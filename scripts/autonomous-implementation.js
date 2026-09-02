#!/usr/bin/env node

const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const { candidateKey } = require('./self-improvement-candidate');

const SHA = /^[0-9a-f]{40}$/iu;
const KEY = /^sha256:[0-9a-f]{64}$/u;

function validateDispatch(dispatch) {
  if (!dispatch || dispatch.schemaVersion !== 1 || dispatch.publicationResult !== 'CANDIDATE') {
    throw new Error('Dispatch is not a Candidate publication');
  }
  if (!Number.isSafeInteger(dispatch.candidateIssueNumber) || dispatch.candidateIssueNumber <= 0 ||
      !Number.isSafeInteger(dispatch.sourceReviewRunId) || dispatch.sourceReviewRunId <= 0 ||
      !KEY.test(dispatch.candidateKey) || !SHA.test(dispatch.sourceMergeSha) ||
      !Number.isInteger(dispatch.totalScore) || typeof dispatch.title !== 'string' || !dispatch.title ||
      typeof dispatch.suggestedScope !== 'string' || !dispatch.suggestedScope ||
      typeof dispatch.nonGoals !== 'string' || !dispatch.nonGoals) {
    throw new Error('Dispatch metadata has an invalid schema');
  }
  if (candidateKey(dispatch.title) !== dispatch.candidateKey) throw new Error('Candidate Key does not match trusted metadata');
  return dispatch;
}

function eligibility(dispatch, issue, trustedMainSha) {
  try { validateDispatch(dispatch); } catch (error) { return { eligible: false, reason: error.message }; }
  const labels = new Set((issue?.labels || []).map((label) => typeof label === 'string' ? label : label.name));
  if (issue?.number !== dispatch.candidateIssueNumber || issue?.state !== 'open') return { eligible: false, reason: 'Candidate Issue identity or state mismatch' };
  if (!labels.has('SI-후보') || labels.has('SI-보류') || labels.has('SI-거절')) return { eligible: false, reason: 'Candidate labels are not eligible' };
  if (dispatch.verificationStatus !== 'PASS') return { eligible: false, reason: 'Verification did not pass' };
  if (dispatch.totalScore < 10) return { eligible: false, reason: 'Candidate score is below 10' };
  if (trustedMainSha !== dispatch.sourceMergeSha) return { eligible: false, reason: 'Trusted main SHA does not match source merge SHA' };
  return { eligible: true, reason: 'eligible' };
}

function implementationMarker(key) {
  if (!KEY.test(key)) throw new Error('Invalid Candidate Key');
  return `<!-- autonomous-implementation-candidate-key: ${key} -->`;
}

function patchDigest(patch) {
  return createHash('sha256').update(patch).digest('hex');
}

function validateManifest(manifest, dispatch, patch, currentBaseSha) {
  validateDispatch(dispatch);
  if (!manifest || manifest.schemaVersion !== 1 || manifest.candidateKey !== dispatch.candidateKey ||
      manifest.candidateIssueNumber !== dispatch.candidateIssueNumber || manifest.baseSha !== dispatch.sourceMergeSha ||
      currentBaseSha !== manifest.baseSha || manifest.patchSha256 !== patchDigest(patch) ||
      manifest.tests !== 'npm test: PASS') throw new Error('Implementation artifact validation failed');
  if (!patch.trim()) throw new Error('Implementation patch is empty');
  return true;
}

function preparePrompt(dispatch) {
  validateDispatch(dispatch);
  return `Implement the following validated self-improvement Candidate. This trusted publication metadata, not the mutable GitHub Issue body, is the sole requirements source.\n\nCandidate Issue: #${dispatch.candidateIssueNumber}\nCandidate Key: ${dispatch.candidateKey}\nTitle: ${dispatch.title}\n\nSuggested Scope:\n${dispatch.suggestedScope}\n\nNon-Goals:\n${dispatch.nonGoals}\n\nPreserve existing behavior, add relevant regression tests, and make the full test suite pass. Do not commit, push, create a pull request, merge, alter workflows, or bypass tests.`;
}

if (require.main === module) {
  const [command] = process.argv.slice(2);
  const dispatch = JSON.parse(readFileSync('candidate-dispatch/candidate-dispatch.json', 'utf8'));
  if (command === 'prepare') writeFileSync('autonomous-implementation-prompt.md', preparePrompt(dispatch));
  else if (command === 'manifest') {
    const patch = readFileSync('implementation.patch', 'utf8');
    validateDispatch(dispatch);
    writeFileSync('implementation-manifest.json', JSON.stringify({ schemaVersion: 1, candidateKey: dispatch.candidateKey,
      candidateIssueNumber: dispatch.candidateIssueNumber, baseSha: dispatch.sourceMergeSha,
      patchSha256: patchDigest(patch), tests: 'npm test: PASS' }, null, 2));
  } else throw new Error(`Unknown command: ${command}`);
}

module.exports = { eligibility, implementationMarker, patchDigest, preparePrompt, validateDispatch, validateManifest };
