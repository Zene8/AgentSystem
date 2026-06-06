#!/usr/bin/env node
// memory-capture.js — automatic fact extraction from a session transcript.
// Reads a transcript file (path as first positional arg), calls an injectable LLM to
// extract ≤5 durable facts about the user or project, and writes each via remember()
// (which reconciles/dedups automatically). Conservative by design: high precision over
// recall. On LLM failure, captures nothing — never guesses.
// LLM call uses `claude -p` (subscription, no API key). Injectable for testing.
// Usage: node tools/memory-capture.js <transcript-path>

import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { remember } from './brain-remember.js';

const MAX_FACTS = 5;

// Pure: build the extraction prompt for a transcript text.
// The LLM must output ONLY bullet lines or the single word NONE.
export function buildCapturePrompt(transcriptText) {
  return [
    'You are a memory extraction engine reading a session transcript.',
    'Extract ONLY facts that are ALL of:',
    '  (a) durable — true beyond this session (preferences, decisions, stable context, corrections)',
    '  (b) specific — about the user or their project, not the task itself',
    '  (c) high-precision — you are certain, not inferring',
    '',
    'EXCLUDE: one-off task details, speculation, ephemeral state, things already obvious from code.',
    `Cap: at most ${MAX_FACTS} facts. If none qualify, output exactly: NONE`,
    '',
    'Output ONLY the facts as bullet lines prefixed with "- ". No preamble, no explanation.',
    '',
    '--- TRANSCRIPT START ---',
    transcriptText.slice(0, 8000),
    '--- TRANSCRIPT END ---',
  ].join('\n');
}

// Pure: parse LLM output into fact strings. Returns [] for NONE, malformed, or empty.
// Enforces the MAX_FACTS cap in the parser so callers can unit-test this independently.
export function parseCaptureFacts(text) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.toUpperCase() === 'NONE') return [];
  return trimmed.split('\n')
    .map(l => l.trim())
    .filter(l => /^[-*]\s+/.test(l))
    .map(l => l.replace(/^[-*]\s+/, '').trim())
    .filter(Boolean)
    .slice(0, MAX_FACTS);
}

const defaultLlm = (prompt) =>
  execFileSync('claude', ['-p', prompt], { encoding: 'utf8', timeout: 120000 });

// Orchestrator: read transcript, call LLM, write each fact via remember().
// On any failure → returns { ok: false, ... } without writing anything.
// llm: injectable — pass a stub in tests.
export function captureFromTranscript(transcriptPath, { llm = defaultLlm, section = 'Session Notes' } = {}) {
  if (!transcriptPath || !existsSync(transcriptPath)) {
    return { ok: false, message: `transcript not found: ${transcriptPath}`, written: [] };
  }

  let transcriptText;
  try {
    transcriptText = readFileSync(transcriptPath, 'utf8');
  } catch (e) {
    return { ok: false, message: `cannot read transcript: ${e.message}`, written: [] };
  }

  const prompt = buildCapturePrompt(transcriptText);

  let raw;
  try {
    raw = llm(prompt);
  } catch (e) {
    return { ok: false, message: `llm failed: ${e.message}`, written: [] };
  }

  const facts = parseCaptureFacts(raw);
  const written = [];
  for (const fact of facts) {
    try {
      const r = remember({ fact, section });
      if (r.ok && r.added) written.push(fact);
    } catch {
      // Individual fact failures don't abort the rest.
    }
  }

  return { ok: true, extracted: facts.length, written };
}

const isMain = process.argv[1] &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const transcriptPath = process.argv[2];
  if (!transcriptPath) {
    console.error('Usage: memory-capture.js <transcript-path>');
    process.exit(1);
  }
  const r = captureFromTranscript(transcriptPath);
  if (!r.ok) { console.error(`memory-capture: ${r.message}`); process.exit(1); }
  console.log(`memory-capture: extracted ${r.extracted}, wrote ${r.written.length} new facts`);
  for (const f of r.written) console.log(`  + ${f}`);
}
