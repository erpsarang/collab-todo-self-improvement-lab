const test = require('node:test');
const assert = require('node:assert/strict');
const { validate } = require('../scripts/self-improvement-review');

test('NO_CANDIDATE is a successful review result', () => {
  assert.match(validate('# Result\n\nNO_CANDIDATE\n\n## Reason\n\nNo evidence clears the thresholds.'), /NO_CANDIDATE/);
});

test('a candidate must clear every value and evidence threshold', () => {
  const weak = `# Result\n\nCANDIDATE\n\n## Title\nWeak\n## Observation\nObserved\n## Evidence\nFile\n## Impact\nSmall\n## Scores\n- User Impact: 2\n- Reliability Impact: 2\n- Collaboration Impact: 2\n- Evidence Strength: 2\n- Urgency: 2\n\nTotal: 10/15\n## Suggested Scope\nChange\n## Non-Goals\nOther`;
  assert.throws(() => validate(weak), /thresholds/);
});

test('a well-formed candidate with sufficient scores is accepted', () => {
  const strong = `# Result\n\nCANDIDATE\n\n## Title\nData safety\n## Observation\nObserved\n## Evidence\nsrc/store.js behavior\n## Impact\nData loss\n## Scores\n- User Impact: 3\n- Reliability Impact: 3\n- Collaboration Impact: 2\n- Evidence Strength: 3\n- Urgency: 2\n\nTotal: 13/15\n## Suggested Scope\nPersist data\n## Non-Goals\nExternal database`;
  assert.match(validate(strong), /Total: 13\/15/);
});
