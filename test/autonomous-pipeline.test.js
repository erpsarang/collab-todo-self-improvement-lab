const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const p = require('../scripts/autonomous-pipeline');

const key = `sha256:${'a'.repeat(64)}`;
const base = 'b'.repeat(40);
const patch = Buffer.from('diff --git a/src/a.js b/src/a.js\nindex 1111111..2222222 100644\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-a\n+b\n');
const identity = () => ({ schemaVersion: 1, candidateIssue: 23, candidateKey: key, reviewRunId: 10,
  sourceMergeSha: base, baseSha: base, implementRunId: 20, patchSha256: p.sha256(patch) });

test('normal Candidate produces a hash-bound implementation artifact and trusted attestation', () => {
  const value = identity();
  p.validateIdentity(value); p.validatePatch(patch, value.patchSha256);
  const attestation = p.createAttestation(value, value.patchSha256, 20);
  p.assertPublishable(value, attestation, patch, base, base);
});

test('VERIFY rejects deletion and modification of existing trusted tests', () => {
  const trusted = { 'test/a.test.js': p.sha256('one'), 'test/b.test.js': p.sha256('two') };
  assert.throws(() => p.assertTrustedTests(trusted, { 'test/a.test.js': trusted['test/a.test.js'] }), /deleted/u);
  assert.throws(() => p.assertTrustedTests(trusted, { ...trusted, 'test/a.test.js': p.sha256('changed') }), /modified/u);
  assert.doesNotThrow(() => p.assertTrustedTests(trusted, { ...trusted, 'test/new.test.js': p.sha256('new') }));
});

test('VERIFY independently creates the base-test trust anchor before applying the Candidate patch', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  const implement = workflow.slice(workflow.indexOf('  implement:'), workflow.indexOf('  verify:'));
  const verify = workflow.slice(workflow.indexOf('  verify:'), workflow.indexOf('  publish:'));
  assert.doesNotMatch(implement, /base-tests\.sha256/u);
  assert.match(verify, /find test -type f[\s\S]*> \/tmp\/trusted\/base-tests\.sha256[\s\S]*git apply --index/u);
  assert.doesNotMatch(workflow, /artifact\/base-tests\.sha256/u);
});

test('recurring Candidate provenance is bound to the trusted Review artifact, not mutable Issue text', () => {
  const publication = { schemaVersion: 1, result: 'CANDIDATE', title: 'Recurring Candidate', verifiedMergeSha: 'c'.repeat(40) };
  const recurringKey = `sha256:${p.sha256('recurring candidate')}`;
  const run = { id: 702, name: 'Self-Improvement Review', path: '.github/workflows/self-improvement-review.yml',
    event: 'workflow_run', conclusion: 'success', head_branch: 'main', head_sha: publication.verifiedMergeSha };
  assert.doesNotThrow(() => p.validateReviewProvenance(run, publication, {
    reviewRunId: 702, sourceMergeSha: publication.verifiedMergeSha, candidateKey: recurringKey,
  }));
  assert.throws(() => p.validateReviewProvenance(run, publication, {
    reviewRunId: 701, sourceMergeSha: publication.verifiedMergeSha, candidateKey: recurringKey,
  }), /provenance/u);
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  assert.match(workflow, /run-id: '\$\{\{ inputs\.review_run_id \}\}'/u);
  assert.doesNotMatch(workflow, /observations\.includes|Source merge SHA.*inputs\.source_merge_sha/u);
  assert.doesNotMatch(workflow, /issue\.body.*candidate_key|candidate_key.*issue\.body/u);
  assert.match(workflow, /publisher-artifact\/publisher-dispatch\.json/u);
  assert.doesNotThrow(() => p.validatePublisherDispatch({ schemaVersion: 1, candidateIssue: 23,
    candidateKey: recurringKey, reviewRunId: 702, sourceMergeSha: publication.verifiedMergeSha, publisherRunId: 900 },
  { candidateIssue: 23, candidateKey: recurringKey, reviewRunId: 702,
    sourceMergeSha: publication.verifiedMergeSha, publisherRunId: 900 }));
});

