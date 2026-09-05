import fs from 'node:fs';

const file = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(file, 'utf8');
const before = `      for (const action of candidates) {
        await assertContext();
        const created = await bridge.createRowCard(structure.templateId);
        await assertContext();
        bridge.rebuildRowCard(created.card, created.versionId, action.excelRow, structure, snapshot);
        await probe('proposed-add', created.card, created.versionId, action.excelRow.excelRow);
      }`;
const after = `      // Live control can be saved-rebuilt=allowed while CardNew/proposed-add alone
      // fails with LeftOperandExtractor. Reuse the first rejected outgoing CardNew
      // payload for the same three one-variable interval-marker probes. If the rebuilt
      // control already ran those probes, do not double the diagnostic request budget.
      const rebuiltStructuralRan = report.samples.some(sample =>
        sample?.structuralMode && String(sample.kind || '').startsWith('saved-rebuilt-'));
      let proposedStructuralProbed = false;
      for (const action of candidates) {
        await assertContext();
        const created = await bridge.createRowCard(structure.templateId);
        await assertContext();
        bridge.rebuildRowCard(created.card, created.versionId, action.excelRow, structure, snapshot);
        const proposedSample = await probe('proposed-add', created.card, created.versionId, action.excelRow.excelRow);
        if (!rebuiltStructuralRan && !proposedStructuralProbed
          && proposedSample?.outcome === 'rejected'
          && proposedSample?.code === 'duplicate-interval-extractor') {
          proposedStructuralProbed = true;
          for (const mode of ['clear-interval-changed', 'clear-interval-state', 'clear-interval-markers']) {
            await probe(\`proposed-add-\${mode}\`, created.card, created.versionId, action.excelRow.excelRow, mode);
          }
        }
      }`;

const count = code.split(before).length - 1;
if (count !== 1) throw new Error(`candidate loop: expected exactly one source block, got ${count}`);
code = code.replace(before, after);
fs.writeFileSync(file, code);

const testFile = 'tests/interval-diagnostics.mjs';
let test = fs.readFileSync(testFile, 'utf8');
const oldContract = `assert.deepEqual(acceptedResult.samples.map(s => s.kind), ['saved-original', 'saved-rebuilt', 'proposed-add', 'proposed-add']);
assert.equal(acceptedResult.samples[1].outcome, 'allowed');
assert.equal(acceptedResult.samples.some(s => s.structuralMode), false, 'structural probes ran without a rejected rebuilt control');
assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'request').length, 4);`;
const newContract = `assert.deepEqual(acceptedResult.samples.map(s => s.kind), [
  'saved-original',
  'saved-rebuilt',
  'proposed-add',
  'proposed-add-clear-interval-changed',
  'proposed-add-clear-interval-state',
  'proposed-add-clear-interval-markers',
  'proposed-add',
]);
assert.equal(acceptedResult.samples[1].outcome, 'allowed');
assert.deepEqual(acceptedResult.samples.filter(s => s.structuralMode).map(s => s.structuralMode), [
  'clear-interval-changed', 'clear-interval-state', 'clear-interval-markers',
], 'rejected proposed-add must get marker probes when rebuilt control is allowed');
assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'request').length, 7);`;
const testCount = test.split(oldContract).length - 1;
if (testCount !== 1) throw new Error(`accepted-rebuilt contract: expected exactly one source block, got ${testCount}`);
test = test.replace(oldContract, newContract);
fs.writeFileSync(testFile, test);

for (const path of [
  '.github/workflows/temporary-proposed-add-interval-probe-patch.yml',
  'tools/temporary-proposed-add-interval-probe-patch.mjs',
]) {
  try { fs.unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

console.log('patched rejected proposed-add interval probes, aligned regression contract, and self-cleaned temporary files');
