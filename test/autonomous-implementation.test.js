const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { candidateKey } = require('../scripts/self-improvement-candidate');
const { eligibility, implementationMarker, patchDigest, preparePrompt, validateManifest } = require('../scripts/autonomous-implementation');

const sha = 'a'.repeat(40);
const title = 'Automate a validated improvement';
const dispatch = { schemaVersion: 1, candidateIssueNumber: 23, candidateKey: candidateKey(title), sourceReviewRunId: 42,
  sourceMergeSha: sha, publicationResult: 'CANDIDATE', verificationStatus: 'PASS', totalScore: 10, title,
  suggestedScope: 'Implement the bounded change.', nonGoals: 'Do not merge automatically.' };
const issue = { number: 23, state: 'open', labels: [{ name: 'SI-후보' }, { name: 'SI-승인대기' }], body: 'untrusted and irrelevant' };

test('PASS Candidate at the score threshold is eligible without trusting its body', () => {
  assert.deepEqual(eligibility(dispatch, issue, sha), { eligible: true, reason: 'eligible' });
  assert.match(preparePrompt(dispatch), /Implement the bounded change/);
  assert.doesNotMatch(preparePrompt(dispatch), /untrusted and irrelevant/);
});
test('CONCERN and below-threshold Candidates stop safely', () => {
  assert.equal(eligibility({ ...dispatch, verificationStatus: 'CONCERN' }, issue, sha).eligible, false);
  assert.equal(eligibility({ ...dispatch, totalScore: 9 }, issue, sha).eligible, false);
});
test('deferred and rejected Candidates stop safely', () => {
  for (const label of ['SI-보류', 'SI-거절']) assert.equal(eligibility(dispatch, { ...issue, labels: ['SI-후보', label] }, sha).eligible, false);
});
test('tampered metadata and changed base stop safely', () => {
  assert.equal(eligibility({ ...dispatch, candidateKey: candidateKey('tampered') }, issue, sha).eligible, false);
  assert.equal(eligibility(dispatch, issue, 'b'.repeat(40)).eligible, false);
});
test('manifest binds a successful test result, exact base, Candidate, and patch', () => {
  const patch = 'diff --git a/a b/a\n';
  const manifest = { schemaVersion: 1, candidateKey: dispatch.candidateKey, candidateIssueNumber: 23,
    baseSha: sha, patchSha256: patchDigest(patch), tests: 'npm test: PASS' };
  assert.equal(validateManifest(manifest, dispatch, patch, sha), true);
  assert.throws(() => validateManifest(manifest, dispatch, `${patch}tamper`, sha));
});
test('workflow separates read-only implementation from publishing and deduplicates PRs', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  assert.match(workflow, /implement:[\s\S]*contents: read[\s\S]*persist-credentials: false/);
  assert.match(workflow, /publish:[\s\S]*contents: write[\s\S]*pull-requests: write/);
  assert.match(workflow, /publish:[\s\S]*issues: read/);
  assert.match(workflow, /Only this write-scoped job receives checkout's push credential[\s\S]*persist-credentials: true/);
  assert.match(workflow, /implementationMarker\(dispatch\.candidateKey\)/);
  assert.match(workflow, /\['apply', '--check'/);
  assert.match(workflow, /Closes #\$\{process\.env\.ISSUE\}/);
  assert.equal(implementationMarker(dispatch.candidateKey), implementationMarker(dispatch.candidateKey));
});

test('publish rechecks eligibility, protects both rename paths, and uses retryable branches', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  assert.match(workflow, /issues\.get[\s\S]*eligibility\(dispatch, issue, main\.object\.sha\)[\s\S]*no longer eligible/);
  assert.match(workflow, /--name-status', '-z', '--find-renames', '--find-copies'/);
  assert.match(workflow, /\^\[RC\][\s\S]*\[changed\[i\+\+\], changed\[i\+\+\]\]/);
  assert.match(workflow, /path === '\.github' \|\| path\.startsWith\('\.github\/'\)/);
  assert.match(workflow, /context\.runId\}-\$\{context\.runAttempt\}/);
});

test('implementation patch reproduces the tested tree including tracked deletions', () => {
  const root = mkdtempSync(join(tmpdir(), 'autonomous-patch-'));
  const published = mkdtempSync(join(tmpdir(), 'autonomous-published-'));
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
  try {
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.name', 'Test');
    git(root, 'config', 'user.email', 'test@example.com');
    writeFileSync(join(root, 'deleted.txt'), 'remove me\n');
    writeFileSync(join(root, 'modified.txt'), 'before\n');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'base');

    rmSync(join(root, 'deleted.txt'));
    writeFileSync(join(root, 'modified.txt'), 'after\n');
    mkdirSync(join(root, 'new'));
    writeFileSync(join(root, 'new/file.txt'), 'created\n');
    git(root, 'add', '--intent-to-add', '.');
    const patch = git(root, 'diff', 'HEAD', '--binary', '--full-index', '--no-ext-diff');

    assert.match(patch, /deleted file mode/);
    assert.match(patch, /new file mode/);
    git(root, 'worktree', 'add', '--quiet', published, 'HEAD');
    writeFileSync(join(published, 'implementation.patch'), patch);
    git(published, 'apply', '--index', 'implementation.patch');
    rmSync(join(published, 'implementation.patch'));
    assert.equal(git(published, 'status', '--short'), 'D  deleted.txt\nM  modified.txt\nA  new/file.txt\n');
  } finally {
    try { git(root, 'worktree', 'remove', '--force', published); } catch {}
    rmSync(root, { recursive: true, force: true });
    rmSync(published, { recursive: true, force: true });
  }
});

test('implementation patch excludes node_modules but retains dependency manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'autonomous-install-artifacts-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    git('init', '--quiet');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(join(root, 'package.json'), '{}\n');
    git('add', '.');
    git('commit', '--quiet', '-m', 'base');
    mkdirSync(join(root, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules/pkg/index.js'), 'generated\n');
    writeFileSync(join(root, 'package.json'), '{"dependencies":{"pkg":"1.0.0"}}\n');
    writeFileSync(join(root, 'package-lock.json'), '{}\n');
    git('add', '--intent-to-add', '--all', '--', '.', ':(exclude)node_modules', ':(exclude)**/node_modules/**');
    const patch = git('diff', 'HEAD', '--binary', '--full-index', '--no-ext-diff', '--', '.',
      ':(exclude)node_modules', ':(exclude)**/node_modules/**');
    assert.match(patch, /package\.json/);
    assert.match(patch, /package-lock\.json/);
    assert.doesNotMatch(patch, /node_modules/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workflow treats a trusted publisher run without a dispatch as a safe no-op', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  assert.match(workflow, /exact\.length === 0[\s\S]*Safe stop: publisher produced NO_CANDIDATE[\s\S]*has-dispatch', 'false'/);
  assert.match(workflow, /Download exact Candidate dispatch\n\s+if: steps\.publisher\.outputs\.has-dispatch == 'true'/);
  assert.match(workflow, /Evaluate eligibility from trusted metadata\n\s+if: steps\.publisher\.outputs\.has-dispatch == 'true'/);
  assert.match(workflow, /exact\.length !== 1[\s\S]*throw new Error/);
});
