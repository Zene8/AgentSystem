# Agent Configuration Guide

## Overview
Three agent platforms configured for this project:

| Platform | Config | Purpose | Best For |
|----------|--------|---------|----------|
| **Antigravity CLI** | `.agents/rules/` | Google ecosystem, Firebase tasks | Workflows, async background work |
| **Claude Code** | `CLAUDE.md` | Anthropic agent | Complex refactors, PR management, multi-file changes |
| **GitHub Copilot** | `.github/agents/` | GitHub-native | Issue triage, delegation, CI/CD fixes |

## Quick Start by Platform

### Antigravity CLI (Google)
```bash
# Install
agy login

# Run a workflow
agy /lint-check

# List available workflows
agy workflows list
```

### Claude Code (Anthropic)
```bash
# Install
curl -fsSL https://claude.ai/install.sh | bash

# Start with your project
cd /path/to/project
claude
```

### GitHub Copilot CLI
```bash
# Authenticate
gh auth login

# Run Copilot CLI
gh copilot

# Get help
gh copilot -- --help
```

## When to Use Which Platform

| Task | Platform | Why |
|------|----------|-----|
| Fix linting errors | Antigravity (workflow) or Claude (hook) | Quick, automated |
| New feature with 3+ files | Claude Code | Best at multi-file refactors |
| Bug fix from GitHub issue | Copilot CLI | Native GitHub context |
| Run tests & report | Antigravity (workflow) | Fire-and-forget |
| Update docs | Copilot CLI or Antigravity | Less risky than code changes |

## Shared Rules
All agents follow `.agents/rules/` coding standards:
- No hardcoded secrets
- Write tests for new code
- Keep commits small and frequent
- YAGNI: don't over-engineer

## Troubleshooting

**"Agent is stuck"**
- Antigravity: Run `agy resume`
- Claude: Run `/stop` then restart session
- Copilot: Check GitHub Actions logs

**"Config changes not synced"**
- Antigravity: Changes sync instantly from desktop app
- Claude: Restart session or run `/clear` to reset context
- Copilot: Commit config changes and push

**"Credentials expired"**
- Antigravity: Run `agy login` again
- Claude: Run `claude login`
- Copilot: Run `gh auth refresh`
