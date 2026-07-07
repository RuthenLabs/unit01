/**
 * src/core/tier.ts
 *
 * Single source of truth for free vs. pro tier detection.
 * Pro is active when the user has a 'pro-license' token in their keychain/vault,
 * OR when they have any premium search API key (Tavily, Exa, Jina, Serper).
 */

import * as path from 'path';
import * as fs from 'fs';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const CONFIG_DIR = path.join(homedir(), '.unit01');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface PlaintextConfig {
  tokens?: Record<string, string>;
}

export function loadPlaintextConfig(): PlaintextConfig {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

export function savePlaintextToken(service: string, token: string): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const conf = loadPlaintextConfig();
  if (!conf.tokens) conf.tokens = {};
  conf.tokens[service] = token;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });
}

export function deletePlaintextToken(service: string): void {
  const conf = loadPlaintextConfig();
  if (conf.tokens && conf.tokens[service]) {
    delete conf.tokens[service];
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });
  }
}

let _cachedIsPro: boolean | null = null;

export function isPro(): boolean {
  if (_cachedIsPro !== null) return _cachedIsPro;

  try {
    const filename = fileURLToPath(import.meta.url);
    const dirname = path.dirname(filename);
    const proPath = path.join(dirname, '../pro');
    if (fs.existsSync(proPath)) {
      _cachedIsPro = true;
      return true;
    }
  } catch (_) {}

  if (process.env.UNIT01_PRO === '1' || process.env.UNIT01_PRO === 'true') {
    _cachedIsPro = true;
    return true;
  }

  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process') as typeof import('child_process');
      const proLicense = (() => {
        try {
          return execSync('security find-generic-password -s "pro-license" -w 2>/dev/null', { stdio: 'pipe' }).toString().trim();
        } catch { return ''; }
      })();
      if (proLicense) { _cachedIsPro = true; return true; }

      const premiumKeys = ['tavily', 'exa', 'jina', 'serper'];
      for (const key of premiumKeys) {
        try {
          const val = execSync(`security find-generic-password -s "${key}" -w 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
          if (val) { _cachedIsPro = true; return true; }
        } catch {}
      }
    } catch {}
  }

  if (process.platform === 'linux') {
    try {
      const { execSync } = require('child_process') as typeof import('child_process');
      const check = (svc: string) => {
        try {
          const val = execSync(`secret-tool lookup service ${svc} 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
          return !!val;
        } catch { return false; }
      };
      if (check('pro-license') || check('tavily') || check('exa') || check('jina') || check('serper')) {
        _cachedIsPro = true;
        return true;
      }
    } catch {}
  }

  _cachedIsPro = false;
  return false;
}

export function getServiceToken(service: string): string | null {
  if (!isPro()) {
    const conf = loadPlaintextConfig();
    return conf.tokens?.[service] || conf.tokens?.[`${service}-token`] || null;
  }

  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process');
      const val = execSync(`security find-generic-password -s "${service}" -w 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (val) return val;
      const valToken = execSync(`security find-generic-password -s "${service}-token" -w 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (valToken) return valToken;
    } catch {}
  } else if (process.platform === 'linux') {
    try {
      const { execSync } = require('child_process');
      const val = execSync(`secret-tool lookup service ${service} 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (val) return val;
      const valToken = execSync(`secret-tool lookup service ${service}-token 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (valToken) return valToken;
    } catch {}
  }

  try {
    const vaultPath = path.join(homedir(), '.unit01', 'credentials.json');
    if (fs.existsSync(vaultPath)) {
      const { getCredential } = require('../pro/connect/vault.js');
      return getCredential(service) || getCredential(`${service}-token`) || null;
    }
  } catch {}

  const conf = loadPlaintextConfig();
  return conf.tokens?.[service] || conf.tokens?.[`${service}-token`] || null;
}

export function isServiceConnected(service: string): boolean {
  // 1. Check macOS Keychain
  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process');
      const val = execSync(`security find-generic-password -s "${service}" -w 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (val) return true;
      const valToken = execSync(`security find-generic-password -s "${service}-token" -w 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (valToken) return true;
    } catch {}
  }

  // 2. Check Linux Secret Service
  if (process.platform === 'linux') {
    try {
      const { execSync } = require('child_process');
      const val = execSync(`secret-tool lookup service ${service} 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (val) return true;
      const valToken = execSync(`secret-tool lookup service ${service}-token 2>/dev/null`, { stdio: 'pipe' }).toString().trim();
      if (valToken) return true;
    } catch {}
  }

  // 3. Check local encrypted Vault (credentials.json) without unlocking it
  try {
    const vaultPath = path.join(homedir(), '.unit01', 'credentials.json');
    if (fs.existsSync(vaultPath)) {
      const data = JSON.parse(fs.readFileSync(vaultPath, 'utf-8'));
      if (data && data.credentials) {
        if (data.credentials[service] !== undefined || data.credentials[`${service}-token`] !== undefined) {
          return true;
        }
      }
    }
  } catch {}

  // 4. Check plaintext config
  const conf = loadPlaintextConfig();
  const plainToken = conf.tokens?.[service] || conf.tokens?.[`${service}-token`] || null;
  return plainToken !== null && plainToken.trim().length > 0;
}

export const FREE_LIMITS = {
  MEMORY_DECISIONS:   3,
  MEMORY_CONVENTIONS: 5,
  AUTOPILOT_ITERATIONS: 1,
};
