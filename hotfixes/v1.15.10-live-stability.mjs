import fs from 'node:fs';

const BUILD = 'TMS_V1_15_10_PAGING_V4_REFRESH_EDIT_V2';

const replaceOnce = (source, before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
};

function replaceBetween(source, startAnchor, endAnchor, replacement, label) {
  const start = source.indexOf(startAnchor);
  if (start < 0) throw new Error(`${label}: start anchor not found`);
  const end = source.indexOf(endAnchor, start + startAnchor.length);
  if (end < 0) throw new Error(`${label}: end anchor not found`);
  return source.slice(0, start) + replacement + source.slice(end);
}

export function applyV11510LiveStability(input) {
  let source = String(input ?? '');
  if (source.includes(BUILD)) return source;

  source = source.replace(
    /(version:\s*'[0-9.]+'\s*,\n)/,
    `$1    buildFingerprint: '${BUILD}',\n`,
  );
  if (!source.includes(`buildFingerprint: '${BUILD}'`)) {
    throw new Error('build fingerprint insertion failed');
  }

  const pagingFunction = `    // SERVER_PAGED_NATIVE_VIEW_V1
    // SERVER_PAGED_NATIVE_VIEW_V4
    // Direct server paging. No setPageAndRefresh() is allowed here.
    // TESSA ViewPagingParameters works with IList<RequestParameter>; in the web runtime
    // that must be a real JS Array (or request.Parameters converted to one).
    async collectNativeMatrixViewLinksServerPaged(options = {}) {
      const nativeControl = this.findNativeMatrixControl();
      if (!nativeControl) return null;
      const { target, controlName } = nativeControl;
      const component = target?.viewComponent || target?.component || target;
      const api = this.viewApi();
      if (!api?.service || !api?.serviceModule?.TessaViewRequest) return null;

      const diagnostics = {
        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V4',
        build: APP.buildFingerprint || null,
        at: new Date().toISOString(),
        controlName: String(controlName || ''),
        attempts: [],
        status: 'started',
        collected: 0,
      };
      this.lastServerPagingDiagnostics = diagnostics;

      const metadataCandidates = [
        target?.viewMetadata, target?.metadata,
        component?.viewMetadata, component?.metadata,
      ].filter(Boolean);
      const aliasCandidates = [
        ...metadataCandidates.flatMap(meta => [meta?.alias, meta?.name]),
        controlName,
      ].map(value => normalizeSpace(value)).filter(Boolean);

      let view = null;
      let viewAlias = null;
      for (const alias of aliasCandidates) {
        try {
          const candidate = api.service.getByName(alias);
          if (candidate?.metadata) { view = candidate; viewAlias = alias; break; }
        } catch (_) { /* try next alias */ }
      }
      if (!view?.metadata) {
        diagnostics.status = 'view-not-found';
        return null;
      }

      const initialPaging = this.nativePagingInfo(target);
      const requestedLimit = Number(
        options.pageLimit
        ?? view?.metadata?.exportDataPageLimit
        ?? view?.metadata?.ExportDataPageLimit
        ?? view?.metadata?.pageLimit
        ?? view?.metadata?.PageLimit
        ?? initialPaging.pageLimit
        ?? 50
      );
      const pageLimit = Math.max(20, Math.min(1000,
        Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.trunc(requestedLimit) : 50));
      const sectionCount = this.rawMatrixSectionLinks().length;
      const maxPages = Math.max(1, Math.min(10000, sectionCount ? Math.ceil(sectionCount / pageLimit) + 2 : 10000));
      const collected = [];
      const seenVersions = new Set();
      const pagesVisited = [];
      const strategiesUsed = [];
      let reportedRowCount = 0;

      const resultValue = value => safePlain(this.unwrapTyped(value), { maxDepth: 4, maxKeys: 50, maxArray: 50 });
      const cloneParameter = item => {
        try {
          if (typeof item?.clone === 'function') return item.clone();
          if (typeof item?.Clone === 'function') return item.Clone();
        } catch (_) {}
        return item;
      };
      const parameterName = item => normalizeSpace(
        item?.name ?? item?.Name ?? item?.alias ?? item?.Alias
        ?? item?.parameterName ?? item?.ParameterName
        ?? item?.metadata?.alias ?? item?.Metadata?.Alias ?? ''
      );
      const normalizeParameterList = value => {
        const raw = value?.parameters ?? value?.Parameters ?? value;
        if (!raw) return [];
        try { return Array.from(raw).map(cloneParameter); }
        catch (_) {
          if (Array.isArray(raw)) return raw.map(cloneParameter);
          return [];
        }
      };
      const withoutPaging = list => normalizeParameterList(list)
        .filter(item => !/^(?:pageoffset|pagelimit)$/i.test(parameterName(item).replace(/\s+/g, '')));
      const pageParamEvidence = parameters => normalizeParameterList(parameters).map(item => ({
        name: parameterName(item),
        value: safePlain(item?.value ?? item?.Value ?? item?.values ?? item?.Values ?? null, { maxDepth: 3, maxKeys: 20, maxArray: 20 }),
      })).filter(item => /pageoffset|pagelimit/i.test(item.name));

      const rememberOwn = (obj, key) => ({ obj, key, had: !!obj && Object.prototype.hasOwnProperty.call(obj, key), value: obj?.[key] });
      const restoreOwn = item => {
        if (!item?.obj) return;
        try {
          if (item.had) item.obj[item.key] = item.value;
          else delete item.obj[item.key];
        } catch (_) {}
      };
      const setPageState = (obj, page, limit, saved) => {
        if (!obj) return;
        for (const [key, value] of [['currentPage', page], ['_currentPage', page], ['pageLimit', limit], ['_pageLimit', limit]]) {
          try {
            if (key in obj || Object.prototype.hasOwnProperty.call(obj, key)) {
              saved.push(rememberOwn(obj, key));
              obj[key] = value;
            }
          } catch (_) {}
        }
      };
      const requestWithParameters = (parameters, page) => {
        const request = new api.serviceModule.TessaViewRequest(view.metadata);
        request.calculateRowCounting = page === 1;
        request.canUseCache = false;
        if ('parameters' in request || !('Parameters' in request)) request.parameters = parameters;
        else request.Parameters = parameters;
        return request;
      };

      const owners = [...new Set([target, component].filter(Boolean))];
      const getParamsOwner = owners.find(owner => typeof owner?.getRequestParams === 'function') || null;
      const getBaseParameters = async () => {
        if (!getParamsOwner) return [];
        return normalizeParameterList(await Promise.resolve(getParamsOwner.getRequestParams()));
      };

      const Provider = api.serviceModule?.ViewPagingParameters || api.platformModule?.ViewPagingParameters || null;
      let provider = Provider?.default || Provider?.Default || null;
      if (!provider && typeof Provider === 'function') {
        try { provider = new Provider(); } catch (_) {}
      }

      const tryBuilder = async (page, strategy, fn) => {
        const evidence = { page, strategy, visiblePageBefore: this.nativePagingInfo(target).currentPage };
        try {
          const built = await fn();
          if (!built?.request) {
            evidence.outcome = 'unavailable';
            diagnostics.attempts.push(evidence);
            return null;
          }
          evidence.outcome = 'built';
          evidence.paging = pageParamEvidence(built.parameters);
          diagnostics.attempts.push(evidence);
          return { ...built, strategy };
        } catch (error) {
          evidence.outcome = 'error';
          evidence.error = String(error?.message || error);
          diagnostics.attempts.push(evidence);
          return null;
        }
      };

      const buildRequest = async page => {
        // Most portable path: create PageLimit/PageOffset RequestParameter objects directly.
        // This avoids setup/provide helpers entirely and therefore cannot hit the old
        // "findIndex is not a function" request-vs-parameter-list mismatch.
        let built = await tryBuilder(page, 'paging-parameter-factory', async () => {
          const getLimit = provider?.getPageLimitParameter || provider?.GetPageLimitParameter;
          const getOffset = provider?.getPageOffsetParameter || provider?.GetPageOffsetParameter;
          if (typeof getLimit !== 'function' || typeof getOffset !== 'function') return null;
          const parameters = withoutPaging(await getBaseParameters());
          const limitParam = getLimit.call(provider, pageLimit, false);
          const offsetParam = getOffset.call(provider, page, pageLimit, false);
          if (limitParam) parameters.push(limitParam);
          if (offsetParam) parameters.push(offsetParam);
          if (!limitParam || !offsetParam) return null;
          return { request: requestWithParameters(parameters, page), parameters };
        });
        if (built) return built;

        // Native request builder already knows all contextual parameters. We alter only
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

        // Mounted control helper, but ALWAYS with a real Array<RequestParameter>.
        for (const owner of owners) {
          built = await tryBuilder(page, owner === target ? 'target-setupPagingParameters-array' : 'component-setupPagingParameters-array', async () => {
            if (typeof owner?.setupPagingParameters !== 'function' || !getParamsOwner) return null;
            const saved = [];
            try {
              setPageState(component, page, pageLimit, saved);
              if (target !== component) setPageState(target, page, pageLimit, saved);
              const parameters = withoutPaging(await getBaseParameters());
              await Promise.resolve(owner.setupPagingParameters(parameters));
              return { request: requestWithParameters(parameters, page), parameters };
            } finally {
              for (let i = saved.length - 1; i >= 0; i -= 1) restoreOwn(saved[i]);
            }
          });
          if (built) return built;
        }

        // Official Provide* fallback. The API contract is IList<RequestParameter>.
        built = await tryBuilder(page, 'view-paging-provider-array', async () => {
          const provideLimit = provider?.providePageLimitParameter || provider?.ProvidePageLimitParameter;
          const provideOffset = provider?.providePageOffsetParameter || provider?.ProvidePageOffsetParameter;
          const pagingMode = view?.metadata?.paging ?? view?.metadata?.Paging
            ?? target?.viewMetadata?.paging ?? target?.viewMetadata?.Paging;
          if (typeof provideLimit !== 'function' || typeof provideOffset !== 'function'
            || pagingMode === null || pagingMode === undefined) return null;
          const parameters = withoutPaging(await getBaseParameters());
          provideLimit.call(provider, parameters, pagingMode, pageLimit, false);
          provideOffset.call(provider, parameters, pagingMode, page, pageLimit, false);
          return { request: requestWithParameters(parameters, page), parameters };
        });
        return built;
      };

      const executeRequest = async built => {
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

      try {
        for (let page = 1; page <= maxPages; page += 1) {
          if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
          await options.assertContext?.();
          const visiblePageBefore = this.nativePagingInfo(target).currentPage;
          const built = await buildRequest(page);
          if (!built?.request) {
            diagnostics.status = \`page-\${page}-request-build-failed\`;
            return null;
          }
          const visiblePageAfterBuild = this.nativePagingInfo(target).currentPage;
          if (visiblePageAfterBuild !== visiblePageBefore) {
            diagnostics.status = \`page-\${page}-visible-page-mutated\`;
            return null;
          }

          let execution;
          try {
            execution = await executeRequest(built);
          } catch (error) {
            diagnostics.attempts.push({ page, strategy: built.strategy, outcome: 'execute-error', error: String(error?.message || error) });
            diagnostics.status = \`page-\${page}-execution-failed\`;
            return null;
          }
          strategiesUsed.push(\`\${built.strategy}+\${execution.executor}\`);

          const result = execution.result;
          const columns = Array.from(result?.columns || result?.Columns || []).map(column =>
            normalizeSpace(column?.alias ?? column?.name ?? column?.Alias ?? column?.Name ?? column)
          );
          const canonicalColumns = columns.map(canonicalValue);
          const cardIndex = canonicalColumns.indexOf(canonicalValue('MatrixRowID'));
          const versionIndex = canonicalColumns.indexOf(canonicalValue('MatrixVersionID'));
          const orderIndex = canonicalColumns.indexOf(canonicalValue('Order'));
          if (cardIndex < 0 || versionIndex < 0) {
            diagnostics.status = \`page-\${page}-identity-columns-missing\`;
            diagnostics.attempts.push({ page, strategy: built.strategy, executor: execution.executor, outcome: 'identity-columns-missing', columns: columns.slice(0, 80) });
            return null;
          }

          const rawRows = Array.from(result?.rows || result?.Rows || []);
          const rowsForPage = rawRows.slice(0, pageLimit);
          const rowCount = Number(result?.rowCount ?? result?.RowCount ?? 0) || 0;
          if (rowCount > 0) reportedRowCount = rowCount;
          pagesVisited.push(page);

          let added = 0;
          const pageVersions = [];
          for (let index = 0; index < rowsForPage.length; index += 1) {
            const raw = Array.from(rowsForPage[index] || []);
            const rowCardId = resultValue(raw[cardIndex]);
            const versionId = resultValue(raw[versionIndex]);
            if (!rowCardId || !versionId) continue;
            pageVersions.push(String(versionId));
            const key = canonicalValue(versionId);
            if (seenVersions.has(key)) continue;
            seenVersions.add(key);
            const order = orderIndex >= 0 ? resultValue(raw[orderIndex]) : null;
            collected.push({
              index: collected.length,
              page,
              pageIndex: index,
              rowCardId: String(rowCardId),
              versionId: String(versionId),
              rowName: order !== null && order !== undefined && String(order) !== '' ? \`Строка \${order}\` : \`Строка \${collected.length + 1}\`,
              source: 'native-view-server-paged-v4',
            });
            added += 1;
          }

          diagnostics.attempts.push({
            page,
            strategy: built.strategy,
            executor: execution.executor,
            outcome: 'page-read',
            returnedRows: rawRows.length,
            acceptedRows: rowsForPage.length,
            added,
            sampleVersionIds: pageVersions.slice(0, 4),
            paging: pageParamEvidence(built.parameters),
            visiblePageAfter: this.nativePagingInfo(target).currentPage,
          });
          diagnostics.collected = collected.length;

          if (this.nativePagingInfo(target).currentPage !== visiblePageBefore) {
            diagnostics.status = \`page-\${page}-visible-page-changed-after-request\`;
            return null;
          }
          if (!rawRows.length || added === 0) break;
          if (reportedRowCount > 0 && collected.length >= reportedRowCount) break;
          if (sectionCount > 0 && collected.length >= sectionCount) break;
          if (rawRows.length <= pageLimit) break;
        }
      } catch (error) {
        if (/остановлена пользователем/i.test(String(error?.message || error))) throw error;
        diagnostics.status = 'exception';
        diagnostics.error = String(error?.message || error);
        log(\`Серверный paging «\${controlName}» недоступен: \${error.message || error}. Использую UI fallback.\`, 'warn');
        return null;
      }

      const links = [...new Map(collected.map(link => [canonicalValue(link.versionId), link])).values()];
      if (sectionCount > 0 && links.length !== sectionCount) {
        diagnostics.status = 'membership-count-mismatch';
        diagnostics.expected = sectionCount;
        diagnostics.actual = links.length;
        return null;
      }
      if (reportedRowCount > 0 && links.length !== reportedRowCount && !sectionCount) {
        diagnostics.status = 'reported-row-count-mismatch';
        diagnostics.expected = reportedRowCount;
        diagnostics.actual = links.length;
        return null;
      }

      diagnostics.status = 'passed';
      diagnostics.collected = links.length;
      diagnostics.pagesVisited = [...pagesVisited];
      diagnostics.strategiesUsed = [...new Set(strategiesUsed)];
      return {
        controlName: viewAlias || controlName,
        visibleRows: nativeControl.rows.length,
        links,
        pageCount: Math.max(1, pagesVisited.length),
        pagesVisited,
        pagingUsed: pagesVisited.length > 1,
        dynamicPaging: false,
        serverPaging: true,
        pageLimit,
        reportedRowCount: reportedRowCount || null,
        strategy: [...new Set(strategiesUsed)].join(' | '),
        diagnostics,
      };
    }

`;

  source = replaceBetween(
    source,
    '    // SERVER_PAGED_NATIVE_VIEW_V1\n',
    '    async collectNativeMatrixViewLinksAllPages(options = {}) {',
    pagingFunction,
    'server paging V4',
  );

  const patchHelper = `
  // UAT_REAL_XLSX_EDIT_V2
  // Creates the exact state a colleague produces in Excel: only the visible worksheet
  // cell changes while hidden companion IDs and every other ZIP/XML part stay untouched.
  async function patchWorkbookVisibleCellForUat(workbook, excelRow, columnIndex, value, dictionaryCatalog = null) {
    if (!workbook?.roundtrip?.enabled) throw new Error('UAT edit requires a roundtrip workbook.');
    const archive = WORKBOOK_ARCHIVES.get(workbook);
    if (!archive) throw new Error('UAT edit requires the original retained XLSX archive.');

    const rowNumber = Number(excelRow);
    const colIndex = Number(columnIndex);
    if (!Number.isInteger(rowNumber) || rowNumber < 1 || !Number.isInteger(colIndex) || colIndex < 0) {
      throw new Error('UAT edit received an invalid worksheet coordinate.');
    }

    const decoder = new TextDecoder();
    const entries = new Map(archive);
    const descriptors = parseWorkbookSheets(entries, decoder);
    const matrixPath = descriptors.find(item => item.name === workbook.sheetName)?.path;
    if (!matrixPath || !entries.has(matrixPath)) throw new Error('UAT edit could not locate the matrix worksheet XML.');

    const ref = \`\${indexToCol(colIndex)}\${rowNumber}\`;
    const escapedRef = ref.replace(/[.*+?^\\${}()|[\\]\\]/g, '\\\\$&');
    let xml = decoder.decode(entries.get(matrixPath));
    const styleOf = attrs => {
      const match = String(attrs || '').match(/\\bs="([^"]+)"/i);
      return match ? \` s="\${xmlEscape(match[1])}"\` : '';
    };
    const replacementFor = attrs =>
      \`<c r="\${ref}" t="inlineStr"\${styleOf(attrs)}><is><t xml:space="preserve">\${xmlEscape(value)}</t></is></c>\`;

    const fullCell = new RegExp(\`<c\\b([^>]*\\br="\${escapedRef}"[^>]*)>[\\s\\S]*?<\\/c>\`, 'i');
    const selfCell = new RegExp(\`<c\\b([^>]*\\br="\${escapedRef}"[^>]*)\\/>\`, 'i');
    if (fullCell.test(xml)) {
      xml = xml.replace(fullCell, (_, attrs) => replacementFor(attrs));
    } else if (selfCell.test(xml)) {
      xml = xml.replace(selfCell, (_, attrs) => replacementFor(attrs));
    } else {
      const rowRe = new RegExp(\`(<row\\b[^>]*\\br="\${rowNumber}"[^>]*>)([\\s\\S]*?)(<\\/row>)\`, 'i');
      if (!rowRe.test(xml)) throw new Error(\`UAT edit could not locate worksheet row \${rowNumber}.\`);
      xml = xml.replace(rowRe, (_, open, body, close) => \`\${open}\${body}\${replacementFor('')}\${close}\`);
    }

    entries.set(matrixPath, xml);
    const bytes = await makeZip([...entries]);
    const patched = await readXlsxArrayBuffer(
      exactArrayBuffer(bytes),
      'TESSA_UAT_USER_EDIT.xlsx',
      {
        skipSheetNames: [ROUNDTRIP.DictionarySheet],
        dictionaryCatalog: dictionaryCatalog || workbook.dictionaryCatalog || null,
        retainArchive: true,
        selectiveInflate: true,
      },
    );
    return { workbook: patched, bytes, ref, value: String(value ?? '') };
  }

`;
  source = replaceOnce(
    source,
    '  async function refreshWorkbookDictionaries(workbook, structure, catalog) {',
    patchHelper + '  async function refreshWorkbookDictionaries(workbook, structure, catalog) {',
    'real XLSX edit helper',
  );

  source = replaceOnce(
    source,
    'createChangesReportXlsxBytes, refreshWorkbookDictionaries, preserveWorkbookSelectors',
    'createChangesReportXlsxBytes, patchWorkbookVisibleCellForUat, refreshWorkbookDictionaries, preserveWorkbookSelectors',
    'export UAT XLSX edit helper',
  );

  const refreshUat = `      await runCheck('dictionary-refresh', 'Обновление справочников в изменённом Excel без потери правки', async () => {
        catalog = await bridge.loadDictionaryCatalog(structure, baseline, { forceRefresh: true, transient: true });
        const edited = findSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng);
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
        if ((beforePlan.counts?.update || 0) !== 1
          || (beforePlan.counts?.skip || 0) !== 0
          || (beforePlan.counts?.add || 0) !== 0
          || (beforePlan.counts?.delete || 0) !== 0) {
          E.releaseWorkbookArchive(sourceBook);
          throw new Error(\`UAT setup: физическая пользовательская правка XLSX должна давать ровно 1 UPDATE: \${JSON.stringify({ counts: beforePlan.counts, warnings: beforePlan.warnings || [], issues: beforePlan.issues || [], skippedRows: beforePlan.skippedRows || [], skippedFields: beforePlan.skippedFields || [], skippedValues: beforePlan.skippedValues || [], safety: beforePlan.safety || null })}\`);
        }
        const beforeAction = (beforePlan.actions || []).find(action => action.type === 'update');
        if (!beforeAction) {
          E.releaseWorkbookArchive(sourceBook);
          throw new Error('UAT setup: UPDATE action не найден после физической правки XLSX.');
        }

        const refreshedBytes = await E.refreshWorkbookDictionaries(sourceBook, structure, catalog);
        E.releaseWorkbookArchive(sourceBook);
        const refreshed = await E.readXlsxArrayBuffer(
          E.exactArrayBuffer(refreshedBytes),
          'TESSA_UAT_REFRESHED.xlsx',
          { skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false, selectiveInflate: true },
        );
        const afterPlan = E.buildPlan(refreshed, structure, baseline, info);

        if ((afterPlan.counts?.update || 0) !== 1
          || (afterPlan.counts?.skip || 0) !== 0
          || (afterPlan.counts?.add || 0) !== 0
          || (afterPlan.counts?.delete || 0) !== 0) {
          throw new Error(\`Refresh изменил пользовательскую правку/план: \${JSON.stringify({ before: beforePlan.counts, after: afterPlan.counts, skippedRows: afterPlan.skippedRows || [], skippedFields: afterPlan.skippedFields || [], skippedValues: afterPlan.skippedValues || [] })}\`);
        }

        const afterAction = (afterPlan.actions || []).find(action => action.type === 'update');
        if (!afterAction || canon(beforeAction.currentRow?.rowCardId) !== canon(afterAction.currentRow?.rowCardId)) {
          throw new Error('После refresh изменённая строка потеряла target identity.');
        }
        const refreshedRow = (refreshed.rows || []).find(row => Number(row.excelRow) === Number(edited.source.excelRow));
        const visibleAfter = refreshedRow?.values?.[edited.column.index] ?? '';
        if (canon(visibleAfter) !== canon(visibleValue)) {
          throw new Error(\`После refresh потерялась пользовательская правка ячейки \${physical.ref}: «\${visibleValue}» → «\${visibleAfter}».\`);
        }

        packageEntries.push(['dictionary-refreshed.xlsx', refreshedBytes]);
        return {
          detail: \`Физическая правка \${physical.ref} сохранена после refresh; hidden identity и план UPDATE не изменились.\`,
          data: { before: beforePlan.counts, after: afterPlan.counts, excelRow: edited.source.excelRow, cell: physical.ref, field: edited.column.key, value: visibleValue },
        };
      });
`;

  source = replaceBetween(
    source,
    "      await runCheck('dictionary-refresh'",
    "      await runCheck('merge-current'",
    refreshUat,
    'dictionary refresh live UAT',
  );

  const provenance = `      await runCheck('candidate-build-provenance', 'Версия и paging-adapter текущего кандидата', async () => {
        const expectedBuild = '${BUILD}';
        const actualBuild = String(E.buildFingerprint || '');
        const version = String(E.studioVersion?.() || E.version || '');
        if (actualBuild !== expectedBuild) {
          throw new Error(\`Загружен другой/старый userscript: build=\${actualBuild || '(нет)'}, ожидался \${expectedBuild}.\`);
        }
        if (version !== '1.15.10') {
          throw new Error(\`Загружена версия \${version || '(нет)'}, ожидалась 1.15.10.\`);
        }
        return { detail: \`Подтверждён v1.15.10 · \${actualBuild}.\`, data: { version, build: actualBuild } };
      });
`;
  source = replaceOnce(
    source,
    "      await runCheck('initial-export-server-paging'",
    provenance + "      await runCheck('initial-export-server-paging'",
    'candidate provenance UAT',
  );

  source = replaceOnce(
    source,
    "    version: APP.version,\n    // FULL_UAT_VERSION_PROVENANCE_V1",
    "    version: APP.version,\n    buildFingerprint: APP.buildFingerprint,\n    // FULL_UAT_VERSION_PROVENANCE_V1",
    'export build fingerprint',
  );

  source = source.replace(
    "if (!direct?.serverPaging) throw new Error('Runtime не подтвердил безопасный direct server paging; visual fallback.');",
    "if (!direct?.serverPaging) throw new Error(`Runtime не подтвердил безопасный direct server paging; visual fallback. Build=${E.buildFingerprint || '(нет)'}. Evidence=${JSON.stringify(bridge.lastServerPagingDiagnostics || null)}`);",
  );

  // PROD_SMOKE_DIAGNOSTICS_V1
  source = replaceOnce(
    source,
    "  async function runStudioDiagnostics(download = false) {\n    if (APP.busy) return;",
    "  // PROD_SMOKE_DIAGNOSTICS_V1\n  async function runStudioDiagnostics(download = false) {\n    if (APP.busy) return;\n    const quickMode = !download;",
    'production smoke diagnostics mode',
  );
  source = replaceOnce(
    source,
    "      let result = download ? APP.lastStudioDiagnostics : null;",
    "      let result = download && APP.lastStudioDiagnostics?.report?.mode === 'full' ? APP.lastStudioDiagnostics : null;",
    'diagnostic cache must match full mode',
  );
  source = replaceOnce(
    source,
    "          probe: probeRuntimeEnvironment, file, workbook: originalWorkbook, previous, assertContext, limits: { candidates: 200 },",
    "          probe: probeRuntimeEnvironment, file, workbook: originalWorkbook, previous, assertContext, limits: { candidates: quickMode ? 40 : 200 },",
    'bounded production smoke candidates',
  );
  source = replaceOnce(
    source,
    "      const intervalDiagnostics = await resolveStudioIntervalDiagnostics({",
    "      const intervalDiagnostics = quickMode ? null : await resolveStudioIntervalDiagnostics({",
    'skip heavy interval diagnostics in smoke mode',
  );
  source = replaceOnce(
    source,
    "      // Performance UAT is deliberately synthetic/read-only. Real touched-only server\n      // timings are copied from this session's telemetry and are never fabricated.\n      let performanceUat;\n      try {\n        setProgress(95, 'Performance UAT', 'Локальные сценарии 0/1/10/100/3000 строк');\n        performanceUat = await runPerformanceUat({ baseRows: 3000 });",
    "      // Performance UAT is deliberately synthetic/read-only. Regular «Проверки» use\n      // a fast 300-row smoke profile; downloaded «Диагностика» keeps the full 3000-row profile.\n      const performanceRows = quickMode ? 300 : 3000;\n      let performanceUat;\n      try {\n        setProgress(95, 'Performance UAT', \`Локальные сценарии до \${performanceRows} строк\`);\n        performanceUat = await runPerformanceUat({ baseRows: performanceRows });",
    'smoke performance profile',
  );
  source = replaceOnce(
    source,
    "          createdAt: nowIso(), baseRows: 3000, scenarios: [], cache: { hits: 0, misses: 0 },",
    "          createdAt: nowIso(), baseRows: performanceRows, scenarios: [], cache: { hits: 0, misses: 0 },",
    'smoke performance failure metadata',
  );
  source = replaceOnce(
    source,
    "      APP.lastPerformanceUat = performanceUat;\n      result.performanceUat = performanceUat;",
    "      APP.lastPerformanceUat = performanceUat;\n      result.report.mode = quickMode ? 'smoke' : 'full';\n      result.performanceUat = performanceUat;",
    'diagnostic mode evidence',
  );

  return source;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node hotfixes/v1.15.10-live-stability.mjs <userscript>');
  const input = fs.readFileSync(file, 'utf8');
  const output = applyV11510LiveStability(input);
  fs.writeFileSync(file, output);
}
