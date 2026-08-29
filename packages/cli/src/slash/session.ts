import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import chalk from 'chalk';
import { isPro } from '@unit01/core/tier.js';
import { getLanguageFromFilename } from '../parser.js';
import { themeBorder } from '../views/theme.js';
import { SlashContext } from './types.js';

export async function handleSessionCommands(command: string, arg: string, ctx: SlashContext): Promise<boolean> {
  const {
    workspaceRoot,
    indexer,
    guard,
    ui,
    state,
    sessionStore,
    sessionId,
    sessionStartTime,
    conversationHistory,
    activeModel,
    setSessionId,
    setLastInputTokens,
    runCompaction,
    resumeSession
  } = ctx;

  if (command === '/exit' || command === '/quit') {
    if (conversationHistory.length > 0) {
      sessionStore.save(sessionId, {
        startedAt: sessionStartTime,
        activeModel,
        conversationHistory
      });
    }
    indexer.close();
    ui.exit(0);
    return true;
  }

  if (command === '/clear') {
    conversationHistory.length = 0;
    setLastInputTokens(0);
    setSessionId(crypto.randomUUID());
    ui.clear();
    ui.printSystemMessage('info', 'Conversation history cleared.');
    return true;
  }

  if (command === '/compact') {
    await runCompaction(ui, false);
    return true;
  }

  if (command === '/sessions') {
    const sessions = sessionStore.list(workspaceRoot).filter(s => s.id !== sessionId);
    if (sessions.length === 0) {
      ui.printSystemMessage('info', 'No previous sessions found.');
      return true;
    }
    const sessionOptions = sessions.map(s => `Session · ${s.messageCount} messages · "${s.firstMessage.slice(0, 40)}"`);
    const chosenIdx = await ui.interactiveSelect('Select Session:', sessionOptions);
    if (chosenIdx !== -1) {
      const selectedSession = sessions[chosenIdx];
      const actionIdx = await ui.interactiveSelect('Session Action:', [
        'Resume',
        'Rename',
        'Delete',
        'Cancel'
      ]);

      if (actionIdx === 0) {
        await resumeSession(ui, selectedSession);
      } else if (actionIdx === 1) {
        const newName = await ui.interactiveInput('Enter new session name:', selectedSession.firstMessage);
        if (newName.trim()) {
          sessionStore.rename(selectedSession.id, newName.trim());
          ui.printSystemMessage('info', 'Session renamed successfully.');
        }
      } else if (actionIdx === 2) {
        sessionStore.delete(selectedSession.id);
        ui.printSystemMessage('info', 'Session deleted successfully.');
      }
    }
    return true;
  }

  if (command === '/preview') {
    if (state.lastWrittenFile) {
      ui.showDiff(
        state.lastWrittenFile.original,
        state.lastWrittenFile.content,
        getLanguageFromFilename(state.lastWrittenFile.filePath),
        state.lastWrittenFile.filePath
      );
    } else {
      ui.printSystemMessage('info', 'No files modified in this session yet.');
    }
    return true;
  }

  if (command === '/diff') {
    if (!isPro()) {
      ui.printSystemMessage('error', 'The /diff command is a Pro tier feature.');
      return true;
    }
    const { execSync } = await import('child_process');
    let rawDiff = '';
    try {
      rawDiff = execSync('git diff HEAD', { cwd: workspaceRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      try {
        rawDiff = execSync('git diff', { cwd: workspaceRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        ui.printSystemMessage('info', 'No git repository found or no changes to show.');
        return true;
      }
    }

    if (!rawDiff.trim()) {
      ui.printSystemMessage('info', 'No changes since last commit. Workspace is clean.');
      return true;
    }

    const fileBlocks: { filePath: string; lines: string[] }[] = [];
    let currentBlock: { filePath: string; lines: string[] } | null = null;
    let totalAdded = 0;
    let totalRemoved = 0;
    let filesChanged = 0;

    for (const rawLine of rawDiff.split('\n')) {
      if (rawLine.startsWith('diff --git')) {
        if (currentBlock) fileBlocks.push(currentBlock);
        const match = rawLine.match(/diff --git a\/.+ b\/(.+)/);
        const fp = match ? match[1] : 'unknown';
        currentBlock = { filePath: fp, lines: [] };
        filesChanged++;
      } else if (
        currentBlock &&
        !rawLine.startsWith('index ') &&
        !rawLine.startsWith('---') &&
        !rawLine.startsWith('+++') &&
        !rawLine.startsWith('Binary')
      ) {
        currentBlock.lines.push(rawLine);
        if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) totalAdded++;
        if (rawLine.startsWith('-') && !rawLine.startsWith('---')) totalRemoved++;
      }
    }
    if (currentBlock) fileBlocks.push(currentBlock);

    const divider = themeBorder('────────────────────────────────────────');
    const header = chalk.hex('#C084FC')('◈ unit01  ·  session diff');
    const summary = chalk.hex('#64748B')(
      `${filesChanged} file${filesChanged !== 1 ? 's' : ''} changed  ·  ` +
        chalk.hex('#10B981')(`+${totalAdded} insertion${totalAdded !== 1 ? 's' : ''}`) +
        '  ·  ' +
        chalk.hex('#F87171')(`-${totalRemoved} deletion${totalRemoved !== 1 ? 's' : ''}`)
    );

    const outputLines: string[] = [
      '',
      `  ${divider}`,
      `  ${header}`,
      `  ${divider}`,
      `  ${summary}`
    ];

    for (const block of fileBlocks) {
      outputLines.push('');
      outputLines.push(`  ${chalk.hex('#38BDF8')('◆')} ${chalk.hex('#38BDF8')(block.filePath)}`);
      outputLines.push(`  ${themeBorder('─'.repeat(Math.min(block.filePath.length + 4, 60)))}`);

      for (const line of block.lines) {
        if (line.startsWith('@@')) {
          outputLines.push(`  ${chalk.hex('#64748B')(line)}`);
        } else if (line.startsWith('+')) {
          outputLines.push(`  ${chalk.bgHex('#0a2a1a')(chalk.hex('#10B981')(line.padEnd(80)))}`);
        } else if (line.startsWith('-')) {
          outputLines.push(`  ${chalk.bgHex('#2a0a0a')(chalk.hex('#F87171')(line.padEnd(80)))}`);
        } else if (line.trim()) {
          outputLines.push(`  ${chalk.hex('#94A3B8')(line)}`);
        }
      }
    }

    outputLines.push('');
    outputLines.push(`  ${divider}`);
    outputLines.push(`  ${chalk.hex('#64748B')('→ git add -p to stage selectively  ·  git commit when ready')}`);
    outputLines.push(`  ${divider}`);
    outputLines.push('');

    ui.addTextOutput(outputLines.join('\n'));
    return true;
  }

  if (command === '/undo') {
    const dbBackup = indexer.db.db.prepare(
      'SELECT original_path, path_hash FROM shadow_backups ORDER BY version DESC LIMIT 1'
    ).get() as { original_path: string; path_hash: string } | undefined;
    if (dbBackup) {
      const restoredPath = dbBackup.original_path;
      const success = indexer.undoWrite(restoredPath);
      if (success) {
        guard.clearLoopHistory();
        try {
          if (fs.existsSync(restoredPath)) {
            const stat = fs.statSync(restoredPath);
            indexer.processFileOnStartup(restoredPath, stat);
          }
        } catch (_) {}
        const remaining = indexer.db.getBackupDepth(
          (await import('@unit01/core/database/backup.js')).getPathHash(restoredPath)
        );
        const moreMsg = remaining > 0 ? `  (${remaining} more undo step${remaining > 1 ? 's' : ''} available)` : '';
        ui.printSystemMessage('info', `Reverted: ${path.basename(restoredPath)}${moreMsg}`);
      } else {
        ui.printSystemMessage('error', `Failed to restore backup for ${restoredPath}`);
      }
    } else {
      ui.printSystemMessage('info', 'No backups found to undo.');
    }
    return true;
  }

  return false;
}
