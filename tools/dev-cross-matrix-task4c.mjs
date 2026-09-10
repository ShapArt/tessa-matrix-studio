import fs from 'node:fs';

const userPath = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(userPath, 'utf8');

const applyMarker = `  async function applyPlan(plan) {`;
if (!code.includes(applyMarker)) throw new Error('Task 4c applyPlan marker not found');
if (!code.includes('async function verifyCrossMatrixRollback(')) {
  const helper = `  async function verifyCrossMatrixRollback(bridge, structure, createdRows, options = {}) {\n    const versionIds = new Set((createdRows || [])\n      .map(row => canonicalValue(row?.versionId || ''))\n      .filter(Boolean));\n    if (!versionIds.size) {\n      return { status: 'verified', checkedCount: 0, lingeringCount: 0, attempts: 0 };\n    }\n\n    const maxAttempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));\n    const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 100));\n    let last = null;\n    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {\n      if (attempt > 1 && baseDelayMs) await sleep(baseDelayMs * (2 ** (attempt - 2)));\n      try {\n        const snapshot = await bridge.loadSnapshot(structure);\n        const lingering = (snapshot?.rows || []).filter(row =>\n          versionIds.has(canonicalValue(row?.versionId || '')));\n        last = {\n          status: lingering.length ? 'divergent' : 'verified',\n          checkedCount: versionIds.size,\n          lingeringCount: lingering.length,\n          attempts: attempt,\n        };\n        if (!lingering.length) return last;\n      } catch (error) {\n        last = {\n          status: 'incomplete',\n          checkedCount: versionIds.size,\n          lingeringCount: null,\n          attempts: attempt,\n          reason: friendlyErrorMessage(error),\n          retryable: isWriterLockError(error),\n        };\n        if (!last.retryable) return last;\n      }\n    }\n    return last || { status: 'incomplete', checkedCount: versionIds.size, lingeringCount: null, attempts: 0, reason: 'rollback-readback-unavailable' };\n  }\n\n`;
  code = code.replace(applyMarker, `${helper}${applyMarker}`);
}

const cleanupNeedle = `      const cleanupFailed = cleanupRows.some(row => row.status !== 'deleted') || !cleanupSave.ok;\n      result.crossMatrixTransfer = {\n        status: cleanupFailed ? 'unsafe' : 'rolled-back',\n        phase: 'add',\n        cleanupRows,\n        cleanupSave,\n        targetDeletesStarted: false,\n      };\n      result.verificationIncomplete = cleanupFailed;`;
const cleanupReplacement = `      const cleanupWriteFailed = cleanupRows.some(row => row.status !== 'deleted') || !cleanupSave.ok;\n      const rollbackVerification = cleanupWriteFailed\n        ? { status: 'incomplete', checkedCount: successfulCrossMatrixAdds.length, lingeringCount: null, attempts: 0, reason: 'cleanup-write-incomplete' }\n        : await verifyCrossMatrixRollback(bridge, structure, successfulCrossMatrixAdds, { attempts: 3, baseDelayMs: 100 });\n      const cleanupFailed = cleanupWriteFailed || rollbackVerification.status !== 'verified';\n      result.crossMatrixTransfer = {\n        status: cleanupFailed ? 'unsafe' : 'rolled-back',\n        phase: 'add',\n        cleanupRows,\n        cleanupSave,\n        rollbackVerification,\n        targetDeletesStarted: false,\n      };\n      result.verificationIncomplete = cleanupFailed;`;
if (!code.includes(cleanupNeedle)) throw new Error('Task 4c cleanup marker not found');
code = code.replace(cleanupNeedle, cleanupReplacement);

const exportNeedle = `    preflightPlan, applyPreflightPreview, applyPlan, requestApplyAbort, hydrateMissingIdsForAction,`;
const exportReplacement = `    preflightPlan, applyPreflightPreview, verifyCrossMatrixRollback, applyPlan, requestApplyAbort, hydrateMissingIdsForAction,`;
if (!code.includes(exportNeedle)) throw new Error('Task 4c export marker not found');
code = code.replace(exportNeedle, exportReplacement);

fs.writeFileSync(userPath, code);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/cross-matrix-preflight-gate.mjs';
if (!pkg.scripts.test.includes('node tests/cross-matrix-rollback-verification.mjs')) {
  if (!pkg.scripts.test.includes(marker)) throw new Error('Task 4c package marker not found');
  pkg.scripts.test = pkg.scripts.test.replace(marker, `${marker} && node tests/cross-matrix-rollback-verification.mjs`);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task 4c rollback read-back verification applied');
