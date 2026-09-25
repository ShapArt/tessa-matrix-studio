(() => {
  'use strict';

  const INSTALL_KEY = '__TMS_FULL_UAT_V1__';
  if (window[INSTALL_KEY]) return;
  const E = window.__TESSA_MATRIX_SYNC_EXPORTS__;
  if (!E) return;

  const VERSION = '1.0.0';
  const utf8 = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const now = () => new Date().toISOString();

  function actionCoverageFromChecks(checks = [], actions = E.STUDIO_ACTION_REGISTRY || []) {
    const byId = new Map((checks || []).map(check => [check?.id, check]));
    const actionRows = (actions || []).map(action => {
      const check = byId.get(action.uatCheckId) || null;
      const outcomeVerified = Boolean(check && check.status === 'PASS' && check.data?.outcome === action.outcome);
      return {
        id: action.id,
        selector: action.selector,
        event: action.event,
        uatCheckId: action.uatCheckId,
        outcome: action.outcome,
        destructive: Boolean(action.destructive),
        status: check?.status || 'MISSING',
        outcomeVerified,
        detail: check?.detail || '',
        evidence: check?.data || null,
      };
    });
    return {
      total: actionRows.length,
      covered: actionRows.filter(item => item.outcomeVerified).length,
      missing: actionRows.filter(item => !item.outcomeVerified).map(item => item.id),
      actions: actionRows,
    };
  }

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

  // TASK9_SELF_RESTORING_UAT_V1
  // A destructive UAT write is not considered safe merely because its local test
  // finished. Every write leaves a durable cleanup obligation which is settled only
  // after a fresh server read proves the temporary state is gone/restored.
  function createCleanupLedger(baselineSignature = []) {
    const frozenBaseline = [...(baselineSignature || [])];
    const obligations = [];
    let sequence = 0;
    const safeCopy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    const snapshot = () => {
      const rows = obligations.map(item => safeCopy(item));
      const verifiedStatuses = new Set(['verified', 'already-absent']);
      const failedStatuses = new Set(['failed', 'error']);
      return {
        baselineSignature: [...frozenBaseline],
        total: rows.length,
        pending: rows.filter(item => item.status === 'pending').length,
        verified: rows.filter(item => verifiedStatuses.has(item.status)).length,
        failed: rows.filter(item => failedStatuses.has(item.status)).length,
        obligations: rows,
      };
    };
    return {
      baselineSignature: [...frozenBaseline],
      register(input = {}) {
        sequence += 1;
        const item = {
          id: `cleanup-${String(sequence).padStart(4, '0')}`,
          status: 'pending',
          registeredAt: now(),
          ...safeCopy(input),
        };
        if (!item.status) item.status = 'pending';
        obligations.push(item);
        return safeCopy(item);
      },
      resolve(id, result = {}) {
        const item = obligations.find(candidate => candidate.id === id);
        if (!item) throw new Error(`Cleanup obligation ${id} не найдена.`);
        Object.assign(item, safeCopy(result));
        if (!item.status) item.status = 'verified';
        return safeCopy(item);
      },
      snapshot,
    };
  }

  function baselineRestoreProof(baselineSignature = [], afterSignature = [], ledgerSnapshot = {}) {
    const baseline = [...(baselineSignature || [])];
    const after = [...(afterSignature || [])];
    const baselineEquivalent = sameArray(baseline, after);
    const pendingObligations = Number(ledgerSnapshot?.pending || 0);
    const failedObligations = Number(ledgerSnapshot?.failed || 0);
    return {
      status: baselineEquivalent && pendingObligations === 0 && failedObligations === 0 ? 'VERIFIED' : 'UNSAFE',
      baselineEquivalent,
      pendingObligations,
      failedObligations,
      baselineSignature: baseline,
      afterSignature: after,
      checkedAt: now(),
    };
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

  function buildWritableFieldInventory(book, structure, currentCatalog) {
    const criterionById = new Map();
    for (const definition of structure?.conditions || []) {
      const id = definition?.criterionRowId || definition?.id || definition?.rowId || definition?.criterionId;
      if (id !== undefined && id !== null && String(id).trim()) criterionById.set(canon(id), definition);
    }
    const functionById = new Map();
    for (const definition of structure?.functions || []) {
      const id = definition?.id || definition?.functionId || definition?.rowId;
      if (id !== undefined && id !== null && String(id).trim()) functionById.set(canon(id), definition);
    }
    const strategyForKind = kind => ({
      Function: 'dictionary', ReferenceGuid: 'dictionary', ReferenceInt: 'dictionary', Boolean: 'boolean',
      Int: 'integer', Decimal: 'decimal', Date: 'date', DateTime: 'datetime', String: 'string',
    })[kind] || null;
    const inventory = [];
    for (let index = 0; index < (book?.schemaTokens || []).length; index += 1) {
      const token = String(book.schemaTokens[index] || '');
      if (!/^(criterion|function):/.test(token)) continue;
      const [scope, ...tail] = token.split(':');
      const id = tail.join(':');
      const definition = scope === 'criterion' ? criterionById.get(canon(id)) : functionById.get(canon(id));
      if (!definition) continue;
      const kind = scope === 'function' ? 'Function' : E.operandKind({ kind: 'criterion', ...definition });
      const strategy = strategyForKind(kind);
      if (!strategy) continue;
      inventory.push({
        token,
        index,
        label: String(scope === 'function'
          ? (definition.name || definition.functionName || definition.typeName || token)
          : (definition.criterionName || definition.name || token)),
        kind,
        strategy,
        definition,
        entries: strategy === 'dictionary' ? authoritativeEntries(currentCatalog, token) : [],
      });
    }
    return inventory;
  }

  function parseSimpleNumber(text) {
    const value = Number(String(text ?? '').trim().replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  function splitSimpleRange(text) {
    const match = String(text ?? '').trim().match(/^(.+?)\s+(?:-|–|—|\.\.|до)\s+(.+)$/i);
    return match ? [match[1].trim(), match[2].trim()] : null;
  }

  function formatCandidateNumber(value, integer, comma) {
    const rendered = integer ? String(Math.trunc(value)) : String(Math.round(value * 1000) / 1000);
    return comma ? rendered.replace('.', ',') : rendered;
  }

  function parseUatDate(text) {
    const raw = String(text ?? '').trim();
    let match = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatUatDate(date, withTime) {
    const pad = value => String(value).padStart(2, '0');
    const day = pad(date.getUTCDate()), month = pad(date.getUTCMonth() + 1), year = date.getUTCFullYear();
    if (!withTime) return `${day}.${month}.${year}`;
    return `${day}.${month}.${year} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  function shiftedDateCandidate(text, withTime, days = 1) {
    const parsed = parseUatDate(text);
    if (!parsed) return null;
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return formatUatDate(parsed, withTime);
  }

  function fieldCandidateValues(item, currentValue) {
    const currentText = String(currentValue ?? '').trim();
    if (!item) return [];
    if (item.strategy === 'dictionary') {
      return [...(item.entries || [])]
        .sort((a, b) => String(a.selector || a.display || a.id || '').localeCompare(String(b.selector || b.display || b.id || ''), 'ru'))
        .filter(entry => canon(entry.selector || entry.display || '') !== canon(currentText));
    }
    if (item.strategy === 'boolean') {
      const current = canon(currentText);
      if (['да', 'true', '1'].includes(current)) return ['Нет'];
      if (['нет', 'false', '0'].includes(current)) return ['Да'];
      return ['Да', 'Нет'];
    }
    if (item.strategy === 'integer' || item.strategy === 'decimal') {
      const integer = item.strategy === 'integer';
      const comma = currentText.includes(',');
      const range = splitSimpleRange(currentText);
      if (range) {
        const from = parseSimpleNumber(range[0]), to = parseSimpleNumber(range[1]);
        if (from !== null && to !== null) {
          return [`${formatCandidateNumber(from + 1, integer, comma)} – ${formatCandidateNumber(to + 1, integer, comma)}`];
        }
      }
      const current = parseSimpleNumber(currentText);
      if (current === null) return integer ? ['1', '2'] : ['1,5', '2,5'];
      return [formatCandidateNumber(current + 1, integer, comma), formatCandidateNumber(current - 1, integer, comma)]
        .filter(value => canon(value) !== canon(currentText));
    }
    if (item.strategy === 'date' || item.strategy === 'datetime') {
      const withTime = item.strategy === 'datetime';
      const range = splitSimpleRange(currentText);
      if (range) {
        const from = shiftedDateCandidate(range[0], withTime, 1), to = shiftedDateCandidate(range[1], withTime, 1);
        if (from && to) return [`${from} – ${to}`];
      }
      const shifted = shiftedDateCandidate(currentText, withTime, 1);
      const fallbacks = withTime ? ['01.01.2030 12:00', '02.01.2030 12:00'] : ['01.01.2030', '02.01.2030'];
      return [shifted, ...fallbacks].filter((value, index, array) => value && canon(value) !== canon(currentText) && array.indexOf(value) === index);
    }
    if (item.strategy === 'string') {
      const base = currentText ? currentText.slice(0, 70) : 'TMS UAT';
      return [`${base} · UAT`, `${base} · UAT 2`].filter(value => canon(value) !== canon(currentText));
    }
    return [];
  }

  function setFieldCandidate(book, row, item, candidate) {
    if (item.strategy === 'dictionary') return setDictionaryValue(book, row, item.token, candidate);
    row.values[item.index] = String(candidate ?? '');
    const idIndex = companionIndex(book, item.token);
    if (idIndex >= 0) row.values[idIndex] = '';
    return row;
  }

  function canonicalFieldValues(values) {
    const list = Array.isArray(values) ? values : (values === null || values === undefined || values === '' ? [] : [values]);
    return list.map(value => canon(value)).filter(Boolean).sort();
  }

  function candidateEvidenceValue(candidate) {
    if (candidate && typeof candidate === 'object') return {
      id: candidate.id ?? null,
      roleTypeId: candidate.roleTypeId ?? null,
      display: String(candidate.selector || candidate.display || ''),
    };
    return String(candidate ?? '');
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
      skippedValues: (plan?.skippedValues || []).slice(0, 30),
      safety: plan?.safety ? { blocked: Boolean(plan.safety.blocked), blockedReasons: plan.safety.blockedReasons || [] } : null,
    };
  }

  function applySafety(plan, bridge) {
    plan.safety = E.evaluatePlanSafety(plan, bridge);
    plan.matrixInfo = plan.safety?.matrixInfo || bridge.matrixInfo();
    return plan;
  }

  async function workbookFromSnapshot(structure, snapshot, bridge, catalog, options = {}) {
    const bytes = await E.createRoundtripXlsxBytes(structure, snapshot, bridge.matrixInfo(), catalog, { includeActions: true });
    const buffer = E.exactArrayBuffer(bytes);
    const book = await E.readXlsxArrayBuffer(buffer, 'TESSA_UAT_CURRENT.xlsx', {
      skipSheetNames: ['Словари'],
      dictionaryCatalog: catalog,
      selectiveInflate: true,
      // Only the one base workbook used by the dictionary-refresh scenario needs its
      // raw OPC/ZIP parts later. Temporary UAT books are parse-and-discard.
      retainArchive: options.retainArchive === true,
    });
    return { bytes, book };
  }

  function chooseSourceRow(book, rng) {
    const candidates = (book.rows || []).filter(row => rowHasRole(book, row));
    if (!candidates.length) throw new Error('В матрице нет строки с исполнителем, которую можно безопасно использовать как шаблон временной строки.');
    return candidates[Math.floor(rng() * candidates.length)];
  }

  // PROD_SHADOW_UAT_V1
  // Deterministic, read-only stress layer derived from the shape of a real production
  // workbook. It deliberately does not depend on the TEST environment's smaller live
  // dictionaries: high-cardinality catalogs and a 488 -> 103 same-template transfer are
  // synthesized in memory, while live TESSA checks continue separately below.
  async function runProductionShadowAudit() {
    const nowMs = () => Number(globalThis.performance?.now?.() ?? Date.now());
    const started = nowMs();
    const profile = Object.freeze({
      sourceRows: 488,
      targetRows: 103,
      sourceCriteria: 14,
      functions: 9,
      retiredColumns: 2,
      targetOnlyColumns: 4,
      observedSkippedRows: 478,
      observedIssueOccurrences: 2386,
      observedAutoFragmentResolutions: 239,
      observedCategories: { notFound: 2168, positionOnly: 172, ambiguous: 45, noPerformers: 1 },
      observedRoleTypeIds: ['0', '1', '2', '4'],
      syntheticOrganizationEntries: 50002,
      syntheticEmployeeEntries: 50007,
      syntheticMissQueries: 100,
      syntheticIssueVolume: 2386,
      syntheticAliasMigrations: 239,
    });

    const orgEntries = Array.from({ length: 50000 }, (_, index) => ({
      id: `qa-org-${index}`,
      display: `QA Организация ${String(index).padStart(5, '0')}`,
      roleTypeId: '',
      source: 'PROD_SHADOW',
      // The real PROD workbook contained 239 automatic old-caption -> current-caption
      // resolutions. Preserve that cardinality without embedding business values.
      previousSelectors: index < 239 ? [`QA Архивная организация ${String(index).padStart(5, '0')}`] : [],
    }));
    orgEntries.push(
      { id: 'qa-org-dup-a', display: 'QA Одинаковая организация', qualifier: 'Регион A', source: 'PROD_SHADOW' },
      { id: 'qa-org-dup-b', display: 'QA Одинаковая организация', qualifier: 'Регион B', source: 'PROD_SHADOW' },
    );

    const peopleEntries = Array.from({ length: 50000 }, (_, index) => ({
      id: `qa-person-${index}`,
      roleTypeId: 1,
      display: `Тестов${index} Т.Т. — Специалист`,
      displayName: `Тестов${index} Т.Т. — Специалист`,
      shortName: `Тестов${index} Т.Т.`,
      fullName: `Тестов${index} Тест Тестович`,
      position: 'Специалист',
      department: 'QA',
      nativeDisplay: `Тестов${index} Т.Т.`,
      previousSelectors: [`Тестов${index} Т.Т.`],
      source: 'MtxRoles',
      status: 'Доступно',
    }));
    peopleEntries.push(
      {
        id: 'qa-title-drift', roleTypeId: 1,
        display: 'Сидоров С.С. — Руководитель центра', displayName: 'Сидоров С.С. — Руководитель центра',
        shortName: 'Сидоров С.С.', fullName: 'Сидоров Сергей Сергеевич',
        position: 'Руководитель центра', department: 'QA', nativeDisplay: 'Сидоров С.С.',
        previousSelectors: ['Сидоров С.С.'], source: 'MtxRoles', status: 'Доступно',
      },
      {
        id: 'qa-name-a', roleTypeId: 1,
        display: 'Иванов И.И. — Эксперт', displayName: 'Иванов И.И. — Эксперт',
        shortName: 'Иванов И.И.', fullName: 'Иванов Иван Иванович',
        position: 'Эксперт', department: 'QA A', nativeDisplay: 'Иванов И.И.',
        previousSelectors: ['Иванов И.И.'], source: 'MtxRoles', status: 'Доступно',
      },
      {
        id: 'qa-name-b', roleTypeId: 1,
        display: 'Иванов И.И. — Аналитик', displayName: 'Иванов И.И. — Аналитик',
        shortName: 'Иванов И.И.', fullName: 'Иванов Игорь Ильич',
        position: 'Аналитик', department: 'QA B', nativeDisplay: 'Иванов И.И.',
        previousSelectors: ['Иванов И.И.'], source: 'MtxRoles', status: 'Доступно',
      },
      {
        id: 'qa-position-only', roleTypeId: 1,
        display: 'Киреева Ю.А. — Директор', displayName: 'Киреева Ю.А. — Директор',
        shortName: 'Киреева Ю.А.', fullName: 'Киреева Юлия Александровна',
        position: 'Директор', department: 'QA', nativeDisplay: 'Киреева Ю.А.',
        previousSelectors: ['Киреева Ю.А.'], source: 'MtxRoles', status: 'Доступно',
      },
      { id: 'qa-role-static', roleTypeId: 0, display: 'QA статическая роль', source: 'MtxRoles', status: 'Доступно' },
      { id: 'qa-role-department', roleTypeId: 2, display: 'QA подразделение', source: 'MtxRoles', status: 'Доступно' },
      { id: 'qa-role-context', roleTypeId: 4, display: 'QA контекстная роль', source: 'MtxRoles', status: 'Доступно' },
    );

    const catalogStarted = nowMs();
    const catalog = E.normalizeDictionaryCatalog({
      catalogs: {
        orgs: { id: 'orgs', label: 'Организация', sourceView: 'PROD_SHADOW', entries: orgEntries },
        people: { id: 'people', label: 'Подписание', sourceView: 'MtxRoles', entries: peopleEntries },
      },
      columnCatalogIds: { 'criterion:org': 'orgs', 'function:sign': 'people' },
      stats: { errors: [], warnings: [] },
    });
    const catalogMs = nowMs() - catalogStarted;
    if (catalog.stats.entries !== profile.syntheticOrganizationEntries + profile.syntheticEmployeeEntries) {
      throw new Error(`Production-shadow: нормализация справочников потеряла значения: ${catalog.stats.entries}.`);
    }

    const orgWorkbook = { dictionaryCatalog: catalog };
    const orgColumn = { key: 'criterion:org', kind: 'criterion', excelHeader: 'Организация' };
    const signColumn = { key: 'function:sign', kind: 'function', excelHeader: 'Подписание' };

    const lastOrg = E.resolveEmbeddedDictionaryValue(orgWorkbook, orgColumn, 'QA Организация 49999', 'qa-org-49999');
    if (!lastOrg.resolved || lastOrg.explicit !== 'qa-org-49999') throw new Error('Production-shadow: точный ID в большом справочнике не разрешился.');
    const duplicateOrg = E.resolveEmbeddedDictionaryValue(orgWorkbook, orgColumn, 'QA Одинаковая организация', '');
    if (duplicateOrg.resolved || !/неоднознач/i.test(duplicateOrg.issue || '')) throw new Error('Production-shadow: одинаковые организации должны оставаться неоднозначными.');

    const aliasStarted = nowMs();
    for (let index = 0; index < profile.syntheticAliasMigrations; index += 1) {
      const oldCaption = `QA Архивная организация ${String(index).padStart(5, '0')}`;
      const migrated = E.resolveEmbeddedDictionaryValue(orgWorkbook, orgColumn, oldCaption, '');
      if (!migrated.resolved || migrated.explicit !== `qa-org-${index}` || migrated.resolution !== 'unique-fragment') {
        throw new Error(`Production-shadow: historical selector #${index} did not migrate safely: ${migrated.issue || migrated.resolution || 'unresolved'}`);
      }
    }
    const aliasMigrationMs = nowMs() - aliasStarted;

    const staleTitle = E.resolveEmbeddedDictionaryValue(orgWorkbook, signColumn, 'Сидоров С.С. - Руководитель МФЦ', '');
    if (!staleTitle.resolved || staleTitle.explicit !== 'qa-title-drift|1') throw new Error(`Production-shadow: ФИО со старой должностью не разрешилось: ${staleTitle.issue || ''}`);
    const namesake = E.resolveEmbeddedDictionaryValue(orgWorkbook, signColumn, 'Иванов И.И.', '');
    if (namesake.resolved || !/неоднознач/i.test(namesake.issue || '')) throw new Error('Production-shadow: одинаковое ФИО должно требовать явного выбора.');
    const positionOnly = E.resolveEmbeddedDictionaryValue(orgWorkbook, signColumn, 'Директор', '');
    if (positionOnly.resolved || positionOnly.resolution !== 'employee-position-only') throw new Error('Production-shadow: должность без ФИО не должна автоматически выбирать сотрудника.');

    for (const [id, roleTypeId, display] of [
      ['qa-role-static', 0, 'QA статическая роль'],
      ['qa-title-drift', 1, 'Сидоров С.С. — Руководитель центра'],
      ['qa-role-department', 2, 'QA подразделение'],
      ['qa-role-context', 4, 'QA контекстная роль'],
    ]) {
      const resolved = E.resolveEmbeddedDictionaryValue(orgWorkbook, signColumn, display, `${id}|${roleTypeId}`);
      if (!resolved.resolved || resolved.explicit !== `${id}|${roleTypeId}`) {
        throw new Error(`Production-shadow: RoleTypeID=${roleTypeId} не сохранил точную identity.`);
      }
    }

    const missStarted = nowMs();
    const missQueries = Array.from({ length: profile.syntheticMissQueries }, (_, index) => `QA отсутствующее значение ${index}`);
    let unresolved = 0;
    for (let index = 0; index < profile.syntheticIssueVolume; index += 1) {
      const value = missQueries[index % missQueries.length];
      const result = E.resolveEmbeddedDictionaryValue(orgWorkbook, orgColumn, value, '');
      if (!result.resolved) unresolved += 1;
    }
    const missMs = nowMs() - missStarted;
    if (unresolved !== profile.syntheticIssueVolume) throw new Error('Production-shadow: отсутствующее значение неожиданно разрешилось.');

    // Replay the exact non-secret PROD issue envelope captured from the colleague
    // workbook: same field distribution, same category cardinalities, same skipped-row
    // count and the same dense-row ceiling. This turns future PROD dry-runs into a
    // deterministic TEST-side contract without copying employees/organisations.
    const observedFieldSpec = [
      ['Организация ГЧ ✅', { notFound: 628, positionOnly: 0, ambiguous: 42 }],
      ['Обязательные', { notFound: 534, positionOnly: 16, ambiguous: 0 }],
      ['Подписание', { notFound: 318, positionOnly: 150, ambiguous: 0 }],
      ['Доп. область документа ✅', { notFound: 342, positionOnly: 0, ambiguous: 3 }],
      ['Область документа ✅', { notFound: 261, positionOnly: 0, ambiguous: 0 }],
      ['Для сведения', { notFound: 51, positionOnly: 5, ambiguous: 0 }],
      ['Ознакомление', { notFound: 21, positionOnly: 1, ambiguous: 0 }],
      ['Доп. эксперт', { notFound: 9, positionOnly: 0, ambiguous: 0 }],
      ['Доп. согласование', { notFound: 3, positionOnly: 0, ambiguous: 0 }],
      ['Функция ✅', { notFound: 1, positionOnly: 0, ambiguous: 0 }],
    ];
    const observedMessages = [];
    for (const [field, spec] of observedFieldSpec) {
      for (let index = 0; index < spec.notFound; index += 1) {
        observedMessages.push(`Значение "QA-${field}-${index}" не найдено в справочнике "${field}".`);
      }
      for (let index = 0; index < spec.positionOnly; index += 1) {
        observedMessages.push(`"QA должность ${index}" похоже на должность, а не на ФИО сотрудника. Выберите сотрудника явно из актуального справочника "${field}".`);
      }
      for (let index = 0; index < spec.ambiguous; index += 1) {
        observedMessages.push(`По запросу "QA неоднозначное ${index}" в столбце "${field}" найдено 2 вариантов: QA A; QA B.`);
      }
    }
    observedMessages.push('после изменений не останется исполнителей.');
    if (observedMessages.length !== profile.observedIssueOccurrences) {
      throw new Error(`Production-shadow: observed issue fixture drifted: ${observedMessages.length}.`);
    }

    const observedPerRow = Array.from({ length: profile.observedSkippedRows }, () => []);
    for (let index = 0; index < 21; index += 1) observedPerRow[0].push(observedMessages.shift());
    let observedRow = 1;
    while (observedMessages.length) {
      if (observedPerRow[observedRow].length < 5) observedPerRow[observedRow].push(observedMessages.shift());
      observedRow += 1;
      if (observedRow >= observedPerRow.length) observedRow = 1;
    }
    const observedSkippedRows = observedPerRow.map((messages, index) => ({
      excelRow: 15 + index,
      reason: messages.map(message => `Excel ${15 + index}: ${message}`).join(' '),
      source: 'excel-validation',
      actionType: 'add',
    }));
    const observedPlan = {
      counts: { noop: 2, update: 0, add: 8, delete: 101, skip: profile.observedSkippedRows },
      workbook: { rows: Array.from({ length: profile.sourceRows }, (_, index) => ({ excelRow: 15 + index })) },
      snapshot: { rows: Array.from({ length: profile.targetRows }, (_, index) => ({ index })) },
      structure: {
        conditions: Array.from({ length: profile.sourceCriteria }, (_, index) => ({ criterionRowId: `qa-observed-c-${index}` })),
        functions: Array.from({ length: profile.functions }, (_, index) => ({ id: `qa-observed-f-${index}` })),
      },
      columnMap: {
        retiredColumns: Array.from({ length: profile.retiredColumns }, (_, index) => ({ id: `qa-retired-${index}` })),
        missingCurrentColumns: Array.from({ length: profile.targetOnlyColumns }, (_, index) => ({ id: `qa-target-${index}` })),
      },
      safety: {
        blocked: true,
        mappedHeaders: 23,
        totalHeaders: 23,
        mappedFunctions: 9,
        workbookContext: { kind: 'same-template-foreign-matrix' },
        crossMatrixReplacement: true,
      },
      desired: [{ resolutions: Array.from({ length: profile.observedAutoFragmentResolutions }, (_, index) => `qa-resolution-${index}`) }],
      skippedRows: observedSkippedRows,
    };
    const observedProfile = E.productionShadowProfile(observedPlan);
    const observedExpectedCategories = profile.observedCategories;
    const categoriesExact = Object.entries(observedExpectedCategories)
      .every(([key, value]) => Number(observedProfile.resolution.categories?.[key] || 0) === Number(value))
      && Number(observedProfile.resolution.categories?.other || 0) === 0;
    if (
      observedProfile.sourceRows !== profile.sourceRows
      || observedProfile.targetRows !== profile.targetRows
      || observedProfile.resolution.skippedRows !== profile.observedSkippedRows
      || observedProfile.resolution.issueOccurrences !== profile.observedIssueOccurrences
      || observedProfile.resolution.autoUniqueFragment !== profile.observedAutoFragmentResolutions
      || observedProfile.resolution.maxIssuesPerRow !== 21
      || !categoriesExact
      || observedProfile.resolution.fields?.['Организация ГЧ ✅']?.total !== 670
      || observedProfile.resolution.fields?.['Обязательные']?.total !== 550
      || observedProfile.resolution.fields?.['Подписание']?.total !== 468
    ) {
      throw new Error(`Production-shadow: observed PROD issue envelope drifted: ${JSON.stringify(observedProfile.resolution)}`);
    }

    const O = E.constants.OPERAND;
    const commonConditions = Array.from({ length: 12 }, (_, index) => ({
      criterionRowId: `qa-common-${index}`, criterionName: `QA поле ${index + 1}`, operandTypeId: O.String,
    }));
    const retiredConditions = Array.from({ length: 2 }, (_, index) => ({
      criterionRowId: `qa-retired-${index}`, criterionName: `QA старое ${index + 1}`, operandTypeId: O.String,
    }));
    const targetOnlyConditions = Array.from({ length: 4 }, (_, index) => ({
      criterionRowId: `qa-target-${index}`, criterionName: `QA новое ${index + 1}`, operandTypeId: O.String,
    }));
    const functions = Array.from({ length: profile.functions }, (_, index) => ({
      id: `qa-fn-${index}`, name: `QA функция ${index + 1}`, typeName: 'Исполнитель',
    }));
    const sourceStructure = { templateId: 'qa-prod-shadow-template', conditions: [...commonConditions, ...retiredConditions], functions };
    const targetStructure = { templateId: sourceStructure.templateId, conditions: [...commonConditions, ...targetOnlyConditions], functions };

    const makeSnapshotRow = (prefix, index, sourceStructureForRow) => {
      const flat = {}, values = {}, roles = {};
      for (const condition of sourceStructureForRow.conditions) {
        const display = `${prefix}-${index}-${condition.criterionRowId}`;
        flat[`criterion:${condition.criterionRowId}`] = [display];
        values[condition.criterionRowId] = [{ kind: 'String', value: display, display }];
      }
      for (let fnIndex = 0; fnIndex < sourceStructureForRow.functions.length; fnIndex += 1) {
        const fn = sourceStructureForRow.functions[fnIndex];
        const roleIndex = index % 40;
        const id = `${prefix}-role-${fnIndex}-${roleIndex}`;
        const display = `${prefix} QA ${fnIndex}-${roleIndex}`;
        flat[`function:${fn.id}`] = [display];
        roles[fn.id] = [{ id, display, roleTypeId: 1 }];
      }
      return {
        index,
        rowCardId: `${prefix}-card-${index}`,
        versionId: `${prefix}-version-${index}`,
        fingerprint: E.fingerprintFlat(flat),
        values,
        roles,
        flat,
      };
    };
    const makeSnapshot = (prefix, size, rowStructure) => ({
      matrixId: `${prefix}-matrix`,
      templateId: sourceStructure.templateId,
      rows: Array.from({ length: size }, (_, index) => makeSnapshotRow(prefix, index, rowStructure)),
      criterionIdCache: new Map(), roleIdByFunctionCache: new Map(), roleIdCache: new Map(),
    });
    const sourceSnapshot = makeSnapshot('qa-source', profile.sourceRows, sourceStructure);
    const targetSnapshot = makeSnapshot('qa-target', profile.targetRows, targetStructure);
    const sourceInfo = { matrixId: sourceSnapshot.matrixId, TemplateID: sourceStructure.templateId, TemplateName: 'PROD SHADOW', StateName: 'Черновик' };
    const targetInfo = { matrixId: targetSnapshot.matrixId, TemplateID: sourceStructure.templateId, TemplateName: 'PROD SHADOW', StateName: 'Черновик' };

    const planStarted = nowMs();
    const sourceCatalog = E.mergeSnapshotIntoDictionaryCatalog(null, sourceStructure, sourceSnapshot);
    const bytes = await E.createRoundtripXlsxBytes(sourceStructure, sourceSnapshot, sourceInfo, sourceCatalog, { includeActions: true });
    const buffer = E.exactArrayBuffer(bytes);
    const workbook = await E.readXlsxArrayBuffer(buffer, 'TESSA_PROD_SHADOW.xlsx');
    const plan = E.buildPlan(workbook, targetStructure, targetSnapshot, targetInfo);
    const safety = E.evaluatePlanSafety(plan, { matrixInfo: () => targetInfo, localizeValue: value => value });
    const planMs = nowMs() - planStarted;
    const totalMs = nowMs() - started;
    if (bytes.byteLength >= 32 * 1024 * 1024) throw new Error(`Production-shadow: XLSX вышел за production input ceiling: ${bytes.byteLength} байт.`);
    if (catalogMs > 30000) throw new Error(`Production-shadow: нормализация ~100k справочных значений заняла ${Math.round(catalogMs)} мс (>30 сек).`);
    if (missMs > 15000) throw new Error(`Production-shadow: повторная проверка ${profile.syntheticIssueVolume} проблемных значений заняла ${Math.round(missMs)} мс (>15 сек).`);
    if (totalMs > 60000) throw new Error(`Production-shadow: полный synthetic-прогон занял ${Math.round(totalMs)} мс (>60 сек).`);

    if (plan.counts.add !== profile.sourceRows || plan.counts.delete !== profile.targetRows || plan.counts.skip !== 0 || plan.counts.update !== 0 || plan.counts.noop !== 0) {
      throw new Error(`Production-shadow: 488→103 planner drift: ${JSON.stringify(plan.counts)}`);
    }
    if (safety.blocked) throw new Error(`Production-shadow: полный same-template перенос заблокирован: ${(safety.blockedReasons || []).join(' ')}`);
    if (E.evaluateApplyBatch(plan.actions).blocked) throw new Error('Production-shadow: пакет 591 операций ошибочно превысил Apply ceiling.');
    if ((plan.columnMap?.retiredColumns || []).length !== profile.retiredColumns || (plan.columnMap?.missingCurrentColumns || []).length !== profile.targetOnlyColumns) {
      throw new Error(`Production-shadow: schema drift не совпал: retired=${plan.columnMap?.retiredColumns?.length || 0}, targetOnly=${plan.columnMap?.missingCurrentColumns?.length || 0}.`);
    }

    return {
      profile,
      observedProfile,
      metrics: {
        totalMs: Math.round(totalMs),
        catalogMs: Math.round(catalogMs),
        repeatedMissMs: Math.round(missMs),
        aliasMigrationMs: Math.round(aliasMigrationMs),
        plannerMs: Math.round(planMs),
        xlsxBytes: bytes.byteLength,
        dictionaryEntries: catalog.stats.entries,
        operationCount: plan.actions.filter(action => action.type !== 'noop').length,
      },
      assertions: {
        exactLargeDictionaryId: true,
        duplicateOrganizationFailClosed: true,
        staleEmployeeTitleResolvedByFio: true,
        previousSelectorMigration: true,
        observedIssueEnvelopeExact: true,
        namesakeFailClosed: true,
        positionOnlyFailClosed: true,
        roleTypeDiversityPreserved: true,
        repeatedMissingValuesFailClosed: true,
        crossMatrixScale: true,
        schemaDrift: true,
      },
    };
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

  function findSafeUpdateCandidate(book, structure, snapshot, bridge, catalog, rng, options = {}) {
    const columns = shuffled(mutableCriterionColumns(book, catalog, 2), rng);
    const sources = options.source ? [options.source] : shuffled((book.rows || []).filter(row => rowHasRole(book, row)), rng);
    for (const source of sources) {
      for (const column of columns) {
        const current = canon(source.values?.[column.index] || '');
        const entries = shuffled(column.entries.filter(entry => canon(entry.selector || entry.display) !== current), rng).slice(0, 40);
        for (const entry of entries) {
          const candidateBook = cloneWorkbook(book);
          const candidateRow = candidateBook.rows.find(row => Number(row.excelRow) === Number(source.excelRow));
          if (!candidateRow) continue;
          setDictionaryValue(candidateBook, candidateRow, column.key, entry);
          const plan = E.buildPlan(candidateBook, structure, snapshot, bridge.matrixInfo());
          if ((plan.counts?.update || 0) === 1
            && (plan.counts?.skip || 0) === 0
            && (plan.counts?.add || 0) === 0
            && (plan.counts?.delete || 0) === 0) {
            const action = (plan.actions || []).find(item => item.type === 'update');
            if (action) return { book: candidateBook, row: candidateRow, source, column, entry, action, plan };
          }
        }
      }
    }
    throw new Error('Не удалось подобрать безопасный UPDATE из актуальных справочников.');
  }

  async function findPhysicalSafeUpdateCandidate(book, structure, snapshot, bridge, catalog, rng) {
    const sources = shuffled((book.rows || []).filter(row => rowHasRole(book, row)), rng);
    let lastEvidence = null;
    for (const sourceRow of sources) {
      let edited = null;
      try {
        edited = findSafeUpdateCandidate(book, structure, snapshot, bridge, catalog, rng, { source: sourceRow });
      } catch (_) {
        continue;
      }
      const visibleValue = String(edited.entry?.selector || edited.entry?.display || '');
      if (!visibleValue) continue;
      let physical = null;
      try {
        physical = await E.patchWorkbookVisibleCellForUat(book, edited.source.excelRow, edited.column.index, visibleValue, catalog);
        const physicalPlan = E.buildPlan(physical.workbook, structure, snapshot, bridge.matrixInfo());
        const action = (physicalPlan.actions || []).find(item => item.type === 'update');
        lastEvidence = { excelRow: edited.source.excelRow, counts: physicalPlan.counts, skippedRows: physicalPlan.skippedRows || [] };
        if ((physicalPlan.counts?.update || 0) === 1
          && (physicalPlan.counts?.skip || 0) === 0
          && (physicalPlan.counts?.add || 0) === 0
          && (physicalPlan.counts?.delete || 0) === 0
          && action) {
          return { ...edited, physical, physicalPlan, selection: 'physical-safe-update' };
        }
      } finally {
        if (physical?.workbook) E.releaseWorkbookArchive(physical.workbook);
      }
    }
    throw new Error(`UAT не нашёл collision-safe UPDATE, который остаётся безопасным после физической правки/re-read XLSX: ${JSON.stringify(lastEvidence)}`);
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
      format: 'TESSA_FULL_UAT_V1', studioVersion: String(E.studioVersion?.() || 'unknown'), runnerVersion: VERSION, seed, startedAt,
      status: 'INCOMPLETE', matrix: null, checks: [], timeline: [], cleanup: [], cleanupLedger: null, restoreProof: null, dictionaryAudit: null, functionalActionAudit: null,
      rolePresentationAudit: null, recordKeepingAudit: null, fieldMutationAudit: null, productionShadowAudit: null, liveConfirmation: options.liveConfirmation === 'full-uat-confirmed' ? 'full-uat-confirmed' : null, writesAttempted: 0, writesCompleted: 0,
    };
    const packageEntries = [];
    let baseline = null, structure = null, catalog = null, bridge = null, baselineSignature = null;
    let cleanupLedgerController = null;
    let cleanupUnsafe = false;
    // FULL_UAT_ACTION_COVERAGE_FINAL_V1
    let reconciliationActionReceiptContext = null;
    // FULL_UAT_PINNED_CONTEXT_RECOVERY_V1
    let pinnedUatBridge = null;
    let pinnedUatMatrixId = '';
    let pinnedUatTemplateId = '';
    // FULL_UAT_PREFLIGHT_RECOVERY_STATE_V1
    let initializationPhase = 'not-started';
    let baselineCaptured = false;
    const timeline = (stage, detail, extra = null) => report.timeline.push({ at: now(), stage, detail, ...(extra ? { extra } : {}) });
    const addCheck = (id, title, status, detail, extra = {}) => {
      const item = { id, title, status, detail, ...extra }; report.checks.push(item); timeline(id, `${status}: ${detail}`); return item;
    };

    const registerCleanupObligation = input => {
      if (!cleanupLedgerController) throw new Error('Cleanup ledger ещё не инициализирован baseline-сигнатурой.');
      const item = cleanupLedgerController.register(input);
      report.cleanupLedger = cleanupLedgerController.snapshot();
      timeline('cleanup-register', `${item.kind || 'unknown'} ${item.id}`, { scenarioId: item.scenarioId || null, rowCardId: item.rowCardId || null, token: item.token || null });
      return item;
    };
    const resolveCleanupObligation = (id, result = {}) => {
      if (!cleanupLedgerController || !id) return null;
      const item = cleanupLedgerController.resolve(id, result);
      report.cleanupLedger = cleanupLedgerController.snapshot();
      timeline('cleanup-resolve', `${item.id}: ${item.status}`, { scenarioId: item.scenarioId || null, rowCardId: item.rowCardId || null, token: item.token || null });
      return item;
    };
    const pendingCleanupForRow = rowCardId => cleanupLedgerController
      ? cleanupLedgerController.snapshot().obligations.filter(item => item.status === 'pending' && canon(item.rowCardId) === canon(rowCardId))
      : [];
    const resolveCleanupForAbsentRow = (rowCardId, status = 'already-absent', extra = {}) => {
      for (const obligation of pendingCleanupForRow(rowCardId)) {
        resolveCleanupObligation(obligation.id, { status, resolvedAt: now(), ...extra });
      }
    };
    const registerFieldMutationObligations = (plan, scenarioId, rowCardId) => {
      const executable = (plan?.actions || []).filter(action => action.type === 'update' && canon(action.currentRow?.rowCardId) === canon(rowCardId));
      const ids = [];
      for (const action of executable) {
        for (const change of action.changes || []) {
          const obligation = registerCleanupObligation({
            kind: 'field-mutation',
            scenarioId,
            rowCardId,
            token: String(change.key || ''),
            before: E.safePlain(change.before || [], { maxDepth: 4, maxKeys: 50, maxArray: 50 }),
            candidate: E.safePlain(change.after || [], { maxDepth: 4, maxKeys: 50, maxArray: 50 }),
            restoreStrategy: 'restore-or-delete-temporary-row',
            createdAt: now(),
          });
          ids.push(obligation.id);
        }
      }
      return ids;
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
      // FULL_UAT_PINNED_CONTEXT_RECOVERY_V1
      const freshBridge = pinnedUatBridge || await E.TessaBridge.create();
      const freshInfo = freshBridge.matrixInfo();
      if (report.matrix?.matrixId && canon(freshInfo.matrixId) !== canon(report.matrix.matrixId)) {
        throw new Error('Pinned UAT bridge потерял исходную матрицу.');
      }
      return { bridge: freshBridge, snapshot: await freshBridge.loadSnapshot(structure) };
    }

    async function assertActiveUatContextBeforeWrite() {
      const activeBridge = await E.TessaBridge.create();
      const activeInfo = activeBridge.matrixInfo();
      if (pinnedUatMatrixId && canon(activeInfo.matrixId) !== canon(pinnedUatMatrixId)) {
        throw new Error('Во время UAT открыта другая матрица; новая запись не начата.');
      }
      if (pinnedUatTemplateId && canon(activeInfo.TemplateID) !== canon(pinnedUatTemplateId)) {
        throw new Error('Во время UAT изменился шаблон матрицы; новая запись не начата.');
      }
      return activeBridge;
    }
    // UAT_DICTIONARY_REUSE_V1
    // Dictionary views are large but immutable for the duration of one UAT run.
    // Force-load them once (and once again in the explicit refresh test); between writes
    // only overlay current matrix values, which is O(rows) and does no View API I/O.
    const catalogForSnapshot = snapshot => E.mergeSnapshotIntoDictionaryCatalog(catalog, structure, snapshot);
    async function applySingle(plan, label, options = {}) {
      applySafety(plan, bridge);
      if (plan.safety?.blocked) throw new Error(plan.safety.blockedReasons?.join(' ') || `${label}: Apply заблокирован.`);
      const executable = (plan.actions || []).filter(action => action.type !== 'noop');
      if (executable.length !== 1) throw new Error(`${label}: ожидалась 1 операция, получено ${executable.length}.`);
      if (!options.recovery) await assertActiveUatContextBeforeWrite();
      report.writesAttempted += 1;
      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat', deferMainMatrixSave: true, runtimeBridge: bridge, runtimeStructure: structure });
      if (!result) throw new Error(`${label}: применение отменено.`);
      // FULL_UAT_STRICT_APPLY_RESULT_V1
      // FULL_UAT_ACCEPTED_WRITE_RESULT_V2
      // FULL_UAT_APPLY_FAILURE_EVIDENCE_V3
      if (result.cancelled === true
        || Number(result.appliedCount || 0) !== 1
        || Number(result.failedCount || 0) !== 0
        || Number(result.notStartedCount || 0) !== 0
        || Number(result.preflightSkippedCount || 0) !== 0
        || Number(result.storeSkippedCount || 0) !== 0) {
        const firstRejected = (result.skipped || [])[0] || (result.rows || []).find(row => row?.status !== 'ok') || null;
        const firstReason = String(firstRejected?.reason || firstRejected?.error || firstRejected?.reasonCode || '').trim();
        throw new Error(`${label}: серверная операция завершилась не полностью (status=${result.status}, applied=${result.appliedCount}, skipped=${result.skippedCount}, notStarted=${result.notStartedCount}).` + (firstReason ? ' Причина: ' + firstReason : ''));
      }
      report.writesCompleted += 1;
      return result;
    }
    async function cleanupCreatedRow(rowCardId, scenarioId) {
      try {
        const current = await freshSnapshot();
        const target = current.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
        if (!target) { report.cleanup.push({ scenarioId, rowCardId, status: 'already-absent', at: now() }); resolveCleanupForAbsentRow(rowCardId, 'already-absent', { resolvedBy: scenarioId }); return true; }
        const currentCatalog = catalogForSnapshot(current.snapshot);
        const { book } = await workbookFromSnapshot(structure, current.snapshot, current.bridge, currentCatalog);
        const cardIndex = tokenIndex(book, 'system:rowCardId');
        book.rows = book.rows.filter(row => canon(row.values?.[cardIndex]) !== canon(rowCardId));
        let plan = E.buildPlan(book, structure, current.snapshot, current.bridge.matrixInfo()); plan = applySafety(plan, current.bridge);
        const deletes = plan.actions.filter(action => action.type === 'delete' && canon(action.currentRow?.rowCardId) === canon(rowCardId));
        if (deletes.length !== 1 || plan.actions.filter(action => action.type !== 'noop').length !== 1) throw new Error(`Cleanup не построил единственный DELETE временной строки: ${JSON.stringify(plan.counts)}.`);
        bridge = current.bridge; const result = await applySingle(plan, scenarioId + ': cleanup DELETE', { recovery: true });
        // Preserve one real DELETE receipt so the Reconcile action can be exercised later
        // against the fully saved/restored matrix. This is real product reconciliation,
        // not a synthetic action-coverage checkbox.
        if (!reconciliationActionReceiptContext) {
          const deleteAction = deletes[0];
          const receipt = E.createMutationReceipt({
            type: 'delete', action: deleteAction,
            rowCardId: deleteAction.currentRow?.rowCardId,
            versionId: deleteAction.currentRow?.versionId,
            expectedRow: null, structure,
          });
          reconciliationActionReceiptContext = {
            matrixId: report.matrix?.matrixId,
            templateId: report.matrix?.templateId,
            receipts: [receipt],
          };
        }
        const verified = await freshSnapshot();
        if (verified.snapshot.rows.some(row => canon(row.rowCardId) === canon(rowCardId))) throw new Error('Временная строка осталась после DELETE/read-back.');
        report.cleanup.push({ scenarioId, rowCardId, status: 'verified', at: now(), result: E.safePlain(result, { maxDepth: 5, maxKeys: 200, maxArray: 100 }) });
        resolveCleanupForAbsentRow(rowCardId, 'verified', { resolvedBy: scenarioId });
        return true;
      } catch (error) {
        cleanupUnsafe = true; report.cleanup.push({ scenarioId, rowCardId, status: 'FAILED', at: now(), error: String(error?.message || error) }); return false;
      }
    }

    async function recoverCleanupObligations() {
      if (!cleanupLedgerController || !baselineSignature || !structure || !report.matrix?.matrixId) return;
      const pendingRows = cleanupLedgerController.snapshot().obligations
        .filter(item => item.status === 'pending' && item.kind === 'temporary-row' && String(item.rowCardId || '').trim())
        .reverse();
      for (const obligation of pendingRows) {
        const cleaned = await cleanupCreatedRow(obligation.rowCardId, `${obligation.scenarioId || 'uat'}: global-finally`);
        if (!cleaned) timeline('cleanup-retry-failed', obligation.id, { rowCardId: obligation.rowCardId });
      }
      const state = await freshSnapshot();
      for (const obligation of cleanupLedgerController.snapshot().obligations.filter(item => item.status === 'pending' && item.kind === 'field-mutation')) {
        const exists = state.snapshot.rows.some(row => canon(row.rowCardId) === canon(obligation.rowCardId));
        if (!exists) resolveCleanupObligation(obligation.id, { status: 'already-absent', resolvedAt: now(), resolvedBy: 'global-finally-row-absence' });
      }
      report.cleanupLedger = cleanupLedgerController.snapshot();
    }
    async function createTemporaryRow(scenarioId) {
      const current = await freshSnapshot(); bridge = current.bridge;
      const currentCatalog = catalogForSnapshot(current.snapshot);
      const { book } = await workbookFromSnapshot(structure, current.snapshot, bridge, currentCatalog);
      const candidate = findUniqueAddCandidate(book, structure, current.snapshot, bridge, currentCatalog, rng, { gap: 3 });
      let plan = applySafety(candidate.plan, bridge); const beforeIds = new Set(current.snapshot.rows.map(row => canon(row.rowCardId)));
      const rowObligation = registerCleanupObligation({
        kind: 'temporary-row',
        scenarioId,
        rowCardId: null,
        beforeRowIds: [...beforeIds],
        excelRow: candidate.row?.excelRow || null,
        restoreStrategy: 'delete-temporary-row',
        createdAt: now(),
      });
      let result;
      try {
        result = await applySingle(plan, `${scenarioId}: ADD`);
      } catch (error) {
        try {
          const verification = await freshSnapshot();
          const extras = verification.snapshot.rows.filter(row => !beforeIds.has(canon(row.rowCardId)));
          if (extras.length === 0) resolveCleanupObligation(rowObligation.id, { status: 'already-absent', resolvedAt: now(), resolvedBy: 'add-failed-fresh-read' });
          else if (extras.length === 1) resolveCleanupObligation(rowObligation.id, { status: 'pending', rowCardId: extras[0].rowCardId, discoveredAfterApplyError: true });
        } catch (_) { /* leave pending: global proof must become UNSAFE rather than guess */ }
        throw error;
      }
      // FULL_UAT_ADD_RECEIPT_RECOVERY_V2
      const addReceipt = (result.rows || []).find(row => row?.type === 'add' && row?.status === 'ok' && row?.rowCardId);
      const receiptRowCardId = String(addReceipt?.rowCardId || '');
      if (!receiptRowCardId) throw new Error(`${scenarioId}: успешный ADD не вернул RowCardID для cleanup.`);
      resolveCleanupObligation(rowObligation.id, { status: 'pending', rowCardId: receiptRowCardId, identifiedAt: now(), identifiedBy: 'apply-receipt' });
      let after;
      try {
        after = await freshSnapshot();
      } catch (error) {
        const cleanupOk = await cleanupCreatedRow(receiptRowCardId, `${scenarioId}-add-readback-recovery`);
        if (!cleanupOk) throw new Error(`${scenarioId}: ADD принят, read-back не завершён и cleanup по receipt RowCardID не подтверждён: ${String(error?.message || error)}`);
        throw error;
      }
      const created = after.snapshot.rows.find(row => canon(row.rowCardId) === canon(receiptRowCardId));
      if (!created) {
        const cleanupOk = await cleanupCreatedRow(receiptRowCardId, `${scenarioId}-add-receipt-mismatch-recovery`);
        if (!cleanupOk) throw new Error(`${scenarioId}: ADD receipt RowCardID отсутствует в read-back и cleanup не подтверждён.`);
        throw new Error(`Добавленная временная строка не найдена по receipt RowCardID ${receiptRowCardId}.`);
      }
      return { created, after: after.snapshot, bridge: after.bridge, catalog: currentCatalog, candidate, result, cleanupObligationId: rowObligation.id };
    }

    try {
      timeline('start', `Full UAT seed=${seed}`);
      initializationPhase = 'bridge-create';
      bridge = await E.TessaBridge.create();
      initializationPhase = 'draft-access';
      E.assertWritableMatrixDraft(bridge);
      initializationPhase = 'native-edit-mode';
      E.assertNativeEditMode();
      initializationPhase = 'structure';
      structure = await bridge.requestStructure(bridge.templateId());
      initializationPhase = 'baseline';
      baseline = await bridge.loadSnapshot(structure);
      baselineSignature = snapshotSignature(baseline);
      baselineCaptured = true;
      const info = bridge.matrixInfo();
      report.matrix = { matrixId: info.matrixId, templateId: info.TemplateID, name: info.TemplateName, state: info.StateName, rows: baseline.rows.length };
      pinnedUatBridge = bridge;
      pinnedUatMatrixId = String(info.matrixId || '');
      pinnedUatTemplateId = String(info.TemplateID || '');
      timeline('context-pinned', 'Исходный runtime-контекст UAT закреплён для read-back/cleanup.', { matrixId: pinnedUatMatrixId, templateId: pinnedUatTemplateId });
      cleanupLedgerController = createCleanupLedger(baselineSignature); report.cleanupLedger = cleanupLedgerController.snapshot();
      initializationPhase = 'dictionary';
      catalog = await bridge.loadDictionaryCatalog(structure, baseline, { forceRefresh: true, transient: true });
      initializationPhase = 'ready';
      addCheck('uat-preflight', 'Готовность Full UAT', 'PASS', 'Черновик, режим редактирования, структура, baseline и справочники подтверждены до write-фазы.', { required: true, data: { phase: initializationPhase, baselineCaptured: true, matrixId: pinnedUatMatrixId, templateId: pinnedUatTemplateId } });
      const base = await workbookFromSnapshot(structure, baseline, bridge, catalog, { retainArchive: true }); packageEntries.push(['matrix-current.xlsx', base.bytes]);

      await runCheck('action-download-current', 'Действие: скачать текущий Excel', async () => {
        if (!(base.bytes instanceof Uint8Array) || base.bytes.length < 4 || base.bytes[0] !== 0x50 || base.bytes[1] !== 0x4b) throw new Error('Текущая выгрузка не является XLSX/ZIP артефактом.');
        return { detail: `Сформирован matrix-current.xlsx (${base.bytes.length} байт).`, data: { outcome: 'xlsx-artifact', artifact: 'matrix-current.xlsx', bytes: base.bytes.length } };
      });
      await runCheck('candidate-build-provenance', 'Версия и paging-adapter текущего кандидата', async () => {
        const expectedBuild = 'TMS_V1_15_10_PAGING_V4_REFRESH_EDIT_V2';
        const expectedPerformanceBuild = 'TMS_V1_16_0_PERF_ENDGAME_V1';
        const actualBuild = String(E.buildFingerprint || '');
        const actualPerformanceBuild = String(E.performanceBuild || '');
        const version = String(E.studioVersion?.() || E.version || '');
        if (actualBuild !== expectedBuild) {
          throw new Error(`Загружен другой/старый userscript: build=${actualBuild || '(нет)'}, ожидался ${expectedBuild}.`);
        }
        if (actualPerformanceBuild !== expectedPerformanceBuild) {
          throw new Error(`Загружена сборка без performance endgame: performanceBuild=${actualPerformanceBuild || '(нет)'}, ожидался ${expectedPerformanceBuild}.`);
        }
        if (version !== '1.17.0') {
          throw new Error(`Загружена версия ${version || '(нет)'}, ожидалась 1.17.0.`);
        }
        return { detail: `Подтверждён v1.17.0 · ${actualBuild} · ${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };
      });
      await runCheck('initial-export-server-paging', 'Выгрузка: server paging без визуального листания', async () => {
        const native = bridge.findNativeMatrixControl();
        if (!native?.target) throw new Error('Нативное представление матрицы не найдено.');
        const before = bridge.nativePagingInfo(native.target).currentPage;
        const result = await bridge.collectNativeMatrixViewLinksAllPages({ pageLimit: 50 });
        const after = bridge.nativePagingInfo(native.target).currentPage;
        if (!result?.serverPaging) throw new Error('Первичная выгрузка использовала native-visual-paging вместо server-view-paging.');
        if (before !== after) throw new Error(`Server paging изменил видимую страницу: ${before} → ${after}.`);
        if ((baseline.rows || []).length && (result.links || []).length !== (baseline.rows || []).length) {
          throw new Error(`Server paging вернул ${(result.links || []).length} строк вместо ${(baseline.rows || []).length}.`);
        }
        return {
          detail: `Server paging подтверждён: ${(result.links || []).length} строк, ${(result.pagesVisited || []).length} server pages, visible page=${after}.`,
          data: { source: 'server-view-paging', rows: (result.links || []).length, pagesVisited: result.pagesVisited || [], strategy: result.strategy || null, visiblePage: after },
        };
      });
      await runCheck('native-view-paging-probe', 'Runtime TESSA: server paging без UI page flip', async () => {
        const native = bridge.findNativeMatrixControl();
        if (!native?.target) throw new Error('Нативное представление матрицы не найдено.');
        const before = bridge.nativePagingInfo(native.target).currentPage;
        const direct = await bridge.collectNativeMatrixViewLinksServerPaged({ pageLimit: 50 });
        const after = bridge.nativePagingInfo(native.target).currentPage;
        if (!direct?.serverPaging) throw new Error(`Runtime не подтвердил безопасный direct server paging; visual fallback. Build=${bridge.lastServerPagingDiagnostics?.build || E.buildFingerprint || '(нет)'}. Evidence=${JSON.stringify(bridge.lastServerPagingDiagnostics || null)}`);
        if (after !== before) throw new Error(`Direct server paging изменил visible currentPage: ${before} → ${after}.`);
        if ((baseline.rows || []).length > 50 && (direct.pagesVisited || []).length < 2) {
          throw new Error(`Ожидалось несколько server pages для ${(baseline.rows || []).length} строк, получено ${JSON.stringify(direct.pagesVisited || [])}.`);
        }
        return {
          detail: `Direct server paging работает без setPageAndRefresh: ${(direct.links || []).length} строк.`,
          data: { rows: (direct.links || []).length, pagesVisited: direct.pagesVisited || [], strategy: direct.strategy || null, visiblePage: after },
        };
      });

      await runCheck('action-value-picker', 'Действие: собрать значения', async () => {
        const columns = E.pickerColumns({ schemaTokens: base.book.schemaTokens, headers: base.book.headers, dictionaryCatalog: catalog }) /* FULL_UAT_PICKER_SOURCE_V2 */;
        const column = columns.find(item => item?.catalog?.entries?.length);
        if (!column) throw new Error('В текущем шаблоне нет ни одного выбираемого справочного значения для picker.');
        const entry = column.catalog.entries[0];
        const text = E.pickerSelectionText([entry]);
        if (!String(text || '').trim()) throw new Error('Picker не сформировал значение для Excel.');
        return { detail: `Picker сформировал значение для «${column.label || column.key}».`, data: { outcome: 'picker-selection', column: column.key, value: text } };
      });
      await runCheck('live-colleague-picker-multi-position', 'Регрессия: сотрудник с несколькими должностями копируется в Excel', async () => {
        const item = {
          id: 'uat-multi-position', roleTypeId: 1,
          shortName: 'Тестов Т.А. — Руководитель направления; Эксперт по методологии', fullName: '',
          position: 'Руководитель направления; Эксперт по методологии',
          display: 'Тестов Т.А. — Руководитель направления; Эксперт по методологии — Руководитель направления',
          selector: 'Тестов Т.А. — Руководитель направления; Эксперт по методологии — Руководитель направления',
        };
        // LIVE_EXCEL_FULL_UAT_SCOPE_FIX_V1
        if (typeof E.pickerSelectionText !== 'function') throw new Error('Full UAT export pickerSelectionText недоступен.');
        const text = E.pickerSelectionText([item]);
        if (!text || /[;\r\n\t]/.test(text)) throw new Error('Picker не сформировал безопасное одиночное значение сотрудника.');
        return { detail: 'Multi-position employee остаётся копируемым одним значением Excel.', data: { outcome: 'picker-selection', valueLength: text.length } };
      });
      await runCheck('live-colleague-preview-attention', 'Регрессия: крупный Preview показывает понятные счётчики и ограничивает список уточнений', async () => {
        const syntheticSkips = Array.from({ length: 196 }, (_, index) => ({ excelRow: index + 15, code: index < 12 ? 'invalid-value' : '', reason: 'synthetic' }));
        const syntheticPlan = { actions: [], counts: { update: 0, add: 0, delete: 0, noop: 100, skip: 196 }, skippedRows: syntheticSkips, desired: [], safety: { blocked: false, blockedReasons: [] } };
        if (typeof E.previewAttentionSummary !== 'function' || typeof E.createPlanReviewState !== 'function') throw new Error('Full UAT Preview exports недоступны.');
        const summary = E.previewAttentionSummary(syntheticPlan, E.createPlanReviewState());
        if (typeof E.resolutionCenterWindow !== 'function') throw new Error('Full UAT export resolutionCenterWindow недоступен.');
        const windowed = E.resolutionCenterWindow(Array.from({ length: 747 }, (_, index) => ({ excelRow: 15 + (index % 196) })), 0, 50);
        if (summary.notApplied !== 196 || summary.errors !== 12) throw new Error('Preview attention counters do not match the synthetic 196/12 case.');
        if (windowed.items.length !== 50 || windowed.total !== 747 || windowed.hidden !== 697) throw new Error('Resolution Center is not bounded to 50 visible items.');
        return { detail: '196 not-applied rows and 12 errors are explicit; 747-item Resolution Center renders only 50 per page.', data: { outcome: 'preview-plan', notApplied: summary.notApplied, errors: summary.errors, totalClarifications: windowed.total, visibleClarifications: windowed.items.length } };
      });
      await runCheck('live-colleague-preview-counter-filters', 'Регрессия: верхние счётчики Preview управляют фильтром без дублирующей панели', async () => {
        if (typeof E.previewCounterFilterTarget !== 'function') throw new Error('Full UAT export previewCounterFilterTarget недоступен.');
        const add = E.previewCounterFilterTarget('all', 'add');
        const all = E.previewCounterFilterTarget('add', 'add');
        const errors = E.previewCounterFilterTarget('delete', 'error');
        if (add !== 'add' || all !== 'all' || errors !== 'error') throw new Error('Счётчики Preview переключают фильтры неверно.');
        return { detail: 'Счётчики являются единственным фильтром: выбор категории работает, повторный клик возвращает «Все».', data: { outcome: 'preview-counter-filter', add, all, errors } };
      });
      await runCheck('action-file-ingest', 'Действие: загрузить изменённый Excel', async () => {
        const buffer = E.exactArrayBuffer(base.bytes);
        const ingested = await E.readXlsxArrayBuffer(buffer, 'TESSA_UAT_INGEST.xlsx');
        if (!ingested || (ingested.rows || []).length !== (base.book.rows || []).length) throw new Error('Повторный ingest изменил число строк roundtrip-книги.');
        return { detail: `Excel прочитан обратно: ${(ingested.rows || []).length} строк.`, data: { outcome: 'ingest-workbook', rows: (ingested.rows || []).length } };
      });
      await runCheck('action-preview', 'Действие: Preview изменений', async () => {
        const previewPlan = E.buildPlan(base.book, structure, baseline, info);
        if (!previewPlan?.counts) throw new Error('Preview не построил план.');
        if (previewPlan.counts.skip || previewPlan.counts.add || previewPlan.counts.update || previewPlan.counts.delete) throw new Error(`Неизменённый roundtrip дал ложные изменения: ${JSON.stringify(previewPlan.counts)}`);
        return { detail: 'Production planner построил нулевой Preview для неизменённой книги.', data: { outcome: 'preview-plan', counts: previewPlan.counts } };
      });
      await runCheck('preview-filters', 'Preview: все фильтры и счётчики', async () => {
        const update = findSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng);
        const add = findUniqueAddCandidate(base.book, structure, baseline, bridge, catalog, rng, { gap: 7 });
        const deleteBook = cloneWorkbook(base.book);
        const deleteTarget = deleteBook.rows.find(row => Number(row.excelRow) !== Number(update.row.excelRow)) || deleteBook.rows[0];
        if (!deleteTarget) return { status: 'NOT_RUN', detail: 'Нет строки для DELETE-фильтра.' };
        const deleteIndex = deleteBook.rows.indexOf(deleteTarget);
        deleteBook.rows.splice(deleteIndex, 1);
        const deletePlan = E.buildPlan(deleteBook, structure, baseline, info);
        const deleteAction = (deletePlan.actions || []).find(action => action.type === 'delete');
        if (!deleteAction) throw new Error('Не удалось построить DELETE для filter-contract.');

        const synthetic = {
          ...update.plan,
          actions: [update.action, (add.plan.actions || []).find(action => action.type === 'add'), deleteAction].filter(Boolean),
          skippedRows: [
            { excelRow: 990001, reason: 'UAT: строка пропущена', code: '' },
            { excelRow: 990002, reason: 'UAT: ошибка справочника', code: 'dictionary-not-found' },
          ],
        };
        const expected = { all: 5, update: 1, add: 1, delete: 1, skip: 2, error: 1 };
        const actual = {};
        for (const [filter, count] of Object.entries(expected)) {
          const selected = E.selectPreviewItems(synthetic, null, E.createPreviewViewState({ filter, pageSize: 200 }));
          actual[filter] = selected.total;
          if (selected.total !== count) throw new Error(`Фильтр ${filter}: ожидалось ${count}, получено ${selected.total}.`);
        }
        const searched = E.selectPreviewItems(synthetic, null, E.createPreviewViewState({ filter: 'error', query: '990002', pageSize: 200 }));
        if (searched.total !== 1) throw new Error(`Поиск внутри ERROR вернул ${searched.total} вместо 1.`);
        return { detail: 'Все/Изменить/Добавить/Удалить/Пропустить/Ошибки и поиск дают точные счётчики.', data: actual };
      });

      await runCheck('review-cancel-item', 'Отмена одного изменения и всей строки', async () => {
        const update = findSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng);
        const action = update.action;
        const change = action.changes?.[0];
        if (!change) throw new Error('UPDATE не содержит изменения для частичной отмены.');
        const review = E.createPlanReviewState();
        E.setPlanReviewChange(review, action, change.key, true);
        let reviewed = E.buildReviewedPlan(update.plan, review);
        const changedAction = (reviewed.actions || []).find(item => Number(item.excelRow?.excelRow) === Number(action.excelRow?.excelRow));
        if (changedAction?.type === 'update' && (changedAction.changes || []).some(item => item.key === change.key)) {
          throw new Error('Отменённое поле осталось в executable UPDATE.');
        }

        E.setPlanReviewChange(review, action, change.key, false);
        reviewed = E.buildReviewedPlan(update.plan, review);
        if ((reviewed.counts?.update || 0) !== 1) throw new Error('Возврат отдельного поля не восстановил UPDATE.');

        E.setPlanReviewRow(review, action, true);
        reviewed = E.buildReviewedPlan(update.plan, review);
        if ((reviewed.counts?.update || 0) !== 0) throw new Error('Отмена всей строки не убрала UPDATE из Apply.');
        E.setPlanReviewRow(review, action, false);
        reviewed = E.buildReviewedPlan(update.plan, review);
        if ((reviewed.counts?.update || 0) !== 1) throw new Error('Возврат всей строки не восстановил UPDATE.');
        return { detail: 'Отдельное поле и целая операция исключаются/возвращаются без затрагивания остального плана.' };
      });

      await runCheck('two-excel-disjoint-merge', 'Два Excel: независимые изменения объединяются', async () => {
        const first = findSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng);
        const firstIdentity = rowIdentity(first.book, first.row);
        const secondSourceBook = cloneWorkbook(base.book);
        const secondCandidates = secondSourceBook.rows.filter(row => canon(rowIdentity(secondSourceBook, row).rowCardId) !== canon(firstIdentity.rowCardId));
        if (!secondCandidates.length) return { status: 'NOT_RUN', detail: 'Недостаточно строк для двух независимых Excel.' };

        let second = null;
        for (const source of secondCandidates.slice(0, 30)) {
          try {
            second = findSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng, { source });
          } catch (_) { /* try another source */ }
          if (second && canon(rowIdentity(second.book, second.row).rowCardId) !== canon(firstIdentity.rowCardId)) break;
          second = null;
        }
        if (!second) return { status: 'NOT_RUN', detail: 'Не удалось подобрать вторую независимую строку.' };

        const afterFirst = E.mergeWorkbookIntoCurrentSnapshot(first.book, structure, baseline).snapshot;
        let prepared = E.prepareThreeWayMerge(second.book, structure, afterFirst);
        if ((prepared.unresolved || []).length) throw new Error(`Независимые изменения дали конфликтов: ${prepared.unresolved.length}.`);
        const merged = E.mergeWorkbookIntoCurrentSnapshot(prepared.workbook, structure, afterFirst);
        const secondPlan = E.buildPlan(prepared.workbook, structure, afterFirst, info);
        if ((secondPlan.counts?.skip || 0) || (secondPlan.counts?.delete || 0) || (secondPlan.counts?.add || 0)) {
          throw new Error(`Второй Excel после merge дал опасный план: ${JSON.stringify(secondPlan.counts)}`);
        }
        if ((merged.snapshot?.rows || []).length !== baseline.rows.length) throw new Error('Two-Excel merge изменил число строк.');
        return { detail: 'Изменение Excel A сохранено, независимое изменение Excel B добавлено без ложного конфликта.', data: { firstRow: first.row.excelRow, secondRow: second.row.excelRow } };
      });

      await runCheck('merge-conflict-resolution', 'Два Excel: конфликт одного поля обнаруживается', async () => {
        const first = findSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng);
        const afterFirst = E.mergeWorkbookIntoCurrentSnapshot(first.book, structure, baseline).snapshot;
        const competing = cloneWorkbook(base.book);
        const competingRow = competing.rows.find(row => Number(row.excelRow) === Number(first.row.excelRow));
        const alternatives = (first.column.entries || []).filter(entry => {
          const value = canon(entry.selector || entry.display);
          return value !== canon(first.entry.selector || first.entry.display)
            && value !== canon(first.source.values?.[first.column.index] || '');
        });
        if (!competingRow || !alternatives.length) return { status: 'NOT_RUN', detail: 'Нет третьего справочного значения для конфликтного merge.' };
        setDictionaryValue(competing, competingRow, first.column.key, alternatives[0]);
        const prepared = E.prepareThreeWayMerge(competing, structure, afterFirst);
        if (!(prepared.unresolved || []).length) throw new Error('Пересекающиеся изменения одного поля не были показаны как конфликт.');
        const mineChoices = Object.fromEntries(prepared.unresolved.map(item => [item.id, 'mine']));
        const mine = E.prepareThreeWayMerge(competing, structure, afterFirst, mineChoices);
        if ((mine.unresolved || []).length) throw new Error('Выбор «Мой Excel» не разрешил конфликт.');
        const serverChoices = Object.fromEntries(prepared.unresolved.map(item => [item.id, 'server']));
        const server = E.prepareThreeWayMerge(competing, structure, afterFirst, serverChoices);
        if ((server.unresolved || []).length) throw new Error('Выбор «TESSA» не разрешил конфликт.');
        return { detail: `Конфликт обнаружен (${prepared.unresolved.length}) и разрешается обеими сторонами без молчаливой перезаписи.` };
      });

      await runCheck('action-support-bundle', 'Действие: скачать единый пакет', async () => {
        const artifact = await E.prepareSupportBundle();
        if (!(artifact?.bytes instanceof Uint8Array) || artifact.bytes.length < 4 || artifact.bytes[0] !== 0x50 || artifact.bytes[1] !== 0x4b) {
          throw new Error('Единый пакет не сформирован как ZIP-артефакт.');
        }
        const buffer = artifact.bytes.buffer.slice(artifact.bytes.byteOffset, artifact.bytes.byteOffset + artifact.bytes.byteLength);
        const entries = await E.unzipArrayBuffer(buffer);
        const required = [
          'excel/matrix-current.xlsx', 'excel/matrix-uploaded.xlsx', 'excel/changes.xlsx',
          'reports/summary.json', 'reports/preview.json', 'manifest.json', 'README.txt',
        ];
        const missing = required.filter(path => !entries.has(path));
        if (missing.length) throw new Error(`В едином пакете отсутствуют: ${missing.join(', ')}.`);
        const manifest = JSON.parse(new TextDecoder().decode(entries.get('manifest.json')));
        if (manifest?.format !== 'TESSA_MATRIX_SUPPORT_BUNDLE_V1') throw new Error(`Неизвестный формат manifest: ${manifest?.format || '(нет)'}.`);
        for (const file of manifest.files || []) {
          const bytes = entries.get(file.path);
          if (!bytes) throw new Error(`Manifest ссылается на отсутствующий файл ${file.path}.`);
          if (await E.sha256Hex(bytes) !== file.sha256) throw new Error(`SHA-256 не совпал для ${file.path}.`);
        }
        const successfulLimit = 12 * 1024 * 1024;
        if (!entries.has('diagnostics/summary.json') && artifact.bytes.length > successfulLimit) {
          throw new Error(`Успешный пакет превышает 12 МБ: ${artifact.bytes.length} байт.`);
        }
        return { detail: `Единый пакет проверен (${artifact.bytes.length} байт, ${entries.size} файлов).`, data: { outcome: 'support-zip-artifact', artifact: artifact.name, bytes: artifact.bytes.length, files: entries.size } };
      });

      // FULL_UAT_RESOURCE_SAFETY_V1
      // A real OOM cannot be used as a successful test oracle: if the renderer dies there is
      // no code left to emit FAIL or cleanup live writes. Full UAT therefore proves the
      // fail-fast resource guards and repeatedly exercises the bounded XLSX path that must
      // prevent the browser from reaching OOM in normal operation.
      await runCheck('resource-input-limit', 'Память: XLSX больше лимита отклоняется до ZIP/XML', async () => {
        const limits = E.constants?.XLSX_ARCHIVE_LIMITS;
        if (!limits || !Number.isFinite(Number(limits.MaxInputBytes)) || Number(limits.MaxInputBytes) <= 0) throw new Error('Production XLSX input limit недоступен.');
        let rejected = false;
        let message = '';
        let oversized = null;
        try {
          oversized = new Uint8Array(Number(limits.MaxInputBytes) + 1);
          await E.readXlsxArrayBuffer(oversized.buffer, 'TESSA_UAT_OVERSIZE.xlsx', { retainArchive: false, selectiveInflate: true });
        } catch (error) {
          message = String(error?.message || error);
          rejected = /размер файла|безопасн.*лимит/i.test(message);
        } finally {
          oversized = null;
        }
        if (!rejected) throw new Error(`Файл > ${limits.MaxInputBytes} байт не был fail-fast отклонён. ${message}`);
        return { detail: `Hard limit ${Math.round(Number(limits.MaxInputBytes) / 1024 / 1024)} МБ сработал до разбора XLSX.`, data: { maxInputBytes: limits.MaxInputBytes, rejection: message } };
      });

      await runCheck('resource-entry-limit', 'Память: слишком много ZIP-частей XLSX отклоняется', async () => {
        const limits = E.constants?.XLSX_ARCHIVE_LIMITS;
        if (!limits || !Number.isFinite(Number(limits.MaxEntries))) throw new Error('Production ZIP entry limit недоступен.');
        const entries = Array.from({ length: Number(limits.MaxEntries) + 1 }, (_, index) => [`xl/uat-resource-${index}.xml`, '']);
        const bytes = await E.makeZip(entries);
        let rejected = false;
        let message = '';
        try {
          await E.readXlsxArrayBuffer(E.exactArrayBuffer(bytes), 'TESSA_UAT_TOO_MANY_PARTS.xlsx', { retainArchive: false });
        } catch (error) {
          message = String(error?.message || error);
          rejected = /слишком много|количеств.*файл/i.test(message);
        }
        if (!rejected) throw new Error(`ZIP с ${entries.length} частями не был отклонён. ${message}`);
        return { detail: `Лимит ZIP-частей ${limits.MaxEntries} подтверждён fail-closed.`, data: { maxEntries: limits.MaxEntries, testedEntries: entries.length, rejection: message } };
      });

      await runCheck('resource-path-traversal', 'Безопасность XLSX: path traversal внутри ZIP', async () => {
        const bytes = await E.makeZip([['../TESSA_UAT_EVIL.xml', '<x/>']]);
        let rejected = false;
        let message = '';
        try {
          await E.readXlsxArrayBuffer(E.exactArrayBuffer(bytes), 'TESSA_UAT_PATH_TRAVERSAL.xlsx', { retainArchive: false });
        } catch (error) {
          message = String(error?.message || error);
          rejected = /небезопасн.*путь|путь.*архив/i.test(message);
        }
        if (!rejected) throw new Error(`Небезопасный ZIP path не был отклонён. ${message}`);
        return { detail: 'ZIP path traversal отклонён до чтения workbook XML.', data: { rejection: message } };
      });

      await runCheck('resource-spreadsheet-bounds', 'Безопасность XLSX: границы строк/столбцов Excel', async () => {
        const limits = E.constants?.SPREADSHEETML_LIMITS;
        if (!limits?.MaxRowNumber || !limits?.MaxColumnNumber) throw new Error('SpreadsheetML production limits недоступны.');
        const worksheet = body => `<?xml version="1.0" encoding="utf-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
        let rowRejected = false;
        let colRejected = false;
        try {
          const row = Number(limits.MaxRowNumber) + 1;
          E.parseSheetXml(worksheet(`<row r="${row}"><c r="A${row}" t="str"><v>x</v></c></row>`), []);
        } catch (error) {
          rowRejected = /строк|номер строки|лимит/i.test(String(error?.message || error));
        }
        try {
          E.parseSheetXml(worksheet('<row r="1"><c r="XFE1" t="str"><v>x</v></c></row>'), []);
        } catch (error) {
          colRejected = /столб|XFD|16384/i.test(String(error?.message || error));
        }
        if (!rowRejected || !colRejected) throw new Error(`Границы SpreadsheetML не сработали: row=${rowRejected}, col=${colRejected}.`);
        return { detail: `Excel bounds подтверждены: rows≤${limits.MaxRowNumber}, cols≤${limits.MaxColumnNumber}.`, data: limits };
      });

      await runCheck('memory-bounded-roundtrip', 'Память: повторный XLSX roundtrip без удержания архива', async () => {
        const heap = () => {
          const used = Number(globalThis.performance?.memory?.usedJSHeapSize);
          const limit = Number(globalThis.performance?.memory?.jsHeapSizeLimit);
          return Number.isFinite(used) && used > 0 ? { used, limit: Number.isFinite(limit) && limit > 0 ? limit : null } : null;
        };
        const before = heap();
        const buffer = E.exactArrayBuffer(base.bytes);
        const samples = [];
        for (let iteration = 1; iteration <= 3; iteration += 1) {
          const parsed = await E.readXlsxArrayBuffer(buffer, `TESSA_UAT_MEMORY_${iteration}.xlsx`, {
            skipSheetNames: ['Словари'],
            dictionaryCatalog: catalog,
            retainArchive: false,
            selectiveInflate: true,
          });
          if (parsed.parsedSheets?.has?.('Словари')) throw new Error(`Итерация ${iteration}: лист «Словари» был материализован в bounded-memory режиме.`);
          if ((parsed.rows || []).length !== (base.book.rows || []).length) throw new Error(`Итерация ${iteration}: число строк изменилось ${parsed.rows?.length}/${base.book.rows?.length}.`);
          if (E.releaseWorkbookArchive(parsed)) throw new Error(`Итерация ${iteration}: retainArchive:false всё равно удержал распакованные ZIP parts.`);
          const plan = E.buildPlan(parsed, structure, baseline, info);
          if (plan.counts.skip || plan.counts.add || plan.counts.update || plan.counts.delete) throw new Error(`Итерация ${iteration}: повторный roundtrip дал изменения ${JSON.stringify(plan.counts)}.`);
          samples.push({ iteration, rows: parsed.rows?.length || 0, heap: heap() });
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        const after = heap();
        const heapPressure = after?.limit ? after.used / after.limit : null;
        return {
          status: heapPressure !== null && heapPressure >= 0.90 ? 'WARN' : 'PASS',
          detail: after?.limit
            ? `3 повторных import→plan прошли без удержания ZIP/«Словарей»; Chrome heap telemetry ${Math.round(after.used / 1024 / 1024)} / ${Math.round(after.limit / 1024 / 1024)} МБ${heapPressure >= 0.90 ? ' (высокое давление памяти; deterministic guards прошли)' : ''}.`
            : '3 повторных import→plan прошли без удержания ZIP/«Словарей»; performance.memory браузером не предоставлен.',
          data: { before, after, samples, heapPressure, heapTelemetryOnly: true, archiveRetained: false, dictionarySheetParsed: false },
        };
      });

      await runCheck('prod-shadow-offline', 'Production-shadow: объём и ошибки production-класса', async () => {
        const heapSnapshot = () => {
          const used = Number(globalThis.performance?.memory?.usedJSHeapSize);
          const limit = Number(globalThis.performance?.memory?.jsHeapSizeLimit);
          return Number.isFinite(used) && used > 0 ? { used, limit: Number.isFinite(limit) && limit > 0 ? limit : null } : null;
        };
        const heapBefore = heapSnapshot();
        const audit = await runProductionShadowAudit();
        const heapAfter = heapSnapshot();
        report.productionShadowAudit = { ...audit, heapBefore, heapAfter };
        if (Number(audit.metrics?.dictionaryEntries || 0) < 100000) throw new Error(`Stress-профиль слишком мал: ${audit.metrics?.dictionaryEntries || 0} dictionary entries.`);
        const heapPressure = heapAfter?.limit ? heapAfter.used / heapAfter.limit : null;
        return {
          status: heapPressure !== null && heapPressure >= 0.90 ? 'WARN' : 'PASS',
          detail: heapAfter?.limit
            ? `Synthetic envelope: ${audit.metrics.dictionaryEntries} значений; ${audit.profile.sourceRows}→${audit.profile.targetRows}; ${audit.metrics.operationCount} операций; ${audit.metrics.totalMs} мс; Chrome heap telemetry ${Math.round(heapAfter.used / 1024 / 1024)} / ${Math.round(heapAfter.limit / 1024 / 1024)} МБ${heapPressure >= 0.90 ? ' (высокое давление)' : ''}.`
            : `Synthetic envelope: ${audit.metrics.dictionaryEntries} значений справочников; перенос ${audit.profile.sourceRows}→${audit.profile.targetRows}; ${audit.metrics.operationCount} операций; schema drift ${audit.profile.retiredColumns}/${audit.profile.targetOnlyColumns}; ${audit.metrics.totalMs} мс; performance.memory недоступен.`,
          data: { outcome: 'production-shadow', profile: audit.profile, metrics: audit.metrics, assertions: audit.assertions, heapBefore, heapAfter, heapPressure, heapTelemetryOnly: true },
        };
      });

      await runCheck('runtime', 'Контекст и доступ на запись', async () => ({ detail: `Черновик «${info.TemplateName}», строк: ${baseline.rows.length}.` }));
      await runCheck('server-paging-parity', 'Чтение матрицы без перелистывания UI', async () => {
        if (typeof bridge.collectNativeMatrixViewLinksServerPaged !== 'function') {
          return { status: 'WARN', detail: 'Server-paging helper недоступен; Studio продолжит использовать безопасный UI fallback.' };
        }
        const started = Number(globalThis.performance?.now?.() ?? Date.now());
        const fast = await bridge.collectNativeMatrixViewLinksServerPaged();
        const fastMs = Number(globalThis.performance?.now?.() ?? Date.now()) - started;
        if (!fast) {
          return { status: 'WARN', detail: 'TESSA runtime не отдал доказуемый server-paged набор; безопасный UI fallback остаётся активен.', data: { fastAvailable: false } };
        }
        const fallbackStarted = Number(globalThis.performance?.now?.() ?? Date.now());
        const fallback = await bridge.collectNativeMatrixViewLinksAllPages({ forceUiPaging: true });
        const fallbackMs = Number(globalThis.performance?.now?.() ?? Date.now()) - fallbackStarted;
        const identity = item => `${canon(item?.rowCardId)}|${canon(item?.versionId)}`;
        const fastIds = (fast.links || []).map(identity).sort();
        const fallbackIds = (fallback.links || []).map(identity).sort();
        if (!sameArray(fastIds, fallbackIds)) {
          throw new Error(`Server paging и UI fallback расходятся: server=${fastIds.length}, ui=${fallbackIds.length}.`);
        }
        if (fastIds.length !== baseline.rows.length) {
          throw new Error(`Server paging вернул ${fastIds.length} строк, baseline содержит ${baseline.rows.length}.`);
        }
        return {
          detail: `Server paging = ${fast.pagesVisited?.length || 0} запросов / ${Math.round(fastMs)} мс; UI fallback = ${fallback.pagesVisited?.length || 0} страниц / ${Math.round(fallbackMs)} мс; identity совпадают.`,
          data: {
            fastAvailable: true,
            rows: fastIds.length,
            serverRequests: fast.pagesVisited?.length || 0,
            uiPages: fallback.pagesVisited?.length || 0,
            serverMs: Math.round(fastMs),
            uiMs: Math.round(fallbackMs),
            serverPageLimit: fast.pageLimit || null,
          },
        };
      }, false);
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
      // FULL_UAT_COPIED_IDENTITY_COLLISION_SAFE_V1
      // The scenario verifies duplicate hidden row identities, not duplicate business rows.
      // First find four valid mutations that are unique against the current matrix; only
      // after that remove two unrelated originals to add the DELETE part of the contract.
      await runCheck('row-copied-identities', 'Изменённые копии строки с одинаковыми скрытыми ID', async () => {
        if (base.book.rows.length < 3) return { status: 'NOT_RUN', detail: 'Нужно минимум 3 исходные строки.' };
        const columns = shuffled(mutableCriterionColumns(base.book, catalog, 5), rng)
          .sort((a, b) => Number(b.entries?.length || 0) - Number(a.entries?.length || 0));
        if (!columns.length) return { status: 'NOT_RUN', detail: 'Нет критерия минимум с 5 значениями.' };

        const sources = shuffled((base.book.rows || []).filter(row => rowHasRole(base.book, row)), rng);
        if (!sources.length) throw new Error('Не найдена исходная строка с исполнителем для copied-identity UAT.');

        const attempts = [];
        const attemptLimit = 240;
        const startExcelRow = maxExcelRow(base.book) + 1;
        let selected = null;

        copiedIdentitySearch:
        for (const sourceRow of sources.slice(0, 24)) {
          const sourceIdentity = rowIdentity(base.book, sourceRow);
          const sourceId = canon(sourceIdentity.rowCardId);
          if (!sourceId) continue;

          for (const column of columns.slice(0, 8)) {
            const current = canon(sourceRow.values?.[column.index] || '');
            const entries = [...new Map(
              shuffled((column.entries || []).filter(entry => canon(entry.selector || entry.display) !== current), rng)
                .map(entry => [canon(entry.id || entry.selector || entry.display), entry]),
            ).values()].filter(entry => canon(entry.id || entry.selector || entry.display));

            if (entries.length < 4) continue;
            const candidatePool = entries.slice(0, 24);

            for (let offset = 0; offset + 4 <= candidatePool.length; offset += 4) {
              const chosen = candidatePool.slice(offset, offset + 4);
              const probeBook = cloneWorkbook(base.book);
              probeBook.rows = probeBook.rows.filter(row => canon(rowIdentity(probeBook, row).rowCardId) !== sourceId);
              chosen.forEach((entry, index) => {
                const copy = { ...sourceRow, excelRow: startExcelRow + index * 2, values: [...sourceRow.values] };
                setDictionaryValue(probeBook, copy, column.key, entry);
                probeBook.rows.push(copy);
              });

              const probePlan = E.buildPlan(probeBook, structure, baseline, info);
              attempts.push({
                sourceExcelRow: sourceRow.excelRow,
                column: column.key,
                offset,
                counts: probePlan.counts,
                skipped: (probePlan.skippedRows || []).slice(0, 2),
              });

              // A valid probe proves the four copied identities themselves are handled as
              // one UPDATE + three ADD without accidentally colliding with another TESSA row.
              if (
                probePlan.counts.skip === 0
                && probePlan.counts.add === 3
                && probePlan.counts.update === 1
                && probePlan.counts.delete === 0
              ) {
                const removable = shuffled(
                  (base.book.rows || []).filter(row => canon(rowIdentity(base.book, row).rowCardId) !== sourceId),
                  rng,
                ).slice(0, 2);
                if (removable.length < 2) continue;

                const removedIds = new Set(removable.map(row => canon(rowIdentity(base.book, row).rowCardId)));
                const finalBook = cloneWorkbook(base.book);
                finalBook.rows = finalBook.rows.filter(row => {
                  const rowId = canon(rowIdentity(finalBook, row).rowCardId);
                  return rowId !== sourceId && !removedIds.has(rowId);
                });
                chosen.forEach((entry, index) => {
                  const copy = { ...sourceRow, excelRow: startExcelRow + index * 2, values: [...sourceRow.values] };
                  setDictionaryValue(finalBook, copy, column.key, entry);
                  finalBook.rows.push(copy);
                });

                const finalPlan = E.buildPlan(finalBook, structure, baseline, info);
                attempts.push({
                  sourceExcelRow: sourceRow.excelRow,
                  column: column.key,
                  offset,
                  phase: 'final',
                  counts: finalPlan.counts,
                  skipped: (finalPlan.skippedRows || []).slice(0, 2),
                });

                if (
                  finalPlan.counts.skip === 0
                  && finalPlan.counts.add === 3
                  && finalPlan.counts.update === 1
                  && finalPlan.counts.delete === 2
                ) {
                  selected = { sourceRow, column, chosen, removable, plan: finalPlan };
                  break copiedIdentitySearch;
                }
              }

              if (attempts.length >= attemptLimit) break copiedIdentitySearch;
            }
          }
        }

        if (!selected) {
          throw new Error('Не удалось построить collision-safe copied-identity сценарий за ' + attempts.length + ' попыток. Последние планы: ' + JSON.stringify(attempts.slice(-8)));
        }

        return {
          detail: 'Excel ' + selected.sourceRow.excelRow + ', ' + selected.column.key + ': одна копия стала UPDATE, остальные три — ADD; два отсутствующих оригинала — DELETE. Кандидат предварительно проверен на отсутствие business-дублей.',
          data: {
            ...compactPlan(selected.plan),
            sourceExcelRow: selected.sourceRow.excelRow,
            column: selected.column.key,
            candidateEntries: selected.chosen.map(entry => candidateEvidenceValue(entry)),
            removedRows: selected.removable.map(row => row.excelRow),
            searchAttempts: attempts.length,
          },
        };
      });
      await runCheck('dictionary-stale-companion', 'Изменение текста при старом скрытом ID', async () => {
        const safe = findSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng);
        const test = cloneWorkbook(base.book);
        const row = test.rows.find(item => Number(item.excelRow) === Number(safe.source.excelRow));
        if (!row) throw new Error('UAT setup: исходная строка безопасного UPDATE не найдена.');
        const column = safe.column;
        const idIndex = companionIndex(test, column.key);
        const oldHidden = idIndex >= 0 ? row.values[idIndex] : '';

        // Keep the old hidden companion deliberately: visible text must win and be
        // re-resolved to the new dictionary ID. Candidate was pre-proven collision-safe,
        // so a duplicate SKIP here is a real stale-companion defect, not flaky UAT data.
        setDictionaryValue(test, row, column.key, safe.entry, true);
        if (idIndex >= 0) row.values[idIndex] = oldHidden;

        const plan = E.buildPlan(test, structure, baseline, info);
        if ((plan.counts?.update || 0) !== 1
          || (plan.counts?.skip || 0) !== 0
          || (plan.counts?.add || 0) !== 0
          || (plan.counts?.delete || 0) !== 0) {
          throw new Error(`UAT setup/case должен давать ровно 1 UPDATE без дублей: ${JSON.stringify({ counts: plan.counts, skippedRows: plan.skippedRows || [] })}`);
        }
        const update = (plan.actions || []).find(action => action.type === 'update');
        if (!update) throw new Error(`Изменение не распознано как UPDATE: ${JSON.stringify(plan.counts)}`);
        const resolved = update.excelRow?.ids?.[column.key]?.[0] || '';
        if (!resolved || canon(resolved) === canon(oldHidden)) {
          throw new Error('Старый companion ID не был пересопоставлен по новому видимому значению.');
        }
        return {
          detail: 'Collision-safe UPDATE: видимое значение победило устаревший companion ID; ID пересобран из справочника.',
          data: { excelRow: row.excelRow, field: column.key, oldHidden, resolved },
        };
      });
      await runCheck('dictionary-invalid', 'Некорректное значение справочника', async () => {
        const columns = mutableCriterionColumns(base.book, catalog, 2); if (!columns.length) return { status: 'NOT_RUN', detail: 'Нет подходящего справочника.' };
        const test = cloneWorkbook(base.book), row = chooseSourceRow(test, rng), column = shuffled(columns, rng)[0];
        const invalidValue = `__UAT_INVALID_${seed}__`;
        row.values[column.index] = invalidValue;
        const idIndex = companionIndex(test, column.key); if (idIndex >= 0) row.values[idIndex] = '';
        const plan = E.buildPlan(test, structure, baseline, info);

        // FULL_UAT_DICTIONARY_INVALID_VALUE_LEVEL_V1
        // v1.15 may fail closed at row, field or individual-value level. The old UAT only
        // looked at counts.skip / plan.issues and therefore reported a false FAIL when the
        // planner correctly preserved the existing field through skippedFields/skippedValues.
        const sameRow = item => Number(item?.excelRow) === Number(row.excelRow);
        const sameField = item => canon(item?.key || '') === canon(column.key);
        const rejectedField = (plan.skippedFields || []).find(item => sameRow(item) && sameField(item));
        const rejectedValue = (plan.skippedValues || []).find(item => sameRow(item) && sameField(item));
        const rejectedRow = (plan.skippedRows || []).find(item => sameRow(item));
        const rejectedIssue = (plan.issues || []).find(item => {
          const text = JSON.stringify(item || {});
          return text.includes(invalidValue) || (sameRow(item) && (!item?.key || sameField(item)));
        });
        const leakedIntoExecutableChange = (plan.actions || [])
          .filter(action => action?.type && action.type !== 'noop')
          .some(action => (action.changes || []).some(change =>
            canon(change?.key || '') === canon(column.key)
            && (change?.after || []).some(value => canon(value) === canon(invalidValue))
          ));
        if (leakedIntoExecutableChange) throw new Error('Некорректное значение попало в исполняемый change-set Apply.');
        if (!rejectedField && !rejectedValue && !rejectedRow && !rejectedIssue && !plan.counts.skip) {
          throw new Error('Некорректное значение не было отклонено ни на уровне строки, ни поля, ни значения.');
        }
        const level = rejectedValue ? 'value' : rejectedField ? 'field' : rejectedRow || plan.counts.skip ? 'row' : 'issue';
        return { detail: `Неизвестное значение fail-closed отклонено до Store на уровне ${level}; в executable change-set его нет.`, data: { rejectionLevel: level, ...compactPlan(plan) } };
      });
      await runCheck('dictionary-refresh', 'Обновление справочников в изменённом Excel без потери правки', async () => {
        catalog = await bridge.loadDictionaryCatalog(structure, baseline, { forceRefresh: true, transient: true });
        const edited = await findPhysicalSafeUpdateCandidate(base.book, structure, baseline, bridge, catalog, rng);
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
          throw new Error(`UAT setup: физическая пользовательская правка XLSX должна давать ровно 1 UPDATE: ${JSON.stringify({ counts: beforePlan.counts, warnings: beforePlan.warnings || [], issues: beforePlan.issues || [], skippedRows: beforePlan.skippedRows || [], skippedFields: beforePlan.skippedFields || [], skippedValues: beforePlan.skippedValues || [], safety: beforePlan.safety || null })}`);
        }
        const beforeAction = (beforePlan.actions || []).find(action => action.type === 'update');
        if (!beforeAction) {
          E.releaseWorkbookArchive(sourceBook);
          throw new Error('UAT setup: UPDATE action не найден после физической правки XLSX.');
        }

        let refreshedBytes;
        try {
          refreshedBytes = await E.refreshWorkbookDictionaries(sourceBook, structure, catalog);
        } finally {
          E.releaseWorkbookArchive(sourceBook);
          // The base OPC archive is retained solely to create the physical edit above.
          // The parsed rows remain usable by later checks after the raw ZIP parts go away.
          E.releaseWorkbookArchive(base.book);
        }
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
          throw new Error(`Refresh изменил пользовательскую правку/план: ${JSON.stringify({ before: beforePlan.counts, after: afterPlan.counts, skippedRows: afterPlan.skippedRows || [], skippedFields: afterPlan.skippedFields || [], skippedValues: afterPlan.skippedValues || [] })}`);
        }

        const afterAction = (afterPlan.actions || []).find(action => action.type === 'update');
        if (!afterAction || canon(beforeAction.currentRow?.rowCardId) !== canon(afterAction.currentRow?.rowCardId)) {
          throw new Error('После refresh изменённая строка потеряла target identity.');
        }
        const refreshedRow = (refreshed.rows || []).find(row => Number(row.excelRow) === Number(edited.source.excelRow));
        const visibleAfter = refreshedRow?.values?.[edited.column.index] ?? '';
        if (canon(visibleAfter) !== canon(visibleValue)) {
          throw new Error(`После refresh потерялась пользовательская правка ячейки ${physical.ref}: «${visibleValue}» → «${visibleAfter}».`);
        }

        return {
          detail: `Физическая правка ${physical.ref} сохранена после refresh; hidden identity и план UPDATE не изменились.`,
          data: { before: beforePlan.counts, after: afterPlan.counts, excelRow: edited.source.excelRow, cell: physical.ref, field: edited.column.key, value: visibleValue, bytes: refreshedBytes.length, sha256: await E.sha256Hex(refreshedBytes) },
        };
      });
      await runCheck('merge-current', 'Объединение с актуальной TESSA', async () => {
        const merged = E.mergeWorkbookIntoCurrentSnapshot(base.book, structure, baseline); if ((merged.snapshot?.rows || []).length !== baseline.rows.length) throw new Error(`После merge строк ${merged.snapshot?.rows?.length}, ожидалось ${baseline.rows.length}.`);
        const mergedBytes = await E.createRoundtripXlsxBytes(structure, merged.snapshot, info, catalog, { baselineRows: baseline.rows, includeActions: true, schemaChanges: merged.schemaChanges, customColumns: merged.customColumns });
        const parsed = await E.readXlsxArrayBuffer(
          E.exactArrayBuffer(mergedBytes),
          'TESSA_UAT_MERGED.xlsx',
          { skipSheetNames: ['Словари'], dictionaryCatalog: catalog, retainArchive: false, selectiveInflate: true },
        ); const plan = E.buildPlan(parsed, structure, baseline, info);
        if (plan.counts.skip || plan.counts.add || plan.counts.update || plan.counts.delete) throw new Error(`Merge дал ложные изменения: ${JSON.stringify(plan.counts)}`);
        return { detail: 'Объединение roundtrip с неизменившейся TESSA идемпотентно.', data: { bytes: mergedBytes.length, sha256: await E.sha256Hex(mergedBytes) } };
      });

      const dictionaryRefreshEvidence = report.checks.find(check => check.id === 'dictionary-refresh');
      addCheck('action-dictionary-refresh', 'Действие: обновить справочники', dictionaryRefreshEvidence?.status === 'PASS' ? 'PASS' : 'FAIL', dictionaryRefreshEvidence?.detail || 'Нет доказательства обновления справочников.', { required: true, data: { outcome: 'refreshed-workbook', artifact: 'dictionary-refreshed.xlsx', sourceCheck: 'dictionary-refresh' } });
      const mergeEvidence = report.checks.find(check => check.id === 'merge-current');
      addCheck('action-merge-current', 'Действие: объединить с актуальной TESSA', mergeEvidence?.status === 'PASS' ? 'PASS' : 'FAIL', mergeEvidence?.detail || 'Нет доказательства merge.', { required: true, data: { outcome: 'merged-workbook', artifact: 'merged-current.xlsx', sourceCheck: 'merge-current' } });

      await runCheck('dictionary-audit', 'Связь столбцов со справочниками', async () => {
        const columns = E.pickerColumns({ schemaTokens: base.book.schemaTokens, headers: base.book.headers, dictionaryCatalog: catalog }) /* FULL_UAT_PICKER_SOURCE_V2 */; const audit = columns.map(column => ({ key: column.key, label: column.label, catalogId: column.catalog?.id || catalog.columnCatalogIds?.[column.key] || null, sourceView: column.catalog?.sourceView || null, entries: column.catalog?.entries?.length || 0 }));
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


      let task8PerformanceUat = null;
      await runCheck('action-performance-uat', 'Действие: Performance UAT', async () => {
        task8PerformanceUat = await E.runPerformanceUat({ baseRows: 300 });
        if (task8PerformanceUat?.status !== 'passed') throw new Error(`Performance UAT: ${task8PerformanceUat?.status || 'unknown'}.`);
        return { detail: `${task8PerformanceUat.scenarios?.length || 0} performance-сценариев пройдено.`, data: { outcome: 'performance-result', status: task8PerformanceUat.status, totalMs: task8PerformanceUat.totalMs } };
      });
      await runCheck('action-diagnostics', 'Действие: скачать диагностику', async () => {
        const diagnosticResult = { report: { format: 'TESSA_STUDIO_DIAGNOSTICS_V1', studioVersion: report.studioVersion, status: 'passed', checks: [], omitted: [] }, entries: [['matrix-current.xlsx', base.bytes]], performanceUat: task8PerformanceUat };
        const zip = await E.makeStudioDiagnosticPackage(diagnosticResult);
        if (!(zip instanceof Uint8Array) || zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) throw new Error('Диагностика не сформировала ZIP артефакт.');
        return { detail: `Сформирован studio-diagnostics.zip (${zip.length} байт).`, data: { outcome: 'diagnostic-artifact', artifact: 'studio-diagnostics.zip', bytes: zip.length } };
      });

      addCheck('full-uat-confirmed', 'Подтверждение live write-фазы', report.liveConfirmation === 'full-uat-confirmed' ? 'PASS' : 'FAIL', report.liveConfirmation === 'full-uat-confirmed' ? 'Пользователь явно подтвердил реальные операции Full UAT.' : 'Реальные операции Full UAT не подтверждены.', { required: true, data: { confirmation: report.liveConfirmation } });
      if (report.liveConfirmation !== 'full-uat-confirmed') throw new Error('Full UAT остановлен до write-фазы: требуется явное подтверждение реальных операций.');

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
          const current = await freshSnapshot(); bridge = current.bridge; const currentCatalog = catalogForSnapshot(current.snapshot); const { book } = await workbookFromSnapshot(structure, current.snapshot, bridge, currentCatalog); const target = findRowByCard(book, rowCardId); if (!target) throw new Error('Временная строка не найдена после ADD.');
          let updatePlan = null; for (const column of shuffled(mutableCriterionColumns(book, currentCatalog, 3), rng)) { for (const entry of shuffled(column.entries.filter(entry => canon(entry.selector || entry.display) !== canon(target.values[column.index])), rng).slice(0, 20)) { const attempt = cloneWorkbook(book), row = findRowByCard(attempt, rowCardId); setDictionaryValue(attempt, row, column.key, entry); const plan = E.buildPlan(attempt, structure, current.snapshot, bridge.matrixInfo()); const exec = plan.actions.filter(action => action.type !== 'noop'); if (exec.length === 1 && exec[0].type === 'update' && canon(exec[0].currentRow?.rowCardId) === canon(rowCardId) && !plan.counts.skip) { updatePlan = plan; break; } } if (updatePlan) break; }
          if (!updatePlan) throw new Error('Не удалось подобрать безопасное UPDATE временной строки.'); registerFieldMutationObligations(updatePlan, 'write-update-delete', rowCardId); await applySingle(updatePlan, 'write-update-delete: UPDATE'); const afterUpdate = await freshSnapshot(); if (!afterUpdate.snapshot.rows.some(row => canon(row.rowCardId) === canon(rowCardId))) throw new Error('Временная строка исчезла после UPDATE.'); if (!await cleanupCreatedRow(rowCardId, 'write-update-delete')) throw new Error('Cleanup после UPDATE не подтверждён.'); const final = await freshSnapshot(); if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) throw new Error('После UPDATE cleanup baseline не восстановлен.'); return { detail: 'Временная строка изменена через штатный Store/read-back и полностью удалена.' };
        } catch (error) { await cleanupCreatedRow(rowCardId, 'write-update-delete-finally'); throw error; }
      });
      // FULL_UAT_BATCHED_FIELD_WRITES_V1
      // Every writable field is still mutated and read back, but safe changes are grouped
      // into one row UPDATE and restored together. This keeps field coverage while cutting
      // the live write/read-back count from ~2×fields to ~2×batches.
      await runCheck('write-every-field', 'Сервер: все доступные поля пакетами → read-back → restore', async () => {
        // FULL_UAT_BATCHED_FIELD_WRITES_V1
        const temp = await createTemporaryRow('write-every-field'), rowCardId = temp.created.rowCardId;
        const audit = { rowCardId, inventory: [], evidence: [], batches: [], batchSize: 6 };
        report.fieldMutationAudit = audit;
        let fatalRestore = null;
        try {
          let initial = await freshSnapshot(); bridge = initial.bridge;
          let currentCatalog = catalogForSnapshot(initial.snapshot);
          const initialPackage = await workbookFromSnapshot(structure, initial.snapshot, bridge, currentCatalog);
          const initialBook = initialPackage.book;
          const initialTarget = findRowByCard(initialBook, rowCardId);
          const initialSnapshotRow = initial.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
          if (!initialTarget || !initialSnapshotRow) throw new Error('Временная строка не найдена перед проверкой полей.');

          const inventory = buildWritableFieldInventory(initialBook, structure, currentCatalog);
          audit.inventory = inventory.map(item => ({
            token: item.token, label: item.label, kind: item.kind, strategy: item.strategy, index: item.index,
          }));
          if (!inventory.length) return { status: 'NOT_RUN', detail: 'В текущей структуре нет доступных для записи criterion/function полей.' };

          const evidenceByToken = new Map();
          for (const item of inventory) {
            const hiddenIndex = companionIndex(initialBook, item.token);
            const evidence = {
              token: item.token,
              label: item.label,
              kind: item.kind,
              before: {
                visible: String(initialTarget.values?.[item.index] ?? ''),
                hidden: hiddenIndex >= 0 ? String(initialTarget.values?.[hiddenIndex] ?? '') : '',
                semantic: canonicalFieldValues(initialSnapshotRow.flat?.[item.token] || []),
              },
              candidate: null,
              observedAfter: null,
              restoreResult: 'not-needed',
              status: 'NOT_RUN',
            };
            evidenceByToken.set(item.token, evidence);
            audit.evidence.push(evidence);
          }

          let remaining = inventory.map(item => item.token);
          const maxBatchSize = audit.batchSize;
          let reusableState = null;

          while (remaining.length && !fatalRestore) {
            const current = reusableState || await freshSnapshot(); reusableState = null; bridge = current.bridge;
            currentCatalog = catalogForSnapshot(current.snapshot);
            const prepared = await workbookFromSnapshot(structure, current.snapshot, bridge, currentCatalog);
            const baseBook = prepared.book;
            const baseTarget = findRowByCard(baseBook, rowCardId);
            const baseSnapshotRow = current.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
            if (!baseTarget || !baseSnapshotRow) throw new Error('Временная строка не найдена перед пакетной мутацией.');

            const liveInventory = buildWritableFieldInventory(baseBook, structure, currentCatalog);
            const liveByToken = new Map(liveInventory.map(item => [item.token, item]));
            let workingBook = cloneWorkbook(baseBook);
            const selected = [];

            for (const token of remaining) {
              if (selected.length >= maxBatchSize) break;
              const liveItem = liveByToken.get(token);
              if (!liveItem) continue;
              const currentVisible = String(baseTarget.values?.[liveItem.index] ?? '');
              let picked = null;

              for (const candidate of fieldCandidateValues(liveItem, currentVisible).slice(0, 24)) {
                const attempt = cloneWorkbook(workingBook);
                const attemptRow = findRowByCard(attempt, rowCardId);
                if (!attemptRow) break;
                setFieldCandidate(attempt, attemptRow, liveItem, candidate);
                let plan = E.buildPlan(attempt, structure, current.snapshot, bridge.matrixInfo());
                plan = applySafety(plan, bridge);
                const executable = (plan.actions || []).filter(action => action.type !== 'noop');
                const update = executable.length === 1
                  && executable[0].type === 'update'
                  && canon(executable[0].currentRow?.rowCardId) === canon(rowCardId)
                  ? executable[0] : null;
                const change = update?.changes?.find(item => item.key === liveItem.token);
                if (update && change && !plan.counts?.skip && !plan.safety?.blocked) {
                  picked = { candidate, attempt, plan };
                  break;
                }
              }

              if (!picked) continue;
              workingBook = picked.attempt;
              selected.push({ token, item: liveItem, candidate: picked.candidate });
            }

            if (!selected.length) {
              // With an empty batch, failure means there is no safe isolated alternative
              // for the remaining fields in the current live row.
              for (const token of remaining) {
                const evidence = evidenceByToken.get(token);
                const liveItem = liveByToken.get(token);
                evidence.status = 'NOT_RUN';
                evidence.reason = liveItem
                  ? 'Не найдено безопасное альтернативное значение, дающее единственный UPDATE.'
                  : 'Поле исчезло из актуальной структуры.';
              }
              break;
            }

            let batchPlan = E.buildPlan(workingBook, structure, current.snapshot, bridge.matrixInfo());
            batchPlan = applySafety(batchPlan, bridge);
            const executable = (batchPlan.actions || []).filter(action => action.type !== 'noop');
            const update = executable.length === 1
              && executable[0].type === 'update'
              && canon(executable[0].currentRow?.rowCardId) === canon(rowCardId)
              ? executable[0] : null;
            if (!update || batchPlan.counts?.skip || batchPlan.safety?.blocked) {
              throw new Error('Пакетный field-UAT не построил единственный безопасный UPDATE.');
            }

            const selectedTokens = new Set(selected.map(item => item.token));
            const expectedByToken = new Map();
            for (const selectedItem of selected) {
              const change = update.changes?.find(item => item.key === selectedItem.token);
              if (!change) throw new Error('Пакетный UPDATE потерял изменение ' + selectedItem.token + '.');
              const rawExpectedAfter = canonicalFieldValues(change.after || []);
              // FULL_UAT_BOOLEAN_SEMANTIC_V2
              const expectedAfter = selectedItem.item.strategy === 'boolean'
                ? rawExpectedAfter.map(value =>
                  ['да', 'true', '1'].includes(value) ? 'true'
                    : ['нет', 'false', '0'].includes(value) ? 'false' : value)
                : rawExpectedAfter;
              expectedByToken.set(selectedItem.token, expectedAfter);
              const evidence = evidenceByToken.get(selectedItem.token);
              evidence.candidate = candidateEvidenceValue(selectedItem.candidate);
            }

            const batchId = 'field-batch-' + String(audit.batches.length + 1).padStart(2, '0');
            const mutationObligationIds = registerFieldMutationObligations(batchPlan, batchId, rowCardId);
            const writesBefore = report.writesCompleted;
            let mutationApplied = false;
            let batchError = null;
            let afterState = null;
            try {
              await applySingle(batchPlan, batchId + ': UPDATE');
              mutationApplied = true;
              afterState = await freshSnapshot(); bridge = afterState.bridge;
              const after = afterState;
              const afterRow = after.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
              if (!afterRow) throw new Error('Временная строка исчезла после пакетной мутации.');

              for (const selectedItem of selected) {
                const evidence = evidenceByToken.get(selectedItem.token);
                const observed = canonicalFieldValues(afterRow.flat?.[selectedItem.token] || []);
                evidence.observedAfter = [...observed];
                if (!sameArray(observed, expectedByToken.get(selectedItem.token) || [])) {
                  evidence.status = 'FAIL';
                  evidence.error = 'Read-back не совпал с ожидаемым значением.';
                  batchError ||= new Error(
                    'Read-back ' + selectedItem.token + ' не совпал: expected='
                    + JSON.stringify(expectedByToken.get(selectedItem.token) || [])
                    + ' actual=' + JSON.stringify(observed)
                  );
                } else {
                  evidence.status = 'PASS';
                }
              }
            } catch (error) {
              batchError = error;
              for (const selectedItem of selected) {
                const evidence = evidenceByToken.get(selectedItem.token);
                if (evidence.status !== 'PASS') {
                  evidence.status = 'FAIL';
                  evidence.error = String(error?.message || error);
                }
              }
            } finally {
              if (mutationApplied) {
                try {
                  const restoreState = afterState || await freshSnapshot(); bridge = restoreState.bridge;
                  const restoreCatalog = catalogForSnapshot(restoreState.snapshot);
                  const restorePackage = await workbookFromSnapshot(structure, restoreState.snapshot, bridge, restoreCatalog);
                  const restoreBook = restorePackage.book;
                  const restoreRow = findRowByCard(restoreBook, rowCardId);
                  if (!restoreRow) throw new Error('Временная строка недоступна для пакетного restore.');

                  for (const selectedItem of selected) {
                    const restoreItem = buildWritableFieldInventory(restoreBook, structure, restoreCatalog)
                      .find(item => item.token === selectedItem.token);
                    const evidence = evidenceByToken.get(selectedItem.token);
                    if (!restoreItem) throw new Error('Поле ' + selectedItem.token + ' недоступно для restore.');
                    restoreRow.values[restoreItem.index] = evidence.before.visible;
                    const hiddenIndex = companionIndex(restoreBook, restoreItem.token);
                    if (hiddenIndex >= 0) restoreRow.values[hiddenIndex] = evidence.before.hidden;
                  }

                  let restorePlan = E.buildPlan(restoreBook, structure, restoreState.snapshot, bridge.matrixInfo());
                  restorePlan = applySafety(restorePlan, bridge);
                  const restoreExecutable = (restorePlan.actions || []).filter(action => action.type !== 'noop');

                  const needsRestore = selected.some(selectedItem => {
                    const liveRow = restoreState.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
                    return !sameArray(
                      canonicalFieldValues(liveRow?.flat?.[selectedItem.token] || []),
                      evidenceByToken.get(selectedItem.token).before.semantic || []
                    );
                  });

                  if (needsRestore) {
                    if (restoreExecutable.length !== 1
                      || restoreExecutable[0].type !== 'update'
                      || canon(restoreExecutable[0].currentRow?.rowCardId) !== canon(rowCardId)
                      || restorePlan.counts?.skip
                      || restorePlan.safety?.blocked) {
                      throw new Error('Пакетный restore не построил единственный безопасный UPDATE.');
                    }
                    await applySingle(restorePlan, batchId + ': restore');
                  }

                  const restored = await freshSnapshot(); bridge = restored.bridge;
                  reusableState = restored;
                  const restoredRow = restored.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
                  if (!restoredRow) throw new Error('Временная строка исчезла после пакетного restore.');

                  for (const selectedItem of selected) {
                    const evidence = evidenceByToken.get(selectedItem.token);
                    const restoredSemantic = canonicalFieldValues(restoredRow.flat?.[selectedItem.token] || []);
                    if (!sameArray(restoredSemantic, evidence.before.semantic || [])) {
                      throw new Error('restore read-back ' + selectedItem.token + ' не совпал с исходным значением.');
                    }
                    evidence.restoreResult = 'verified';
                  }
                  for (const obligationId of mutationObligationIds) {
                    resolveCleanupObligation(obligationId, {
                      status: 'verified',
                      resolvedAt: now(),
                      resolvedBy: 'batched-field-readback-restore',
                    });
                  }
                } catch (restoreError) {
                  cleanupUnsafe = true;
                  fatalRestore = restoreError;
                  for (const selectedItem of selected) {
                    const evidence = evidenceByToken.get(selectedItem.token);
                    evidence.restoreResult = 'FAILED: ' + String(restoreError?.message || restoreError);
                    evidence.status = 'FAIL';
                  }
                }
              }
            }

            audit.batches.push({
              id: batchId,
              tokens: selected.map(item => item.token),
              fields: selected.length,
              writes: report.writesCompleted - writesBefore,
              status: fatalRestore || batchError ? 'FAIL' : 'PASS',
              error: fatalRestore ? String(fatalRestore?.message || fatalRestore)
                : batchError ? String(batchError?.message || batchError) : null,
            });

            remaining = remaining.filter(token => !selectedTokens.has(token));
            if (batchError) {
              // Keep testing independent later batches only if cleanup was proven.
              if (fatalRestore) break;
            }
          }

          const passCount = audit.evidence.filter(item => item.status === 'PASS').length;
          const failCount = audit.evidence.filter(item => item.status === 'FAIL').length;
          const notRunCount = audit.evidence.filter(item => item.status === 'NOT_RUN').length;
          audit.summary = {
            total: audit.evidence.length,
            pass: passCount,
            fail: failCount,
            notRun: notRunCount,
            batches: audit.batches.length,
            writes: audit.batches.reduce((sum, item) => sum + Number(item.writes || 0), 0),
          };

          if (fatalRestore) throw fatalRestore;
          if (failCount) throw new Error(
            'Пакетная проверка полей: FAIL ' + failCount + ' из ' + audit.evidence.length
            + '. См. fieldMutationAudit.'
          );
          return {
            detail: 'Поля проверены пакетами: PASS ' + passCount
              + ', NOT RUN ' + notRunCount
              + ', пакетов ' + audit.batches.length
              + ', write-операций ' + audit.summary.writes + '.',
            data: audit.summary,
          };
        } finally {
          if (!await cleanupCreatedRow(rowCardId, 'write-every-field-finally')) cleanupUnsafe = true;
        }
      });
      await runCheck('write-clear-delete', 'Сервер: ADD → SET → CLEAR → read-back → cleanup', async () => {
        // FULL_UAT_CLEAR_SCENARIO_DETERMINISTIC_V2
        // The old test tried to infer that a criterion was optional by looking for some
        // *other* production row where the same column happened to be blank. That made
        // the check depend on the live matrix data shape and could return NOT_RUN even
        // when SET/CLEAR worked correctly. A freshly accepted temporary row is stronger
        // evidence: every criterion that is blank on that accepted row is already proven
        // to have a valid blank state for this exact row. Exercise that field through a
        // real dictionary-backed SET, server read-back, CLEAR, server read-back, cleanup.
        const temp = await createTemporaryRow('write-clear-delete'), rowCardId = temp.created.rowCardId;
        try {
          const current = await freshSnapshot();
          bridge = current.bridge;
          const currentCatalog = await bridge.loadDictionaryCatalog(structure, current.snapshot, { forceRefresh: true, transient: true });
          const { book } = await workbookFromSnapshot(structure, current.snapshot, bridge, currentCatalog);
          const target = findRowByCard(book, rowCardId);
          if (!target) throw new Error('Временная строка не найдена после ADD.');

          const blankColumns = shuffled(
            mutableCriterionColumns(book, currentCatalog, 1)
              .filter(column => !String(target.values?.[column.index] || '').trim()),
            rng,
          );
          let selected = null;
          for (const column of blankColumns) {
            for (const entry of shuffled(column.entries, rng).slice(0, 40)) {
              const attempt = cloneWorkbook(book);
              const row = findRowByCard(attempt, rowCardId);
              if (!row) throw new Error('Временная строка потеряна при подготовке SET.');
              setDictionaryValue(attempt, row, column.key, entry);
              const plan = E.buildPlan(attempt, structure, current.snapshot, bridge.matrixInfo());
              const executable = (plan.actions || []).filter(action => action.type !== 'noop');
              if (executable.length === 1
                && executable[0].type === 'update'
                && canon(executable[0].currentRow?.rowCardId) === canon(rowCardId)
                && Number(plan.counts?.skip || 0) === 0
                && !(plan.issues || []).length) {
                selected = { column, entry, plan };
                break;
              }
            }
            if (selected) break;
          }
          if (!selected) {
            throw new Error('Не удалось подобрать безопасный словарный критерий для детерминированного SET → CLEAR на временной строке.');
          }

          await applySingle(selected.plan, 'write-clear-delete: SET');

          const afterSet = await freshSnapshot();
          bridge = afterSet.bridge;
          const setRow = afterSet.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
          if (!setRow) throw new Error('Временная строка исчезла после SET.');
          const setValues = setRow.flat?.[selected.column.key] || [];
          if (!(Array.isArray(setValues) ? setValues.some(value => String(value ?? '').trim()) : String(setValues ?? '').trim())) {
            throw new Error('SET не подтверждён server read-back: выбранный критерий остался пустым.');
          }

          const setCatalog = await bridge.loadDictionaryCatalog(structure, afterSet.snapshot, { forceRefresh: true, transient: true });
          const { book: setBook } = await workbookFromSnapshot(structure, afterSet.snapshot, bridge, setCatalog);
          const clearTarget = findRowByCard(setBook, rowCardId);
          if (!clearTarget) throw new Error('Временная строка не найдена перед CLEAR.');
          const clearIndex = tokenIndex(setBook, selected.column.key);
          if (clearIndex < 0) throw new Error('Критерий SET отсутствует в свежей Excel-схеме перед CLEAR.');

          const clearBook = cloneWorkbook(setBook);
          const clearRow = findRowByCard(clearBook, rowCardId);
          clearRow.values[clearIndex] = '';
          const idIndex = companionIndex(clearBook, selected.column.key);
          if (idIndex >= 0) clearRow.values[idIndex] = '';
          const clearPlan = E.buildPlan(clearBook, structure, afterSet.snapshot, bridge.matrixInfo());
          const clearExecutable = (clearPlan.actions || []).filter(action => action.type !== 'noop');
          if (clearExecutable.length !== 1
            || clearExecutable[0].type !== 'update'
            || canon(clearExecutable[0].currentRow?.rowCardId) !== canon(rowCardId)
            || Number(clearPlan.counts?.skip || 0) !== 0
            || (clearPlan.issues || []).length) {
            throw new Error('CLEAR не построил единственный безопасный UPDATE временной строки: ' + JSON.stringify(compactPlan(clearPlan)));
          }

          await applySingle(clearPlan, 'write-clear-delete: CLEAR');

          const afterClear = await freshSnapshot();
          const clearedRow = afterClear.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
          if (!clearedRow) throw new Error('Временная строка исчезла после CLEAR до cleanup.');
          const clearedValues = clearedRow.flat?.[selected.column.key] || [];
          if (Array.isArray(clearedValues)
            ? clearedValues.some(value => String(value ?? '').trim())
            : Boolean(String(clearedValues ?? '').trim())) {
            throw new Error('CLEAR не подтверждён server read-back: критерий остался заполненным.');
          }

          if (!await cleanupCreatedRow(rowCardId, 'write-clear-delete')) {
            throw new Error('Cleanup после SET → CLEAR не подтверждён.');
          }
          const final = await freshSnapshot();
          if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) {
            throw new Error('После SET → CLEAR → cleanup baseline не восстановлен.');
          }
          return { detail: 'На временной строке выполнены SET → CLEAR → read-back → cleanup; baseline полностью восстановлен.' };
        } catch (error) {
          await cleanupCreatedRow(rowCardId, 'write-clear-delete-finally');
          throw error;
        }
      });

      // FULL_UAT_RECORDER_THROUGH_FINAL_SAVE_V2
      // Recorder remains active: cleanup recovery, the sole main-card Save and its proof
      // still belong to the same native evidence window.
    } catch (error) {
      report.fatalError = String(error?.message || error);
      const abortedBeforeBaseline = !baselineCaptured && report.writesAttempted === 0;
      report.status = cleanupUnsafe ? 'UNSAFE' : 'INCOMPLETE';
      if (abortedBeforeBaseline && !report.checks.some(check => check.id === 'uat-preflight')) {
        addCheck('uat-preflight', 'Готовность Full UAT', 'FAIL', report.fatalError, { required: true, data: { phase: initializationPhase, baselineCaptured: false, writesAttempted: 0 } });
      }
      timeline('fatal', report.fatalError, { phase: initializationPhase, baselineCaptured, writesAttempted: report.writesAttempted });
    } finally {

      const recoveryReady = Boolean(baselineCaptured && baselineSignature && structure && pinnedUatBridge && report.matrix?.matrixId);
      if (!recoveryReady && report.writesAttempted === 0) {
        report.finalMatrixSave = { ok: false, skipped: true, reason: 'preflight-abort-before-baseline' };
        report.restoreProof = {
          status: 'NOT_REQUIRED', baselineEquivalent: null, pendingObligations: 0, failedObligations: 0,
          reason: 'UAT остановлен до подтверждённого baseline и до первой мутации; восстанавливать нечего.',
          phase: initializationPhase, checkedAt: now(),
        };
        addCheck('final-restore-proof', 'Task9: восстановление baseline', 'NOT_RUN', report.restoreProof.reason, { required: true, data: report.restoreProof });
        timeline('recovery-skipped', report.restoreProof.reason, { phase: initializationPhase });
      } else try {
        await recoverCleanupObligations();
        // FULL_UAT_SINGLE_MAIN_SAVE_V1
        if (report.writesCompleted > 0) {
          if (!bridge || typeof bridge.saveMainMatrixAfterApply !== 'function') throw new Error('Финальный нативный Save основной карточки матрицы недоступен.');
          const finalMainSave = await bridge.saveMainMatrixAfterApply();
          report.finalMatrixSave = E.safePlain(finalMainSave, { maxDepth: 4, maxKeys: 80, maxArray: 20 });
          if (!finalMainSave || finalMainSave.ok === false) throw new Error(`Финальный нативный Save основной карточки матрицы не подтверждён: ${String(finalMainSave?.reason || finalMainSave?.error || 'unknown')}`);
          timeline('main-matrix-save', 'Один нативный Save после write/cleanup фазы.', { method: finalMainSave.method || null });
        } else {
          report.finalMatrixSave = { ok: false, skipped: true, reason: 'no-accepted-writes' };
        }

        const final = await freshSnapshot();
        if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) {
          cleanupUnsafe = true;
          addCheck('final-baseline', 'Финальное состояние матрицы', 'FAIL', 'После cleanup и финального Save исходные строки/значения отличаются от baseline.', { required: true });
        } else {
          addCheck('final-baseline', 'Финальное состояние матрицы', 'PASS', 'После cleanup и финального Save исходная матрица полностью восстановлена.', { required: true });
        }

        if (typeof E.stopNativeOperationRecorder === 'function') {
          try {
            const nativeRecord = await E.stopNativeOperationRecorder(false);
            if (nativeRecord) report.nativeOperationSummary = {
              format: 'TESSA_NATIVE_OPERATION_SUMMARY_V1',
              captured: Array.isArray(nativeRecord?.records) ? nativeRecord.records.length : 0,
              errors: Array.isArray(nativeRecord?.records) ? nativeRecord.records.filter(item => item?.status === 'error').length : 0,
            };
          } catch (error) {
            addCheck('native-recorder-stop', 'Остановка нативной записи', 'WARN', String(error?.message || error), { required: false });
          }
        }
        if (cleanupLedgerController && baselineSignature && structure && report.matrix?.matrixId) {
          const restoredState = await freshSnapshot();
          report.cleanupLedger = cleanupLedgerController.snapshot();
          report.restoreProof = baselineRestoreProof(baselineSignature, snapshotSignature(restoredState.snapshot), report.cleanupLedger);
          addCheck('final-restore-proof', 'Task9: восстановление baseline', report.restoreProof.status === 'VERIFIED' ? 'PASS' : 'FAIL', report.restoreProof.status === 'VERIFIED'
            ? `Baseline подтверждён fresh read; cleanup ${report.cleanupLedger.verified}/${report.cleanupLedger.total}.`
            : `UNSAFE: baselineEquivalent=${report.restoreProof.baselineEquivalent}, pending=${report.restoreProof.pendingObligations}, failed=${report.restoreProof.failedObligations}.`,
            { required: true, data: report.restoreProof });
          if (report.restoreProof.status === 'UNSAFE') { cleanupUnsafe = true; report.status = 'UNSAFE'; }
        }
      } catch (recoveryError) {
        cleanupUnsafe = true;
        report.status = 'UNSAFE';
        report.cleanupLedger = cleanupLedgerController ? cleanupLedgerController.snapshot() : report.cleanupLedger;
        report.restoreProof = {
          status: 'UNSAFE', baselineEquivalent: false,
          pendingObligations: Number(report.cleanupLedger?.pending || 0),
          failedObligations: Number(report.cleanupLedger?.failed || 0),
          error: String(recoveryError?.message || recoveryError), checkedAt: now(),
        };
        addCheck('final-restore-proof', 'Task9: восстановление baseline', 'FAIL', `UNSAFE: ${report.restoreProof.error}`, { required: true, data: report.restoreProof });
      }

      // FULL_UAT_ACTION_COVERAGE_FINAL_V1
      // Apply evidence is based on the same audited live writes that the Full UAT just
      // executed. A PASS requires at least one accepted mutation and zero unfinished writes.
      {
        const noWriteAbort = Boolean(report.fatalError) && report.writesAttempted === 0;
        const applyOk = report.writesAttempted > 0
          && report.writesCompleted === report.writesAttempted
          && !report.checks.some(check => check.required !== false && check.status === 'FAIL' && /^write-/.test(String(check.id || '')));
        addCheck(
          'action-apply',
          'Действие: применить к TESSA',
          noWriteAbort ? 'NOT_RUN' : (applyOk ? 'PASS' : 'FAIL'),
          noWriteAbort
            ? 'Apply не запускался: Full UAT остановился до первой мутации. Первичная причина сохранена в fatalError.'
            : (applyOk
              ? 'Реальные Apply-операции завершены и подтверждены server read-back/cleanup.'
              : ('Apply evidence неполный: attempted=' + report.writesAttempted + ', completed=' + report.writesCompleted + '.')),
          { required: true, data: { outcome: applyOk ? 'live-write-readback' : null, writesAttempted: report.writesAttempted, writesCompleted: report.writesCompleted, notRunBecauseFatalBeforeWrite: noWriteAbort } },
        );
      }

      // Reconcile must be a real runReconciliationRead invocation. The retained receipt is
      // a successful DELETE of a temporary UAT row; after cleanup/final Save the correct
      // reconciliation result is "verified" with that row still absent.
      try {
        const noWriteAbort = Boolean(report.fatalError) && report.writesAttempted === 0;
        if (noWriteAbort) {
          addCheck('action-reconcile', 'Действие: сверить результат', 'NOT_RUN', 'Reconcile не запускался: Full UAT остановился до первой мутации, поэтому mutation receipt не создавался.', { required: true, data: { outcome: null, notRunBecauseFatalBeforeWrite: true } });
        } else {
          if (!reconciliationActionReceiptContext?.receipts?.length) {
            throw new Error('Нет подтверждённого DELETE receipt для Reconcile evidence.');
          }
          const reconciliationResult = await E.runReconciliationRead(
            async () => pinnedUatBridge || E.TessaBridge.create(),
          reconciliationActionReceiptContext,
          { attempts: 3, baseDelayMs: 100 },
        );
        const checked = Number(reconciliationResult?.checkedCount || 0);
        const verified = Number(reconciliationResult?.verifiedCount || 0);
        if (reconciliationResult?.status !== 'verified' || checked < 1 || verified !== checked) {
          throw new Error(
            'Reconcile не подтвердил receipt: status=' + String(reconciliationResult?.status || 'unknown')
            + ', checked=' + checked + ', verified=' + verified
            + ', missing=' + Number(reconciliationResult?.missingCount || 0)
            + ', divergent=' + Number(reconciliationResult?.divergentCount || 0) + '.',
          );
        }
        addCheck(
          'action-reconcile',
          'Действие: сверить результат',
          'PASS',
          'Reconcile реально перечитал TESSA по mutation receipt и подтвердил итог.',
          {
            required: true,
            data: {
              outcome: 'reconciliation-readback',
              status: reconciliationResult.status,
              mode: reconciliationResult.mode || null,
              checkedCount: checked,
              verifiedCount: verified,
              attempts: reconciliationResult.attempts || 1,
            },
          },
        );
        }
      } catch (reconcileError) {
        addCheck(
          'action-reconcile',
          'Действие: сверить результат',
          'FAIL',
          String(reconcileError?.message || reconcileError),
          { required: true, data: { outcome: null } },
        );
      }

      try {
        const packageProbe = await E.makeZip([...packageEntries, ['task8-package-probe.txt', utf8('TESSA Full UAT package probe')]]);
        if (!(packageProbe instanceof Uint8Array) || packageProbe.length < 4 || packageProbe[0] !== 0x50 || packageProbe[1] !== 0x4b) throw new Error('Full UAT package probe не является ZIP.');
        addCheck('action-full-uat', 'Действие: полный UAT', 'PASS', `Full UAT package path сформировал ZIP (${packageProbe.length} байт).`, { required: true, data: { outcome: 'full-uat-package', artifact: 'TESSA_Full_UAT_*.zip', bytes: packageProbe.length } });
      } catch (packageProbeError) {
        addCheck('action-full-uat', 'Действие: полный UAT', 'FAIL', String(packageProbeError?.message || packageProbeError), { required: true, data: { outcome: null } });
      }
      report.functionalActionAudit = actionCoverageFromChecks(report.checks, E.STUDIO_ACTION_REGISTRY || []);
      // FULL_UAT_FINAL_VERDICT_AFTER_SAVE_V2
      const requiredFailures = report.checks.filter(check => check.required !== false && check.status === 'FAIL');
      if (cleanupUnsafe || report.restoreProof?.status === 'UNSAFE') report.status = 'UNSAFE';
      else if (report.fatalError) report.status = 'INCOMPLETE';
      else if (requiredFailures.length || report.functionalActionAudit.missing.length) report.status = 'FAILED';
      else report.status = 'PASSED';

      // FULL_UAT_FAILURE_SUMMARY_V1
      report.failedChecks = report.checks
        .filter(check => check.status === 'FAIL')
        .map(check => ({ id: check.id, title: check.title, detail: check.detail, required: check.required !== false }));
      if (report.failedChecks.length) {
        const failureText = report.failedChecks.map((check, index) => (index + 1) + '. ' + check.id + ' — ' + (check.title || '') + '\n' + String(check.detail || '')).join('\n\n');
        packageEntries.push(['failed-checks.json', utf8({ seed: report.seed, status: report.status, fatalError: report.fatalError || null, failures: report.failedChecks })], ['FAILURES.txt', utf8((report.fatalError ? 'FATAL\\n' + report.fatalError + '\\n\\n' : '') + failureText)]);
      }

      report.finishedAt = now(); report.durationMs = new Date(report.finishedAt).getTime() - new Date(startedAt).getTime(); report.summary = { pass: report.checks.filter(x => x.status === 'PASS').length, fail: report.checks.filter(x => x.status === 'FAIL').length, warn: report.checks.filter(x => x.status === 'WARN').length, notRun: report.checks.filter(x => x.status === 'NOT_RUN').length, writesAttempted: report.writesAttempted, writesCompleted: report.writesCompleted, cleanupVerified: report.cleanup.filter(x => x.status === 'verified' || x.status === 'already-absent').length, cleanupFailed: report.cleanup.filter(x => x.status === 'FAILED').length, cleanupLedgerPending: Number(report.cleanupLedger?.pending || 0), cleanupLedgerFailed: Number(report.cleanupLedger?.failed || 0), restoreStatus: report.restoreProof?.status || 'NOT_RUN' };
      const summary = { format: 'TESSA_FULL_UAT_SUMMARY_V1', status: report.status, seed: report.seed, studioVersion: report.studioVersion, runnerVersion: report.runnerVersion, matrix: report.matrix, startedAt: report.startedAt, finishedAt: report.finishedAt, summary: report.summary, failedChecks: report.failedChecks };
      const readme = `TESSA Matrix Studio — Full UAT\n\nСтатус: ${report.status}\nSeed: ${report.seed}\nМатрица: ${report.matrix?.name || ''} (${report.matrix?.matrixId || ''})\n\nPASSED — обязательные проверки прошли и cleanup подтверждён.\nFAILED — есть функциональная ошибка, cleanup подтверждён.\nUNSAFE — cleanup или восстановление исходного состояния не подтверждены.\nINCOMPLETE — UAT не дошёл до полного набора проверок.\n`;
      packageEntries.push(['cleanup-ledger.json', utf8(report.cleanupLedger || {})], ['restore-proof.json', utf8(report.restoreProof || {})], ['summary.json', utf8(summary)], ['uat-report.json', utf8(report)], ['timeline.json', utf8(report.timeline)], ['dictionary-audit.json', utf8({ dictionaryAudit: report.dictionaryAudit, rolePresentationAudit: report.rolePresentationAudit, recordKeepingAudit: report.recordKeepingAudit, productionShadowAudit: report.productionShadowAudit })], ['README.txt', utf8(readme)]);
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
    const card = document.createElement('div'); card.className = 'tms-uat-card'; card.innerHTML = `<h4>Полный UAT</h4><button id="tms-full-uat" type="button">Запустить полный UAT</button><div id="tms-full-uat-status" class="tms-uat-status" data-state="idle">Не запускался.</div>`; host.appendChild(card);
    const button = card.querySelector('#tms-full-uat'), status = card.querySelector('#tms-full-uat-status');
    button.addEventListener('click', async () => {
      // FULL_UAT_UI_PREFLIGHT_V1
      try {
        const preflightBridge = await E.TessaBridge.create();
        E.assertWritableMatrixDraft(preflightBridge);
        E.assertNativeEditMode();
      } catch (preflightError) {
        status.dataset.state = 'INCOMPLETE';
        status.textContent = 'INCOMPLETE · PRECHECK\n' + String(preflightError?.message || preflightError) + '\nНикаких изменений в TESSA не выполнялось.';
        return;
      }
      if (!window.confirm('Полный UAT выполнит реальные операции только с временными строками в текущем черновике TESSA и будет удалять их после каждого сценария. Запустить?')) return;
      button.disabled = true; status.dataset.state = 'running'; status.textContent = 'Выполняю Full UAT… Не закрывайте вкладку до скачивания итогового ZIP.';
      try {
        // FULL_UAT_INLINE_FAILURES_V1
        const result = await runFullUat({ liveConfirmation: 'full-uat-confirmed' });
        status.dataset.state = result.status;
        const failures = Array.isArray(result.failedChecks)
          ? result.failedChecks
          : (result.checks || []).filter(check => check?.status === 'FAIL').map(check => ({ id: check.id, title: check.title, detail: check.detail }));
        const nl = String.fromCharCode(10);
        const failureText = failures.map((check, index) =>
          String(index + 1) + '. ' + String(check?.id || 'unknown') + ' — ' + String(check?.title || '') + nl + String(check?.detail || '')
        ).join(nl + nl);
        const header = String(result.status) + ' · PASS ' + String(result.summary?.pass || 0) + ' · FAIL ' + String(result.summary?.fail || 0) + ' · NOT RUN ' + String(result.summary?.notRun || 0)
          + nl + 'Итоговый ZIP скачан. Seed: ' + String(result.seed);
        status.textContent = header + (failureText ? nl + nl + 'FAIL DETAILS' + nl + failureText : '');
        if (failureText && E && typeof E.triggerBlobDownload === 'function') {
          E.triggerBlobDownload(
            new Blob([failureText], { type: 'text/plain;charset=utf-8' }),
            'TESSA_Full_UAT_FAILURES_' + String(result.seed || 'unknown') + '.txt',
          );
        }
      }
      catch (error) { status.dataset.state = 'UNSAFE'; status.textContent = `UNSAFE · ${String(error?.message || error)}`; }
      finally { button.disabled = false; }
    });
    return true;
  }

  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, buildWritableFieldInventory, fieldCandidateValues, actionCoverageFromChecks, createCleanupLedger, baselineRestoreProof, runProductionShadowAudit, runFullUat, installUi };
  if (!globalThis.__TESSA_MATRIX_SYNC_TEST_MODE__) { let attempts = 0; const timer = setInterval(() => { attempts += 1; if (installUi() || attempts > 120) clearInterval(timer); }, 250); installUi(); }
})();
