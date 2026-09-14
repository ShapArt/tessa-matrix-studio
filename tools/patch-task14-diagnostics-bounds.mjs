import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const sourcePath = new URL('tessa-matrix-studio.user.js', root);
const packagePath = new URL('package.json', root);
let source = fs.readFileSync(sourcePath, 'utf8');

function replaceOnce(oldText, newText, label) {
  const first = source.indexOf(oldText);
  assert.notEqual(first, -1, `${label}: source anchor not found`);
  assert.equal(source.indexOf(oldText, first + oldText.length), -1, `${label}: source anchor is not unique`);
  source = source.slice(0, first) + newText + source.slice(first + oldText.length);
}

replaceOnce(
  "    const bounds = { calls: 2000, candidates: 20, bytes: 48 * 1024 * 1024, itemBytes: 8 * 1024 * 1024, requestMs: 20000, ...limits };",
  "    const bounds = { calls: 2000, candidates: 20, bytes: 64 * 1024 * 1024, itemBytes: 32 * 1024 * 1024, dictionaryEvidencePerCatalog: 400, dictionaryEvidenceTotalEntries: 5000, requestMs: 20000, ...limits };",
  'Task14 diagnostic capture bounds',
);

const helper = `
  function sampleDiagnosticDictionaryEntries(entries, limit = 400) {
    const list = Array.isArray(entries) ? entries : [];
    const cap = Math.max(0, Math.floor(Number(limit) || 0));
    if (!list.length || !cap) return [];
    if (list.length <= cap) return list.slice();
    if (cap === 1) return [list[0]];
    const sampled = [];
    let previousIndex = -1;
    for (let index = 0; index < cap; index++) {
      const sourceIndex = Math.round(index * (list.length - 1) / (cap - 1));
      if (sourceIndex === previousIndex) continue;
      sampled.push(list[sourceIndex]);
      previousIndex = sourceIndex;
    }
    return sampled;
  }
`;
replaceOnce(
  '\n  // Explicit allowlists protect the test path if ordinary bridge code changes.',
  `${helper}\n  // Explicit allowlists protect the test path if ordinary bridge code changes.`,
  'Task14 dictionary sampler helper',
);

const oldDictionaryBlock = `    await run('dictionaries', 'Чтение справочников', async () => {
      catalog = await bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh: true, transient: true });
      // Search text is reproducible. Shard large reference data so one large
      // dictionary cannot discard every catalog from a diagnostic package.
      capture('dictionaries.json', { columnCatalogIds: catalog.columnCatalogIds, stats: catalog.stats, catalogs: Object.fromEntries(Object.entries(catalog.catalogs).map(([id,c]) => [id, { id, label:c.label, sourceView:c.sourceView, projection:c.projection, sourceCount:c.sourceCount, entries:c.entries.length }])) });
      let dictionaryIndex = 0;
      for (const [id, dictionary] of Object.entries(catalog.catalogs)) {
        dictionaryIndex++;
        for (let offset = 0; offset < dictionary.entries.length; offset += 500) capture(\`dictionaries/\${dictionaryIndex}-\${offset}.json\`, { id, offset, entries: dictionary.entries.slice(offset, offset + 500).map(({ searchText, ...entry }) => entry) });
      }
      return { status: catalog.stats.errors?.length ? 'fail' : 'pass', detail: catalog.stats.errors?.join('\\n') || \`\${catalog.stats.entries} значений в \${catalog.stats.catalogs} справочниках.\` };
    }, snapshotOk);`;

