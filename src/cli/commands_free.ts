
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { DirectiveIndexer } from '../core/indexer/index.js';
import { DirectiveSandbox } from '../core/security/sandbox.js';
import { buildRepoMap } from '../core/indexer/repomap.js';
import { AllowedPath } from '../core/security/types.js';
import { ChunkRecord } from '../core/database/db.js';
import {
  themePrimary,
  themeOrange,
  themeAccent,
  themeGray,
  themeRed,
  isGui,
  guiEmit
} from './views/theme.js';
import { UiAdapter } from './types.js';


import {
  parseRunCommand,
  parseWriteFile,
  parseReadFile,
  parseSearchCode,
  parseWebSearch,
  parsePatchFile,
  parsePatchFileBlocks,
  parseListDir,
  parseGitStatus,
  parseDiagnosticsTag,
  parseMoveFile,
  parseQuestion,
  validateToolCall,
  getLanguageFromFilename,
  applySearchReplaceBlocks,
  listDirectory,
  parseDiagnostics,
  parseViewOutline,
  parseAskUser,
  parseDeleteFile,
  parseMakeDir,
  parseCopyFile
} from './parser.js';

export interface CliState {
  lastWrittenFile: {
    filePath: string;
    original: string | null;
    content: string;
  } | null;
  activeAllowedPaths: AllowedPath[];
  isNonInteractive: boolean;
}

async function requestPathAccess(
  absPath: string,
  mode: 'ro' | 'rw',
  ui: UiAdapter,
  state: CliState,
  sandbox: DirectiveSandbox
): Promise<boolean> {
  const options = mode === 'rw' 
    ? ['Allow read-write', 'Allow read-only', 'Deny']
    : ['Allow read-only', 'Deny'];
  
  const question = `I need access to ${absPath} to complete this task. Grant access?`;
  if (isGui) guiEmit({ type: 'tool-call', tool: 'ask_user', question, options });

  let chosenIdx = 0;
  if (state.isNonInteractive || typeof process.stdin.setRawMode !== 'function') {
    console.log(`\n${themePrimary.bold(question)}`);
    options.forEach((opt, idx) => console.log(`  ${idx + 1}) ${opt}`));
    chosenIdx = 0;
  } else {
    chosenIdx = await ui.interactiveSelect(question, options);
  }

  const choice = options[chosenIdx];
  if (choice === 'Allow read-write') {
    if (!state.activeAllowedPaths.some(ap => ap.path === absPath && ap.mode === 'rw')) {
      state.activeAllowedPaths = state.activeAllowedPaths.filter(ap => ap.path !== absPath);
      state.activeAllowedPaths.push({ path: absPath, mode: 'rw' });
    }
    sandbox.updateAllowedPaths(state.activeAllowedPaths);
    return true;
  }
  if (choice === 'Allow read-only') {
    if (!state.activeAllowedPaths.some(ap => ap.path === absPath)) {
      state.activeAllowedPaths.push({ path: absPath, mode: 'ro' });
    }
    sandbox.updateAllowedPaths(state.activeAllowedPaths);
    return true;
  }
  return false;
}

