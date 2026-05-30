#!/usr/bin/env node
/**
 * memory-embed.js — write embedding for a single SONA entry to the cache
 *
 * Usage:
 *   node ~/AgentSystem/tools/memory-embed.js --entry="<text>" --id="<slug>"
 *
 * Uses TF-IDF vectors (primary) or Voyage AI (if VOYAGE_API_KEY set).
 * Appends/updates ~/agent-memory/nexus/sona-embeddings.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { request as httpsRequest } from 'node:https';
import { homedir } from 'node:os';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
);

const entryText = args.entry || '';
const entryId   = args.id    || '';
const nexusDir  = join(homedir(), 'agent-memory', 'nexus');
const cacheFile = join(nexusDir, 'sona-embeddings.json');

if (!entryText || !entryId) {
  console.error('Usage: memory-embed.js --entry="<text>" --id="<slug>"');
  process.exit(1);
}

function tokenize(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function buildTfVector(tokens) {
  const freq = {};
  for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
  const total = tokens.length || 1;
  const vec = {};
  for (const [t, c] of Object.entries(freq)) vec[t] = c / total;
  return vec;
}

function loadCache() {
  try { return JSON.parse(readFileSync(cacheFile, 'utf8')); }
  catch { return {}; }
}

function saveCache(cache) {
  mkdirSync(nexusDir, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
}

function voyageEmbed(text) {
  return new Promise((resolve, reject) => {
    const key = process.env.VOYAGE_API_KEY;
    if (!key) return reject(new Error('No VOYAGE_API_KEY'));
    const body = JSON.stringify({ model: 'voyage-2', input: [text] });
    const options = {
      hostname: 'api.voyageai.com',
      path: '/v1/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = httpsRequest(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.data[0].embedding);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const cache = loadCache();

  if (process.env.VOYAGE_API_KEY) {
    try {
      cache[entryId] = await voyageEmbed(entryText);
      saveCache(cache);
      console.log(`Embedded (Voyage) and cached: ${entryId}`);
      return;
    } catch (err) {
      process.stderr.write(`Voyage failed (${err.message}), using TF-IDF\n`);
    }
  }

  cache[entryId] = buildTfVector(tokenize(entryText));
  saveCache(cache);
  console.log(`Embedded (TF-IDF) and cached: ${entryId}`);
}

main().catch(err => {
  process.stderr.write(`memory-embed error: ${err.message}\n`);
  process.exit(1);
});
