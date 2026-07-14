import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { disconnectService } from '../index.js';
import { getServiceToken } from '../../../core/tier.js';

const GLOBAL_CONFIG_FILE = path.join(homedir(), '.unit01', 'config.json');
const SENTRY_API = 'https://sentry.io/api/0';

// ── Config helpers ────────────────────────────────────────────────────────────

export function getSentryToken(): string | null {
  return getServiceToken('sentry-token') || getServiceToken('sentry');
}

export function getCachedSentryOrg(): string | null {
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      const conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
      if (conf?.last_sentry_org) return conf.last_sentry_org as string;
    }
  } catch {}
  return null;
}

export function setCachedSentryOrg(orgSlug: string): void {
  if (!orgSlug) return;
  const dir = path.dirname(GLOBAL_CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let conf: Record<string, any> = {};
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  conf.last_sentry_org = orgSlug;
  fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });
}

// ── Core fetch helper ─────────────────────────────────────────────────────────

async function sentryFetch(endpoint: string): Promise<any> {
  const token = getSentryToken();
  if (!token) throw new Error('Sentry is not connected. Use /connect sentry first.');

  const response = await fetch(`${SENTRY_API}${endpoint}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (response.status === 401 || response.status === 403) {
    disconnectService('sentry');
    disconnectService('sentry-token');
    throw new Error('[Authentication Error] Stored Sentry token is invalid or expired. Run "/connect sentry" to re-authenticate.');
  }

  if (!response.ok) {
    throw new Error(`Sentry API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List all organizations the token has access to.
 */
export async function fetchSentryOrganizations(): Promise<{ slug: string; name: string }[]> {
  const data = await sentryFetch('/organizations/');
  return (data as any[]).map((org: any) => ({ slug: org.slug, name: org.name }));
}

/**
 * Fetch recent error issues from a Sentry organization.
 * Defaults to last-used org slug.
 */
export async function fetchSentryIssues(orgSlug?: string, projectSlug?: string, limit = 10): Promise<any[]> {
  const activeOrg = orgSlug?.trim() || getCachedSentryOrg();
  if (!activeOrg) {
    throw new Error('No Sentry organization slug provided and no last-used org found. Use sentry_get_orgs first, then specify org_slug.');
  }
  setCachedSentryOrg(activeOrg);

  const projectFilter = projectSlug ? `&project=${encodeURIComponent(projectSlug)}` : '';
  const data = await sentryFetch(
    `/organizations/${encodeURIComponent(activeOrg)}/issues/?limit=${limit}&query=is:unresolved${projectFilter}`
  );

  return (data as any[]).map((issue: any) => ({
    id: issue.id,
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level,
    count: issue.count,
    userCount: issue.userCount,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    url: issue.permalink
  }));
}

/**
 * Fetch full details + stack trace for a specific Sentry issue by ID.
 */
export async function fetchSentryIssueDetails(issueId: string): Promise<any> {
  const token = getSentryToken();
  if (!token) throw new Error('Sentry is not connected. Use /connect sentry first.');

  // Fetch issue metadata
  const issue = await sentryFetch(`/issues/${encodeURIComponent(issueId)}/`);

  // Fetch latest event with stack trace
  const events = await sentryFetch(`/issues/${encodeURIComponent(issueId)}/events/?limit=1&full=true`);
  const latestEvent = (events as any[])[0];

  let stackTrace = 'No stack trace available.';
  if (latestEvent?.entries) {
    const exEntry = latestEvent.entries.find((e: any) => e.type === 'exception');
    if (exEntry?.data?.values?.length) {
      const exc = exEntry.data.values[0];
      stackTrace = exc.stacktrace?.frames
        ?.slice(-10)
        ?.map((f: any) => `  at ${f.function || '?'} (${f.filename}:${f.lineNo})`)
        ?.join('\n') || stackTrace;
    }
  }

  return {
    id: issue.id,
    title: issue.title,
    culprit: issue.culprit,
    level: issue.level,
    count: issue.count,
    userCount: issue.userCount,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    url: issue.permalink,
    stackTrace
  };
}
