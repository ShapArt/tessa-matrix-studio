import fs from 'node:fs';

const file = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label = before.slice(0, 80)) {
  const first = code.indexOf(before);
  if (first < 0) throw new Error(`pattern not found (${label})`);
  if (code.indexOf(before, first + before.length) >= 0) throw new Error(`pattern not unique (${label})`);
  code = code.slice(0, first) + after + code.slice(first + before.length);
}

function insertBefore(marker, text, label = marker.slice(0, 80)) {
  const index = code.indexOf(marker);
  if (index < 0) throw new Error(`insert marker not found (${label})`);
  code = code.slice(0, index) + text + code.slice(index);
}

// ---------------------------------------------------------------------------
// 1. Version/state
// ---------------------------------------------------------------------------
replaceOnce('// @version      1.12.1', '// @version      1.12.2', 'userscript version');
replaceOnce("    version: '1.12.1',", "    version: '1.12.2',", 'APP version');
replaceOnce(
  '    lastStudioDiagnostics: null,\n    dictionaryCatalog: null,',
  '    lastStudioDiagnostics: null,\n    nativeRecorder: null,\n    dictionaryCatalog: null,',
  'nativeRecorder state',
);

// ---------------------------------------------------------------------------
// 2. Pure runtime contract helpers + real matrix membership DELETE staging
// ---------------------------------------------------------------------------
insertBefore(
  '  class TessaBridge {',
`  function ownMethodNames(value) {
    const names = new Set();
    let cursor = value;
    for (let depth = 0; cursor && depth < 4; depth += 1) {
      for (const name of Object.getOwnPropertyNames(cursor)) {
        if (name === 'constructor') continue;
        try { if (typeof value?.[name] === 'function') names.add(name); } catch (_) { /* ignore getters */ }
      }
      cursor = Object.getPrototypeOf(cursor);
    }
    return [...names].sort();
  }

  function collectNativeRuntimeSurface(input = {}) {
    const controls = input.controls instanceof Map
      ? [...input.controls.entries()]
      : Array.isArray(input.controls)
        ? input.controls.map((value, index) => [String(index), value])
        : Object.entries(input.controls || {});
    return {
      format: 'TESSA_NATIVE_RUNTIME_SURFACE_V1',
      capturedAt: nowIso(),
      editorMethods: ownMethodNames(input.editor),
      cardModelMethods: ownMethodNames(input.cardModel),
      cardServiceMethods: ownMethodNames(input.cardService),
      controls: controls.map(([name, control]) => ({
        name: String(name),
        methods: ownMethodNames(control),
        componentMethods: ownMethodNames(control?.viewComponent || control?.component || null),
      })),
    };
  }

  function sanitizeNativeOperationValue(key, value, depth = 0) {
    if (depth > 5) return '[MAX_DEPTH]';
    if (value === null || value === undefined) return value ?? null;
    const keyText = String(key || '');
    if (typeof value === 'string') {
      const text = value.trim();
      const technicalKey = /(?:^|_)(?:id|rowid|versionid|cardid|matrixid|templateid|requesttype)$/i.test(keyText)
        || /(?:ID|RowID|VersionID|CardID|MatrixID|TemplateID|requestType)$/i.test(keyText);
      if (technicalKey && isGuidLike(text)) return text;
      if (keyText === 'method' || keyText === 'operation' || keyText === 'reason' || keyText === 'code') return text.slice(0, 300);
      return '[REDACTED]';
    }
    if (typeof value === 'number' || typeof value === 'bigint') return '[REDACTED]';
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) return value.slice(0, 200).map((item, index) => sanitizeNativeOperationValue(String(index), item, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [childKey, childValue] of Object.entries(value).slice(0, 300)) {
        out[childKey] = sanitizeNativeOperationValue(childKey, childValue, depth + 1);
      }
      return out;
    }
    return '[REDACTED]';
  }

  function sanitizeNativeOperationRecord(record = {}) {
    const out = {};
    for (const [key, value] of Object.entries(record || {})) out[key] = sanitizeNativeOperationValue(key, value);
    return out;
  }

  function classifyIntervalDiagnosticError(error) {
    const message = String(error?.message || error || '');
    const code = error?.code || (/LeftOperandExtractor is null/i.test(message) ? 'duplicate-interval-extractor' : 'diagnostic-check-failed');
    if (code === 'duplicate-interval-extractor') {
      return {
        code,
        capability: 'unsupported-server-contract',
        fatal: false,
        message: 'Сервер TESSA не смог построить LeftOperandExtractor для интервального операнда. Это ограничение/ошибка серверного контракта проверки дублей, а не ошибка Excel.',
      };
    }
    return { code, capability: 'unknown-error', fatal: true, message: friendlyErrorMessage(error) };
  }

  function stageMatrixRowDelete(versionId) {
    const section = this.section(this.mainCard, S.MatrixRows);
    const target = canonicalValue(versionId);
    if (!section?.rows || !target) throw new Error('Не удалось получить состав матрицы для удаления строки.');
    const matches = Array.from(section.rows).filter(row =>
      !this.isDeleted(row)
      && canonicalValue(this.rowValue(row, F.MatrixRowVersionID)) === target);
    if (matches.length !== 1) {
      throw new Error(matches.length
        ? \`Для MatrixVersionID \${versionId} найдено несколько строк состава матрицы. Удаление остановлено.\`
        : \`Строка состава матрицы для MatrixVersionID \${versionId} не найдена. Удаление остановлено.\`);
    }
    const row = matches[0];
    const sectionRowId = row?.rowId ? String(row.rowId) : null;
    row.state = this.CardRowState.Deleted;
    if (!this._ownedMatrixDeleteSectionRowIds) this._ownedMatrixDeleteSectionRowIds = new Set();
    if (sectionRowId) this._ownedMatrixDeleteSectionRowIds.add(canonicalValue(sectionRowId));
    return { staged: true, versionId: String(versionId), sectionRowId };
  }

`,
  'runtime/delete helpers',
);

