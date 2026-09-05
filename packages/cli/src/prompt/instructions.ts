export const PERSONALITY_TONES: Record<string, { label: string; instruction: string }> = {
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

export const OLLAMA_TOOLS = [
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
      description: 'Executes a shell command in the workspace (running tests, builds, linting).',
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

export function getToolCallFingerprint(tc: any): string {
  const name = tc.function?.name || '';
  const args = tc.function?.arguments || {};
  const sortedArgs: Record<string, any> = {};
  Object.keys(args).sort().forEach(k => {
    sortedArgs[k] = args[k];
  });
  return `${name}:${JSON.stringify(sortedArgs)}`;
}

export function getXmlToolCallFingerprint(text: string): string {
  const match = /<([a-zA-Z_][a-zA-Z0-9_\-]*)([^>]*)>([\s\S]*?)(?:<\/\1>|$)/.exec(text);
  if (match) {
    const name = match[1];
    const attrs = match[2].trim();
    const content = match[3].trim();
    return `xml:${name}:${attrs}:${content}`;
  }
  return '';
}

export function formatToolCallToXml(tc: any): string {
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

export function cleanModelResponse(text: string): string {
  let cleaned = text.replace(/```(?:xml|json|html|plaintext|text)?\s*([\s\S]*?)```/gi, '$1').trim();
  cleaned = cleaned.replace(/(?:^|\s|<)file\s+([^>]+)>/gi, '<write_file $1>');
  cleaned = cleaned.replace(/<\/file>/gi, '</write_file>');
  cleaned = cleaned.replace(/(?:^|\s)(write_file|patch_file|patch_file_blocks|read_file|delete_file|run_command|make_dir|copy_file|move_file|view_outline)\s+([^>]+)>/gi, '<$1 $2>');
  return cleaned;
}

export const SYSTEM_INSTRUCTIONS = `You are Unit01, a local-first AI coding agent. You act by outputting ONE XML tool tag at a time. You NEVER write explanations, preambles, or conversational text before a tool call. You write the tag and stop.

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
- read_file is for LOCAL files only. Never pass a URL, GitHub link, or any http:// path to read_file. Use fetch_webpage for URLs, github_get_contents for GitHub file content.
- When calling run_command, always pass non-interactive flags where available (e.g., "npm init -y", "npx --yes", "apt-get -y", "git commit -m ..."). Never invoke commands that open interactive wizard prompts.
- NEVER use generic placeholders like "/path/to/", "current/directory/path", "yourusername", or "/home/yourusername" in tool paths. Instead, look at the absolute paths provided in the [System Environment] block (e.g. Workspace Root Path, User Home Directory) and use the real, actual paths of the target folders on the machine.`;
