#!/usr/bin/env -S node --no-warnings
/**
 * app.tsx — Root Ink component for Unit01 CLI
 * 
 * Replaces the rendering logic from the old index.ts (1878 lines).
 * All business logic (LLM, tools, sessions) is delegated to hooks and callbacks.
 * This file only handles WHAT to render based on the current app state.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import chalk from 'chalk';
import {
  themePrimary,
  themeBorder,
  themeAccent,
  themeGold,
  themeGray,
  themeRed,
  isGui,
  guiEmit
} from './views/theme.js';
import {
  WelcomeBanner,
  ThinkingSpinner,
  ToolProgress,
  ChatStream,
  SystemMessage,
  ToolResult,
  SelectMenu,
  ConfirmWrite,
  PromptInput,
  DiffView,
  InteractiveInput,
  FullscreenOverlay
} from './components/index.js';
import type { CoreServices, AppScreen, OutputEntry } from './types.js';

function getActiveToolStreamProgress(text: string): { active: boolean; details: string } | null {
  const writeReg = /<(write_file|patch_file_blocks|patch_file)\s+path="([^"]+)"\s*>/g;
  let lastMatch: RegExpExecArray | null = null;
  let match;
  
  while ((match = writeReg.exec(text)) !== null) {
    lastMatch = match;
  }
  
  if (lastMatch) {
    const tag = lastMatch[1];
    const filePath = lastMatch[2];
    const startIndex = lastMatch.index + lastMatch[0].length;
    
    const closeTag = `</${tag}>`;
    const closeIndex = text.indexOf(closeTag, startIndex);
    
    if (closeIndex === -1) {
      const contentSoFar = text.substring(startIndex);
      const lineCount = contentSoFar.split('\n').length;
      const sizeKb = (contentSoFar.length / 1024).toFixed(1);
      
      let action = 'Writing';
      if (tag === 'patch_file') action = 'Patching';
      if (tag === 'patch_file_blocks') action = 'Patching';
      
      const filename = filePath.split(/[/\\]/).pop() || filePath;
      
      return {
        active: true,
        details: `${action} ${chalk.hex('#38BDF8')(filename)}... (${lineCount} lines, ${sizeKb} KB)`
      };
    }
  }
  
  const makeDirReg = /<make_dir\s*>([\s\S]*?)$/g;
  const makeDirMatch = makeDirReg.exec(text);
  if (makeDirMatch && !makeDirMatch[1].includes('</make_dir>')) {
    const dirName = makeDirMatch[1].trim();
    return {
      active: true,
      details: `Creating directory ${chalk.hex('#38BDF8')(dirName)}...`
    };
  }

  return null;
}

interface AppProps {
  services: CoreServices;
}

export function App({ services }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const rows = stdout?.rows || 24;
  const cols = stdout?.columns || 80;

  // App state machine
  const [screen, setScreen] = useState<AppScreen>('prompt');
  const [output, setOutput] = useState<OutputEntry[]>([]);

  // Streaming state
  const [streamText, setStreamText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [spinnerActive, setSpinnerActive] = useState(false);
  const [toolProgressActive, setToolProgressActive] = useState(false);
  const [toolProgressDetails, setToolProgressDetails] = useState('');

  // Modal state
  const [selectMenuProps, setSelectMenuProps] = useState<{
    title: string;
    options: string[];
    resolve: (index: number) => void;
  } | null>(null);

  const [confirmWriteProps, setConfirmWriteProps] = useState<{
    filePath: string;
    lineCount: number;
    actionVerb: 'write' | 'create' | 'modify' | 'delete';
    resolve: (choice: 'y' | 'n' | 'p') => void;
  } | null>(null);

  const [diffViewProps, setDiffViewProps] = useState<{
    original: string | null;
    modified: string;
    language: string;
    filePath: string;
  } | null>(null);

  const [interactiveInputProps, setInteractiveInputProps] = useState<{
    title: string;
    placeholder?: string;
    resolve: (val: string) => void;
  } | null>(null);

  // Status bar state
  const [statusModel, setStatusModel] = useState('');
  const [statusContext, setStatusContext] = useState('');
  const [statusBranch, setStatusBranch] = useState('');

  // Welcome info
  const [welcomeShown, setWelcomeShown] = useState(false);
  const [welcomeHints, setWelcomeHints] = useState<string[]>([]);

  // Ref to prevent double-init
  const initialized = useRef(false);
  const autoSubmitted = useRef(false);

  // Show thinking toggle (expanded by default or collapsed)
  const [showThinking, setShowThinking] = useState(false);

  // Fullscreen Scrollable Overlay State
  const [overlayContent, setOverlayContent] = useState<{ title: string; content: string } | null>(null);
  const lastTruncatedRef = useRef<{ title: string; content: string } | null>(null);
  const registerTruncated = useCallback((title: string, content: string) => {
    lastTruncatedRef.current = { title, content };
  }, []);

  // Listen for Escape during model streaming to abort, Ctrl+T to toggle thinking, and Ctrl+O to open full code overlay
  useInput((input, key) => {
    if (screen === 'streaming' && key.escape) {
      services.abortStreaming();
    }
    if (key.ctrl && input === 't') {
      setShowThinking(prev => !prev);
    }
    if (key.ctrl && input === 'o') {
      if (lastTruncatedRef.current) {
        setOverlayContent(lastTruncatedRef.current);
      }
    }
  });

  // Initialize on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    setStatusModel(services.activeModel);
    setStatusBranch(services.gitBranch);
    setWelcomeShown(true);

    // Build welcome hints
    const hints: string[] = [];
    if (services.isFirstRun) {
      hints.push(`◈ Type ${chalk.cyan('/')} to see commands  ·  type anything to begin`);
      hints.push(`◈ Press ${chalk.cyan('Escape')} to stop generation`);
    }
    if (services.latestSession && !services.isFirstRun) {
      hints.push(`⤿ Last session ${services.latestSession.relTime} · "${services.latestSession.label}"`);
      hints.push(`  Type ${chalk.cyan('/sessions')} to browse all, or just start typing.`);
    }
    setWelcomeHints(hints);
  }, []);

  // Update status bar
  const updateStatus = useCallback((model: string, ctx: string, branch: string) => {
    setStatusModel(model);
    setStatusContext(ctx);
    setStatusBranch(branch);
  }, []);

  // Add output entry
  const addOutput = useCallback((entry: OutputEntry) => {
    setOutput(prev => [...prev, entry]);
  }, []);

  // ── UI Adapters ──
  // These functions are passed to the business logic so it can trigger UI changes
  // without knowing about React/Ink

  const uiAdapter = {
    // System messages
    printSystemMessage: (type: 'error' | 'warn' | 'guard' | 'info' | 'stop', message: string) => {
      addOutput({ type: 'system', data: { type, message } });
    },

    // Tool results
    printToolResult: (status: 'success' | 'failure' | 'skipped', message: string) => {
      addOutput({ type: 'tool-result', data: { status, message } });
    },

    // Interactive select (returns a promise)
    interactiveSelect: (title: string, options: string[]): Promise<number> => {
      return new Promise((resolve) => {
        setScreen('select');
        setSelectMenuProps({ title, options, resolve });
      });
    },

    interactiveInput: (title: string, placeholder?: string): Promise<string> => {
      return new Promise((resolve) => {
        setScreen('input');
        setInteractiveInputProps({ title, placeholder, resolve });
      });
    },

    // Confirm write (returns a promise)
    interactiveConfirmWrite: (
      filePath: string,
      lineCount: number,
      actionVerb: 'write' | 'create' | 'modify' | 'delete'
    ): Promise<'y' | 'n' | 'p'> => {
      return new Promise((resolve) => {
        setScreen('confirm');
        setConfirmWriteProps({ filePath, lineCount, actionVerb, resolve });
      });
    },

    // Show diff
    showDiff: (original: string | null, modified: string, language: string, filePath: string) => {
      setDiffViewProps({ original, modified, language, filePath });
    },

    // Streaming control
    startStreaming: () => {
      setStreamText('');
      setIsStreaming(true);
      setSpinnerActive(true);
      setScreen('streaming');
    },

    onStreamChunk: (chunk: string) => {
      setSpinnerActive(false);
      setStreamText(prev => {
        const nextText = prev + chunk;
        const progress = getActiveToolStreamProgress(nextText);
        if (progress) {
          setToolProgressActive(true);
          setToolProgressDetails(progress.details);
        } else {
          setToolProgressActive(false);
          setToolProgressDetails('');
        }
        return nextText;
      });
    },

    endStreaming: () => {
      setIsStreaming(false);
      setSpinnerActive(false);
      setToolProgressActive(false);
      setToolProgressDetails('');
    },

    // Tool progress
    showToolProgress: (details: string) => {
      setToolProgressActive(true);
      setToolProgressDetails(details);
    },

    hideToolProgress: () => {
      setToolProgressActive(false);
      setToolProgressDetails('');
    },

    // Return to prompt
    returnToPrompt: () => {
      setScreen('prompt');
      setDiffViewProps(null);
    },

    // Update status bar
    updateStatus,

    // Exit
    exit: (code: number) => {
      exit();
      process.exit(code);
    },

    // Add raw text output
    addTextOutput: (text: string) => {
      addOutput({ type: 'text', data: text });
    },

    clear: () => {
      console.clear();
      setOutput([]);
    },

    populateHistory: (history: { role: string; content: string }[]) => {
      const entries: OutputEntry[] = [];
      for (const msg of history) {
        if (msg.role === 'user') {
          if (msg.content.startsWith('<tool_output>')) {
            const clean = msg.content.replace('<tool_output>\n', '').replace('\n</tool_output>', '');
            try {
              const parsed = JSON.parse(clean);
              if (parsed.error) {
                entries.push({ type: 'tool-result', data: { status: 'failure', message: parsed.error } });
              } else {
                entries.push({ type: 'tool-result', data: { status: 'success', message: JSON.stringify(parsed) } });
              }
            } catch (e) {
              entries.push({ type: 'tool-result', data: { status: 'success', message: clean } });
            }
          } else {
            entries.push({ type: 'user-input', data: msg.content });
          }
        } else if (msg.role === 'assistant') {
          entries.push({ type: 'model-response', data: { text: msg.content, thinkingEnabled: false } });
        } else if (msg.role === 'tool') {
          try {
            const parsed = JSON.parse(msg.content);
            if (parsed.error) {
              entries.push({ type: 'tool-result', data: { status: 'failure', message: parsed.error } });
            } else {
              entries.push({ type: 'tool-result', data: { status: 'success', message: JSON.stringify(parsed) } });
            }
          } catch (e) {
            entries.push({ type: 'tool-result', data: { status: 'success', message: msg.content } });
          }
        }
      }
      setOutput(entries);
    },

    // Print final completed model response
    printModelResponse: (text: string, thinkingEnabled: boolean) => {
      addOutput({ type: 'model-response', data: { text, thinkingEnabled } });
    }
  };

  // Handle user input submission
  const handleSubmit = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Echo user input
    addOutput({ type: 'user-input', data: input });

    // Delegate to business logic
    await services.handleInput(trimmed, uiAdapter);
  }, [services, uiAdapter]);

  useEffect(() => {
    if (services.nonInteractivePrompt && !autoSubmitted.current) {
      autoSubmitted.current = true;
      handleSubmit(services.nonInteractivePrompt);
    }
  }, [services.nonInteractivePrompt, handleSubmit]);

  // Handle select menu choice
  const handleSelect = useCallback((index: number) => {
    if (selectMenuProps) {
      selectMenuProps.resolve(index);
      setSelectMenuProps(null);
      setScreen('prompt');
    }
  }, [selectMenuProps]);

  // Handle confirm write choice
  const handleConfirmChoice = useCallback((choice: 'y' | 'n' | 'p') => {
    if (confirmWriteProps) {
      confirmWriteProps.resolve(choice);
      setConfirmWriteProps(null);
      setScreen('prompt');
    }
  }, [confirmWriteProps]);

  // Handle interactive text input submit
  const handleInputValueSubmit = useCallback((val: string) => {
    if (interactiveInputProps) {
      interactiveInputProps.resolve(val);
      setInteractiveInputProps(null);
      setScreen('prompt');
    }
  }, [interactiveInputProps]);

  // ── Render ──
  if (overlayContent) {
    return (
      <FullscreenOverlay
        title={overlayContent.title}
        content={overlayContent.content}
        onClose={() => setOverlayContent(null)}
      />
    );
  }

  return (
    <Box flexDirection="column" paddingX={2}>
      {/* Welcome Banner */}
      {welcomeShown && (
        <WelcomeBanner
          workspaceRoot={services.workspaceRoot}
          modelName={statusModel}
          contextLimit={services.contextLimit}
          fileCount={services.filesCount}
          gitBranch={services.gitBranch}
          projectType={services.projectType}
          latestSession={services.latestSession}
        />
      )}

      {/* Output History */}
      {output.map((entry, i) => {
        if (entry.type === 'system') {
          return (
            <Box key={i} marginTop={1}>
              <SystemMessage type={entry.data.type} message={entry.data.message} />
            </Box>
          );
        }
        if (entry.type === 'tool-result') {
          const prevEntry = i > 0 ? output[i - 1] : null;
          const isFirstInSequence = !prevEntry || (prevEntry.type !== 'tool-result' && prevEntry.type !== 'model-response');
          return (
            <Box key={i} marginTop={isFirstInSequence ? 1 : 0}>
              <ToolResult status={entry.data.status} message={entry.data.message} />
            </Box>
          );
        }
        if (entry.type === 'user-input') {
          const cols = stdout?.columns || 80;
          // Account for root paddingX={2} and marginLeft={2}: width is cols - 8
          const width = Math.max(40, cols - 8);
          const paddingLine = ' '.repeat(width);
          const contentLine = `  ${entry.data}`.padEnd(width);
          const turnDivider = '─'.repeat(width);
          return (
            <Box key={i} flexDirection="column" marginTop={1} marginBottom={1}>
              {i > 0 && (
                <Box marginBottom={1}>
                  <Text color="#334155">{turnDivider}</Text>
                </Box>
              )}
              <Box 
                flexDirection="column"
                width={width}
                marginLeft={2}
              >
                <Text backgroundColor="#374151" color="#FFFFFF" bold>
                  {paddingLine}
                  {'\n'}
                  {contentLine}
                  {'\n'}
                  {paddingLine}
                </Text>
              </Box>
            </Box>
          );
        }
        if (entry.type === 'model-response') {
          return (
            <ChatStream
              key={i}
              text={entry.data.text}
              isStreaming={false}
              thinkingEnabled={entry.data.thinkingEnabled}
              showThinking={showThinking}
              onTruncated={registerTruncated}
            />
          );
        }
        if (entry.type === 'text') {
          return (
            <Box key={i} marginTop={1} marginLeft={2}>
              <Text>{entry.data}</Text>
            </Box>
          );
        }
        return null;
      })}

      {/* Diff View (shown inline when previewing) */}
      {diffViewProps && (
        <DiffView
          original={diffViewProps.original}
          modified={diffViewProps.modified}
          language={diffViewProps.language}
          filePath={diffViewProps.filePath}
          onTruncated={registerTruncated}
        />
      )}

      {/* Streaming AI Response */}
      {screen === 'streaming' && (
        <Box flexDirection="column">
          <ChatStream
            text={streamText}
            isStreaming={isStreaming}
            thinkingEnabled={services.thinkingEnabled}
            showThinking={showThinking}
            onTruncated={registerTruncated}
          />
          <ToolProgress active={toolProgressActive} details={toolProgressDetails} />
        </Box>
      )}

      {/* Select Menu Modal */}
      {screen === 'select' && selectMenuProps && (
        <SelectMenu
          title={selectMenuProps.title}
          options={selectMenuProps.options}
          onSelect={handleSelect}
        />
      )}

      {/* Confirm Write Modal */}
      {screen === 'confirm' && confirmWriteProps && (
        <ConfirmWrite
          filePath={confirmWriteProps.filePath}
          lineCount={confirmWriteProps.lineCount}
          actionVerb={confirmWriteProps.actionVerb}
          onChoice={handleConfirmChoice}
        />
      )}

      {/* Interactive Text Input Modal */}
      {screen === 'input' && interactiveInputProps && (
        <InteractiveInput
          title={interactiveInputProps.title}
          placeholder={interactiveInputProps.placeholder}
          onSubmit={handleInputValueSubmit}
        />
      )}

      {/* Input Prompt */}
      {(screen === 'prompt' || screen === 'streaming') && (
        <Box marginTop={1}>
          <PromptInput
            onSubmit={handleSubmit}
            disabled={screen === 'streaming'}
            status={{
              model: statusModel,
              contextPct: statusContext,
              branch: statusBranch
            }}
          />
        </Box>
      )}
    </Box>
  );
}
