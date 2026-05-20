# Lint & Format Check

## Description
Run linters and formatters on the codebase. Fix trivial issues automatically.

## Steps
1. Run linter: `npm run lint` (or `python -m pylint` / equivalent)
2. List issues found
3. For fixable issues, run formatter: `npm run format`
4. Re-run linter to confirm
5. Report results

## Trigger
User runs: `/lint-check`

## Output
Summary of issues found and fixed. List remaining manual fixes needed.
