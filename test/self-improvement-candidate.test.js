const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { candidateKey, hasRunMarker, publicationDecision } = require('../scripts/self-improvement-candidate');
const { candidateMemory, validatedPublication } = require('../scripts/self-improvement-review');

const workflowPath = join(__dirname, '../.github/workflows/self-improvement-candidate-publisher.yml');
const workflow = () => readFileSync(workflowPath, 'utf8');

function workflowScript(source, stepName) {
  const step = source.indexOf(`      - name: ${stepName}`);
  const marker = source.indexOf('          script: |\n', step);
  const end = source.indexOf('\n      - name:', marker + 1);
  return source.slice(marker + '          script: |\n'.length, end === -1 ? source.length : end)
    .split('\n').map((line) => line.startsWith('            ') ? line.slice(12) : line).join('\n');
}

function candidatePublication(overrides = {}) {
  return {
    schemaVersion: 1, result: 'CANDIDATE', verificationStatus: 'PASS', verificationTarget: 'Merged implementation',
    verificationEvidence: 'Check one passed.\nCheck two passed.', residualRisk: 'Risk line one.\nRisk line two.',
    verifiedMergeSha: 'b'.repeat(40), title: 'Preserve multiline candidate sections',
    observation: 'Observation line one.\nObservation line two.', evidence: '- First evidence line\n- Second evidence line',
    impact: 'Impact line one.\nImpact line two.',
    scores: { 'User Impact': 3, 'Reliability Impact': 3, 'Collaboration Impact': 1, 'Evidence Strength': 2, Urgency: 1 },
    total: 10, suggestedScope: '- First scope item\n- Second scope item', nonGoals: '- First exclusion\n- Second exclusion',
    ...overrides,
  };
}

test('review workflow GitHub Script parses without duplicate candidate bindings', () => {
  const source = readFileSync(join(__dirname, '../.github/workflows/self-improvement-review.yml'), 'utf8');
  const script = workflowScript(source, 'Verify the human-merged pull request');
  assert.doesNotThrow(() => new Function(`return async function () {\n${script}\n}`));
  assert.equal((script.match(/const candidates\b/g) || []).length, 0);
  assert.match(script, /const mergedPrCandidates\b/);
  assert.match(script, /const candidateMemoryEntries\b/);
});

