import * as path from 'path';
import * as fs from 'fs';
import { isPro } from '@unit01/core/tier.js';
import { buildRepoMap } from '@unit01/core/indexer/repomap.js';
import { themeOrange, themeAccent, isGui, guiEmit } from '../views/theme.js';
import {
  parseDeleteFile,
  parseMakeDir,
  parseCopyFile,
  parseMoveFile,
  parseReadFile,
  parseWriteFile,
  parsePatchFile,
  parsePatchFileBlocks,
  getLanguageFromFilename,
  applySearchReplaceBlocks
} from '../parser.js';
import { ToolContext, ToolResult, resolvePath, requestPathAccess } from './types.js';

export async function handleDeleteFile(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const deletePath = parseDeleteFile(text);
  if (deletePath === null) return null;

  const { ui, state, guard, indexer } = ctx;
  const absPath = resolvePath(guard['workspaceRoot'], deletePath);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'delete_file', filePath: deletePath });

  if (!guard.isPathWriteAllowed(absPath)) {
    const granted = await requestPathAccess(absPath, 'rw', ui, state, guard);
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
      nextPrompt: `<tool_output>\nError: Target not found at ${deletePath}\n</tool_output>`,
      consoleOutput: `\n[Delete failed: Target not found: ${deletePath}]`
    };
  }

  const stat = fs.statSync(absPath);
  const isDir = stat.isDirectory();

  if (isDir && !isPro()) {
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
    if (isDir) {
      const getAllFilesRecursive = (dir: string): string[] => {
        let files: string[] = [];
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files = files.concat(getAllFilesRecursive(fullPath));
          } else {
            files.push(fullPath);
          }
        }
        return files;
      };

      const files = getAllFilesRecursive(absPath);
      for (const file of files) {
        indexer.backupBeforeWrite(file);
      }
      fs.rmSync(absPath, { recursive: true, force: true });
      for (const file of files) {
        indexer.db.removeFile(file);
      }
    } else {
      indexer.backupBeforeWrite(absPath);
      fs.unlinkSync(absPath);
      indexer.db.removeFile(absPath);
    }

    guard.clearLoopHistory();
    indexer.currentRepoMap = buildRepoMap(indexer.db);

    ui.hideToolProgress();
    ui.printToolResult('success', `Deleted ${deletePath}`);

    if (isPro()) {
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer.db);
        auditStore.logAction({
          service: 'file_delete',
          operation: 'delete_file',
          target: absPath,
          payload_summary: `Deleted ${deletePath}`,
          payload_hash: crypto.createHash('sha256').update(deletePath).digest('hex'),
          status: 'completed'
        });
      } catch (_) {}
    }

    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${isDir ? 'Directory' : 'File'} successfully deleted: ${deletePath}\n</tool_output>`,
      consoleOutput: `\n[${isDir ? 'Directory' : 'File'} deleted: ${deletePath}]`
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

export async function handleMakeDir(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const makeDirPath = parseMakeDir(text);
  if (makeDirPath === null) return null;

  const { ui, state, guard } = ctx;
  const absPath = resolvePath(guard['workspaceRoot'], makeDirPath);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'make_dir', filePath: makeDirPath });

  if (!guard.isPathWriteAllowed(absPath)) {
    const granted = await requestPathAccess(absPath, 'rw', ui, state, guard);
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

export async function handleCopyFile(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const copyFileParams = parseCopyFile(text);
  if (copyFileParams === null) return null;

  const { ui, state, guard, indexer } = ctx;
  const { sourcePath, destinationPath } = copyFileParams;
  const absSrc = resolvePath(guard['workspaceRoot'], sourcePath);
  const absDest = resolvePath(guard['workspaceRoot'], destinationPath);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'copy_file', sourcePath, destinationPath });

  if (!guard.isPathAllowed(absSrc)) {
    const granted = await requestPathAccess(absSrc, 'ro', ui, state, guard);
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

  if (!guard.isPathWriteAllowed(absDest)) {
    const granted = await requestPathAccess(absDest, 'rw', ui, state, guard);
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
    const parentDir = path.dirname(absDest);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    if (fs.existsSync(absDest)) {
      indexer.backupBeforeWrite(absDest);
    }

    fs.copyFileSync(absSrc, absDest);
    guard.clearLoopHistory();

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

export async function handleMoveFile(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const moveResult = parseMoveFile(text);
  if (moveResult === null) return null;

  const { ui, state, guard, indexer } = ctx;
  const { sourcePath, destinationPath } = moveResult;
  const absSource = resolvePath(guard['workspaceRoot'], sourcePath);
  const absDest = resolvePath(guard['workspaceRoot'], destinationPath);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'move_file', sourcePath, destinationPath });

  if (!guard.isPathWriteAllowed(absSource)) {
    const granted = await requestPathAccess(absSource, 'rw', ui, state, guard);
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

  if (!guard.isPathWriteAllowed(absDest)) {
    const granted = await requestPathAccess(absDest, 'rw', ui, state, guard);
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
    guard.recordWrittenFile(absDest);
    guard.clearLoopHistory();

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
    ui.printToolResult('failure', `Move ${sourcePath} -> ${destinationPath} — failed: ${err.message}`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nError moving file: ${err.message}\n</tool_output>`,
      consoleOutput: `\n[Move failed: ${sourcePath} -> ${destinationPath}]`
    };
  }
}

