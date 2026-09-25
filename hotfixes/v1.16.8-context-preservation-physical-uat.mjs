import fs from 'node:fs';

const BUILD = 'TMS_V1_16_8_PAGING_V9_CONTEXT_PRESERVATION';

function once(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
}

export function apply(input) {
  let source = String(input ?? '');
  if (source.includes(`pagingContextBuild: '${BUILD}'`)) return source;

  source = once(source,
    "    pagingCanonicalBuild: 'TMS_V1_16_7_PAGING_V8_CANONICAL_REQUEST',\n",
    "    pagingCanonicalBuild: 'TMS_V1_16_7_PAGING_V8_CANONICAL_REQUEST',\n    pagingContextBuild: '" + BUILD + "',\n",
    'V9 build');
  source = once(source,
    '    // SERVER_PAGED_NATIVE_VIEW_V8\n',
    '    // SERVER_PAGED_NATIVE_VIEW_V8\n    // SERVER_PAGED_NATIVE_VIEW_V9\n',
    'V9 marker');
  source = once(source,
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V8',\n        build: APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V9',\n        build: APP.pagingContextBuild || APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    'V9 diagnostics');

  source = once(source,
`      const requestWithParameters = (parameters, page) => {
        const request = new api.serviceModule.TessaViewRequest(view.metadata);
        request.calculateRowCounting = page === 1;
        request.canUseCache = false;
        if ('parameters' in request || !('Parameters' in request)) request.parameters = parameters;
        else request.Parameters = parameters;
        return request;
      };
`,
`      const requestWithParameters = (parameters, page, nativeContextValues = []) => {
        const request = new api.serviceModule.TessaViewRequest(view.metadata);
        request.calculateRowCounting = page === 1;
        request.canUseCache = false;
        if ('parameters' in request || !('Parameters' in request)) request.parameters = parameters;
        else request.Parameters = parameters;
        // Web ViewRequest serializes contextual view parameters through values.
        // Cherkizovo DynamicMetadataViewInterceptor requires MatrixID there.
        if (nativeContextValues.length) request.values = nativeContextValues;
        return request;
      };
`,
    'request values preservation');

  source = once(source,
`              const nativeRequest = await Promise.resolve(owner.createDataRequest());
              if (!nativeRequest) return null;
              let parameters = withoutPaging(nativeRequest.parameters ?? nativeRequest.Parameters ?? []);
`,
`              const nativeRequest = await Promise.resolve(owner.createDataRequest());
              if (!nativeRequest) return null;
              const nativeContextValues = normalizeParameterList(nativeRequest?.values ?? nativeRequest?.Values ?? []);
              let parameters = withoutPaging(nativeRequest.parameters ?? nativeRequest.Parameters ?? []);
`,
    'capture native values');

  source = once(source,
`                request: requestWithParameters(parameters, page),
                parameters,
                nativeRequestType: String(nativeRequest?.constructor?.name || typeof nativeRequest),
`,
`                request: requestWithParameters(parameters, page, nativeContextValues),
                parameters,
                nativeContextValues,
                contextParameterNames: [...new Set([
                  ...normalizeParameterList(parameters).map(parameterName),
                  ...nativeContextValues.map(parameterName),
                ].filter(Boolean))],
                nativeRequestType: String(nativeRequest?.constructor?.name || typeof nativeRequest),
`,
    'wire native values');

  source = once(source,
    "            nativeRequestType: built.nativeRequestType || null,\n            visiblePageAfter:",
    "            nativeRequestType: built.nativeRequestType || null,\n            contextParameterNames: built.contextParameterNames || [],\n            visiblePageAfter:",
    'context diagnostics');

  source = once(source,
    "              source: 'native-view-server-paged-v8',",
    "              source: 'native-view-server-paged-v9',",
    'V9 source');

  const helperAnchor = `  function findRowByCard(book, rowCardId) {`;
  const helper = `  async function findPhysicalSafeUpdateCandidate(book, structure, snapshot, bridge, catalog, rng) {
    const sources = shuffled((book.rows || []).filter(row => rowHasRole(book, row)), rng);
    let lastEvidence = null;
    for (const sourceRow of sources) {
      let edited = null;
      try {
        edited = findSafeUpdateCandidate(book, structure, snapshot, bridge, catalog, rng, { source: sourceRow });
      } catch (_) {
        continue;
      }
      const visibleValue = String(edited.entry?.selector || edited.entry?.display || '');
      if (!visibleValue) continue;
      let physical = null;
      try {
        physical = await E.patchWorkbookVisibleCellForUat(book, edited.source.excelRow, edited.column.index, visibleValue, catalog);
        const physicalPlan = E.buildPlan(physical.workbook, structure, snapshot, bridge.matrixInfo());
        const action = (physicalPlan.actions || []).find(item => item.type === 'update');
        lastEvidence = { excelRow: edited.source.excelRow, counts: physicalPlan.counts, skippedRows: physicalPlan.skippedRows || [] };
        if ((physicalPlan.counts?.update || 0) === 1
          && (physicalPlan.counts?.skip || 0) === 0
          && (physicalPlan.counts?.add || 0) === 0
          && (physicalPlan.counts?.delete || 0) === 0
          && action
          && resultingRoleCountForAction(action, structure) > 0) {
          return { ...edited, physical, physicalPlan, selection: 'physical-safe-update' };
        }
      } finally {
        if (physical?.workbook) E.releaseWorkbookArchive(physical.workbook);
      }
    }
    throw new Error(\`UAT не нашёл collision-safe UPDATE, который остаётся безопасным после физической правки/re-read XLSX: \${JSON.stringify(lastEvidence)}\`);
  }

`;
  source = once(source, helperAnchor, helper + helperAnchor, 'physical-safe helper');

  source = once(source,
`        const edited = findSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng);
        const visibleValue = String(edited.entry?.selector || edited.entry?.display || '');
        if (!visibleValue) throw new Error('UAT setup: безопасный UPDATE не содержит видимого значения.');

        const physical = await E.patchWorkbookVisibleCellForUat(
          base.book,
          edited.source.excelRow,
          edited.column.index,
          visibleValue,
          catalog,
        );
        const sourceBook = physical.workbook;
        const beforePlan = E.buildPlan(sourceBook, structure, baseline, info);
`,
`        const edited = await findPhysicalSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng);
        const visibleValue = String(edited.entry?.selector || edited.entry?.display || '');
        if (!visibleValue) throw new Error('UAT setup: безопасный UPDATE не содержит видимого значения.');

        const physical = await E.patchWorkbookVisibleCellForUat(
          base.book,
          edited.source.excelRow,
          edited.column.index,
          visibleValue,
          catalog,
        );
        const sourceBook = physical.workbook;
        const beforePlan = E.buildPlan(sourceBook, structure, baseline, info);
`,
    'dictionary refresh physical-safe selection');

  source = once(source,
    "        if (version !== '1.16.7') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.7.\`);\n        }\n        return { detail: \`Подтверждён v1.16.7 · \${actualBuild} · \${actualPerformanceBuild}.\`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    "        if (version !== '1.16.8') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.8.\`);\n        }\n        return { detail: \`Подтверждён v1.16.8 · \${actualBuild} · \${actualPerformanceBuild}.\`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    'v1.16.8 provenance');

  return source;
}

const target = process.argv[2];
if (target) {
  const output = apply(fs.readFileSync(target, 'utf8'));
  fs.writeFileSync(target, output, 'utf8');
  console.log('TESSA Matrix Studio v1.16.8 context preservation + physical UAT: OK');
}
