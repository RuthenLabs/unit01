import {
  saveToKeychain,
  getFromKeychain,
  deleteFromKeychain,
  isSecretToolAvailable,
  saveToSecretTool,
  getFromSecretTool,
  deleteFromSecretTool
} from './keychain.js';
import { saveCredential, getCredential, deleteCredential, vaultExists } from './vault.js';

/**
 * Perform a test query against the service API to validate the token.
 * Prevents saving invalid keys to the local vault/keychain.
 */
export async function validateServiceToken(service: string, token: string): Promise<boolean> {
  try {
    switch (service.toLowerCase()) {
      case 'github': {
        const res = await fetch('https://api.github.com/user', {
          headers: {
            'Accept': 'application/vnd.github+json',
            'Authorization': `Bearer ${token}`,
            'X-GitHub-Api-Version': '2022-11-28'
          }
        });
        return res.ok;
      }
      case 'slack': {
        const res = await fetch('https://slack.com/api/auth.test', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`
          }
        });
        const data = (await res.json()) as any;
        return res.ok && data.ok === true;
      }
      case 'discord': {
        const res = await fetch('https://discord.com/api/v10/users/@me', {
          headers: {
            'Authorization': `Bot ${token}`
          }
        });
        return res.ok;
      }
      case 'telegram': {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = (await res.json()) as any;
        return res.ok && data.ok === true;
      }
      case 'notion': {
        const res = await fetch('https://api.notion.com/v1/users/me', {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28'
          }
        });
        return res.ok;
      }
      case 'tavily': {
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: token, query: 'test', num_results: 1 })
        });
        return res.ok;
      }
      case 'exa': {
        const res = await fetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': token
          },
          body: JSON.stringify({ query: 'test', numResults: 1 })
        });
        return res.ok;
      }
      case 'jina': {
        const res = await fetch('https://r.jina.ai/https://example.com', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        return res.ok;
      }
      case 'serper': {
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': token
          },
          body: JSON.stringify({ q: 'test', num: 1 })
        });
        return res.ok;
      }
      case 'pro-license': {
        return token.startsWith('unit01-pro-') || token.trim().length > 10;
      }
      default:
        return true; // Auto-pass for un-validated services
    }
  } catch (_) {
    return false;
  }
}

/**
 * Save a validated credential key to OS Keychain or encrypted local Vault.
 */
export async function connectService(service: string, token: string): Promise<void> {
  const isValid = await validateServiceToken(service, token);
  if (!isValid) {
    throw new Error(`Failed to validate token for ${service}. Please check your credentials.`);
  }

  if (process.platform === 'darwin') {
    saveToKeychain(service, token);
  } else if (isSecretToolAvailable()) {
    saveToSecretTool(service, token);
  } else {
    saveCredential(service, token);
  }
}

/**
 * Check if a service credentials token is active on this machine.
 */
export function isServiceConnected(service: string): boolean {
  let token: string | null = null;
  if (process.platform === 'darwin') {
    token = getFromKeychain(service);
  } else if (isSecretToolAvailable()) {
    token = getFromSecretTool(service);
  } else {
    if (!vaultExists()) return false;
    try {
      token = getCredential(service);
    } catch (_) {
      return false; // Vault is locked or empty
    }
  }
  return token !== null && token.trim().length > 0;
}

/**
 * Delete service credentials and drop tokens.
 */
export function disconnectService(service: string): void {
  if (process.platform === 'darwin') {
    deleteFromKeychain(service);
  } else if (isSecretToolAvailable()) {
    deleteFromSecretTool(service);
  } else {
    try {
      deleteCredential(service);
    } catch (_) {}
  }
}

export { isSecretToolAvailable } from './keychain.js';
