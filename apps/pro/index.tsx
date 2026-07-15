#!/usr/bin/env -S node --no-warnings
import '../../src/core/warnings.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { render } from 'ink';
import React from 'react';

import { DirectiveIndexer } from '../../src/core/indexer/index.js';
import { DirectiveSandbox, redactSecrets } from '../../src/core/security/sandbox.js';
import { ollama } from '../../src/core/llm/client.js';
import { buildRepoMap } from '../../src/core/indexer/repomap.js';
import { AllowedPath } from '../../src/core/security/types.js';
import { SessionStore, SessionData, runStalenessCheck } from '../../src/core/session/index.js';
import { handleToolCalls } from './commands.js';
import { ProjectMemoryStore } from '../../src/pro/memory/index.js';
import { AuditLogStore } from '../../src/pro/audit/index.js';
import {
  themePrimary,
  themeOrange,
  themeAccent,
  themeBorder,
  themeGray,
  themeRed,
  isGui,
  guiEmit
} from '../../src/cli/views/theme.js';
import { getLanguageFromFilename } from '../../src/cli/parser.js';
import { App } from '../../src/cli/app.js';
import { CoreServices, UiAdapter, CliState } from '../../src/cli/types.js';

const PERSONALITY_TONES: Record<string, { label: string; instruction: string }> = {
  vanilla: {
    label: 'Vanilla (Standard Professional)',
    instruction: 'Voice/Tone: Maintain a standard, helpful, and professional coding assistant tone. Keep explanations clear, concise, and focused on the codebase.'
  },
  homie: {
    label: 'The Homie (Street-Smart/Hood)',
    instruction: 'Voice/Tone: Talk like a supportive friend from the hood. Use informal language, call the user "cuh", prioritize the grind, and keep it encouraging.'
  },
  savage: {
    label: 'The Savage Senior (Cynical Lead)',
    instruction: 'Voice/Tone: Act like a cynical, grumpy senior developer. Complain about sloppy code, roast bad style choices slightly, but write perfect, high-performance solutions.'
  },
  zen: {
    label: 'The Zen Monk (Minimalist Architect)',
    instruction: 'Voice/Tone: Speak in a calm, philosophical, and minimalist manner. Use short, wise phrases. Advocate for deleting code, avoiding dependencies, and clean designs.'
  },
  terminator: {
    label: 'The Terminator (Max Speed)',
    instruction: 'Voice/Tone: Act as a pure command-line machine. Write absolutely zero conversational text—output ONLY the required code blocks and XML tool tags.'
  },
  lazy_senior: {
    label: 'The Lazy Senior (YAGNI Minimalist)',
    instruction: 'Voice/Tone: Act as the laziest senior developer in the room. The best code is the code you never wrote. Question if tasks are really needed, reuse existing code/libraries, write minimal solutions, and avoid over-engineering or new dependencies at all costs.'
  }
};

const OLLAMA_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads the complete text content of a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Creates a new file or completely overwrites an existing one.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to create or overwrite.' },
          content: { type: 'string', description: 'The file contents.' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'patch_file',
      description: 'Replaces a single exact string occurrence in an existing file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file.' },
          search: { type: 'string', description: 'Exact string to search for.' },
          replace: { type: 'string', description: 'Replacement string.' }
        },
        required: ['path', 'search', 'replace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'patch_file_blocks',
      description: 'Performs complex multi-block search/replace edits using ORIGINAL/UPDATED markers.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file.' },
          diff: { type: 'string', description: 'Diff block containing ORIGINAL/UPDATED markers.' }
        },
        required: ['path', 'diff']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Deletes a file tracked by shadow backup.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Lists all files and subdirectories under the target directory path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list. Use "." for workspace root.' },
          recursive: { type: 'string', enum: ['true', 'false'], description: 'Recursive list flag.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Searches the codebase for specific text matches.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term query.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Performs an external web query for docs/solutions.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fetch_webpage',
      description: 'Fetches the complete text content of a target URL and returns it in clean Markdown format.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The absolute HTTP or HTTPS URL to fetch.' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Executes a command inside the sandboxed environment (running tests, builds, linting).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command line string to run.' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'view_outline',
      description: 'Retrieves structural class, method, or function outline of a file to save tokens.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Asks the user a clarifying question or requests path mount permissions.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question text.' },
          options: { type: 'string', description: 'Optional comma-separated list of choice options.' }
        },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_file',
      description: 'Renames or moves a file.',
      parameters: {
        type: 'object',
        properties: {
          sourcePath: { type: 'string', description: 'Source path.' },
          destinationPath: { type: 'string', description: 'Destination path.' }
        },
        required: ['sourcePath', 'destinationPath']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Returns the structural git status of the workspace.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'diagnostics',
      description: 'Runs project linter or compiler checks.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Optional compiler check command.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'make_dir',
      description: 'Creates a new empty directory/folder path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the folder to create.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'copy_file',
      description: 'Copies a file from source path to destination path.',
      parameters: {
        type: 'object',
        properties: {
          sourcePath: { type: 'string', description: 'Source file path.' },
          destinationPath: { type: 'string', description: 'Destination file path.' }
        },
        required: ['sourcePath', 'destinationPath']
      }
    }
  }
];

function getToolCallFingerprint(tc: any): string {
  const name = tc.function?.name || '';
  const args = tc.function?.arguments || {};
  const sortedArgs: Record<string, any> = {};
  Object.keys(args).sort().forEach(k => {
    sortedArgs[k] = args[k];
  });
  return `${name}:${JSON.stringify(sortedArgs)}`;
}

function getXmlToolCallFingerprint(text: string): string {
  const match = /<([a-zA-Z_][a-zA-Z0-9_\-]*)([^>]*)>([\s\S]*?)(?:<\/\1>|$)/.exec(text);
  if (match) {
    const name = match[1];
    const attrs = match[2].trim();
    const content = match[3].trim();
    return `xml:${name}:${attrs}:${content}`;
  }
  return '';
}

function formatToolCallToXml(tc: any): string {
  const name = tc.function?.name;
  const args = tc.function?.arguments || {};
  switch (name) {
    case 'read_file':
      return `<read_file>${args.path || args.filePath}</read_file>`;
    case 'write_file':
      return `<write_file path="${args.path || args.filePath}">${args.content || ''}</write_file>`;
    case 'patch_file':
      return `<patch_file path="${args.path || args.filePath}" search="${args.search || ''}" replace="${args.replace || ''}" />`;
    case 'patch_file_blocks':
      return `<patch_file_blocks path="${args.path || args.filePath}">${args.diff || ''}</patch_file_blocks>`;
    case 'delete_file':
      return `<delete_file>${args.path || args.filePath}</delete_file>`;
    case 'list_dir':
      return `<list_dir path="${args.path || '.'}" recursive="${args.recursive || 'false'}" />`;
    case 'search_code':
      return `<search_code>${args.query || ''}</search_code>`;
    case 'web_search':
      return `<web_search>${args.query || ''}</web_search>`;
    case 'fetch_webpage':
      return `<fetch_webpage>${args.url || ''}</fetch_webpage>`;
    case 'run_command':
      return `<run_command>${args.command || ''}</run_command>`;
    case 'view_outline':
      return `<view_outline path="${args.path || ''}" />`;
    case 'ask_user':
      return `<ask_user${args.options ? ` options="${args.options}"` : ''}>${args.question || ''}</ask_user>`;
    case 'move_file':
      return `<move_file source_path="${args.sourcePath || args.source_path}" destination_path="${args.destinationPath || args.destination_path}" />`;
    case 'make_dir':
      return `<make_dir>${args.path || args.filePath}</make_dir>`;
    case 'copy_file':
      return `<copy_file source_path="${args.sourcePath || args.source_path}" destination_path="${args.destinationPath || args.destination_path}" />`;
    case 'git_status':
      return `<git_status />`;
    case 'diagnostics':
      return `<diagnostics${args.command ? ` command="${args.command}"` : ''} />`;
    default:
      return '';
  }
}

