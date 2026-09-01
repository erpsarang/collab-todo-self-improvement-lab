const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { candidateKey, hasRunMarker, publicationDecision } = require('../scripts/self-improvement-candidate');
const { candidateMemory } = require('../scripts/self-improvement-review');

const workflowPath = join(__dirname, '../.github/workflows/self-improvement-candidate-publisher.yml');
const workflow = () => readFileSync(workflowPath, 'utf8');

function workflowScript(source, stepName) {
  const step = source.indexOf(`      - name: ${stepName}`);
  const marker = source.indexOf('          script: |\n', step);
  const end = source.indexOf('\n      - name:', marker + 1);
  return source.slice(marker + '          script: |\n'.length, end === -1 ? source.length : end)
    .split('\n').map((line) => line.startsWith('            ') ? line.slice(12) : line).join('\n');
}

test('review workflow GitHub Script parses without duplicate candidate bindings', () => {
  const source = readFileSync(join(__dirname, '../.github/workflows/self-improvement-review.yml'), 'utf8');
  const script = workflowScript(source, 'Verify the human-merged pull request');
  assert.doesNotThrow(() => new Function(`return async function () {\n${script}\n}`));
  assert.equal((script.match(/const candidates\b/g) || []).length, 0);
  assert.match(script, /const mergedPrCandidates\b/);
  assert.match(script, /const candidateMemoryEntries\b/);
});

test('publisher preserves complete multiline candidate sections in the registry Issue body', async () => {
  const source = workflow();
  const script = workflowScript(source, 'Publish candidate record');
  assert.doesNotThrow(() => new Function(`return async function () {\n${script}\n}`));

  const scores = '- Value: 5\n- Breadth: 4\n- Confidence: 5\n- Safety: 4\n- Feasibility: 5\n- Total: 23';
  const evidence = '- First evidence line\n```markdown\n## Impact\nExample impact only\n```\n- Second evidence line';
  const scope = '- First scope item\n- Second scope item';
  const nonGoals = '- First exclusion\n```markdown\n# Result\n\nNO_CANDIDATE\n```\n- Second exclusion';
  const markdown = `# Verification PASS
## Verification Target
Merged implementation
## Verification Evidence
Check one passed.\nCheck two passed.
## Residual Risk
Risk line one.\nRisk line two.
# Result
CANDIDATE
## Title
Preserve multiline candidate sections
## Observation
Observation line one.\nObservation line two.
## Evidence
${evidence}
## Impact
Impact line one.\nImpact line two.
## Scores
${scores}
## Suggested Scope
${scope}
## Non-Goals
${nonGoals}`;
  const directory = mkdtempSync(join(tmpdir(), 'candidate-publisher-'));
  mkdirSync(join(directory, 'candidate-artifact'));
  writeFileSync(join(directory, 'candidate-artifact/self-improvement-result.md'), markdown);
  let created;
  const github = {
    paginate: async () => [],
    rest: { issues: {
      getLabel: async () => ({}),
      createLabel: async () => ({}),
      listForRepo: async () => ({ data: [] }),
      listComments: async () => ({ data: [] }),
      createComment: async () => ({}),
      create: async (input) => { created = input; },
    } },
  };
  const previousCwd = process.cwd();
  const previousRun = process.env.SOURCE_RUN_ID;
  const previousSha = process.env.SOURCE_HEAD_SHA;
  process.chdir(directory);
  process.env.SOURCE_RUN_ID = '321';
  process.env.SOURCE_HEAD_SHA = 'a'.repeat(40);
  try {
    await new Function('require', 'github', 'context', 'core', `return (async () => {\n${script}\n})()`)(
      require, github, { repo: { owner: 'owner', repo: 'repo' } }, { info() {} },
    );
  } finally {
    process.chdir(previousCwd);
    if (previousRun === undefined) delete process.env.SOURCE_RUN_ID; else process.env.SOURCE_RUN_ID = previousRun;
    if (previousSha === undefined) delete process.env.SOURCE_HEAD_SHA; else process.env.SOURCE_HEAD_SHA = previousSha;
  }
  assert.ok(created, 'Candidate Registry Issue was not created');
  for (const section of [scores, evidence, scope, nonGoals]) assert.ok(created.body.includes(section));
  assert.match(created.body, /## Verification Evidence\nCheck one passed\.\nCheck two passed\./);
  assert.match(created.body, /## Residual Risk\nRisk line one\.\nRisk line two\./);
  assert.match(created.body, /## Observation\nObservation line one\.\nObservation line two\./);
  assert.match(created.body, /## Impact\nImpact line one\.\nImpact line two\./);
  assert.match(created.body, /## Evidence\n- First evidence line\n```markdown\n## Impact/);
});

test('publisher gives every source run an independent scheduling opportunity', () => {
  const source = workflow();
  assert.doesNotMatch(source, /^concurrency:/m);
});

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
  assert.equal(publicationDecision('# Result\n\nCANDIDATE\n\n## Non-Goals\n```markdown\n# Result\n\nNO_CANDIDATE\n```'), 'CANDIDATE');
  const source = workflow();
  assert.ok(source.indexOf("result === 'NO_CANDIDATE'") < source.indexOf('issues.create({'));
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
  assert.match(source, /String\(existing\.body \|\| ''\)\.includes\(runMarker\)/);
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
