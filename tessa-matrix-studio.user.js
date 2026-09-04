// ==UserScript==
// @name         TESSA Matrix Studio — Черкизово
// @namespace    https://github.com/ShapArt/tessa-matrix-studio
// @version      1.10.1
// @description  TESSA Matrix Studio: безопасное редактирование матриц через Excel, понятный diff, замена строк, прогресс операций и защита от ошибок.
// @author       Шаповалов Артём
// @match        https://tessa-app01tl.cherkizovsky.net/*
// @match        https://tessa-app01.cherkizovsky.net/*
// @match        https://tessa.cherkizovsky.net/*
// @include      https://tessa-app*.cherkizovsky.net/*
// @run-at       document-idle
// @grant        none
// @homepageURL  https://github.com/ShapArt/tessa-matrix-studio
// @supportURL   https://github.com/ShapArt/tessa-matrix-studio/issues
// @updateURL    https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.meta.js
// @downloadURL  https://github.com/ShapArt/tessa-matrix-studio/releases/latest/download/tessa-matrix-studio.user.js
// ==/UserScript==

(() => {
  'use strict';

  /*
   * Архитектура модуля
   * -------------------
   * 1. XLSX: чтение и формирование roundtrip-книги без внешних библиотек.
   * 2. Справочники: загрузка, кэширование и типизированное разрешение значений.
   * 3. TESSA bridge: чтение структуры, строк, представлений и CardService.
   * 4. Planner: сопоставление строк по MatrixRowID/MatrixVersionID и расчёт diff.
   * 5. Safety/apply: preflight, проверка дублей, частичное применение и повторная верификация.
   * 6. UI: компактный пользовательский сценарий «скачать → изменить → проверить → применить».
   *
   * Навигация по функциям, тестам и границам записи: docs/CODE-MAP.md.
   *
   * Критический принцип: служебные идентификаторы из Excel используются только для
   * точного сопоставления. Любая аномалия идентичности приводит к пропуску строки,
   * а не к догадке, автоматическому ADD или массовому DELETE.
   */

  // ---------------------------------------------------------------------------
  // 1. СОСТОЯНИЕ ПРИЛОЖЕНИЯ И КОНСТАНТЫ
  // Все изменяемое состояние одной вкладки хранится в APP. Константы ниже
  // описывают формат Excel, служебные секции TESSA и параметры производительности.
  // ---------------------------------------------------------------------------

  const APP = {
    name: 'TESSA Matrix Studio',
    version: '1.10.1',
    plan: null,
    review: createPlanReviewState(),
    previewView: createPreviewViewState(),
    workbook: null,
    snapshot: null,
    structure: null,
    bridge: null,
    capabilities: null,
    capabilityAvailability: null,
    capabilityCheckedCardId: null,
    capabilityCheckedTemplateId: null,
    runtimeMonitor: null,
    picker: null,
    busyControlStates: new WeakMap(),
    lastMutationReceipts: null,
    lastReconciliation: null,
    busy: false,
    abortRequested: false,
    logs: [],
    lastReport: null,
    lastIntervalDiagnostics: null,
    lastStudioDiagnostics: null,
    dictionaryCatalog: null,
    progress: { percent: 0, label: 'Готово', detail: '' },
  };

  const ROUNDTRIP = Object.freeze({
    Format: 'TESSA_MATRIX_ROUNDTRIP_V6',
    AcceptedFormats: ['TESSA_MATRIX_ROUNDTRIP_V1', 'TESSA_MATRIX_ROUNDTRIP_V2', 'TESSA_MATRIX_ROUNDTRIP_V3', 'TESSA_MATRIX_ROUNDTRIP_V4', 'TESSA_MATRIX_ROUNDTRIP_V5', 'TESSA_MATRIX_ROUNDTRIP_V6'],
    DictionarySheet: 'Словари',
    StructureSheet: 'Структура',
    SchemaChangesSheet: 'Изменения структуры',
    BaselineSheet: '__TESSA_BASELINE',
    InstructionSheet: 'Инструкция',
    FormatKey: '__TESSA_FORMAT',
    MatrixIdKey: '__TESSA_MATRIX_ID',
    TemplateIdKey: '__TESSA_TEMPLATE_ID',
    PreviousVersionIdKey: '__TESSA_PREVIOUS_VERSION_ID',
    HeaderRowKey: '__TESSA_HEADER_ROW',
    SchemaRowKey: '__TESSA_SCHEMA_ROW',
    TemplateModeKey: '__TESSA_TEMPLATE_MODE',
  });

  const DICTIONARY_CACHE = Object.freeze({
    DbName: 'TESSA_Matrix_Excel_Sync',
    StoreName: 'dictionaryCatalogs',
    DbVersion: 1,
    TtlMs: 12 * 60 * 60 * 1000,
  });

  const PERFORMANCE = Object.freeze({
    SnapshotCardGetConcurrency: 6,
    PreflightAddConcurrency: 4,
    PreviewSnapshotTtlMs: 15 * 60 * 1000,
    PreviewYieldDeadlineMs: 40,
    ZipConcurrency: 4,
  });

  // XLSX is an OPC/ZIP package. These are hard browser-side resource ceilings, not
  // business limits: a workbook that exceeds them is rejected before XML parsing.
  const XLSX_ARCHIVE_LIMITS = Object.freeze({
    MaxInputBytes: 32 * 1024 * 1024,
    MaxEntries: 256,
    MaxEntryUncompressedBytes: 128 * 1024 * 1024,
    MaxTotalUncompressedBytes: 256 * 1024 * 1024,
    MaxCompressionRatio: 100,
  });

  // SpreadsheetML itself is untrusted even after the ZIP package passes archive guards.
  // These ceilings prevent tiny XML from materializing pathological sparse arrays or
  // forcing the browser to parse an unreasonable number of physical row/cell nodes.
  const SPREADSHEETML_LIMITS = Object.freeze({
    MaxRowNumber: 100000,
    MaxColumnNumber: 16384, // Excel XFD
    MaxParsedRows: 100000,
    MaxParsedCells: 500000,
  });


  // Индексы справочников живут только в памяти вкладки. Они не сериализуются в Excel,
  // зато превращают точный поиск по ID/названию из O(N) на каждую ячейку в O(1).
  const DICTIONARY_LOOKUP_CACHE = new WeakMap();
  const NORMALIZED_DICTIONARY_CATALOGS = new WeakSet();
  let extensionRuntimeCache = null;

  const OPERAND = Object.freeze({
    String: '5730135A-882A-47A7-8C9C-9EA53E5869DA',
    Date: 'F03E108F-C120-4499-88A1-47AB8C25EF9D',
    DateTime: '2738356E-DCF5-4E3B-990B-C57173EF9AB1',
    Decimal: '8F30CA84-67BC-4B84-8747-A3536E48516D',
    Int: '310ECB73-D554-42DA-9F9D-7EDC62A5D09F',
    Boolean: '987D0A66-C48F-422E-946E-978A672241E4',
    TypeGuid: 'A0EDE057-A8E0-454E-AC26-C7F81139F81D',
    ReferenceInt: '9E65EC2E-26D7-4773-BA61-E2A647FFDD39',
    ReferenceGuid: '89D5C112-CF02-4B22-97CB-7E6AB7FADC4E',
  });

  const REQUEST = Object.freeze({
    Structure: '6a6fbe48-9603-4b37-8da8-78c3b12a1a56',
    ValidateDuplicate: 'f5c0419f-15cc-428e-b2f9-76c1b3ef7525',
    DeleteRow: 'd090417f-bf4b-45ed-9c82-33ef23acd96f',
  });

  const S = Object.freeze({
    Matrix: 'MtxRouteMatrix',
    MatrixRows: 'MtxRouteMatrixRows',
    MatrixRow: 'MtxRouteMatrixRow',
    Versions: 'MtxRouteMatrixRowVersions',
    Values: 'MtxRouteMatrixRowVersionValues',
    Roles: 'MtxRouteMatrixRowVersionRoles',
  });

  const F = Object.freeze({
    TemplateID: 'TemplateID',
    // Эти поля нужны только для резервной диагностики. Для открытия строки используются
    // нативные скрытые поля представления MatrixRowID / MatrixVersionID — как в самой TESSA.
    MatrixRowCardID: 'RowID',
    MatrixRowVersionID: 'RowRowID',
    MatrixRowName: 'RowName',
    LinkCount: 'LinkCount',
    OwnerRowID: 'OwnerRowID',
    CriterionRowID: 'CriterionRowID',
    CriterionName: 'CriterionName',
    BoolValue: 'BoolValue',
    DateValue: 'DateValue',
    DateToValue: 'DateToValue',
    DateTimeValue: 'DateTimeValue',
    DateTimeToValue: 'DateTimeToValue',
    StringValue: 'StringValue',
    IntValue: 'IntValue',
    IntToValue: 'IntToValue',
    DecimalValue: 'DecimalValue',
    DecimalToValue: 'DecimalToValue',
    ReferenceValueID: 'ReferenceValueID',
    ReferenceValueName: 'ReferenceValueName',
    ReferenceIntValueID: 'ReferenceIntValueID',
    ReferenceIntValueName: 'ReferenceIntValueName',
    FunctionID: 'FunctionID',
    FunctionName: 'FunctionName',
    RoleID: 'RoleID',
    RoleName: 'RoleName',
    RoleTypeID: 'RoleTypeID',
  });

  const VALUE_FIELDS = [
    F.BoolValue, F.DateValue, F.DateToValue, F.DateTimeValue, F.DateTimeToValue,
    F.StringValue, F.IntValue, F.IntToValue, F.DecimalValue, F.DecimalToValue,
    F.ReferenceValueID, F.ReferenceValueName, F.ReferenceIntValueID, F.ReferenceIntValueName,
  ];

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const monotonicNow = () => Number(globalThis.performance?.now?.() ?? Date.now());

  async function yieldToMain() {
    if (globalThis.scheduler?.yield) {
      await globalThis.scheduler.yield();
      return;
    }
    await sleep(0);
  }

  function estimateRemainingMs({ completed, total, elapsedMs }) {
    const done = Math.max(0, Number(completed) || 0);
    const size = Math.max(0, Number(total) || 0);
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    if (!size || done <= 0 || elapsed <= 0) return null;
    if (done >= size) return 0;
    return Math.max(0, Math.round((elapsed / done) * (size - done)));
  }

  function formatEtaMs(ms) {
    const value = Math.max(0, Number(ms) || 0);
    if (value < 5000) return 'меньше 5 сек';
    const totalSeconds = Math.max(1, Math.round(value / 1000));
    if (totalSeconds < 60) return `${totalSeconds} сек`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) return seconds ? `${totalMinutes} мин ${seconds} сек` : `${totalMinutes} мин`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`;
  }

  function formatProgressCount(value) {
    return String(Math.max(0, Math.trunc(Number(value) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

  function workProgressDetail({ completed, total, elapsedMs }) {
    const done = Math.max(0, Number(completed) || 0);
    const size = Math.max(0, Number(total) || 0);
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    let tail = 'оцениваю время…';
    if (done >= size && size > 0) {
      tail = 'готово';
    } else if (done >= 5 && elapsed >= 500) {
      const eta = estimateRemainingMs({ completed: done, total: size, elapsedMs: elapsed });
      if (eta !== null) tail = `~${formatEtaMs(eta)} осталось`;
    }
    return `${formatProgressCount(done)} из ${formatProgressCount(size)} · ${tail}`;
  }

  function requestApplyAbort() {
    APP.abortRequested = true;
  }

  function preflightAbortError() {
    const error = new Error('Предварительная проверка остановлена пользователем.');
    error.code = 'TMS_PREFLIGHT_ABORTED';
    return error;
  }

  function isPreflightAbortError(error) {
    return error?.code === 'TMS_PREFLIGHT_ABORTED';
  }

  /**
   * TESSA internal promises do not expose AbortSignal. During read-only preflight we can
   * still stop waiting immediately and refuse to schedule further checks. The underlying
   * already-started request may finish later, but no Store/Delete is allowed from it.
   */
  async function awaitPreflightAbortable(promise) {
    if (APP.abortRequested) throw preflightAbortError();
    let timer = null;
    const abortPromise = new Promise((_, reject) => {
      timer = setInterval(() => {
        if (!APP.abortRequested) return;
        if (timer !== null) clearInterval(timer);
        timer = null;
        reject(preflightAbortError());
      }, 25);
    });
    try {
      return await Promise.race([Promise.resolve(promise), abortPromise]);
    } finally {
      if (timer !== null) clearInterval(timer);
    }
  }

  /**
   * Выполняет независимые операции с ограниченной конкуренцией.
   * Так мы ускоряем сотни CardGet, не создавая всплеск запросов к TESSA.
   */
  async function mapConcurrent(items, limit, worker) {
    const source = Array.from(items || []);
    if (!source.length) return [];
    const concurrency = Math.max(1, Math.min(Number(limit) || 1, source.length));
    const output = new Array(source.length);
    let cursor = 0;
    async function run() {
      while (true) {
        const index = cursor++;
        if (index >= source.length) return;
        output[index] = await worker(source[index], index);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => run()));
    return output;
  }
  const nowIso = () => new Date().toISOString();

  // ---------------------------------------------------------------------------
  // 2. БАЗОВЫЕ УТИЛИТЫ
  // Нормализация, безопасная сериализация, сравнение значений и вспомогательные функции.
  // Эти функции не обращаются к TESSA и используются всеми последующими слоями.
  // ---------------------------------------------------------------------------

  function truncateText(value, max = 200000) {
    const text = String(value ?? '');
    return text.length > max ? `${text.slice(0, max)}
…[обрезано ${text.length - max} символов]` : text;
  }

  function safePlain(value, options = {}, seen = new WeakMap(), depth = 0) {
    const maxDepth = options.maxDepth ?? 10;
    const maxKeys = options.maxKeys ?? 500;
    const maxArray = options.maxArray ?? 2000;
    const maxString = options.maxString ?? 500000;
    if (value === null || value === undefined) return value ?? null;
    if (typeof value === 'string') return truncateText(value, maxString);
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return `${value.toString()}n`;
    if (typeof value === 'symbol') return String(value);
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { name: value.name, message: value.message, stack: truncateText(value.stack || '', 30000) };
    if (value instanceof Element) {
      return {
        tag: value.tagName,
        id: value.id || null,
        className: typeof value.className === 'string' ? value.className : null,
        text: truncateText(normalizeSpace(value.textContent || ''), 3000),
      };
    }
    if (depth >= maxDepth) return `[MaxDepth:${value?.constructor?.name || typeof value}]`;
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return `[Circular:${seen.get(value)}]`;
    seen.set(value, value?.constructor?.name || 'Object');
    if (Array.isArray(value)) {
      const out = value.slice(0, maxArray).map(item => safePlain(item, options, seen, depth + 1));
      if (value.length > maxArray) out.push(`[Truncated ${value.length - maxArray} items]`);
      return out;
    }
    if (value instanceof Map || typeof value.entries === 'function' && value?.constructor?.name === 'Dictionary') {
      try {
        const out = {};
        let count = 0;
        for (const [key, item] of value.entries()) {
          if (count++ >= maxKeys) { out.__truncated__ = true; break; }
          out[String(key)] = safePlain(item, options, seen, depth + 1);
        }
        return out;
      } catch (_) { /* use object path */ }
    }
    if (value instanceof Set) {
      return safePlain(Array.from(value), options, seen, depth + 1);
    }
    const out = { __class__: value?.constructor?.name || 'Object' };
    let keys = [];
    try { keys = Object.keys(value); } catch (_) { return out; }
    for (const key of keys.slice(0, maxKeys)) {
      if (/^(password|authorization|accessToken|refreshToken|token)$/i.test(key)) {
        out[key] = '[REDACTED]';
        continue;
      }
      try { out[key] = safePlain(value[key], options, seen, depth + 1); }
      catch (error) { out[key] = `[ReadError:${error?.message || error}]`; }
    }
    if (keys.length > maxKeys) out.__truncatedKeys__ = keys.length - maxKeys;
    return out;
  }

  function log(message, level = 'info', extra = null) {
    const entry = { time: nowIso(), level, message, extra };
    APP.logs.push(entry);
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[TESSA Matrix Sync] ${message}`, extra ?? '');
    const box = document.querySelector('#tms-log');
    if (box) {
      const line = document.createElement('div');
      line.className = `tms-log-line tms-${level}`;
      line.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    }
  }

  function normalizeSpace(value) {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/[‐‑‒–—−]/g, '-')
      .replace(/[“”„«»]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isOverwriteMatch(match) {
    return ['position-overwrite', 'missing-identity-overwrite'].includes(match?.matchedBy);
  }

  function stripFormulaMarker(value) {
    return normalizeSpace(String(value ?? '').replace(/^\s*=\s*/, ''));
  }

  function canonicalHeader(value) {
    return normalizeSpace(value)
      .toLowerCase()
      .replace(/✅/g, ' __eq__ ')
      .replace(/❌/g, ' __neq__ ')
      .replace(/\b=\s*пусто\b/gi, ' __empty__ ')
      .replace(/\bпусто\b/gi, ' __empty__ ')
      .replace(/\b=\s*между\b/gi, ' __between__ ')
      .replace(/\bмежду\b/gi, ' __between__ ')
      .replace(/\s+\d+$/g, '')
      .replace(/[.:;,_/\\()[\]{}]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function canonicalValue(value) {
    return stripFormulaMarker(value).toLocaleLowerCase('ru-RU');
  }

  function searchCanonical(value) {
    return canonicalValue(value)
      .replace(/ё/g, 'е')
      .replace(/[^0-9a-zа-я]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function searchTokens(value) {
    return searchCanonical(value).split(' ').filter(Boolean);
  }

  function booleanSemantic(value) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
    const text = canonicalValue(value);
    if (['true', '1', 'да', 'yes', 'y', 'истина'].includes(text)) return true;
    if (['false', '0', 'нет', 'no', 'n', 'ложь'].includes(text)) return false;
    return null;
  }

  function booleanDisplay(value) {
    const semantic = booleanSemantic(value);
    return semantic === true ? 'Да' : semantic === false ? 'Нет' : normalizeSpace(value);
  }

  function operandKind(column) {
    if (column?.kind === 'function') return 'Function';
    const operand = canonicalValue(column?.operandTypeId);
    if (operand === canonicalValue(OPERAND.Boolean)) return 'Boolean';
    if (operand === canonicalValue(OPERAND.Int)) return 'Int';
    if (operand === canonicalValue(OPERAND.Decimal)) return 'Decimal';
    if (operand === canonicalValue(OPERAND.Date)) return 'Date';
    if (operand === canonicalValue(OPERAND.DateTime)) return 'DateTime';
    if (operand === canonicalValue(OPERAND.ReferenceGuid)) return 'ReferenceGuid';
    if (operand === canonicalValue(OPERAND.ReferenceInt)) return 'ReferenceInt';
    return column?.refSection ? 'ReferenceGuid' : 'String';
  }

  function excelSerialToDate(value) {
    const serial = Number(value);
    if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + Math.round(serial * 86400000));
  }

  function strictLocalDateParts(raw) {
    const normalized = String(raw || '').replace(/,\s*(?=\d{1,2}:\d{2})/, ' ').trim();
    const match = normalized.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) return null;
    const [, dd, mm, yyyy, hh='0', mi='0', ss='0'] = match;
    const parts = { y:Number(yyyy), m:Number(mm), d:Number(dd), hh:Number(hh), mi:Number(mi), ss:Number(ss) };
    if (parts.m < 1 || parts.m > 12 || parts.d < 1 || parts.d > 31 || parts.hh < 0 || parts.hh > 23 || parts.mi < 0 || parts.mi > 59 || parts.ss < 0 || parts.ss > 59) return null;
    const date = new Date(parts.y, parts.m - 1, parts.d, parts.hh, parts.mi, parts.ss);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== parts.y || date.getMonth() !== parts.m - 1 || date.getDate() !== parts.d || date.getHours() !== parts.hh || date.getMinutes() !== parts.mi || date.getSeconds() !== parts.ss) return null;
    return { date, hasTime: Boolean(match[4]) };
  }

  function canonicalDateSemantic(value, withTime = false) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      if (!withTime) return `${y}-${m}-${d}`;
      return `${y}-${m}-${d}T${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}:${String(value.getSeconds()).padStart(2,'0')}`;
    }
    const raw = stripFormulaMarker(value);
    if (!raw) return '';
    const compact = raw.replace(/[\s\u00a0]/g,'');
    if (/^-?\d+(?:[.,]\d+)?$/.test(compact)) {
      const serial = excelSerialToDate(compact.replace(',', '.'));
      if (serial) return canonicalDateSemantic(serial, withTime);
    }
    const local = strictLocalDateParts(raw);
    if (local) return canonicalDateSemantic(local.date, withTime);
    const normalized = raw.replace(/,\s*(?=\d{1,2}:\d{2})/, ' ');
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? `text:${canonicalValue(raw)}` : canonicalDateSemantic(parsed, withTime);
  }

  function canonicalNumberSemantic(value, integer = false) {
    const raw = stripFormulaMarker(value).replace(/[\s\u00a0]/g, '').replace(',', '.');
    if (!raw) return '';
    const valid = integer ? /^[+-]?\d+$/.test(raw) : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw);
    if (!valid) return `text:${canonicalValue(value)}`;
    const n = Number(raw);
    if (!Number.isFinite(n)) return `text:${canonicalValue(value)}`;
    return integer ? String(Math.trunc(n)) : String(Number(n));
  }

  function typedValueIssue(kind, value, label = 'значение') {
    const raw = stripFormulaMarker(value);
    if (!raw) return null;
    if (kind === 'Boolean' && booleanSemantic(raw) === null) return `В столбце «${label}» используйте «Да» или «Нет».`;
    if (kind === 'Int') {
      const compact = raw.replace(/[\s\u00a0]/g,'').replace(',', '.');
      if (!/^[+-]?\d+$/.test(compact)) return `В столбце «${label}» не удалось распознать целое число «${raw}».`;
      if (!Number.isSafeInteger(Number(compact)) || Number(compact) < -2147483648 || Number(compact) > 2147483647) return `В столбце «${label}» число «${raw}» выходит за пределы Int32.`;
    }
    if (kind === 'Decimal') {
      const compact = raw.replace(/[\s\u00a0]/g,'').replace(',', '.');
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(compact) || !Number.isFinite(Number(compact))) return `В столбце «${label}» не удалось распознать число «${raw}».`;
    }
    if (kind === 'Date' || kind === 'DateTime') {
      const compact = raw.replace(/[\s\u00a0]/g,'');
      if (/^-?\d+(?:[.,]\d+)?$/.test(compact) && excelSerialToDate(compact.replace(',', '.'))) return null;
      if (strictLocalDateParts(raw)) return null;
      const normalized = raw.replace(/,\s*(?=\d{1,2}:\d{2})/, ' ');
      const parsed = new Date(normalized);
      if (Number.isNaN(parsed.getTime())) return `В столбце «${label}» не удалось распознать дату «${raw}».`;
      // Строки, похожие на локальную дату, но не прошедшие строгую проверку (31.02 и т.п.), блокируем.
      if (/^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}/.test(raw) && !strictLocalDateParts(raw)) return `В столбце «${label}» указана некорректная дата «${raw}».`;
    }
    return null;
  }

  // Excel may silently reinterpret text-like input such as `3 - 18` as a date and
  // persist only the numeric serial. For non-date TESSA criteria that conversion is
  // ambiguous and must never be applied as a legitimate number/string/reference.
  function excelAutoDateIssue(kind, value, meta, label = 'значение') {
    if (!meta || meta.numberFormatKind !== 'date') return null;
    if (kind === 'Date' || kind === 'DateTime') return null;
    const rawType = canonicalValue(meta.rawType || 'n');
    if (rawType && rawType !== 'n') return null;
    const raw = stripFormulaMarker(value);
    const compact = raw.replace(/[\s\u00a0]/g, '').replace(',', '.');
    if (!/^-?\d+(?:\.\d+)?$/.test(compact)) return null;
    const date = excelSerialToDate(compact);
    if (!date) return null;
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    const hasTime = Math.abs(Number(compact) % 1) > 1e-10;
    const time = hasTime
      ? ` ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
      : '';
    return `В столбце «${label}» Excel автоматически преобразовал значение в дату «${dd}.${mm}.${yyyy}${time}» и сохранил серийный номер «${raw}». Верните ячейку в текстовый формат и введите исходное значение повторно.`;
  }

  function excelCoercionIssue(kind, value, meta, label = 'значение') {
    if (!meta) return null;
    if (meta.hasFormula) {
      return `В столбце «${label}» обнаружена Excel-формула. Формулы в редактируемых ячейках матрицы не применяются: замените формулу обычным значением.`;
    }
    if (kind === 'Date' || kind === 'DateTime') return null;
    const rawType = canonicalValue(meta.rawType || 'n');
    if (rawType && rawType !== 'n') return null;
    const raw = stripFormulaMarker(value);
    if (!raw) return null;

    // Свежие Roundtrip-файлы экспортируют редактируемые значения как Text. Если
    // строковый критерий вернулся из Excel числовым cell type, исходная запись могла
    // потерять ведущие нули, перейти в scientific notation, процент или дробь.
    if (kind === 'String') {
      return `В столбце «${label}» Excel сохранил текстовый критерий как число «${raw}». Исходное текстовое представление могло измениться (ведущие нули, экспонента, проценты или дробь). Верните ячейку в текстовый формат и введите значение повторно.`;
    }

    const formatKind = canonicalValue(meta.numberFormatKind || 'general');
    if (['scientific', 'percent', 'fraction'].includes(formatKind) && !['Int', 'Decimal'].includes(kind)) {
      return `В столбце «${label}» Excel применил числовой формат «${formatKind}» к значению «${raw}». Для этого типа критерия преобразование неоднозначно; верните ячейку в текстовый формат и повторите ввод.`;
    }
    return null;
  }

  function typedScalarSemantic(kind, value) {
    if (value === null || value === undefined || normalizeSpace(value) === '') return '';
    if (kind === 'Boolean') {
      const semantic = booleanSemantic(value);
      return semantic === null ? `text:${canonicalValue(value)}` : `bool:${semantic ? 1 : 0}`;
    }
    if (kind === 'Int') return `int:${canonicalNumberSemantic(value, true)}`;
    if (kind === 'Decimal') return `decimal:${canonicalNumberSemantic(value, false)}`;
    if (kind === 'Date') return `date:${canonicalDateSemantic(value, false)}`;
    if (kind === 'DateTime') return `datetime:${canonicalDateSemantic(value, true)}`;
    return `text:${canonicalValue(value)}`;
  }

  function typedRangeSemantic(kind, value, to = null) {
    const fromSemantic = typedScalarSemantic(kind, value);
    const toSemantic = to === null || to === undefined || normalizeSpace(to) === '' ? '' : typedScalarSemantic(kind, to);
    return toSemantic ? `${fromSemantic}..${toSemantic}` : fromSemantic;
  }


  function reconciliationCriterionToken(item) {
    const id = item?.id;
    if (id !== null && id !== undefined && id !== '') return `ref:${canonicalValue(id)}`;
    const kind = normalizeSpace(item?.kind || 'String') || 'String';
    const value = item?.value ?? item?.display ?? '';
    const to = item?.to === null || item?.to === undefined ? null : item.to;
    return typedRangeSemantic(kind, value, to);
  }

  function reconciliationSemanticKey(row, structure) {
    const parts = [];
    const conditions = [...(structure?.conditions || [])]
      .sort((a, b) => canonicalValue(a?.criterionRowId || '').localeCompare(canonicalValue(b?.criterionRowId || '')));
    for (const condition of conditions) {
      const criterionId = condition?.criterionRowId;
      const tokens = (row?.values?.[criterionId] || [])
        .map(reconciliationCriterionToken)
        .sort();
      parts.push(`c:${canonicalValue(criterionId || '')}=[${tokens.join(',')}]`);
    }
    const functions = [...(structure?.functions || [])]
      .sort((a, b) => canonicalValue(a?.id || '').localeCompare(canonicalValue(b?.id || '')));
    for (const fn of functions) {
      const tokens = (row?.roles?.[fn?.id] || [])
        .map(item => `role:${canonicalValue(item?.id || '')}:${canonicalValue(item?.roleTypeId || '')}`)
        .sort();
      parts.push(`f:${canonicalValue(fn?.id || '')}=[${tokens.join(',')}]`);
    }
    return hashText(parts.join('|'));
  }

  function createMutationReceipt({ type, action, rowCardId, versionId, expectedRow, structure }) {
    const rowNumber = Number(action?.excelRow?.excelRow);
    return {
      type,
      excelRow: Number.isFinite(rowNumber) ? rowNumber : null,
      rowCardId: rowCardId ? String(rowCardId) : null,
      versionId: versionId ? String(versionId) : null,
      expectedSemanticKey: type === 'delete' ? null : reconciliationSemanticKey(expectedRow, structure),
    };
  }

  function looksTechnicalValue(value) {
    const text = normalizeSpace(value);
    if (!text) return true;
    return isGuidLike(text) || /^\$[A-Za-z0-9_.-]+$/.test(text) || /^[A-Z][A-Z0-9_.$-]{5,}$/.test(text);
  }

  function humanQualifierFromDetails(details, display = '') {
    const text = normalizeSpace(details);
    if (!text) return '';
    const preferred = [
      'KrDocTypeTitle', 'RoleFullName', 'FullName', 'Title', 'Caption', 'Description',
      'Code', 'INN', 'ИНН', 'KPP', 'КПП', 'ParentRoleName', 'TypeName'
    ];
    const parts = text.split('|').map(x => normalizeSpace(x)).filter(Boolean);
    const pairs = parts.map(part => {
      const index = part.indexOf(':');
      return index > 0 ? { key: normalizeSpace(part.slice(0, index)), value: normalizeSpace(part.slice(index + 1)) } : { key: '', value: part };
    });
    for (const key of preferred) {
      const found = pairs.find(pair => canonicalValue(pair.key) === canonicalValue(key) && pair.value && canonicalValue(pair.value) !== canonicalValue(display) && !looksTechnicalValue(pair.value));
      if (found) return found.value;
    }
    const fallback = pairs.find(pair => pair.value && canonicalValue(pair.value) !== canonicalValue(display) && !looksTechnicalValue(pair.value) && pair.value.length <= 140);
    return fallback?.value || '';
  }

  function knownRoleTypeId(value) {
    const text = normalizeSpace(value);
    if (!text) return null;
    const roleTypeId = Number(text);
    return Number.isInteger(roleTypeId) && roleTypeId >= 0 && roleTypeId <= 7 ? roleTypeId : null;
  }

  function definitionKey(kind, id) {
    return `${kind}:${canonicalValue(id)}`;
  }

  function splitCell(value) {
    const text = String(value ?? '').replace(/\r\n?/g, '\n').trim();
    if (!text) return [];
    return text
      .split(/\n+|;\s*/)
      .map(stripFormulaMarker)
      .filter(Boolean);
  }

  function sortedCanon(items) {
    return [...new Set((items || []).map(canonicalValue).filter(Boolean))].sort();
  }

  function arraysEqual(a, b) {
    const aa = sortedCanon(a);
    const bb = sortedCanon(b);
    return aa.length === bb.length && aa.every((x, i) => x === bb[i]);
  }

  function hashText(text) {
    let hash = 0x811c9dc5;
    const input = String(text ?? '');
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (`00000000${(hash >>> 0).toString(16)}`).slice(-8);
  }

  function stableObject(value) {
    if (Array.isArray(value)) return value.map(stableObject);
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = stableObject(value[key]);
        return acc;
      }, {});
    }
    return value;
  }

  function fingerprintFlat(flat) {
    const normalized = {};
    Object.keys(flat || {}).sort().forEach(key => {
      normalized[key] = sortedCanon(flat[key]);
    });
    return hashText(JSON.stringify(stableObject(normalized)));
  }

  // DELETE dependency matching has a different goal from stale/integrity fingerprints.
  // It must compare the semantic final row state, not the raw display representation.
  // Example: Excel Boolean «Да» and TESSA raw «true» are the same matrix value but have
  // different fingerprintFlat hashes. Keep fingerprintFlat exact for stale protection and
  // normalize typed values only for UPDATE/ADD -> DELETE dependency detection.
  function dependencySemanticKey(flat, structure) {
    const normalized = {};
    let definitionCount = 0;
    const semanticValue = (kind, value) => {
      if (['Boolean', 'Int', 'Decimal', 'Date', 'DateTime'].includes(kind)) {
        return typedScalarSemantic(kind, value);
      }
      const text = canonicalValue(value);
      return text ? `text:${text}` : '';
    };
    for (const condition of structure?.conditions || []) {
      definitionCount += 1;
      const key = definitionKey('criterion', condition.criterionRowId);
      const kind = operandKind({ kind: 'criterion', operandTypeId: condition.operandTypeId, refSection: condition.refSection });
      normalized[key] = (flat?.[key] || []).map(value => semanticValue(kind, value)).filter(Boolean).sort();
    }
    for (const fn of structure?.functions || []) {
      definitionCount += 1;
      const key = definitionKey('function', fn.id);
      normalized[key] = (flat?.[key] || []).map(value => semanticValue('Function', value)).filter(Boolean).sort();
    }
    return definitionCount ? JSON.stringify(stableObject(normalized)) : '';
  }

  function similarityFlat(a, b, keys) {
    let total = 0;
    let score = 0;
    for (const key of keys) {
      const aa = new Set(sortedCanon(a?.[key] || []));
      const bb = new Set(sortedCanon(b?.[key] || []));
      if (!aa.size && !bb.size) continue;
      total += 1;
      if (aa.size === bb.size && [...aa].every(x => bb.has(x))) {
        score += 1;
        continue;
      }
      const union = new Set([...aa, ...bb]);
      const intersection = [...aa].filter(x => bb.has(x)).length;
      score += union.size ? intersection / union.size : 0;
    }
    return total ? score / total : 0;
  }

  // ---------------------------------------------------------------------------
  // 3. XLSX: ЧТЕНИЕ ZIP/XML БЕЗ ВНЕШНИХ БИБЛИОТЕК
  // Excel-файл читается прямо в браузере: ZIP распаковывается, затем разбираются
  // workbook.xml, sharedStrings и листы. Это позволяет не загружать файл на сервер.
  // ---------------------------------------------------------------------------

  function xmlDecode(value) {
    return String(value ?? '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
  }

  function attr(tag, name) {
    const match = String(tag).match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
    return match ? xmlDecode(match[1]) : null;
  }

  function colToIndex(ref) {
    const letters = String(ref).replace(/[^A-Z]/gi, '').toUpperCase();
    let value = 0;
    for (const ch of letters) value = value * 26 + ch.charCodeAt(0) - 64;
    return Math.max(0, value - 1);
  }

  function findEocd(bytes) {
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) return i;
    }
    throw new Error('Не найден каталог ZIP внутри XLSX.');
  }

  function xlsxArchiveError(message) {
    return new Error(`XLSX отклонён: ${message}`);
  }

  function archiveLimitLabel(bytes) {
    const mib = Number(bytes) / (1024 * 1024);
    if (mib >= 1) return `${Number.isInteger(mib) ? mib : mib.toFixed(1)} МБ`;
    return `${Math.ceil(Number(bytes) / 1024)} КБ`;
  }

  function effectiveXlsxArchiveLimits() {
    // Tiny limits are injectable only in Node regression tests. The browser always uses
    // the immutable production ceilings above, even if a page defines a similarly named global.
    const isNodeTest = Boolean(
      window.__TESSA_MATRIX_SYNC_TEST_MODE__
      && typeof process !== 'undefined'
      && process?.versions?.node
      && window.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__,
    );
    if (!isNodeTest) return XLSX_ARCHIVE_LIMITS;
    const limits = { ...XLSX_ARCHIVE_LIMITS };
    for (const key of Object.keys(limits)) {
      const value = Number(window.__TESSA_MATRIX_SYNC_TEST_ARCHIVE_LIMITS__[key]);
      if (Number.isFinite(value) && value > 0) limits[key] = Math.floor(value);
    }
    return limits;
  }

  function ensureZipRange(length, offset, size, label) {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > length) {
      throw xlsxArchiveError(`${label} выходит за границы файла.`);
    }
  }

  function parseZipExtra(extra, label) {
    let offset = 0;
    while (offset < extra.length) {
      if (offset + 4 > extra.length) throw xlsxArchiveError(`повреждены служебные данные ZIP для ${label}.`);
      const view = new DataView(extra.buffer, extra.byteOffset + offset, extra.byteLength - offset);
      const id = view.getUint16(0, true);
      const size = view.getUint16(2, true);
      if (offset + 4 + size > extra.length) throw xlsxArchiveError(`повреждены служебные данные ZIP для ${label}.`);
      if (id === 0x0001) throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
      offset += 4 + size;
    }
  }

  function validateArchivePath(name) {
    const raw = String(name ?? '');
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); }
    catch (_) { throw xlsxArchiveError(`небезопасный путь внутри архива: ${raw || '(пусто)'}.`); }
    for (const candidate of [raw, decoded]) {
      if (!candidate || candidate.includes('\0') || candidate.includes('\\') || candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) {
        throw xlsxArchiveError(`небезопасный путь внутри архива: ${raw || '(пусто)'}.`);
      }
      const segments = candidate.split('/');
      if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
        throw xlsxArchiveError(`небезопасный путь внутри архива: ${raw}.`);
      }
    }
    return { name: raw, key: decoded.toLowerCase() };
  }

  async function inflateRawLimited(data, descriptor, limits, actualState) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Браузер не поддерживает DecompressionStream. Нужен актуальный Chrome/Edge.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let entryTotal = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        entryTotal += chunk.byteLength;
        actualState.total += chunk.byteLength;
        if (entryTotal > limits.MaxEntryUncompressedBytes) {
          try { await reader.cancel(); } catch (_) { /* already closing */ }
          throw xlsxArchiveError(`распакованный размер файла ${descriptor.name} превышает безопасный лимит ${archiveLimitLabel(limits.MaxEntryUncompressedBytes)}.`);
        }
        if (actualState.total > limits.MaxTotalUncompressedBytes) {
          try { await reader.cancel(); } catch (_) { /* already closing */ }
          throw xlsxArchiveError(`суммарный распакованный размер превышает безопасный лимит ${archiveLimitLabel(limits.MaxTotalUncompressedBytes)}.`);
        }
        const actualRatio = descriptor.compressedSize > 0 ? entryTotal / descriptor.compressedSize : (entryTotal ? Infinity : 1);
        if (actualRatio > limits.MaxCompressionRatio) {
          try { await reader.cancel(); } catch (_) { /* already closing */ }
          throw xlsxArchiveError(`подозрительная степень сжатия файла ${descriptor.name} превышает ${limits.MaxCompressionRatio}×.`);
        }
        chunks.push(chunk);
      }
    } catch (error) {
      if (String(error?.message || '').startsWith('XLSX отклонён:')) throw error;
      throw xlsxArchiveError(`не удалось безопасно распаковать ${descriptor.name}: ${error?.message || error}.`);
    } finally {
      try { reader.releaseLock(); } catch (_) { /* no-op */ }
    }
    const output = new Uint8Array(entryTotal);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  async function unzipArrayBuffer(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const limits = effectiveXlsxArchiveLimits();
    if (bytes.byteLength > limits.MaxInputBytes) {
      throw xlsxArchiveError(`размер файла превышает безопасный лимит ${archiveLimitLabel(limits.MaxInputBytes)}.`);
    }
    if (bytes.byteLength < 22) throw xlsxArchiveError('файл слишком мал и не содержит корректный ZIP-каталог.');

    const view = new DataView(arrayBuffer);
    let eocd;
    try { eocd = findEocd(bytes); }
    catch (_) { throw xlsxArchiveError('не найден корректный ZIP-каталог внутри XLSX.'); }
    ensureZipRange(bytes.length, eocd, 22, 'конец ZIP-каталога');
    const diskNumber = view.getUint16(eocd + 4, true);
    const centralDisk = view.getUint16(eocd + 6, true);
    const entriesOnDisk = view.getUint16(eocd + 8, true);
    const count = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    const commentLength = view.getUint16(eocd + 20, true);

    if (eocd + 22 + commentLength !== bytes.length) throw xlsxArchiveError('повреждён конец ZIP-каталога или обнаружены лишние данные после него.');
    if (eocd >= 20 && view.getUint32(eocd - 20, true) === 0x07064b50) {
      throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
    }
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== count) throw xlsxArchiveError('многотомные ZIP-архивы не поддерживаются.');
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
    }
    if (count > limits.MaxEntries) throw xlsxArchiveError(`слишком много файлов внутри архива (${count} > ${limits.MaxEntries}).`);
    ensureZipRange(bytes.length, centralOffset, centralSize, 'центральный ZIP-каталог');
    if (centralOffset + centralSize !== eocd) throw xlsxArchiveError('повреждён центральный ZIP-каталог или его границы не совпадают с EOCD.');

    const decoder = new TextDecoder('utf-8');
    const descriptors = [];
    const seenPaths = new Set();
    let offset = centralOffset;
    let declaredTotal = 0;
    let declaredCompressedTotal = 0;

    for (let index = 0; index < count; index += 1) {
      ensureZipRange(bytes.length, offset, 46, 'запись центрального ZIP-каталога');
      if (offset + 46 > eocd || view.getUint32(offset, true) !== 0x02014b50) throw xlsxArchiveError('повреждён центральный каталог XLSX.');
      const versionNeeded = view.getUint16(offset + 6, true);
      const flags = view.getUint16(offset + 8, true);
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLengthEntry = view.getUint16(offset + 32, true);
      const diskStart = view.getUint16(offset + 34, true);
      const localOffset = view.getUint32(offset + 42, true);
      const recordLength = 46 + nameLength + extraLength + commentLengthEntry;
      ensureZipRange(bytes.length, offset, recordLength, 'запись центрального ZIP-каталога');
      if (offset + recordLength > eocd) throw xlsxArchiveError('запись центрального ZIP-каталога выходит за его границы.');
      if (versionNeeded >= 45 && (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff)) {
        throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
      }
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff || diskStart === 0xffff) {
        throw xlsxArchiveError('ZIP64 не поддерживается. Сохраните файл как обычный XLSX.');
      }
      if (flags & 0x2041) throw xlsxArchiveError('зашифрованные ZIP-файлы не поддерживаются.');
      if (![0, 8].includes(method)) throw xlsxArchiveError(`неподдерживаемый метод сжатия ${method}.`);

      const nameStart = offset + 46;
      const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
      const pathInfo = validateArchivePath(name);
      if (seenPaths.has(pathInfo.key)) throw xlsxArchiveError(`дублирующийся путь внутри архива: ${name}.`);
      seenPaths.add(pathInfo.key);
      const centralExtra = bytes.slice(nameStart + nameLength, nameStart + nameLength + extraLength);
      parseZipExtra(centralExtra, name);

      if (uncompressedSize > limits.MaxEntryUncompressedBytes) {
        throw xlsxArchiveError(`распакованный размер файла ${name} превышает безопасный лимит ${archiveLimitLabel(limits.MaxEntryUncompressedBytes)}.`);
      }
      declaredTotal += uncompressedSize;
      declaredCompressedTotal += compressedSize;
      if (declaredTotal > limits.MaxTotalUncompressedBytes) {
        throw xlsxArchiveError(`суммарный распакованный размер превышает безопасный лимит ${archiveLimitLabel(limits.MaxTotalUncompressedBytes)}.`);
      }
      const declaredRatio = compressedSize > 0 ? uncompressedSize / compressedSize : (uncompressedSize ? Infinity : 1);
      if (declaredRatio > limits.MaxCompressionRatio) {
        throw xlsxArchiveError(`подозрительная степень сжатия файла ${name} превышает ${limits.MaxCompressionRatio}×.`);
      }

      ensureZipRange(bytes.length, localOffset, 30, `локальный заголовок ${name}`);
      if (localOffset + 30 > centralOffset || view.getUint32(localOffset, true) !== 0x04034b50) throw xlsxArchiveError(`повреждён локальный заголовок файла ${name}.`);
      const localFlags = view.getUint16(localOffset + 6, true);
      const localMethod = view.getUint16(localOffset + 8, true);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const localHeaderLength = 30 + localNameLength + localExtraLength;
      ensureZipRange(bytes.length, localOffset, localHeaderLength, `локальный заголовок ${name}`);
      if (localOffset + localHeaderLength > centralOffset) throw xlsxArchiveError(`локальный заголовок файла ${name} пересекает центральный каталог.`);
      if (localFlags & 0x2041) throw xlsxArchiveError('зашифрованные ZIP-файлы не поддерживаются.');
      if (localMethod !== method) throw xlsxArchiveError(`метод сжатия файла ${name} не совпадает между ZIP-заголовками.`);
      const localNameStart = localOffset + 30;
      const localName = decoder.decode(bytes.slice(localNameStart, localNameStart + localNameLength));
      if (validateArchivePath(localName).key !== pathInfo.key) throw xlsxArchiveError(`имя файла ${name} не совпадает между ZIP-заголовками.`);
      const localExtra = bytes.slice(localNameStart + localNameLength, localNameStart + localNameLength + localExtraLength);
      parseZipExtra(localExtra, name);
      const dataStart = localOffset + localHeaderLength;
      ensureZipRange(bytes.length, dataStart, compressedSize, `сжатые данные ${name}`);
      if (dataStart + compressedSize > centralOffset) throw xlsxArchiveError(`сжатые данные файла ${name} пересекают центральный ZIP-каталог.`);

      descriptors.push({
        name,
        method,
        compressedSize,
        uncompressedSize,
        compressed: bytes.slice(dataStart, dataStart + compressedSize),
      });
      offset += recordLength;
    }

    if (offset !== centralOffset + centralSize) throw xlsxArchiveError('размер центрального ZIP-каталога не совпадает с количеством записей.');
    const totalDeclaredRatio = declaredCompressedTotal > 0 ? declaredTotal / declaredCompressedTotal : (declaredTotal ? Infinity : 1);
    if (totalDeclaredRatio > limits.MaxCompressionRatio) {
      throw xlsxArchiveError(`суммарная степень сжатия архива превышает ${limits.MaxCompressionRatio}×.`);
    }

    const decoded = [];
    const actualState = { total: 0 };
    for (const descriptor of descriptors) {
      let raw;
      if (descriptor.method === 0) {
        if (descriptor.compressedSize !== descriptor.uncompressedSize) {
          throw xlsxArchiveError(`размер несжатого файла ${descriptor.name} не совпадает с ZIP-каталогом.`);
        }
        raw = descriptor.compressed;
        actualState.total += raw.byteLength;
        if (actualState.total > limits.MaxTotalUncompressedBytes) {
          throw xlsxArchiveError(`суммарный распакованный размер превышает безопасный лимит ${archiveLimitLabel(limits.MaxTotalUncompressedBytes)}.`);
        }
      } else {
        raw = await inflateRawLimited(descriptor.compressed, descriptor, limits, actualState);
      }
      if (raw.byteLength !== descriptor.uncompressedSize) {
        throw xlsxArchiveError(`фактический распакованный размер файла ${descriptor.name} не совпадает с ZIP-каталогом.`);
      }
      decoded.push([descriptor.name, raw]);
    }
    return new Map(decoded);
  }

  const BUILTIN_EXCEL_DATE_FORMAT_IDS = new Set([
    14, 15, 16, 17, 18, 19, 20, 21, 22,
    27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
    45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  ]);

  function excelNumberFormatKind(numFmtId, formatCode = '') {
    const id = Number(numFmtId);
    if (id === 49) return 'text';
    if (BUILTIN_EXCEL_DATE_FORMAT_IDS.has(id)) return 'date';
    if (id === 9 || id === 10) return 'percent';
    if (id === 11 || id === 48) return 'scientific';
    if (id === 12 || id === 13) return 'fraction';
    const code = String(formatCode || '').trim();
    if (!code) return 'general';
    if (code === '@') return 'text';
    const semantic = code
      .replace(/"(?:[^"]|"")*"/g, '')
      .replace(/\\./g, '')
      .replace(/[_*]./g, '')
      .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/gi, '')
      .toLowerCase();
    if (/am\/pm|a\/p|\[h+\]|\[m+\]|\[s+\]|y+|d+|h+|s+/.test(semantic)) return 'date';
    if (/m+/.test(semantic) && /[\/-]/.test(semantic)) return 'date';
    if (/%/.test(semantic)) return 'percent';
    if (/[0#?]+\s*e[+-]?[0#?]+/i.test(semantic)) return 'scientific';
    if (/[#0?]+\s+[#0?]+\/[#0?]+/.test(semantic)) return 'fraction';
    return 'general';
  }

  function parseStylesXml(xml) {
    if (!xml) return [];
    const customFormats = new Map();
    for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?numFmt\b([^>]*?)(?:\/\s*>|>)/gi)) {
      const id = Number(attr(match[1], 'numFmtId'));
      const code = attr(match[1], 'formatCode') || '';
      if (Number.isInteger(id) && id >= 0) customFormats.set(id, code);
    }
    const cellXfsMatch = xml.match(/<(?:[A-Za-z_][\w.-]*:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?cellXfs>/i);
    if (!cellXfsMatch) return [];
    const styles = [];
    for (const match of cellXfsMatch[1].matchAll(/<(?:[A-Za-z_][\w.-]*:)?xf\b([^>]*?)(?:\/\s*>|>)/gi)) {
      const numFmtId = Number(attr(match[1], 'numFmtId') || 0);
      const formatCode = customFormats.get(numFmtId) || '';
      styles.push({ numFmtId, formatCode, numberFormatKind: excelNumberFormatKind(numFmtId, formatCode) });
    }
    return styles;
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const items = [];
    const itemRegex = /<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/gi;
    const textRegex = /<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gi;
    for (const si of xml.matchAll(itemRegex)) {
      const parts = [...si[1].matchAll(textRegex)].map(x => xmlDecode(x[1]));
      items.push(parts.join(''));
    }
    return items;
  }

  function resolveOpcRelationshipTarget(sourcePart, target) {
    const raw = String(target || '').trim().replace(/\\/g, '/');
    if (!raw) return '';
    // Worksheet relationships must stay inside the OPC package. External URI schemes
    // are not valid worksheet parts and must not be rewritten into a guessed ZIP path.
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) || raw.startsWith('//')) {
      throw xlsxArchiveError(`внешняя ссылка Relationship «${raw}» не может использоваться как лист XLSX.`);
    }
    const source = String(sourcePart || '').replace(/^\/+/, '');
    const base = source.includes('/') ? source.slice(0, source.lastIndexOf('/') + 1) : '';
    const combined = raw.startsWith('/') ? raw.slice(1) : `${base}${raw}`;
    const parts = [];
    for (const part of combined.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!parts.length) throw xlsxArchiveError(`Relationship «${raw}» выходит за предел корня XLSX-пакета.`);
        parts.pop();
        continue;
      }
      parts.push(part);
    }
    if (!parts.length) throw xlsxArchiveError(`Relationship «${raw}» не указывает на часть XLSX-пакета.`);
    return parts.join('/');
  }

  function parseWorkbookSheets(entries, decoder) {
    const workbookPath = 'xl/workbook.xml';
    const workbook = decoder.decode(entries.get(workbookPath) || new Uint8Array());
    const rels = decoder.decode(entries.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
    const relationships = new Map();
    for (const match of rels.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gi)) {
      const id = attr(match[1], 'Id');
      const target = attr(match[1], 'Target');
      const targetMode = attr(match[1], 'TargetMode');
      if (id && target) relationships.set(id, { target, targetMode });
    }
    const sheets = [];
    for (const match of workbook.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/gi)) {
      const sheetName = attr(match[1], 'name') || `Лист${sheets.length + 1}`;
      const relId = attr(match[1], 'r:id') || attr(match[1], 'id');
      const relationship = relationships.get(relId);
      if (canonicalValue(relationship?.targetMode) === 'external') {
        throw xlsxArchiveError(`Relationship ${relId || ''} имеет TargetMode=External и не может использоваться как лист XLSX.`);
      }
      const target = relationship?.target || `worksheets/sheet${sheets.length + 1}.xml`;
      const normalized = resolveOpcRelationshipTarget(workbookPath, target);
      sheets.push({ name: sheetName, path: normalized, relId });
    }
    return sheets.length ? sheets : [{ name: 'Лист1', path: 'xl/worksheets/sheet1.xml', relId: 'rId1' }];
  }

  function effectiveSpreadsheetMlLimits() {
    // Tests may inject tiny limits only in Node. A TESSA page cannot weaken production ceilings.
    const isNodeTest = Boolean(
      window.__TESSA_MATRIX_SYNC_TEST_MODE__
      && typeof process !== 'undefined'
      && process?.versions?.node
      && window.__TESSA_MATRIX_SYNC_TEST_SPREADSHEET_LIMITS__,
    );
    if (!isNodeTest) return SPREADSHEETML_LIMITS;
    const limits = { ...SPREADSHEETML_LIMITS };
    for (const key of Object.keys(limits)) {
      const value = Number(window.__TESSA_MATRIX_SYNC_TEST_SPREADSHEET_LIMITS__[key]);
      if (Number.isFinite(value) && value > 0) limits[key] = Math.floor(value);
    }
    return limits;
  }

  function spreadsheetRowNumber(raw, fallback, limits) {
    const hasExplicit = raw !== null && raw !== undefined && String(raw).trim() !== '';
    const text = hasExplicit ? String(raw).trim() : String(fallback);
    if (!/^[1-9]\d*$/.test(text)) throw xlsxArchiveError(`некорректный номер строки «${text || '(пусто)'}» в SpreadsheetML.`);
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < 1) throw xlsxArchiveError(`некорректный номер строки «${text}» в SpreadsheetML.`);
    if (value > limits.MaxRowNumber) throw xlsxArchiveError(`номер строки ${value} превышает безопасный лимит ${limits.MaxRowNumber}.`);
    return value;
  }

  function spreadsheetColumnNumber(letters) {
    let value = 0;
    for (const ch of String(letters).toUpperCase()) value = value * 26 + ch.charCodeAt(0) - 64;
    return value;
  }

  function spreadsheetCellCoordinate(rawRef, rowNumber, inferredCol, limits) {
    const raw = rawRef === null || rawRef === undefined ? '' : String(rawRef).trim();
    if (!raw) {
      const columnNumber = inferredCol + 1;
      if (columnNumber > limits.MaxColumnNumber) throw xlsxArchiveError('число столбцов SpreadsheetML превышает предел Excel XFD (16 384).');
      return { col: inferredCol, key: `${rowNumber}:${inferredCol}`, label: `столбец ${columnNumber}` };
    }
    const match = raw.match(/^([A-Za-z]{1,3})([1-9]\d*)$/);
    if (!match) throw xlsxArchiveError(`некорректная координата ячейки «${raw}» в SpreadsheetML.`);
    const columnNumber = spreadsheetColumnNumber(match[1]);
    const cellRow = Number(match[2]);
    if (!Number.isSafeInteger(cellRow) || cellRow < 1 || cellRow > limits.MaxRowNumber) {
      throw xlsxArchiveError(`координата ячейки «${raw}» содержит недопустимый номер строки.`);
    }
    if (columnNumber < 1 || columnNumber > limits.MaxColumnNumber) {
      throw xlsxArchiveError(`столбец «${match[1].toUpperCase()}» выходит за предел Excel XFD (16 384).`);
    }
    if (cellRow !== rowNumber) {
      throw xlsxArchiveError(`координата ячейки «${raw}» указывает на строку ${cellRow}, но находится внутри строки ${rowNumber}.`);
    }
    const col = columnNumber - 1;
    return { col, key: `${rowNumber}:${col}`, label: raw.toUpperCase() };
  }

  function parseSheetXml(xml, sharedStrings, styles = []) {
    const limits = effectiveSpreadsheetMlLimits();
    const rows = [];
    const cellMeta = [];
    const seenRows = new Set();
    const seenCells = new Set();
    let maxCol = 0;
    let parsedRowCount = 0;
    let parsedCellCount = 0;
    let nextImplicitRow = 1;

    const rowRegex = /<(?:[A-Za-z_][\w.-]*:)?row\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>)/gi;
    for (const rowMatch of xml.matchAll(rowRegex)) {
      parsedRowCount += 1;
      if (parsedRowCount > limits.MaxParsedRows) {
        throw xlsxArchiveError(`слишком много строк SpreadsheetML (${parsedRowCount} > ${limits.MaxParsedRows}).`);
      }
      const explicitRow = attr(rowMatch[1], 'r');
      const rowNumber = spreadsheetRowNumber(explicitRow, nextImplicitRow, limits);
      nextImplicitRow = Math.max(nextImplicitRow, rowNumber + 1);
      if (seenRows.has(rowNumber)) throw xlsxArchiveError(`дублирующийся номер строки ${rowNumber} в SpreadsheetML.`);
      seenRows.add(rowNumber);

      const values = [];
      const metaValues = [];
      const body = rowMatch[2] || '';
      let nextImplicitCol = 0;
      // В Excel пустая ячейка часто сериализуется как <c .../>. Обрабатываем
      // self-closing и обычную формы одинаково, но координаты проверяем до записи.
      const cellRegex = /<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>)/gi;
      for (const cellMatch of body.matchAll(cellRegex)) {
        parsedCellCount += 1;
        if (parsedCellCount > limits.MaxParsedCells) {
          throw xlsxArchiveError(`слишком много ячеек SpreadsheetML (${parsedCellCount} > ${limits.MaxParsedCells}).`);
        }
        const attrs = cellMatch[1] || '';
        const cellBody = cellMatch[2] || '';
        const coordinate = spreadsheetCellCoordinate(attr(attrs, 'r'), rowNumber, nextImplicitCol, limits);
        if (seenCells.has(coordinate.key)) throw xlsxArchiveError(`дублирующаяся координата ячейки ${coordinate.label} в SpreadsheetML.`);
        seenCells.add(coordinate.key);
        nextImplicitCol = Math.max(nextImplicitCol, coordinate.col + 1);

        const type = attr(attrs, 't') || '';
        const styleIndexRaw = attr(attrs, 's');
        const styleIndex = styleIndexRaw === null ? 0 : Number(styleIndexRaw);
        const style = Number.isInteger(styleIndex) && styleIndex >= 0 ? (styles[styleIndex] || null) : null;
        // Formula nodes can contain an expression (<f>1+1</f>) or be self-closing
        // for shared formulas (<f t="shared" si="0"/>). Both mean the cached <v>
        // is formula output, never a user-entered scalar that may be applied to TESSA.
        const formulaMatch = cellBody.match(/<(?:[A-Za-z_][\w.-]*:)?f\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?f>)/i);
        metaValues[coordinate.col] = {
          styleIndex: Number.isInteger(styleIndex) && styleIndex >= 0 ? styleIndex : 0,
          numFmtId: style?.numFmtId ?? 0,
          formatCode: style?.formatCode || '',
          numberFormatKind: style?.numberFormatKind || 'general',
          rawType: type || 'n',
          hasFormula: Boolean(formulaMatch),
          formula: formulaMatch ? xmlDecode(formulaMatch[2] || '') : '',
        };
        let value = '';
        const inline = cellBody.match(/<(?:[A-Za-z_][\w.-]*:)?is\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?is>/i);
        if (inline) value = [...inline[1].matchAll(/<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gi)].map(x => xmlDecode(x[1])).join('');
        else {
          const v = cellBody.match(/<(?:[A-Za-z_][\w.-]*:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/i);
          if (v) {
            const raw = xmlDecode(v[1]);
            if (type === 's') {
              const indexText = String(raw).trim();
              if (!/^(?:0|[1-9]\d*)$/.test(indexText)) {
                throw xlsxArchiveError(`некорректный индекс общей строки «${indexText || '(пусто)'}» в sharedStrings.`);
              }
              const sharedIndex = Number(indexText);
              if (!Number.isSafeInteger(sharedIndex) || sharedIndex < 0 || sharedIndex >= sharedStrings.length) {
                throw xlsxArchiveError(`индекс общей строки ${indexText} выходит за предел таблицы sharedStrings (${sharedStrings.length}).`);
              }
              value = sharedStrings[sharedIndex];
            } else value = raw;
          }
        }
        values[coordinate.col] = value;
        maxCol = Math.max(maxCol, coordinate.col + 1);
      }
      rows[rowNumber - 1] = values;
      cellMeta[rowNumber - 1] = metaValues;
    }
    // Keep missing rows as sparse-array holes. The numeric indexes are still bounded by
    // MaxRowNumber, while avoiding one allocated empty Array for every absent row.
    return { rows, maxCol, cellMeta };
  }

  function findHeaderRow(rows) {
    let best = { index: -1, score: -1 };
    rows.forEach((row, index) => {
      const nonEmpty = row.filter(x => normalizeSpace(x)).length;
      const text = row.map(normalizeSpace).join(' ').toLowerCase();
      const signals = ['✅', '❌', 'рассмотр', 'регистрац', 'подписан', 'согласован', 'организац', 'сегмент'];
      const signalScore = signals.reduce((n, token) => n + (text.includes(token) ? 4 : 0), 0);
      const score = nonEmpty + signalScore;
      if (nonEmpty >= 3 && score > best.score) best = { index, score };
    });
    if (best.index < 0) throw new Error('Не удалось найти строку заголовков матрицы в Excel.');
    return best.index;
  }

  function readMetadataPairs(rows, endExclusive = 30) {
    const metadata = {};
    const limit = Math.min(rows.length, endExclusive);
    for (let r = 0; r < limit; r += 1) {
      const key = normalizeSpace(rows[r]?.[0]);
      const value = normalizeSpace(rows[r]?.[1]);
      if (key) metadata[key] = value;
    }
    return metadata;
  }

  function rowsToObjects(parsed) {
    const headers = (parsed.rows[0] || []).map(normalizeSpace);
    return (parsed.rows || []).slice(1).filter(row => row.some(value => normalizeSpace(value))).map((row, index) => {
      const object = { __row: index + 2 };
      headers.forEach((header, col) => { if (header) object[header] = row[col] ?? ''; });
      return object;
    });
  }

  function parseBaselineData(row) {
    const keys = Object.keys(row).filter(key => /^BaseData\d+$/.test(key)).sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
    const text = keys.map(key => row[key] || '').join('');
    if (!text) return {};
    try {
      const base = JSON.parse(text);
      if (!base || typeof base.flat !== 'object' || !base.values || !base.roles || fingerprintFlat(base.flat) !== normalizeSpace(row.BaseFingerprint)) throw new Error('fingerprint');
      return { base };
    } catch (_) { throw new Error('Повреждены исходные значения Excel для объединения. Скачайте свежую выгрузку.'); }
  }

  function parseBaselineRows(parsedSheets) {
    const baselineSheet = parsedSheets.get(ROUNDTRIP.BaselineSheet);
    if (!baselineSheet) return [];
    const rows = rowsToObjects(baselineSheet).map(row => ({
      rowCardId: normalizeSpace(row['MatrixRowID']),
      versionId: normalizeSpace(row['MatrixVersionID']),
      baseFingerprint: normalizeSpace(row['BaseFingerprint']),
      ...parseBaselineData(row),
    })).filter(row => row.rowCardId || row.versionId);
    const seen = new Set();
    for (const row of rows) {
      const key = `v:${canonicalValue(row.versionId)}|c:${canonicalValue(row.rowCardId)}`;
      if (seen.has(key)) throw new Error('Повреждён baseline-ledger Excel: обнаружена повторяющаяся исходная identity. Скачайте свежую выгрузку.');
      if (!row.baseFingerprint) throw new Error('Повреждён baseline-ledger Excel: отсутствует fingerprint исходной строки. Скачайте свежую выгрузку.');
      seen.add(key);
    }
    return rows;
  }

  function parseEmbeddedDictionaryCatalog(parsedSheets) {
    const dictionarySheet = parsedSheets.get(ROUNDTRIP.DictionarySheet);
    const structureSheet = parsedSheets.get(ROUNDTRIP.StructureSheet);
    if (!dictionarySheet || !structureSheet) return null;
    const structureRows = rowsToObjects(structureSheet);
    const dictionaryRows = rowsToObjects(dictionarySheet);
    const columnCatalogIds = {};
    for (const row of structureRows) {
      const key = normalizeSpace(row['Ключ столбца']);
      const catalogId = normalizeSpace(row['CatalogID']);
      if (key && catalogId) columnCatalogIds[key] = catalogId;
    }
    const catalogs = {};
    for (const row of dictionaryRows) {
      const catalogId = normalizeSpace(row['CatalogID']);
      if (!catalogId) continue;
      if (!catalogs[catalogId]) catalogs[catalogId] = {
        id: catalogId,
        label: normalizeSpace(row['Словарь']),
        sourceView: normalizeSpace(row['Источник']),
        entries: [],
      };
      catalogs[catalogId].entries.push({
        selector: String(row['Выбор в Excel'] ?? '').trim(),
        previousSelectors: (() => { try { const values = JSON.parse(row['Прежние названия'] || '[]'); return Array.isArray(values) ? values.filter(v => typeof v === 'string') : []; } catch (_) { return []; } })(),
        display: String(row['Отображение'] ?? '').trim(),
        id: normalizeSpace(row['ID']),
        roleTypeId: normalizeSpace(row['RoleTypeID']),
        source: normalizeSpace(row['Источник']),
        status: normalizeSpace(row['Статус']) || 'Доступно',
        details: normalizeSpace(row['Доп. данные']),
        searchText: normalizeSpace(row['Поисковый текст']),
      });
    }
    return { version: 2, catalogs, columnCatalogIds };
  }

  const WORKBOOK_ARCHIVES = new WeakMap();

  async function readXlsxArrayBuffer(arrayBuffer, fileName = 'matrix.xlsx') {
    const entries = await unzipArrayBuffer(arrayBuffer);
    const decoder = new TextDecoder('utf-8');
    const shared = parseSharedStrings(entries.has('xl/sharedStrings.xml') ? decoder.decode(entries.get('xl/sharedStrings.xml')) : '');
    const styles = parseStylesXml(entries.has('xl/styles.xml') ? decoder.decode(entries.get('xl/styles.xml')) : '');
    const sheetDescriptors = parseWorkbookSheets(entries, decoder);
    const parsedSheets = new Map();
    for (const descriptor of sheetDescriptors) {
      const raw = entries.get(descriptor.path);
      if (!raw) continue;
      parsedSheets.set(descriptor.name, parseSheetXml(decoder.decode(raw), shared, styles));
    }
    const roundtripSheets = sheetDescriptors.filter(item => ROUNDTRIP.AcceptedFormats.includes(readMetadataPairs(parsedSheets.get(item.name)?.rows || [], 40)[ROUNDTRIP.FormatKey]));
    if (roundtripSheets.length > 1) throw new Error('В книге несколько листов матрицы TESSA. Оставьте один рабочий лист и повторите проверку.');
    if (!roundtripSheets.length && ['01_ACTIVE', '05_GOLD', '07_RESULTS'].every(name => parsedSheets.has(name))) {
      throw new Error('Выбран UAT-чеклист, а не матрица TESSA. Откройте его отдельно для отметок тестирования. В Studio загрузите рабочий Excel, полученный кнопкой «Скачать Excel».');
    }
    const matrixDescriptor = roundtripSheets[0] || sheetDescriptors.find(item => canonicalValue(item.name) === canonicalValue('Матрица')) || sheetDescriptors[0];
    const parsed = parsedSheets.get(matrixDescriptor.name);
    if (!parsed) throw new Error(`Не найден лист ${matrixDescriptor.path} в XLSX.`);
    const preliminaryMetadata = readMetadataPairs(parsed.rows, 40);
    const declaredHeaderRow = Number(preliminaryMetadata[ROUNDTRIP.HeaderRowKey] || 0);
    const headerRowIndex = declaredHeaderRow > 0 && declaredHeaderRow <= parsed.rows.length
      ? declaredHeaderRow - 1
      : findHeaderRow(parsed.rows);
    const headers = parsed.rows[headerRowIndex].map(normalizeSpace);
    const lastMeaningful = Math.max(headers.length, parsed.maxCol);
    const trimmedHeaders = Array.from({ length: lastMeaningful }, (_, i) => headers[i] || '');
    const metadata = readMetadataPairs(parsed.rows, headerRowIndex);
    const declaredSchemaRow = Number(metadata[ROUNDTRIP.SchemaRowKey] || 0);
    const schemaRowIndex = declaredSchemaRow > 0 && declaredSchemaRow <= parsed.rows.length
      ? declaredSchemaRow - 1
      : -1;
    const schemaTokens = schemaRowIndex >= 0
      ? Array.from({ length: lastMeaningful }, (_, i) => normalizeSpace(parsed.rows[schemaRowIndex]?.[i] || ''))
      : [];
    const data = [];
    for (let r = headerRowIndex + 1; r < parsed.rows.length; r += 1) {
      const source = parsed.rows[r] || [];
      const values = Array.from({ length: lastMeaningful }, (_, i) => source[i] ?? '');
      const cellMeta = Array.from({ length: lastMeaningful }, (_, i) => parsed.cellMeta?.[r]?.[i] || null);
      if (values.some(v => normalizeSpace(v))) data.push({ excelRow: r + 1, values, cellMeta });
    }
    const format = metadata[ROUNDTRIP.FormatKey] || null;
    const workbook = {
      fileName,
      sheetName: matrixDescriptor.name,
      sheetNames: [...parsedSheets.keys()],
      headerRow: headerRowIndex + 1,
      schemaRow: schemaRowIndex >= 0 ? schemaRowIndex + 1 : null,
      headers: trimmedHeaders,
      schemaTokens,
      rows: data,
      metadata,
      parsedSheets,
      dictionaryCatalog: parseEmbeddedDictionaryCatalog(parsedSheets),
      roundtrip: {
        enabled: ROUNDTRIP.AcceptedFormats.includes(format),
        format,
        matrixId: metadata[ROUNDTRIP.MatrixIdKey] || null,
        templateId: metadata[ROUNDTRIP.TemplateIdKey] || null,
        previousVersionId: metadata[ROUNDTRIP.PreviousVersionIdKey] || null,
        templateMode: metadata[ROUNDTRIP.TemplateModeKey] || null,
        baselineRows: parseBaselineRows(parsedSheets),
      },
    };
    WORKBOOK_ARCHIVES.set(workbook, entries);
    return workbook;
  }



  function xmlEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function indexToCol(index) {
    let n = Number(index) + 1;
    let result = '';
    while (n > 0) {
      const remainder = (n - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }

  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  async function deflateRaw(bytes) {
    try {
      if (typeof CompressionStream !== 'function') return null;
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (_) {
      return null;
    }
  }

  async function makeZip(entries) {
    const encoder = new TextEncoder();
    const now = new Date();
    const year = Math.max(1980, now.getFullYear());
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const prepared = await mapConcurrent(entries, PERFORMANCE.ZipConcurrency, async ([name, value]) => {
      const data = value instanceof Uint8Array ? value : encoder.encode(String(value));
      const deflated = await deflateRaw(data);
      const compressed = deflated && deflated.length < data.length ? deflated : data;
      return { name, data, compressed, method: compressed === data ? 0 : 8, crc: crc32(data) };
    });

    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    for (const entry of prepared) {
      const nameBytes = encoder.encode(entry.name);
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034B50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, entry.method, true);
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, entry.crc, true);
      lv.setUint32(18, entry.compressed.length, true);
      lv.setUint32(22, entry.data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      localParts.push(local, entry.compressed);

      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014B50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, entry.method, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, entry.crc, true);
      cv.setUint32(20, entry.compressed.length, true);
      cv.setUint32(24, entry.data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, localOffset, true);
      central.set(nameBytes, 46);
      centralParts.push(central);
      localOffset += local.length + entry.compressed.length;
    }

    const centralDirectory = concatBytes(centralParts);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054B50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, prepared.length, true);
    ev.setUint16(10, prepared.length, true);
    ev.setUint32(12, centralDirectory.length, true);
    ev.setUint32(16, localOffset, true);
    ev.setUint16(20, 0, true);
    return concatBytes([...localParts, centralDirectory, eocd]);
  }

  // ---------------------------------------------------------------------------
  // 4. XLSX: НИЗКОУРОВНЕВАЯ ЗАПИСЬ
  // Небольшие helpers для формирования XML-ячеек и ZIP-частей будущего .xlsx.
  // Сборка полной roundtrip-книги находится ниже, после блока справочников.
  // ---------------------------------------------------------------------------

  function xlsxStringCell(row, col, value, style = 0) {
    if (value === null || value === undefined || String(value) === '') return '';
    const ref = `${indexToCol(col)}${row}`;
    return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }



  // ---------------------------------------------------------------------------
  // 5. СПРАВОЧНИКИ
  // Каталог справочников нормализуется и кэшируется. При поиске сначала используется
  // точный ID, затем однозначное название. Неоднозначные значения не угадываются.
  // ---------------------------------------------------------------------------

  function finalizeDictionaryEntries(entries) {
    const byIdentity = new Map();
    for (const source of entries || []) {
      const isBoolean = source.kind === 'Boolean' || canonicalValue(source.source) === 'boolean';
      if (isBoolean) {
        const semantic = booleanSemantic(source.value ?? source.id ?? source.display);
        if (semantic === null) continue;
        const id = semantic ? 'true' : 'false';
        const display = semantic ? 'Да' : 'Нет';
        const identity = `boolean:${id}`;
        if (!byIdentity.has(identity)) byIdentity.set(identity, { ...source, id, display, roleTypeId: '', kind: 'Boolean', source: source.source || 'Boolean' });
        continue;
      }
      const id = normalizeSpace(source.id);
      const display = String(source.display ?? '').trim();
      const roleTypeId = source.roleTypeId === null || source.roleTypeId === undefined ? '' : normalizeSpace(source.roleTypeId);
      if (!display || !id) continue;
      const identity = `${canonicalValue(id)}|${canonicalValue(roleTypeId)}`;
      const qualifier = normalizeSpace(source.qualifier || humanQualifierFromDetails(source.details, display));
      if (!byIdentity.has(identity)) byIdentity.set(identity, { ...source, id, display, roleTypeId, qualifier });
      else if (!byIdentity.get(identity).qualifier && qualifier) byIdentity.get(identity).qualifier = qualifier;
    }
    const values = [...byIdentity.values()];
    const groups = new Map();
    for (const item of values) {
      const key = canonicalValue(item.display);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    for (const group of groups.values()) {
      // Details help distinguish namesakes; they are not part of an ordinary
      // matrix caption. Keep legacy selectors as ID-bound aliases for old Excel.
      if (group.length === 1) {
        const item = group[0];
        if (item.selector && item.selector !== item.display) item.previousSelectors = [...new Set([item.selector, ...(item.previousSelectors || [])])];
        item.selector = item.display;
        item.status = item.status || 'Доступно';
        continue;
      }
      const previous = new Map();
      for (const item of group) {
        const selector = normalizeSpace(item.selector);
        if (selector && canonicalValue(selector) !== canonicalValue(item.display) && canonicalValue(selector).startsWith(canonicalValue(item.display))) previous.set(canonicalValue(selector), (previous.get(canonicalValue(selector)) || 0) + 1);
      }
      const preserved = new Set(group.filter(item => previous.get(canonicalValue(item.selector)) === 1).map(item => canonicalValue(item.selector)));
      const used = new Set(preserved);
      // Existing selectors are part of the workbook contract. Renumbering them
      // after alphabetical sorting (1, 10, 11, 2...) can select another entity.
      for (const item of [...group].sort((a,b) => `${a.id}|${a.roleTypeId}`.localeCompare(`${b.id}|${b.roleTypeId}`))) {
        if (preserved.has(canonicalValue(item.selector))) { item.status = item.status || 'Доступно'; continue; }
        const qualifier = normalizeSpace(item.qualifier || humanQualifierFromDetails(item.details, item.display));
        const base = qualifier ? `${item.display} — ${qualifier}` : item.display;
        let selector = base, n = 1;
        if (group.length > 1 && !qualifier) selector = `${base} — вариант ${n++}`;
        while (used.has(canonicalValue(selector))) selector = `${base}${qualifier ? '' : ' — вариант'} ${n++}`;
        used.add(canonicalValue(selector)); item.selector = selector; item.status = item.status || 'Доступно';
      }
    }
    return values.sort((a, b) => a.selector.localeCompare(b.selector, 'ru', { sensitivity: 'base' }));
  }


  function dictionarySelector(catalog, id, roleTypeId, display) {
    if (!catalog) return display || '';
    const lookup = dictionaryLookup(catalog);
    if (!lookup) return display || '';
    const cid = canonicalValue(id);
    const crt = roleTypeId === null || roleTypeId === undefined ? '' : canonicalValue(roleTypeId);
    const exact = lookup.byId.get(`${cid}|${crt}`) || lookup.byId.get(`${cid}|`) || [];
    const found = exact.length === 1 ? exact[0] : exact.find(item => !crt || canonicalValue(item.roleTypeId) === crt);
    return found?.selector || display || '';
  }

  function normalizeDictionaryCatalog(catalog) {
    if (!catalog) return { catalogs: {}, columnCatalogIds: {}, stats: { catalogs: 0, entries: 0, errors: [] } };
    if (NORMALIZED_DICTIONARY_CATALOGS.has(catalog)) return catalog;
    for (const item of Object.values(catalog.catalogs || {})) { item.entries = finalizeDictionaryEntries(item.entries || []); DICTIONARY_LOOKUP_CACHE.delete(item); }
    const entries = Object.values(catalog.catalogs || {}).reduce((sum, item) => sum + item.entries.length, 0);
    catalog.stats = catalog.stats || {};
    catalog.stats.catalogs = Object.keys(catalog.catalogs || {}).length;
    catalog.stats.entries = entries;
    catalog.stats.errors = catalog.stats.errors || [];
    NORMALIZED_DICTIONARY_CATALOGS.add(catalog);
    return catalog;
  }

  function dictionaryStructureSignature(structure) {
    const compact = {
      projectionVersion: 3,
      templateId: canonicalValue(structure?.templateId),
      conditions: (structure?.conditions || []).map(item => [
        canonicalValue(item.criterionRowId), canonicalValue(item.operandTypeId),
        canonicalValue(item.autocompleteViewName), canonicalValue(item.refSection), canonicalValue(item.autocompleteParamName),
      ]),
      functions: (structure?.functions || []).map(item => [canonicalValue(item.id), canonicalValue(item.typeId)]),
    };
    return hashText(JSON.stringify(compact));
  }

  function dictionaryCacheKey(structure) {
    const origin = typeof location !== 'undefined' ? location.origin : 'offline';
    return `${origin}|${canonicalValue(structure?.templateId)}|${dictionaryStructureSignature(structure)}`;
  }

  function openDictionaryCacheDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise(resolve => {
      try {
        const request = indexedDB.open(DICTIONARY_CACHE.DbName, DICTIONARY_CACHE.DbVersion);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(DICTIONARY_CACHE.StoreName)) db.createObjectStore(DICTIONARY_CACHE.StoreName, { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch (_) { resolve(null); }
    });
  }

  async function readDictionaryCache(key, maxAgeMs = DICTIONARY_CACHE.TtlMs) {
    const db = await openDictionaryCacheDb();
    if (!db) return null;
    return await new Promise(resolve => {
      try {
        const tx = db.transaction(DICTIONARY_CACHE.StoreName, 'readonly');
        const request = tx.objectStore(DICTIONARY_CACHE.StoreName).get(key);
        request.onsuccess = () => {
          const record = request.result || null;
          if (!record || !record.catalog || !record.savedAt || Date.now() - Number(record.savedAt) > maxAgeMs) resolve(null);
          else resolve(record);
        };
        request.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
        tx.onerror = () => { try { db.close(); } catch (_) {} };
      } catch (_) { try { db.close(); } catch (_) {} resolve(null); }
    });
  }

  async function writeDictionaryCache(key, catalog) {
    const db = await openDictionaryCacheDb();
    if (!db) return false;
    return await new Promise(resolve => {
      try {
        const tx = db.transaction(DICTIONARY_CACHE.StoreName, 'readwrite');
        tx.objectStore(DICTIONARY_CACHE.StoreName).put({ key, savedAt: Date.now(), catalog: clonePlain(catalog) });
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { try { db.close(); } catch (_) {} resolve(false); };
        tx.onabort = () => { try { db.close(); } catch (_) {} resolve(false); };
      } catch (_) { try { db.close(); } catch (_) {} resolve(false); }
    });
  }

  async function deleteDictionaryCache(key) {
    const db = await openDictionaryCacheDb();
    if (!db) return false;
    return await new Promise(resolve => {
      try {
        const tx = db.transaction(DICTIONARY_CACHE.StoreName, 'readwrite');
        tx.objectStore(DICTIONARY_CACHE.StoreName).delete(key);
        tx.oncomplete = () => { db.close(); resolve(true); };
        tx.onerror = () => { try { db.close(); } catch (_) {} resolve(false); };
      } catch (_) { try { db.close(); } catch (_) {} resolve(false); }
    });
  }

  function mergeSnapshotIntoDictionaryCatalog(sourceCatalog, structure, snapshot) {
    /*
     * Не клонируем весь каталог (десятки тысяч записей) на каждый Preview/Export.
     * Базовый каталог уже нормализован и рассматривается как immutable. Сначала
     * проверяем текущие значения матрицы через O(1)-индекс; копируем только тот
     * конкретный каталог, где отсутствует значение или отличается его подпись.
     */
    const base = normalizeDictionaryCatalog(sourceCatalog || { catalogs: {}, columnCatalogIds: {}, stats: { errors: [] } });
    const changesByCatalog = new Map();
    const captionsByCatalog = new Map();

    const appendCurrent = (catalogId, entry) => {
      const target = base.catalogs?.[catalogId];
      if (!target || entry?.id === null || entry?.id === undefined || entry?.id === '' || !normalizeSpace(entry.display)) return;
      const id = canonicalValue(entry.id);
      const roleTypeId = entry.roleTypeId === null || entry.roleTypeId === undefined ? '' : canonicalValue(entry.roleTypeId);
      const identity = `${id}|${roleTypeId}`;
      const lookup = dictionaryLookup(target);
      // Для ролей RoleTypeID является частью идентичности. Совпадение того же GUID
      // под другим типом роли нельзя считать эквивалентным текущему значению.
      const existing = roleTypeId
        ? (lookup?.byId?.get(`${id}|${roleTypeId}`) || [])
        : (lookup?.byId?.get(`${id}|`) || []);
      const pending = changesByCatalog.get(catalogId)?.get(identity);
      const current = pending || existing[0];
      const display = String(entry.display ?? '').trim();
      if (!captionsByCatalog.has(catalogId)) captionsByCatalog.set(catalogId, new Map());
      const captions = captionsByCatalog.get(catalogId);
      const firstDisplay = captions.get(identity);
      if (!firstDisplay) captions.set(identity, display);
      if (current?.display === display || (firstDisplay && (current?.previousSelectors || []).includes(display))) return;
      if (!changesByCatalog.has(catalogId)) changesByCatalog.set(catalogId, new Map());
      // Every caption emitted into a matrix cell must survive XLSX serialization;
      // truncating this list makes an untouched row fail its ID-and-text check.
      const aliases = [...new Set([...(current?.previousSelectors || []), current?.selector, current?.display, ...(firstDisplay ? [display] : [])].filter(Boolean))];
      // Preserve the selected identity and use the caption stored in the matrix.
      // A different view caption remains searchable and useful for namesakes.
      changesByCatalog.get(catalogId).set(identity, firstDisplay && current
        ? { ...current, previousSelectors: aliases }
        : { ...current, ...entry, display, selector: undefined,
          qualifier: current?.display && current.display !== display ? current.display : current?.qualifier,
          previousSelectors: aliases });
    };

    for (const condition of structure?.conditions || []) {
      const key = definitionKey('criterion', condition.criterionRowId);
      const catalogId = base.columnCatalogIds?.[key];
      if (!catalogId || !base.catalogs?.[catalogId]) continue;
      const isBoolean = canonicalValue(condition.operandTypeId) === canonicalValue(OPERAND.Boolean);
      for (const row of snapshot?.rows || []) {
        for (const item of row.values?.[condition.criterionRowId] || []) {
          if (isBoolean) {
            const semantic = booleanSemantic(item.value ?? item.id ?? item.display);
            if (semantic === null) continue;
            appendCurrent(catalogId, {
              id: semantic ? 'true' : 'false', display: semantic ? 'Да' : 'Нет', value: semantic,
              kind: 'Boolean', source: 'Boolean', status: 'Текущее значение', roleTypeId: '',
            });
          } else {
            appendCurrent(catalogId, {
              id: String(item.id ?? ''), display: item.display, roleTypeId: '',
              source: 'Текущая матрица', status: 'Текущее значение',
            });
          }
        }
      }
    }

    for (const fn of structure?.functions || []) {
      const key = definitionKey('function', fn.id);
      const catalogId = base.columnCatalogIds?.[key];
      if (!catalogId || !base.catalogs?.[catalogId]) continue;
      for (const row of snapshot?.rows || []) {
        for (const item of row.roles?.[fn.id] || []) {
          appendCurrent(catalogId, {
            id: String(item.id ?? ''), display: item.display, roleTypeId: item.roleTypeId,
            source: 'Текущая матрица', status: 'Текущее значение',
          });
        }
      }
    }

    // В типичном roundtrip все текущие значения уже есть в каталоге: возвращаем
    // исходный объект без 30–40 тыс. глубоких копирований и повторных сортировок.
    if (!changesByCatalog.size) return base;

    const merged = {
      ...base,
      catalogs: { ...(base.catalogs || {}) },
      columnCatalogIds: { ...(base.columnCatalogIds || {}) },
      stats: { ...(base.stats || {}), errors: [...(base.stats?.errors || [])] },
    };
    for (const [catalogId, changes] of changesByCatalog.entries()) {
      const source = base.catalogs[catalogId];
      const entries = (source.entries || []).map(item => {
        const key = `${canonicalValue(item.id)}|${canonicalValue(item.roleTypeId)}`;
        const replacement = changes.get(key);
        changes.delete(key);
        return replacement || item;
      });
      merged.catalogs[catalogId] = {
        ...source,
        entries: finalizeDictionaryEntries([...entries, ...changes.values()]),
      };
    }
    merged.stats.catalogs = Object.keys(merged.catalogs).length;
    merged.stats.entries = Object.values(merged.catalogs).reduce((sum, item) => sum + (item.entries?.length || 0), 0);
    NORMALIZED_DICTIONARY_CATALOGS.add(merged);
    return merged;
  }

  function dictionaryLookup(catalog) {
    if (!catalog || typeof catalog !== 'object') return null;
    const cached = DICTIONARY_LOOKUP_CACHE.get(catalog);
    if (cached) return cached;

    const items = Array.from(catalog.entries || []);
    const byId = new Map();
    const bySelector = new Map();
    const byDisplay = new Map();
    const searchRows = [];
    const append = (map, key, item) => {
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    };

    for (const item of items) {
      const id = canonicalValue(item.id);
      const roleType = canonicalValue(item.roleTypeId);
      if (id) {
        append(byId, `${id}|${roleType}`, item);
        if (roleType) append(byId, `${id}|`, item);
      }
      append(bySelector, canonicalValue(item.selector), item);
      append(byDisplay, canonicalValue(item.display), item);
      searchRows.push({
        item,
        haystack: searchCanonical(`${item.selector || ''} ${item.display || ''} ${item.qualifier || ''} ${item.searchText || ''} ${item.details || ''} ${(item.previousSelectors || []).join(' ')}`),
      });
    }

    const isBoolean = canonicalValue(catalog.sourceView || '') === 'boolean'
      || (items.length > 0 && items.every(item => item.kind === 'Boolean' || ['true', 'false'].includes(canonicalValue(item.id))));
    const lookup = { items, byId, bySelector, byDisplay, searchRows, isBoolean, resolutionCache: new Map() };
    DICTIONARY_LOOKUP_CACHE.set(catalog, lookup);
    return lookup;
  }

  /**
   * Разрешает значение Excel в точную запись справочника TESSA.
   * Точный ID/текст ищется по индексам O(1); линейный поиск включается только
   * когда пользователь действительно ввёл новый фрагмент названия.
   */
  function resolveEmbeddedDictionaryValue(workbook, column, visible, explicit) {
    const embedded = workbook.dictionaryCatalog;
    const catalogId = embedded?.columnCatalogIds?.[column.key];
    const catalog = catalogId ? embedded?.catalogs?.[catalogId] : null;
    if (!catalog) return { display: visible, explicit: explicit || '', resolved: false, issue: null, resolution: null };
    const lookup = dictionaryLookup(catalog);
    const visibleText = normalizeSpace(visible);
    const visibleCanonical = canonicalValue(visibleText);
    const explicitText = normalizeSpace(explicit);
    const explicitParts = explicitText.split('|');
    const explicitId = canonicalValue(explicitParts[0]);
    const explicitRoleType = canonicalValue(explicitParts[1] || '');

    const resolvedItem = (item, resolution = 'exact') => ({
      display: item.display,
      explicit: column.kind === 'function' ? `${item.id}|${item.roleTypeId}` : item.id,
      resolved: true,
      issue: null,
      resolution,
    });

    if (lookup?.isBoolean) {
      if (!visibleText) return { display: '', explicit: '', resolved: true, issue: null, resolution: 'blank' };
      const semantic = booleanSemantic(visibleText);
      if (semantic === null) return { display: visibleText, explicit: '', resolved: false, resolution: null, issue: `В столбце «${column.excelHeader}» используйте «Да» или «Нет».` };
      const id = semantic ? 'true' : 'false';
      return resolvedItem({ id, display: semantic ? 'Да' : 'Нет', roleTypeId: '', kind: 'Boolean' }, 'boolean');
    }

    let explicitMatch = null;
    if (explicitId) {
      const candidates = lookup.byId.get(`${explicitId}|${explicitRoleType}`)
        || lookup.byId.get(`${explicitId}|`)
        || [];
      explicitMatch = candidates.find(item => !explicitRoleType || canonicalValue(item.roleTypeId) === explicitRoleType) || null;
    }
    if (explicitMatch && [explicitMatch.selector, explicitMatch.display, ...(explicitMatch.previousSelectors || [])].map(canonicalValue).includes(visibleCanonical)) {
      return resolvedItem(explicitMatch, 'id-and-text');
    }

    let matches = lookup.bySelector.get(visibleCanonical) || [];
    if (!matches.length) matches = lookup.byDisplay.get(visibleCanonical) || [];
    if (matches.length === 1) return resolvedItem(matches[0], 'exact');
    if (matches.length > 1) {
      const variants = matches.slice(0, 8).map(item => item.selector).join('; ');
      return { display: visibleText, explicit: '', resolved: false, resolution: null, issue: `Значение «${visibleText}» в столбце «${column.excelHeader}» неоднозначно. Выберите один из вариантов: ${variants}.` };
    }

    const resolutionCache = lookup.resolutionCache || (lookup.resolutionCache = new Map());
    const resolutionCacheKey = `${canonicalValue(column.kind)}|${canonicalValue(column.excelHeader)}|${visibleCanonical}`;
    if (resolutionCache.has(resolutionCacheKey)) return resolutionCache.get(resolutionCacheKey);
    const cacheResolution = result => {
      // Bound per-catalog typo/fragment cache so a pathological workbook with hundreds of
      // thousands of distinct bad values cannot retain an unbounded number of result objects.
      if (resolutionCache.size >= 2048 && !resolutionCache.has(resolutionCacheKey)) {
        const oldest = resolutionCache.keys().next().value;
        if (oldest !== undefined) resolutionCache.delete(oldest);
      }
      resolutionCache.set(resolutionCacheKey, result);
      return result;
    };

    const needle = searchCanonical(visibleText);
    const tokens = searchTokens(visibleText);
    const allowPartial = needle.length >= 2 && !/^\d+$/.test(needle);
    if (allowPartial) {
      const partial = lookup.searchRows
        .filter(row => tokens.length ? tokens.every(token => row.haystack.includes(token)) : row.haystack.includes(needle))
        .map(row => row.item);
      if (partial.length === 1) return cacheResolution(resolvedItem(partial[0], 'unique-fragment'));
      if (partial.length > 1) {
        const variants = partial.slice(0, 10).map(item => item.selector).join('; ');
        const suffix = partial.length > 10 ? `; … ещё ${partial.length - 10}` : '';
        return cacheResolution({ display: visibleText, explicit: '', resolved: false, resolution: null, issue: `По запросу «${visibleText}» в столбце «${column.excelHeader}» найдено ${partial.length} вариантов: ${variants}${suffix}. Добавьте ещё слово, чтобы остался один вариант.` });
      }
    }
    return cacheResolution({ display: visibleText, explicit: '', resolved: false, resolution: null, issue: `Значение «${visibleText}» не найдено в справочнике «${column.excelHeader}». Введите часть официального названия из TESSA или обновите справочники.` });
  }


  // ---------------------------------------------------------------------------
  // 6. ROUNDTRIP-EXCEL: СБОРКА КНИГИ
  // Здесь из snapshot TESSA и структуры матрицы собираются видимые листы, скрытые
  // identity-колонки, справочники и пользовательская инструкция.
  // ---------------------------------------------------------------------------

  function buildRoundtripGrid(structure, snapshot, matrixInfo, dictionaryCatalog = null, options = {}) {
    const catalog = mergeSnapshotIntoDictionaryCatalog(dictionaryCatalog, structure, snapshot);
    const columns = [];

    for (const condition of structure.conditions) {
      const key = definitionKey('criterion', condition.criterionRowId);
      columns.push({
        header: condition.criterionName,
        schema: `criterion:${condition.criterionRowId}`,
        key,
        kind: 'criterion',
        hidden: false,
        width: 24,
        catalogId: catalog.columnCatalogIds?.[key] || null,
        operandTypeId: condition.operandTypeId,
      });
      columns.push({ header: `${condition.criterionName}__ID`, schema: `companion:criterion:${condition.criterionRowId}`, key: `${key}:id`, kind: 'companion', hidden: true, width: 3 });
    }
    for (const fn of structure.functions) {
      const key = definitionKey('function', fn.id);
      columns.push({
        header: fn.name,
        schema: `function:${fn.id}`,
        key,
        kind: 'function',
        hidden: false,
        width: 26,
        catalogId: catalog.columnCatalogIds?.[key] || null,
      });
      columns.push({ header: `${fn.name}__ID`, schema: `companion:function:${fn.id}`, key: `${key}:id`, kind: 'companion', hidden: true, width: 3 });
    }
    const customColumns = (options.customColumns || []).map((item, index) => ({
      header: normalizeSpace(item.header) || `Пользовательская колонка ${index + 1}`,
      schema: '',
      key: `custom:${index}`,
      kind: 'custom',
      hidden: false,
      width: Number(item.width) || 26,
      sourceIndex: item.sourceIndex,
    }));
    columns.push(...customColumns);
    const includeActions = Boolean(options.includeActions) || snapshot.rows.some(row => row.action);
    if (includeActions) columns.push({ header: 'Действие', schema: 'system:action', key: 'system:action', kind: 'system', hidden: false, width: 18 });
    columns.push({ header: '__TESSA_ROW_CARD_ID', schema: 'system:rowCardId', key: 'system:rowCardId', kind: 'system-hidden', hidden: true, width: 3 });
    columns.push({ header: '__TESSA_VERSION_ID', schema: 'system:versionId', key: 'system:versionId', kind: 'system-hidden', hidden: true, width: 3 });
    columns.push({ header: '__TESSA_BASE_FINGERPRINT', schema: 'system:baseFingerprint', key: 'system:baseFingerprint', kind: 'system-hidden', hidden: true, width: 3 });

    const rows = snapshot.rows.map(snapshotRow => {
      const values = [];
      for (const condition of structure.conditions) {
        const key = definitionKey('criterion', condition.criterionRowId);
        const dict = catalog.catalogs?.[catalog.columnCatalogIds?.[key]];
        const items = snapshotRow.values?.[condition.criterionRowId] || [];
        const isBoolean = canonicalValue(condition.operandTypeId) === canonicalValue(OPERAND.Boolean);
        values.push(items.map(item => isBoolean ? booleanDisplay(item.value ?? item.id ?? item.display) : (item.display || dictionarySelector(dict, item.id, null, ''))).join('\n'));
        values.push(items.map(item => {
          if (isBoolean) { const semantic = booleanSemantic(item.value ?? item.id ?? item.display); return semantic === null ? '' : semantic ? 'true' : 'false'; }
          return item.id !== null && item.id !== undefined && item.id !== '' ? String(item.id) : '';
        }).filter(Boolean).join('\n'));
      }
      for (const fn of structure.functions) {
        const key = definitionKey('function', fn.id);
        const dict = catalog.catalogs?.[catalog.columnCatalogIds?.[key]];
        const items = snapshotRow.roles?.[fn.id] || [];
        values.push(items.map(item => item.display || dictionarySelector(dict, item.id, item.roleTypeId, '')).join('\n'));
        values.push(items.map(item => `${item.id}|${item.roleTypeId}`).join('\n'));
      }
      for (let customIndex = 0; customIndex < customColumns.length; customIndex += 1) {
        values.push(snapshotRow.customValues?.[customIndex] ?? '');
      }
      if (includeActions) values.push(snapshotRow.action || '');
      values.push(snapshotRow.rowCardId || '', snapshotRow.versionId || '', snapshotRow.fingerprint || '');
      return values;
    });

    const headerRow = 14;
    const schemaRow = 13;
    const metadata = [
      ['Наименование матрицы', matrixInfo.TemplateName || ''],
      ['Состояние', matrixStateCaption(matrixInfo)],
      ['Автор', matrixInfo.AuthorName || ''],
      ['Дата выгрузки', new Date().toLocaleString('ru-RU')],
      ['Поиск по справочникам', 'Начните печатать часть официального названия прямо в ячейке. При одном совпадении точный ID будет подставлен автоматически.'],
      [ROUNDTRIP.FormatKey, ROUNDTRIP.Format],
      [ROUNDTRIP.MatrixIdKey, snapshot.matrixId || matrixInfo.matrixId || ''],
      [ROUNDTRIP.TemplateIdKey, snapshot.templateId || matrixInfo.TemplateID || ''],
      [ROUNDTRIP.PreviousVersionIdKey, matrixInfo.PreviousVersionID || ''],
      [ROUNDTRIP.HeaderRowKey, String(headerRow)],
      [ROUNDTRIP.SchemaRowKey, String(schemaRow)],
      [ROUNDTRIP.TemplateModeKey, 'ROUNDTRIP'],
    ];
    return { columns, rows, metadata, headerRow, schemaRow, dictionaryCatalog: catalog };
  }

  function genericSheetXml(rows, widths = [], options = {}) {
    const maxCols = Math.max(1, ...rows.map(row => row.length));
    const lastCol = indexToCol(maxCols - 1);
    const lastRow = Math.max(1, rows.length);
    const xmlRows = rows.map((values, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const style = rowIndex === 0 ? 2 : 5;
      return `<row r="${rowNumber}"${rowIndex === 0 ? ' ht="28" customHeight="1"' : ''}>${values.map((value, colIndex) => xlsxStringCell(rowNumber, colIndex, value, style)).join('')}</row>`;
    }).join('');
    const cols = Array.from({ length: maxCols }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="${widths[index] || 22}" customWidth="1"/>`).join('');
    const view = options.freezeHeader === false
      ? '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    const filter = options.autoFilter === false ? '' : `<autoFilter ref="A1:${lastCol}${lastRow}"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${lastRow}"/>${view}<sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${xmlRows}</sheetData>${filter}</worksheet>`;
  }

  function instructionSheetXml() {
    const rows = [];
    const row = (number, height, cells) => {
      rows.push(`<row r="${number}" ht="${height}" customHeight="1">${cells.map(([col, value, style]) => xlsxStringCell(number, col, value, style)).join('')}</row>`);
    };
    row(1, 34, [[0, 'TESSA Matrix Studio', 9]]);
    row(2, 20, []);
    row(3, 26, [[0, `Excel-редактор матриц · v${APP.version} · сценарий «скачать → изменить → проверить → применить»`, 10]]);
    row(5, 24, [[0, 'Как работать — 4 шага', 11]]);
    row(6, 56, [
      [0, '1 · СКАЧАТЬ\nНажмите «Скачать Excel» и работайте именно с выгрузкой текущей матрицы.', 12],
      [2, '2 · ИЗМЕНИТЬ\nМеняйте значения, добавляйте строки, заменяйте содержимое существующих строк или удаляйте строки целиком.', 12],
      [4, '3 · ПРОВЕРИТЬ\nВыберите файл в TESSA и нажмите «Проверить изменения». Сначала изучите список операций.', 12],
      [6, '4 · ПРИМЕНИТЬ\nНажмите «Применить к TESSA». Перед записью строки ещё раз проверяются по актуальному состоянию матрицы.', 12],
    ]);
    row(11, 24, [[0, 'Что произойдёт с каждой строкой', 11]]);
    row(12, 62, [
      [0, 'ИЗМЕНИТЬ\nОтредактируйте нужные ячейки существующей строки. Скрытые ID не меняйте — строка обновится в TESSA.', 12],
      [2, 'ДОБАВИТЬ\nВставьте новую строку. Можно скопировать похожую строку в НОВУЮ позицию и затем изменить значения — это станет новой строкой TESSA.', 12],
      [4, 'ЗАМЕНИТЬ\nЕсли скопировать строку ПОВЕРХ другой существующей строки, Studio распознает цель по позиции и обновит именно затёртую строку. Новая строка не создаётся.', 13],
      [6, 'УДАЛИТЬ\nУдалите существующую строку Excel целиком. Очистка всех ячеек не считается удалением. Большие удаления выполняйте небольшими пакетами.', 12],
    ]);
    row(17, 24, [[0, 'Как заполнять значения', 11]]);
    row(18, 68, [
      [0, 'ПОИСК ПО СПРАВОЧНИКАМ\nМожно вводить уникальную часть названия прямо в ячейке. Если найден ровно один вариант, Studio сопоставит его с точной записью TESSA. Признаки: «Да» / «Нет». Число или диапазон: 0, 15, 4..15. Сохраняйте текстовый формат ячеек.', 12],
      [4, 'НЕСКОЛЬКО ЗНАЧЕНИЙ\nРядом со «Скачать Excel» нажмите «Собрать значения»: выберите поле, отметьте варианты, скопируйте и вставьте в Excel через F2 → Ctrl+V. Вручную разделяйте значения Alt+Enter. Обычный список заменяет значение.', 12],
    ]);
    row(23, 24, [[0, 'Дополнительные действия — когда нужны эти кнопки', 11]]);
    row(24, 70, [
      [0, '«ОБНОВИТЬ ПОЛЯ EXCEL»\nИспользуйте, если в шаблоне TESSA появились новые критерии/функции. Studio добавит новые поля и сохранит ваши пользовательские изменения, насколько это безопасно.', 12],
      [4, '«ОБНОВИТЬ СПРАВОЧНИКИ И СКАЧАТЬ»\nСоздаёт новую выгрузку и принудительно перечитывает справочники/роли из TESSA. Полезно, если нужное значение недавно добавили или переименовали.', 12],
    ]);
    row(29, 24, [[0, 'Безопасность', 11]]);
    row(30, 76, [[0, 'В существующей строке ошибочное поле сохраняет значение TESSA, а корректные изменения можно применить. Новая строка с ошибкой пропускается целиком. Формулы не исполняются. Чужая матрица, повреждённая структура или небезопасное удаление блокируют запись. Все пропуски видны при проверке.', 13]]);
    row(34, 32, [[0, 'Главное правило: сначала «Проверить изменения», затем внимательно посмотреть ИЗМЕНИТЬ / ДОБАВИТЬ / ЗАМЕНИТЬ / УДАЛИТЬ и только после этого применять.', 14]]);

    const merges = ['A1:H2','A3:H3','A5:H5','A6:B9','C6:D9','E6:F9','G6:H9','A11:H11','A12:B15','C12:D15','E12:F15','G12:H15','A17:H17','A18:D21','E18:H21','A23:H23','A24:D27','E24:H27','A29:H29','A30:H32','A34:H35'];
    const cols = Array.from({ length: 8 }, (_, index) => `<col min="${index + 1}" max="${index + 1}" width="18" customWidth="1"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:H35"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${cols}</cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells></worksheet>`;
  }

  async function createRoundtripXlsxBytes(structure, snapshot, matrixInfo, dictionaryCatalog = null, options = {}) {
    const grid = buildRoundtripGrid(structure, snapshot, matrixInfo, dictionaryCatalog, options);
    const lastCol = indexToCol(grid.columns.length - 1);
    const dataStartRow = grid.headerRow + 1;
    const visualRowCount = Math.max(1, grid.rows.length);
    const lastDataRow = dataStartRow + visualRowCount - 1;
    const validationLastRow = Math.min(1048576, Math.max(10000, lastDataRow + 5000));
    const highlighted = new Set((options.highlights || []).map(item => `${canonicalValue(item.rowCardId)}|${item.key}`));
    const sheetRows = [];
    grid.metadata.forEach(([key, value], index) => {
      const rowNumber = index + 1;
      const hidden = rowNumber >= 5 ? ' hidden="1"' : '';
      sheetRows.push(`<row r="${rowNumber}"${hidden}>${xlsxStringCell(rowNumber, 0, key, 1)}${xlsxStringCell(rowNumber, 1, value, 7)}</row>`);
    });
    sheetRows.push(`<row r="${grid.schemaRow}" hidden="1">${grid.columns.map((column, index) => xlsxStringCell(grid.schemaRow, index, column.schema, 0)).join('')}</row>`);
    sheetRows.push(`<row r="${grid.headerRow}" ht="46" customHeight="1">${grid.columns.map((column, index) => xlsxStringCell(grid.headerRow, index, column.header, column.kind === 'criterion' ? 2 : column.kind === 'function' ? 3 : 4)).join('')}</row>`);
    grid.rows.forEach((values, rowIndex) => {
      const rowNumber = dataStartRow + rowIndex;
      const bodyStyle = rowIndex % 2 ? 8 : 5;
      // Approximate wrapping using visible column widths. Hidden ID payloads must
      // not inflate row height; Excel's 409-point ceiling keeps huge cells usable.
      const lines = values.reduce((max, value, index) => {
        if (grid.columns[index]?.hidden) return max;
        const width = Math.max(8, Number(grid.columns[index]?.width || 28) - 3);
        const wrapped = String(value ?? '').split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / width)), 0);
        return Math.max(max, wrapped);
      }, 1);
      const height = Math.min(409, Math.max(32, lines * 15 + 10));
      sheetRows.push(`<row r="${rowNumber}" ht="${height}" customHeight="1">${values.map((value, colIndex) => value === null || value === undefined || value === ''
        ? `<c r="${indexToCol(colIndex)}${rowNumber}" s="${bodyStyle}"/>`
        : xlsxStringCell(rowNumber, colIndex, value, highlighted.has(`${canonicalValue(snapshot.rows[rowIndex]?.rowCardId)}|${grid.columns[colIndex]?.key}`) ? 15 : bodyStyle)).join('')}</row>`);
    });
    const cols = grid.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" style="5" customWidth="1"${column.hidden ? ' hidden="1"' : ''}/>`).join('');

    // Служебный лист хранит только данные, необходимые для обратного сопоставления.
    // Статус и поисковую строку не дублируем в каждой из десятков тысяч строк:
    // статус имеет безопасный default, а поисковый индекс восстанавливается в памяти.
    const dictionaryRows = [['CatalogID', 'Словарь', 'Выбор в Excel', 'Отображение', 'ID', 'RoleTypeID', 'Источник', 'Доп. данные', 'Прежние названия']];
    const namedRanges = [];
    const rangeByCatalog = {};
    let dictionaryRow = 2;
    let rangeIndex = 1;
    for (const catalog of Object.values(grid.dictionaryCatalog.catalogs || {})) {
      const startRow = dictionaryRow;
      let firstCatalogRow = true;
      for (const item of catalog.entries || []) {
        // Название и источник одинаковы для всего каталога. Записываем их только
        // в первой строке каталога — parser уже сохраняет эти метаданные при инициализации.
        dictionaryRows.push([catalog.id, firstCatalogRow ? (catalog.label || catalog.id) : '', item.selector, item.display, item.id, item.roleTypeId, firstCatalogRow ? (catalog.sourceView || item.source || '') : '', item.details || '', item.previousSelectors?.length ? JSON.stringify(item.previousSelectors) : '']);
        firstCatalogRow = false;
        dictionaryRow += 1;
      }
      if (dictionaryRow > startRow) {
        const name = `_TMS_DV_${String(rangeIndex++).padStart(3, '0')}`;
        rangeByCatalog[catalog.id] = name;
        namedRanges.push({ name, formula: `'${ROUNDTRIP.DictionarySheet}'!$C$${startRow}:$C$${dictionaryRow - 1}` });
      }
    }

    const validationGroups = new Map();
    const booleanRefs = [];
    grid.columns.forEach((column, index) => {
      if (column.hidden) return;
      const ref = `${indexToCol(index)}${dataStartRow}:${indexToCol(index)}${validationLastRow}`;
      const rangeName = column.catalogId ? rangeByCatalog[column.catalogId] : null;
      if (rangeName) {
        if (!validationGroups.has(rangeName)) validationGroups.set(rangeName, []);
        validationGroups.get(rangeName).push(ref);
      } else if (canonicalValue(column.operandTypeId) === canonicalValue(OPERAND.Boolean)) booleanRefs.push(ref);
    });
    const validations = [];
    for (const [index, column] of grid.columns.entries()) {
      if (column.kind !== 'criterion' || ![OPERAND.Int, OPERAND.Decimal].includes(column.operandTypeId)) continue;
      validations.push(`<dataValidation type="custom" allowBlank="1" showInputMessage="0" showErrorMessage="0" sqref="${indexToCol(index)}${dataStartRow}:${indexToCol(index)}${validationLastRow}"><formula1>TRUE</formula1></dataValidation>`);
    }
    // Keep the dropdowns; editing guidance belongs on Инструкция, not in a
    // persistent Excel input-message popup covering the neighbouring cells.
    for (const [rangeName, refs] of validationGroups) validations.push(`<dataValidation type="list" allowBlank="1" showDropDown="0" showInputMessage="0" showErrorMessage="0" sqref="${refs.join(' ')}"><formula1>${rangeName}</formula1></dataValidation>`);
    if (booleanRefs.length) validations.push(`<dataValidation type="list" allowBlank="1" showDropDown="0" showInputMessage="0" showErrorMessage="1" sqref="${booleanRefs.join(' ')}"><formula1>"Да,Нет"</formula1></dataValidation>`);

    const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastCol}${lastDataRow}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="${grid.headerRow}" topLeftCell="B${dataStartRow}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${sheetRows.join('')}</sheetData><autoFilter ref="A${grid.headerRow}:${lastCol}${lastDataRow}"/><dataValidations count="${validations.length}">${validations.join('')}</dataValidations></worksheet>`;

    const structureRows = [['Ключ столбца', 'Тип', 'ID', 'Наименование', 'Тип значения', 'Источник', 'CatalogID', 'Редактирование']];
    structure.conditions.forEach(item => {
      const key = definitionKey('criterion', item.criterionRowId);
      structureRows.push([key, 'Критерий', item.criterionRowId, item.criterionName, item.operandTypeId, item.autocompleteViewName || item.refSection || '', grid.dictionaryCatalog.columnCatalogIds?.[key] || '', 'Значения и строки редактируются в Excel; само определение меняется в шаблоне TESSA']);
    });
    structure.functions.forEach(item => {
      const key = definitionKey('function', item.id);
      structureRows.push([key, 'Функция', item.id, item.name, item.typeName || item.typeId || '', 'MtxRoles', grid.dictionaryCatalog.columnCatalogIds?.[key] || '', 'Исполнители и строки редактируются в Excel; само определение меняется в шаблоне TESSA']);
    });
    const changeRows = [['Статус', 'Тип', 'ID', 'Наименование', 'Что произойдёт', 'ExcelRow', 'MatrixRowID', 'Архивное значение']];
    const changes = options.schemaChanges || {};
    for (const item of changes.missingDefinitions || []) changeRows.push(['НОВЫЙ В TESSA / НЕТ В EXCEL', item.kind === 'function' ? 'Функция' : 'Критерий', item.id, item.name, 'Добавлен в обновлённый Excel; текущее значение сохранено', '', '', '']);
    for (const item of changes.staleDefinitions || []) changeRows.push(['УДАЛЁН ИЗ TESSA / ЕСТЬ В EXCEL', item.kind === 'function' ? 'Функция' : 'Критерий', item.id, item.header || item.name || '', 'Не отправляется в TESSA; прежние значения сохранены ниже как архив', '', '', '']);
    for (const item of changes.retiredData || []) changeRows.push(['АРХИВ ЗНАЧЕНИЯ', item.kind === 'function' ? 'Функция' : 'Критерий', item.id, item.header || '', 'Значение из старого Excel сохранено только для истории', item.excelRow, item.rowCardId || '', item.value || '']);
    if (changeRows.length === 1) changeRows.push(['БЕЗ ИЗМЕНЕНИЙ', '', '', '', 'Структура Excel соответствует текущему шаблону TESSA', '', '', '']);

    const baselineRows = [['MatrixRowID', 'MatrixVersionID', 'BaseFingerprint']];
    const baselineSourceRows = Array.isArray(options.baselineRows) ? options.baselineRows : (snapshot.rows || []);
    for (const row of baselineSourceRows) {
      if (!row.rowCardId && !row.versionId) continue;
      const payload = JSON.stringify({ flat: row.flat || {}, values: row.values || {}, roles: row.roles || {} });
      const chunks = !row.fingerprint || row.fingerprint === fingerprintFlat(row.flat || {}) ? (payload.match(/[\s\S]{1,30000}/g) || []) : [];
      while (baselineRows[0].length < 3 + chunks.length) baselineRows[0].push(`BaseData${baselineRows[0].length - 2}`);
      baselineRows.push([row.rowCardId || '', row.versionId || '', row.fingerprint || fingerprintFlat(row.flat || {}), ...chunks]);
    }

    const instructionSheet = instructionSheetXml();
    const dictionarySheet = genericSheetXml(dictionaryRows, [28, 42, 56, 48, 40, 14, 28, 72]);
    const structureSheet = genericSheetXml(structureRows, [46, 14, 38, 42, 38, 28, 24, 70]);
    const schemaChangesSheet = genericSheetXml(changeRows, [32, 16, 40, 44, 72, 12, 40, 72]);
    const baselineSheet = genericSheetXml(baselineRows, [40, 40, 48], { autoFilter: false });

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="11"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FF292929"/><sz val="11"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="20"/><name val="Aptos Display"/><family val="2"/></font><font><b/><color rgb="FF292929"/><sz val="13"/><name val="Aptos Display"/><family val="2"/></font></fonts><fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE31E24"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB5121B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF292929"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF0F1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F5"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE699"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE5E5E5"/></left><right style="thin"><color rgb="FFE5E5E5"/></right><top style="thin"><color rgb="FFE5E5E5"/></top><bottom style="thin"><color rgb="FFE5E5E5"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="16"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="7" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const sheetNames = ['Матрица', ROUNDTRIP.InstructionSheet, ROUNDTRIP.DictionarySheet, ROUNDTRIP.StructureSheet, ROUNDTRIP.SchemaChangesSheet, ROUNDTRIP.BaselineSheet];
    const sheetXml = [worksheet, instructionSheet, dictionarySheet, structureSheet, schemaChangesSheet, baselineSheet];
    const sheetOverrides = sheetNames.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
    const definedNames = namedRanges.length ? `<definedNames>${namedRanges.map(item => `<definedName name="${item.name}">${item.formula}</definedName>`).join('')}</definedNames>` : '';
    const workbookSheets = sheetNames.map((name, index) => `<sheet name="${xmlEscape(name)}" sheetId="${index + 1}"${index >= 2 ? ' state="veryHidden"' : ''} r:id="rId${index + 1}"/>`).join('');
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="28329"/><workbookPr defaultThemeVersion="166925"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews><sheets>${workbookSheets}</sheets>${definedNames}<calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetNames.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rId${sheetNames.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const created = new Date().toISOString();
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>TESSA Matrix Studio</dc:creator><cp:lastModifiedBy>TESSA Matrix Studio</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified></cp:coreProperties>`;
    const titleParts = [...sheetNames, ...namedRanges.map(item => item.name)];
    const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Excel</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="4" baseType="variant"><vt:variant><vt:lpstr>Листы</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetNames.length}</vt:i4></vt:variant><vt:variant><vt:lpstr>Именованные диапазоны</vt:lpstr></vt:variant><vt:variant><vt:i4>${namedRanges.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${titleParts.length}" baseType="lpstr">${titleParts.map(name => `<vt:lpstr>${xmlEscape(name)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts><Company>ПАО «Группа Черкизово»</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0300</AppVersion></Properties>`;
    const entries = [['[Content_Types].xml', contentTypes], ['_rels/.rels', rels], ['docProps/core.xml', core], ['docProps/app.xml', app], ['xl/workbook.xml', workbook], ['xl/_rels/workbook.xml.rels', workbookRels], ['xl/styles.xml', styles]];
    sheetXml.forEach((xml, index) => entries.push([`xl/worksheets/sheet${index + 1}.xml`, xml]));
    return await makeZip(entries);
  }

  function sanitizeFileName(value) {
    return normalizeSpace(value || 'Матрица')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 120);
  }

  function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  /**
   * Скачивает актуальную матрицу в roundtrip-Excel.
   * Файл содержит видимые пользовательские поля и скрытые идентификаторы строк.
   * options.forceDictionaryRefresh=true принудительно перечитывает справочники TESSA.
   */
  async function exportCurrentMatrixXlsx(options = {}) {
    setProgress(8, 'Подключаюсь к TESSA', 'Проверяю открытую матрицу');
    const bridge = await TessaBridge.create();
    const templateId = bridge.templateId();
    if (!templateId) throw new Error('У матрицы не найден TemplateID.');
    setProgress(24, 'Читаю структуру', 'Критерии и функции матрицы');
    log('Выгрузка текущей матрицы: читаю структуру.');
    const structure = await bridge.requestStructure(templateId);
    setProgress(38, 'Читаю строки', 'Загружаю текущее состояние матрицы');
    log('Выгрузка текущей матрицы: читаю строки.');
    const snapshot = await bridge.loadSnapshot(structure);
    setProgress(62, 'Обновляю справочники', 'Читаю свежие значения и роли из TESSA');
    log(options.forceDictionaryRefresh ? 'Выгрузка текущей матрицы: принудительно обновляю словари и роли.' : 'Выгрузка текущей матрицы: подключаю словари и роли.');
    const dictionaryCatalog = await bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh: true });
    APP.dictionaryCatalog = dictionaryCatalog;
    const matrixInfo = bridge.matrixInfo();
    setProgress(84, 'Формирую Excel', `${snapshot.rows.length} строк`);
    const bytes = await createRoundtripXlsxBytes(structure, snapshot, matrixInfo, dictionaryCatalog, { includeActions: true });
    const shortId = String(snapshot.matrixId || '').slice(0, 8);
    const name = `TESSA_Матрица_${sanitizeFileName(matrixInfo.TemplateName)}_${shortId}.xlsx`;
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    APP.bridge = bridge;
    APP.structure = structure;
    APP.snapshot = snapshot;
    log(`Текущая матрица выгружена: ${snapshot.rows.length} строк, ${dictionaryCatalog.stats.entries} значений в ${dictionaryCatalog.stats.catalogs} словарях.`);
    setProgress(100, 'Excel готов', `${snapshot.rows.length} строк · ${dictionaryCatalog.stats.entries} значений справочников`);
    return { name, structure, snapshot, matrixInfo, dictionaryCatalog, bytes };
  }

  function clonePlain(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function desiredCriterionItems(condition, desired, column) {
    const displays = desired.flat[column.key] || [];
    const ids = desired.ids[column.key] || [];
    const operand = canonicalValue(condition.operandTypeId);
    const kind = operand === canonicalValue(OPERAND.ReferenceInt) ? 'ReferenceInt'
      : operand === canonicalValue(OPERAND.ReferenceGuid) || condition.refSection ? 'ReferenceGuid'
      : operand === canonicalValue(OPERAND.Boolean) ? 'Boolean'
      : operand === canonicalValue(OPERAND.Int) ? 'Int'
      : operand === canonicalValue(OPERAND.Decimal) ? 'Decimal'
      : operand === canonicalValue(OPERAND.Date) ? 'Date'
      : operand === canonicalValue(OPERAND.DateTime) ? 'DateTime'
      : 'String';
    return displays.map((display, index) => ({ id: ids[index] ? String(ids[index]).split('|')[0] : '', display, kind }));
  }

  function desiredRoleItems(desired, column) {
    const displays = desired.flat[column.key] || [];
    const ids = desired.ids[column.key] || [];
    return displays.map((display, index) => {
      const [id = '', roleTypeId = ''] = String(ids[index] || '').split('|');
      return { id, display, roleTypeId: roleTypeId === '' ? '' : Number(roleTypeId) };
    });
  }

  function prepareThreeWayMerge(workbook, structure, snapshot, choices = {}) {
    const map = buildColumnMap(workbook, structure);
    const desired = workbookRowsToDesired(workbook, map);
    const bases = workbook.roundtrip?.baselineRows || [];
    const baseByCard = new Map(bases.map(base => [canonicalValue(base.rowCardId), base]));
    const baseByVersion = new Map(bases.map(base => [canonicalValue(base.versionId), base]));
    // Validate the original ledger before rebasing; otherwise damaged IDs or a
    // cleared fingerprint would be silently replaced with trusted fresh values.
    for (const local of desired) {
      const base = baseByCard.get(canonicalValue(local.system.rowCardId)) || baseByVersion.get(canonicalValue(local.system.versionId));
      if (base && ['rowCardId', 'versionId', 'baseFingerprint'].some(field => canonicalValue(local.system[field]) !== canonicalValue(base[field]))) {
        throw new Error(`Строка Excel ${local.excelRow}: повреждены служебные идентификаторы или BaseFingerprint. Скачайте свежую выгрузку.`);
      }
    }
    const issues = [...(map.mappingIssues || []), ...desired.flatMap(row => row.issues || [])];
    if (issues.length) throw new Error(`Перед объединением исправьте значения Excel: ${issues.slice(0, 8).join(' ')}`);
    const byCard = new Map((snapshot.rows || []).map(row => [canonicalValue(row.rowCardId), row]));
    const conflicts = [], highlights = [], rows = workbook.rows.map(row => ({ ...row, values: [...row.values], cellMeta: row.cellMeta ? [...row.cellMeta] : undefined }));
    const byExcel = new Map(rows.map(row => [row.excelRow, row]));
    const counts = new Map();
    for (const d of desired) { const id = canonicalValue(d.system.rowCardId); if (id) counts.set(id, (counts.get(id) || 0) + 1); }
    const mergeCatalog = { ...workbook.dictionaryCatalog, catalogs: { ...(workbook.dictionaryCatalog?.catalogs || {}) }, columnCatalogIds: { ...(workbook.dictionaryCatalog?.columnCatalogIds || {}) } };
    for (const column of map.columns.values()) {
      const catalogId = mergeCatalog.columnCatalogIds[column.key];
      if (!catalogId || !mergeCatalog.catalogs[catalogId]) continue;
      const source = mergeCatalog.catalogs[catalogId];
      const entries = [...source.entries];
      const seen = new Set(entries.map(e => `${e.id}|${e.roleTypeId || ''}|${e.display}`));
      for (const current of snapshot.rows) for (const item of (column.kind === 'function' ? current.roles?.[column.id] : current.values?.[column.id]) || []) {
        if (item.id == null || !item.display) continue;
        const roleTypeId = column.kind === 'function' ? item.roleTypeId : '';
        const key = `${item.id}|${roleTypeId || ''}|${item.display}`;
        if (!seen.has(key)) { entries.push({ ...item, roleTypeId, selector: item.display }); seen.add(key); }
      }
      mergeCatalog.catalogs[catalogId] = { ...source, entries };
    }
    const outputBases = bases.map(row => ({ ...row }));
    const assign = (row, column, source) => {
      const items = (column.kind === 'function' ? source.roles?.[column.id] : source.values?.[column.id]) || [];
      row.values[column.index] = items.map(item => item.display ?? '').join('\n');
      const companion = workbook.schemaTokens.indexOf(`companion:${column.key}`);
      if (companion >= 0) row.values[companion] = items.map(item => column.kind === 'function' ? `${item.id}|${item.roleTypeId}` : item.id ?? '').join('\n');
      if (row.cellMeta) row.cellMeta[column.index] = null;
    };
    for (const base of outputBases) {
      if (!base.base) continue; // V1–V6 without cell baselines retain conservative conflict handling.
      const id = canonicalValue(base.rowCardId), current = byCard.get(id);
      const local = desired.find(row => canonicalValue(row.system.rowCardId) === id);
      if ((counts.get(id) || 0) > 1 || local?.system.action === 'add') continue;
      if (!current) {
        if (!local) continue;
        const changed = local.system.action !== 'delete' && [...local.columns.values()].some(col => !arraysEqual(local.compare?.[col.key] || [], currentCompareValues(base.base, col)));
        if (changed) conflicts.push({ id: `missing:${id}`, excelRow: local.excelRow, column: 'Строка удалена в TESSA', mine: 'Сохранить как новую строку', server: 'Удалить из Excel', base: 'Строка была в выгрузке', kind: 'remote-delete' });
        if (!changed || choices[`missing:${id}`] === 'server') rows.splice(rows.indexOf(byExcel.get(local.excelRow)), 1);
        else if (choices[`missing:${id}`] === 'mine') {
          const row = byExcel.get(local.excelRow);
          for (const field of ['rowCardId', 'versionId', 'baseFingerprint']) if (map.system[field] !== undefined) row.values[map.system[field]] = '';
          if (map.system.action !== undefined) row.values[map.system.action] = 'ДОБАВИТЬ';
        }
        continue;
      }
      if (!local) {
        if (baselineRowChanged(base, current, structure)) {
          const key = `delete:${id}`;
          conflicts.push({ id: key, excelRow: '', column: `Удаление строки ${current.index + 1}`, mine: 'Удалить строку', server: 'Сохранить строку TESSA', base: 'Строка удалена в Excel', kind: 'local-delete' });
          if (choices[key] === 'server') {
            const row = { excelRow: Math.max(workbook.headerRow, ...rows.map(r => r.excelRow)) + 1, values: Array(workbook.headers.length).fill('') };
            for (const column of map.columns.values()) assign(row, column, current);
            for (const [field,value] of Object.entries({rowCardId:current.rowCardId,versionId:current.versionId,baseFingerprint:current.fingerprint})) if (map.system[field] !== undefined) row.values[map.system[field]] = value;
            rows.push(row);
          }
        }
      } else {
        const row = byExcel.get(local.excelRow);
        if (local.issues?.length) continue;
        if (local.system.action === 'delete') {
          if (baselineRowChanged(base, current, structure)) {
            const key = `explicit-delete:${id}`;
            conflicts.push({ id: key, excelRow: local.excelRow, column: 'Удаление изменённой строки', mine: 'Удалить строку', server: 'Сохранить TESSA', base: 'Строка изменилась после выгрузки', kind: 'local-delete' });
            if (choices[key] === 'server' && map.system.action !== undefined) row.values[map.system.action] = '';
          }
          // A deletion is one row-level decision. Keeping TESSA must not apply
          // old cell edits from the row that the user had marked for deletion.
          for (const column of local.columns.values()) {
            assign(row, column, current);
            if (!arraysEqual(currentCompareValues(base.base, column), currentCompareValues(current, column))) highlights.push({ rowCardId: current.rowCardId, key: column.key, conflict: true });
          }
        } else for (const column of local.columns.values()) {
          const original = currentCompareValues(base.base, column), remote = currentCompareValues(current, column), mine = local.compare?.[column.key] || [];
          const mineChanged = !arraysEqual(mine, original), remoteChanged = !arraysEqual(remote, original);
          const key = `${local.excelRow}:${column.key}`;
          const conflict = mineChanged && remoteChanged && !arraysEqual(mine, remote);
          if (conflict) conflicts.push({ id: key, excelRow: local.excelRow, column: column.name || column.excelHeader, mine: (local.flat[column.key] || []).join(' · ') || '(пусто)', server: (current.flat[column.key] || []).join(' · ') || '(пусто)', base: (base.base.flat[column.key] || []).join(' · ') || '(пусто)', kind: 'cell' });
          if (remoteChanged && (!mineChanged || arraysEqual(mine, remote) || choices[key] === 'server')) assign(row, column, current);
          if (remoteChanged) highlights.push({ rowCardId: current.rowCardId, key: column.key, conflict });
        }
        if (map.system.baseFingerprint !== undefined) row.values[map.system.baseFingerprint] = current.fingerprint;
        if (map.system.versionId !== undefined) row.values[map.system.versionId] = current.versionId;
      }
      base.versionId = current.versionId; base.baseFingerprint = current.fingerprint; base.base = { flat: current.flat, values: current.values, roles: current.roles };
    }
    return { workbook: { ...workbook, dictionaryCatalog: mergeCatalog, rows, roundtrip: { ...workbook.roundtrip, baselineRows: outputBases.filter(base => byCard.has(canonicalValue(base.rowCardId))) } }, conflicts, unresolved: conflicts.filter(c => !['mine', 'server'].includes(choices[c.id])), highlights };
  }

  function resolveMergeConflicts(conflicts) {
    const host = document.querySelector('#tms-merge-conflicts');
    if (!host) throw new Error('Не удалось показать конфликты объединения.');
    host.hidden = false;
    host.innerHTML = `<h3>Выберите значения для новой книги</h3><p>Жёлтым отмечены пересекающиеся изменения. До вашего выбора книга не пересобирается.</p>${conflicts.map((c, i) => `<fieldset class="tms-merge-conflict"><legend>${escapeHtml(c.excelRow ? `Excel ${c.excelRow} · ${c.column}` : c.column)}</legend><p>Было: ${escapeHtml(c.base)}</p><label><input type="radio" name="merge-${i}" value="mine"> Мой Excel: ${escapeHtml(c.mine)}</label><label><input type="radio" name="merge-${i}" value="server"> TESSA: ${escapeHtml(c.server)}</label></fieldset>`).join('')}<p id="tms-merge-status" role="status"></p><button type="button" id="tms-merge-confirm">Объединить выбранное</button> <button type="button" id="tms-merge-cancel">Отмена</button>`;
    host.querySelector('input')?.focus();
    return new Promise((resolve, reject) => {
      host.querySelector('#tms-merge-cancel').onclick = () => { host.hidden = true; reject(new Error('Объединение отменено. Исходный Excel сохранён.')); };
      host.querySelector('#tms-merge-confirm').onclick = () => {
        const choices = Object.fromEntries(conflicts.map((c,i) => [c.id, host.querySelector(`input[name="merge-${i}"]:checked`)?.value]));
        if (Object.values(choices).some(value => !value)) { host.querySelector('#tms-merge-status').textContent = 'Выберите вариант для каждого конфликта.'; return; }
        host.hidden = true; resolve(choices);
      };
    });
  }

  function mergeWorkbookIntoCurrentSnapshot(workbook, structure, snapshot) {
    if (!workbook.roundtrip?.enabled) throw new Error('Обновление схемы доступно только для Excel, ранее выгруженного этим скриптом.');
    const columnMap = buildColumnMap(workbook, structure);
    const desiredRows = workbookRowsToDesired(workbook, columnMap);
    const issues = [...(columnMap.mappingIssues || []), ...desiredRows.flatMap(row => row.issues || [])];
    if (issues.length) throw new Error(`Перед обновлением схемы исправьте значения Excel: ${issues.slice(0, 8).join(' ')}`);

    const customColumns = (columnMap.customColumns || []).map((item, index) => ({
      header: item.header,
      sourceIndex: item.index,
      width: 26,
      customIndex: index,
    }));
    const workbookRowByExcelRow = new Map((workbook.rows || []).map(row => [row.excelRow, row]));
    const baselineRows = Array.isArray(workbook.roundtrip?.baselineRows) ? workbook.roundtrip.baselineRows : [];
    const byVersion = new Map(snapshot.rows.map(row => [canonicalValue(row.versionId), row]));
    const byCard = new Map(snapshot.rows.map(row => [canonicalValue(row.rowCardId), row]));
    const mergedByCard = new Map(snapshot.rows.map(row => [canonicalValue(row.rowCardId), { ...clonePlain(row), action: '', customValues: Array(customColumns.length).fill('') }]));
    const added = [];
    const usedCurrent = new Set();
    const excelIdentityKey = desired => {
      const versionId = canonicalValue(desired?.system?.versionId || '');
      const rowCardId = canonicalValue(desired?.system?.rowCardId || '');
      return versionId || rowCardId ? `v:${versionId}|c:${rowCardId}` : '';
    };
    const currentIdentityKey = current => {
      const versionId = canonicalValue(current?.versionId || '');
      const rowCardId = canonicalValue(current?.rowCardId || '');
      return versionId || rowCardId ? `v:${versionId}|c:${rowCardId}` : '';
    };
    const baselineByIdentity = new Map(baselineRows.map(row => {
      const versionId = canonicalValue(row.versionId || '');
      const rowCardId = canonicalValue(row.rowCardId || '');
      return [`v:${versionId}|c:${rowCardId}`, row];
    }));
    // Schema refresh должен сопоставлять overwrite по тем же identity-правилам,
    // что и основной planner. Физический порядок Excel после сортировки не является identity.
    const expectedCurrentByExcelRow = new Map();
    const identityCounts = new Map();
    const identityGroups = new Map();
    const primaryExcelRowByIdentity = new Map();
    const ambiguousDuplicateIdentities = new Set();
    const positionalOverwriteTargets = new Map();
    const findCurrentByIdentity = desired => {
      if (desired?.system?.versionId) {
        const row = byVersion.get(canonicalValue(desired.system.versionId));
        if (row) return row;
      }
      if (desired?.system?.rowCardId) {
        const row = byCard.get(canonicalValue(desired.system.rowCardId));
        if (row) return row;
      }
      return null;
    };
    for (const desired of desiredRows) {
      const identity = excelIdentityKey(desired);
      if (!identity) continue;
      if (!identityGroups.has(identity)) identityGroups.set(identity, []);
      identityGroups.get(identity).push(desired);
    }
    // Новые строки без identity не должны ломать позиционное доказательство REPLACE
    // между исходными identity-строками. Сопоставляем позиции только по baseline-рядам.
    const positionalDesiredRows = desiredRows.filter(desired => desired.system.action !== 'add' && Boolean(excelIdentityKey(desired)));
    const canAlignByPosition = positionalDesiredRows.length === snapshot.rows.length;
    if (canAlignByPosition) {
      for (const desired of positionalDesiredRows) {
        const identity = excelIdentityKey(desired);
        if (identity) identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
      }
      positionalDesiredRows.forEach((desired, index) => expectedCurrentByExcelRow.set(desired, snapshot.rows[index] || null));
      for (const [sourceIdentity, group] of identityGroups.entries()) {
        if (group.length === 1) { primaryExcelRowByIdentity.set(sourceIdentity, group[0]); continue; }
        const current = findCurrentByIdentity(group[0]);
        if (!current) { primaryExcelRowByIdentity.set(sourceIdentity, group[0]); continue; }
        const positionalOriginal = group.find(row => {
          const expected = expectedCurrentByExcelRow.get(row);
          return expected && currentIdentityKey(expected) === sourceIdentity;
        });
        if (positionalOriginal) { primaryExcelRowByIdentity.set(sourceIdentity, positionalOriginal); continue; }
        const currentFingerprint = canonicalValue(current.fingerprint || fingerprintFlat(current.flat || {}));
        const exact = group.filter(row => canonicalValue(fingerprintFlat(row.flat || {})) === currentFingerprint);
        if (exact.length) primaryExcelRowByIdentity.set(sourceIdentity, exact[0]);
        else ambiguousDuplicateIdentities.add(sourceIdentity);
      }
      const missingCurrentRows = (snapshot.rows || []).filter(current => {
        const identity = currentIdentityKey(current);
        return Boolean(identity && (identityCounts.get(identity) || 0) === 0);
      });
      const remainingMissing = new Map(missingCurrentRows.map(row => [currentIdentityKey(row), row]));
      const extraRows = [];
      for (const [sourceIdentity, group] of identityGroups.entries()) {
        if (group.length < 2 || ambiguousDuplicateIdentities.has(sourceIdentity)) continue;
        const primary = primaryExcelRowByIdentity.get(sourceIdentity);
        if (!primary) continue;
        for (const row of group) {
          if (row !== primary) extraRows.push({ row, sourceIdentity, primary });
        }
      }
      for (const extra of extraRows) {
        const expectedTarget = expectedCurrentByExcelRow.get(extra.row);
        const expectedTargetIdentity = currentIdentityKey(expectedTarget);
        const expectedPrimary = expectedCurrentByExcelRow.get(extra.primary);
        const primaryStayedInPlace = expectedPrimary && currentIdentityKey(expectedPrimary) === extra.sourceIdentity;
        if (!primaryStayedInPlace || !remainingMissing.has(expectedTargetIdentity)) continue;
        positionalOverwriteTargets.set(extra.row, expectedTarget);
        remainingMissing.delete(expectedTargetIdentity);
      }
      const remainingExtras = extraRows.filter(extra => !positionalOverwriteTargets.has(extra.row));
      if (remainingExtras.length === 1 && remainingMissing.size === 1) {
        const [target] = remainingMissing.values();
        positionalOverwriteTargets.set(remainingExtras[0].row, target);
      }
    }

    if (canonicalValue(workbook.roundtrip?.format) === canonicalValue('TESSA_MATRIX_ROUNDTRIP_V6') && baselineRows.length) {
      for (const desired of desiredRows) {
        const identity = excelIdentityKey(desired);
        if (!identity) continue;
        const base = baselineByIdentity.get(identity);
        if (!base) continue;
        if (canonicalValue(desired.system.baseFingerprint || '') !== canonicalValue(base.baseFingerprint || '')) {
          throw new Error(`Строка Excel ${desired.excelRow}: повреждён служебный BaseFingerprint. Скрытые ID/fingerprint нельзя очищать или менять. Скачайте свежую выгрузку.`);
        }
      }
    }

    // V6 хранит baseline identity/fingerprint на отдельном veryHidden-листе.
    // Поэтому физическое удаление строки на основном листе не уничтожает доказательство,
    // какую именно версию пользователь собирался удалить. Это позволяет schema refresh
    // сохранить DELETE только если строка в TESSA с момента выгрузки не менялась.
    const physicalDeleteIdentities = new Set();
    if (canonicalValue(workbook.roundtrip?.format) === canonicalValue('TESSA_MATRIX_ROUNDTRIP_V6') && baselineRows.length) {
      const desiredIdentities = new Set(desiredRows.map(excelIdentityKey).filter(Boolean));
      const overwriteTargetIdentities = new Set([...positionalOverwriteTargets.values()].map(currentIdentityKey).filter(Boolean));
      const missingBaseline = baselineRows.filter(base => {
        const identity = `v:${canonicalValue(base.versionId || '')}|c:${canonicalValue(base.rowCardId || '')}`;
        return identity !== 'v:|c:' && !desiredIdentities.has(identity) && !overwriteTargetIdentities.has(identity);
      });
      const rowDeficit = Math.max(0, baselineRows.length - desiredRows.filter(row => row.system.action !== 'add').length);
      if (missingBaseline.length && missingBaseline.length !== rowDeficit) {
        throw new Error('Конфликт актуализации: baseline показывает пропавшую исходную identity, но число строк Excel не соответствует чистому физическому удалению. Возможно, повреждены скрытые ID или одновременно выполнены удаление и добавление. Выполните эти операции отдельно в свежей выгрузке.');
      }
      for (const base of missingBaseline) {
        const identity = `v:${canonicalValue(base.versionId || '')}|c:${canonicalValue(base.rowCardId || '')}`;
        const current = base.versionId ? byVersion.get(canonicalValue(base.versionId)) : byCard.get(canonicalValue(base.rowCardId));
        if (current) {
          const exportedFingerprint = canonicalValue(base.baseFingerprint || '');
          if (!exportedFingerprint || baselineRowChanged(base, current, structure)) {
            throw new Error(`Конфликт актуализации: физически удалённая строка TESSA ${base.versionId || base.rowCardId} изменилась после выгрузки Excel. Скачайте свежий файл и подтвердите удаление повторно.`);
          }
        }
        physicalDeleteIdentities.add(identity);
      }
    }

    for (const desired of desiredRows) {
      if (desired.system.action.startsWith('invalid:')) throw new Error(`Строка Excel ${desired.excelRow}: неизвестное действие.`);
      const positionalOverwriteTarget = positionalOverwriteTargets.get(desired) || null;
      if (positionalOverwriteTarget && desired.system.action === 'delete') {
        throw new Error(`Строка Excel ${desired.excelRow}: операция неоднозначна — строка одновременно распознана как ЗАМЕНИТЬ и помечена УДАЛИТЬ. Нельзя безопасно определить цель удаления. Выполните удаление отдельно в свежей выгрузке.`);
      }

      // Актуализация схемы читает свежий snapshot TESSA, поэтому нельзя молча
      // накладывать на него значения из Excel, выгруженного до чужих изменений.
      // Иначе старые значения получат свежий baseFingerprint и stale-защита Apply
      // больше не сможет распознать конфликт.
      const sourceIdentity = excelIdentityKey(desired);
      const sourceGroup = sourceIdentity ? (identityGroups.get(sourceIdentity) || []) : [];
      // Повтор одной hidden identity в Excel означает локальное копирование.
      // Для stale source этого достаточно для конфликта, даже если primary
      // нельзя выбрать однозначно после внешнего изменения TESSA.
      const duplicatedSourceIdentity = sourceGroup.length > 1;
      const sourceCurrentRow = findCurrentByIdentity(desired);
      const exportedFingerprint = canonicalValue(desired.system.baseFingerprint || "");
      const freshFingerprint = canonicalValue(sourceCurrentRow?.fingerprint || "");
      const workbookFingerprint = canonicalValue(desired.fingerprint || fingerprintFlat(desired.flat || {}));
      const sourceChangedSinceExport = Boolean(sourceCurrentRow && exportedFingerprint && freshFingerprint && exportedFingerprint !== freshFingerprint);
      if (sourceChangedSinceExport) {
        const workbookChangedSinceExport = Boolean(workbookFingerprint && workbookFingerprint !== exportedFingerprint);
        const hasLocalOperation = desired.system.action !== 'keep' || positionalOverwriteTarget || duplicatedSourceIdentity || workbookChangedSinceExport;
        if (hasLocalOperation) {
          throw new Error(`Строка Excel ${desired.excelRow}: конфликт актуализации — исходная строка изменилась в TESSA после выгрузки, и в Excel тоже есть изменение/копия/операция. Скачайте свежую выгрузку и перенесите правку повторно.`);
        }
        // Excel-строка не менялась: сохраняем authoritative свежие значения TESSA,
        // но не теряем пользовательские несистемные колонки исходного файла.
        const sourceWorkbookRow = workbookRowByExcelRow.get(desired.excelRow);
        const customValues = customColumns.map(column => sourceWorkbookRow?.values?.[column.sourceIndex] ?? "");
        const freshRow = { ...clonePlain(sourceCurrentRow), action: "", customValues };
        const freshIdentityKey = canonicalValue(sourceCurrentRow.versionId || sourceCurrentRow.rowCardId);
        if (freshIdentityKey) usedCurrent.add(freshIdentityKey);
        mergedByCard.set(canonicalValue(sourceCurrentRow.rowCardId), freshRow);
        continue;
      }

      let current = positionalOverwriteTarget || (desired.system.versionId ? byVersion.get(canonicalValue(desired.system.versionId)) : null);
      if (!current && desired.system.rowCardId) current = byCard.get(canonicalValue(desired.system.rowCardId));
      const identityKey = current ? canonicalValue(current.versionId || current.rowCardId) : '';
      const copiedIdentity = Boolean(!positionalOverwriteTarget && current && identityKey && usedCurrent.has(identityKey) && desired.system.action !== 'delete');
      const isAdd = desired.system.action === 'add' || copiedIdentity || (!current && desired.hasData && !desired.system.rowCardId && !desired.system.versionId);
      if (current && !isAdd && identityKey) usedCurrent.add(identityKey);
      if (copiedIdentity) current = null;
      if (!current && !isAdd) continue;
      const sourceWorkbookRow = workbookRowByExcelRow.get(desired.excelRow);
      const customValues = customColumns.map(column => sourceWorkbookRow?.values?.[column.sourceIndex] ?? '');
      const row = isAdd
        ? { index: snapshot.rows.length + added.length, rowCardId: '', versionId: '', rowName: `Новая строка ${added.length + 1}`, values: {}, roles: {}, flat: {}, fingerprint: '', action: 'ДОБАВИТЬ', customValues }
        : { ...clonePlain(current), action: desired.system.action === 'delete' ? 'УДАЛИТЬ' : '', customValues };
      for (const condition of structure.conditions) {
        const column = desired.columns.get(condition.criterionRowId);
        if (!column) continue;
        row.values = row.values || {};
        row.values[condition.criterionRowId] = desiredCriterionItems(condition, desired, column);
      }
      for (const fn of structure.functions) {
        const column = desired.columns.get(fn.id);
        if (!column) continue;
        row.roles = row.roles || {};
        row.roles[fn.id] = desiredRoleItems(desired, column);
      }
      row.flat = { ...(row.flat || {}) };
      for (const column of desired.columns.values()) row.flat[column.key] = [...(desired.flat[column.key] || [])];
      if (isAdd) added.push(row);
      else mergedByCard.set(canonicalValue(current.rowCardId), row);
    }

    const rows = snapshot.rows
      .filter(row => !physicalDeleteIdentities.has(currentIdentityKey(row)))
      .map(row => mergedByCard.get(canonicalValue(row.rowCardId)) || { ...row, customValues: Array(customColumns.length).fill('') })
      .concat(added);
    const retiredData = [];
    for (const retired of columnMap.retiredColumns || []) {
      for (const workbookRow of workbook.rows || []) {
        const value = workbookRow.values?.[retired.index] ?? '';
        if (normalizeSpace(value) === '') continue;
        retiredData.push({
          excelRow: workbookRow.excelRow,
          rowCardId: columnMap.system.rowCardId !== undefined ? workbookRow.values?.[columnMap.system.rowCardId] || '' : '',
          kind: retired.kind,
          id: retired.id,
          header: retired.header,
          value,
        });
      }
    }
    const schemaChanges = {
      missingDefinitions: columnMap.missingCurrentColumns || [],
      staleDefinitions: columnMap.retiredColumns || [],
      retiredData,
      customColumns,
    };
    return { columnMap, snapshot: { ...snapshot, rows }, customColumns, schemaChanges };
  }

  function mergeWorkbookEditsIntoSnapshot(workbook, structure, snapshot) {
    return mergeWorkbookIntoCurrentSnapshot(workbook, structure, snapshot).snapshot;
  }

  async function refreshWorkbookSchema(workbook, sourceName = 'выбранный Excel') {
    APP.abortRequested = false;
    setProgress(10, 'Проверяю выбранный Excel', sourceName);
    log(`Обновление Excel-схемы: ${sourceName}`);
    setProgress(20, 'Подключаюсь к TESSA', 'Проверяю открытую матрицу');
    const bridge = await TessaBridge.create();
    const templateId = bridge.templateId();
    setProgress(30, 'Читаю актуальную структуру TESSA', 'Сверяю критерии и функции');
    const structure = await bridge.requestStructure(templateId);
    const matrixInfo = bridge.matrixInfo();
    if (canonicalValue(workbook.roundtrip?.matrixId) !== canonicalValue(matrixInfo.matrixId)) throw new Error('Excel относится к другой матрице. Откройте матрицу, из которой он выгружен.');
    const workbookTemplateId = canonicalValue(workbook.roundtrip?.templateId);
    if (!workbook.roundtrip?.enabled || workbookTemplateId !== canonicalValue(matrixInfo.TemplateID)) throw new Error('Выбранный Excel относится к другому шаблону или не является roundtrip-файлом.');
    setProgress(45, 'Читаю строки TESSA', 'Нужно сохранить ваши изменения и актуальные ID');
    log('Обновление Excel-схемы: читаю все строки и страницы TESSA.');
    const snapshot = await bridge.loadSnapshot(structure);
    setProgress(62, 'Переношу ваши изменения', 'Сохраняю значения и пользовательские столбцы');
    let prepared = prepareThreeWayMerge(workbook, structure, snapshot);
    if (prepared.unresolved.length) {
      const choices = await resolveMergeConflicts(prepared.unresolved);
      if (APP.abortRequested) throw new Error('Объединение остановлено.');
      const freshBridge = await TessaBridge.create();
      if (canonicalValue(freshBridge.mainCard.id) !== canonicalValue(snapshot.matrixId) || canonicalValue(freshBridge.templateId()) !== canonicalValue(structure.templateId)) throw new Error('Матрица изменилась. Повторите обновление.');
      prepared = prepareThreeWayMerge(workbook, structure, snapshot, choices);
    }
    const merged = mergeWorkbookIntoCurrentSnapshot(prepared.workbook, structure, snapshot);
    setProgress(76, 'Обновляю справочники', 'Подключаю актуальные значения');
    log('Обновление Excel-схемы: подключаю словари (локальный кэш или сервер).');
    const dictionaryCatalog = await bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh: true });
    setProgress(90, 'Формирую актуальный Excel', 'Новые поля + ваши изменения');
    const bytes = await createRoundtripXlsxBytes(structure, merged.snapshot, matrixInfo, dictionaryCatalog, {
      schemaChanges: merged.schemaChanges,
      baselineRows: snapshot.rows,
      highlights: prepared.highlights,
      includeActions: true,
      customColumns: merged.customColumns,
    });
    const shortId = String(snapshot.matrixId || '').slice(0, 8);
    const name = `TESSA_Матрица_${sanitizeFileName(matrixInfo.TemplateName)}_${shortId}_АКТУАЛЬНАЯ.xlsx`;
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    log(`Excel-схема обновлена: строк ${merged.snapshot.rows.length}; новых столбцов ${merged.schemaChanges.missingDefinitions.length}; удалённых ${merged.schemaChanges.staleDefinitions.length}; пользовательских ${merged.customColumns.length}.`);
    setProgress(100, 'Excel актуализирован', `Новых полей: ${merged.schemaChanges.missingDefinitions.length} · пользовательских: ${merged.customColumns.length}`);
    return { name, workbook, structure, snapshot, merged, dictionaryCatalog, bytes };
  }

  function preserveWorkbookSelectors(workbook, fresh) {
    const originals = new Map();
    for (const [key, newId] of Object.entries(fresh.columnCatalogIds || {})) {
      const oldId = workbook.dictionaryCatalog?.columnCatalogIds?.[key];
      const old = workbook.dictionaryCatalog?.catalogs?.[oldId];
      if (!old) continue;
      if (!originals.has(newId)) originals.set(newId, new Map());
      for (const entry of old.entries || []) originals.get(newId).set(`${canonicalValue(entry.id)}|${canonicalValue(entry.roleTypeId)}`, entry);
    }
    const catalogs = {};
    for (const [id, catalog] of Object.entries(fresh.catalogs || {})) {
      catalogs[id] = { ...catalog, entries: catalog.entries.map(entry => {
        const old = originals.get(id)?.get(`${canonicalValue(entry.id)}|${canonicalValue(entry.roleTypeId)}`);
        return { ...entry, selector: old && canonicalValue(old.display) === canonicalValue(entry.display) ? old.selector : undefined,
          previousSelectors: old ? [...new Set([old.selector, old.display, ...(old.previousSelectors || []), ...(entry.previousSelectors || [])].filter(Boolean))] : entry.previousSelectors };
      }) };
    }
    return normalizeDictionaryCatalog({ ...fresh, catalogs });
  }

  async function refreshWorkbookDictionaries(workbook, structure, catalog) {
    if (!workbook.roundtrip?.enabled) throw new Error('Выберите Excel, выгруженный из Studio.');
    const archive = WORKBOOK_ARCHIVES.get(workbook);
    if (!archive) throw new Error('Выберите исходный файл Excel повторно.');
    const decoder = new TextDecoder();
    const entries = new Map(archive);
    const descriptors = parseWorkbookSheets(entries, decoder);
    const pathOf = name => descriptors.find(item => item.name === name)?.path;
    const dictionaryPath = pathOf(ROUNDTRIP.DictionarySheet), structurePath = pathOf(ROUNDTRIP.StructureSheet), matrixPath = pathOf(workbook.sheetName);
    if (!dictionaryPath || !structurePath || !matrixPath) throw new Error('В книге отсутствуют служебные листы справочников.');
    catalog = preserveWorkbookSelectors(workbook, catalog);
    const donorBytes = await createRoundtripXlsxBytes(structure, { rows: [] }, {}, catalog);
    const donor = await unzipArrayBuffer(donorBytes.buffer.slice(donorBytes.byteOffset, donorBytes.byteOffset + donorBytes.byteLength));
    const donorDescriptors = parseWorkbookSheets(donor, decoder);
    const donorPath = name => donorDescriptors.find(item => item.name === name)?.path;
    // Replace reference data only. Matrix cells, IDs, formulas, row order, styles,
    // baseline ledger and arbitrary user worksheets stay byte-for-byte intact.
    const dictionaryXml = decoder.decode(donor.get(donorPath(ROUNDTRIP.DictionarySheet))).replace(/\s+s="\d+"/g, '');
    entries.set(dictionaryPath, dictionaryXml);
    const structureRows = workbook.parsedSheets.get(ROUNDTRIP.StructureSheet).rows.map(row => [...row]);
    for (const row of structureRows.slice(1)) row[6] = catalog.columnCatalogIds?.[row[0]] || '';
    entries.set(structurePath, genericSheetXml(structureRows, [], { autoFilter: false }).replace(/\s+s="\d+"/g, ''));
    const namespace = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const donorWorkbook = decoder.decode(donor.get('xl/workbook.xml'));
    const ranges = [...donorWorkbook.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)].map(m => ({ name: attr(m[1], 'name'), formula: m[2] }));
    const ids = Object.values(normalizeDictionaryCatalog(catalog).catalogs).filter(item => item.entries.length).map(item => item.id);
    const rangeByCatalog = new Map(ids.map((id, i) => [id, ranges[i]?.name]));
    let workbookXml = decoder.decode(entries.get('xl/workbook.xml'));
    const namesPattern = /<(?:[\w.-]+:)?definedNames\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?definedNames>/;
    const existingNames = workbookXml.match(namesPattern)?.[1] || '';
    const preservedNames = existingNames.replace(/<(?:[\w.-]+:)?definedName\b([^>]*)>[\s\S]*?<\/(?:[\w.-]+:)?definedName>/g, (all, attrs) => /^_TMS_DV_/.test(attr(attrs, 'name') || '') ? '' : all);
    const namesXml = `<definedNames xmlns="${namespace}">${preservedNames}${ranges.map(r => `<definedName name="${r.name}">${r.formula}</definedName>`).join('')}</definedNames>`;
    workbookXml = namesPattern.test(workbookXml) ? workbookXml.replace(namesPattern, () => namesXml) : workbookXml.replace(/(<\/(?:[\w.-]+:)?sheets>)/, (_, end) => end + namesXml);
    entries.set('xl/workbook.xml', workbookXml);
    let matrixXml = decoder.decode(entries.get(matrixPath));
    const validationPattern = /<(?:[\w.-]+:)?dataValidations\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?dataValidations>/;
    const oldValidation = matrixXml.match(validationPattern)?.[1] || '';
    const preserved = [...oldValidation.matchAll(/<(?:[\w.-]+:)?dataValidation\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?dataValidation>/g)].map(m => m[0]).filter(xml => !/_TMS_DV_/.test(xml));
    const endRow = Math.min(1048576, Math.max(10000, ...(workbook.rows || []).map(r => r.excelRow + 5000)));
    workbook.schemaTokens.forEach((key, index) => {
      const range = rangeByCatalog.get(catalog.columnCatalogIds?.[key]);
      if (range) preserved.push(`<dataValidation type="list" allowBlank="1" showDropDown="0" showInputMessage="0" showErrorMessage="0" sqref="${indexToCol(index)}${workbook.headerRow + 1}:${indexToCol(index)}${endRow}"><formula1>${range}</formula1></dataValidation>`);
    });
    const validationXml = `<dataValidations xmlns="${namespace}" count="${preserved.length}">${preserved.join('')}</dataValidations>`;
    matrixXml = validationPattern.test(matrixXml) ? matrixXml.replace(validationPattern, () => validationXml) : matrixXml.replace(/(<(?:[\w.-]+:)?(?:hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|drawing|extLst)\b|<\/(?:[\w.-]+:)?worksheet>)/, (_, tail) => validationXml + tail);
    entries.set(matrixPath, matrixXml);
    return makeZip([...entries]);
  }

  async function refreshSelectedWorkbookDictionaries(file) {
    if (!file) throw new Error('Сначала выберите изменённый Excel в шаге 2.');
    setProgress(10, 'Читаю ваш Excel', 'Матрица и ваши правки сохранятся');
    const workbook = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name);
    const bridge = await TessaBridge.create(), matrixInfo = bridge.matrixInfo();
    if (canonicalValue(workbook.roundtrip?.templateId) !== canonicalValue(matrixInfo.TemplateID)) throw new Error('Excel относится к другому шаблону.');
    const structure = await bridge.requestStructure(bridge.templateId());
    setProgress(35, 'Обновляю справочники', 'Читаю актуальные значения TESSA');
    const catalog = await bridge.loadDictionaryCatalog(structure, { rows: [] }, { forceRefresh: true });
    const bytes = await refreshWorkbookDictionaries(workbook, structure, catalog);
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), file.name.replace(/\.xlsx$/i, '') + '_СПРАВОЧНИКИ.xlsx');
    setProgress(100, 'Справочники обновлены', catalog.stats.errors.length ? `Есть неполные справочники: ${catalog.stats.errors.length}. Запустите диагностику.` : 'Матрица и ваши изменения сохранены в новом файле');
    return { bytes, catalog };
  }

  async function refreshSelectedWorkbook(file) {
    if (!file) throw new Error('Выберите Excel, который нужно обновить.');
    const workbook = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name);
    return refreshWorkbookSchema(workbook, file.name);
  }

  async function refreshLoadedWorkbookXlsx() {
    if (!APP.workbook?.roundtrip?.enabled) throw new Error('Сначала выберите roundtrip-Excel и нажмите «Сравнить», либо используйте выбранный файл.');
    return refreshWorkbookSchema(APP.workbook, APP.workbook.fileName || 'загруженный Excel');
  }

  /**
   * Pure compatibility model. It consumes only already-observed booleans and
   * never touches TESSA services. Scoped write gaps degrade Studio to `limited`;
   * missing authoritative read/identity primitives are fail-closed.
   */
  function evaluateRuntimeCapabilities(probe = {}) {
    const p = probe || {};
    const blockers = [];
    const warnings = [];
    const addBlocker = (code, scope) => blockers.push({ code, scope });
    const addWarning = (code, scope) => warnings.push({ code, scope });

    if (!p.runtime?.extensionRequire) addBlocker('runtime-extension-require-missing', 'snapshot');
    if (!p.runtime?.apiLoader) addBlocker('runtime-api-loader-missing', 'workspace');
    if (!p.runtime?.workspace) addBlocker('workspace-missing', 'card');
    if (!p.runtime?.editor) addBlocker('editor-missing', 'card');
    if (!p.runtime?.cardModel) addBlocker('card-model-missing', 'card');
    if (!p.cardService?.get || !p.constructors?.cardGetRequest) addBlocker('card-get-unavailable', 'read');
    if (!p.cardService?.request || !p.constructors?.cardRequest) addBlocker('card-request-unavailable', 'read');
    if (!p.matrix?.identity || !p.matrix?.template || !p.matrix?.stateReadable) addBlocker('matrix-identity-unavailable', 'matrix');
    if (!p.nativeView?.found) addBlocker('native-view-missing', 'snapshot');

    if (!p.matrix?.writableState) addWarning('matrix-not-writable', 'apply');
    if (!p.cardService?.store || !p.constructors?.cardStoreRequest || !p.constructors?.affectVersion) addWarning('update-store-unavailable', 'apply');
    if (!p.cardService?.newOrCreate || !p.constructors?.cardNewRequest) addWarning('add-store-unavailable', 'apply');
    if (p.nativeView?.found && !p.nativeView?.refresh) addWarning('native-view-refresh-unavailable', 'refreshView');
    if (p.nativeView?.found && !p.nativeView?.paging) addWarning('native-view-paging-limited', 'snapshot');

    return {
      ...p,
      blockers,
      warnings,
      overall: blockers.length ? 'incompatible' : warnings.length ? 'limited' : 'ready',
    };
  }

  function capabilityOperationAvailability(capabilities, actions = []) {
    const c = capabilities || {};
    const types = new Set((actions || []).map(action => action?.type).filter(Boolean));
    const readBlockers = [];
    if (!c.runtime?.extensionRequire || !c.runtime?.apiLoader || !c.runtime?.workspace || !c.runtime?.editor || !c.runtime?.cardModel) readBlockers.push('runtime-read-unavailable');
    if (!c.cardService?.get || !c.constructors?.cardGetRequest) readBlockers.push('card-get-unavailable');
    if (!c.cardService?.request || !c.constructors?.cardRequest) readBlockers.push('card-request-unavailable');
    if (!c.matrix?.identity || !c.matrix?.template || !c.matrix?.stateReadable) readBlockers.push('matrix-identity-unavailable');
    if (!c.nativeView?.found) readBlockers.push('native-view-missing');
    const readReady = readBlockers.length === 0;

    const applyBlockers = [...readBlockers];
    if (!c.matrix?.writableState) applyBlockers.push('matrix-not-writable');
    if (types.has('update') && (!c.cardService?.store || !c.constructors?.cardStoreRequest || !c.constructors?.affectVersion)) applyBlockers.push('update-store-unavailable');
    if (types.has('add') && (!c.cardService?.newOrCreate || !c.constructors?.cardNewRequest || !c.cardService?.store || !c.constructors?.cardStoreRequest || !c.constructors?.affectVersion)) applyBlockers.push('add-store-unavailable');
    if (types.has('delete') && (!c.cardService?.request || !c.constructors?.cardRequest)) applyBlockers.push('delete-request-unavailable');

    const unique = values => [...new Set(values.filter(Boolean))];
    return {
      export: { enabled: readReady, blockers: unique(readBlockers) },
      analyze: { enabled: readReady, blockers: unique(readBlockers) },
      apply: { enabled: applyBlockers.length === 0, blockers: unique(applyBlockers) },
      refreshView: {
        enabled: Boolean(c.nativeView?.found && c.nativeView?.refresh),
        blockers: c.nativeView?.found && c.nativeView?.refresh ? [] : ['native-view-refresh-unavailable'],
      },
      reconcile: { enabled: readReady, blockers: unique(readBlockers) },
    };
  }

  function humanCapabilityBlocker(blockers) {
    const codes = (Array.isArray(blockers) ? blockers : [blockers])
      .map(item => typeof item === 'string' ? item : item?.code)
      .filter(Boolean);
    const labels = {
      'runtime-extension-require-missing': 'Не удалось подключиться к внутреннему runtime открытой страницы TESSA.',
      'runtime-api-loader-missing': 'На странице недоступен API текущей web-сборки TESSA.',
      'runtime-read-unavailable': 'Среда TESSA не предоставляет обязательные возможности чтения карточки.',
      'workspace-missing': 'Не найдена активная рабочая область карточки TESSA.',
      'editor-missing': 'Не найден редактор открытой карточки TESSA.',
      'card-model-missing': 'Не найдена модель открытой карточки TESSA.',
      'card-get-unavailable': 'Недоступно безопасное чтение карточек строк матрицы.',
      'card-request-unavailable': 'Недоступен обязательный запрос структуры матрицы TESSA.',
      'matrix-identity-unavailable': 'Не удалось надёжно определить открытую матрицу, её шаблон или состояние.',
      'native-view-missing': 'Не найдено нативное представление матрицы со служебными идентификаторами строк.',
      'native-view-refresh-unavailable': 'Автоматическое локальное обновление отображения недоступно; запись при этом может оставаться доступной.',
      'native-view-paging-limited': 'Нативное представление не публикует безопасный постраничный переход; большие матрицы могут потребовать обновления страницы.',
      'matrix-not-writable': 'Открытая матрица сейчас недоступна для безопасной записи.',
      'update-store-unavailable': 'В этой сборке недоступна безопасная запись изменений существующих строк.',
      'add-store-unavailable': 'В этой сборке недоступно безопасное создание новых строк; изменение существующих строк может оставаться доступным.',
      'delete-request-unavailable': 'В этой сборке недоступно безопасное удаление строк матрицы.',
    };
    const messages = [...new Set(codes.map(code => labels[code] || 'Часть возможностей Studio недоступна в текущей сборке TESSA.'))];
    return messages.join(' ');
  }

  function probeDataValue(data, key, typedField = null) {
    if (!data) return null;
    try {
      if (typeof data.get === 'function') {
        const value = data.get(key);
        if (value !== undefined && value !== null) return value;
      }
    } catch (_) { /* read-only probe fallback */ }
    try {
      if (typeof data.tryGet === 'function') {
        const value = data.tryGet(key);
        return typedField?.get ? typedField.get(value) : value;
      }
    } catch (_) { /* read-only probe fallback */ }
    return data[key] ?? null;
  }

  function probeControlEntries(editor) {
    const controls = editor?.cardModel?.controls;
    if (!controls) return [];
    try {
      if (typeof controls.entries === 'function') return Array.from(controls.entries());
    } catch (_) { /* continue */ }
    if (Array.isArray(controls)) return controls.map((value, index) => [String(index), value]);
    try { return Object.entries(controls); } catch (_) { return []; }
  }

  function probeControlRows(control) {
    for (const candidate of [control, control?.control, control?.model, control?.viewModel]) {
      try {
        if (candidate?.table?.rows) return Array.from(candidate.table.rows);
      } catch (_) { /* continue */ }
    }
    return [];
  }

  function nativeMatrixControlCandidates(original) {
    return [original, original?.control, original?.model, original?.viewModel].filter(Boolean);
  }

  function nativeMatrixControlTarget(original) {
    const candidates = nativeMatrixControlCandidates(original);
    return candidates.find(item => typeof item?.doubleClickAction === 'function')
      || candidates.find(item =>
        typeof item?.setPageAndRefresh === 'function'
        || typeof item?.refresh === 'function'
        || typeof item?.viewComponent?.refresh === 'function'
        || typeof item?.component?.refresh === 'function'
      )
      || null;
  }

  function nativeMatrixControlStructuralScore(controlName, original) {
    const candidates = nativeMatrixControlCandidates(original);
    const hasRowsSurface = candidates.some(item => {
      try { return item?.table && item.table.rows !== null && item.table.rows !== undefined; }
      catch (_) { return false; }
    });
    const target = nativeMatrixControlTarget(original);
    if (!hasRowsSurface || !target) return 0;
    const pieces = [controlName];
    for (const item of candidates) {
      const metadata = [item?.viewMetadata, item?.metadata, item?.viewComponent?.viewMetadata, item?.viewComponent?.metadata, item?.component?.viewMetadata, item?.component?.metadata];
      pieces.push(item?.name, item?.alias, item?.caption);
      for (const meta of metadata) pieces.push(meta?.name, meta?.alias, meta?.caption);
    }
    const text = canonicalValue(pieces.filter(Boolean).join(' '));
    let score = 0;
    if (/mtxroutematrixdummyview/.test(text)) score += 320;
    if (/testmatrixview/.test(text)) score += 240;
    if (/mtxroutematrix/.test(text)) score += 180;
    if (/routematrix/.test(text)) score += 120;
    return score;
  }

  function pickNativeMatrixControl(entries, rowsOf, dataValue) {
    let identityBest = null;
    const structural = [];
    for (const [controlName, original] of entries || []) {
      const target = nativeMatrixControlTarget(original);
      if (!target) continue;
      const rows = rowsOf(original) || [];
      const validRows = rows.filter(row => {
        const data = row?.data || row?.selectedObject || null;
        return Boolean(dataValue(data, 'MatrixRowID') && dataValue(data, 'MatrixVersionID'));
      });
      if (validRows.length && (!identityBest || validRows.length > identityBest.rows.length)) {
        identityBest = { controlName: String(controlName), target, rows: validRows, structuralFallback: false };
      }
      // Structural evidence is allowed only for a genuinely empty rendered table.
      // If rows exist but hidden identities are absent, keep failing closed.
      if (!rows.length) {
        const score = nativeMatrixControlStructuralScore(controlName, original);
        if (score >= 180) structural.push({ controlName: String(controlName), target, rows: [], score, structuralFallback: true });
      }
    }
    if (identityBest) return identityBest;
    structural.sort((a, b) => b.score - a.score);
    if (!structural.length) return null;
    if (structural.length > 1 && structural[0].score === structural[1].score) return null;
    return structural[0];
  }

  function inspectNativeViewCapabilitiesReadOnly(editor, typedField = null) {
    const selected = pickNativeMatrixControl(
      probeControlEntries(editor),
      probeControlRows,
      (data, key) => probeDataValue(data, key, typedField),
    );
    if (!selected) return { found: false, paging: false, refresh: false };
    const target = selected.target;
    const component = target?.viewComponent || target?.component || target;
    return {
      found: true,
      paging: Boolean(
        typeof target?.setPageAndRefresh === 'function'
        || Number.isFinite(Number(component?.currentPage ?? component?._currentPage))
      ),
      refresh: Boolean(
        typeof target?.refresh === 'function'
        || typeof component?.refresh === 'function'
        || typeof target?.setPageAndRefresh === 'function'
      ),
    };
  }

  function probeFieldValue(section, name, typedField = null) {
    const fields = section?.fields;
    if (!fields) return null;
    for (const method of ['tryGetString', 'tryGetGuid', 'tryGetNumber', 'tryGetBoolean', 'tryGetDateTime']) {
      try {
        const value = fields[method]?.(name);
        if (value !== undefined && value !== null) return value;
      } catch (_) { /* continue */ }
    }
    try {
      const value = fields.tryGet?.(name);
      return typedField?.get ? typedField.get(value) : value;
    } catch (_) { return null; }
  }

  function probeLocalizeValueReadOnly(root, value) {
    const textValue = normalizeSpace(value);
    if (!textValue || !textValue.startsWith('$')) return textValue;
    const candidates = [];
    try {
      const module = root?.tessa?.apiLoader?.(880540);
      const manager = module?.LocalizationManager?.instance || module?.LocalizationManager;
      if (manager?.localize) candidates.push([manager, manager.localize]);
      if (module?.LocalizationManager?.localize) candidates.push([module.LocalizationManager, module.LocalizationManager.localize]);
    } catch (_) { /* keep raw localization key */ }
    if (root?.tessa?.localizationManager?.localize) candidates.push([root.tessa.localizationManager, root.tessa.localizationManager.localize]);
    if (root?.tessa?.localize) candidates.push([root.tessa, root.tessa.localize]);
    if (root?.LocalizationManager?.instance?.localize) candidates.push([root.LocalizationManager.instance, root.LocalizationManager.instance.localize]);
    for (const [owner, fn] of candidates) {
      try {
        const localized = typeof fn === 'function' ? fn.call(owner, textValue) : null;
        if (localized && localized !== textValue) return normalizeSpace(localized);
      } catch (_) { /* try next read-only localizer */ }
    }
    return textValue;
  }

  function inspectMatrixCapabilitiesReadOnly(mainCard, typedField = null, localize = null) {
    let section = null;
    try { section = mainCard?.sections?.tryGet?.(S.Matrix) || null; } catch (_) { section = null; }
    const template = probeFieldValue(section, F.TemplateID, typedField);
    const stateName = probeFieldValue(section, 'StateName', typedField);
    const matrixInfo = { StateName: stateName };
    return {
      identity: Boolean(mainCard?.id),
      template: Boolean(template),
      templateId: template ? String(template) : null,
      stateReadable: Boolean(stateName),
      writableState: isWritableMatrixDraft(matrixInfo, localize),
      matrixId: mainCard?.id ? String(mainCard.id) : null,
    };
  }

  function probeAffectVersionSupport(CardStoreRequest) {
    if (typeof CardStoreRequest !== 'function') return false;
    try {
      const proto = CardStoreRequest.prototype;
      if (proto && ('affectVersion' in proto || Object.getOwnPropertyDescriptor(proto, 'affectVersion'))) return true;
    } catch (_) { /* local constructor fallback */ }
    try {
      const request = new CardStoreRequest();
      if (!request || typeof request !== 'object') return false;
      if ('affectVersion' in request) return true;
      request.affectVersion = true;
      return request.affectVersion === true;
    } catch (_) { return false; }
  }

  function probeRuntimeEnvironment(options = {}) {
    const root = options.root || window;
    const extensionRequireFactory = options.extensionRequireFactory || captureExtensionRequire;
    let extRequire = null;
    let cards = null;
    let core = null;
    let cardService = null;
    try {
      extRequire = extensionRequireFactory();
      cards = extRequire?.(9855) || null;
      core = extRequire?.(9814) || null;
      cardService = extRequire?.(9893)?.CardService?.instance || null;
    } catch (_) {
      extRequire = null;
      cards = null;
      core = null;
      cardService = null;
    }

    const apiLoader = typeof root?.tessa?.apiLoader === 'function' ? root.tessa.apiLoader : null;
    let workspace = null;
    try { workspace = apiLoader?.(546914)?.WorkspaceStorage?.instance?.currentCardWorkspace || null; } catch (_) { workspace = null; }
    const editor = workspace?.editor || null;
    const cardModel = editor?.cardModel || null;
    const mainCard = cardModel?.card || null;
    const localize = value => probeLocalizeValueReadOnly(root, value);

    return {
      runtime: {
        extensionRequire: Boolean(extRequire),
        apiLoader: Boolean(apiLoader),
        workspace: Boolean(workspace),
        editor: Boolean(editor),
        cardModel: Boolean(cardModel),
      },
      cardService: {
        get: typeof cardService?.get === 'function',
        request: typeof cardService?.request === 'function',
        store: typeof cardService?.store === 'function',
        newOrCreate: typeof cardService?.new === 'function' || typeof cardService?.create === 'function',
      },
      constructors: {
        cardGetRequest: typeof cards?.CardGetRequest === 'function',
        cardRequest: typeof cards?.CardRequest === 'function',
        cardStoreRequest: typeof cards?.CardStoreRequest === 'function',
        cardNewRequest: typeof cards?.CardNewRequest === 'function',
        affectVersion: probeAffectVersionSupport(cards?.CardStoreRequest),
      },
      matrix: inspectMatrixCapabilitiesReadOnly(mainCard, core?.TypedField || null, localize),
      nativeView: inspectNativeViewCapabilitiesReadOnly(editor, core?.TypedField || null),
    };
  }

  function captureExtensionRequire() {
    const chunks = window.webpackChunktessa_web_extensions;
    if (!Array.isArray(chunks)) throw new Error('Не найден runtime расширений TESSA. Откройте карточку матрицы и повторите.');
    if (extensionRuntimeCache?.chunks === chunks) return extensionRuntimeCache.require;
    let req = null;
    const id = `tms_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    chunks.push([[id], {}, runtime => { req = runtime; }]);
    if (!req) throw new Error('Не удалось подключиться к runtime TESSA.');
    extensionRuntimeCache = { chunks, require: req };
    return req;
  }

  // ---------------------------------------------------------------------------
  // 7. TESSA BRIDGE
  // Единственная зона, которая знает о внутренних API TESSA. Bridge читает карточку
  // матрицы, строки, представления и выполняет CardGet/CardStore/CardRequest.
  // Planner и UI работают через этот слой и не зависят от деталей API напрямую.
  // ---------------------------------------------------------------------------

  // A failed duplicate check is distinguishable from an uncertain Store result.
  // Only this local error type may assert that the row's write was not attempted.
  class DuplicateValidationError extends Error {
    constructor(message, code = 'duplicate-check-failed') {
      super(message);
      this.name = 'DuplicateValidationError';
      this.code = code;
    }
  }

  class TessaBridge {
    constructor() {
      this.extRequire = captureExtensionRequire();
      this.cards = this.extRequire(9855);
      this.cardTypes = this.extRequire(5951).D;
      this.core = this.extRequire(9814);
      this.cardService = this.extRequire(9893).CardService.instance;
      const workspaceModule = window.tessa?.apiLoader?.(546914);
      this.workspace = workspaceModule?.WorkspaceStorage?.instance?.currentCardWorkspace || null;
      this.editor = this.workspace?.editor || null;
      this.mainCard = this.editor?.cardModel?.card || null;
      if (!this.cardService || !this.mainCard) throw new Error('Активная карточка TESSA не найдена.');
      if (!this.mainCard.sections?.tryGet?.(S.Matrix)) throw new Error('Открытая карточка не является матрицей маршрута.');
    }

    static async create() {
      const bridge = new TessaBridge();
      await bridge.ensureNoUnsavedChanges();
      return bridge;
    }

    async ensureNoUnsavedChanges() {
      const hasChanges = await this.editor?.cardModel?.hasChanges?.();
      if (hasChanges) throw new Error('В карточке есть несохранённые изменения. Сначала сохраните или обновите карточку TESSA.');
    }

    get FieldType() { return this.core.FieldType; }
    get Guid() { return this.core.Guid; }
    get TypedField() { return this.core.TypedField; }
    get StorageHelper() { return this.core.StorageHelper; }
    get CardRowState() { return this.cards.CardRowState; }

    section(card, name, create = false) {
      if (create) return card.sections.getOrAdd(name);
      return card.sections.tryGet(name);
    }

    fieldFromSection(section, name) {
      const fields = section?.fields;
      if (!fields) return null;
      for (const method of ['tryGetString', 'tryGetGuid', 'tryGetNumber', 'tryGetBoolean', 'tryGetDateTime']) {
        try {
          const value = fields[method]?.(name);
          if (value !== null && value !== undefined) return value;
        } catch (_) { /* continue */ }
      }
      try {
        const field = fields.tryGet?.(name);
        const value = field ? this.TypedField.get(field) : null;
        return value ?? null;
      } catch (_) { return null; }
    }

    rowValue(row, name) {
      for (const method of ['tryGetString', 'tryGetNumber', 'tryGetBoolean', 'tryGetDateTime']) {
        try {
          const value = row?.[method]?.(name);
          if (value !== null && value !== undefined) return value;
        } catch (_) { /* continue */ }
      }
      try {
        const field = row?.tryGetField?.(name);
        return field ? this.TypedField.get(field) : null;
      } catch (_) { return null; }
    }

    isDeleted(row) {
      return row?.state === this.CardRowState.Deleted;
    }

    validationError(response, context) {
      if (response?.validationResult?.isSuccessful) return null;
      let detail = '';
      try {
        const built = response?.validationResult?.build?.();
        detail = built?.toString?.() || JSON.stringify(built);
      } catch (_) { detail = ''; }
      return new Error(`${context}${detail ? `: ${detail}` : ''}`);
    }

    async requestStructure(templateId) {
      const req = new this.cards.CardRequest();
      req.requestType = REQUEST.Structure;
      req.cardId = templateId;
      const response = await this.cardService.request(req);
      const error = this.validationError(response, 'TESSA не вернула структуру матрицы');
      if (error) throw error;
      const getString = value => this.TypedField.getString(value);
      const conditions = (response.info?.Conditions || []).map(item => ({
        criterionRowId: getString(item.CriterionRowID),
        criterionName: getString(item.CriterionName),
        operatorTypeId: getString(item.OperatorType),
        operandTypeId: getString(item.OperandType),
        refSection: item.RefSection ? getString(item.RefSection) : null,
        popupIndices: item.PopupIndices ? getString(item.PopupIndices) : null,
        autocompleteViewName: item.AutocompleteViewName ? getString(item.AutocompleteViewName) : null,
        autocompleteParamName: item.AutocompleteParamName ? getString(item.AutocompleteParamName) : null,
      }));
      const functions = (response.info?.Functions || []).map(item => ({
        id: getString(item.FunctionRowID),
        name: getString(item.FunctionName),
        typeId: getString(item.FunctionType.ID),
        typeName: getString(item.FunctionType.Name),
      }));
      return { templateId, conditions, functions };
    }

    templateId() {
      return this.fieldFromSection(this.section(this.mainCard, S.Matrix), F.TemplateID);
    }

    async tryGetCard(cardId) {
      if (!cardId) return { card: null, error: new Error('Пустой идентификатор карточки строки.') };
      const req = new this.cards.CardGetRequest();
      req.cardId = String(cardId);
      const response = await this.cardService.get(req);
      const error = this.validationError(response, `Не удалось открыть строку ${cardId}`);
      return error ? { card: null, error, response } : { card: response.card, error: null, response };
    }

    async getCard(cardId) {
      const result = await this.tryGetCard(cardId);
      if (result.error) throw result.error;
      return result.card;
    }

    cardNewMethodName() {
      // В поддерживаемых сборках TESSA метод создания карточки встречается
      // под именами `new` и `create`. Поддерживаем оба варианта и не начинаем
      // запись, если среда не предоставляет ни одного из них.
      if (typeof this.cardService?.new === 'function') return 'new';
      if (typeof this.cardService?.create === 'function') return 'create';
      return null;
    }

    assertCanCreateRows() {
      const methodName = this.cardNewMethodName();
      if (!methodName) {
        const available = this.cardService
          ? Object.getOwnPropertyNames(Object.getPrototypeOf(this.cardService) || {})
              .filter(name => typeof this.cardService[name] === 'function')
              .sort()
          : [];
        throw new Error(`В этой сборке TESSA не найден метод получения новой карточки строки (ожидался CardService.new или CardService.create). Доступно: ${available.join(', ') || 'нет данных'}.`);
      }
      return methodName;
    }

    async createRowCard(templateId) {
      const req = new this.cards.CardNewRequest();
      req.cardTypeId = this.cardTypes.mtxRouteMatrixRow.id;
      req.cardTypeName = this.cardTypes.mtxRouteMatrixRow.alias;
      const methodName = this.assertCanCreateRows();
      const response = await this.cardService[methodName](req);
      const error = this.validationError(response, 'Не удалось получить структуру новой строки матрицы');
      if (error) throw error;
      const card = response?.card;
      if (!card) throw new Error(`CardService.${methodName} не вернул структуру карточки новой строки.`);
      card.id = this.Guid.newGuid();
      this.section(card, S.MatrixRow, true).fields.set(F.TemplateID, templateId, this.FieldType.Guid);
      const version = this.addRow(this.section(card, S.Versions, true));
      version.rowId = this.Guid.newGuid();
      version.state = this.CardRowState.Inserted;
      version.set(F.LinkCount, 0, this.FieldType.Int);
      return { card, cardId: String(card.id), versionId: String(version.rowId), newMethod: methodName };
    }

    addRow(section) {
      if (section.rows?.add) return section.rows.add();
      const row = new this.cards.CardRow();
      section.rows.push(row);
      return row;
    }

    removeOrDelete(section, row) {
      if (row.state === this.CardRowState.Inserted) {
        if (section.rows?.remove) section.rows.remove(row);
        else {
          const index = section.rows.indexOf(row);
          if (index >= 0) section.rows.splice(index, 1);
        }
      } else row.state = this.CardRowState.Deleted;
    }

    dataValue(data, key) {
      if (!data) return null;
      try {
        if (typeof data.get === 'function') {
          const value = data.get(key);
          if (value !== null && value !== undefined) return value;
        }
      } catch (_) { /* continue */ }
      try {
        if (typeof data.tryGet === 'function') {
          const value = data.tryGet(key);
          if (value !== null && value !== undefined) return this.TypedField.get(value);
        }
      } catch (_) { /* continue */ }
      return data[key] ?? null;
    }

    controlEntries() {
      const controls = this.editor?.cardModel?.controls;
      if (!controls) return [];
      try { if (typeof controls.entries === 'function') return Array.from(controls.entries()); } catch (_) { /* continue */ }
      if (Array.isArray(controls)) return controls.map((value, index) => [String(index), value]);
      return Object.entries(controls);
    }

    rowsOfControl(control) {
      const candidates = [control, control?.control, control?.model, control?.viewModel];
      for (const candidate of candidates) {
        const rows = candidate?.table?.rows;
        if (rows) {
          try { return Array.from(rows); } catch (_) { /* continue */ }
        }
      }
      return [];
    }

    findNativeMatrixViewLinks() {
      let best = null;
      for (const [controlName, control] of this.controlEntries()) {
        const rows = this.rowsOfControl(control);
        if (!rows.length) continue;
        const links = [];
        for (let index = 0; index < rows.length; index += 1) {
          const viewRow = rows[index];
          const data = viewRow?.data || viewRow?.selectedObject || null;
          const rowCardId = this.dataValue(data, 'MatrixRowID');
          const versionId = this.dataValue(data, 'MatrixVersionID');
          if (!rowCardId || !versionId) continue;
          const order = this.dataValue(data, 'Order');
          links.push({
            index,
            rowCardId: String(rowCardId),
            versionId: String(versionId),
            rowName: order !== null && order !== undefined && String(order) !== '' ? `Строка ${order}` : `Строка ${index + 1}`,
            source: 'native-view',
          });
        }
        const deduped = [...new Map(links.map(link => [canonicalValue(link.versionId), link])).values()];
        if (deduped.length && (!best || deduped.length > best.links.length)) {
          best = { controlName: String(controlName), visibleRows: rows.length, links: deduped };
        }
      }
      return best || { controlName: null, visibleRows: 0, links: [] };
    }

    nativePagingInfo(target) {
      const component = target?.viewComponent || target?.component || target;
      const currentPage = Number(component?.currentPage ?? component?._currentPage ?? 1) || 1;
      const pageLimit = Number(component?.pageLimit ?? component?._pageLimit ?? target?.viewMetadata?.pageLimit ?? 50) || 50;
      const calculatedRowCount = Number(component?.calculatedRowCount ?? component?._calculatedRowCount ?? 0) || 0;
      const explicitPageCount = Number(component?.pageCount ?? component?._pageCount ?? 0) || 0;
      const pageCount = explicitPageCount || (calculatedRowCount ? Math.ceil(calculatedRowCount / pageLimit) : 1);
      return { component, currentPage, pageLimit, calculatedRowCount, pageCount: Math.max(1, pageCount) };
    }

    async collectNativeMatrixViewLinksAllPages(options = {}) {
      const nativeControl = this.findNativeMatrixControl();
      if (!nativeControl) return this.findNativeMatrixViewLinks();
      const { target, controlName } = nativeControl;
      const initialPaging = this.nativePagingInfo(target);
      const originalPage = initialPaging.currentPage;
      const canPage = typeof target?.setPageAndRefresh === 'function';

      // В production-контроле TESSA calculatedRowCount/pageCount могут отсутствовать,
      // даже когда реально есть несколько страниц. Поэтому нельзя доверять pageCount=1:
      // обходим страницы динамически, пока новая страница перестаёт приносить новые versionId.
      if (!canPage) {
        const single = this.findNativeMatrixViewLinks();
        return { ...single, pageCount: 1, pagesVisited: [originalPage], pagingUsed: false, dynamicPaging: false };
      }

      const collected = [];
      const seenVersions = new Set();
      const pagesVisited = [];
      const explicitPageLimit = Number(
        target?.viewMetadata?.pageLimit
        ?? target?.metadata?.pageLimit
        ?? initialPaging.component?.pageLimit
        ?? initialPaging.component?._pageLimit
        ?? 0
      ) || 0;
      const pageLimitHint = Math.max(1, explicitPageLimit || nativeControl.rows?.length || 20);
      const maxPages = 10000;

      const collectPage = (page) => {
        const rows = this.rowsOfControl(target);
        let added = 0;
        rows.forEach((viewRow, index) => {
          const data = viewRow?.data || viewRow?.selectedObject || null;
          const rowCardId = this.dataValue(data, 'MatrixRowID');
          const versionId = this.dataValue(data, 'MatrixVersionID');
          if (!rowCardId || !versionId) return;
          const versionKey = canonicalValue(versionId);
          if (seenVersions.has(versionKey)) return;
          seenVersions.add(versionKey);
          const order = this.dataValue(data, 'Order');
          collected.push({
            index: collected.length,
            page,
            pageIndex: index,
            rowCardId: String(rowCardId),
            versionId: String(versionId),
            rowName: order !== null && order !== undefined && String(order) !== '' ? `Строка ${order}` : `Строка ${collected.length + 1}`,
            source: 'native-view-all-pages-dynamic',
          });
          added += 1;
        });
        return { rows, added };
      };

      try {
        // Всегда начинаем с первой страницы: пользователь мог находиться на любой странице.
        for (let page = 1; page <= maxPages; page += 1) {
          if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
          await options.assertContext?.();

          const before = this.nativePagingInfo(target);
          if (page !== before.currentPage || page === 1) {
            await target.setPageAndRefresh(page);
          }

          // Ждём завершения загрузки. Некоторые сборки не публикуют currentPage,
          // поэтому дополнительно ждём стабильные строки, а не только флаг loading.
          let lastSignature = null;
          let stableTicks = 0;
          for (let wait = 0; wait < 120; wait += 1) {
            await options.assertContext?.();
            const state = this.nativePagingInfo(target);
            const rows = this.rowsOfControl(target);
            const signature = rows.map(row => {
              const data = row?.data || row?.selectedObject || null;
              return canonicalValue(this.dataValue(data, 'MatrixVersionID') || '');
            }).filter(Boolean).join('|');
            const loading = !!(state.component?.isDataLoading || state.component?._isDataLoading);
            if (!loading && signature === lastSignature) stableTicks += 1;
            else stableTicks = 0;
            lastSignature = signature;
            if (!loading && stableTicks >= 2) break;
            await sleep(50);
          }

          const { rows, added } = collectPage(page);
          if (!pagesVisited.includes(page)) pagesVisited.push(page);

          // Пустая страница, повтор последней страницы или неполная последняя страница —
          // естественные признаки конца данных.
          if (!rows.length) break;
          if (added === 0 && page > 1) break;
          if (rows.length < pageLimitHint) break;

          // Если TESSA явно публикует pageCount — используем его лишь как дополнительный стоп,
          // но не как единственный источник истины.
          const after = this.nativePagingInfo(target);
          if (after.pageCount > 1 && page >= after.pageCount) break;
        }
      } catch (error) {
        log(`Не удалось полностью обойти страницы представления «${controlName}»: ${error.message || error}.`, 'warn');
      } finally {
        try {
          await options.assertContext?.();
          const current = this.nativePagingInfo(target).currentPage;
          if (current !== originalPage) await target.setPageAndRefresh(originalPage);
        } catch (_) { /* restore is best effort */ }
      }

      const links = [...new Map(collected.map(link => [canonicalValue(link.versionId), link])).values()];
      return {
        controlName,
        visibleRows: nativeControl.rows.length,
        links,
        pageCount: Math.max(initialPaging.pageCount || 1, pagesVisited.length || 1),
        pagesVisited,
        pagingUsed: pagesVisited.length > 1,
        dynamicPaging: true,
      };
    }

    rawMatrixSectionLinks() {
      const rows = this.section(this.mainCard, S.MatrixRows)?.rows || [];
      return Array.from(rows)
        .filter(row => !this.isDeleted(row))
        .map((row, index) => ({
          index,
          cardRowId: row?.rowId ? String(row.rowId) : null,
          rowID: this.rowValue(row, F.MatrixRowCardID),
          rowRowID: this.rowValue(row, F.MatrixRowVersionID),
          rowName: this.rowValue(row, F.MatrixRowName) || `Строка ${index + 1}`,
        }));
    }


    // Быстрый маркер состава матрицы. Он используется только для повторного предпросмотра:
    // перед фактической записью сервер всё равно перечитывается и валидируется заново.
    matrixSectionSignature() {
      const versions = this.rawMatrixSectionLinks()
        .map(item => canonicalValue(item.rowRowID || ''))
        .filter(Boolean)
        .sort();
      return `${versions.length}:${hashText(JSON.stringify(versions))}`;
    }

    async resolveMatrixSectionLinks(nativeLinks = []) {
      // ВАЖНО: MtxRouteMatrixRows.RowID и RowRowID — идентификаторы строк/версий
      // секции, а НЕ CardID карточки строки. Их нельзя передавать в CardGet.
      // Истинные CardID находятся в скрытом MatrixRowID нативного представления.
      const rawLinks = this.rawMatrixSectionLinks();
      const byVersion = new Map((nativeLinks || []).map(link => [canonicalValue(link.versionId), link]));
      const resolved = [];
      const unresolved = [];

      for (const raw of rawLinks) {
        const versionCandidates = [raw.rowRowID, raw.rowID, raw.cardRowId].filter(Boolean).map(canonicalValue);
        const match = versionCandidates.map(id => byVersion.get(id)).find(Boolean) || null;
        if (match) {
          resolved.push({ ...match, index: raw.index, rowName: raw.rowName || match.rowName });
        } else {
          unresolved.push({
            index: raw.index,
            rowName: raw.rowName,
            sectionRowId: raw.cardRowId,
            rowID: raw.rowID,
            rowRowID: raw.rowRowID,
          });
        }
      }

      if (unresolved.length) {
        const first = unresolved[0];
        throw new Error(
          `Нативное представление TESSA вернуло ${resolved.length} из ${rawLinks.length} строк. `
          + `Не удалось получить MatrixRowID для строки ${first.index + 1}. `
          + 'Обновите карточку TESSA (F5) и повторите выгрузку. Служебные RowID/RowRowID намеренно не используются как CardID.'
        );
      }
      return resolved;
    }

    matrixInfo() {
      const section = this.section(this.mainCard, S.Matrix);
      const names = [
        'TemplateID', 'TemplateName', 'StateID', 'StateName', 'Version',
        'PreviousVersionID', 'PreviousVersionCreatedDate', 'PreviousVersionTypeName',
        'FirstVersionID', 'ApplyTypeID', 'ApplyTypeName', 'CreatedDate',
        'ActualizationDate', 'OutdatingDate', 'AuthorID', 'AuthorName',
        'AuthorPositionName', 'AuthorComment',
      ];
      const fields = {};
      for (const name of names) fields[name] = this.fieldFromSection(section, name);
      // StateName в TESSA может приходить как $Mtx_Enums_* localization key.
      // Локализуем его в bridge один раз, чтобы UI, Excel и safety-guard видели одно состояние.
      if (fields.StateName) fields.StateName = this.localizeValue(fields.StateName);
      return { matrixId: String(this.mainCard.id), ...fields };
    }

    unwrapTyped(value) {
      try {
        const unwrapped = this.TypedField.get(value);
        if (unwrapped !== undefined) return unwrapped;
      } catch (_) { /* keep original */ }
      return value;
    }

    dictionaryEntries(value) {
      if (!value) return [];
      try { if (typeof value.entries === 'function') return Array.from(value.entries()); } catch (_) { /* continue */ }
      return Object.entries(value);
    }

    findNativeMatrixControl() {
      return pickNativeMatrixControl(
        this.controlEntries(),
        control => this.rowsOfControl(control),
        (data, key) => this.dataValue(data, key),
      );
    }

    repositoryViewAliases() {
      const api = this.viewApi();
      const views = api?.serviceModule?.ViewService?._repository?._views;
      return views?.entries ? [...views.entries()].map(([alias, internal]) => ({ alias: String(alias), metadata: internal?._meta || internal?.metadata || null })) : [];
    }

    findCompatibleViewAlias(condition) {
      const api = this.viewApi();
      if (!api) return null;
      const directCandidates = [condition.autocompleteViewName, condition.refSection, condition.autocompleteViewName ? `${condition.autocompleteViewName}s` : null, condition.refSection ? `${condition.refSection}s` : null, condition.autocompleteViewName ? `Gch${condition.autocompleteViewName}` : null].filter(Boolean);
      for (const candidate of directCandidates) {
        try { if (api.service.getByName(candidate)?.metadata) return candidate; } catch (_) { /* continue */ }
      }
      return null;
    }

    dictionaryReferences(metadata) {
      const refs = metadata?.references || metadata?.References || [];
      const values = Array.isArray(refs) ? refs : typeof refs.values === 'function' ? [...refs.values()] : Object.values(refs);
      return values.map(ref => ({
        colPrefix: ref.colPrefix ?? ref.ColPrefix ?? '',
        refSection: ref.refSection ?? ref.RefSection ?? [],
        displayValueColumn: ref.displayValueColumn ?? ref.DisplayValueColumn ?? '',
      }));
    }

    dictionaryProjection(result, options = {}) {
      const columns = Array.from(result.columns || []);
      const index = name => columns.findIndex(col => canonicalValue(col) === canonicalValue(name));
      const refs = result.references || [];
      const section = canonicalValue(options.refSection || '');
      const sections = ref => (Array.isArray(ref.refSection) ? ref.refSection : String(ref.refSection || '').split(/\s+/)).filter(x => typeof x === 'string').map(canonicalValue);
      const matched = refs.filter(ref => sections(ref).includes(section));
      // The native selector uses the first reference matching RefSection.
      const reference = matched[0] || (!section && refs.length === 1 ? refs[0] : null);
      let prefix = reference?.colPrefix;
      let displayColumn = reference?.displayValueColumn;
      if (!prefix) {
        // Older SDKs omit reference metadata. Use an exact column pair only;
        // never infer identity from row contents or choose a parent by score.
        const stems = [options.roleMode ? 'Role' : '', options.refSection || '', result.alias || '']
          .flatMap(value => { const base = value.replace(/^Gch/, '').replace(/Multi$/, ''); return [value, base, base.replace(/ies$/, 'y').replace(/s$/, ''), base.replace(/^Ord/, '').replace(/s$/, '')]; }).filter(Boolean);
        const pairs = columns.filter(col => /ID$/i.test(col)).map(col => col.slice(0, -2)).filter(stem => ['Name', 'Title', 'FullName', 'Caption'].some(end => index(`${stem}${end}`) >= 0));
        prefix = stems.find(stem => index(`${stem}ID`) >= 0 && ['Name', 'Title', 'FullName', 'Caption'].some(end => index(`${stem}${end}`) >= 0));
        if (!prefix && pairs.length === 1) prefix = pairs[0];
        if (!prefix && index('ID') >= 0) prefix = '';
        if (prefix === undefined) throw new Error('Не определена ссылка справочника: нет однозначной пары ID/название. Обновите диагностику метаданных.');
      }
      const idIndex = index(`${prefix}ID`);
      let displayIndex = displayColumn ? index(displayColumn) : -1;
      if (displayIndex < 0) displayIndex = ['Name', 'Title', 'FullName', 'Caption'].map(end => index(`${prefix}${end}`)).find(i => i >= 0) ?? -1;
      if (idIndex < 0 || displayIndex < 0 || idIndex === displayIndex) throw new Error('Колонки ссылки справочника не найдены в ответе TESSA.');
      return { idIndex, displayIndex, idColumn: columns[idIndex], displayColumn: columns[displayIndex], refSection: options.refSection || '', via: reference ? 'metadata' : 'exact-column-pair' };
    }

    localizeValue(value) {
      const text = normalizeSpace(value);
      if (!text || !text.startsWith('$')) return text;
      const candidates = [];
      try {
        const module = window.tessa?.apiLoader?.(880540);
        const manager = module?.LocalizationManager?.instance || module?.LocalizationManager;
        if (manager?.localize) candidates.push([manager, manager.localize]);
        if (module?.LocalizationManager?.localize) candidates.push([module.LocalizationManager, module.LocalizationManager.localize]);
      } catch (_) { /* fallback */ }
      if (window.tessa?.localizationManager?.localize) candidates.push([window.tessa.localizationManager, window.tessa.localizationManager.localize]);
      if (window.tessa?.localize) candidates.push([window.tessa, window.tessa.localize]);
      if (window.LocalizationManager?.instance?.localize) candidates.push([window.LocalizationManager.instance, window.LocalizationManager.instance.localize]);
      for (const [owner, fn] of candidates) {
        try {
          const localized = typeof fn === 'function' ? fn.call(owner, text) : null;
          if (localized && localized !== text) return normalizeSpace(localized);
        } catch (_) { /* fallback */ }
      }
      return text;
    }

    extractDictionaryEntries(result, options = {}) {
      if (!result || result.error || !Array.isArray(result.rows)) return [];
      const columns = Array.from(result.columns || []);
      const rows = result.rows || [];
      const { idIndex, displayIndex } = this.dictionaryProjection(result, options);
      const roleMode = Boolean(options.roleMode);
      let roleTypeIndex = columns.findIndex(alias => /roletypeid/i.test(String(alias)));
      if (roleMode && roleTypeIndex < 0 && rows.some(row => row.length > columns.length && Number.isFinite(Number(row[row.length - 1])))) roleTypeIndex = Math.max(...rows.map(row => row.length)) - 1;
      const hiddenIndex = columns.findIndex(alias => /(?:^|Is)Hidden$|Disabled$/i.test(String(alias)));
      const activeIndex = columns.findIndex(alias => /(?:^|Is)Active$/i.test(String(alias)));
      const entries = [];
      for (const row of rows) {
        const id = row[idIndex];
        let display = this.localizeValue(row[displayIndex]);
        if (isGuidLike(display) || /^\$[A-Za-z0-9_.-]+$/.test(display)) continue;
        if (!display || id === null || id === undefined || id === '') continue;
        const hidden = hiddenIndex >= 0 && [true, 1, '1', 'true'].includes(row[hiddenIndex]);
        const inactive = activeIndex >= 0 && [false, 0, '0', 'false'].includes(row[activeIndex]);
        if (hidden || inactive) continue;
        const roleTypeId = roleTypeIndex >= 0 && row[roleTypeIndex] !== null && row[roleTypeIndex] !== undefined && row[roleTypeIndex] !== '' ? Number(row[roleTypeIndex]) : '';
        const details = columns.map((alias, index) => {
          if (index === idIndex || index === displayIndex || index === roleTypeIndex) return '';
          const value = this.localizeValue(row[index]);
          if (value === null || value === undefined || String(value).trim() === '') return '';
          if (typeof value === 'object') return '';
          return `${normalizeSpace(alias)}: ${normalizeSpace(value)}`;
        }).filter(Boolean).join(' | ').slice(0, 4000);
        const qualifier = humanQualifierFromDetails(details, display);
        const searchText = searchCanonical(`${display} ${qualifier} ${details} ${row.map(value => typeof value === 'object' ? '' : normalizeSpace(this.localizeValue(value))).join(' ')}`);
        entries.push({ id: String(id), display, qualifier, roleTypeId: Number.isFinite(roleTypeId) ? roleTypeId : '', source: result.alias, status: 'Доступно', details, searchText });
      }
      return entries;
    }

    async loadDictionaryCatalog(structure, snapshot, options = {}) {
      const forceRefresh = Boolean(options.forceRefresh);
      const cacheKey = dictionaryCacheKey(structure);
      if (!forceRefresh && APP.dictionaryCatalog?.stats?.cache?.key === cacheKey) {
        const merged = mergeSnapshotIntoDictionaryCatalog(APP.dictionaryCatalog, structure, snapshot);
        merged.stats.cache = { ...APP.dictionaryCatalog.stats.cache, hit: true, key: cacheKey, source: 'memory' };
        log(`Словари: использую кэш текущей вкладки (${merged.stats.entries} значений).`);
        return merged;
      }
      if (!forceRefresh) {
        const cached = await readDictionaryCache(cacheKey);
        if (cached?.catalog) {
          const merged = mergeSnapshotIntoDictionaryCatalog(cached.catalog, structure, snapshot);
          const ageMs = Math.max(0, Date.now() - Number(cached.savedAt || Date.now()));
          merged.stats.cache = { hit: true, key: cacheKey, savedAt: cached.savedAt, ageMs };
          log(`Словари: использую локальный кэш (${merged.stats.entries} значений, возраст ${Math.max(1, Math.round(ageMs / 60000))} мин.).`);
          return merged;
        }
      } else if (!options.transient) {
        await deleteDictionaryCache(cacheKey);
      }

      const catalog = { catalogs: {}, columnCatalogIds: {}, stats: { catalogs: 0, entries: 0, errors: [] } };
      const criterionGroups = new Map();
      for (const condition of structure.conditions) {
        const operand = canonicalValue(condition.operandTypeId);
        const key = definitionKey('criterion', condition.criterionRowId);
        if (operand === canonicalValue(OPERAND.Boolean)) {
          const catalogId = `boolean:${condition.criterionRowId}`;
          catalog.catalogs[catalogId] = { id: catalogId, label: condition.criterionName, sourceView: 'Boolean', entries: [{ id: 'true', display: 'Да', value: true, kind: 'Boolean', source: 'Boolean' }, { id: 'false', display: 'Нет', value: false, kind: 'Boolean', source: 'Boolean' }] };
          catalog.columnCatalogIds[key] = catalogId;
          continue;
        }
        if (![canonicalValue(OPERAND.ReferenceGuid), canonicalValue(OPERAND.ReferenceInt)].includes(operand)) continue;
        const alias = this.findCompatibleViewAlias(condition);
        const catalogId = `criterion-view:${alias || condition.autocompleteViewName || condition.refSection || condition.criterionRowId}:${operand}:${condition.refSection || ''}`;
        catalog.columnCatalogIds[key] = catalogId;
        if (!criterionGroups.has(catalogId)) criterionGroups.set(catalogId, { alias, conditions: [], wantedKind: operand === canonicalValue(OPERAND.ReferenceInt) ? 'int' : 'guid' });
        criterionGroups.get(catalogId).conditions.push(condition);
      }

      const queries = new Map();
      const query = alias => { if (!queries.has(alias)) queries.set(alias, this.queryViewSample(alias, 200000, { forceRefresh })); return queries.get(alias); };

      // Самые тяжёлые представления (GchPartners и MtxRoles) читаются параллельно.
      const criterionJobs = [...criterionGroups.entries()].map(async ([catalogId, group]) => {
        const label = group.conditions.map(item => item.criterionName).join(' / ');
        let entries = [], projection = null, sourceCount = 0;
        if (group.alias) {
          log(`Словарь: ${label} ← ${group.alias}`);
          const result = await query(group.alias);
          if (result.error) catalog.stats.errors.push(`${group.alias}: ${String(result.error).split('\n')[0]}`);
          else {
            try { projection = this.dictionaryProjection(result, { refSection: group.conditions[0].refSection }); entries = this.extractDictionaryEntries(result, { wantedKind: group.wantedKind, refSection: group.conditions[0].refSection }); sourceCount = entries.length; }
            catch (error) { catalog.stats.errors.push(`${label}: ${error.message}`); }
            if (result.truncated) catalog.stats.errors.push(`${group.alias}: получено ${result.rows.length} из ${result.rowCount}; словарь неполный`);
          }
        } else catalog.stats.errors.push(`${label}: подходящее представление не найдено`);
        return { catalogId, catalog: { id: catalogId, label, sourceView: group.alias || 'Текущая матрица', projection, sourceCount, entries } };
      });

      const roleJob = (async () => {
        const roleCatalogId = 'roles:MtxRoles';
        let roleEntries = [];
        let roleAlias = null;
        for (const alias of ['MtxRoles']) {
          log(`Словарь ролей: пробую ${alias}`);
          const result = await query(alias);
          if (result.error) catalog.stats.errors.push(`Роли: ${result.error}`);
          if (!result.error && result.rows?.length) {
            roleAlias = alias;
            try { roleEntries = this.extractDictionaryEntries(result, { wantedKind: 'guid', roleMode: true }); }
            catch (error) { catalog.stats.errors.push(`Роли: ${error.message}`); }
            if (result.truncated) catalog.stats.errors.push(`${alias}: получено ${result.rows.length} из ${result.rowCount}; словарь ролей неполный`);
            if (roleEntries.length) break;
          }
        }
        return { roleCatalogId, roleAlias, roleEntries };
      })();

      const [criterionResults, roleResult] = await Promise.all([Promise.all(criterionJobs), roleJob]);
      for (const item of criterionResults) catalog.catalogs[item.catalogId] = item.catalog;

      // FunctionType.ID uses the same numeric role-type domain as RoleTypeID.
      // MtxRoles contains multiple role classes, so exposing one shared catalog to every
      // function lets departments leak into Personal pickers (and vice versa). Partition
      // only when the server actually returned typed role entries. Unknown/custom function
      // types keep the old conservative shared catalog instead of being guessed.
      const sharedRoleCatalog = {
        id: roleResult.roleCatalogId,
        label: 'Роли и пользователи TESSA',
        sourceView: roleResult.roleAlias || 'Текущая матрица',
        entries: roleResult.roleEntries,
      };
      const hasTypedRoleEntries = roleResult.roleEntries.some(entry => knownRoleTypeId(entry.roleTypeId) !== null);
      const typedRoleCatalogIds = new Map();
      const ensureSharedRoleCatalog = () => {
        if (!catalog.catalogs[roleResult.roleCatalogId]) catalog.catalogs[roleResult.roleCatalogId] = sharedRoleCatalog;
        return roleResult.roleCatalogId;
      };

      for (const fn of structure.functions) {
        const functionRoleTypeId = hasTypedRoleEntries ? knownRoleTypeId(fn.typeId) : null;
        if (functionRoleTypeId === null) {
          catalog.columnCatalogIds[definitionKey('function', fn.id)] = ensureSharedRoleCatalog();
          continue;
        }
        let typedCatalogId = typedRoleCatalogIds.get(functionRoleTypeId);
        if (!typedCatalogId) {
          typedCatalogId = `${roleResult.roleCatalogId}:type:${functionRoleTypeId}`;
          typedRoleCatalogIds.set(functionRoleTypeId, typedCatalogId);
          catalog.catalogs[typedCatalogId] = {
            ...sharedRoleCatalog,
            id: typedCatalogId,
            label: `Роли и пользователи TESSA · тип ${functionRoleTypeId}`,
            entries: roleResult.roleEntries.filter(entry => knownRoleTypeId(entry.roleTypeId) === functionRoleTypeId),
          };
        }
        catalog.columnCatalogIds[definitionKey('function', fn.id)] = typedCatalogId;
      }

      const normalized = mergeSnapshotIntoDictionaryCatalog(catalog, structure, snapshot);
      normalized.stats.cache = { hit: false, key: cacheKey, savedAt: options.transient ? null : Date.now(), ageMs: 0, ...(options.transient ? { transient: true } : {}) };
      const cached = options.transient || await writeDictionaryCache(cacheKey, normalized);
      if (!cached) normalized.stats.errors.push('Локальный кэш словарей недоступен; следующая выгрузка снова запросит данные TESSA.');
      return normalized;
    }

    async queryViewSample(viewAlias, maxRows = 100, options = {}) {
      const api = this.viewApi();
      if (!api || !viewAlias) return { alias: viewAlias, error: 'View API unavailable' };
      const view = api.service.getByName(viewAlias);
      if (!view?.metadata) return { alias: viewAlias, error: 'View not found' };
      const request = new api.serviceModule.TessaViewRequest(view.metadata);
      request.calculateRowCounting = true;
      request.canUseCache = !options.forceRefresh;
      try {
        const result = await view.getData(request);
        const columns = Array.from(result?.columns || []);
        const rows = Array.from(result?.rows || []).slice(0, maxRows).map(row => Array.from(row || []).map(value => safePlain(this.unwrapTyped(value), { maxDepth: 5 })));
        return {
          alias: viewAlias,
          references: this.dictionaryReferences(view.metadata),
          columns,
          schemeTypes: Array.from(result?.schemeTypes || []).map(item => item?.toString?.() || String(item)),
          rowCount: result?.rowCount ?? rows.length,
          returnedRows: Array.from(result?.rows || []).length,
          complete: (result?.rowCount ?? rows.length) <= Array.from(result?.rows || []).length,
          rows,
          truncated: Number(result?.rowCount ?? rows.length) > rows.length || Array.from(result?.rows || []).length > rows.length,
          info: safePlain(result?.info, { maxDepth: 7, maxKeys: 500, maxArray: 2000 }),
        };
      } catch (error) {
        if (options.throwOnError) throw error;
        return { alias: viewAlias, error: error.message || String(error) };
      }
    }

    readMatrixRowFromCard(card, link, structure, caches = {}) {
      const criterionIdCache = caches.criterionIdCache || null;
      const roleIdCache = caches.roleIdCache || null;
      const roleIdByFunctionCache = caches.roleIdByFunctionCache || null;
      const versionsSection = this.section(card, S.Versions);
      const versionExists = (versionsSection?.rows || []).some(row =>
        !this.isDeleted(row) && canonicalValue(row.rowId) === canonicalValue(link.versionId));
      if (!versionExists) {
        throw new Error(`MatrixVersionID ${link.versionId || ''} для строки ${link.rowCardId || ''} больше не существует.`);
      }
      const valuesSection = this.section(card, S.Values);
      const rolesSection = this.section(card, S.Roles);
      const flat = {};
      const values = {};
      const roles = {};

      for (const condition of structure.conditions) {
        const rows = (valuesSection?.rows || []).filter(row =>
          !this.isDeleted(row)
          && canonicalValue(this.rowValue(row, F.OwnerRowID)) === canonicalValue(link.versionId)
          && canonicalValue(this.rowValue(row, F.CriterionRowID)) === canonicalValue(condition.criterionRowId));
        const items = rows.map(row => this.readCriterionValue(row, condition)).filter(Boolean);
        values[condition.criterionRowId] = items;
        flat[definitionKey('criterion', condition.criterionRowId)] = items.map(x => x.display);
        if (criterionIdCache) {
          for (const item of items) {
            if (item.id !== null && item.id !== undefined && item.id !== '') {
              const cacheKey = `${condition.criterionRowId}|${canonicalValue(item.display)}`;
              if (!criterionIdCache.has(cacheKey)) criterionIdCache.set(cacheKey, item);
              else if (canonicalValue(criterionIdCache.get(cacheKey).id) !== canonicalValue(item.id)) criterionIdCache.set(cacheKey, { ambiguous: true, display: item.display });
            }
          }
        }
      }

      for (const fn of structure.functions) {
        const rows = (rolesSection?.rows || []).filter(row =>
          !this.isDeleted(row)
          && canonicalValue(this.rowValue(row, F.OwnerRowID)) === canonicalValue(link.versionId)
          && canonicalValue(this.rowValue(row, F.FunctionID)) === canonicalValue(fn.id));
        const items = rows.map(row => ({
          id: this.rowValue(row, F.RoleID),
          display: this.rowValue(row, F.RoleName) || '',
          roleTypeId: this.rowValue(row, F.RoleTypeID),
        })).filter(x => x.display);
        roles[fn.id] = items;
        flat[definitionKey('function', fn.id)] = items.map(x => x.display);
        for (const item of items) {
          const globalKey = canonicalValue(item.display);
          if (roleIdCache) {
            if (!roleIdCache.has(globalKey)) roleIdCache.set(globalKey, item);
            else if (canonicalValue(roleIdCache.get(globalKey).id) !== canonicalValue(item.id)) roleIdCache.set(globalKey, { ambiguous: true, display: item.display });
          }
          if (roleIdByFunctionCache) {
            const functionKey = `${fn.id}|${globalKey}`;
            if (!roleIdByFunctionCache.has(functionKey)) roleIdByFunctionCache.set(functionKey, item);
            else if (canonicalValue(roleIdByFunctionCache.get(functionKey).id) !== canonicalValue(item.id)) roleIdByFunctionCache.set(functionKey, { ambiguous: true, display: item.display });
          }
        }
      }

      return { ...link, card, values, roles, flat, fingerprint: fingerprintFlat(flat) };
    }

    async loadSnapshot(structure) {
      let native = typeof this.collectNativeMatrixViewLinksAllPages === 'function'
        ? await this.collectNativeMatrixViewLinksAllPages()
        : { ...this.findNativeMatrixViewLinks(), pageCount: 1, pagesVisited: [1], pagingUsed: false };
      const sectionCount = this.rawMatrixSectionLinks().length;
      let links = native.links;

      // После массового ADD представление может остаться на старой странице/старом счётчике.
      // Один раз принудительно обновляем именно нативный контрол и повторяем динамический обход.
      if (sectionCount > links.length) {
        const nativeControl = this.findNativeMatrixControl();
        const target = nativeControl?.target;
        try {
          if (typeof target?.refresh === 'function') await target.refresh();
          else if (typeof target?.refreshWithDelay === 'function') await target.refreshWithDelay();
          await sleep(100);
          native = await this.collectNativeMatrixViewLinksAllPages();
          links = native.links;
        } catch (error) {
          log(`Не удалось принудительно обновить представление матрицы: ${error.message || error}`, 'warn');
        }
      }

      if (!links.length && sectionCount === 0 && native.controlName) {
        // A brand-new matrix can legitimately have no MatrixRowID yet. This is safe
        // only when the authoritative card section agrees that membership is empty.
        log(`Источник строк TESSA: нативное представление «${native.controlName || 'матрица'}» (0 строк).`);
      } else if (links.length && (!sectionCount || links.length >= sectionCount)) {
        const pageNote = native.pagingUsed ? `, страниц: ${native.pagesVisited.length}/${native.pageCount}` : '';
        log(`Источник строк TESSA: нативное представление «${native.controlName}» (${links.length}${pageNote}).`);
      } else if (links.length && sectionCount > links.length) {
        log(`Представление вернуло ${links.length} из ${sectionCount} строк; проверяю сопоставление по MatrixVersionID без CardGet по служебным RowID.`, 'warn');
        links = await this.resolveMatrixSectionLinks(links);
      } else {
        throw new Error(
          'В нативном представлении TESSA не найдены скрытые MatrixRowID/MatrixVersionID. '
          + 'Обновите карточку TESSA (F5) и повторите операцию.'
        );
      }

      const snapshotRows = [];
      const criterionIdCache = new Map();
      const roleIdCache = new Map();
      const roleIdByFunctionCache = new Map();

      const loadedRows = await mapConcurrent(links, PERFORMANCE.SnapshotCardGetConcurrency, async (link, i) => {
        if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
        const card = await this.getCard(link.rowCardId);
        return this.readMatrixRowFromCard(card, link, structure, {
          criterionIdCache,
          roleIdCache,
          roleIdByFunctionCache,
        });
      });
      snapshotRows.push(...loadedRows);

      return {
        matrixId: this.mainCard.id,
        templateId: structure.templateId,
        rows: snapshotRows,
        criterionIdCache,
        roleIdCache,
        roleIdByFunctionCache,
        sectionSignature: this.matrixSectionSignature(),
        createdAt: nowIso(),
      };
    }

    readCriterionValue(row, condition) {
      const refGuid = this.rowValue(row, F.ReferenceValueID);
      const refGuidName = this.rowValue(row, F.ReferenceValueName);
      if (refGuid !== null && refGuid !== undefined && refGuidName) return { id: refGuid, display: refGuidName, kind: 'ReferenceGuid' };
      const refInt = this.rowValue(row, F.ReferenceIntValueID);
      const refIntName = this.rowValue(row, F.ReferenceIntValueName);
      if (refInt !== null && refInt !== undefined && refIntName) return { id: refInt, display: refIntName, kind: 'ReferenceInt' };
      const bool = this.rowValue(row, F.BoolValue);
      if (bool !== null && bool !== undefined) return { id: null, display: bool ? 'true' : 'false', kind: 'Boolean', value: bool };
      const candidates = [
        [F.DateValue, 'Date'], [F.DateTimeValue, 'DateTime'], [F.DecimalValue, 'Decimal'],
        [F.IntValue, 'Int'], [F.StringValue, 'String'],
      ];
      for (const [field, kind] of candidates) {
        const value = this.rowValue(row, field);
        if (value !== null && value !== undefined && value !== '') {
          const toField = ({ Date: F.DateToValue, DateTime: F.DateTimeToValue, Decimal: F.DecimalToValue, Int: F.IntToValue })[kind];
          const to = toField ? this.rowValue(row, toField) : null;
          return { id: null, display: to !== null && to !== undefined && to !== '' ? `${this.formatScalar(value)} - ${this.formatScalar(to)}` : this.formatScalar(value), kind, value, to };
        }
      }
      return null;
    }

    formatScalar(value) {
      if (value instanceof Date) return value.toLocaleString('ru-RU');
      return normalizeSpace(value);
    }

    viewApi() {
      const serviceModule = window.tessa?.apiLoader?.(829759);
      const platformModule = window.tessa?.apiLoader?.(684514);
      if (!serviceModule || !platformModule) return null;
      try {
        const service = serviceModule.ViewService.instance;
        return { serviceModule, platformModule, service };
      } catch (_) { return null; }
    }

    async queryViewExact(viewAlias, parameterName, display, wantedKind = 'guid') {
      const api = this.viewApi();
      if (!api || !viewAlias) return [];
      const view = api.service.getByName(viewAlias);
      if (!view?.metadata) return [];
      const request = new api.serviceModule.TessaViewRequest(view.metadata);
      request.calculateRowCounting = false;
      request.canUseCache = true;
      const parameter = parameterName && view.metadata.parameters?.get?.(parameterName)
        ? parameterName
        : this.pickSearchParameter(view.metadata, parameterName);
      if (parameter) {
        request.addParameter(parameter, builder => builder
          .addCriteria(api.platformModule.ViewCriteriaOperators.Contains, display, display)
          .asRequestParameter());
      }
      let result;
      try { result = await view.getData(request); }
      catch (error) {
        log(`Представление ${viewAlias} не выполнилось: ${error.message || error}`, 'warn');
        return [];
      }
      return pickExactReferenceFromViewResult(result, view.metadata, display, wantedKind);
    }

    pickSearchParameter(metadata, preferred = null) {
      const parameters = Array.from(metadata?.parameters?.values?.() || []);
      if (preferred) {
        const direct = parameters.find(x => canonicalValue(x.alias) === canonicalValue(preferred));
        if (direct) return direct.alias;
      }
      const scored = parameters.map(item => {
        const text = canonicalValue(`${item.alias || ''} ${item.caption || ''}`);
        let score = 0;
        if (/name|наимен|назван|search|поиск|роль|role|user|сотруд/.test(text)) score += 5;
        if (/id|идентификатор/.test(text)) score -= 3;
        return { item, score };
      }).sort((a, b) => b.score - a.score);
      return scored[0]?.score > 0 ? scored[0].item.alias : null;
    }

    async resolveReferenceOnline(condition, display) {
      if (!condition.autocompleteViewName) return null;
      const wanted = canonicalValue(condition.operandTypeId) === canonicalValue(OPERAND.ReferenceInt) ? 'int' : 'guid';
      const matches = await this.queryViewExact(condition.autocompleteViewName, condition.autocompleteParamName, display, wanted);
      const unique = uniqueReferenceMatches(matches);
      if (unique.length === 1) return unique[0];
      if (unique.length > 1) throw new Error(`В справочнике «${condition.autocompleteViewName}» найдено несколько точных значений «${display}». Укажите ID в колонке «${condition.criterionName}__ID».`);
      return null;
    }

    listRoleViewAliases() {
      const api = this.viewApi();
      if (!api) return [];
      const cls = api.serviceModule.ViewService;
      const views = cls._repository?._views;
      if (!views?.entries) return ['Roles', 'AllRoles', 'RoleUsers', 'RolesAndUsers'];
      const candidates = [];
      for (const [alias, internal] of views.entries()) {
        const meta = internal?._meta || internal?.metadata || null;
        const text = canonicalValue(`${alias} ${meta?.caption || ''}`);
        let score = 0;
        if (/role|роль/.test(text)) score += 10;
        if (/user|сотруд|employee|group|групп/.test(text)) score += 4;
        if (/history|истор|report|отчет|task|задач/.test(text)) score -= 8;
        if (score > 0) candidates.push({ alias, score });
      }
      return candidates.sort((a, b) => b.score - a.score).slice(0, 24).map(x => x.alias);
    }

    async resolveRoleOnline(fn, display, snapshot) {
      const results = [];
      for (const alias of this.listRoleViewAliases()) {
        const matches = await this.queryViewExact(alias, null, display, 'guid');
        for (const match of matches) results.push({ ...match, viewAlias: alias });
        if (uniqueReferenceMatches(results).length === 1 && results.some(x => x.roleTypeId !== null && x.roleTypeId !== undefined)) break;
      }
      const unique = uniqueReferenceMatches(results);
      if (unique.length > 1) throw new Error(`Для роли «${display}» найдено несколько разных ID. Укажите «${fn.name}__ID» в формате GUID|RoleTypeID.`);
      if (!unique.length) return null;
      const result = unique[0];
      if (result.roleTypeId === null || result.roleTypeId === undefined || result.roleTypeId === '') {
        const sameFunction = [...snapshot.roleIdByFunctionCache.entries()].find(([key]) => key.startsWith(`${fn.id}|`))?.[1];
        result.roleTypeId = sameFunction?.roleTypeId;
      }
      return result.id && result.roleTypeId !== null && result.roleTypeId !== undefined ? result : null;
    }

    rebuildRowCard(card, versionId, desired, structure, snapshot) {
      const valuesSection = this.section(card, S.Values, true);
      const rolesSection = this.section(card, S.Roles, true);

      // Меняем только те критерии и функции, чьи schema-колонки реально присутствуют
      // в Excel. Удалённая из Excel колонка означает «не изменять», а не «очистить».
      for (const condition of structure.conditions) {
        const column = desired.columns.get(condition.criterionRowId);
        if (!column) continue;
        for (const row of [...valuesSection.rows]) {
          if (!this.isDeleted(row)
            && canonicalValue(this.rowValue(row, F.OwnerRowID)) === canonicalValue(versionId)
            && canonicalValue(this.rowValue(row, F.CriterionRowID)) === canonicalValue(condition.criterionRowId)) {
            this.removeOrDelete(valuesSection, row);
          }
        }
        const displays = desired.flat[column.key] || [];
        const explicitIds = desired.ids[column.key] || [];
        for (let index = 0; index < displays.length; index += 1) {
          const display = displays[index];
          const explicit = explicitIds[index] || null;
          const resolved = this.resolveCriterion(condition, display, explicit, snapshot);
          const row = this.addRow(valuesSection);
          row.rowId = this.Guid.newGuid();
          row.state = this.CardRowState.Inserted;
          row.set(F.OwnerRowID, versionId, this.FieldType.Guid);
          row.set(F.CriterionRowID, condition.criterionRowId, this.FieldType.Guid);
          row.set(F.CriterionName, condition.criterionName, this.FieldType.String);
          this.writeCriterionValue(row, condition, resolved);
        }
      }

      for (const fn of structure.functions) {
        const column = desired.columns.get(fn.id);
        if (!column) continue;
        for (const row of [...rolesSection.rows]) {
          if (!this.isDeleted(row)
            && canonicalValue(this.rowValue(row, F.OwnerRowID)) === canonicalValue(versionId)
            && canonicalValue(this.rowValue(row, F.FunctionID)) === canonicalValue(fn.id)) {
            this.removeOrDelete(rolesSection, row);
          }
        }
        const displays = desired.flat[column.key] || [];
        const explicitIds = desired.ids[column.key] || [];
        for (let index = 0; index < displays.length; index += 1) {
          const display = displays[index];
          const explicit = explicitIds[index] || null;
          const resolved = this.resolveRole(fn, display, explicit, snapshot);
          const row = this.addRow(rolesSection);
          row.rowId = this.Guid.newGuid();
          row.state = this.CardRowState.Inserted;
          row.set(F.OwnerRowID, versionId, this.FieldType.Guid);
          row.set(F.FunctionID, fn.id, this.FieldType.Guid);
          row.set(F.FunctionName, fn.name, this.FieldType.String);
          row.set(F.RoleID, resolved.id, this.FieldType.Guid);
          row.set(F.RoleName, display, this.FieldType.String);
          row.set(F.RoleTypeID, Number(resolved.roleTypeId), this.FieldType.Int);
        }
      }

      const resultingRoleCount = [...rolesSection.rows].filter(row =>
        !this.isDeleted(row)
        && canonicalValue(this.rowValue(row, F.OwnerRowID)) === canonicalValue(versionId)).length;
      if (!resultingRoleCount) throw new Error(`В строке Excel ${desired.excelRow} после изменений не останется ни одного исполнителя.`);
      return card;
    }

    resolveCriterion(condition, display, explicitId, snapshot) {
      const operand = canonicalValue(condition.operandTypeId);
      if (operand === canonicalValue(OPERAND.ReferenceGuid) || operand === canonicalValue(OPERAND.ReferenceInt) || condition.refSection) {
        if (explicitId) {
          const id = String(explicitId).split('|')[0].trim();
          return { kind: operand === canonicalValue(OPERAND.ReferenceInt) ? 'ReferenceInt' : 'ReferenceGuid', id, display };
        }
        const cached = snapshot.criterionIdCache.get(`${condition.criterionRowId}|${canonicalValue(display)}`);
        if (cached?.ambiguous) throw new Error(`Для «${condition.criterionName}» = «${display}» найдено несколько ID. Укажите точный ID в колонке «${condition.criterionName}__ID».`);
        if (!cached) throw new Error(`Не найден ID справочника для «${condition.criterionName}» = «${display}». Добавьте колонку «${condition.criterionName}__ID» или один раз выберите значение вручную в TESSA.`);
        return cached;
      }
      if (operand === canonicalValue(OPERAND.Boolean)) return { kind: 'Boolean', value: parseBoolean(display) };
      if (operand === canonicalValue(OPERAND.Int)) return parseRange(display, 'Int');
      if (operand === canonicalValue(OPERAND.Decimal)) return parseRange(display, 'Decimal');
      if (operand === canonicalValue(OPERAND.Date)) return parseRange(display, 'Date');
      if (operand === canonicalValue(OPERAND.DateTime)) return parseRange(display, 'DateTime');
      return { kind: 'String', value: stripFormulaMarker(display) };
    }

    resolveRole(fn, display, explicitId, snapshot) {
      if (explicitId) {
        const [id, type] = String(explicitId).split('|').map(x => x.trim());
        if (!id) throw new Error(`Пустой ID роли для «${fn.name}» = «${display}».`);
        const fallback = snapshot.roleIdByFunctionCache.get(`${fn.id}|${canonicalValue(display)}`) || snapshot.roleIdCache.get(canonicalValue(display));
        return { id, roleTypeId: type || fallback?.roleTypeId };
      }
      const cached = snapshot.roleIdByFunctionCache.get(`${fn.id}|${canonicalValue(display)}`) || snapshot.roleIdCache.get(canonicalValue(display));
      if (cached?.ambiguous) throw new Error(`Для роли «${display}» найдено несколько ID. Укажите «${fn.name}__ID» в формате GUID|RoleTypeID.`);
      if (!cached?.id || cached.roleTypeId === null || cached.roleTypeId === undefined) {
        throw new Error(`Не найден ID роли «${display}» для функции «${fn.name}». Добавьте колонку «${fn.name}__ID» со значением GUID|RoleTypeID либо сначала добавьте эту роль вручную в любую строку матрицы.`);
      }
      return cached;
    }

    writeCriterionValue(row, condition, resolved) {
      const ft = this.FieldType;
      switch (resolved.kind) {
        case 'ReferenceGuid':
          row.set(F.ReferenceValueID, resolved.id, ft.Guid);
          row.set(F.ReferenceValueName, resolved.display, ft.String);
          break;
        case 'ReferenceInt':
          row.set(F.ReferenceIntValueID, Number(resolved.id), ft.Int);
          row.set(F.ReferenceIntValueName, resolved.display, ft.String);
          break;
        case 'Boolean': row.set(F.BoolValue, Boolean(resolved.value), ft.Boolean); break;
        case 'Int':
          row.set(F.IntValue, resolved.value, ft.Int);
          if (resolved.to !== null) row.set(F.IntToValue, resolved.to, ft.Int);
          break;
        case 'Decimal':
          row.set(F.DecimalValue, resolved.value, ft.Decimal ?? ft.Double);
          if (resolved.to !== null) row.set(F.DecimalToValue, resolved.to, ft.Decimal ?? ft.Double);
          break;
        case 'Date':
          row.set(F.DateValue, resolved.value, ft.DateTime);
          if (resolved.to !== null) row.set(F.DateToValue, resolved.to, ft.DateTime);
          break;
        case 'DateTime':
          row.set(F.DateTimeValue, resolved.value, ft.DateTime);
          if (resolved.to !== null) row.set(F.DateTimeToValue, resolved.to, ft.DateTime);
          break;
        default: row.set(F.StringValue, resolved.value, ft.String);
      }
    }

    prepareRowCardForServer(card) {
      // Native restoreActualValues removes these editor-only sections after
      // moving their values into the actual Values/Roles tables. Studio already
      // builds actual rows, but CardNew/CardGet still supply empty virtual
      // sections (Rows:[] / Rows:null). Never send those editing buffers to the
      // server, and use the same card preparation for validation and Store.
      const sections = card.getStorage()?.Sections;
      const names = [
        'MtxRouteMatrixVirtual',
        'MtxRouteMatrixRowVersionRolesGroupsVirtual',
        'MtxRouteMatrixRowVersionValuesGroupsVirtual',
        'MtxRouteMatrixRowVersionRolesGroupsValuesVirtual',
        'MtxRouteMatrixRowVersionValuesGroupsValuesVirtual',
      ].filter(name => sections && Object.prototype.hasOwnProperty.call(sections, name));
      if (!names.length) return card;
      for (const name of names) {
        const section = sections[name];
        const rows = section?.Rows;
        const fields = section?.Fields;
        if (!section || typeof section !== 'object' || Array.isArray(section)
          || (rows != null && (!Array.isArray(rows) || rows.length))
          || (fields != null && (typeof fields !== 'object' || Array.isArray(fields)
            || Object.values(fields).some(value => value != null)))) {
          throw new Error('В карточке строки есть непустые временные данные редактора. Закройте штатное редактирование строки и повторите проверку.');
        }
      }
      // Only a detached SDK clone may be stripped. Keep the source card,
      // identity, row states, permissions and typed values intact for receipts
      // and further local checks; do not implement an ad-hoc storage-to-card cast.
      const copy = card.clone?.();
      if (!copy || copy === card || copy.sections === card.sections
        || typeof copy.sections?.remove !== 'function' || copy.getStorage() === card.getStorage()
        || copy.getStorage()?.Sections === sections) {
        throw new Error('Не удалось подготовить отдельную копию карточки строки. Запись не запускалась.');
      }
      for (const name of names) copy.sections.remove(name);
      return copy;
    }

    async validateDuplicate(card, versionId) {
      const req = new this.cards.CardRequest();
      req.requestType = REQUEST.ValidateDuplicate;
      req.info.versionId = this.TypedField.createGuid(versionId);
      req.info.matrixId = this.TypedField.createGuid(this.mainCard.id);
      req.info.templateID = this.TypedField.createGuid(this.templateId());
      try {
        req.info.card = this.prepareRowCardForServer(card).getStorage();
        const response = await this.cardService.request(req);
        const error = this.validationError(response, 'Ошибка проверки дубликатов');
        if (error) throw error;
        const info = response.tryGetInfo?.() || response.info;
        const ok = this.StorageHelper.tryGet(info, 'ok');
        if (ok === false) throw new DuplicateValidationError('TESSA обнаружила дублирующую строку матрицы.', 'duplicate-found');
        // A successful request is not itself a successful business check.
        // Missing/malformed ok must fail closed, as it does in the native editor.
        if (ok !== true) throw new DuplicateValidationError('TESSA не подтвердила проверку дубликатов. Сохранение строки не запускалось.', 'duplicate-response-invalid');
      } catch (error) {
        if (error instanceof DuplicateValidationError) throw error;
        const message = String(error?.message || error || 'Ошибка проверки дубликатов');
        throw new DuplicateValidationError(message, /LeftOperandExtractor is null/.test(message)
          ? 'duplicate-interval-extractor' : 'duplicate-check-failed');
      }
    }

    async storeRowCard(card) {
      const req = new this.cards.CardStoreRequest();
      // Force TESSA to perform an atomic card-version check during Store.
      // This closes the post-preflight lost-update window for UPDATE/ADD.
      req.affectVersion = true;
      req.card = this.prepareRowCardForServer(card);
      req.info.MatrixID = this.TypedField.createGuid(this.mainCard.id);
      const response = await this.cardService.store(req);
      const error = this.validationError(response, 'Не удалось сохранить строку матрицы');
      if (error) throw error;
      return response;
    }

    async deleteMatrixRow(versionId) {
      const req = new this.cards.CardRequest();
      req.requestType = REQUEST.DeleteRow;
      req.cardId = this.mainCard.id;
      req.info.MatrixRowVersionID = this.TypedField.createGuid(versionId);
      const response = await this.cardService.request(req);
      const error = this.validationError(response, `Не удалось удалить строку ${versionId}`);
      if (error) throw error;
      return response;
    }

    async refreshNativeMatrixView() {
      const nativeControl = this.findNativeMatrixControl();
      if (!nativeControl) return { ok: false, reason: 'native-view-not-found', error: 'Не найдено нативное отображение матрицы TESSA.' };
      const { target, controlName } = nativeControl;
      const page = this.nativePagingInfo(target).currentPage;
      if (typeof target?.refresh === 'function') {
        await target.refresh();
      } else if (typeof target?.setPageAndRefresh === 'function') {
        await target.setPageAndRefresh(page);
      } else if (typeof target?.viewComponent?.refresh === 'function') {
        await target.viewComponent.refresh();
      } else {
        throw new Error(`Представление «${controlName}» не поддерживает локальное обновление.`);
      }
      return { ok: true, controlName, page };
    }

    async refresh() {
      await this.editor?.refreshCard?.();
      // refreshCard может заменить cardModel/card/control instances.
      // Пере-привязываемся к актуальным объектам, чтобы следующий экспорт видел новые строки и пагинацию.
      const workspaceModule = window.tessa?.apiLoader?.(546914);
      this.workspace = workspaceModule?.WorkspaceStorage?.instance?.currentCardWorkspace || this.workspace;
      this.editor = this.workspace?.editor || this.editor;
      this.mainCard = this.editor?.cardModel?.card || this.mainCard;
    }
  }

  function isGuidLike(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '').trim());
  }

  function pickExactReferenceFromViewResult(result, metadata, display, wantedKind = 'guid') {
    if (!result) return [];
    const columns = result.columns || [];
    const rows = result.rows || [];
    const metaColumns = metadata?.columns;
    const target = canonicalValue(display);
    const output = [];
    for (const rawRow of rows) {
      const values = {};
      columns.forEach((alias, index) => { values[alias] = rawRow[index]; });
      const exactColumns = columns.filter(alias => canonicalValue(values[alias]) === target);
      if (!exactColumns.length) continue;
      const idCandidates = columns
        .map(alias => ({ alias, value: values[alias], text: canonicalValue(`${alias} ${metaColumns?.get?.(alias)?.caption || ''}`) }))
        .filter(x => wantedKind === 'int' ? (x.value !== null && x.value !== undefined && String(x.value).trim() !== '' && Number.isInteger(Number(x.value))) : isGuidLike(x.value))
        .sort((a, b) => {
          const score = x => (/roleid|rowid|reference.*id|(^| )id($| )|идентификатор/.test(x.text) ? 10 : 0) + (/typeid/.test(x.text) ? -8 : 0);
          return score(b) - score(a);
        });
      if (!idCandidates.length) continue;
      const roleType = columns
        .map(alias => ({ alias, value: values[alias], text: canonicalValue(`${alias} ${metaColumns?.get?.(alias)?.caption || ''}`) }))
        .find(x => /roletypeid|тип роли/.test(x.text) && Number.isFinite(Number(x.value)));
      output.push({ id: idCandidates[0].value, display, roleTypeId: roleType ? Number(roleType.value) : null });
    }
    return output;
  }

  function uniqueReferenceMatches(matches) {
    const map = new Map();
    for (const match of matches || []) {
      const key = canonicalValue(match.id);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { ...match });
      else if ((map.get(key).roleTypeId === null || map.get(key).roleTypeId === undefined) && match.roleTypeId !== null && match.roleTypeId !== undefined) {
        map.get(key).roleTypeId = match.roleTypeId;
      }
    }
    return [...map.values()];
  }

  function parseBoolean(value) {
    const semantic = booleanSemantic(value);
    if (semantic !== null) return semantic;
    throw new Error(`Не удалось преобразовать «${value}» в Да/Нет.`);
  }

  function parseDateValue(value, withTime = false) {
    const text = stripFormulaMarker(value);
    const issue = typedValueIssue(withTime ? 'DateTime' : 'Date', text, 'Дата');
    if (issue) throw new Error(issue);
    const compact = text.replace(/[\s\u00a0]/g,'');
    if (/^-?\d+(?:[.,]\d+)?$/.test(compact)) {
      const serial = excelSerialToDate(compact.replace(',', '.'));
      if (serial) return serial;
    }
    const local = strictLocalDateParts(text);
    if (local) return local.date;
    const parsed = new Date(text.replace(/,\s*(?=\d{1,2}:\d{2})/, ' '));
    if (!Number.isNaN(parsed.getTime())) return parsed;
    throw new Error(`Не удалось распознать дату «${value}».`);
  }

  function splitRangeText(value, kind = null) {
    const text = stripFormulaMarker(value);
    if (kind === 'Int' || kind === 'Decimal') {
      const numeric = text.replace(/\s/g, '').match(/^([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))(?:-|\.\.|до)([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))$/i);
      if (numeric) return [numeric[1], numeric[2]];
    }
    const match = text.match(/^(.+?)\s+(?:-|–|—|\.\.|до)\s+(.+)$/i);
    return match ? [match[1].trim(), match[2].trim()] : [text, null];
  }

  function parseRange(value, kind) {
    const [fromText, toText] = splitRangeText(value, kind);
    const parse = text => {
      const issue = typedValueIssue(kind, text);
      if (!text || issue) throw new Error(issue || 'Пустая граница диапазона.');
      if (kind === 'Date') return parseDateValue(text, false);
      if (kind === 'DateTime') return parseDateValue(text, true);
      const normalized = String(text).replace(/\s/g, '').replace(',', '.');
      const number = Number(normalized);
      if (!Number.isFinite(number)) throw new Error(`Не удалось распознать число «${text}».`);
      return number;
    };
    const from = parse(fromText);
    const to = toText ? parse(toText) : null;
    if (to !== null && from > to) throw new Error(`Начало диапазона «${fromText}» больше конца «${toText}».`);
    return { kind, value: from, to };
  }

  // ---------------------------------------------------------------------------
  // 8. СХЕМА EXCEL И СОПОСТАВЛЕНИЕ КОЛОНОК
  // Заголовки Excel связываются с критериями и функциями матрицы. Пользовательские
  // колонки допускаются, но не участвуют в записи в TESSA.
  // ---------------------------------------------------------------------------

  function parseSchemaToken(token) {
    const value = normalizeSpace(token);
    if (!value) return null;
    const parts = value.split(':');
    if (parts[0] === 'criterion' && parts[1]) return { type: 'definition', kind: 'criterion', id: parts.slice(1).join(':') };
    if (parts[0] === 'function' && parts[1]) return { type: 'definition', kind: 'function', id: parts.slice(1).join(':') };
    if (parts[0] === 'companion' && parts[1] && parts[2]) return { type: 'companion', kind: parts[1], id: parts.slice(2).join(':') };
    if (parts[0] === 'system' && parts[1]) return { type: 'system', name: parts.slice(1).join(':') };
    return null;
  }

  function buildColumnMap(workbook, structure) {
    const headers = workbook.headers || [];
    const schemaTokens = workbook.schemaTokens || [];
    const mode = workbook.roundtrip?.enabled ? 'roundtrip' : 'legacy';
    const definitions = [
      ...structure.conditions.map(x => ({ ...x, kind: 'criterion', id: x.criterionRowId, name: x.criterionName })),
      ...structure.functions.map(x => ({ ...x, kind: 'function', id: x.id, name: x.name })),
    ];
    const byDefinitionKey = new Map(definitions.map(def => [definitionKey(def.kind, def.id), def]));
    const byCanonical = new Map();
    definitions.forEach(def => {
      const headerKey = canonicalHeader(def.name);
      if (!byCanonical.has(headerKey)) byCanonical.set(headerKey, []);
      byCanonical.get(headerKey).push(def);
    });

    const columns = new Map();
    const companionIds = new Map();
    const system = {};
    const warnings = [];
    const mappingIssues = [];
    const customColumns = [];
    const staleDefinitions = [];
    const retiredColumns = [];
    const usedDefinitions = new Set();
    const headerOccurrences = new Map();
    let workbookSchemaDefinitions = 0;
    let schemaDefinitions = 0;
    let schemaMapped = 0;

    schemaTokens.forEach((token, index) => {
      const parsed = parseSchemaToken(token);
      if (!parsed) return;
      if (parsed.type === 'companion') companionIds.set(definitionKey(parsed.kind, parsed.id), index);
      if (parsed.type === 'system') system[parsed.name] = index;
    });

    const maxColumns = Math.max(headers.length, schemaTokens.length);
    for (let index = 0; index < maxColumns; index += 1) {
      const header = normalizeSpace(headers[index] || '');
      const parsedToken = parseSchemaToken(schemaTokens[index]);
      if (parsedToken?.type === 'system' || parsedToken?.type === 'companion') continue;

      if (parsedToken?.type === 'definition') {
        workbookSchemaDefinitions += 1;
        const key = definitionKey(parsedToken.kind, parsedToken.id);
        const def = byDefinitionKey.get(key);
        if (!def) {
          retiredColumns.push({ index, header: header || `${parsedToken.kind}:${parsedToken.id}`, kind: parsedToken.kind, id: parsedToken.id });
          warnings.push(`Колонка Excel «${header || parsedToken.id}» больше отсутствует в текущей структуре TESSA. Она будет проигнорирована и может быть сохранена как архивная при обновлении Excel-схемы.`);
          continue;
        }
        schemaDefinitions += 1;
        if (usedDefinitions.has(key)) {
          const issue = `Служебная схема Excel содержит «${header || def.name}» повторно. Один критерий/функцию нельзя импортировать дважды.`;
          warnings.push(issue); mappingIssues.push(issue); continue;
        }
        schemaMapped += 1;
        usedDefinitions.add(key);
        columns.set(def.id, {
          ...def,
          index,
          key,
          excelHeader: header || def.name,
          occurrence: 0,
          idIndex: companionIds.get(key) ?? null,
          mappedBy: 'schema-id',
        });
        continue;
      }

      if (!header) continue;
      if (/__ID$/i.test(header) || /^__TESSA_/i.test(header) || canonicalHeader(header) === canonicalHeader('Действие')) continue;

      if (mode === 'roundtrip') {
        customColumns.push({ index, header });
        continue;
      }

      const headerKey = canonicalHeader(header);
      const occurrence = headerOccurrences.get(headerKey) || 0;
      headerOccurrences.set(headerKey, occurrence + 1);
      const exact = (byCanonical.get(headerKey) || []).filter(def => !usedDefinitions.has(definitionKey(def.kind, def.id)));
      let def = exact[0] || null;
      if (!def) {
        const scored = definitions
          .filter(candidate => !usedDefinitions.has(definitionKey(candidate.kind, candidate.id)))
          .map(candidate => ({ candidate, score: headerSimilarity(headerKey, canonicalHeader(candidate.name)) }))
          .sort((a, b) => b.score - a.score);
        if (scored[0]?.score >= 0.86 && (scored[0].score - (scored[1]?.score || 0)) >= 0.08) def = scored[0].candidate;
      }
      if (def) {
        const key = definitionKey(def.kind, def.id);
        usedDefinitions.add(key);
        const legacyCompanionKey = canonicalHeader(header);
        let idIndex = null;
        for (let i = 0; i < headers.length; i += 1) {
          if (canonicalHeader(headers[i] || '') === `${legacyCompanionKey} id`) { idIndex = i; break; }
        }
        columns.set(def.id, { ...def, index, key, excelHeader: header, occurrence, idIndex, mappedBy: exact.length ? 'header-exact' : 'header-fuzzy' });
      } else warnings.push(`Столбец Excel «${header}» не сопоставлен со структурой TESSA.`);
    }

    for (const column of columns.values()) {
      if (column.idIndex !== null) continue;
      const expected = canonicalHeader(`${column.excelHeader}__ID`);
      const index = headers.findIndex(header => canonicalHeader(header || '') === expected);
      if (index >= 0) column.idIndex = index;
    }

    const missingCurrentColumns = definitions.filter(def => !usedDefinitions.has(definitionKey(def.kind, def.id)));
    if (mode === 'roundtrip' && missingCurrentColumns.length) {
      warnings.push(`В TESSA есть новые или пропущенные в Excel колонки: ${missingCurrentColumns.map(item => `«${item.name}»`).join(', ')}. Они сохранят текущие значения; для редактирования нажмите «Обновить Excel-схему».`);
    }
    if (mode === 'roundtrip' && retiredColumns.length) {
      warnings.push(`Колонок, удалённых из текущей структуры TESSA: ${retiredColumns.length}. Они не применяются.`);
    }

    const dataHeaderCount = mode === 'roundtrip' ? schemaDefinitions : headers.reduce((count, header, index) => {
      if (!header) return count;
      const parsed = parseSchemaToken(schemaTokens[index]);
      if (parsed?.type === 'definition') return count + 1;
      if (parsed?.type === 'companion' || parsed?.type === 'system') return count;
      if (/__ID$/i.test(header) || /^__TESSA_/i.test(header) || canonicalHeader(header) === canonicalHeader('Действие')) return count;
      return count + 1;
    }, 0);

    return {
      columns, warnings, mappingIssues, customColumns,
      retiredColumns, staleDefinitions: retiredColumns,
      missingCurrentColumns, missingDefinitions: missingCurrentColumns,
      system, mode, workbookSchemaDefinitions, schemaDefinitions, schemaMapped, dataHeaderCount,
    };
  }

  function headerSimilarity(a, b) {
    if (a === b) return 1;
    const aa = new Set(a.split(' ').filter(Boolean));
    const bb = new Set(b.split(' ').filter(Boolean));
    const union = new Set([...aa, ...bb]);
    const inter = [...aa].filter(x => bb.has(x)).length;
    return union.size ? inter / union.size : 0;
  }

  function normalizeAction(value) {
    const action = canonicalValue(value);
    if (!action || ['оставить', 'keep', 'auto', 'обновить', 'update'].includes(action)) return 'keep';
    if (['удалить', 'delete', 'remove'].includes(action)) return 'delete';
    if (['добавить', 'add', 'new', 'создать'].includes(action)) return 'add';
    return `invalid:${normalizeSpace(value)}`;
  }

  function compareIdentity(kind, id, roleTypeId = '') {
    const normalized = canonicalValue(id);
    if (!normalized) return null;
    return kind === 'function' ? `id:${normalized}|${canonicalValue(roleTypeId)}` : `id:${normalized}`;
  }

  function currentCompareValues(currentRow, column) {
    if (column.kind === 'function') {
      return (currentRow.roles?.[column.id] || []).map(item => compareIdentity('function', item.id, item.roleTypeId) || `value:${canonicalValue(item.display)}`);
    }
    const kind = operandKind(column);
    return (currentRow.values?.[column.id] || []).map(item => {
      if ((kind === 'ReferenceGuid' || kind === 'ReferenceInt') && item.id !== null && item.id !== undefined && item.id !== '') {
        return compareIdentity('criterion', item.id);
      }
      if (['Boolean','Int','Decimal','Date','DateTime'].includes(kind)) {
        if (item.value !== undefined && item.value !== null) return typedRangeSemantic(kind, item.value, item.to);
        const [fromText, toText] = splitRangeText(item.display || '', kind);
        return typedRangeSemantic(kind, fromText, toText);
      }
      return `value:${canonicalValue(item.display)}`;
    }).filter(Boolean);
  }

  /**
   * Семантический fingerprint текущей строки: ссылочные поля и исполнители
   * сравниваются по стабильным ID, а типизированные значения — по нормализованному
   * значению. Raw fingerprint остаётся отдельным строгим барьером для DELETE.
   */
  function currentRowCompareFingerprint(currentRow, structure) {
    const compare = {};
    for (const condition of structure?.conditions || []) {
      const key = definitionKey('criterion', condition.criterionRowId);
      compare[key] = currentCompareValues(currentRow, {
        ...condition,
        kind: 'criterion',
        id: condition.criterionRowId,
      });
    }
    for (const fn of structure?.functions || []) {
      const key = definitionKey('function', fn.id);
      compare[key] = currentCompareValues(currentRow, { ...fn, kind: 'function', id: fn.id });
    }
    return fingerprintFlat(compare);
  }

  function rawFingerprintChangedSinceExport(excelRow, currentRow) {
    const exported = canonicalValue(excelRow?.system?.baseFingerprint || '');
    const fresh = canonicalValue(currentRow?.fingerprint || fingerprintFlat(currentRow?.flat || {}));
    return Boolean(currentRow && exported && fresh && exported !== fresh);
  }

  function baselineRowChanged(base, currentRow, structure) {
    return canonicalValue(base.baseFingerprint) !== canonicalValue(currentRow.fingerprint || fingerprintFlat(currentRow.flat || {}))
      || Boolean(base.base && currentRowCompareFingerprint(base.base, structure) !== currentRowCompareFingerprint(currentRow, structure));
  }

  function exportedRowSemanticallyStale(excelRow, currentRow, structure) {
    if (!rawFingerprintChangedSinceExport(excelRow, currentRow)) return false;
    const exportedSemantic = canonicalValue(excelRow?.compareFingerprint || '');
    const freshSemantic = canonicalValue(currentRowCompareFingerprint(currentRow, structure));
    // Fail closed when semantic evidence is unavailable. We relax stale protection only
    // when stable IDs / typed values prove that the raw drift is display-only.
    return !exportedSemantic || !freshSemantic || exportedSemantic !== freshSemantic;
  }

  // ---------------------------------------------------------------------------
  // 9. PLANNER: EXCEL -> ПЛАН ИЗМЕНЕНИЙ
  // Основной принцип: существующие строки определяются по MatrixRowID/MatrixVersionID.
  // Копирование поверх другой строки распознаётся как ЗАМЕНА целевой строки, а
  // копирование в новую свободную строку — как ДОБАВЛЕНИЕ.
  // ---------------------------------------------------------------------------

  function workbookRowsToDesired(workbook, columnMap) {
    return workbook.rows.map(row => {
      const flat = {};
      const ids = {};
      const compare = {};
      const columns = new Map();
      const issues = [];
      const fieldIssues = [];
      const resolutions = [];
      for (const [id, column] of columnMap.columns.entries()) {
        const issueStart = issues.length;
        const cellOperandKind = operandKind(column);
        const cellMeta = row.cellMeta?.[column.index];
        const autoDateIssue = excelAutoDateIssue(cellOperandKind, row.values[column.index], cellMeta, column.excelHeader);
        if (autoDateIssue) issues.push(`Excel ${row.excelRow}: ${autoDateIssue}`);
        const coercionIssue = excelCoercionIssue(cellOperandKind, row.values[column.index], cellMeta, column.excelHeader);
        if (coercionIssue) issues.push(`Excel ${row.excelRow}: ${coercionIssue}`);
        const visibleValues = splitCell(row.values[column.index]);
        const explicitValues = column.idIndex === null ? [] : splitCell(row.values[column.idIndex]);
        const resolvedDisplays = [];
        const resolvedIds = [];
        const compareValues = [];
        const operand = canonicalValue(column.operandTypeId);
        const isReference = column.kind === 'function'
          || operand === canonicalValue(OPERAND.ReferenceGuid)
          || operand === canonicalValue(OPERAND.ReferenceInt)
          || Boolean(column.refSection);
        visibleValues.forEach((visible, index) => {
          // A formula or an Excel-coerced value is already rejected. Do not
          // search large dictionaries for its cached result or invent extra
          // validation errors; recovery will preserve the entire old field.
          if (autoDateIssue || coercionIssue) {
            resolvedDisplays.push(visible);
            resolvedIds.push('');
            compareValues.push(`invalid:${canonicalValue(visible)}`);
            return;
          }
          const result = resolveEmbeddedDictionaryValue(workbook, column, visible, explicitValues[index] || '');
          resolvedDisplays.push(result.display);
          resolvedIds.push(result.explicit);
          if (result.issue) {
            issues.push(`Excel ${row.excelRow}: ${result.issue}`);
            compareValues.push(`invalid:${canonicalValue(visible)}`);
            return;
          }
          if (result.resolution === 'unique-fragment') resolutions.push(`Excel ${row.excelRow}: «${visible}» → «${result.display}» в «${column.excelHeader}»`);
          if (column.kind === 'function' && result.explicit) {
            const [roleId, roleTypeId = ''] = String(result.explicit).split('|').map(value => value.trim());
            compareValues.push(compareIdentity('function', roleId, roleTypeId) || `value:${canonicalValue(result.display)}`);
          } else if (isReference && result.explicit) {
            compareValues.push(compareIdentity('criterion', String(result.explicit).split('|')[0]) || `value:${canonicalValue(result.display)}`);
          } else {
            const kind = cellOperandKind;
            if (['Boolean','Int','Decimal','Date','DateTime'].includes(kind)) {
              const [fromText, toText] = kind === 'Boolean' ? [result.display || '', null] : splitRangeText(result.display || '', kind);
              const fromIssue = typedValueIssue(kind, fromText, column.excelHeader);
              const toIssue = toText ? typedValueIssue(kind, toText, column.excelHeader) : null;
              if (fromIssue) issues.push(`Excel ${row.excelRow}: ${fromIssue}`);
              if (toIssue) issues.push(`Excel ${row.excelRow}: ${toIssue}`);
              if (!fromIssue && !toIssue && kind !== 'Boolean') {
                try { parseRange(result.display, kind); }
                catch (error) { issues.push(`Excel ${row.excelRow}: «${column.excelHeader}»: ${error.message}`); }
              }
              compareValues.push(typedRangeSemantic(kind, fromText, toText));
            } else compareValues.push(`value:${canonicalValue(result.display)}`);
          }
        });
        flat[column.key] = resolvedDisplays;
        ids[column.key] = resolvedIds;
        compare[column.key] = compareValues.filter(Boolean);
        columns.set(id, column);
        if (issues.length > issueStart) fieldIssues.push({ id, key: column.key, label: column.excelHeader, reasons: issues.slice(issueStart) });
      }
      const system = {
        action: normalizeAction(columnMap.system.action === undefined ? '' : row.values[columnMap.system.action]),
        rowCardId: normalizeSpace(columnMap.system.rowCardId === undefined ? '' : row.values[columnMap.system.rowCardId]),
        versionId: normalizeSpace(columnMap.system.versionId === undefined ? '' : row.values[columnMap.system.versionId]),
        baseFingerprint: normalizeSpace(columnMap.system.baseFingerprint === undefined ? '' : row.values[columnMap.system.baseFingerprint]),
      };
      const hasData = Object.values(flat).some(values => Array.isArray(values) && values.length);
      return { excelRow: row.excelRow, flat, ids, compare, columns, system, hasData, issues, fieldIssues, resolutions, fingerprint: fingerprintFlat(flat), compareFingerprint: fingerprintFlat(compare) };
    });
  }

  function buildLegacyPlan(workbook, structure, snapshot, columnMap, desired) {
    const keys = [...new Set([...columnMap.columns.values()].map(x => x.key))];
    const pairs = [];
    desired.forEach((excelRow, ei) => snapshot.rows.forEach((currentRow, ci) => {
      pairs.push({ ei, ci, score: similarityFlat(excelRow.flat, currentRow.flat, keys), distance: Math.abs(ei - ci) });
    }));
    pairs.sort((a, b) => b.score - a.score || a.distance - b.distance);
    const usedExcel = new Set();
    const usedCurrent = new Set();
    const matches = [];
    for (const pair of pairs) {
      if (usedExcel.has(pair.ei) || usedCurrent.has(pair.ci)) continue;
      if (pair.score < 0.2) continue;
      usedExcel.add(pair.ei); usedCurrent.add(pair.ci);
      matches.push({ ...pair, matchedBy: 'similarity', lowConfidence: pair.score < 0.55 });
    }
    if (desired.length === snapshot.rows.length) {
      for (let i = 0; i < desired.length; i += 1) {
        if (usedExcel.has(i) || usedCurrent.has(i)) continue;
        usedExcel.add(i); usedCurrent.add(i);
        matches.push({ ei: i, ci: i, score: 0, matchedBy: 'position', lowConfidence: true });
      }
    }

    const actions = [];
    for (const match of matches.sort((a, b) => a.ei - b.ei)) {
      const excelRow = desired[match.ei];
      const currentRow = snapshot.rows[match.ci];
      const changes = [];
      for (const key of keys) {
        const before = currentRow.flat[key] || [];
        const after = excelRow.flat[key] || [];
        if (!arraysEqual(before, after)) {
          const column = [...columnMap.columns.values()].find(x => x.key === key);
          changes.push({ key, label: column?.excelHeader || column?.name || key, before, after });
        }
      }
      actions.push({
        type: changes.length ? 'update' : 'noop',
        excelRow,
        currentRow,
        changes,
        match,
        expectedFingerprint: currentRow.fingerprint,
      });
    }
    desired.forEach((excelRow, index) => {
      if (!usedExcel.has(index)) actions.push({ type: 'add', excelRow, currentRow: null, changes: [], match: null, expectedFingerprint: null });
    });
    snapshot.rows.forEach((currentRow, index) => {
      if (!usedCurrent.has(index)) actions.push({ type: 'delete', excelRow: null, currentRow, changes: [], match: null, expectedFingerprint: currentRow.fingerprint });
    });
    return { actions, issues: [] };
  }

  function buildRoundtripPlan(workbook, structure, snapshot, columnMap, desired) {
    const actions = [];
    const issues = [];
    const warnings = [];
    const skippedRows = [];
    const usedCurrent = new Set();
    // Копии определяем по повтору одной и той же пары скрытых ID внутри Excel.
    // Порядок строк не должен влиять на результат: если копию вставили выше источника,
    // исходной считаем строку, семантически совпадающую с текущей строкой TESSA.
    // Если все строки с одной identity уже изменены, безопасно определить источник нельзя.
    let identityMappingAnomaly = false;
    let copiedRowAutoAddDetected = false;
    const excelIdentityKey = excelRow => {
      const versionId = canonicalValue(excelRow?.system?.versionId || '');
      const rowCardId = canonicalValue(excelRow?.system?.rowCardId || '');
      return versionId || rowCardId ? `v:${versionId}|c:${rowCardId}` : '';
    };
    const currentIdentityKey = currentRow => {
      const versionId = canonicalValue(currentRow?.versionId || '');
      const rowCardId = canonicalValue(currentRow?.rowCardId || '');
      return versionId || rowCardId ? `v:${versionId}|c:${rowCardId}` : '';
    };
    const byVersion = new Map(snapshot.rows.map(row => [canonicalValue(row.versionId), row]));
    const byCard = new Map(snapshot.rows.map(row => [canonicalValue(row.rowCardId), row]));
    const baselineRows = Array.isArray(workbook.roundtrip?.baselineRows) ? workbook.roundtrip.baselineRows : [];
    const baselineByCard = new Map(baselineRows.map(row => [canonicalValue(row.rowCardId), row]));
    const baselineByIdentity = new Map(baselineRows.map(row => {
      const versionId = canonicalValue(row.versionId || '');
      const rowCardId = canonicalValue(row.rowCardId || '');
      return [`v:${versionId}|c:${rowCardId}`, row];
    }));
    const byKey = new Map([...columnMap.columns.values()].map(column => [column.key, column]));
    const keys = [...byKey.keys()];
    const findCurrent = excelRow => {
      if (excelRow.system.versionId) { const row = byVersion.get(canonicalValue(excelRow.system.versionId)); if (row) return row; }
      if (excelRow.system.rowCardId) { const row = byCard.get(canonicalValue(excelRow.system.rowCardId)); if (row) return row; }
      return null;
    };
    const semanticChangeCount = (excelRow, currentRow) => {
      let count = 0;
      for (const key of keys) {
        const column = byKey.get(key);
        if (!arraysEqual(currentCompareValues(currentRow, column), excelRow.compare?.[key] || [])) count += 1;
      }
      return count;
    };

    // Группируем повторяющиеся identity ДО основного прохода, чтобы корректно работать
    // и когда копия расположена выше исходной строки.
    const identityGroups = new Map();
    for (const row of desired) {
      const sourceIdentity = excelIdentityKey(row);
      if (!sourceIdentity) continue;
      if (!identityGroups.has(sourceIdentity)) identityGroups.set(sourceIdentity, []);
      identityGroups.get(sourceIdentity).push(row);
    }

    // Для overwrite сначала считаем identity, а не доверяем физическому порядку Excel.
    // Сортировка строк не должна менять цель операции. Позиция используется только как
    // дополнительное доказательство, когда исходная строка осталась на своей позиции.
    const expectedCurrentByExcelRow = new Map();
    const identityCounts = new Map();
    // ADD без baseline identity может находиться в том же Excel, что и REPLACE.
    // Для позиционного доказательства REPLACE исключаем новые строки из baseline-последовательности.
    const positionalDesiredRows = desired.filter(row => row.system.action !== 'add' && Boolean(excelIdentityKey(row)));
    const canAlignByPosition = positionalDesiredRows.length === snapshot.rows.length;
    if (canAlignByPosition) {
      for (const row of positionalDesiredRows) {
        const key = excelIdentityKey(row);
        if (key) identityCounts.set(key, (identityCounts.get(key) || 0) + 1);
      }
      positionalDesiredRows.forEach((row, index) => expectedCurrentByExcelRow.set(row, snapshot.rows[index] || null));
    }
    const primaryExcelRowByIdentity = new Map();
    const ambiguousDuplicateIdentities = new Set();
    for (const [sourceIdentity, group] of identityGroups.entries()) {
      if (group.length === 1) { primaryExcelRowByIdentity.set(sourceIdentity, group[0]); continue; }
      const currentRow = findCurrent(group[0]);
      if (!currentRow) { primaryExcelRowByIdentity.set(sourceIdentity, group[0]); continue; }
      // Если одна из копий находится в собственной исходной позиции, это лучший кандидат
      // на оригинал даже когда пользователь одновременно изменил и оригинал, и копию.
      const positionalOriginal = group.find(row => {
        const expected = expectedCurrentByExcelRow.get(row);
        return expected && currentIdentityKey(expected) === sourceIdentity;
      });
      if (positionalOriginal) { primaryExcelRowByIdentity.set(sourceIdentity, positionalOriginal); continue; }
      const scored = group.map(row => ({ row, changes: semanticChangeCount(row, currentRow) }));
      const exact = scored.filter(item => item.changes === 0);
      if (exact.length) primaryExcelRowByIdentity.set(sourceIdentity, exact[0].row);
      else ambiguousDuplicateIdentities.add(sourceIdentity);
    }

    // Копирование поверх существующей строки даёт одну дополнительную строку с identity
    // источника и одну пропавшую identity цели. Сначала используем позицию только там,
    // где оригинал источника всё ещё стоит на своей исходной позиции. Если после сортировки
    // остаётся ровно одна лишняя копия и одна пропавшая identity, пара однозначна без позиции.
    const positionalOverwriteTargets = new Map();
    const overwriteMatchedBy = new Map();
    if (canAlignByPosition) {
      const missingCurrentRows = (snapshot.rows || []).filter(currentRow => {
        const identity = currentIdentityKey(currentRow);
        return Boolean(identity && (identityCounts.get(identity) || 0) === 0);
      });
      const remainingMissing = new Map(missingCurrentRows.map(row => [currentIdentityKey(row), row]));
      const extraRows = [];
      for (const [sourceIdentity, group] of identityGroups.entries()) {
        if (group.length < 2 || ambiguousDuplicateIdentities.has(sourceIdentity)) continue;
        const primary = primaryExcelRowByIdentity.get(sourceIdentity);
        if (!primary) continue;
        for (const row of group) {
          if (row !== primary) extraRows.push({ row, sourceIdentity, primary });
        }
      }
      for (const extra of extraRows) {
        const expectedTarget = expectedCurrentByExcelRow.get(extra.row);
        const expectedTargetIdentity = currentIdentityKey(expectedTarget);
        const expectedPrimary = expectedCurrentByExcelRow.get(extra.primary);
        const primaryStayedInPlace = expectedPrimary && currentIdentityKey(expectedPrimary) === extra.sourceIdentity;
        if (!primaryStayedInPlace || !remainingMissing.has(expectedTargetIdentity)) continue;
        positionalOverwriteTargets.set(extra.row, expectedTarget);
        overwriteMatchedBy.set(extra.row, 'position-overwrite');
        remainingMissing.delete(expectedTargetIdentity);
      }
      const remainingExtras = extraRows.filter(extra => !positionalOverwriteTargets.has(extra.row));
      if (remainingExtras.length === 1 && remainingMissing.size === 1) {
        const [target] = remainingMissing.values();
        positionalOverwriteTargets.set(remainingExtras[0].row, target);
        overwriteMatchedBy.set(remainingExtras[0].row, 'missing-identity-overwrite');
      }
    }

    const baselineIntegrityRows = new Set();
    if (canonicalValue(workbook.roundtrip?.format) === canonicalValue('TESSA_MATRIX_ROUNDTRIP_V6') && baselineRows.length) {
      // Скрытый fingerprint основной строки не является источником истины: V6 хранит
      // отдельный baseline-ledger. Любая потеря/подмена fingerprint блокирует строку.
      for (const excelRow of desired) {
        const identity = excelIdentityKey(excelRow);
        if (!identity) continue;
        const base = baselineByIdentity.get(identity);
        if (!base) continue;
        if (canonicalValue(excelRow.system.baseFingerprint || '') !== canonicalValue(base.baseFingerprint || '')) {
          baselineIntegrityRows.add(excelRow);
          identityMappingAnomaly = true;
          const current = findCurrent(excelRow);
          if (current) usedCurrent.add(canonicalValue(current.versionId || current.rowCardId));
          issues.push(`Строка Excel ${excelRow.excelRow}: повреждён служебный BaseFingerprint. Скрытые ID/fingerprint нельзя очищать или менять; скачайте свежую выгрузку.`);
        }
      }

      // Если baseline identity пропала, но число строк не уменьшилось настолько же,
      // это не доказанное физическое удаление. Чаще всего так выглядит потеря hidden ID
      // или смешение DELETE+ADD в одном файле. Нельзя превращать это в ADD + implicit DELETE.
      const desiredIdentities = new Set(desired.map(excelIdentityKey).filter(Boolean));
      const overwriteTargetIdentities = new Set([...positionalOverwriteTargets.values()].map(currentIdentityKey).filter(Boolean));
      const missingBaseline = baselineRows.filter(base => {
        const identity = `v:${canonicalValue(base.versionId || '')}|c:${canonicalValue(base.rowCardId || '')}`;
        return identity !== 'v:|c:' && !desiredIdentities.has(identity) && !overwriteTargetIdentities.has(identity);
      });
      const rowDeficit = Math.max(0, baselineRows.length - desired.filter(row => row.system.action !== 'add').length);
      if (missingBaseline.length > rowDeficit) {
        const noIdentityRows = desired.filter(row => row.hasData && row.system.action !== 'add' && !excelIdentityKey(row));
        for (const excelRow of noIdentityRows) {
          baselineIntegrityRows.add(excelRow);
          issues.push(`Строка Excel ${excelRow.excelRow}: потеряны скрытые MatrixRowID/MatrixVersionID. Строка не будет считаться новой, а автоматическое удаление отключено. Скачайте свежую выгрузку или выполните DELETE и ADD отдельно.`);
        }
        identityMappingAnomaly = true;
      }
    }

    for (const excelRow of desired) {
      const action = excelRow.system.action;
      if (baselineIntegrityRows.has(excelRow)) continue;
      if (action.startsWith('invalid:')) { issues.push(`Строка Excel ${excelRow.excelRow}: неизвестное действие «${action.slice(8)}».`); continue; }
      const hasIdentity = Boolean(excelRow.system.versionId || excelRow.system.rowCardId);
      const sourceIdentity = excelIdentityKey(excelRow);
      const identityGroup = sourceIdentity ? (identityGroups.get(sourceIdentity) || []) : [];
      const repeatedInExcel = identityGroup.length > 1;
      const primaryExcelRow = sourceIdentity ? primaryExcelRowByIdentity.get(sourceIdentity) : null;
      const copiedFromExisting = Boolean(repeatedInExcel && primaryExcelRow && primaryExcelRow !== excelRow);
      if (!excelRow.hasData && !hasIdentity && action === 'keep') continue;
      if (!excelRow.hasData && hasIdentity && action === 'keep') {
        const protectedRow = findCurrent(excelRow);
        if (protectedRow) usedCurrent.add(canonicalValue(protectedRow.versionId || protectedRow.rowCardId));
        issues.push(`Строка Excel ${excelRow.excelRow} полностью очищена. Чтобы удалить существующую строку, удалите её целиком из Excel.`);
        continue;
      }
      if (action === 'add') {
        if (!excelRow.hasData) { issues.push(`Строка Excel ${excelRow.excelRow}: для ДОБАВИТЬ не заполнены критерии и исполнители.`); continue; }
        actions.push({ type: 'add', excelRow, currentRow: null, changes: [], match: { matchedBy: 'explicit-add', lowConfidence: false }, expectedFingerprint: null });
        continue;
      }
      const positionalOverwriteTarget = positionalOverwriteTargets.get(excelRow) || null;
      if (positionalOverwriteTarget && action === 'delete') {
        const protectedIdentity = canonicalValue(positionalOverwriteTarget.versionId || positionalOverwriteTarget.rowCardId);
        if (protectedIdentity) usedCurrent.add(protectedIdentity);
        identityMappingAnomaly = true;
        issues.push(`Строка Excel ${excelRow.excelRow}: операция неоднозначна — строка одновременно распознана как ЗАМЕНИТЬ и помечена УДАЛИТЬ. Целевая строка TESSA сохранена без изменений. Выполните удаление отдельно в свежей выгрузке.`);
        continue;
      }
      const currentRow = positionalOverwriteTarget || findCurrent(excelRow);
      const identityKey = currentRow ? canonicalValue(currentRow.versionId || currentRow.rowCardId) : '';
      const sourceCurrent = findCurrent(excelRow);
      const sourceBase = sourceCurrent && baselineByCard.get(canonicalValue(sourceCurrent.rowCardId));
      if (sourceBase?.base && currentRowCompareFingerprint(sourceBase.base, structure) !== currentRowCompareFingerprint(sourceCurrent, structure)) {
        // Equal labels do not prove an unchanged reference/role. Check the cell
        // baseline before UPDATE, copied ADD or REPLACE can carry old IDs forward.
        if (identityKey) usedCurrent.add(identityKey);
        usedCurrent.add(canonicalValue(sourceCurrent.versionId || sourceCurrent.rowCardId));
        issues.push(`Строка Excel ${excelRow.excelRow}: значения TESSA изменились после выгрузки Excel. Обновите поля Excel, чтобы объединить изменения.`);
        continue;
      }

      // Если строка была вставлена поверх другой существующей строки, физическая позиция
      // определяет цель. Скрытые ID источника для этой строки намеренно игнорируются:
      // итоговая операция обновляет исходную строку, которая занимала эту позицию.
      if (positionalOverwriteTarget && action === 'keep') {
        if (usedCurrent.has(identityKey)) {
          identityMappingAnomaly = true;
          issues.push(`Строка Excel ${excelRow.excelRow}: целевая строка замены уже используется другой операцией. Строка пропущена.`);
          continue;
        }
        // ЗАМЕНИТЬ переносит данные из source identity в другую target identity.
        // Поэтому stale-check обязан проверять именно источник копии, а не только цель.
        // Цель сразу резервируем в usedCurrent даже при SKIP, чтобы она не превратилась
        // в неявный DELETE в конце planner-а.
        const sourceCurrentRow = findCurrent(excelRow);
        const sourceBaselineExcelRow = primaryExcelRow || excelRow;
        if (sourceCurrentRow && exportedRowSemanticallyStale(sourceBaselineExcelRow, sourceCurrentRow, structure)) {
          if (identityKey) usedCurrent.add(identityKey);
          issues.push(`Строка Excel ${excelRow.excelRow}: исходная строка, из которой сделана замена, изменилась в TESSA после выгрузки. Скачайте свежий файл. Целевая строка TESSA не изменялась.`);
          continue;
        }
        usedCurrent.add(identityKey);
        const changes = [];
        for (const key of keys) {
          const column = byKey.get(key);
          const beforeIdentity = currentCompareValues(positionalOverwriteTarget, column);
          const afterIdentity = excelRow.compare?.[key] || [];
          if (!arraysEqual(beforeIdentity, afterIdentity)) {
            changes.push({ key, label: column?.excelHeader || column?.name || key, before: positionalOverwriteTarget.flat[key] || [], after: excelRow.flat[key] || [], beforeIdentity, afterIdentity });
          }
        }
        actions.push({
          type: changes.length ? 'update' : 'noop',
          excelRow,
          currentRow: positionalOverwriteTarget,
          changes,
          match: {
            matchedBy: overwriteMatchedBy.get(excelRow) || 'position-overwrite',
            lowConfidence: false,
            sourceIdentity,
            sourceVersionId: excelRow.system.versionId || '',
            sourceRowCardId: excelRow.system.rowCardId || '',
            // После Preview следим уже от свежего raw fingerprint, а не от старой выгрузки.
            sourceFingerprint: sourceCurrentRow?.fingerprint || excelRow.system.baseFingerprint || '',
          },
          expectedFingerprint: positionalOverwriteTarget.fingerprint,
        });
        warnings.push(`Excel ${excelRow.excelRow}: обнаружена замена существующей строки. Будет обновлена строка TESSA ${positionalOverwriteTarget.index + 1}, а не создана новая.`);
        continue;
      }

      // Если одна identity встречается несколько раз и ни одна строка уже не совпадает
      // с текущей TESSA, нельзя надёжно отличить изменённый оригинал от изменённой копии.
      // Сохраняем текущую строку и локально пропускаем неоднозначную группу.
      if (sourceIdentity && ambiguousDuplicateIdentities.has(sourceIdentity)) {
        identityMappingAnomaly = true;
        if (identityKey) usedCurrent.add(identityKey);
        issues.push(`Строка Excel ${excelRow.excelRow}: несколько строк имеют одинаковые скрытые ID, и все они изменены. Нельзя безопасно определить, какая строка исходная, а какая копия. Разделите изменение и добавление на разные операции.`);
        continue;
      }

      // Легитимная копия в ДОПОЛНИТЕЛЬНОЙ строке обрабатывается как ADD независимо
      // от её положения относительно исходной строки в Excel.
      if (currentRow && copiedFromExisting && action === 'keep') {
        const sourceBaselineExcelRow = primaryExcelRow || excelRow;
        if (exportedRowSemanticallyStale(sourceBaselineExcelRow, currentRow, structure)) {
          issues.push(`Строка Excel ${excelRow.excelRow}: исходная строка TESSA изменилась после выгрузки Excel. Скопированная строка пропущена, чтобы не создавать её из устаревших данных.`);
          continue;
        }
        const cloned = {
          ...excelRow,
          system: { ...excelRow.system, rowCardId: '', versionId: '', baseFingerprint: '' },
        };
        actions.push({
          type: 'add',
          excelRow: cloned,
          currentRow: null,
          changes: [],
          match: {
            matchedBy: 'copied-row-auto-add',
            lowConfidence: false,
            sourceIdentity,
            sourceVersionId: excelRow.system.versionId || '',
            sourceRowCardId: excelRow.system.rowCardId || '',
            sourceFingerprint: currentRow.fingerprint || excelRow.system.baseFingerprint || '',
          },
          expectedFingerprint: null,
        });
        copiedRowAutoAddDetected = true;
        warnings.push(`Excel ${excelRow.excelRow}: копия существующей строки распознана как новая.`);
        continue;
      }

      // Проверяем конфликт идентичности ДО stale-fingerprint. Если одна runtime-строка
      // сопоставилась повторно не как подтверждённая копия, это аномалия снимка/ID.
      if (currentRow && usedCurrent.has(identityKey)) {
        if (!excelRow.hasData) continue;
        identityMappingAnomaly = true;
        issues.push(`Строка Excel ${excelRow.excelRow}: не удалось безопасно сопоставить строку с текущей матрицей. Строка пропущена.`);
        continue;
      }

      const deletionBase = currentRow && baselineByCard.get(canonicalValue(currentRow.rowCardId));
      const deletionChanged = action === 'delete' && deletionBase && baselineRowChanged(deletionBase, currentRow, structure);
      if (currentRow && (deletionChanged || rawFingerprintChangedSinceExport(excelRow, currentRow))) {
        // DELETE остаётся строго raw-stale: удаление нельзя разрешать только по semantic ID.
        // Для обычной неизменённой строки допускаем лишь доказанный display-only drift.
        const stale = action === 'delete' || exportedRowSemanticallyStale(excelRow, currentRow, structure);
        if (stale) {
          if (identityKey) usedCurrent.add(identityKey);
          issues.push(`Строка Excel ${excelRow.excelRow}: строка TESSA изменилась после выгрузки Excel. Скачайте свежий файл, чтобы не затереть чужие изменения.`);
          continue;
        }
      }

      if (action === 'delete') {
        if (!currentRow) { issues.push(`Строка Excel ${excelRow.excelRow}: для УДАЛИТЬ не найден исходный MatrixVersionID/MatrixRowID.`); continue; }
        if (usedCurrent.has(identityKey)) { issues.push(`Строка Excel ${excelRow.excelRow}: одна исходная строка уже используется другой операцией. Строка пропущена, чтобы избежать повторного изменения.`); continue; }
        usedCurrent.add(identityKey);
        actions.push({ type: 'delete', excelRow, currentRow, changes: [], match: { matchedBy: 'identity', lowConfidence: false }, expectedFingerprint: currentRow.fingerprint });
        continue;
      }

      if (!currentRow) {
        if (excelRow.hasData && !hasIdentity) actions.push({ type: 'add', excelRow, currentRow: null, changes: [], match: { matchedBy: 'new-row-no-id', lowConfidence: false }, expectedFingerprint: null });
        else if (hasIdentity) {
          identityMappingAnomaly = true;
          issues.push(`Строка Excel ${excelRow.excelRow}: строка не относится к текущей версии матрицы. Строка пропущена.`);
        }
        continue;
      }
      usedCurrent.add(identityKey);
      const changes = [];
      for (const key of keys) {
        const column = byKey.get(key);
        const beforeIdentity = currentCompareValues(currentRow, column);
        const afterIdentity = excelRow.compare?.[key] || [];
        if (!arraysEqual(beforeIdentity, afterIdentity)) {
          changes.push({ key, label: column?.excelHeader || column?.name || key, before: currentRow.flat[key] || [], after: excelRow.flat[key] || [], beforeIdentity, afterIdentity });
        }
      }
      actions.push({ type: changes.length ? 'update' : 'noop', excelRow, currentRow, changes, match: { matchedBy: 'identity', lowConfidence: false }, expectedFingerprint: currentRow.fingerprint });
    }
    const templateMode = canonicalValue(workbook.roundtrip?.templateMode || workbook.metadata?.[ROUNDTRIP.TemplateModeKey] || '');
    const appendOnly = templateMode.startsWith('append_only');
    const automaticDeleteEnabled = canonicalValue(workbook.roundtrip?.format) === canonicalValue(ROUNDTRIP.Format);
    if (automaticDeleteEnabled && !appendOnly && !identityMappingAnomaly) {
      const implicitDeleteCandidates = (snapshot.rows || []).filter(currentRow => {
        const identityKey = canonicalValue(currentRow.versionId || currentRow.rowCardId);
        // Absence only expresses deletion for rows that existed in this export.
        // A colleague's subsequent ADD must never become our implicit DELETE.
        return Boolean(identityKey && !usedCurrent.has(identityKey) && baselineByCard.has(canonicalValue(currentRow.rowCardId)));
      });
      // Если пользователь скопировал существующую строку поверх другой строки Excel,
      // скрытые ID источника продублируются, а ID затёртой строки исчезнет. Без этой
      // защиты planner интерпретировал бы затёртую строку как намеренное удаление.
      // В одном файле сочетание «копия строки + пропавшая identity» неоднозначно,
      // поэтому безопаснее сохранить текущую строку TESSA и не делать implicit DELETE.
      if (copiedRowAutoAddDetected && implicitDeleteCandidates.length) {
        warnings.push(`Обнаружена копия существующей строки; строк TESSA, отсутствующих в Excel: ${implicitDeleteCandidates.length}. Автоматическое удаление отключено для этого файла: копирование могло затереть строку Excel. Если удаление действительно нужно, выполните его отдельно.`);
      } else {
        for (const currentRow of implicitDeleteCandidates) {
          const identityKey = canonicalValue(currentRow.versionId || currentRow.rowCardId);
          usedCurrent.add(identityKey);
          if (baselineRowChanged(baselineByCard.get(canonicalValue(currentRow.rowCardId)), currentRow, structure)) {
            skippedRows.push(makeSkippedRow(null, `Строка TESSA ${currentRow.index + 1}: строка изменилась после выгрузки Excel. Обновите поля Excel и подтвердите удаление при объединении.`, 'baseline-conflict', 'delete'));
            continue;
          }
          actions.push({
            type: 'delete',
            excelRow: null,
            currentRow,
            changes: [],
            match: { matchedBy: 'missing-row-auto-delete', lowConfidence: false },
            expectedFingerprint: currentRow.fingerprint,
          });
        }
      }
    }
    if (identityMappingAnomaly) warnings.push('Часть строк не удалось надёжно сопоставить. Они пропущены; автоматическое удаление для этого файла отключено.');
    return { actions, issues, warnings, skippedRows, usedCurrent };
  }

  function duplicateRowKey(current, desired, structure) {
    const columns = [
      ...(structure?.conditions || []).map(c => ({ ...c, kind: 'criterion', id: c.criterionRowId, key: definitionKey('criterion', c.criterionRowId) })),
      ...(structure?.functions || []).map(f => ({ ...f, kind: 'function', key: definitionKey('function', f.id) })),
    ];
    const flat = { ...(current?.flat || {}), ...(desired?.flat || {}) };
    const normalized = {};
    for (const column of columns) {
      const edited = desired?.columns?.has(column.id);
      const typed = (column.kind === 'function' ? current?.roles : current?.values)?.[column.id];
      if (edited && desired.compare?.[column.key]) normalized[column.key] = sortedCanon(desired.compare[column.key]);
      else if (!edited && typed) normalized[column.key] = sortedCanon(currentCompareValues(current, column));
      else {
        const kind = operandKind(column);
        normalized[column.key] = sortedCanon((flat[column.key] || []).map(value => {
          if (!['Boolean', 'Int', 'Decimal', 'Date', 'DateTime'].includes(kind)) return `value:${canonicalValue(value)}`;
          const [from, to] = splitRangeText(value, kind);
          return typedRangeSemantic(kind, from, to);
        }));
      }
    }
    if (!columns.length) for (const key of Object.keys(flat).sort()) normalized[key] = sortedCanon(flat[key]);
    // Keep the complete key: a 32-bit fingerprint is not proof of equality.
    return JSON.stringify(stableObject(normalized));
  }

  function detectPlanDuplicateConflicts(actions, snapshot, structure = null) {
    const finalRows = new Map((snapshot?.rows || []).map(row => [canonicalValue(row.versionId || row.rowCardId), { label: `TESSA ${row.index + 1}`, current: row }]));
    for (const action of actions || []) {
      if (action.type === 'delete' && action.currentRow) finalRows.delete(canonicalValue(action.currentRow.versionId || action.currentRow.rowCardId));
      else if (action.type === 'update' && action.currentRow) finalRows.set(canonicalValue(action.currentRow.versionId || action.currentRow.rowCardId), { label: `Excel ${action.excelRow.excelRow}`, current: action.currentRow, desired: action.excelRow, changed: true });
      else if (action.type === 'add') finalRows.set(`add:${action.excelRow.excelRow}`, { label: `Excel ${action.excelRow.excelRow}`, desired: action.excelRow, changed: true });
    }
    const groups = new Map();
    for (const row of finalRows.values()) {
      const fp = duplicateRowKey(row.current, row.desired, structure);
      if (!groups.has(fp)) groups.set(fp, []);
      groups.get(fp).push(row);
    }
    const issues = [];
    for (const rows of groups.values()) {
      if (rows.length < 2 || !rows.some(row => row.changed)) continue;
      issues.push(`После изменений строки ${rows.map(row => row.label).join(' и ')} будут полностью одинаковыми. TESSA не допускает дублирующие строки — измените условия или удалите дубль.`);
    }
    return issues;
  }

  function issueExcelRows(issue) {
    const rows = [];
    const text = String(issue || '');
    const re = /(?:Строка\s+)?Excel\s+(\d+)/gi;
    let match;
    while ((match = re.exec(text))) rows.push(Number(match[1]));
    return [...new Set(rows.filter(Number.isFinite))];
  }

  function makeSkippedRow(excelRow, reason, source = 'validation', actionType = null) {
    return {
      excelRow: Number(excelRow) || null,
      reason: normalizeSpace(reason || 'Строка пропущена.'),
      source,
      actionType,
    };
  }

  function buildPlan(workbook, structure, snapshot) {
    const columnMap = buildColumnMap(workbook, structure);
    const desired = workbookRowsToDesired(workbook, columnMap);
    const built = columnMap.mode === 'roundtrip'
      ? buildRoundtripPlan(workbook, structure, snapshot, columnMap, desired)
      : buildLegacyPlan(workbook, structure, snapshot, columnMap, desired);

    // An unambiguous UPDATE can preserve a bad cell without discarding unrelated
    // edits. ADD/REPLACE/DELETE and identity/baseline errors stay atomic.
    const skippedFields = [];
    const recoveredRows = new Set();
    const structuralIssueRows = new Set([...(built.issues || []), ...(columnMap.mappingIssues || [])].flatMap(issueExcelRows));
    built.actions = (built.actions || []).map(action => {
      const fields = action.excelRow?.fieldIssues || [];
      if (!fields.length || action.type !== 'update' || columnMap.mode !== 'roundtrip'
        || action.match?.matchedBy !== 'identity' || structuralIssueRows.has(action.excelRow.excelRow)) return action;
      const rejected = new Set(fields.map(field => field.key));
      const changes = action.changes.filter(change => !rejected.has(change.key));
      if (!changes.length) return action;
      const excelRow = reviewedExcelRow(action, rejected);
      for (const field of fields) excelRow.columns.delete(field.id);
      excelRow.issues = [];
      excelRow.fieldIssues = [];
      const omitted = fields.map(field => ({ excelRow: excelRow.excelRow, key: field.key, label: field.label, reason: field.reasons.join(' '), source: 'field-validation' }));
      skippedFields.push(...omitted);
      recoveredRows.add(excelRow.excelRow);
      return { ...action, changes, excelRow, skippedFields: omitted };
    });

    // Ошибки конкретной строки не должны ломать весь пакет. Они переводятся в SKIP,
    // а корректные строки остаются исполняемыми. Глобальные ошибки формата/матрицы
    // по-прежнему считаются фатальными, потому что безопасно интерпретировать файл нельзя.
    const rawIssues = [
      ...(built.issues || []),
      ...(columnMap.mappingIssues || []),
      ...desired.flatMap(row => recoveredRows.has(row.excelRow) ? [] : (row.issues || [])),
    ];
    const rowIssueMap = new Map();
    const fatalIssues = [];
    const addRowIssue = (rowNumber, issue) => {
      if (!rowIssueMap.has(rowNumber)) rowIssueMap.set(rowNumber, []);
      rowIssueMap.get(rowNumber).push(issue);
    };
    for (const issue of rawIssues) {
      const rows = issueExcelRows(issue);
      if (rows.length) rows.forEach(rowNumber => addRowIssue(rowNumber, issue));
      else fatalIssues.push(issue);
    }

    let actions = [...(built.actions || [])];
    const skippedRows = [...(built.skippedRows || [])];
    const desiredByExcelRow = new Map(desired.map(row => [row.excelRow, row]));

    // Убираем из исполняемого плана строки, у которых уже найдена локальная ошибка.
    const invalidRows = new Set(rowIssueMap.keys());
    actions = actions.filter(action => {
      const rowNumber = action.excelRow?.excelRow;
      if (!rowNumber || !invalidRows.has(rowNumber)) return true;
      const reasons = [...new Set(rowIssueMap.get(rowNumber) || [])];
      skippedRows.push(makeSkippedRow(rowNumber, reasons.join(' '), 'excel-validation', action.type));
      return false;
    });
    for (const [rowNumber, reasons] of rowIssueMap.entries()) {
      if (skippedRows.some(item => item.excelRow === rowNumber)) continue;
      skippedRows.push(makeSkippedRow(rowNumber, [...new Set(reasons)].join(' '), 'excel-validation', null));
    }

    // Новая/обновляемая строка без исполнителя пропускается отдельно, не блокируя остальные.
    const noRoleRows = new Set();
    actions = actions.filter(action => {
      if (action.type !== 'add' && action.type !== 'update') return true;
      if (resultingRoleCountForAction(action, structure) > 0) return true;
      const rowNumber = action.excelRow?.excelRow;
      if (rowNumber) {
        noRoleRows.add(rowNumber);
        skippedRows.push(makeSkippedRow(rowNumber, `Excel ${rowNumber}: после изменений не останется исполнителей.`, 'role-validation', action.type));
      }
      return false;
    });

    // Дубликаты после применения тоже локальны: пропускаем только изменяемые Excel-строки,
    // которые образуют конфликт, а не весь файл.
    const duplicateIssues = detectPlanDuplicateConflicts(actions, snapshot, structure);
    if (duplicateIssues.length) {
      const duplicateRows = new Set();
      for (const issue of duplicateIssues) issueExcelRows(issue).forEach(rowNumber => duplicateRows.add(rowNumber));
      actions = actions.filter(action => {
        const rowNumber = action.excelRow?.excelRow;
        if (!rowNumber || !duplicateRows.has(rowNumber)) return true;
        const reasons = duplicateIssues.filter(issue => issueExcelRows(issue).includes(rowNumber));
        skippedRows.push(makeSkippedRow(rowNumber, reasons.join(' '), 'duplicate-validation', action.type));
        return false;
      });
    }

    const templateMode = canonicalValue(workbook.roundtrip?.templateMode || workbook.metadata?.[ROUNDTRIP.TemplateModeKey] || '');
    if (!workbook.rows.length && templateMode.startsWith('append_only')) {
      fatalIssues.push('В Excel нет ни одной заполненной строки. Пустые строки старого шаблона игнорируются. Скачайте актуальный Excel из открытой матрицы и добавляйте строки в него.');
    }

    const warnings = [...columnMap.warnings, ...(built.warnings || [])];
    const uniqueFragmentResolutions = desired.flatMap(row => row.resolutions || []);
    if (uniqueFragmentResolutions.length) warnings.push(`По уникальному фрагменту автоматически найдено значений: ${uniqueFragmentResolutions.length}. ${uniqueFragmentResolutions.slice(0, 6).join(' | ')}${uniqueFragmentResolutions.length > 6 ? ' | …' : ''}`);
    const nonEmptyFingerprints = desired.filter(row => row.hasData).map(x => x.compareFingerprint || x.fingerprint);
    const duplicates = nonEmptyFingerprints.filter((fp, i) => nonEmptyFingerprints.indexOf(fp) !== i);
    if (duplicates.length) warnings.push('В Excel обнаружены полностью одинаковые строки. Конфликтующие изменяемые строки будут пропущены.');
    if (actions.some(a => a.match?.lowConfidence)) warnings.push('Есть строки с низкой уверенностью сопоставления. Проверьте их в предпросмотре.');

    const plan = {
      id: `TMS-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      createdAt: nowIso(),
      mode: columnMap.mode,
      fileName: workbook.fileName,
      sheetName: workbook.sheetName,
      matrixId: snapshot.matrixId,
      snapshot,
      sourceRowCount: snapshot.rows?.length || 0,
      templateId: snapshot.templateId,
      workbook,
      structure,
      columnMap,
      desired,
      actions,
      issues: fatalIssues,
      fatalIssues,
      skippedRows,
      skippedFields,
      warnings,
      counts: countActions(actions, skippedRows),
    };

    // Защита от случайного массового удаления теперь не блокирует полезные UPDATE/ADD:
    // только DELETE-операции переводятся в SKIP.
    const deleteGuard = deletionGuard(plan);
    if (deleteGuard.blocked) {
      const kept = [];
      for (const action of plan.actions) {
        if (action.type !== 'delete') { kept.push(action); continue; }
        plan.skippedRows.push(makeSkippedRow(action.excelRow?.excelRow || null, deleteGuard.reason, 'delete-guard', 'delete'));
      }
      plan.actions = kept;
      plan.warnings.push(`${deleteGuard.reason} Остальные безопасные изменения можно применить.`);
      plan.counts = countActions(plan.actions, plan.skippedRows);
    }
    return plan;
  }

  function countActions(actions, skippedRows = []) {
    const acc = (actions || []).reduce((result, action) => {
      result[action.type] = (result[action.type] || 0) + 1;
      return result;
    }, { noop: 0, update: 0, add: 0, delete: 0, skip: 0 });
    acc.skip = (skippedRows || []).length;
    return acc;
  }

  function createPlanReviewState() {
    return { excludedRows: new Set(), excludedChanges: new Map() };
  }

  // Любая реально начатая запись делает текущий Preview устаревшим. Даже если ответ
  // Store/Delete неоднозначен, повторно применять тот же план нельзя без свежего чтения.
  function invalidatePlanStateAfterApply(state, result) {
    if (!state) return false;
    const started = Math.max(0, Number(result?.startedCount || 0));
    const applied = Math.max(0, Number(result?.appliedCount || 0));
    if (!started && !applied) return false;
    state.plan = null;
    state.snapshot = null;
    state.bridge = null;
    state.lastIntervalDiagnostics = null;
    state.lastStudioDiagnostics = null;
    state.review = createPlanReviewState();
    state.previewView = createPreviewViewState();
    return true;
  }

  function renderPlanConsumedNotice(result) {
    const summary = document.querySelector?.('#tms-summary');
    const table = document.querySelector?.('#tms-plan');
    const refreshButton = document.querySelector?.('#tms-refresh-view');
    const applied = Math.max(0, Number(result?.appliedCount || 0));
    const requested = Math.max(applied, Number(result?.requestedCount || result?.plannedCount || applied));
    const sourceSkipped = Math.max(0, Number(result?.sourceSkippedCount || 0));
    const completed = result?.status === 'completed' && result?.success === true;
    const title = completed
      ? `Изменения применены: ${applied} из ${requested}.`
      : result?.cancelled
        ? `Применение остановлено: применено ${applied}.`
        : `Применение завершено частично: применено ${applied} из ${requested}.`;
    const sourceText = (sourceSkipped ? ` Ещё ${sourceSkipped} строк не входили в Apply и остались без изменений.` : '')
      + (result?.skippedFields?.length ? ` Не применено отдельных полей: ${result.skippedFields.length}.` : '');
    const refreshText = result?.viewRefresh?.ok
      ? ' Отображение TESSA обновлено автоматически.'
      : (result?.viewRefresh && !result.viewRefresh.skipped ? ' Запись завершена; отображение можно обновить кнопкой ниже.' : '');
    if (summary) summary.innerHTML = `<div class="tms-review-note"><b>${title}</b>${sourceText}${refreshText} Для следующего применения выполните новую проверку.</div>${rowFailuresHtml(result?.skipped, true)}${skippedFieldsHtml(result?.skippedFields)}`;
    if (table) table.innerHTML = '';
    if (refreshButton) {
      const needsManualRefresh = Boolean(result?.viewRefresh && !result.viewRefresh.ok && !result.viewRefresh.skipped);
      refreshButton.hidden = !needsManualRefresh;
      setControlDisabled(refreshButton, !needsManualRefresh);
    }
  }

  function skippedFieldsHtml(fields = []) {
    if (!fields?.length) return '';
    return `<details open class="tms-skipped-box"><summary><b>Не применяются отдельные поля: ${fields.length}</b></summary><div>Значения этих полей в TESSA сохраняются. Исправьте ячейки в Excel и выполните новую проверку.</div>${fields.slice(0, 20).map(field => `<div class="tms-skip-line">Excel ${escapeHtml(field.excelRow)} · ${escapeHtml(field.label)}: ${escapeHtml(field.reason)}</div>`).join('')}${fields.length > 20 ? '<div>Остальные поля указаны в строках Preview и отчёте.</div>' : ''}</details>`;
  }

  function rowFailureReason(item) {
    return item?.code === 'duplicate-interval-extractor'
      ? 'TESSA не смогла сравнить интервалы при проверке дубликатов; сохранение не запускалось.'
      : String(item?.reason || 'Причина не указана');
  }

  function rowFailuresHtml(skips = [], reportAvailable = false) {
    // Input errors already have a separate section. Runtime failures must remain
    // visible even when they occurred during Preview or that Preview is consumed.
    const failures = (skips || []).filter(item => /^(preflight|store)-/.test(item.source || ''));
    if (!failures.length) return '';
    const lines = failures.slice(0, 20).map(item => {
      const stage = item.source.startsWith('preflight-') ? 'До применения' : 'При применении';
      const reason = rowFailureReason(item).slice(0, 1000);
      return `<div class="tms-skip-line"><b>${item.excelRow ? `Excel ${escapeHtml(item.excelRow)}` : 'Строка'} · ${stage}</b><br>${escapeHtml(reason)}</div>`;
    });
    const hint = reportAvailable ? 'Подробности: «Дополнительно → Скачать отчёт».' : 'Подробности каждой строки — в фильтре «Пропустить».';
    return `<details open class="tms-skipped-box"><summary><b>Не удалось выполнить: ${failures.length}</b></summary>${lines.join('')}<div>${hint}${failures.length > 20 ? ` Показано 20 из ${failures.length}.` : ''}</div></details>`;
  }

  /**
   * Keeps only the first N executable operations from the requested Preview filter.
   * Everything outside that package is represented through ordinary review exclusions,
   * so Planner/Apply stay unchanged and the user can restore the full plan at any time.
   */
  function keepReviewedPackage(plan, review = null, options = {}) {
    if (!plan) return review || createPlanReviewState();
    const filter = ['all', 'update', 'add', 'delete'].includes(options.filter) ? options.filter : 'all';
    if (options.filter === 'skip') throw new Error('Пропущенные строки нельзя включить в пакет Apply.');
    const limit = Math.max(0, Math.min(2000, Math.trunc(Number(options.limit) || 0)));
    const state = review || createPlanReviewState();
    const executable = (plan.actions || []).filter(action => action?.type && action.type !== 'noop');
    const query = canonicalValue(options.query || '');
    const candidates = executable
      .filter(action => filter === 'all' || action.type === filter)
      .filter(action => !query || previewActionSearchText(action).includes(query));
    const keepKeys = new Set(candidates.slice(0, limit).map(planReviewActionKey));

    executable.forEach(action => {
      const key = planReviewActionKey(action);
      if (keepKeys.has(key)) state.excludedRows.delete(key);
      else state.excludedRows.add(key);
    });
    return state;
  }

  function planReviewActionKey(action) {
    const excelRow = Number(action?.excelRow?.excelRow) || 0;
    const versionId = canonicalValue(action?.currentRow?.versionId || '');
    const rowCardId = canonicalValue(action?.currentRow?.rowCardId || '');
    return `${action?.type || 'action'}:${excelRow}:${versionId || rowCardId || 'new'}`;
  }

  function reviewExcludedChanges(review, action) {
    const key = planReviewActionKey(action);
    return review?.excludedChanges?.get?.(key) || new Set();
  }

  function setPlanReviewChange(review, action, changeKey, excluded) {
    if (!review || !action || !changeKey) return review;
    const actionKey = planReviewActionKey(action);
    let set = review.excludedChanges.get(actionKey);
    if (!set) {
      set = new Set();
      review.excludedChanges.set(actionKey, set);
    }
    if (excluded) set.add(changeKey);
    else set.delete(changeKey);
    if (!set.size) review.excludedChanges.delete(actionKey);
    return review;
  }

  function setPlanReviewRow(review, action, excluded) {
    if (!review || !action) return review;
    const actionKey = planReviewActionKey(action);
    if (excluded) review.excludedRows.add(actionKey);
    else {
      review.excludedRows.delete(actionKey);
      // «Вернуть все» означает именно полный возврат строки, включая ранее
      // отключённые отдельные поля.
      review.excludedChanges.delete(actionKey);
    }
    return review;
  }

  function currentIdsForReview(currentRow, column) {
    if (!currentRow || !column) return [];
    if (column.kind === 'function') {
      return (currentRow.roles?.[column.id] || []).map(item => {
        const id = normalizeSpace(item?.id ?? '');
        if (!id) return '';
        const roleTypeId = item?.roleTypeId;
        return roleTypeId === null || roleTypeId === undefined || roleTypeId === '' ? id : `${id}|${roleTypeId}`;
      });
    }
    const kind = operandKind(column);
    if (kind !== 'ReferenceGuid' && kind !== 'ReferenceInt' && !column.refSection) return [];
    return (currentRow.values?.[column.id] || []).map(item => item?.id === null || item?.id === undefined ? '' : String(item.id));
  }

  function reviewedExcelRow(action, excludedKeys) {
    const source = action?.excelRow;
    const current = action?.currentRow;
    if (!source || !current || !excludedKeys?.size) return source;
    const flat = { ...(source.flat || {}) };
    const ids = { ...(source.ids || {}) };
    const compare = { ...(source.compare || {}) };
    const columns = new Map(source.columns || []);
    const byKey = new Map([...columns.values()].map(column => [column.key, column]));
    for (const key of excludedKeys) {
      const column = byKey.get(key);
      flat[key] = [...(current.flat?.[key] || [])];
      if (column) {
        ids[key] = currentIdsForReview(current, column);
        compare[key] = currentCompareValues(current, column);
      } else {
        ids[key] = [];
        compare[key] = [...(flat[key] || [])].map(value => `value:${canonicalValue(value)}`);
      }
    }
    return {
      ...source,
      flat,
      ids,
      compare,
      columns,
      fingerprint: fingerprintFlat(flat),
      compareFingerprint: fingerprintFlat(compare),
    };
  }

  function buildReviewedPlan(plan, review = null) {
    if (!plan) return null;
    const state = review || createPlanReviewState();
    const actions = (plan.actions || []).map(action => {
      const actionKey = planReviewActionKey(action);
      const rowExcluded = Boolean(state.excludedRows?.has?.(actionKey));
      // Whole-operation review is intentionally available for every mutation type.
      // ADD/DELETE are atomic from the review UI perspective; UPDATE additionally
      // supports per-field exclusions below.
      if (rowExcluded && (action.type === 'add' || action.type === 'delete')) {
        return { ...action, type: 'noop', changes: [], reviewExcluded: true, originalType: action.type };
      }
      if (action.type !== 'update') return action;
      const excludedKeys = new Set(reviewExcludedChanges(state, action));
      if (rowExcluded) {
        for (const change of action.changes || []) excludedKeys.add(change.key);
      }
      if (!excludedKeys.size) return action;
      const changes = (action.changes || []).filter(change => !excludedKeys.has(change.key));
      const excelRow = reviewedExcelRow(action, excludedKeys);
      if (!changes.length) {
        return { ...action, type: 'noop', changes: [], excelRow, reviewExcluded: true, originalType: 'update' };
      }
      return { ...action, changes, excelRow, reviewExcludedKeys: [...excludedKeys] };
    });

    const reviewed = {
      ...plan,
      actions,
      counts: countActions(actions, plan.skippedRows || []),
      reviewApplied: true,
    };

    // Частичная отмена меняет итоговую строку, поэтому заново проверяем дубли.
    // Иначе пользователь мог бы убрать одно поле и случайно собрать комбинацию,
    // уже существующую в другой строке TESSA.
    const duplicateIssues = detectPlanDuplicateConflicts(actions.filter(action => action.type !== 'noop'), plan.snapshot, plan.structure);
    const safety = plan.safety
      ? { ...plan.safety, blockedReasons: [...(plan.safety.blockedReasons || [])] }
      : { blocked: false, blockedReasons: [] };
    if (duplicateIssues.length) {
      safety.blocked = true;
      safety.blockedReasons = [...new Set([...safety.blockedReasons, ...duplicateIssues])];
    }
    reviewed.safety = safety;
    reviewed.reviewIssues = duplicateIssues;
    return reviewed;
  }

  function compactPlanForExport(plan) {
    if (!plan) return null;
    return {
      id: plan.id,
      createdAt: plan.createdAt,
      mode: plan.mode,
      fileName: plan.fileName,
      sheetName: plan.sheetName,
      matrixId: plan.matrixId,
      templateId: plan.templateId,
      counts: plan.counts,
      warnings: plan.warnings,
      issues: plan.issues,
      skippedFields: plan.skippedFields || [],
      safety: plan.safety,
      actions: (plan.actions || []).map(action => ({
        type: action.type,
        match: action.match,
        expectedFingerprint: action.expectedFingerprint,
        excelRow: action.excelRow ? {
          excelRow: action.excelRow.excelRow,
          system: action.excelRow.system,
          flat: action.excelRow.flat,
          ids: action.excelRow.ids,
        } : null,
        currentRow: action.currentRow ? {
          index: action.currentRow.index,
          rowCardId: action.currentRow.rowCardId,
          versionId: action.currentRow.versionId,
          fingerprint: action.currentRow.fingerprint,
          flat: action.currentRow.flat,
        } : null,
        changes: action.changes,
      })),
    };
  }

  function matrixNameSimilarity(a, b) {
    const aa = new Set(canonicalHeader(a).split(/\s+/).filter(token => token.length > 2 && !['матрица', 'основная'].includes(token)));
    const bb = new Set(canonicalHeader(b).split(/\s+/).filter(token => token.length > 2 && !['матрица', 'основная'].includes(token)));
    if (!aa.size || !bb.size) return 0;
    const intersection = [...aa].filter(token => bb.has(token)).length;
    return intersection / Math.max(aa.size, bb.size);
  }

  function resultingRoleCountForAction(action, structure, currentRowOverride = null) {
    if (!action?.excelRow || !structure?.functions) return 0;
    const currentRow = currentRowOverride || action.currentRow || null;
    let count = 0;
    for (const fn of structure.functions) {
      const column = action.excelRow.columns?.get?.(fn.id);
      if (column) {
        count += (action.excelRow.flat?.[column.key] || []).filter(value => normalizeSpace(value)).length;
      } else if (action.type !== 'add') {
        count += (currentRow?.roles?.[fn.id] || []).length;
      }
    }
    return count;
  }

  function resolvedMatrixState(matrixInfo, localize = null) {
    const source = normalizeSpace(matrixInfo?.StateName || matrixInfo?.StateID || 'неизвестно');
    if (!source.startsWith('$') || typeof localize !== 'function') return source;
    try {
      return normalizeSpace(localize(source)) || source;
    } catch (_) {
      return source;
    }
  }

  function matrixStateCaption(matrixInfo, localize = null) {
    const raw = resolvedMatrixState(matrixInfo, localize);
    const state = canonicalHeader(raw);
    if (state.includes('draft') || state.includes('чернов')) return 'Черновик';
    if (state.includes('active') || state.includes('актив')) return 'Активная';
    if (state.includes('obsolete') || state.includes('outdated') || state.includes('устар')) return 'Устаревшая';
    if (state.includes('approval') || state.includes('coordination') || state.includes('соглас')) return 'Согласование';
    return raw.startsWith('$Mtx_Enums_') ? 'Неизвестное состояние' : raw;
  }

  function isWritableMatrixDraft(matrixInfo, localize = null) {
    const state = canonicalHeader(resolvedMatrixState(matrixInfo, localize));
    if (!state) return false;
    return state.includes('draft') || state.includes('чернов');
  }

  function assertWritableMatrixDraft(bridge) {
    const matrixInfo = bridge.matrixInfo();
    const localize = typeof bridge?.localizeValue === 'function' ? bridge.localizeValue.bind(bridge) : null;
    if (!isWritableMatrixDraft(matrixInfo, localize)) {
      throw new Error(`Открыта матрица в состоянии «${matrixStateCaption(matrixInfo, localize)}». Изменения разрешены только в черновике. Создайте или откройте актуальный черновик матрицы и повторите сравнение.`);
    }
    return matrixInfo;
  }

  // ---------------------------------------------------------------------------
  // 10. БЕЗОПАСНОСТЬ И PREFLIGHT
  // Перед применением проверяются права, режим редактирования, дубли, справочники и
  // подозрительные удаления. Ошибочная строка пропускается, а не маскируется догадкой.
  // ---------------------------------------------------------------------------


  function indexSnapshotForReconciliation(snapshot) {
    const byCard = new Map();
    const byVersion = new Map();
    const ambiguousCards = new Set();
    const ambiguousVersions = new Set();
    for (const row of snapshot?.rows || []) {
      const card = canonicalValue(row?.rowCardId || '');
      const version = canonicalValue(row?.versionId || '');
      if (card) {
        if (byCard.has(card)) ambiguousCards.add(card);
        else byCard.set(card, row);
      }
      if (version) {
        if (byVersion.has(version)) ambiguousVersions.add(version);
        else byVersion.set(version, row);
      }
    }
    return { byCard, byVersion, ambiguousCards, ambiguousVersions, rowCount: (snapshot?.rows || []).length };
  }

  function reconcileMutationReceipts(receipts, snapshot, structure) {
    const index = indexSnapshotForReconciliation(snapshot);
    const rows = [];
    for (const receipt of receipts || []) {
      const cardKey = receipt?.rowCardId ? canonicalValue(receipt.rowCardId) : '';
      const versionKey = receipt?.versionId ? canonicalValue(receipt.versionId) : '';
      const byCard = cardKey ? index.byCard.get(cardKey) : null;
      const byVersion = versionKey ? index.byVersion.get(versionKey) : null;
      const cardAmbiguous = Boolean(cardKey && index.ambiguousCards.has(cardKey));
      const versionAmbiguous = Boolean(versionKey && index.ambiguousVersions.has(versionKey));
      if (receipt?.type === 'delete') {
        rows.push(byCard || byVersion || cardAmbiguous || versionAmbiguous
          ? { type: 'delete', excelRow: receipt.excelRow ?? null, status: 'divergent', reasonCode: 'reconcile-delete-still-member' }
          : { type: 'delete', excelRow: receipt.excelRow ?? null, status: 'verified', reasonCode: 'reconcile-delete-absent' });
        continue;
      }
      if (!cardKey && !versionKey) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'unknown', reasonCode: 'reconcile-identity-unknown' });
        continue;
      }
      if (cardAmbiguous || versionAmbiguous) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'unknown', reasonCode: 'reconcile-identity-ambiguous' });
        continue;
      }
      if (byCard && byVersion && byCard !== byVersion) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'unknown', reasonCode: 'reconcile-identity-conflict' });
        continue;
      }
      const current = byCard || byVersion;
      if (!current) {
        rows.push({ type: receipt?.type || null, excelRow: receipt?.excelRow ?? null, status: 'missing', reasonCode: 'reconcile-target-missing' });
        continue;
      }
      const matches = reconciliationSemanticKey(current, structure) === receipt.expectedSemanticKey;
      rows.push(matches
        ? { type: receipt.type, excelRow: receipt.excelRow ?? null, status: 'verified', reasonCode: 'reconcile-match' }
        : { type: receipt.type, excelRow: receipt.excelRow ?? null, status: 'divergent', reasonCode: 'reconcile-semantic-divergence' });
    }
    const counts = { verified: 0, divergent: 0, missing: 0, unknown: 0 };
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(counts, row.status)) counts[row.status] += 1;
    }
    return {
      status: counts.divergent || counts.missing ? 'divergent' : counts.unknown ? 'incomplete' : 'verified',
      checkedCount: rows.length,
      verifiedCount: counts.verified,
      divergentCount: counts.divergent,
      missingCount: counts.missing,
      unknownCount: counts.unknown,
      rows,
    };
  }

  async function runReconciliationRead(bridgeFactory, receiptContext, options = {}) {
    const maxAttempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));
    const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 450));
    const startedAt = nowIso();
    let lastError = null;
    let usedAttempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      usedAttempts = attempt;
      if (attempt > 1 && baseDelayMs) await sleep(baseDelayMs * (2 ** (attempt - 2)));
      try {
        const bridge = await bridgeFactory();
        const structure = await bridge.requestStructure(receiptContext.templateId);
        const snapshot = await bridge.loadSnapshot(structure);
        const expectedMatrixId = canonicalValue(receiptContext?.matrixId || '');
        const actualMatrixId = canonicalValue(snapshot?.matrixId || '');
        const expectedTemplateId = canonicalValue(receiptContext?.templateId || '');
        const actualTemplateId = canonicalValue(snapshot?.templateId || structure?.templateId || '');
        if (!expectedMatrixId || actualMatrixId !== expectedMatrixId
          || !expectedTemplateId || actualTemplateId !== expectedTemplateId) {
          return {
            status: 'incomplete',
            checkedCount: 0,
            verifiedCount: 0,
            divergentCount: 0,
            missingCount: 0,
            unknownCount: receiptContext?.receipts?.length || 0,
            rows: [],
            attempts: attempt,
            retryable: false,
            reasonCode: 'reconcile-context-mismatch',
            startedAt,
            finishedAt: nowIso(),
          };
        }
        return {
          ...reconcileMutationReceipts(receiptContext?.receipts || [], snapshot, structure),
          attempts: attempt,
          retryable: false,
          startedAt,
          finishedAt: nowIso(),
        };
      } catch (error) {
        lastError = error;
        if (!isWriterLockError(error) || attempt === maxAttempts) break;
      }
    }
    const retryable = isWriterLockError(lastError);
    return {
      status: 'incomplete',
      checkedCount: 0,
      verifiedCount: 0,
      divergentCount: 0,
      missingCount: 0,
      unknownCount: receiptContext?.receipts?.length || 0,
      rows: [],
      attempts: usedAttempts,
      retryable,
      reasonCode: retryable ? 'reconcile-writer-lock' : 'reconcile-read-failed',
      startedAt,
      finishedAt: nowIso(),
    };
  }

  function deletionGuard(plan) {
    const deleteCount = Number(plan?.counts?.delete || 0);
    const snapshotCount = Number(plan?.snapshot?.rows?.length || plan?.sourceRowCount || 0);
    if (!deleteCount || !snapshotCount) return { blocked: false, deleteCount, snapshotCount, ratio: 0, rule: null, reason: null };
    const ratio = deleteCount / snapshotCount;
    const absoluteBlocked = deleteCount >= 100;
    const ratioBlocked = deleteCount >= 10 && ratio >= 0.20;
    const rule = absoluteBlocked ? 'absolute' : ratioBlocked ? 'ratio' : null;
    const blocked = Boolean(rule);
    const reason = rule === 'absolute'
      ? `Excel удаляет ${deleteCount} строк. За один пакет нельзя удалять 100 и более строк; разделите массовое удаление на несколько контролируемых пакетов.`
      : rule === 'ratio'
        ? `Excel удаляет ${deleteCount} из ${snapshotCount} строк (${Math.round(ratio * 100)}%). Эти удаления будут пропущены; разделите массовое удаление на несколько меньших пакетов.`
        : null;
    return { blocked, deleteCount, snapshotCount, ratio, rule, reason };
  }

  function suppressPlanForUnsafeContext(plan) {
    plan.candidateCounts = { ...plan.counts };
    plan.candidateActions = plan.actions;
    plan.candidateSkippedRows = plan.skippedRows;
    plan.actions = [];
    plan.skippedRows = [];
    plan.counts = countActions([], []);
    plan.previewSuppressed = true;
    return plan;
  }

  function evaluatePlanSafety(plan, bridge) {
    const matrixInfo = bridge.matrixInfo();
    const stateLocalizer = typeof bridge?.localizeValue === 'function' ? bridge.localizeValue.bind(bridge) : null;
    const totalHeaders = plan.columnMap.dataHeaderCount;
    const mappedColumns = [...plan.columnMap.columns.values()];
    const mappedHeaders = mappedColumns.length;
    const mappedFunctions = mappedColumns.filter(column => column.kind === 'function').length;
    const workbookMatrixName = normalizeSpace(plan.workbook.metadata?.['Наименование матрицы'] || plan.workbook.metadata?.['Тип матрицы'] || '');
    const currentMatrixName = normalizeSpace(matrixInfo.TemplateName || '');
    const nameScore = workbookMatrixName && currentMatrixName ? matrixNameSimilarity(workbookMatrixName, currentMatrixName) : null;
    const blockedReasons = [];
    let suppressUnsafePreview = false;

    // Только ошибки уровня файла/контекста блокируют весь пакет. Ошибки отдельных строк
    // уже вынесены в plan.skippedRows и не мешают корректным операциям.
    if (!isWritableMatrixDraft(matrixInfo, stateLocalizer)) {
      blockedReasons.push(`Открыта матрица в состоянии «${matrixStateCaption(matrixInfo, stateLocalizer)}». Изменения возможны только в черновике.`);
      suppressUnsafePreview = true;
    }

    if (plan.mode === 'roundtrip') {
      if (!ROUNDTRIP.AcceptedFormats.includes(plan.workbook.roundtrip?.format)) {
        blockedReasons.push('Не удалось распознать формат Excel. Скачайте новый файл из открытой матрицы и перенесите изменения в него.');
        suppressUnsafePreview = true;
      }
      const workbookTemplateId = canonicalValue(plan.workbook.roundtrip?.templateId);
      const currentTemplateId = canonicalValue(matrixInfo.TemplateID);
      if (!workbookTemplateId || workbookTemplateId !== currentTemplateId) {
        blockedReasons.push('Файл выгружен из другого шаблона матрицы TESSA.');
        suppressUnsafePreview = true;
      }

      const workbookMatrixId = canonicalValue(plan.workbook.roundtrip?.matrixId);
      const currentMatrixId = canonicalValue(matrixInfo.matrixId);
      const currentPreviousId = canonicalValue(matrixInfo.PreviousVersionID);
      const sameMatrix = Boolean(workbookMatrixId && workbookMatrixId === currentMatrixId);
      const exportedFromPreviousVersion = Boolean(workbookMatrixId && workbookMatrixId === currentPreviousId);
      if (!sameMatrix && !exportedFromPreviousVersion) {
        blockedReasons.push('Excel относится к другой карточке матрицы. Скачайте свежий Excel из открытой матрицы.');
        suppressUnsafePreview = true;
      }

      if (mappedHeaders === 0) {
        blockedReasons.push('В Excel не осталось ни одного актуального критерия или функции TESSA. Обновите структуру Excel.');
        suppressUnsafePreview = true;
      }
      if (plan.fatalIssues?.length) {
        blockedReasons.push(...plan.fatalIssues);
        suppressUnsafePreview = true;
      }
    } else {
      if (mappedHeaders === 0) {
        blockedReasons.push('Файл не похож на выгрузку матрицы TESSA: ни один рабочий столбец не сопоставлен.');
        suppressUnsafePreview = true;
      }
      if (mappedFunctions === 0) {
        blockedReasons.push('Не сопоставлен ни один столбец исполнителей/функций.');
        suppressUnsafePreview = true;
      }
      if (totalHeaders && mappedHeaders / totalHeaders < 0.5) {
        blockedReasons.push(`Сопоставлено только ${mappedHeaders} из ${totalHeaders} рабочих столбцов Excel — вероятно, открыт другой тип матрицы.`);
        suppressUnsafePreview = true;
      }
      if (nameScore !== null && nameScore < 0.34) {
        blockedReasons.push(`Excel относится к матрице «${workbookMatrixName}», а открыта матрица «${currentMatrixName}».`);
        suppressUnsafePreview = true;
      }
    }

    return {
      blocked: blockedReasons.length > 0,
      blockedReasons: [...new Set(blockedReasons)],
      suppressUnsafePreview,
      mode: plan.mode,
      matrixInfo,
      workbookMatrixName,
      currentMatrixName,
      nameSimilarity: nameScore,
      totalHeaders,
      mappedHeaders,
      mappedFunctions,
      mappingRatio: totalHeaders ? mappedHeaders / totalHeaders : 0,
      rowsWithoutMappedRoles: [],
      deleteGuard: deletionGuard(plan),
      roundtripMatrixId: plan.workbook.roundtrip?.matrixId || null,
      roundtripTemplateId: plan.workbook.roundtrip?.templateId || null,
    };
  }

  // ---------------------------------------------------------------------------
  // 11. ПОЛЬЗОВАТЕЛЬСКИЙ СЦЕНАРИЙ
  // Проверка выбранного Excel строит preview-план. Применение использует только уже
  // проверенный план и повторно валидирует критические условия непосредственно перед записью.
  // ---------------------------------------------------------------------------

  async function analyzeSelectedFile(file) {
    resetFilePreview();
    if (!file) throw new Error('Выберите файл .xlsx.');
    APP.abortRequested = false;
    setProgress(5, '1/6 · Читаю Excel', file.name);
    log(`Читаю ${file.name}`);
    const workbook = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name);
    setProgress(18, '1/6 · Excel прочитан', `${workbook.rows.length} строк данных`);
    log(`Excel: ${workbook.headers.filter(Boolean).length} столбцов, ${workbook.rows.length} строк данных.`);
    setProgress(22, '2/6 · Подключаюсь к TESSA', 'Проверяю открытую матрицу');
    const bridge = await TessaBridge.create();
    const templateId = bridge.templateId();
    if (!templateId) throw new Error('В карточке матрицы не найден TemplateID.');
    setProgress(32, '3/6 · Читаю структуру TESSA', 'Критерии и функции');
    const structure = await bridge.requestStructure(templateId);
    log(`Структура TESSA: ${structure.conditions.length} критериев, ${structure.functions.length} функций.`);
    const cachedSnapshot = APP.snapshot;
    const currentSectionSignature = bridge.matrixSectionSignature();
    const canReuseSnapshot = Boolean(
      cachedSnapshot
      && canonicalValue(cachedSnapshot.matrixId) === canonicalValue(bridge.mainCard?.id)
      && canonicalValue(cachedSnapshot.templateId) === canonicalValue(structure.templateId)
      && cachedSnapshot.sectionSignature === currentSectionSignature
      && Date.now() - Date.parse(cachedSnapshot.createdAt || 0) < PERFORMANCE.PreviewSnapshotTtlMs
    );
    // Обычный сценарий «скачал → изменил → проверил» не должен второй раз читать сотни карточек.
    // Перед Apply всё равно выполняется свежая серверная проверка, поэтому reuse безопасен для preview.
    setProgress(canReuseSnapshot ? 48 : 40, canReuseSnapshot ? '3/6 · Использую свежий снимок' : '3/6 · Читаю строки TESSA', canReuseSnapshot ? 'Повторная загрузка не нужна' : 'Сверяю текущие строки');
    const snapshot = canReuseSnapshot ? cachedSnapshot : await bridge.loadSnapshot(structure);
    setProgress(55, '4/6 · Сопоставляю Excel и TESSA', `${snapshot.rows.length} строк в TESSA`);
    log(`Текущее состояние TESSA: ${snapshot.rows.length} строк${canReuseSnapshot ? ' (из текущей сессии)' : ''}.`);
    const plan = buildPlan(workbook, structure, snapshot);
    setProgress(62, '5/6 · Проверяю безопасность', 'Дубли, права, удаления и неоднозначности');
    plan.safety = evaluatePlanSafety(plan, bridge);
    plan.matrixInfo = plan.safety.matrixInfo;
    if (plan.safety.blocked) {
      log(`Файл нельзя применить в текущем контексте: ${plan.safety.blockedReasons.join(' ')}`, 'warn');
      if (plan.safety.suppressUnsafePreview) {
        suppressPlanForUnsafeContext(plan);
      }
    } else if (plan.skippedRows?.length) {
      log(`Проверка готова: ${plan.skippedRows.length} строк будут пропущены, остальные можно применить.`, 'warn');
    }
    let previewPlan = plan;
    if (!plan.safety.blocked && plan.actions.some(action => action.type !== 'noop')) {
      const previewPolicy = previewPreflightPolicy(plan.actions);
      if (previewPolicy.skipServerAddValidation) log(previewPolicy.reason, 'warn');
      const previewProgress = (phasePercent, label, detail = '') => {
        const bounded = Math.max(10, Math.min(42, Number(phasePercent) || 10));
        const percent = 70 + Math.round(((bounded - 10) / 32) * 28);
        setProgress(percent, `6/6 · ${label}`, detail);
      };
      setProgress(70, '6/6 · Проверяю применимость', previewPolicy.skipServerAddValidation
        ? 'Большой пакет: быстрый локальный Preview без тысяч лишних CardNew/duplicate запросов'
        : 'Справочники, дубли и зависимости перед Apply');
      const previewPreflight = await preflightPlan(plan, { previewOnly: true, bridge, structure, onProgress: previewProgress });
      previewPlan = applyPreflightPreview(plan, previewPreflight);
      if (previewPlan.preflightPreview.runtimeSkipCount) {
        log(`Предварительная проверка: ${previewPlan.preflightPreview.runtimeSkipCount} операций заранее переведены в ПРОПУСТИТЬ.`, 'warn');
      }
    }
    APP.workbook = workbook;
    if (workbook.dictionaryCatalog && workbook.roundtrip?.enabled) {
      APP.dictionaryCatalog = normalizeDictionaryCatalog(clonePlain(workbook.dictionaryCatalog));
      APP.dictionaryCatalog.stats.cache = { hit: true, key: dictionaryCacheKey(structure), savedAt: Date.now(), ageMs: 0, source: 'workbook' };
      writeDictionaryCache(dictionaryCacheKey(structure), APP.dictionaryCatalog).catch(() => {});
    }
    APP.bridge = bridge;
    APP.structure = structure;
    APP.snapshot = snapshot;
    APP.review = createPlanReviewState();
    APP.previewView = createPreviewViewState();
    APP.plan = previewPlan;
    renderPlan(previewPlan);
    const visible = previewPlan.actions.filter(action => action.type !== 'noop').length;
    const skipped = previewPlan.counts?.skip || 0;
    const detail = visible
      ? `Корректных изменений: ${visible}${skipped ? ` · пропустить строк: ${skipped}` : ''}${previewPlan.skippedFields?.length ? ` · не применяются поля: ${previewPlan.skippedFields.length}` : ''}`
      : (skipped ? `Нет изменений для применения · пропущено строк: ${skipped}` : 'Изменений нет');
    setProgress(100, 'Проверка завершена', detail);
    return previewPlan;
  }

  function resetFilePreview() {
    clearTimeout(APP.previewSearchTimer);
    APP.plan = null;
    APP.workbook = null;
    APP.review = createPlanReviewState();
    APP.previewView = createPreviewViewState();
    APP.capabilityActions = [];
    APP.reviewedApplyEnabled = false;
    APP.lastIntervalDiagnostics = null;
    APP.lastStudioDiagnostics = null;
    renderStudioDiagnostics();
    updateIntervalDiagnosticControlState();
    for (const id of ['#tms-summary', '#tms-plan']) {
      const element = document.querySelector(id);
      if (element) element.innerHTML = '';
    }
    const apply = document.querySelector('#tms-apply');
    if (apply) apply.disabled = true;
    const applySection = document.querySelector('#tms-apply-section');
    if (applySection) applySection.hidden = true;
  }

  async function hydrateMissingIdsForAction(action, structure, snapshot, bridge) {
    if (!action || (action.type !== 'update' && action.type !== 'add')) return;
    const desired = action.excelRow;
    for (const condition of structure.conditions) {
      const column = desired.columns.get(condition.criterionRowId);
      if (!column) continue;
      const operand = canonicalValue(condition.operandTypeId);
      const isReference = operand === canonicalValue(OPERAND.ReferenceGuid)
        || operand === canonicalValue(OPERAND.ReferenceInt)
        || Boolean(condition.refSection);
      if (!isReference) continue;
      const displays = desired.flat[column.key] || [];
      const ids = desired.ids[column.key] || [];
      for (let i = 0; i < displays.length; i += 1) {
        if (ids[i]) continue;
        const cached = snapshot.criterionIdCache.get(`${condition.criterionRowId}|${canonicalValue(displays[i])}`);
        if (!cached?.ambiguous && cached?.id !== null && cached?.id !== undefined) continue;
        log(`Ищу в справочнике: ${condition.criterionName} = ${displays[i]}`);
        const online = await bridge.resolveReferenceOnline(condition, displays[i]);
        if (online?.id !== null && online?.id !== undefined) ids[i] = String(online.id);
      }
      desired.ids[column.key] = ids;
    }
    for (const fn of structure.functions) {
      const column = desired.columns.get(fn.id);
      if (!column) continue;
      const displays = desired.flat[column.key] || [];
      const ids = desired.ids[column.key] || [];
      for (let i = 0; i < displays.length; i += 1) {
        if (ids[i]) continue;
        const cached = snapshot.roleIdByFunctionCache.get(`${fn.id}|${canonicalValue(displays[i])}`) || snapshot.roleIdCache.get(canonicalValue(displays[i]));
        if (!cached?.ambiguous && cached?.id && cached.roleTypeId !== null && cached.roleTypeId !== undefined) continue;
        log(`Ищу роль в TESSA: ${displays[i]}`);
        const online = await bridge.resolveRoleOnline(fn, displays[i], snapshot);
        if (online?.id) ids[i] = `${online.id}|${online.roleTypeId}`;
      }
      desired.ids[column.key] = ids;
    }
  }

  function nativeEditAccessState() {
    const text = canonicalValue(document.body?.innerText || '');
    if (text.includes('завершить редактирование и разблокировать') || text.includes('добавить строку')) return { editable: true, reason: null };
    if (text.includes('редактировать и заблокировать для других')) return { editable: false, reason: 'edit-mode' };
    return { editable: null, reason: 'unknown' };
  }

  function assertNativeEditMode() {
    const state = nativeEditAccessState();
    if (state.editable === false && state.reason === 'edit-mode') throw new Error('Матрица открыта только для просмотра. Нажмите в TESSA «Редактировать и заблокировать для других», затем повторите проверку.');
    return state;
  }

  function friendlyErrorMessage(error) {
    const raw = normalizeSpace(error?.message || error || 'Неизвестная ошибка');
    const text = canonicalValue(raw);
    if (text.includes('дублирующ') || text.includes('duplicate')) return 'TESSA обнаружила дублирующую строку. Проверьте одинаковые строки в Excel: комбинация критериев и исполнителей должна быть уникальной.';
    if (text.includes('access denied') || text.includes('permission') || text.includes('forbidden') || text.includes('недостаточно прав') || text.includes('нет прав') || text.includes('прав доступа') || text.includes('доступ запрещ')) return 'Недостаточно прав для изменения этой матрицы. Откройте черновик под пользователем с правами редактирования.';
    if (text.includes('lock') || text.includes('заблок')) return 'Матрица занята или не переведена в режим редактирования. Обновите карточку, войдите в режим «Редактировать и заблокировать для других» и повторите проверку.';
    if (text.includes('изменилась в tessa после предпросмотра') || text.includes('исчезла после предпросмотра')) return 'Матрица изменилась после проверки Excel. Нажмите «Проверить изменения» ещё раз, чтобы работать с актуальной версией.';
    return raw;
  }

  function runtimeSkip(action, error, phase = 'preflight') {
    const rowNumber = action?.excelRow?.excelRow || null;
    const skipped = makeSkippedRow(rowNumber, friendlyErrorMessage(error), phase, action?.type || null);
    if (error instanceof DuplicateValidationError) {
      // Fixed diagnostic fields only; retain the original reason in the opt-in
      // Apply report. Do not infer this from arbitrary Store/network error text.
      skipped.check = 'duplicate';
      skipped.code = error.code;
      skipped.writeAttempted = false;
    }
    return skipped;
  }

  function applyPreflightPreview(plan, preflight) {
    if (!plan) return plan;
    const skippedActions = preflight?.runtimeSkippedActions instanceof Set
      ? preflight.runtimeSkippedActions
      : new Set();
    const runtimeSkips = Array.isArray(preflight?.runtimeSkips) ? preflight.runtimeSkips : [];
    const seenSkips = new Set();
    const skippedRows = [];
    for (const item of [...(plan.skippedRows || []), ...runtimeSkips]) {
      const key = [item?.phase || '', item?.actionType || '', item?.excelRow ?? '', item?.reason || ''].join('|');
      if (seenSkips.has(key)) continue;
      seenSkips.add(key);
      skippedRows.push(item);
    }
    const actions = (plan.actions || []).filter(action => !skippedActions.has(action));
    const runtimeSkipCount = runtimeSkips.length;
    const warnings = [...(plan.warnings || [])];
    if (runtimeSkipCount) {
      warnings.push(`Предварительная проверка до Apply: ${runtimeSkipCount} операций переведены в ПРОПУСТИТЬ. Причины показаны выше.`);
    }
    const serverAddValidationSkipped = Boolean(preflight?.previewPolicy?.skipServerAddValidation);
    if (serverAddValidationSkipped && preflight?.previewPolicy?.reason) warnings.push(preflight.previewPolicy.reason);
    return {
      ...plan,
      actions,
      skippedRows,
      warnings,
      counts: countActions(actions, skippedRows),
      preflightPreview: {
        validated: true,
        runtimeSkipCount,
        attemptedCount: (plan.actions || []).filter(action => action.type !== 'noop').length,
        executableCount: actions.filter(action => action.type !== 'noop').length,
        serverAddValidationSkipped,
        applyBlockedByBatch: Boolean(preflight?.previewPolicy?.applyBlocked),
        validatedAt: nowIso(),
      },
    };
  }

  async function preflightPlan(plan, options = {}) {
    const previewOnly = Boolean(options.previewOnly);
    const preflightProgress = typeof options.onProgress === 'function'
      ? options.onProgress
      : (previewOnly ? () => {} : setProgress);
    const previewPolicy = previewOnly
      ? previewPreflightPolicy(plan?.actions || [])
      : { applyBlocked: false, skipServerAddValidation: false, reason: null };
    const skipServerAddValidation = Boolean(previewPolicy.skipServerAddValidation);
    preflightProgress(10, 'Предварительная проверка', 'Перечитываю матрицу перед записью');
    if (plan?.safety?.blocked) throw new Error(`Файл нельзя применить: ${plan.safety.blockedReasons.join(' ')}`);
    const bridge = options.bridge || await awaitPreflightAbortable(TessaBridge.create());
    assertWritableMatrixDraft(bridge);
    if (!previewOnly) assertNativeEditMode();
    const structure = options.structure || await awaitPreflightAbortable(bridge.requestStructure(bridge.templateId()));
    const fresh = options.fresh || await awaitPreflightAbortable(bridge.loadSnapshot(structure));
    preflightProgress(18, 'Сверяю актуальное состояние', `${fresh.rows.length} строк в TESSA`);
    if (fresh.matrixId !== plan.matrixId) throw new Error('Открыта другая матрица. Нажмите «Проверить изменения» ещё раз.');
    // Template changes can happen between Preview and Apply without changing the
    // card ID. Never rebuild an old plan against a different set of field IDs.
    if (plan.templateId && canonicalValue(plan.templateId) !== canonicalValue(fresh.templateId || structure.templateId)) {
      throw new Error('Шаблон матрицы изменился. Нажмите «Проверить изменения» ещё раз.');
    }
    const freshByVersion = new Map(fresh.rows.map(row => [canonicalValue(row.versionId), row]));
    const freshByCard = new Map(fresh.rows.map(row => [canonicalValue(row.rowCardId), row]));
    const runtimeSkips = [];
    const runtimeSkippedActions = new Set();
    const preparedUpdates = new Map();
    const preparedAdds = new Map();
    const readyDeletes = [];
    const failedMutationRows = new Set();

    // Некоторые финально валидные пакеты используют DELETE как зависимость: например,
    // UPDATE A -> значения B одновременно с DELETE B. До удаления B серверная проверка
    // может видеть временный дубль. Если связанная мутация не применится, такой DELETE
    // нельзя выполнять отдельно — иначе получится разрушительное частичное применение.
    const mutationRowsByDesiredSemanticKey = new Map();
    for (const action of plan.actions.filter(x => (x.type === 'update' || x.type === 'add') && x.excelRow)) {
      const resultingFlat = action.type === 'update'
        ? { ...(action.currentRow?.flat || {}), ...(action.excelRow.flat || {}) }
        : (action.excelRow.flat || {});
      const desiredSemanticKey = dependencySemanticKey(resultingFlat, structure);
      const excelRow = Number(action.excelRow.excelRow);
      if (!desiredSemanticKey || !Number.isFinite(excelRow)) continue;
      if (!mutationRowsByDesiredSemanticKey.has(desiredSemanticKey)) mutationRowsByDesiredSemanticKey.set(desiredSemanticKey, []);
      mutationRowsByDesiredSemanticKey.get(desiredSemanticKey).push(excelRow);
    }
    const deleteDependencies = new Map();
    for (const action of plan.actions.filter(x => x.type === 'delete')) {
      const currentSemanticKey = dependencySemanticKey(action.currentRow?.flat || {}, structure);
      deleteDependencies.set(action, [...(mutationRowsByDesiredSemanticKey.get(currentSemanticKey) || [])]);
    }

    // UPDATE: каждая строка проверяется независимо. Ошибка одной строки не отменяет пакет.
    for (const action of plan.actions.filter(x => x.type === 'update')) {
      if (APP.abortRequested) throw preflightAbortError();
      try {
        const current = freshByVersion.get(canonicalValue(action.currentRow.versionId));
        if (!current) throw new Error(`Строка ${action.currentRow.versionId} исчезла после предпросмотра.`);
        if (current.fingerprint !== action.expectedFingerprint) throw new Error(`Строка Excel ${action.excelRow.excelRow} изменилась в TESSA после предпросмотра.`);

        // REPLACE читает данные из source identity Excel, но записывает их в другую target identity.
        // Target stale-check выше недостаточен: source мог измениться уже после Preview.
        // Повторно сверяем source непосредственно перед записью, иначе старый снимок source
        // может быть перенесён в неизменившийся target.
        if (isOverwriteMatch(action.match)) {
          const sourceVersionId = canonicalValue(action.excelRow?.system?.versionId || '');
          const sourceRowCardId = canonicalValue(action.excelRow?.system?.rowCardId || '');
          const sourceCurrent = (sourceVersionId ? freshByVersion.get(sourceVersionId) : null)
            || (sourceRowCardId ? freshByCard.get(sourceRowCardId) : null);
          if (!sourceCurrent) throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} исчезла после предпросмотра.`);
          const sourceExpectedFingerprint = canonicalValue(action.match?.sourceFingerprint || action.excelRow?.system?.baseFingerprint || '');
          const sourceFreshFingerprint = canonicalValue(sourceCurrent.fingerprint || fingerprintFlat(sourceCurrent.flat || {}));
          if (!sourceExpectedFingerprint || sourceExpectedFingerprint !== sourceFreshFingerprint) {
            throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} изменилась в TESSA после предпросмотра.`);
          }
        }

        await awaitPreflightAbortable(hydrateMissingIdsForAction(action, structure, fresh, bridge));
        for (const condition of structure.conditions) {
          const column = action.excelRow.columns.get(condition.criterionRowId);
          if (!column) continue;
          const displays = action.excelRow.flat[column.key] || [];
          const ids = action.excelRow.ids[column.key] || [];
          displays.forEach((display, i) => bridge.resolveCriterion(condition, display, ids[i] || null, fresh));
        }
        let roleCount = 0;
        for (const fn of structure.functions) {
          const column = action.excelRow.columns.get(fn.id);
          if (!column) { roleCount += (current.roles?.[fn.id] || []).length; continue; }
          const displays = action.excelRow.flat[column.key] || [];
          const ids = action.excelRow.ids[column.key] || [];
          displays.forEach((display, i) => { bridge.resolveRole(fn, display, ids[i] || null, fresh); roleCount += 1; });
        }
        if (!roleCount) throw new Error(`В строке Excel ${action.excelRow.excelRow} после изменений не останется исполнителей.`);
        const card = await awaitPreflightAbortable(bridge.getCard(current.rowCardId));
        bridge.rebuildRowCard(card, current.versionId, action.excelRow, structure, fresh);
        await awaitPreflightAbortable(bridge.validateDuplicate(card, current.versionId));
        preparedUpdates.set(action.excelRow.excelRow, { action, card, current });
      } catch (error) {
        if (isPreflightAbortError(error)) throw error;
        const excelRow = Number(action.excelRow?.excelRow);
        if (Number.isFinite(excelRow)) failedMutationRows.add(excelRow);
        runtimeSkippedActions.add(action);
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-update'));
      }
    }

    preflightProgress(28, 'Проверяю изменяемые строки', `Проверено: ${plan.actions.filter(x => x.type === 'update').length}`);

    // ADD: локальные справочники/типы проверяются всегда. Серверный CardNew +
    // ValidateDuplicate нужен для применяемых пакетов, но для Preview >2000 он только
    // создаёт тысячи сетевых запросов к пакету, который всё равно нельзя Apply.
    const addActions = plan.actions.filter(x => x.type === 'add');
    let createCapabilityError = null;
    if (addActions.length && !skipServerAddValidation) {
      try { bridge.assertCanCreateRows(); } catch (error) { createCapabilityError = error; }
    }
    const addStartedAt = monotonicNow();
    let completedAdds = 0;
    let lastYieldAt = addStartedAt;
    const addProgressLabel = skipServerAddValidation ? 'Быстрый Preview новых строк' : 'Проверяю новые строки';
    if (addActions.length) {
      preflightProgress(29, addProgressLabel,
        skipServerAddValidation
          ? `0 из ${formatProgressCount(addActions.length)} · локальная проверка`
          : `0 из ${formatProgressCount(addActions.length)} · жду ответ TESSA`);
    }

    const validateAddAction = async action => {
      if (APP.abortRequested) throw preflightAbortError();
      try {
        if (!skipServerAddValidation && createCapabilityError) throw createCapabilityError;
        if (action.match?.matchedBy === 'copied-row-auto-add') {
          const sourceVersionId = canonicalValue(action.match.sourceVersionId || '');
          const sourceRowCardId = canonicalValue(action.match.sourceRowCardId || '');
          const sourceCurrent = (sourceVersionId ? freshByVersion.get(sourceVersionId) : null)
            || (sourceRowCardId ? freshByCard.get(sourceRowCardId) : null);
          if (!sourceCurrent) throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} исчезла после предпросмотра.`);
          const sourceExpectedFingerprint = canonicalValue(action.match.sourceFingerprint || '');
          const sourceFreshFingerprint = canonicalValue(sourceCurrent.fingerprint || fingerprintFlat(sourceCurrent.flat || {}));
          if (!sourceExpectedFingerprint || sourceExpectedFingerprint !== sourceFreshFingerprint) {
            throw new Error(`Исходная строка Excel ${action.excelRow.excelRow} изменилась в TESSA после предпросмотра.`);
          }
        }
        await awaitPreflightAbortable(hydrateMissingIdsForAction(action, structure, fresh, bridge));
        for (const condition of structure.conditions) {
          const column = action.excelRow.columns.get(condition.criterionRowId);
          if (!column) continue;
          const displays = action.excelRow.flat[column.key] || [];
          const ids = action.excelRow.ids[column.key] || [];
          displays.forEach((display, i) => bridge.resolveCriterion(condition, display, ids[i] || null, fresh));
        }
        let roleCount = 0;
        for (const fn of structure.functions) {
          const column = action.excelRow.columns.get(fn.id);
          if (!column) continue;
          const displays = action.excelRow.flat[column.key] || [];
          const ids = action.excelRow.ids[column.key] || [];
          displays.forEach((display, i) => { bridge.resolveRole(fn, display, ids[i] || null, fresh); roleCount += 1; });
        }
        if (!roleCount) throw new Error(`В строке Excel ${action.excelRow.excelRow} не указан ни один исполнитель.`);
        if (skipServerAddValidation) return { action, prepared: { action, previewLocalOnly: true } };
        const created = await awaitPreflightAbortable(bridge.createRowCard(structure.templateId));
        log(`Подготавливаю новую строку Excel ${action.excelRow.excelRow} через CardService.${created.newMethod}`);
        bridge.rebuildRowCard(created.card, created.versionId, action.excelRow, structure, fresh);
        await awaitPreflightAbortable(bridge.validateDuplicate(created.card, created.versionId));
        return { action, prepared: { action, ...created } };
      } catch (error) {
        if (isPreflightAbortError(error)) throw error;
        return { action, error };
      }
    };

    const recordAddResult = result => {
      if (!result?.error) {
        preparedAdds.set(result.action.excelRow.excelRow, result.prepared);
        return;
      }
      const excelRow = Number(result.action?.excelRow?.excelRow);
      if (Number.isFinite(excelRow)) failedMutationRows.add(excelRow);
      runtimeSkippedActions.add(result.action);
      runtimeSkips.push(runtimeSkip(result.action, result.error, 'preflight-add'));
    };

    const reportAddProgress = () => {
      completedAdds += 1;
      const elapsedMs = Math.max(0, monotonicNow() - addStartedAt);
      const percent = addActions.length ? 29 + Math.round((completedAdds / addActions.length) * 7) : 36;
      preflightProgress(percent, addProgressLabel,
        workProgressDetail({ completed: completedAdds, total: addActions.length, elapsedMs }));
    };

    if (skipServerAddValidation) {
      for (const action of addActions) {
        recordAddResult(await validateAddAction(action));
        reportAddProgress();
        const current = monotonicNow();
        if (current - lastYieldAt >= PERFORMANCE.PreviewYieldDeadlineMs) {
          await yieldToMain();
          lastYieldAt = monotonicNow();
        }
      }
    } else {
      let heartbeatTimer = null;
      if (addActions.length) {
        heartbeatTimer = setInterval(() => {
          const elapsedMs = Math.max(0, monotonicNow() - addStartedAt);
          const elapsedSeconds = Math.max(1, Math.floor(elapsedMs / 1000));
          const percent = 29 + Math.round((completedAdds / addActions.length) * 7);
          preflightProgress(percent, addProgressLabel,
            `${formatProgressCount(completedAdds)} из ${formatProgressCount(addActions.length)} · жду ответ TESSA · прошло ${elapsedSeconds} сек`);
        }, 1000);
      }
      try {
        const results = await mapConcurrent(addActions, PERFORMANCE.PreflightAddConcurrency, async action => {
          const result = await validateAddAction(action);
          reportAddProgress();
          return result;
        });
        results.forEach(recordAddResult);
      } finally {
        if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      }
    }

    preflightProgress(36,
      skipServerAddValidation ? 'Быстрый Preview новых строк завершён' : 'Проверяю новые строки',
      workProgressDetail({ completed: addActions.length, total: addActions.length, elapsedMs: Math.max(0, monotonicNow() - addStartedAt) }));

    // DELETE тоже проверяется по fingerprint отдельно.
    for (const action of plan.actions.filter(x => x.type === 'delete')) {
      if (APP.abortRequested) throw preflightAbortError();
      try {
        const current = freshByVersion.get(canonicalValue(action.currentRow.versionId));
        if (!current) throw new Error(`Строка ${action.currentRow.versionId} исчезла после предпросмотра.`);
        if (current.fingerprint !== action.expectedFingerprint) throw new Error(`Строка TESSA ${action.currentRow.index + 1} изменилась после предпросмотра.`);
        const dependsOnExcelRows = deleteDependencies.get(action) || [];
        const failedDependencies = dependsOnExcelRows.filter(excelRow => failedMutationRows.has(Number(excelRow)));
        if (failedDependencies.length) {
          throw new Error(`Удаление строки TESSA ${action.currentRow.index + 1} пропущено: связанное изменение Excel ${failedDependencies.join(', ')} не прошло предварительную проверку. Выполните изменение и удаление отдельно на свежей выгрузке.`);
        }
        readyDeletes.push({ action, current, dependsOnExcelRows });
      } catch (error) {
        runtimeSkippedActions.add(action);
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-delete'));
      }
    }

    if (APP.abortRequested) throw preflightAbortError();

    preflightProgress(42,
      skipServerAddValidation ? 'Быстрый Preview завершён' : 'Предварительная проверка завершена',
      skipServerAddValidation
        ? `Локально проверено: ${preparedUpdates.size + preparedAdds.size + readyDeletes.length} · глубокая ADD-проверка будет после разделения пакета`
        : `Готово к записи: ${preparedUpdates.size + preparedAdds.size + readyDeletes.length}`);
    return { bridge, structure, fresh, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips, runtimeSkippedActions, previewPolicy };
  }

  /**
   * Operational write ceiling. XLSX/planner may analyze larger books, but one Apply
   * is intentionally bounded so an accidental bulk edit cannot fire thousands of
   * CardStore/CardRequest calls from a single confirmation.
   */
  function evaluateApplyBatch(actions) {
    const count = (actions || []).filter(action => action?.type && action.type !== 'noop').length;
    const blocked = count > 2000;
    const warning = !blocked && count > 500;
    const reason = blocked
      ? `Пакет содержит ${count} операций. За один Apply разрешено не более 2000 операций; разделите изменения на несколько контролируемых пакетов.`
      : warning
        ? `Большой пакет: ${count} операций. Перед продолжением дополнительно проверьте Preview и подтвердите массовое применение.`
        : null;
    return { count, warning, blocked, reason };
  }

  function applyAvailability(plan, review = null) {
    const reviewed = buildReviewedPlan(plan, review);
    const safety = reviewed?.safety || plan?.safety || { blocked: false, blockedReasons: [] };
    const batch = evaluateApplyBatch(reviewed?.actions || []);
    const safetyReasons = safety.blocked ? [...(safety.blockedReasons || [])] : [];
    const blockedReasons = batch.blocked ? [...safetyReasons, batch.reason].filter(Boolean) : safetyReasons;
    const blocked = Boolean(safety.blocked || batch.blocked);
    const canApply = Boolean(batch.count > 0 && !blocked);
    const label = batch.blocked
      ? `Пакет слишком большой · ${batch.count} / 2000`
      : batch.count
        ? `Применить к TESSA · ${batch.count}`
        : 'Применить к TESSA';
    return {
      count: batch.count,
      warning: batch.warning,
      blocked,
      batchBlocked: batch.blocked,
      canApply,
      reason: batch.blocked ? batch.reason : (blockedReasons[0] || null),
      blockedReasons,
      label,
    };
  }

  function previewPreflightPolicy(actions) {
    const batch = evaluateApplyBatch(actions);
    const skipServerAddValidation = Boolean(batch.blocked);
    const reason = skipServerAddValidation
      ? `Большой локальный Preview: ${batch.count} операций. Пакет всё равно заблокирован для Apply (>2000), поэтому тысячи CardNew/duplicate-запросов для ADD в Preview не выполняются. Разделите пакет до 2000 операций — каждая применяемая часть пройдёт глубокую серверную проверку перед записью.`
      : null;
    return { applyBlocked: batch.blocked, skipServerAddValidation, count: batch.count, reason };
  }

  /**
   * Финализирует отчёт Apply так, чтобы два уровня счётчиков можно было сверить:
   * requested = prepared + preflightSkipped; prepared = applied + storeSkipped + notStarted.
   * sourceSkippedCount относится к строкам Excel, которые planner уже исключил из mutation-plan.
   */
  function isWriterLockError(error) {
    const text = `${error?.message || error || ''} ${error?.code || ''}`.toLowerCase();
    return /obtainwriterlock|writeheartbit|cardislockedbywriter|cardlocktimeoutwhileobtainingwriterlock|locked by writer|writer[- ]lock/.test(text);
  }

  async function refreshNativeMatrixViewAfterApply(bridge, options = {}) {
    if (!bridge || typeof bridge.refreshNativeMatrixView !== 'function') {
      return { ok: false, attempts: 0, reason: 'native-view-refresh-unavailable', error: 'Нативное отображение матрицы недоступно.' };
    }
    const attempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));
    const baseDelayMs = Math.max(0, Number(options.baseDelayMs) || 0);
    let lastError = null;
    for (let index = 0; index < attempts; index += 1) {
      if (index > 0 && baseDelayMs > 0) await sleep(baseDelayMs * (2 ** (index - 1)));
      try {
        const outcome = await bridge.refreshNativeMatrixView();
        if (outcome?.ok === false) throw new Error(outcome.error || outcome.reason || 'Не удалось обновить отображение матрицы.');
        return { ok: true, attempts: index + 1, ...(outcome || {}) };
      } catch (error) {
        lastError = error;
        if (!isWriterLockError(error) || index + 1 >= attempts) break;
        log(`Отображение TESSA ещё занято writer-lock; повторяю refresh (${index + 2}/${attempts}).`, 'warn');
      }
    }
    return {
      ok: false,
      attempts: Math.max(1, Math.min(attempts, attempts)),
      reason: isWriterLockError(lastError) ? 'writer-lock' : 'refresh-failed',
      error: lastError?.message || String(lastError || 'Не удалось обновить отображение матрицы.'),
    };
  }

  /**
   * Финализирует отчёт Apply. Source-skipped строки уже были исключены planner'ом
   * и не являются частью requested mutation-plan, поэтому сами по себе не делают
   * успешный Apply частичным.
   */
  function finalizeApplyResult(result, options = {}) {
    const cancelled = Boolean(options.cancelled ?? result?.cancelled);
    result.appliedCount = (result.rows || []).filter(row => row.status === 'ok').length;
    result.storeSkippedCount = (result.rows || []).filter(row => row.status === 'skipped').length;
    result.failedCount = result.storeSkippedCount;
    result.notStartedCount = Math.max(0, Number(result.plannedCount || 0) - Number(result.startedCount || 0));
    result.skippedCount = (result.skipped || []).length;
    const inferredSourceSkipped = (result.skipped || []).filter(item => item?.phase === 'source' || item?.source === 'excel-validation').length;
    const inferredPreflightSkipped = (result.skipped || []).filter(item => item?.phase === 'preflight').length;
    result.sourceSkippedCount = Math.max(0, Number(result.sourceSkippedCount ?? inferredSourceSkipped) || 0);
    result.preflightSkippedCount = Math.max(0, Number(result.preflightSkippedCount ?? inferredPreflightSkipped) || 0);
    result.cancelled = cancelled;
    result.verificationIncomplete = Boolean(result.verificationIncomplete || result.refreshError);
    const mutationIncomplete = result.verificationIncomplete
      || result.preflightSkippedCount > 0
      || result.storeSkippedCount > 0
      || result.failedCount > 0
      || result.notStartedCount > 0;
    result.status = cancelled ? 'cancelled' : (mutationIncomplete ? 'partial' : 'completed');
    result.partial = result.status !== 'completed';
    result.success = result.status === 'completed';
    return result;
  }

  function applyResultMessage(result) {
    const applied = Math.max(0, Number(result?.appliedCount || 0));
    const requested = Math.max(applied, Number(result?.requestedCount || result?.plannedCount || applied));
    const sourceSkipped = Math.max(0, Number(result?.sourceSkippedCount || 0));
    const preflightSkipped = Math.max(0, Number(result?.preflightSkippedCount || 0));
    const storeSkipped = Math.max(0, Number(result?.storeSkippedCount || 0));
    const notStarted = Math.max(0, Number(result?.notStartedCount || 0));
    if (result?.cancelled || result?.status === 'cancelled') {
      return `Применение остановлено.

Применено: ${applied}
Не начато: ${notStarted}

Уже выполненные записи не откатываются. Перед продолжением используйте свежую проверку TESSA.`;
    }
    if (result?.status === 'completed') {
      const sourceNote = sourceSkipped ? `
Ещё ${sourceSkipped} строк не вошли в Apply и остались без изменений.` : '';
      const refreshNote = result?.viewRefresh?.ok
        ? `\nОтображение TESSA обновлено автоматически.`
        : (result?.viewRefresh && !result.viewRefresh.skipped ? `\nЗапись завершена, но отображение TESSA не удалось обновить автоматически.` : '');
      return `Готово. Применено: ${applied} из ${requested}.
Все подготовленные изменения применены.${sourceNote}${result.skippedFields?.length ? `\nНе применено отдельных полей: ${result.skippedFields.length}. Причины указаны в отчёте.` : ''}${refreshNote}
Перед следующим Apply нужна свежая проверка или свежая выгрузка Excel.`;
    }
    const mutationSkipped = preflightSkipped + storeSkipped;
    return `Применение завершено частично.

Применено: ${applied} из ${requested}
Не применено после проверки: ${mutationSkipped}
Не начато: ${notStarted}${sourceSkipped ? `
Отдельно не вошли в Apply: ${sourceSkipped}` : ''}

Перед следующим Apply выполните свежую проверку.`;
  }

  /**
   * Применяет только заранее построенный и прошедший preflight план.
   * Каждая операция верифицируется отдельно; при частичной ошибке остальные строки
   * не маскируются как успешные, а результат сохраняется в JSON-отчёт.
   */
  async function applyPlan(plan) {
    if (!plan) throw new Error('Сначала проверьте Excel.');
    if (plan?.safety?.blocked) throw new Error(`Файл нельзя применить: ${plan.safety.blockedReasons.join(' ')}`);
    const executable = (plan.actions || []).filter(action => action.type !== 'noop');
    if (!executable.length) throw new Error(plan.skippedRows?.length ? 'Нет корректных изменений для применения: все изменяемые строки будут пропущены.' : 'Изменений для применения нет.');
    const batch = evaluateApplyBatch(executable);
    if (batch.blocked) throw new Error(batch.reason);
    if (batch.warning) {
      const okBatch = window.confirm(`${batch.reason}

Продолжить?`);
      if (!okBatch) return null;
    }
    if (plan.actions.some(a => a.match?.lowConfidence)) {
      const okLow = window.confirm('Есть строки с низкой уверенностью сопоставления. Продолжить после проверки предпросмотра?');
      if (!okLow) return null;
    }
    const c = plan.counts;
    const ok = window.confirm(`Применить корректные изменения к TESSA?\n\nИзменить: ${c.update}\nДобавить: ${c.add}\nУдалить: ${c.delete}\nПропустить: ${c.skip || 0}${plan.skippedFields?.length ? `\nОставить без изменения отдельных полей: ${plan.skippedFields.length}` : ''}\n\nОшибочные строки и указанные в Preview поля не будут применены.`);
    if (!ok) return null;
    APP.abortRequested = false;
    APP.lastMutationReceipts = null;
    APP.lastReconciliation = null;
    let preflight;
    try {
      preflight = await preflightPlan(plan);
    } catch (error) {
      if (!isPreflightAbortError(error)) throw error;
      const result = {
        planId: plan.id,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        rows: [],
        skipped: [...(plan.skippedRows || [])],
        skippedFields: [...(plan.skippedFields || [])],
        success: false,
        partial: true,
        status: 'cancelled',
        cancelled: true,
        sourceSkippedCount: (plan.skippedRows || []).length,
        preflightSkippedCount: 0,
        requestedCount: executable.length,
        plannedCount: executable.length,
        startedCount: 0,
        appliedCount: 0,
        skippedCount: 0,
        storeSkippedCount: 0,
        failedCount: 0,
        notStartedCount: executable.length,
        verificationIncomplete: false,
        refreshError: null,
      };
      finalizeApplyResult(result, { cancelled: true });
      log(`Предварительная проверка остановлена. Запись в TESSA не начиналась; не начато: ${result.notStartedCount}.`, 'warn');
      rememberReport(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      setProgress(100, 'Применение остановлено', `Запись не начиналась · не начато: ${result.notStartedCount}`);
      return result;
    }
    const { bridge, structure, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips } = preflight;
    const totalToStore = preparedUpdates.size + preparedAdds.size + readyDeletes.length;
    let storedCount = 0;
    const tickStoreProgress = label => {
      storedCount += 1;
      const percent = totalToStore ? 42 + Math.round((storedCount / totalToStore) * 52) : 94;
      setProgress(percent, label, `${storedCount} из ${Math.max(1, totalToStore)}`);
    };
    setProgress(44, 'Применяю изменения', totalToStore ? `0 из ${totalToStore}` : 'Нет строк для записи');
    const successfulMutationRows = new Set();
    const receipts = [];
    const result = {
      planId: plan.id,
      startedAt: nowIso(),
      finishedAt: null,
      rows: [],
      skipped: [...(plan.skippedRows || []), ...runtimeSkips],
      skippedFields: [...(plan.skippedFields || [])],
      success: false,
      partial: false,
      status: 'running',
      cancelled: false,
      sourceSkippedCount: (plan.skippedRows || []).length,
      preflightSkippedCount: runtimeSkips.length,
      requestedCount: executable.length,
      plannedCount: totalToStore,
      startedCount: 0,
      appliedCount: 0,
      skippedCount: 0,
      storeSkippedCount: 0,
      failedCount: 0,
      notStartedCount: totalToStore,
      verificationIncomplete: false,
      refreshError: null,
    };
    let cancelled = false;
    const shouldStopBeforeNextMutation = () => {
      if (!APP.abortRequested) return false;
      cancelled = true;
      result.cancelled = true;
      return true;
    };

    for (const prepared of preparedUpdates.values()) {
      if (shouldStopBeforeNextMutation()) break;
      result.startedCount += 1;
      const action = prepared.action;
      try {
        log(`Обновляю строку Excel ${action.excelRow.excelRow}`);
        const expectedRow = typeof bridge.readMatrixRowFromCard === 'function'
          ? bridge.readMatrixRowFromCard(prepared.card, {
            index: prepared.current.index,
            rowCardId: prepared.current.rowCardId,
            versionId: prepared.current.versionId,
            rowName: prepared.current.rowName,
            source: 'apply-expected-update',
          }, structure)
          : null;
        await bridge.storeRowCard(prepared.card);
        if (expectedRow) receipts.push(createMutationReceipt({
          type: 'update', action,
          rowCardId: prepared.current.rowCardId,
          versionId: prepared.current.versionId,
          expectedRow, structure,
        }));
        successfulMutationRows.add(Number(action.excelRow.excelRow));
        result.rows.push({ type: 'update', excelRow: action.excelRow.excelRow, versionId: prepared.current.versionId, status: 'ok' });
      } catch (error) {
        const skipped = runtimeSkip(action, error, 'store-update');
        result.skipped.push(skipped);
        result.rows.push({ type: 'update', excelRow: action.excelRow.excelRow, status: 'skipped', reason: skipped.reason });
      }
      tickStoreProgress(isOverwriteMatch(action.match) ? 'Заменяю строки' : 'Обновляю строки');
    }

    if (!cancelled) for (const created of preparedAdds.values()) {
      if (shouldStopBeforeNextMutation()) break;
      result.startedCount += 1;
      const action = created.action;
      try {
        log(`Добавляю строку Excel ${action.excelRow.excelRow}`);
        const expectedRow = typeof bridge.readMatrixRowFromCard === 'function'
          ? bridge.readMatrixRowFromCard(created.card, {
            index: -1,
            rowCardId: created.cardId,
            versionId: created.versionId,
            rowName: `Excel ${action.excelRow.excelRow}`,
            source: 'apply-expected-add',
          }, structure)
          : null;
        // Re-check immediately before Store: another session may have created the
        // same matrix row after preflight completed.
        await bridge.validateDuplicate(created.card, created.versionId);
        const storeResponse = await bridge.storeRowCard(created.card);
        const storedCardId = String(storeResponse?.cardId || created.cardId);
        const verification = await bridge.tryGetCard(storedCardId);
        if (verification.error || !verification.card) throw new Error(`Новая карточка строки ${storedCardId} не открывается после сохранения.`);
        if (expectedRow) receipts.push(createMutationReceipt({
          type: 'add', action,
          rowCardId: storedCardId,
          versionId: created.versionId,
          expectedRow, structure,
        }));
        successfulMutationRows.add(Number(action.excelRow.excelRow));
        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, rowCardId: storedCardId, versionId: created.versionId, newMethod: created.newMethod, verifiedByCardGet: true, status: 'ok' });
      } catch (error) {
        const skipped = runtimeSkip(action, error, 'store-add');
        result.skipped.push(skipped);
        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, status: 'skipped', reason: skipped.reason });
      }
      tickStoreProgress('Добавляю строки');
    }

    if (!cancelled) for (const prepared of readyDeletes) {
      if (shouldStopBeforeNextMutation()) break;
      result.startedCount += 1;
      const action = prepared.action;
      try {
        const missingDependencies = (prepared.dependsOnExcelRows || [])
          .filter(excelRow => !successfulMutationRows.has(Number(excelRow)));
        if (missingDependencies.length) {
          throw new Error(`Удаление строки TESSA ${action.currentRow.index + 1} пропущено: связанное изменение Excel ${missingDependencies.join(', ')} не было успешно применено. Исходная строка сохранена.`);
        }
        // DeleteRow is a custom request without CardStoreRequest.AffectVersion.
        // Read only the target card immediately before deletion instead of reloading the whole matrix.
        const deleteCard = await bridge.getCard(prepared.current.rowCardId);
        const deleteTarget = bridge.readMatrixRowFromCard(deleteCard, {
          index: prepared.current.index,
          rowCardId: prepared.current.rowCardId,
          versionId: prepared.current.versionId,
          rowName: prepared.current.rowName,
          source: 'targeted-delete-recheck',
        }, structure);
        if (canonicalValue(deleteTarget.versionId) !== canonicalValue(prepared.current.versionId)
          || canonicalValue(deleteTarget.fingerprint) !== canonicalValue(prepared.current.fingerprint)) {
          throw new Error(`Удаление строки TESSA ${action.currentRow.index + 1} пропущено: строка изменилась после предварительной проверки. Обновите Excel и проверьте изменения заново.`);
        }
        log(`Удаляю строку TESSA ${action.currentRow.index + 1}`);
        await bridge.deleteMatrixRow(action.currentRow.versionId);
        receipts.push(createMutationReceipt({
          type: 'delete', action,
          rowCardId: prepared.current.rowCardId,
          versionId: prepared.current.versionId,
          expectedRow: null, structure,
        }));
        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'ok' });
      } catch (error) {
        const skipped = runtimeSkip(action, error, 'store-delete');
        result.skipped.push(skipped);
        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'skipped', reason: skipped.reason });
      }
      tickStoreProgress('Удаляю строки');
    }

    result.viewRefresh = { ok: false, skipped: true, reason: 'not-attempted' };
    if (!cancelled && result.startedCount > 0) {
      setProgress(96, 'Обновляю отображение TESSA', 'Только представление матрицы · без перезагрузки карточки');
      result.viewRefresh = await refreshNativeMatrixViewAfterApply(bridge, { attempts: 3, baseDelayMs: 450 });
      if (result.viewRefresh.ok) {
        log(`Отображение TESSA обновлено автоматически${result.viewRefresh.controlName ? `: ${result.viewRefresh.controlName}` : ''}.`);
      } else {
        log(`Запись завершена, но отображение TESSA не обновилось автоматически: ${result.viewRefresh.error || result.viewRefresh.reason}.`, 'warn');
      }
    } else {
      setProgress(96, cancelled ? 'Фиксирую остановленную операцию' : 'Завершаю применение',
        cancelled ? 'Сохраняю точную границу выполненных операций' : 'Запись завершена');
    }
    result.finishedAt = nowIso();
    finalizeApplyResult(result, { cancelled });
    APP.lastMutationReceipts = result.startedCount > 0 ? {
      planId: plan.id,
      matrixId: plan.matrixId,
      templateId: structure.templateId,
      receipts,
      createdAt: nowIso(),
    } : null;
    const resultLevel = result.partial ? 'warn' : 'info';
    log(`Готово. Статус: ${result.status}; применено: ${result.appliedCount}; пропущено: ${result.skippedCount}; не начато: ${result.notStartedCount}.`, resultLevel);
    rememberReport(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const progressLabel = cancelled
      ? 'Применение остановлено'
      : result.partial
        ? 'Применение завершено частично'
        : `Применено ${result.appliedCount} из ${Math.max(result.appliedCount, Number(result.requestedCount || result.plannedCount || result.appliedCount))}`;
    const progressParts = [];
    if (result.preflightSkippedCount || result.storeSkippedCount) progressParts.push(`не применено: ${result.preflightSkippedCount + result.storeSkippedCount}`);
    if (result.sourceSkippedCount) progressParts.push(`не вошли в Apply: ${result.sourceSkippedCount}`);
    if (result.skippedFields?.length) progressParts.push(`не применяются поля: ${result.skippedFields.length}`);
    if (result.notStartedCount) progressParts.push(`не начато: ${result.notStartedCount}`);
    if (result.viewRefresh?.ok) progressParts.push('отображение TESSA обновлено');
    else if (result.viewRefresh && !result.viewRefresh.skipped) progressParts.push('отображение можно обновить кнопкой ниже');
    setProgress(100, progressLabel, progressParts.join(' · ') || 'Готово');
    return result;
  }

  function downloadJson(value, name, replacer = jsonReplacer) {
    const blob = new Blob([JSON.stringify(value, replacer, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Отчёты храним в памяти вкладки. Файл создаётся только по явному клику пользователя.
  function rememberReport(value, name) {
    APP.lastReport = { value, name };
    const button = document.querySelector?.('#tms-download-report');
    if (button) {
      button.hidden = false;
      setControlDisabled(button, false);
      button.title = name || 'Скачать последний диагностический отчёт';
    }
    return APP.lastReport;
  }

  function downloadLastReport() {
    if (!APP.lastReport?.value) return false;
    downloadJson(APP.lastReport.value, APP.lastReport.name || `TESSA_Matrix_Report_${Date.now()}.json`);
    return true;
  }

  function updateIntervalDiagnosticControlState() {
    const available = Boolean(APP.plan && APP.workbook && APP.snapshot
      && APP.plan.skippedRows?.some(row => row.code === 'duplicate-interval-extractor'));
    const container = document.querySelector?.('#tms-interval-tool');
    if (container) container.hidden = !available;
    const button = document.querySelector?.('#tms-interval-diagnostics');
    if (button) {
      setControlDisabled(button, !available);
      button.textContent = APP.lastIntervalDiagnostics ? 'Скачать диагностику' : 'Диагностика интервалов';
    }
  }

  // Read-only interval diagnostics may test one structural marker at a time on the
  // detached outgoing duplicate-check storage. The SDK Card itself is never mutated.
  function applyIntervalStructuralProbe(cardStorage, mode) {
    const modes = new Set(['clear-interval-changed', 'clear-interval-state', 'clear-interval-markers']);
    if (!modes.has(mode)) throw new Error(`Неизвестный режим структурной диагностики: ${mode}`);

    const sections = cardStorage?.Sections || cardStorage?.sections || {};
    const section = sections?.[S.Values];
    const rows = section?.Rows || section?.rows || [];
    for (const row of rows) {
      const data = row?.data && typeof row.data === 'object' ? row.data : row;
      if (!data || typeof data !== 'object') continue;
      const hasFrom = Object.prototype.hasOwnProperty.call(data, F.IntValue);
      const hasTo = Object.prototype.hasOwnProperty.call(data, F.IntToValue);
      if (!hasFrom && !hasTo) continue;

      if (mode === 'clear-interval-changed' || mode === 'clear-interval-markers') {
        delete row['.changed'];
        delete row.changed;
        if (data !== row) { delete data['.changed']; delete data.changed; }
      }
      if (mode === 'clear-interval-state' || mode === 'clear-interval-markers') {
        delete row['.state'];
        delete row.state;
        if (data !== row) { delete data['.state']; delete data.state; }
      }
    }
    return cardStorage;
  }

  // Explicit, bounded diagnosis of the unresolved interval error. This collector
  // does not use preflightPlan/applyPlan and never returns an executable plan.
  // CardNew prepares an in-memory card; the only business request is the same
  // duplicate check. Store/Delete and automatic retries are deliberately absent.
  async function collectIntervalDiagnostics({ bridge, workbook, structure, snapshot, failedRows, assertContext }) {
    if (typeof assertContext !== 'function') throw new Error('Не задана проверка контекста диагностики.');
    const report = {
      format: 'TESSA_INTERVAL_DIAGNOSTICS_V1', studioVersion: APP.version,
      startedAt: nowIso(), matrixId: snapshot.matrixId, templateId: structure.templateId,
      writesAttempted: 0, containsBusinessData: true, samples: [],
      note: 'Сравнение запросов, не применение. saved-original — CardGet без перестройки Studio; это не запуск штатного редактора.',
    };
    // Serialize storage snapshots, never service objects, browser storage or
    // HTTP headers. Bound each sample so an unusual server response cannot
    // produce an unlimited diagnostic attachment. Nothing is sent elsewhere.
    const copyStorage = value => {
      const text = JSON.stringify(value);
      if (!text || new TextEncoder().encode(text).byteLength > 2_000_000) throw new Error('Размер данных диагностики превышает 2 МБ на образец.');
      return JSON.parse(text);
    };
    report.structureFromPreview = copyStorage(structure);
    const failed = new Set((failedRows || []).filter(row => row.code === 'duplicate-interval-extractor').map(row => Number(row.excelRow)));
    const plan = buildPlan(workbook, structure, snapshot);
    const candidates = plan.actions.filter(action => action.type === 'add' && failed.has(Number(action.excelRow.excelRow))).slice(0, 2);
    report.candidateRows = candidates.map(action => action.excelRow.excelRow);
    if (!candidates.length) throw new Error('Нет отклонённых добавлений для диагностики. Выполните новую проверку Excel.');

    const probe = async (kind, card, versionId, excelRow = null) => {
      await assertContext();
      const sample = { kind, excelRow, versionId, requestSent: false };
      report.samples.push(sample);
      const reader = Object.create(bridge);
      // A local facade captures the real validateDuplicate contract without
      // replacing the shared CardService or changing normal Apply behaviour.
      reader.cardService = { request: async req => {
        await assertContext();
        if (canonicalValue(req.requestType) !== canonicalValue(REQUEST.ValidateDuplicate)) {
          throw new Error('Диагностика допускает только запрос проверки дубликатов.');
        }
        sample.request = copyStorage(req.getStorage?.() || { requestType: req.requestType, info: req.info });
        sample.requestSent = true;
        const response = await bridge.cardService.request(req);
        try {
          sample.response = copyStorage(response.getStorage?.() || {
            info: response.tryGetInfo?.() || response.info || {},
            validation: { isSuccessful: response.validationResult?.isSuccessful },
          });
        } catch (error) { sample.captureError = String(error.message || error).slice(0, 1000); }
        return response;
      } };
      try {
        await reader.validateDuplicate(card, versionId);
        sample.outcome = 'allowed';
      } catch (error) {
        sample.outcome = sample.requestSent ? 'rejected' : 'not-sent';
        sample.code = error.code || 'diagnostic-check-failed';
        sample.message = String(error.message || error).slice(0, 20000);
      }
      await assertContext();
    };

    // Pick an existing interval row close to the first candidate. Similarity is
    // used only for this read-only control sample, never for identity or Apply.
    const intervalIds = structure.conditions.filter(condition => ['Int', 'Decimal'].includes(operandKind(condition))).map(condition => condition.criterionRowId);
    const controls = snapshot.rows.filter(row => row.rowCardId && intervalIds.some(id =>
      row.values?.[id]?.some(value => value.to !== null && value.to !== undefined)));
    const desired = candidates[0].excelRow;
    const score = row => Object.keys(desired.flat || {}).reduce((n, key) => n + Number(arraysEqual(row.flat?.[key] || [], desired.flat[key] || [])), 0);
    let control = null, bestScore = -1;
    for (const row of controls) {
      const candidateScore = score(row);
      if (candidateScore > bestScore) { control = row; bestScore = candidateScore; }
    }
    try {
      await assertContext();
      if (control) {
        const original = await bridge.getCard(control.rowCardId);
        await assertContext();
        const current = bridge.readMatrixRowFromCard(original, control, structure);
        await probe('saved-original', original, control.versionId);
        if (typeof original.clone === 'function') {
          const columns = buildColumnMap(workbook, structure).columns;
          const ids = {};
          for (const column of columns.values()) {
            const values = column.kind === 'function' ? current.roles[column.id] : current.values[column.id];
            ids[column.key] = (values || []).map(value => column.kind === 'function'
              ? `${value.id}|${value.roleTypeId}` : value.id == null ? '' : String(value.id));
          }
          const rebuilt = original.clone();
          bridge.rebuildRowCard(rebuilt, control.versionId, { excelRow: 0, columns, flat: clonePlain(current.flat), ids }, structure, snapshot);
          const after = bridge.readMatrixRowFromCard(rebuilt, control, structure);
          if (reconciliationSemanticKey(current, structure) !== reconciliationSemanticKey(after, structure)) {
            report.samples.push({ kind: 'saved-rebuilt', outcome: 'not-sent', code: 'rebuilt-control-differs' });
          } else await probe('saved-rebuilt', rebuilt, control.versionId);
        } else report.samples.push({ kind: 'saved-rebuilt', outcome: 'not-sent', code: 'card-clone-unavailable' });
      } else report.samples.push({ kind: 'saved-original', outcome: 'not-sent', code: 'saved-interval-row-unavailable' });
      for (const action of candidates) {
        await assertContext();
        const created = await bridge.createRowCard(structure.templateId);
        await assertContext();
        bridge.rebuildRowCard(created.card, created.versionId, action.excelRow, structure, snapshot);
        await probe('proposed-add', created.card, created.versionId, action.excelRow.excelRow);
      }
    } catch (error) {
      report.interrupted = true;
      report.interruptionReason = String(error.message || error).slice(0, 1000);
    }
    report.finishedAt = nowIso();
    return report;
  }

  async function runIntervalDiagnostics() {
    if (APP.busy || !APP.plan || !APP.workbook || !APP.snapshot || !APP.structure) return;
    const { plan, workbook, snapshot, structure } = APP;
    if (!plan.skippedRows?.some(row => row.code === 'duplicate-interval-extractor')) return;
    APP.abortRequested = false;
    setBusy(true);
    try {
      const assertContext = async () => {
        if (APP.abortRequested) throw new Error('Диагностика остановлена пользователем.');
        if (APP.plan !== plan || APP.workbook !== workbook) throw new Error('Выбранный файл или проверка изменились.');
        const current = await TessaBridge.create();
        if (canonicalValue(current.mainCard.id) !== canonicalValue(plan.matrixId)
          || canonicalValue(current.templateId()) !== canonicalValue(structure.templateId)) {
          throw new Error('Открытая матрица или шаблон изменились. Диагностика остановлена.');
        }
      };
      await assertContext();
      if (APP.lastIntervalDiagnostics) {
        // Unlike the public support summary, this opt-in diagnostic intentionally
        // retains request.info.card. Keep the normal report's replacer unchanged.
        downloadJson(APP.lastIntervalDiagnostics.value, APP.lastIntervalDiagnostics.name, null);
        return;
      }
      const bridge = await TessaBridge.create();
      setProgress(20, 'Диагностика интервалов', 'Сравниваю запросы без сохранения строк');
      const result = await collectIntervalDiagnostics({ bridge, workbook, structure, snapshot, failedRows: plan.skippedRows, assertContext });
      const name = `TESSA_Interval_Diagnostics_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      if (!result.interrupted) APP.lastIntervalDiagnostics = { value: result, name };
      downloadJson(result, name, null);
      setProgress(100, result.interrupted ? 'Диагностика прервана' : 'Диагностика готова',
        result.interrupted ? result.interruptionReason : 'Файл скачан. Запись в TESSA не выполнялась.');
    } catch (error) {
      setProgress(100, 'Диагностика не выполнена', friendlyErrorMessage(error));
    } finally {
      setBusy(false);
      updateIntervalDiagnosticControlState();
    }
  }

  // Diagnostics runs on a separate bridge and never returns an Apply plan.
  // Explicit allowlists protect the test path if ordinary bridge code changes.
  // Capture only selected business data, never page HTML, browser storage,
  // HTTP headers, credentials or arbitrary application objects.
  async function collectStudioDiagnostics({ connect, probe, file = null, workbook = null, previous = {}, assertContext, onProgress = () => {}, limits = {} }) {
    if (typeof assertContext !== 'function') throw new Error('Не задан контроль контекста диагностики.');
    const bounds = { calls: 2000, candidates: 20, bytes: 48 * 1024 * 1024, itemBytes: 8 * 1024 * 1024, requestMs: 20000, ...limits };
    const report = {
      format: 'TESSA_STUDIO_DIAGNOSTICS_V1', studioVersion: APP.version, startedAt: nowIso(),
      scope: 'read-only', writesAttempted: 0, blockedWrites: 0, containsBusinessData: true,
      checks: [], captures: [], omitted: [], calls: [],
      notTested: ['Сохранение и удаление строк', 'Серверные транзакции и обработчики Store', 'Параллельная запись другого пользователя', 'Действия в штатном редакторе'],
    };
    const entries = [];
    const pending = new Set();
    let capturedBytes = 0, stopped = false, callCount = 0;
    const message = error => String(error?.message || error).slice(0, 20000);
    const capture = (name, value, raw = false) => {
      try {
        const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value, (key, item) => {
          if (key === 'expectedSemanticKey') return undefined;
          return raw ? item : jsonReplacer(key, item);
        }, 2));
        if (!bytes || bytes.length > bounds.itemBytes || capturedBytes + bytes.length > bounds.bytes) throw new Error('Лимит размера пакета');
        entries.push([name, bytes]); capturedBytes += bytes.length;
        report.captures.push({ name, bytes: bytes.length });
      } catch (error) { report.omitted.push({ name, reason: message(error) }); }
    };
    const guard = async () => {
      if (stopped) throw new Error('Проверки остановлены.');
      try { await assertContext(); } catch (error) { stopped = true; report.interrupted = message(error); throw error; }
    };
    const run = async (id, title, work, dependency = true) => {
      const check = { id, title, status: 'running', startedAt: nowIso() };
      report.checks.push(check); onProgress(report);
      if (!dependency || stopped) {
        check.status = 'not-run'; check.detail = stopped ? 'Прогон остановлен.' : 'Нет необходимых данных.';
      } else {
        try {
          await guard();
          const result = await work();
          await guard();
          Object.assign(check, { status: 'pass', ...result });
        } catch (error) {
          check.status = 'fail'; check.detail = message(error); check.code = error.code || 'check-failed';
        }
      }
      check.finishedAt = nowIso(); onProgress(report);
      return check.status === 'pass';
    };
    const performRpc = async (kind, request, invoke) => {
      await guard();
      if (++callCount > bounds.calls) { stopped = true; report.interrupted = 'Достигнут лимит запросов диагностики.'; throw new Error(report.interrupted); }
      const call = { index: callCount, kind, startedAt: nowIso() };
      report.calls.push(call);
      const prefix = `requests/${String(call.index).padStart(4, '0')}`;
      capture(`${prefix}-request.json`, request?.getStorage?.() || request, true);
      let timer;
      try {
        const response = await Promise.race([
          Promise.resolve().then(invoke),
          new Promise((_, reject) => { timer = setTimeout(() => {
            stopped = true; report.interrupted = 'Сервер не ответил вовремя. Следующие запросы остановлены.';
            reject(new Error(report.interrupted));
          }, bounds.requestMs); }),
        ]);
        call.status = 'returned';
        // CardGet/CardNew mock fallback is explicit; never serialize services.
        capture(`${prefix}-response.json`, response?.getStorage?.() || {
          info: response?.tryGetInfo?.() || response?.info,
          card: response?.card?.getStorage?.(),
          validation: { successful: response?.validationResult?.isSuccessful },
          ...(kind === 'view' ? { result: response } : {}),
        }, true);
        await guard();
        return response;
      } catch (error) { stopped = true; report.interrupted ||= message(error); call.status = 'failed'; call.error = message(error); throw error; }
      finally { clearTimeout(timer); call.finishedAt = nowIso(); }
    };
    const rpc = (...args) => {
      const task = performRpc(...args); pending.add(task);
      task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    };
    const forbidden = () => { report.blockedWrites++; throw new Error('Запись запрещена в разделе проверок.'); };
    let bridge, structure, snapshot, catalog, generated, selected = file ? null : workbook, plan;
    const connected = await run('connection', 'Подключение к матрице', async () => {
      bridge = await connect();
      report.matrixId = String(bridge.mainCard.id); report.templateId = String(bridge.templateId() || '');
      if (!report.templateId) throw new Error('Не найдена матрица с шаблоном.');
      const real = bridge, reader = Object.create(real);
      reader.cardService = {
        get: req => rpc('CardGet', req, () => real.cardService.get(req)),
        request: req => {
          if (![REQUEST.Structure, REQUEST.ValidateDuplicate].some(id => canonicalValue(id) === canonicalValue(req.requestType))) return forbidden();
          return rpc('CardRequest', req, () => real.cardService.request(req));
        },
        store: forbidden, delete: forbidden,
      };
      for (const name of ['new', 'create']) if (typeof real.cardService[name] === 'function') {
        reader.cardService[name] = req => rpc('CardNew', req, () => real.cardService[name](req));
      }
      reader.storeRowCard = forbidden; reader.deleteMatrixRow = forbidden;
      reader.queryViewSample = (alias, maxRows) => rpc('view', { alias, maxRows },
        () => real.queryViewSample.call(reader, alias, maxRows, { forceRefresh: true, throwOnError: true }));
      reader.collectNativeMatrixViewLinksAllPages = async () => {
        await guard();
        const native = await real.collectNativeMatrixViewLinksAllPages.call(reader, { assertContext: guard });
        await guard(); capture('native-matrix-view.json', native);
        return native;
      };
      bridge = reader;
      return { detail: 'Матрица определена. Запись для этого прогона запрещена.' };
    });
    await run('capabilities', 'Возможности текущей TESSA', async () => {
      const value = evaluateRuntimeCapabilities(await probe()); capture('capabilities.json', value);
      return { status: value.overall === 'ready' ? 'pass' : value.overall === 'limited' ? 'not-run' : 'fail', detail: humanCapabilityBlocker([...value.blockers, ...value.warnings].map(x => x.code || x)) || 'Доступные API проверены.' };
    });
    await run('input-rules', 'Правила ввода: числа, интервалы, Да/Нет', async () => {
      const cases = [
        ['Нулевое число', () => parseRange('0', 'Int').value === 0],
        ['Интервал', () => { const v = parseRange('2..17', 'Int'); return v.value === 2 && v.to === 17; }],
        ['Отрицательный интервал', () => { const v = parseRange('-15..-4', 'Int'); return v.value === -15 && v.to === -4; }],
        ['Дробный интервал', () => { const v = parseRange('1,5..4,25', 'Decimal'); return v.value === 1.5 && v.to === 4.25; }],
        ['Да', () => parseBoolean('Да') === true], ['Нет', () => parseBoolean('Нет') === false],
        ['Обратный интервал', () => { try { parseRange('15..4', 'Int'); return false; } catch (_) { return true; } }],
        ['Дробь в целом числе', () => { try { parseRange('4.5', 'Int'); return false; } catch (_) { return true; } }],
        ['Переполнение целого числа', () => { try { parseRange('2147483648', 'Int'); return false; } catch (_) { return true; } }],
        ['Текст вместо числа', () => { try { parseRange('4oops', 'Int'); return false; } catch (_) { return true; } }],
        ['Неизвестное Да/Нет', () => { try { parseBoolean('НЕИЗВЕСТНО'); return false; } catch (_) { return true; } }],
        ['Формулы во всех типах ячеек', () => ['String', 'Int', 'Decimal', 'Boolean', 'Date', 'DateTime', 'Guid'].every(kind => Boolean(excelCoercionIssue(kind, '1', { hasFormula: true })))],
        ['Число, превращённое Excel в дату', () => Boolean(excelAutoDateIssue('Int', '46000', { rawType: 'n', numberFormatKind: 'date' }))],
        ['Текст, превращённый Excel в число', () => Boolean(excelCoercionIssue('String', '123', { rawType: 'n' }))],
      ].map(([title, test]) => ({ title, passed: test() }));
      capture('input-rules.json', cases);
      if (cases.some(c => !c.passed)) throw new Error('Не прошла встроенная проверка правил ввода.');
      return { detail: `${cases.length} проверок пройдено. Остальные типы проверяются на данных матрицы.` };
    });
    if (file) await run('file-read', 'Чтение выбранного Excel', async () => {
      if (file.size > XLSX_ARCHIVE_LIMITS.MaxInputBytes) throw new Error('Выбранный Excel превышает лимит размера.');
      const buffer = await file.arrayBuffer(); capture('selected.xlsx', new Uint8Array(buffer));
      selected = await readXlsxArrayBuffer(buffer, file.name);
      return { detail: `${selected.rows.length} строк; ${selected.headers.filter(Boolean).length} столбцов.` };
    });
    const schemaOk = await run('schema', 'Свежая структура матрицы', async () => {
      structure = await bridge.requestStructure(report.templateId); capture('structure.json', structure);
      return { detail: `${structure.conditions.length} критериев; ${structure.functions.length} функций.` };
    }, connected);
    // Configuration cards are evidence only: never replace the editor's card or
    // infer permission to change the template from permission to read it.
    for (const [name, id, title] of [['matrix', report.matrixId, 'Настройки матрицы'], ['template', report.templateId, 'Настройки шаблона']]) {
      await run(`${name}-settings`, title, async () => {
        const card = await bridge.getCard(id);
        if (!card?.getStorage) throw new Error('TESSA не вернула хранилище карточки.');
        capture(`${name}-card.json`, card.getStorage(), true);
        return { detail: 'Карточка прочитана; настройки не менялись.' };
      }, connected);
    }
    const snapshotOk = await run('snapshot', 'Чтение всех строк матрицы', async () => {
      snapshot = await bridge.loadSnapshot(structure);
      capture('snapshot.json', snapshot);
      const rowIds = new Set(), versionIds = new Set();
      for (const row of snapshot.rows) {
        if (!row.rowCardId || !row.versionId || rowIds.has(canonicalValue(row.rowCardId)) || versionIds.has(canonicalValue(row.versionId))) throw new Error('Пустые или повторяющиеся идентификаторы строк.');
        rowIds.add(canonicalValue(row.rowCardId)); versionIds.add(canonicalValue(row.versionId));
      }
      return { detail: `${snapshot.rows.length} строк прочитано. Идентификаторы уникальны.` };
    }, schemaOk);
    await run('dictionaries', 'Чтение справочников', async () => {
      catalog = await bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh: true, transient: true });
      // Search text is reproducible. Shard large reference data so one large
      // dictionary cannot discard every catalog from a diagnostic package.
      capture('dictionaries.json', { columnCatalogIds: catalog.columnCatalogIds, stats: catalog.stats, catalogs: Object.fromEntries(Object.entries(catalog.catalogs).map(([id,c]) => [id, { id, label:c.label, sourceView:c.sourceView, projection:c.projection, sourceCount:c.sourceCount, entries:c.entries.length }])) });
      let dictionaryIndex = 0;
      for (const [id, dictionary] of Object.entries(catalog.catalogs)) {
        dictionaryIndex++;
        for (let offset = 0; offset < dictionary.entries.length; offset += 500) capture(`dictionaries/${dictionaryIndex}-${offset}.json`, { id, offset, entries: dictionary.entries.slice(offset, offset + 500).map(({ searchText, ...entry }) => entry) });
      }
      return { status: catalog.stats.errors?.length ? 'fail' : 'pass', detail: catalog.stats.errors?.join('\n') || `${catalog.stats.entries} значений в ${catalog.stats.catalogs} справочниках.` };
    }, snapshotOk);
    const roundtripOk = await run('roundtrip', 'Выгрузка и обратное чтение всех полей', async () => {
      const bytes = await createRoundtripXlsxBytes(structure, snapshot, bridge.matrixInfo(), catalog);
      capture('matrix-current.xlsx', bytes);
      generated = await readXlsxArrayBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const roundtrip = buildPlan(generated, structure, snapshot);
      capture('roundtrip.json', { counts: roundtrip.counts, safety: roundtrip.safety, skippedRows: roundtrip.skippedRows, skippedFields: roundtrip.skippedFields });
      if (roundtrip.safety?.blocked || roundtrip.counts.skip || roundtrip.skippedFields?.length || roundtrip.actions.some(a => a.type !== 'noop') || roundtrip.actions.length !== snapshot.rows.length) throw new Error('Выгрузка и обратное чтение дали расхождения. Подробности в пакете.');
      return { detail: `${snapshot.rows.length} строк × ${structure.conditions.length + structure.functions.length} полей: расхождений нет.` };
    }, snapshotOk);
    await run('selected-plan', 'Изменения и ошибки выбранного Excel', async () => {
      capture('selected-workbook.json', { fileName: selected.fileName, sheetName: selected.sheetName, headers: selected.headers, schemaTokens: selected.schemaTokens, roundtrip: selected.roundtrip, rows: selected.rows });
      plan = buildPlan(selected, structure, snapshot); capture('selected-plan.json', compactPlanForExport(plan));
      return { status: plan.safety?.blocked || plan.counts.skip || plan.skippedFields?.length ? 'fail' : 'pass', detail: `Изменить: ${plan.counts.update}; добавить: ${plan.counts.add}; удалить: ${plan.counts.delete}; пропустить: ${plan.counts.skip}; ошибочных полей: ${plan.skippedFields?.length || 0}.` };
    }, Boolean(snapshotOk && selected));

    const columns = roundtripOk ? buildColumnMap(generated, structure).columns : null;
    const desiredFromRow = row => {
      const ids = {};
      for (const column of columns.values()) {
        const items = column.kind === 'function' ? row.roles[column.id] : row.values[column.id];
        ids[column.key] = (items || []).map(value => column.kind === 'function' ? `${value.id}|${value.roleTypeId}` : value.id == null ? '' : String(value.id));
      }
      return { excelRow: 0, columns, flat: clonePlain(row.flat), ids };
    };
    if (catalog) for (const [id, dictionary] of Object.entries(catalog.catalogs)) {
      await run(`catalog-${id}`, `Справочник: ${dictionary.label || 'Значения'}`, async () => {
        const lookup = dictionaryLookup(dictionary);
        const bad = (dictionary.entries || []).filter(entry => !entry.display || isGuidLike(entry.display) || /^\$[A-Za-z0-9_.-]+$/.test(entry.display));
        if (bad.length) throw new Error(`Технических или пустых названий: ${bad.length}.`);
        const columnKey = Object.keys(catalog.columnCatalogIds).find(key => catalog.columnCatalogIds[key] === id);
        const column = { key: columnKey, kind: columnKey?.startsWith('function:') ? 'function' : 'criterion', excelHeader: dictionary.label };
        let checked = 0, ambiguous = 0;
        for (const entry of dictionary.entries) {
          const sameName = lookup.byDisplay.get(canonicalValue(entry.display)) || [];
          if (sameName.length > 1) { ambiguous++; continue; }
          const resolved = resolveEmbeddedDictionaryValue({ dictionaryCatalog: catalog }, column, entry.selector || entry.display, '');
          if (!resolved.resolved) throw new Error('Значение из справочника не распознано при ручном вводе.');
          checked++;
        }
        return { detail: `Проверено названий: ${checked}; одинаковых названий с уточнением: ${ambiguous}. Источник: ${dictionary.sourceView || 'текущая матрица'}.` };
      });
    }
    if (generated && columns) for (const column of columns.values()) {
      await run(`field-${column.key}`, `Поле: ${column.name || column.excelHeader}`, async () => {
        const controlRow = snapshot.rows.find(row => (column.kind === 'function' ? row.roles?.[column.id] : row.values?.[column.id])?.length);
        if (!controlRow) return { status: 'not-run', detail: 'В матрице нет заполненного примера этого поля.' };
        if (!controlRow.card?.clone) return { status: 'not-run', detail: 'Карточка для проверки перестройки недоступна.' };
        const desired = desiredFromRow(controlRow);
        desired.flat[column.key] = []; desired.ids[column.key] = [];
        const cloned = controlRow.card.clone();
        const removesLastRole = column.kind === 'function' && !Object.entries(controlRow.roles || {}).some(([id,items]) => id !== column.id && items.length);
        try { bridge.rebuildRowCard(cloned, controlRow.versionId, desired, structure, snapshot); }
        catch (error) {
          if (removesLastRole && /не останется ни одного исполнителя/.test(error.message || '')) return { detail: 'Защита сработала: удалить последнего исполнителя из существующей строки нельзя. Записи не было.' };
          throw error;
        }
        if (removesLastRole) throw new Error('Подготовка разрешила строку без исполнителей.');
        const after = bridge.readMatrixRowFromCard(cloned, controlRow, structure);
        if (currentCompareValues(after, column).length) throw new Error('Очистка поля не удаляет его значения в подготовленной карточке.');
        for (const other of columns.values()) if (other.key !== column.key && !arraysEqual(currentCompareValues(after, other), currentCompareValues(controlRow, other))) throw new Error('При очистке изменилось другое поле.');
        return { detail: 'Очистка отдельного поля проверена на копии карточки; остальные поля сохранены. Записи не было.' };
      });
    }
    await run('physical-delete', 'Удаление строки в Excel: сопоставление', async () => {
      if (!generated.rows.length) return { status: 'not-run', detail: 'Нет строк для контрольного удаления.' };
      const index = Math.floor(generated.rows.length / 2);
      const sample = { ...generated, rows: generated.rows.filter((_, i) => i !== index) };
      const deleted = buildPlan(sample, structure, snapshot);
      const target = snapshot.rows[index];
      const action = deleted.actions.find(a => a.type === 'delete' && a.currentRow.rowCardId === target.rowCardId);
      if (!action) throw new Error('Удаление целой строки не распознано.');
      return { detail: 'Удаление строки из середины Excel распознано по исходной версии. Серверное удаление не вызывалось.' };
    }, Boolean(generated && snapshotOk));

    const control = snapshotOk ? snapshot.rows.find(row => Object.values(row.values || {}).some(items => items.some(v => v.to != null))) || snapshot.rows[0] : null;
    await run('saved-validation', 'Сервер: сохранённая строка', async () => {
      await bridge.validateDuplicate(control.card, control.versionId); return { detail: 'Сервер разрешил проверку существующей версии.' };
    }, Boolean(control));
    await run('rebuilt-validation', 'Сервер: та же строка после перестройки', async () => {
      const card = control.card.clone(); bridge.rebuildRowCard(card, control.versionId, desiredFromRow(control), structure, snapshot);
      const after = bridge.readMatrixRowFromCard(card, control, structure);
      if (reconciliationSemanticKey(after, structure) !== reconciliationSemanticKey(control, structure)) throw new Error('Перестройка изменила значения контрольной строки. Запрос не отправлен.');
      await bridge.validateDuplicate(card, control.versionId); return { detail: 'Значения совпадают; сервер разрешил проверку.' };
    }, Boolean(control && columns));
    await run('duplicate-control', 'Сервер: точная копия должна определиться как дубль', async () => {
      const created = await bridge.createRowCard(structure.templateId);
      bridge.rebuildRowCard(created.card, created.versionId, desiredFromRow(control), structure, snapshot);
      try { await bridge.validateDuplicate(created.card, created.versionId); }
      catch (error) { if (error.code === 'duplicate-found') return { detail: 'Сервер обнаружил дубль. Копия не сохранялась.' }; throw error; }
      throw new Error('Сервер разрешил точную копию. Нужно проверить правило поиска дубликатов. Копия не сохранялась.');
    }, Boolean(control && columns));
    const candidates = plan && !plan.safety?.blocked ? plan.actions.filter(a => ['add', 'update'].includes(a.type)) : [];
    report.candidateCoverage = { total: candidates.length, checked: 0, limit: bounds.candidates };
    for (const action of candidates.slice(0, bounds.candidates)) {
      await run(`candidate-${action.excelRow.excelRow}`, `Сервер: Excel ${action.excelRow.excelRow} · ${action.type === 'add' ? 'добавить' : 'изменить'}`, async () => {
        await hydrateMissingIdsForAction(action, structure, snapshot, bridge);
        const created = action.type === 'add' ? await bridge.createRowCard(structure.templateId)
          : { card: await bridge.getCard(action.currentRow.rowCardId), versionId: action.currentRow.versionId };
        bridge.rebuildRowCard(created.card, created.versionId, action.excelRow, structure, snapshot);
        report.candidateCoverage.checked++;
        await bridge.validateDuplicate(created.card, created.versionId);
        return { detail: 'Проверка дубликатов пройдена. Сохранение не выполнялось.' };
      });
    }
    if (candidates.length > bounds.candidates) report.checks.push({ id: 'candidate-limit', title: 'Остальные изменения', status: 'not-run', detail: `За один прогон проверяется до ${bounds.candidates} операций; всего ${candidates.length}.` });
    while (pending.size) await Promise.allSettled([...pending]);
    capture('previous-state.json', previous);
    report.finishedAt = nowIso();
    report.status = report.checks.some(c => c.status === 'fail') ? 'failed'
      : report.interrupted || report.omitted.length || report.checks.some(c => c.status === 'not-run') ? 'incomplete' : 'passed';
    return { report, entries };
  }

  async function makeStudioDiagnosticPackage(result) {
    // Late packaging is local only. Re-downloading never re-runs server checks.
    const readme = 'TESSA Matrix Studio — проверки без записи\n\nНачните с report.json: checks содержит результат каждого этапа, omitted — данные, не вошедшие в пакет.\nrequests/ содержит бизнес-запросы и ответы. selected.xlsx — исходный выбранный файл; matrix-current.xlsx — свежая выгрузка, если их удалось собрать.\nЗапись, удаление, транзакции и чужая параллельная запись не тестировались. Успешная проверка дубликатов не разрешает Apply без обычного свежего Preview.\nПакет содержит рабочие значения. Передавайте его только тем, кому можно видеть эту матрицу. Cookies, пароли и HTTP-заголовки не собираются.\n';
    return makeZip([['README.txt', readme], ['report.json', JSON.stringify(result.report, null, 2)], ...result.entries]);
  }

  function renderStudioDiagnostics(report = APP.lastStudioDiagnostics?.report) {
    const host = document.querySelector?.('#tms-tests-result');
    if (!host) return;
    if (!report) { host.textContent = 'Проверки ещё не запускались.'; return; }
    const labels = { pass: 'Пройдено', fail: 'Ошибка', 'not-run': 'Не проверено', running: 'Выполняется' };
    const counts = status => report.checks.filter(c => c.status === status).length;
    host.innerHTML = `<p>Пройдено: ${counts('pass')} · ошибок: ${counts('fail')} · не проверено: ${counts('not-run')}</p>`
      + report.checks.map(c => `<details class="tms-test-check"${c.status === 'fail' ? ' open' : ''}><summary>${escapeHtml(labels[c.status])} · ${escapeHtml(c.title)}</summary><p>${escapeHtml(String(c.detail || 'Ожидание результата.').slice(0, 2500))}</p></details>`).join('')
      + (report.omitted?.length ? `<p>В пакет не вошли данные: ${report.omitted.length}. Причины — в отчёте.</p>` : '')
      + '<p>Запись и удаление не проверялись.</p>';
  }

  async function runStudioDiagnostics(download = false) {
    if (APP.busy) return;
    const file = document.querySelector('#tms-file')?.files?.[0] || null;
    const originalPlan = APP.plan, originalWorkbook = APP.workbook;
    const previous = { plan: APP.plan, applyReport: APP.lastReport?.value, reconciliation: APP.lastReconciliation, intervalDiagnostics: APP.lastIntervalDiagnostics?.value };
    let context = null;
    // Cancellation may retain a partial package. A different matrix/file may not.
    const assertIdentity = () => {
      if (APP.plan !== originalPlan || APP.workbook !== originalWorkbook || (document.querySelector('#tms-file')?.files?.[0] || null) !== file) throw new Error('Файл или Preview изменились.');
      if (context) {
        const active = probeRuntimeEnvironment();
        if (canonicalValue(active.matrix?.matrixId) !== canonicalValue(context.id) || canonicalValue(active.matrix?.templateId) !== canonicalValue(context.templateId)) throw new Error('Матрица или шаблон изменились.');
      }
    };
    APP.abortRequested = false; setBusy(true);
    try {
      const assertContext = async () => {
        if (APP.abortRequested) throw new Error('Проверки остановлены пользователем.');
        assertIdentity();
      };
      let result = download ? APP.lastStudioDiagnostics : null;
      if (result && (result.source?.plan !== originalPlan || result.source?.workbook !== originalWorkbook || result.source?.file !== file)) result = null;
      if (result?.report.matrixId) {
        context = { id: result.report.matrixId, templateId: result.report.templateId };
        await assertContext();
      }
      if (!result) {
        result = await collectStudioDiagnostics({
          connect: async () => { const bridge = await TessaBridge.create(); context = { id: bridge.mainCard.id, templateId: bridge.templateId() }; return bridge; },
          probe: probeRuntimeEnvironment, file, workbook: originalWorkbook, previous, assertContext, limits: { candidates: 200 },
          onProgress: report => { renderStudioDiagnostics(report); setProgress(Math.min(94, 5 + report.checks.length * 4), 'Проверки без записи', report.checks.at(-1)?.title || 'Подготовка'); },
        });
      }
      assertIdentity();
      // References stay in memory only; package serialization uses report/entries.
      result.source = { plan: originalPlan, workbook: originalWorkbook, file };
      APP.lastStudioDiagnostics = result;
      renderStudioDiagnostics(result.report);
      if (download) {
        const bytes = await makeStudioDiagnosticPackage(result);
        assertIdentity();
        downloadBlob(new Blob([bytes], { type: 'application/zip' }), `TESSA_Diagnostics_${result.report.startedAt.replace(/[:.]/g, '-')}.zip`);
      }
      setProgress(100, result.report.status === 'failed' ? 'В проверках найдены ошибки' : result.report.status === 'incomplete' ? 'Проверки выполнены не полностью' : 'Проверки без записи пройдены', download ? 'Пакет диагностики скачан.' : 'Результаты — в «Дополнительно → Проверки и диагностика».');
    } catch (error) {
      APP.lastStudioDiagnostics = null; renderStudioDiagnostics();
      setProgress(100, 'Не удалось завершить диагностику', friendlyErrorMessage(error));
    }
    finally { setBusy(false); }
  }

  function reconciliationSummary(result) {
    if (!result) return 'Проверка результата не выполнялась.';
    if (result.status === 'verified') {
      return `Подтверждено: ${Number(result.verifiedCount || 0)} из ${Number(result.checkedCount || 0)}.`;
    }
    if (result.status === 'divergent') {
      return `Подтверждено: ${Number(result.verifiedCount || 0)}; расхождений: ${Number(result.divergentCount || 0) + Number(result.missingCount || 0)}.`;
    }
    return `Проверка неполная: подтверждено ${Number(result.verifiedCount || 0)}; неизвестно ${Number(result.unknownCount || 0)}.`;
  }

  function renderReconciliationResult(result) {
    const host = document.querySelector?.('#tms-reconciliation-result');
    if (!host) return null;
    host.textContent = reconciliationSummary(result);
    host.dataset.status = result?.status || 'not-run';
    return host.textContent;
  }

  function updateReconciliationControlState() {
    const button = document.querySelector?.('#tms-reconcile');
    if (!button) return false;
    const hasReceipts = Boolean(APP.lastMutationReceipts?.receipts?.length);
    const capabilityAllows = Boolean(APP.capabilityAvailability?.reconcile?.enabled);
    button.hidden = !hasReceipts;
    button.disabled = Boolean(APP.busy || !hasReceipts || !capabilityAllows);
    button.title = hasReceipts && !capabilityAllows
      ? humanCapabilityBlocker(APP.capabilityAvailability?.reconcile?.blockers || [])
      : '';
    return !button.disabled;
  }

  function sanitizeSupportReport(input = {}, options = {}) {
    const reconciliation = input.reconciliation || {};
    const reasonCodes = [...new Set([
      reconciliation.reasonCode,
      ...(reconciliation.rows || []).map(row => row?.reasonCode),
    ].filter(Boolean))];
    return {
      studioVersion: String(input.version || APP.version),
      createdAt: nowIso(),
      ...(options.includeIds ? {
        matrixId: input.matrixId || null,
        templateId: input.templateId || null,
      } : {}),
      capabilities: {
        overall: input.capabilities?.overall || null,
        blockers: (input.capabilities?.blockers || []).map(item => ({ code: item?.code || null, scope: item?.scope || null })),
        warnings: (input.capabilities?.warnings || []).map(item => ({ code: item?.code || null, scope: item?.scope || null })),
      },
      apply: input.apply ? {
        status: input.apply.status || null,
        requestedCount: Number(input.apply.requestedCount || 0),
        appliedCount: Number(input.apply.appliedCount || 0),
        failedCount: Number(input.apply.failedCount || 0),
        notStartedCount: Number(input.apply.notStartedCount || 0),
      } : null,
      reconciliation: {
        status: reconciliation.status || null,
        checkedCount: Number(reconciliation.checkedCount || 0),
        verifiedCount: Number(reconciliation.verifiedCount || 0),
        divergentCount: Number(reconciliation.divergentCount || 0),
        missingCount: Number(reconciliation.missingCount || 0),
        unknownCount: Number(reconciliation.unknownCount || 0),
        reasonCodes,
      },
    };
  }

  function jsonReplacer(key, value) {
    if (key === 'card' || key === 'bridge' || key === 'columnMap') return undefined;
    if (value instanceof Map) return Object.fromEntries(value);
    return value;
  }

  // ---------------------------------------------------------------------------
  // 12. UI
  // Панель намеренно сводит работу к четырём шагам: скачать -> изменить -> проверить
  // -> применить. Технические детали остаются внутри отчёта и не перегружают пользователя.
  // ---------------------------------------------------------------------------

  /**
   * Session-only view state for large Preview. It never changes the plan itself and
   * therefore cannot alter Apply semantics by paging/filtering the DOM.
   */
  function createPreviewViewState(overrides = {}) {
    const pageSize = Math.max(1, Math.min(200, Math.trunc(Number(overrides.pageSize) || 40)));
    const page = Math.max(1, Math.trunc(Number(overrides.page) || 1));
    const filter = ['all', 'update', 'add', 'delete', 'skip'].includes(canonicalValue(overrides.filter))
      ? canonicalValue(overrides.filter)
      : 'all';
    return { page, pageSize, filter, query: normalizeSpace(overrides.query || '') };
  }

  function previewActionSearchText(action) {
    const parts = [
      action?.type,
      action?.excelRow?.excelRow,
      action?.currentRow?.index !== undefined ? Number(action.currentRow.index) + 1 : '',
      ...(action?.changes || []).flatMap(change => [change?.label, change?.key, ...(change?.before || []), ...(change?.after || [])]),
      ...Object.values(action?.excelRow?.flat || {}).flat(),
      ...Object.values(action?.currentRow?.flat || {}).flat(),
    ];
    return canonicalValue(parts.filter(value => value !== null && value !== undefined).join(' '));
  }

  /**
   * Selects exactly one Preview page from the full plan. Review state is accepted so
   * callers can share one signature with renderPlan, but paging itself deliberately
   * uses source plan actions: a fully excluded UPDATE must remain reachable to restore.
   */
  function selectPreviewItems(plan, review = null, viewState = null) {
    void review;
    const state = createPreviewViewState(viewState || {});
    const query = canonicalValue(state.query);
    let items = [];
    if (state.filter !== 'skip') {
      items = (plan?.actions || [])
        .filter(action => action?.type && action.type !== 'noop')
        .filter(action => state.filter === 'all' || action.type === state.filter)
        .map(action => ({ kind: 'action', action }));
    }
    // "All" includes rejected rows, too. Keep actions first to preserve review
    // ordering; these display-only items never enter the executable Apply plan.
    if (state.filter === 'all' || state.filter === 'skip') {
      items = items.concat((plan?.skippedRows || []).map(skip => ({ kind: 'skip', skip })));
    }
    if (query) items = items.filter(item => (item.kind === 'action'
      ? previewActionSearchText(item.action)
      : canonicalValue(`${item.skip?.excelRow || ''} ${rowFailureReason(item.skip)} ${item.skip?.reason || ''}`)).includes(query));

    const total = items.length;
    const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
    const page = Math.min(state.page, pageCount);
    const offset = (page - 1) * state.pageSize;
    const pageItems = items.slice(offset, offset + state.pageSize);
    return {
      items: pageItems,
      total,
      page,
      pageSize: state.pageSize,
      pageCount,
      start: total ? offset + 1 : 0,
      end: total ? offset + pageItems.length : 0,
      filter: state.filter,
      query: state.query,
    };
  }

  function cherkizovoLogoSvg() {
    return `<svg viewBox="0 0 192.756 192.756" aria-hidden="true" focusable="false"><path fill="#E31E24" d="M162.854 63.44c10.303 20.271 11.299 48.019-.664 67.957-16.449 26.752-46.689 41.541-77.263 37.719-26.086-2.492-52.505-21.104-61.81-46.357-9.637-23.76-3.655-53.502 14.123-72.278 21.268-23.262 56.659-31.902 86.567-19.772 15.951 6.478 30.24 16.78 39.047 32.731z"/><path fill="#fff" d="M117.66 53.471c.996 3.323 1.494 6.646-.5 9.471-5.98 6.48-15.451 8.806-24.258 6.646-4.486-.831-9.305-3.656-11.465-7.81-1.33-4.154.831-7.976 3.157-10.8 8.806-6.646 24.591-7.145 32.235 2.493z"/><path fill="#fff" d="M79.277 69.255c6.646 13.292-1.495 29.077 3.656 40.209.831 2.326 3.489 1.33 5.316 1.496 6.813-3.324 5.317-10.635 9.471-15.453 4.154-9.637 14.289-15.951 24.426-16.616 11.631-.665 23.428 5.982 28.246 17.114 4.486 9.471 4.154 23.096-2.824 31.57-4.986 8.807-14.291 12.295-23.262 13.957-8.309.166-15.951-4.818-19.607-12.295-2.16-5.484-3.82-12.463 0-17.779 4.652-9.139 23.428-9.139 16.615-23.096-2.99-2.327-6.314-5.151-10.467-3.324-13.293 7.976-13.625 23.761-19.607 35.89-4.486 9.305-9.471 22.264-21.767 22.93-8.972 1.494-16.117-2.99-20.77-10.469-6.812-16.615-6.812-37.219-9.471-54.997.332-7.975 4.818-15.951 12.462-19.606 10.47-4.651 22.266.334 27.583 10.469z"/></svg>`;
  }

  function renderPlan(plan) {
    clearTimeout(APP.previewSearchTimer);
    const summary = document.querySelector('#tms-summary');
    const table = document.querySelector('#tms-plan');
    if (!summary || !table) return;
    updateIntervalDiagnosticControlState();
    const applySection = document.querySelector('#tms-apply-section');
    if (applySection) applySection.hidden = false;
    const reviewed = buildReviewedPlan(plan, APP.review);
    APP.capabilityActions = reviewed.actions;
    const applyState = applyAvailability(plan, APP.review);
    APP.reviewedApplyEnabled = applyState.canApply;
    const c = reviewed.counts;
    const skipped = reviewed.skippedRows || [];
    const warnings = (reviewed.warnings || []).slice(0, 8);
    const reviewedSafety = reviewed.safety || plan.safety || { blocked: false, blockedReasons: [] };
    const excludedRowCount = APP.review?.excludedRows?.size || 0;
    const excludedChangeCount = [...(APP.review?.excludedChanges?.values?.() || [])].reduce((sum, values) => sum + (values?.size || 0), 0);
    const hasReviewExclusions = excludedRowCount > 0 || excludedChangeCount > 0;
    const hasSourceChanges = (plan.actions || []).some(action => action.type !== 'noop');
    summary.innerHTML = `
      <div class="tms-counters">
        <span class="tms-count tms-update">изменить <b>${c.update}</b></span>
        <span class="tms-count tms-add">добавить <b>${c.add}</b></span>
        <span class="tms-count tms-delete">удалить <b>${c.delete}</b></span>
        <span class="tms-count tms-noop">без изменений <b>${c.noop}</b></span>
        <span class="tms-count tms-skip">пропустить <b>${c.skip || 0}</b></span>
      </div>
      ${hasReviewExclusions ? `<div class="tms-review-note"><b>Фильтр применения включён.</b> Отключённые здесь изменения не попадут в TESSA; исходный Excel не изменяется.</div>` : ''}
      ${skipped.length ? `<div class="tms-review-note"><b>${applyState.count === 0
        ? 'Нет изменений для применения.'
        : applyState.blocked ? 'Применение заблокировано.' : `Доступно для применения: ${applyState.count}.`}</b> Пропущено строк: ${skipped.length}. Причины указаны в списке ниже.</div>` : ''}
      ${hasSourceChanges ? rowFailuresHtml(skipped) : ''}
      ${skippedFieldsHtml(reviewed.skippedFields)}
      ${reviewedSafety.blocked ? `<div class="tms-fatal"><b>Этот набор изменений нельзя безопасно применить</b><br>${(reviewedSafety.blockedReasons || []).map(escapeHtml).join('<br>')}</div>` : ''}
      ${applyState.batchBlocked ? `<div class="tms-fatal"><b>Слишком много изменений за один раз</b><br>Сейчас: ${applyState.count} · максимум: 2000. Раскройте «Выбрать часть изменений» и уменьшите число операций.</div>` : ''}
      ${warnings.length ? `<details class="tms-warning"><summary>Нужно проверить</summary><div>${warnings.map(item => `<div>${escapeHtml(item)}</div>`).join('')}</div></details>` : ''}
    `;

    // Не теряем раскрытую строку после клика по review-кнопке и повторного renderPlan().
    const openActionKeys = new Set([...table.querySelectorAll('details[open][data-review-action-key]')].map(item => item.dataset.reviewActionKey));
    table.innerHTML = '';

    // Показываем исходные найденные действия, а не только effective actions: иначе
    // полностью отключённая строка исчезнет из preview и её нельзя будет вернуть.
    APP.previewView = createPreviewViewState(APP.previewView || {});
    const selection = selectPreviewItems(plan, APP.review, APP.previewView);
    APP.previewView.page = selection.page;

    const toolbar = document.createElement('div');
    toolbar.className = 'tms-preview-toolbar';
    const filterButton = (value, label) => `<button type="button" class="tms-preview-filter${selection.filter === value ? ' tms-active' : ''}" data-preview-filter="${value}">${label}</button>`;
    toolbar.innerHTML = `
      <div class="tms-preview-filters">
        ${filterButton('all', 'Все')}${filterButton('update', 'Изменить')}${filterButton('add', 'Добавить')}${filterButton('delete', 'Удалить')}${filterButton('skip', 'Пропустить')}
      </div>
      <input id="tms-preview-query" aria-label="Поиск изменений" class="tms-preview-query" type="search" placeholder="Найти строку или значение" value="${escapeHtml(selection.query)}">
      ${hasSourceChanges || hasReviewExclusions ? `<details class="tms-package-details" ${hasReviewExclusions || applyState.batchBlocked ? 'open' : ''}><summary>Выбрать часть изменений${hasReviewExclusions ? ' · выбор изменён' : ''}</summary><div class="tms-preview-package">
        <strong>Применить первые</strong>
        <select id="tms-review-package-limit" aria-label="Число операций для применения">
          <option value="1">1</option><option value="10">10</option><option value="100">100</option><option value="500">500</option><option value="2000">2000</option>
        </select>
        <button type="button" data-review-package="keep" ${selection.filter === 'skip' ? 'disabled' : ''}>Выбрать</button>
        <button type="button" data-review-package="reset">Вернуть всё</button>
        <span>${selection.filter === 'skip'
          ? 'Пропущенные строки не применяются'
          : selection.query
            ? 'По текущему фильтру и поиску'
            : selection.filter === 'all'
              ? 'Из всех операций'
              : `Только: ${selection.filter === 'update' ? 'изменить' : selection.filter === 'add' ? 'добавить' : 'удалить'}`}</span>
      </div></details>` : ''}
      <div class="tms-preview-pager" ${selection.pageCount <= 1 ? 'hidden' : ''}>
        <button type="button" data-preview-page="${Math.max(1, selection.page - 1)}" ${selection.page <= 1 ? 'disabled' : ''}>←</button>
        <span>Показано ${selection.start}–${selection.end} из ${selection.total} · стр. ${selection.page}/${selection.pageCount}</span>
        <button type="button" data-preview-page="${Math.min(selection.pageCount, selection.page + 1)}" ${selection.page >= selection.pageCount ? 'disabled' : ''}>→</button>
      </div>`;
    table.appendChild(toolbar);

    if (!selection.total) {
      const empty = document.createElement('div');
      empty.className = 'tms-empty';
      empty.textContent = selection.filter === 'skip' ? 'Пропущенных строк по этому фильтру нет.' : 'Изменений по этому фильтру нет.';
      table.appendChild(empty);
    }
    const previewActions = selection.items.filter(item => item.kind === 'action').map(item => item.action);

    previewActions.forEach(action => {
      const item = document.createElement('details');
      item.className = `tms-action tms-action-${action.type}`;
      const actionKey = planReviewActionKey(action);
      item.dataset.reviewActionKey = actionKey;
      if (openActionKeys.has(actionKey)) item.open = true;
      const isReplacement = action.type === 'update' && isOverwriteMatch(action.match);
      const label = isReplacement ? 'Заменить' : action.type === 'update' ? 'Изменить' : action.type === 'add' ? 'Добавить' : 'Удалить';
      const rowText = isReplacement ? `Excel ${action.excelRow.excelRow} → TESSA ${action.currentRow.index + 1}` : action.excelRow ? `Excel ${action.excelRow.excelRow}` : `TESSA ${action.currentRow.index + 1}`;
      const rowExcluded = Boolean(APP.review?.excludedRows?.has?.(actionKey));
      const supportsWholeActionReview = action.type === 'update' || action.type === 'add' || action.type === 'delete';
      if (rowExcluded) item.classList.add('tms-review-row-excluded');
      item.innerHTML = `<summary><b>${label}</b> — ${rowText}${action.match?.lowConfidence ? ' · проверьте соответствие' : ''}${rowExcluded ? ' · <span class="tms-review-state">не будет применено</span>' : ''}</summary>`;
      const body = document.createElement('div');
      body.className = 'tms-action-body';
      const rowButtonLabel = action.type === 'update'
        ? (rowExcluded ? 'Вернуть строку' : 'Исключить строку')
        : (rowExcluded ? 'Вернуть операцию' : 'Не применять');
      const rowReviewControl = supportsWholeActionReview ? `
        <div class="tms-review-row-actions">
          <button type="button" class="tms-review-btn tms-review-row-btn" data-review-action="${escapeHtml(actionKey)}" data-review-row="true" aria-pressed="${rowExcluded ? 'true' : 'false'}">${rowButtonLabel}</button>
        </div>` : '';

      if (action.type === 'update') {
        const excludedChanges = reviewExcludedChanges(APP.review, action);
        const rowsExcludedIndividually = (action.changes || []).filter(change => excludedChanges.has(change.key)).length;
        body.innerHTML = `${rowReviewControl}${skippedFieldsHtml(action.skippedFields)}
          ${!rowExcluded && rowsExcludedIndividually ? `<div class="tms-review-state">Не применяется полей: ${rowsExcludedIndividually}</div>` : ''}
          ${(action.changes || []).map(change => {
            const individuallyExcluded = excludedChanges.has(change.key);
            const excluded = rowExcluded || individuallyExcluded;
            const button = rowExcluded ? '' : `<button type="button" class="tms-review-btn tms-review-change-btn" data-review-action="${escapeHtml(actionKey)}" data-review-change="${escapeHtml(change.key)}" aria-pressed="${individuallyExcluded ? 'true' : 'false'}">${individuallyExcluded ? 'Вернуть' : 'Исключить'}</button>`;
            return `<div class="tms-diff${excluded ? ' tms-diff-excluded' : ''}">
              <div class="tms-diff-head"><b>${escapeHtml(change.label || change.key)}</b>${button}</div>
              <div class="tms-diff-values"><div class="tms-before"><small>Было</small>${previewValuesHtml(change.before, plan.columnMap, change.key)}</div><div class="tms-after"><small>Будет</small>${previewValuesHtml(change.after, plan.columnMap, change.key)}</div></div>
              ${excluded ? '<div class="tms-review-state">Это изменение не будет применено</div>' : ''}
            </div>`;
          }).join('')}`;
      } else if (action.type === 'add') body.innerHTML = `${rowReviewControl}${flatToHtml(action.excelRow.flat, plan.columnMap)}`;
      else body.innerHTML = `${rowReviewControl}${flatToHtml(action.currentRow.flat, plan.columnMap)}`;
      item.appendChild(body);
      table.appendChild(item);
    });

    selection.items.filter(item => item.kind === 'skip').forEach(({ skip }) => {
      const item = document.createElement('details');
      item.className = 'tms-action tms-action-skip';
      // Show short rejected-only plans immediately; retain full platform text
      // behind an explicit disclosure rather than repeating it in the summary.
      item.open = !hasSourceChanges && selection.total <= 20;
      const reason = rowFailureReason(skip);
      const technical = skip?.reason && skip.reason !== reason
        ? `<details><summary>Технические подробности</summary><div>${escapeHtml(skip.reason)}</div></details>` : '';
      item.innerHTML = `<summary><b>Пропущено</b> — ${skip?.excelRow ? `Excel ${escapeHtml(skip.excelRow)}` : 'строка без номера'}</summary><div class="tms-action-body">${escapeHtml(reason)}${technical}</div>`;
      table.appendChild(item);
    });

    // Делегируем навигацию и review-клики: renderPlan может пересобирать карточки сколько угодно.
    table.onclick = event => {
      const filter = event.target?.closest?.('button[data-preview-filter]');
      if (filter && !APP.busy) {
        APP.previewView = createPreviewViewState({ ...APP.previewView, filter: filter.dataset.previewFilter, page: 1 });
        renderPlan(APP.plan);
        return;
      }
      const pager = event.target?.closest?.('button[data-preview-page]');
      if (pager && !pager.disabled && !APP.busy) {
        APP.previewView = createPreviewViewState({ ...APP.previewView, page: Number(pager.dataset.previewPage) || 1 });
        renderPlan(APP.plan);
        return;
      }
      const packageButton = event.target?.closest?.('button[data-review-package]');
      if (packageButton && APP.plan && !APP.busy) {
        if (packageButton.dataset.reviewPackage === 'reset') {
          APP.review = createPlanReviewState();
        } else if (packageButton.dataset.reviewPackage === 'keep') {
          const limitInput = table.querySelector?.('#tms-review-package-limit') || document.querySelector('#tms-review-package-limit');
          const limit = Math.max(0, Math.trunc(Number(limitInput?.value) || 0));
          APP.review = keepReviewedPackage(APP.plan, APP.review, {
            filter: APP.previewView.filter,
            query: APP.previewView.query,
            limit,
          });
        }
        APP.previewView = createPreviewViewState({ ...APP.previewView, page: 1 });
        renderPlan(APP.plan);
        return;
      }

      const button = event.target?.closest?.('button[data-review-action]');
      if (!button || !APP.plan || APP.busy) return;
      const sourceAction = (APP.plan.actions || []).find(candidate => planReviewActionKey(candidate) === button.dataset.reviewAction);
      if (!sourceAction) return;
      if (button.hasAttribute('data-review-row')) {
        const currentlyExcluded = Boolean(APP.review?.excludedRows?.has?.(planReviewActionKey(sourceAction)));
        setPlanReviewRow(APP.review, sourceAction, !currentlyExcluded);
      } else if (button.hasAttribute('data-review-change')) {
        if (sourceAction.type !== 'update') return;
        const changeKey = button.dataset.reviewChange;
        const currentlyExcluded = reviewExcludedChanges(APP.review, sourceAction).has(changeKey);
        setPlanReviewChange(APP.review, sourceAction, changeKey, !currentlyExcluded);
      }
      renderPlan(APP.plan);
    };
    table.oninput = event => {
      if (event.target?.id !== 'tms-preview-query' || APP.busy) return;
      APP.previewView = createPreviewViewState({ ...APP.previewView, query: event.target.value, page: 1 });
      clearTimeout(APP.previewSearchTimer);
      const sourcePlan = APP.plan;
      APP.previewSearchTimer = setTimeout(() => {
        if (APP.busy || APP.plan !== sourcePlan) return;
        const restoreFocus = document.activeElement?.id === 'tms-preview-query';
        renderPlan(APP.plan);
        if (restoreFocus) requestAnimationFrame(() => {
          const queryInput = document.querySelector('#tms-preview-query');
          if (queryInput) { queryInput.focus(); queryInput.setSelectionRange(queryInput.value.length, queryInput.value.length); }
        });
      }, 150);
    };

    const apply = document.querySelector('#tms-apply');
    if (apply) {
      apply.disabled = !applyState.canApply;
      apply.textContent = applyState.label;
      apply.title = applyState.blocked ? (applyState.reason || 'Применение заблокировано') : '';
    }
    const applyNote = document.querySelector('#tms-apply-note');
    if (applyNote) {
      applyNote.textContent = applyState.batchBlocked
        ? `Нужно уменьшить пакет: сейчас ${applyState.count}, максимум 2000 операций за один Apply.`
        : applyState.warning
          ? `Большой пакет: ${applyState.count} операций. Перед записью потребуется дополнительное подтверждение.`
          : '';
    }
  }

  // Presentation only: preserve order, repeated labels and IDs in the plan.
  // A Boolean is rendered as Да/Нет only when the template declares that type.
  function previewValuesHtml(values, columnMap, key) {
    if (!values?.length) return 'Не заполнено';
    const column = columnMap?.columns?.get?.(String(key).slice(String(key).indexOf(':') + 1));
    const isBoolean = column?.key === key && operandKind(column) === 'Boolean';
    return values.map(value => `<span class="tms-value">${escapeHtml(isBoolean ? booleanDisplay(value) : value)}</span>`).join('');
  }

  function flatToHtml(flat, columnMap = null) {
    const labels = new Map([...(columnMap?.columns?.values?.() || [])].map(column => [column.key, column.excelHeader || column.name]));
    return Object.entries(flat).filter(([, value]) => value?.length).map(([key, value]) => `<div><b>${escapeHtml(labels.get(key) || key)}</b>: ${previewValuesHtml(value, columnMap, key)}</div>`).join('') || 'Пустая строка';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
  }

  function setProgress(percent, label, detail = '') {
    const bounded = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    APP.progress = { percent: bounded, label: normalizeSpace(label || APP.progress?.label || 'Готово'), detail: normalizeSpace(detail || '') };
    const fill = document.querySelector('#tms-progress-fill');
    const labelEl = document.querySelector('#tms-progress-label');
    const percentEl = document.querySelector('#tms-progress-percent');
    const detailEl = document.querySelector('#tms-progress-detail');
    if (fill) fill.style.width = `${bounded}%`;
    if (labelEl) labelEl.textContent = APP.progress.label;
    if (percentEl) percentEl.textContent = `${bounded}%`;
    if (detailEl) detailEl.textContent = APP.progress.detail;
    // Keep idle state compact; progress appears only once an operation starts.
    const line = document.querySelector('#tms-status .tms-status-line');
    const track = document.querySelector('#tms-status .tms-progress-track');
    if (line) line.hidden = !APP.busy && bounded === 0;
    if (track) track.hidden = !APP.busy || bounded === 100;
  }

  // An operation can create a report or change whether a manual refresh is
  // needed while controls are locked. Update the state to restore at idle,
  // keeping the control disabled until the operation's finally block runs.
  // Otherwise setBusy(false) resurrects the obsolete pre-operation state.
  function setControlDisabled(control, disabled) {
    if (!control) return;
    if (APP.busy) APP.busyControlStates.set(control, Boolean(disabled));
    control.disabled = Boolean(APP.busy || disabled);
  }

  function setBusy(value) {
    APP.busy = value;
    const panel = document.querySelector('#tms-panel');
    panel?.classList.toggle('tms-busy', value);
    document.querySelectorAll('#tms-panel button, #tms-panel input, #tms-panel select, #tms-panel textarea').forEach(el => {
      if (el.id === 'tms-stop') { el.disabled = !value; el.hidden = !value; }
      else if (value) {
        // Preserve semantic disabled states (empty picker, first/last page,
        // unavailable operation) instead of enabling every control afterwards.
        if (!APP.busyControlStates.has(el)) APP.busyControlStates.set(el, Boolean(el.disabled));
        el.disabled = true;
      } else if (APP.busyControlStates.has(el)) {
        el.disabled = APP.busyControlStates.get(el);
        APP.busyControlStates.delete(el);
      }
    });
    if (value) setProgress(Math.max(3, APP.progress?.percent || 0), APP.progress?.label === 'Готово' ? 'Подготавливаю операцию' : APP.progress?.label, APP.progress?.detail || '');
    if (!value) {
      updateIntervalDiagnosticControlState();
      const stop = document.querySelector('#tms-stop');
      if (stop) stop.disabled = true;
      const apply = document.querySelector('#tms-apply');
      if (apply) { const availability = applyAvailability(APP.plan, APP.review); apply.disabled = !availability.canApply; apply.textContent = availability.label; apply.title = availability.blocked ? (availability.reason || 'Применение заблокировано') : ''; }
      const applyNote = document.querySelector('#tms-apply-note');
      if (applyNote) { const availability = applyAvailability(APP.plan, APP.review); applyNote.textContent = availability.batchBlocked ? `Нужно уменьшить пакет: сейчас ${availability.count}, максимум 2000 операций за один Apply.` : availability.warning ? `Большой пакет: ${availability.count} операций. Перед записью потребуется дополнительное подтверждение.` : ''; }
      const refresh = document.querySelector('#tms-refresh-excel');
      if (refresh) refresh.disabled = !APP.workbook?.roundtrip?.enabled && !document.querySelector('#tms-file')?.files?.length;
      if ((APP.progress?.percent || 0) < 100) {
        const status = APP.plan ? (APP.plan.safety?.blocked ? 'Нужен другой файл или черновик матрицы' : (APP.plan.skippedRows?.length ? `Готово: ${APP.plan.skippedRows.length} строк будут пропущены` : 'Готово к применению')) : 'Готово';
        setProgress(0, status, '');
      }
    }
    updateReconciliationControlState();
    if (!value && APP.runtimeMonitor) APP.runtimeMonitor.tick();
  }


  function capabilityStatusModel(capabilities, availability) {
    const overall = ['ready', 'limited', 'incompatible'].includes(capabilities?.overall)
      ? capabilities.overall
      : 'incompatible';
    const codes = [...new Set([
      ...(capabilities?.blockers || []).map(item => item?.code || item),
      ...(capabilities?.warnings || []).map(item => item?.code || item),
    ].filter(Boolean))];
    let label;
    let tone = overall;
    let detail = codes.length ? humanCapabilityBlocker(codes.slice(0, 1)) : 'Можно работать с Excel.';
    if (capabilities?.runtime && !capabilities.runtime.workspace) {
      label = 'Откройте матрицу'; tone = 'waiting'; detail = 'Studio подключится автоматически.';
    } else if (capabilities?.runtime && (!capabilities.runtime.editor || !capabilities.runtime.cardModel || (capabilities.matrix?.template && !capabilities.nativeView?.found))) {
      label = 'Матрица загружается'; tone = 'waiting'; detail = 'Проверяем подключение автоматически.';
    } else if (capabilities?.matrix?.identity && !capabilities.matrix.template) {
      label = 'Откройте матрицу'; tone = 'waiting'; detail = 'В текущей карточке матрица не найдена.';
    } else if (overall === 'ready') label = 'Матрица готова';
    else if (overall === 'limited') label = capabilities?.matrix?.writableState === false ? 'Только чтение' : 'Есть ограничения';
    else label = 'Подключение недоступно';
    return {
      label,
      tone,
      detail,
      diagnostics: humanCapabilityBlocker(codes),
      codes,
      exportEnabled: Boolean(availability?.export?.enabled),
      analyzeEnabled: Boolean(availability?.analyze?.enabled),
      applyEnabled: Boolean(availability?.apply?.enabled),
      refreshViewEnabled: Boolean(availability?.refreshView?.enabled),
      reconcileEnabled: Boolean(availability?.reconcile?.enabled),
    };
  }

  function renderCapabilityStatus(capabilities = APP.capabilities, availability = APP.capabilityAvailability) {
    const host = document.querySelector('#tms-capability-status');
    const details = document.querySelector('#tms-capability-details');
    if (!host || !details) return null;
    const model = capabilityStatusModel(capabilities, availability);
    host.textContent = model.label;
    host.dataset.tone = model.tone;
    details.textContent = model.detail;
    details.dataset.tone = model.tone;
    const diagnostics = document.querySelector('#tms-capability-diagnostics');
    if (diagnostics) { diagnostics.textContent = model.diagnostics; diagnostics.parentElement.hidden = !model.codes.length; }
    return model;
  }

  // Read-only local probes only. No polling of CardService, and no work while
  // Studio is closed, the tab is hidden, or a user operation is in progress.
  function createRuntimeMonitor({ check, active, schedule = setTimeout, cancel = clearTimeout, intervalMs = 1000 }) {
    let timer = null;
    let stopped = true;
    const tick = () => { if (!stopped && active()) check(); };
    const loop = () => {
      if (stopped) return;
      try { tick(); } finally { if (!stopped) timer = schedule(loop, intervalMs); }
    };
    return {
      start() { if (!stopped) return; stopped = false; loop(); },
      tick,
      stop() { stopped = true; if (timer !== null) cancel(timer); timer = null; },
    };
  }

  function refreshRuntimeCapabilities(actions = APP.capabilityActions || []) {
    let probe;
    try {
      probe = probeRuntimeEnvironment();
    } catch (_) {
      probe = {
        runtime: { extensionRequire: false, apiLoader: Boolean(window.tessa?.apiLoader), workspace: false, editor: false, cardModel: false },
        cardService: { get: false, request: false, store: false, newOrCreate: false },
        constructors: { cardGetRequest: false, cardRequest: false, cardStoreRequest: false, cardNewRequest: false, affectVersion: false },
        matrix: { identity: false, template: false, stateReadable: false, writableState: false, matrixId: null },
        nativeView: { found: false, paging: false, refresh: false },
      };
    }
    const capabilities = evaluateRuntimeCapabilities(probe);
    const availability = capabilityOperationAvailability(capabilities, actions);
    const previousCardId = APP.capabilityCheckedCardId;
    const nextCardId = probe?.matrix?.matrixId || null;
    const nextTemplateId = probe?.matrix?.templateId || null;
    if (!APP.busy && previousCardId && (previousCardId !== nextCardId || APP.capabilityCheckedTemplateId !== nextTemplateId)) {
      resetFilePreview();
      APP.structure = null; APP.snapshot = null; APP.bridge = null; APP.dictionaryCatalog = null;
      APP.lastMutationReceipts = null; APP.lastReconciliation = null;
      renderReconciliationResult(null);
      closeValuePicker();
      updateReconciliationControlState();
    }
    APP.capabilities = capabilities;
    APP.capabilityAvailability = availability;
    // A check during a running operation must not acknowledge a context switch:
    // the first idle check still needs to discard the previous card's UI state.
    if (!APP.busy) {
      APP.capabilityCheckedCardId = nextCardId;
      APP.capabilityCheckedTemplateId = nextTemplateId;
    }
    const stamp = JSON.stringify([capabilities.overall, capabilities.blockers, capabilities.warnings, probe.matrix, probe.runtime]);
    if (APP.capabilityRenderStamp !== stamp) {
      APP.capabilityRenderStamp = stamp;
      renderCapabilityStatus(capabilities, availability);
    }
    if (!APP.busy) {
      for (const [selector, enabled] of [['#tms-download-current', availability.export.enabled], ['#tms-download-fresh', availability.export.enabled], ['#tms-analyze', availability.analyze.enabled]]) {
        const button = document.querySelector(selector);
        if (button) button.disabled = !enabled || (['#tms-analyze', '#tms-download-fresh'].includes(selector) && !document.querySelector('#tms-file')?.files?.length);
      }
      const apply = document.querySelector('#tms-apply');
      if (apply) apply.disabled = !availability.apply.enabled || !APP.plan || !APP.reviewedApplyEnabled;
      const writeTest = document.querySelector('#tms-test-write'); if (writeTest) writeTest.disabled = !availability.apply.enabled || !APP.plan || !APP.reviewedApplyEnabled;
      updateReconciliationControlState();
    }
    return { probe, capabilities, availability };
  }

  function requireRuntimeOperation(operation, actions = []) {
    const checked = refreshRuntimeCapabilities(actions);
    const state = checked.availability?.[operation];
    if (state?.enabled) return checked;
    const reason = humanCapabilityBlocker(state?.blockers || checked.capabilities?.blockers || []);
    throw new Error(reason || 'Текущая web-сборка TESSA не предоставляет обязательные возможности для этой операции.');
  }

  // Build available fields from workbook schema IDs, never from one matrix name.
  function pickerColumns(source) {
    const catalog = source?.dictionaryCatalog;
    return (source?.schemaTokens || []).flatMap((token, index) => {
      const schema = parseSchemaToken(token);
      if (schema?.type !== 'definition') return [];
      const key = definitionKey(schema.kind, schema.id);
      const dictionary = catalog?.catalogs?.[catalog?.columnCatalogIds?.[key]];
      if (!dictionary?.entries?.length || dictionaryLookup(dictionary).isBoolean) return [];
      return [{ key, kind: schema.kind, label: source.headers[index], catalog: dictionary }];
    });
  }

  function pickerEntryKey(item) { return `${canonicalValue(item.id)}|${canonicalValue(item.roleTypeId || '')}`; }

  // Reuse the dictionary search index; bound rendered results, keep total count.
  function searchPickerEntries(catalog, query = '', limit = 80) {
    const terms = searchCanonical(query).split(/\s+/).filter(Boolean);
    const items = []; let total = 0;
    for (const row of dictionaryLookup(catalog)?.searchRows || []) {
      if (!terms.every(term => row.haystack.includes(term))) continue;
      total++;
      if (items.length < Math.max(1, Math.min(200, limit))) items.push(row.item);
    }
    return { items, total };
  }

  // Clipboard payload is plain text for Excel edit mode. Do not silently split
  // a selector containing delimiters or allow a pasted formula prefix.
  function pickerSelectionText(items) {
    const unique = [...new Map(items.map(item => [pickerEntryKey(item), item])).values()];
    const values = unique.map(item => String(item.selector || item.display || '').trim());
    if (values.some(value => /[\n\r;\t]/.test(value))) throw new Error('В названии есть разделитель. Такое значение нельзя собрать автоматически. Выберите его в штатном редакторе TESSA.');
    if (values.some(value => /^[=+@-]/.test(value))) throw new Error('Название начинается со знака формулы. Выберите его в штатном редакторе TESSA.');
    const result = values.join('\n');
    if (result.length > 32767) throw new Error('В ячейке Excel может быть не больше 32767 символов. Уменьшите выбор.');
    return result;
  }

  function closeValuePicker() {
    if (APP.picker?.searchTimer) clearTimeout(APP.picker.searchTimer);
    APP.picker = null;
    const host = document.querySelector('#tms-value-picker');
    if (host) { host.hidden = true; host.innerHTML = ''; }
    document.querySelector('#tms-open-picker')?.setAttribute('aria-expanded', 'false');
  }

  function renderPickerResults() {
    const state = APP.picker;
    const host = document.querySelector('#tms-value-picker');
    if (!state || !host) return;
    const column = state.columns[state.columnIndex];
    const found = searchPickerEntries(column.catalog, host.querySelector('#tms-picker-query').value);
    state.visibleItems = found.items;
    host.querySelector('#tms-picker-results').innerHTML = found.items.map((item, i) => `<label class="tms-picker-option"><input type="checkbox" data-picker-index="${i}" ${state.selected.has(pickerEntryKey(item)) ? 'checked' : ''}><span>${escapeHtml(item.selector || item.display)}</span></label>`).join('') || '<p class="tms-muted">Ничего не найдено. Измените поиск.</p>';
    host.querySelector('#tms-picker-count').textContent = `Найдено: ${found.total} · показано: ${found.items.length} · выбрано: ${state.selected.size}`;
    host.querySelector('#tms-picker-selected').innerHTML = [...state.selected.values()].map((item, i) => `<button type="button" data-picker-remove="${i}" aria-label="Убрать ${escapeHtml(item.selector || item.display)}">${escapeHtml(item.selector || item.display)} ×</button>`).join('');
    const output = host.querySelector('#tms-picker-output');
    const copy = host.querySelector('#tms-picker-copy');
    try { output.value = pickerSelectionText([...state.selected.values()]); copy.disabled = !output.value; host.querySelector('#tms-picker-message').textContent = ''; }
    catch (error) { output.value = ''; copy.disabled = true; host.querySelector('#tms-picker-message').textContent = error.message; }
  }

  // Only read a local workbook or the already downloaded dictionary. This picker
  // never writes to Excel or TESSA; the user reviews the resulting workbook.
  async function openValuePicker() {
    const file = document.querySelector('#tms-file')?.files?.[0];
    let source;
    if (file) source = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name);
    else if (APP.structure && APP.snapshot && APP.dictionaryCatalog) {
      const grid = buildRoundtripGrid(APP.structure, APP.snapshot, {}, APP.dictionaryCatalog);
      source = { headers: grid.columns.map(c => c.header), schemaTokens: grid.columns.map(c => c.schema), dictionaryCatalog: grid.dictionaryCatalog };
    }
    if (!source) throw new Error('Сначала скачайте Excel или выберите рабочую книгу со справочниками.');
    const columns = pickerColumns(source);
    if (!columns.length) throw new Error('В книге нет справочников для выбора. Скачайте Excel со справочниками.');
    closeValuePicker();
    APP.picker = { columns, columnIndex: 0, selected: new Map(), visibleItems: [], searchTimer: null };
    const host = document.querySelector('#tms-value-picker');
    host.hidden = false;
    document.querySelector('#tms-open-picker')?.setAttribute('aria-expanded', 'true');
    host.innerHTML = `<div class="tms-picker-head"><b>Несколько значений в ячейке</b><button type="button" id="tms-picker-close" aria-label="Закрыть выбор значений">×</button></div>
      <label for="tms-picker-column">Поле Excel</label><select id="tms-picker-column">${columns.map((c, i) => `<option value="${i}">${escapeHtml(c.label)}</option>`).join('')}</select>
      <p class="tms-muted">Поиск по текущему полю. Enter выбирает единственный результат; Esc закрывает окно.</p><details><summary>Продолжить набор из ячейки Excel</summary><textarea id="tms-picker-paste" rows="2" aria-label="Значения из Excel"></textarea><button id="tms-picker-import" type="button">Добавить в набор</button></details><input id="tms-picker-query" type="search" aria-label="Поиск по справочнику" placeholder="Найти значение" maxlength="200">
      <div id="tms-picker-count" class="tms-muted" aria-live="polite"></div><div id="tms-picker-results" class="tms-picker-results"></div>
      <div id="tms-picker-selected" class="tms-picker-selected"></div><label for="tms-picker-output">Готовое содержимое ячейки</label><textarea id="tms-picker-output" readonly rows="3"></textarea>
      <p class="tms-muted">Скопируйте набор. В Excel нажмите F2 в нужной ячейке и вставьте: все значения останутся внутри неё.</p>
      <div class="tms-row"><button type="button" id="tms-picker-copy" class="tms-primary" disabled>Скопировать</button><button type="button" id="tms-picker-clear">Очистить выбор</button></div><div id="tms-picker-message" role="status"></div>`;
    host.onchange = event => {
      const state = APP.picker; if (!state || APP.busy) return;
      if (event.target.id === 'tms-picker-column') {
        state.selections = state.selections || new Map(); state.selections.set(state.columnIndex, state.selected); state.columnIndex = Number(event.target.value); state.selected = state.selections.get(state.columnIndex) || new Map(); host.querySelector('#tms-picker-query').value = '';
      } else if (event.target.dataset.pickerIndex !== undefined) {
        const item = state.visibleItems[Number(event.target.dataset.pickerIndex)]; if (!item) return;
        if (event.target.checked) state.selected.set(pickerEntryKey(item), item); else state.selected.delete(pickerEntryKey(item));
      } else return;
      renderPickerResults();
    };
    host.oninput = event => {
      if (event.target.id !== 'tms-picker-query' || !APP.picker) return;
      clearTimeout(APP.picker.searchTimer);
      APP.picker.searchTimer = setTimeout(renderPickerResults, 120);
    };
    host.onclick = async event => {
      const button = event.target.closest('button'); const state = APP.picker;
      if (!button || !state || APP.busy) return;
      if (button.id === 'tms-picker-close') { closeValuePicker(); document.querySelector('#tms-open-picker')?.focus(); return; }
      if (button.id === 'tms-picker-import') {
        const column = state.columns[state.columnIndex], dictionary = { catalogs: { selected: column.catalog }, columnCatalogIds: { [column.key]: 'selected' } };
        const unknown = [];
        for (const value of splitCell(host.querySelector('#tms-picker-paste').value)) {
          const result = resolveEmbeddedDictionaryValue({ dictionaryCatalog: dictionary }, { key: column.key, kind: column.kind, excelHeader: column.label }, value, '');
          const entry = result.resolved ? column.catalog.entries.find(e => (column.kind === 'function' ? `${e.id}|${e.roleTypeId}` : String(e.id)) === result.explicit) : null;
          if (entry) state.selected.set(pickerEntryKey(entry), entry); else unknown.push(value);
        }
        renderPickerResults();
        if (unknown.length) host.querySelector('#tms-picker-message').textContent = `Не найдены или неоднозначны: ${unknown.join('; ')}`;
      }
      if (button.id === 'tms-picker-clear') { state.selected.clear(); renderPickerResults(); }
      if (button.dataset.pickerRemove !== undefined) {
        const item = [...state.selected.values()][Number(button.dataset.pickerRemove)];
        if (item) state.selected.delete(pickerEntryKey(item)); renderPickerResults();
      }
      if (button.id === 'tms-picker-copy') {
        const output = host.querySelector('#tms-picker-output');
        const message = host.querySelector('#tms-picker-message');
        output.focus(); output.select();
        try { await navigator.clipboard.writeText(output.value); if (APP.picker === state) message.textContent = 'Скопировано. Вставьте в Excel через F2 → Ctrl+V.'; }
        catch (_) { if (APP.picker === state) message.textContent = 'Текст выделен. Нажмите Ctrl+C, затем F2 → Ctrl+V в Excel.'; }
      }
    };
    host.onkeydown = event => {
      if (event.key === 'Escape') { closeValuePicker(); document.querySelector('#tms-open-picker')?.focus(); }
      if (event.key === 'Enter' && event.target.id === 'tms-picker-query' && APP.picker) {
        event.preventDefault();
        clearTimeout(APP.picker.searchTimer); renderPickerResults();
        if (APP.picker.visibleItems.length === 1) { const item = APP.picker.visibleItems[0]; APP.picker.selected.set(pickerEntryKey(item), item); renderPickerResults(); }
        else host.querySelector('#tms-picker-results input')?.focus();
      }
    };
    renderPickerResults();
    host.querySelector('#tms-picker-query').focus();
  }

  function mountUi() {
    if (document.querySelector('#tms-launch')) return;
    const style = document.createElement('style');
    style.textContent = `
      #tms-panel,#tms-launch{--tms-red:#c91c24;--tms-red-dark:#a9151c;--tms-ink:#24272c;--tms-muted:#616771;--tms-line:#dce0e5;--tms-bg:#fff;--tms-soft:#f5f6f8;--tms-success:#21603b;--tms-warning:#805b12;--tms-radius:8px;font:14px/1.5 var(--font-default,"Gotham Pro Server","Segoe UI",sans-serif);color:var(--tms-ink)}
      #tms-panel *,#tms-launch{box-sizing:border-box}
      #tms-panel [hidden]{display:none!important}
      #tms-launch{position:fixed;right:20px;bottom:20px;z-index:2147483645;width:52px;height:52px;padding:0;border:1px solid #dce0e5;border-radius:50%;background:#fff;box-shadow:0 4px 16px #0002;cursor:grab;display:grid;place-items:center;touch-action:none;user-select:none;overflow:hidden}
      #tms-launch:active{cursor:grabbing}
      #tms-launch svg{width:52px;height:52px;display:block;pointer-events:none}
      #tms-panel{position:fixed;right:20px;bottom:84px;width:min(620px,calc(100vw - 32px));max-height:calc(100vh - 108px);z-index:2147483646;background:var(--tms-bg);border:1px solid var(--tms-line);border-radius:12px;box-shadow:0 8px 32px #0003;display:none;overflow:hidden}
      #tms-panel.tms-open{display:flex;flex-direction:column;animation:tms-enter .18s ease-out}
      #tms-panel .tms-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--tms-line);background:var(--tms-bg)}
      #tms-panel .tms-brand{width:32px;height:32px;flex:none}
      #tms-panel .tms-brand svg{width:100%;height:100%}
      #tms-panel .tms-title{flex:1;min-width:0}
      #tms-panel .tms-title strong{display:block;font-size:14px}
      #tms-panel .tms-title small{display:block;color:var(--tms-muted);font-size:12px}
      #tms-panel button,#tms-panel .tms-file-label{font-family:inherit;font-size:13px;font-weight:600;line-height:1.4;min-height:36px;border:1px solid var(--tms-line);border-radius:var(--tms-radius);padding:6px 10px;background:var(--tms-bg);color:var(--tms-ink);cursor:pointer;text-align:center;white-space:normal;margin:0;box-shadow:none;text-transform:none;letter-spacing:normal}
      #tms-panel button:hover:enabled,#tms-panel .tms-file-label:hover{background:var(--tms-soft);border-color:#9fa7b1}
      #tms-panel button:disabled,#tms-panel .tms-disabled{opacity:.45;cursor:not-allowed}
      #tms-panel button.tms-primary{background:var(--tms-red);border-color:var(--tms-red);color:#fff;box-shadow:0 2px 6px #a9151c1a}
      #tms-panel button.tms-primary:hover:enabled{background:var(--tms-red-dark);border-color:var(--tms-red-dark);box-shadow:0 4px 12px #a9151c26}
      #tms-panel .tms-danger{color:var(--tms-red-dark)}
      #tms-panel .tms-close,#tms-panel .tms-help{width:32px;padding:2px;border-color:transparent;font-size:18px}
      #tms-panel .tms-ghost{background:var(--tms-bg)}
      #tms-panel button.tms-subtle{border-color:transparent;background:transparent;color:var(--tms-muted);font-weight:500}
      #tms-panel button.tms-subtle:hover:enabled{background:var(--tms-soft);color:var(--tms-ink);border-color:var(--tms-line)}
      #tms-panel input,#tms-panel select,#tms-panel textarea{font-family:inherit;font-size:13px;line-height:1.5;color:var(--tms-ink);border:1px solid var(--tms-line);border-radius:var(--tms-radius);background:var(--tms-bg);padding:7px 9px;min-height:32px;margin:0;max-width:100%}
      #tms-panel input[type=checkbox]{min-height:16px;width:16px;height:16px;margin:2px 0 0;accent-color:var(--tms-red);flex:none}
      #tms-panel :focus-visible,#tms-launch:focus-visible{outline:2px solid #234e86;outline-offset:2px}
      #tms-panel textarea{resize:vertical}
      #tms-panel summary{cursor:pointer}
      #tms-panel p{margin:0}
      #tms-panel b{font-weight:600}
      #tms-panel .tms-body{padding:0 16px 16px;overflow:auto;background:var(--tms-bg)}
      #tms-panel .tms-status{position:sticky;top:0;z-index:30;background:var(--tms-bg);padding:12px 0;margin-bottom:4px;border-bottom:1px solid var(--tms-line)}
      #tms-panel .tms-status-line{display:flex;align-items:center;justify-content:space-between;gap:16px;font-weight:600}
      #tms-panel .tms-progress-percent{font-size:12px;font-variant-numeric:tabular-nums;color:var(--tms-muted)}
      #tms-panel .tms-progress-track{height:4px;background:var(--tms-soft);border-radius:4px;overflow:hidden;margin:8px 0}
      #tms-panel .tms-progress-fill{height:100%;width:0;background:var(--tms-red);transition:width .2s ease}
      #tms-panel .tms-progress-detail{font-size:12px;color:var(--tms-muted)}
      #tms-panel .tms-capability-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px}
      #tms-panel .tms-capability-status{font-size:12px;font-weight:600;color:var(--tms-success)}
      #tms-panel .tms-capability-status[data-tone=waiting]{color:var(--tms-muted)}
      #tms-panel .tms-capability-status[data-tone=limited]{color:var(--tms-warning)}
      #tms-panel .tms-capability-status[data-tone=incompatible]{color:var(--tms-red-dark)}
      #tms-panel .tms-capability-recheck{min-height:28px;padding:3px 8px}
      #tms-panel .tms-capability-details,#tms-panel .tms-capability-technical{font-size:12px;color:var(--tms-muted);margin-top:4px}
      #tms-panel .tms-capability-technical div{padding:8px 0;overflow-wrap:anywhere}
      #tms-panel .tms-step{display:grid;gap:8px;padding:12px 0;border-bottom:1px solid var(--tms-line)}
      #tms-panel .tms-step-label{font-size:13px;font-weight:600;color:var(--tms-ink)}
      #tms-panel .tms-step-caption,#tms-panel .tms-muted{font-size:12px;color:var(--tms-muted)}
      #tms-panel .tms-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      #tms-panel #tms-test-tools>p,#tms-panel #tms-test-tools>.tms-row{margin-top:8px}
      #tms-panel #tms-tests-result{margin-top:8px;font-size:12px;overflow-wrap:anywhere}
      #tms-panel #tms-tests-result>p{padding:6px 0;color:var(--tms-muted)}
      #tms-panel .tms-test-check{padding:8px 0;border-top:1px solid var(--tms-line)}
      #tms-panel .tms-test-check>p{padding-top:6px;white-space:pre-wrap;color:var(--tms-muted)}
      #tms-panel .tms-file-name{font-size:12px;color:var(--tms-muted);overflow-wrap:anywhere}
      #tms-panel #tms-file{position:absolute;opacity:0;width:1px;height:1px;min-height:0;padding:0}
      #tms-panel .tms-file-label:has(+ input:focus-visible){outline:2px solid #234e86;outline-offset:2px}
      #tms-panel #tms-apply{width:100%;min-height:42px;font-size:14px}
      #tms-panel .tms-counters{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:12px 0}
      #tms-panel .tms-count{padding:8px 4px;border:1px solid var(--tms-line);border-radius:var(--tms-radius);font-size:11px;text-align:center;background:var(--tms-soft)}
      #tms-panel .tms-count b{display:block;font-size:18px;font-variant-numeric:tabular-nums;margin-top:4px}
      #tms-panel .tms-delete b{color:var(--tms-red-dark)}
      #tms-panel .tms-add b{color:var(--tms-success)}
      #tms-panel .tms-warning,#tms-panel .tms-skipped-box,#tms-panel .tms-review-note,#tms-panel .tms-fatal{margin-top:8px;padding:10px 12px;border:1px solid var(--tms-line);border-radius:var(--tms-radius);background:var(--tms-soft);font-size:12px;overflow-wrap:anywhere}
      #tms-panel .tms-warning,#tms-panel .tms-skipped-box{border-left:3px solid var(--tms-warning)}
      #tms-panel .tms-fatal{border-left:3px solid var(--tms-red);color:var(--tms-red-dark)}
      #tms-panel .tms-skip-line{padding:8px 0;border-top:1px solid var(--tms-line)}
      #tms-panel .tms-skip-more{padding-top:8px}
      #tms-panel .tms-action{margin:8px 0;border:1px solid var(--tms-line);border-radius:var(--tms-radius);background:var(--tms-bg)}
      #tms-panel .tms-action summary{padding:10px 12px}
      #tms-panel .tms-action-body{padding:0 12px 12px}
      #tms-panel .tms-review-row-actions{display:flex;gap:8px;flex-wrap:wrap;padding:4px 0 8px}
      #tms-panel .tms-review-state{font-size:12px;color:var(--tms-muted)}
      #tms-panel .tms-review-btn[aria-pressed=true]{background:#e9edf1}
      #tms-panel .tms-review-row-excluded{background:var(--tms-soft)}
      #tms-panel .tms-diff{padding:10px 0;border-top:1px solid var(--tms-line)}
      #tms-panel .tms-diff-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:8px}
      #tms-panel .tms-diff-head b{flex:1;overflow-wrap:anywhere}
      #tms-panel .tms-diff-head button{flex:none}
      #tms-panel .tms-diff-values{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}
      #tms-panel .tms-diff-values>div{padding:8px;border-radius:4px;background:var(--tms-soft);overflow-wrap:anywhere;white-space:pre-line}
      #tms-panel .tms-diff-values small{display:block;color:var(--tms-muted);font-size:11px;margin-bottom:4px}
      #tms-panel .tms-after{color:var(--tms-success)}
      #tms-panel .tms-value{display:block;white-space:pre-wrap;overflow-wrap:anywhere}
      #tms-panel .tms-value+.tms-value{margin-top:5px;padding-top:5px;border-top:1px solid var(--tms-line)}
      #tms-panel .tms-diff-excluded .tms-diff-values{text-decoration:line-through;color:var(--tms-muted)}
      #tms-panel .tms-preview-toolbar{display:grid;gap:8px;margin:12px 0}
      #tms-panel .tms-preview-filters{display:flex;gap:4px;flex-wrap:wrap}
      #tms-panel .tms-preview-filter.tms-active{border-color:var(--tms-red);color:var(--tms-red-dark)}
      #tms-panel .tms-preview-query{width:100%}
      #tms-panel .tms-preview-package{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px;background:var(--tms-soft);border-radius:var(--tms-radius)}
      #tms-panel .tms-preview-package strong{font-size:12px}
      #tms-panel .tms-preview-package span{flex-basis:100%;font-size:12px;color:var(--tms-muted)}
      #tms-panel .tms-preview-pager{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--tms-muted);font-size:12px}
      #tms-panel .tms-empty{padding:16px;color:var(--tms-muted);text-align:center}
      #tms-panel .tms-tools{padding:12px 0;border-bottom:1px solid var(--tms-line)}
      #tms-panel .tms-tool-list{display:grid;gap:12px;padding-top:12px}
      #tms-panel .tms-tool-list p{margin:4px 0 0;color:var(--tms-muted);font-size:12px}
      #tms-panel .tms-package-details>summary{font-size:12px;color:var(--tms-muted)}
      #tms-panel .tms-operation-status:has(.tms-status-line:not([hidden])){margin-top:10px}
      #tms-panel .tms-capability-technical button{margin-top:8px}
      #tms-panel .tms-help-card{display:none;margin:12px 0;padding:12px;border:1px solid var(--tms-line);border-radius:var(--tms-radius);background:var(--tms-soft)}
      #tms-panel .tms-help-card.tms-show{display:block}
      #tms-panel .tms-help-card h3{font-size:14px;margin:0 0 12px}
      #tms-panel .tms-help-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      #tms-panel .tms-help-item b{display:block;margin-bottom:4px}
      #tms-panel .tms-help-note{margin:12px 0}
      #tms-panel .tms-help-close{width:100%}
      #tms-panel .tms-merge-conflict{background:#fff3c4;border:1px solid #b38b1a;padding:12px;margin:10px 0;color:#242424}
      #tms-panel .tms-merge-conflict label{display:block;margin:8px 0;overflow-wrap:anywhere}
      #tms-panel .tms-picker{display:grid;gap:8px;margin:12px 0;padding:12px;border:1px solid var(--tms-line);border-radius:var(--tms-radius)}
      #tms-panel .tms-picker-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
      #tms-panel .tms-picker-results{max-height:240px;overflow:auto;border:1px solid var(--tms-line);border-radius:4px}
      #tms-panel .tms-picker-option{display:flex;gap:8px;align-items:flex-start;padding:8px;cursor:pointer;border-bottom:1px solid var(--tms-line);overflow-wrap:anywhere}
      #tms-panel .tms-picker-option:last-child{border-bottom:0}
      #tms-panel .tms-picker-option:hover{background:var(--tms-soft)}
      #tms-panel .tms-picker-selected{display:flex;flex-wrap:wrap;gap:4px;max-height:140px;overflow:auto}
      #tms-panel .tms-picker-selected button{font-weight:400}
      #tms-panel .tms-reconciliation-result[data-status=verified]{color:var(--tms-success)}
      #tms-panel .tms-reconciliation-result[data-status=divergent]{color:var(--tms-red-dark)}
      #tms-panel .tms-reconciliation-result[data-status=incomplete]{color:var(--tms-warning)}
      @media(max-width:650px){#tms-panel{right:8px;bottom:76px;width:calc(100vw - 16px);max-height:calc(100vh - 92px)}
      #tms-launch{right:12px;bottom:12px}
      #tms-panel .tms-body{padding:0 12px 12px}
      #tms-panel .tms-counters{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:400px){#tms-panel .tms-diff-values{grid-template-columns:1fr}
      #tms-panel .tms-help-grid{grid-template-columns:1fr}}
      /* Animate only explicit interaction: opening, pressing and hover. No
         repeating decorative motion or expensive per-row animation on render. */
      #tms-panel button,#tms-panel .tms-file-label,#tms-launch{transition:background-color .14s ease,border-color .14s ease,box-shadow .14s ease,transform .14s ease}
      #tms-panel button:active:enabled,#tms-panel .tms-file-label:active{transform:translateY(1px)}
      #tms-panel .tms-help-card.tms-show{animation:tms-reveal .16s ease-out}
      @keyframes tms-enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      @keyframes tms-reveal{from{opacity:0}to{opacity:1}}
      @media(prefers-reduced-motion:reduce){#tms-panel,#tms-panel *,#tms-launch{animation:none!important;transition:none!important;transform:none!important}}
    `;
    document.head.appendChild(style);

    const launch = document.createElement('button');
    launch.id = 'tms-launch';
    launch.innerHTML = cherkizovoLogoSvg();
    launch.title = 'TESSA Matrix Studio';
    launch.setAttribute('aria-label', 'Открыть TESSA Matrix Studio');
    document.body.appendChild(launch);

    const panel = document.createElement('section');
    panel.id = 'tms-panel';
    panel.innerHTML = `
      <div class="tms-head" id="tms-drag-handle">
        <div class="tms-brand">${cherkizovoLogoSvg()}</div>
        <div class="tms-title"><strong>TESSA Matrix Studio</strong><small>Excel-редактор матриц · v${APP.version}</small></div>
        <button class="tms-help" aria-label="Как пользоваться" title="Как пользоваться">?</button><button class="tms-close" aria-label="Закрыть Studio" title="Закрыть">×</button>
      </div>
      <div class="tms-body">
        <div id="tms-help-card" class="tms-help-card">
          <h3>Как пользоваться TESSA Matrix Studio</h3>
          <div class="tms-help-grid">
            <div class="tms-help-item"><b>Изменить</b>Отредактируйте ячейки существующей строки.</div>
            <div class="tms-help-item"><b>Добавить</b>Вставьте копию в новую строку или создайте новую строку.</div>
            <div class="tms-help-item"><b>Заменить</b>Если вставить копию поверх другой строки, Studio обновит затёртую строку по её позиции.</div>
            <div class="tms-help-item"><b>Удалить</b>Удалите существующую строку Excel целиком.</div>
          </div>
          <div class="tms-help-note"><b>Важно:</b> сначала нажмите «Проверить изменения» и убедитесь, что список операций соответствует тому, что вы сделали в Excel.</div>
          <button id="tms-help-close" class="tms-help-close">Понятно</button>
        </div>
        <div id="tms-status" class="tms-status">
          <div class="tms-capability-row"><span id="tms-capability-status" class="tms-capability-status" data-tone="limited">Подключаемся к матрице</span></div>
          <div id="tms-capability-details" class="tms-capability-details">Подключение обновляется автоматически.</div>
          <details class="tms-capability-technical" hidden><summary>Подключение</summary><div id="tms-capability-diagnostics"></div><button id="tms-capability-recheck" type="button">Проверить подключение</button></details>
          <div class="tms-operation-status" aria-live="polite" aria-atomic="true"><div class="tms-status-line" hidden><span id="tms-progress-label">Готово</span><span id="tms-progress-percent" class="tms-progress-percent">0%</span></div><div class="tms-progress-track" hidden><div id="tms-progress-fill" class="tms-progress-fill"></div></div><div id="tms-progress-detail" class="tms-progress-detail"></div></div>
        </div>
        <div class="tms-controls">
          <details class="tms-start-help"><summary>Перед началом работы</summary><p>В TESSA создайте черновик матрицы и перейдите в редактирование. Затем скачайте Excel: справочники при каждой выгрузке читаются заново.</p><p>Удалить строку: удалить её целиком в Excel. Удалить отдельное значение: очистить ячейку или убрать элемент списка. Полностью очищенная строка с сохранёнными служебными полями будет показана как пропущенная. При одновременном удалении и добавлении пометьте новые строки действием «Добавить».</p><p>Можно вводить полное название вручную. Однозначный фрагмент сопоставляется при проверке; неоднозначный требует уточнения. Автодополнение выпадающих списков зависит от версии Excel. Поиск в «Собрать значения» доступен независимо от неё.</p></details><div class="tms-step"><div class="tms-step-label">1 · Файл для редактирования</div><div class="tms-row"><button id="tms-download-current">Скачать Excel</button><button type="button" id="tms-open-picker" aria-controls="tms-value-picker" aria-expanded="false" title="Несколько значений для одной ячейки">Собрать значения</button></div><section id="tms-value-picker" class="tms-picker" aria-label="Выбор значений для Excel" hidden></section></div>
          <div class="tms-step"><div class="tms-step-label">2 · Изменённый файл</div><div class="tms-row"><label for="tms-file" class="tms-file-label">Выбрать Excel</label><input id="tms-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div><div id="tms-file-name" class="tms-file-name">Файл не выбран</div></div>
          <details class="tms-tools"><summary>Дополнительно</summary><div class="tms-tool-list">
            <div><button id="tms-download-fresh">Обновить справочники в моём Excel</button><p>Выберите изменённый файл в шаге 2. Скачается его копия с новыми справочниками; ваши строки и правки сохранятся.</p></div>
            <div><button id="tms-refresh-excel" disabled>Объединить с актуальной TESSA</button><p>Добавить новые поля и изменения других пользователей. Совпавшие правки объединяются; конфликты покажем для выбора. В старых книгах без исходных значений объединение ограничено.</p></div>
            <button id="tms-download-report" hidden disabled>Скачать отчёт</button>
            <details id="tms-test-tools"><summary>Проверки и диагностика</summary>
              <p>Проверка матрицы и Excel без сохранения строк. Пакет содержит рабочие значения, запросы и ответы TESSA.</p>
              <div class="tms-row"><button id="tms-run-tests" type="button">Запустить проверки</button><button id="tms-download-diagnostics" type="button">Скачать пакет диагностики</button></div>
              <details><summary>Проверка с записью</summary><p>Сначала проверьте Excel и выберите операции в Preview. Кнопка применяет именно эти изменения после обычного подтверждения, затем перечитывает результат. Для испытаний используйте отдельный тестовый черновик. Добавление, изменение и удаление проверяются только если есть в выбранном наборе.</p><button id="tms-test-write" type="button">Применить выбранное и проверить запись</button></details><div id="tms-tests-result" role="status" aria-live="polite">Проверки ещё не запускались.</div>
            </details>
          </div></details>
          <section id="tms-merge-conflicts" hidden aria-label="Конфликты объединения"></section><div class="tms-step"><div class="tms-step-label">3 · Проверка</div><div class="tms-row"><button id="tms-analyze" class="tms-primary" disabled>Проверить изменения</button><button id="tms-stop" hidden disabled>Отмена</button></div></div>
          <div id="tms-apply-section" class="tms-step tms-step-apply" hidden><div class="tms-step-label">4 · Применение</div><button id="tms-apply" class="tms-primary" disabled>Применить к TESSA</button><div id="tms-apply-note" class="tms-step-caption"></div><button id="tms-reconcile" hidden disabled>Проверить результат</button><div id="tms-reconciliation-result" class="tms-step-caption tms-reconciliation-result"></div><div class="tms-row"><button id="tms-refresh-view" hidden disabled>Обновить отображение</button></div></div>
        </div>
        <div id="tms-summary"></div><div id="tms-plan"></div>
      </div>`;
    document.body.appendChild(panel);

    const togglePanel = () => { panel.classList.toggle('tms-open'); APP.runtimeMonitor?.tick(); };
    const clampLauncher = (left, top) => {
      const rect = launch.getBoundingClientRect();
      const maxLeft = Math.max(6, window.innerWidth - rect.width - 6);
      const maxTop = Math.max(6, window.innerHeight - rect.height - 6);
      return { left: Math.min(Math.max(6, left), maxLeft), top: Math.min(Math.max(6, top), maxTop) };
    };
    const saveLauncherPosition = position => { try { localStorage.setItem('TMS_LAUNCH_POSITION_V1', JSON.stringify(position)); } catch (_) {} };
    const setLauncherPosition = (left, top, persist = false) => {
      const pos = clampLauncher(left, top);
      launch.style.left = `${pos.left}px`; launch.style.top = `${pos.top}px`; launch.style.right = 'auto'; launch.style.bottom = 'auto';
      if (persist) saveLauncherPosition(pos);
      return pos;
    };
    try {
      const saved = JSON.parse(localStorage.getItem('TMS_LAUNCH_POSITION_V1') || 'null');
      if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) setLauncherPosition(saved.left, saved.top, false);
    } catch (_) {}
    let launchDrag = null;
    let suppressLaunchClick = false;
    launch.addEventListener('pointerdown', event => {
      if (event.button !== undefined && event.button !== 0) return;
      const rect = launch.getBoundingClientRect();
      launchDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, moved: false };
      launch.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    launch.addEventListener('pointermove', event => {
      if (!launchDrag || event.pointerId !== launchDrag.pointerId) return;
      const dx = event.clientX - launchDrag.startX;
      const dy = event.clientY - launchDrag.startY;
      if (!launchDrag.moved && Math.hypot(dx, dy) >= 5) launchDrag.moved = true;
      if (launchDrag.moved) setLauncherPosition(launchDrag.left + dx, launchDrag.top + dy, false);
    });
    const finishLaunchPointer = event => {
      if (!launchDrag || event.pointerId !== launchDrag.pointerId) return;
      const moved = launchDrag.moved;
      try { launch.releasePointerCapture?.(event.pointerId); } catch (_) {}
      launchDrag = null;
      if (moved) {
        const rect = launch.getBoundingClientRect();
        setLauncherPosition(rect.left, rect.top, true);
        suppressLaunchClick = true;
      }
    };
    launch.addEventListener('pointerup', finishLaunchPointer);
    launch.addEventListener('pointercancel', finishLaunchPointer);
    launch.addEventListener('click', event => {
      if (suppressLaunchClick) { suppressLaunchClick = false; event.preventDefault(); return; }
      togglePanel();
    });
    window.addEventListener('resize', () => {
      if (launch.style.left) { const rect = launch.getBoundingClientRect(); setLauncherPosition(rect.left, rect.top, true); }
    });

    panel.querySelector('.tms-close').addEventListener('click', () => panel.classList.remove('tms-open'));
    const helpCard = panel.querySelector('#tms-help-card');
    panel.querySelector('.tms-help').addEventListener('click', () => helpCard?.classList.toggle('tms-show'));
    panel.querySelector('#tms-help-close').addEventListener('click', () => helpCard?.classList.remove('tms-show'));
    panel.querySelector('#tms-stop').addEventListener('click', requestApplyAbort);
    panel.querySelector('#tms-capability-recheck').addEventListener('click', () => {
      if (APP.busy) return;
      const effectiveActions = APP.plan ? buildReviewedPlan(APP.plan, APP.review).actions : [];
      refreshRuntimeCapabilities(effectiveActions);
    });
    panel.querySelector('#tms-file').addEventListener('change', event => {
      resetFilePreview();
      closeValuePicker();
      const file = event.target.files?.[0]; panel.querySelector('#tms-file-name').textContent = file?.name || 'Файл не выбран'; panel.querySelector('#tms-refresh-excel').disabled = !file && !APP.workbook?.roundtrip?.enabled;
      setProgress(0, 'Готово', '');
      APP.runtimeMonitor?.tick();
    });

    panel.querySelector('#tms-open-picker').addEventListener('click', async () => {
      if (APP.busy) return;
      setBusy(true);
      try { await openValuePicker(); }
      catch (error) { setProgress(100, 'Выбор значений недоступен', friendlyErrorMessage(error)); }
      finally { setBusy(false); if (APP.picker) renderPickerResults(); }
    });

    panel.querySelector('#tms-download-current').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { requireRuntimeOperation('export'); await exportCurrentMatrixXlsx();  }
      catch (error) { const message = friendlyErrorMessage(error); log(message, 'error', error); setProgress(100, 'Не удалось скачать Excel', message); }
      finally { setBusy(false); }
    });
    panel.querySelector('#tms-download-fresh').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { requireRuntimeOperation('export'); await refreshSelectedWorkbookDictionaries(panel.querySelector('#tms-file').files?.[0]);  }
      catch (error) { const message = friendlyErrorMessage(error); log(message, 'error', error); setProgress(100, 'Не удалось обновить справочники', message); }
      finally { setBusy(false); }
    });
    panel.querySelector('#tms-refresh-excel').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { const selectedFile = panel.querySelector('#tms-file').files?.[0]; if (selectedFile) await refreshSelectedWorkbook(selectedFile); else await refreshLoadedWorkbookXlsx(); setProgress(100, 'Поля Excel обновлены', 'Проверьте новую книгу перед применением.'); }
      catch (error) { const message = friendlyErrorMessage(error); log(message, 'error', error); setProgress(100, 'Не удалось обновить поля Excel', message); }
      finally { setBusy(false); }
    });
    panel.querySelector('#tms-analyze').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { requireRuntimeOperation('analyze'); await analyzeSelectedFile(panel.querySelector('#tms-file').files?.[0]); }
      catch (error) { const message = friendlyErrorMessage(error); log(message, 'error', error); setProgress(100, 'Проверка не завершена', message); }
      finally { setBusy(false); }
    });
    panel.querySelector('#tms-download-report').addEventListener('click', () => { downloadLastReport(); });
    panel.querySelector('#tms-run-tests').addEventListener('click', () => runStudioDiagnostics());
    panel.querySelector('#tms-download-diagnostics').addEventListener('click', () => runStudioDiagnostics(true));
    panel.querySelector('#tms-reconcile').addEventListener('click', async () => {
      if (APP.busy || !APP.lastMutationReceipts?.receipts?.length) return;
      setBusy(true);
      try {
        requireRuntimeOperation('reconcile');
        setProgress(20, 'Проверяю результат', 'Сверяем сохранённые значения');
        APP.lastReconciliation = await runReconciliationRead(
          () => TessaBridge.create(),
          APP.lastMutationReceipts,
          { attempts: 3, baseDelayMs: 450 },
        );
        renderReconciliationResult(APP.lastReconciliation);
        setProgress(100, 'Проверка результата завершена', reconciliationSummary(APP.lastReconciliation));
      } catch (error) {
        const retryable = isWriterLockError(error);
        APP.lastReconciliation = {
          status: 'incomplete',
          checkedCount: 0,
          verifiedCount: 0,
          divergentCount: 0,
          missingCount: 0,
          unknownCount: APP.lastMutationReceipts?.receipts?.length || 0,
          rows: [],
          attempts: 0,
          retryable,
          reasonCode: retryable ? 'reconcile-writer-lock' : 'reconcile-read-failed',
        };
        renderReconciliationResult(APP.lastReconciliation);
        setProgress(100, 'Проверка результата не завершена', reconciliationSummary(APP.lastReconciliation));
      } finally {
        setBusy(false);
      }
    });
    panel.querySelector('#tms-refresh-view').addEventListener('click', async () => {
      if (APP.busy) return;
      setBusy(true);
      try {
        const bridge = await TessaBridge.create();
        const outcome = await refreshNativeMatrixViewAfterApply(bridge, { attempts: 3, baseDelayMs: 450 });
        if (!outcome.ok) throw new Error(outcome.error || 'Не удалось обновить отображение TESSA.');
        const button = panel.querySelector('#tms-refresh-view');
        if (button) { button.hidden = true; setControlDisabled(button, true); }
        setProgress(100, 'Отображение обновлено', outcome.controlName || 'Матрица TESSA обновлена');
      } catch (error) {
        const message = friendlyErrorMessage(error);
        log(message, 'error', error);
        setProgress(100, 'Не удалось обновить отображение', 'Запись в TESSA не отменяется; можно повторить позже.');
        setProgress(100, 'Не удалось обновить отображение', message);
      } finally { setBusy(false); }
    });
    const applySelected = async (verifyWrites = false) => {
      if (APP.busy) return;
      const availability = applyAvailability(APP.plan, APP.review);
      if (!availability.canApply) {
        setProgress(100, 'Применение недоступно', availability.reason || 'Нет операций для применения.');
        return;
      }
      setBusy(true);
      try {
        const reviewedPlan = buildReviewedPlan(APP.plan, APP.review);
        requireRuntimeOperation('apply', reviewedPlan.actions);
        const result = await applyPlan(reviewedPlan);
        if (result && verifyWrites && APP.lastMutationReceipts?.receipts?.length && !APP.abortRequested) {
          setProgress(97, 'Проверяю запись', 'Перечитываю изменённые, добавленные и удалённые строки');
          try {
            APP.lastReconciliation = await runReconciliationRead(() => TessaBridge.create(), APP.lastMutationReceipts, { attempts: 3, baseDelayMs: 450 });
            result.reconciliation = APP.lastReconciliation;
          } catch (error) { result.reconciliation = { status: 'incomplete', reason: friendlyErrorMessage(error) }; }
          APP.lastReconciliation = result.reconciliation;
          rememberReport(result, `TESSA_Write_Check_${Date.now()}.json`);
          setProgress(100, 'Проверка записи завершена', reconciliationSummary(APP.lastReconciliation));
        }
        if (result) {
          invalidatePlanStateAfterApply(APP, result);
          renderPlanConsumedNotice(result);
          renderReconciliationResult(APP.lastReconciliation);
          updateReconciliationControlState();
        }
      }
      catch (error) {
        const message = friendlyErrorMessage(error); log(message, 'error', error);
        rememberReport({ app: { name: APP.name, version: APP.version }, planId: APP.plan?.id, failedAt: nowIso(), error: message, technicalError: error?.message || String(error), matrixId: APP.plan?.matrixId || null, logs: APP.logs.slice(-120) }, `TESSA_Matrix_ErrorReport_${Date.now()}.json`);
        setProgress(100, 'Применение не завершено', `${message} Подробности — в отчёте.`);
      } finally { setBusy(false); }
    };
    panel.querySelector('#tms-apply').addEventListener('click', () => applySelected(false));
    panel.querySelector('#tms-test-write').addEventListener('click', () => applySelected(true));
    refreshRuntimeCapabilities([]);
    APP.runtimeMonitor = createRuntimeMonitor({
      active: () => panel.classList.contains('tms-open') && document.visibilityState !== 'hidden' && !APP.busy,
      check: () => refreshRuntimeCapabilities(),
    });
    APP.runtimeMonitor.start();
    window.addEventListener('pagehide', () => APP.runtimeMonitor?.stop());
    window.addEventListener('pageshow', () => APP.runtimeMonitor?.start());
    document.addEventListener('visibilitychange', () => APP.runtimeMonitor?.tick());
  }


  async function bootstrap() {
    if (window.__TESSA_MATRIX_SYNC_TEST_MODE__) return;
    for (let i = 0; i < 90; i += 1) {
      if (window.tessa?.apiLoader && Array.isArray(window.webpackChunktessa_web_extensions)) {
        mountUi();
        log('Скрипт загружен.');
        return;
      }
      await sleep(1000);
    }
    console.warn('[TESSA Matrix Studio] Не удалось обнаружить среду TESSA на текущей странице.');
  }

  window.__TESSA_MATRIX_SYNC_EXPORTS__ = {
    applyIntervalStructuralProbe, collectIntervalDiagnostics, collectStudioDiagnostics, makeStudioDiagnosticPackage,
    createRuntimeMonitor, pickerColumns, pickerEntryKey, searchPickerEntries, pickerSelectionText,
    probeRuntimeEnvironment, inspectNativeViewCapabilitiesReadOnly, inspectMatrixCapabilitiesReadOnly,
    evaluateRuntimeCapabilities, capabilityOperationAvailability, humanCapabilityBlocker, capabilityStatusModel,
    normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent, yieldToMain, estimateRemainingMs, formatEtaMs, workProgressDetail, rememberReport, downloadLastReport, reconciliationSummary, renderReconciliationResult, sanitizeSupportReport,
    sortedCanon, arraysEqual, hashText, fingerprintFlat, similarityFlat,
    readXlsxArrayBuffer, parseSheetXml, buildColumnMap, workbookRowsToDesired, buildPlan,
    buildRoundtripGrid, createRoundtripXlsxBytes, refreshWorkbookDictionaries, preserveWorkbookSelectors, mergeWorkbookIntoCurrentSnapshot, prepareThreeWayMerge, mergeWorkbookEditsIntoSnapshot, parseSchemaToken, normalizeAction, cherkizovoLogoSvg, issueExcelRows, makeSkippedRow,
    parseBoolean, parseRange, headerSimilarity, countActions, matrixStateCaption, operandKind, typedScalarSemantic, typedRangeSemantic, reconciliationSemanticKey, createMutationReceipt, indexSnapshotForReconciliation, reconcileMutationReceipts, runReconciliationRead, deletionGuard, evaluateApplyBatch, applyAvailability, previewPreflightPolicy, isWriterLockError, refreshNativeMatrixViewAfterApply, finalizeApplyResult, applyResultMessage,
    createPlanReviewState, invalidatePlanStateAfterApply, keepReviewedPackage, planReviewActionKey, setPlanReviewChange, setPlanReviewRow, buildReviewedPlan, createPreviewViewState, selectPreviewItems,
    pickExactReferenceFromViewResult, uniqueReferenceMatches, isGuidLike,
    safePlain, suppressPlanForUnsafeContext, evaluatePlanSafety, resultingRoleCountForAction, matrixNameSimilarity,
    preflightPlan, applyPreflightPreview, applyPlan, requestApplyAbort, hydrateMissingIdsForAction, nativeEditAccessState, assertNativeEditMode, isWritableMatrixDraft, assertWritableMatrixDraft,
    finalizeDictionaryEntries, dictionaryLookup, resolveEmbeddedDictionaryValue, normalizeDictionaryCatalog, searchCanonical, booleanSemantic, booleanDisplay, humanQualifierFromDetails, detectPlanDuplicateConflicts, friendlyErrorMessage,
    dictionaryStructureSignature, dictionaryCacheKey, readDictionaryCache, writeDictionaryCache, deleteDictionaryCache, mergeSnapshotIntoDictionaryCatalog, compactPlanForExport,
    TessaBridge,
    constants: { OPERAND, REQUEST, S, F, ROUNDTRIP, DICTIONARY_CACHE, PERFORMANCE },
  };

  bootstrap();
})();
