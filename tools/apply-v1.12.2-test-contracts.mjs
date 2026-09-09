import fs from 'node:fs';

const url = new URL('../tests/studio-diagnostics.mjs', import.meta.url);
let code = fs.readFileSync(url, 'utf8');

const before = `const failure = await collect(fixture({ intervalFailure: true }));
assert.equal(failure.report.status, 'failed');
assert.equal(failure.report.checks.find(c => c.id === 'duplicate-control').code, 'duplicate-interval-extractor');
assert.equal(failure.report.checks.find(c => c.id === 'candidate-16').code, 'duplicate-interval-extractor');
assert.ok(failure.entries.some(([name]) => name === 'matrix-current.xlsx'), 'server failure discarded prior evidence');`;

const after = `const failure = await collect(fixture({ intervalFailure: true }));
assert.equal(failure.report.status, 'failed');
const duplicateCapability = failure.report.checks.find(c => c.id === 'duplicate-control');
assert.equal(duplicateCapability.status, 'pass');
assert.equal(duplicateCapability.warning, true);
assert.equal(duplicateCapability.capability, 'unsupported-server-contract');
assert.match(duplicateCapability.detail, /LeftOperandExtractor/i);
// The generic control is a known server capability limitation, but an actual Excel
// candidate that cannot pass ValidateDuplicate remains a hard fail-closed blocker.
assert.equal(failure.report.checks.find(c => c.id === 'candidate-16').code, 'duplicate-interval-extractor');
assert.ok(failure.entries.some(([name]) => name === 'matrix-current.xlsx'), 'server failure discarded prior evidence');`;

if (code.includes(after)) {
  console.log('v1.12.2 Studio diagnostics contract already applied');
  process.exit(0);
}
if (!code.includes(before)) throw new Error('studio-diagnostics contract pattern not found');
code = code.replace(before, after);
fs.writeFileSync(url, code);
console.log('Applied v1.12.2 Studio diagnostics capability contract');
