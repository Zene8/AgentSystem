# System Instructions for Agent

## Core Behavior
- Write terse, direct responses. No fluff.
- Prefer existing patterns in codebase over inventing new ones.
- Before refactoring: ask if it's worth it. YAGNI applies.
- All code changes need corresponding tests.
- Commits: small, frequent, with clear messages.

## When Stuck
- Read existing error messages completely before guessing.
- Check git log for similar changes.
- Ask for clarification rather than guessing user intent.

## Security First
- No hardcoded secrets in code.
- Validate at system boundaries only (user input, external APIs).
- Never bypass permission checks with --no-verify flags.
