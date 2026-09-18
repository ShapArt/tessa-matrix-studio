import fs from 'node:fs';

const target = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(target, 'utf8');

if (source.includes('FULL_UAT_COPIED_IDENTITY_COLLISION_SAFE_V1')) {
  console.log('TESSA Matrix Studio v1.14.2 copied-identity collision-safe transform: already applied');
  process.exit(0);
}

const startNeedle = "      await runCheck('row-copied-identities', 'Изменённые копии строки с одинаковыми скрытыми ID', async () => {";
const endNeedle = "      await runCheck('dictionary-stale-companion', 'Изменение текста при старом скрытом ID', async () => {";
const start = source.indexOf(startNeedle);
const end = source.indexOf(endNeedle, start + 1);
if (start < 0 || end < 0 || end <= start) {
  throw new Error('Copied-identity UAT block anchors not found');
}

const replacement = `      // FULL_UAT_COPIED_IDENTITY_COLLISION_SAFE_V1
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
          throw new Error(`Не удалось построить collision-safe copied-identity сценарий за ${attempts.length} попыток. Последние планы: ${JSON.stringify(attempts.slice(-8))}`);
        }

        return {
          detail: `Excel ${selected.sourceRow.excelRow}, ${selected.column.key}: одна копия стала UPDATE, остальные три — ADD; два отсутствующих оригинала — DELETE. Кандидат предварительно проверен на отсутствие business-дублей.`,
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
`;

source = source.slice(0, start) + replacement + source.slice(end);

if (!source.includes('FULL_UAT_COPIED_IDENTITY_COLLISION_SAFE_V1')) {
  throw new Error('Copied-identity collision-safe marker missing after transform');
}
if (source.includes("const column = shuffled(columns, rng)[0], source = chooseSourceRow(base.book, rng)")) {
  throw new Error('Old single-shot copied-identity generator is still present');
}

fs.writeFileSync(target, source, 'utf8');
console.log('TESSA Matrix Studio v1.14.2 copied-identity collision-safe transform: OK');
