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
    const vaultPath = path.join(homedir(), '.unit01', 'vault.enc');
    if (fs.existsSync(vaultPath)) {
      const { getCredential } = require('../pro/connect/vault.js');
      return getCredential(service) || getCredential(`${service}-token`) || null;
    }
  } catch {}

  const conf = loadPlaintextConfig();
  return conf.tokens?.[service] || conf.tokens?.[`${service}-token`] || null;
}

export const FREE_LIMITS = {
  MEMORY_DECISIONS:   3,
  MEMORY_CONVENTIONS: 5,
  AUTOPILOT_ITERATIONS: 1,
};
