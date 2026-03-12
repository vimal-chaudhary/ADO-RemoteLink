# Copy Remote Link

Copy a shareable link to code directly from VS Code that opens in your remote repository (Azure DevOps, GitHub, GitLab).

## Install

```bash
git clone https://github.com/vimal-chaudhary/ADO-RemoteLink.git
```

**Windows:**
```powershell
Copy-Item -Recurse copy-remote-link "$env:USERPROFILE\.vscode\extensions\local.copy-remote-link-1.0.0"
```

**macOS / Linux:**
```bash
cp -r copy-remote-link ~/.vscode/extensions/local.copy-remote-link-1.0.0
```

Reload VS Code (`Ctrl+Shift+P` → `Developer: Reload Window`).

## Use

Right-click in any editor → **Copy Remote Link**

The URL for the current file, branch, and selected lines is copied to your clipboard.
