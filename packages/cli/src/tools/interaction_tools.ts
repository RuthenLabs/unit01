import * as path from 'path';
import * as os from 'os';
import { UiAdapter } from '../types.js';
import { themePrimary, isGui, guiEmit } from '../views/theme.js';
import { parseAskUser, parseQuestion } from '../parser.js';
import { ToolContext, ToolResult } from './types.js';

export async function handleAskUser(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const askUserResult = parseAskUser(text);
  if (askUserResult === null) return null;

  const { ui, state, guard } = ctx;
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
      guard.updateAllowedPaths(state.activeAllowedPaths);
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
      guard.updateAllowedPaths(state.activeAllowedPaths);
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

export async function handleQuestion(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const questionResult = parseQuestion(text);
  if (questionResult === null) return null;

  const { ui, state } = ctx;
  const { question, options } = questionResult;

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
  return {
    toolRun: true,
    nextPrompt: `<tool_output>\n${JSON.stringify({
      choice,
      message: `User chose: ${choice}`
    })}\n</tool_output>`,
    consoleOutput: `\n[User choice: ${choice}]`
  };
}
