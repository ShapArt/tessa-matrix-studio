import fs from 'node:fs';

const BUILD = 'TMS_V1_16_10_PAGING_V11_ISOLATED_PAGING_CONTEXT';

function once(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
}

export function apply(input) {
  let source = String(input ?? '');
  if (source.includes(`pagingIsolatedContextBuild: '${BUILD}'`)) return source;

  source = once(source,
    "    pagingVersionedContextBuild: 'TMS_V1_16_9_PAGING_V10_VERSIONED_CONTEXT',\n",
    "    pagingVersionedContextBuild: 'TMS_V1_16_9_PAGING_V10_VERSIONED_CONTEXT',\n    pagingIsolatedContextBuild: '" + BUILD + "',\n",
    'V11 build');
  source = once(source,
    '    // SERVER_PAGED_NATIVE_VIEW_V10\n',
    '    // SERVER_PAGED_NATIVE_VIEW_V10\n    // SERVER_PAGED_NATIVE_VIEW_V11\n',
    'V11 marker');
  source = once(source,
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V10',\n        build: APP.pagingVersionedContextBuild || APP.pagingContextBuild || APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V11',\n        build: APP.pagingIsolatedContextBuild || APP.pagingVersionedContextBuild || APP.pagingContextBuild || APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    'V11 diagnostics');

  source = once(source,
`              const baseContextParameters = await getBaseParameters();
              const nativeContextParameters = normalizeParameterList(
                nativeRequest.parameters ?? nativeRequest.Parameters ?? nativeRequest.values ?? nativeRequest.Values ?? []
              );
              let parameters = withoutPaging(mergeContextParameters(baseContextParameters, nativeContextParameters));
              if (!isPagingUsableForPage(parameters, page, lastAcceptedOffset)) {
                for (const pagingOwner of owners) {
                  if (typeof pagingOwner?.setupPagingParameters !== 'function') continue;
                  const candidate = [...parameters];
                  await Promise.resolve(pagingOwner.setupPagingParameters(candidate));
                  if (isPagingUsableForPage(candidate, page, lastAcceptedOffset)) {
                    parameters = candidate;
                    break;
                  }
                }
              }
              if (!isPagingUsableForPage(parameters, page, lastAcceptedOffset)) return null;
              // Cherkizovo DynamicMetadataViewInterceptor hard-requires MatrixID.
`,
`              const baseContextParameters = await getBaseParameters();
              const nativeContextParameters = normalizeParameterList(
                nativeRequest.parameters ?? nativeRequest.Parameters ?? nativeRequest.values ?? nativeRequest.Values ?? []
              );
              // Live Full UAT seed 2589527719 proved that getRequestParams() may contain
              // contextual parameter objects that the mounted setupPagingParameters()
              // implementation cannot iterate ("e is not iterable"). Paging must be
              // produced from the native request collection first; contextual filters are
              // merged only after PageOffset/PageLimit are valid.
              let pagingParameters = withoutPaging(nativeContextParameters);
              if (!isPagingUsableForPage(pagingParameters, page, lastAcceptedOffset)) {
                for (const pagingOwner of owners) {
                  if (typeof pagingOwner?.setupPagingParameters !== 'function') continue;
                  const candidate = [...pagingParameters];
                  await Promise.resolve(pagingOwner.setupPagingParameters(candidate));
                  if (isPagingUsableForPage(candidate, page, lastAcceptedOffset)) {
                    pagingParameters = candidate;
                    break;
                  }
                }
              }
              if (!isPagingUsableForPage(pagingParameters, page, lastAcceptedOffset)) return null;
              const parameters = mergeContextParameters(baseContextParameters, pagingParameters);
              // Cherkizovo DynamicMetadataViewInterceptor hard-requires MatrixID.
`,
    'isolate paging from contextual parameters');

  source = once(source,
`              const parameters = withoutPaging(await getBaseParameters());
              await Promise.resolve(owner.setupPagingParameters(parameters));
              return { request: requestWithParameters(parameters, page), parameters };
`,
`              const baseContextParameters = await getBaseParameters();
              const pagingParameters = [];
              await Promise.resolve(owner.setupPagingParameters(pagingParameters));
              if (!isPagingUsableForPage(pagingParameters, page, lastAcceptedOffset)) return null;
              const parameters = mergeContextParameters(baseContextParameters, pagingParameters);
              return { request: requestWithParameters(parameters, page), parameters };
`,
    'isolate setup fallback');

  source = once(source,
`          const parameters = withoutPaging(await getBaseParameters());
          provideLimit.call(provider, parameters, pagingMode, pageLimit, false);
          provideOffset.call(provider, parameters, pagingMode, page, pageLimit, false);
          return { request: requestWithParameters(parameters, page), parameters };
`,
`          const baseContextParameters = await getBaseParameters();
          const pagingParameters = [];
          provideLimit.call(provider, pagingParameters, pagingMode, pageLimit, false);
          provideOffset.call(provider, pagingParameters, pagingMode, page, pageLimit, false);
          if (!isPagingUsableForPage(pagingParameters, page, lastAcceptedOffset)) return null;
          const parameters = mergeContextParameters(baseContextParameters, pagingParameters);
          return { request: requestWithParameters(parameters, page), parameters };
`,
    'isolate provider fallback');

  source = once(source,
    "              source: 'native-view-server-paged-v10',",
    "              source: 'native-view-server-paged-v11',",
    'V11 source');

  source = once(source,
    "        if (version !== '1.16.9') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.9.\`);\n        }\n        return { detail: \`Подтверждён v1.16.9 · \${actualBuild} · \${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    "        if (version !== '1.16.10') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.10.\`);\n        }\n        return { detail: \`Подтверждён v1.16.10 · \${actualBuild} · \${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    'v1.16.10 provenance');

  return source;
}

const target = process.argv[2];
if (target) {
  const output = apply(fs.readFileSync(target, 'utf8'));
  fs.writeFileSync(target, output, 'utf8');
  console.log('TESSA Matrix Studio v1.16.10 isolated paging/context merge: OK');
}
