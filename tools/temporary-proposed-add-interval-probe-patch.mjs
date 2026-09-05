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

for (const path of [
  '.github/workflows/temporary-proposed-add-interval-probe-patch.yml',
  'tools/temporary-proposed-add-interval-probe-patch.mjs',
]) {
  try { fs.unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

console.log('patched rejected proposed-add interval probes and self-cleaned temporary files');
