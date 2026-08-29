import { themePrimary, themeOrange } from '../views/theme.js';
import { ToolContext, ToolResult } from './types.js';

export async function handleMcpTool(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const mcpMatch = /<mcp_tool[^>]+server=["']([^"']+)["'][^>]+name=["']([^"']+)["'][^>]*>([\/\s\S]*?)<\/mcp_tool>/.exec(text)
    || /<mcp_tool[^>]+name=["']([^"']+)["'][^>]+server=["']([^"']+)["'][^>]*>([\/\s\S]*?)<\/mcp_tool>/.exec(text);

  if (!mcpMatch) return null;

  const { ui } = ctx;
  const isServerFirst = text.includes('server=') && text.indexOf('server=') < text.indexOf('name=');
  const serverId  = isServerFirst ? mcpMatch[1] : mcpMatch[2];
  const toolName  = isServerFirst ? mcpMatch[2] : mcpMatch[1];
  const argsRaw   = (mcpMatch[3] || '').trim();

  let args: Record<string, any> = {};
  try {
    if (argsRaw) args = JSON.parse(argsRaw);
  } catch (_) {
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nMCP tool call error: arguments must be valid JSON.\n</tool_output>`,
      consoleOutput: `\n[MCP: invalid JSON args for ${toolName}]`
    };
  }

  ui.showToolProgress(`${themePrimary('mcp')} ${themeOrange(serverId)} › ${toolName}...`);

  try {
    const { McpClientManager } = await import('@unit01/core/mcp/client.js');
    const mcpManager = McpClientManager.getInstance();
    const result = await mcpManager.callTool(serverId, toolName, args);
    ui.hideToolProgress();

    if (result.success) {
      ui.printToolResult('success', `mcp: ${serverId} › ${toolName}`);
    } else {
      ui.printToolResult('failure', `mcp: ${serverId} › ${toolName} (error)`);
    }

    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${result.output}\n</tool_output>`,
      consoleOutput: `\n[MCP: ${serverId} › ${toolName}]`
    };
  } catch (err: any) {
    ui.hideToolProgress();
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nMCP error: ${err.message}\n</tool_output>`,
      consoleOutput: `\n[MCP error: ${err.message}]`
    };
  }
}

export async function handleThirdPartyIntegrations(text: string, ctx: ToolContext): Promise<ToolResult | null> {
  const integrations = [
    'github_get_pr', 'github_create_issue', 'github_create_pr', 'github_list_repos', 'github_get_contents', 'github_rename_repo',
    'slack_get_history', 'slack_post_message',
    'linear_get_teams', 'linear_get_issues', 'linear_create_issue',
    'sentry_get_orgs', 'sentry_get_issues', 'sentry_get_issue',
    'notion_get_page', 'notion_append_blocks'
  ];

  const matches = [...text.matchAll(/<([a-zA-Z0-9_]+)\b/g)];
  const matchedTag = integrations.find(tag => matches.some(m => m[1] === tag));
  if (!matchedTag) return null;

  const { ui } = ctx;

  const getAttr = (tag: string, attr: string): string => {
    const re = new RegExp(`<${tag}[^>]*\\b${attr}=["']([^"']*)["']`, 'i');
    const m = re.exec(text);
    return m ? m[1] : '';
  };

  const getBody = (tag: string): string => {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'i');
    const m = re.exec(text);
    if (m) return m[1].trim();

    const openRe = new RegExp(`<${tag}[^>]*>([\\s\\S]*)$`, 'i');
    const openMatch = openRe.exec(text);
    return openMatch ? openMatch[1].trim() : '';
  };

  const { isPro } = await import('@unit01/core/tier.js');
  if (!isPro()) {
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nError: Native integrations (${matchedTag}) are a Pro tier feature. Upgrade to Pro or configure MCP servers to perform these operations.\n</tool_output>`,
      consoleOutput: `\n[Integration blocked (Free tier limit): ${matchedTag}]`
    };
  }

  ui.showToolProgress(`Connecting service for ${matchedTag}...`);

  try {
    let output = '';
    switch (matchedTag) {
      case 'github_rename_repo': {
        const owner = getAttr('github_rename_repo', 'owner');
        const repo = getAttr('github_rename_repo', 'repo');
        const newName = getAttr('github_rename_repo', 'new_name');
        const { renameGitHubRepo } = await import('@unit01/pro/connect/integrations/github.js');
        const result = await renameGitHubRepo(owner, repo, newName);
        output = JSON.stringify(result, null, 2);
        break;
      }
      case 'github_get_contents': {
        const owner = getAttr('github_get_contents', 'owner');
        const repo = getAttr('github_get_contents', 'repo');
        const pathStr = getAttr('github_get_contents', 'path');
        const { fetchGitHubContents } = await import('@unit01/pro/connect/integrations/github.js');
        const contents = await fetchGitHubContents(owner, repo, pathStr);
        output = typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2);
        break;
      }
      case 'github_list_repos': {
        const { fetchGitHubRepos } = await import('@unit01/pro/connect/integrations/github.js');
        const repos = await fetchGitHubRepos();
        output = JSON.stringify(repos, null, 2);
        break;
      }
      case 'github_get_pr': {
        const owner = getAttr('github_get_pr', 'owner');
        const repo = getAttr('github_get_pr', 'repo');
        const number = parseInt(getAttr('github_get_pr', 'number'), 10);
        const { fetchGitHubPullRequest } = await import('@unit01/pro/connect/integrations/github.js');
        const pr = await fetchGitHubPullRequest(owner, repo, number);
        output = JSON.stringify(pr, null, 2);
        break;
      }
      case 'github_create_issue': {
        const owner = getAttr('github_create_issue', 'owner');
        const repo = getAttr('github_create_issue', 'repo');
        const title = getAttr('github_create_issue', 'title');
        const body = getBody('github_create_issue');
        const { createGitHubIssue } = await import('@unit01/pro/connect/integrations/github.js');
        const issue = await createGitHubIssue(owner, repo, title, body);
        output = JSON.stringify(issue, null, 2);
        break;
      }
      case 'github_create_pr': {
        const owner = getAttr('github_create_pr', 'owner');
        const repo = getAttr('github_create_pr', 'repo');
        const title = getAttr('github_create_pr', 'title');
        const head = getAttr('github_create_pr', 'head');
        const base = getAttr('github_create_pr', 'base');
        const body = getBody('github_create_pr');
        const { createGitHubPullRequest } = await import('@unit01/pro/connect/integrations/github.js');
        const pr = await createGitHubPullRequest(owner, repo, title, head, base, body);
        output = JSON.stringify(pr, null, 2);
        break;
      }
      case 'slack_get_history': {
        const channel = getAttr('slack_get_history', 'channel');
        const limitStr = getAttr('slack_get_history', 'limit');
        const limit = limitStr ? parseInt(limitStr, 10) : 10;
        const { fetchSlackMessages } = await import('@unit01/pro/connect/integrations/slack.js');
        const history = await fetchSlackMessages(channel, limit);
        if (history.length === 0) {
          output = `No messages found in Slack channel ${channel}.`;
        } else {
          output = history.map((m: any) => `[${m.user || 'User'}]: ${m.text}`).join('\n');
        }
        break;
      }
      case 'slack_post_message': {
        const channel = getAttr('slack_post_message', 'channel');
        const body = getBody('slack_post_message');
        const { postSlackMessage } = await import('@unit01/pro/connect/integrations/slack.js');
        const res = await postSlackMessage(channel, body);
        output = `Slack message posted successfully to channel ${channel} (TS: ${res.ts || 'unknown'}).`;
        break;
      }
      case 'linear_get_teams': {
        const { fetchLinearTeams } = await import('@unit01/pro/connect/integrations/linear.js');
        const teams = await fetchLinearTeams();
        if (teams.length === 0) {
          output = 'No Linear teams found in your workspace.';
        } else {
          output = teams.map((t: any) => `[${t.key}] ${t.name} (ID: ${t.id})`).join('\n');
        }
        break;
      }
      case 'linear_get_issues': {
        const teamId = getAttr('linear_get_issues', 'team_id');
        const limitStr = getAttr('linear_get_issues', 'limit');
        const limit = limitStr ? parseInt(limitStr, 10) : 10;
        const { fetchLinearIssues } = await import('@unit01/pro/connect/integrations/linear.js');
        const issues = await fetchLinearIssues(teamId || undefined, limit);
        if (issues.length === 0) {
          output = 'No issues found.';
        } else {
          output = issues.map((i: any) =>
            `[${i.identifier}] ${i.title} — ${i.state?.name || 'Unknown'} | Priority: ${i.priority} | Assignee: ${i.assignee?.name || 'Unassigned'}\n  ${i.url}`
          ).join('\n\n');
        }
        break;
      }
      case 'linear_create_issue': {
        const teamId = getAttr('linear_create_issue', 'team_id');
        const title = getAttr('linear_create_issue', 'title');
        const priorityStr = getAttr('linear_create_issue', 'priority');
        const priority = priorityStr ? parseInt(priorityStr, 10) : 0;
        const description = getBody('linear_create_issue');
        const { createLinearIssue } = await import('@unit01/pro/connect/integrations/linear.js');
        const issue = await createLinearIssue(title, description, teamId || undefined, priority);
        output = `Linear issue created successfully!\n  ID: ${issue.identifier}\n  Title: ${issue.title}\n  URL: ${issue.url}`;
        break;
      }
      case 'sentry_get_orgs': {
        const { fetchSentryOrganizations } = await import('@unit01/pro/connect/integrations/sentry.js');
        const orgs = await fetchSentryOrganizations();
        if (orgs.length === 0) {
          output = 'No Sentry organizations found.';
        } else {
          output = orgs.map((o: any) => `[${o.slug}] ${o.name}`).join('\n');
        }
        break;
      }
      case 'sentry_get_issues': {
        const orgSlug = getAttr('sentry_get_issues', 'org_slug');
        const projectSlug = getAttr('sentry_get_issues', 'project_slug');
        const limitStr = getAttr('sentry_get_issues', 'limit');
        const limit = limitStr ? parseInt(limitStr, 10) : 10;
        const { fetchSentryIssues } = await import('@unit01/pro/connect/integrations/sentry.js');
        const issues = await fetchSentryIssues(orgSlug || undefined, projectSlug || undefined, limit);
        if (issues.length === 0) {
          output = 'No unresolved Sentry issues found.';
        } else {
          output = issues.map((i: any) =>
            `[${i.level.toUpperCase()}] ${i.title}\n  Culprit: ${i.culprit}\n  Occurrences: ${i.count} | Users affected: ${i.userCount}\n  Last seen: ${i.lastSeen}\n  URL: ${i.url}`
          ).join('\n\n');
        }
        break;
      }
      case 'sentry_get_issue': {
        const issueId = getAttr('sentry_get_issue', 'issue_id');
        const { fetchSentryIssueDetails } = await import('@unit01/pro/connect/integrations/sentry.js');
        const issue = await fetchSentryIssueDetails(issueId);
        output = `[${issue.level.toUpperCase()}] ${issue.title}\nCulprit: ${issue.culprit}\nOccurrences: ${issue.count} | Users: ${issue.userCount}\nFirst seen: ${issue.firstSeen} | Last seen: ${issue.lastSeen}\nURL: ${issue.url}\n\nStack Trace (last 10 frames):\n${issue.stackTrace}`;
        break;
      }
      case 'notion_get_page': {
        const pageId = getAttr('notion_get_page', 'page_id');
        const { fetchNotionPage } = await import('@unit01/pro/connect/integrations/notion.js');
        const page = await fetchNotionPage(pageId);
        output = JSON.stringify(page, null, 2);
        break;
      }
      case 'notion_append_blocks': {
        const blockId = getAttr('notion_append_blocks', 'block_id');
        const body = getBody('notion_append_blocks');
        const { appendNotionBlocks } = await import('@unit01/pro/connect/integrations/notion.js');
        const children = JSON.parse(body);
        const res = await appendNotionBlocks(blockId, children);
        output = JSON.stringify(res, null, 2);
        break;
      }
    }

    ui.hideToolProgress();
    ui.printToolResult('success', `${matchedTag}`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${output}\n</tool_output>`,
      consoleOutput: `\n[Integration Success: ${matchedTag}]`
    };
  } catch (err: any) {
    ui.hideToolProgress();
    ui.printToolResult('failure', `${matchedTag}`);
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nIntegration Error: ${err.message}\n</tool_output>`,
      consoleOutput: `\n[Integration Failure: ${matchedTag} (${err.message})]`
    };
  }
}
