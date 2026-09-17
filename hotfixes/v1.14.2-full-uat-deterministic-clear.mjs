import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

const startMarker = `      await runCheck('write-clear-delete', 'Сервер: ADD → очистка поля → read-back → cleanup', async () => {`;
// v1.13.0-full-uat-live-finalize moves recorder shutdown into finally. This marker is
// the stable boundary immediately after the write-clear check in the composed artifact.
const endMarker = `      // FULL_UAT_RECORDER_THROUGH_FINAL_SAVE_V2`;
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);
if (start < 0 || end < 0 || end <= start) {
  throw new Error('Full UAT deterministic CLEAR: block boundaries not found');
}

const currentBlock = source.slice(start, end);
if (!currentBlock.includes('FULL_UAT_CLEAR_NOT_RUN_CLEANUP_V1')) {
  throw new Error('Full UAT deterministic CLEAR: expected finalized NOT_RUN cleanup contract is missing');
}
if (!currentBlock.includes('candidateIndexes = directTokenIndexes(book)')) {
  throw new Error('Full UAT deterministic CLEAR: expected old data-shape heuristic is missing');
}

const replacement = `      await runCheck('write-clear-delete', 'Сервер: ADD → SET → CLEAR → read-back → cleanup', async () => {
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

`;

source = source.slice(0, start) + replacement + source.slice(end);

const replacedBlockEnd = source.indexOf(endMarker, start);
const replacedBlock = source.slice(start, replacedBlockEnd);
if (!replacedBlock.includes('FULL_UAT_CLEAR_SCENARIO_DETERMINISTIC_V2')) {
  throw new Error('Full UAT deterministic CLEAR marker missing after replacement');
}
if (replacedBlock.includes("status: 'NOT_RUN'")) {
  throw new Error('Full UAT deterministic CLEAR: scenario must PASS or FAIL, never NOT_RUN');
}
if (replacedBlock.includes('candidateIndexes = directTokenIndexes(book)')) {
  throw new Error('Full UAT deterministic CLEAR: obsolete live-data heuristic remains');
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.14.2 Full UAT deterministic SET -> CLEAR -> cleanup transform: OK');
