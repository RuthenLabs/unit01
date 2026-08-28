import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

import { AllowedPath } from './types.js';

const BLACKLIST = new Set([
  'sudo', 'su', 'docker', 'podman', 'mount', 'umount', 'nsenter', 'unshare',
  'shutdown', 'reboot', 'poweroff', 'dd', 'fdisk', 'mkfs', 'iptables', 'ufw',
  'nerdctl', 'runc', 'containerd'
]);

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/g, // AWS Access Key ID
  /gh[opru]_[0-9a-zA-Z]{36,255}/g, // GitHub Token
  /eyJhbGciOi[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, // JWT Token
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[a-zA-Z0-9/\+=\s\n]+-----END [A-Z ]+ PRIVATE KEY-----/g, // SSH Key
  /xox[bapr]-[0-9]{12}-[0-9]{12}-[0-9]{12}-[a-z0-9]{32}/g, // Slack token
  /sk_live_[0-9a-zA-Z]{24}/g, // Stripe Key
  /AIza[0-9A-Za-z-_]{35}/g, // Google Key
  /(?:aws_secret|aws_token|secret_key|secret)\s*[:=]\s*['\"][A-Za-z0-9/+=]{40}['\"]/gi, // AWS Secret Key assignment
  /bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, // Bearer Token
  /(?:api_key|apikey|password|passwd|token|auth_token)\s*[:=]\s*['\"][^'\"]{10,100}['\"]/gi // Generic credentials
];

export function redactSecrets(content: string): string {
  let redacted = content;
  for (const regex of SECRET_PATTERNS) {
    redacted = redacted.replace(regex, '[REDACTED]');
  }
  return redacted;
}

export function truncateOutput(output: string): string {
  if (output.length <= 2000) {
    return output;
  }
  const first500 = output.slice(0, 500);
  const last500 = output.slice(-500);
  const omittedBytes = output.length - 1000;
  return `${first500}\n\n[${omittedBytes} bytes omitted in middle]\n\n${last500}`;
}

export function containsCdCommand(command: string): boolean {
  // Checks if cd exists with word boundary, indicating a directory change attempt
  const cdRegex = /(?:^|;|&&|\|\||\|)\s*cd\b/;
  return cdRegex.test(command);
}

export function isBlacklisted(command: string): boolean {
  const parts = command.split(/(?:;|&&|\|\||\|)/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const firstWord = trimmed.split(/\s+/)[0];
    if (BLACKLIST.has(firstWord)) {
      return true;
    }
  }
  return false;
}

export class LoopDetector {
  private commandHistory: string[] = [];
  private outputHistory: string[] = [];

  public checkLoop(command: string): boolean {
    if (this.commandHistory.length >= 3) {
      const last3Cmds = this.commandHistory.slice(-3);
      const allSameCmd = last3Cmds.every(cmd => cmd === command);

      // If the exact same command is executed 3 times sequentially, trigger loop detection
      if (allSameCmd) {
        return true;
      }

      // Also check if the outputs are identical (non-empty)
      const last3Outputs = this.outputHistory.slice(-3);
      const allSameOutput = last3Outputs.every(out => out && out === last3Outputs[0]);
      if (allSameOutput) {
        return true;
      }
    }
    return false;
  }

  public record(command: string, output: string) {
    this.commandHistory.push(command);
    this.outputHistory.push(output);

    if (this.commandHistory.length > 5) {
      this.commandHistory.shift();
      this.outputHistory.shift();
    }
  }

  public clear() {
    this.commandHistory = [];
    this.outputHistory = [];
  }
}

const RUNNERS = new Set([
  'python', 'python3', 'node', 'bun', 'deno', 'ts-node', 'tsx', 'bash', 'sh',
  'source', 'perl', 'ruby', 'php', 'pytest', 'unittest', 'npx'
]);

const SCRIPT_EXTS = new Set([
  '.py', '.js', '.ts', '.sh', '.bash', '.jsx', '.tsx', '.rb', '.pl', '.php', '.pyw', '.command'
]);

function splitCommands(command: string): string[] {
  const cmds: string[] = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escape = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escape = true;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += char;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }
    if (!inDoubleQuote && !inSingleQuote) {
      if (char === ';') {
        cmds.push(current);
        current = '';
        continue;
      }
      if (char === '\n') {
        cmds.push(current);
        current = '';
        continue;
      }
      if (char === '&' && command[i + 1] === '&') {
        cmds.push(current);
        current = '';
        i++;
        continue;
      }
      if (char === '|' && command[i + 1] === '|') {
        cmds.push(current);
        current = '';
        i++;
        continue;
      }
      if (char === '|' && command[i + 1] !== '|') {
        cmds.push(current);
        current = '';
        continue;
      }
      if (char === '&' && command[i + 1] !== '&') {
        cmds.push(current);
        current = '';
        continue;
      }
    }
    current += char;
  }
  if (current) {
    cmds.push(current);
  }
  return cmds.map(c => c.trim()).filter(Boolean);
}

function tokenizeCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escape = false;

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i];
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (!inDoubleQuote && !inSingleQuote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function isRunner(firstToken: string, secondToken?: string): boolean {
  const cmdName = path.basename(firstToken);
  if (RUNNERS.has(cmdName)) {
    return true;
  }
  if (cmdName === 'go' && secondToken === 'run') {
    return true;
  }
  if (cmdName === 'cargo' && secondToken === 'run') {
    return true;
  }
  return false;
}

function isTokenAPath(token: string): boolean {
  return token.startsWith('.') || token.startsWith('/') || token.includes('/');
}

function isBuildCommand(tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const first = tokens[0].toLowerCase();
  if (['gcc', 'g++', 'clang', 'clang++', 'make', 'cmake'].includes(first)) {
    return true;
  }
  if (first === 'cargo' && tokens[1] === 'build') {
    return true;
  }
  if (first === 'go' && tokens[1] === 'build') {
    return true;
  }
  if (['npm', 'yarn', 'pnpm', 'bun'].includes(first)) {
    return tokens.slice(1).some(t => t === 'build');
  }
  return false;
}

export class ExecutionGuard {
  private workspaceRoot: string;
  private loopDetector = new LoopDetector();
  private writtenFiles = new Set<string>();
  private sessionStartTime: number;
  private allowedPaths: AllowedPath[] = [];
  private onSystemMessage?: (type: 'error' | 'warn' | 'guard' | 'info' | 'stop', message: string) => void;
  private commandTimeoutMs: number;

  constructor(
    workspaceRoot: string,
    allowedPaths: AllowedPath[] = [],
    onSystemMessage?: (type: 'error' | 'warn' | 'guard' | 'info' | 'stop', message: string) => void,
    commandTimeoutMs: number = 30000
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.sessionStartTime = Date.now();
    this.allowedPaths = allowedPaths;
    this.onSystemMessage = onSystemMessage;
    this.commandTimeoutMs = commandTimeoutMs > 0 ? commandTimeoutMs : 30000;
  }

  public updateAllowedPaths(allowedPaths: AllowedPath[]) {
    this.allowedPaths = allowedPaths;
  }

  public isPathAllowed(child: string): boolean {
    const absParent = path.resolve(this.workspaceRoot);
    const absChild = path.resolve(child);
    
    // Check workspace root
    const relativeToParent = path.relative(absParent, absChild);
    if (relativeToParent === '' || (!relativeToParent.startsWith('..') && !path.isAbsolute(relativeToParent))) {
      return true;
    }
    
    // Check allowed paths
    for (const allowed of this.allowedPaths) {
      const absAllowed = path.resolve(allowed.path);
      const relativeToAllowed = path.relative(absAllowed, absChild);
      if (relativeToAllowed === '' || (!relativeToAllowed.startsWith('..') && !path.isAbsolute(relativeToAllowed))) {
        return true;
      }
    }
    
    return false;
  }

  public isPathWriteAllowed(child: string): boolean {
    const absParent = path.resolve(this.workspaceRoot);
    const absChild = path.resolve(child);
    
    // Check workspace root
    const relativeToParent = path.relative(absParent, absChild);
    if (relativeToParent === '' || (!relativeToParent.startsWith('..') && !path.isAbsolute(relativeToParent))) {
      return true;
    }
    
    // Check allowed paths
    for (const allowed of this.allowedPaths) {
      if (allowed.mode !== 'rw') continue;
      const absAllowed = path.resolve(allowed.path);
      const relativeToAllowed = path.relative(absAllowed, absChild);
      if (relativeToAllowed === '' || (!relativeToAllowed.startsWith('..') && !path.isAbsolute(relativeToAllowed))) {
        return true;
      }
    }
    
    return false;
  }

  public recordWrittenFile(filePath: string) {
    const absPath = path.resolve(this.workspaceRoot, filePath);
    this.writtenFiles.add(absPath);
  }

  private checkWriteBeforeRun(command: string): string | null {
    const subCommands = splitCommands(command);
    let seenBuildStep = false;

    for (const subCmd of subCommands) {
      const tokens = tokenizeCommand(subCmd);
      if (tokens.length === 0) continue;

      if (isBuildCommand(tokens)) {
        seenBuildStep = true;
      }

      let fileToExecute: string | null = null;
      let startIndex = 0;
      if (tokens[startIndex] === 'env' || tokens[startIndex] === '/usr/bin/env') {
        startIndex++;
      }
      if (startIndex >= tokens.length) continue;

      const firstToken = tokens[startIndex];
      const cmdName = path.basename(firstToken);
      const isCmdInsideWorkspace = isTokenAPath(firstToken) && this.isPathAllowed(firstToken);

      if (isCmdInsideWorkspace) {
        fileToExecute = path.resolve(this.workspaceRoot, firstToken);
      } else {
        const secondToken = tokens[startIndex + 1];
        const isRun = isRunner(firstToken, secondToken);
        if (isRun) {
          const skipOffset = (cmdName === 'go' || cmdName === 'cargo') ? 2 : 1;
          for (let i = startIndex + skipOffset; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.startsWith('-')) continue;
            const absTokenPath = path.resolve(this.workspaceRoot, token);
            if (isTokenAPath(token) && this.isPathAllowed(absTokenPath)) {
              const ext = path.extname(absTokenPath).toLowerCase();
              const isScriptExt = SCRIPT_EXTS.has(ext);
              const isDirectExec = token.startsWith('.') || token.startsWith('/');
              if (isScriptExt || isDirectExec) {
                fileToExecute = absTokenPath;
                break;
              }
            }
          }
        }
      }

      if (fileToExecute) {
        if (seenBuildStep) {
          this.recordWrittenFile(fileToExecute);
        }

        let exists = fs.existsSync(fileToExecute);
        let wasWritten = this.writtenFiles.has(fileToExecute);

        if (seenBuildStep) {
          exists = true;
          wasWritten = true;
        }

        if (exists && !wasWritten) {
          try {
            const stat = fs.statSync(fileToExecute);
            if (stat.mtimeMs >= this.sessionStartTime) {
              wasWritten = true;
            }
          } catch (e) {}
        }

        if (!exists || !wasWritten) {
          const relPath = path.relative(this.workspaceRoot, fileToExecute);
          return JSON.stringify({
            error: "File not found. Did you mean to write it first? Write the file using write_file before executing it.",
            code: "FILE_NOT_WRITTEN",
            filePath: relPath
          });
        }
      }
    }
    return null;
  }



  public clearLoopHistory() {
    this.loopDetector.clear();
  }

  private resolvePaths(command: string): string {
    const parts = command.split(/(\s+)/);
    const keywords = new Set(['go', 'run', 'python', 'node', 'npm', 'cargo', 'rustc', 'pip', '&&', '||', '|', ';', '>', '>>', 'cat', 'grep', 'rm', 'mkdir', 'touch']);
    
    const resolvedParts = parts.map(part => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      
      let word = trimmed;
      let quote = '';
      if ((word.startsWith("'") && word.endsWith("'")) || (word.startsWith('"') && word.endsWith('"'))) {
        quote = word[0];
        word = word.slice(1, -1);
      }
      
      const isUri = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(word);
      const isSsh = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9.-]+:/.test(word);
      if (word.startsWith('-') || word.startsWith('/') || keywords.has(word) || isUri || isSsh) {
        return part;
      }
      
      const looksLikePath = word.includes('/') || word.startsWith('.') || /\.[a-zA-Z0-9]+$/.test(word);
      const absPath = path.resolve(this.workspaceRoot, word);
      let exists = false;
      try {
        exists = fs.existsSync(absPath);
      } catch (e) {}
      
      if (exists || looksLikePath) {
        return quote + absPath + quote;
      }
      
      return part;
    });
    
    return resolvedParts.join('');
  }

  private isCommandAvailable(cmd: string): boolean {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a shell command with guardrails (path checks, blacklist, loop detection, timeout).
   */
  public async runCommand(command: string, customTimeoutMs?: number): Promise<string> {
    const resolvedCommand = this.resolvePaths(command.trim());
    const trimmedCommand = resolvedCommand.trim();

    // 0. Write-before-run enforcement check:
    const fileNotWrittenError = this.checkWriteBeforeRun(trimmedCommand);
    if (fileNotWrittenError) {
      return fileNotWrittenError;
    }

    // 1. Block cd commands
    if (containsCdCommand(trimmedCommand)) {
      return '[unit01] Directory changes not allowed. Use absolute paths.';
    }

    // 2. Blacklist check
    if (isBlacklisted(trimmedCommand)) {
      return '[unit01] Command not allowed by security policy.';
    }

    // 3. Loop detection check
    if (this.loopDetector.checkLoop(trimmedCommand)) {
      return '[unit01] Loop detected — same command ran 3 times with same result. Stop and try a different approach.';
    }

    // 4. Set up resource limit ulimit prefix
    const ulimitPrefix = 'ulimit -n 2048';
    const innerCommand = `${ulimitPrefix} && ${trimmedCommand}`;

    // 5. Execute on host shell
    const execCommand = '/bin/sh';
    const execArgs = ['-c', innerCommand];
    const env = { ...process.env };

    const timeoutMs = (customTimeoutMs && customTimeoutMs > 0) ? customTimeoutMs : this.commandTimeoutMs;
    const timeoutSec = Math.max(1, Math.round(timeoutMs / 1000));

    return new Promise((resolve) => {
      const MAX_STREAM_BYTES = 256 * 1024; // 256KB cap on collected process output stream
      let outputBuffer = '';
      let streamCapped = false;

      const child = spawn(execCommand, execArgs, {
        cwd: this.workspaceRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => {
        if (outputBuffer.length < MAX_STREAM_BYTES) {
          outputBuffer += data.toString();
          if (outputBuffer.length >= MAX_STREAM_BYTES) {
            outputBuffer = outputBuffer.slice(0, MAX_STREAM_BYTES);
            streamCapped = true;
          }
        }
      });

      child.stderr.on('data', (data) => {
        if (outputBuffer.length < MAX_STREAM_BYTES) {
          outputBuffer += data.toString();
          if (outputBuffer.length >= MAX_STREAM_BYTES) {
            outputBuffer = outputBuffer.slice(0, MAX_STREAM_BYTES);
            streamCapped = true;
          }
        }
      });

      // Implement timeout logic: timeoutMs SIGTERM -> wait 2s -> SIGKILL
      let killed = false;
      const timeoutTimer = setTimeout(() => {
        if (this.onSystemMessage) {
          this.onSystemMessage('warn', `Command timed out after ${timeoutSec}s: "${trimmedCommand}". Sending SIGTERM...`);
        }
        killed = true;
        child.kill('SIGTERM');

        const killForceTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 2000);

        child.once('close', () => {
          clearTimeout(killForceTimer);
        });
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeoutTimer);

        let result = outputBuffer;
        if (streamCapped) {
          result += '\n[unit01] Process output exceeded 256KB and was capped in memory.';
        }
        if (killed) {
          result += `\n[unit01] Process terminated: execution timed out after ${timeoutSec} seconds.`;
        } else if (code !== 0 && code !== null) {
          result = `[Command failed with exit code ${code}]\n${result}`;
        }

        // Apply truncation and secret redaction
        const redacted = redactSecrets(result);
        const truncated = truncateOutput(redacted);

        // Record execution in loop detector
        this.loopDetector.record(trimmedCommand, truncated);

        resolve(truncated);
      });

      child.on('error', (err) => {
        clearTimeout(timeoutTimer);
        resolve(`[unit01] Execution failed to start: ${err.message}`);
      });
    });
  }
}
