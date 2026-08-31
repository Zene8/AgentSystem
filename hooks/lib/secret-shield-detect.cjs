'use strict';
// secret-shield-detect.cjs — pure pattern/entropy detector for secrets and PHI/PII in free text.
// Contract: docs/secret-shield-contract.md
//
// detect(text, opts = {}) -> Array<{ start, end, value, type, detector, confidence }>
// - start/end are JS string indices (UTF-16 code units), end exclusive.
// - Output is sorted ascending by start, and ranges are NON-OVERLAPPING: when two candidate
//   matches overlap, the longer span wins; on equal length, the higher-confidence one wins
//   ('high' beats 'medium').
// - detector: 'pattern' | 'entropy'
// - confidence: 'high' | 'medium'
//
// Never render a secret value in a log line, error message, or thrown message — this module
// only ever returns matched substrings to its caller, never writes them anywhere itself. See
// hooks/guard-secrets.js for the house rule this follows.
//
// Node builtins only. CommonJS (hooks/package.json declares the whole hooks/ tree CommonJS).

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------------------------
// PATTERNS — each entry: { type, re, confidence }
// Every regex below carries a 'g' flag (required for matchAll) and is bounded/anchored enough
// to avoid firing on ordinary source code. Fixtures proving that live in the test file, including
// a run of detect() over hooks/guard-secrets.js itself.
// ---------------------------------------------------------------------------------------------

