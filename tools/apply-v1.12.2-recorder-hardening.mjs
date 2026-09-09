import fs from 'node:fs';

const file = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(file, 'utf8');

const startMarker = '  function restoreNativeRecorderMethods(recorder) {';
const legacyStartMarker = '  async function startNativeOperationRecorder() {';
const endMarker = '  function reconciliationSummary(result) {';
let start = code.indexOf(startMarker);
if (start < 0) start = code.indexOf(legacyStartMarker);
const end = code.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('native recorder block not found');

const replacement = `  function restoreNativeRecorderMethods(recorder) {
    if (!recorder) return { restored: 0, failed: 0 };
    const service = recorder.bridge?.cardService;
    let restored = 0;
    let failed = 0;
    for (const [name, original] of recorder.originals || []) {
      try {
        if (service) service[name] = original;
        if (!service || service[name] !== original) throw new Error('restore-verification-failed');
        restored++;
      } catch (_) {
        failed++;
      }
    }
    recorder.originals?.clear?.();
    return { restored, failed };
  }

  function resetNativeRecorderControls() {
    const start = document.querySelector?.('#tms-native-record-start');
    const stop = document.querySelector?.('#tms-native-record-stop');
    if (start) start.disabled = false;
    if (stop) stop.disabled = true;
  }

  async function startNativeOperationRecorder() {
    if (APP.busy || APP.nativeRecorder?.active) return;
    let recorder = null;
    try {
      const bridge = await TessaBridge.create();
      const service = bridge.cardService;
      const methods = ['request', 'store', 'get', 'new', 'create', 'delete'].filter(name => typeof service?.[name] === 'function');
      recorder = {
        active: true,
        startedAt: nowIso(),
        bridge,
        records: [],
        truncatedCount: 0,
        maxRecords: 500,
        originals: new Map(),
        beforeMembership: nativeMembershipSnapshot(bridge),
        surface: buildNativeRuntimeSurfaceReport(bridge),
      };
      for (const name of methods) {
        const original = service[name];
        try {
          recorder.originals.set(name, original);
          service[name] = async function (...args) {
            const canCapture = recorder.records.length < recorder.maxRecords;
            const request = args[0];
            const entry = canCapture ? sanitizeNativeOperationRecord({
              at: nowIso(), method: name,
              requestType: request?.requestType || null,
              cardId: request?.cardId || request?.card?.id || null,
              info: safePlain(request?.info || {}, { maxDepth: 4, maxKeys: 200, maxArray: 100 }),
            }) : null;
            if (entry) recorder.records.push(entry);
            else recorder.truncatedCount++;
            try {
              const response = await original.apply(this, args);
              if (entry) {
                entry.outcome = 'resolved';
                entry.validationSuccessful = response?.validationResult?.isSuccessful ?? null;
                entry.responseCardId = response?.cardId || response?.card?.id || null;
                entry.responseCardVersion = response?.cardVersion ?? null;
              }
              return response;
            } catch (error) {
              if (entry) {
                entry.outcome = 'rejected';
                entry.error = String(error?.message || error).slice(0, 1000);
              }
              throw error;
            }
          };
          if (service[name] === original) throw new Error('method-not-writable');
        } catch (error) {
          try { service[name] = original; } catch (_) { /* best effort */ }
          recorder.originals.delete(name);
          recorder.records.push({ method: name, outcome: 'not-wrapped', error: String(error?.message || error).slice(0, 300) });
        }
      }
      APP.nativeRecorder = recorder;
      setProgress(100, 'Запись нативного действия включена', 'Выполните одно действие штатным интерфейсом TESSA, затем нажмите «Остановить и скачать».');
      const start = document.querySelector?.('#tms-native-record-start');
      const stop = document.querySelector?.('#tms-native-record-stop');
      if (start) start.disabled = true;
      if (stop) stop.disabled = false;
    } catch (error) {
      restoreNativeRecorderMethods(recorder);
      if (APP.nativeRecorder === recorder) APP.nativeRecorder = null;
      resetNativeRecorderControls();
      throw error;
    }
  }

  async function stopNativeOperationRecorder(download = true) {
    const recorder = APP.nativeRecorder;
    if (!recorder?.active) return null;
    recorder.active = false;
    let report = null;
    try {
      let afterMembership = [];
      let hasChanges = null;
      try {
        afterMembership = nativeMembershipSnapshot(recorder.bridge);
        hasChanges = await recorder.bridge?.editor?.cardModel?.hasChanges?.();
      } catch (_) { /* keep partial report */ }
      report = {
        format: 'TESSA_NATIVE_OPERATION_RECORD_V1',
        studioVersion: APP.version,
        startedAt: recorder.startedAt,
        finishedAt: nowIso(),
        beforeMembership: recorder.beforeMembership,
        afterMembership,
        cardHasChangesAfterAction: hasChanges,
        surface: recorder.surface,
        records: recorder.records,
        truncatedCount: Number(recorder.truncatedCount || 0),
        maxRecords: Number(recorder.maxRecords || 500),
      };
    } finally {
      const restoration = restoreNativeRecorderMethods(recorder);
      if (report) report.restoration = restoration;
      if (APP.nativeRecorder === recorder) APP.nativeRecorder = null;
      resetNativeRecorderControls();
    }
    // RESTORATION_BEFORE_DOWNLOAD_V1: the serialized evidence must contain cleanup status.
    if (download) downloadJson(report, \`TESSA_Native_Action_\${report.finishedAt.replace(/[:.]/g, '-')}.json\`, null);
    setProgress(100, 'Нативное действие записано', download ? 'Диагностический JSON скачан.' : 'Запись остановлена.');
    return report;
  }

`;
code = code.slice(0, start) + replacement + code.slice(end);

const oldExport = 'buildNativeRuntimeSurfaceReport, startNativeOperationRecorder, stopNativeOperationRecorder,';
const newExport = 'buildNativeRuntimeSurfaceReport, restoreNativeRecorderMethods, startNativeOperationRecorder, stopNativeOperationRecorder,';
if (code.includes(oldExport)) code = code.replace(oldExport, newExport);
else if (!code.includes(newExport)) throw new Error('native recorder export line not found');

const oldPagehide = "    window.addEventListener('pagehide', () => APP.runtimeMonitor?.stop());";
const newPagehide = `    window.addEventListener('pagehide', () => {
      restoreNativeRecorderMethods(APP.nativeRecorder);
      APP.nativeRecorder = null;
      APP.runtimeMonitor?.stop();
    });`;
if (code.includes(oldPagehide)) code = code.replace(oldPagehide, newPagehide);
else if (!code.includes(newPagehide)) throw new Error('pagehide cleanup hook not found');

fs.writeFileSync(file, code);
console.log('Applied v1.12.2 native recorder lifecycle hardening v2');
