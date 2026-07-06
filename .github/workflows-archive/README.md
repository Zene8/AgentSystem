# Archived workflows

Parked to save GitHub Actions minutes. Restore by moving back to `.github/workflows/`.

- `memory-consistency.yml` — tested deprecated `.agents/memory/*.md` files (see #117); ubuntu-latest on every .agents push.
- `sync-verification.yml` — weekly ubuntu-latest sync check; redundant with `node tools/sync-agents.js` + sync.log.