export async function handleToolCalls(
  text: string,
  sandbox: DirectiveSandbox,
  indexer: DirectiveIndexer,
  ui: UiAdapter,
  state: CliState
): Promise<{ toolRun: boolean; nextPrompt: string; consoleOutput: string }> {
  // Parse and validate all XML/HTML tags
  const openTagRegex = /<([a-zA-Z_][a-zA-Z0-9_\-]*)([^>]*)>/g;
  let match;
  while ((match = openTagRegex.exec(text))) {
    const tagName = match[1];
    const attributesStr = match[2];
    
    // Check if tag is a tool
    const isTool = [
      'run_command', 'read_file', 'write_file', 'patch_file', 'patch_file_blocks',
      'delete_file', 'list_dir', 'search_code', 'web_search', 'view_outline',
      'ask_user', 'move_file', 'git_status', 'diagnostics',
      'sandbox_exec', 'question', 'path_question', 'mcp_tool'
    ].includes(tagName);
    
    if (isTool) {
      const errorMsg = validateToolCall(tagName, attributesStr);
      if (errorMsg) {
        console.log(`\n  ${chalk.red('✗')} tool call ${chalk.yellow(`<${tagName}>`)} (blocked: invalid/wrong arguments)`);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${errorMsg}\n</tool_output>`,
          consoleOutput: `\n[Tool call blocked: <${tagName}>]`
        };
      }
    }
  }

  const deletePath = parseDeleteFile(text);
  if (deletePath !== null) {
    const absPath = path.resolve(sandbox['workspaceRoot'], deletePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'delete_file', filePath: deletePath });

    if (!sandbox.isPathWriteAllowed(absPath)) {
      const granted = await requestPathAccess(absPath, 'rw', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absPath
          })}\n</tool_output>`,
          consoleOutput: `\n[Delete blocked (not allowed): ${deletePath}]`
        };
      }
    }

    if (!fs.existsSync(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: File not found at ${deletePath}\n</tool_output>`,
        consoleOutput: `\n[Delete failed: File not found: ${deletePath}]`
      };
    }

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: delete_file only supports deleting files, not directories. Use run_command with rm -rf to delete directories.\n</tool_output>`,
        consoleOutput: `\n[Delete blocked: target is a directory: ${deletePath}]`
      };
    }

    let userConfirmed = false;
    const choice = await ui.interactiveConfirmWrite(deletePath, 0, 'delete' as any);
    if (choice === 'y') {
      userConfirmed = true;
    }

    if (!userConfirmed) {
      ui.printToolResult('skipped', `Skipped deleting ${deletePath}`);
      return {
        toolRun: false,
        nextPrompt: '',
        consoleOutput: `\n[Delete rejected by user: ${deletePath}]`
      };
    }

    ui.showToolProgress(`${themeAccent('delete')} ${deletePath}...`);
    try {
      // 1. Shadow backup BEFORE deleting so it is undoable!
      indexer.backupBeforeWrite(absPath);

      // 2. Unlink the file
      fs.unlinkSync(absPath);

      sandbox.clearLoopHistory();
      
      // 3. Remove file from indexer DB
      indexer.db.removeFile(absPath);
      indexer.currentRepoMap = buildRepoMap(indexer.db);

      ui.hideToolProgress();
      ui.printToolResult('success', `Deleted ${deletePath}`);

      // Pro Auditing
      

      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully deleted: ${deletePath}\n</tool_output>`,
        consoleOutput: `\n[File deleted: ${deletePath}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Delete ${deletePath} — failed: ${err.message}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError deleting file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File delete failed: ${deletePath}]`
      };
    }
  }

  const makeDirPath = parseMakeDir(text);
  if (makeDirPath !== null) {
    const absPath = path.resolve(sandbox['workspaceRoot'], makeDirPath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'make_dir', filePath: makeDirPath });

    if (!sandbox.isPathWriteAllowed(absPath)) {
      const granted = await requestPathAccess(absPath, 'rw', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absPath
          })}\n</tool_output>`,
          consoleOutput: `\n[MakeDir blocked (not allowed): ${makeDirPath}]`
        };
      }
    }

    if (fs.existsSync(absPath)) {
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\nDirectory already exists: ${makeDirPath}\n</tool_output>`,
          consoleOutput: `\n[MakeDir skipped: already exists: ${makeDirPath}]`
        };
      } else {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\nError: Path ${makeDirPath} exists and is a file, not a directory.\n</tool_output>`,
          consoleOutput: `\n[MakeDir failed: path is a file: ${makeDirPath}]`
        };
      }
    }

    ui.showToolProgress(`${themeAccent('mkdir')} ${makeDirPath}...`);
    try {
      fs.mkdirSync(absPath, { recursive: true });
      ui.hideToolProgress();
      ui.printToolResult('success', `Created directory ${makeDirPath}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nDirectory successfully created: ${makeDirPath}\n</tool_output>`,
        consoleOutput: `\n[Directory created: ${makeDirPath}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `MakeDir ${makeDirPath} — failed: ${err.message}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError creating directory: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Directory create failed: ${makeDirPath}]`
      };
    }
  }

  const copyFileParams = parseCopyFile(text);
  if (copyFileParams !== null) {
    const { sourcePath, destinationPath } = copyFileParams;
    const absSrc = path.resolve(sandbox['workspaceRoot'], sourcePath);
    const absDest = path.resolve(sandbox['workspaceRoot'], destinationPath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'copy_file', sourcePath, destinationPath });

    if (!sandbox.isPathAllowed(absSrc)) {
      const granted = await requestPathAccess(absSrc, 'ro', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Source path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absSrc
          })}\n</tool_output>`,
          consoleOutput: `\n[Copy blocked (src not allowed): ${sourcePath}]`
        };
      }
    }

    if (!sandbox.isPathWriteAllowed(absDest)) {
      const granted = await requestPathAccess(absDest, 'rw', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Destination path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absDest
          })}\n</tool_output>`,
          consoleOutput: `\n[Copy blocked (dest not allowed): ${destinationPath}]`
        };
      }
    }

    if (!fs.existsSync(absSrc)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: Source file not found: ${sourcePath}\n</tool_output>`,
        consoleOutput: `\n[Copy failed: src not found: ${sourcePath}]`
      };
    }

    const srcStat = fs.statSync(absSrc);
    if (srcStat.isDirectory()) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: copy_file only supports copying files, not directories.\n</tool_output>`,
        consoleOutput: `\n[Copy failed: src is directory: ${sourcePath}]`
      };
    }

    let userConfirmed = false;
    const choice = await ui.interactiveConfirmWrite(destinationPath, 0, 'write');
    if (choice === 'y') {
      userConfirmed = true;
    }

    if (!userConfirmed) {
      ui.printToolResult('skipped', `Skipped copying to ${destinationPath}`);
      return {
        toolRun: false,
        nextPrompt: '',
        consoleOutput: `\n[Copy rejected by user: ${destinationPath}]`
      };
    }

    ui.showToolProgress(`${themeAccent('copy')} ${sourcePath} -> ${destinationPath}...`);
    try {
      // Create parent directories if they don't exist
      const parentDir = path.dirname(absDest);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      // Backup destination if it exists
      if (fs.existsSync(absDest)) {
        indexer.backupBeforeWrite(absDest);
      }

      fs.copyFileSync(absSrc, absDest);
      
      sandbox.clearLoopHistory();

      // Add to indexer DB
      try {
        const stats = fs.statSync(absDest);
        indexer.processFileOnStartup(absDest, stats, { silent: true });
        indexer.currentRepoMap = buildRepoMap(indexer.db);
      } catch (_) {}

      ui.hideToolProgress();
      ui.printToolResult('success', `Copied ${sourcePath} to ${destinationPath}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully copied from ${sourcePath} to ${destinationPath}\n</tool_output>`,
        consoleOutput: `\n[File copied: ${sourcePath} -> ${destinationPath}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Copy ${sourcePath} -> ${destinationPath} — failed: ${err.message}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError copying file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Copy failed: ${sourcePath} -> ${destinationPath}]`
      };
    }
  }

  const outlinePath = parseViewOutline(text);
  if (outlinePath !== null) {
    const absPath = path.resolve(sandbox['workspaceRoot'], outlinePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'view_outline', outlinePath });

    if (!sandbox.isPathAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace.`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Outline blocked (not allowed): ${outlinePath}]`
      };
    }

    ui.showToolProgress(`${themeAccent('outline')} ${outlinePath}...`);
    try {
      if (!fs.existsSync(absPath)) {
        ui.hideToolProgress();
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\nError: File not found at ${outlinePath}\n</tool_output>`,
          consoleOutput: `\n[Outline failed: not found: ${outlinePath}]`
        };
      }

      const chunks = indexer.db.getChunksForFile(absPath);
      ui.hideToolProgress();
      ui.printToolResult('success', `Outlined ${outlinePath}`);

      if (chunks.length === 0) {
        const fileContent = fs.readFileSync(absPath, 'utf-8');
        const lines = fileContent.split('\n');
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\nNo structural outline symbols indexed for this file type. Showing preview (first 50 lines):\n${lines.slice(0, 50).join('\n')}\n</tool_output>`,
          consoleOutput: `\n[Outline: no symbols found, preview shown]`
        };
      }

      const outline = chunks.map(c => `- [${c.chunk_type}] ${c.name} (Lines ${c.start_line}-${c.end_line})`).join('\n');
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile outline for ${outlinePath}:\n${outline}\n</tool_output>`,
        consoleOutput: `\n[Outline retrieved: ${outlinePath}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError retrieving outline: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Outline failed: ${outlinePath}]`
      };
    }
  }

  const askUserResult = parseAskUser(text);
  if (askUserResult !== null) {
    let { question, options } = askUserResult;

    // Auto-override path access options if the model generates a "Deny" only select box
    const isPathAccess = question.includes('/') || question.includes('~') || question.toLowerCase().includes('path') || question.toLowerCase().includes('access');
    if (isPathAccess && (options.length === 0 || (options.length === 1 && options[0].toLowerCase() === 'deny') || !options.includes('Allow read-write'))) {
      options = ['Allow read-write', 'Allow read-only', 'Deny'];
    }

    if (isGui) guiEmit({ type: 'tool-call', tool: 'ask_user', question, options });

    let chosenIdx = 0;
    if (state.isNonInteractive || typeof process.stdin.setRawMode !== 'function') {
      console.log(`\n${themePrimary.bold(question)}`);
      options.forEach((opt, idx) => console.log(`  ${idx + 1}) ${opt}`));
      chosenIdx = 0;
    } else {
      chosenIdx = await ui.interactiveSelect(question, options);
    }

    const choice = options[chosenIdx];
    
    // Extract path from question
    let extractedPath: string | null = null;
    const regex = new RegExp("(?:^|\\s|['\"`])(\\/[^'\"\\s]+|~\\/[^'\"\\s]+|~)");
    const pathMatch = question.match(regex);
    if (pathMatch) {
      let p = pathMatch[1];
      while (p && /[?.!,;]$/.test(p)) {
        p = p.slice(0, -1);
      }
      extractedPath = p;
    }

    if (choice === 'Allow read-write') {
      if (extractedPath) {
        let resolvedPath = extractedPath;
        if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
          resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
        }
        const absPath = path.resolve(resolvedPath);
        if (!state.activeAllowedPaths.some(ap => ap.path === absPath && ap.mode === 'rw')) {
          state.activeAllowedPaths = state.activeAllowedPaths.filter(ap => ap.path !== absPath);
          state.activeAllowedPaths.push({ path: absPath, mode: 'rw' });
        }
        sandbox.updateAllowedPaths(state.activeAllowedPaths);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            granted: true,
            path: absPath,
            mode: 'rw',
            message: 'Access granted. Mount added dynamically.'
          })}\n</tool_output>`,
          consoleOutput: `\n[Permission granted (rw): ${absPath}]`
        };
      }
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          granted: true,
          message: 'Access granted.'
        })}\n</tool_output>`,
        consoleOutput: `\n[Permission granted]`
      };
    }

    if (choice === 'Allow read-only') {
      if (extractedPath) {
        let resolvedPath = extractedPath;
        if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
          resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
        }
        const absPath = path.resolve(resolvedPath);
        if (!state.activeAllowedPaths.some(ap => ap.path === absPath)) {
          state.activeAllowedPaths.push({ path: absPath, mode: 'ro' });
        }
        sandbox.updateAllowedPaths(state.activeAllowedPaths);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            granted: true,
            path: absPath,
            mode: 'ro',
            message: 'Access granted. Mount added dynamically.'
          })}\n</tool_output>`,
          consoleOutput: `\n[Permission granted (ro): ${absPath}]`
        };
      }
    }

    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${JSON.stringify({
        granted: false,
        choice,
        message: `User chose: ${choice}`
      })}\n</tool_output>`,
      consoleOutput: `\n[User response: ${choice}]`
    };
  }

  const runCmd = parseRunCommand(text);
  if (runCmd !== null) {
    const cmd = runCmd;
    if (isGui) guiEmit({ type: 'tool-call', tool: 'run_command', command: cmd });
    ui.showToolProgress(`${themePrimary('run')} ${cmd}...`);
    const output = await sandbox.runCommand(cmd);
    ui.hideToolProgress();

    if (output.startsWith('[DIRECTIVE AI]')) {
      ui.printToolResult('failure', `Ran: ${cmd} (blocked)`);
      ui.printSystemMessage('guard', `command blocked  ·  ${cmd}`);
      
      return {
        toolRun: false,
        nextPrompt: '',
        consoleOutput: `\n[Blocked: ${cmd}]`
      };
    }

    if (output.startsWith('{') && output.includes('FILE_NOT_WRITTEN')) {
      ui.printToolResult('failure', `Ran: ${cmd} (failed: file not written)`);
      
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
      
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${output.trim()}\n</tool_output>`,
        consoleOutput: `\n[Failed: ${cmd}]`
      };
    }

    ui.printToolResult('success', `Ran: ${cmd} (exit 0)`);
    const outputResult = output.trim() || 'Command executed successfully with no output.';
    
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${outputResult}\n</tool_output>`,
      consoleOutput: `\n[Sandbox output executed: ${cmd}]`
    };
  }

  const writeResult = parseWriteFile(text);
  if (writeResult) {
    const filePath = writeResult.filePath;
    const content = writeResult.content;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'write_file', filePath });
    
    if (!sandbox.isPathWriteAllowed(absPath)) {
      const granted = await requestPathAccess(absPath, 'rw', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absPath
          })}\n</tool_output>`,
          consoleOutput: `\n[Write blocked (not allowed): ${filePath}]`
        };
      }
    }

    const fileExists = fs.existsSync(absPath);
    const original = fileExists ? fs.readFileSync(absPath, 'utf-8') : null;
    
    if (original !== null && original.trim() === content.trim()) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nNo changes detected. The proposed content for ${filePath} matches the existing content.\n</tool_output>`,
        consoleOutput: `\n[No changes detected: ${filePath}]`
      };
    }
    
    state.lastWrittenFile = {
      filePath,
      original,
      content
    };
    
    const lineCount = content.split('\n').length;
    const actionVerb: 'write' | 'create' | 'modify' = fileExists ? 'modify' : 'create';

    let userConfirmed = false;
    while (true) {
      const choice = await ui.interactiveConfirmWrite(filePath, lineCount, actionVerb);
      if (choice === 'y') {
        userConfirmed = true;
        break;
      } else if (choice === 'n') {
        userConfirmed = false;
        break;
      } else if (choice === 'p') {
        if (fileExists && original !== null) {
          ui.showDiff(original, content, getLanguageFromFilename(filePath), filePath);
        } else {
          ui.showDiff(null, content, getLanguageFromFilename(filePath), filePath);
        }
      }
    }
    
    if (!userConfirmed) {
      ui.printToolResult('skipped', `Skipped ${filePath}`);
      return {
        toolRun: false,
        nextPrompt: '',
        consoleOutput: `\n[Write rejected by user: ${filePath}]`
      };
    }
    
    process.stdout.write(`  ${themeOrange('⠋')} ${themeAccent('write')} ${filePath} ...`);
    try {
      indexer.backupBeforeWrite(absPath);
      
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf-8');
      
      // Clear sandbox loop history since file modification changes workspace state
      sandbox.clearLoopHistory();
      
      // Record written file for sandbox write-before-run enforcement
      sandbox.recordWrittenFile(absPath);
      
      // Re-index
      try {
        const stat = fs.statSync(absPath);
        indexer.processFileOnStartup(absPath, stat);
        indexer.currentRepoMap = buildRepoMap(indexer.db);
      } catch (e) {}
      
      ui.hideToolProgress();
      ui.printToolResult('success', `Wrote ${filePath} (${lineCount} lines)`);
      
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully written and indexed at ${filePath}\n</tool_output>`,
        consoleOutput: `\n[File written: ${filePath}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Wrote ${filePath} — failed: ${err.message}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError writing file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File write failed: ${filePath}]`
      };
    }
  }

  const readPath = parseReadFile(text);
  if (readPath !== null) {
    const filePath = readPath;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'read_file', filePath });
    
    if (!sandbox.isPathAllowed(absPath)) {
      const granted = await requestPathAccess(absPath, 'ro', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absPath
          })}\n</tool_output>`,
          consoleOutput: `\n[Read blocked (not allowed): ${filePath}]`
        };
      }
    }

    ui.showToolProgress(`${themeAccent('read')} ${filePath}...`);
    
    let content = '';
    let success = false;
    try {
      if (fs.existsSync(absPath)) {
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          content = `Error: ${filePath} is a directory. Use run_command with shell commands like 'ls' or 'find' to inspect its contents.`;
        } else {
          content = fs.readFileSync(absPath, 'utf-8');
          success = true;
        }
      } else {
        content = `Error: File not found at ${filePath}`;
      }
    } catch (err: any) {
      content = `Error: ${err.message}`;
    }
    
    ui.hideToolProgress();
    if (success) {
      ui.printToolResult('success', `Read ${filePath} (${content.split('\n').length} lines)`);
    } else {
      ui.printToolResult('failure', `Read ${filePath} (failed)`);
    }
    
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nFile content of ${filePath}:\n${content}\n</tool_output>`,
      consoleOutput: `\n[File read: ${filePath}]`
    };
  }

  const searchQuery = parseSearchCode(text);
  if (searchQuery !== null) {
    const query = searchQuery.trim();
    if (isGui) guiEmit({ type: 'tool-call', tool: 'search_code', query });
    if (!query) {
      ui.printToolResult('failure', `Searched "${query}" (blocked: empty query)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: Search query cannot be empty. Please provide specific keywords to search the codebase.\n</tool_output>`,
        consoleOutput: `\n[Search blocked: empty query]`
      };
    }
    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('search')} index for "${query}" ...`);
    
    const results = indexer.search(query);
    ui.hideToolProgress();
    ui.printToolResult('success', `Searched "${query}" (${results.length} results)`);
    
    const formatted = results.slice(0, 5).map(r => 
      `- ${r.relpath} (line ${r.start_line}-${r.end_line}, type ${r.chunk_type}):\n${r.content}`
    ).join('\n\n');
    
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nSearch results for "${query}":\n${formatted || 'No matches found'}\n</tool_output>`,
      consoleOutput: `\n[Search executed: "${query}"]`
    };
  }

  const webSearchQuery = parseWebSearch(text);
  if (webSearchQuery !== null) {
    const query = webSearchQuery.trim();
    if (isGui) guiEmit({ type: 'tool-call', tool: 'web_search', query });
    if (!query) {
      ui.printToolResult('failure', `Web searched "${query}" (blocked: empty query)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: Search query cannot be empty.\n</tool_output>`,
        consoleOutput: `\n[Web search blocked: empty query]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('web_search')} query "${query}" ...`);
    
    let results: any[] = [];
    try {
      const { searchDuckDuckGo } = await import('../core/search.js');
      let augmentedQuery = query;

      // Smart Context Query Augmentation
      const fs = await import('fs');
      const path = await import('path');
      const root = indexer.db.workspaceRoot;
      const contextKeywords: string[] = [];

      if (fs.existsSync(path.join(root, 'package.json'))) {
        contextKeywords.push('nodejs');
        try {
          const pkgJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
          if (pkgJson.dependencies?.['next']) contextKeywords.push('nextjs');
          if (pkgJson.dependencies?.['react']) contextKeywords.push('react');
          if (pkgJson.devDependencies?.['typescript'] || pkgJson.dependencies?.['typescript']) contextKeywords.push('typescript');
        } catch (_) {}
      } else if (fs.existsSync(path.join(root, 'Cargo.toml'))) {
        contextKeywords.push('rust');
      } else if (fs.existsSync(path.join(root, 'go.mod'))) {
        contextKeywords.push('go');
      } else if (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'requirements.txt'))) {
        contextKeywords.push('python');
      }

      if (contextKeywords.length > 0) {
        const missing = contextKeywords.filter(k => !query.toLowerCase().includes(k));
        if (missing.length > 0) {
          augmentedQuery = `${query} ${missing.join(' ')}`;
        }
      }

      results = await searchDuckDuckGo(augmentedQuery);
    } catch (e: any) {
      results = [];
    }

    ui.hideToolProgress();
    ui.printToolResult('success', `Web searched "${query}" (${results.length} results)`);

    const formatted = results.map(r => 
      `- ${r.title} (${r.url}):\n  ${r.snippet}`
    ).join('\n\n');

    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nWeb search results for "${query}":\n${formatted || 'No results found'}\n</tool_output>`,
      consoleOutput: `\n[Web search executed: "${query}"]`
    };
  }

  const patchResult = parsePatchFile(text);
  if (patchResult) {
    const { filePath, search, replace } = patchResult;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'patch_file', filePath, search, replace });

    if (!sandbox.isPathWriteAllowed(absPath)) {
      const granted = await requestPathAccess(absPath, 'rw', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absPath
          })}\n</tool_output>`,
          consoleOutput: `\n[Patch blocked (not allowed): ${filePath}]`
        };
      }
    }

    ui.showToolProgress(`${themeAccent('patch')} ${filePath}...`);

    try {
      if (!fs.existsSync(absPath)) {
        ui.hideToolProgress();
        ui.printToolResult('failure', `Patched ${filePath} (failed: file not found)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: "Search string not found in file. Verify the text matches exactly including whitespace and indentation.",
          code: "PATCH_NOT_FOUND",
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch failed: File not found: ${filePath}]`
        };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      const index = content.indexOf(search);
      if (index === -1) {
        ui.hideToolProgress();
        ui.printToolResult('failure', `Patched ${filePath} (failed: search string not found)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: "Search string not found in file. Verify the text matches exactly including whitespace and indentation.",
          code: "PATCH_NOT_FOUND",
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch failed: Search string not found in ${filePath}]`
        };
      }

      indexer.backupBeforeWrite(absPath);

      const updated = content.slice(0, index) + replace + content.slice(index + search.length);
      fs.writeFileSync(absPath, updated, 'utf-8');

      sandbox.clearLoopHistory();
      sandbox.recordWrittenFile(absPath);

      try {
        const stat = fs.statSync(absPath);
        indexer.processFileOnStartup(absPath, stat);
        indexer.currentRepoMap = buildRepoMap(indexer.db);
      } catch (e) {}

      ui.hideToolProgress();
      ui.printToolResult('success', `Patched ${filePath}`);
      
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully patched at ${filePath}\n</tool_output>`,
        consoleOutput: `\n[File patched: ${filePath}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Patched ${filePath} (failed: ${err.message})`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError patching file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File patch failed: ${filePath}]`
      };
    }
  }

  const patchBlocksResult = parsePatchFileBlocks(text);
  if (patchBlocksResult) {
    const { filePath, diff } = patchBlocksResult;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'patch_file_blocks', filePath });

    if (!sandbox.isPathWriteAllowed(absPath)) {
      const granted = await requestPathAccess(absPath, 'rw', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absPath
          })}\n</tool_output>`,
          consoleOutput: `\n[Patch blocks blocked (not allowed): ${filePath}]`
        };
      }
    }

    ui.showToolProgress(`${themeAccent('patch_blocks')} ${filePath}...`);

    try {
      if (!fs.existsSync(absPath)) {
        ui.hideToolProgress();
        ui.printToolResult('failure', `Patched ${filePath} (failed: file not found)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: `File not found at ${filePath}`,
          code: "PATCH_FILE_NOT_FOUND",
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch blocks failed: File not found: ${filePath}]`
        };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      
      let updated: string;
      try {
        updated = applySearchReplaceBlocks(content, diff);
      } catch (err: any) {
        ui.hideToolProgress();
        ui.printToolResult('failure', `Patched ${filePath} (failed: applying blocks failed)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: err.message || String(err),
          code: err.code || "PATCH_BLOCK_FAILED",
          blockIndex: err.blockIndex,
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch blocks failed: ${err.message}]`
        };
      }

      indexer.backupBeforeWrite(absPath);

      fs.writeFileSync(absPath, updated, 'utf-8');

      sandbox.clearLoopHistory();
      sandbox.recordWrittenFile(absPath);

      try {
        const stat = fs.statSync(absPath);
        indexer.processFileOnStartup(absPath, stat);
        indexer.currentRepoMap = buildRepoMap(indexer.db);
      } catch (e) {}

      ui.hideToolProgress();
      ui.printToolResult('success', `Patched ${filePath}`);
      
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully patched using blocks at ${filePath}\n</tool_output>`,
        consoleOutput: `\n[File patched with blocks: ${filePath}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Patched ${filePath} (failed: ${err.message})`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError patching file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File patch blocks failed: ${filePath}]`
      };
    }
  }

  const listDirResult = parseListDir(text);
  if (listDirResult) {
    const { pathVal, recursive } = listDirResult;
    const absPath = path.resolve(sandbox['workspaceRoot'], pathVal);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'list_dir', pathVal, recursive });

    if (!sandbox.isPathAllowed(absPath)) {
      const granted = await requestPathAccess(absPath, 'ro', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absPath
          })}\n</tool_output>`,
          consoleOutput: `\n[List dir blocked (not allowed): ${pathVal}]`
        };
      }
    }

    ui.showToolProgress(`${themeAccent('list_dir')} ${pathVal}...`);

    try {
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        ui.hideToolProgress();
        ui.printToolResult('failure', `Listed directory ${pathVal} (failed: not found)`);
        const errObj = {
          error: `Directory not found at ${pathVal}`,
          code: "DIRECTORY_NOT_FOUND",
          path: pathVal
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[List dir failed: Directory not found: ${pathVal}]`
        };
      }

      const result = listDirectory(absPath, sandbox['workspaceRoot'], recursive);

      ui.hideToolProgress();
      ui.printToolResult('success', `Listed directory ${pathVal}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
        consoleOutput: `\n[Directory listed: ${pathVal}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Listed directory ${pathVal} (failed: ${err.message})`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError listing directory: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Directory list failed: ${pathVal}]`
      };
    }
  }

  if (parseGitStatus(text)) {
    if (isGui) guiEmit({ type: 'tool-call', tool: 'git_status' });
    ui.showToolProgress(`${themeAccent('git_status')}...`);

    try {
      let isGit = false;
      try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: sandbox['workspaceRoot'], stdio: 'ignore' });
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

      const branch = execSync('git branch --show-current', { cwd: sandbox['workspaceRoot'] }).toString().trim();
      const statusText = execSync('git status --porcelain', { cwd: sandbox['workspaceRoot'] }).toString().trim();

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
        const revList = execSync('git rev-list --left-right --count HEAD...@{u}', { cwd: sandbox['workspaceRoot'], stdio: 'pipe' }).toString().trim();
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

  const diagResult = parseDiagnosticsTag(text);
  if (diagResult !== null) {
    let commandToRun = diagResult.command;
    const workspaceRoot = sandbox['workspaceRoot'];

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
      const rawOutput = await sandbox.runCommand(commandToRun);
      
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

  const moveResult = parseMoveFile(text);
  if (moveResult !== null) {
    const { sourcePath, destinationPath } = moveResult;
    const absSource = path.resolve(sandbox['workspaceRoot'], sourcePath);
    const absDest = path.resolve(sandbox['workspaceRoot'], destinationPath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'move_file', sourcePath, destinationPath });

    if (!sandbox.isPathWriteAllowed(absSource)) {
      const granted = await requestPathAccess(absSource, 'rw', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absSource
          })}\n</tool_output>`,
          consoleOutput: `\n[Move blocked (source not allowed): ${sourcePath}]`
        };
      }
    }

    if (!sandbox.isPathWriteAllowed(absDest)) {
      const granted = await requestPathAccess(absDest, 'rw', ui, state, sandbox);
      if (!granted) {
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            error: `Path is outside the workspace. Permission denied by user.`,
            code: "PATH_NOT_ALLOWED",
            path: absDest
          })}\n</tool_output>`,
          consoleOutput: `\n[Move blocked (destination not allowed): ${destinationPath}]`
        };
      }
    }

    if (!fs.existsSync(absSource)) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Moved ${sourcePath} (failed: source not found)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Source file not found at ${sourcePath}`,
          code: "MOVE_SOURCE_NOT_FOUND",
          sourcePath
        })}\n</tool_output>`,
        consoleOutput: `\n[Move failed: Source not found: ${sourcePath}]`
      };
    }

    if (fs.existsSync(absDest)) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Moved ${sourcePath} (failed: destination exists)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Destination path already exists at ${destinationPath}. Move aborted to prevent overwrite.`,
          code: "MOVE_DESTINATION_EXISTS",
          destinationPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Move failed: Destination exists: ${destinationPath}]`
      };
    }

    ui.showToolProgress(`${themeAccent('move')} ${sourcePath} to ${destinationPath}...`);

    try {
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.renameSync(absSource, absDest);

      indexer.renameFile(absSource, absDest);
      sandbox.recordWrittenFile(absDest);
      sandbox.clearLoopHistory();

      ui.hideToolProgress();
      ui.printToolResult('success', `Moved ${sourcePath} to ${destinationPath}`);
      
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          success: true,
          message: `File successfully moved/renamed from ${sourcePath} to ${destinationPath}`,
          sourcePath,
          destinationPath
        })}\n</tool_output>`,
        consoleOutput: `\n[File moved: ${sourcePath} -> ${destinationPath}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Moved ${sourcePath} to ${destinationPath} (failed: ${err.message})`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Failed to move/rename file: ${err.message}`,
          code: "MOVE_FAILED",
          sourcePath,
          destinationPath
        })}\n</tool_output>`,
        consoleOutput: `\n[File move failed: ${sourcePath} -> ${destinationPath}]`
      };
    }
  }

  const questionResult = parseQuestion(text);
  if (questionResult !== null) {
    let { question, options } = questionResult;

    // Auto-override path access options if the model generates a "Deny" only select box
    const isPathAccess = question.includes('/') || question.includes('~') || question.toLowerCase().includes('path') || question.toLowerCase().includes('access');
    if (isPathAccess && (options.length === 0 || (options.length === 1 && options[0].toLowerCase() === 'deny') || !options.includes('Allow read-write'))) {
      options = ['Allow read-write', 'Allow read-only', 'Deny'];
    }

    if (isGui) guiEmit({ type: 'tool-call', tool: 'question', question, options });
    
    let chosenIdx = 0;
    if (state.isNonInteractive || typeof process.stdin.setRawMode !== 'function') {
      console.log(`\n${themePrimary.bold(question)}`);
      options.forEach((opt, idx) => console.log(`  ${idx + 1}) ${opt}`));
      chosenIdx = 0;
    } else {
      chosenIdx = await ui.interactiveSelect(question, options);
    }

    const choice = options[chosenIdx];
    
    // Extract path from question
    let extractedPath: string | null = null;
    const regex = new RegExp("(?:^|\\s|['\"`])(\\/[^'\"\\s]+|~\\/[^'\"\\s]+|~)");
    const pathMatch = question.match(regex);
    if (pathMatch) {
      let p = pathMatch[1];
      while (p && /[?.!,;]$/.test(p)) {
        p = p.slice(0, -1);
      }
      extractedPath = p;
    }

    if (choice === 'Allow read-write') {
      if (extractedPath) {
        let resolvedPath = extractedPath;
        if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
          resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
        }
        const absPath = path.resolve(resolvedPath);
        if (!state.activeAllowedPaths.some(ap => ap.path === absPath && ap.mode === 'rw')) {
          state.activeAllowedPaths = state.activeAllowedPaths.filter(ap => ap.path !== absPath);
          state.activeAllowedPaths.push({ path: absPath, mode: 'rw' });
        }
        sandbox.updateAllowedPaths(state.activeAllowedPaths);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            granted: true,
            path: absPath,
            mode: 'rw',
            message: 'Access granted. Mount added dynamically.'
          })}\n</tool_output>`,
          consoleOutput: `\n[Permission granted (rw): ${absPath}]`
        };
      }
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          granted: true,
          message: 'Access granted, but no path could be extracted from the question.'
        })}\n</tool_output>`,
        consoleOutput: `\n[Permission granted: no path extracted]`
      };
    }

    if (choice === 'Allow read-only') {
      if (extractedPath) {
        let resolvedPath = extractedPath;
        if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
          resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
        }
        const absPath = path.resolve(resolvedPath);
        if (!state.activeAllowedPaths.some(ap => ap.path === absPath)) {
          state.activeAllowedPaths.push({ path: absPath, mode: 'ro' });
        }
        sandbox.updateAllowedPaths(state.activeAllowedPaths);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            granted: true,
            path: absPath,
            mode: 'ro',
            message: 'Access granted. Mount added dynamically.'
          })}\n</tool_output>`,
          consoleOutput: `\n[Permission granted (ro): ${absPath}]`
        };
      }
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          granted: true,
          message: 'Access granted, but no path could be extracted from the question.'
        })}\n</tool_output>`,
        consoleOutput: `\n[Permission granted: no path extracted]`
      };
    }

    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${JSON.stringify({
        granted: false,
        path: extractedPath ? path.resolve(extractedPath.startsWith('~/') || extractedPath === '~' ? (os.homedir() + extractedPath.slice(1)) : extractedPath) : undefined
      })}\n</tool_output>`,
      consoleOutput: `\n[Permission denied]`
    };
  }

  // ── MCP tool call: <mcp_tool server="id" name="toolName">{...args json...}</mcp_tool> ──
  const mcpMatch = /<mcp_tool[^>]+server=["']([^"']+)["'][^>]+name=["']([^"']+)["'][^>]*>([\/\s\S]*?)<\/mcp_tool>/.exec(text)
    || /<mcp_tool[^>]+name=["']([^"']+)["'][^>]+server=["']([^"']+)["'][^>]*>([\/\s\S]*?)<\/mcp_tool>/.exec(text);

  if (mcpMatch) {
    // Handle both attribute orderings
    const isServerFirst = text.includes('server=') && text.indexOf('server=') < text.indexOf('name=');
    const serverId  = isServerFirst ? mcpMatch[1] : mcpMatch[2];
    const toolName  = isServerFirst ? mcpMatch[2] : mcpMatch[1];
    const argsRaw   = (mcpMatch[3] || '').trim();

    let args: Record<string, any> = {};
    try {
      if (argsRaw) args = JSON.parse(argsRaw);
    } catch (_) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nMCP tool call error: arguments must be valid JSON.\n</tool_output>`,
        consoleOutput: `\n[MCP: invalid JSON args for ${toolName}]`
      };
    }

    ui.showToolProgress(`${themePrimary('mcp')} ${themeOrange(serverId)} › ${toolName}...`);

    try {
      const { McpClientManager } = await import('../core/mcp/client.js');
      const mcpManager = McpClientManager.getInstance();
      const result = await mcpManager.callTool(serverId, toolName, args);
      ui.hideToolProgress();

      if (result.success) {
        ui.printToolResult('success', `mcp: ${serverId} › ${toolName}`);
      } else {
        ui.printToolResult('failure', `mcp: ${serverId} › ${toolName} (error)`);
      }

      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${result.output}\n</tool_output>`,
        consoleOutput: `\n[MCP: ${serverId} › ${toolName}]`
      };
    } catch (err: any) {
      ui.hideToolProgress();
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nMCP error: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[MCP error: ${err.message}]`
      };
    }
  }

  return { toolRun: false, nextPrompt: '', consoleOutput: '' };
}
