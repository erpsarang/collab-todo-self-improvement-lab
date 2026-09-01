const { createHash } = require('node:crypto');

function candidateKey(title) {
  const normalized = String(title).normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

function publicationDecision(markdown) {
  const matches = [...String(markdown).trim().matchAll(/^# Result\s+(NO_CANDIDATE|CANDIDATE)(?:\s|$)/gmu)];
  const match = matches.at(-1);
  if (!match) throw new Error('Validated result has no recognized result');
  return match[1];
}

function hasRunMarker(comments, runId) {
  const marker = `<!-- self-improvement-review-run: ${runId} -->`;
  return comments.some((comment) => String(comment.body || comment).includes(marker));
}

module.exports = { candidateKey, hasRunMarker, publicationDecision };
