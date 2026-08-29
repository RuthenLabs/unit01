import { CodeIndexer } from '@unit01/core/indexer/index.js';
import { ExecutionGuard } from '@unit01/core/security/guard.js';
import { SessionStore, SessionData } from '@unit01/core/session/index.js';
import { UiAdapter } from '../types.js';
import { CliState } from '../tools/types.js';

export interface SlashContext {
  workspaceRoot: string;
  indexer: CodeIndexer;
  guard: ExecutionGuard;
  ui: UiAdapter;
  state: CliState;
  sessionStore: SessionStore;
  sessionId: string;
  sessionStartTime: number;
  conversationHistory: { role: string; content: string }[];
  activeModel: string;
  setActiveModel: (model: string) => void;
  activePersonality: string;
  setActivePersonality: (p: string) => void;
  userContextLimit: number;
  modelContextWindow: number;
  lastInputTokens: number;
  setLastInputTokens: (t: number) => void;
  setSessionId: (id: string) => void;
  runCompaction: (ui: UiAdapter, notifyOnly?: boolean) => Promise<void>;
  resumeSession: (ui: UiAdapter, session: SessionData) => Promise<void>;
  recalcContextAndRender?: () => void;
  activeAbortController: AbortController | null;
  setActiveAbortController: (ac: AbortController | null) => void;
}
