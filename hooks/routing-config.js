'use strict';
// routing-config.js — parses config/routing.yml, the single source of truth for domain
// routing rules (#124). Deliberately dependency-free: not real YAML, just a pipe-delimited
// line format (see the header comment in config/routing.yml for the column spec).
// Consumed by hooks/memory-router.js (live hint) and tools/generate-routing-table.js
// (jarvis.md table generation) so both stay in sync by construction instead of by discipline.

const fs = require('fs');
const path = require('path');

function defaultConfigPath() {
  // hooks/routing-config.js -> ../config/routing.yml
  return path.join(__dirname, '..', 'config', 'routing.yml');
}

// Pure: parse routing.yml text into an ordered array of rule objects.
// Throws on a malformed data row (missing columns) so config typos fail loudly at load time
// rather than silently dropping a rule.
function parseRoutingConfig(text) {
  const rules = [];
  const lines = (text || '').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    // Columns are separated by " | " (space-pipe-space) specifically, NOT bare "|" — regex
    // alternation inside the pattern column (e.g. `\b(deploy|ci)\b`) has no surrounding spaces,
    // so splitting on the spaced form only breaks on real column boundaries.
    const cols = line.split(' | ').map(c => c.trim());
    if (cols.length < 6) {
      throw new Error(`routing.yml: malformed row (expected 6 columns, got ${cols.length}): ${line}`);
    }
    const [id, regexSource, agentShort, command, hintDisplay, keywordsDisplay] = cols;
    let regex;
    try {
      regex = new RegExp(regexSource, 'i');
    } catch (e) {
      throw new Error(`routing.yml: invalid regex for rule "${id}": ${e.message}`);
    }
    rules.push({ id, regex, regexSource, agentShort, command, hintDisplay, keywordsDisplay });
  }
  return rules;
}

// Load + parse config/routing.yml from disk. Returns [] on any read/parse failure so a
// broken config degrades the router to "no domain hints" rather than crashing the hook.
function loadRoutingRules(configPath) {
  try {
    const text = fs.readFileSync(configPath || defaultConfigPath(), 'utf8');
    return parseRoutingConfig(text);
  } catch {
    return [];
  }
}

module.exports = { parseRoutingConfig, loadRoutingRules, defaultConfigPath };
