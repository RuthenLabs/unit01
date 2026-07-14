import { disconnectService } from '../index.js';
import { getServiceToken } from '../../../core/tier.js';

/**
 * Retrieve Notion integration token from keychain (macOS) or encrypted vault (Linux).
 */
export function getNotionToken(): string | null {
  return getServiceToken('notion-token') || getServiceToken('notion');
}

/**
 * Append content blocks (e.g. paragraphs, headings) as children to a Notion block/page.
 */
export async function appendNotionBlocks(blockId: string, children: any[]): Promise<any> {
  const token = getNotionToken();
  if (!token) throw new Error('Notion is not connected. Use /connect notion first.');

  const response = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ children })
  });

  if (response.status === 401) {
    disconnectService('notion');
    disconnectService('notion-token');
    throw new Error('[Authentication Error] Stored token for notion is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect notion" to re-authenticate.');
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Notion API error: Status ${response.status} - ${errText}`);
  }
  return await response.json();
}

/**
 * Fetch a single page from Notion.
 */
export async function fetchNotionPage(pageId: string): Promise<any> {
  const token = getNotionToken();
  if (!token) throw new Error('Notion is not connected. Use /connect notion first.');

  const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28'
    }
  });

  if (response.status === 401) {
    disconnectService('notion');
    disconnectService('notion-token');
    throw new Error('[Authentication Error] Stored token for notion is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect notion" to re-authenticate.');
  }

  if (!response.ok) {
    throw new Error(`Notion API error: Status ${response.status}`);
  }
  return await response.json();
}
