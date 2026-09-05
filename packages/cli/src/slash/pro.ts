import chalk from 'chalk';
import { isPro } from '@unit01/core/tier.js';
import { ollama } from '@unit01/core/llm/client.js';
import { SlashContext } from './types.js';

export async function handleProCommands(command: string, arg: string, ctx: SlashContext): Promise<boolean> {
  const {
    ui,
    indexer,
    activeModel,
    userContextLimit,
    workspaceRoot,
    config,
    autopilotEnabled,
    setAutopilotEnabled,
    autopilotTestCommand,
    setAutopilotTestCommand,
    setActiveAbortController
  } = ctx;

  if (command === '/autopilot' || command === '/heal') {
    if (arg.trim()) {
      setAutopilotEnabled(true);
      setAutopilotTestCommand(arg.trim());
      ui.printSystemMessage('info', `🤖 Autopilot enabled with test command: "${arg.trim()}"`);
      return true;
    }

    const { detectProjectType } = await import('../prompt/helpers.js');
    const projectType = detectProjectType(workspaceRoot);
    let defaultCmd = 'npm test';
    if (projectType === 'Rust') defaultCmd = 'cargo test';
    else if (projectType === 'Go') defaultCmd = 'go test ./...';
    else if (projectType === 'Python') defaultCmd = 'pytest';

    const currentCmd = autopilotTestCommand || config.test_command || defaultCmd;
    const chosenIdx = await ui.interactiveSelect('Autopilot Mode:', [
      `Enable Autopilot (${currentCmd})  ${autopilotEnabled ? '✓' : ''}`,
      `Set Custom Test Command (current: "${currentCmd}")`,
      `Disable Autopilot ${!autopilotEnabled ? '✓' : ''}`
    ]);

    if (chosenIdx === 0) {
      setAutopilotEnabled(true);
      setAutopilotTestCommand(currentCmd);
      ui.printSystemMessage('info', `🤖 Autopilot enabled (${currentCmd}).`);
    } else if (chosenIdx === 1) {
      const customCmd = await ui.interactiveInput('Enter verification/test command:', currentCmd);
      if (customCmd.trim()) {
        setAutopilotTestCommand(customCmd.trim());
        setAutopilotEnabled(true);
        ui.printSystemMessage('info', `🤖 Autopilot enabled with command: "${customCmd.trim()}"`);
      }
    } else if (chosenIdx === 2) {
      setAutopilotEnabled(false);
      ui.printSystemMessage('info', '🤖 Autopilot disabled.');
    }
    return true;
  }

  if (command === '/overkill') {
    const activeChanges = indexer.getRecentChanges();
    if (!activeChanges) {
      ui.printSystemMessage('info', 'No code changes detected in this session yet to audit.');
      return true;
    }

    ui.printSystemMessage('info', 'Running overkill audit (checking for over-engineering and code fat)...');

    const auditPrompt = `Evaluate the following code modifications made during this session. Determine if the implementation is "overkill" or over-engineered (e.g. adding unnecessary abstractions, writing custom logic that standard library handles, introducing dependencies, creating unused files/boilerplate). Provide a goofy yet professional audit critique. Output a section called "THE FAT" listing the bloat, and "THE SHRED" listing how to simplify it.

[Session Changes]
${activeChanges}`;

    const payload = [
      { role: 'system', content: 'You are a cynical, minimalist senior developer auditing code for overkill and bloat.' },
      { role: 'user', content: auditPrompt }
    ];

    ui.startStreaming();
    try {
      const ac = new AbortController();
      setActiveAbortController(ac);
      await ollama.chatStream(
        activeModel,
        payload,
        userContextLimit,
        (chunk) => {
          ui.onStreamChunk(chunk);
        },
        ac.signal
      );
      setActiveAbortController(null);
      ui.endStreaming();
    } catch (err: any) {
      ui.endStreaming();
      ui.printSystemMessage('error', `Overkill audit failed: ${err.message}`);
    }
    return true;
  }

  if (command === '/audit') {
    if (!isPro()) {
      ui.printSystemMessage('error', 'The /audit command is a Pro tier feature.');
      return true;
    }
    const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
    const store = new AuditLogStore(indexer.db);
    const limitStr = arg ? arg.trim() : '15';
    const limit = parseInt(limitStr, 10) || 15;
    const logs = store.getRecentLogs(limit);
    if (logs.length === 0) {
      ui.printSystemMessage('info', 'No audit logs recorded yet.');
      return true;
    }
    let out = `\nRecent Activity Audit Logs:\n`;
    logs.forEach((l: any) => {
      const time = new Date(l.timestamp).toLocaleTimeString();
      const statusText =
        l.status === 'completed' || l.status === 'approved'
          ? chalk.green(l.status)
          : l.status === 'failed'
          ? chalk.red(l.status)
          : chalk.yellow(l.status);
      out += `  [${time}] ${chalk.cyan(l.service)} · ${l.operation} -> ${l.target} (${statusText})\n`;
    });
    ui.addTextOutput(out);
    return true;
  }

  return false;
}