// ---------------------------------------------------------------------------
// 3. Main matrix Store must carry real changed state. An empty forceTransaction
// request is rejected by CheckRequestStoreExtension in the live Cherkizovo runtime.
// ---------------------------------------------------------------------------
const oldSave = `    async saveMainMatrixAfterApply() {
      const hasEditorChanges = typeof this.editor?.cardModel?.hasChanges === 'function'
        ? await this.editor.cardModel.hasChanges()
        : false;
      if (hasEditorChanges) {
        throw new Error('Основная карточка матрицы получила несохранённые изменения во время Apply. Автосохранение остановлено, чтобы не перезаписать параллельную правку.');
      }
      if (!this.mainCard || typeof this.mainCard.clone !== 'function') {
        throw new Error('Не удалось подготовить основную карточку матрицы к сохранению.');
      }
      const card = this.mainCard.clone();
      if (typeof card.removeAllButChanged !== 'function') {
        throw new Error('Текущая версия TESSA не поддерживает безопасную подготовку карточки к сохранению.');
      }
      card.removeAllButChanged();
      card.clean?.();

      const req = new this.cards.CardStoreRequest();
      req.card = card;
      req.forceTransaction = true;
      const response = await this.cardService.store(req);
      const error = this.validationError(response, 'Не удалось сохранить основную карточку матрицы');
      if (error) throw error;
      return {
        ok: true,
        skipped: false,
        method: 'force-transaction-store',
        cardId: String(response?.cardId || this.mainCard.id || ''),
        cardVersion: response?.cardVersion ?? null,
      };
    }`;

const newSave = `    async saveMainMatrixAfterApply(options = {}) {
      const hasEditorChanges = typeof this.editor?.cardModel?.hasChanges === 'function'
        ? await this.editor.cardModel.hasChanges()
        : Boolean(this._ownedMatrixDeleteSectionRowIds?.size);
      const ownedChanges = Boolean(this._ownedMatrixDeleteSectionRowIds?.size || options.allowOwnedChanges);
      if (!hasEditorChanges) {
        return { ok: false, skipped: true, reason: 'no-main-card-changes', method: null };
      }
      if (!ownedChanges) {
        throw new Error('Основная карточка матрицы получила несохранённые изменения, не созданные текущим Apply. Автосохранение остановлено, чтобы не перезаписать параллельную правку.');
      }
      if (!this.mainCard || typeof this.mainCard.clone !== 'function') {
        throw new Error('Не удалось подготовить основную карточку матрицы к сохранению.');
      }
      const card = this.mainCard.clone();
      if (typeof card.removeAllButChanged !== 'function') {
        throw new Error('Текущая версия TESSA не поддерживает безопасную подготовку карточки к сохранению.');
      }
      // Preserve row .state/.changed markers. Calling clean() here destroys the
      // very membership transition the Store request must persist.
      card.removeAllButChanged();

      const req = new this.cards.CardStoreRequest();
      req.card = card;
      if ('affectVersion' in req) req.affectVersion = true;
      const response = await this.cardService.store(req);
      const error = this.validationError(response, 'Не удалось сохранить основную карточку матрицы');
      if (error) throw error;
      this._ownedMatrixDeleteSectionRowIds?.clear?.();
      return {
        ok: true,
        skipped: false,
        method: 'changed-card-store',
        cardId: String(response?.cardId || this.mainCard.id || ''),
        cardVersion: response?.cardVersion ?? null,
      };
    }`;
