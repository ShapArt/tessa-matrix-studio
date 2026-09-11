(() => {
  'use strict';

  const INSTALL_KEY = '__TMS_FULL_UAT_V1__';
  if (window[INSTALL_KEY]) return;
  const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
  if (!E) return;

  const VERSION = '1.0.0';
  const utf8 = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const now = () => new Date().toISOString();
  const canon = value => E.canonicalValue ? E.canonicalValue(value || '') : String(value || '').trim().toLowerCase();

  function seededRandom(seed) {
    let state = (Number(seed) >>> 0) || 0x9E3779B9;
    return () => {
      state ^= state << 13; state >>>= 0;
      state ^= state >>> 17; state >>>= 0;
      state ^= state << 5; state >>>= 0;
      return (state >>> 0) / 0x100000000;
    };
  }

  function hashSeed(text) {
    let h = 2166136261 >>> 0;
    for (const ch of String(text || '')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  function cloneWorkbook(book) {
    return { ...book, rows: (book.rows || []).map(row => ({ ...row, values: [...(row.values || [])] })) };
  }

  function snapshotSignature(snapshot) {
    return (snapshot?.rows || []).map(row => `${canon(row.rowCardId)}|${canon(row.fingerprint || E.fingerprintFlat(row.flat || {}))}`).sort();
  }

  function sameArray(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }

  function directTokenIndexes(book) {
    const out = [];
    (book.schemaTokens || []).forEach((token, index) => {
      if (/^(criterion|function):/.test(String(token || ''))) out.push(index);
    });
    return out;
  }

  function tokenIndex(book, token) { return (book.schemaTokens || []).indexOf(token); }
  function companionIndex(book, key) { return tokenIndex(book, `companion:${key}`); }
  function maxExcelRow(book) { return Math.max(Number(book.headerRow || 14), ...(book.rows || []).map(row => Number(row.excelRow || 0))); }

  function rowHasRole(book, row) {
    return (book.schemaTokens || []).some((token, index) => String(token || '').startsWith('function:') && String(row.values?.[index] || '').trim());
  }

  function rowIdentity(book, row) {
    const card = tokenIndex(book, 'system:rowCardId');
    const version = tokenIndex(book, 'system:versionId');
    return {
      rowCardId: card >= 0 ? String(row.values?.[card] || '') : '',
      versionId: version >= 0 ? String(row.values?.[version] || '') : '',
    };
  }

  function clearSystemIdentity(book, row, action = 'add') {
    for (const token of ['system:rowCardId', 'system:versionId', 'system:baseFingerprint']) {
      const index = tokenIndex(book, token); if (index >= 0) row.values[index] = '';
    }
    const actionIndex = tokenIndex(book, 'system:action');
    if (actionIndex >= 0) row.values[actionIndex] = action;
    return row;
  }

  function authoritativeEntries(catalog, key) {
    const id = catalog?.columnCatalogIds?.[key];
    const entries = id ? catalog?.catalogs?.[id]?.entries || [] : [];
    return entries.filter(entry => {
      if (!String(entry?.id || '').trim()) return false;
      if (!String(entry?.selector || entry?.display || '').trim()) return false;
      if (canon(entry?.status) === canon('Текущее значение')) return false;
      return true;
    });
  }

  function setDictionaryValue(book, row, key, entry, keepCompanion = false) {
    const index = tokenIndex(book, key);
    if (index < 0) throw new Error(`Не найден столбец ${key}`);
    row.values[index] = String(entry.selector || entry.display || '');
    const idIndex = companionIndex(book, key);
    if (idIndex >= 0 && !keepCompanion) {
      const raw = String(entry.id || '');
      row.values[idIndex] = String(key).startsWith('function:') && entry.roleTypeId !== '' && entry.roleTypeId !== null && entry.roleTypeId !== undefined
        ? `${raw}|${entry.roleTypeId}` : raw;
    }
    return row;
  }

  function mutableCriterionColumns(book, catalog, minimum = 2) {
    return (book.schemaTokens || []).map((key, index) => ({ key, index, entries: String(key || '').startsWith('criterion:') ? authoritativeEntries(catalog, key) : [] }))
      .filter(item => item.entries.length >= minimum);
  }

  function shuffled(array, rng) {
    const out = [...array];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function compactPlan(plan) {
    return {
      counts: plan?.counts || null,
      warnings: plan?.warnings || [],
      issues: plan?.issues || [],
      skippedRows: (plan?.skippedRows || []).slice(0, 30),
      skippedFields: (plan?.skippedFields || []).slice(0, 30),
      safety: plan?.safety ? { blocked: Boolean(plan.safety.blocked), blockedReasons: plan.safety.blockedReasons || [] } : null,
    };
  }

  function applySafety(plan, bridge) {
    plan.safety = E.evaluatePlanSafety(plan, bridge);
    plan.matrixInfo = plan.safety?.matrixInfo || bridge.matrixInfo();
    return plan;
  }

  async function workbookFromSnapshot(structure, snapshot, bridge, catalog) {
    const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, bridge.matrixInfo(), catalog, { includeActions: true });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const book = await E.readXlsxArrayBuffer(buffer, 'TESSA_UAT_CURRENT.xlsx');
    return { bytes, book };
  }

  function chooseSourceRow(book, rng) {
    const candidates = (book.rows || []).filter(row => rowHasRole(book, row));
    if (!candidates.length) throw new Error('В матрице нет строки с исполнителем, которую можно безопасно использовать как шаблон временной строки.');
    return candidates[Math.floor(rng() * candidates.length)];
  }

  function findUniqueAddCandidate(book, structure, snapshot, bridge, catalog, rng, options = {}) {
    const source = options.source || chooseSourceRow(book, rng);
    const columns = shuffled(mutableCriterionColumns(book, catalog, 2), rng);
    if (!columns.length) throw new Error('Не найден справочник критерия минимум с двумя актуальными значениями.');
    const startRow = maxExcelRow(book) + Math.max(1, Number(options.gap || 1));
    for (const column of columns) {
      const current = canon(source.values?.[column.index] || '');
      const entries = shuffled(column.entries.filter(entry => canon(entry.selector || entry.display) !== current), rng).slice(0, 40);
      for (const entry of entries) {
        const candidateBook = cloneWorkbook(book);
        const candidate = { ...source, excelRow: startRow, values: [...source.values] };
        clearSystemIdentity(candidateBook, candidate, 'add');
        setDictionaryValue(candidateBook, candidate, column.key, entry);
        candidateBook.rows.push(candidate);
        const plan = E.buildPlan(candidateBook, structure, snapshot, bridge.matrixInfo());
        if ((plan.counts?.add || 0) === 1 && (plan.counts?.skip || 0) === 0 && (plan.counts?.update || 0) === 0 && (plan.counts?.delete || 0) === 0) {
          return { book: candidateBook, row: candidate, column, entry, plan };
        }
      }
    }
    throw new Error('Не удалось подобрать уникальную временную строку из актуальных справочников без конфликтов.');
  }

  function findRowByCard(book, rowCardId) {
    const cardIndex = tokenIndex(book, 'system:rowCardId');
    if (cardIndex < 0) return null;
    return (book.rows || []).find(row => canon(row.values?.[cardIndex]) === canon(rowCardId)) || null;
  }

  async function runFullUat(options = {}) {
    const startedAt = now();
    const seed = Number.isFinite(Number(options.seed)) ? Number(options.seed) >>> 0 : hashSeed(`${Date.now()}|${location?.href || ''}`);
    const rng = seededRandom(seed);
    const report = {
      format: 'TESSA_FULL_UAT_V1', studioVersion: '1.13.0', runnerVersion: VERSION, seed, startedAt,
      status: 'INCOMPLETE', matrix: null, checks: [], timeline: [], cleanup: [], dictionaryAudit: null,
      rolePresentationAudit: null, recordKeepingAudit: null, writesAttempted: 0, writesCompleted: 0,
    };
    const packageEntries = [];
    let baseline = null, structure = null, catalog = null, bridge = null, baselineSignature = null;
    let cleanupUnsafe = false;
    const timeline = (stage, detail, extra = null) => report.timeline.push({ at: now(), stage, detail, ...(extra ? { extra } : {}) });
    const addCheck = (id, title, status, detail, extra = {}) => {
      const item = { id, title, status, detail, ...extra }; report.checks.push(item); timeline(id, `${status}: ${detail}`); return item;
    };
    const runCheck = async (id, title, fn, required = true) => {
      try {
        const value = await fn(); const status = value?.status || 'PASS'; const detail = value?.detail || 'Проверка пройдена.';
        return addCheck(id, title, status, detail, { required, ...(value?.data !== undefined ? { data: value.data } : {}) });
      } catch (error) {
        return addCheck(id, title, 'FAIL', String(error?.message || error), { required, errorClass: error?.name || 'Error' });
      }
    };
    async function freshSnapshot() {
      const freshBridge = await E.TessaBridge.create();
      if (canon(freshBridge.matrixInfo().matrixId) !== canon(report.matrix?.matrixId)) throw new Error('Во время UAT открыта другая матрица.');
      return { bridge: freshBridge, snapshot: await freshBridge.loadSnapshot(structure) };
    }
    async function applySingle(plan, label) {
      applySafety(plan, bridge);
      if (plan.safety?.blocked) throw new Error(plan.safety.blockedReasons?.join(' ') || `${label}: Apply заблокирован.`);
      const executable = (plan.actions || []).filter(action => action.type !== 'noop');
      if (executable.length !== 1) throw new Error(`${label}: ожидалась 1 операция, получено ${executable.length}.`);
      report.writesAttempted += 1;
      const result = await E.applyPlan(plan);
      if (!result) throw new Error(`${label}: применение отменено.`);
      report.writesCompleted += 1;
      return result;
    }
    async function cleanupCreatedRow(rowCardId, scenarioId) {
      try {
        const current = await freshSnapshot();
        const target = current.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
        if (!target) { report.cleanup.push({ scenarioId, rowCardId, status: 'already-absent', at: now() }); return true; }
        const currentCatalog = await current.bridge.loadDictionaryCatalog(structure, current.snapshot, { forceRefresh: true, transient: true });
        const { book } = await workbookFromSnapshot(structure, current.snapshot, current.bridge, currentCatalog);
        const cardIndex = tokenIndex(book, 'system:rowCardId');
        book.rows = book.rows.filter(row => canon(row.values?.[cardIndex]) !== canon(rowCardId));
        let plan = E.buildPlan(book, structure, current.snapshot, current.bridge.matrixInfo()); plan = applySafety(plan, current.bridge);
        const deletes = plan.actions.filter(action => action.type === 'delete' && canon(action.currentRow?.rowCardId) === canon(rowCardId));
        if (deletes.length !== 1 || plan.actions.filter(action => action.type !== 'noop').length !== 1) throw new Error(`Cleanup не построил единственный DELETE временной строки: ${JSON.stringify(plan.counts)}.`);
        bridge = current.bridge; const result = await applySingle(plan, `${scenarioId}: cleanup DELETE`);
        const verified = await freshSnapshot();
        if (verified.snapshot.rows.some(row => canon(row.rowCardId) === canon(rowCardId))) throw new Error('Временная строка осталась после DELETE/read-back.');
        report.cleanup.push({ scenarioId, rowCardId, status: 'verified', at: now(), result: E.safePlain(result, { maxDepth: 5, maxKeys: 200, maxArray: 100 }) });
        return true;
      } catch (error) {
        cleanupUnsafe = true; report.cleanup.push({ scenarioId, rowCardId, status: 'FAILED', at: now(), error: String(error?.message || error) }); return false;
      }
    }
    async function createTemporaryRow(scenarioId) {
      const current = await freshSnapshot(); bridge = current.bridge;
      const currentCatalog = await bridge.loadDictionaryCatalog(structure, current.snapshot, { forceRefresh: true, transient: true });
      const { book } = await workbookFromSnapshot(structure, current.snapshot, bridge, currentCatalog);
      const candidate = findUniqueAddCandidate(book, structure, current.snapshot, bridge, currentCatalog, rng, { gap: 3 });
      let plan = applySafety(candidate.plan, bridge); const beforeIds = new Set(current.snapshot.rows.map(row => canon(row.rowCardId)));
      const result = await applySingle(plan, `${scenarioId}: ADD`); const after = await freshSnapshot();
      const created = after.snapshot.rows.filter(row => !beforeIds.has(canon(row.rowCardId)));
      if (created.length !== 1) throw new Error(`После ADD ожидалась 1 новая строка, найдено ${created.length}.`);
      return { created: created[0], after: after.snapshot, bridge: after.bridge, catalog: currentCatalog, candidate, result };
    }

    try {
      timeline('start', `Full UAT seed=${seed}`);
      bridge = await E.TessaBridge.create(); E.assertWritableMatrixDraft(bridge); E.assertNativeEditMode();
      structure = await bridge.requestStructure(bridge.templateId()); baseline = await bridge.loadSnapshot(structure); baselineSignature = snapshotSignature(baseline);
      catalog = await bridge.loadDictionaryCatalog(structure, baseline, { forceRefresh: true, transient: true });
      const info = bridge.matrixInfo(); report.matrix = { matrixId: info.matrixId, templateId: info.TemplateID, name: info.TemplateName, state: info.StateName, rows: baseline.rows.length };
      const base = await workbookFromSnapshot(structure, baseline, bridge, catalog); packageEntries.push(['matrix-current.xlsx', base.bytes]);

      await runCheck('runtime', 'Контекст и доступ на запись', async () => ({ detail: `Черновик «${info.TemplateName}», строк: ${baseline.rows.length}.` }));
      await runCheck('roundtrip', 'Выгрузка → обратное чтение', async () => {
        const plan = E.buildPlan(base.book, structure, baseline, info);
        if (plan.counts.skip || plan.counts.add || plan.counts.update || plan.counts.delete) throw new Error(`Roundtrip дал изменения: ${JSON.stringify(plan.counts)}`);
        return { detail: `${baseline.rows.length} строк вернулись без изменений.`, data: compactPlan(plan) };
      });
      await runCheck('row-physical-delete', 'Физическое удаление строки Excel', async () => {
        if (!base.book.rows.length) return { status: 'NOT_RUN', detail: 'В матрице нет строк.' };
        const test = cloneWorkbook(base.book); const index = Math.floor(rng() * test.rows.length); const target = test.rows[index]; const identity = rowIdentity(test, target); test.rows.splice(index, 1);
        const plan = E.buildPlan(test, structure, baseline, info);
        if (!plan.actions.find(action => action.type === 'delete' && canon(action.currentRow?.rowCardId) === canon(identity.rowCardId))) throw new Error(`DELETE не распознан: ${JSON.stringify(compactPlan(plan))}`);
        return { detail: `Строка ${target.excelRow} распознана как DELETE.` };
      });
      await runCheck('row-clear-visible', 'Очистка всех рабочих ячеек строки', async () => {
        if (!base.book.rows.length) return { status: 'NOT_RUN', detail: 'В матрице нет строк.' };
        const test = cloneWorkbook(base.book); const row = test.rows[Math.floor(rng() * test.rows.length)]; const identity = rowIdentity(test, row); for (const index of directTokenIndexes(test)) row.values[index] = '';
        const plan = E.buildPlan(test, structure, baseline, info);
        if (!plan.actions.some(action => action.type === 'delete' && canon(action.currentRow?.rowCardId) === canon(identity.rowCardId))) throw new Error(`Очистка не стала DELETE: ${JSON.stringify(compactPlan(plan))}`);
        return { detail: `Очистка строки ${row.excelRow} распознана как DELETE.` };
      });
      await runCheck('row-clear-all', 'Полная очистка строки вместе со скрытыми ID', async () => {
        if (!base.book.rows.length) return { status: 'NOT_RUN', detail: 'В матрице нет строк.' };
        const test = cloneWorkbook(base.book); const index = Math.floor(rng() * test.rows.length); const target = test.rows[index]; const identity = rowIdentity(test, target); target.values.fill('');
        const plan = E.buildPlan(test, structure, baseline, info);
        if (!plan.actions.some(action => action.type === 'delete' && canon(action.currentRow?.rowCardId) === canon(identity.rowCardId))) throw new Error(`Полная очистка не стала DELETE: ${JSON.stringify(compactPlan(plan))}`);
        return { detail: `Строка ${target.excelRow} удаляется даже после очистки скрытых ID.` };
      });
      await runCheck('row-gap-add', 'Новая строка после пустого промежутка', async () => {
        const candidate = findUniqueAddCandidate(base.book, structure, baseline, bridge, catalog, rng, { gap: 7 });
        if (candidate.plan.counts.add !== 1 || candidate.plan.counts.skip) throw new Error(JSON.stringify(compactPlan(candidate.plan)));
        return { detail: `Excel ${candidate.row.excelRow}: распознано ADD после пустого промежутка.` };
      });
      await runCheck('row-copied-identities', 'Изменённые копии строки с одинаковыми скрытыми ID', async () => {
        if (base.book.rows.length < 3) return { status: 'NOT_RUN', detail: 'Нужно минимум 3 исходные строки.' };
        const columns = mutableCriterionColumns(base.book, catalog, 5); if (!columns.length) return { status: 'NOT_RUN', detail: 'Нет критерия минимум с 5 значениями.' };
        const column = shuffled(columns, rng)[0], source = chooseSourceRow(base.book, rng), sourceIdentity = rowIdentity(base.book, source);
        const remove = base.book.rows.filter(row => canon(rowIdentity(base.book, row).rowCardId) !== canon(sourceIdentity.rowCardId)).slice(0, 2);
        const removedIds = new Set(remove.map(row => canon(rowIdentity(base.book, row).rowCardId))); const test = cloneWorkbook(base.book);
        test.rows = test.rows.filter(row => !removedIds.has(canon(rowIdentity(test, row).rowCardId)) && canon(rowIdentity(test, row).rowCardId) !== canon(sourceIdentity.rowCardId));
        const entries = shuffled(column.entries.filter(entry => canon(entry.selector || entry.display) !== canon(source.values[column.index])), rng).slice(0, 4); const start = maxExcelRow(base.book) + 1;
        entries.forEach((entry, index) => { const copy = { ...source, excelRow: start + index * 2, values: [...source.values] }; setDictionaryValue(test, copy, column.key, entry); test.rows.push(copy); });
        const plan = E.buildPlan(test, structure, baseline, info);
        if (plan.counts.skip !== 0 || plan.counts.add !== 3 || plan.counts.update !== 1 || plan.counts.delete !== 2) throw new Error(`Ожидалось UPDATE 1 / ADD 3 / DELETE 2 / SKIP 0; получено ${JSON.stringify(plan.counts)}. ${JSON.stringify(plan.skippedRows || [])}`);
        return { detail: 'Одна копия стала UPDATE, остальные три — ADD; два отсутствующих оригинала — DELETE.', data: compactPlan(plan) };
      });
      await runCheck('dictionary-stale-companion', 'Изменение текста при старом скрытом ID', async () => {
        const columns = mutableCriterionColumns(base.book, catalog, 2); if (!columns.length) return { status: 'NOT_RUN', detail: 'Нет подходящего справочника.' };
        const test = cloneWorkbook(base.book), row = chooseSourceRow(test, rng), column = shuffled(columns, rng)[0];
        const oldHidden = companionIndex(test, column.key) >= 0 ? row.values[companionIndex(test, column.key)] : '';
        const entry = shuffled(column.entries.filter(item => canon(item.selector || item.display) !== canon(row.values[column.index])), rng)[0]; setDictionaryValue(test, row, column.key, entry, true);
        const plan = E.buildPlan(test, structure, baseline, info); if (plan.counts.skip) throw new Error(JSON.stringify(plan.skippedRows));
        const update = plan.actions.find(action => action.type === 'update'); if (!update) throw new Error(`Изменение не распознано как UPDATE: ${JSON.stringify(plan.counts)}`);
        const resolved = update.excelRow?.ids?.[column.key]?.[0] || ''; if (!resolved || canon(resolved) === canon(oldHidden)) throw new Error('Старый companion ID не был пересопоставлен по новому видимому значению.');
        return { detail: 'Видимое значение победило устаревший companion ID; ID пересобран из справочника.' };
      });
      await runCheck('dictionary-invalid', 'Некорректное значение справочника', async () => {
        const columns = mutableCriterionColumns(base.book, catalog, 2); if (!columns.length) return { status: 'NOT_RUN', detail: 'Нет подходящего справочника.' };
        const test = cloneWorkbook(base.book), row = chooseSourceRow(test, rng), column = shuffled(columns, rng)[0]; row.values[column.index] = `__UAT_INVALID_${seed}__`; const idIndex = companionIndex(test, column.key); if (idIndex >= 0) row.values[idIndex] = '';
        const plan = E.buildPlan(test, structure, baseline, info); if (!plan.counts.skip && !(plan.issues || []).length) throw new Error('Некорректное значение не было отклонено.');
        return { detail: 'Неизвестное значение остановлено до Store.', data: compactPlan(plan) };
      });
      await runCheck('dictionary-refresh', 'Обновление справочников без потери строк', async () => {
        const refreshedBytes = await E.refreshWorkbookDictionaries(base.book, structure, catalog); const refreshed = await E.readXlsxArrayBuffer(refreshedBytes.buffer.slice(refreshedBytes.byteOffset, refreshedBytes.byteOffset + refreshedBytes.byteLength), 'TESSA_UAT_REFRESHED.xlsx');
        const plan = E.buildPlan(refreshed, structure, baseline, info); if (plan.counts.skip || plan.counts.add || plan.counts.update || plan.counts.delete) throw new Error(`После refresh появились изменения: ${JSON.stringify(plan.counts)}`);
        packageEntries.push(['dictionary-refreshed.xlsx', refreshedBytes]); return { detail: 'Справочники обновились; матрица и скрытые identity сохранились.' };
      });
      await runCheck('merge-current', 'Объединение с актуальной TESSA', async () => {
        const merged = E.mergeWorkbookIntoCurrentSnapshot(base.book, structure, baseline); if ((merged.snapshot?.rows || []).length !== baseline.rows.length) throw new Error(`После merge строк ${merged.snapshot?.rows?.length}, ожидалось ${baseline.rows.length}.`);
        const mergedBytes = await E.createRoundtripXlsxBytes(structure, merged.snapshot, info, catalog, { baselineRows: baseline.rows, includeActions: true, schemaChanges: merged.schemaChanges, customColumns: merged.customColumns });
        const parsed = await E.readXlsxArrayBuffer(mergedBytes.buffer.slice(mergedBytes.byteOffset, mergedBytes.byteOffset + mergedBytes.byteLength), 'TESSA_UAT_MERGED.xlsx'); const plan = E.buildPlan(parsed, structure, baseline, info);
        if (plan.counts.skip || plan.counts.add || plan.counts.update || plan.counts.delete) throw new Error(`Merge дал ложные изменения: ${JSON.stringify(plan.counts)}`);
        packageEntries.push(['merged-current.xlsx', mergedBytes]); return { detail: 'Объединение roundtrip с неизменившейся TESSA идемпотентно.' };
      });
      await runCheck('dictionary-audit', 'Связь столбцов со справочниками', async () => {
        const columns = E.pickerColumns(structure, catalog); const audit = columns.map(column => ({ key: column.key, label: column.label, catalogId: column.catalog?.id || catalog.columnCatalogIds?.[column.key] || null, sourceView: column.catalog?.sourceView || null, entries: column.catalog?.entries?.length || 0 }));
        const missing = audit.filter(item => !item.catalogId || !item.entries); report.dictionaryAudit = { columns: audit, missing, stats: E.safePlain(catalog.stats || {}, { maxDepth: 4, maxKeys: 200, maxArray: 200 }) };
        if (missing.length) throw new Error(`Пустые/непривязанные справочники: ${missing.map(item => item.label).join(', ')}`); return { detail: `Проверено ${audit.length} picker-столбцов; пустых привязок нет.` };
      });
      await runCheck('record-keeping', 'Фильтр юридических лиц IsRecordKeeping', async () => {
        const partner = Object.values(catalog.catalogs || {}).filter(item => canon(item.sourceView) === canon('GchPartners')); if (!partner.length) return { status: 'NOT_RUN', detail: 'В шаблоне нет GchPartners.' };
        const rows = partner.flatMap(item => (item.entries || []).map(entry => ({ catalog: item.label, entry }))); const invalid = rows.filter(({ entry }) => canon(entry.status) !== canon('Текущее значение') && entry.details && !/IsRecordKeeping\s*:\s*true/i.test(entry.details)); const overlays = rows.filter(({ entry }) => canon(entry.status) === canon('Текущее значение') || !entry.details);
        report.recordKeepingAudit = { catalogs: partner.map(item => ({ id: item.id, label: item.label, entries: item.entries?.length || 0 })), invalid: invalid.slice(0, 20).map(x => x.entry.display), historicalOverlays: overlays.slice(0, 20).map(x => x.entry.display), warnings: catalog.stats?.warnings || [] };
        if (invalid.length) throw new Error(`В актуальном GchPartners найдено ${invalid.length} записей без IsRecordKeeping=true.`); return { detail: 'Актуальные GchPartners отфильтрованы; historical snapshot-overlay не считаются новыми допустимыми значениями.' };
      });
      await runCheck('role-presentation', 'ФИО + должность в picker', async () => {
        const roleCatalogs = Object.values(catalog.catalogs || {}).filter(item => canon(item.sourceView) === canon('MtxRoles')); const people = roleCatalogs.flatMap(item => item.entries || []).filter(entry => String(entry.roleTypeId) === '1' && /RolePositionName\s*:/i.test(String(entry.details || '')));
        const sample = shuffled(people, rng).slice(0, 25).map(entry => ({ raw: entry.display, ...E.pickerEntryPresentation(entry) })); if (!sample.length) return { status: 'NOT_RUN', detail: 'TESSA не вернула Personal role с должностью.' };
        const bad = sample.filter(item => !/\s—\s/.test(item.title || '')); report.rolePresentationAudit = { tested: sample.length, bad: bad.length, sample }; if (bad.length) throw new Error(`${bad.length} персональных ролей показаны без должности.`);
        return { detail: `${sample.length} случайных сотрудников показаны как «Фамилия И.О. — должность».` };
      });

      try { await E.startNativeOperationRecorder(); timeline('native-recorder', 'started'); }
      catch (error) { addCheck('native-recorder', 'Нативная запись write-фазы', 'WARN', String(error?.message || error), { required: false }); }

      await runCheck('write-add-delete', 'Сервер: ADD → read-back → DELETE → восстановление', async () => {
        const temp = await createTemporaryRow('write-add-delete'), rowCardId = temp.created.rowCardId;
        try { if (!await cleanupCreatedRow(rowCardId, 'write-add-delete')) throw new Error('Cleanup временной строки не подтверждён.'); const final = await freshSnapshot(); if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) throw new Error('После ADD/DELETE исходная матрица отличается от baseline.'); return { detail: `Временная строка ${rowCardId} добавлена, прочитана и удалена; baseline восстановлен.` }; }
        catch (error) { await cleanupCreatedRow(rowCardId, 'write-add-delete-finally'); throw error; }
      });
      await runCheck('write-update-delete', 'Сервер: ADD → UPDATE → read-back → cleanup', async () => {
        const temp = await createTemporaryRow('write-update-delete'), rowCardId = temp.created.rowCardId;
        try {
          const current = await freshSnapshot(); bridge = current.bridge; const currentCatalog = await bridge.loadDictionaryCatalog(structure, current.snapshot, { forceRefresh: true, transient: true }); const { book } = await workbookFromSnapshot(structure, current.snapshot, bridge, currentCatalog); const target = findRowByCard(book, rowCardId); if (!target) throw new Error('Временная строка не найдена после ADD.');
          let updatePlan = null; for (const column of shuffled(mutableCriterionColumns(book, currentCatalog, 3), rng)) { for (const entry of shuffled(column.entries.filter(entry => canon(entry.selector || entry.display) !== canon(target.values[column.index])), rng).slice(0, 20)) { const attempt = cloneWorkbook(book), row = findRowByCard(attempt, rowCardId); setDictionaryValue(attempt, row, column.key, entry); const plan = E.buildPlan(attempt, structure, current.snapshot, bridge.matrixInfo()); const exec = plan.actions.filter(action => action.type !== 'noop'); if (exec.length === 1 && exec[0].type === 'update' && canon(exec[0].currentRow?.rowCardId) === canon(rowCardId) && !plan.counts.skip) { updatePlan = plan; break; } } if (updatePlan) break; }
          if (!updatePlan) throw new Error('Не удалось подобрать безопасное UPDATE временной строки.'); await applySingle(updatePlan, 'write-update-delete: UPDATE'); const afterUpdate = await freshSnapshot(); if (!afterUpdate.snapshot.rows.some(row => canon(row.rowCardId) === canon(rowCardId))) throw new Error('Временная строка исчезла после UPDATE.'); if (!await cleanupCreatedRow(rowCardId, 'write-update-delete')) throw new Error('Cleanup после UPDATE не подтверждён.'); const final = await freshSnapshot(); if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) throw new Error('После UPDATE cleanup baseline не восстановлен.'); return { detail: 'Временная строка изменена через штатный Store/read-back и полностью удалена.' };
        } catch (error) { await cleanupCreatedRow(rowCardId, 'write-update-delete-finally'); throw error; }
      });
      await runCheck('write-clear-delete', 'Сервер: ADD → очистка поля → read-back → cleanup', async () => {
        const temp = await createTemporaryRow('write-clear-delete'), rowCardId = temp.created.rowCardId;
        try {
          const current = await freshSnapshot(); bridge = current.bridge; const currentCatalog = await bridge.loadDictionaryCatalog(structure, current.snapshot, { forceRefresh: true, transient: true }); const { book } = await workbookFromSnapshot(structure, current.snapshot, bridge, currentCatalog); const target = findRowByCard(book, rowCardId); if (!target) throw new Error('Временная строка не найдена после ADD.');
          const candidateIndexes = directTokenIndexes(book).filter(index => String(book.schemaTokens[index]).startsWith('criterion:') && String(target.values[index] || '').trim()); let clearPlan = null;
          for (const index of shuffled(candidateIndexes, rng)) { const key = book.schemaTokens[index]; if (!(book.rows || []).some(row => canon(rowIdentity(book, row).rowCardId) !== canon(rowCardId) && !String(row.values[index] || '').trim())) continue; const attempt = cloneWorkbook(book), row = findRowByCard(attempt, rowCardId); row.values[index] = ''; const idIndex = companionIndex(attempt, key); if (idIndex >= 0) row.values[idIndex] = ''; const plan = E.buildPlan(attempt, structure, current.snapshot, bridge.matrixInfo()); const exec = plan.actions.filter(action => action.type !== 'noop'); if (exec.length === 1 && exec[0].type === 'update' && canon(exec[0].currentRow?.rowCardId) === canon(rowCardId) && !plan.counts.skip) { clearPlan = plan; break; } }
          if (!clearPlan) return { status: 'NOT_RUN', detail: 'Не найдено доказанно необязательное заполненное поле временной строки.' }; await applySingle(clearPlan, 'write-clear-delete: CLEAR'); if (!await cleanupCreatedRow(rowCardId, 'write-clear-delete')) throw new Error('Cleanup после очистки не подтверждён.'); const final = await freshSnapshot(); if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) throw new Error('После очистки cleanup baseline не восстановлен.'); return { detail: 'Очистка значения применена на временной строке, подтверждена и откатана.' };
        } catch (error) { await cleanupCreatedRow(rowCardId, 'write-clear-delete-finally'); throw error; }
      });

      if (typeof E.stopNativeOperationRecorder === 'function') { try { const nativeRecord = await E.stopNativeOperationRecorder(false); if (nativeRecord) packageEntries.push(['native-write-trace.json', utf8(nativeRecord)]); } catch (error) { addCheck('native-recorder-stop', 'Остановка нативной записи', 'WARN', String(error?.message || error), { required: false }); } }
      const final = await freshSnapshot(); if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) { cleanupUnsafe = true; addCheck('final-baseline', 'Финальное состояние матрицы', 'FAIL', 'После UAT исходные строки/значения отличаются от baseline.', { required: true }); } else addCheck('final-baseline', 'Финальное состояние матрицы', 'PASS', 'Исходная матрица полностью восстановлена.', { required: true });
      report.status = cleanupUnsafe ? 'UNSAFE' : report.checks.some(check => check.required !== false && check.status === 'FAIL') ? 'FAILED' : 'PASSED';
    } catch (error) {
      report.fatalError = String(error?.message || error); report.status = cleanupUnsafe ? 'UNSAFE' : 'INCOMPLETE'; timeline('fatal', report.fatalError); try { if (typeof E.stopNativeOperationRecorder === 'function') await E.stopNativeOperationRecorder(false); } catch (_) { /* best effort */ }
    } finally {
      report.finishedAt = now(); report.durationMs = new Date(report.finishedAt).getTime() - new Date(startedAt).getTime(); report.summary = { pass: report.checks.filter(x => x.status === 'PASS').length, fail: report.checks.filter(x => x.status === 'FAIL').length, warn: report.checks.filter(x => x.status === 'WARN').length, notRun: report.checks.filter(x => x.status === 'NOT_RUN').length, writesAttempted: report.writesAttempted, writesCompleted: report.writesCompleted, cleanupVerified: report.cleanup.filter(x => x.status === 'verified' || x.status === 'already-absent').length, cleanupFailed: report.cleanup.filter(x => x.status === 'FAILED').length };
      const summary = { format: 'TESSA_FULL_UAT_SUMMARY_V1', status: report.status, seed: report.seed, studioVersion: report.studioVersion, runnerVersion: report.runnerVersion, matrix: report.matrix, startedAt: report.startedAt, finishedAt: report.finishedAt, summary: report.summary };
      const readme = `TESSA Matrix Studio — Full UAT\n\nСтатус: ${report.status}\nSeed: ${report.seed}\nМатрица: ${report.matrix?.name || ''} (${report.matrix?.matrixId || ''})\n\nPASSED — обязательные проверки прошли и cleanup подтверждён.\nFAILED — есть функциональная ошибка, cleanup подтверждён.\nUNSAFE — cleanup или восстановление исходного состояния не подтверждены.\nINCOMPLETE — UAT не дошёл до полного набора проверок.\n`;
      packageEntries.push(['summary.json', utf8(summary)], ['uat-report.json', utf8(report)], ['timeline.json', utf8(report.timeline)], ['dictionary-audit.json', utf8({ dictionaryAudit: report.dictionaryAudit, rolePresentationAudit: report.rolePresentationAudit, recordKeepingAudit: report.recordKeepingAudit })], ['README.txt', utf8(readme)]);
      try { const zip = await E.makeZip(packageEntries); const stamp = report.finishedAt.replace(/[:.]/g, '-'); E.triggerBlobDownload(new Blob([zip], { type: 'application/zip' }), `TESSA_Full_UAT_${report.status}_${stamp}.zip`); }
      catch (error) { console.error('[TESSA Full UAT] package error', error); try { E.downloadJson(report, `TESSA_Full_UAT_${report.status}.json`, null); } catch (_) { /* best effort */ } }
    }
    return report;
  }

  function installUi() {
    if (globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__) return;
    const styleId = 'tms-full-uat-style';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style'); style.id = styleId;
      style.textContent = `.tms-picker-import-block{margin-top:12px;padding:12px;border:1px solid rgba(128,128,128,.22);border-radius:10px;background:rgba(128,128,128,.035)}.tms-picker-import-block>summary{font-weight:600;cursor:pointer}.tms-picker-import-hint{margin:8px 0;color:var(--tms-muted,#6b7280);font-size:12px;line-height:1.45}.tms-picker-import-block textarea{display:block;width:100%;box-sizing:border-box;min-height:92px;margin:8px 0;resize:vertical}.tms-picker-import-actions{justify-content:flex-end}.tms-uat-card{margin-top:12px;padding:14px;border:1px solid rgba(128,128,128,.22);border-radius:12px;background:rgba(128,128,128,.035)}.tms-uat-card h4{margin:0 0 6px;font-size:14px}.tms-uat-card p{margin:5px 0 10px;line-height:1.45}.tms-uat-status{margin-top:10px;padding:9px 11px;border-radius:8px;background:rgba(128,128,128,.08);font-size:12px;white-space:pre-wrap}.tms-uat-status[data-state="running"],.tms-uat-status[data-state="PASSED"],.tms-uat-status[data-state="FAILED"],.tms-uat-status[data-state="UNSAFE"]{font-weight:600}`;
      document.head?.appendChild(style);
    }
    const host = document.querySelector('#tms-test-tools'); if (!host || host.querySelector('#tms-full-uat')) return false;
    const card = document.createElement('div'); card.className = 'tms-uat-card'; card.innerHTML = `<h4>Полный UAT</h4><p>Автоматически проверяет Excel-сценарии, справочники, объединение и реальные ADD/UPDATE/DELETE на временных строках. Исходные строки не меняются; после каждого write-сценария временная строка удаляется и состояние перечитывается.</p><button id="tms-full-uat" type="button">Запустить полный UAT</button><div id="tms-full-uat-status" class="tms-uat-status" data-state="idle">Не запускался.</div>`; host.appendChild(card);
    const button = card.querySelector('#tms-full-uat'), status = card.querySelector('#tms-full-uat-status');
    button.addEventListener('click', async () => {
      if (!window.confirm('Полный UAT выполнит реальные операции только с временными строками в текущем черновике TESSA и будет удалять их после каждого сценария. Запустить?')) return;
      button.disabled = true; status.dataset.state = 'running'; status.textContent = 'Выполняю Full UAT… Не закрывайте вкладку до скачивания итогового ZIP.';
      try { const result = await runFullUat(); status.dataset.state = result.status; status.textContent = `${result.status} · PASS ${result.summary?.pass || 0} · FAIL ${result.summary?.fail || 0} · NOT RUN ${result.summary?.notRun || 0}\nИтоговый ZIP скачан. Seed: ${result.seed}`; }
      catch (error) { status.dataset.state = 'UNSAFE'; status.textContent = `UNSAFE · ${String(error?.message || error)}`; }
      finally { button.disabled = false; }
    });
    return true;
  }

  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, runFullUat, installUi };
  if (!globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__) { let attempts = 0; const timer = setInterval(() => { attempts += 1; if (installUi() || attempts > 120) clearInterval(timer); }, 250); installUi(); }
})();
