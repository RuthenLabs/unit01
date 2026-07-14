import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { disconnectService } from '../index.js';
import { getServiceToken } from '../../../core/tier.js';

const GLOBAL_CONFIG_FILE = path.join(homedir(), '.unit01', 'config.json');
const LINEAR_API = 'https://api.linear.app/graphql';

// ── Config helpers ────────────────────────────────────────────────────────────

export function getLinearToken(): string | null {
  return getServiceToken('linear-token') || getServiceToken('linear');
}

export function getCachedLinearTeam(): string | null {
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      const conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
      if (conf?.last_linear_team) return conf.last_linear_team as string;
    }
  } catch {}
  return null;
}

export function setCachedLinearTeam(teamId: string): void {
  if (!teamId) return;
  const dir = path.dirname(GLOBAL_CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let conf: Record<string, any> = {};
  try {
    if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
      conf = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  conf.last_linear_team = teamId;
  fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(conf, null, 2), { mode: 0o600 });
}

// ── Core GraphQL executor ────────────────────────────────────────────────────

async function linearQuery(query: string, variables?: Record<string, any>): Promise<any> {
  const token = getLinearToken();
  if (!token) throw new Error('Linear is not connected. Use /connect linear first.');

  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token
    },
    body: JSON.stringify({ query, variables })
  });

  if (response.status === 401) {
    disconnectService('linear');
    disconnectService('linear-token');
    throw new Error('[Authentication Error] Stored Linear token is invalid or expired. Run "/connect linear" to re-authenticate.');
  }

  const data = (await response.json()) as any;
  if (data.errors?.length) {
    throw new Error(`Linear API error: ${data.errors[0].message}`);
  }
  return data.data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * List all teams in the Linear workspace.
 */
export async function fetchLinearTeams(): Promise<{ id: string; name: string; key: string }[]> {
  const data = await linearQuery(`
    query {
      teams {
        nodes { id name key }
      }
    }
  `);
  return data.teams.nodes;
}

/**
 * Fetch recent issues for a team. Defaults to the last-used team.
 */
export async function fetchLinearIssues(teamId?: string, limit = 10): Promise<any[]> {
  const activeTeam = teamId?.trim() || getCachedLinearTeam();
  if (!activeTeam) {
    throw new Error('No Linear team ID provided and no last-used team found. Use linear_get_teams first, then specify a team_id.');
  }
  setCachedLinearTeam(activeTeam);

  const data = await linearQuery(
    `query($teamId: String!, $first: Int!) {
      issues(filter: { team: { id: { eq: $teamId } } }, first: $first, orderBy: updatedAt) {
        nodes {
          id
          identifier
          title
          state { name }
          priority
          assignee { name }
          url
          createdAt
        }
      }
    }`,
    { teamId: activeTeam, first: limit }
  );
  return data.issues.nodes;
}

/**
 * Create a new issue in Linear. Defaults to the last-used team.
 */
export async function createLinearIssue(
  title: string,
  description: string,
  teamId?: string,
  priority?: number
): Promise<any> {
  const activeTeam = teamId?.trim() || getCachedLinearTeam();
  if (!activeTeam) {
    throw new Error('No Linear team ID provided and no last-used team found. Use linear_get_teams first, then specify a team_id.');
  }
  setCachedLinearTeam(activeTeam);

  const data = await linearQuery(
    `mutation($title: String!, $description: String, $teamId: String!, $priority: Int) {
      issueCreate(input: { title: $title, description: $description, teamId: $teamId, priority: $priority }) {
        success
        issue { id identifier title url }
      }
    }`,
    { title, description, teamId: activeTeam, priority: priority ?? 0 }
  );

  if (!data.issueCreate.success) {
    throw new Error('Failed to create Linear issue.');
  }
  return data.issueCreate.issue;
}