replaceOnce(oldSave, newSave, 'saveMainMatrixAfterApply');

const oldDelete = `    async deleteMatrixRow(versionId) {
      const req = new this.cards.CardRequest();
      req.requestType = REQUEST.DeleteRow;
      req.cardId = this.mainCard.id;
      req.info.MatrixRowVersionID = this.TypedField.createGuid(versionId);
      const response = await this.cardService.request(req);
      const error = this.validationError(response, \`Не удалось удалить строку \${versionId}\`);
      if (error) throw error;
      return response;
    }`;
const newDelete = `    async deleteMatrixRow(versionId) {
      // Native matrix membership is a collection row on the main card. Stage that
      // row as Deleted and let the ordinary changed-card Store persist the deletion.
      // RowID/RowRowID are never treated as CardID.
      return stageMatrixRowDelete.call(this, versionId);
    }`;
replaceOnce(oldDelete, newDelete, 'deleteMatrixRow');

// Main-card persistence must run for successfully remote-stored UPDATE/ADD and for
// staged DELETE. If only UPDATE/ADD happened and the main card is unchanged, save() safely skips.
replaceOnce(
  "    const acceptedCount = (result?.rows || []).filter(row => row?.status === 'ok').length;",
  "    const acceptedCount = (result?.rows || []).filter(row => row?.status === 'ok' || row?.status === 'staged').length;",
  'persist accepted/staged count',
);

// DELETE is not accepted until the main-card membership Store succeeds.
replaceOnce(
`        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'ok' });`,
`        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'staged' });`,
  'delete staged status',
);

replaceOnce(
`    result.matrixSave = await persistMainMatrixAfterApply(bridge, result);
    if (result.matrixSave.ok) {
      log('Основная карточка матрицы сохранена после применения.');
    } else if (!result.matrixSave.skipped) {
      log(\`Строки записаны, но основную карточку матрицы не удалось сохранить автоматически: \${result.matrixSave.error || result.matrixSave.reason}.\`, 'warn');
    }

    result.viewRefresh = { ok: false, skipped: true, reason: 'not-attempted' };`,
`    result.matrixSave = await persistMainMatrixAfterApply(bridge, result);
    const stagedDeletes = result.rows.filter(row => row.type === 'delete' && row.status === 'staged');
    if (stagedDeletes.length) {
      if (result.matrixSave.ok) {
        stagedDeletes.forEach(row => { row.status = 'ok'; });
      } else {
        const reason = result.matrixSave.error || result.matrixSave.reason || 'Основная карточка матрицы не сохранена.';
        stagedDeletes.forEach(row => { row.status = 'skipped'; row.reason = reason; });
        for (let index = receipts.length - 1; index >= 0; index -= 1) {
          if (receipts[index]?.type === 'delete') receipts.splice(index, 1);
        }
        for (const prepared of readyDeletes) {
          result.skipped.push(makeSkippedRow(null, reason, 'store-delete-membership', 'delete'));
        }
      }
    }
    if (result.matrixSave.ok) {
      log('Основная карточка матрицы сохранена после применения.');
    } else if (!result.matrixSave.skipped) {
      log(\`Строки записаны, но основную карточку матрицы не удалось сохранить автоматически: \${result.matrixSave.error || result.matrixSave.reason}.\`, 'warn');
    }

    result.viewRefresh = { ok: false, skipped: true, reason: 'not-attempted' };`,
  'post-save DELETE accounting',
);

