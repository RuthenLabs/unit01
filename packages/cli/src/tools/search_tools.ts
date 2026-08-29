import * as fs from 'fs';
import { isPro } from '@unit01/core/tier.js';
import { ChunkRecord } from '@unit01/core/database/db.js';
import { themeOrange, themeAccent, isGui, guiEmit } from '../views/theme.js';
import { parseSearchCode, parseListDir, parseViewOutline, listDirectory } from '../parser.js';
import { ToolContext, ToolResult, resolvePath, requestPathAccess } from './types.js';

export async function handleSearchCode(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const searchQuery = parseSearchCode(text);
  if (searchQuery === null) return null;

  const { ui, indexer } = ctx;
  const query = searchQuery.trim();
  if (isGui) guiEmit({ type: 'tool-call', tool: 'search_code', query });

  if (!query) {
    ui.printToolResult('failure', `Searched "${query}" (blocked: empty query)`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nError: Search query cannot be empty. Please provide specific keywords to search the codebase.\n</tool_output>`,
      consoleOutput: `\n[Search blocked: empty query]`
    };
  }

  process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('search')} index for "${query}" ...`);
  
  let results: ChunkRecord[] = [];
  let isHybrid = false;
  if (isPro()) {
    try {
      const { executeHybridSearch } = await import('@unit01/pro/search/index.js');
      results = await executeHybridSearch(indexer.db, query);
      isHybrid = true;
    } catch (e) {
      results = indexer.search(query);
    }
  } else {
    results = indexer.search(query);
  }
  
  ui.hideToolProgress();
  ui.printToolResult('success', `${isHybrid ? 'Hybrid searched' : 'Searched'} "${query}" (${results.length} results)`);
  
  const formatted = results.slice(0, 5).map(r => 
    `- ${r.relpath} (line ${r.start_line}-${r.end_line}, type ${r.chunk_type}):\n${r.content}`
  ).join('\n\n');

  const totalNote = results.length > 5
    ? `\nShowing top 5 of ${results.length} total matches. Refine your query to narrow results.`
    : '';

  return {
    toolRun: true,
    nextPrompt: `<tool_output>\nSearch results for "${query}" (${results.length} total):\n${formatted || 'No matches found'}${totalNote}\n</tool_output>`,
    consoleOutput: `\n[Search executed: "${query}"]`
  };
}

export async function handleListDir(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const listDirResult = parseListDir(text);
  if (!listDirResult) return null;

  const { ui, state, guard } = ctx;
  const { pathVal, recursive } = listDirResult;
  const absPath = resolvePath(guard['workspaceRoot'], pathVal);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'list_dir', pathVal, recursive });

  if (!guard.isPathAllowed(absPath)) {
    const granted = await requestPathAccess(absPath, 'ro', ui, state, guard);
    if (!granted) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. Permission denied by user.`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[List dir blocked (not allowed): ${pathVal}]`
      };
    }
  }

  ui.showToolProgress(`${themeAccent('list_dir')} ${pathVal}...`);

  try {
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
      ui.hideToolProgress();
      ui.printToolResult('failure', `Listed directory ${pathVal} (failed: not found)`);
      const errObj = {
        error: `Directory not found at ${pathVal}`,
        code: "DIRECTORY_NOT_FOUND",
        path: pathVal
      };
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
        consoleOutput: `\n[List dir failed: Directory not found: ${pathVal}]`
      };
    }

    const result = listDirectory(absPath, guard['workspaceRoot'], recursive);

    ui.hideToolProgress();
    ui.printToolResult('success', `Listed directory ${pathVal}`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
      consoleOutput: `\n[Directory listed: ${pathVal}]`
    };
  } catch (err: any) {
    ui.hideToolProgress();
    ui.printToolResult('failure', `ListDir ${pathVal} — failed: ${err.message}`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nError listing directory: ${err.message}\n</tool_output>`,
      consoleOutput: `\n[ListDir failed: ${pathVal}]`
    };
  }
}

export async function handleViewOutline(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const outlinePath = parseViewOutline(text);
  if (outlinePath === null) return null;

  const { ui, indexer, guard } = ctx;
  const absPath = resolvePath(guard['workspaceRoot'], outlinePath);
  if (isGui) guiEmit({ type: 'tool-call', tool: 'view_outline', outlinePath });

  if (!guard.isPathAllowed(absPath)) {
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${JSON.stringify({
        error: `Path is outside the workspace.`,
        code: "PATH_NOT_ALLOWED",
        path: absPath
      })}\n</tool_output>`,
      consoleOutput: `\n[Outline blocked (not allowed): ${outlinePath}]`
    };
  }

  ui.showToolProgress(`${themeAccent('outline')} ${outlinePath}...`);
  try {
    if (!fs.existsSync(absPath)) {
      ui.hideToolProgress();
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: File not found at ${outlinePath}\n</tool_output>`,
        consoleOutput: `\n[Outline failed: not found: ${outlinePath}]`
      };
    }

    const chunks = indexer.db.getChunksForFile(absPath);
    ui.hideToolProgress();
    ui.printToolResult('success', `Outlined ${outlinePath}`);

    if (chunks.length === 0) {
      const fileContent = fs.readFileSync(absPath, 'utf-8');
      const lines = fileContent.split('\n');
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nNo structural outline symbols indexed for this file type. Showing preview (first 50 lines):\n${lines.slice(0, 50).join('\n')}\n</tool_output>`,
        consoleOutput: `\n[Outline: no symbols found, preview shown]`
      };
    }

    const outline = chunks.map(c => `- [${c.chunk_type}] ${c.name} (Lines ${c.start_line}-${c.end_line})`).join('\n');
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nFile outline for ${outlinePath}:\n${outline}\n</tool_output>`,
      consoleOutput: `\n[Outline retrieved: ${outlinePath}]`
    };
  } catch (err: any) {
    ui.hideToolProgress();
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nError retrieving outline: ${err.message}\n</tool_output>`,
      consoleOutput: `\n[Outline failed: ${outlinePath}]`
    };
  }
}
