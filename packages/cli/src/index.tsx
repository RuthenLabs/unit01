#!/usr/bin/env -S node --no-warnings
import '@unit01/core/warnings.js';
import * as path from 'path';
import { isPro } from '@unit01/core/tier.js';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { render } from 'ink';
import React from 'react';

import { CodeIndexer } from '@unit01/core/indexer/index.js';
import { ExecutionGuard } from '@unit01/core/security/guard.js';
import { ollama } from '@unit01/core/llm/client.js';
import { AllowedPath } from '@unit01/core/security/types.js';
import { SessionStore, SessionData } from '@unit01/core/session/index.js';
import { handleToolCalls } from './commands.js';
import { dispatchSlashCommand, SlashContext } from './slash/index.js';
import {
  PERSONALITY_TONES,
  OLLAMA_TOOLS,
  SYSTEM_INSTRUCTIONS,
  formatToolCallToXml,
  getToolCallFingerprint,
  getXmlToolCallFingerprint,
  cleanModelResponse
} from './prompt/instructions.js';
import {
  estimateTokens,
  getGitBranch,
  detectProjectType,
  detectTestCommand,
  sendDesktopNotification,
  hasRepetitionLoop
} from './prompt/helpers.js';
import { App } from './app.js';
import { CoreServices, UiAdapter, CliState } from './types.js';

interface Unit01Config {
  allowed_paths?: AllowedPath[];
  compact_threshold?: number;
  test_command?: string;
  personality?: string;
  command_timeout?: number;
  context_limit?: number;
}

function loadConfig(workspaceRoot: string): Unit01Config {
  const configPath = path.join(workspaceRoot, 'unit01.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return data || {};
    } catch (e: any) {}
  }
  return {};
}

function compressSourceCode(filePath: string, content: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split(/\r?\n/);
  const isSourceCode = ['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.cpp', '.h', '.java', '.cs'].includes(ext);

  if (isSourceCode) {
    const outlineLines: string[] = [];
    let importCount = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ') || trimmed.startsWith('import {') || (trimmed.startsWith('const ') && trimmed.includes(' = require('))) {
        importCount++;
        continue;
      }
      const isStructure =
        trimmed.startsWith('export ') ||
        trimmed.startsWith('class ') ||
        trimmed.startsWith('interface ') ||
        trimmed.startsWith('function ') ||
        trimmed.startsWith('def ') ||
        trimmed.startsWith('pub ') ||
        trimmed.startsWith('type ') ||
        trimmed.startsWith('struct ') ||
        trimmed.includes('class ') ||
        (trimmed.startsWith('const ') && (trimmed.includes('=>') || trimmed.includes('function')));

      if (isStructure) {
        outlineLines.push(line);
      }
    }

    const summary = [];
    if (importCount > 0) {
      summary.push(`// [Collapsed ${importCount} import lines]`);
    }
    summary.push(...outlineLines);
    summary.push(`// ... [Full implementation of ${lines.length} lines cached to save tokens] ...`);
    summary.push(`// To view/retrieve raw content call <read_file path="${filePath}" />`);

    return summary.join('\n');
  }

  if (lines.length > 30) {
    const head = lines.slice(0, 10);
    const tail = lines.slice(-10);
    return [
      ...head,
      `\n... [${lines.length - 20} lines cached to save context window tokens] ...\n`,
      ...tail,
      `\n// To view/retrieve raw content call <read_file path="${filePath}" />`
    ].join('\n');
  }

  return content;
}

function detectAndLoadImages(text: string, workspaceRoot: string, ui: UiAdapter): string[] {
  if (!isPro()) return [];
  const imageBase64s: string[] = [];
  const imageRegex = /"([^"]+\.(?:png|jpg|jpeg|webp|gif))"|'([^']+\.(?:png|jpg|jpeg|webp|gif))'|([^\s"']+\.(?:png|jpg|jpeg|webp|gif))/gi;

  let match;
  while ((match = imageRegex.exec(text)) !== null) {
    const filePath = match[1] || match[2] || match[3];
    if (!filePath) continue;

    let resolvedPath = filePath;
    if (filePath === '~') {
      resolvedPath = os.homedir();
    } else if (filePath.startsWith('~/')) {
      resolvedPath = path.join(os.homedir(), filePath.slice(2));
    }

    const absPath = path.isAbsolute(resolvedPath)
      ? resolvedPath
      : path.resolve(workspaceRoot, resolvedPath);

    if (fs.existsSync(absPath)) {
      try {
        const stats = fs.statSync(absPath);
        if (stats.isFile()) {
          const data = fs.readFileSync(absPath);
          const base64 = data.toString('base64');
          imageBase64s.push(base64);
          ui.printSystemMessage('info', `📷 Loaded image: ${path.basename(absPath)}`);
        }
      } catch (e: any) {
        ui.printSystemMessage('error', `Failed to read image at ${filePath}: ${e.message}`);
      }
    }
  }
  return imageBase64s;
}

