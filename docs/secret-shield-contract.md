# secret-shield module contract (issue #222)

Repo rules that bind every file here:
- Node builtins ONLY. No npm deps.
- Files under `hooks/` are **CommonJS** (`hooks/package.json` declares it). Use `require`.
- Files under `tools/` are **ESM**. To use a hooks lib from a tool, use `createRequire`
  (see `tools/session-bulk-rename.js` for the existing pattern).
- `tools/deploy-hooks.js` `buildManifest()` copies `hooks/lib/*` with a FLAT readdir. It does
  NOT recurse. So every shared module lives flat: `hooks/lib/secret-shield-<name>.cjs`.
- Never render a secret value in a log line, error message, or thrown message. Compare and
  report by hash or by placeholder only. `hooks/guard-secrets.js` is the reference for this.

## hooks/lib/secret-shield-detect.cjs

```js
detect(text, opts = {}) -> Array<Detection>
// Detection = { start, end, value, type, detector, confidence }
// - byte-index-free: start/end are JS string indices, end exclusive
// - NON-OVERLAPPING and sorted ascending by start. When two patterns match overlapping
//   ranges, the longer match wins; on equal length, the higher-confidence one wins.
// - detector: 'pattern' | 'entropy'
// - confidence: 'high' | 'medium'
// opts: { detectors?: string[] (type allowlist), entropy?: boolean (default true) }
```

Types (exact strings, used to build placeholders):
`SECRET_AWS_ACCESS_KEY`, `SECRET_AWS_SECRET_KEY`, `SECRET_GCP_KEY`, `SECRET_AZURE_KEY`,
`SECRET_GITHUB_TOKEN`, `SECRET_SLACK_TOKEN`, `SECRET_STRIPE_KEY`, `SECRET_OPENAI_KEY`,
`SECRET_ANTHROPIC_KEY`, `SECRET_PEM_PRIVATE_KEY`, `SECRET_JWT`, `SECRET_CONNECTION_STRING`,
`SECRET_ENTROPY`, `PII_SSN`, `PII_CARD`, `PII_EMAIL`, `PII_PHONE`, `PII_DOB`, `PHI_MRN`.

Also export: `PATTERNS` (array of `{type, re, confidence}`), `luhn(digits) -> boolean`,
`shannonEntropy(str) -> number`.

## hooks/lib/secret-shield-vault.cjs

```js
openVault({ project, home }) -> Vault
// Vault = {
//   allocate(value, type) -> placeholder   // deterministic + idempotent per (value)
//   lookup(placeholder) -> value | null
//   placeholderFor(value) -> placeholder | null
//   list() -> Array<{ placeholder, type, valueSha256, firstSeen, len }>   // NEVER the value
//   forget(placeholder) -> boolean
//   path -> string
//   close() -> void   // flush
// }
```
- Placeholder format: `__<TYPE>_<NN>__`, `NN` zero-padded 2+ digits, counter per type per vault.
- Same value -> same placeholder forever (index keyed by sha256 of value).
- Storage: `<home>/.claude/secret-shield/<project>.vault`, AES-256-GCM, key at
  `<home>/.claude/secret-shield/vault.key` (32 random bytes, created on first use).
- Dir mode 700, files mode 600. On win32 `chmod` is a no-op — attempt it anyway and record the
  platform limitation in a comment; do not claim POSIX permissions on Windows.
- FAIL CLOSED: a vault file that exists but does not decrypt or authenticate THROWS. Never
  silently start a fresh vault over it (that would hand out a placeholder already meaning
  something else).
- `home` defaults to `os.homedir()`; tests override it.

## hooks/lib/secret-shield-config.cjs

```js
loadConfig(cwd, env = process.env) -> Config
// Config = {
//   enabled: boolean            // default true
//   mode: 'obfuscate'           // only mode implemented; 'local-route' is out of scope (#222 Mode 2)
//   detectors: string[] | null  // null = all
//   entropy: boolean            // default true
//   rehydrate: boolean          // default FALSE — opt-in per project
//   allowUnshielded: boolean    // default false; env SECRET_SHIELD_ALLOW_UNSHIELDED=1 sets it
//   failClosed: boolean         // default true
//   localModel: { enabled: boolean, url: string|null, model: string|null }  // enabled default false
//   pathRules: Array<{ glob: string, action: 'route-local'|'skip' }>        // parsed, not enforced here
//   project: string             // slug of the project, used for the vault filename
// }
```
- Source: `<cwd>/.secret-shield.json`, shallow-merged over defaults. Malformed JSON with
  `failClosed` default true -> THROW (the caller decides how to fail).
