import fs from 'node:fs';

const BUILD = 'TMS_V1_16_12_PAGING_V13_SELF_CONTAINED_REQUEST';

function once(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
}

export function apply(input) {
  let source = String(input ?? '');
  if (source.includes(`pagingSelfContainedBuild: '${BUILD}'`)) return source;

  source = once(source,
    "    pagingManualSpecialBuild: 'TMS_V1_16_11_PAGING_V12_MANUAL_SPECIAL_PARAMS',\n",
    "    pagingManualSpecialBuild: 'TMS_V1_16_11_PAGING_V12_MANUAL_SPECIAL_PARAMS',\n    pagingSelfContainedBuild: '" + BUILD + "',\n",
    'V13 build');
  source = once(source,
    '    // SERVER_PAGED_NATIVE_VIEW_V12\n',
    '    // SERVER_PAGED_NATIVE_VIEW_V12\n    // SERVER_PAGED_NATIVE_VIEW_V13\n',
    'V13 marker');
  source = once(source,
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V12',\n        build: APP.pagingManualSpecialBuild || APP.pagingIsolatedContextBuild || APP.pagingVersionedContextBuild || APP.pagingContextBuild || APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V13',\n        build: APP.pagingSelfContainedBuild || APP.pagingManualSpecialBuild || APP.pagingIsolatedContextBuild || APP.pagingVersionedContextBuild || APP.pagingContextBuild || APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    'V13 diagnostics');

  source = once(source,
`              const baseContextParameters = await getBaseParameters();
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
`,
`              // Live seed 2991209272 proved V12 still failed before addParameter:
              // getBaseParameters() -> mounted getRequestParams() itself throws
              // "e is not iterable". V13 is therefore fully self-contained and does
              // not call createDataRequest, getRequestParams or setupPagingParameters.
              const manualRequest = new api.serviceModule.TessaViewRequest(view.metadata);
              manualRequest.calculateRowCounting = page === 1;
              manualRequest.canUseCache = false;
              const operators = api.platformModule?.ViewCriteriaOperators || {};
              const equalsOperator = operators.EqualsTo || operators.Equals || operators.Equality || null;
              if (!equalsOperator || typeof manualRequest?.addParameter !== 'function') return null;
              const matrixId = this.mainCard?.id || this.editor?.cardModel?.card?.id || null;
              if (!matrixId) throw new Error('Self-contained paging cannot resolve MatrixID from the open matrix card.');
              const addParameter = (name, value, text = undefined) => manualRequest.addParameter(name, builder => builder
                .addCriteria(equalsOperator, value, text)
                .asRequestParameter());
              // DynamicMetadataViewInterceptor requires MatrixID. Keep the GUID object
              // from the card model instead of stringifying it.
              addParameter('MatrixID', matrixId);
              const wireLimit = pageLimit + 1;
              const wireOffset = 1 + ((page - 1) * pageLimit);
              addParameter('PageLimit', wireLimit);
              addParameter('PageOffset', wireOffset);
              const manualParameters = normalizeParameterList(
                manualRequest.parameters ?? manualRequest.Parameters ?? manualRequest.values ?? manualRequest.Values ?? []
              );
`,
    'self-contained MatrixID and paging request');

  source = once(source,
    "owner === target ? 'target-createDataRequest-v5' : 'component-createDataRequest-v5'",
    "owner === target ? 'target-self-contained-v13' : 'component-self-contained-v13'",
    'V13 diagnostic strategy');

  source = once(source,
    "              source: 'native-view-server-paged-v12',",
    "              source: 'native-view-server-paged-v13',",
    'V13 source');

  source = once(source,
    "        if (version !== '1.16.11') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.11.\`);\n        }\n        return { detail: \`Подтверждён v1.16.11 · \${actualBuild} · \${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    "        if (version !== '1.16.12') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.12.\`);\n        }\n        return { detail: \`Подтверждён v1.16.12 · \${actualBuild} · \${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    'v1.16.12 provenance');

  return source;
}

const target = process.argv[2];
if (target) {
  const output = apply(fs.readFileSync(target, 'utf8'));
  fs.writeFileSync(target, output, 'utf8');
  console.log('TESSA Matrix Studio v1.16.12 self-contained direct paging request: OK');
}
