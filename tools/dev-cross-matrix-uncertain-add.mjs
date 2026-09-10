import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(path, 'utf8');

const declarationNeedle = `    const successfulCrossMatrixAdds = [];\n    let crossMatrixAddFailed = false;`;
const declarationReplacement = `    const successfulCrossMatrixAdds = [];\n    const attemptedCrossMatrixAdds = [];\n    let crossMatrixAddFailed = false;`;
if (!code.includes(declarationNeedle)) throw new Error('uncertain ADD declaration marker not found');
code = code.replace(declarationNeedle, declarationReplacement);

const loopNeedle = `      const action = created.action;\n      try {\n        log(\`Добавляю строку Excel \${action.excelRow.excelRow}\`);`;
const loopReplacement = `      const action = created.action;\n      let crossMatrixAddAttempt = null;\n      try {\n        log(\`Добавляю строку Excel \${action.excelRow.excelRow}\`);`;
if (!code.includes(loopNeedle)) throw new Error('uncertain ADD loop marker not found');
code = code.replace(loopNeedle, loopReplacement);

const preStoreNeedle = `        await bridge.validateDuplicate(created.card, created.versionId);\n        const storeResponse = await bridge.storeRowCard(created.card);\n        const storedCardId = String(storeResponse?.cardId || created.cardId);`;
const preStoreReplacement = `        await bridge.validateDuplicate(created.card, created.versionId);\n        if (isCrossMatrixTransfer) {\n          crossMatrixAddAttempt = {\n            action,\n            rowCardId: created.cardId,\n            versionId: created.versionId,\n            storeState: 'attempted',\n          };\n          attemptedCrossMatrixAdds.push(crossMatrixAddAttempt);\n        }\n        const storeResponse = await bridge.storeRowCard(created.card);\n        const storedCardId = String(storeResponse?.cardId || created.cardId);\n        if (crossMatrixAddAttempt) {\n          crossMatrixAddAttempt.rowCardId = storedCardId;\n          crossMatrixAddAttempt.storeState = 'accepted';\n        }`;
if (!code.includes(preStoreNeedle)) throw new Error('uncertain ADD pre-store marker not found');
code = code.replace(preStoreNeedle, preStoreReplacement);

const catchNeedle = `        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, status: 'skipped', reason: skipped.reason });\n        if (isCrossMatrixTransfer) crossMatrixAddFailed = true;`;
const catchReplacement = `        result.rows.push({ type: 'add', excelRow: action.excelRow.excelRow, status: 'skipped', reason: skipped.reason });\n        if (isCrossMatrixTransfer) {\n          if (crossMatrixAddAttempt && crossMatrixAddAttempt.storeState !== 'accepted') {\n            crossMatrixAddAttempt.storeState = 'uncertain';\n          }\n          crossMatrixAddFailed = true;\n        }`;
if (!code.includes(catchNeedle)) throw new Error('uncertain ADD catch marker not found');
code = code.replace(catchNeedle, catchReplacement);

const cleanupLoopNeedle = `      for (const added of [...successfulCrossMatrixAdds].reverse()) {`;
const cleanupLoopReplacement = `      for (const added of [...attemptedCrossMatrixAdds].reverse()) {`;
if (!code.includes(cleanupLoopNeedle)) throw new Error('uncertain ADD cleanup loop marker not found');
code = code.replace(cleanupLoopNeedle, cleanupLoopReplacement);

const cleanupPushSuccessNeedle = `            versionId: added.versionId,\n            status: 'deleted',\n          });`;
const cleanupPushSuccessReplacement = `            versionId: added.versionId,\n            storeState: added.storeState,\n            status: 'deleted',\n          });`;
if (!code.includes(cleanupPushSuccessNeedle)) throw new Error('uncertain ADD cleanup success marker not found');
code = code.replace(cleanupPushSuccessNeedle, cleanupPushSuccessReplacement);

const cleanupPushFailNeedle = `            versionId: added.versionId,\n            status: 'failed',\n            reason: friendlyErrorMessage(error),`;
const cleanupPushFailReplacement = `            versionId: added.versionId,\n            storeState: added.storeState,\n            status: 'failed',\n            reason: friendlyErrorMessage(error),`;
if (!code.includes(cleanupPushFailNeedle)) throw new Error('uncertain ADD cleanup failure marker not found');
code = code.replace(cleanupPushFailNeedle, cleanupPushFailReplacement);

const saveNeedle = `      if (successfulCrossMatrixAdds.length) {`;
const saveReplacement = `      if (attemptedCrossMatrixAdds.length) {`;
if (!code.includes(saveNeedle)) throw new Error('uncertain ADD cleanup save marker not found');
code = code.replace(saveNeedle, saveReplacement);

const verificationNeedle = `      const cleanupWriteFailed = cleanupRows.some(row => row.status !== 'deleted') || !cleanupSave.ok;\n      const rollbackVerification = cleanupWriteFailed\n        ? { status: 'incomplete', checkedCount: successfulCrossMatrixAdds.length, lingeringCount: null, attempts: 0, reason: 'cleanup-write-incomplete' }\n        : await verifyCrossMatrixRollback(bridge, structure, successfulCrossMatrixAdds, { attempts: 3, baseDelayMs: 100 });\n      const cleanupFailed = cleanupWriteFailed || rollbackVerification.status !== 'verified';`;
const verificationReplacement = `      // DeleteRow response is not the source of truth: a request may have committed even\n      // if the client saw an error (or vice versa). Always reconcile every VersionID whose\n      // Store was attempted against matrix membership. Never CardGet a VersionID.\n      const cleanupDeleteResponseFailed = cleanupRows.some(row => row.status !== 'deleted');\n      const rollbackVerification = await verifyCrossMatrixRollback(\n        bridge, structure, attemptedCrossMatrixAdds, { attempts: 3, baseDelayMs: 100 });\n      const cleanupFailed = !cleanupSave.ok || rollbackVerification.status !== 'verified';`;
if (!code.includes(verificationNeedle)) throw new Error('uncertain ADD verification marker not found');
code = code.replace(verificationNeedle, verificationReplacement);

const transferNeedle = `        cleanupRows,\n        cleanupSave,\n        rollbackVerification,\n        targetDeletesStarted: false,`;
const transferReplacement = `        cleanupRows,\n        cleanupSave,\n        cleanupDeleteResponseFailed,\n        attemptedAddCount: attemptedCrossMatrixAdds.length,\n        uncertainAddCount: attemptedCrossMatrixAdds.filter(row => row.storeState === 'uncertain').length,\n        rollbackVerification,\n        targetDeletesStarted: false,`;
if (!code.includes(transferNeedle)) throw new Error('uncertain ADD transfer report marker not found');
code = code.replace(transferNeedle, transferReplacement);

fs.writeFileSync(path, code);
console.log('uncertain cross-matrix ADD patch applied');
