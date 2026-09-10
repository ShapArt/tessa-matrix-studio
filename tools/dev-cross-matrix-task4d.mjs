import fs from 'node:fs';

const userPath = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(userPath, 'utf8');

const varsNeedle = `    const successfulCrossMatrixAdds = [];\n    let crossMatrixAddFailed = false;\n    let blockCrossMatrixDeletes = crossMatrixPreflightBlocked;`;
const varsReplacement = `    const successfulCrossMatrixAdds = [];\n    let crossMatrixAddFailed = false;\n    let blockCrossMatrixDeletes = crossMatrixPreflightBlocked;\n    let crossMatrixDeleteFailed = false;\n    let crossMatrixTargetDeletesSucceeded = 0;`;
if (!code.includes(varsNeedle)) throw new Error('Task 4d vars marker not found');
code = code.replace(varsNeedle, varsReplacement);

const deleteSuccessNeedle = `        await bridge.deleteMatrixRow(action.currentRow.versionId);\n        receipts.push(createMutationReceipt({`;
const deleteSuccessReplacement = `        await bridge.deleteMatrixRow(action.currentRow.versionId);\n        if (isCrossMatrixTransfer) crossMatrixTargetDeletesSucceeded += 1;\n        receipts.push(createMutationReceipt({`;
if (!code.includes(deleteSuccessNeedle)) throw new Error('Task 4d delete success marker not found');
code = code.replace(deleteSuccessNeedle, deleteSuccessReplacement);

const deleteCatchNeedle = `      } catch (error) {\n        const skipped = runtimeSkip(action, error, 'store-delete');\n        result.skipped.push(skipped);\n        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'skipped', reason: skipped.reason });\n      }\n      tickStoreProgress('Удаляю строки');\n    }`;
const deleteCatchReplacement = `      } catch (error) {\n        const skipped = runtimeSkip(action, error, 'store-delete');\n        result.skipped.push(skipped);\n        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'skipped', reason: skipped.reason });\n        if (isCrossMatrixTransfer) {\n          crossMatrixDeleteFailed = true;\n          result.crossMatrixTransfer = {\n            status: 'unsafe',\n            phase: 'delete',\n            targetDeletesStarted: true,\n            successfulTargetDeleteCount: crossMatrixTargetDeletesSucceeded,\n            failedVersionId: action.currentRow.versionId,\n            reason: skipped.reason,\n          };\n          result.verificationIncomplete = true;\n          log('Перенос остановлен на удалении старых строк. Дальнейшие DELETE не выполняются; требуется проверка фактического состояния TESSA.', 'error');\n        }\n      }\n      tickStoreProgress('Удаляю строки');\n      if (crossMatrixDeleteFailed) break;\n    }`;
if (!code.includes(deleteCatchNeedle)) throw new Error('Task 4d delete catch marker not found');
code = code.replace(deleteCatchNeedle, deleteCatchReplacement);

fs.writeFileSync(userPath, code);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/cross-matrix-rollback-verification.mjs';
if (!pkg.scripts.test.includes('node tests/cross-matrix-delete-phase-failure.mjs')) {
  if (!pkg.scripts.test.includes(marker)) throw new Error('Task 4d package marker not found');
  pkg.scripts.test = pkg.scripts.test.replace(marker, `${marker} && node tests/cross-matrix-delete-phase-failure.mjs`);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task 4d target DELETE fail-closed patch applied');