// ---------------------------------------------------------------------------
// 4. Result copy: accepted by server != verified by readback
// ---------------------------------------------------------------------------
insertBefore(
  '  function renderPlanConsumedNotice(result) {',
`  function applyResultSummary(result) {
    const applied = Math.max(0, Number(result?.appliedCount || 0));
    const accepted = Math.max(applied, Number(result?.acceptedCount || 0));
    const requested = Math.max(accepted, Number(result?.requestedCount || result?.plannedCount || accepted));
    const verified = Math.max(0, Number(result?.verifiedCount ?? result?.reconciliation?.verifiedCount ?? 0));
    const divergent = Math.max(0, Number(result?.reconciliation?.divergentCount || 0) + Number(result?.reconciliation?.missingCount || 0));
    const unknown = Math.max(0, Number(result?.reconciliation?.unknownCount || 0));
    let title;
    if (result?.reconciliation?.status === 'divergent') {
      title = \`Сервер принял \${accepted} из \${requested}; повторно подтверждено \${verified}; расхождений \${divergent}.\`;
    } else if (result?.reconciliation?.status === 'incomplete') {
      title = \`Сервер принял \${accepted} из \${requested}; повторно подтверждено \${verified}; неизвестно \${unknown}.\`;
    } else if (result?.reconciliation?.status === 'verified') {
      title = \`Сервер принял и повторно подтвердил \${verified} из \${requested} операций.\`;
    } else if (result?.cancelled) {
      title = \`Применение остановлено: сервер принял \${accepted} из \${requested}.\`;
    } else {
      title = \`Сервер принял \${accepted} из \${requested} операций.\`;
    }
    return { title, accepted, requested, verified, divergent, unknown };
  }

`,
  'apply result summary helper',
);

replaceOnce(
`    const completed = result?.status === 'completed' && result?.success === true;
    const title = result?.verificationIncomplete && result?.reconciliation
      ? \`Запись подтверждена для \${applied} из \${requested} операций. Остальные требуют проверки.\`
      : completed
      ? \`Изменения применены: \${applied} из \${requested}.\`
      : result?.cancelled
        ? \`Применение остановлено: применено \${applied}.\`
        : \`Применение завершено частично: применено \${applied} из \${requested}.\`;`,
`    const completed = result?.status === 'completed' && result?.success === true;
    const title = result?.reconciliation
      ? applyResultSummary(result).title
      : completed
        ? \`Изменения применены: \${applied} из \${requested}.\`
        : result?.cancelled
          ? \`Применение остановлено: применено \${applied}.\`
          : \`Применение завершено частично: применено \${applied} из \${requested}.\`;`,
  'renderPlanConsumedNotice title',
);

// ---------------------------------------------------------------------------
// 5. Interval diagnostic: known server extractor bug is capability evidence,
// not a generic fatal diagnostics failure.
// ---------------------------------------------------------------------------
replaceOnce(
`      } catch (error) {
        sample.outcome = sample.requestSent ? 'rejected' : 'not-sent';
        sample.code = error.code || 'diagnostic-check-failed';
        sample.message = String(error.message || error).slice(0, 20000);
      }`,
`      } catch (error) {
        sample.outcome = sample.requestSent ? 'rejected' : 'not-sent';
        const classified = classifyIntervalDiagnosticError(error);
        sample.code = classified.code;
        sample.capability = classified.capability;
        sample.fatal = classified.fatal;
        sample.message = String(error.message || error).slice(0, 20000);
      }`,
  'interval probe classification',
);

// The general duplicate-control check is allowed to report this known server defect
// as unsupported instead of failing the whole diagnostic suite.
replaceOnce(
`      try { await bridge.validateDuplicate(created.card, created.versionId); }
      catch (error) { if (error.code === 'duplicate-found') return { detail: 'Сервер обнаружил дубль. Копия не сохранялась.' }; throw error; }
      throw new Error('Сервер разрешил точную копию. Нужно проверить правило поиска дубликатов. Копия не сохранялась.');`,
`      try { await bridge.validateDuplicate(created.card, created.versionId); }
      catch (error) {
        if (error.code === 'duplicate-found') return { detail: 'Сервер обнаружил дубль. Копия не сохранялась.' };
        const classified = classifyIntervalDiagnosticError(error);
        if (!classified.fatal) return { detail: classified.message, capability: classified.capability, warning: true };
        throw error;
      }
      throw new Error('Сервер разрешил точную копию. Нужно проверить правило поиска дубликатов. Копия не сохранялась.');`,
  'studio duplicate-control capability',
);

