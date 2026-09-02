const { createHash, timingSafeEqual } = require('node:crypto');
const { readFileSync } = require('node:fs');

const SHA = /^[0-9a-f]{40}$/iu;
const KEY = /^sha256:[0-9a-f]{64}$/u;
const AUTOMATION_BRANCH = /^automation\/self-improvement\/\d+-[0-9]+$/u;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function equalHash(actual, expected) {
  if (!/^[0-9a-f]{64}$/iu.test(actual) || !/^[0-9a-f]{64}$/iu.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual.toLowerCase()), Buffer.from(expected.toLowerCase()));
}

function validateIdentity(value) {
  const required = ['candidateIssue', 'candidateKey', 'reviewRunId', 'sourceMergeSha', 'baseSha', 'implementRunId'];
  if (!value || value.schemaVersion !== 1 || required.some((key) => value[key] === undefined)) {
    throw new Error('Implementation provenance has an invalid schema');
  }
  if (!Number.isSafeInteger(value.candidateIssue) || value.candidateIssue <= 0 ||
      !Number.isSafeInteger(value.reviewRunId) || value.reviewRunId <= 0 ||
      !Number.isSafeInteger(value.implementRunId) || value.implementRunId <= 0 ||
      !KEY.test(value.candidateKey) || !SHA.test(value.sourceMergeSha) || !SHA.test(value.baseSha)) {
    throw new Error('Implementation provenance has invalid values');
  }
  return value;
}

function validatePatch(patch, expectedHash) {
  if (!Buffer.isBuffer(patch)) throw new Error('Patch must be bytes');
  if (!equalHash(sha256(patch), expectedHash)) throw new Error('Implementation patch hash mismatch');
}

function parsePatchPaths(patch) {
  const paths = [];
  for (const line of String(patch).split(/\r?\n/u)) {
    const match = line.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/u);
    if (match) paths.push(match[1], match[2]);
    const rename = line.match(/^(?:rename|copy) (?:from|to) (.+)$/u);
    if (rename) paths.push(rename[1]);
  }
  return paths;
}

function assertPatchScope(patch) {
  const paths = parsePatchPaths(patch);
  if (paths.length === 0) throw new Error('Implementation patch is empty or malformed');
  if (paths.some((path) => path === '.github' || path.startsWith('.github/'))) {
    throw new Error('Autonomous patches may not change .github');
  }
  return paths;
}

function assertTrustedTests(baseTests, candidateTests) {
  for (const [path, hash] of Object.entries(baseTests)) {
    if (!(path in candidateTests)) throw new Error(`Trusted test deleted: ${path}`);
    if (!equalHash(hash, candidateTests[path])) throw new Error(`Trusted test modified: ${path}`);
  }
}

function createAttestation(identity, patchSha256, verificationRunId) {
  validateIdentity(identity);
  if (!/^[0-9a-f]{64}$/iu.test(patchSha256) || !Number.isSafeInteger(verificationRunId) || verificationRunId <= 0) {
    throw new Error('Cannot attest invalid verification provenance');
  }
  return {
    schemaVersion: 1,
    ...identity,
    implementationPatchSha256: patchSha256.toLowerCase(),
    verificationRunId,
    verificationResult: 'PASS',
    trustedTestResult: 'PASS',
    verifiedBaseSha: identity.baseSha,
  };
}

function assertPublishable(identity, attestation, patch, currentMainSha, checkedOutSha) {
  validateIdentity(identity);
  validatePatch(patch, identity.patchSha256);
  if (!attestation || attestation.schemaVersion !== 1 || attestation.verificationResult !== 'PASS' ||
      attestation.trustedTestResult !== 'PASS') throw new Error('Verification did not pass');
  for (const key of ['candidateIssue', 'candidateKey', 'reviewRunId', 'sourceMergeSha', 'baseSha', 'implementRunId']) {
    if (attestation[key] !== identity[key]) throw new Error(`Attestation provenance mismatch: ${key}`);
  }
  if (attestation.implementationPatchSha256 !== identity.patchSha256 || attestation.verifiedBaseSha !== identity.baseSha) {
    throw new Error('Attestation does not cover the implementation patch');
  }
  if (currentMainSha !== identity.baseSha) throw new Error('Trusted base is no longer current');
  if (checkedOutSha !== identity.baseSha) throw new Error('Checked-out base was not verified');
  assertPatchScope(patch);
}

function isOwnedDuplicate(pr, { candidateKey, repository, actor }) {
  return pr?.state === 'open' && pr?.head?.repo?.full_name === repository &&
    AUTOMATION_BRANCH.test(pr?.head?.ref || '') && pr?.user?.login === actor &&
    String(pr?.body || '').includes(`<!-- autonomous-candidate-key: ${candidateKey} -->`);
}

function eligibleCandidate(issue) {
  const labels = new Set((issue?.labels || []).map((label) => typeof label === 'string' ? label : label.name));
  return issue?.state === 'open' && labels.has('SI-후보') && labels.has('SI-승인') &&
    !labels.has('SI-보류') && !labels.has('SI-거절');
}

async function waitForPublisher(getRun, runId, { attempts = 8, delay = async () => {} } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const run = await getRun(runId);
    if (run.id !== runId || run.name !== 'Self-Improvement Candidate Publisher' ||
        run.path !== '.github/workflows/self-improvement-candidate-publisher.yml' ||
        run.event !== 'workflow_run' || run.head_branch !== 'main') throw new Error('Untrusted Publisher run');
    if (run.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`Publisher concluded ${run.conclusion}`);
      return run;
    }
    if (attempt + 1 < attempts) await delay(attempt);
  }
  throw new Error('Publisher completion timed out');
}

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }

module.exports = { assertPatchScope, assertPublishable, assertTrustedTests, createAttestation,
  eligibleCandidate, equalHash, isOwnedDuplicate, parsePatchPaths, readJson, sha256, validateIdentity,
  validatePatch, waitForPublisher };
