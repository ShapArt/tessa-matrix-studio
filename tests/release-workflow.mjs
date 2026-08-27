import fs from 'node:fs';

const workflow = fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(workflow.includes('workflow_run:'), 'release must wait for Quality & Security workflow completion');
assert(workflow.includes('workflows: ["Quality & Security"]'), 'release must be chained to Quality & Security');
assert(workflow.includes('types: [completed]'), 'release workflow_run must wait for completed');
assert(workflow.includes('branches: [main]'), 'release workflow_run must be limited to main');
assert(workflow.includes("github.event.workflow_run.conclusion == 'success'"), 'release must require successful Quality & Security');
assert(workflow.includes('workflow_dispatch:'), 'manual release fallback must stay available');
assert(workflow.includes('github.event.workflow_run.head_sha'), 'release must checkout the exact verified commit');
assert(workflow.includes('git diff-tree'), 'release must detect whether userscript changed');
assert(workflow.includes('tessa-matrix-studio.user.js'), 'release change gate must watch the userscript');

// Release assets must be independently verifiable after download.
assert(workflow.includes('sha256sum'), 'release must calculate SHA-256 checksums');
assert(workflow.includes('SHA256SUMS.txt'), 'release must publish SHA256SUMS.txt');
const checksumMentions = (workflow.match(/SHA256SUMS\.txt/g) || []).length;
assert(checksumMentions >= 3, 'SHA256SUMS.txt must be built and uploaded for existing/new releases');

console.log('TESSA Matrix Studio release workflow checks: OK');
