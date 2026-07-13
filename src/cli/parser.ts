import * as path from 'path';
import * as fs from 'fs';


export function cleanFilePath(p: string): string {
  let cleaned = p.trim();
  // Strip relative_path=" or path=" attribute wrapper if present
  const attrRegex = /^(?:relative_)?path\s*=\s*['"]?([^'"]+)['"]?$/i;
  const match = attrRegex.exec(cleaned);
  if (match) {
    cleaned = match[1];
  }
  // Remove surrounding quotes
  cleaned = cleaned.replace(/^['"]|['"]$/g, '');
  return cleaned.trim();
}

export function cleanContentFences(content: string): string {
  const trimmed = content.trim();
  const fenceRegex = /^`{3,}[\w\-]*\r?\n([\s\S]*?)\r?\n`{3,}$/;
  const match = fenceRegex.exec(trimmed);
  if (match) {
    return match[1];
  }
  return content;
}

export function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_\-]+)=["']([^"']*)["']/g;
  let match;
  while ((match = regex.exec(attrStr))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

export function parseWriteFile(text: string): { filePath: string; content: string } | null {
  // Try matching path attribute: <write_file path="src/index.ts">content</write_file>
  // or unclosed: <write_file path="src/index.ts">content (to end of text)
  const attrMatch = /<write_file\s+(?:relative_)?path=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/write_file>|$)/.exec(text);
  if (attrMatch) {
    return {
      filePath: cleanFilePath(attrMatch[1]),
      content: cleanContentFences(attrMatch[2])
    };
  }

  // Fallback if model omitted attribute: <write_file>src/index.ts\ncontent</write_file>
  // or unclosed: <write_file>src/index.ts\ncontent (to end of text)
  const tagMatch = /<write_file>([\s\S]*?)(?:<\/write_file>|$)/.exec(text);
  if (tagMatch) {
    const inner = tagMatch[1].trim();
    const firstNewline = inner.indexOf('\n');
    if (firstNewline !== -1) {
      const filePath = cleanFilePath(inner.slice(0, firstNewline));
      const content = inner.slice(firstNewline + 1);
      return { filePath, content: cleanContentFences(content) };
    }
  }

  return null;
}

export function parseReadFile(text: string): string | null {
  const attrMatch = /<read_file\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/.exec(text);
  if (attrMatch) {
    return cleanFilePath(attrMatch[1]);
  }

  // Require closing tag — prevents conversational mentions from firing
  const tagMatch = /<read_file\s*>([\s\S]*?)<\/read_file>/.exec(text);
  if (tagMatch) {
    return cleanFilePath(tagMatch[1]);
  }

  return null;
}

export function parseDeleteFile(text: string): string | null {
  const attrMatch = /<delete_file\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/.exec(text);
  if (attrMatch) {
    return cleanFilePath(attrMatch[1]);
  }

  // Require closing tag — prevents conversational mentions from firing
  const tagMatch = /<delete_file\s*>([\s\S]*?)<\/delete_file>/.exec(text);
  if (tagMatch) {
    return cleanFilePath(tagMatch[1]);
  }

  return null;
}


export function parseRunCommand(text: string): string | null {
  // Require closing tag — prevents conversational mentions from firing
  const tagMatch = /<run_command\s*>([\s\S]*?)<\/run_command>/.exec(text);
  if (tagMatch) {
    return tagMatch[1].trim();
  }
  return null;
}

export function parseSearchCode(text: string): string | null {
  // Require closing tag — prevents conversational mentions from firing
  const tagMatch = /<search_code\s*>([\s\S]*?)<\/search_code>/.exec(text);
  if (tagMatch) {
    return tagMatch[1].trim();
  }
  return null;
}

export function parseWebSearch(text: string): string | null {
  // Allow unclosed tag or end of string, matching what qwen3.5:2b generates
  const tagMatch = /<web_search\s*>([\s\S]*?)(?:<\/web_search>|$)/.exec(text);
  if (tagMatch) {
    let query = tagMatch[1].trim();
    // Strip any "query:" or "query: " prefix that the model might generate
    if (query.toLowerCase().startsWith('query:')) {
      query = query.substring(6).trim();
    }
    return query || null;
  }
  return null;
}

