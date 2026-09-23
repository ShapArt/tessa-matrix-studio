import fs from 'node:fs';

const BUILD = 'TMS_V1_16_4_PAGING_V5_XLSX_EDIT_V3';

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
}

export function applyV1164LivePagingXlsxFix(input) {
  let source = String(input ?? '');
  if (source.includes(`pagingXlsxFixBuild: '${BUILD}'`)) return source;

  source = replaceOnce(
    source,
    "    buildFingerprint: 'TMS_V1_15_10_PAGING_V4_REFRESH_EDIT_V2',\n",
    "    buildFingerprint: 'TMS_V1_15_10_PAGING_V4_REFRESH_EDIT_V2',\n    pagingXlsxFixBuild: '" + BUILD + "',\n",
    'v1.16.4 build fingerprint',
  );

  source = replaceOnce(
    source,
    "    // SERVER_PAGED_NATIVE_VIEW_V4\n",
    "    // SERVER_PAGED_NATIVE_VIEW_V4\n    // SERVER_PAGED_NATIVE_VIEW_V5\n",
    'server paging V5 marker',
  );

  source = source.replace(
    "format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V4',",
    "// TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V4 lineage\n        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V5',",
  );

  source = replaceOnce(
    source,
    "      const pageParamEvidence = parameters => normalizeParameterList(parameters).map(item => ({\n        name: parameterName(item),\n        value: safePlain(item?.value ?? item?.Value ?? item?.values ?? item?.Values ?? null, { maxDepth: 3, maxKeys: 20, maxArray: 20 }),\n      })).filter(item => /pageoffset|pagelimit/i.test(item.name));\n",
    "      const pageParamEvidence = parameters => normalizeParameterList(parameters).map(item => ({\n        name: parameterName(item),\n        value: safePlain(item?.value ?? item?.Value ?? item?.values ?? item?.Values ?? null, { maxDepth: 3, maxKeys: 20, maxArray: 20 }),\n      })).filter(item => /pageoffset|pagelimit/i.test(item.name));\n      const hasExplicitPaging = parameters => {\n        const names = new Set(pageParamEvidence(parameters).map(item => canonicalValue(item.name).replace(/\\s+/g, '')));\n        return names.has(canonicalValue('PageLimit')) && names.has(canonicalValue('PageOffset'));\n      };\n",
    'explicit paging proof helper',
  );

  const oldCreate = `        // Native request builder already knows all contextual parameters. We alter only
        // transient page state and restore it before network I/O.
        for (const owner of owners) {
          built = await tryBuilder(page, owner === target ? 'target-createDataRequest' : 'component-createDataRequest', async () => {
            if (typeof owner?.createDataRequest !== 'function') return null;
            const saved = [];
            try {
              setPageState(component, page, pageLimit, saved);
              if (target !== component) setPageState(target, page, pageLimit, saved);
              const request = await Promise.resolve(owner.createDataRequest());
              if (!request) return null;
              request.calculateRowCounting = page === 1;
              request.canUseCache = false;
              return { request, parameters: request.parameters ?? request.Parameters ?? [] };
            } finally {
              for (let i = saved.length - 1; i >= 0; i -= 1) restoreOwn(saved[i]);
            }
          });
          if (built) return built;
        }
`;

  const newCreate = `        // Native request builder knows contextual filters, but live seed 696022484 proved
        // that createDataRequest() can return a request with NO PageLimit/PageOffset.
        // Never call that "server paging". Enrich its real Array<RequestParameter> through
        // the mounted control helper while page state is transiently pinned, then require
        // explicit paging evidence before the request is allowed onto the wire.
        for (const owner of owners) {
          built = await tryBuilder(page, owner === target ? 'target-createDataRequest-v5' : 'component-createDataRequest-v5', async () => {
            if (typeof owner?.createDataRequest !== 'function') return null;
            const saved = [];
            try {
              setPageState(component, page, pageLimit, saved);
              if (target !== component) setPageState(target, page, pageLimit, saved);
              const request = await Promise.resolve(owner.createDataRequest());
              if (!request) return null;
              let parameters = withoutPaging(request.parameters ?? request.Parameters ?? []);
              if (!hasExplicitPaging(parameters)) {
                for (const pagingOwner of owners) {
                  if (typeof pagingOwner?.setupPagingParameters !== 'function') continue;
                  const candidate = [...parameters];
                  await Promise.resolve(pagingOwner.setupPagingParameters(candidate));
                  if (hasExplicitPaging(candidate)) {
                    parameters = candidate;
                    break;
                  }
                }
              }
              if (!hasExplicitPaging(parameters)) return null;
              if ('parameters' in request || !('Parameters' in request)) request.parameters = parameters;
              else request.Parameters = parameters;
              request.calculateRowCounting = page === 1;
              request.canUseCache = false;
              return { request, parameters };
            } finally {
              for (let i = saved.length - 1; i >= 0; i -= 1) restoreOwn(saved[i]);
            }
          });
          if (built) return built;
        }
`;
  source = replaceOnce(source, oldCreate, newCreate, 'createDataRequest explicit paging');

  source = replaceOnce(
    source,
    `          const columns = Array.from(result?.columns || result?.Columns || []).map(column =>
            normalizeSpace(column?.alias ?? column?.name ?? column?.Alias ?? column?.Name ?? column)
          );
`,
    `          const columns = Array.from(result?.columns || result?.Columns || []).map(column =>
            normalizeSpace(
              Array.isArray(column) ? column[0]
                : column?.Item1 ?? column?.item1
                  ?? column?.alias ?? column?.name ?? column?.Alias ?? column?.Name ?? column
            )
          );
`,
    'tuple-shaped TessaViewResult.Columns',
  );

  source = replaceOnce(
    source,
    "              source: 'native-view-server-paged-v4',\n",
    "              source: 'native-view-server-paged-v5',\n",
    'server paging source marker',
  );

  source = replaceOnce(
    source,
    "          if (rawRows.length <= pageLimit) break;\n",
    "          if (rawRows.length < pageLimit) break;\n",
    'full-page continuation',
  );

  source = replaceOnce(
    source,
    "    const fullCell = new RegExp(`<c\\b([^>]*\\br=\"${ref}\"[^>]*)>[\\s\\S]*?<\\/c>`, 'i');\n    const selfCell = new RegExp(`<c\\b([^>]*\\br=\"${ref}\"[^>]*)\\/>`, 'i');\n",
    "    const fullCell = new RegExp(String.raw`<c\\b([^>]*\\br=\"${ref}\"[^>]*)>[\\s\\S]*?<\\/c>`, 'i');\n    const selfCell = new RegExp(String.raw`<c\\b([^>]*\\br=\"${ref}\"[^>]*)\\/>`, 'i');\n",
    'physical XLSX cell regex',
  );
  source = replaceOnce(
    source,
    "      const rowRe = new RegExp(`(<row\\b[^>]*\\br=\"${rowNumber}\"[^>]*>)([\\s\\S]*?)(<\\/row>)`, 'i');\n",
    "      const rowRe = new RegExp(String.raw`(<row\\b[^>]*\\br=\"${rowNumber}\"[^>]*>)([\\s\\S]*?)(<\\/row>)`, 'i');\n",
    'physical XLSX row regex',
  );

  source = source.replace("if (version !== '1.16.3') {", "if (version !== '1.16.4') {");
  source = source.replace("ожидалась 1.16.3.", "ожидалась 1.16.4.");
  source = source.replace("Подтверждён v1.16.3", "Подтверждён v1.16.4");

  for (const marker of [
    `pagingXlsxFixBuild: '${BUILD}'`,
    'SERVER_PAGED_NATIVE_VIEW_V5',
    'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V5',
    'const hasExplicitPaging = parameters =>',
    'Array.isArray(column) ? column[0]',
    "source: 'native-view-server-paged-v5'",
    'if (rawRows.length < pageLimit) break;',
    'const fullCell = new RegExp(String.raw`<c\\b',
    'const rowRe = new RegExp(String.raw`(<row\\b',
    "version !== '1.16.4'",
  ]) {
    if (!source.includes(marker)) throw new Error('v1.16.4 verification failed: ' + marker);
  }
  if (source.includes('if (rawRows.length <= pageLimit) break;')) {
    throw new Error('v1.16.4 verification failed: stale full-page stop survived');
  }

  return source;
}

const target = process.argv[2];
if (target) {
  const input = fs.readFileSync(target, 'utf8');
  const output = applyV1164LivePagingXlsxFix(input);
  fs.writeFileSync(target, output, 'utf8');
  console.log('TESSA Matrix Studio v1.16.4 live paging/XLSX fix: OK');
}
