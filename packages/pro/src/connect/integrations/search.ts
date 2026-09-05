import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { getServiceToken } from '@unit01/core/tier.js';

const FREE_QUOTA_FILE = path.join(homedir(), '.unit01', 'free_search_quota.json');
const GLOBAL_CONFIG_FILE = path.join(homedir(), '.unit01', 'config.json');

// ── Fetch timeout helper (10 seconds) ────────────────────────────────────────
function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface QuotaData {
  date: string;
  count: number;
}

// ── Search provider preference ────────────────────────────────────────────────
// Stored in ~/.unit01/config.json as { "search_provider": "tavily" }
// Valid values: "tavily" | "brave" | "exa" | "serper" | "duckduckgo"

export function getSearchProvider(): string {
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      const conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
      if (conf?.search_provider) return conf.search_provider as string;
    }
  } catch {}
  return 'auto'; // auto = use whichever key is connected, prefer first connected
}

export function setSearchProvider(provider: string): void {
  const validProviders = ['tavily', 'brave', 'exa', 'serper', 'duckduckgo', 'auto'];
  if (!validProviders.includes(provider)) {
    throw new Error(`Invalid provider "${provider}". Valid options: ${validProviders.join(', ')}`);
  }
  const dir = path.dirname(GLOBAL_CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let conf: Record<string, any> = {};
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  conf.search_provider = provider;
  fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });
}

export function getSearchLimit(): number {
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      const conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
      if (typeof conf?.search_limit === 'number') return conf.search_limit;
    }
  } catch {}
  return 5; // Default limit
}

export function setSearchLimit(limit: number): void {
  if (limit < 1 || limit > 20) {
    throw new Error('Search limit must be between 1 and 20.');
  }
  const dir = path.dirname(GLOBAL_CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let conf: Record<string, any> = {};
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  conf.search_limit = limit;
  fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });
}

/**
 * Helper to check the free tier daily search limit (11 searches/day).
 */
function checkFreeQuota(): { allowed: boolean; count: number } {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let data: QuotaData = { date: today, count: 0 };

  try {
    if (fs.existsSync(FREE_QUOTA_FILE)) {
      data = JSON.parse(fs.readFileSync(FREE_QUOTA_FILE, 'utf8')) as QuotaData;
    }
  } catch (e) {
    // Ignore read errors, overwrite if corrupt
  }

  if (data.date !== today) {
    data.date = today;
    data.count = 0;
  }

  if (data.count >= 11) {
    return { allowed: false, count: data.count };
  }

  return { allowed: true, count: data.count };
}

/**
 * Increment the free tier daily search count.
 */
function incrementFreeQuota(): void {
  const today = new Date().toISOString().split('T')[0];
  let data: QuotaData = { date: today, count: 0 };

  try {
    if (fs.existsSync(FREE_QUOTA_FILE)) {
      data = JSON.parse(fs.readFileSync(FREE_QUOTA_FILE, 'utf8')) as QuotaData;
    }
  } catch (e) {}

  if (data.date !== today) {
    data.date = today;
    data.count = 0;
  }

  data.count += 1;

  try {
    const dir = path.dirname(FREE_QUOTA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FREE_QUOTA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {}
}

/**
 * Fetch search results using DuckDuckGo Lite.
 */
export async function searchDuckDuckGo(query: string, limit = 5): Promise<SearchResult[]> {
  try {
    const response = await fetchWithTimeout('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: `q=${encodeURIComponent(query)}`
    });

    if (!response.ok) throw new Error(`DDG response status ${response.status}`);
    const html = await response.text();
    
    if (html.includes('anomaly-modal') || html.includes('anomaly.js') || html.includes('bots use DuckDuckGo too')) {
      return [{
        title: "DuckDuckGo CAPTCHA Triggered",
        url: "https://unit01.dev/upgrade",
        snippet: "⚠️ Fallback search failed because DuckDuckGo blocked the request with a bot CAPTCHA. Please configure a custom search API key (Tavily, Brave, Exa, Serper) using /connect to unlock reliable web search."
      }];
    }
    
    const results: SearchResult[] = [];

    const linkMatches: { url: string; title: string }[] = [];
    const linkRegex = /<a\s+[^>]*class=['"]result-link['"][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>|<a\s+[^>]*href=["']([^"']+)["'][^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const url = (match[1] || match[3] || '').trim();
      const title = (match[2] || match[4] || '').replace(/<[^>]*>/g, '').trim();
      linkMatches.push({ url, title });
    }

    const snippetMatches: string[] = [];
    const snippetRegex = /<td\s+[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
    while ((match = snippetRegex.exec(html)) !== null) {
      snippetMatches.push(match[1].replace(/<[^>]*>/g, '').trim());
    }

    for (let i = 0; i < Math.min(linkMatches.length, snippetMatches.length); i++) {
      if (results.length >= limit) break;
      const href = linkMatches[i].url;
      if (href.startsWith('http')) {
        results.push({
          title: linkMatches[i].title,
          url: href,
          snippet: snippetMatches[i].substring(0, 300)
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('[DDG Search] Failed to query DuckDuckGo:', error);
    return [];
  }
}

/**
 * Fetch search results using Tavily Search API.
 */
async function searchTavily(query: string, apiKey: string, limit = 5): Promise<SearchResult[]> {
  const response = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      num_results: limit
    })
  });
  if (!response.ok) {
    throw new Error(`Tavily API returned status ${response.status}`);
  }
  const data = (await response.json()) as any;
  const results = data.results || [];
  return results.map((r: any) => ({
    title: r.title || 'Untitled',
    url: r.url || '',
    snippet: r.content || ''
  }));
}

/**
 * Fetch search results using Exa API.
 */
async function searchExa(query: string, apiKey: string, limit = 5): Promise<SearchResult[]> {
  const response = await fetchWithTimeout('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({
      query: query,
      numResults: limit,
      highlights: true
    })
  });
  if (!response.ok) {
    throw new Error(`Exa API returned status ${response.status}`);
  }
  const data = (await response.json()) as any;
  const results = data.results || [];
  return results.map((r: any) => {
    const highlightText = r.highlights && r.highlights.length > 0 ? r.highlights.join(' ... ') : '';
    return {
      title: r.title || 'Untitled',
      url: r.url || '',
      snippet: highlightText || r.text || ''
    };
  });
}

