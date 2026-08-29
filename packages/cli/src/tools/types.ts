import * as path from 'path';
import * as os from 'os';
import { isPro } from '@unit01/core/tier.js';
import { CodeIndexer } from '@unit01/core/indexer/index.js';
import { ExecutionGuard } from '@unit01/core/security/guard.js';
import { AllowedPath } from '@unit01/core/security/types.js';
import { UiAdapter } from '../types.js';
import { themePrimary, isGui, guiEmit } from '../views/theme.js';

export interface CliState {
  lastWrittenFile: {
    filePath: string;
    original: string | null;
    content: string;
  } | null;
  activeAllowedPaths: AllowedPath[];
  isNonInteractive: boolean;
}

export interface ToolResult {
  toolRun: boolean;
  nextPrompt: string;
  consoleOutput: string;
}

export interface ToolContext {
  guard: ExecutionGuard;
  indexer: CodeIndexer;
  ui: UiAdapter;
  state: CliState;
  fileReadCache?: Map<string, string>;
}

export function resolvePath(workspaceRoot: string, pathVal: string): string {
  if (!isPro()) {
    return path.resolve(workspaceRoot, pathVal);
  }
  let resolved = pathVal;
  if (pathVal.startsWith('~/')) {
    resolved = path.join(os.homedir(), pathVal.slice(2));
  } else if (pathVal === '~') {
    resolved = os.homedir();
  } else {
    resolved = path.resolve(workspaceRoot, pathVal);
  }
  return path.resolve(resolved);
}

export async function requestPathAccess(
  absPath: string,
  mode: 'ro' | 'rw',
  ui: UiAdapter,
  state: CliState,
  guard: ExecutionGuard
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
    guard.updateAllowedPaths(state.activeAllowedPaths);
    return true;
  }
  if (choice === 'Allow read-only') {
    if (!state.activeAllowedPaths.some(ap => ap.path === absPath)) {
      state.activeAllowedPaths.push({ path: absPath, mode: 'ro' });
    }
    guard.updateAllowedPaths(state.activeAllowedPaths);
    return true;
  }
  return false;
}
