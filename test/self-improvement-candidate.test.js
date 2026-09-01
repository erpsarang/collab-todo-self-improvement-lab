const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { candidateKey, hasRunMarker, publicationDecision } = require('../scripts/self-improvement-candidate');
const { candidateMemory } = require('../scripts/self-improvement-review');

const workflowPath = join(__dirname, '../.github/workflows/self-improvement-candidate-publisher.yml');
const workflow = () => readFileSync(workflowPath, 'utf8');

test('publisher accepts only a successful trusted review on main', () => {
  const source = workflow();
  assert.match(source, /run\.name !== 'Self-Improvement Review'/);
  assert.match(source, /run\.path !== '\.github\/workflows\/self-improvement-review\.yml'/);
  assert.match(source, /run\.event !== 'workflow_run'/);
  assert.match(source, /run\.conclusion !== 'success'/);
  assert.match(source, /run\.head_branch !== 'main'/);
  assert.match(source, /run\.id !== expected\.id/);
  assert.match(source, /run\.head_sha !== expected\.head_sha/);
});

test('publisher uses only the exact validated artifact', () => {
  const source = workflow();
  assert.match(source, /artifact\.name === 'self-improvement-review'/);
  assert.match(source, /candidate-artifact\/self-improvement-result\.md/);
  assert.doesNotMatch(source, /self-improvement-raw\.md/);
  assert.doesNotMatch(source, /actions\/checkout|npm (?:install|test)|OPENAI_API_KEY|codex-action/);
});

test('publisher has minimal write permissions and no repository write access', () => {
  const permissions = workflow().match(/^permissions:\n((?:  [^\n]+\n)+)/m);
  assert.equal(permissions?.[1], '  actions: read\n  issues: write\n');
  assert.doesNotMatch(permissions[1], /contents:|pull-requests:|actions: write/);
});

test('NO_CANDIDATE exits without creating an Issue while CANDIDATE can publish', () => {
  assert.equal(publicationDecision('# Result\n\nNO_CANDIDATE\n\n## Reason\nNone'), 'NO_CANDIDATE');
  assert.equal(publicationDecision('# Result\n\nCANDIDATE\n\n## Title\nSafety'), 'CANDIDATE');
  assert.equal(publicationDecision('# Result\n\nNO_CANDIDATE\n\n# Result\n\nCANDIDATE'), 'CANDIDATE');
  const source = workflow();
  assert.ok(source.indexOf("resultMatch[1] === 'NO_CANDIDATE'") < source.indexOf('issues.create({'));
});

test('candidate keys normalize Unicode case and whitespace deterministically', () => {
  const expected = candidateKey(' Prevent   Silent Overwrites ');
  assert.equal(candidateKey('prevent silent overwrites'), expected);
  assert.equal(candidateKey('ＰＲＥＶＥＮＴ silent overwrites'), expected);
  assert.match(expected, /^sha256:[0-9a-f]{64}$/);
});

test('publisher deduplicates keys and recurrence comments by run ID', () => {
  const source = workflow();
  assert.match(source, /includes\(keyMarker\)/);
  assert.match(source, /if \(existing\)/);
  assert.match(source, /comments\.some.*includes\(runMarker\)/s);
  assert.equal(hasRunMarker([{ body: '<!-- self-improvement-review-run: 108 -->' }], 108), true);
  assert.equal(hasRunMarker([], 108), false);
});

test('new records receive the registry and pending human-decision labels', () => {
  const source = workflow();
  assert.match(source, /labels: \['SI-후보', 'SI-승인대기'\]/);
  for (const label of ['SI-승인대기', 'SI-승인', 'SI-보류', 'SI-거절']) assert.match(source, new RegExp(label));
  assert.match(source, /Approval does not start implementation/);
});

test('candidate memory preserves bounded metadata and all human decisions', () => {
  const candidates = ['SI-승인대기', 'SI-승인', 'SI-보류', 'SI-거절'].map((decision, index) => ({
    number: index + 1,
    title: `[Self-Improvement Candidate] Candidate ${index + 1}`,
    key: `sha256:${String(index).repeat(64)}`,
    labels: ['SI-후보', decision],
    state: 'open',
    body: 'BODY_MUST_NOT_ENTER_MEMORY'.repeat(1_000),
  }));
  const memory = candidateMemory(JSON.stringify(candidates));
  assert.ok(memory.length <= 8_000);
  assert.doesNotMatch(memory, /BODY_MUST_NOT_ENTER_MEMORY/);
  for (const decision of ['SI-승인대기', 'SI-승인', 'SI-보류', 'SI-거절']) assert.match(memory, new RegExp(decision));
  assert.match(memory, /Issue #1\nTitle: Candidate 1\nCandidate Key:/);
});

test('review prompt compares memory only after VERIFY and OBSERVE', () => {
  const source = readFileSync(join(__dirname, '../scripts/self-improvement-review.js'), 'utf8');
  assert.match(source, /Only after VERIFY and current-repository OBSERVE/);
  assert.match(source, /genuinely NEW candidate from a REOBSERVED candidate/);
  assert.match(source, /For SI-보류 or SI-거절, require concrete evidence/);
  assert.ok(source.indexOf('First VERIFY') < source.indexOf('Only after VERIFY'));
});

test('candidate memory has a separate budget from current repository evidence', () => {
  const source = readFileSync(join(__dirname, '../scripts/self-improvement-review.js'), 'utf8');
  assert.match(source, /currentEvidence\.slice\(0, MAX_CONTEXT_CHARS\)/);
  assert.match(source, /MAX_CANDIDATE_MEMORY_CHARS = 8_000/);
  assert.ok(source.indexOf('Current tracked repository files:') < source.indexOf('SELF-IMPROVEMENT CANDIDATE MEMORY'));
});
