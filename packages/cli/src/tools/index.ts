import chalk from 'chalk';
import { CodeIndexer } from '@unit01/core/indexer/index.js';
import { ExecutionGuard } from '@unit01/core/security/guard.js';
import { UiAdapter } from '../types.js';
import { validateToolCall } from '../parser.js';
import { CliState, ToolContext, ToolResult, resolvePath, requestPathAccess } from './types.js';
import {
  handleDeleteFile,
  handleMakeDir,
  handleCopyFile,
  handleMoveFile,
  handleReadFile,
  handleWriteFile,
  handlePatchFile,
  handlePatchFileBlocks
} from './file_tools.js';
import {
  handleRunCommand,
  handleGitStatus,
  handleDiagnostics
} from './shell_tools.js';
import {
  handleSearchCode,
  handleListDir,
  handleViewOutline
} from './search_tools.js';
import {
  handleWebSearch,
  handleFetchWebpage
} from './web_tools.js';
import {
  handleAskUser,
  handleQuestion
} from './interaction_tools.js';
import {
  handleMcpTool,
  handleThirdPartyIntegrations
} from './integration_tools.js';

export { CliState, ToolContext, ToolResult, resolvePath, requestPathAccess };

export async function handleToolCalls(
  text: string,
  guard: ExecutionGuard,
  indexer: CodeIndexer,
  ui: UiAdapter,
  state: CliState,
  fileReadCache?: Map<string, string>
): Promise<ToolResult> {
  // Parse and validate all XML/HTML tags
  const openTagRegex = /<([a-zA-Z_][a-zA-Z0-9_\-]*)([^>]*)>/g;
  let match;
  while ((match = openTagRegex.exec(text))) {
    const tagName = match[1];
    const attributesStr = match[2];
    
    const isTool = [
      'run_command', 'read_file', 'write_file', 'search_code', 'web_search', 'fetch_webpage',
      'patch_file', 'patch_file_blocks', 'list_dir', 'git_status', 'diagnostics',
      'move_file', 'think', 'question', 'path_question',
      'delete_file', 'view_outline', 'ask_user', 'make_dir', 'copy_file',
      'mcp_tool', 'github_get_pr', 'github_create_issue', 'github_create_pr', 'github_list_repos', 'github_get_contents', 'github_rename_repo',
      'slack_get_history', 'slack_post_message',
      'linear_get_teams', 'linear_get_issues', 'linear_create_issue',
      'sentry_get_orgs', 'sentry_get_issues', 'sentry_get_issue',
      'discord_get_history', 'discord_post_message',
      'notion_get_page', 'notion_append_blocks',
      'telegram_get_updates', 'telegram_post_message'
    ].includes(tagName);
    
    if (isTool) {
      const errorMsg = validateToolCall(tagName, attributesStr);
      if (errorMsg) {
        console.log(`\n  ${chalk.red('✗')} tool call ${chalk.yellow(`<${tagName}>`)} (blocked: invalid/wrong arguments)`);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${errorMsg}\n</tool_output>`,
          consoleOutput: `\n[Tool call blocked: <${tagName}>]`
        };
      }
    }
  }

  const ctx: ToolContext = {
    guard,
    indexer,
    ui,
    state,
    fileReadCache
  };

  // Run tool handlers in priority order
  const handlers = [
    handleDeleteFile,
    handleMakeDir,
    handleCopyFile,
    handleViewOutline,
    handleAskUser,
    handleRunCommand,
    handleWriteFile,
    handleReadFile,
    handleSearchCode,
    handleWebSearch,
    handleFetchWebpage,
    handlePatchFile,
    handlePatchFileBlocks,
    handleListDir,
    handleGitStatus,
    handleDiagnostics,
    handleMoveFile,
    handleQuestion,
    handleMcpTool,
    handleThirdPartyIntegrations
  ];

  for (const handler of handlers) {
    const res = await handler(text, ctx);
    if (res !== null) {
      return res;
    }
  }

  return { toolRun: false, nextPrompt: '', consoleOutput: '' };
}
