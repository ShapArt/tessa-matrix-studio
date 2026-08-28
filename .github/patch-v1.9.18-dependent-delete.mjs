import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = code.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, got ${count}`);
  code = code.replace(from, to);
}

replaceOnce(
`    const runtimeSkips = [];
    const preparedUpdates = new Map();
    const preparedAdds = new Map();
    const readyDeletes = [];
`,
`    const runtimeSkips = [];
    const preparedUpdates = new Map();
    const preparedAdds = new Map();
    const readyDeletes = [];
    const failedMutationRows = new Set();

    // Некоторые финально валидные пакеты используют DELETE как зависимость: например,
    // UPDATE A -> значения B одновременно с DELETE B. До удаления B серверная проверка
    // может видеть временный дубль. Если связанная мутация не применится, такой DELETE
    // нельзя выполнять отдельно — иначе получится разрушительное частичное применение.
    const mutationRowsByDesiredFingerprint = new Map();
    for (const action of plan.actions.filter(x => (x.type === 'update' || x.type === 'add') && x.excelRow)) {
      const desiredFingerprint = canonicalValue(fingerprintFlat(action.excelRow.flat || {}));
      const excelRow = Number(action.excelRow.excelRow);
      if (!desiredFingerprint || !Number.isFinite(excelRow)) continue;
      if (!mutationRowsByDesiredFingerprint.has(desiredFingerprint)) mutationRowsByDesiredFingerprint.set(desiredFingerprint, []);
      mutationRowsByDesiredFingerprint.get(desiredFingerprint).push(excelRow);
    }
    const deleteDependencies = new Map();
    for (const action of plan.actions.filter(x => x.type === 'delete')) {
      const currentFingerprint = canonicalValue(action.currentRow?.fingerprint || '');
      deleteDependencies.set(action, [...(mutationRowsByDesiredFingerprint.get(currentFingerprint) || [])]);
    }
`,
'preflight dependency maps');

replaceOnce(
`      } catch (error) {
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-update'));
      }
    }

    setProgress(28, 'Проверяю изменяемые строки',`,
`      } catch (error) {
        const excelRow = Number(action.excelRow?.excelRow);
        if (Number.isFinite(excelRow)) failedMutationRows.add(excelRow);
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-update'));
      }
    }

    setProgress(28, 'Проверяю изменяемые строки',`,
'track failed UPDATE');

replaceOnce(
`      } catch (error) {
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-add'));
      }
    }

    setProgress(36, 'Проверяю новые строки',`,
`      } catch (error) {
        const excelRow = Number(action.excelRow?.excelRow);
        if (Number.isFinite(excelRow)) failedMutationRows.add(excelRow);
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-add'));
      }
    }

    setProgress(36, 'Проверяю новые строки',`,
'track failed ADD');

replaceOnce(
`        if (!current) throw new Error(\`Строка \${action.currentRow.versionId} исчезла после предпросмотра.\`);
        if (current.fingerprint !== action.expectedFingerprint) throw new Error(\`Строка TESSA \${action.currentRow.index + 1} изменилась после предпросмотра.\`);
        readyDeletes.push({ action, current });
`,
`        if (!current) throw new Error(\`Строка \${action.currentRow.versionId} исчезла после предпросмотра.\`);
        if (current.fingerprint !== action.expectedFingerprint) throw new Error(\`Строка TESSA \${action.currentRow.index + 1} изменилась после предпросмотра.\`);
        const dependsOnExcelRows = deleteDependencies.get(action) || [];
        const failedDependencies = dependsOnExcelRows.filter(excelRow => failedMutationRows.has(Number(excelRow)));
        if (failedDependencies.length) {
          throw new Error(\`Удаление строки TESSA \${action.currentRow.index + 1} пропущено: связанное изменение Excel \${failedDependencies.join(', ')} не прошло предварительную проверку. Выполните изменение и удаление отдельно на свежей выгрузке.\`);
        }
        readyDeletes.push({ action, current, dependsOnExcelRows });
`,
'guard DELETE after preflight mutation skip');

replaceOnce(
`    const result = {
      planId: plan.id,`,
`    const successfulMutationRows = new Set();
    const result = {
      planId: plan.id,`,
'successful mutation set');

replaceOnce(
`        await bridge.storeRowCard(prepared.card);
        result.rows.push({ type: 'update', excelRow: action.excelRow.excelRow, versionId: prepared.current.versionId, status: 'ok' });
`,
`        await bridge.storeRowCard(prepared.card);
        successfulMutationRows.add(Number(action.excelRow.excelRow));
        result.rows.push({ type: 'update', excelRow: action.excelRow.excelRow, versionId: prepared.current.versionId, status: 'ok' });
`,
'track successful UPDATE');

replaceOnce(
`        if (verification.error || !verification.card) throw new Error(\`Новая карточка строки \${storedCardId} не открывается после сохранения.\`);
        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, rowCardId: storedCardId, versionId: created.versionId, newMethod: created.newMethod, verifiedByCardGet: true, status: 'ok' });
`,
`        if (verification.error || !verification.card) throw new Error(\`Новая карточка строки \${storedCardId} не открывается после сохранения.\`);
        successfulMutationRows.add(Number(action.excelRow.excelRow));
        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, rowCardId: storedCardId, versionId: created.versionId, newMethod: created.newMethod, verifiedByCardGet: true, status: 'ok' });
`,
'track successful ADD');

replaceOnce(
`      try {
        log(\`Удаляю строку TESSA \${action.currentRow.index + 1}\`);
        await bridge.deleteMatrixRow(action.currentRow.versionId);
`,
`      try {
        const missingDependencies = (prepared.dependsOnExcelRows || [])
          .filter(excelRow => !successfulMutationRows.has(Number(excelRow)));
        if (missingDependencies.length) {
          throw new Error(\`Удаление строки TESSA \${action.currentRow.index + 1} пропущено: связанное изменение Excel \${missingDependencies.join(', ')} не было успешно применено. Исходная строка сохранена.\`);
        }
        log(\`Удаляю строку TESSA \${action.currentRow.index + 1}\`);
        await bridge.deleteMatrixRow(action.currentRow.versionId);
`,
'guard DELETE after store mutation failure');

fs.writeFileSync(path, code);
console.log('dependent DELETE safety patch applied');