export function parseFetchWebpage(text: string): string | null {
  const tagMatch = /<fetch_webpage\s*>([\s\S]*?)(?:<\/fetch_webpage>|$)/.exec(text);
  if (tagMatch) {
    return tagMatch[1].trim();
  }
  return null;
}

export function parseQuestion(text: string): { question: string; options: string[] } | null {
  // 1. Try matching nested format: <question options="Allow read-write, Allow read-only, Deny">I need access...</question>
  const matchNested = /<(?:path_)?question(?:\s+([^>]*))?>([\s\S]*?)<\/(?:path_)?question>/.exec(text);
  if (matchNested) {
    const attrsStr = matchNested[1] || '';
    const innerContent = matchNested[2].trim();
    if (innerContent) {
      const attrs = parseAttributes(attrsStr);
      const optionsVal = attrs.options;
      const options = optionsVal
        ? optionsVal.split(',').map(o => o.trim())
        : ['Yes', 'No'];
      return {
        question: innerContent,
        options
      };
    }
  }

  // 2. Fallback to matching attribute format: <question question="..." options="..." />
  const matchAttr = /<(?:path_)?question\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const questionVal = attrs.question;
    const optionsVal = attrs.options;
    if (questionVal) {
      const options = optionsVal
        ? optionsVal.split(',').map(o => o.trim())
        : ['Yes', 'No'];
      return {
        question: questionVal,
        options
      };
    }
  }

  return null;
}

export function parseListDir(text: string): { pathVal: string; recursive: boolean } | null {
  const matchAttr = /<list_dir\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const pathVal = attrs.path || attrs.relative_path || '.';
    const recursive = attrs.recursive === 'true' || attrs.recursive === 'yes';
    return { pathVal: cleanFilePath(pathVal), recursive };
  }
  
  // Require closing tag — prevents conversational mentions from firing
  const matchTag = /<list_dir\s*>([\s\S]*?)<\/list_dir>/.exec(text);
  if (matchTag) {
    return {
      pathVal: cleanFilePath(matchTag[1]) || '.',
      recursive: false
    };
  }
  return null;
}

export function parseGitStatus(text: string): boolean {
  return /<git_status\s*\/?>/.test(text) || /<git_status\s*>/.test(text);
}

export function parseDiagnosticsTag(text: string): { command?: string } | null {
  const matchAttr = /<diagnostics\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    return { command: attrs.command };
  }
  const matchTag = /<diagnostics\s*>([\s\S]*?)(?:<\/diagnostics>|$)/.exec(text);
  if (matchTag) {
    return { command: matchTag[1].trim() };
  }
  return null;
}

export function parseMoveFile(text: string): { sourcePath: string; destinationPath: string } | null {
  const matchAttr = /<move_file\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const sourceVal = attrs.source_path || attrs.src_path || attrs.from;
    const destVal = attrs.destination_path || attrs.dest_path || attrs.to;
    if (sourceVal && destVal) {
      return {
        sourcePath: cleanFilePath(sourceVal),
        destinationPath: cleanFilePath(destVal)
      };
    }
  }
  return null;
}

export function parsePatchFile(text: string): { filePath: string; search: string; replace: string } | null {
  const matchAttr = /<patch_file\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const pathVal = attrs.path || attrs.relative_path;
    const searchVal = attrs.search || attrs.target;
    const replaceVal = attrs.replace || attrs.replacement;
    if (pathVal && searchVal !== undefined && replaceVal !== undefined) {
      return {
        filePath: cleanFilePath(pathVal),
        search: searchVal,
        replace: replaceVal
      };
    }
  }

  const matchNested = /<patch_file\s+([^>]+)\s*>([\s\S]*?)<\/patch_file>/.exec(text);
  if (matchNested) {
    const attrs = parseAttributes(matchNested[1]);
    const pathVal = attrs.path || attrs.relative_path;
    const inner = matchNested[2];
    
    const searchMatch = /<search>([\s\S]*?)<\/search>/.exec(inner);
    const replaceMatch = /<replace>([\s\S]*?)<\/replace>/.exec(inner);
    
    if (pathVal && searchMatch && replaceMatch) {
      return {
        filePath: cleanFilePath(pathVal),
        search: searchMatch[1],
        replace: replaceMatch[1]
      };
    }
  }
  
  return null;
}

