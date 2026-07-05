export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
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
