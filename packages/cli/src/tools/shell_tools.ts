import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { isPro } from '@unit01/core/tier.js';
import { redactSecrets } from '@unit01/core/security/guard.js';
import { themePrimary, themeOrange, themeAccent, isGui, guiEmit } from '../views/theme.js';
import { parseRunCommand, parseGitStatus, parseDiagnosticsTag, parseDiagnostics } from '../parser.js';
import { ToolContext, ToolResult } from './types.js';

export async function handleRunCommand(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const runCmd = parseRunCommand(text);
  if (runCmd === null) return null;

  const { ui, guard, indexer } = ctx;
  const cmd = runCmd;
  if (isGui) guiEmit({ type: 'tool-call', tool: 'run_command', command: cmd });
  ui.showToolProgress(`${themePrimary('run')} ${cmd}...`);
  const output = await guard.runCommand(cmd);
  ui.hideToolProgress();

  if (output.startsWith('[unit01]')) {
    const sanitizedCmd = redactSecrets(cmd);
    ui.printToolResult('failure', `Ran: ${sanitizedCmd} (blocked)`);
    ui.printSystemMessage('guard', `command blocked  ·  ${sanitizedCmd}`);
    if (isPro()) {
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer.db);
        const payloadHash = crypto.createHash('sha256').update(cmd).digest('hex');
        auditStore.logAction({
          service: 'shell',
          operation: 'execute_script',
          target: sanitizedCmd,
          payload_summary: `Command blocked by guard: ${sanitizedCmd}`,
          payload_hash: payloadHash,
          status: 'denied'
        });
      } catch (_) {}
    }
    return {
      toolRun: false,
      nextPrompt: '',
      consoleOutput: `\n[Blocked: ${sanitizedCmd}]`
    };
  }

  if (output.startsWith('{') && output.includes('FILE_NOT_WRITTEN')) {
    ui.printToolResult('failure', `Ran: ${cmd} (failed: file not written)`);
    if (isPro()) {
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer.db);
        const payloadHash = crypto.createHash('sha256').update(cmd).digest('hex');
        auditStore.logAction({
          service: 'shell',
          operation: 'execute_script',
          target: cmd,
          payload_summary: `Failed to execute command (file not written)`,
          payload_hash: payloadHash,
          status: 'failed'
        });
      } catch (_) {}
    }
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${output}\n</tool_output>`,
      consoleOutput: `\n[Failed: ${cmd}]`
    };
  }

  if (output.startsWith('[Command failed with exit code')) {
    const match = output.match(/exit code (\d+)/);
    const exitCode = match ? match[1] : '1';
    ui.printToolResult('failure', `Ran: ${cmd} (exit ${exitCode})`);
    if (isPro()) {
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer.db);
        const payloadHash = crypto.createHash('sha256').update(cmd).digest('hex');
        auditStore.logAction({
          service: 'shell',
          operation: 'execute_script',
          target: cmd,
          payload_summary: `Command failed with exit code ${exitCode}`,
          payload_hash: payloadHash,
          status: 'failed'
        });
      } catch (_) {}
    }
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${output.trim()}\n</tool_output>`,
      consoleOutput: `\n[Failed: ${cmd}]`
    };
  }

  ui.printToolResult('success', `Ran: ${cmd} (exit 0)`);
  const outputResult = output.trim() || 'Command executed successfully with no output.';
  if (isPro()) {
    try {
      const crypto = await import('crypto');
      const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
      const auditStore = new AuditLogStore(indexer.db);
      const payloadHash = crypto.createHash('sha256').update(cmd).digest('hex');
      auditStore.logAction({
        service: 'shell',
        operation: 'execute_script',
        target: redactSecrets(cmd),
        payload_summary: outputResult.length > 100 ? outputResult.substring(0, 100) + '...' : outputResult,
        payload_hash: payloadHash,
        status: 'completed'
      });
    } catch (_) {}
  }
  return {
    toolRun: true,
    nextPrompt: `<tool_output>\n${outputResult}\n</tool_output>`,
    consoleOutput: `\n[Command output executed: ${redactSecrets(cmd)}]`
  };
}

