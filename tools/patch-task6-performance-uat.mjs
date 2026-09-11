import fs from 'node:fs';

const sourcePath = new URL('../tessa-matrix-studio.user.js', import.meta.url);
const packagePath = new URL('../package.json', import.meta.url);
const diagnosticsPath = new URL('../docs/STUDIO-DIAGNOSTICS.md', import.meta.url);
let code = fs.readFileSync(sourcePath, 'utf8');

function replaceOnce(before, after, label) {
  if (code.includes(after)) return;
  const index = code.indexOf(before);
  if (index < 0) throw new Error(`Patch anchor not found: ${label}`);
  if (code.indexOf(before, index + before.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  code = code.slice(0, index) + after + code.slice(index + before.length);
}

replaceOnce(
  `    lastStudioDiagnostics: null,\n    nativeRecorder: null,`,
  `    lastStudioDiagnostics: null,\n    lastPerformanceUat: null,\n    nativeRecorder: null,`,
  'APP lastPerformanceUat',
);

const performanceFunctions = `
  // PERFORMANCE_UAT_V1
  // Local synthetic benchmark only: it builds the same roundtrip workbook and planner
  // shapes as normal Studio work, but never calls TESSA services or mutation methods.
  function performanceUatScenarioNames() {
    return [
      '0 changes', '1 ADD', '10 ADD', '100 ADD', '1 UPDATE', '10 UPDATE',
      '1 DELETE', 'mixed 10', '3000 KEEP + 1 ADD', '3000 KEEP + 1 UPDATE',
    ];
  }

  function performanceUatRow(index) {
    const org = index % 100;
    const person = index % 300;
    const flat = {
      'criterion:org': ['Орг ' + org],
      'function:sign': ['Сотрудник ' + person],
    };
    return {
      index,
      rowCardId: 'perf-card-' + index,
      versionId: 'perf-version-' + index,
      fingerprint: fingerprintFlat(flat),
      flat,
      values: { org: [{ id: 'perf-org-' + org, display: 'Орг ' + org, kind: 'ReferenceGuid' }] },
      roles: { sign: [{ id: 'perf-person-' + person, display: 'Сотрудник ' + person, roleTypeId: 1 }] },
    };
  }

  function clonePerformanceWorkbook(workbook) {
    const cloneRow = row => ({
      ...row,
      values: Array.isArray(row?.values) ? [...row.values] : [],
      cellMeta: Array.isArray(row?.cellMeta) ? row.cellMeta.map(item => item && typeof item === 'object' ? { ...item } : item) : row?.cellMeta,
    });
    return {
      ...workbook,
      headers: [...(workbook?.headers || [])],
      schemaTokens: [...(workbook?.schemaTokens || [])],
      rows: (workbook?.rows || []).map(cloneRow),
      roundtrip: {
        ...(workbook?.roundtrip || {}),
        baselineRows: (workbook?.roundtrip?.baselineRows || []).map(item => ({
          ...item,
          base: item?.base ? clonePlain(item.base) : item?.base,
        })),
      },
    };
  }

  function buildPerformanceUatSummary(result = {}) {
    return {
      format: result.format || 'TESSA_PERFORMANCE_UAT_V1',
      status: result.status || 'unknown',
      scope: result.scope || 'synthetic-read-only',
      baseRows: Math.max(0, Number(result.baseRows) || 0),
      scenarios: Array.isArray(result.scenarios) ? result.scenarios.length : 0,
      totalMs: Math.max(0, Number(result.totalMs) || 0),
      cache: clonePlain(result.cache || { hits: 0, misses: 0 }),
      liveTimings: clonePlain(result.liveTimings || {}),
      failures: clonePlain(result.failures || []),
      rows: (result.scenarios || []).map(item => ({
        name: item.name,
        plannerMs: Math.max(0, Number(item.plannerMs) || 0),
        totalRows: Math.max(0, Number(item.totalRows) || 0),
        fullyValidatedRows: Math.max(0, Number(item.fullyValidatedRows) || 0),
        preflightRows: Math.max(0, Number(item.preflightRows) || 0),
        baselineFastPathHits: Math.max(0, Number(item.baselineFastPathHits) || 0),
        counts: clonePlain(item.counts || {}),
      })),
    };
  }

  async function runPerformanceUat(options = {}) {
    const requested = Math.trunc(Number(options?.baseRows) || 3000);
    const baseRows = Math.max(100, Math.min(10000, requested));
    const started = monotonicNow();
    const structure = {
      templateId: 'performance-uat-template',
      conditions: [{ criterionRowId: 'org', criterionName: 'Организация', operandTypeId: OPERAND.ReferenceGuid, refSection: 'GchPartners' }],
      functions: [{ id: 'sign', name: 'Подписание', typeName: 'Подписание' }],
    };
    const snapshot = {
      matrixId: 'performance-uat-matrix',
      templateId: structure.templateId,
      rows: Array.from({ length: baseRows }, (_, index) => performanceUatRow(index)),
    };
    const matrixInfo = { matrixId: snapshot.matrixId, TemplateID: snapshot.templateId, Name: 'Performance UAT' };
    const catalog = mergeSnapshotIntoDictionaryCatalog(null, structure, snapshot);
    const bytes = await createRoundtripXlsxBytes(structure, snapshot, matrixInfo, catalog, { includeActions: true });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const baseWorkbook = await readXlsxArrayBuffer(buffer, 'performance-uat.xlsx');
    const signer = baseWorkbook.headers.indexOf('Подписание');
    const signerId = baseWorkbook.headers.indexOf('Подписание__ID');
    if (signer < 0 || signerId < 0) throw new Error('Performance UAT: не найдены колонки функции Подписание.');

    const changeSigner = (workbook, rowIndex, delta = 1) => {
      const row = workbook.rows[rowIndex];
      if (!row) throw new Error('Performance UAT: отсутствует строка ' + rowIndex + '.');
      const person = (rowIndex + delta) % 300;
      row.values[signer] = 'Сотрудник ' + person;
      row.values[signerId] = 'perf-person-' + person + '|1';
    };
    const appendCopies = (workbook, count, sourceOffset = 0) => {
      const maxExcelRow = Math.max(0, ...(workbook.rows || []).map(row => Number(row.excelRow) || 0));
      for (let i = 0; i < count; i += 1) {
        const sourceIndex = (sourceOffset + i) % baseWorkbook.rows.length;
        const source = baseWorkbook.rows[sourceIndex];
        const copy = {
          ...source,
          excelRow: maxExcelRow + i + 2,
          values: [...source.values],
          cellMeta: Array.isArray(source.cellMeta) ? source.cellMeta.map(item => item && typeof item === 'object' ? { ...item } : item) : source.cellMeta,
        };
        workbook.rows.push(copy);
        changeSigner(workbook, workbook.rows.length - 1, 1);
      }
    };
    const deleteRows = (workbook, indexes) => {
      const remove = new Set(indexes);
      workbook.rows = workbook.rows.filter((_, index) => !remove.has(index));
    };

    const scenarioBuilders = new Map([
      ['0 changes', workbook => workbook],
      ['1 ADD', workbook => { appendCopies(workbook, 1, 0); return workbook; }],
      ['10 ADD', workbook => { appendCopies(workbook, 10, 20); return workbook; }],
      ['100 ADD', workbook => { appendCopies(workbook, 100, 100); return workbook; }],
      ['1 UPDATE', workbook => { changeSigner(workbook, 0, 1); return workbook; }],
      ['10 UPDATE', workbook => { for (let i = 0; i < 10; i += 1) changeSigner(workbook, i, 1); return workbook; }],
      ['1 DELETE', workbook => { deleteRows(workbook, [0]); return workbook; }],
      ['mixed 10', workbook => {
        for (let i = 0; i < 4; i += 1) changeSigner(workbook, i, 1);
        deleteRows(workbook, [10, 11, 12]);
        appendCopies(workbook, 3, 30);
        return workbook;
      }],
      ['3000 KEEP + 1 ADD', workbook => { appendCopies(workbook, 1, 40); return workbook; }],
      ['3000 KEEP + 1 UPDATE', workbook => { changeSigner(workbook, 42, 1); return workbook; }],
    ]);

    const expected = {
      '0 changes': { noop: baseRows, fullyValidatedRows: 0, preflightRows: 0 },
      '1 ADD': { add: 1 },
      '10 ADD': { add: 10 },
      '100 ADD': { add: 100 },
      '1 UPDATE': { update: 1 },
      '10 UPDATE': { update: 10 },
      '1 DELETE': { delete: 1 },
      'mixed 10': { preflightRows: 10 },
      '3000 KEEP + 1 ADD': { add: 1, noop: baseRows, fullyValidatedRows: 1, baselineFastPathHits: baseRows },
      '3000 KEEP + 1 UPDATE': { update: 1, noop: baseRows - 1, fullyValidatedRows: 1 },
    };

    const scenarios = [];
    const failures = [];
    for (const name of performanceUatScenarioNames()) {
      const workbook = scenarioBuilders.get(name)(clonePerformanceWorkbook(baseWorkbook));
      const planStarted = monotonicNow();
      const plan = buildPlan(workbook, structure, snapshot, matrixInfo);
      const plannerMs = Math.max(0, monotonicNow() - planStarted);
      const counts = clonePlain(plan.counts || countActions(plan.actions || []));
      const preflightRows = (plan.actions || []).filter(action => ['add', 'update', 'delete'].includes(action?.type)).length;
      const item = {
        name,
        plannerMs,
        totalRows: workbook.rows.length,
        counts,
        fullyValidatedRows: Math.max(0, Number(plan.incremental?.rowsFullyValidated) || 0),
        preflightRows,
        baselineFastPathHits: Math.max(0, Number(plan.incremental?.baselineFastPathHits) || 0),
      };
      scenarios.push(item);
      const rule = expected[name] || {};
      for (const [key, value] of Object.entries(rule)) {
        const actual = Object.prototype.hasOwnProperty.call(counts, key) ? counts[key] : item[key];
        if (Number(actual) !== Number(value)) failures.push({ scenario: name, metric: key, expected: value, actual });
      }
      await yieldToMain();
    }

    const cacheState = sessionCacheStats();
    const telemetry = performanceSnapshot();
    const result = {
      format: 'TESSA_PERFORMANCE_UAT_V1',
      scope: 'synthetic-read-only',
      createdAt: nowIso(),
      baseRows,
      scenarios,
      failures,
      cache: {
        hits: Math.max(0, Number(cacheState?.hits) || 0),
        misses: Math.max(0, Number(cacheState?.misses) || 0),
        invalidations: Math.max(0, Number(cacheState?.invalidations) || 0),
      },
      liveTimings: clonePlain(telemetry?.stages || {}),
      totalMs: Math.max(0, monotonicNow() - started),
    };
    result.status = failures.length ? 'failed' : 'passed';
    return result;
  }
`;

replaceOnce(
  `  function performanceSnapshot() {\n    return clonePlain(APP.performanceTelemetry || { startedAt: nowIso(), stages: {}, events: [] });\n  }\n\n  function sessionContextKey(matrixId, templateId) {`,
  `  function performanceSnapshot() {\n    return clonePlain(APP.performanceTelemetry || { startedAt: nowIso(), stages: {}, events: [] });\n  }\n${performanceFunctions}\n  function sessionContextKey(matrixId, templateId) {`,
  'performance UAT functions',
);

replaceOnce(
  `    APP.lastIntervalDiagnostics = null;\n    APP.lastStudioDiagnostics = null;\n    APP.lastReport = null;`,
  `    APP.lastIntervalDiagnostics = null;\n    APP.lastStudioDiagnostics = null;\n    APP.lastPerformanceUat = null;\n    APP.lastReport = null;`,
  'reset performance UAT',
);

replaceOnce(
  `    const interval = result?.intervalDiagnostics?.value;\n    const intervalEntries = interval ? [\n      ['interval/TESSA_Interval_Diagnostics.json', JSON.stringify(interval, null, 2)],\n      ['interval/interval-summary.json', JSON.stringify(buildIntervalDiagnosticSummary(interval), null, 2)],\n    ] : [];\n    return makeZip([['README.txt', readme], ['report.json', JSON.stringify(result.report, null, 2)], ...result.entries, ...intervalEntries]);`,
  `    const interval = result?.intervalDiagnostics?.value;\n    const intervalEntries = interval ? [\n      ['interval/TESSA_Interval_Diagnostics.json', JSON.stringify(interval, null, 2)],\n      ['interval/interval-summary.json', JSON.stringify(buildIntervalDiagnosticSummary(interval), null, 2)],\n    ] : [];\n    const performanceUat = result?.performanceUat || APP.lastPerformanceUat;\n    const performanceEntries = performanceUat ? [\n      ['performance/performance-uat.json', JSON.stringify(performanceUat, null, 2)],\n      ['performance/performance-uat-summary.json', JSON.stringify(buildPerformanceUatSummary(performanceUat), null, 2)],\n    ] : [];\n    return makeZip([['README.txt', readme], ['report.json', JSON.stringify(result.report, null, 2)], ...result.entries, ...intervalEntries, ...performanceEntries]);`,
  'diagnostics performance artifact',
);

replaceOnce(
  `      // References stay in memory only; package serialization uses report/entries.\n      result.source = { plan: originalPlan, workbook: originalWorkbook, file };\n      APP.lastStudioDiagnostics = result;`,
  `      // Performance UAT is deliberately synthetic/read-only. Real touched-only server\n      // timings are copied from this session's telemetry and are never fabricated.\n      let performanceUat;\n      try {\n        setProgress(95, 'Performance UAT', 'Локальные сценарии 0/1/10/100/3000 строк');\n        performanceUat = await runPerformanceUat({ baseRows: 3000 });\n      } catch (error) {\n        performanceUat = {\n          format: 'TESSA_PERFORMANCE_UAT_V1', scope: 'synthetic-read-only', status: 'failed',\n          createdAt: nowIso(), baseRows: 3000, scenarios: [], cache: { hits: 0, misses: 0 },\n          liveTimings: clonePlain(performanceSnapshot()?.stages || {}), totalMs: 0,\n          failures: [{ scenario: 'setup', metric: 'exception', expected: 'success', actual: friendlyErrorMessage(error) }],\n        };\n      }\n      APP.lastPerformanceUat = performanceUat;\n      result.performanceUat = performanceUat;\n      result.report.performanceUat = buildPerformanceUatSummary(performanceUat);\n      result.report.checks.push({\n        status: performanceUat.status === 'passed' ? 'pass' : 'fail',\n        title: 'Performance UAT',\n        detail: performanceUat.status === 'passed'\n          ? performanceUat.scenarios.length + ' synthetic read-only сценариев · ' + Math.round(performanceUat.totalMs) + ' мс'\n          : 'Не пройдено: ' + (performanceUat.failures || []).length + '. См. performance/performance-uat.json',\n      });\n      if (performanceUat.status !== 'passed') result.report.status = 'failed';\n      // References stay in memory only; package serialization uses report/entries.\n      result.source = { plan: originalPlan, workbook: originalWorkbook, file };\n      APP.lastStudioDiagnostics = result;`,
  'run diagnostics performance UAT',
);

replaceOnce(
  `    performanceStage, performanceSnapshot, resetPerformanceTelemetry, sessionContextKey, setSessionSnapshot, getSessionSnapshot, updateSessionRows, invalidateSessionCache, sessionCacheStats,`,
  `    performanceStage, performanceSnapshot, resetPerformanceTelemetry, performanceUatScenarioNames, runPerformanceUat, buildPerformanceUatSummary, makeZip, sessionContextKey, setSessionSnapshot, getSessionSnapshot, updateSessionRows, invalidateSessionCache, sessionCacheStats,`,
  'performance UAT exports',
);

fs.writeFileSync(sourcePath, code);

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (!pkg.scripts?.test?.includes('tests/performance-uat.mjs')) {
  pkg.scripts.test = pkg.scripts.test.replace(
    'node tests/changes-report-ui.mjs',
    'node tests/changes-report-ui.mjs && node tests/performance-uat.mjs',
  );
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
}

let diagnostics = fs.readFileSync(diagnosticsPath, 'utf8');
const marker = '## Performance UAT (v1.14 candidate)';
if (!diagnostics.includes(marker)) {
  diagnostics += '\n\n' + marker + '\n\nВстроенная диагностика дополнительно запускает локальный **read-only** benchmark planner-а. Он не вызывает серверные операции записи и не изменяет карточки TESSA.\n\nПроверяются сценарии: 0 изменений; 1/10/100 ADD; 1/10 UPDATE; 1 DELETE; mixed 10; 3000 KEEP + 1 ADD; 3000 KEEP + 1 UPDATE. Для каждого сценария фиксируются время planner-а, число строк, прошедших полную validation, число mutation/preflight-строк и baseline fast-path hits.\n\nВ ZIP диагностики добавляются `performance/performance-uat.json` и `performance/performance-uat-summary.json`. Поля `liveTimings` берутся только из реально накопленной telemetry текущей вкладки (например, `preflight.targeted` / `reconcile.targeted`) и не подменяются synthetic-замерами. Поэтому до live UAT нельзя интерпретировать synthetic planner timings как подтверждённое ускорение сервера TESSA.\n';
  fs.writeFileSync(diagnosticsPath, diagnostics);
}

console.log('Task 6 performance UAT patch applied.');
