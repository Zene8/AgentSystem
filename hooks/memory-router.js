'use strict';
// UserPromptSubmit hook — lightweight intent router. Injects an advisory routing hint so the
// main loop answers trivial/identity queries INLINE (cheaply) instead of spawning a heavyweight
// agent (the "47k tokens for 'who am I'" problem), and points domain work at the right lead.
// Hint is advisory context only — it cannot reroute the prompt (harness limitation).

const PB = '~/agent-memory/nexus/personal-brain';

function classify(promptRaw) {
  const p = (promptRaw || '').toLowerCase().trim();
  if (!p) return '';

  // Identity / memory lookups → answer inline from the graph, NO heavyweight agent.
  if (/\b(who am i|what'?s my name|what do you know about me|my (preferences|profile)|remind me who i am)\b/.test(p)) {
    return `ROUTING HINT: identity/memory query. Answer INLINE — do NOT spawn a heavyweight agent. ` +
      `Use: node tools/graph/graph-query.js personal-brain <keywords> --brain-path=${PB} --record-access`;
  }

  // Strong domain signals → suggest the lead (advisory; main loop still decides).
  if (/\b(deploy|ci\/?cd|pipeline|infra|terraform|runner|docker|kubernetes)\b/.test(p)) return hint('Leo (DevOps)');
  if (/\b(security|vulnerab|audit|cve|secret|phi|compliance)\b/.test(p)) return hint('Sam (security — hard gate on main merges)');
  if (/\b(schema|migration|prisma|sql|database|query plan)\b/.test(p)) return hint('Pym (database)');
  if (/\b(pricing|gtm|revenue|market|sales|forecast|strategy|customer)\b/.test(p)) return hint('Nat (business)');
  if (/\b(readme|changelog|docs|documentation|release notes|announcement)\b/.test(p)) return hint('Threepio (docs)');
  if (/\b(code|bug|fix|refactor|api|test|pr|merge|build|backend|frontend|component)\b/.test(p)) return hint('Friday (engineering — dispatches Ultron/Astra/etc)');

  return '';
}

function hint(agent) {
  return `ROUTING HINT: domain signal → ${agent}. Route there unless this is genuinely cross-domain/CEO-level (then Jarvis). Trivial sub-questions can be answered inline.`;
}

module.exports = { classify };

if (require.main === module) {
  let input = '';
  process.stdin.on('data', d => (input += d));
  process.stdin.on('end', () => {
    let prompt = '';
    try { prompt = JSON.parse(input || '{}').prompt || ''; } catch { /* ignore */ }
    process.stdout.write(classify(prompt));
  });
}