export function parsePatchFileBlocks(text: string): { filePath: string; diff: string } | null {
  const match = /<patch_file_blocks\s+(?:relative_)?path=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/patch_file_blocks>|$)/.exec(text);
  if (match) {
    return {
      filePath: cleanFilePath(match[1]),
      diff: match[2].trim()
    };
  }
  return null;
}

export function parseMakeDir(text: string): string | null {
  const attrMatch = /<make_dir\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/.exec(text);
  if (attrMatch) {
    return cleanFilePath(attrMatch[1]);
  }
  // Require closing tag — prevents conversational mentions from firing
  const tagMatch = /<make_dir\s*>([\s\S]*?)<\/make_dir>/.exec(text);
  if (tagMatch) {
    return cleanFilePath(tagMatch[1].trim());
  }
  return null;
}

export function parseCopyFile(text: string): { sourcePath: string; destinationPath: string } | null {
  const matchAttr = /<copy_file\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const sourceVal = attrs.source_path || attrs.src_path || attrs.from;
    const destVal = attrs.destination_path || attrs.dest_path || attrs.to;
    if (sourceVal && destVal) {
      return {
        sourcePath: cleanFilePath(sourceVal),
        destinationPath: cleanFilePath(destVal)
      };
    }
  }
  return null;
}



export function parseViewOutline(text: string): string | null {
  const attrMatch = /<view_outline\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/.exec(text);
  if (attrMatch) {
    return cleanFilePath(attrMatch[1]);
  }

  // Require closing tag — prevents conversational mentions from firing
  const tagMatch = /<view_outline\s*>([\s\S]*?)<\/view_outline>/.exec(text);
  if (tagMatch) {
    return cleanFilePath(tagMatch[1]);
  }

  return null;
}

export function parseAskUser(text: string): { question: string; options: string[] } | null {
  const matchNested = /<ask_user(?:\s+([^>]*))?>([\s\S]*?)<\/ask_user>/.exec(text);
  if (matchNested) {
    const attrsStr = matchNested[1] || '';
    const innerContent = matchNested[2].trim();
    if (innerContent) {
      const attrs = parseAttributes(attrsStr);
      const optionsVal = attrs.options;
      const options = optionsVal
        ? optionsVal.split(',').map(o => o.trim())
        : ['Yes', 'No'];
      return {
        question: innerContent,
        options
      };
    }
  }

  const matchAttr = /<ask_user\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const questionVal = attrs.question;
    const optionsVal = attrs.options;
    if (questionVal) {
      const options = optionsVal
        ? optionsVal.split(',').map(o => o.trim())
        : ['Yes', 'No'];
      return {
        question: questionVal,
        options
      };
    }
  }

  // Fallback to legacy question tool
  return parseQuestion(text);
}


export const TOOL_SIGNATURES: Record<string, { desc: string; args: string }> = {
  'run_command': {
    desc: "Executes a shell command in the sandbox.",
    args: "command (string, content of the tag)"
  },
  'read_file': {
    desc: "Reads the content of a file in the workspace.",
    args: "path (string, attribute or content)"
  },
  'write_file': {
    desc: "Writes content to a file in the workspace.",
    args: "path (string, attribute or content), content (string, content of the tag)"
  },
  'search_code': {
    desc: "Searches the codebase index using keyword/FTS matching.",
    args: "query (string, content of the tag)"
  },
  'patch_file': {
    desc: "Replaces an exact string occurrence in a file.",
    args: "path (string, required), search (string, required), replace (string, required)"
  },
  'patch_file_blocks': {
    desc: "Multi-block search/replace using diff markers.",
    args: "path (string, required), diff (string, required)"
  },
  'list_dir': {
    desc: "Lists files and directories at a path.",
    args: "path (string, required), recursive (boolean, optional)"
  },
  'git_status': {
    desc: "Returns structured git status for the workspace.",
    args: "none"
  },
  'diagnostics': {
    desc: "Runs linter or compiler checks and returns structured results.",
    args: "command (string, optional)"
  },
  'move_file': {
    desc: "Renames/moves a file and updates indexing, backups, and sandbox tracking.",
    args: "source_path (string, required), destination_path (string, required)"
  },
  'question': {
    desc: "Asks the developer a question or requests access permission to a directory path outside the workspace.",
    args: "question (string, required), options (string, comma-separated, optional)"
  },
  'sandbox_exec': {
    desc: "Executes code in a sandboxed environment.",
    args: "code (string), language (string), timeout_ms (number, optional)"
  },
  'delete_file': {
    desc: "Deletes a file recursively tracked by shadow backup.",
    args: "path (string, required)"
  },
  'view_outline': {
    desc: "Retrieves a structural outline of symbols/functions in a file.",
    args: "path (string, required)"
  },
  'ask_user': {
    desc: "Asks the developer a question or requests permission.",
    args: "question (string, required), options (string, optional)"
  }
};

