import fs from 'node:fs';

const userPath = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(userPath, 'utf8');

const preflightNeedle = `    const { bridge, structure, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips } = preflight;\n    const totalToStore = preparedUpdates.size + preparedAdds.size + readyDeletes.length;`;
const preflightReplacement = `    const { bridge, structure, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips } = preflight;\n    const isCrossMatrixTransfer = Boolean(plan.crossMatrixReplacement?.enabled);\n    const successfulCrossMatrixAdds = [];\n    let crossMatrixAddFailed = false;\n    let blockCrossMatrixDeletes = false;\n    const totalToStore = preparedUpdates.size + preparedAdds.size + readyDeletes.length;`;
if (!code.includes(preflightNeedle)) throw new Error('Task 4 preflight marker not found');
code = code.replace(preflightNeedle, preflightReplacement);

const addSuccessNeedle = `        successfulMutationRows.add(Number(action.excelRow.excelRow));\n        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, rowCardId: storedCardId, versionId: created.versionId, newMethod: created.newMethod, verifiedByCardGet: true, status: 'ok' });`;
const addSuccessReplacement = `        successfulMutationRows.add(Number(action.excelRow.excelRow));\n        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, rowCardId: storedCardId, versionId: created.versionId, newMethod: created.newMethod, verifiedByCardGet: true, status: 'ok' });\n        if (isCrossMatrixTransfer) {\n          successfulCrossMatrixAdds.push({\n            action,\n            rowCardId: storedCardId,\n            versionId: created.versionId,\n          });\n        }`;
if (!code.includes(addSuccessNeedle)) throw new Error('Task 4 ADD success marker not found');
code = code.replace(addSuccessNeedle, addSuccessReplacement);

const addCatchNeedle = `      } catch (error) {\n        const skipped = runtimeSkip(action, error, 'store-add');\n        result.skipped.push(skipped);\n        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, status: 'skipped', reason: skipped.reason });\n      }\n      tickStoreProgress('Добавляю строки');\n    }\n\n    if (!cancelled) for (const prepared of readyDeletes) {`;
const addCatchReplacement = `      } catch (error) {\n        const skipped = runtimeSkip(action, error, 'store-add');\n        result.skipped.push(skipped);\n        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, status: 'skipped', reason: skipped.reason });\n        if (isCrossMatrixTransfer) crossMatrixAddFailed = true;\n      }\n      tickStoreProgress('Добавляю строки');\n      if (crossMatrixAddFailed) break;\n    }\n\n    if (isCrossMatrixTransfer && crossMatrixAddFailed) {\n      blockCrossMatrixDeletes = true;\n      const cleanupRows = [];\n      for (const added of [...successfulCrossMatrixAdds].reverse()) {\n        try {\n          await bridge.deleteMatrixRow(added.versionId);\n          const appliedRow = result.rows.find(row => row.type === 'add'\n            && canonicalValue(row.versionId || '') === canonicalValue(added.versionId));\n          if (appliedRow) appliedRow.status = 'rolled-back';\n          successfulMutationRows.delete(Number(added.action?.excelRow?.excelRow));\n          cleanupRows.push({\n            excelRow: added.action?.excelRow?.excelRow ?? null,\n            rowCardId: added.rowCardId,\n            versionId: added.versionId,\n            status: 'deleted',\n          });\n        } catch (error) {\n          cleanupRows.push({\n            excelRow: added.action?.excelRow?.excelRow ?? null,\n            rowCardId: added.rowCardId,\n            versionId: added.versionId,\n            status: 'failed',\n            reason: friendlyErrorMessage(error),\n          });\n        }\n      }\n\n      let cleanupSave = { ok: true, skipped: true, reason: 'no-created-rows' };\n      if (successfulCrossMatrixAdds.length) {\n        if (typeof bridge.saveMainMatrixAfterApply !== 'function') {\n          cleanupSave = { ok: false, skipped: false, reason: 'matrix-save-unavailable' };\n        } else {\n          try {\n            const saved = await bridge.saveMainMatrixAfterApply();\n            cleanupSave = { ...(saved || {}), ok: saved?.ok !== false, skipped: false };\n          } catch (error) {\n            cleanupSave = { ok: false, skipped: false, reason: 'matrix-save-failed', error: friendlyErrorMessage(error) };\n          }\n        }\n      }\n      const cleanupFailed = cleanupRows.some(row => row.status !== 'deleted') || !cleanupSave.ok;\n      result.crossMatrixTransfer = {\n        status: cleanupFailed ? 'unsafe' : 'rolled-back',\n        phase: 'add',\n        cleanupRows,\n        cleanupSave,\n        targetDeletesStarted: false,\n      };\n      result.verificationIncomplete = cleanupFailed;\n      receipts.length = 0;\n      log(cleanupFailed\n        ? 'Перенос остановлен на ADD. Не все созданные строки удалось откатить; старые строки целевой матрицы не удалялись.'\n        : 'Перенос остановлен на ADD. Созданные строки откатились; старые строки целевой матрицы не удалялись.',\n        cleanupFailed ? 'error' : 'warn');\n    }\n\n    if (!cancelled && !blockCrossMatrixDeletes) for (const prepared of readyDeletes) {`;
if (!code.includes(addCatchNeedle)) throw new Error('Task 4 ADD catch/delete marker not found');
code = code.replace(addCatchNeedle, addCatchReplacement);

fs.writeFileSync(userPath, code);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/cross-matrix-confirmation.mjs';
if (!pkg.scripts.test.includes('node tests/cross-matrix-atomic-apply.mjs')) {
  if (!pkg.scripts.test.includes(marker)) throw new Error('Task 4 package marker not found');
  pkg.scripts.test = pkg.scripts.test.replace(marker, `${marker} && node tests/cross-matrix-atomic-apply.mjs`);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task 4 atomic cross-matrix Apply patch applied');
