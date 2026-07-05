import { disconnectService } from '../index.js';
import { getServiceToken } from '../../../core/tier.js';

/**
 * Retrieve GitHub token from keychain (macOS) or encrypted vault (Linux).
 */
export function getGitHubToken(): string | null {
  return getServiceToken('github-token') || getServiceToken('github');
}

/**
 * Create a new issue in a GitHub repository.
 */
export async function createGitHubIssue(owner: string, repo: string, title: string, body: string): Promise<any> {
  const token = getGitHubToken();
  if (!token) throw new Error('GitHub is not connected. Use /connect github first.');

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title, body })
  });

  if (response.status === 401) {
    disconnectService('github');
    disconnectService('github-token');
    throw new Error('[Authentication Error] Stored token for github is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect github" to re-authenticate.');
  }

  if (!response.ok) {
    throw new Error(`GitHub API error: Status ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Create a new Pull Request.
 */
export async function createGitHubPullRequest(
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string,
  body?: string
): Promise<any> {
  const token = getGitHubToken();
  if (!token) throw new Error('GitHub is not connected. Use /connect github first.');

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ title, head, base, body })
  });

  if (response.status === 401) {
    disconnectService('github');
    disconnectService('github-token');
    throw new Error('[Authentication Error] Stored token for github is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect github" to re-authenticate.');
  }

  if (!response.ok) {
    const errorDetails = await response.text();
    throw new Error(`GitHub PR API error: Status ${response.status} - ${errorDetails}`);
  }
  return await response.json();
}

/**
 * Get details of a Pull Request (including diff info).
 */
export async function fetchGitHubPullRequest(owner: string, repo: string, pullNumber: number): Promise<any> {
  const token = getGitHubToken();
  if (!token) throw new Error('GitHub is not connected. Use /connect github first.');

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pullNumber}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });

  if (response.status === 401) {
    disconnectService('github');
    disconnectService('github-token');
    throw new Error('[Authentication Error] Stored token for github is invalid or expired. We have cleared it from your secure vault/keychain. Please run "/connect github" to re-authenticate.');
  }

  if (!response.ok) {
    throw new Error(`GitHub PR API error: Status ${response.status}`);
  }
  return await response.json();
}
