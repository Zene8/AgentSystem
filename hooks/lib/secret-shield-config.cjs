'use strict';
// secret-shield-config.cjs — loads per-project secret-shield config, per
// docs/secret-shield-contract.md. Node builtins only, CommonJS (hooks/ rule).

const fs = require('node:fs');
const path = require('node:path');

function defaults() {
  return {
    enabled: true,
    mode: 'obfuscate',
    detectors: null,
    entropy: true,
    rehydrate: false,
    allowUnshielded: false,
    failClosed: true,
    localModel: { enabled: false, url: null, model: null },
    pathRules: [],
  };
}

function projectSlug(cwd) {
  return path.resolve(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * loadConfig(cwd, env) -> Config
 * Reads <cwd>/.secret-shield.json (if present) and shallow-merges it over defaults().
 * Malformed JSON throws (failClosed default is true; the caller decides how to handle it —
 * this module does not swallow the parse error).
 */
function loadConfig(cwd, env = process.env) {
  const cfg = defaults();
  const filePath = path.join(cwd, '.secret-shield.json');

  if (fs.existsSync(filePath)) {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      throw new Error(`secret-shield: could not read ${filePath}: ${err.code || err.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`secret-shield: ${filePath} is not valid JSON`);
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.assign(cfg, parsed);
      // localModel is itself an object the contract wants shallow-merged, not replaced wholesale.
      if (parsed.localModel && typeof parsed.localModel === 'object') {
        cfg.localModel = { ...defaults().localModel, ...parsed.localModel };
      }
    }
  }

  if (env && String(env.SECRET_SHIELD_ALLOW_UNSHIELDED) === '1') {
    cfg.allowUnshielded = true;
  }

  cfg.project = projectSlug(cwd);

  return cfg;
}

module.exports = { loadConfig, projectSlug };