const SYSTEM_INSTRUCTIONS = `You are Unit01, a local-first AI coding agent. You act by outputting ONE XML tool tag at a time. You NEVER write explanations, preambles, or conversational text before a tool call. You write the tag and stop.

TOOLS (use exactly as shown — real paths, not placeholders):
<read_file>path</read_file>  (LOCAL filesystem paths only — NEVER pass a URL or GitHub link here; for GitHub file content use github_get_contents)
<write_file path="path">content</write_file>
<patch_file path="path" search="exact" replace="new" />
<patch_file_blocks path="path"><<<<<<< ORIGINAL\nexact\n=======\nnew\n>>>>>>> UPDATED</patch_file_blocks>
<delete_file>path</delete_file>
<make_dir>path</make_dir>
<copy_file source_path="src" destination_path="dst" />
<move_file source_path="src" destination_path="dst" />
<list_dir path="." recursive="false" />
<search_code>query</search_code>
<run_command>command</run_command>
<web_search>query</web_search>
<fetch_webpage>url</fetch_webpage>
<view_outline path="path" />
<git_status />
<diagnostics />
<ask_user options="opt1, opt2">question</ask_user>
<mcp_tool server="server-id" name="tool-name">{"arg": "value"}</mcp_tool>
<github_get_pr owner="owner" repo="repo" number="123" />
<github_list_repos />
<github_get_contents owner="owner" repo="repo" path="path" />
<github_rename_repo owner="owner" repo="repo" new_name="new-name" />
<github_create_issue owner="owner" repo="repo" title="title">body</github_create_issue>
<github_create_pr owner="owner" repo="repo" title="title" head="head" base="base">body</github_create_pr>
<slack_get_history limit="10" /> (channel is optional — omit to auto-use last-used channel; NEVER use placeholder IDs like C123)
<slack_post_message>text</slack_post_message> (channel is optional — omit to auto-use last-used channel; NEVER use placeholder IDs)
<linear_get_teams />
<linear_get_issues team_id="TEAM_ID" limit="10" /> (team_id is optional, defaults to last-used team)
<linear_create_issue team_id="TEAM_ID" title="Bug: login crash" priority="1">description</linear_create_issue> (team_id optional)
<sentry_get_orgs />
<sentry_get_issues org_slug="my-org" project_slug="my-project" limit="10" /> (org_slug optional, defaults to last-used org)
<sentry_get_issue issue_id="12345678" />
<notion_get_page page_id="id" />
<notion_append_blocks block_id="id">JSON_array_children</notion_append_blocks>

RULES:
- One tool per response. Output the tag, then stop. Never explain before calling a tool.
- Use patch_file_blocks to edit existing files. Use write_file only for new files.
- Use make_dir for folders. Never use mkdir/cp/mv/rm in run_command.
- Use move_file to rename/move. Use copy_file to copy. Use delete_file to delete.
- When creating files, check [Repo Map] under [Directories] and ensure you place the file inside the correct subdirectory (e.g. write_file path="website/index.html"). Never default to the root workspace.
- Implement ONE file per turn: after writing a file, do NOT output another tool tag. Instead, describe what you did in chat and ask the user for permission to write the next file.
- Always wrap code snippets in your chat response inside fenced code blocks (using \`\`\`lang) so they format correctly with rounded borders.
- Use ask_user ONLY to request external path access (using options="Allow read-write, Allow read-only, Deny"). For all regular conversational questions, clarifications, or inputs, output them directly as plain text in your chat response. Do NOT call the ask_user tool for conversational questions.
- For tasks outside workspace: try access first, if PATH_NOT_ALLOWED use ask_user to request permission.
- Before writing new apps/features: present a plan in chat, wait for approval, then implement one file per turn.
- Never call file-writing or editing tools (like write_file, patch_file_blocks, or patch_file) unless the user explicitly requests to create, save, edit, or write to a file (e.g. specifying a filename, path, or explicitly asking to save/modify/create a file). For all other requests, explanations, and code examples, output them directly in the chat response text without calling any tools.
- For mcp_tool: use the exact server ID and tool name as listed in [MCP Tools]. Pass arguments as a JSON object inside the tag.
- Use web_search to find relevant URLs and brief snippets on a topic. Use fetch_webpage to load the full text/markdown content of a specific URL you want to read. Do not attempt to read full webpage content from web_search results.
- Always output the closing tag for all tools (e.g., </web_search>, </fetch_webpage>, or </read_file>). Never stop generating mid-tag.
- Write raw values inside XML tags. For example, for web_search, write the raw query (e.g., <web_search>latest openai news</web_search>). Do NOT prefix the value with "query:" or any other labels.
- NEVER re-call a tool whose output already appears in the conversation history. If data was fetched (e.g. github_list_repos, slack_get_history), read it from context and answer directly.
- NEVER tell the user to run /connect for a service if a tool call for that service already returned data in this session. Trust the tool results in history.
- read_file is for LOCAL files only. Never pass a URL, GitHub link, or any http:// path to read_file. Use fetch_webpage for URLs, github_get_contents for GitHub file content.`;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getGitBranch(workspaceRoot: string): string {
  try {
    return execSync('git branch --show-current', { cwd: workspaceRoot, stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    return 'main';
  }
}

function detectProjectType(workspaceRoot: string): string | null {
  if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) return 'Node.js';
  if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) return 'Rust';
  if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) return 'Go';
  if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml'))) return 'Python';
  if (fs.existsSync(path.join(workspaceRoot, 'setup.py'))) return 'Python';
  if (fs.existsSync(path.join(workspaceRoot, 'Gemfile'))) return 'Ruby';
  if (fs.existsSync(path.join(workspaceRoot, 'CMakeLists.txt'))) return 'C/C++';
  if (fs.existsSync(path.join(workspaceRoot, 'composer.json'))) return 'PHP';
  return null;
}

function detectTestCommand(workspaceRoot: string): string {
  if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
    return 'cargo test';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
    return 'go test ./...';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8'));
      if (pkg.scripts?.test) {
        if (fs.existsSync(path.join(workspaceRoot, 'bun.lockb')) || fs.existsSync(path.join(workspaceRoot, 'bun.lock'))) {
          return 'bun test';
        }
        if (fs.existsSync(path.join(workspaceRoot, 'yarn.lock'))) {
          return 'yarn test';
        }
        if (fs.existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
          return 'pnpm test';
        }
        return 'npm test';
      }
    } catch {}
    return 'npm test';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) || 
      fs.existsSync(path.join(workspaceRoot, 'requirements.txt')) ||
      fs.existsSync(path.join(workspaceRoot, 'setup.py'))) {
    return 'pytest';
  }
  return 'npm test'; // Default fallback
}

