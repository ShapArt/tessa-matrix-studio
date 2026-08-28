import fs from 'node:fs';

const files = [
  '.github/workflows/quality.yml',
  '.github/workflows/release.yml',
  '.github/workflows/delivery-canary.yml',
];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

for (const path of files) {
  const text = fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const uses = [...text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+).*$/gm)].map(match => match[1]);

  for (const ref of uses) {
    // Local reusable actions (./...) are part of this repository and do not need a remote SHA.
    if (ref.startsWith('./')) continue;
    const at = ref.lastIndexOf('@');
    assert(at > 0, `${path}: action reference has no @ref: ${ref}`);
    const revision = ref.slice(at + 1);
    assert(/^[0-9a-f]{40}$/i.test(revision), `${path}: external action must be pinned to a full 40-char commit SHA: ${ref}`);
  }
}

console.log('TESSA Matrix Studio workflow action pinning checks: OK');
