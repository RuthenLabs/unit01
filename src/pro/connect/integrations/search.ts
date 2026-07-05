import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { getServiceToken } from '../../../core/tier.js';

const FREE_QUOTA_FILE = path.join(homedir(), '.unit01', 'free_search_quota.json');
const themeAccent = chalk.hex('#38BDF8');

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface QuotaData {
  date: string;
  count: number;
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
export async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const response = await fetch('https://lite.duckduckgo.com/lite/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: `q=${encodeURIComponent(query)}`
    });

    if (!response.ok) throw new Error(`DDG response status ${response.status}`);
    const html = await response.text();
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
      if (results.length >= 5) break;
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
async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query: query,
      num_results: 5
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
async function searchExa(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({
      query: query,
      numResults: 5,
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
async function searchSerper(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey
    },
    body: JSON.stringify({ q: query, num: 5 })
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
 * Scrape URL content into clean markdown format using Jina Reader API.
 */
async function scrapeWithJina(url: string, apiKey: string): Promise<string> {
  const response = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`
    }
  });
  if (!response.ok) {
    return '';
  }
  const text = await response.text();
  return text.substring(0, 1000); // Return first 1000 characters of clean Markdown
}

/**
 * Executive search gateway logic.
 * Handles free daily search limits, checks for premium API keys, and routes search requests.
 */
export async function executeWebSearch(query: string): Promise<SearchResult[]> {
  const proLicense = getServiceToken('pro-license');
  const tavilyKey = getServiceToken('tavily');
  const exaKey = getServiceToken('exa');
  const jinaKey = getServiceToken('jina');
  const serperKey = getServiceToken('serper');

  const isPro = !!(proLicense || tavilyKey || exaKey || jinaKey || serperKey);

  // Free Tier Daily search limit enforcement
  if (!isPro) {
    const quota = checkFreeQuota();
    if (!quota.allowed) {
      return [{
        title: "Free Tier Limit Reached",
        url: "https://unit01.dev/upgrade",
        snippet: `⚠️ Daily search limit reached (11/11). Please upgrade to Pro or configure a custom API Key (Tavily/Exa/Jina/Serper) under /connect to unlock unlimited search.`
      }];
    }
    incrementFreeQuota();
  }

  try {
    if (isPro) {
      if (tavilyKey) {
        return await searchTavily(query, tavilyKey);
      }
      if (exaKey) {
        return await searchExa(query, exaKey);
      }
      if (serperKey) {
        return await searchSerper(query, serperKey);
      }
      if (jinaKey) {
        // Enriched DuckDuckGo results using Jina URL-to-Markdown scraper
        const ddgResults = await searchDuckDuckGo(query);
        const enriched = await Promise.all(ddgResults.slice(0, 2).map(async (r) => {
          try {
            const fullContent = await scrapeWithJina(r.url, jinaKey);
            if (fullContent) {
              return {
                title: r.title,
                url: r.url,
                snippet: `${r.snippet}\n\n[Jina Scraped Content]:\n${fullContent}`
              };
            }
          } catch (_) {}
          return r;
        }));
        return [...enriched, ...ddgResults.slice(2)];
      }
    }

    // Default search connection
    return await searchDuckDuckGo(query);
  } catch (err: any) {
    console.warn(chalk.yellow(`Search API failed — falling back to DuckDuckGo. Error: ${err}`));
    return await searchDuckDuckGo(query);
  }
}
