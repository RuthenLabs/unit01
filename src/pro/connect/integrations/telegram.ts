import { disconnectService } from '../index.js';
import { getServiceToken } from '../../../core/tier.js';

/**
 * Retrieve Telegram token from keychain (macOS) or encrypted vault (Linux).
 */
export function getTelegramToken(): string | null {
  return getServiceToken('telegram-token') || getServiceToken('telegram');
}

/**
 * Send a message to a Telegram group, channel, or user.
 */
export async function postTelegramMessage(chatId: string, text: string): Promise<any> {
  const token = getTelegramToken();
  if (!token) throw new Error('Telegram is not connected. Use /connect telegram first.');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown'
    })
  });

  if (response.status === 401) {
    disconnectService('telegram');
    disconnectService('telegram-token');
    throw new Error('[Authentication Error] Stored token for telegram is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect telegram" to re-authenticate.');
  }

  const data = (await response.json()) as any;
  if (!data.ok) {
    if (data.error_code === 401 || data.description === 'Unauthorized' || data.description?.includes('invalid')) {
      disconnectService('telegram');
      disconnectService('telegram-token');
      throw new Error('[Authentication Error] Stored token for telegram is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect telegram" to re-authenticate.');
    }
    throw new Error(`Telegram API error: ${data.description}`);
  }
  return data.result;
}

/**
 * Fetch bot updates (recent messages/alerts sent to the bot).
 */
export async function fetchTelegramUpdates(limit = 10): Promise<any[]> {
  const token = getTelegramToken();
  if (!token) throw new Error('Telegram is not connected. Use /connect telegram first.');

  const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=${limit}`, {
    method: 'GET'
  });

  if (response.status === 401) {
    disconnectService('telegram');
    disconnectService('telegram-token');
    throw new Error('[Authentication Error] Stored token for telegram is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect telegram" to re-authenticate.');
  }

  const data = (await response.json()) as any;
  if (!data.ok) {
    if (data.error_code === 401 || data.description === 'Unauthorized' || data.description?.includes('invalid')) {
      disconnectService('telegram');
      disconnectService('telegram-token');
      throw new Error('[Authentication Error] Stored token for telegram is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect telegram" to re-authenticate.');
    }
    throw new Error(`Telegram API error: ${data.description}`);
  }
  return data.result || [];
}
