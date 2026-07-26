/**
 * Shared types for the Unit01 Ink CLI
 */
import type { AllowedPath } from '@unit01/core/security/types.js';

// App screen states
export type AppScreen = 'prompt' | 'streaming' | 'select' | 'confirm' | 'input';

// Output history entries
export type OutputEntry =
  | { type: 'system'; data: { type: 'error' | 'warn' | 'guard' | 'info' | 'stop'; message: string } }
  | { type: 'tool-result'; data: { status: 'success' | 'failure' | 'skipped'; message: string } }
  | { type: 'user-input'; data: string }
  | { type: 'model-response'; data: { text: string; thinkingEnabled: boolean } }
  | { type: 'text'; data: string };

// UI adapter interface — business logic calls these to trigger UI changes
export interface UiAdapter {
  printSystemMessage: (type: 'error' | 'warn' | 'guard' | 'info' | 'stop', message: string) => void;
  printToolResult: (status: 'success' | 'failure' | 'skipped', message: string) => void;
  interactiveSelect: (title: string, options: string[]) => Promise<number>;
  interactiveInput: (title: string, placeholder?: string) => Promise<string>;
  interactiveConfirmWrite: (filePath: string, lineCount: number, actionVerb: 'write' | 'create' | 'modify' | 'delete') => Promise<'y' | 'n' | 'p'>;
  showDiff: (original: string | null, modified: string, language: string, filePath: string) => void;
  startStreaming: () => void;
  onStreamChunk: (chunk: string) => void;
  endStreaming: () => void;
  showToolProgress: (details: string) => void;
  hideToolProgress: () => void;
  returnToPrompt: () => void;
  updateStatus: (model: string, ctx: string, branch: string) => void;
  exit: (code: number) => void;
  addTextOutput: (text: string) => void;
  clear: () => void;
  populateHistory: (history: { role: string; content: string }[]) => void;
  printModelResponse: (text: string, thinkingEnabled: boolean) => void;
}

// Core services passed from bootstrap to the App
export interface CoreServices {
  workspaceRoot: string;
  activeModel: string;
  contextLimit: number;
  filesCount: number;
  gitBranch: string;
  projectType: string | null;
  isFirstRun: boolean;
  thinkingEnabled: boolean;
  latestSession: { relTime: string; label: string } | null;
  nonInteractivePrompt?: string | null;
  abortStreaming: () => void;

  // The main business logic handler
  handleInput: (input: string, ui: UiAdapter) => Promise<void>;
}

// CLI state (shared with commands.ts)
export interface CliState {
  lastWrittenFile: {
    filePath: string;
    original: string | null;
    content: string;
  } | null;
  activeAllowedPaths: AllowedPath[];
  isNonInteractive: boolean;
}
