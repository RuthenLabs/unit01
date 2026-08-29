import { isPro } from '@unit01/core/tier.js';
import { themeAccent, isGui, guiEmit } from '../views/theme.js';
import { parseWebSearch, parseFetchWebpage } from '../parser.js';
import { ToolContext, ToolResult } from './types.js';

export async function handleWebSearch(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const webSearchQuery = parseWebSearch(text);
  if (webSearchQuery === null) return null;

  const { ui, indexer } = ctx;
  const query = webSearchQuery.trim();
  if (isGui) guiEmit({ type: 'tool-call', tool: 'web_search', query });

  if (!query) {
    ui.printToolResult('failure', `Web searched "${query}" (blocked: empty query)`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nError: Search query cannot be empty.\n</tool_output>`,
      consoleOutput: `\n[Web search blocked: empty query]`
    };
  }

  ui.showToolProgress(`${themeAccent('web_search')} "${query}"...`);
  
  let results: any[] = [];
  if (isPro()) {
    try {
      const { executeWebSearch } = await import('@unit01/pro/connect/integrations/search.js');
      results = await executeWebSearch(query);
    } catch (e: any) {
      results = [];
    }
  } else {
    results = [];
  }

  ui.hideToolProgress();
  ui.printToolResult('success', `Web searched "${query}" (${results.length} results)`);

  const formatted = results.map(r => 
    `- ${r.title} (${r.url}):\n  ${r.snippet}`
  ).join('\n\n');

  if (isPro()) {
    try {
      const crypto = await import('crypto');
      const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
      const auditStore = new AuditLogStore(indexer.db);
      const payloadHash = crypto.createHash('sha256').update(query).digest('hex');
      auditStore.logAction({
        service: 'web-search',
        operation: 'search',
        target: query,
        payload_summary: `Found ${results.length} snippets`,
        payload_hash: payloadHash,
        status: 'completed'
      });
    } catch (_) {}
  }

  return {
    toolRun: true,
    nextPrompt: `<tool_output>\nWeb search results for "${query}":\n${formatted || 'No results found'}\n</tool_output>`,
    consoleOutput: `\n[Web search executed: "${query}"]`
  };
}

export async function handleFetchWebpage(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const fetchWebpageUrl = parseFetchWebpage(text);
  if (fetchWebpageUrl === null) return null;

  const { ui, indexer } = ctx;
  const url = fetchWebpageUrl.trim();
  if (isGui) guiEmit({ type: 'tool-call', tool: 'fetch_webpage', url });

  if (!url) {
    ui.printToolResult('failure', `Fetched webpage (blocked: empty URL)`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nError: URL cannot be empty.\n</tool_output>`,
      consoleOutput: `\n[Fetch webpage blocked: empty URL]`
    };
  }

  ui.showToolProgress(`${themeAccent('fetch_webpage')} ${url}...`);

  let pageContent = '';
  if (isPro()) {
    try {
      const { executeFetchWebpage } = await import('@unit01/pro/connect/integrations/search.js');
      pageContent = await executeFetchWebpage(url);
    } catch (e: any) {
      pageContent = `Failed to fetch webpage content: ${e.message}`;
    }
  } else {
    pageContent = `Failed to fetch webpage content: The read_url_content tool is a Pro tier feature.`;
  }

  ui.hideToolProgress();
  ui.printToolResult('success', `Fetched webpage: ${url}`);

  if (isPro()) {
    try {
      const crypto = await import('crypto');
      const { AuditLogStore } = await import('@unit01/pro/audit/index.js');
      const auditStore = new AuditLogStore(indexer.db);
      const payloadHash = crypto.createHash('sha256').update(url).digest('hex');
      auditStore.logAction({
        service: 'web-fetch',
        operation: 'fetch',
        target: url,
        payload_summary: `Fetched ${pageContent.length} chars`,
        payload_hash: payloadHash,
        status: 'completed'
      });
    } catch (_) {}
  }

  return {
    toolRun: true,
    nextPrompt: `<tool_output>\nContent of ${url}:\n${pageContent}\n</tool_output>`,
    consoleOutput: `\n[Fetched webpage: "${url}"]`
  };
}