// ---------------------------------------------------------------------------
// 6. Opt-in native runtime surface + operation recorder
// ---------------------------------------------------------------------------
insertBefore(
  '  function reconciliationSummary(result) {',
`  function nativeMembershipSnapshot(bridge) {
    return (bridge?.rawMatrixSectionLinks?.() || []).map(item => ({
      index: Number(item.index || 0),
      sectionRowId: item.cardRowId || null,
      rowID: item.rowID || null,
      rowRowID: item.rowRowID || null,
    }));
  }

  function buildNativeRuntimeSurfaceReport(bridge) {
    return {
      ...collectNativeRuntimeSurface({
        editor: bridge?.editor,
        cardModel: bridge?.editor?.cardModel,
        controls: new Map(bridge?.controlEntries?.() || []),
        cardService: bridge?.cardService,
      }),
      studioVersion: APP.version,
      matrixId: String(bridge?.mainCard?.id || ''),
      templateId: String(bridge?.templateId?.() || ''),
      membership: nativeMembershipSnapshot(bridge),
    };
  }

  async function downloadNativeRuntimeSurface() {
    if (APP.busy) return;
    setBusy(true);
    try {
      const bridge = await TessaBridge.create();
      const report = buildNativeRuntimeSurfaceReport(bridge);
      downloadJson(report, \`TESSA_Native_Runtime_Surface_\${new Date().toISOString().replace(/[:.]/g, '-')} .json\`.replace(' .json', '.json'), null);
      setProgress(100, 'Интерфейс TESSA выгружен', 'Методы runtime и техническая структура матрицы сохранены без бизнес-значений.');
    } catch (error) {
      setProgress(100, 'Не удалось снять интерфейс TESSA', friendlyErrorMessage(error));
    } finally { setBusy(false); }
  }

  async function startNativeOperationRecorder() {
    if (APP.busy || APP.nativeRecorder?.active) return;
    const bridge = await TessaBridge.create();
    const service = bridge.cardService;
    const methods = ['request', 'store', 'get', 'new', 'create', 'delete'].filter(name => typeof service?.[name] === 'function');
    const recorder = {
      active: true,
      startedAt: nowIso(),
      bridge,
      records: [],
      originals: new Map(),
      beforeMembership: nativeMembershipSnapshot(bridge),
      surface: buildNativeRuntimeSurfaceReport(bridge),
    };
    for (const name of methods) {
      const original = service[name];
      try {
        recorder.originals.set(name, original);
        service[name] = async function (...args) {
          const request = args[0];
          const entry = sanitizeNativeOperationRecord({
            at: nowIso(), method: name,
            requestType: request?.requestType || null,
            cardId: request?.cardId || request?.card?.id || null,
            info: safePlain(request?.info || {}, { maxDepth: 4, maxKeys: 200, maxArray: 100 }),
          });
          recorder.records.push(entry);
          try {
            const response = await original.apply(this, args);
            entry.outcome = 'resolved';
            entry.validationSuccessful = response?.validationResult?.isSuccessful ?? null;
            entry.responseCardId = response?.cardId || response?.card?.id || null;
            entry.responseCardVersion = response?.cardVersion ?? null;
            return response;
          } catch (error) {
            entry.outcome = 'rejected';
            entry.error = String(error?.message || error).slice(0, 1000);
            throw error;
          }
        };
        if (service[name] === original) throw new Error('method-not-writable');
      } catch (error) {
        try { service[name] = original; } catch (_) { /* best effort */ }
        recorder.records.push({ method: name, outcome: 'not-wrapped', error: String(error?.message || error).slice(0, 300) });
      }
    }
    APP.nativeRecorder = recorder;
    setProgress(100, 'Запись нативного действия включена', 'Выполните одно действие штатным интерфейсом TESSA, затем нажмите «Остановить и скачать».');
    const start = document.querySelector?.('#tms-native-record-start');
    const stop = document.querySelector?.('#tms-native-record-stop');
    if (start) start.disabled = true;
    if (stop) stop.disabled = false;
  }

  async function stopNativeOperationRecorder(download = true) {
    const recorder = APP.nativeRecorder;
    if (!recorder?.active) return null;
    recorder.active = false;
    const service = recorder.bridge?.cardService;
    for (const [name, original] of recorder.originals || []) {
      try { service[name] = original; } catch (_) { /* restore best effort */ }
    }
    let afterMembership = [];
    let hasChanges = null;
    try {
      afterMembership = nativeMembershipSnapshot(recorder.bridge);
      hasChanges = await recorder.bridge?.editor?.cardModel?.hasChanges?.();
    } catch (_) { /* keep partial report */ }
    const report = {
      format: 'TESSA_NATIVE_OPERATION_RECORD_V1',
      studioVersion: APP.version,
      startedAt: recorder.startedAt,
      finishedAt: nowIso(),
      beforeMembership: recorder.beforeMembership,
      afterMembership,
      cardHasChangesAfterAction: hasChanges,
      surface: recorder.surface,
      records: recorder.records,
    };
    APP.nativeRecorder = null;
    const start = document.querySelector?.('#tms-native-record-start');
    const stop = document.querySelector?.('#tms-native-record-stop');
    if (start) start.disabled = false;
    if (stop) stop.disabled = true;
    if (download) downloadJson(report, \`TESSA_Native_Action_\${report.finishedAt.replace(/[:.]/g, '-')}.json\`, null);
    setProgress(100, 'Нативное действие записано', download ? 'Диагностический JSON скачан.' : 'Запись остановлена.');
    return report;
  }

`,
  'native runtime recorder UI functions',
);

