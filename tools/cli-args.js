// cli-args.js — shared CLI flag guard for tools/ scripts that touch live memory data.
// Pure Node builtins only (tools/ rule).
//
// Usage:
//   import { parseFlags } from './cli-args.js';
//   const flags = parseFlags(process.argv.slice(2), {
//     usage: 'Usage: node tools/foo.js [--dry-run] [--quiet]',
//     allowed: ['dry-run', 'quiet'],
//   });
//   if (flags === null) return; // --help was printed, or unknown flag — caller should exit(0)/(2)
//
// Behavior:
//  - `-h` / `--help` → prints usage, returns null (caller exits 0)
//  - any `--flag` not in `allowed` → prints usage + error, returns null (caller exits 2)
//  - never executes the script's side-effecting logic on an unrecognized flag

export function parseFlags(argv, { usage, allowed = [] }) {
  const allowedSet = new Set(allowed);
  const flags = {};
  for (const a of argv) {
    if (a === '-h' || a === '--help') {
      console.log(usage);
      return null;
    }
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) continue; // positional args (e.g. transcript path) are the caller's concern
    const [, name, value] = m;
    if (!allowedSet.has(name)) {
      console.error(`Unknown flag: --${name}\n${usage}`);
      return null;
    }
    flags[name] = value ?? true;
  }
  return flags;
}

// Convenience: run parseFlags and process.exit() appropriately if it failed/help'd.
// Returns the flags object only on success (never returns null).
export function parseFlagsOrExit(argv, opts) {
  const hadHelp = argv.includes('-h') || argv.includes('--help');
  const flags = parseFlags(argv, opts);
  if (flags === null) {
    process.exit(hadHelp ? 0 : 2);
  }
  return flags;
}