test('publisher preserves validated multiline metadata in the registry Issue body', async () => {
  const source = workflow();
  const script = workflowScript(source, 'Publish candidate record');
  assert.doesNotThrow(() => new Function(`return async function () {\n${script}\n}`));

  const scores = '- User Impact: 3\n- Reliability Impact: 3\n- Collaboration Impact: 1\n- Evidence Strength: 2\n- Urgency: 1\n\nTotal: 10/15';
  const evidence = '- First evidence line\n```markdown\n## Impact\nExample impact only\n```\n- Second evidence line';
  const scope = '- First scope item\n- Second scope item';
  const nonGoals = '- First exclusion\n```markdown\n# Result\n\nNO_CANDIDATE\n```\n- Second exclusion';
  const directory = mkdtempSync(join(tmpdir(), 'candidate-publisher-'));
  mkdirSync(join(directory, 'candidate-artifact'));
  writeFileSync(join(directory, 'candidate-artifact/self-improvement-publication.json'), JSON.stringify(candidatePublication({ evidence, suggestedScope: scope, nonGoals })));
  let created;
  const issues = [];
  const github = {
    paginate: async (method, input) => (await method(input)).data,
    rest: { issues: {
      getLabel: async () => ({}),
      createLabel: async () => ({}),
      listForRepo: async () => ({ data: issues.filter((issue) => issue.labels.includes('SI-후보')) }),
      listComments: async () => ({ data: [] }),
      createComment: async () => ({}),
      removeLabel: async () => ({}),
      update: async () => ({}),
      create: async (input) => {
        created = input;
        issues.push({ ...input, number: 1 });
      },
    } },
  };
  const previousCwd = process.cwd();
  const previousRun = process.env.SOURCE_RUN_ID;
  process.chdir(directory);
  process.env.SOURCE_RUN_ID = '321';
  try {
    await new Function('require', 'github', 'context', 'core', `return (async () => {\n${script}\n})()`)(
      require, github, { repo: { owner: 'owner', repo: 'repo' } }, { info() {} },
    );
  } finally {
    process.chdir(previousCwd);
    if (previousRun === undefined) delete process.env.SOURCE_RUN_ID; else process.env.SOURCE_RUN_ID = previousRun;
  }
  assert.ok(created, 'Candidate Registry Issue was not created');
  assert.match(created.title, /Preserve multiline candidate sections/);
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
  assert.match(source, /candidate-artifact\/self-improvement-publication\.json/);
  assert.doesNotMatch(source, /candidate-artifact\/self-improvement-result\.md|# Result|structuralHeadings/);
  assert.doesNotMatch(source, /self-improvement-raw\.md/);
  assert.doesNotMatch(source, /actions\/checkout|npm (?:install|test)|OPENAI_API_KEY|codex-action/);
});

test('validator publication metadata preserves its recognized result and trusted merge SHA', () => {
  const markdown = `# Verification
PASS
## Verification Target
Issue #21
## Verification Evidence
Diagnostic output included a rejected structural heading:
# Result
INVALID
\`\`\`markdown
## Evidence
fenced example
# Result
NO_CANDIDATE
\`\`\`
The actual validated result follows.
## Residual Risk
None.
# Result
CANDIDATE
## Title
Structured publication
## Observation
Line one.\nLine two.
## Evidence
Evidence one.\nEvidence two.
## Impact
Impact one.\nImpact two.
## Scores
- User Impact: 3
- Reliability Impact: 3
- Collaboration Impact: 1
- Evidence Strength: 2
- Urgency: 1

Total: 10/15
## Suggested Scope
Scope one.\nScope two.
## Non-Goals
Non-goal one.\nNon-goal two.`;
  const mergeSha = 'c'.repeat(40);
  const publication = validatedPublication(markdown, mergeSha);
  assert.equal(publication.result, 'CANDIDATE');
  assert.equal(publication.verifiedMergeSha, mergeSha);
  assert.equal(publication.evidence, 'Evidence one.\nEvidence two.');
  assert.equal(publication.suggestedScope, 'Scope one.\nScope two.');
  assert.equal(publication.nonGoals, 'Non-goal one.\nNon-goal two.');
  assert.match(publication.verificationEvidence, /# Result\nINVALID/);
});

test('NO_CANDIDATE metadata makes the publisher return before Issue APIs', async () => {
  const script = workflowScript(workflow(), 'Publish candidate record');
  const directory = mkdtempSync(join(tmpdir(), 'no-candidate-publisher-'));
  mkdirSync(join(directory, 'candidate-artifact'));
  writeFileSync(join(directory, 'candidate-artifact/self-improvement-publication.json'), JSON.stringify({
    schemaVersion: 1, result: 'NO_CANDIDATE', verificationStatus: 'PASS', verificationTarget: 'Issue #21',
    verificationEvidence: 'Verified.', residualRisk: 'None.', verifiedMergeSha: 'd'.repeat(40),
  }));
  const previousCwd = process.cwd();
  process.chdir(directory);
  try {
    await new Function('require', 'github', 'context', 'core', 'process', `return (async () => {\n${script}\n})()`)(
      require, { rest: { issues: new Proxy({}, { get() { throw new Error('Issue API must not be used'); } }) } },
      { repo: {} }, { info() {} }, { env: { SOURCE_RUN_ID: '10' } },
    );
  } finally {
    process.chdir(previousCwd);
  }
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
  assert.match(source, /matching\.sort\(\(left, right\) => left\.number - right\.number\)/);
  assert.match(source, /Duplicate Candidate Registry record reconciled/);
  assert.equal(hasRunMarker([{ body: '<!-- self-improvement-review-run: 108 -->' }], 108), true);
  assert.equal(hasRunMarker([], 108), false);
});

test('concurrent publishers reconcile one canonical key while preserving every source run', async () => {
  const script = workflowScript(workflow(), 'Publish candidate record');
  const directory = mkdtempSync(join(tmpdir(), 'candidate-race-'));
  mkdirSync(join(directory, 'candidate-artifact'));
  writeFileSync(join(directory, 'candidate-artifact/self-improvement-publication.json'), JSON.stringify(candidatePublication({
    verificationTarget: 'Issue #21', verificationEvidence: 'Verified.', residualRisk: 'None.', title: 'Concurrent candidate',
    observation: 'Observed.', evidence: 'Evidence.', impact: 'Impact.', suggestedScope: 'Reconcile.', nonGoals: 'No queue.',
  })));

  const issues = [{
    number: 99,
    title: '[Self-Improvement Candidate] Unrelated',
    body: '<!-- self-improvement-candidate-key: sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff -->',
    labels: ['SI-후보'],
    comments: [],
  }];
  let initialLists = 0;
  let releaseInitial;
  const initialBarrier = new Promise((resolve) => { releaseInitial = resolve; });
  const api = {
    getLabel: async () => ({}), createLabel: async () => ({}),
    listForRepo: async () => {
      initialLists += 1;
      if (initialLists <= 2) {
        if (initialLists === 2) releaseInitial();
        await initialBarrier;
      }
      return { data: issues.filter(({ labels }) => labels.includes('SI-후보')) };
    },
    listComments: async ({ issue_number: number }) => ({ data: issues.find((issue) => issue.number === number).comments }),
    create: async (input) => {
      const issue = { ...input, number: issues.length + 1, comments: [] };
      issues.push(issue);
      return { data: issue };
    },
    createComment: async ({ issue_number: number, body }) => {
      issues.find((issue) => issue.number === number).comments.push({ body });
    },
    removeLabel: async ({ issue_number: number, name }) => {
      const issue = issues.find((candidate) => candidate.number === number);
      issue.labels = issue.labels.filter((label) => label !== name);
    },
    update: async ({ issue_number: number, state }) => { issues.find((issue) => issue.number === number).state = state; },
  };
  const github = { paginate: async (method, input) => (await method(input)).data, rest: { issues: api } };
  const execute = (runId) => new Function('require', 'github', 'context', 'core', 'process',
    `return (async () => {\n${script}\n})()`)(require, github, { repo: {} }, { info() {} }, {
      env: { SOURCE_RUN_ID: String(runId) },
    });
  const previousCwd = process.cwd();
  process.chdir(directory);
  try {
    await Promise.all([execute(501), execute(502)]);
  } finally {
    process.chdir(previousCwd);
  }
  const candidateIssues = issues.filter(({ title }) => title.includes('Concurrent candidate'));
  const registryRecords = candidateIssues.filter(({ labels }) => labels.includes('SI-후보'));
  assert.equal(registryRecords.length, 1);
  assert.equal(registryRecords[0].number, Math.min(...candidateIssues.map(({ number }) => number)));
  const canonicalHistory = [registryRecords[0].body, ...registryRecords[0].comments.map(({ body }) => body)].join('\n');
  assert.match(canonicalHistory, /self-improvement-review-run: 501/);
  assert.match(canonicalHistory, /self-improvement-review-run: 502/);
  assert.deepEqual(issues.find(({ number }) => number === 99).labels, ['SI-후보']);
});

test('candidate memory fails closed when decision labels are ambiguous or absent', () => {
  const memory = candidateMemory(JSON.stringify([
    { number: 1, title: 'Conflicted', labels: ['SI-승인대기', 'SI-승인'], state: 'open' },
    { number: 2, title: 'Missing', labels: ['SI-후보'], state: 'open' },
  ]));
  assert.match(memory, /Human Decision: AMBIGUOUS \(SI-승인대기, SI-승인\)/);
  assert.match(memory, /Human Decision: AMBIGUOUS \(no decision label\)/);
  assert.doesNotMatch(memory, /Human Decision: SI-승인대기\nState: open\n\nIssue #2/);
});

test('decision normalizer keeps the newly applied human label and has no implementation boundary', async () => {
  const source = readFileSync(join(__dirname, '../.github/workflows/self-improvement-decision-normalizer.yml'), 'utf8');
  const script = workflowScript(source, 'Keep only the newly applied human decision');
  const labels = ['SI-후보', 'SI-승인대기', 'SI-승인'];
  const removed = [];
  const github = { rest: { issues: { removeLabel: async ({ name }) => {
    removed.push(name);
    labels.splice(labels.indexOf(name), 1);
  } } } };
  const context = { repo: {}, payload: { label: { name: 'SI-승인' }, issue: { number: 7, labels: labels.map((name) => ({ name })) } } };
  await new Function('github', 'context', `return (async () => {\n${script}\n})()`)(github, context);
  assert.deepEqual(removed, ['SI-승인대기']);
  assert.deepEqual(labels, ['SI-후보', 'SI-승인']);

  context.payload.label.name = 'SI-보류';
  context.payload.issue.labels = [...labels, 'SI-보류'].map((name) => ({ name }));
  await new Function('github', 'context', `return (async () => {\n${script}\n})()`)(github, context);
  assert.deepEqual(labels, ['SI-후보']);
  assert.deepEqual(removed, ['SI-승인대기', 'SI-승인']);
  assert.match(source, /^permissions:\n  issues: write\n/m);
  assert.doesNotMatch(source, /checkout|codex|OPENAI_API_KEY|contents:|pull-requests:|branches|merge/i);
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
