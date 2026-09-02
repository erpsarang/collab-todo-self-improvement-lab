#!/usr/bin/env node

// This file is copied outside the Candidate-writable checkout before Codex runs.
// Keep it standalone: loading any repository module during verification would
// let the Candidate alter the trust decision.
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');

function isTrustedTestPath(path) {
  return /(^|\/)(?:test|tests|__tests__)(?:\/|$)/u.test(path) ||
    /(?:^|\/)[^/]+\.(?:test|spec)\.[^/]+$/u.test(path);
}

function verifyTrustedTests(snapshot) {
  if (!Array.isArray(snapshot) || snapshot.length === 0) throw new Error('Trusted base test snapshot is empty');
  for (const entry of snapshot) {
    if (!entry || typeof entry.path !== 'string' || !isTrustedTestPath(entry.path) ||
        !/^[0-9a-f]{64}$/u.test(entry.sha256)) throw new Error('Trusted base test snapshot is invalid');
    let contents;
    try { contents = readFileSync(entry.path); } catch { throw new Error(`Trusted test was deleted: ${entry.path}`); }
    if (createHash('sha256').update(contents).digest('hex') !== entry.sha256) {
      throw new Error(`Trusted test was modified: ${entry.path}`);
    }
  }
  return true;
}

if (require.main === module) {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) throw new Error('Trusted test snapshot path is required');
  verifyTrustedTests(JSON.parse(readFileSync(snapshotPath, 'utf8')));
}

module.exports = { isTrustedTestPath, verifyTrustedTests };
