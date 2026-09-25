import fs from 'node:fs';

const BUILD = 'TMS_V1_16_7_PAGING_V8_CANONICAL_REQUEST';

function once(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
}

export function apply(input) {
  let source = String(input ?? '');
  if (source.includes(`pagingCanonicalBuild: '${BUILD}'`)) return source;

  source = once(
    source,
    "    pagingFinalBuild: 'TMS_V1_16_6_PAGING_V7_VALIDATED_OFFSETS',\n",
    "    pagingFinalBuild: 'TMS_V1_16_6_PAGING_V7_VALIDATED_OFFSETS',\n    pagingCanonicalBuild: '" + BUILD + "',\n",
    'V8 build fingerprint',
  );
  source = once(
    source,
    '    // SERVER_PAGED_NATIVE_VIEW_V7\n',
    '    // SERVER_PAGED_NATIVE_VIEW_V7\n    // SERVER_PAGED_NATIVE_VIEW_V8\n',
    'V8 marker',
  );
  source = once(
    source,
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V7',\n        build: APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    "        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V8',\n        build: APP.pagingCanonicalBuild || APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",
    'V8 diagnostics',
  );

  source = once(
    source,
`              const request = await Promise.resolve(owner.createDataRequest());
              if (!request) return null;
              let parameters = withoutPaging(request.parameters ?? request.Parameters ?? []);
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
              if ('parameters' in request || !('Parameters' in request)) request.parameters = parameters;
              else request.Parameters = parameters;
              request.calculateRowCounting = page === 1;
              request.canUseCache = false;
              return { request, parameters };
`,
`              const nativeRequest = await Promise.resolve(owner.createDataRequest());
              if (!nativeRequest) return null;
              let parameters = withoutPaging(nativeRequest.parameters ?? nativeRequest.Parameters ?? []);
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

              // Live Full UAT seed 3680395665 proved the architectural boundary:
              // component.getViewData accepted our request argument but ignored its
              // PageOffset=51 and returned page 1 again. createDataRequest is therefore
              // used only to preserve the mounted control's contextual RequestParameters.
              // The actual wire request is rebuilt as the canonical TessaViewRequest type
              // used by the documented view.getData(request) API.
              return {
                request: requestWithParameters(parameters, page),
                parameters,
                nativeRequestType: String(nativeRequest?.constructor?.name || typeof nativeRequest),
              };
`,
    'canonical direct request',
  );

  source = once(
    source,
`      const executeRequest = async built => {
        const executors = [
          { name: 'view.getData', owner: view, fn: view?.getData },
          { name: 'component.getViewData', owner: component, fn: component?.getViewData },
          { name: 'target.getViewData', owner: target, fn: target?.getViewData },
        ];
        const errors = [];
        for (const executor of executors) {
          if (typeof executor.fn !== 'function') continue;
          try {
            const result = await Promise.resolve(executor.fn.call(executor.owner, built.request));
            if (result) return { result, executor: executor.name };
          } catch (error) {
            errors.push({ executor: executor.name, error: String(error?.message || error) });
          }
        }
        throw new Error(\`Все direct View API executors отклонены: \${JSON.stringify(errors)}\`);
      };
`,
`      const executeRequest = async built => {
        // Only APIs whose public contract consumes an explicit View request are allowed.
        // Mounted component/target getViewData methods are UI refresh helpers in this
        // runtime and must never be used as proof of server paging.
        const executors = [
          { name: 'view.getData', owner: view, fn: view?.getData },
          { name: 'service.getData', owner: api.service, fn: api.service?.getData },
        ];
        const directExecutorErrors = [];
        for (const executor of executors) {
          if (typeof executor.fn !== 'function') continue;
          try {
            const result = await Promise.resolve(executor.fn.call(executor.owner, built.request));
            if (result) return { result, executor: executor.name, directExecutorErrors };
            directExecutorErrors.push({ executor: executor.name, error: 'empty-result' });
          } catch (error) {
            directExecutorErrors.push({ executor: executor.name, error: String(error?.message || error) });
          }
        }
        throw new Error(\`Все direct View API executors отклонены: \${JSON.stringify(directExecutorErrors)}\`);
      };
`,
    'direct request executors',
  );

  source = once(
    source,
    "            decodedPaging: pagingValues(built.parameters),\n            visiblePageAfter:",
    "            decodedPaging: pagingValues(built.parameters),\n            directExecutorErrors: execution.directExecutorErrors || [],\n            nativeRequestType: built.nativeRequestType || null,\n            visiblePageAfter:",
    'direct executor diagnostics',
  );
  source = once(
    source,
    "              source: 'native-view-server-paged-v7',",
    "              source: 'native-view-server-paged-v8',",
    'V8 source marker',
  );
  source = once(
    source,
    "        if (version !== '1.16.6') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.6.\`);\n        }\n        return { detail: \`Подтверждён v1.16.6 · \${actualBuild} · \${actualPerformanceBuild}.\`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    "        if (version !== '1.16.7') {\n          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.16.7.\`);\n        }\n        return { detail: \`Подтверждён v1.16.7 · \${actualBuild} · \${actualPerformanceBuild}.\`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
    'v1.16.7 provenance',
  );

  return source;
}

const target = process.argv[2];
if (target) {
  const output = apply(fs.readFileSync(target, 'utf8'));
  fs.writeFileSync(target, output, 'utf8');
  console.log('TESSA Matrix Studio v1.16.7 canonical direct request: OK');
}
