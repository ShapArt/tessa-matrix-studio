import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const workflows = {
  quality: read('.github/workflows/quality.yml'),
  release: read('.github/workflows/release.yml'),
  canary: read('.github/workflows/delivery-canary.yml'),
};

for (const [name, workflow] of Object.entries(workflows)) {
  for (const match of workflow.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)) {
    const ref = match[1];
    assert(/@[0-9a-f]{40}$/i.test(ref), `${name} workflow action is not pinned to a full commit SHA: ${ref}`);
  }
}

// Tests should not inherit CodeQL's write permission. Only the CodeQL job needs security-events: write.
assert(/^permissions:\n\s+contents:\s+read\s*$/m.test(workflows.quality),
  'quality workflow must default to read-only contents permission');
assert(/\n\s+codeql:\n(?:.|\n)*?\n\s+permissions:\n\s+contents:\s+read\n\s+security-events:\s+write/m.test(workflows.quality),
  'CodeQL job must explicitly receive security-events: write');
assert(!/permissions:\n\s+contents:\s+read\n\s+security-events:\s+write\n\njobs:/m.test(workflows.quality),
  'security-events: write must not be granted workflow-wide');

console.log('TESSA Matrix Studio workflow supply-chain security checks: OK');