function sendDesktopNotification(title: string, message: string) {
  try {
    const { exec } = require('child_process');
    const cleanTitle = title.replace(/['"]/g, '');
    const cleanMessage = message.replace(/['"]/g, '');
    
    if (process.platform === 'darwin') {
      exec(`osascript -e 'display notification "${cleanMessage}" with title "${cleanTitle}"'`);
    } else if (process.platform === 'linux') {
      exec(`notify-send "${cleanTitle}" "${cleanMessage}"`);
    }
  } catch {}
}

interface Unit01Config {
  allowed_paths?: AllowedPath[];
  compact_threshold?: number;
  test_command?: string;
  personality?: string;
  strict_sandbox?: boolean;
  context_limit?: number; // Optional: override Ollama's VRAM-aware default (e.g. 8192, 32768)
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

function hasRepetitionLoop(text: string): boolean {
  // Strip <think>...</think> blocks before checking — small models repeat phrases inside think blocks naturally
  const strippedText = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*/g, '');
  const len = strippedText.length;
  const minSequenceSize = 20;
  const maxChunkSize = Math.min(200, Math.floor(len / 3));

  if (len < minSequenceSize * 3) {
    return false;
  }

  for (let size = minSequenceSize; size <= maxChunkSize; size++) {
    const chunk3 = strippedText.slice(-size);
    const chunk2 = strippedText.slice(-2 * size, -size);
    const chunk1 = strippedText.slice(-3 * size, -2 * size);
    if (chunk1 === chunk2 && chunk2 === chunk3) {
      const lettersCount = (chunk3.match(/[a-zA-Z]/g) || []).length;
      const uniqueChars = new Set(chunk3).size;

      if (uniqueChars >= 5 && lettersCount / size >= 0.35) {
        return true;
      }
    }
  }

  const lines = strippedText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length >= 5) {
    const last5 = lines.slice(-5);
    const first = last5[0];
    const allMatch = last5.every(l => l === first);
    if (allMatch) {
      const uniqueChars = new Set(first).size;
      const lettersCount = (first.match(/[a-zA-Z]/g) || []).length;
      if (first.length >= 8 && uniqueChars >= 4 && lettersCount >= 3) {
        return true;
      }
    }
  }
  return false;
}

function cleanModelResponse(text: string): string {
  // Strip markdown code fences wrapping XML tags (common with small models like deepseek-r1:1.5b)
  let cleaned = text.replace(/```(?:xml|json|html|plaintext|text)?\s*([\s\S]*?)```/gi, '$1').trim();
  
  // Fix common malformed tags (e.g. <file path="foo"> -> <write_file path="foo">)
  cleaned = cleaned.replace(/(?:^|\s|<)file\s+([^>]+)>/gi, '<write_file $1>');
  cleaned = cleaned.replace(/<\/file>/gi, '</write_file>');

  // Fix missing opening '<' in write_file/patch_file/etc tags, e.g. write_file path="foo"> -> <write_file path="foo">
  cleaned = cleaned.replace(/(?:^|\s)(write_file|patch_file|patch_file_blocks|read_file|delete_file|run_command|make_dir|copy_file|move_file|view_outline)\s+([^>]+)>/gi, '<$1 $2>');

  return cleaned;
}

function compressSourceCode(filePath: string, content: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split(/\r?\n/);
  
  // Supported coding extensions for structural outline
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

async function main() {
  const workspaceRoot = process.cwd();

  // Parse args
  const args = process.argv.slice(2);
  let activeModelArg: string | null = null;
  let nonInteractivePrompt: string | null = null;
  const cliAllowedPaths: AllowedPath[] = [];
  let continueSession = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && i + 1 < args.length) {
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
      continueSession = true;
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

  // modelContextWindow: the model's max architecture limit — used for display and compaction ratio only.
  // Never sent to Ollama as num_ctx (that would override its VRAM-aware default).
  let modelContextWindow = await ollama.getContextLimit(activeModel);

  const config = loadConfig(workspaceRoot);
  let activePersonality = config.personality || 'vanilla';
  // userContextLimit: only set if the user explicitly configured context_limit in unit01.json.
  // 0 = unset = let Ollama decide based on available VRAM.
  const userContextLimit: number = config.context_limit ?? 0;
  const rawAllowed = [...(config.allowed_paths || []), ...cliAllowedPaths];
  const resolvedAllowedPaths: AllowedPath[] = [];
  for (const item of rawAllowed) {
    let resolvedPath = item.path;
    if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
      resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
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

  let compactThreshold = 0.8;
  if (config.compact_threshold !== undefined) {
    compactThreshold = config.compact_threshold;
  }

  let sessionId: string = crypto.randomUUID();
  let autopilotEnabled = false;
  const sessionStartTime = Date.now();
  let lastInputTokens = 0;
  let pendingCompaction = false;
  const conversationHistory: any[] = [];
  const fileReadCache = new Map<string, string>();

  // Loop detection: tracks consecutive repeat counts per fingerprint
  // A loop is only declared after the SAME fingerprint fires 3 times in a row
  const recentToolCallsFingerprints: string[] = [];
  const fingerprintConsecutiveCounts = new Map<string, number>();
  const MAX_FINGERPRINTS = 20;
  const LOOP_TRIGGER_COUNT = 2; // Block duplicate tool calls on 2nd consecutive identical call (not 3rd)
  let useNativeTools = false;
  // Enforce XML tags exclusively as Ollama's native tool parsing is unstable and causes empty/silent failures on first turns
  /*
  try {
    useNativeTools = await ollama.checkModelToolsCapability(activeModel);
  } catch (e) {}
  */

  let modelSupportsThinking = false;
  try {
    modelSupportsThinking = await ollama.checkModelThinkingCapability(activeModel);
  } catch (e) {}
  let thinkingEnabled = modelSupportsThinking;

  const indexer = new DirectiveIndexer(workspaceRoot);
  await indexer.initialize({ silent: true });

  const memoryStore = new ProjectMemoryStore(indexer.db);

  try {
    const { indexMissingEmbeddings } = await import('../../src/pro/search/index.js');
    await indexMissingEmbeddings(indexer.db, true);
  } catch (e) {}

  // Boot MCP servers silently in the background
  try {
    const { McpClientManager } = await import('../../src/core/mcp/client.js');
    McpClientManager.getInstance().initialize(true).catch(() => {});
  } catch (e) {}

  const filesCount = indexer.db.getAllFiles().length;

  const sandbox = new DirectiveSandbox(
    workspaceRoot,
    state.activeAllowedPaths,
    () => {},
    config.strict_sandbox || false
  );
  await sandbox.initialize([], { silent: true });

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

  const runCompaction = async (ui: UiAdapter, isAuto: boolean): Promise<boolean> => {
    if (conversationHistory.length < 4) return false;

    const activeRepoMap = indexer.getRepoMap();
    const activeChanges = indexer.getRecentChanges();
    const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
    const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
    const pct = Math.round((totalTokens / modelContextWindow) * 100);

    // ── Task Checkpoint Strategy ─────────────────────────────────────────────
    // Always keep the last 6 messages verbatim (last 3 turns of back-and-forth)
    // so the model always has sharp working memory of what it was just doing.
    // Only messages OLDER than that get compressed into the checkpoint block.
    const VERBATIM_KEEP = 6;
    const recentMessages = conversationHistory.slice(-VERBATIM_KEEP);
    const messagesToSummarize = conversationHistory.slice(0, -VERBATIM_KEEP);

    // If there is nothing old enough to summarise, nothing to do
    if (messagesToSummarize.length === 0) return false;

    // Build the structured summary prompt
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
          userContextLimit > 0 ? userContextLimit : modelContextWindow,
          () => {},
          activeAbortController.signal
        );
        activeAbortController = null;

      const contentText = chatResult.content;

      // Extract structured fields
      const taskStateMatch = /<task_state>([\s\S]*?)<\/task_state>/.exec(contentText);
      const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(contentText);
      const summaryContent = summaryMatch ? summaryMatch[1].trim() : contentText.trim();

      if (!summaryContent) throw new Error('Empty checkpoint summary');

      // Persist decisions to SQLite
      const decisionsMatch = /<decisions>([\s\S]*?)<\/decisions>/.exec(contentText);
      if (decisionsMatch) {
        const lines = decisionsMatch[1].split('\n');
        for (const line of lines) {
          const match = /-\s*\[(database|auth|styles|conventions|other)\]\s*(.*?)\s*\(Rationale:\s*(.*?)\)/i.exec(line);
          if (match) {
            const [, category, summary, rationale] = match;
            try {
              memoryStore.logDecision({
                category: category.toLowerCase() as any,
                summary: summary.trim(),
                rationale: rationale.trim(),
                context_files: []
              });
            } catch (e) {}
          }
        }
      }

      // Persist conventions to SQLite
      const conventionsMatch = /<conventions>([\s\S]*?)<\/conventions>/.exec(contentText);
      if (conventionsMatch) {
        const lines = conventionsMatch[1].split('\n');
        for (const line of lines) {
          const match = /-\s*\[(.*?)\]:\s*"(.*?)"/.exec(line);
          if (match) {
            const [, key, pattern] = match;
            try {
              memoryStore.upsertConvention(key.trim(), pattern.trim());
            } catch (e) {}
          }
        }
      }

      // ── Build the Task Checkpoint block ────────────────────────────────────
      // Pull real file change data directly from indexer (hard facts, not model memory)
      const recentChangesBlock = activeChanges
        ? `\n\n[Files changed this session]\n${activeChanges}`
        : '';

      // Re-inject SQLite project memory so conventions are never lost after checkpoint
      const memoryBlock = memoryStore.generateMemoryContextBlock();

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

      // ── Replace history: checkpoint + last 6 messages verbatim ─────────────
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

    // Re-inject SQLite project memory so conventions and past decisions
    // are immediately available when resuming — not lost between sessions
    const memoryBlock = memoryStore.generateMemoryContextBlock();
    if (memoryBlock) {
      conversationHistory.unshift({
        role: 'system',
        content: `[SESSION RESUMED — project memory restored]\n${memoryBlock}`
      });
    }

    ui.printSystemMessage('info', `Resumed session successfully.`);
  };

  let activeAbortController: AbortController | null = null;

  // The main handleInput orchestrator
  const handleInput = async (input: string, ui: UiAdapter) => {
    try {
      await handleInputInternal(input, ui);
      // Auto-save session after processing a user turn
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
        try { sandbox.stop(); } catch (e) {}
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

      if (command === '/exit' || command === '/quit') {
        if (conversationHistory.length > 0) {
          sessionStore.save(sessionId, {
            startedAt: sessionStartTime,
            activeModel,
            conversationHistory
          });
        }
        indexer.close();
        sandbox.stop();
        ui.exit(0);
        return;
      }

      if (command === '/clear') {
        conversationHistory.length = 0;
        lastInputTokens = 0;
        sessionId = crypto.randomUUID(); // Start new session
        ui.clear();
        ui.printSystemMessage('info', 'Conversation history cleared.');
        return;
      }

      if (command === '/compact') {
        await runCompaction(ui, false);
        return;
      }



      if (command === '/overkill') {
        const activeChanges = indexer.getRecentChanges();
        if (!activeChanges) {
          ui.printSystemMessage('info', 'No code changes detected in this session yet to audit.');
          return;
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
          activeAbortController = new AbortController();
          const chatResult = await ollama.chatStream(
            activeModel,
            payload,
            userContextLimit > 0 ? userContextLimit : modelContextWindow,
            (chunk) => {
              ui.onStreamChunk(chunk);
            },
            activeAbortController.signal
          );
          activeAbortController = null;
          ui.endStreaming();
        } catch (err: any) {
          ui.endStreaming();
          ui.printSystemMessage('error', `Overkill audit failed: ${err.message}`);
        }
        return;
      }

      if (command === '/sessions') {
        const sessions = sessionStore.list(workspaceRoot).filter(s => s.id !== sessionId);
        if (sessions.length === 0) {
          ui.printSystemMessage('info', 'No previous sessions found.');
          return;
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
        return;
      }

      if (command === '/preview') {
        if (state.lastWrittenFile) {
          ui.showDiff(state.lastWrittenFile.original, state.lastWrittenFile.content, getLanguageFromFilename(state.lastWrittenFile.filePath), state.lastWrittenFile.filePath);
        } else {
          ui.printSystemMessage('info', 'No files modified in this session yet.');
        }
        return;
      }

      if (command === '/diff') {
        const { execSync } = await import('child_process');
        let rawDiff = '';
        try {
          rawDiff = execSync('git diff HEAD', { cwd: workspaceRoot, encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] });
        } catch {
          try {
            rawDiff = execSync('git diff', { cwd: workspaceRoot, encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] });
          } catch {
            ui.printSystemMessage('info', 'No git repository found or no changes to show.');
            return;
          }
        }

        if (!rawDiff.trim()) {
          ui.printSystemMessage('info', 'No changes since last commit. Workspace is clean.');
          return;
        }

        // Parse unified diff
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
          } else if (currentBlock && !rawLine.startsWith('index ') && !rawLine.startsWith('---') && !rawLine.startsWith('+++') && !rawLine.startsWith('Binary')) {
            currentBlock.lines.push(rawLine);
            if (rawLine.startsWith('+') && !rawLine.startsWith('+++')) totalAdded++;
            if (rawLine.startsWith('-') && !rawLine.startsWith('---')) totalRemoved++;
          }
        }
        if (currentBlock) fileBlocks.push(currentBlock);

        const divider = themeBorder('────────────────────────────────────────');
        const header  = chalk.hex('#C084FC')('◈ unit01  ·  session diff');
        const summary = chalk.hex('#64748B')(
          `${filesChanged} file${filesChanged !== 1 ? 's' : ''} changed  ·  ` +
          chalk.hex('#10B981')(`+${totalAdded} insertion${totalAdded !== 1 ? 's' : ''}`) + '  ·  ' +
          chalk.hex('#F87171')(`-${totalRemoved} deletion${totalRemoved !== 1 ? 's' : ''}`)
        );

        const outputLines: string[] = [
          '',
          `  ${divider}`,
          `  ${header}`,
          `  ${divider}`,
          `  ${summary}`,
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
        return;
      }

      if (command === '/status') {
        const activeRepoMap = indexer.getRepoMap();
        const activeChanges = indexer.getRecentChanges();
        const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
        const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
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

        const { isServiceConnected } = await import('../../src/core/tier.js');

        const integrationList = [
          { id: 'github',  label: 'GitHub'  },
          { id: 'slack',   label: 'Slack'   },
          { id: 'linear',  label: 'Linear'  },
          { id: 'sentry',  label: 'Sentry'  },
          { id: 'notion',  label: 'Notion'  },
          { id: 'tavily',  label: 'Tavily'  },
          { id: 'brave',   label: 'Brave'   },
          { id: 'exa',     label: 'Exa'     },
          { id: 'jina',    label: 'Jina'    },
          { id: 'serper',  label: 'Serper'  },
        ];

        const connectedLabel   = chalk.hex('#10B981')('● connected');
        const disconnectedLabel = chalk.hex('#475569')('○ not connected');

        const integrationLines = integrationList.map(svc => {
          const status = isServiceConnected(svc.id) ? connectedLabel : disconnectedLabel;
          return `  ${chalk.hex('#64748B')(svc.label.padEnd(11))}${status}`;
        });

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
          '',
          `  ${themeBorder('──  integrations  ──────────────────────')}`,
          ...integrationLines,
          ''
        ].join('\n');

        ui.addTextOutput(out);
        return;
      }


      if (command === '/usage') {
        const activeRepoMap = indexer.getRepoMap();
        const activeChanges = indexer.getRecentChanges();
        const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
        const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
        const ratioPct = Math.round(Math.min(totalTokens / modelContextWindow, 1.0) * 100);

        const headerLine = chalk.hex('#C084FC')('◈ unit01  ·  context window');
        const divider = themeBorder('────────────────────────────────────────');

        let fillColor = '#F59E0B'; // gold
        if (ratioPct >= 60 && ratioPct < 80) {
          fillColor = '#D97706'; // amber
        } else if (ratioPct >= 80) {
          fillColor = '#F87171'; // rose
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
        return;
      }

      if (command === '/help') {
        const headerLine = chalk.hex('#C084FC')('◈ unit01  ·  help');
        const divider = themeBorder('────────────────────────────────────────');

        const helpItems = [
          { cmd: '/audit',       desc: 'view recent activity audit logs' },
          { cmd: '/autopilot',   desc: 'toggle autopilot mode (plan-code-test-heal loop)' },
          { cmd: '/changes',     desc: 'show recent file changes in the session' },
          { cmd: '/clear',       desc: 'clear conversation history' },
          { cmd: '/compact',     desc: 'save task checkpoint to compact history' },
          { cmd: '/connect',     desc: 'manage integrations (GitHub, Slack, etc.)' },
          { cmd: '/exit, /quit', desc: 'exit the CLI' },
          { cmd: '/export',      desc: 'export session transcript to Markdown' },
          { cmd: '/files',       desc: 'list all indexed files' },
          { cmd: '/help',        desc: 'show this menu' },
          { cmd: '/mcp',         desc: 'manage MCP servers (add, reload, remove)' },
          { cmd: '/models',      desc: 'switch the active model' },
          { cmd: '/overkill',    desc: 'run overkill audit on recent changes' },
          { cmd: '/personality', desc: 'switch assistant personality / tone' },
          { cmd: '/preview',     desc: 'preview last file changes (diff format)' },
          { cmd: '/reindex',     desc: 're-scan workspace and rebuild file index' },
          { cmd: '/reset-password', desc: 'reset the master password of the credentials vault' },
          { cmd: '/search',      desc: 'search codebase  |  /search <provider> (web search)  |  /search limit <N> (result limit)' },
          { cmd: '/sessions',    desc: 'browse and manage saved sessions' },
          { cmd: '/diff',        desc: 'show a colored diff of all session changes' },
          { cmd: '/status',      desc: 'show system status info' },
          { cmd: '/thinking',    desc: 'toggle model reasoning blocks' },
          { cmd: '/undo',        desc: 'revert the last file write' },
          { cmd: '/usage',       desc: 'show context window token usage' }
        ];

        const out = [
          '',
          `  ${divider}`,
          `  ${headerLine}`,
          `  ${divider}`,
          ...helpItems.map(item => {
            const cmdColored = chalk.hex('#C084FC')(item.cmd.padEnd(16));
            const descColored = chalk.hex('#64748B')(item.desc);
            return `  ${cmdColored}${descColored}`;
          }),
          ''
        ].join('\n');

        ui.addTextOutput(out);
        return;
      }

      if (command === '/export') {
        if (conversationHistory.length === 0) {
          ui.printSystemMessage('error', 'Nothing to export — conversation history is empty.');
          return;
        }

        const homeDir = os.homedir();
        const sessionDir = path.join(homeDir, 'ruthen-sessions');

        // Ensure ruthen-sessions directory exists
        if (!fs.existsSync(sessionDir)) {
          try {
            fs.mkdirSync(sessionDir, { recursive: true });
          } catch (e: any) {
            ui.printSystemMessage('error', `Failed to create sessions directory: ${e.message}`);
          }
        }

        // YYYY-MM-DD
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        // Find first user message (not tool output)
        const firstUserMsg = conversationHistory.find(m => m.role === 'user' && !m.content.includes('<tool_output>'));
        let suffix = '';
        if (firstUserMsg) {
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
            'Yes (Overwrite)',
          ]);

          if (overwriteIdx !== 1) { // 1 is Yes
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

          // XML tags parsing
          const writeAttrRegex = /<write_file\s+(?:relative_)?path=["']([^"']+)["']/g;
          let match;
          while ((match = writeAttrRegex.exec(content)) !== null) {
            addOrMergeFileMod(match[1], 'created', 'write_file');
          }

          const writeTagRegex = /<write_file\s*>([\s\S]*?)(?:<\/write_file>|$)/g;
          while ((match = writeTagRegex.exec(content)) !== null) {
            const lines = match[1].trim().split('\n');
            if (lines.length > 0 && lines[0].trim()) {
              addOrMergeFileMod(lines[0].trim(), 'created', 'write_file');
            }
          }

          const deleteAttrRegex = /<delete_file\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/g;
          while ((match = deleteAttrRegex.exec(content)) !== null) {
            addOrMergeFileMod(match[1], 'deleted', 'delete_file');
          }

          const deleteTagRegex = /<delete_file\s*>([\s\S]*?)(?:<\/delete_file>|$)/g;
          while ((match = deleteTagRegex.exec(content)) !== null) {
            const lines = match[1].trim().split('\n');
            if (lines.length > 0 && lines[0].trim()) {
              addOrMergeFileMod(lines[0].trim(), 'deleted', 'delete_file');
            }
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

          const makeDirTagRegex = /<make_dir\s*>([\s\S]*?)(?:<\/make_dir>|$)/g;
          while ((match = makeDirTagRegex.exec(content)) !== null) {
            const lines = match[1].trim().split('\n');
            if (lines.length > 0 && lines[0].trim()) {
              addOrMergeFileMod(lines[0].trim(), 'created', 'make_dir');
            }
          }

          const copyFileRegex = /<copy_file\s+source_path=["']([^"']+)["']\s+destination_path=["']([^"']+)["']/g;
          while ((match = copyFileRegex.exec(content)) !== null) {
            addOrMergeFileMod(match[2], 'created', 'copy_file');
          }

          // Native tool calls parsing
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              const name = tc.function?.name;
              const args = tc.function?.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {};
              if (name === 'write_file') {
                const filePath = args.filePath || args.path;
                if (filePath) {
                  addOrMergeFileMod(filePath, 'created', name);
                }
              } else if (name === 'delete_file') {
                const filePath = args.filePath || args.path;
                if (filePath) {
                  addOrMergeFileMod(filePath, 'deleted', name);
                }
              } else if (name === 'patch_file' || name === 'patch_file_blocks') {
                const filePath = args.filePath || args.path;
                if (filePath) {
                  addOrMergeFileMod(filePath, 'modified', name);
                }
              } else if (name === 'move_file') {
                const source = args.sourcePath || args.source;
                if (source) {
                  addOrMergeFileMod(source, 'moved', name);
                }
              } else if (name === 'make_dir') {
                const pathVal = args.path || args.filePath;
                if (pathVal) {
                  addOrMergeFileMod(pathVal, 'created', name);
                }
              } else if (name === 'copy_file') {
                const dest = args.destinationPath || args.destination_path || args.to;
                if (dest) {
                  addOrMergeFileMod(dest, 'created', name);
                }
              }
            }
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

        const commandsRun: { command: string; outcome: string }[] = [];
        for (let i = 0; i < conversationHistory.length; i++) {
          const msg = conversationHistory[i];
          if (msg.role !== 'assistant') continue;

          // XML style parsing
          const content = msg.content || '';
          const runRegex = /<run_command\s*>([\s\S]*?)<\/run_command>/g;
          let match;
          while ((match = runRegex.exec(content)) !== null) {
            const cmd = match[1].trim();
            let outcome = '✓ passed';
            for (let k = i + 1; k < conversationHistory.length; k++) {
              const nextMsg = conversationHistory[k];
              if (nextMsg.role === 'user' && nextMsg.content.includes('<tool_output>')) {
                const outputMatch = /<tool_output\s*>([\s\S]*?)<\/tool_output>/.exec(nextMsg.content);
                const outputVal = outputMatch ? outputMatch[1].trim() : nextMsg.content.trim();
                if (outputVal.startsWith('[Command failed') || (outputVal.includes('exit code') && !outputVal.includes('exit code 0'))) {
                  outcome = '✗ failed';
                }
                break;
              }
              if (nextMsg.role === 'assistant') {
                break;
              }
            }
            commandsRun.push({ command: cmd, outcome });
          }

          // Native tool calls parsing
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              if (tc.function?.name === 'run_command') {
                const args = tc.function.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {};
                const cmd = (args.command || '').trim();
                let outcome = '✓ passed';
                if (i + 1 < conversationHistory.length && conversationHistory[i + 1].role === 'tool') {
                  const outputVal = conversationHistory[i + 1].content || '';
                  if (outputVal.startsWith('[Command failed') || (outputVal.includes('exit code') && !outputVal.includes('exit code 0'))) {
                    outcome = '✗ failed';
                  }
                }
                commandsRun.push({ command: cmd, outcome });
              }
            }
          }
        }

        let commandsRunTable = '';
        if (commandsRun.length > 0) {
          commandsRunTable = '## Commands Run\n\n| Command | Outcome |\n|---------|---------|\n';
          for (const cmd of commandsRun) {
            commandsRunTable += `| ${cmd.command} | ${cmd.outcome} |\n`;
          }
          commandsRunTable += '\n';
        }

        let secretsRedacted = false;
        function redactWithNotice(c: string): string {
          const redacted = redactSecrets(c);
          if (redacted !== c) {
            secretsRedacted = true;
          }
          return redacted;
        }

        function parseCommandResult(output: string): { status: string; code: string } {
          const failMatch = /exit code (\d+)/i.exec(output);
          if (failMatch) {
            const code = parseInt(failMatch[1], 10);
            if (code === 0) return { status: '✓ exit code 0', code: '0' };
            return { status: `✗ exit code ${code}`, code: String(code) };
          }
          if (output.includes('Command failed') || output.includes('Error:')) {
            return { status: '✗ failed', code: '1' };
          }
          return { status: '✓ exit code 0', code: '0' };
        }

        function formatToolCallForMarkdown(toolName: string, attrsStr: string, innerContent: string, rawOutput: string): string {
          let out = '';
          let resultStatus = '✓ success';
          if (rawOutput.includes('Error') || rawOutput.startsWith('Error') || rawOutput.startsWith('[Command failed')) {
            resultStatus = '✗ failure';
          }

          if (['write_file', 'patch_file', 'patch_file_blocks'].includes(toolName)) {
            let file = '';
            const pathAttr = /path=["']([^"']+)["']/.exec(attrsStr);
            if (pathAttr) {
              file = pathAttr[1];
            } else {
              const lines = innerContent.trim().split('\n');
              if (lines.length > 0) {
                file = lines[0].trim();
                innerContent = lines.slice(1).join('\n');
              }
            }

            const lineCount = innerContent.split('\n').length;
            out += `### 🔧 Tool Call: ${toolName}\n`;
            out += `**File:** ${file}\n`;
            out += `**Result:** ${resultStatus}\n\n`;

            if (lineCount <= 500) {
              const lang = getLanguageFromFilename(file);
              const redactedContent = redactWithNotice(innerContent);
              out += `\`\`\`${lang}\n${redactedContent}\n\`\`\`\n\n`;
            } else {
              out += `[File content omitted — ${lineCount} lines. See ${file}]\n\n`;
            }
          } else if (toolName === 'run_command') {
            const cmd = innerContent.trim();
            const cmdResult = parseCommandResult(rawOutput);

            const outputLines = rawOutput.split('\n');
            let truncatedOutput = outputLines.slice(0, 100).join('\n');
            if (outputLines.length > 100) {
              truncatedOutput += `\n\n[Output truncated to 100 lines — ${outputLines.length - 100} lines omitted]`;
            }
            const redactedOutput = redactWithNotice(truncatedOutput);

            out += `### 🔧 Tool Call: run_command\n`;
            out += `**Command:** \`${cmd}\`\n`;
            out += `**Result:** ${cmdResult.status}\n`;
            out += `**Output:**\n\`\`\`\n${redactedOutput}\n\`\`\`\n\n`;
          } else {
            let details = '';
            if (toolName === 'read_file' || toolName === 'delete_file') {
              const pathAttr = /path=["']([^"']+)["']/.exec(attrsStr);
              if (pathAttr) details = `**File:** ${pathAttr[1]}`;
            } else if (toolName === 'make_dir') {
              const pathAttr = /path=["']([^"']+)["']/.exec(attrsStr);
              details = `**Path:** ${pathAttr ? pathAttr[1] : innerContent.trim()}`;
            } else if (toolName === 'copy_file') {
              const srcAttr = /source_path=["']([^"']+)["']/.exec(attrsStr);
              const destAttr = /destination_path=["']([^"']+)["']/.exec(attrsStr);
              if (srcAttr && destAttr) details = `**Source:** ${srcAttr[1]}\n**Destination:** ${destAttr[1]}`;
            } else if (toolName === 'move_file') {
              const srcAttr = /source_path=["']([^"']+)["']/.exec(attrsStr);
              const destAttr = /destination_path=["']([^"']+)["']/.exec(attrsStr);
              if (srcAttr && destAttr) details = `**Source:** ${srcAttr[1]}\n**Destination:** ${destAttr[1]}`;
            } else if (toolName === 'search' || toolName === 'search_code' || toolName === 'web_search') {
              details = `**Query:** \`${innerContent.trim()}\``;
            } else if (toolName === 'list_dir') {
              const pathAttr = /path=["']([^"']+)["']/.exec(attrsStr);
              const recAttr = /recursive=["']([^"']+)["']/.exec(attrsStr);
              details = `**Path:** ${pathAttr ? pathAttr[1] : '.'}`;
              if (recAttr) details += `\n**Recursive:** ${recAttr[1]}`;
            } else if (toolName === 'view_outline') {
              const pathAttr = /path=["']([^"']+)["']/.exec(attrsStr);
              if (pathAttr) details = `**File:** ${pathAttr[1]}`;
            } else if (toolName === 'ask_user') {
              details = `**Question:** \`${innerContent.trim()}\``;
            }

            out += `### 🔧 Tool Call: ${toolName}\n`;
            if (details) {
              out += `${details}\n`;
            }
            out += `**Result:** ${resultStatus}\n\n`;
          }
          return out;
        }

        const durationMs = Date.now() - sessionStartTime;
        function formatDuration(ms: number): string {
          const seconds = Math.floor((ms / 1000) % 60);
          const minutes = Math.floor((ms / (1000 * 60)) % 60);
          const hours = Math.floor(ms / (1000 * 60 * 60));
          const parts = [];
          if (hours > 0) parts.push(`${hours}h`);
          if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
          parts.push(`${seconds}s`);
          return parts.join(' ');
        }

        const durationStr = formatDuration(durationMs);
        const fullDateStr = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date());
        const exportTimestamp = new Date().toISOString();

        let conversationMarkdown = '';
        for (let idx = 0; idx < conversationHistory.length; idx++) {
          const msg = conversationHistory[idx];
          if (msg.role === 'system') {
            const compactMatch = /\[COMPACTED CONTEXT — conversation summarised at ([^\]]+)\]\n\n([\s\S]*)/.exec(msg.content);
            if (compactMatch) {
              const timestamp = compactMatch[1].trim();
              const summaryContent = compactMatch[2].trim();
              conversationMarkdown += `### ⚡ Context Compacted\n*Conversation history was compacted at ${timestamp}. Summary below:*\n${summaryContent}\n\n`;
            } else {
              conversationMarkdown += `### ⚙️ System\n${msg.content}\n\n`;
            }
          } else if (msg.role === 'user') {
            if (msg.content.includes('<tool_output>')) {
              continue;
            }
            conversationMarkdown += `### 👤 User\n${msg.content.trim()}\n\n`;
          } else if (msg.role === 'tool') {
            continue;
          } else if (msg.role === 'assistant') {
            let prose = msg.content || '';
            prose = prose
              .replace(/<run_command\s*>[\s\S]*?(?:<\/run_command>|$)/g, '')
              .replace(/<read_file\s*[^>]*>[\s\S]*?(?:<\/read_file>|$)/g, '')
              .replace(/<search_code\s*>[\s\S]*?(?:<\/search_code>|$)/g, '')
              .replace(/<write_file\s*[^>]*>[\s\S]*?(?:<\/write_file>|$)/g, '')
              .replace(/<patch_file\s*[^>]*>[\s\S]*?(?:<\/patch_file>|$)/g, '')
              .replace(/<patch_file_blocks\s*[^>]*>[\s\S]*?(?:<\/patch_file_blocks>|$)/g, '')
              .replace(/<delete_file\s*[^>]*>[\s\S]*?(?:<\/delete_file>|$)/g, '')
              .replace(/<web_search\s*[^>]*>[\s\S]*?(?:<\/web_search>|$)/g, '')
              .replace(/<edit_file\s*[^>]*>[\s\S]*?(?:<\/edit_file>|$)/g, '')
              .replace(/<search\s*[^>]*>[\s\S]*?(?:<\/search>|$)/g, '')
              .replace(/<view_outline\s*[^>]*>[\s\S]*?(?:<\/view_outline>|$)/g, '')
              .replace(/<ask_user\s*[^>]*>[\s\S]*?(?:<\/ask_user>|$)/g, '')
              .replace(/<list_dir\s*[^>]*>[\s\S]*?(?:<\/list_dir>|$)/g, '')
              .replace(/<git_status\s*[^>]*>[\s\S]*?(?:<\/git_status>|$)/g, '')
              .replace(/<diagnostics\s*[^>]*>[\s\S]*?(?:<\/diagnostics>|$)/g, '')
              .replace(/<move_file\s*[^>]*>[\s\S]*?(?:<\/move_file>|$)/g, '')
              .replace(/<(?:path_)?question\s*[^>]*\/>/g, '')
              .replace(/<(?:path_)?question\s*[^>]*>[\s\S]*?(?:<\/(?:path_)?question>|$)/g, '')
              .trim();

            if (prose) {
              conversationMarkdown += `### 🤖 Agent\n${prose}\n\n`;
            }

            // 1. XML tool calls
            const toolCallRegex = /<(run_command|read_file|write_file|patch_file|patch_file_blocks|delete_file|list_dir|search_code|web_search|view_outline|ask_user|move_file|git_status|diagnostics|edit_file|search)(\s+[^>]*?)(?:>([\s\S]*?)(?:<\/\1>|$)|\s*\/>)/g;
            let toolMatch;
            while ((toolMatch = toolCallRegex.exec(msg.content || '')) !== null) {
              const toolName = toolMatch[1];
              let toolOutputContent = '';
              
              for (let k = idx + 1; k < conversationHistory.length; k++) {
                if (conversationHistory[k].role === 'user' && conversationHistory[k].content.includes('<tool_output>')) {
                  toolOutputContent = conversationHistory[k].content;
                  break;
                }
                if (conversationHistory[k].role === 'assistant') {
                  break;
                }
              }

              let rawOutput = '';
              const outputMatch = /<tool_output\s*>([\s\S]*?)<\/tool_output>/.exec(toolOutputContent);
              if (outputMatch) {
                rawOutput = outputMatch[1].trim();
              } else {
                rawOutput = toolOutputContent.trim();
              }

              conversationMarkdown += formatToolCallForMarkdown(toolName, toolMatch[2], toolMatch[3] || '', rawOutput);
            }

            // 2. Native tool calls
            if (msg.tool_calls) {
              for (const tc of msg.tool_calls) {
                const toolName = tc.function?.name;
                const args = tc.function?.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {};
                
                let rawOutput = '';
                if (idx + 1 < conversationHistory.length && conversationHistory[idx + 1].role === 'tool') {
                  rawOutput = conversationHistory[idx + 1].content || '';
                }

                let detailsStr = '';
                let innerContent = '';
                if (['write_file', 'patch_file', 'patch_file_blocks', 'delete_file'].includes(toolName)) {
                  detailsStr = ` path="${args.filePath || args.path}"`;
                  if (toolName === 'patch_file_blocks') {
                    innerContent = args.diff || '';
                  } else if (toolName === 'patch_file') {
                    detailsStr += ` search="${args.search || ''}" replace="${args.replace || ''}"`;
                  } else {
                    innerContent = args.content || '';
                  }
                } else if (toolName === 'read_file') {
                  detailsStr = ` path="${args.path || args.filePath}"`;
                } else if (toolName === 'run_command') {
                  innerContent = args.command || '';
                } else if (toolName === 'search_code' || toolName === 'web_search') {
                  innerContent = args.query || '';
                } else if (toolName === 'list_dir') {
                  detailsStr = ` path="${args.path || '.'}" recursive="${args.recursive || 'false'}"`;
                } else if (toolName === 'view_outline') {
                  detailsStr = ` path="${args.path}"`;
                } else if (toolName === 'ask_user') {
                  detailsStr = args.options ? ` options="${args.options}"` : '';
                  innerContent = args.question || '';
                } else if (toolName === 'move_file') {
                  detailsStr = ` source_path="${args.sourcePath}" destination_path="${args.destinationPath}"`;
                } else if (toolName === 'make_dir') {
                  detailsStr = ` path="${args.path || args.filePath}"`;
                } else if (toolName === 'copy_file') {
                  detailsStr = ` source_path="${args.sourcePath}" destination_path="${args.destinationPath}"`;
                }

                conversationMarkdown += formatToolCallForMarkdown(toolName, detailsStr, innerContent, rawOutput);
              }
            }
          }
        }

        let metadataNotice = '';
        if (secretsRedacted) {
          metadataNotice = `\n> ⚠ Note: Secret patterns were automatically redacted from this export.\n`;
        }

        const exportMarkdown = `# Ruthen Session — ${fullDateStr}\n\n` +
          `**Duration:** ${durationStr}\n` +
          `**Messages:** ${conversationHistory.length}\n` +
          `**Workspace:** ${workspaceRoot}\n` +
          `**Model:** ${activeModel}\n` +
          `**Exported:** ${exportTimestamp}\n` +
          metadataNotice +
          `\n---\n\n` +
          `## Files Modified This Session\n\n` +
          filesModifiedTable +
          `\n\n` +
          commandsRunTable +
          `---\n\n` +
          `## Full Conversation\n\n` +
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

        return;
      }

      if (command === '/models') {
        const options = models.map(m => {
          const activeIndicator = m.name === activeModel ? ' (active)' : '';
          return `${m.name}${activeIndicator}`;
        });
        const chosenIdx = await ui.interactiveSelect('Select Active Model:', options);
        if (chosenIdx !== -1) {
          activeModel = models[chosenIdx].name;
          modelContextWindow = await ollama.getContextLimit(activeModel);
          useNativeTools = false;
          modelSupportsThinking = await ollama.checkModelThinkingCapability(activeModel).catch(() => false);
          thinkingEnabled = modelSupportsThinking;
          ui.updateStatus(activeModel, '0', gitBranch);
          ui.printSystemMessage('info', `Switched to active model: ${activeModel} (Thinking: ${modelSupportsThinking ? 'yes' : 'no'})`);
        }
        return;
      }

      if (command === '/thinking') {
        const chosenIdx = await ui.interactiveSelect('Model Thinking Mode:', [
          `Enable Thinking  ${thinkingEnabled ? '✓' : ''}`,
          `Disable Thinking ${!thinkingEnabled ? '✓' : ''}`
        ]);
        if (chosenIdx === 0) {
          thinkingEnabled = true;
          ui.printSystemMessage('info', 'Model thinking enabled.');
        } else if (chosenIdx === 1) {
          thinkingEnabled = false;
          ui.printSystemMessage('info', 'Model thinking disabled.');
        }
        return;
      }

      if (command === '/autopilot') {
        const chosenIdx = await ui.interactiveSelect('Autopilot Mode:', [
          `Enable Autopilot (Plan-Code-Test-Healing Loop)  ${autopilotEnabled ? '✓' : ''}`,
          `Disable Autopilot ${!autopilotEnabled ? '✓' : ''}`
        ]);
        if (chosenIdx === 0) {
          autopilotEnabled = true;
          ui.printSystemMessage('info', '🤖 Autopilot enabled.');
        } else if (chosenIdx === 1) {
          autopilotEnabled = false;
          ui.printSystemMessage('info', '🤖 Autopilot disabled.');
        }
        return;
      }

      if (command === '/personality') {
        const keys = Object.keys(PERSONALITY_TONES);
        const options = keys.map(k => {
          const activeIndicator = k === activePersonality ? ' (active)' : '';
          return `${PERSONALITY_TONES[k].label}${activeIndicator}`;
        });
        const chosenIdx = await ui.interactiveSelect('Select Personality:', options);
        if (chosenIdx !== -1) {
          activePersonality = keys[chosenIdx];
          ui.printSystemMessage('info', `Switched to personality: ${PERSONALITY_TONES[activePersonality].label}`);
        }
        return;
      }

      if (command === '/changes') {
        const changes = indexer.getRecentChanges();
        ui.addTextOutput('\n' + (changes || 'No recent changes.') + '\n');
        return;
      }

      if (command === '/undo') {
        const dbBackup = indexer.db.db.prepare(
          'SELECT original_path, path_hash FROM shadow_backups ORDER BY version DESC LIMIT 1'
        ).get() as { original_path: string; path_hash: string } | undefined;
        if (dbBackup) {
          const restoredPath = dbBackup.original_path;
          const success = indexer.undoWrite(restoredPath);
          if (success) {
            sandbox.clearLoopHistory();
            // Re-index the restored file
            try {
              if (fs.existsSync(restoredPath)) {
                const stat = fs.statSync(restoredPath);
                indexer.processFileOnStartup(restoredPath, stat);
              }
            } catch (_) {}
            const remaining = indexer.db.getBackupDepth(
              (await import('../../src/core/database/backup.js')).getPathHash(restoredPath)
            );
            const moreMsg = remaining > 0 ? `  (${remaining} more undo step${remaining > 1 ? 's' : ''} available)` : '';
            ui.printSystemMessage('info', `Reverted: ${path.basename(restoredPath)}${moreMsg}`);
          } else {
            ui.printSystemMessage('error', `Failed to restore backup for ${restoredPath}`);
          }
        } else {
          ui.printSystemMessage('info', 'No backups found to undo.');
        }
        return;
      }

      if (command === '/files') {
        const allFiles = indexer.db.getAllFiles();
        let out = `\nIndexed Files (${allFiles.length}):\n`;
        allFiles.forEach(f => {
          const rel = path.relative(workspaceRoot, f.path);
          out += `  - ${rel} (${(f.size / 1024).toFixed(1)} KB)\n`;
        });
        ui.addTextOutput(out);
        return;
      }

      if (command === '/reindex') {
        ui.printSystemMessage('info', 'Re-scanning workspace and rebuilding index...');
        await indexer.initialize();
        ui.printSystemMessage('info', 'Index successfully rebuilt.');
        return;
      }

      if (command === '/search') {
        const PROVIDERS = ['tavily', 'brave', 'exa', 'serper', 'duckduckgo', 'auto'];

        const argTrimmed = arg ? arg.trim().toLowerCase() : '';

        // 1. /search limit <number> — change max retrieved sources
        if (argTrimmed.startsWith('limit ')) {
          const limitVal = parseInt(argTrimmed.substring(6).trim(), 10);
          if (isNaN(limitVal) || limitVal < 1 || limitVal > 20) {
            ui.printSystemMessage('error', 'Search limit must be a valid integer between 1 and 20.');
          } else {
            try {
              const { setSearchLimit } = await import('../../src/pro/connect/integrations/search.js');
              setSearchLimit(limitVal);
              ui.printSystemMessage('info', `Search result count limit set to: ${limitVal}`);
            } catch (e: any) {
              ui.printSystemMessage('error', `Failed to set search limit: ${e.message}`);
            }
          }
          return;
        }

        // 2. /search <provider> — switch web search provider
        if (arg && PROVIDERS.includes(arg.trim().toLowerCase())) {
          const provider = arg.trim().toLowerCase();
          try {
            const { setSearchProvider } = await import('../../src/pro/connect/integrations/search.js');
            setSearchProvider(provider);
            const label = provider === 'auto' ? 'Auto (use first connected key)' : provider.charAt(0).toUpperCase() + provider.slice(1);
            ui.printSystemMessage('info', `Web search provider set to: ${label}`);
          } catch (e: any) {
            ui.printSystemMessage('error', `Failed to set provider: ${e.message}`);
          }
          return;
        }

        // 3. /search with no args — show current provider, current limit, + options
        if (!arg) {
          const { getSearchProvider, getSearchLimit } = await import('../../src/pro/connect/integrations/search.js');
          const { isServiceConnected } = await import('../../src/core/tier.js');
          const current = getSearchProvider();
          const currentLimit = getSearchLimit();
          const connected = PROVIDERS.filter(p => p !== 'auto' && p !== 'duckduckgo' && isServiceConnected(p));
          const connectedStr = connected.length > 0 ? connected.join(', ') : 'none';

          const options = [
            ...PROVIDERS.map(p => {
              const isActive = p === current;
              const isConn = p !== 'auto' && p !== 'duckduckgo' && connected.includes(p);
              const tag = isActive ? chalk.hex('#10B981')(' ✓ active') : '';
              const connTag = isConn ? chalk.hex('#38BDF8')(' (connected)') : '';
              return `${p}${tag}${connTag}`;
            }),
            'Search codebase instead'
          ];

          ui.addTextOutput(`\n  Current web search provider: ${chalk.hex('#C084FC')(current)}\n  Current search source limit: ${chalk.hex('#C084FC')(currentLimit)}\n  Connected keys: ${connectedStr}\n  Tip: /search <provider> to switch, /search limit <N> to set count limit, /search <query> to search codebase\n`);
          return;
        }

        // 4. /search <query> — codebase search (original behavior)
        const results = indexer.search(arg);
        let out = `\nFound ${results.length} matches:\n`;
        results.slice(0, 5).forEach(r => {
          out += `  - ${r.relpath} (line ${r.start_line}-${r.end_line})\n`;
        });
        ui.addTextOutput(out);
        return;
      }


      if (command === '/audit') {
        const store = new AuditLogStore(indexer.db);
        const limitStr = arg ? arg.trim() : '15';
        const limit = parseInt(limitStr, 10) || 15;
        const logs = store.getRecentLogs(limit);
        if (logs.length === 0) {
          ui.printSystemMessage('info', 'No audit logs recorded yet.');
          return;
        }
        let out = `\nRecent Activity Audit Logs:\n`;
        logs.forEach((l: any) => {
          const time = new Date(l.timestamp).toLocaleTimeString();
          const statusText = l.status === 'completed' || l.status === 'approved' 
            ? chalk.green(l.status) 
            : l.status === 'failed' ? chalk.red(l.status) : chalk.yellow(l.status);
          out += `  [${time}] ${chalk.cyan(l.service)} · ${l.operation} -> ${l.target} (${statusText})\n`;
        });
        ui.addTextOutput(out);
        return;
      }

      // ── /mcp ─────────────────────────────────────────────────────────────────
      if (command === '/mcp') {
        const { McpClientManager } = await import('../../src/core/mcp/client.js');
        const { loadMcpConfig, saveMcpServer, removeMcpServer } = await import('../../src/core/mcp/config.js');
        const mcpManager = McpClientManager.getInstance();
        const subCmd = arg?.trim().split(/\s+/)[0] || '';
        const subArgs = arg?.trim().split(/\s+/).slice(1) || [];

        // /mcp  (no args) — list connected servers + their tools
        if (!subCmd) {
          const connected = mcpManager.getConnectedServers();
          const config = loadMcpConfig();
          const configuredIds = Object.keys(config.servers);

          if (configuredIds.length === 0) {
            ui.printSystemMessage('info', 'No MCP servers configured. Use /mcp add <id> to add one.');
            ui.addTextOutput(
              `  ${chalk.hex('#6B7280')('Example:')}
  ${chalk.hex('#F59E0B')('/mcp add filesystem')} ${chalk.hex('#6B7280')('— then follow the prompts')}
  ${chalk.hex('#F59E0B')('/mcp add github-mcp')} ${chalk.hex('#6B7280')('— for GitHub MCP server')}`
            );
          } else {
            const lines = configuredIds.map(id => {
              const srv = config.servers[id];
              const conn = connected.find(c => c.id === id);
              const status = conn ? chalk.hex('#34D399')('● connected') + chalk.hex('#6B7280')(` (${conn.toolCount} tools)`) : chalk.hex('#F87171')('○ disconnected');
              return `  ${chalk.hex('#F59E0B')(id.padEnd(20))} ${status}  ${chalk.hex('#6B7280')(srv.description || srv.name)}`;
            });
            ui.addTextOutput(`\n${lines.join('\n')}\n`);

            // List tools per connected server
            const allTools = mcpManager.getAllTools();
            if (allTools.length > 0) {
              const toolLines = allTools.map(t =>
                `  ${chalk.hex('#38BDF8')(t.serverId.padEnd(20))} ${chalk.white(t.name.padEnd(30))} ${chalk.hex('#6B7280')(t.description.slice(0, 60))}`
              );
              ui.addTextOutput(`  ${chalk.hex('#F59E0B')('Available MCP Tools:')}
${toolLines.join('\n')}\n`);
            }
          }
          return;
        }

        // /mcp add <id> — interactive add
        if (subCmd === 'add') {
          const id = subArgs[0];
          if (!id) {
            ui.printSystemMessage('error', 'Usage: /mcp add <server-id>');
            return;
          }
          // Show a guide for adding
          ui.addTextOutput(
            `\n  ${chalk.hex('#F59E0B').bold('Adding MCP Server: ')}${chalk.white(id)}\n` +
            `  Edit ${chalk.hex('#38BDF8')('~/.unit01/mcp.json')} and add:\n\n` +
            `  ${chalk.hex('#6B7280')(JSON.stringify({
              [id]: {
                name: id,
                transport: 'stdio',
                command: 'npx',
                args: ['-y', `@modelcontextprotocol/${id}`],
                description: 'Your MCP server description'
              }
            }, null, 2).split('\n').join('\n  '))}\n\n` +
            `  Then run ${chalk.hex('#F59E0B')('/mcp reload')} to connect.\n`
          );
          return;
        }

        // /mcp reload — reconnect all servers from config
        if (subCmd === 'reload') {
          ui.printSystemMessage('info', 'Reloading MCP servers...');
          const config = loadMcpConfig();
          let connected = 0;
          for (const [id, srv] of Object.entries(config.servers)) {
            const ok = await mcpManager.connectServer(id, srv, false);
            if (ok) connected++;
          }
          ui.printSystemMessage('info', `MCP reload complete — ${connected}/${Object.keys(config.servers).length} servers connected.`);
          return;
        }

        // /mcp remove <id>
        if (subCmd === 'remove') {
          const id = subArgs[0];
          if (!id) { ui.printSystemMessage('error', 'Usage: /mcp remove <server-id>'); return; }
          await mcpManager.disconnectServer(id);
          const removed = removeMcpServer(id);
          if (removed) {
            ui.printSystemMessage('info', `MCP server "${id}" removed.`);
          } else {
            ui.printSystemMessage('error', `Server "${id}" not found in config.`);
          }
          return;
        }

        ui.printSystemMessage('info', 'Usage: /mcp · /mcp add <id> · /mcp remove <id> · /mcp reload');
        return;
      }

      if (command === '/connect') {
        let service = '';
        let token = '';

        if (arg) {
          const parts = arg.trim().split(/\s+/);
          if (parts.length === 2) {
            [service, token] = parts;
          } else {
            ui.printSystemMessage('error', 'Usage: /connect <service> <token> or just /connect to open the interactive menu.');
            return;
          }
        } else {
          const { isPro, isServiceConnected } = await import('../../src/core/tier.js');

          const serviceOptions = [
            { id: 'tavily', label: 'Tavily (Web Search)' },
            { id: 'brave',  label: 'Brave Web Search' },
            { id: 'exa',    label: 'Exa (Web Search)' },
            { id: 'jina',   label: 'Jina (Web Search)' },
            { id: 'serper', label: 'Serper (Web Search)' },
            { id: 'github', label: 'GitHub API Integration' },
            { id: 'slack',  label: 'Slack Integration' },
            { id: 'linear', label: 'Linear (Issue Tracking)' },
            { id: 'sentry', label: 'Sentry (Error Tracking)' },
            { id: 'notion', label: 'Notion Database Integration' }
          ];

          // Build menu options: show (Connected) for active ones
          const options = serviceOptions.map(opt => {
            const connected = isServiceConnected(opt.id);
            const statusSuffix = connected ? chalk.hex('#10B981')(' (Connected)') : '';
            return `${opt.label}${statusSuffix}`;
          });
          options.push('Disconnect Service');

          const choiceIdx = await ui.interactiveSelect('Select Service to Connect:', options);
          if (choiceIdx === -1) return;

          // Handle Disconnect Service option (last option in the list)
          if (choiceIdx === options.length - 1) {
            const activeServices = serviceOptions.filter(opt => isServiceConnected(opt.id));

            if (activeServices.length === 0) {
              ui.printSystemMessage('info', 'No active services to disconnect.');
              return;
            }

            const disconnectLabels = activeServices.map(opt => opt.label);
            const selectDisconnectIdx = await ui.interactiveSelect('Select Service to Disconnect:', disconnectLabels);
            if (selectDisconnectIdx === -1) return;

            const targetService = activeServices[selectDisconnectIdx].id;
            try {
              if (!isPro()) {
                const { deletePlaintextToken } = await import('../../src/core/tier.js');
                deletePlaintextToken(targetService);
                ui.printSystemMessage('info', `Disconnected credentials for service: ${targetService}`);
                return;
              }
              const { disconnectService } = await import('../../src/pro/connect/index.js');
              disconnectService(targetService);
              ui.printSystemMessage('info', `Disconnected credentials for service: ${targetService}`);
            } catch (e: any) {
              ui.printSystemMessage('error', `Failed to disconnect service: ${e.message}`);
            }
            return;
          }

          // Handle normal service connection selection
          const selectedOpt = serviceOptions[choiceIdx];
          if (isServiceConnected(selectedOpt.id)) {
            ui.printSystemMessage('error', `Service "${selectedOpt.id}" is already connected. Please disconnect it first before entering a new token.`);
            return;
          }

          service = selectedOpt.id;
          const inputPrompt = `Enter API Token/Key for ${selectedOpt.label}:`;
          token = await ui.interactiveInput(inputPrompt);
          if (!token || token.trim().length === 0) {
            ui.printSystemMessage('error', 'API Token/Key cannot be empty.');
            return;
          }
          token = token.trim();
        }

        ui.showToolProgress(`Connecting service ${service}...`);
        try {
          const { isPro, savePlaintextToken } = await import('../../src/core/tier.js');
          const { validateServiceToken } = await import('../../src/pro/connect/index.js');

          if (!isPro()) {
            // Free Tier: Plaintext config flow
            const isValid = await validateServiceToken(service, token);
            ui.hideToolProgress();
            if (!isValid) {
              ui.printSystemMessage('error', `Failed to validate token for ${service}. Please check your credentials.`);
              return;
            }
            savePlaintextToken(service, token);
            ui.printSystemMessage('info', `Successfully connected service: ${service}`);
            ui.addTextOutput(`\n  ${chalk.hex('#F59E0B')('⚠️ Warning:')} ${chalk.hex('#6B7280')('Stored credentials in plaintext at ~/.unit01/config.json.')}\n  ${chalk.hex('#6B7280')('Upgrade to Pro to use the secure OS Keychain / encrypted Vault.')}\n`);
            return;
          }

          // Pro Tier: Secure Keychain/Vault flow
          const isValid = await validateServiceToken(service, token);
          if (!isValid) {
            ui.hideToolProgress();
            ui.printSystemMessage('error', `Failed to validate token for ${service}. Please check your credentials.`);
            return;
          }

          const { connectService, isSecretToolAvailable } = await import('../../src/pro/connect/index.js');
          
          if (process.platform !== 'darwin' && !isSecretToolAvailable()) {
            const { vaultExists, unlockWithPassword, initializeVault } = await import('../../src/pro/connect/vault.js');
            if (vaultExists()) {
              let unlocked = false;
              while (!unlocked) {
                const password = await ui.interactiveInput('Enter Vault Master Password to unlock credentials store:');
                if (!password) {
                  ui.printSystemMessage('error', 'Password required to unlock credentials vault.');
                  ui.hideToolProgress();
                  return;
                }
                unlocked = unlockWithPassword(password);
                if (!unlocked) {
                  ui.printSystemMessage('error', 'Incorrect password. Try again.');
                }
              }
            } else {
              const password = await ui.interactiveInput('Create a new Vault Master Password to encrypt API credentials:');
              if (!password) {
                ui.printSystemMessage('error', 'Password required to initialize credentials vault.');
                ui.hideToolProgress();
                return;
              }
              const confirmPassword = await ui.interactiveInput('Confirm Vault Master Password:');
              if (password !== confirmPassword) {
                ui.printSystemMessage('error', 'Passwords do not match. Vault initialization aborted.');
                ui.hideToolProgress();
                return;
              }
              const recoveryKey = initializeVault(password);
              ui.printSystemMessage('info', `Vault initialized successfully!\nYour Recovery Key (keep this safe!):\n--> ${recoveryKey}`);
            }
          }
          
          await connectService(service, token);
          ui.hideToolProgress();
          ui.printSystemMessage('info', `Successfully connected service: ${service}`);
        } catch (e: any) {
          ui.hideToolProgress();
          ui.printSystemMessage('error', `Failed to connect service: ${e.message}`);
        }
        return;
      }

      if (command === '/reset-password') {
        if (process.platform === 'darwin') {
          ui.printSystemMessage('info', 'Password vault not used on macOS (using native Keychain).');
          return;
        }
        const { isSecretToolAvailable } = await import('../../src/pro/connect/index.js');
        if (isSecretToolAvailable()) {
          ui.printSystemMessage('info', 'Password vault not used (using Linux Secret Service Keyring).');
          return;
        }
        
        const { vaultExists, unlockWithRecoveryKey, resetVaultPassword } = await import('../../src/pro/connect/vault.js');
        if (!vaultExists()) {
          ui.printSystemMessage('error', 'Vault does not exist. Use /connect to initialize it first.');
          return;
        }

        const recoveryKey = await ui.interactiveInput('Enter Vault Master Recovery Key:');
        if (!recoveryKey) {
          ui.printSystemMessage('error', 'Recovery key required.');
          return;
        }

        const unlocked = unlockWithRecoveryKey(recoveryKey.trim());
        if (!unlocked) {
          ui.printSystemMessage('error', 'Invalid Recovery Key.');
          return;
        }

        const newPassword = await ui.interactiveInput('Enter new Master Password:');
        if (!newPassword) {
          ui.printSystemMessage('error', 'New password required.');
          return;
        }
        const confirmPassword = await ui.interactiveInput('Confirm new Master Password:');
        if (newPassword !== confirmPassword) {
          ui.printSystemMessage('error', 'Passwords do not match.');
          return;
        }

        const success = resetVaultPassword(recoveryKey.trim(), newPassword);
        if (success) {
          ui.printSystemMessage('info', 'Vault master password reset successfully.');
        } else {
          ui.printSystemMessage('error', 'Failed to reset vault password.');
        }
        return;
      }

      ui.printSystemMessage('error', `Unknown command: ${command}`);
      return;
    }

    conversationHistory.push({ role: 'user', content: trimmed });
    recentToolCallsFingerprints.length = 0; // Clear loop detection history on new user turn

    const optimizeContextHistory = () => {
      for (let i = 0; i < conversationHistory.length; i++) {
        const msg = conversationHistory[i];
        if (!msg.content) continue;

        // Match File content of <path>:
        const readMatch = /File content of ([^\s:]+):([\s\S]+)/.exec(msg.content);
        if (readMatch) {
          const filePath = readMatch[1].trim();
          const rawContent = readMatch[2].trim();

          // Only compress if raw content is large (e.g. > 800 chars)
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

        // Match Content of <url>:
        const fetchMatch = /Content of (https?:\/\/[^\s:]+):([\s\S]+)/.exec(msg.content);
        if (fetchMatch) {
          const url = fetchMatch[1].trim();
          const rawContent = fetchMatch[2].replace(/<\/tool_output>$/, '').trim();

          // Only drop if it is actually populated to save context window tokens
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
      const toneBlock = PERSONALITY_TONES[activePersonality]?.instruction || PERSONALITY_TONES['vanilla'].instruction;
      
      const memoryContext = memoryStore.generateMemoryContextBlock();

      // Inject live MCP tools so model knows what's available
      let mcpToolsBlock = '';
      try {
        const { McpClientManager } = await import('../../src/core/mcp/client.js');
        const mcpTools = McpClientManager.getInstance().getAllTools();
        if (mcpTools.length > 0) {
          const lines = mcpTools.map(t =>
            `  - server="${t.serverId}" name="${t.name}": ${t.description}`
          ).join('\n');
          mcpToolsBlock = `\n\n[MCP Tools — call with <mcp_tool server="id" name="name">{...json args...}</mcp_tool>]\n${lines}`;
        }
      } catch (_) {}

      const systemMessage = {
        role: 'system',
        content: `${SYSTEM_INSTRUCTIONS}\n\n[Repo Map]\n${currentRepoMap}\n${currentChanges}${memoryContext}${mcpToolsBlock}`
      };

      const activePayload = [systemMessage, ...conversationHistory];

      let streamAccumulator = '';
      ui.startStreaming();

      try {
        activeAbortController = new AbortController();
        const chatResult = await ollama.chatStream(
          activeModel,
          activePayload,
          userContextLimit > 0 ? userContextLimit : modelContextWindow,
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

        // Helper: check if a fingerprint has been seen LOOP_TRIGGER_COUNT times consecutively
        const isLooping = (fp: string): boolean => {
          const count = (fingerprintConsecutiveCounts.get(fp) || 0) + 1;
          fingerprintConsecutiveCounts.set(fp, count);
          // Reset counts for all other fingerprints (consecutive = only the latest matters)
          for (const [key] of fingerprintConsecutiveCounts) {
            if (key !== fp) fingerprintConsecutiveCounts.set(key, 0);
          }
          return count >= LOOP_TRIGGER_COUNT;
        };

        // Helper: after a write/patch, evict read fingerprints for that path so verify-reads are allowed
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
              // Evict read fingerprints when model writes to a file
              const writtenPath = tc.function?.arguments?.path || tc.function?.arguments?.filePath || tc.function?.arguments?.destinationPath || tc.function?.arguments?.destination_path || '';
              if (writtenPath && ['write_file', 'patch_file', 'patch_file_blocks', 'delete_file', 'make_dir', 'copy_file'].includes(tc.function?.name)) {
                evictReadFingerprintsForPath(writtenPath);
              }
              toolResult = await handleToolCalls(xmlEquivalent, sandbox, indexer, ui, state, fileReadCache);
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
              // Evict read fingerprints if model is writing/deleting/moving/copying/creating a file/directory
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
            toolResult = await handleToolCalls(cleanedResponse, sandbox, indexer, ui, state, fileReadCache);
          }
        }

        // Autopilot test-healing loop
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
          const testCommand = config.test_command || detectTestCommand(workspaceRoot);
          ui.printSystemMessage('info', `🤖 [Autopilot] Starting structured build pipeline: "${testCommand}"...`);
          try {
            const { StructuredBuildPipeline } = await import('../../src/pro/autopilot/pipeline.js');
            const pipeline = new StructuredBuildPipeline(workspaceRoot, testCommand, 8);

            const result = await pipeline.executePipeline(
              async () => {}, // edits already applied — no-op
              async (errorLog: string) => {
                // Feed error to the model for self-healing
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

          // Auto-extract decisions & conventions from every final response (silent, no LLM call)
          try { memoryStore.autoCapture(responseWithoutThink, sessionId); } catch (_) {}

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

  // Boot Ink App
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
