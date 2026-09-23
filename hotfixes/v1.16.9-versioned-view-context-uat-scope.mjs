import fs from 'node:fs';

const BUILD = 'TMS_V1_16_9_PAGING_V10_VERSIONED_CONTEXT';

function once(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
}

export function apply(input) {
  let source = String(input ?? '');
  if (source.includes(`pagingVersionedContextBuild: '${BUILD}'`)) return source;

  source = once(source,
    "    pagingContextBuild: 'TMS_V1_16_8_PAGING_V9_CONTEXT_PRESERVATION',\n",
    "    pagingContextBuild: 'TMS_V1_16_8_PAGING_V9_CONTEXT_PRESERVATION',\n    pagingVersionedContextBuild: '" + BUILD + "',\n",
    'V10 build');
  source = once(source,
    '    // SERVER_PAGED_NATIVE_VIEW_V9\n',
    '    // SERVER_PAGED_NATIVE_VIEW_V9\n    // SERVER_PAGED_NATIVE_VIEW_V10\n',
    'V10 marker');
  source = once(source,
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V9',\n        build: APP.pagingContextBuild || APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V10',\n        build: APP.pagingVersionedContextBuild || APP.pagingContextBuild || APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    'V10 diagnostics');

  source = once(source,
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
`      const requestWithParameters = (parameters, page) => {
        const request = new api.serviceModule.TessaViewRequest(view.metadata);
        request.calculateRowCounting = page === 1;
        request.canUseCache = false;
        // TESSA 4.1 renamed Web ViewRequest.values -> parameters. Cherkizovo can run
        // either contract, so write only the native property exposed by this runtime.
        if ('parameters' in request) request.parameters = parameters;
        else if ('values' in request) request.values = parameters;
        else if ('Parameters' in request) request.Parameters = parameters;
        else if ('Values' in request) request.Values = parameters;
        else request.parameters = parameters;
        return request;
      };
      const mergeContextParameters = (...lists) => {
        const merged = new Map();
        for (const list of lists) {
          for (const item of normalizeParameterList(list)) {
            const name = canonicalValue(parameterName(item)).replace(/\\s+/g, '');
            if (!name) continue;
            merged.set(name, item);
          }
        }
        return [...merged.values()];
      };
      const requiredContextPresent = parameters => normalizeParameterList(parameters)
        .some(item => canonicalValue(parameterName(item)).replace(/\\s+/g, '') === canonicalValue('MatrixID'));
`,
    'versioned request adapter');

  source = once(source,
`              const nativeRequest = await Promise.resolve(owner.createDataRequest());
              if (!nativeRequest) return null;
              const nativeContextValues = normalizeParameterList(nativeRequest?.values ?? nativeRequest?.Values ?? []);
              let parameters = withoutPaging(nativeRequest.parameters ?? nativeRequest.Parameters ?? []);
`,
`              const nativeRequest = await Promise.resolve(owner.createDataRequest());
              if (!nativeRequest) return null;
              const baseContextParameters = await getBaseParameters();
              const nativeContextParameters = normalizeParameterList(
                nativeRequest.parameters ?? nativeRequest.Parameters ?? nativeRequest.values ?? nativeRequest.Values ?? []
              );
              let parameters = withoutPaging(mergeContextParameters(baseContextParameters, nativeContextParameters));
`,
    'merge native/base context');

  source = once(source,
`              if (!isPagingUsableForPage(parameters, page, lastAcceptedOffset)) return null;

              // Live Full UAT seed 3680395665 proved the architectural boundary:
`,
`              if (!isPagingUsableForPage(parameters, page, lastAcceptedOffset)) return null;
              // Cherkizovo DynamicMetadataViewInterceptor hard-requires MatrixID.
              // Never send a request that is already known to be missing it.
              if (!requiredContextPresent(parameters)) {
                throw new Error(\`Direct view context is missing MatrixID. Available: \${normalizeParameterList(parameters).map(parameterName).filter(Boolean).join(', ')}\`);
              }

              // Live Full UAT seed 3680395665 proved the architectural boundary:
`,
    'MatrixID preflight');

  source = once(source,
`                request: requestWithParameters(parameters, page, nativeContextValues),
                parameters,
                nativeContextValues,
                contextParameterNames: [...new Set([
                  ...normalizeParameterList(parameters).map(parameterName),
                  ...nativeContextValues.map(parameterName),
                ].filter(Boolean))],
                nativeRequestType: String(nativeRequest?.constructor?.name || typeof nativeRequest),
`,
`                request: requestWithParameters(parameters, page),
                parameters,
                contextParameterNames: [...new Set(normalizeParameterList(parameters).map(parameterName).filter(Boolean))],
                nativeRequestType: String(nativeRequest?.constructor?.name || typeof nativeRequest),
`,
    'V10 context diagnostics');

  source = once(source,
    "              source: 'native-view-server-paged-v9',",
    "              source: 'native-view-server-paged-v10',",
    'V10 source');

  source = once(source,
`          && action
          && resultingRoleCountForAction(action, structure) > 0) {
`,
`          && action) {
`,
    'remove out-of-scope role helper');

  source = once(source,
    "        if (version !== '1.16.8') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.8.\`);\n        }\n        return { detail: \`Подтверждён v1.16.8 · \${actualBuild} · \${actualPerformanceBuild}.\`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    "        if (version !== '1.16.9') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.9.\`);\n        }\n        return { detail: \`Подтверждён v1.16.9 · \${actualBuild} · \${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    'v1.16.9 provenance');

  return source;
}

const target = process.argv[2];
if (target) {
  const output = apply(fs.readFileSync(target, 'utf8'));
  fs.writeFileSync(target, output, 'utf8');
  console.log('TESSA Matrix Studio v1.16.9 versioned view context + UAT scope: OK');
}
