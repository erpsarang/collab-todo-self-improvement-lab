const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
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
  assert.match(workflow, /implementationMarker\(dispatch\.candidateKey\)/);
  assert.match(workflow, /\['apply', '--check'/);
  assert.match(workflow, /Closes #\$\{process\.env\.ISSUE\}/);
  assert.equal(implementationMarker(dispatch.candidateKey), implementationMarker(dispatch.candidateKey));
});