replaceOnce(
`              <div class=\"tms-row\"><button id=\"tms-run-tests\" type=\"button\">Запустить проверки</button><button id=\"tms-download-diagnostics\" type=\"button\">Скачать пакет диагностики</button></div>
              <details><summary>Проверка с записью</summary>`,
`              <div class=\"tms-row\"><button id=\"tms-run-tests\" type=\"button\">Запустить проверки</button><button id=\"tms-download-diagnostics\" type=\"button\">Скачать пакет диагностики</button></div>
              <details><summary>Нативный интерфейс TESSA</summary><p>Снимает технический состав методов/контролов без бизнес-значений. Режим записи позволяет выполнить штатное действие TESSA (например, удалить строку правой кнопкой и сохранить) и скачать фактические вызовы CardService и изменение состава матрицы.</p><div class=\"tms-row\"><button id=\"tms-native-surface\" type=\"button\">Снять интерфейс TESSA</button><button id=\"tms-native-record-start\" type=\"button\">Начать запись нативного действия</button><button id=\"tms-native-record-stop\" type=\"button\" disabled>Остановить и скачать</button></div></details>
              <details><summary>Проверка с записью</summary>`,
  'native recorder controls HTML',
);

replaceOnce(
`    panel.querySelector('#tms-run-tests').addEventListener('click', () => runStudioDiagnostics());
    panel.querySelector('#tms-download-diagnostics').addEventListener('click', () => runStudioDiagnostics(true));`,
`    panel.querySelector('#tms-run-tests').addEventListener('click', () => runStudioDiagnostics());
    panel.querySelector('#tms-download-diagnostics').addEventListener('click', () => runStudioDiagnostics(true));
    panel.querySelector('#tms-native-surface').addEventListener('click', () => downloadNativeRuntimeSurface());
    panel.querySelector('#tms-native-record-start').addEventListener('click', () => startNativeOperationRecorder());
    panel.querySelector('#tms-native-record-stop').addEventListener('click', () => stopNativeOperationRecorder(true));`,
  'native recorder handlers',
);

// ---------------------------------------------------------------------------
// 7. Test exports
// ---------------------------------------------------------------------------
replaceOnce(
`    applyIntervalStructuralProbe, applyCardNewTopologyProbe, applyCardNewEnvelopeProbe, summarizeCardIdentityTopology, collectIntervalDiagnostics, buildIntervalDiagnosticSummary, resolveStudioIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,`,
`    applyIntervalStructuralProbe, applyCardNewTopologyProbe, applyCardNewEnvelopeProbe, summarizeCardIdentityTopology, collectIntervalDiagnostics, buildIntervalDiagnosticSummary, resolveStudioIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,
    classifyIntervalDiagnosticError, collectNativeRuntimeSurface, sanitizeNativeOperationRecord, stageMatrixRowDelete, applyResultSummary, buildNativeRuntimeSurfaceReport, startNativeOperationRecorder, stopNativeOperationRecorder,`,
  'exports',
);

fs.writeFileSync(file, code);
console.log('Applied v1.12.2 runtime contract hardening');
