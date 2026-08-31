#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const { readFileSync, writeFileSync } = require('node:fs');

const OUTPUT = 'self-improvement-result.md';
const API_URL = 'https://models.github.ai/inference/chat/completions';
const MODEL = 'openai/gpt-4.1';
const MAX_CONTEXT_CHARS = 80_000;

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function repositoryContext() {
  const files = git('ls-files')
    .split('\n')
    .filter(Boolean)
    .filter((file) => !file.startsWith('.git/'));
  const sections = [];

  for (const file of files) {
    try {
      const contents = readFileSync(file, 'utf8');
      if (!contents.includes('\0')) sections.push(`\n===== ${file} =====\n${contents}`);
    } catch {
      // A tracked file may disappear between enumeration and reading.
    }
  }

  const base = process.env.MERGE_BASE_SHA;
  let mergedDiff = '(merge base was unavailable)';
  if (base && /^[0-9a-f]{7,40}$/i.test(base)) {
    try {
      mergedDiff = git('diff', '--stat', base, 'HEAD') + '\n' + git('diff', '--no-ext-diff', base, 'HEAD');
    } catch {
      mergedDiff = '(the merged diff could not be read; use the repository and recent history)';
    }
  }

  const context = [
    `Merged PR: #${process.env.MERGED_PR_NUMBER || 'unknown'} ${process.env.MERGED_PR_TITLE || ''}`,
    `Recent history:\n${git('log', '--oneline', '-12')}`,
    `Merged change:\n${mergedDiff}`,
    `Current tracked repository files:${sections.join('')}`,
  ].join('\n\n');

  return context.slice(0, MAX_CONTEXT_CHARS);
}

function prompt(context) {
  return `You are performing a read-only self-improvement review of a collaborative to-do application.
Judge whether there is ONE improvement worth investing in now. Prefer NO_CANDIDATE over a weak,
speculative, cosmetic, convenience-only, style, naming, documentation-only, coverage-only,
unobserved-performance, unnecessary-refactoring, or future-abstraction suggestion. Do not suggest
anything already implemented or intentionally excluded by the product's current scope.

Consider the whole repository, tests, README, current user workflows, the merged change, concrete
reliability/data-loss risks, collaboration quality, and deliberately omitted features. Evidence must
identify concrete current repository behavior; generic best practice or predicted user preference is
not evidence.

Score an otherwise valid candidate from 0 to 3 for User Impact, Reliability Impact, Collaboration
Impact, Evidence Strength, and Urgency. Return CANDIDATE only if total >= 9, Evidence Strength >= 2,
and at least one of User/Reliability/Collaboration Impact is 3. Never inflate scores to pass.

Return markdown only, in exactly one of these shapes:

# Result

NO_CANDIDATE

## Reason

<why no repository-backed improvement clears every threshold, including notable exclusions>

OR:

# Result

CANDIDATE

## Title
<title>
## Observation
<current behavior>
## Evidence
<repository file/behavior evidence>
## Impact
<meaningful impact>
## Scores
- User Impact: N
- Reliability Impact: N
- Collaboration Impact: N
- Evidence Strength: N
- Urgency: N

Total: N/15
## Suggested Scope
<minimum useful scope>
## Non-Goals
<explicit exclusions>

Do not create or modify an issue, code, branch, pull request, label, or repository content.

REPOSITORY CONTEXT
${context}`;
}

function validate(result) {
  const normalized = result.trim();
  if (/^# Result\s+NO_CANDIDATE\s+## Reason\s+\S[\s\S]*$/u.test(normalized)) return normalized + '\n';
  if (!/^# Result\s+CANDIDATE\s+/u.test(normalized)) throw new Error('Model returned an unknown result');

  for (const heading of ['Title', 'Observation', 'Evidence', 'Impact', 'Scores', 'Suggested Scope', 'Non-Goals']) {
    if (!normalized.includes(`## ${heading}`)) throw new Error(`Candidate is missing ${heading}`);
  }
  const labels = ['User Impact', 'Reliability Impact', 'Collaboration Impact', 'Evidence Strength', 'Urgency'];
  const scores = Object.fromEntries(labels.map((label) => {
    const match = normalized.match(new RegExp(`- ${label}: ([0-3])(?:\\s|$)`));
    if (!match) throw new Error(`Candidate has an invalid ${label} score`);
    return [label, Number(match[1])];
  }));
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  if (total < 9 || scores['Evidence Strength'] < 2 || Math.max(scores['User Impact'], scores['Reliability Impact'], scores['Collaboration Impact']) < 3) {
    throw new Error('Candidate does not meet the value and evidence thresholds');
  }
  if (!normalized.includes(`Total: ${total}/15`)) throw new Error('Candidate total does not match its scores');
  return normalized + '\n';
}

async function main() {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required');
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.1, max_tokens: 1800, messages: [{ role: 'user', content: prompt(repositoryContext()) }] }),
  });
  if (!response.ok) throw new Error(`GitHub Models request failed (${response.status}): ${await response.text()}`);
  const body = await response.json();
  const result = body.choices?.[0]?.message?.content;
  if (typeof result !== 'string') throw new Error('GitHub Models returned no review text');
  writeFileSync(OUTPUT, validate(result), 'utf8');
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { validate };
