'use strict';

/**
 * tool-output-compress.js
 * PostToolUse hook: If tool output is > 5000 characters, injects a compressed preview
 * to standard output which Claude Code receives as additional context.
 * Exits 0 silently for small outputs.
 */

let input = '';
process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  let payload = {};
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    process.exit(0);
  }

  const response = payload.tool_response;
  if (!response) {
    process.exit(0);
  }

  let responseString = '';
  if (typeof response === 'string') {
    responseString = response;
  } else {
    try {
      responseString = JSON.stringify(response, null, 2);
    } catch {
      process.exit(0);
    }
  }

  if (responseString.length > 5000) {
    const originalLen = responseString.length;
    const startPart = responseString.slice(0, 1500);
    const endPart = responseString.slice(-1500);
    
    const preview = 
      `\n[MISSION CONTROL WARNING: Tool output of '${payload.tool_name || 'unknown'}' was very large (${originalLen} characters) and has been compressed for context efficiency.]\n` +
      `--- START OF OUTPUT ---\n` +
      startPart +
      `\n\n... [TRUNCATED ${originalLen - 3000} CHARACTERS] ...\n\n` +
      endPart +
      `\n--- END OF OUTPUT ---\n`;

    process.stdout.write(preview);
  }
  
  process.exit(0);
});
