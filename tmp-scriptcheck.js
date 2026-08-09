// Validate every `script:` block in a workflow the way actions/github-script runs it:
// as an AsyncFunction body. `node --check` is wrong here -- it rejects the top-level
// await/return that github-script legally allows.
const fs = require('fs');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
let found = 0, bad = 0;

for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^(\s*)script:\s*\|\s*$/);
  if (!m) continue;
  const headerIndent = m[1].length;

  // Collect the block: everything indented deeper than the header, plus blank lines.
  const body = [];
  let j = i + 1, blockIndent = null;
  for (; j < lines.length; j++) {
    const line = lines[j];
    if (line.trim() === '') { body.push(''); continue; }
    const indent = line.match(/^\s*/)[0].length;
    if (blockIndent === null) blockIndent = indent;
    if (indent <= headerIndent) break;
    body.push(line.slice(blockIndent));
  }

  found++;
  const src = body.join('\n');
  try {
    new AsyncFunction('github', 'context', 'core', src);
    console.log(`  OK   script at line ${i + 1} (${body.length} lines, indent ${blockIndent})`);
  } catch (e) {
    bad++;
    console.log(`  FAIL script at line ${i + 1}: ${e.message}`);
  }
  i = j - 1;
}

console.log(`\n${file}: ${found} script block(s), ${bad} invalid`);
process.exit(bad ? 1 : 0);