export async function handleReadFile(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const readPath = parseReadFile(text);
  if (readPath === null) return null;

  const { ui, state, guard, fileReadCache } = ctx;
  const filePath = readPath;
  const absPath = resolvePath(guard['workspaceRoot'], filePath);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'read_file', filePath });
  
  if (!guard.isPathAllowed(absPath)) {
    const granted = await requestPathAccess(absPath, 'ro', ui, state, guard);
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
  let servedFromCache = false;
  try {
    const cached = fileReadCache?.get(absPath) ?? fileReadCache?.get(filePath);
    if (cached !== undefined) {
      content = cached;
      success = true;
      servedFromCache = true;
    } else if (fs.existsSync(absPath)) {
      const stat = fs.statSync(absPath);
      if (stat.isDirectory()) {
        content = `Error: ${filePath} is a directory. Use run_command with shell commands like 'ls' or 'find' to inspect its contents.`;
      } else {
        content = fs.readFileSync(absPath, 'utf-8');
        success = true;
        if (fileReadCache) fileReadCache.set(absPath, content);
      }
    } else {
      content = `Error: File not found at ${filePath}`;
    }
  } catch (err: any) {
    content = `Error: ${err.message}`;
  }
  
  ui.hideToolProgress();
  if (success) {
    const cacheTag = servedFromCache ? ' [cached]' : '';
    ui.printToolResult('success', `Read ${filePath} (${content.split('\n').length} lines${cacheTag})`);
  } else {
    ui.printToolResult('failure', `Read ${filePath} (failed)`);
  }
  
  return {
    toolRun: true,
    nextPrompt: `<tool_output>\nFile content of ${filePath}:\n${content}\n</tool_output>`,
    consoleOutput: `\n[File read: ${filePath}]`
  };
}

export async function handleWriteFile(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const writeResult = parseWriteFile(text);
  if (!writeResult) return null;

  const { ui, state, guard, indexer, fileReadCache } = ctx;
  const filePath = writeResult.filePath;
  const content = writeResult.content;
  const absPath = resolvePath(guard['workspaceRoot'], filePath);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'write_file', filePath });

  if (!guard.isPathWriteAllowed(absPath)) {
    const granted = await requestPathAccess(absPath, 'rw', ui, state, guard);
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
    
    guard.clearLoopHistory();
    guard.recordWrittenFile(absPath);
    
    try {
      const stat = fs.statSync(absPath);
      indexer.processFileOnStartup(absPath, stat);
      indexer.currentRepoMap = buildRepoMap(indexer.db);
    } catch (e) {}
    
    ui.hideToolProgress();
    ui.printToolResult('success', `Wrote ${filePath} (${lineCount} lines)`);
    if (isPro()) {
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer.db);
        const payloadHash = crypto.createHash('sha256').update(content).digest('hex');
        auditStore.logAction({
          service: 'file_write',
          operation: 'write_file',
          target: absPath,
          payload_summary: `Wrote ${lineCount} lines to ${filePath}`,
          payload_hash: payloadHash,
          status: 'completed'
        });
      } catch (_) {}
    }
    if (fileReadCache) fileReadCache.delete(absPath);
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

export async function handlePatchFile(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const patchResult = parsePatchFile(text);
  if (!patchResult) return null;

  const { ui, state, guard, indexer } = ctx;
  const { filePath, search, replace } = patchResult;
  const absPath = resolvePath(guard['workspaceRoot'], filePath);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'patch_file', filePath, search, replace });

  if (!guard.isPathWriteAllowed(absPath)) {
    const granted = await requestPathAccess(absPath, 'rw', ui, state, guard);
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
      const relPath = path.relative(guard['workspaceRoot'], absPath);
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
      const relPath = path.relative(guard['workspaceRoot'], absPath);
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

    guard.clearLoopHistory();
    guard.recordWrittenFile(absPath);

    try {
      const stat = fs.statSync(absPath);
      indexer.processFileOnStartup(absPath, stat);
      indexer.currentRepoMap = buildRepoMap(indexer.db);
    } catch (e) {}

    ui.hideToolProgress();
    ui.printToolResult('success', `Patched ${filePath}`);
    if (isPro()) {
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer.db);
        const payloadHash = crypto.createHash('sha256').update(updated).digest('hex');
        auditStore.logAction({
          service: 'file_patch',
          operation: 'patch_file',
          target: absPath,
          payload_summary: `Patched ${filePath}`,
          payload_hash: payloadHash,
          status: 'completed'
        });
      } catch (_) {}
    }
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

export async function handlePatchFileBlocks(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const patchBlocksResult = parsePatchFileBlocks(text);
  if (!patchBlocksResult) return null;

  const { ui, state, guard, indexer, fileReadCache } = ctx;
  const { filePath, diff } = patchBlocksResult;
  const absPath = resolvePath(guard['workspaceRoot'], filePath);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'patch_file_blocks', filePath });

  if (!guard.isPathWriteAllowed(absPath)) {
    const granted = await requestPathAccess(absPath, 'rw', ui, state, guard);
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
      const relPath = path.relative(guard['workspaceRoot'], absPath);
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
      const relPath = path.relative(guard['workspaceRoot'], absPath);
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

    guard.clearLoopHistory();
    guard.recordWrittenFile(absPath);

    try {
      const stat = fs.statSync(absPath);
      indexer.processFileOnStartup(absPath, stat);
      indexer.currentRepoMap = buildRepoMap(indexer.db);
    } catch (e) {}

    ui.hideToolProgress();
    ui.printToolResult('success', `Patched ${filePath}`);
    if (isPro()) {
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer.db);
        const payloadHash = crypto.createHash('sha256').update(updated).digest('hex');
        auditStore.logAction({
          service: 'file_patch',
          operation: 'patch_file_blocks',
          target: absPath,
          payload_summary: `Patched blocks in ${filePath}`,
          payload_hash: payloadHash,
          status: 'completed'
        });
      } catch (_) {}
    }
    if (fileReadCache) fileReadCache.delete(absPath);
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
