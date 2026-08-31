const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { readMergedDiff, validate } = require('../scripts/self-improvement-review');

test('workflow checks out the merged SHA with full history', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/self-improvement-review.yml'), 'utf8');
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /ref: \$\{\{ steps\.merged-pr\.outputs\.merge-sha \}\}/);
  assert.doesNotMatch(workflow, /ref:.*(?:head_sha|head\.sha)/);
});

test('fork-safe review runs after an unprivileged merge gate in trusted context', () => {
  const gate = readFileSync(join(__dirname, '../.github/workflows/self-improvement-review-gate.yml'), 'utf8');
  const workflow = readFileSync(join(__dirname, '../.github/workflows/self-improvement-review.yml'), 'utf8');

  assert.match(gate, /pull_request:/);
  assert.match(gate, /if: github\.event\.pull_request\.merged == true/);
  assert.doesNotMatch(gate, /checkout|OPENAI_API_KEY|pull_request_target/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Merged PR Review Gate/);
  assert.match(workflow, /listWorkflowRunPullRequests/);
  assert.match(workflow, /pr\.merged_by\?\.type !== 'User'/);
  assert.match(workflow, /pr\.merge_commit_sha/);
  assert.doesNotMatch(workflow, /github\.event\.workflow_run\.head_sha/);
});

test('trusted review grants only the read permissions required by its APIs', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/self-improvement-review.yml'), 'utf8');
  const permissions = workflow.match(/^permissions:\n((?:  [^\n]+\n)+)/m);

  assert.ok(permissions, 'workflow must declare explicit permissions');
  assert.equal(
    permissions[1],
    '  actions: read\n  contents: read\n  pull-requests: read\n',
  );
  assert.doesNotMatch(permissions[1], /write/);
});

test('workflow uses Codex read-only and publishes only the validated result', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/self-improvement-review.yml'), 'utf8');
  assert.match(workflow, /uses: openai\/codex-action@v1/);
  assert.match(workflow, /openai-api-key: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.match(workflow, /sandbox: read-only/);
  assert.match(workflow, /output-file: self-improvement-raw\.md/);
  assert.match(workflow, /node scripts\/self-improvement-review\.js validate/);
  assert.match(workflow, /path: self-improvement-result\.md/);
  assert.doesNotMatch(workflow, /models\.github\.ai|models: read/);
  assert.doesNotMatch(workflow, /path: self-improvement-raw\.md/);
});

test('an invalid raw Codex result does not create the artifact file', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'self-improvement-validation-'));
  t.after(() => require('node:fs').rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'self-improvement-raw.md'), 'untrusted output');

  const validation = spawnSync(
    process.execPath,
    [join(__dirname, '../scripts/self-improvement-review.js'), 'validate'],
    { cwd: directory, encoding: 'utf8' },
  );

  assert.notEqual(validation.status, 0);
  assert.equal(existsSync(join(directory, 'self-improvement-result.md')), false);
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

test('a candidate must have content in every required section', async (t) => {
  const strong = `# Result\n\nCANDIDATE\n\n## Title\nData safety\n## Observation\nObserved\n## Evidence\nsrc/store.js behavior\n## Impact\nData loss\n## Scores\n- User Impact: 3\n- Reliability Impact: 3\n- Collaboration Impact: 2\n- Evidence Strength: 3\n- Urgency: 2\n\nTotal: 13/15\n## Suggested Scope\nPersist data\n## Non-Goals\nExternal database`;

  for (const heading of ['Title', 'Observation', 'Evidence', 'Impact', 'Suggested Scope', 'Non-Goals']) {
    await t.test(heading, () => {
      const emptySection = strong.replace(
        new RegExp(`(## ${heading}\\n)[\\s\\S]*?(?=\\n## |$)`),
        `$1   \n`,
      );
      assert.throws(() => validate(emptySection), new RegExp(`empty ${heading} section`));
    });
  }
});

test('a well-formed candidate with sufficient scores is accepted', () => {
  const strong = `# Result\n\nCANDIDATE\n\n## Title\nData safety\n## Observation\nObserved\n## Evidence\nsrc/store.js behavior\n## Impact\nData loss\n## Scores\n- User Impact: 3\n- Reliability Impact: 3\n- Collaboration Impact: 2\n- Evidence Strength: 3\n- Urgency: 2\n\nTotal: 13/15\n## Suggested Scope\nPersist data\n## Non-Goals\nExternal database`;
  assert.match(validate(strong), /Total: 13\/15/);
});