function printCliHelp() {
  console.log(`
Usage: u01 [options]

Options:
  -h, --help            Show this help message
  --workspace <path>    Specify the workspace root directory
  --model <name>        Specify the Ollama model to use
  -p <prompt>           Run in non-interactive mode with a single prompt
  --allow <path>        Allow read-write access to a path outside the workspace
  --allow-read <path>   Allow read-only access to a path outside the workspace
  -c, --continue        Continue the last active session
`);
}

async function main() {
  const workspaceRoot = process.cwd();

  const args = process.argv.slice(2);
  let activeModelArg: string | null = null;
  let nonInteractivePrompt: string | null = null;
  const cliAllowedPaths: AllowedPath[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      printCliHelp();
      process.exit(0);
    } else if (args[i] === '--workspace' && i + 1 < args.length) {
      i++;
    } else if (args[i] === '--model' && i + 1 < args.length) {
      activeModelArg = args[i + 1];
      i++;
    } else if (args[i] === '-p' && i + 1 < args.length) {
      nonInteractivePrompt = args[i + 1];
      i++;
    } else if (args[i] === '--allow' && i + 1 < args.length) {
      cliAllowedPaths.push({ path: args[i + 1], mode: 'rw' });
      i++;
    } else if (args[i] === '--allow-read' && i + 1 < args.length) {
      cliAllowedPaths.push({ path: args[i + 1], mode: 'ro' });
      i++;
    } else if (args[i] === '-c' || args[i] === '--continue') {
      // continue session
    }
  }

  const models = await ollama.listModels();
  if (models.length === 0) {
    console.error('\n❌ Error: No local Ollama models detected.\n');
    console.error('To get started:');
    console.error('  1. Ensure the Ollama service is running on your machine.');
    console.error('  2. Download a coding model by running: ollama pull qwen2.5-coder\n');
    process.exit(1);
  }

  const chatModels = models.filter(m => !m.name.toLowerCase().includes('embed'));
  let activeModel = (chatModels.length > 0 ? chatModels[0] : models[0]).name;
  if (activeModelArg) {
    const matchIndex = models.findIndex(m => m.name === activeModelArg);
    if (matchIndex !== -1) activeModel = models[matchIndex].name;
  }

  let modelContextWindow = await ollama.getContextLimit(activeModel);

  const config = loadConfig(workspaceRoot);
  let activePersonality = config.personality || 'vanilla';
  const userContextLimit: number = config.context_limit ?? 0;
  const rawAllowed = [...(config.allowed_paths || []), ...cliAllowedPaths];
  const resolvedAllowedPaths: AllowedPath[] = [];
  for (const item of rawAllowed) {
    let resolvedPath = item.path;
    if (resolvedPath.startsWith('~/')) {
      resolvedPath = path.join(os.homedir(), resolvedPath.slice(2));
    }
    resolvedAllowedPaths.push({
      path: path.resolve(resolvedPath),
      mode: item.mode
    });
  }

  const state: CliState = {
    lastWrittenFile: null,
    activeAllowedPaths: resolvedAllowedPaths,
    isNonInteractive: !!nonInteractivePrompt
  };

  let compactThreshold = config.compact_threshold ?? 0.8;
  let sessionId: string = crypto.randomUUID();
  let autopilotEnabled = false;
  let autopilotTestCommand: string | null = null;
  const sessionStartTime = Date.now();
  let lastInputTokens = 0;
  let pendingCompaction = false;
  const conversationHistory: any[] = [];
  const fileReadCache = new Map<string, string>();

  const recentToolCallsFingerprints: string[] = [];
  const fingerprintConsecutiveCounts = new Map<string, number>();
  const MAX_FINGERPRINTS = 20;
  const LOOP_TRIGGER_COUNT = isPro() ? 2 : 3;
  let useNativeTools = false;

  let modelSupportsThinking = false;
  try {
    modelSupportsThinking = await ollama.checkModelThinkingCapability(activeModel);
  } catch (e) {}
  let thinkingEnabled = modelSupportsThinking;

  const indexer = new CodeIndexer(workspaceRoot);
  await indexer.initialize({ silent: true });

  let memoryStore: any = null;
  if (isPro()) {
    const { ProjectMemoryStore } = await import('@unit01/pro/memory/index.js');
    memoryStore = new ProjectMemoryStore(indexer.db);
  }

  if (isPro()) {
    try {
      const { indexMissingEmbeddings } = await import('@unit01/pro/search/index.js');
      await indexMissingEmbeddings(indexer.db, true);
    } catch (e) {}
  }

  try {
    const { McpClientManager } = await import('@unit01/core/mcp/client.js');
    McpClientManager.getInstance().initialize(true).catch(() => {});
  } catch (e) {}

  const filesCount = indexer.db.getAllFiles().length;

  const commandTimeoutMs = (config.command_timeout && config.command_timeout > 0)
    ? config.command_timeout * 1000
    : 30000;

  const guard = new ExecutionGuard(
    workspaceRoot,
    state.activeAllowedPaths,
    () => {},
    commandTimeoutMs
  );

  const sessionStore = new SessionStore(workspaceRoot);
  const gitBranch = getGitBranch(workspaceRoot);
  const projectType = detectProjectType(workspaceRoot);

  const existingSessions = sessionStore.list(workspaceRoot).filter(s => s.id !== sessionId);
  const isFirstRun = !fs.existsSync(path.join(workspaceRoot, 'unit01.json')) && existingSessions.length === 0;

  let latestSession: { relTime: string; label: string } | null = null;
  if (existingSessions.length > 0) {
    const latest = existingSessions[0];
    const diff = Date.now() - latest.lastUpdatedAt;
    let relTime = 'just now';
    if (diff > 86400000) {
      const days = Math.floor(diff / 86400000);
      relTime = `${days} day${days > 1 ? 's' : ''} ago`;
    } else if (diff > 3600000) {
      const hrs = Math.floor(diff / 3600000);
      relTime = `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
    } else if (diff > 60000) {
      const mins = Math.floor(diff / 60000);
      relTime = `${mins} minute${mins > 1 ? 's' : ''} ago`;
    } else if (diff > 5000) {
      const secs = Math.floor(diff / 1000);
      relTime = `${secs} seconds ago`;
    }
    const cleanMsg = latest.firstMessage.replace(/\r?\n/g, ' ').trim();
    latestSession = {
      relTime,
      label: cleanMsg.length > 60 ? cleanMsg.substring(0, 60) + '...' : cleanMsg || '(empty session)'
    };
  }

  let activeAbortController: AbortController | null = null;

  const runCompaction = async (ui: UiAdapter, isAuto: boolean = false): Promise<boolean> => {
    if (conversationHistory.length < 4) return false;

    const activeRepoMap = indexer.getRepoMap();
    const activeChanges = indexer.getRecentChanges();
    const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
    const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
    const pct = Math.round((totalTokens / modelContextWindow) * 100);

    const VERBATIM_KEEP = 6;
    const recentMessages = conversationHistory.slice(-VERBATIM_KEEP);
    const messagesToSummarize = conversationHistory.slice(0, -VERBATIM_KEEP);

    if (messagesToSummarize.length === 0) return false;

    const summaryPrompt = `You are creating a Task Checkpoint — a structured record of what was done in this session. 
Analyze only the conversation messages provided and output a response wrapped in a single <checkpoint_response> tag with these sections:

1. <task_state>: One sentence describing what task is currently in progress.
2. <summary>: A concise technical brief (3-5 sentences) of the edits made, files created, and commands run.
3. <decisions>: Architectural choices made. Format: "- [category] Summary (Rationale: description)". Categories: database, auth, styles, conventions, other.
4. <conventions>: Coding guidelines or patterns established. Format: "- [key]: \\"Pattern details\\"".

Output ONLY the <checkpoint_response> tag and nothing else.`;

    const summarisationPayload = [
      ...messagesToSummarize,
      { role: 'user', content: summaryPrompt }
    ];

    try {
      activeAbortController = new AbortController();
      const chatResult = await ollama.chatStream(
        activeModel,
        summarisationPayload,
        userContextLimit,
        () => {},
        activeAbortController.signal
      );
      activeAbortController = null;

      const contentText = chatResult.content;
      const taskStateMatch = /<task_state>([\s\S]*?)<\/task_state>/.exec(contentText);
      const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(contentText);
      const summaryContent = summaryMatch ? summaryMatch[1].trim() : contentText.trim();

      if (!summaryContent) throw new Error('Empty checkpoint summary');

      const decisionsMatch = /<decisions>([\s\S]*?)<\/decisions>/.exec(contentText);
      if (decisionsMatch) {
        const lines = decisionsMatch[1].split('\n');
        for (const line of lines) {
          const match = /-\s*\[(database|auth|styles|conventions|other)\]\s*(.*?)\s*\(Rationale:\s*(.*?)\)/i.exec(line);
          if (match) {
            const [, category, summary, rationale] = match;
            try {
              memoryStore?.logDecision({
                category: category.toLowerCase() as any,
                summary: summary.trim(),
                rationale: rationale.trim(),
                context_files: []
              });
            } catch (e) {}
          }
        }
      }

      const conventionsMatch = /<conventions>([\s\S]*?)<\/conventions>/.exec(contentText);
      if (conventionsMatch) {
        const lines = conventionsMatch[1].split('\n');
        for (const line of lines) {
          const match = /-\s*\[(.*?)\]:\s*"(.*?)"/.exec(line);
          if (match) {
            const [, key, pattern] = match;
            try {
              memoryStore?.upsertConvention(key.trim(), pattern.trim());
            } catch (e) {}
          }
        }
      }

      const recentChangesBlock = activeChanges
        ? `\n\n[Files changed this session]\n${activeChanges}`
        : '';
      const memoryBlock = memoryStore?.generateMemoryContextBlock() || '';
      const taskState = taskStateMatch ? taskStateMatch[1].trim() : 'Ongoing task';

      const checkpointBlock = [
        `[TASK CHECKPOINT — saved at ${new Date().toISOString()}]`,
        ``,
        `Current task: ${taskState}`,
        ``,
        `What was done:`,
        summaryContent,
        recentChangesBlock,
        memoryBlock ? `\n${memoryBlock}` : '',
      ].join('\n').trim();

      conversationHistory.length = 0;
      conversationHistory.push({
        role: 'system',
        content: checkpointBlock
      });
      conversationHistory.push(...recentMessages);

      const newHistoryLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
      const newTotal = systemPromptLength + newHistoryLength;
      const saved = totalTokens - newTotal;
      lastInputTokens = newTotal;
      const newPct = Math.round((newTotal / modelContextWindow) * 100);

      ui.printSystemMessage('info', `task checkpoint saved  ·  ${pct}% → ${newPct}%  ·  ${saved} tokens freed  ·  last ${VERBATIM_KEEP} messages kept verbatim`);
      return true;
    } catch (err: any) {
      ui.printSystemMessage('warn', `Task checkpoint failed: ${err.message}`);
      return false;
    }
  };

  const resumeSession = async (ui: UiAdapter, sessionData: SessionData) => {
    conversationHistory.length = 0;
    conversationHistory.push(...sessionData.conversationHistory);
    activeModel = sessionData.activeModel;
    modelContextWindow = await ollama.getContextLimit(activeModel);
    sessionId = sessionData.id;
    lastInputTokens = 0;
    ui.updateStatus(activeModel, '0', gitBranch);
    ui.populateHistory(sessionData.conversationHistory);

    const memoryBlock = memoryStore?.generateMemoryContextBlock();
    if (memoryBlock) {
      conversationHistory.unshift({
        role: 'system',
        content: `[SESSION RESUMED — project memory restored]\n${memoryBlock}`
      });
    }

    ui.printSystemMessage('info', `Resumed session successfully.`);
  };

  const handleInput = async (input: string, ui: UiAdapter) => {
    try {
      await handleInputInternal(input, ui);
      if (conversationHistory.length > 0) {
        sessionStore.save(sessionId, {
          startedAt: sessionStartTime,
          activeModel,
          conversationHistory
        });
      }
    } finally {
      if (state.isNonInteractive) {
        try { indexer.close(); } catch (e) {}
        setTimeout(() => {
          ui.exit(0);
        }, 100);
      }
    }
  };

  const handleInputInternal = async (input: string, ui: UiAdapter) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(/\s+/);
      const command = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ');

      const slashCtx: SlashContext = {
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
        setActiveModel: (m: string) => { activeModel = m; },
        activePersonality,
        setActivePersonality: (p: string) => { activePersonality = p; },
        userContextLimit,
        modelContextWindow,
        setModelContextWindow: (w: number) => { modelContextWindow = w; },
        lastInputTokens,
        setLastInputTokens: (t: number) => { lastInputTokens = t; },
        setSessionId: (id: string) => { sessionId = id; },
        runCompaction,
        resumeSession,
        activeAbortController,
        setActiveAbortController: (ac: AbortController | null) => { activeAbortController = ac; },
        config,
        gitBranch,
        memoryStore,
        thinkingEnabled,
        setThinkingEnabled: (t: boolean) => { thinkingEnabled = t; },
        autopilotEnabled,
        setAutopilotEnabled: (a: boolean) => { autopilotEnabled = a; },
        autopilotTestCommand,
        setAutopilotTestCommand: (cmd: string | null) => { autopilotTestCommand = cmd; }
      };

      const handled = await dispatchSlashCommand(command, arg, slashCtx);
      if (!handled) {
        ui.printSystemMessage('error', `Unknown command: ${command}`);
      }
      return;
    }

    const images = detectAndLoadImages(trimmed, workspaceRoot, ui);
    const userMsg: any = { role: 'user', content: trimmed };
    if (images.length > 0) {
      userMsg.images = images;
    }
    conversationHistory.push(userMsg);
    recentToolCallsFingerprints.length = 0;

    const optimizeContextHistory = () => {
      for (let i = 0; i < conversationHistory.length; i++) {
        const msg = conversationHistory[i];
        if (!msg.content) continue;

        const readMatch = /File content of ([^\s:]+):([\s\S]+)/.exec(msg.content);
        if (readMatch) {
          const filePath = readMatch[1].trim();
          const rawContent = readMatch[2].trim();

          if (rawContent.length > 800) {
            fileReadCache.set(filePath, rawContent);
            const compressed = compressSourceCode(filePath, rawContent);

            if (msg.role === 'tool') {
              msg.content = `File content of ${filePath}:\n${compressed}`;
            } else {
              msg.content = `<tool_output>\nFile content of ${filePath}:\n${compressed}\n</tool_output>`;
            }
          }
        }

        const fetchMatch = /Content of (https?:\/\/[^\s:]+):([\s\S]+)/.exec(msg.content);
        if (fetchMatch) {
          const url = fetchMatch[1].trim();
          const rawContent = fetchMatch[2].replace(/<\/tool_output>$/, '').trim();

          if (rawContent.length > 100) {
            const compressed = `[Webpage content fetched and read. Full body dropped to save tokens.]`;
            if (msg.role === 'tool') {
              msg.content = `Content of ${url}:\n${compressed}`;
            } else {
              msg.content = `<tool_output>\nContent of ${url}:\n${compressed}\n</tool_output>`;
            }
          }
        }
      }
    };

    let accumulatedThinking = '';
    let loopDepth = 0;
    const runAgentLoop = async () => {
      loopDepth++;
      if (loopDepth > 30) {
        ui.printSystemMessage('guard', 'Loop protection: Max tool execution depth reached, returning control to user.');
        return;
      }

      const currentRepoMap = indexer.getRepoMap();
      const currentChanges = indexer.getRecentChanges();

      const memoryContext = memoryStore?.generateMemoryContextBlock() || '';

      let mcpToolsBlock = '';
      try {
        const { McpClientManager } = await import('@unit01/core/mcp/client.js');
        const mcpTools = McpClientManager.getInstance().getAllTools();
        if (mcpTools.length > 0) {
          const lines = mcpTools.map(t =>
            `  - server="${t.serverId}" name="${t.name}": ${t.description}`
          ).join('\n');
          mcpToolsBlock = `\n\n[MCP Tools — call with <mcp_tool server="id" name="name">{...json args...}</mcp_tool>]\n${lines}`;
        }
      } catch (_) {}

      let semanticContextBlock = '';
      if (isPro()) {
        try {
          const lastUserMsg = [...conversationHistory].reverse().find(m => m.role === 'user');
          if (lastUserMsg && typeof lastUserMsg.content === 'string') {
            const { generateSemanticContextBlock } = await import('@unit01/pro/search/index.js');
            const block = await generateSemanticContextBlock(indexer.db, lastUserMsg.content);
            if (block) semanticContextBlock = block;
          }
        } catch (_) {}
      }

      const systemEnvBlock = `\n\n[System Environment]
- Workspace Root Path: ${workspaceRoot}
- User Home Directory: ${os.homedir()}
- OS Platform: ${process.platform}`;

      const systemMessage = {
        role: 'system',
        content: `${SYSTEM_INSTRUCTIONS}${systemEnvBlock}\n\n[Repo Map]\n${currentRepoMap}\n${currentChanges}${memoryContext}${semanticContextBlock}${mcpToolsBlock}`
      };

      const activePayload = [systemMessage, ...conversationHistory];

      let streamAccumulator = '';
      ui.startStreaming();

      try {
        activeAbortController = new AbortController();
        const chatResult = await ollama.chatStream(
          activeModel,
          activePayload,
          userContextLimit,
          (chunk) => {
            streamAccumulator += chunk;
            if (hasRepetitionLoop(streamAccumulator)) {
              throw new Error('REPETITION_LOOP');
            }
            ui.onStreamChunk(chunk);
          },
          activeAbortController.signal,
          useNativeTools ? OLLAMA_TOOLS : undefined,
          modelSupportsThinking && thinkingEnabled
        );
        activeAbortController = null;

        ui.endStreaming();
        const modelResponse = chatResult.content;
        const thinkMatch = /<think>([\s\S]*?)<\/think>/.exec(modelResponse);
        if (thinkMatch) {
          accumulatedThinking += thinkMatch[1].trim() + '\n\n';
        }
        const responseWithoutThink = modelResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        lastInputTokens = chatResult.usage.input_tokens;

        if (chatResult.usage.input_tokens / modelContextWindow >= compactThreshold) {
          pendingCompaction = true;
        }

        let toolResult: { toolRun: boolean; nextPrompt: string; consoleOutput: string } = {
          toolRun: false,
          nextPrompt: '',
          consoleOutput: ''
        };

        const isLooping = (fp: string): boolean => {
          const count = (fingerprintConsecutiveCounts.get(fp) || 0) + 1;
          fingerprintConsecutiveCounts.set(fp, count);
          for (const [key] of fingerprintConsecutiveCounts) {
            if (key !== fp) fingerprintConsecutiveCounts.set(key, 0);
          }
          return count >= LOOP_TRIGGER_COUNT;
        };

        const evictReadFingerprintsForPath = (rawPath: string) => {
          const normalised = rawPath.replace(/^\.?\//, '');
          for (let i = recentToolCallsFingerprints.length - 1; i >= 0; i--) {
            const fp = recentToolCallsFingerprints[i];
            if (fp.includes('read_file') && fp.includes(normalised)) {
              recentToolCallsFingerprints.splice(i, 1);
              fingerprintConsecutiveCounts.delete(fp);
            }
          }
        };

        if (useNativeTools && chatResult.tool_calls && chatResult.tool_calls.length > 0) {
          ui.printModelResponse(responseWithoutThink || 'Executing tools...', false);

          const tc = chatResult.tool_calls[0];
          const fingerprint = getToolCallFingerprint(tc);

          if (isLooping(fingerprint)) {
            ui.printToolResult('failure', `Tool: ${tc.function.name} (blocked)`);
            ui.printSystemMessage('guard', `Loop protection: ${tc.function.name} was called ${LOOP_TRIGGER_COUNT}x in a row. Returning control to user.`);
            toolResult = {
              toolRun: false,
              nextPrompt: '',
              consoleOutput: `\n[Loop protection: ${tc.function.name} blocked]`
            };
          } else {
            recentToolCallsFingerprints.push(fingerprint);
            if (recentToolCallsFingerprints.length > MAX_FINGERPRINTS) {
              recentToolCallsFingerprints.shift();
            }

            const xmlEquivalent = formatToolCallToXml(tc);
            if (xmlEquivalent) {
              const writtenPath = tc.function?.arguments?.path || tc.function?.arguments?.filePath || tc.function?.arguments?.destinationPath || tc.function?.arguments?.destination_path || '';
              if (writtenPath && ['write_file', 'patch_file', 'patch_file_blocks', 'delete_file', 'make_dir', 'copy_file'].includes(tc.function?.name)) {
                evictReadFingerprintsForPath(writtenPath);
              }
              toolResult = await handleToolCalls(xmlEquivalent, guard, indexer, ui, state, fileReadCache);
            }
          }
        } else {
          ui.printModelResponse(responseWithoutThink, false);

          const cleanedResponse = cleanModelResponse(modelResponse);
          const xmlFingerprint = getXmlToolCallFingerprint(cleanedResponse);
          if (xmlFingerprint && isLooping(xmlFingerprint)) {
            ui.printToolResult('failure', `Tool call blocked`);
            ui.printSystemMessage('guard', `Loop protection: same tool called ${LOOP_TRIGGER_COUNT}x in a row. Returning control to user.`);
            toolResult = {
              toolRun: false,
              nextPrompt: '',
              consoleOutput: `\n[Loop protection: blocked]`
            };
          } else {
            if (xmlFingerprint) {
              recentToolCallsFingerprints.push(xmlFingerprint);
              if (recentToolCallsFingerprints.length > MAX_FINGERPRINTS) {
                recentToolCallsFingerprints.shift();
              }
              let writtenPath = '';
              const writeMatch = cleanedResponse.match(/<(?:patch_file|write_file|patch_file_blocks)[^>]*path="([^"]+)"/);
              if (writeMatch) {
                writtenPath = writeMatch[1];
              } else {
                const deleteMatch = cleanedResponse.match(/<delete_file\s*>([\s\S]*?)<\/delete_file>/);
                if (deleteMatch) {
                  writtenPath = deleteMatch[1].trim();
                } else {
                  const makeDirMatch = cleanedResponse.match(/<make_dir\s*>([\s\S]*?)<\/make_dir>/);
                  if (makeDirMatch) {
                    writtenPath = makeDirMatch[1].trim();
                  } else {
                    const copyMatch = cleanedResponse.match(/<copy_file[^>]*destination_path="([^"]+)"/);
                    if (copyMatch) writtenPath = copyMatch[1];
                  }
                }
              }
              if (writtenPath) evictReadFingerprintsForPath(writtenPath);
            }
            toolResult = await handleToolCalls(cleanedResponse, guard, indexer, ui, state, fileReadCache);
          }
        }

        const hasEditedFiles = modelResponse.includes('<patch_file') || 
                            modelResponse.includes('<write_file') || 
                            modelResponse.includes('<patch_file_blocks') ||
                            modelResponse.includes('<delete_file') ||
                            modelResponse.includes('<make_dir') ||
                            modelResponse.includes('<copy_file') ||
                            (chatResult.tool_calls && chatResult.tool_calls.some((tc: any) => 
                              ['write_file', 'patch_file', 'patch_file_blocks', 'delete_file', 'make_dir', 'copy_file'].includes(tc.function?.name)
                            ));

        if (autopilotEnabled && toolResult.toolRun && hasEditedFiles) {
          const testCommand = autopilotTestCommand || config.test_command || detectTestCommand(workspaceRoot);
          if (isPro()) {
            ui.printSystemMessage('info', `🤖 [Autopilot] Starting structured build pipeline: "${testCommand}"...`);
            try {
              const { StructuredBuildPipeline } = await import('@unit01/pro/autopilot/pipeline.js');
              const pipeline = new StructuredBuildPipeline(workspaceRoot, testCommand, 8);

              const result = await pipeline.executePipeline(
                async () => {},
                async (errorLog: string) => {
                  toolResult.nextPrompt = `<tool_output>\nAutopilot verification command "${testCommand}" failed with output:\n${errorLog.substring(0, 3000)}\n</tool_output>`;
                  toolResult.toolRun = true;
                  conversationHistory.push({ role: 'assistant', content: modelResponse });
                  conversationHistory.push({ role: 'user', content: toolResult.nextPrompt });
                  await runAgentLoop();
                  return true;
                }
              );

              if (result.success) {
                sendDesktopNotification('Autopilot Success 🤖', `All checks passed after ${result.iterations} iteration(s).`);
              } else {
                sendDesktopNotification('Autopilot Halted ⚠️', `Pipeline stopped after ${result.iterations} iteration(s). Manual review needed.`);
              }
            } catch (e: any) {
              ui.printSystemMessage('error', `🤖 [Autopilot] Pipeline execution failed: ${e.message}`);
            }
          } else {
            ui.printSystemMessage('info', `🤖 [Autopilot] Verifying edits with test command: "${testCommand}"...`);
            try {
              const { exec } = await import('child_process');
              const { promisify } = await import('util');
              const execPromise = promisify(exec);

              let passed = false;
              let output = '';
              try {
                const { stdout, stderr } = await execPromise(testCommand, {
                  cwd: workspaceRoot,
                  env: { ...process.env, CI: 'true' }
                });
                passed = true;
                output = stdout + (stderr || '');
              } catch (err: any) {
                passed = false;
                output = (err.stdout || '') + (err.stderr || '') + (err.message || '');
              }

              if (passed) {
                ui.printSystemMessage('info', '🤖 [Autopilot] Verification passed successfully!');
                sendDesktopNotification("Autopilot Success 🤖", `Verification passed for command: "${testCommand}"`);
              } else {
                ui.printSystemMessage('error', '🤖 [Autopilot] Verification failed. Self-healing trace generated.');
                sendDesktopNotification("Autopilot Verification Failed ⚠️", `Self-healing in progress for: "${testCommand}"`);
                toolResult.nextPrompt = `<tool_output>\nAutopilot verification command "${testCommand}" failed with output:\n${output.substring(0, 3000)}\n</tool_output>`;
                toolResult.toolRun = true;
              }
            } catch (e: any) {
              ui.printSystemMessage('error', `🤖 [Autopilot] Verification execution failed: ${e.message}`);
            }
          }
        }

        if (toolResult.toolRun) {
          if (useNativeTools && chatResult.tool_calls && chatResult.tool_calls.length > 0) {
            conversationHistory.push({
              role: 'assistant',
              content: modelResponse,
              tool_calls: chatResult.tool_calls
            });
            const rawOutput = toolResult.nextPrompt
              .replace('<tool_output>\n', '')
              .replace('\n</tool_output>', '');
            conversationHistory.push({
              role: 'tool',
              content: rawOutput
            });
          } else {
            conversationHistory.push({ role: 'assistant', content: modelResponse });
            conversationHistory.push({ role: 'user', content: toolResult.nextPrompt });
          }
          await runAgentLoop();
        } else {
          conversationHistory.push({ role: 'assistant', content: modelResponse });

          try { memoryStore?.autoCapture(responseWithoutThink, sessionId); } catch (_) {}

          if (thinkingEnabled && accumulatedThinking.trim()) {
            ui.printModelResponse(`<think>\n${accumulatedThinking.trim()}\n</think>`, true);
          }
          optimizeContextHistory();
          if (pendingCompaction) {
            await runCompaction(ui, true);
            pendingCompaction = false;
          }
          ui.returnToPrompt();
        }
      } catch (err: any) {
        ui.endStreaming();
        if (thinkingEnabled && accumulatedThinking.trim()) {
          ui.printModelResponse(`<think>\n${accumulatedThinking.trim()}\n</think>`, true);
        }
        if (err.message === 'REPETITION_LOOP') {
          ui.printSystemMessage('error', 'Loop protection: Generation stopped, model repetition loop detected.');
        } else {
          ui.printSystemMessage('error', `Generation failed: ${err.message}`);
        }
        ui.returnToPrompt();
      }
    };

    await runAgentLoop();
  };

  const services: CoreServices = {
    workspaceRoot,
    activeModel,
    contextLimit: modelContextWindow,
    filesCount,
    gitBranch,
    projectType,
    isFirstRun,
    thinkingEnabled,
    latestSession,
    nonInteractivePrompt,
    abortStreaming: () => {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
    },
    handleInput
  };

  render(<App services={services} />);
}

main().catch(err => {
  console.error('Failed to boot Unit01 CLI:', err);
});
