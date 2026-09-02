const { createHash } = require('node:crypto');

function candidateKey(title) {
  const normalized = String(title).normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ');
  return `sha256:${createHash('sha256').update(normalized).digest('hex')}`;
}

function candidateKeyFromRegistryBody(body) {
  return String(body || '').match(
    /^<!-- self-improvement-candidate-key: (sha256:[0-9a-f]{64}) -->(?:\r?\n|$)/u,
  )?.[1] || null;
}

function publicationDecision(markdown) {
  const source = String(markdown).trim();
  let fence = null;
  for (const line of source.matchAll(/^(.*)(?:\r?\n|$)/gmu)) {
    const fenceMatch = line[1].match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      const length = fenceMatch[1].length;
      if (!fence) fence = { marker, length };
      else if (fence.marker === marker && length >= fence.length && /^\s*$/u.test(fenceMatch[2])) fence = null;
      continue;
    }
    if (!fence && /^# Result\s*$/u.test(line[1])) {
      const result = source.slice(line.index + line[1].length).trim().match(/^(NO_CANDIDATE|CANDIDATE)(?:\s|$)/u)?.[1];
      if (result) return result;
    }
  }
  throw new Error('Validated result has no recognized result');
}

function hasRunMarker(comments, runId) {
  const marker = `<!-- self-improvement-review-run: ${runId} -->`;
  return comments.some((comment) => String(comment.body || comment).includes(marker));
}

module.exports = { candidateKey, candidateKeyFromRegistryBody, hasRunMarker, publicationDecision };
