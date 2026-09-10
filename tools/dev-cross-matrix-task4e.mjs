import fs from 'node:fs';

const userPath = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(userPath, 'utf8');

const applyMarker = `  async function applyPlan(plan) {`;
if (!code.includes(applyMarker)) throw new Error('Task 4e apply marker not found');
if (!code.includes('function finalizeCrossMatrixTransferVerification(')) {
  const helper = `  function finalizeCrossMatrixTransferVerification(result) {\n    const transfer = result?.crossMatrixTransfer;\n    if (!transfer) return result;\n    const terminal = new Set(['verified', 'unsafe', 'rolled-back', 'preflight-blocked']);\n    if (terminal.has(transfer.status)) return result;\n    if (transfer.status !== 'awaiting-verification') return result;\n\n    const reconciliation = result?.reconciliation || null;\n    const expected = Math.max(0, Number(transfer.acceptedMutationCount || 0));\n    const verified = Math.max(0, Number(reconciliation?.verifiedCount || 0));\n    const divergent = Math.max(0, Number(reconciliation?.divergentCount || 0));\n    const missing = Math.max(0, Number(reconciliation?.missingCount || 0));\n    const unknown = Math.max(0, Number(reconciliation?.unknownCount || 0));\n    transfer.verification = {\n      status: reconciliation?.status || 'incomplete',\n      expectedCount: expected,\n      verifiedCount: verified,\n      divergentCount: divergent,\n      missingCount: missing,\n      unknownCount: unknown,\n    };\n    if (reconciliation?.status === 'verified' && verified === expected && divergent === 0 && missing === 0 && unknown === 0) {\n      transfer.status = 'verified';\n      result.verificationIncomplete = false;\n    } else if (reconciliation?.status === 'divergent' || divergent > 0 || missing > 0) {\n      transfer.status = 'unsafe';\n      result.verificationIncomplete = true;\n    } else {\n      transfer.status = 'incomplete';\n      result.verificationIncomplete = true;\n    }\n    return result;\n  }\n\n`;
  code = code.replace(applyMarker, `${helper}${applyMarker}`);
}

const matrixSaveNeedle = `    result.matrixSave = await persistMainMatrixAfterApply(bridge, result);`;
const matrixSaveReplacement = `    if (isCrossMatrixTransfer\n      && !crossMatrixPreflightBlocked\n      && !crossMatrixAddFailed\n      && !crossMatrixDeleteFailed) {\n      const acceptedMutationCount = result.rows.filter(row => row?.status === 'ok').length;\n      result.crossMatrixTransfer = {\n        status: 'awaiting-verification',\n        phase: 'verification',\n        targetDeletesStarted: readyDeletes.length > 0,\n        successfulTargetDeleteCount: crossMatrixTargetDeletesSucceeded,\n        acceptedMutationCount,\n        receiptCount: receipts.length,\n      };\n      result.verificationIncomplete = true;\n    }\n\n    result.matrixSave = await persistMainMatrixAfterApply(bridge, result);`;
if (!code.includes(matrixSaveNeedle)) throw new Error('Task 4e matrix save marker not found');
code = code.replace(matrixSaveNeedle, matrixSaveReplacement);

const reconcileNeedle = `          APP.lastReconciliation = result.reconciliation;\n          finalizeApplyResult(result);`;
const reconcileReplacement = `          APP.lastReconciliation = result.reconciliation;\n          finalizeCrossMatrixTransferVerification(result);\n          finalizeApplyResult(result);`;
if (!code.includes(reconcileNeedle)) throw new Error('Task 4e reconciliation integration marker not found');
code = code.replace(reconcileNeedle, reconcileReplacement);

const exportNeedle = `    preflightPlan, applyPreflightPreview, verifyCrossMatrixRollback, applyPlan, requestApplyAbort, hydrateMissingIdsForAction,`;
const exportReplacement = `    preflightPlan, applyPreflightPreview, verifyCrossMatrixRollback, finalizeCrossMatrixTransferVerification, applyPlan, requestApplyAbort, hydrateMissingIdsForAction,`;
if (!code.includes(exportNeedle)) throw new Error('Task 4e export marker not found');
code = code.replace(exportNeedle, exportReplacement);

fs.writeFileSync(userPath, code);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/cross-matrix-delete-phase-failure.mjs';
if (!pkg.scripts.test.includes('node tests/cross-matrix-success-verification.mjs')) {
  if (!pkg.scripts.test.includes(marker)) throw new Error('Task 4e package marker not found');
  pkg.scripts.test = pkg.scripts.test.replace(marker, `${marker} && node tests/cross-matrix-success-verification.mjs`);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task 4e successful transfer verification state patch applied');
