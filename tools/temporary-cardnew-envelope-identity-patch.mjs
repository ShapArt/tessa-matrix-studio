import fs from 'node:fs';

const scriptPath = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(scriptPath, 'utf8');

function replaceOnce(label, before, after) {
  const first = code.indexOf(before);
  if (first < 0) throw new Error(`${label}: source block not found`);
  if (code.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source block is not unique`);
  code = code.replace(before, after);
}

const topologyTail = `    if (mode === 'clear-all-row-markers') {
      for (const name of [S.Versions, S.Values, S.Roles]) sectionRows(name).forEach(clearMarkers);
    }
    return cardStorage;
  }

  // Explicit, bounded diagnosis of the unresolved interval error.`;

const topologyWithEnvelope = `    if (mode === 'clear-all-row-markers') {
      for (const name of [S.Versions, S.Values, S.Roles]) sectionRows(name).forEach(clearMarkers);
    }
    return cardStorage;
  }

  // The old live diagnostic shows one more native-vs-CardNew difference outside row
  // markers: MtxRouteMatrixRow itself carries .changed=[TemplateID] on CardNew while
  // the saved native card does not. Probe that single envelope marker independently.
  function applyCardNewEnvelopeProbe(cardStorage, mode) {
    if (mode !== 'clear-main-section-changed') {
      throw new Error(\`Неизвестный режим структурной диагностики: \${mode}\`);
    }
    const sections = cardStorage?.Sections || cardStorage?.sections || {};
    const section = sections?.[S.MatrixRow];
    if (section && typeof section === 'object') {
      delete section['.changed'];
      delete section.changed;
      if (section.data && typeof section.data === 'object') {
        delete section.data['.changed'];
        delete section.data.changed;
      }
    }
    return cardStorage;
  }

  // Privacy-safe structural summary for every duplicate-check sample. It reports only
  // topology facts/counts: no GUIDs, role names, criterion captions or business values.
  function summarizeCardIdentityTopology(cardStorage, requestVersionId = null) {
    const sections = cardStorage?.Sections || cardStorage?.sections || {};
    const sectionRows = name => {
      const section = sections?.[name];
      return section?.Rows || section?.rows || [];
    };
    const rowData = row => row?.data && typeof row.data === 'object' ? row.data : row;
    const unwrap = value => {
      if (value && typeof value === 'object') {
        if (Object.prototype.hasOwnProperty.call(value, '$__value')) return value.$__value;
        if (Object.prototype.hasOwnProperty.call(value, 'value')) return value.value;
      }
      return value;
    };
    const scalar = value => {
      const result = unwrap(value);
      return result === null || result === undefined || result === '' ? null : result;
    };
    const idText = value => {
      const result = scalar(value);
      return result === null ? null : String(result).trim().toLowerCase();
    };
    const markerPresent = (row, marker) => {
      if (!row || typeof row !== 'object') return false;
      const data = rowData(row);
      return Object.prototype.hasOwnProperty.call(row, marker)
        || Object.prototype.hasOwnProperty.call(row, marker === '.state' ? 'state' : 'changed')
        || (data && data !== row && (Object.prototype.hasOwnProperty.call(data, marker)
          || Object.prototype.hasOwnProperty.call(data, marker === '.state' ? 'state' : 'changed')));
    };
    const rowId = row => {
      const data = rowData(row) || {};
      return idText(data.RowID ?? row?.RowID ?? row?.rowId);
    };
    const ownerId = row => {
      const data = rowData(row) || {};
      return idText(data[F.OwnerRowID] ?? row?.[F.OwnerRowID]);
    };

    const versions = sectionRows(S.Versions);
    const values = sectionRows(S.Values);
    const roles = sectionRows(S.Roles);
    const allRows = [...versions, ...values, ...roles];
    const versionIds = versions.map(rowId).filter(Boolean);
    const versionIdSet = new Set(versionIds);
    const requestVersion = idText(requestVersionId);
    const childRows = [...values, ...roles];
    let ownerMismatchCount = 0;
    let ownerMissingCount = 0;
    for (const row of childRows) {
      const owner = ownerId(row);
      if (!owner) ownerMissingCount += 1;
      else if (!versionIdSet.has(owner)) ownerMismatchCount += 1;
    }
    const ids = allRows.map(rowId).filter(Boolean);
    const frequencies = new Map();
    for (const id of ids) frequencies.set(id, (frequencies.get(id) || 0) + 1);
    let duplicateRowIdCount = 0;
    for (const count of frequencies.values()) if (count > 1) duplicateRowIdCount += count - 1;
    const mainSection = sections?.[S.MatrixRow];
    const mainSectionChanged = Boolean(mainSection && typeof mainSection === 'object'
      && (Object.prototype.hasOwnProperty.call(mainSection, '.changed')
        || Object.prototype.hasOwnProperty.call(mainSection, 'changed')
        || (mainSection.data && typeof mainSection.data === 'object'
          && (Object.prototype.hasOwnProperty.call(mainSection.data, '.changed')
            || Object.prototype.hasOwnProperty.call(mainSection.data, 'changed')))));

    return {
      cardIdPresent: Boolean(idText(cardStorage?.ID ?? cardStorage?.id)),
      cardVersion: scalar(cardStorage?.Version ?? cardStorage?.version),
      mainSectionChanged,
      versionRowCount: versions.length,
      requestVersionMatchesVersionRow: requestVersion ? versionIdSet.has(requestVersion) : null,
      ownerMismatchCount,
      ownerMissingCount,
      missingRowIdCount: allRows.reduce((sum, row) => sum + Number(!rowId(row)), 0),
      duplicateRowIdCount,
      rowCounts: { versions: versions.length, values: values.length, roles: roles.length },
      markerCounts: {
        state: allRows.reduce((sum, row) => sum + Number(markerPresent(row, '.state')), 0),
        changed: allRows.reduce((sum, row) => sum + Number(markerPresent(row, '.changed')), 0),
      },
    };
  }

  // Explicit, bounded diagnosis of the unresolved interval error.`;
replaceOnce('insert CardNew envelope/identity helpers', topologyTail, topologyWithEnvelope);

const dispatchBefore = `          const topologyModes = new Set([
            'clear-version-changed', 'clear-version-state', 'clear-version-markers',
            'clear-noninterval-markers', 'clear-all-row-markers',
          ]);
          if (intervalModes.has(structuralMode)) applyIntervalStructuralProbe(req.info.card, structuralMode);
          else if (topologyModes.has(structuralMode)) applyCardNewTopologyProbe(req.info.card, structuralMode);
          else throw new Error(\`Неизвестный режим структурной диагностики: \${structuralMode}\`);
        }
        sample.request = copyStorage(req.getStorage?.() || { requestType: req.requestType, info: req.info });`;
const dispatchAfter = `          const topologyModes = new Set([
            'clear-version-changed', 'clear-version-state', 'clear-version-markers',
            'clear-noninterval-markers', 'clear-all-row-markers',
          ]);
          const envelopeModes = new Set(['clear-main-section-changed']);
          if (intervalModes.has(structuralMode)) applyIntervalStructuralProbe(req.info.card, structuralMode);
          else if (topologyModes.has(structuralMode)) applyCardNewTopologyProbe(req.info.card, structuralMode);
          else if (envelopeModes.has(structuralMode)) applyCardNewEnvelopeProbe(req.info.card, structuralMode);
          else throw new Error(\`Неизвестный режим структурной диагностики: \${structuralMode}\`);
        }
        sample.identityTopology = summarizeCardIdentityTopology(req.info?.card, versionId);
        sample.request = copyStorage(req.getStorage?.() || { requestType: req.requestType, info: req.info });`;
replaceOnce('wire envelope mode and identity summary', dispatchBefore, dispatchAfter);

const finalProbeBefore = `              const nonInterval = await probe('proposed-add-clear-noninterval-markers', created.card, created.versionId, action.excelRow.excelRow, 'clear-noninterval-markers');
              if (rejectedExtractor(nonInterval)) {
                await probe('proposed-add-clear-all-row-markers', created.card, created.versionId, action.excelRow.excelRow, 'clear-all-row-markers');
              }`;
const finalProbeAfter = `              const nonInterval = await probe('proposed-add-clear-noninterval-markers', created.card, created.versionId, action.excelRow.excelRow, 'clear-noninterval-markers');
              if (rejectedExtractor(nonInterval)) {
                const allRows = await probe('proposed-add-clear-all-row-markers', created.card, created.versionId, action.excelRow.excelRow, 'clear-all-row-markers');
                if (rejectedExtractor(allRows)) {
                  await probe('proposed-add-clear-main-section-changed', created.card, created.versionId, action.excelRow.excelRow, 'clear-main-section-changed');
                }
              }`;
replaceOnce('add final section-envelope probe', finalProbeBefore, finalProbeAfter);

replaceOnce('export envelope/identity helpers',
  `    applyIntervalStructuralProbe, applyCardNewTopologyProbe, collectIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,`,
  `    applyIntervalStructuralProbe, applyCardNewTopologyProbe, applyCardNewEnvelopeProbe, summarizeCardIdentityTopology, collectIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,`);

fs.writeFileSync(scriptPath, code);

function patchTest(path, replacements) {
  let text = fs.readFileSync(path, 'utf8');
  for (const [label, before, after] of replacements) {
    const index = text.indexOf(before);
    if (index < 0) throw new Error(`${path} ${label}: block not found`);
    text = text.replace(before, after);
  }
  fs.writeFileSync(path, text);
}

patchTest('tests/interval-proposed-add-probes.mjs', [
  ['sample list', `  'proposed-add-clear-all-row-markers',\n],`, `  'proposed-add-clear-all-row-markers',\n  'proposed-add-clear-main-section-changed',\n],`],
  ['mode list', `  'clear-all-row-markers',\n]);`, `  'clear-all-row-markers',\n  'clear-main-section-changed',\n]);`],
  ['request budget', `assert.equal(f.calls.filter(call => call[0] === 'request').length, 11, 'one candidate must stay bounded to 2 controls + 1 proposed-add + 8 detached probes');`, `assert.equal(f.calls.filter(call => call[0] === 'request').length, 12, 'one candidate must stay bounded to 2 controls + 1 proposed-add + 9 detached probes');`],
]);

patchTest('tests/interval-diagnostics.mjs', [
  ['accepted sample list', `  'proposed-add-clear-all-row-markers',\n  'proposed-add',`, `  'proposed-add-clear-all-row-markers',\n  'proposed-add-clear-main-section-changed',\n  'proposed-add',`],
  ['accepted mode list', `  'clear-noninterval-markers', 'clear-all-row-markers',\n],`, `  'clear-noninterval-markers', 'clear-all-row-markers', 'clear-main-section-changed',\n],`],
  ['accepted budget', `assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'request').length, 12, 'accepted rebuilt path is bounded to two controls + eight detached probes + second proposed-add baseline');`, `assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'request').length, 13, 'accepted rebuilt path is bounded to two controls + nine detached probes + second proposed-add baseline');`],
]);

for (const path of [
  '.github/workflows/temporary-cardnew-envelope-identity-patch.yml',
  'tools/temporary-cardnew-envelope-identity-patch.mjs',
]) {
  try { fs.unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

console.log('patched CardNew envelope + identity diagnostics');
