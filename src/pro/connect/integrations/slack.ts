import { disconnectService } from '../index.js';
import { getServiceToken } from '../../../core/tier.js';

/**
 * Retrieve Slack token from keychain (macOS) or encrypted vault (Linux).
 */
export function getSlackToken(): string | null {
  return getServiceToken('slack-token') || getServiceToken('slack');
}

/**
 * Send a message or thread reply to a Slack channel/DM.
 */
export async function postSlackMessage(channel: string, text: string, threadTs?: string): Promise<any> {
  const token = getSlackToken();
  if (!token) throw new Error('Slack is not connected. Use /connect slack first.');

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs
    })
  });

  if (response.status === 401) {
    disconnectService('slack');
    disconnectService('slack-token');
    throw new Error('[Authentication Error] Stored token for slack is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect slack" to re-authenticate.');
  }

  const data = (await response.json()) as any;
  if (!data.ok) {
    if (data.error === 'invalid_auth') {
      disconnectService('slack');
      disconnectService('slack-token');
      throw new Error('[Authentication Error] Stored token for slack is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect slack" to re-authenticate.');
    }
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data;
}

/**
 * Fetch recent message history from a Slack channel.
 */
export async function fetchSlackMessages(channel: string, limit = 10): Promise<any[]> {
  const token = getSlackToken();
  if (!token) throw new Error('Slack is not connected. Use /connect slack first.');

  const response = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel)}&limit=${limit}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (response.status === 401) {
    disconnectService('slack');
    disconnectService('slack-token');
    throw new Error('[Authentication Error] Stored token for slack is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect slack" to re-authenticate.');
  }

  const data = (await response.json()) as any;
  if (!data.ok) {
    if (data.error === 'invalid_auth') {
      disconnectService('slack');
      disconnectService('slack-token');
      throw new Error('[Authentication Error] Stored token for slack is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect slack" to re-authenticate.');
    }
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data.messages || [];
}

/**
 * Fetch thread replies for a specific message thread.
 */
export async function fetchSlackReplies(channel: string, threadTs: string, limit = 10): Promise<any[]> {
  const token = getSlackToken();
  if (!token) throw new Error('Slack is not connected. Use /connect slack first.');

  const response = await fetch(`https://slack.com/api/conversations.replies?channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(threadTs)}&limit=${limit}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (response.status === 401) {
    disconnectService('slack');
    disconnectService('slack-token');
    throw new Error('[Authentication Error] Stored token for slack is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect slack" to re-authenticate.');
  }

  const data = (await response.json()) as any;
  if (!data.ok) {
    if (data.error === 'invalid_auth') {
      disconnectService('slack');
      disconnectService('slack-token');
      throw new Error('[Authentication Error] Stored token for slack is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect slack" to re-authenticate.');
    }
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data.messages || [];
}
