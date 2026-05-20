# Review Pull Request

## Description
Analyze current PR against coding standards. Check for common issues.

## Steps
1. Get current branch name (assumes PR branch)
2. Check: tests exist and pass
3. Check: no console.log/print statements left in code
4. Check: no hardcoded values or secrets
5. Check: commit messages are clear
6. List findings

## Trigger
User runs: `/review-pr`

## Output
Checklist of review findings. Approve or request changes.
