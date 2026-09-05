import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import { isPro } from '@unit01/core/tier.js';
import { redactSecrets } from '@unit01/core/security/guard.js';
import { estimateTokens } from '../prompt/helpers.js';
import { SYSTEM_INSTRUCTIONS } from '../prompt/instructions.js';
import { getLanguageFromFilename } from '../parser.js';
import { themeBorder } from '../views/theme.js';
import { SlashContext } from './types.js';

export async function handleSystemCommands(command: string, arg: string, ctx: SlashContext): Promise<boolean> {
  const {
    workspaceRoot,
    indexer,
    ui,
    conversationHistory,
    activeModel,
    modelContextWindow,
    lastInputTokens,
    gitBranch,
    sessionStartTime
  } = ctx;

  if (command === '/status') {
    const activeRepoMap = indexer.getRepoMap();
    const activeChanges = indexer.getRecentChanges();
    const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
    const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content || ''), 0);
    const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
    const ratioPct = Math.round(Math.min(totalTokens / modelContextWindow, 1.0) * 100);

    const headerLine = chalk.hex('#C084FC')('◈ unit01  ·  system status');
    const divider = themeBorder('────────────────────────────────────────');

    const tildify = (absolutePath: string) => {
      const home = os.homedir();
      if (absolutePath.startsWith(home)) {
        return '~' + absolutePath.slice(home.length);
      }
      return absolutePath;
    };

    let integrationLines: string[] = [];
    if (isPro()) {
      const { isServiceConnected } = await import('@unit01/core/tier.js');

      const integrationList = [
        { id: 'github', label: 'GitHub' },
        { id: 'slack', label: 'Slack' },
        { id: 'linear', label: 'Linear' },
        { id: 'sentry', label: 'Sentry' },
        { id: 'notion', label: 'Notion' },
        { id: 'tavily', label: 'Tavily' },
        { id: 'brave', label: 'Brave' },
        { id: 'exa', label: 'Exa' },
        { id: 'jina', label: 'Jina' },
        { id: 'serper', label: 'Serper' }
      ];

      const connectedLabel = chalk.hex('#10B981')('● connected');
      const disconnectedLabel = chalk.hex('#475569')('○ not connected');

      integrationLines = integrationList.map(svc => {
        const status = isServiceConnected(svc.id) ? connectedLabel : disconnectedLabel;
        return `  ${chalk.hex('#64748B')(svc.label.padEnd(11))}${status}`;
      });
    }

    const filesCount = indexer.db.getAllFiles().length;

    const out = [
      '',
      `  ${divider}`,
      `  ${headerLine}`,
      `  ${divider}`,
      `  ${chalk.hex('#64748B')('model'.padEnd(11))}${activeModel}`,
      `  ${chalk.hex('#64748B')('context'.padEnd(11))}${totalTokens.toLocaleString()} / ${modelContextWindow.toLocaleString()} tokens  (${ratioPct}%)`,
      `  ${chalk.hex('#64748B')('workspace'.padEnd(11))}${tildify(workspaceRoot)}`,
      `  ${chalk.hex('#64748B')('branch'.padEnd(11))}${gitBranch}`,
      `  ${chalk.hex('#64748B')('files'.padEnd(11))}${filesCount}`,
      ...(isPro()
        ? [
            '',
            `  ${themeBorder('──  integrations  ──────────────────────')}`,
            ...integrationLines
          ]
        : []),
      ''
    ].join('\n');

    ui.addTextOutput(out);
    return true;
  }

  if (command === '/usage') {
    const activeRepoMap = indexer.getRepoMap();
    const activeChanges = indexer.getRecentChanges();
    const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
    const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content || ''), 0);
    const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
    const ratioPct = Math.round(Math.min(totalTokens / modelContextWindow, 1.0) * 100);

    const headerLine = chalk.hex('#C084FC')('◈ unit01  ·  context window');
    const divider = themeBorder('────────────────────────────────────────');

    let fillColor = '#F59E0B';
    if (ratioPct >= 60 && ratioPct < 80) {
      fillColor = '#D97706';
    } else if (ratioPct >= 80) {
      fillColor = '#F87171';
    }

    const filledCount = Math.round((ratioPct / 100) * 20);
    const emptyCount = 20 - filledCount;
    const filledStr = chalk.hex(fillColor)('█'.repeat(filledCount));
    const emptyStr = chalk.hex('#64748B')('░'.repeat(emptyCount));

    const labelStyle = chalk.hex('#64748B').dim;
    const percentStr = labelStyle(`${ratioPct}%`);
    const midDot = labelStyle('·');
    const tokensStr = labelStyle(`${Math.round(totalTokens / 1000)}k / ${Math.round(modelContextWindow / 1000)}k`);

    const out = [
      '',
      `  ${headerLine}`,
      `  ${divider}`,
      `  [${filledStr}${emptyStr}]  ${percentStr}  ${midDot}  ${tokensStr}`,
      ''
    ].join('\n');

    ui.addTextOutput(out);
    return true;
  }

  if (command === '/changes') {
    const changes = indexer.getRecentChanges();
    ui.addTextOutput('\n' + (changes || 'No recent changes.') + '\n');
    return true;
  }

  if (command === '/files') {
    const allFiles = indexer.db.getAllFiles();
    let out = `\nIndexed Files (${allFiles.length}):\n`;
    allFiles.forEach(f => {
      const rel = path.relative(workspaceRoot, f.path);
      out += `  - ${rel} (${(f.size / 1024).toFixed(1)} KB)\n`;
    });
    ui.addTextOutput(out);
    return true;
  }

  if (command === '/reindex') {
    ui.printSystemMessage('info', 'Re-scanning workspace and rebuilding index...');
    await indexer.initialize();
    ui.printSystemMessage('info', 'Index successfully rebuilt.');
    return true;
  }

  if (command === '/help') {
    const headerLine = chalk.hex('#C084FC')('◈ unit01  ·  help');
    const divider = themeBorder('────────────────────────────────────────');

    const helpItems = [
      { cmd: '/audit', desc: 'view recent activity audit logs' },
      { cmd: '/autopilot, /heal [cmd]', desc: 'enable test-driven self-healing loop (e.g. /heal npm test)' },
      { cmd: '/changes', desc: 'show recent file changes in the session' },
      { cmd: '/clear', desc: 'clear conversation history' },
      { cmd: '/compact', desc: 'save task checkpoint to compact history' },
      { cmd: '/connect', desc: 'manage integrations (GitHub, Slack, etc.)' },
      { cmd: '/diff', desc: 'view git diff of current session' },
      { cmd: '/exit, /quit', desc: 'exit the CLI' },
      { cmd: '/export', desc: 'export session transcript to Markdown' },
      { cmd: '/files', desc: 'list all indexed files' },
      { cmd: '/help', desc: 'show this menu' },
      { cmd: '/mcp', desc: 'manage MCP servers (add, reload, remove)' },
      { cmd: '/models', desc: 'switch the active model' },
      { cmd: '/overkill', desc: 'audit code for over-engineering and bloat' },
      { cmd: '/personality', desc: 'switch assistant personality tone' },
      { cmd: '/preview', desc: 'preview diff of last written file' },
      { cmd: '/reindex', desc: 're-scan workspace and rebuild code index' },
      { cmd: '/search', desc: 'configure web search provider & limit' },
      { cmd: '/sessions', desc: 'list and switch between saved sessions' },
      { cmd: '/status', desc: 'view active system and connection status' },
      { cmd: '/thinking', desc: 'toggle model thinking/reasoning mode' },
      { cmd: '/undo', desc: 'revert last file modification' },
      { cmd: '/usage', desc: 'view context window token utilization' }
    ];

    const out = [
      '',
      `  ${divider}`,
      `  ${headerLine}`,
      `  ${divider}`,
      ...helpItems.map(item => {
        const cmdColored = chalk.hex('#C084FC')(item.cmd.padEnd(28));
        const descColored = chalk.hex('#64748B')(item.desc);
        return `  ${cmdColored}${descColored}`;
      }),
      ''
    ].join('\n');

    ui.addTextOutput(out);
    return true;
  }

  if (command === '/export') {
    if (conversationHistory.length === 0) {
      ui.printSystemMessage('error', 'Nothing to export — conversation history is empty.');
      return true;
    }

    const homeDir = os.homedir();
    const sessionDir = path.join(homeDir, 'ruthen-sessions');

    if (!fs.existsSync(sessionDir)) {
      try {
        fs.mkdirSync(sessionDir, { recursive: true });
      } catch (e: any) {
        ui.printSystemMessage('error', `Failed to create sessions directory: ${e.message}`);
      }
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const firstUserMsg = conversationHistory.find(m => m.role === 'user' && !m.content?.includes('<tool_output>'));
    let suffix = '';
    if (firstUserMsg && typeof firstUserMsg.content === 'string') {
      let sanitised = firstUserMsg.content.toLowerCase();
      sanitised = sanitised.replace(/\s+/g, '-');
      sanitised = sanitised.replace(/[^a-z0-9\-]/g, '');
      sanitised = sanitised.replace(/-+/g, '-');
      sanitised = sanitised.replace(/^-+|-+$/g, '');
      sanitised = sanitised.substring(0, 40);
      sanitised = sanitised.replace(/-+$/g, '');

      if (sanitised.length >= 3) {
        suffix = sanitised;
      }
    }

    if (!suffix) {
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      suffix = `${hh}-${min}-${ss}`;
    }

    const defaultPath = path.join(sessionDir, `${dateStr}-${suffix}.md`);
    let targetPath = arg.trim();
    if (!targetPath) {
      targetPath = defaultPath;
    } else {
      if (targetPath.startsWith('~/')) {
        targetPath = path.join(homeDir, targetPath.slice(2));
      } else {
        targetPath = path.resolve(workspaceRoot, targetPath);
      }
    }

    let finalPath = targetPath;
    if (fs.existsSync(finalPath)) {
      const overwriteIdx = await ui.interactiveSelect(`File already exists at ${finalPath}. Overwrite?`, [
        'No (Generate unique filename)',
        'Yes (Overwrite)'
      ]);

      if (overwriteIdx !== 1) {
        const ext = path.extname(finalPath);
        const dir = path.dirname(finalPath);
        const base = path.basename(finalPath, ext);
        let counter = 1;
        while (true) {
          const candidate = path.join(dir, `${base}-${counter}${ext}`);
          if (!fs.existsSync(candidate)) {
            finalPath = candidate;
            break;
          }
          counter++;
        }
      }
    }

    interface FileMod {
      file: string;
      action: 'created' | 'modified' | 'moved' | 'deleted';
      toolUsed: string;
      edits: number;
    }

    const fileMods = new Map<string, FileMod>();

    function addOrMergeFileMod(file: string, action: 'created' | 'modified' | 'moved' | 'deleted', toolUsed: string) {
      const normalized = path.normalize(file);
      const existing = fileMods.get(normalized);
      if (existing) {
        existing.edits += 1;
        if (existing.action !== 'created' && action === 'created') {
          existing.action = 'created';
        }
        existing.toolUsed = toolUsed;
      } else {
        fileMods.set(normalized, {
          file: normalized,
          action,
          toolUsed,
          edits: 1
        });
      }
    }

    for (const msg of conversationHistory) {
      if (msg.role !== 'assistant') continue;
      const content = msg.content || '';

      const writeAttrRegex = /<write_file\s+(?:relative_)?path=["']([^"']+)["']/g;
      let match;
      while ((match = writeAttrRegex.exec(content)) !== null) {
        addOrMergeFileMod(match[1], 'created', 'write_file');
      }

      const deleteAttrRegex = /<delete_file\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/g;
      while ((match = deleteAttrRegex.exec(content)) !== null) {
        addOrMergeFileMod(match[1], 'deleted', 'delete_file');
      }

      const patchRegex = /<(patch_file|patch_file_blocks)\s+(?:relative_)?path=["']([^"']+)["']/g;
      while ((match = patchRegex.exec(content)) !== null) {
        addOrMergeFileMod(match[2], 'modified', match[1]);
      }

      const moveRegex = /<move_file\s+source_path=["']([^"']+)["']\s+destination_path=["']([^"']+)["']/g;
      while ((match = moveRegex.exec(content)) !== null) {
        addOrMergeFileMod(match[1], 'moved', 'move_file');
      }

      const makeDirAttrRegex = /<make_dir\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/g;
      while ((match = makeDirAttrRegex.exec(content)) !== null) {
        addOrMergeFileMod(match[1], 'created', 'make_dir');
      }

      const copyFileRegex = /<copy_file\s+source_path=["']([^"']+)["']\s+destination_path=["']([^"']+)["']/g;
      while ((match = copyFileRegex.exec(content)) !== null) {
        addOrMergeFileMod(match[2], 'created', 'copy_file');
      }
    }

    let filesModifiedTable = '';
    if (fileMods.size === 0) {
      filesModifiedTable = '*No files were modified in this session.*';
    } else {
      filesModifiedTable = '| File | Action | Tool Used | Edits |\n|------|--------|-----------|-------|\n';
      for (const mod of fileMods.values()) {
        filesModifiedTable += `| ${mod.file} | ${mod.action} | ${mod.toolUsed} | ${mod.edits} |\n`;
      }
    }

    const durationMs = Date.now() - sessionStartTime;
    const durationMins = Math.round(durationMs / 60000);
    const fullDateStr = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date());

    let conversationMarkdown = '';
    for (const msg of conversationHistory) {
      if (msg.role === 'user') {
        if (!msg.content?.includes('<tool_output>')) {
          conversationMarkdown += `### 👤 User\n${(msg.content || '').trim()}\n\n`;
        }
      } else if (msg.role === 'assistant') {
        conversationMarkdown += `### 🤖 Agent\n${redactSecrets(msg.content || '').trim()}\n\n`;
      }
    }

    const exportMarkdown = `# Unit 01 Session — ${fullDateStr}\n\n` +
      `**Duration:** ${durationMins}m\n` +
      `**Messages:** ${conversationHistory.length}\n` +
      `**Workspace:** ${workspaceRoot}\n` +
      `**Model:** ${activeModel}\n` +
      `**Exported:** ${new Date().toISOString()}\n\n` +
      `---\n\n` +
      `## Files Modified This Session\n\n` +
      filesModifiedTable +
      `\n\n---\n\n` +
      `## Conversation\n\n` +
      conversationMarkdown;

    try {
      fs.mkdirSync(path.dirname(finalPath), { recursive: true });
      fs.writeFileSync(finalPath, exportMarkdown, 'utf8');
      const stats = fs.statSync(finalPath);
      const sizeKb = (stats.size / 1024).toFixed(0);

      let displayPath = finalPath;
      if (displayPath.startsWith(homeDir)) {
        displayPath = '~' + displayPath.slice(homeDir.length);
      }

      ui.printSystemMessage('info', `Session exported to ${displayPath} (${sizeKb} KB)`);
    } catch (e: any) {
      ui.printSystemMessage('error', `Failed to write export file: ${e.message}`);
    }
    return true;
  }

  return false;
}
