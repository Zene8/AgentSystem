import { checkGithubOutputMultiline } from './workflow-lint.js';

const preFix = [
  'set +e',
  'results=""',
  'results="${results}• Agent definition drift detected\\n"',
  'echo "drift_results=$(printf \'%b\' "$results")" >> "$GITHUB_OUTPUT"',
].join('\n');
console.log('preFix:', JSON.stringify(checkGithubOutputMultiline(preFix, 1)));

const varForm = [
  'results=""',
  'results="${results}foo\\n"',
  'echo "drift_results=$results" >> "$GITHUB_OUTPUT"',
].join('\n');
console.log('varForm:', JSON.stringify(checkGithubOutputMultiline(varForm, 1)));

const goodForms = [
  'echo "gh_path=$(resolve gh)" >> "$GITHUB_OUTPUT"',
  'echo "agent=$agent" >> "$GITHUB_OUTPUT"',
  'echo "down=$([ "$state" = down ] && echo true || echo false)" >> "$GITHUB_OUTPUT"',
].join('\n');
console.log('goodForms:', JSON.stringify(checkGithubOutputMultiline(goodForms, 1)));