- `project` slug: `path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-')` (same scheme
  `tools/session-namer.js` uses for project dirs).

## hooks/lib/secret-shield-redact.cjs

Exports `{ MAX_DEPTH, PLACEHOLDER_RE, sweepKnown, redactString, redactShape, rehydrateString,
rehydrateShape, appendAudit, shieldDir }`.

- `redactShape(value, vault, config) -> { value, replacements, truncated }` — walks any structure and
  returns the **same shape** with only string leaves rewritten. `truncated: true` means the depth cap
  (`MAX_DEPTH = 12`) was hit and bytes went unexamined; a fail-closed caller must treat that as a
  failure, not as "probably fine".
- `rehydrateShape(value, vault) -> { value, used, unknown }`.
- `appendAudit(line, home)` appends to `<home>/.claude/secret-shield/audit.jsonl`, recording the
  **placeholder and type, never the value**. Best-effort: it never throws into the caller.

## Verified hook IO contract, and the two things it forces

Checked against the hook docs while building this, because both points change the design:

1. **`tool_response` is an object whose fields differ per tool** — Bash `{stdout, stderr, exit_code}`,
   Read `{file_contents}`, Write/Edit `{file_path, file_size, …}`, Grep
   `{matches:[{file_path,line_number,line_content}], pattern}`, WebFetch `{url,status,headers,body}`
   — and an **MCP response is a bare ARRAY of content blocks**, not an object wrapper. The docs do
   not say whether `updatedToolOutput` must be a plain string or must mirror the native shape, so
   the shield never assumes: `redactShape()` preserves the shape and rewrites string leaves only.
   Correct under either reading, and no per-tool table to fall out of date when a tool is added.
2. **Only exit 0 with valid JSON applies `updatedToolOutput`.** Exit 1, exit 3+, a crash, or
   malformed stdout all mean the ORIGINAL, UNREDACTED result is used. So a PostToolUse hook that
   throws fails **wide open**. `secret-shield-hook.js` therefore catches everything and
   `process.exit(0)` on every path, and on any internal failure emits a shape-preserving BLANKED
   result rather than staying silent.

`UserPromptSubmit` has **no prompt-rewrite field** — a secret typed into a prompt cannot be
intercepted by a hook at all. That is why #236 (local proxy) stays parked rather than being folded
in here.

PostToolUse also **fires inside subagents** (`agent_id` / `agent_type` are present), so subagent tool
results are covered by the same registration with no extra wiring.

## vault.knownValues() and the egress sweep (added after the first draft of this contract)

`knownValues() -> [{ value, placeholder, type }]`, sorted longest value first, WITH plaintext —
unlike `list()`, which backs a user-facing CLI and never returns a value.

This exists because the detectors are **contextual**. `AWS_SECRET_ACCESS_KEY=<v>` matches;
a bare `<v>` alone on stdout matches nothing. So a value rehydrated into a shell command comes back
in that command's stdout unrecognised and leaks. `sweepKnown()` closes that by construction: once a
value is in the vault it can never appear in a tool result again, in any context, pattern or no
pattern. `redactString()` runs detectors first, then the sweep over the result.

The same reasoning forces a detector rule: a context-anchored pattern must **narrow its match to
capture group 1** when it has one, so the vault learns `<v>` and not `AWS_SECRET_ACCESS_KEY=<v>`.
Store the labelled form and `sweepKnown` never matches the bare secret. Both defects were found by
`the leak test` in `hooks/secret-shield-hook.test.js`, which asserts the full round trip: real secret
reaches the shell, the command works, and its output returns with zero bytes of the secret and the
same placeholder. If that test ever fails, `rehydrate` is a net loss and must be turned off.
