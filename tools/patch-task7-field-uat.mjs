import fs from 'node:fs';
import assert from 'node:assert/strict';

const userscriptPath = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(userscriptPath, 'utf8');

function replaceOne(before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: source block not found`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: source block is not unique`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

const oldInventoryAnchor = `  function mutableCriterionColumns(book, catalog, minimum = 2) {
    return (book.schemaTokens || []).map((key, index) => ({ key, index, entries: String(key || '').startsWith('criterion:') ? authoritativeEntries(catalog, key) : [] }))
      .filter(item => item.entries.length >= minimum);
  }

  function shuffled(array, rng) {`;

const newInventoryAnchor = `  function mutableCriterionColumns(book, catalog, minimum = 2) {
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
    const match = String(text ?? '').trim().match(/^(.+?)\\s+(?:-|–|—|\\.\\.|до)\\s+(.+)$/i);
    return match ? [match[1].trim(), match[2].trim()] : null;
  }

  function formatCandidateNumber(value, integer, comma) {
    const rendered = integer ? String(Math.trunc(value)) : String(Math.round(value * 1000) / 1000);
    return comma ? rendered.replace('.', ',') : rendered;
  }

  function parseUatDate(text) {
    const raw = String(text ?? '').trim();
    let match = raw.match(/^(\\d{1,2})[.\\/-](\\d{1,2})[.\\/-](\\d{4})(?:[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?$/);
    if (match) {
      const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    match = raw.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})(?:[ T](\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?$/);
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

  function shuffled(array, rng) {`;
replaceOne(oldInventoryAnchor, newInventoryAnchor, 'Task7 writable field inventory helpers');

replaceOne(
  `      rolePresentationAudit: null, recordKeepingAudit: null, writesAttempted: 0, writesCompleted: 0,`,
  `      rolePresentationAudit: null, recordKeepingAudit: null, fieldMutationAudit: null, writesAttempted: 0, writesCompleted: 0,`,
  'Task7 report field mutation audit',
);

const clearScenarioAnchor = `      await runCheck('write-clear-delete', 'Сервер: ADD → очистка поля → read-back → cleanup', async () => {`;
const everyFieldScenario = `      await runCheck('write-every-field', 'Сервер: каждое доступное поле → read-back → restore', async () => {
        const temp = await createTemporaryRow('write-every-field'), rowCardId = temp.created.rowCardId;
        const audit = { rowCardId, inventory: [], evidence: [] };
        report.fieldMutationAudit = audit;
        let fatalRestore = null;
        try {
          let initial = await freshSnapshot(); bridge = initial.bridge;
          let currentCatalog = await bridge.loadDictionaryCatalog(structure, initial.snapshot, { forceRefresh: true, transient: true });
          let currentPackage = await workbookFromSnapshot(structure, initial.snapshot, bridge, currentCatalog);
          let currentBook = currentPackage.book;
          let currentTarget = findRowByCard(currentBook, rowCardId);
          if (!currentTarget) throw new Error('Временная строка не найдена перед проверкой полей.');
          const inventory = buildWritableFieldInventory(currentBook, structure, currentCatalog);
          audit.inventory = inventory.map(item => ({ token: item.token, label: item.label, kind: item.kind, strategy: item.strategy, index: item.index }));
          if (!inventory.length) return { status: 'NOT_RUN', detail: 'В текущей структуре нет доступных для записи criterion/function полей.' };

          for (const inventoryItem of inventory) {
            let mutationApplied = false;
            let original = null;
            let originalSemantic = [];
            let evidence = {
              token: inventoryItem.token,
              label: inventoryItem.label,
              kind: inventoryItem.kind,
              before: null,
              candidate: null,
              observedAfter: null,
              restoreResult: 'not-needed',
              status: 'NOT_RUN',
            };
            audit.evidence.push(evidence);
            try {
              const current = await freshSnapshot(); bridge = current.bridge;
              currentCatalog = await bridge.loadDictionaryCatalog(structure, current.snapshot, { forceRefresh: true, transient: true });
              const prepared = await workbookFromSnapshot(structure, current.snapshot, bridge, currentCatalog);
              const book = prepared.book;
              const target = findRowByCard(book, rowCardId);
              const snapshotRow = current.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
              if (!target || !snapshotRow) throw new Error('Временная строка не найдена перед изолированной мутацией.');
              const liveItem = buildWritableFieldInventory(book, structure, currentCatalog).find(item => item.token === inventoryItem.token);
              if (!liveItem) {
                evidence.status = 'NOT_RUN'; evidence.restoreResult = 'not-needed'; evidence.reason = 'Поле исчезло из актуальной структуры.';
                continue;
              }
              const hiddenIndex = companionIndex(book, liveItem.token);
              original = { visible: String(target.values?.[liveItem.index] ?? ''), hidden: hiddenIndex >= 0 ? String(target.values?.[hiddenIndex] ?? '') : '' };
              originalSemantic = canonicalFieldValues(snapshotRow.flat?.[liveItem.token] || []);
              evidence.before = { visible: original.visible, hidden: original.hidden, semantic: [...originalSemantic] };

              let selected = null;
              for (const candidate of fieldCandidateValues(liveItem, original.visible).slice(0, 24)) {
                const attempt = cloneWorkbook(book);
                const attemptRow = findRowByCard(attempt, rowCardId);
                setFieldCandidate(attempt, attemptRow, liveItem, candidate);
                let plan = E.buildPlan(attempt, structure, current.snapshot, bridge.matrixInfo());
                plan = applySafety(plan, bridge);
                const executable = (plan.actions || []).filter(action => action.type !== 'noop');
                const update = executable.length === 1 && executable[0].type === 'update' && canon(executable[0].currentRow?.rowCardId) === canon(rowCardId) ? executable[0] : null;
                const change = update?.changes?.find(item => item.key === liveItem.token);
                if (update && change && !plan.counts?.skip && !plan.safety?.blocked) {
                  selected = { candidate, plan, expectedAfter: canonicalFieldValues(change.after || []) };
                  break;
                }
              }
              if (!selected) {
                evidence.status = 'NOT_RUN'; evidence.restoreResult = 'not-needed'; evidence.reason = 'Не найдено безопасное альтернативное значение, дающее единственный UPDATE.';
                continue;
              }

              evidence.candidate = candidateEvidenceValue(selected.candidate);
              await applySingle(selected.plan, `write-every-field ${liveItem.token}: UPDATE`);
              mutationApplied = true;
              const after = await freshSnapshot(); bridge = after.bridge;
              const afterRow = after.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
              if (!afterRow) throw new Error('Временная строка исчезла после мутации поля.');
              const observedAfter = canonicalFieldValues(afterRow.flat?.[liveItem.token] || []);
              evidence.observedAfter = [...observedAfter];
              if (!sameArray(observedAfter, selected.expectedAfter)) {
                throw new Error(`Read-back ${liveItem.token} не совпал с ожидаемым значением: expected=${JSON.stringify(selected.expectedAfter)} actual=${JSON.stringify(observedAfter)}.`);
              }
              evidence.status = 'PASS';
            } catch (error) {
              evidence.status = 'FAIL';
              evidence.error = String(error?.message || error);
            } finally {
              if (mutationApplied && original) {
                try {
                  const restoreState = await freshSnapshot(); bridge = restoreState.bridge;
                  const restoreCatalog = await bridge.loadDictionaryCatalog(structure, restoreState.snapshot, { forceRefresh: true, transient: true });
                  const restorePackage = await workbookFromSnapshot(structure, restoreState.snapshot, bridge, restoreCatalog);
                  const restoreBook = restorePackage.book;
                  const restoreRow = findRowByCard(restoreBook, rowCardId);
                  const restoreItem = buildWritableFieldInventory(restoreBook, structure, restoreCatalog).find(item => item.token === inventoryItem.token);
                  if (!restoreRow || !restoreItem) throw new Error('Поле или временная строка недоступны для restore.');
                  restoreRow.values[restoreItem.index] = original.visible;
                  const restoreHiddenIndex = companionIndex(restoreBook, restoreItem.token);
                  if (restoreHiddenIndex >= 0) restoreRow.values[restoreHiddenIndex] = original.hidden;
                  let restorePlan = E.buildPlan(restoreBook, structure, restoreState.snapshot, bridge.matrixInfo());
                  restorePlan = applySafety(restorePlan, bridge);
                  const restoreExecutable = (restorePlan.actions || []).filter(action => action.type !== 'noop');
                  const beforeRestoreRow = restoreState.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
                  if (!sameArray(canonicalFieldValues(beforeRestoreRow?.flat?.[restoreItem.token] || []), originalSemantic)) {
                    if (restoreExecutable.length !== 1 || restoreExecutable[0].type !== 'update' || canon(restoreExecutable[0].currentRow?.rowCardId) !== canon(rowCardId) || restorePlan.counts?.skip || restorePlan.safety?.blocked) {
                      throw new Error(`restore не построил единственный безопасный UPDATE для ${restoreItem.token}.`);
                    }
                    await applySingle(restorePlan, `write-every-field ${restoreItem.token}: restore`);
                  }
                  const restored = await freshSnapshot(); bridge = restored.bridge;
                  const restoredRow = restored.snapshot.rows.find(row => canon(row.rowCardId) === canon(rowCardId));
                  const restoredSemantic = canonicalFieldValues(restoredRow?.flat?.[restoreItem.token] || []);
                  if (!sameArray(restoredSemantic, originalSemantic)) throw new Error(`restore read-back ${restoreItem.token} не совпал с исходным значением.`);
                  evidence.restoreResult = 'verified';
                } catch (restoreError) {
                  cleanupUnsafe = true;
                  evidence.restoreResult = `FAILED: ${String(restoreError?.message || restoreError)}`;
                  evidence.status = 'FAIL';
                  fatalRestore = restoreError;
                }
              }
            }
            if (fatalRestore) break;
          }

          const passCount = audit.evidence.filter(item => item.status === 'PASS').length;
          const failCount = audit.evidence.filter(item => item.status === 'FAIL').length;
          const notRunCount = audit.evidence.filter(item => item.status === 'NOT_RUN').length;
          if (fatalRestore) throw new Error(`Не удалось доказать restore одного из полей: ${String(fatalRestore?.message || fatalRestore)}.`);
          if (failCount) throw new Error(`Каждое поле проверено не полностью: PASS ${passCount}, FAIL ${failCount}, NOT_RUN ${notRunCount}.`);
          if (!passCount) return { status: 'NOT_RUN', detail: `Ни для одного из ${inventory.length} полей не найдено безопасной альтернативы.`, data: audit };
          return { status: 'PASS', detail: `Изолированно проверено ${passCount} полей; NOT_RUN ${notRunCount}. Для каждой записи выполнен read-back и restore.`, data: audit };
        } finally {
          const cleaned = await cleanupCreatedRow(rowCardId, 'write-every-field');
          if (!cleaned) cleanupUnsafe = true;
          const final = await freshSnapshot();
          if (!sameArray(snapshotSignature(final.snapshot), baselineSignature)) {
            cleanupUnsafe = true;
            throw new Error('После every-field UAT исходная матрица отличается от baseline.');
          }
        }
      });
`;
replaceOne(clearScenarioAnchor, `${everyFieldScenario}${clearScenarioAnchor}`, 'Task7 live every-field mutation scenario');

replaceOne(
  `  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, runFullUat, installUi };`,
  `  window[INSTALL_KEY] = { version: VERSION, seededRandom, hashSeed, snapshotSignature, cloneWorkbook, buildWritableFieldInventory, fieldCandidateValues, runFullUat, installUi };`,
  'Task7 test/export surface',
);

fs.writeFileSync(userscriptPath, source);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/full-uat-runner-contract.mjs';
assert.ok(pkg.scripts?.test?.includes(marker), 'package test marker missing');
if (!pkg.scripts.test.includes('recovery-task7-field-uat.mjs')) {
  pkg.scripts.test = pkg.scripts.test.replace(marker, `${marker} && node tests/recovery-task7-field-uat.mjs`);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task7 patch applied: every writable field inventory + deterministic candidates + isolated live mutation/read-back/restore evidence');