test('changed package test scripts, helpers, lifecycle scripts, and manifest generators are not verification authorities', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  assert.match(workflow, /install -D scripts\/autonomous-pipeline\.js \/tmp\/trusted/u);
  assert.match(workflow, /npm ci --ignore-scripts/u);
  assert.match(workflow, /node:20 node --test/u);
  assert.doesNotMatch(workflow, /npm test/u);
  assert.match(workflow, /require\('\/tmp\/trusted\/autonomous-pipeline'\)/u);
});

test('candidate-added tests run with the verified source mounted read-only', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  assert.match(workflow, /docker run --rm --network none --read-only -v "\$PWD:\/workspace:ro" --tmpfs \/tmp -w \/workspace node:20 node --test/u);
  assert.doesNotMatch(workflow, /-v "\$PWD:\/workspace" -w \/workspace node:20 node --test/u);
});

test('tampered implementation patch fails VERIFY', () => {
  assert.throws(() => p.validatePatch(Buffer.from(`${patch}tamper`), identity().patchSha256), /hash mismatch/u);
});

test('patch/attestation mismatch, changed main, and a different checkout fail PUBLISH', () => {
  const value = identity(); const attestation = p.createAttestation(value, value.patchSha256, 20);
  assert.throws(() => p.assertPublishable(value, { ...attestation, implementationPatchSha256: 'c'.repeat(64) }, patch, base, base), /does not cover/u);
  assert.throws(() => p.assertPublishable(value, attestation, patch, 'd'.repeat(40), base), /no longer current/u);
  assert.throws(() => p.assertPublishable(value, attestation, patch, base, 'd'.repeat(40)), /not verified/u);
});

test('PUBLISH pins the checkout and rechecks the four-way base invariant immediately before applying', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  const publish = workflow.slice(workflow.indexOf('  publish:'));
  assert.match(publish, /ref: '\$\{\{ inputs\.source_merge_sha \}\}'/u);
  assert.match(publish, /repos\.getBranch\(\{\.\.\.context\.repo,branch:'main'\}\)/u);
  assert.match(publish, /git',\['rev-parse','HEAD'\]/u);
  const recheck = publish.indexOf('CURRENT_MAIN_SHA=$(gh api');
  const apply = publish.indexOf('git apply --check');
  assert.ok(recheck > 0 && recheck < apply);
  assert.match(publish, /test "\$CURRENT_MAIN_SHA" = "\$BASE_SHA"[\s\S]*test "\$BASE_SHA" = "\$VERIFIED_BASE_SHA"[\s\S]*test "\$VERIFIED_BASE_SHA" = "\$CHECKED_OUT_SHA"/u);
  assert.match(publish, /commit -m[\s\S]*assert_base_invariant[\s\S]*git push/u);
});

test('candidate eligibility closes safely for closed, held, or rejected records', () => {
  const approved = { state: 'open', labels: ['SI-후보', 'SI-승인'] };
  assert.equal(p.eligibleCandidate(approved), true);
  for (const issue of [{ ...approved, state: 'closed' }, { ...approved, labels: [...approved.labels, 'SI-보류'] },
    { ...approved, labels: [...approved.labels, 'SI-거절'] }]) assert.equal(p.eligibleCandidate(issue), false);
});

test('copied marker in an external PR is not treated as an owned duplicate', () => {
  const owned = { state: 'open', body: `<!-- autonomous-candidate-key: ${key} -->`, user: { login: 'github-actions[bot]' },
    head: { ref: 'automation/self-improvement/23-99', repo: { full_name: 'o/r' } } };
  assert.equal(p.isOwnedDuplicate(owned, { candidateKey: key, repository: 'o/r', actor: 'github-actions[bot]' }), true);
  assert.equal(p.isOwnedDuplicate({ ...owned, user: { login: 'attacker' } }, { candidateKey: key, repository: 'o/r', actor: 'github-actions[bot]' }), false);
  assert.equal(p.isOwnedDuplicate({ ...owned, head: { ...owned.head, repo: { full_name: 'fork/r' } } }, { candidateKey: key, repository: 'o/r', actor: 'github-actions[bot]' }), false);
});

