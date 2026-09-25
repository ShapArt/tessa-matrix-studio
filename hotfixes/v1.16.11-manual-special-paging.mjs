import fs from 'node:fs';

const BUILD = 'TMS_V1_16_11_PAGING_V12_MANUAL_SPECIAL_PARAMS';

function once(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
}

export function apply(input) {
  let source = String(input ?? '');
  if (source.includes(`pagingManualSpecialBuild: '${BUILD}'`)) return source;

  source = once(source,
    "    pagingIsolatedContextBuild: 'TMS_V1_16_10_PAGING_V11_ISOLATED_PAGING_CONTEXT',\n",
    "    pagingIsolatedContextBuild: 'TMS_V1_16_10_PAGING_V11_ISOLATED_PAGING_CONTEXT',\n    pagingManualSpecialBuild: '" + BUILD + "',\n",
    'V12 build');
  source = once(source,
    '    // SERVER_PAGED_NATIVE_VIEW_V11\n',
    '    // SERVER_PAGED_NATIVE_VIEW_V11\n    // SERVER_PAGED_NATIVE_VIEW_V12\n',
    'V12 marker');
  source = once(source,
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V11',\n        build: APP.pagingIsolatedContextBuild || APP.pagingVersionedContextBuild || APP.pagingContextBuild || APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V12',\n        build: APP.pagingManualSpecialBuild || APP.pagingIsolatedContextBuild || APP.pagingVersionedContextBuild || APP.pagingContextBuild || APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    'V12 diagnostics');

  source = once(source,
`              const nativeRequest = await Promise.resolve(owner.createDataRequest());
              if (!nativeRequest) return null;
              const baseContextParameters = await getBaseParameters();
`,
`              // V12: the mounted Cherkizovo createDataRequest/setupPagingParameters
              // delegates both throw "e is not iterable" in live runtime (seed 1369359921).
              // Build TESSA's documented special paging parameters directly instead.
              const baseContextParameters = await getBaseParameters();
              const manualRequest = requestWithParameters(withoutPaging(baseContextParameters), page);
              const operators = api.platformModule?.ViewCriteriaOperators || {};
              const equalsOperator = operators.EqualsTo || operators.Equals || operators.Equality || null;
              if (!equalsOperator || typeof manualRequest?.addParameter !== 'function') return null;
              const wireLimit = pageLimit + 1;
              const wireOffset = 1 + ((page - 1) * pageLimit);
              const addIntParameter = (name, value) => manualRequest.addParameter(name, builder => builder
                .addCriteria(equalsOperator, value, String(value))
                .asRequestParameter());
              addIntParameter('PageLimit', wireLimit);
              addIntParameter('PageOffset', wireOffset);
              const manualParameters = normalizeParameterList(
                manualRequest.parameters ?? manualRequest.Parameters ?? manualRequest.values ?? manualRequest.Values ?? []
              );
              if (!requiredContextPresent(manualParameters)) {
                throw new Error(\`Manual paging context is missing MatrixID. Available: \${manualParameters.map(parameterName).filter(Boolean).join(', ')}\`);
              }
              if (!isPagingUsableForPage(manualParameters, page, lastAcceptedOffset)) return null;
              return { request: manualRequest, parameters: manualParameters, nativeRequestType: 'manual-special-parameters-v12' };

              // Kept below as dead compatibility documentation; V12 intentionally does
              // not execute the broken mounted delegate on this Cherkizovo runtime.
              const nativeRequest = await Promise.resolve(owner.createDataRequest());
              if (!nativeRequest) return null;
`,
    'manual paging before mounted createDataRequest');

  source = once(source,
    "              source: 'native-view-server-paged-v11',",
    "              source: 'native-view-server-paged-v12',",
    'V12 source');

  source = once(source,
    "        if (version !== '1.16.10') {\n          throw new Error(`Загружена версия ${version || '(нет)'}, ожидалась 1.16.10.`);\n        }\n        return { detail: `Подтверждён v1.16.10 · ${actualBuild} · ${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    "        if (version !== '1.16.11') {\n          throw new Error(`Загружена версия ${version || '(нет)'}, ожидалась 1.16.11.`);\n        }\n        return { detail: `Подтверждён v1.16.11 · ${actualBuild} · ${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    'v1.16.11 provenance');

  return source;
}

const target = process.argv[2];
if (target) {
  const output = apply(fs.readFileSync(target, 'utf8'));
  fs.writeFileSync(target, output, 'utf8');
  console.log('TESSA Matrix Studio v1.16.11 manual special paging params: OK');
}
