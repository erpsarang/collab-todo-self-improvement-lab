const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readMergedDiff, validate } = require('../scripts/self-improvement-review');

test('workflow checks out the merged SHA with full history', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/self-improvement-review.yml'), 'utf8');
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/);
});

test('merged diff includes every commit in a multi-commit rebase merge', (t) => {
  const repository = mkdtempSync(join(tmpdir(), 'self-improvement-review-'));
  t.after(() => require('node:fs').rmSync(repository, { recursive: true, force: true }));
  const runGit = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' });

  runGit('init', '--quiet');
  runGit('config', 'user.name', 'Test User');
  runGit('config', 'user.email', 'test@example.com');
  writeFileSync(join(repository, 'tasks.txt'), 'original\n');
  runGit('add', 'tasks.txt');
  runGit('commit', '--quiet', '-m', 'base');
  const base = runGit('rev-parse', 'HEAD').trim();

  writeFileSync(join(repository, 'tasks.txt'), 'original\nfirst rebased change\n');
  runGit('commit', '--quiet', '-am', 'first rebased commit');
  writeFileSync(join(repository, 'tasks.txt'), 'original\nfirst rebased change\nsecond rebased change\n');
  runGit('commit', '--quiet', '-am', 'second rebased commit');

  const diff = readMergedDiff(base, runGit);
  assert.match(diff, /first rebased change/);
  assert.match(diff, /second rebased change/);
  assert.doesNotMatch(diff, /could not be read/);
});

test('NO_CANDIDATE is a successful review result', () => {
  assert.match(validate('# Result\n\nNO_CANDIDATE\n\n## Reason\n\nNo evidence clears the thresholds.'), /NO_CANDIDATE/);
});

test('a candidate must clear every value and evidence threshold', () => {
  const weak = `# Result\n\nCANDIDATE\n\n## Title\nWeak\n## Observation\nObserved\n## Evidence\nFile\n## Impact\nSmall\n## Scores\n- User Impact: 2\n- Reliability Impact: 2\n- Collaboration Impact: 2\n- Evidence Strength: 2\n- Urgency: 2\n\nTotal: 10/15\n## Suggested Scope\nChange\n## Non-Goals\nOther`;
  assert.throws(() => validate(weak), /thresholds/);
});

test('a well-formed candidate with sufficient scores is accepted', () => {
  const strong = `# Result\n\nCANDIDATE\n\n## Title\nData safety\n## Observation\nObserved\n## Evidence\nsrc/store.js behavior\n## Impact\nData loss\n## Scores\n- User Impact: 3\n- Reliability Impact: 3\n- Collaboration Impact: 2\n- Evidence Strength: 3\n- Urgency: 2\n\nTotal: 13/15\n## Suggested Scope\nPersist data\n## Non-Goals\nExternal database`;
  assert.match(validate(strong), /Total: 13\/15/);
});