const newDictionaryBlock = `    await run('dictionaries', 'Чтение справочников', async () => {
      catalog = await bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh: true, transient: true });
      // Full counts/metadata stay in dictionaries.json, while raw values are a deterministic
      // diagnostic sample. The support bundle must not become incomplete merely because a
      // valid production dictionary contains hundreds of thousands of values.
      const dictionaryPairs = Object.entries(catalog.catalogs || {});
      const totalEvidenceBudget = Math.max(0, Math.floor(Number(bounds.dictionaryEvidenceTotalEntries) || 0));
      const perCatalogConfigured = Math.max(0, Math.floor(Number(bounds.dictionaryEvidencePerCatalog) || 0));
      const fairShare = dictionaryPairs.length ? Math.max(1, Math.floor(totalEvidenceBudget / dictionaryPairs.length)) : 0;
      const perCatalogBudget = Math.min(perCatalogConfigured, fairShare || perCatalogConfigured);
      const evidencePlans = dictionaryPairs.map(([id, dictionary]) => {
        const allEntries = Array.isArray(dictionary.entries) ? dictionary.entries : [];
        const sampledEntries = sampleDiagnosticDictionaryEntries(allEntries, perCatalogBudget);
        return { id, dictionary, allEntries, sampledEntries };
      });
      report.dictionaryEvidence = evidencePlans.map(({ id, dictionary, allEntries, sampledEntries }) => ({
        id,
        label: dictionary.label,
        totalEntries: allEntries.length,
        capturedEntries: sampledEntries.length,
        mode: sampledEntries.length < allEntries.length ? 'sampled' : 'full',
      }));
      capture('dictionaries.json', {
        columnCatalogIds: catalog.columnCatalogIds,
        stats: catalog.stats,
        evidence: report.dictionaryEvidence,
        catalogs: Object.fromEntries(dictionaryPairs.map(([id,c]) => [id, { id, label:c.label, sourceView:c.sourceView, projection:c.projection, sourceCount:c.sourceCount, entries:Array.isArray(c.entries) ? c.entries.length : 0 }]))
      });
      let dictionaryIndex = 0;
      for (const { id, sampledEntries } of evidencePlans) {
        dictionaryIndex++;
        for (let offset = 0; offset < sampledEntries.length; offset += 500) {
          capture(\`dictionaries/\${dictionaryIndex}-\${offset}.json\`, {
            id,
            offset,
            sampled: true,
            entries: sampledEntries.slice(offset, offset + 500).map(({ searchText, ...entry }) => entry),
          });
        }
      }
      return { status: catalog.stats.errors?.length ? 'fail' : 'pass', detail: catalog.stats.errors?.join('\\n') || \`\${catalog.stats.entries} значений в \${catalog.stats.catalogs} справочниках.\` };
    }, snapshotOk);`;
replaceOnce(oldDictionaryBlock, newDictionaryBlock, 'Task14 bounded dictionary evidence');

replaceOnce(
  '    STUDIO_ACTION_REGISTRY,\n    applyIntervalStructuralProbe, applyCardNewTopologyProbe, applyCardNewEnvelopeProbe, summarizeCardIdentityTopology, collectIntervalDiagnostics, buildIntervalDiagnosticSummary, resolveStudioIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,',
  '    STUDIO_ACTION_REGISTRY,\n    sampleDiagnosticDictionaryEntries,\n    applyIntervalStructuralProbe, applyCardNewTopologyProbe, applyCardNewEnvelopeProbe, summarizeCardIdentityTopology, collectIntervalDiagnostics, buildIntervalDiagnosticSummary, resolveStudioIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,',
  'Task14 test export',
);

assert.match(source, /function sampleDiagnosticDictionaryEntries\(/);
assert.match(source, /dictionaryEvidencePerCatalog:\s*400/);
assert.match(source, /dictionaryEvidenceTotalEntries:\s*5000/);
assert.match(source, /report\.dictionaryEvidence\s*=/);
assert.doesNotMatch(source, /for \(let offset = 0; offset < dictionary\.entries\.length; offset \+= 500\)/);
fs.writeFileSync(sourcePath, source, 'utf8');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const test = 'node tests/recovery-task14-diagnostics-bounds.mjs';
if (!pkg.scripts.test.includes(test)) {
  const anchor = 'node tests/recovery-task13-selective-xlsx.mjs';
  assert.ok(pkg.scripts.test.includes(anchor), 'Task14 package test anchor missing');
  pkg.scripts.test = pkg.scripts.test.replace(anchor, `${anchor} && ${test}`);
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

console.log('Task14 patch applied: diagnostics keep full metadata/workbooks but sample high-cardinality dictionary evidence deterministically.');