export async function handleGitStatus(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  if (!parseGitStatus(text)) return null;

  const { ui, guard } = ctx;
  if (isGui) guiEmit({ type: 'tool-call', tool: 'git_status' });
  ui.showToolProgress(`${themeAccent('git_status')}...`);

  try {
    let isGit = false;
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: guard['workspaceRoot'], stdio: 'ignore' });
      isGit = true;
    } catch (e) {}

    if (!isGit) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Ran git status (failed: not a git repo)`);
      const errObj = {
        error: "Not a git repository",
        code: "NOT_GIT_REPO"
      };
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
        consoleOutput: `\n[Git status failed: Not a git repository]`
      };
    }

    const branch = execSync('git branch --show-current', { cwd: guard['workspaceRoot'] }).toString().trim();
    const statusText = execSync('git status --porcelain', { cwd: guard['workspaceRoot'] }).toString().trim();

    const lines = statusText ? statusText.split('\n') : [];
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const x = line[0];
      const y = line[1];
      const file = line.slice(3).replace(/^["']|["']$/g, '');

      if (x === '?' && y === '?') {
        untracked.push(file);
      } else {
        if (x !== ' ' && x !== '?') {
          staged.push(file);
        }
        if (y !== ' ' && y !== '?') {
          unstaged.push(file);
        }
      }
    }

    let ahead = 0;
    let behind = 0;
    try {
      const revList = execSync('git rev-list --left-right --count HEAD...@{u}', { cwd: guard['workspaceRoot'], stdio: 'pipe' }).toString().trim();
      const parts = revList.split(/\s+/);
      if (parts.length === 2) {
        ahead = parseInt(parts[0], 10) || 0;
        behind = parseInt(parts[1], 10) || 0;
      }
    } catch (e) {}

    const result = {
      branch,
      staged,
      unstaged,
      untracked,
      ahead,
      behind
    };

    ui.hideToolProgress();
    ui.printToolResult('success', `Ran git status`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
      consoleOutput: `\n[Git status completed]`
    };
  } catch (err: any) {
    ui.hideToolProgress();
    ui.printToolResult('failure', `Ran git status (failed: ${err.message})`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nError running git status: ${err.message}\n</tool_output>`,
      consoleOutput: `\n[Git status failed: ${err.message}]`
    };
  }
}

export async function handleDiagnostics(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const diagResult = parseDiagnosticsTag(text);
  if (diagResult === null) return null;

  const { ui, guard } = ctx;
  let commandToRun = diagResult.command;
  const workspaceRoot = guard['workspaceRoot'];

  if (!commandToRun) {
    if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) {
      let hasLintScript = false;
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8'));
        if (pkg.scripts && pkg.scripts.lint) {
          hasLintScript = true;
        }
      } catch (e) {}
      commandToRun = hasLintScript ? 'npm run lint' : 'npm run build';
    } else if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
      commandToRun = 'cargo check';
    } else if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
      commandToRun = 'go build ./...';
    } else if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) || fs.existsSync(path.join(workspaceRoot, 'setup.py'))) {
      commandToRun = 'python -m py_compile';
    }
  }

  if (!commandToRun) {
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${JSON.stringify({
        passed: true,
        errors: [],
        warnings: [],
        raw: "No standard project configuration (package.json, Cargo.toml, go.mod, pyproject.toml, setup.py) detected to run diagnostics."
      }, null, 2)}\n</tool_output>`,
      consoleOutput: `\n[Diagnostics skipped: No configuration]`
    };
  }

  if (isGui) guiEmit({ type: 'tool-call', tool: 'diagnostics', command: commandToRun });
  process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('diagnostics')} (running "${commandToRun}") ...`);

  try {
    const rawOutput = await guard.runCommand(commandToRun);
    
    const parsed = parseDiagnostics(rawOutput);
    const result = {
      passed: parsed.passed,
      errors: parsed.errors,
      warnings: parsed.warnings,
      raw: rawOutput
    };

    ui.hideToolProgress();
    ui.printToolResult('success', `Ran diagnostics: ${commandToRun}`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
      consoleOutput: `\n[Diagnostics completed: "${commandToRun}"]`
    };
  } catch (err: any) {
    ui.hideToolProgress();
    ui.printToolResult('failure', `Ran diagnostics: ${commandToRun} (failed)`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nError running diagnostics: ${err.message}\n</tool_output>`,
      consoleOutput: `\n[Diagnostics failed]`
    };
  }
}