export function validateToolCall(tagName: string, attributesStr: string): string | null {
  const attrs = parseAttributes(attributesStr);
  const attrKeys = Object.keys(attrs);

  const isAllowed = new Set([
    'run_command', 'read_file', 'write_file', 'search_code', 'web_search',
    'patch_file', 'patch_file_blocks', 'list_dir', 'git_status', 'diagnostics',
    'move_file', 'think', 'question', 'path_question',
    'delete_file', 'view_outline', 'ask_user', 'make_dir', 'copy_file',
    'mcp_tool', 'github_get_pr', 'github_create_issue', 'github_create_pr',
    'github_list_repos', 'github_get_contents', 'github_rename_repo', 'slack_get_history', 'slack_post_message',
    'discord_get_history', 'discord_post_message', 'notion_get_page',
    'notion_append_blocks', 'telegram_get_updates', 'telegram_post_message'
  ]).has(tagName);

  if (!isAllowed) {
    const sig = TOOL_SIGNATURES[tagName];
    if (sig) {
      const validArgs = sig.args.split(', ').map(a => a.split(' ')[0]);
      const invalidArgs = attrKeys.filter(k => !validArgs.includes(k));
      if (invalidArgs.length > 0) {
        return JSON.stringify({
          error: `Tool '${tagName}' called with invalid argument '${invalidArgs[0]}'. Valid arguments are: ${sig.args}.`,
          code: "INVALID_TOOL_ARGUMENT"
        });
      }
      return JSON.stringify({
        error: `Unknown tool '${tagName}'. Valid arguments are: ${sig.args}.`,
        code: "UNKNOWN_TOOL"
      });
    } else {
      return JSON.stringify({
        error: `Unknown tool '${tagName}'. Supported tools include: read_file, write_file, patch_file, patch_file_blocks, delete_file, list_dir, search_code, web_search, view_outline, ask_user, move_file, git_status, diagnostics.`,
        code: "UNKNOWN_TOOL"
      });
    }
  }

  if (tagName === 'run_command') {
    if (attrKeys.length > 0) {
      return JSON.stringify({
        error: `Tool 'run_command' called with invalid argument '${attrKeys[0]}'. Valid arguments are: command (string, content of the tag).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'read_file') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'read_file' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, attribute or content).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'write_file') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'write_file' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, attribute or content), content (string, content of the tag).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'delete_file') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'delete_file' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, attribute or content).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'view_outline') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'view_outline' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, required).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'ask_user') {
    const invalid = attrKeys.filter(k => k !== 'question' && k !== 'options');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'ask_user' called with invalid argument '${invalid[0]}'. Valid arguments are: question (string, required), options (string, optional).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'search_code') {
    if (attrKeys.length > 0) {
      return JSON.stringify({
        error: `Tool 'search_code' called with invalid argument '${attrKeys[0]}'. Valid arguments are: query (string, content of the tag).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'web_search') {
    if (attrKeys.length > 0) {
      return JSON.stringify({
        error: `Tool 'web_search' called with invalid argument '${attrKeys[0]}'. Valid arguments are: query (string, content of the tag).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'patch_file') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path' && k !== 'search' && k !== 'target' && k !== 'replace' && k !== 'replacement');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'patch_file' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, required), search (string, required), replace (string, required).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'patch_file_blocks') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path' && k !== 'diff' && k !== 'blocks');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'patch_file_blocks' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, required), diff (string, required).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'list_dir') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path' && k !== 'recursive');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'list_dir' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, required), recursive (boolean, optional).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'git_status') {
    if (attrKeys.length > 0) {
      return JSON.stringify({
        error: `Tool 'git_status' called with invalid argument '${attrKeys[0]}'. Valid arguments are: none.`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'diagnostics') {
    const invalid = attrKeys.filter(k => k !== 'command');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'diagnostics' called with invalid argument '${invalid[0]}'. Valid arguments are: command (string, optional).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'move_file') {
    const invalid = attrKeys.filter(k => k !== 'source_path' && k !== 'destination_path' && k !== 'src_path' && k !== 'dest_path' && k !== 'from' && k !== 'to');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'move_file' called with invalid argument '${invalid[0]}'. Valid arguments are: source_path (string, required), destination_path (string, required).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'question' || tagName === 'path_question') {
    const invalid = attrKeys.filter(k => k !== 'question' && k !== 'options');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool '${tagName}' called with invalid argument '${invalid[0]}'. Valid arguments are: question (string, required), options (string, optional).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'make_dir') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'make_dir' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, required).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'copy_file') {
    const invalid = attrKeys.filter(k => k !== 'source_path' && k !== 'destination_path' && k !== 'src_path' && k !== 'dest_path' && k !== 'from' && k !== 'to');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'copy_file' called with invalid argument '${invalid[0]}'. Valid arguments are: source_path (string, required), destination_path (string, required).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  }

  return null;
}



export function applySearchReplaceBlocks(content: string, blocksStr: string): string {
  const lines = blocksStr.split('\n');
  const blocks: { search: string; replace: string }[] = [];
  
  let currentSearch: string[] = [];
  let currentReplace: string[] = [];
  let inSearch = false;
  let inReplace = false;
  let blockCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<<<<<<< ORIGINAL')) {
      inSearch = true;
      inReplace = false;
      currentSearch = [];
      blockCount++;
    } else if (line.startsWith('=======')) {
      inSearch = false;
      inReplace = true;
      currentReplace = [];
    } else if (line.startsWith('>>>>>>> UPDATED')) {
      inSearch = false;
      inReplace = false;
      blocks.push({
        search: currentSearch.join('\n'),
        replace: currentReplace.join('\n'),
      });
    } else {
      if (inSearch) {
        currentSearch.push(line);
      } else if (inReplace) {
        currentReplace.push(line);
      }
    }
  }
  
  if (blocks.length === 0) {
    throw {
      message: "No valid ORIGINAL/UPDATED blocks found in the input. Format must use <<<<<<< ORIGINAL, =======, and >>>>>>> UPDATED.",
      code: "INVALID_PATCH_FORMAT"
    };
  }
  
  let updated = content;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.search.trim()) {
      throw {
        message: `Block ${i + 1} has an empty ORIGINAL block, which is not allowed.`,
        code: "EMPTY_PATCH_BLOCK",
        blockIndex: i + 1
      };
    }
    
    const index = updated.indexOf(block.search);
    if (index === -1) {
      const normalizedSearch = block.search.replace(/\r\n/g, '\n');
      const normalizedContent = updated.replace(/\r\n/g, '\n');
      const normIndex = normalizedContent.indexOf(normalizedSearch);
      
      if (normIndex === -1) {
        // ── Fuzzy fallback: strip leading whitespace per-line and try again ──
        // Handles the common case where the model regenerates code with slightly
        // wrong indentation (e.g. 2 spaces vs 4 spaces, tabs vs spaces).
        const trimLines = (s: string) => s.split('\n').map(l => l.trimStart()).join('\n');
        const trimmedSearch = trimLines(normalizedSearch);
        const trimmedContent = trimLines(normalizedContent);
        const trimIndex = trimmedContent.indexOf(trimmedSearch);

        if (trimIndex === -1) {
          throw {
            message: `Could not find ORIGINAL block ${i + 1} in the file. Indentation and whitespace must match exactly.`,
            code: "PATCH_BLOCK_NOT_FOUND",
            blockIndex: i + 1,
            blockSearch: block.search
          };
        }

        // Apply patch against the original (non-trimmed) content by mapping the
        // trimmed match position back to the original content.
        // Strategy: find the line number where the match starts in trimmed content,
        // then locate the same span in the original normalized content.
        const trimmedLines = trimmedContent.split('\n');
        const searchTrimmedLines = trimmedSearch.split('\n');
        let lineStart = -1;
        outer: for (let li = 0; li <= trimmedLines.length - searchTrimmedLines.length; li++) {
          for (let si = 0; si < searchTrimmedLines.length; si++) {
            if (trimmedLines[li + si] !== searchTrimmedLines[si]) continue outer;
          }
          lineStart = li;
          break;
        }

        if (lineStart === -1) {
          throw {
            message: `Could not find ORIGINAL block ${i + 1} in the file (fuzzy fallback failed).`,
            code: "PATCH_BLOCK_NOT_FOUND",
            blockIndex: i + 1,
            blockSearch: block.search
          };
        }

        // Reconstruct from original lines, replacing the matched span
        const origLines = normalizedContent.split('\n');
        const before = origLines.slice(0, lineStart).join('\n');
        const after = origLines.slice(lineStart + searchTrimmedLines.length).join('\n');
        updated = [before, block.replace, after].filter((s, idx) => idx === 1 || s !== '').join('\n');
      } else {
        updated = normalizedContent.slice(0, normIndex) + block.replace + normalizedContent.slice(normIndex + normalizedSearch.length);
      }
    } else {
      updated = updated.slice(0, index) + block.replace + updated.slice(index + block.search.length);
    }
  }
  
  return updated;
}

export function listDirectory(dirPath: string, workspaceRoot: string, recursive = false): { directories: any[]; files: any[]; truncated?: boolean } {
  const directories: any[] = [];
  const files: any[] = [];
  let truncated = false;
  const LIMIT = 250;

  function walk(currentDir: string) {
    if (files.length >= LIMIT || directories.length >= LIMIT) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      if (files.length >= LIMIT || directories.length >= LIMIT) {
        truncated = true;
        break;
      }
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(workspaceRoot, fullPath);
      
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch (e) {
        continue;
      }

      if (entry.isDirectory()) {
        directories.push({
          name: entry.name,
          path: relPath,
          modified: stat.mtimeMs
        });
        if (recursive) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        files.push({
          name: entry.name,
          path: relPath,
          size: stat.size,
          modified: stat.mtimeMs
        });
      }
    }
  }

  walk(dirPath);
  return { directories, files, truncated };
}

export function parseDiagnostics(raw: string): { passed: boolean; errors: any[]; warnings: any[] } {
  const errors: any[] = [];
  const warnings: any[] = [];
  const lines = raw.split('\n');

  const regexes = [
    /^([a-zA-Z0-9_\-\./\s]+):(\d+):(\d+)\s+-\s+(error|warning)\s+(.*)$/i,
    /^([a-zA-Z0-9_\-\./\s]+):(\d+):(?:\d+:)?\s*(error|warning|err|warn)?\s*[:\-]?\s*(.*)$/i
  ];

  for (const line of lines) {
    let matched = false;
    for (const rx of regexes) {
      const m = rx.exec(line.trim());
      if (m) {
        const file = m[1].trim();
        const lineNum = parseInt(m[2], 10);
        const type = (m[4] || m[3] || 'error').toLowerCase();
        const message = (m[5] || m[4] || m[3] || '').trim();

        const item = { file, line: lineNum, message };
        if (type.includes('warn')) {
          warnings.push(item);
        } else {
          errors.push(item);
        }
        matched = true;
        break;
      }
    }
  }

  let passed = errors.length === 0;
  if (raw.toLowerCase().includes('error') || raw.toLowerCase().includes('failed') || raw.toLowerCase().includes('compilation failed')) {
    passed = false;
  }
  if (errors.length === 0 && !passed) {
    errors.push({ file: 'project', line: 1, message: 'Diagnostics command failed. See raw output.' });
  }

  return { passed, errors, warnings };
}

export function getLanguageFromFilename(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
      return 'javascript';
    case '.py':
      return 'python';
    case '.rs':
      return 'rust';
    case '.go':
      return 'go';
    case '.java':
      return 'java';
    case '.c':
    case '.h':
      return 'c';
    case '.cpp':
    case '.hpp':
    case '.cc':
      return 'cpp';
    case '.cs':
      return 'csharp';
    case '.html':
      return 'html';
    case '.css':
      return 'css';
    case '.json':
      return 'json';
    case '.md':
      return 'markdown';
    case '.sh':
    case '.bash':
      return 'bash';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.toml':
      return 'toml';
    case '.sql':
      return 'sql';
    default:
      return ext.slice(1);
  }
}