test('.github modify, rename, delete, and copy paths are rejected', () => {
  for (const changed of [
    'diff --git a/.github/a.yml b/.github/a.yml\n',
    'diff --git a/.github/a.yml b/a.yml\nrename from .github/a.yml\nrename to a.yml\n',
    'diff --git a/.github/a.yml b/.github/a.yml\ndeleted file mode 100644\n',
    'diff --git a/a.yml b/.github/a.yml\ncopy from a.yml\ncopy to .github/a.yml\n',
  ]) assert.throws(() => p.assertPatchScope(Buffer.from(changed)), /may not change/u);
});

test('Publisher completion race uses bounded polling and accepts only successful trusted completion', async () => {
  let calls = 0;
  const run = { id: 7, name: 'Self-Improvement Candidate Publisher', path: '.github/workflows/self-improvement-candidate-publisher.yml', event: 'workflow_run', head_branch: 'main' };
  const result = await p.waitForPublisher(async () => ({ ...run, status: ++calls < 3 ? 'in_progress' : 'completed', conclusion: calls < 3 ? null : 'success' }), 7, { attempts: 3 });
  assert.equal(result.conclusion, 'success'); assert.equal(calls, 3);
  for (const conclusion of ['failure', 'cancelled']) await assert.rejects(() => p.waitForPublisher(async () => ({ ...run, status: 'completed', conclusion }), 7), new RegExp(conclusion));
});

test('publication is candidate-serialized and safely reuses only an equivalent remote retry branch', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  assert.match(workflow, /group: autonomous-candidate-\$\{\{ inputs\.candidate_key \}\}[\s\S]*cancel-in-progress: false/u);
  assert.match(workflow, /automation\/self-improvement\/\$\{\{ steps\.gate\.outputs\.issue \}\}-\$\{\{ github\.run_id \}\}/u);
  assert.match(workflow, /REMOTE_PARENT=.*[\s\S]*test "\$REMOTE_PARENT" = "\$BASE_SHA"[\s\S]*test "\$REMOTE_TREE" = "\$LOCAL_TREE"/u);
  assert.doesNotMatch(workflow, /git push[^\n]*--force/u);
  assert.equal((workflow.match(/gh pr create/gu) || []).length, 1);
  assert.match(workflow, /if: steps\.gate\.outputs\.publish == 'true'/u);
});

test('PUBLISH rechecks candidate eligibility at both final privileged boundaries', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  const publish = workflow.slice(workflow.indexOf('  publish:'));
  assert.match(publish, /candidate_is_eligible\(\)[\s\S]*p\.eligibleCandidate\(JSON\.parse\(s\)\)/u);
  assert.equal((publish.match(/if ! candidate_is_eligible/gu) || []).length, 2);
  assert.match(publish, /if ! candidate_is_eligible[\s\S]*git push[\s\S]*if ! candidate_is_eligible[\s\S]*gh pr create/u);
});

test('NO_CANDIDATE remains a safe no-op before autonomous dispatch', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/self-improvement-candidate-publisher.yml'), 'utf8');
  assert.ok(workflow.indexOf("publication.result === 'NO_CANDIDATE'") < workflow.indexOf('createWorkflowDispatch'));
});

test('workflow separates untrusted IMPLEMENT, trusted VERIFY, and privileged PUBLISH runners', () => {
  const workflow = readFileSync(join(__dirname, '../.github/workflows/autonomous-implementation.yml'), 'utf8');
  for (const job of ['implement:', 'verify:', 'publish:']) assert.match(workflow, new RegExp(`^  ${job}`, 'mu'));
  assert.match(workflow, /permissions: \{ actions: read, contents: write, issues: read, pull-requests: write \}/u);
  assert.match(workflow, /persist-credentials: false/u);
});