/**
 * Fetch search results using Serper.dev API.
 */
async function searchSerper(query: string, apiKey: string, limit = 5): Promise<SearchResult[]> {
  const response = await fetchWithTimeout('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ q: query, num: limit })
  });
  if (!response.ok) {
    throw new Error(`Serper API returned status ${response.status}`);
  }
  const data = (await response.json()) as any;
  const organic = data.organic || [];
  return organic.map((r: any) => ({
    title: r.title || 'Untitled',
    url: r.link || '',
    snippet: r.snippet || ''
  }));
}

/**
 * Fetch search results using Brave Search API.
 */
async function searchBrave(query: string, apiKey: string, limit = 5): Promise<SearchResult[]> {
  const response = await fetchWithTimeout(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey
    }
  });
  if (!response.ok) {
    throw new Error(`Brave Search API status ${response.status}`);
  }
  const data = await response.json() as any;
  const results = data.web?.results || [];
  return results.map((r: any) => ({
    title: r.title || 'Untitled',
    url: r.url || '',
    snippet: r.description || ''
  }));
}

/**
 * Scrape URL content into clean markdown format using Jina Reader API.
 * NOTE: Jina is a scraper only — NOT used for web search anymore.
 * It's kept here exclusively for the fetch_webpage tool.
 */
export async function scrapeWithJina(url: string, apiKey: string): Promise<string> {
  const response = await fetchWithTimeout(`https://r.jina.ai/${url}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  }, 15000); // Jina can be slower, give it 15s
  if (!response.ok) {
    return '';
  }
  return await response.text(); // No cap — return full content, context compressor handles it downstream
}

/**
 * Execute webpage content fetching (using Jina, or clean HTML fallback).
 */
export async function executeFetchWebpage(url: string): Promise<string> {
  const jinaKey = getServiceToken('jina');
  if (jinaKey) {
    try {
      const content = await scrapeWithJina(url, jinaKey);
      if (content) return content;
    } catch (_) {}
  }

  // ── High-speed TypeScript HTML Fallback ──
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) throw new Error(`HTTP status ${response.status}`);
    const text = await response.text();
    const clean = text
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return clean.substring(0, 4000);
  } catch (err: any) {
    return `Failed to fetch webpage: ${err.message}`;
  }
}

/**
 * Execute a web search using the user's chosen provider.
 * Supports API keys (Tavily, Brave, Exa, Serper), or DuckDuckGo fallback.
 */
export async function executeWebSearch(query: string): Promise<SearchResult[]> {
  const tavilyKey = getServiceToken('tavily');
  const braveKey  = getServiceToken('brave');
  const exaKey    = getServiceToken('exa');
  const serperKey = getServiceToken('serper');

  const hasAnyKey = !!(tavilyKey || braveKey || exaKey || serperKey);
  const searchLimit = getSearchLimit();
  const chosenProvider = getSearchProvider();

  // ── Zero-key mode: Fallback to DuckDuckGo lite with free daily quota check ──
  if (!hasAnyKey) {
    const quota = checkFreeQuota();
    if (!quota.allowed) {
      return [{
        title: "Free Tier Limit Reached",
        url: "https://unit01.dev/upgrade",
        snippet: `⚠️ Daily search limit reached (11/11). Please upgrade to Pro or configure a custom API Key (Tavily/Brave/Exa/Serper) under /connect to unlock unlimited search.`
      }];
    }
    incrementFreeQuota();
    return await searchDuckDuckGo(query, searchLimit);
  }

  // ── User-selected provider with connected API keys ──
  const runProvider = async (provider: string): Promise<SearchResult[] | null> => {
    try {
      switch (provider) {
        case 'tavily':    return tavilyKey  ? await searchTavily(query, tavilyKey, searchLimit)   : null;
        case 'brave':     return braveKey   ? await searchBrave(query, braveKey, searchLimit)     : null;
        case 'exa':       return exaKey     ? await searchExa(query, exaKey, searchLimit)         : null;
        case 'serper':    return serperKey  ? await searchSerper(query, serperKey, searchLimit)   : null;
        default:          return null;
      }
    } catch (err: any) {
      console.warn(chalk.yellow(`[Search] Provider "${provider}" failed: ${err.message}`));
      return null;
    }
  };

  // Explicit provider set — run it directly, no waterfall
  if (chosenProvider !== 'auto' && chosenProvider !== 'duckduckgo') {
    const results = await runProvider(chosenProvider);
    if (results) return results;
    console.warn(chalk.yellow(`[Search] Configured provider "${chosenProvider}" failed or key not connected. Falling back to DuckDuckGo.`));
    return await searchDuckDuckGo(query, searchLimit);
  }

  // "auto" mode — use whichever single key is connected
  if (tavilyKey)  { const r = await runProvider('tavily');  if (r) return r; }
  if (braveKey)   { const r = await runProvider('brave');   if (r) return r; }
  if (exaKey)     { const r = await runProvider('exa');     if (r) return r; }
  if (serperKey)  { const r = await runProvider('serper');  if (r) return r; }

  return await searchDuckDuckGo(query, searchLimit);
}


