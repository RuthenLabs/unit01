import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { disconnectService } from '../index.js';
import { getServiceToken } from '../../../core/tier.js';

const GLOBAL_CONFIG_FILE = path.join(homedir(), '.unit01', 'config.json');

export function getCachedSlackChannel(): string | null {
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      const conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
      if (conf?.last_slack_channel) return conf.last_slack_channel as string;
    }
  } catch {}
  return null;
}

export function setCachedSlackChannel(channel: string): void {
  if (!channel) return;
  const dir = path.dirname(GLOBAL_CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let conf: Record<string, any> = {};
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  conf.last_slack_channel = channel;
  fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });
}

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
  let activeChannel = channel ? channel.trim() : getCachedSlackChannel();
  if (!activeChannel) {
    throw new Error('No Slack channel ID provided, and no last-used channel was found in history. Please specify a channel ID (e.g. channel="C0BFZ9D7MGW").');
  }
  setCachedSlackChannel(activeChannel);

  const token = getSlackToken();
  if (!token) throw new Error('Slack is not connected. Use /connect slack first.');

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      channel: activeChannel,
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
  let activeChannel = channel ? channel.trim() : getCachedSlackChannel();
  if (!activeChannel) {
    throw new Error('No Slack channel ID provided, and no last-used channel was found in history. Please specify a channel ID.');
  }
  setCachedSlackChannel(activeChannel);

  const token = getSlackToken();
  if (!token) throw new Error('Slack is not connected. Use /connect slack first.');

  const response = await fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(activeChannel)}&limit=${limit}`, {
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
  let activeChannel = channel ? channel.trim() : getCachedSlackChannel();
  if (!activeChannel) {
    throw new Error('No Slack channel ID provided, and no last-used channel was found in history. Please specify a channel ID.');
  }
  setCachedSlackChannel(activeChannel);

  const token = getSlackToken();
  if (!token) throw new Error('Slack is not connected. Use /connect slack first.');

  const response = await fetch(`https://slack.com/api/conversations.replies?channel=${encodeURIComponent(activeChannel)}&ts=${encodeURIComponent(threadTs)}&limit=${limit}`, {
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
