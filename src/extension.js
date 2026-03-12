const vscode = require('vscode');
const { execSync } = require('child_process');
const path = require('path');

/**
 * Run a git command in the given working directory and return trimmed stdout.
 */
function git(args, cwd) {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8' }).trim();
}

/**
 * Parse a remote URL into { provider, baseUrl } for link construction.
 * Supports Azure DevOps (HTTPS + SSH) and GitHub/GitLab (HTTPS + SSH).
 */
function parseRemoteUrl(remoteUrl) {
  // Azure DevOps HTTPS: https://dev.azure.com/{org}/{project}/_git/{repo}
  let match = remoteUrl.match(/https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/);
  if (match) {
    return { provider: 'azuredevops', org: match[1], project: match[2], repo: match[3] };
  }

  // Azure DevOps HTTPS (old format): https://{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}
  match = remoteUrl.match(/https?:\/\/([^.]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/\s]+)/);
  if (match) {
    return { provider: 'azuredevops-old', org: match[1], project: match[2], repo: match[3] };
  }

  // Azure DevOps SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  match = remoteUrl.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+)/);
  if (match) {
    return { provider: 'azuredevops', org: match[1], project: match[2], repo: match[3] };
  }

  // Azure DevOps HTTPS with @dev.azure.com: https://{org}@dev.azure.com/{org}/{project}/_git/{repo}
  match = remoteUrl.match(/https?:\/\/[^@]+@dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+)/);
  if (match) {
    return { provider: 'azuredevops', org: match[1], project: match[2], repo: match[3] };
  }

  // GitHub HTTPS: https://github.com/{owner}/{repo}.git
  match = remoteUrl.match(/https?:\/\/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (match) {
    return { provider: 'github', owner: match[1], repo: match[2] };
  }

  // GitHub SSH: git@github.com:{owner}/{repo}.git
  match = remoteUrl.match(/git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (match) {
    return { provider: 'github', owner: match[1], repo: match[2] };
  }

  // GitLab HTTPS: https://gitlab.com/{owner}/{repo}.git
  match = remoteUrl.match(/https?:\/\/gitlab\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (match) {
    return { provider: 'gitlab', owner: match[1], repo: match[2] };
  }

  // GitLab SSH: git@gitlab.com:{owner}/{repo}.git
  match = remoteUrl.match(/git@gitlab\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (match) {
    return { provider: 'gitlab', owner: match[1], repo: match[2] };
  }

  return null;
}

/**
 * Build the remote URL for a file + line selection.
 */
function buildRemoteLink(parsed, branch, relativePath, startLine, endLine) {
  // Normalize path separators to forward slashes
  const filePath = relativePath.replace(/\\/g, '/');

  switch (parsed.provider) {
    case 'azuredevops': {
      let url = `https://dev.azure.com/${parsed.org}/${parsed.project}/_git/${parsed.repo}?path=/${filePath}&version=GB${encodeURIComponent(branch)}`;
      if (startLine != null) {
        url += `&line=${startLine}&lineEnd=${endLine}&lineStartColumn=1&lineEndColumn=1000`;
      }
      return url;
    }
    case 'azuredevops-old': {
      let url = `https://${parsed.org}.visualstudio.com/${parsed.project}/_git/${parsed.repo}?path=/${filePath}&version=GB${encodeURIComponent(branch)}`;
      if (startLine != null) {
        url += `&line=${startLine}&lineEnd=${endLine}&lineStartColumn=1&lineEndColumn=1000`;
      }
      return url;
    }
    case 'github': {
      let url = `https://github.com/${parsed.owner}/${parsed.repo}/blob/${encodeURIComponent(branch)}/${filePath}`;
      if (startLine != null) {
        url += startLine === endLine ? `#L${startLine}` : `#L${startLine}-L${endLine}`;
      }
      return url;
    }
    case 'gitlab': {
      let url = `https://gitlab.com/${parsed.owner}/${parsed.repo}/-/blob/${encodeURIComponent(branch)}/${filePath}`;
      if (startLine != null) {
        url += startLine === endLine ? `#L${startLine}` : `#L${startLine}-${endLine}`;
      }
      return url;
    }
    default:
      return null;
  }
}

function activate(context) {
  const disposable = vscode.commands.registerCommand('copyRemoteLink.copyLink', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor.');
      return;
    }

    const filePath = editor.document.uri.fsPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('File is not inside a workspace folder.');
      return;
    }

    const repoRoot = workspaceFolder.uri.fsPath;

    try {
      // 1. Get current branch
      let branch;
      try {
        branch = git('rev-parse --abbrev-ref HEAD', repoRoot);
      } catch {
        vscode.window.showErrorMessage('Could not determine the current Git branch.');
        return;
      }

      if (branch === 'HEAD') {
        vscode.window.showWarningMessage('You are in detached HEAD state. Please checkout a branch first.');
        return;
      }

      // 2. Check if branch is up to date with origin (using local tracking info — no network call)
      let behindCount = 0;
      try {
        const status = git(`rev-list --left-right --count origin/${branch}...HEAD`, repoRoot);
        const parts = status.split(/\s+/);
        behindCount = parseInt(parts[0], 10) || 0;
      } catch {
        // Remote tracking branch may not exist - that's okay for new branches
      }

      // 3. Check for uncommitted changes in the current file
      let hasUncommittedChanges = false;
      try {
        const fileStatus = git(`status --porcelain -- "${filePath}"`, repoRoot);
        hasUncommittedChanges = fileStatus.length > 0;
      } catch {
        // Ignore status check errors
      }

      // Show warnings inline (non-blocking) instead of modal dialogs
      if (behindCount > 0) {
        vscode.window.showWarningMessage(
          `Branch '${branch}' is ${behindCount} commit(s) behind origin (based on last fetch).`
        );
      }
      if (hasUncommittedChanges) {
        vscode.window.showWarningMessage('This file has uncommitted changes. The remote version may differ.');
      }

      // Fire a background fetch so tracking info is fresh for next invocation
      const { exec } = require('child_process');
      exec('git fetch origin', { cwd: repoRoot });

      // 4. Get remote URL
      let remoteUrl;
      try {
        remoteUrl = git('remote get-url origin', repoRoot);
      } catch {
        vscode.window.showErrorMessage('No "origin" remote found.');
        return;
      }

      const parsed = parseRemoteUrl(remoteUrl);
      if (!parsed) {
        vscode.window.showErrorMessage(`Unsupported remote URL format: ${remoteUrl}`);
        return;
      }

      // 5. Build relative path from repo root
      const relativePath = path.relative(repoRoot, filePath);

      // 6. Get line selection (1-based)
      const selection = editor.selection;
      const startLine = selection.start.line + 1;
      const endLine = selection.end.line + 1;

      // 7. Build and copy link
      const link = buildRemoteLink(parsed, branch, relativePath, startLine, endLine);
      if (!link) {
        vscode.window.showErrorMessage('Could not build remote link.');
        return;
      }

      await vscode.env.clipboard.writeText(link);
      vscode.window.showInformationMessage(`Remote link copied to clipboard!`);

    } catch (err) {
      vscode.window.showErrorMessage(`Error: ${err.message}`);
    }
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
