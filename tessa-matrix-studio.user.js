// ==UserScript==
// @name         TESSA Matrix Studio — Черкизово
// @namespace    https://github.com/ShapArt/tessa-matrix-studio
// @version      1.9.9
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
// @updateURL    https://cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/ShapArt/tessa-matrix-studio@main/tessa-matrix-studio.user.js
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
    version: '1.9.9',
    plan: null,
    workbook: null,
    snapshot: null,
    structure: null,
    bridge: null,
    busy: false,
    abortRequested: false,
    logs: [],
    dictionaryCatalog: null,
    progress: { percent: 0, label: 'Готово', detail: '' },
  };

  const ROUNDTRIP = Object.freeze({
    Format: 'TESSA_MATRIX_ROUNDTRIP_V5',
    AcceptedFormats: ['TESSA_MATRIX_ROUNDTRIP_V1', 'TESSA_MATRIX_ROUNDTRIP_V2', 'TESSA_MATRIX_ROUNDTRIP_V3', 'TESSA_MATRIX_ROUNDTRIP_V4', 'TESSA_MATRIX_ROUNDTRIP_V5'],
    DictionarySheet: 'Словари',
    StructureSheet: 'Структура',
    SchemaChangesSheet: 'Изменения структуры',
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
    PreviewSnapshotTtlMs: 15 * 60 * 1000,
    ZipConcurrency: 4,
  });


  // Индексы справочников живут только в памяти вкладки. Они не сериализуются в Excel,
  // зато превращают точный поиск по ID/названию из O(N) на каждую ячейку в O(1).
  const DICTIONARY_LOOKUP_CACHE = new WeakMap();
  const NORMALIZED_DICTIONARY_CATALOGS = new WeakSet();

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

  async function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Браузер не поддерживает DecompressionStream. Нужен актуальный Chrome/Edge.');
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzipArrayBuffer(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const eocd = findEocd(bytes);
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');
    const descriptors = [];

    for (let index = 0; index < count; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Повреждён центральный каталог XLSX.');
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength));
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`Повреждён файл ${name} в XLSX.`);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      descriptors.push({ name: name.replace(/^\//, ''), method, compressed: bytes.slice(dataStart, dataStart + compressedSize) });
      offset += 46 + nameLength + extraLength + commentLength;
    }

    const decoded = await mapConcurrent(descriptors, PERFORMANCE.ZipConcurrency, async descriptor => {
      let raw;
      if (descriptor.method === 0) raw = descriptor.compressed;
      else if (descriptor.method === 8) raw = await inflateRaw(descriptor.compressed);
      else throw new Error(`Неподдерживаемый метод сжатия ${descriptor.method} в ${descriptor.name}.`);
      return [descriptor.name, raw];
    });
    return new Map(decoded);
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const items = [];
    for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
      const parts = [...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(x => xmlDecode(x[1]));
      items.push(parts.join(''));
    }
    return items;
  }

  function parseWorkbookSheets(entries, decoder) {
    const workbook = decoder.decode(entries.get('xl/workbook.xml') || new Uint8Array());
    const rels = decoder.decode(entries.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
    const relationships = new Map();
    for (const match of rels.matchAll(/<Relationship\b([^>]*)\/?\s*>/gi)) {
      const id = attr(match[1], 'Id');
      const target = attr(match[1], 'Target');
      if (id && target) relationships.set(id, target);
    }
    const sheets = [];
    for (const match of workbook.matchAll(/<sheet\b([^>]*)\/?\s*>/gi)) {
      const sheetName = attr(match[1], 'name') || `Лист${sheets.length + 1}`;
      const relId = attr(match[1], 'r:id') || attr(match[1], 'id');
      const target = relationships.get(relId) || `worksheets/sheet${sheets.length + 1}.xml`;
      const normalized = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
      sheets.push({ name: sheetName, path: normalized.replace(/\/\.\//g, '/'), relId });
    }
    return sheets.length ? sheets : [{ name: 'Лист1', path: 'xl/worksheets/sheet1.xml', relId: 'rId1' }];
  }

  function parseSheetXml(xml, sharedStrings) {
    const rows = [];
    let maxCol = 0;
    for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
      const rowNumber = Number(attr(rowMatch[1], 'r') || rows.length + 1);
      const values = [];
      const body = rowMatch[2];
      // В Excel пустая ячейка часто сериализуется как <c .../>. Старый regex
      // ошибочно склеивал её со следующей ячейкой и показывал индекс sharedStrings
      // (например 102/118) вместо реального значения. Обрабатываем оба варианта.
      const cellRegex = /<c\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/c>)/gi;
      for (const cellMatch of body.matchAll(cellRegex)) {
        const attrs = cellMatch[1] || '';
        const cellBody = cellMatch[2] || '';
        const ref = attr(attrs, 'r') || 'A1';
        const col = colToIndex(ref);
        const type = attr(attrs, 't') || '';
        let value = '';
        const inline = cellBody.match(/<is\b[^>]*>([\s\S]*?)<\/is>/i);
        if (inline) value = [...inline[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map(x => xmlDecode(x[1])).join('');
        else {
          const v = cellBody.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i);
          if (v) {
            const raw = xmlDecode(v[1]);
            value = type === 's' ? (sharedStrings[Number(raw)] ?? '') : raw;
          }
        }
        values[col] = value;
        maxCol = Math.max(maxCol, col + 1);
      }
      rows[rowNumber - 1] = values;
    }
    for (let i = 0; i < rows.length; i += 1) rows[i] = rows[i] || [];
    return { rows, maxCol };
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
        selector: normalizeSpace(row['Выбор в Excel']),
        display: normalizeSpace(row['Отображение']),
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

  async function readXlsxArrayBuffer(arrayBuffer, fileName = 'matrix.xlsx') {
    const entries = await unzipArrayBuffer(arrayBuffer);
    const decoder = new TextDecoder('utf-8');
    const shared = parseSharedStrings(entries.has('xl/sharedStrings.xml') ? decoder.decode(entries.get('xl/sharedStrings.xml')) : '');
    const sheetDescriptors = parseWorkbookSheets(entries, decoder);
    const parsedSheets = new Map();
    for (const descriptor of sheetDescriptors) {
      const raw = entries.get(descriptor.path);
      if (!raw) continue;
      parsedSheets.set(descriptor.name, parseSheetXml(decoder.decode(raw), shared));
    }
    const matrixDescriptor = sheetDescriptors.find(item => canonicalValue(item.name) === canonicalValue('Матрица')) || sheetDescriptors[0];
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
      if (values.some(v => normalizeSpace(v))) data.push({ excelRow: r + 1, values });
    }
    const format = metadata[ROUNDTRIP.FormatKey] || null;
    return {
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
      },
    };
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
      let display = normalizeSpace(source.display);
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
      if (group.length === 1) {
        group[0].selector = group[0].display;
        group[0].status = group[0].status || 'Доступно';
        continue;
      }
      const used = new Map();
      for (const item of group) {
        const qualifier = normalizeSpace(item.qualifier || humanQualifierFromDetails(item.details, item.display));
        let selector = qualifier ? `${item.display} — ${qualifier}` : item.display;
        const canonical = canonicalValue(selector);
        const n = (used.get(canonical) || 0) + 1;
        used.set(canonical, n);
        if (n > 1 || !qualifier) selector = `${selector}${qualifier ? '' : ' — вариант'} ${n}`;
        item.selector = selector;
        item.status = item.status || 'Доступно';
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
    for (const item of Object.values(catalog.catalogs || {})) item.entries = finalizeDictionaryEntries(item.entries || []);
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
      templateId: canonicalValue(structure?.templateId),
      conditions: (structure?.conditions || []).map(item => [
        canonicalValue(item.criterionRowId), canonicalValue(item.operandTypeId),
        canonicalValue(item.autocompleteViewName || item.refSection), canonicalValue(item.autocompleteParamName),
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
     * конкретный каталог, в котором действительно отсутствует текущее значение.
     */
    const base = normalizeDictionaryCatalog(sourceCatalog || { catalogs: {}, columnCatalogIds: {}, stats: { errors: [] } });
    const extrasByCatalog = new Map();
    const pendingIdentity = new Map();

    const appendIfMissing = (catalogId, entry) => {
      const target = base.catalogs?.[catalogId];
      if (!target || entry?.id === null || entry?.id === undefined || entry?.id === '') return;
      const id = canonicalValue(entry.id);
      const roleTypeId = entry.roleTypeId === null || entry.roleTypeId === undefined ? '' : canonicalValue(entry.roleTypeId);
      const lookup = dictionaryLookup(target);
      // Для ролей RoleTypeID является частью идентичности. Совпадение того же GUID
      // под другим типом роли нельзя считать эквивалентным текущему значению.
      const existing = roleTypeId
        ? (lookup?.byId?.get(`${id}|${roleTypeId}`) || [])
        : (lookup?.byId?.get(`${id}|`) || []);
      if (existing.length) return;

      if (!pendingIdentity.has(catalogId)) pendingIdentity.set(catalogId, new Set());
      const identity = `${id}|${roleTypeId}`;
      if (pendingIdentity.get(catalogId).has(identity)) return;
      pendingIdentity.get(catalogId).add(identity);
      if (!extrasByCatalog.has(catalogId)) extrasByCatalog.set(catalogId, []);
      extrasByCatalog.get(catalogId).push(entry);
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
            appendIfMissing(catalogId, {
              id: semantic ? 'true' : 'false', display: semantic ? 'Да' : 'Нет', value: semantic,
              kind: 'Boolean', source: 'Boolean', status: 'Текущее значение', roleTypeId: '',
            });
          } else {
            appendIfMissing(catalogId, {
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
          appendIfMissing(catalogId, {
            id: String(item.id ?? ''), display: item.display, roleTypeId: item.roleTypeId,
            source: 'Текущая матрица', status: 'Текущее значение',
          });
        }
      }
    }

    // В типичном roundtrip все текущие значения уже есть в каталоге: возвращаем
    // исходный объект без 30–40 тыс. глубоких копирований и повторных сортировок.
    if (!extrasByCatalog.size) return base;

    const merged = {
      ...base,
      catalogs: { ...(base.catalogs || {}) },
      columnCatalogIds: { ...(base.columnCatalogIds || {}) },
      stats: { ...(base.stats || {}), errors: [...(base.stats?.errors || [])] },
    };
    for (const [catalogId, extras] of extrasByCatalog.entries()) {
      const source = base.catalogs[catalogId];
      merged.catalogs[catalogId] = {
        ...source,
        entries: finalizeDictionaryEntries([...(source.entries || []), ...extras]),
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
        append(byId, `${id}|`, item);
      }
      append(bySelector, canonicalValue(item.selector), item);
      append(byDisplay, canonicalValue(item.display), item);
      searchRows.push({
        item,
        haystack: searchCanonical(`${item.selector || ''} ${item.display || ''} ${item.qualifier || ''} ${item.searchText || ''} ${item.details || ''}`),
      });
    }

    const isBoolean = canonicalValue(catalog.sourceView || '') === 'boolean'
      || (items.length > 0 && items.every(item => item.kind === 'Boolean' || ['true', 'false'].includes(canonicalValue(item.id))));
    const lookup = { items, byId, bySelector, byDisplay, searchRows, isBoolean };
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
    if (explicitMatch && [canonicalValue(explicitMatch.selector), canonicalValue(explicitMatch.display)].includes(visibleCanonical)) {
      return resolvedItem(explicitMatch, 'id-and-text');
    }

    let matches = lookup.bySelector.get(visibleCanonical) || [];
    if (!matches.length) matches = lookup.byDisplay.get(visibleCanonical) || [];
    if (matches.length === 1) return resolvedItem(matches[0], 'exact');
    if (matches.length > 1) {
      const variants = matches.slice(0, 8).map(item => item.selector).join('; ');
      return { display: visibleText, explicit: '', resolved: false, resolution: null, issue: `Значение «${visibleText}» в столбце «${column.excelHeader}» неоднозначно. Выберите один из вариантов: ${variants}.` };
    }

    const needle = searchCanonical(visibleText);
    const tokens = searchTokens(visibleText);
    const allowPartial = needle.length >= 2 && !/^\d+$/.test(needle);
    if (allowPartial) {
      const partial = lookup.searchRows
        .filter(row => tokens.length ? tokens.every(token => row.haystack.includes(token)) : row.haystack.includes(needle))
        .map(row => row.item);
      if (partial.length === 1) return resolvedItem(partial[0], 'unique-fragment');
      if (partial.length > 1) {
        const variants = partial.slice(0, 10).map(item => item.selector).join('; ');
        const suffix = partial.length > 10 ? `; … ещё ${partial.length - 10}` : '';
        return { display: visibleText, explicit: '', resolved: false, resolution: null, issue: `По запросу «${visibleText}» в столбце «${column.excelHeader}» найдено ${partial.length} вариантов: ${variants}${suffix}. Добавьте ещё слово, чтобы остался один вариант.` };
      }
    }
    return { display: visibleText, explicit: '', resolved: false, resolution: null, issue: `Значение «${visibleText}» не найдено в справочнике «${column.excelHeader}». Введите часть официального названия из TESSA или обновите справочники.` };
  }


  // ---------------------------------------------------------------------------
  // 6. ROUNDTRIP-EXCEL: СБОРКА КНИГИ
  // Здесь из snapshot TESSA и структуры матрицы собираются видимые листы, скрытые
  // identity-колонки, справочники и пользовательская инструкция.
  // ---------------------------------------------------------------------------

  function buildRoundtripGrid(structure, snapshot, matrixInfo, dictionaryCatalog = null, options = {}) {
    const catalog = normalizeDictionaryCatalog(dictionaryCatalog);
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
        values.push(items.map(item => isBoolean ? booleanDisplay(item.value ?? item.id ?? item.display) : dictionarySelector(dict, item.id, null, item.display)).join('\n'));
        values.push(items.map(item => {
          if (isBoolean) { const semantic = booleanSemantic(item.value ?? item.id ?? item.display); return semantic === null ? '' : semantic ? 'true' : 'false'; }
          return item.id !== null && item.id !== undefined && item.id !== '' ? String(item.id) : '';
        }).filter(Boolean).join('\n'));
      }
      for (const fn of structure.functions) {
        const key = definitionKey('function', fn.id);
        const dict = catalog.catalogs?.[catalog.columnCatalogIds?.[key]];
        const items = snapshotRow.roles?.[fn.id] || [];
        values.push(items.map(item => dictionarySelector(dict, item.id, item.roleTypeId, item.display)).join('\n'));
        values.push(items.map(item => `${item.id}|${item.roleTypeId}`).join('\n'));
      }
      for (let customIndex = 0; customIndex < customColumns.length; customIndex += 1) {
        values.push(snapshotRow.customValues?.[customIndex] ?? '');
      }
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
      [0, 'ПОИСК ПО СПРАВОЧНИКАМ\nМожно вводить уникальную часть названия прямо в ячейке. Если найден ровно один вариант, Studio сопоставит его с точной записью TESSA. Для логических признаков используйте «Да» / «Нет».', 12],
      [4, 'НЕСКОЛЬКО ЗНАЧЕНИЙ\nКаждое значение размещайте с новой строки внутри одной ячейки (Alt+Enter). Не склеивайте несколько значений через запятые, если поле допускает множественный выбор.', 12],
    ]);
    row(23, 24, [[0, 'Дополнительные действия — когда нужны эти кнопки', 11]]);
    row(24, 70, [
      [0, '«АКТУАЛИЗИРОВАТЬ ВЫБРАННЫЙ EXCEL»\nИспользуйте, если в шаблоне TESSA появились новые критерии/функции. Studio добавит новые поля и сохранит ваши пользовательские изменения, насколько это безопасно.', 12],
      [4, '«СКАЧАТЬ СО СВЕЖИМИ СПРАВОЧНИКАМИ»\nСоздаёт новую выгрузку и принудительно перечитывает справочники/роли из TESSA. Полезно, если нужное значение недавно добавили или переименовали.', 12],
    ]);
    row(29, 24, [[0, 'Безопасность', 11]]);
    row(30, 76, [[0, 'Перед применением Studio перечитывает матрицу, проверяет права и режим редактирования, сверяет fingerprint изменяемых строк, валидирует справочники, исполнителей и дубли. Ошибка одной строки не должна приводить к случайному изменению остальных. Если строку нельзя сопоставить однозначно, она пропускается и показывается пользователю.', 13]]);
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
      sheetRows.push(`<row r="${rowNumber}" ht="32" customHeight="1">${values.map((value, colIndex) => xlsxStringCell(rowNumber, colIndex, value, bodyStyle)).join('')}</row>`);
    });
    const cols = grid.columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"${column.hidden ? ' hidden="1"' : ''}/>`).join('');

    // Служебный лист хранит только данные, необходимые для обратного сопоставления.
    // Статус и поисковую строку не дублируем в каждой из десятков тысяч строк:
    // статус имеет безопасный default, а поисковый индекс восстанавливается в памяти.
    const dictionaryRows = [['CatalogID', 'Словарь', 'Выбор в Excel', 'Отображение', 'ID', 'RoleTypeID', 'Источник', 'Доп. данные']];
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
        dictionaryRows.push([catalog.id, firstCatalogRow ? (catalog.label || catalog.id) : '', item.selector, item.display, item.id, item.roleTypeId, firstCatalogRow ? (catalog.sourceView || item.source || '') : '', item.details || '']);
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
    for (const [rangeName, refs] of validationGroups) validations.push(`<dataValidation type="list" allowBlank="1" showInputMessage="0" showErrorMessage="0" sqref="${refs.join(' ')}"><formula1>${rangeName}</formula1></dataValidation>`);
    if (booleanRefs.length) validations.push(`<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${booleanRefs.join(' ')}"><formula1>"Да,Нет"</formula1></dataValidation>`);

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

    const instructionSheet = instructionSheetXml();
    const dictionarySheet = genericSheetXml(dictionaryRows, [28, 42, 56, 48, 40, 14, 28, 72]);
    const structureSheet = genericSheetXml(structureRows, [46, 14, 38, 42, 38, 28, 24, 70]);
    const schemaChangesSheet = genericSheetXml(changeRows, [32, 16, 40, 44, 72, 12, 40, 72]);

    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="5"><font><sz val="11"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FF292929"/><sz val="11"/><name val="Aptos"/><family val="2"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="20"/><name val="Aptos Display"/><family val="2"/></font><font><b/><color rgb="FF292929"/><sz val="13"/><name val="Aptos Display"/><family val="2"/></font></fonts><fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE31E24"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFB5121B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF292929"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF0F1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF5F5F5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE5E5E5"/></left><right style="thin"><color rgb="FFE5E5E5"/></right><top style="thin"><color rgb="FFE5E5E5"/></top><bottom style="thin"><color rgb="FFE5E5E5"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="15"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
    const sheetNames = ['Матрица', ROUNDTRIP.InstructionSheet, ROUNDTRIP.DictionarySheet, ROUNDTRIP.StructureSheet, ROUNDTRIP.SchemaChangesSheet];
    const sheetXml = [worksheet, instructionSheet, dictionarySheet, structureSheet, schemaChangesSheet];
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
    setProgress(62, options.forceDictionaryRefresh ? 'Обновляю справочники' : 'Подключаю справочники', options.forceDictionaryRefresh ? 'Читаю свежие значения и роли из TESSA' : 'Использую кэш, где это безопасно');
    log(options.forceDictionaryRefresh ? 'Выгрузка текущей матрицы: принудительно обновляю словари и роли.' : 'Выгрузка текущей матрицы: подключаю словари и роли.');
    const dictionaryCatalog = await bridge.loadDictionaryCatalog(structure, snapshot, { forceRefresh: Boolean(options.forceDictionaryRefresh) });
    APP.dictionaryCatalog = dictionaryCatalog;
    const matrixInfo = bridge.matrixInfo();
    setProgress(84, 'Формирую Excel', `${snapshot.rows.length} строк`);
    const bytes = await createRoundtripXlsxBytes(structure, snapshot, matrixInfo, dictionaryCatalog);
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
    if (desiredRows.length === snapshot.rows.length) {
      for (const desired of desiredRows) {
        const identity = excelIdentityKey(desired);
        if (identity) identityCounts.set(identity, (identityCounts.get(identity) || 0) + 1);
      }
      desiredRows.forEach((desired, index) => expectedCurrentByExcelRow.set(desired, snapshot.rows[index] || null));
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

    for (const desired of desiredRows) {
      if (desired.system.action.startsWith('invalid:')) throw new Error(`Строка Excel ${desired.excelRow}: неизвестное действие.`);
      const positionalOverwriteTarget = positionalOverwriteTargets.get(desired) || null;
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

    const rows = snapshot.rows.map(row => mergedByCard.get(canonicalValue(row.rowCardId)) || { ...row, customValues: Array(customColumns.length).fill('') }).concat(added);
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
    setProgress(10, 'Проверяю выбранный Excel', sourceName);
    log(`Обновление Excel-схемы: ${sourceName}`);
    setProgress(20, 'Подключаюсь к TESSA', 'Проверяю открытую матрицу');
    const bridge = await TessaBridge.create();
    const templateId = bridge.templateId();
    setProgress(30, 'Читаю актуальную структуру TESSA', 'Сверяю критерии и функции');
    const structure = await bridge.requestStructure(templateId);
    const matrixInfo = bridge.matrixInfo();
    const workbookTemplateId = canonicalValue(workbook.roundtrip?.templateId);
    if (!workbook.roundtrip?.enabled || workbookTemplateId !== canonicalValue(matrixInfo.TemplateID)) throw new Error('Выбранный Excel относится к другому шаблону или не является roundtrip-файлом.');
    setProgress(45, 'Читаю строки TESSA', 'Нужно сохранить ваши изменения и актуальные ID');
    log('Обновление Excel-схемы: читаю все строки и страницы TESSA.');
    const snapshot = await bridge.loadSnapshot(structure);
    setProgress(62, 'Переношу ваши изменения', 'Сохраняю значения и пользовательские столбцы');
    const merged = mergeWorkbookIntoCurrentSnapshot(workbook, structure, snapshot);
    setProgress(76, 'Обновляю справочники', 'Подключаю актуальные значения');
    log('Обновление Excel-схемы: подключаю словари (локальный кэш или сервер).');
    const dictionaryCatalog = await bridge.loadDictionaryCatalog(structure, snapshot);
    setProgress(90, 'Формирую актуальный Excel', 'Новые поля + ваши изменения');
    const bytes = await createRoundtripXlsxBytes(structure, merged.snapshot, matrixInfo, dictionaryCatalog, {
      schemaChanges: merged.schemaChanges,
      customColumns: merged.customColumns,
    });
    const shortId = String(snapshot.matrixId || '').slice(0, 8);
    const name = `TESSA_Матрица_${sanitizeFileName(matrixInfo.TemplateName)}_${shortId}_АКТУАЛЬНАЯ.xlsx`;
    downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    log(`Excel-схема обновлена: строк ${merged.snapshot.rows.length}; новых столбцов ${merged.schemaChanges.missingDefinitions.length}; удалённых ${merged.schemaChanges.staleDefinitions.length}; пользовательских ${merged.customColumns.length}.`);
    setProgress(100, 'Excel актуализирован', `Новых полей: ${merged.schemaChanges.missingDefinitions.length} · пользовательских: ${merged.customColumns.length}`);
    return { name, workbook, structure, snapshot, merged, dictionaryCatalog, bytes };
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

  function captureExtensionRequire() {
    const chunks = window.webpackChunktessa_web_extensions;
    if (!Array.isArray(chunks)) throw new Error('Не найден runtime расширений TESSA. Откройте карточку матрицы и повторите.');
    let req = null;
    const id = `tms_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    chunks.push([[id], {}, runtime => { req = runtime; }]);
    if (!req) throw new Error('Не удалось подключиться к runtime TESSA.');
    return req;
  }

  // ---------------------------------------------------------------------------
  // 7. TESSA BRIDGE
  // Единственная зона, которая знает о внутренних API TESSA. Bridge читает карточку
  // матрицы, строки, представления и выполняет CardGet/CardStore/CardRequest.
  // Planner и UI работают через этот слой и не зависят от деталей API напрямую.
  // ---------------------------------------------------------------------------

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

    async collectNativeMatrixViewLinksAllPages() {
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

          const before = this.nativePagingInfo(target);
          if (page !== before.currentPage || page === 1) {
            await target.setPageAndRefresh(page);
          }

          // Ждём завершения загрузки. Некоторые сборки не публикуют currentPage,
          // поэтому дополнительно ждём стабильные строки, а не только флаг loading.
          let lastSignature = null;
          let stableTicks = 0;
          for (let wait = 0; wait < 120; wait += 1) {
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
      let best = null;
      for (const [controlName, original] of this.controlEntries()) {
        const candidates = [original, original?.control, original?.model, original?.viewModel].filter(Boolean);
        const rows = this.rowsOfControl(original);
        if (!rows.length) continue;
        const target = candidates.find(item => typeof item?.doubleClickAction === 'function') || null;
        const validRows = rows.filter(row => {
          const data = row?.data || row?.selectedObject;
          return this.dataValue(data, 'MatrixRowID') && this.dataValue(data, 'MatrixVersionID');
        });
        if (target && validRows.length && (!best || validRows.length > best.rows.length)) {
          best = { controlName: String(controlName), target, rows: validRows };
        }
      }
      return best;
    }

    repositoryViewAliases() {
      const api = this.viewApi();
      const views = api?.serviceModule?.ViewService?._repository?._views;
      return views?.entries ? [...views.entries()].map(([alias, internal]) => ({ alias: String(alias), metadata: internal?._meta || internal?.metadata || null })) : [];
    }

    findCompatibleViewAlias(condition) {
      const api = this.viewApi();
      if (!api) return null;
      const aliases = this.repositoryViewAliases();
      const directCandidates = [condition.autocompleteViewName, condition.refSection, condition.autocompleteViewName ? `${condition.autocompleteViewName}s` : null, condition.refSection ? `${condition.refSection}s` : null, condition.autocompleteViewName ? `Gch${condition.autocompleteViewName}` : null].filter(Boolean);
      for (const candidate of directCandidates) {
        try { if (api.service.getByName(candidate)?.metadata) return candidate; } catch (_) { /* continue */ }
      }
      const wanted = canonicalValue(`${condition.autocompleteViewName || ''} ${condition.refSection || ''}`);
      const wantedTokens = new Set(wanted.split(/\s+/).filter(token => token.length > 2));
      const scored = aliases.map(item => {
        const text = canonicalValue(`${item.alias} ${item.metadata?.caption || ''}`);
        let score = 0;
        if (canonicalValue(item.alias) === canonicalValue(condition.autocompleteViewName)) score += 100;
        if (canonicalValue(item.alias).startsWith(canonicalValue(condition.autocompleteViewName || '___'))) score += 40;
        if (canonicalValue(item.alias).includes(canonicalValue(condition.refSection || '___'))) score += 35;
        for (const token of wantedTokens) if (text.includes(token)) score += 5;
        if (/history|report|task|log|истор|отчет|задач/.test(text)) score -= 20;
        return { ...item, score };
      }).sort((a, b) => b.score - a.score);
      return scored[0]?.score >= 10 ? scored[0].alias : null;
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
      const sample = rows.slice(0, 100);
      const wantedKind = options.wantedKind || 'guid';
      const roleMode = Boolean(options.roleMode);
      const scoreId = (alias, index) => {
        const text = canonicalValue(alias);
        const values = sample.map(row => row[index]).filter(value => value !== null && value !== undefined && String(value).trim() !== '');
        const typeScore = wantedKind === 'int' ? (values.some(value => Number.isInteger(Number(value))) ? 20 : 0) : (values.some(isGuidLike) ? 20 : 0);
        return typeScore + (/roleid|partnerid|businessscopeid|typeid|rowid|(^| )id($| )/.test(text) ? 14 : 0) - (/roletypeid/.test(text) ? 20 : 0);
      };
      const scoreDisplay = (alias, index) => {
        const text = canonicalValue(alias);
        const preferred = canonicalValue(options.preferredDisplay || '');
        const values = sample.map(row => normalizeSpace(row[index])).filter(Boolean);
        return (preferred && text === preferred ? 30 : 0) + (/name|наимен|назван|display|caption|fullname|flow/.test(text) ? 15 : 0) + (values.some(value => !isGuidLike(value) && !/^\d+$/.test(value)) ? 8 : 0) - (/id|type|email|comment|описан|inn|kpp/.test(text) ? 5 : 0);
      };
      let idIndex = columns.map((alias, index) => ({ index, score: scoreId(alias, index) })).sort((a,b)=>b.score-a.score)[0]?.index ?? 0;
      let displayIndex = columns.map((alias, index) => ({ index, score: scoreDisplay(alias, index) })).sort((a,b)=>b.score-a.score)[0]?.index ?? Math.min(1, columns.length - 1);
      let roleTypeIndex = columns.findIndex(alias => /roletypeid/i.test(String(alias)));
      if (roleMode && roleTypeIndex < 0 && rows.some(row => row.length > columns.length && Number.isFinite(Number(row[row.length - 1])))) roleTypeIndex = Math.max(...rows.map(row => row.length)) - 1;
      const hiddenIndex = columns.findIndex(alias => /^(is)?hidden$|disabled/i.test(String(alias)));
      const activeIndex = columns.findIndex(alias => /^(is)?active$|ispartneractive/i.test(String(alias)));
      const entries = [];
      for (const row of rows) {
        const id = row[idIndex];
        let display = this.localizeValue(row[displayIndex]);
        if (looksTechnicalValue(display)) {
          const better = columns.map((alias, index) => ({ alias, value: this.localizeValue(row[index]), score: scoreDisplay(alias, index) }))
            .filter(item => item.value && !looksTechnicalValue(item.value) && canonicalValue(item.value) !== canonicalValue(id))
            .sort((a, b) => b.score - a.score)[0];
          if (better?.value) display = normalizeSpace(better.value);
        }
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
      } else {
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
        const catalogId = `criterion-view:${alias || condition.autocompleteViewName || condition.refSection || condition.criterionRowId}:${operand}`;
        catalog.columnCatalogIds[key] = catalogId;
        if (!criterionGroups.has(catalogId)) criterionGroups.set(catalogId, { alias, conditions: [], wantedKind: operand === canonicalValue(OPERAND.ReferenceInt) ? 'int' : 'guid' });
        criterionGroups.get(catalogId).conditions.push(condition);
      }

      // Самые тяжёлые представления (GchPartners и MtxRoles) читаются параллельно.
      const criterionJobs = [...criterionGroups.entries()].map(async ([catalogId, group]) => {
        const label = group.conditions.map(item => item.criterionName).join(' / ');
        let entries = [];
        if (group.alias) {
          log(`Словарь: ${label} ← ${group.alias}`);
          const result = await this.queryViewSample(group.alias, 200000);
          if (result.error) catalog.stats.errors.push(`${group.alias}: ${String(result.error).split('\n')[0]}`);
          else {
            entries = this.extractDictionaryEntries(result, { wantedKind: group.wantedKind, preferredDisplay: group.conditions[0].autocompleteParamName });
            if (result.truncated) catalog.stats.errors.push(`${group.alias}: получено ${result.rows.length} из ${result.rowCount}; словарь неполный`);
          }
        } else catalog.stats.errors.push(`${label}: подходящее представление не найдено`);
        for (const condition of group.conditions) {
          for (const row of snapshot.rows || []) {
            for (const item of row.values?.[condition.criterionRowId] || []) if (item.id !== null && item.id !== undefined && item.id !== '') entries.push({ id: String(item.id), display: item.display, roleTypeId: '', source: 'Текущая матрица', status: 'Текущее значение' });
          }
        }
        return { catalogId, catalog: { id: catalogId, label, sourceView: group.alias || 'Текущая матрица', entries } };
      });

      const roleJob = (async () => {
        const roleCatalogId = 'roles:MtxRoles';
        let roleEntries = [];
        let roleAlias = null;
        for (const alias of ['MtxRoles', 'GchRolesForMultiselect', 'ApprovalProcessEditorRoles', 'DiadocRoles']) {
          log(`Словарь ролей: пробую ${alias}`);
          const result = await this.queryViewSample(alias, 200000);
          if (!result.error && result.rows?.length) {
            roleAlias = alias;
            roleEntries = this.extractDictionaryEntries(result, { wantedKind: 'guid', roleMode: true, preferredDisplay: 'RoleName' });
            if (result.truncated) catalog.stats.errors.push(`${alias}: получено ${result.rows.length} из ${result.rowCount}; словарь ролей неполный`);
            if (roleEntries.length) break;
          }
        }
        for (const row of snapshot.rows || []) for (const items of Object.values(row.roles || {})) for (const item of items) roleEntries.push({ id: String(item.id), display: item.display, roleTypeId: item.roleTypeId, source: 'Текущая матрица', status: 'Текущее значение' });
        return { roleCatalogId, roleAlias, roleEntries };
      })();

      const [criterionResults, roleResult] = await Promise.all([Promise.all(criterionJobs), roleJob]);
      for (const item of criterionResults) catalog.catalogs[item.catalogId] = item.catalog;
      catalog.catalogs[roleResult.roleCatalogId] = { id: roleResult.roleCatalogId, label: 'Роли и пользователи TESSA', sourceView: roleResult.roleAlias || 'Текущая матрица', entries: roleResult.roleEntries };
      structure.functions.forEach(fn => { catalog.columnCatalogIds[definitionKey('function', fn.id)] = roleResult.roleCatalogId; });

      const normalized = normalizeDictionaryCatalog(catalog);
      normalized.stats.cache = { hit: false, key: cacheKey, savedAt: Date.now(), ageMs: 0 };
      const cached = await writeDictionaryCache(cacheKey, normalized);
      if (!cached) normalized.stats.errors.push('Локальный кэш словарей недоступен; следующая выгрузка снова запросит данные TESSA.');
      return normalized;
    }

    async queryViewSample(viewAlias, maxRows = 100) {
      const api = this.viewApi();
      if (!api || !viewAlias) return { alias: viewAlias, error: 'View API unavailable' };
      const view = api.service.getByName(viewAlias);
      if (!view?.metadata) return { alias: viewAlias, error: 'View not found' };
      const request = new api.serviceModule.TessaViewRequest(view.metadata);
      request.calculateRowCounting = true;
      request.canUseCache = true;
      try {
        const result = await view.getData(request);
        const columns = Array.from(result?.columns || []);
        const rows = Array.from(result?.rows || []).slice(0, maxRows).map(row => Array.from(row || []).map(value => safePlain(this.unwrapTyped(value), { maxDepth: 5 })));
        return {
          alias: viewAlias,
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
        return { alias: viewAlias, error: error.message || String(error) };
      }
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

      if (links.length && (!sectionCount || links.length >= sectionCount)) {
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
          for (const item of items) {
            if (item.id !== null && item.id !== undefined && item.id !== '') {
              const cacheKey = `${condition.criterionRowId}|${canonicalValue(item.display)}`;
              if (!criterionIdCache.has(cacheKey)) criterionIdCache.set(cacheKey, item);
              else if (canonicalValue(criterionIdCache.get(cacheKey).id) !== canonicalValue(item.id)) criterionIdCache.set(cacheKey, { ambiguous: true, display: item.display });
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
            if (!roleIdCache.has(globalKey)) roleIdCache.set(globalKey, item);
            else if (canonicalValue(roleIdCache.get(globalKey).id) !== canonicalValue(item.id)) roleIdCache.set(globalKey, { ambiguous: true, display: item.display });
            const functionKey = `${fn.id}|${globalKey}`;
            if (!roleIdByFunctionCache.has(functionKey)) roleIdByFunctionCache.set(functionKey, item);
            else if (canonicalValue(roleIdByFunctionCache.get(functionKey).id) !== canonicalValue(item.id)) roleIdByFunctionCache.set(functionKey, { ambiguous: true, display: item.display });
          }
        }

        return { ...link, card, values, roles, flat, fingerprint: fingerprintFlat(flat) };
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

    async validateDuplicate(card, versionId) {
      const req = new this.cards.CardRequest();
      req.requestType = REQUEST.ValidateDuplicate;
      req.info.card = card.getStorage();
      req.info.versionId = this.TypedField.createGuid(versionId);
      req.info.matrixId = this.TypedField.createGuid(this.mainCard.id);
      req.info.templateID = this.TypedField.createGuid(this.templateId());
      const response = await this.cardService.request(req);
      const error = this.validationError(response, 'Ошибка проверки дубликатов');
      if (error) throw error;
      const info = response.tryGetInfo?.() || response.info;
      const ok = this.StorageHelper.tryGet(info, 'ok');
      if (ok === false) throw new Error('TESSA обнаружила дублирующую строку матрицы.');
    }

    async storeRowCard(card) {
      const req = new this.cards.CardStoreRequest();
      req.card = card;
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

  function splitRangeText(value) {
    const text = stripFormulaMarker(value);
    const match = text.match(/^(.+?)\s+(?:-|–|—|\.\.|до)\s+(.+)$/i);
    return match ? [match[1].trim(), match[2].trim()] : [text, null];
  }

  function parseRange(value, kind) {
    const [fromText, toText] = splitRangeText(value);
    const parse = text => {
      if (kind === 'Date') return parseDateValue(text, false);
      if (kind === 'DateTime') return parseDateValue(text, true);
      const normalized = String(text).replace(/\s/g, '').replace(',', '.');
      const number = kind === 'Int' ? Number.parseInt(normalized, 10) : Number.parseFloat(normalized);
      if (!Number.isFinite(number)) throw new Error(`Не удалось распознать число «${text}».`);
      return number;
    };
    return { kind, value: parse(fromText), to: toText ? parse(toText) : null };
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
        const [fromText, toText] = splitRangeText(item.display || '');
        return typedRangeSemantic(kind, fromText, toText);
      }
      return `value:${canonicalValue(item.display)}`;
    }).filter(Boolean);
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
      const resolutions = [];
      for (const [id, column] of columnMap.columns.entries()) {
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
          const result = resolveEmbeddedDictionaryValue(workbook, column, visible, explicitValues[index] || '');
          resolvedDisplays.push(result.display);
          resolvedIds.push(result.explicit);
          if (result.issue) issues.push(`Excel ${row.excelRow}: ${result.issue}`);
          if (result.resolution === 'unique-fragment') resolutions.push(`Excel ${row.excelRow}: «${visible}» → «${result.display}» в «${column.excelHeader}»`);
          if (column.kind === 'function' && result.explicit) {
            const [roleId, roleTypeId = ''] = String(result.explicit).split('|').map(value => value.trim());
            compareValues.push(compareIdentity('function', roleId, roleTypeId) || `value:${canonicalValue(result.display)}`);
          } else if (isReference && result.explicit) {
            compareValues.push(compareIdentity('criterion', String(result.explicit).split('|')[0]) || `value:${canonicalValue(result.display)}`);
          } else {
            const kind = operandKind(column);
            if (['Boolean','Int','Decimal','Date','DateTime'].includes(kind)) {
              const [fromText, toText] = splitRangeText(result.display || '');
              const fromIssue = typedValueIssue(kind, fromText, column.excelHeader);
              const toIssue = toText ? typedValueIssue(kind, toText, column.excelHeader) : null;
              if (fromIssue) issues.push(`Excel ${row.excelRow}: ${fromIssue}`);
              if (toIssue) issues.push(`Excel ${row.excelRow}: ${toIssue}`);
              compareValues.push(typedRangeSemantic(kind, fromText, toText));
            } else compareValues.push(`value:${canonicalValue(result.display)}`);
          }
        });
        flat[column.key] = resolvedDisplays;
        ids[column.key] = resolvedIds;
        compare[column.key] = compareValues.filter(Boolean);
        columns.set(id, column);
      }
      const system = {
        action: normalizeAction(columnMap.system.action === undefined ? '' : row.values[columnMap.system.action]),
        rowCardId: normalizeSpace(columnMap.system.rowCardId === undefined ? '' : row.values[columnMap.system.rowCardId]),
        versionId: normalizeSpace(columnMap.system.versionId === undefined ? '' : row.values[columnMap.system.versionId]),
        baseFingerprint: normalizeSpace(columnMap.system.baseFingerprint === undefined ? '' : row.values[columnMap.system.baseFingerprint]),
      };
      const hasData = Object.values(flat).some(values => Array.isArray(values) && values.length);
      return { excelRow: row.excelRow, flat, ids, compare, columns, system, hasData, issues, resolutions, fingerprint: fingerprintFlat(flat), compareFingerprint: fingerprintFlat(compare) };
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
    if (desired.length === snapshot.rows.length) {
      for (const row of desired) {
        const key = excelIdentityKey(row);
        if (key) identityCounts.set(key, (identityCounts.get(key) || 0) + 1);
      }
      desired.forEach((row, index) => expectedCurrentByExcelRow.set(row, snapshot.rows[index] || null));
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
    if (desired.length === snapshot.rows.length) {
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

    for (const excelRow of desired) {
      const action = excelRow.system.action;
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
      const currentRow = positionalOverwriteTarget || findCurrent(excelRow);
      const identityKey = currentRow ? canonicalValue(currentRow.versionId || currentRow.rowCardId) : '';

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
        if (sourceCurrentRow && excelRow.system.baseFingerprint && sourceCurrentRow.fingerprint
          && canonicalValue(excelRow.system.baseFingerprint) !== canonicalValue(sourceCurrentRow.fingerprint)) {
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
          match: { matchedBy: overwriteMatchedBy.get(excelRow) || 'position-overwrite', lowConfidence: false, sourceIdentity },
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
        if (excelRow.system.baseFingerprint && currentRow.fingerprint && canonicalValue(excelRow.system.baseFingerprint) !== canonicalValue(currentRow.fingerprint)) {
          issues.push(`Строка Excel ${excelRow.excelRow}: исходная строка TESSA изменилась после выгрузки Excel. Скопированная строка пропущена, чтобы не создавать её из устаревших данных.`);
          continue;
        }
        const cloned = {
          ...excelRow,
          system: { ...excelRow.system, rowCardId: '', versionId: '', baseFingerprint: '' },
        };
        actions.push({ type: 'add', excelRow: cloned, currentRow: null, changes: [], match: { matchedBy: 'copied-row-auto-add', lowConfidence: false }, expectedFingerprint: null });
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

      if (currentRow && excelRow.system.baseFingerprint && currentRow.fingerprint && canonicalValue(excelRow.system.baseFingerprint) !== canonicalValue(currentRow.fingerprint)) {
        if (identityKey) usedCurrent.add(identityKey);
        issues.push(`Строка Excel ${excelRow.excelRow}: строка TESSA изменилась после выгрузки Excel. Скачайте свежий файл, чтобы не затереть чужие изменения.`);
        continue;
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
        return Boolean(identityKey && !usedCurrent.has(identityKey));
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
    return { actions, issues, warnings, usedCurrent };
  }

  function detectPlanDuplicateConflicts(actions, snapshot) {
    const finalRows = new Map((snapshot?.rows || []).map(row => [canonicalValue(row.versionId || row.rowCardId), { label: `TESSA ${row.index + 1}`, flat: row.flat }]));
    for (const action of actions || []) {
      if (action.type === 'delete' && action.currentRow) finalRows.delete(canonicalValue(action.currentRow.versionId || action.currentRow.rowCardId));
      else if (action.type === 'update' && action.currentRow) finalRows.set(canonicalValue(action.currentRow.versionId || action.currentRow.rowCardId), { label: `Excel ${action.excelRow.excelRow}`, flat: action.excelRow.flat, changed: true });
      else if (action.type === 'add') finalRows.set(`add:${action.excelRow.excelRow}`, { label: `Excel ${action.excelRow.excelRow}`, flat: action.excelRow.flat, changed: true });
    }
    const groups = new Map();
    for (const row of finalRows.values()) {
      const fp = fingerprintFlat(row.flat || {});
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

    // Ошибки конкретной строки не должны ломать весь пакет. Они переводятся в SKIP,
    // а корректные строки остаются исполняемыми. Глобальные ошибки формата/матрицы
    // по-прежнему считаются фатальными, потому что безопасно интерпретировать файл нельзя.
    const rawIssues = [
      ...(built.issues || []),
      ...(columnMap.mappingIssues || []),
      ...desired.flatMap(row => row.issues || []),
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
    const skippedRows = [];
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
    const duplicateIssues = detectPlanDuplicateConflicts(actions, snapshot);
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

  function matrixStateCaption(matrixInfo) {
    const raw = normalizeSpace(matrixInfo?.StateName || matrixInfo?.StateID || 'неизвестно');
    const state = canonicalHeader(raw);
    if (state.includes('draft') || state.includes('чернов')) return 'Черновик';
    if (state.includes('active') || state.includes('актив')) return 'Активная';
    if (state.includes('obsolete') || state.includes('outdated') || state.includes('устар')) return 'Устаревшая';
    if (state.includes('approval') || state.includes('coordination') || state.includes('соглас')) return 'Согласование';
    return raw.startsWith('$Mtx_Enums_') ? 'Неизвестное состояние' : raw;
  }

  function isWritableMatrixDraft(matrixInfo) {
    const state = canonicalHeader(matrixInfo?.StateName || '');
    if (!state) return false;
    return state.includes('draft') || state.includes('чернов');
  }

  function assertWritableMatrixDraft(bridge) {
    const matrixInfo = bridge.matrixInfo();
    if (!isWritableMatrixDraft(matrixInfo)) {
      throw new Error(`Открыта матрица в состоянии «${matrixStateCaption(matrixInfo)}». Изменения разрешены только в черновике. Создайте или откройте актуальный черновик матрицы и повторите сравнение.`);
    }
    return matrixInfo;
  }

  // ---------------------------------------------------------------------------
  // 10. БЕЗОПАСНОСТЬ И PREFLIGHT
  // Перед применением проверяются права, режим редактирования, дубли, справочники и
  // подозрительные удаления. Ошибочная строка пропускается, а не маскируется догадкой.
  // ---------------------------------------------------------------------------

  function deletionGuard(plan) {
    const deleteCount = Number(plan?.counts?.delete || 0);
    const snapshotCount = Number(plan?.snapshot?.rows?.length || plan?.sourceRowCount || 0);
    if (!deleteCount || !snapshotCount) return { blocked: false, deleteCount, snapshotCount, ratio: 0 };
    const ratio = deleteCount / snapshotCount;
    const blocked = deleteCount >= 10 && ratio >= 0.20;
    return {
      blocked, deleteCount, snapshotCount, ratio,
      reason: blocked ? `Excel удаляет ${deleteCount} из ${snapshotCount} строк (${Math.round(ratio * 100)}%). Эти удаления будут пропущены; разделите массовое удаление на несколько меньших пакетов.` : null,
    };
  }

  function evaluatePlanSafety(plan, bridge) {
    const matrixInfo = bridge.matrixInfo();
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
    if (!isWritableMatrixDraft(matrixInfo)) {
      blockedReasons.push(`Открыта матрица в состоянии «${matrixStateCaption(matrixInfo)}». Изменения возможны только в черновике.`);
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
    if (!file) throw new Error('Выберите файл .xlsx.');
    APP.abortRequested = false;
    setProgress(8, 'Читаю Excel', file.name);
    log(`Читаю ${file.name}`);
    const workbook = await readXlsxArrayBuffer(await file.arrayBuffer(), file.name);
    setProgress(22, 'Excel прочитан', `${workbook.rows.length} строк данных`);
    log(`Excel: ${workbook.headers.filter(Boolean).length} столбцов, ${workbook.rows.length} строк данных.`);
    setProgress(30, 'Подключаюсь к TESSA', 'Проверяю открытую матрицу');
    const bridge = await TessaBridge.create();
    const templateId = bridge.templateId();
    if (!templateId) throw new Error('В карточке матрицы не найден TemplateID.');
    setProgress(42, 'Читаю структуру TESSA', 'Критерии и функции');
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
    setProgress(canReuseSnapshot ? 58 : 52, canReuseSnapshot ? 'Использую свежий снимок' : 'Читаю строки TESSA', canReuseSnapshot ? 'Повторная загрузка не нужна' : 'Сверяю текущие строки');
    const snapshot = canReuseSnapshot ? cachedSnapshot : await bridge.loadSnapshot(structure);
    setProgress(72, 'Сопоставляю Excel и TESSA', `${snapshot.rows.length} строк в TESSA`);
    log(`Текущее состояние TESSA: ${snapshot.rows.length} строк${canReuseSnapshot ? ' (из текущей сессии)' : ''}.`);
    const plan = buildPlan(workbook, structure, snapshot);
    setProgress(88, 'Проверяю безопасность', 'Дубли, права, удаления и неоднозначности');
    plan.safety = evaluatePlanSafety(plan, bridge);
    plan.matrixInfo = plan.safety.matrixInfo;
    if (plan.safety.blocked) {
      log(`Файл нельзя применить в текущем контексте: ${plan.safety.blockedReasons.join(' ')}`, 'warn');
      if (plan.safety.suppressUnsafePreview) {
        plan.candidateCounts = { ...plan.counts };
        plan.candidateActions = plan.actions;
        plan.actions = [];
        plan.counts = countActions([], plan.skippedRows);
        plan.previewSuppressed = true;
      }
    } else if (plan.skippedRows?.length) {
      log(`Проверка готова: ${plan.skippedRows.length} строк будут пропущены, остальные можно применить.`, 'warn');
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
    APP.plan = plan;
    renderPlan(plan);
    const visible = plan.actions.filter(action => action.type !== 'noop').length;
    setProgress(100, 'Проверка завершена', visible ? `Найдено изменений: ${visible}` : 'Изменений нет');
    return plan;
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
    return makeSkippedRow(rowNumber, friendlyErrorMessage(error), phase, action?.type || null);
  }

  async function preflightPlan(plan) {
    setProgress(10, 'Предварительная проверка', 'Перечитываю матрицу перед записью');
    if (plan?.safety?.blocked) throw new Error(`Файл нельзя применить: ${plan.safety.blockedReasons.join(' ')}`);
    const bridge = await TessaBridge.create();
    assertWritableMatrixDraft(bridge);
    assertNativeEditMode();
    const structure = await bridge.requestStructure(bridge.templateId());
    const fresh = await bridge.loadSnapshot(structure);
    setProgress(18, 'Сверяю актуальное состояние', `${fresh.rows.length} строк в TESSA`);
    if (fresh.matrixId !== plan.matrixId) throw new Error('Открыта другая матрица. Нажмите «Проверить изменения» ещё раз.');
    const freshByVersion = new Map(fresh.rows.map(row => [canonicalValue(row.versionId), row]));
    const runtimeSkips = [];
    const preparedUpdates = new Map();
    const preparedAdds = new Map();
    const readyDeletes = [];

    // UPDATE: каждая строка проверяется независимо. Ошибка одной строки не отменяет пакет.
    for (const action of plan.actions.filter(x => x.type === 'update')) {
      try {
        const current = freshByVersion.get(canonicalValue(action.currentRow.versionId));
        if (!current) throw new Error(`Строка ${action.currentRow.versionId} исчезла после предпросмотра.`);
        if (current.fingerprint !== action.expectedFingerprint) throw new Error(`Строка Excel ${action.excelRow.excelRow} изменилась в TESSA после предпросмотра.`);
        await hydrateMissingIdsForAction(action, structure, fresh, bridge);
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
        const card = await bridge.getCard(current.rowCardId);
        bridge.rebuildRowCard(card, current.versionId, action.excelRow, structure, fresh);
        await bridge.validateDuplicate(card, current.versionId);
        preparedUpdates.set(action.excelRow.excelRow, { action, card, current });
      } catch (error) {
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-update'));
      }
    }

    setProgress(28, 'Проверяю изменяемые строки', `Проверено: ${plan.actions.filter(x => x.type === 'update').length}`);

    // ADD: если конкретная новая строка не проходит справочник/дубликат/тип — пропускаем её.
    const addActions = plan.actions.filter(x => x.type === 'add');
    let createCapabilityError = null;
    if (addActions.length) {
      try { bridge.assertCanCreateRows(); } catch (error) { createCapabilityError = error; }
    }
    for (const action of addActions) {
      try {
        if (createCapabilityError) throw createCapabilityError;
        await hydrateMissingIdsForAction(action, structure, fresh, bridge);
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
        const created = await bridge.createRowCard(structure.templateId);
        log(`Подготавливаю новую строку Excel ${action.excelRow.excelRow} через CardService.${created.newMethod}`);
        bridge.rebuildRowCard(created.card, created.versionId, action.excelRow, structure, fresh);
        await bridge.validateDuplicate(created.card, created.versionId);
        preparedAdds.set(action.excelRow.excelRow, { action, ...created });
      } catch (error) {
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-add'));
      }
    }

    setProgress(36, 'Проверяю новые строки', `Проверено: ${plan.actions.filter(x => x.type === 'add').length}`);

    // DELETE тоже проверяется по fingerprint отдельно.
    for (const action of plan.actions.filter(x => x.type === 'delete')) {
      try {
        const current = freshByVersion.get(canonicalValue(action.currentRow.versionId));
        if (!current) throw new Error(`Строка ${action.currentRow.versionId} исчезла после предпросмотра.`);
        if (current.fingerprint !== action.expectedFingerprint) throw new Error(`Строка TESSA ${action.currentRow.index + 1} изменилась после предпросмотра.`);
        readyDeletes.push({ action, current });
      } catch (error) {
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-delete'));
      }
    }

    setProgress(42, 'Предварительная проверка завершена', `Готово к записи: ${preparedUpdates.size + preparedAdds.size + readyDeletes.length}`);
    return { bridge, structure, fresh, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips };
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
    if (plan.actions.some(a => a.match?.lowConfidence)) {
      const okLow = window.confirm('Есть строки с низкой уверенностью сопоставления. Продолжить после проверки предпросмотра?');
      if (!okLow) return null;
    }
    const c = plan.counts;
    const ok = window.confirm(`Применить корректные изменения к TESSA?\n\nИзменить: ${c.update}\nДобавить: ${c.add}\nУдалить: ${c.delete}\nПропустить: ${c.skip || 0}\n\nОшибочные строки не будут применены.`);
    if (!ok) return null;
    if (c.delete && !window.confirm(`Будет удалено строк: ${c.delete}. Подтвердите удаление отдельно.`)) return null;

    APP.abortRequested = false;
    const { bridge, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips } = await preflightPlan(plan);
    const totalToStore = preparedUpdates.size + preparedAdds.size + readyDeletes.length;
    let storedCount = 0;
    const tickStoreProgress = label => {
      storedCount += 1;
      const percent = totalToStore ? 42 + Math.round((storedCount / totalToStore) * 52) : 94;
      setProgress(percent, label, `${storedCount} из ${Math.max(1, totalToStore)}`);
    };
    setProgress(44, 'Применяю изменения', totalToStore ? `0 из ${totalToStore}` : 'Нет строк для записи');
    const result = {
      planId: plan.id,
      startedAt: nowIso(),
      finishedAt: null,
      rows: [],
      skipped: [...(plan.skippedRows || []), ...runtimeSkips],
      success: false,
      partial: false,
      appliedCount: 0,
      skippedCount: 0,
    };

    for (const prepared of preparedUpdates.values()) {
      if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
      const action = prepared.action;
      try {
        log(`Обновляю строку Excel ${action.excelRow.excelRow}`);
        await bridge.storeRowCard(prepared.card);
        result.rows.push({ type: 'update', excelRow: action.excelRow.excelRow, versionId: prepared.current.versionId, status: 'ok' });
      } catch (error) {
        const skipped = runtimeSkip(action, error, 'store-update');
        result.skipped.push(skipped);
        result.rows.push({ type: 'update', excelRow: action.excelRow.excelRow, status: 'skipped', reason: skipped.reason });
      }
      tickStoreProgress(isOverwriteMatch(action.match) ? 'Заменяю строки' : 'Обновляю строки');
    }

    for (const created of preparedAdds.values()) {
      if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
      const action = created.action;
      try {
        log(`Добавляю строку Excel ${action.excelRow.excelRow}`);
        const storeResponse = await bridge.storeRowCard(created.card);
        const storedCardId = String(storeResponse?.cardId || created.cardId);
        const verification = await bridge.tryGetCard(storedCardId);
        if (verification.error || !verification.card) throw new Error(`Новая карточка строки ${storedCardId} не открывается после сохранения.`);
        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, rowCardId: storedCardId, versionId: created.versionId, newMethod: created.newMethod, verifiedByCardGet: true, status: 'ok' });
      } catch (error) {
        const skipped = runtimeSkip(action, error, 'store-add');
        result.skipped.push(skipped);
        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, status: 'skipped', reason: skipped.reason });
      }
      tickStoreProgress('Добавляю строки');
    }

    for (const prepared of readyDeletes) {
      if (APP.abortRequested) throw new Error('Операция остановлена пользователем.');
      const action = prepared.action;
      try {
        log(`Удаляю строку TESSA ${action.currentRow.index + 1}`);
        await bridge.deleteMatrixRow(action.currentRow.versionId);
        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'ok' });
      } catch (error) {
        const skipped = runtimeSkip(action, error, 'store-delete');
        result.skipped.push(skipped);
        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'skipped', reason: skipped.reason });
      }
      tickStoreProgress('Удаляю строки');
    }

    setProgress(96, 'Обновляю карточку TESSA', 'Получаю итоговое состояние');
    await bridge.refresh();
    result.finishedAt = nowIso();
    result.appliedCount = result.rows.filter(row => row.status === 'ok').length;
    result.skippedCount = result.skipped.length;
    result.partial = result.skippedCount > 0;
    result.success = true;
    log(`Готово. Применено: ${result.appliedCount}; пропущено: ${result.skippedCount}.`, result.partial ? 'warn' : 'info');
    downloadJson(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    setProgress(100, result.partial ? 'Применение завершено с пропусками' : 'Все изменения применены', `Применено: ${result.appliedCount} · пропущено: ${result.skippedCount}`);
    return result;
  }

  function downloadJson(value, name) {
    const blob = new Blob([JSON.stringify(value, jsonReplacer, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  function cherkizovoLogoSvg() {
    return `<svg viewBox="0 0 192.756 192.756" aria-hidden="true" focusable="false"><path fill="#E31E24" d="M162.854 63.44c10.303 20.271 11.299 48.019-.664 67.957-16.449 26.752-46.689 41.541-77.263 37.719-26.086-2.492-52.505-21.104-61.81-46.357-9.637-23.76-3.655-53.502 14.123-72.278 21.268-23.262 56.659-31.902 86.567-19.772 15.951 6.478 30.24 16.78 39.047 32.731z"/><path fill="#fff" d="M117.66 53.471c.996 3.323 1.494 6.646-.5 9.471-5.98 6.48-15.451 8.806-24.258 6.646-4.486-.831-9.305-3.656-11.465-7.81-1.33-4.154.831-7.976 3.157-10.8 8.806-6.646 24.591-7.145 32.235 2.493z"/><path fill="#fff" d="M79.277 69.255c6.646 13.292-1.495 29.077 3.656 40.209.831 2.326 3.489 1.33 5.316 1.496 6.813-3.324 5.317-10.635 9.471-15.453 4.154-9.637 14.289-15.951 24.426-16.616 11.631-.665 23.428 5.982 28.246 17.114 4.486 9.471 4.154 23.096-2.824 31.57-4.986 8.807-14.291 12.295-23.262 13.957-8.309.166-15.951-4.818-19.607-12.295-2.16-5.484-3.82-12.463 0-17.779 4.652-9.139 23.428-9.139 16.615-23.096-2.99-2.327-6.314-5.151-10.467-3.324-13.293 7.976-13.625 23.761-19.607 35.89-4.486 9.305-9.471 22.264-21.767 22.93-8.972 1.494-16.117-2.99-20.77-10.469-6.812-16.615-6.812-37.219-9.471-54.997.332-7.975 4.818-15.951 12.462-19.606 10.47-4.651 22.266.334 27.583 10.469z"/></svg>`;
  }

  function renderPlan(plan) {
    const summary = document.querySelector('#tms-summary');
    const table = document.querySelector('#tms-plan');
    if (!summary || !table) return;
    const c = plan.counts;
    const skipped = plan.skippedRows || [];
    const warnings = (plan.warnings || []).slice(0, 8);
    summary.innerHTML = `
      <div class="tms-counters">
        <span class="tms-count tms-update">изменить <b>${c.update}</b></span>
        <span class="tms-count tms-add">добавить <b>${c.add}</b></span>
        <span class="tms-count tms-delete">удалить <b>${c.delete}</b></span>
        <span class="tms-count tms-noop">без изменений <b>${c.noop}</b></span>
        <span class="tms-count tms-skip">пропустить <b>${c.skip || 0}</b></span>
      </div>
      ${plan.safety?.blocked ? `<div class="tms-fatal"><b>Этот файл нельзя безопасно применить</b><br>${plan.safety.blockedReasons.map(escapeHtml).join('<br>')}</div>` : ''}
      ${skipped.length ? `<details class="tms-skipped-box"><summary><b>Пропущено строк: ${skipped.length}</b> · корректные изменения можно применить</summary><div>${skipped.slice(0, 20).map(item => `<div class="tms-skip-line">${item.excelRow ? `Excel ${item.excelRow}: ` : ''}${escapeHtml(item.reason)}</div>`).join('')}${skipped.length > 20 ? `<div class="tms-skip-more">Ещё ${skipped.length - 20}…</div>` : ''}</div></details>` : ''}
      ${warnings.length ? `<details class="tms-warning"><summary>Нужно проверить</summary><div>${warnings.map(item => `<div>${escapeHtml(item)}</div>`).join('')}</div></details>` : ''}
    `;
    table.innerHTML = '';
    const visible = plan.actions.filter(a => a.type !== 'noop');
    const previewLimit = 40;
    const previewActions = visible.slice(0, previewLimit);
    if (!visible.length && !skipped.length) table.innerHTML = '<div class="tms-empty">Изменений нет.</div>';
    previewActions.forEach(action => {
      const item = document.createElement('details');
      item.className = `tms-action tms-action-${action.type}`;
      const isReplacement = action.type === 'update' && isOverwriteMatch(action.match);
      const label = isReplacement ? 'ЗАМЕНИТЬ' : action.type === 'update' ? 'ИЗМЕНИТЬ' : action.type === 'add' ? 'ДОБАВИТЬ' : 'УДАЛИТЬ';
      const rowText = isReplacement ? `Excel ${action.excelRow.excelRow} → TESSA ${action.currentRow.index + 1}` : action.excelRow ? `Excel ${action.excelRow.excelRow}` : `TESSA ${action.currentRow.index + 1}`;
      item.innerHTML = `<summary><b>${label}</b> — ${rowText}${action.match?.lowConfidence ? ' ⚠' : ''}</summary>`;
      const body = document.createElement('div');
      body.className = 'tms-action-body';
      if (action.type === 'update') {
        body.innerHTML = action.changes.map(change => `
          <div class="tms-diff"><b>${escapeHtml(change.label || change.key)}</b><br>
          <span class="tms-before">было: ${escapeHtml((change.before || []).join(' | ') || '∅')}</span><br>
          <span class="tms-after">стало: ${escapeHtml((change.after || []).join(' | ') || '∅')}</span></div>`).join('');
      } else if (action.type === 'add') body.innerHTML = flatToHtml(action.excelRow.flat, plan.columnMap);
      else body.innerHTML = flatToHtml(action.currentRow.flat, plan.columnMap);
      item.appendChild(body);
      table.appendChild(item);
    });
    if (visible.length > previewLimit) {
      const more = document.createElement('div');
      more.className = 'tms-empty';
      more.textContent = `Ещё ${visible.length - previewLimit} изменений не развёрнуты. Счётчики сверху учитывают весь план.`;
      table.appendChild(more);
    }
    const executable = visible.length > 0;
    const apply = document.querySelector('#tms-apply');
    if (apply) {
      apply.disabled = !executable || Boolean(plan.safety?.blocked);
      apply.textContent = executable ? `Применить к TESSA · ${visible.length}` : 'Применить к TESSA';
    }
  }

  function flatToHtml(flat, columnMap = null) {
    const labels = new Map([...(columnMap?.columns?.values?.() || [])].map(column => [column.key, column.excelHeader || column.name]));
    return Object.entries(flat).filter(([, value]) => value?.length).map(([key, value]) => `<div><b>${escapeHtml(labels.get(key) || key)}</b>: ${escapeHtml(value.join(' | '))}</div>`).join('') || 'Пустая строка';
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
  }

  function setBusy(value) {
    APP.busy = value;
    const panel = document.querySelector('#tms-panel');
    panel?.classList.toggle('tms-busy', value);
    document.querySelectorAll('#tms-panel button, #tms-panel input').forEach(el => {
      if (el.id === 'tms-stop') el.disabled = !value;
      else el.disabled = value;
    });
    if (value) setProgress(Math.max(3, APP.progress?.percent || 0), APP.progress?.label === 'Готово' ? 'Подготавливаю операцию' : APP.progress?.label, APP.progress?.detail || '');
    if (!value) {
      const stop = document.querySelector('#tms-stop');
      if (stop) stop.disabled = true;
      const apply = document.querySelector('#tms-apply');
      if (apply) { const executable = Boolean(APP.plan?.actions?.some(a => a.type !== 'noop')); apply.disabled = !executable || Boolean(APP.plan?.safety?.blocked); apply.textContent = executable ? `Применить к TESSA · ${APP.plan.actions.filter(a => a.type !== 'noop').length}` : 'Применить к TESSA'; }
      const refresh = document.querySelector('#tms-refresh-excel');
      if (refresh) refresh.disabled = !APP.workbook?.roundtrip?.enabled && !document.querySelector('#tms-file')?.files?.length;
      if ((APP.progress?.percent || 0) < 100) {
        const status = APP.plan ? (APP.plan.safety?.blocked ? 'Нужен другой файл или черновик матрицы' : (APP.plan.skippedRows?.length ? `Готово: ${APP.plan.skippedRows.length} строк будут пропущены` : 'Готово к применению')) : 'Готово';
        setProgress(0, status, '');
      }
    }
  }


  function mountUi() {
    if (document.querySelector('#tms-launch')) return;
    const style = document.createElement('style');
    style.textContent = `
      :root{--tms-red:#e31e24;--tms-red-dark:#b5121b;--tms-ink:#292929;--tms-muted:#727272;--tms-line:#e7e7e7;--tms-bg:#fff;--tms-soft:#fff4f4}
      #tms-launch{position:fixed;right:22px;bottom:22px;z-index:2147483645;width:58px;height:58px;padding:0;border:0;border-radius:50%;background:#fff;color:#fff;box-shadow:0 12px 30px #0003;cursor:grab;display:grid;place-items:center;transition:.18s box-shadow;touch-action:none;user-select:none;overflow:hidden}#tms-launch:active{cursor:grabbing}#tms-launch svg{width:58px;height:58px;display:block;pointer-events:none}
      #tms-launch:hover{box-shadow:0 16px 36px #0004}
      #tms-panel{position:fixed;right:22px;bottom:88px;width:min(500px,calc(100vw - 30px));max-height:min(780px,calc(100vh - 110px));z-index:2147483646;background:var(--tms-bg);color:var(--tms-ink);border:1px solid var(--tms-line);border-radius:20px;box-shadow:0 24px 70px #0004;font:13px/1.45 Arial,sans-serif;display:none;overflow:hidden}
      #tms-panel.tms-open{display:flex;flex-direction:column;animation:tms-panel-in .22s ease-out}.tms-head{display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border-bottom:1px solid var(--tms-line);cursor:move;user-select:none}.tms-brand{width:34px;height:34px;border-radius:11px;background:var(--tms-red);color:#fff;display:grid;place-items:center;font-weight:900;font-size:17px}.tms-title{flex:1;min-width:0}.tms-title strong{display:block;font-size:14px}.tms-title small{display:block;color:var(--tms-muted);font-size:11px;margin-top:1px}.tms-close,.tms-help{border:0;background:transparent;color:#555;font-size:20px;cursor:pointer;border-radius:8px;padding:4px 7px}.tms-help{font-size:15px;font-weight:700}.tms-close:hover,.tms-help:hover{background:#f4f4f4}
      .tms-body{padding:14px 16px 16px;overflow:auto;background:linear-gradient(180deg,#fff 0,#fff 55%,#fffafa 100%)}.tms-status{padding:11px 12px;border-radius:13px;background:#f7f7f7;color:#555;margin-bottom:12px;border:1px solid #ededed;transition:.2s}.tms-status-line{display:flex;align-items:center;justify-content:space-between;gap:10px;font-weight:700;color:#353535}.tms-progress-percent{font-variant-numeric:tabular-nums;color:var(--tms-red);font-size:11px}.tms-progress-track{height:7px;border-radius:999px;background:#e9e9e9;overflow:hidden;margin:8px 0 5px;position:relative}.tms-progress-fill{height:100%;width:0;background:linear-gradient(90deg,var(--tms-red),#ff5b60);border-radius:inherit;transition:width .28s ease;position:relative;overflow:hidden}.tms-busy .tms-progress-fill::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,#ffffff80,transparent);transform:translateX(-100%);animation:tms-shimmer 1.15s linear infinite}.tms-progress-detail{min-height:16px;font-size:11px;color:#777}.tms-step{display:grid;gap:8px;margin-bottom:10px;padding:11px 12px;border:1px solid #ececec;border-radius:14px;background:#fff;box-shadow:0 2px 8px #00000008}.tms-step-apply{border-color:#f2c5c7;background:linear-gradient(135deg,#fff 0,#fff6f6 100%)}.tms-step-label{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:#777;font-weight:800}.tms-step-caption{font-size:11px;color:#777;margin-top:-2px}.tms-row{display:flex;gap:8px;flex-wrap:wrap}.tms-controls button,.tms-file-label{border:1px solid #d9d9d9;background:#fff;color:#292929;border-radius:11px;padding:9px 12px;cursor:pointer;font-weight:600;transition:.15s}.tms-controls button:hover,.tms-file-label:hover{border-color:#b9b9b9;background:#fafafa}.tms-controls button.tms-primary{background:var(--tms-red);border-color:var(--tms-red);color:#fff}.tms-controls button.tms-primary:hover{background:var(--tms-red-dark);border-color:var(--tms-red-dark)}.tms-controls button:disabled,.tms-file-label.tms-disabled{opacity:.42;cursor:not-allowed}.tms-controls button.tms-ghost{color:#666}.tms-controls button.tms-danger{color:var(--tms-red-dark)}#tms-file{display:none}.tms-file-name{font-size:12px;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;padding:1px 2px}
      .tms-counters{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin:10px 0}.tms-count{padding:8px 5px;border-radius:11px;text-align:center;font-size:10px;border:1px solid transparent}.tms-count b{display:block;font-size:16px;margin-top:1px}.tms-update{background:#fff7e6;border-color:#f4dfae}.tms-add{background:#edf9f1;border-color:#ccebd7}.tms-delete{background:#fff1f1;border-color:#f2cccc}.tms-noop{background:#f5f5f5;border-color:#e9e9e9}.tms-skip{background:#f6f1ff;border-color:#e1d4f7;color:#62438b}.tms-warning,.tms-skipped-box{margin-top:8px;padding:9px 11px;border-radius:11px;background:#fffaf0;color:#624f21;border:1px solid #f0e1b5}.tms-warning summary,.tms-skipped-box summary{cursor:pointer}.tms-skipped-box{background:#f7f3ff;color:#533b77;border-color:#e2d7f5}.tms-skip-line{padding:6px 0;border-top:1px dashed #e6ddf2}.tms-skip-more{padding-top:7px;font-weight:700}.tms-fatal{margin-top:8px;padding:11px 12px;border-radius:11px;background:#fff0f0;color:#8f1418;border:1px solid #f3b9bb}.tms-action{margin:7px 0;border:1px solid var(--tms-line);border-radius:11px;padding:8px 10px;background:#fff}.tms-action-update{border-left:4px solid #d99a00}.tms-action-add{border-left:4px solid #238b4a}.tms-action-delete{border-left:4px solid #c62828}.tms-action summary{cursor:pointer}.tms-action-body{padding:8px 2px 1px}.tms-diff{padding:7px 0;border-top:1px dashed #e5e5e5}.tms-before{color:#8a3232}.tms-after{color:#17683a}.tms-empty{padding:15px;text-align:center;color:#777}.tms-help-card{display:none;margin-bottom:12px;padding:13px;border-radius:14px;border:1px solid #f0c9cb;background:linear-gradient(135deg,#fff,#fff6f6);animation:tms-pop .18s ease-out}.tms-help-card.tms-show{display:block}.tms-help-card h3{font-size:14px;margin:0 0 8px}.tms-help-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.tms-help-item{padding:8px 9px;border:1px solid #eee;border-radius:10px;background:#fff;font-size:11px}.tms-help-item b{display:block;margin-bottom:2px}.tms-help-note{margin-top:8px;padding:8px 9px;border-radius:10px;background:#fff0f1;font-size:11px}.tms-help-close{margin-top:9px;width:100%;border:1px solid #ddd;background:#fff;border-radius:10px;padding:7px;cursor:pointer;font-weight:700}@keyframes tms-panel-in{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:none}}@keyframes tms-pop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}@keyframes tms-shimmer{to{transform:translateX(100%)}}#tms-apply{width:100%;padding:11px 14px;font-size:13px;box-shadow:0 8px 18px #e31e2420}
      @media(max-width:650px){#tms-panel{right:8px;bottom:74px;width:calc(100vw - 16px)}#tms-launch{right:10px;bottom:10px}.tms-counters{grid-template-columns:repeat(2,1fr)}}
    `;
    document.head.appendChild(style);

    const launch = document.createElement('button');
    launch.id = 'tms-launch';
    launch.innerHTML = cherkizovoLogoSvg();
    launch.title = 'TESSA Matrix Studio';
    document.body.appendChild(launch);

    const panel = document.createElement('section');
    panel.id = 'tms-panel';
    panel.innerHTML = `
      <div class="tms-head" id="tms-drag-handle">
        <div class="tms-brand">${cherkizovoLogoSvg()}</div>
        <div class="tms-title"><strong>TESSA Matrix Studio</strong><small>Excel-редактор матриц · v${APP.version}</small></div>
        <button class="tms-help" title="Как пользоваться">?</button><button class="tms-close" title="Закрыть">×</button>
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
        <div id="tms-status" class="tms-status"><div class="tms-status-line"><span id="tms-progress-label">Готово</span><span id="tms-progress-percent" class="tms-progress-percent">0%</span></div><div class="tms-progress-track"><div id="tms-progress-fill" class="tms-progress-fill"></div></div><div id="tms-progress-detail" class="tms-progress-detail">Скачайте Excel, внесите изменения и загрузите файл обратно.</div></div>
        <div class="tms-controls">
          <div class="tms-step"><div class="tms-step-label">1 · Подготовить Excel</div><div class="tms-row"><button id="tms-download-current" class="tms-primary">Скачать Excel</button><button id="tms-download-fresh">Скачать со свежими справочниками</button></div><div class="tms-step-caption">Обычная выгрузка быстрее. Свежие справочники нужны, если значения недавно добавили или переименовали.</div></div>
          <div class="tms-step"><div class="tms-step-label">2 · Выбрать изменённый файл</div><div class="tms-row"><label for="tms-file" class="tms-file-label">Выбрать Excel</label><input id="tms-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><button id="tms-refresh-excel" class="tms-ghost" disabled>Актуализировать выбранный Excel</button></div><div class="tms-step-caption">Добавит новые поля из текущего шаблона TESSA и постарается сохранить ваши изменения.</div><div id="tms-file-name" class="tms-file-name">Файл не выбран</div></div>
          <div class="tms-step"><div class="tms-step-label">3 · Проверить</div><div class="tms-row"><button id="tms-analyze" class="tms-primary">Проверить изменения</button><button id="tms-stop" class="tms-danger" disabled>Отмена</button></div></div>
          <div class="tms-step tms-step-apply"><div class="tms-step-label">4 · Применить корректные строки</div><button id="tms-apply" class="tms-primary" disabled>Применить к TESSA</button></div>
        </div>
        <div id="tms-summary"></div><div id="tms-plan"></div>
      </div>`;
    document.body.appendChild(panel);

    const togglePanel = () => panel.classList.toggle('tms-open');
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
    panel.querySelector('#tms-stop').addEventListener('click', () => { APP.abortRequested = true; });
    panel.querySelector('#tms-file').addEventListener('change', event => {
      const file = event.target.files?.[0]; panel.querySelector('#tms-file-name').textContent = file?.name || 'Файл не выбран'; panel.querySelector('#tms-refresh-excel').disabled = !file && !APP.workbook?.roundtrip?.enabled;
    });

    panel.querySelector('#tms-download-current').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { await exportCurrentMatrixXlsx(); alert('Excel скачан. Можно редактировать лист «Матрица».'); }
      catch (error) { const message = friendlyErrorMessage(error); log(message, 'error', error); alert(`Не удалось скачать Excel: ${message}`); }
      finally { setBusy(false); }
    });
    panel.querySelector('#tms-download-fresh').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { await exportCurrentMatrixXlsx({ forceDictionaryRefresh: true }); alert('Новый Excel со свежими справочниками скачан.'); }
      catch (error) { const message = friendlyErrorMessage(error); log(message, 'error', error); alert(`Не удалось обновить справочники: ${message}`); }
      finally { setBusy(false); }
    });
    panel.querySelector('#tms-refresh-excel').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { const selectedFile = panel.querySelector('#tms-file').files?.[0]; if (selectedFile) await refreshSelectedWorkbook(selectedFile); else await refreshLoadedWorkbookXlsx(); alert('Выбранный Excel актуализирован. Правки сохранены.'); }
      catch (error) { const message = friendlyErrorMessage(error); log(message, 'error', error); alert(`Не удалось актуализировать Excel: ${message}`); }
      finally { setBusy(false); }
    });
    panel.querySelector('#tms-analyze').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { await analyzeSelectedFile(panel.querySelector('#tms-file').files?.[0]); }
      catch (error) { const message = friendlyErrorMessage(error); log(message, 'error', error); alert(message); }
      finally { setBusy(false); }
    });
    panel.querySelector('#tms-apply').addEventListener('click', async () => {
      if (APP.busy) return; setBusy(true);
      try { const result = await applyPlan(APP.plan); if (result) alert(`Готово.\n\nПрименено: ${result.appliedCount}\nПропущено: ${result.skippedCount}\n\n${result.partial ? 'Ошибочные строки не применялись; остальные изменения сохранены.' : 'Все подготовленные изменения применены.'}`); }
      catch (error) {
        const message = friendlyErrorMessage(error); log(message, 'error', error);
        downloadJson({ app: { name: APP.name, version: APP.version }, planId: APP.plan?.id, failedAt: nowIso(), error: message, technicalError: error?.message || String(error), matrixId: APP.plan?.matrixId || null, logs: APP.logs.slice(-120) }, `TESSA_Matrix_ErrorReport_${Date.now()}.json`);
        alert(`${message}\n\nЕсли понадобится разбор ошибки, приложите автоматически скачанный файл TESSA_Matrix_ErrorReport_*.json.`);
      } finally { setBusy(false); }
    });
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
    normalizeSpace, isOverwriteMatch, stripFormulaMarker, canonicalHeader, canonicalValue, definitionKey, splitCell, mapConcurrent,
    sortedCanon, arraysEqual, hashText, fingerprintFlat, similarityFlat,
    readXlsxArrayBuffer, parseSheetXml, buildColumnMap, workbookRowsToDesired, buildPlan,
    buildRoundtripGrid, createRoundtripXlsxBytes, mergeWorkbookIntoCurrentSnapshot, mergeWorkbookEditsIntoSnapshot, parseSchemaToken, normalizeAction, cherkizovoLogoSvg, issueExcelRows, makeSkippedRow,
    parseBoolean, parseRange, headerSimilarity, countActions, matrixStateCaption, operandKind, typedScalarSemantic, typedRangeSemantic, deletionGuard,
    pickExactReferenceFromViewResult, uniqueReferenceMatches, isGuidLike,
    safePlain, evaluatePlanSafety, resultingRoleCountForAction, matrixNameSimilarity,
    preflightPlan, applyPlan, hydrateMissingIdsForAction, nativeEditAccessState, assertNativeEditMode, isWritableMatrixDraft, assertWritableMatrixDraft,
    finalizeDictionaryEntries, dictionaryLookup, resolveEmbeddedDictionaryValue, normalizeDictionaryCatalog, searchCanonical, booleanSemantic, booleanDisplay, humanQualifierFromDetails, detectPlanDuplicateConflicts, friendlyErrorMessage,
    dictionaryStructureSignature, dictionaryCacheKey, readDictionaryCache, writeDictionaryCache, deleteDictionaryCache, mergeSnapshotIntoDictionaryCatalog, compactPlanForExport,
    TessaBridge,
    constants: { OPERAND, REQUEST, S, F, ROUNDTRIP, DICTIONARY_CACHE, PERFORMANCE },
  };

  bootstrap();
})();