const PATTERNS = [
  // --- cloud / vendor secrets -------------------------------------------------------------
  {
    type: 'SECRET_AWS_ACCESS_KEY',
    // AKIA/ASIA + 16 upper/digit chars is the fixed AWS access-key-id shape.
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_AWS_SECRET_KEY',
    // AWS secret access keys have no fixed prefix, so we require an explicit assignment
    // context (aws_secret_access_key = ..., or similar) to avoid matching arbitrary base64.
    re: /\baws[_-]?secret[_-]?access[_-]?key\b\s*[:=]\s*["']?([A-Za-z0-9/+]{40})["']?/gi,
    confidence: 'high',
  },
  {
    type: 'SECRET_GCP_KEY',
    // Google API keys: fixed "AIza" prefix + 35 URL-safe chars.
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_AZURE_KEY',
    // Azure storage/connection-string style: AccountKey=<base64, 80+ chars, often ending in ==>.
    re: /\bAccountKey\s*=\s*[A-Za-z0-9+/]{60,}={0,2}/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_GITHUB_TOKEN',
    // ghp_/gho_/ghu_/ghs_/ghr_ + 36 alnum is the current GitHub PAT/token shape.
    re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_SLACK_TOKEN',
    // xoxb-/xoxa-/xoxp-/xoxr-/xoxs- followed by dash-separated digit/alnum groups.
    re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_STRIPE_KEY',
    // sk_live_/pk_live_/rk_live_ + 24+ alnum. Test-mode sk_test_ is deliberately excluded —
    // those keys aren't sensitive in the same way and including them would just add noise.
    re: /\b[sprk]k_live_[A-Za-z0-9]{24,}\b/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_OPENAI_KEY',
    // sk-... (48 alnum) classic form, and the newer sk-proj-... form.
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_ANTHROPIC_KEY',
    // sk-ant-api03-<long base64url>-<checksum>
    re: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{20,}\b/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_PEM_PRIVATE_KEY',
    // Whole PEM block, any of the common private-key headers/footers.
    re: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |ENCRYPTED |DSA )?PRIVATE KEY-----/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_JWT',
    // Three base64url segments separated by dots; header segment must decode-shape-like start
    // with 'ey' (base64 of '{"') to avoid matching arbitrary dotted strings.
    re: /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    confidence: 'high',
  },
  {
    type: 'SECRET_CONNECTION_STRING',
    // scheme://user:password@host — inline credentials in a DB/service URL.
    re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|amqps):\/\/[^\s:/@'"]+:[^\s@'"]+@[^\s/'"]+/g,
    confidence: 'high',
  },

  // --- PII / PHI ----------------------------------------------------------------------------
  {
    type: 'PII_SSN',
    // 123-45-6789. Excludes the all-zero groups the SSA never issues, to cut obvious false
    // positives (000-xx-xxxx, xx-00-xxxx, xx-xxxx-0000) without needing a full validity table.
    re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    confidence: 'high',
  },
  {
    type: 'PII_CARD',
    // 13-19 digits, optionally grouped by spaces/dashes in 4s. Luhn-checked below in `detect`;
    // the pattern itself only narrows candidates.
    re: /\b(?:\d[ -]?){13,19}\b/g,
    confidence: 'medium',
  },
  {
    type: 'PII_EMAIL',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: 'high',
  },
  {
    type: 'PII_PHONE',
    // US-style phone: optional +1, area code, exchange, line number, common separators.
    re: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
    confidence: 'medium',
  },
  {
    type: 'PII_DOB',
    // Explicit DOB context: "DOB 1974-03-02" / "DOB: 03/02/1974" / "date of birth 1974-03-02".
    re: /\b(?:DOB|date of birth)\s*[:\-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/gi,
    confidence: 'high',
  },
  {
    type: 'PHI_MRN',
    // Explicit MRN context: "MRN 4482910" / "MRN: 4482910" / "medical record number 4482910".
    re: /\b(?:MRN|medical record (?:number|#))\s*[:#]?\s*(\d{5,12})\b/gi,
    confidence: 'high',
  },
];

// ---------------------------------------------------------------------------------------------
// luhn — standard mod-10 checksum for candidate card numbers. Digits only (strip separators
// before calling).
// ---------------------------------------------------------------------------------------------
function luhn(digits) {
  const s = String(digits).replace(/\D/g, '');
  if (s.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------------------------
// shannonEntropy — bits of entropy per character (base-2 Shannon entropy over the character
// frequency distribution of `str`).
// ---------------------------------------------------------------------------------------------
function shannonEntropy(str) {
  const s = String(str);
  if (s.length === 0) return 0;
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Entropy detector gating (false-positive discipline, per the epic): only fire on a line that
// looks like an assignment to a key/token/secret/password/credential-shaped name, or a
// .env-shaped `NAME=value` line. A bare high-entropy string sitting in prose is never flagged.
const ENTROPY_LINE_RE =
  /(?:^|[\s;])([A-Za-z_][A-Za-z0-9_]*(?:key|token|secret|password|pwd|credential)[A-Za-z0-9_]*)\s*[:=]\s*['"]?([A-Za-z0-9+/_.=-]{20,})['"]?/gi;

const ENTROPY_MIN_LEN = 20;
const ENTROPY_MIN_BITS = 3.5; // bits/char threshold; ordinary English prose sits well below this.

function findEntropyCandidates(text) {
  const out = [];
  ENTROPY_LINE_RE.lastIndex = 0;
  let m;
  while ((m = ENTROPY_LINE_RE.exec(text))) {
    const value = m[2];
    if (value.length < ENTROPY_MIN_LEN) continue;
    const bits = shannonEntropy(value);
    if (bits < ENTROPY_MIN_BITS) continue;
    const start = m.index + m[0].indexOf(value, m[1].length);
    out.push({
      start,
      end: start + value.length,
      value,
      type: 'SECRET_ENTROPY',
      detector: 'entropy',
      confidence: 'medium',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// detect
// ---------------------------------------------------------------------------------------------
function detect(text, opts = {}) {
  const src = String(text == null ? '' : text);
  const allow = Array.isArray(opts.detectors) ? new Set(opts.detectors) : null;
  const entropyOn = opts.entropy !== false;

  let candidates = [];

  for (const { type, re, confidence } of PATTERNS) {
    if (allow && !allow.has(type)) continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (type === 'PII_CARD') {
        if (!luhn(m[0])) continue;
      }
      // A context-anchored pattern (aws_secret_access_key = <v>, connection strings, DOB labels)
      // matches the LABEL plus the secret, but only the secret is the secret. Where such a pattern
      // provides capture group 1, that group is the value and the match is narrowed to it.
      //
      // This is load-bearing, not cosmetic. The vault is keyed by value, and the egress sweep in
      // secret-shield-redact.cjs replaces known values literally — so if the vault learns
      // `AWS_SECRET_ACCESS_KEY=<v>` instead of `<v>`, the same secret appearing bare on stdout
      // matches nothing and leaks. It also keeps the redacted text readable: the model sees
      // `AWS_SECRET_ACCESS_KEY=__SECRET_AWS_SECRET_KEY_01__` rather than the whole assignment
      // disappearing into one opaque token. Caught by `the leak test`.
      let start = m.index;
      let value = m[0];
      if (m.length > 1 && typeof m[1] === 'string' && m[1].length > 0) {
        const offset = m[0].indexOf(m[1]);
        if (offset !== -1) {
          start = m.index + offset;
          value = m[1];
        }
      }
      candidates.push({
        start,
        end: start + value.length,
        value,
        type,
        detector: 'pattern',
        confidence,
      });
    }
  }

  if (entropyOn && (!allow || allow.has('SECRET_ENTROPY'))) {
    candidates.push(...findEntropyCandidates(src));
  }

  // Resolve overlaps: longer match wins; on equal length, higher confidence wins. Sort candidates
  // by that priority (NOT by start) and greedily keep each one that doesn't overlap anything
  // already kept, so a longer-but-later-starting match correctly beats a shorter earlier one.
  const confRank = { high: 1, medium: 0 };
  candidates.sort((a, b) => {
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenA !== lenB) return lenB - lenA;
    const confDiff = (confRank[b.confidence] || 0) - (confRank[a.confidence] || 0);
    if (confDiff !== 0) return confDiff;
    return a.start - b.start;
  });

  const kept = [];
  for (const c of candidates) {
    let overlaps = false;
    for (const k of kept) {
      if (c.start < k.end && c.end > k.start) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) kept.push(c);
  }

  kept.sort((a, b) => a.start - b.start);
  return kept;
}

module.exports = { detect, PATTERNS, luhn, shannonEntropy };
