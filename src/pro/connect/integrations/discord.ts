import { disconnectService } from '../index.js';
import { getServiceToken } from '../../../core/tier.js';

/**
 * Retrieve Discord bot token from keychain (macOS) or encrypted vault (Linux).
 */
export function getDiscordToken(): string | null {
  return getServiceToken('discord-token') || getServiceToken('discord');
}

/**
 * Send a message to a Discord channel.
 */
export async function postDiscordMessage(channelId: string, content: string): Promise<any> {
  const token = getDiscordToken();
  if (!token) throw new Error('Discord is not connected. Use /connect discord first.');

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bot ${token}`
    },
    body: JSON.stringify({ content })
  });

  if (response.status === 401) {
    disconnectService('discord');
    disconnectService('discord-token');
    throw new Error('[Authentication Error] Stored token for discord is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect discord" to re-authenticate.');
  }

  if (!response.ok) {
    throw new Error(`Discord API error: Status ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Fetch recent messages from a Discord channel.
 */
export async function fetchDiscordMessages(channelId: string, limit = 10): Promise<any[]> {
  const token = getDiscordToken();
  if (!token) throw new Error('Discord is not connected. Use /connect discord first.');

  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bot ${token}`
    }
  });

  if (response.status === 401) {
    disconnectService('discord');
    disconnectService('discord-token');
    throw new Error('[Authentication Error] Stored token for discord is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect discord" to re-authenticate.');
  }

  if (!response.ok) {
    throw new Error(`Discord API error: Status ${response.status}`);
  }
  return (await response.json()) as any[];
}
