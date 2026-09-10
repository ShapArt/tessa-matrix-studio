import fs from 'node:fs';

const userPath = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(userPath, 'utf8');

const varsNeedle = `    const isCrossMatrixTransfer = Boolean(plan.crossMatrixReplacement?.enabled);\n    const successfulCrossMatrixAdds = [];\n    let crossMatrixAddFailed = false;\n    let blockCrossMatrixDeletes = false;`;
const varsReplacement = `    const isCrossMatrixTransfer = Boolean(plan.crossMatrixReplacement?.enabled);\n    const crossMatrixPreflightBlocked = isCrossMatrixTransfer && runtimeSkips.length > 0;\n    const successfulCrossMatrixAdds = [];\n    let crossMatrixAddFailed = false;\n    let blockCrossMatrixDeletes = crossMatrixPreflightBlocked;`;
if (!code.includes(varsNeedle)) throw new Error('Task 4b vars marker not found');
code = code.replace(varsNeedle, varsReplacement);

const resultEndNeedle = `      verificationIncomplete: false,\n      refreshError: null,\n    };\n    let cancelled = false;`;
const resultEndReplacement = `      verificationIncomplete: false,\n      refreshError: null,\n    };\n    if (crossMatrixPreflightBlocked) {\n      result.crossMatrixTransfer = {\n        status: 'preflight-blocked',\n        phase: 'preflight',\n        rejectedCount: runtimeSkips.length,\n        targetDeletesStarted: false,\n      };\n      log('Перенос остановлен на предварительной проверке. Запись и удаление строк TESSA не начинались.', 'warn');\n    }\n    let cancelled = false;`;
if (!code.includes(resultEndNeedle)) throw new Error('Task 4b result marker not found');
code = code.replace(resultEndNeedle, resultEndReplacement);

const updateLoopNeedle = `    for (const prepared of preparedUpdates.values()) {`;
const updateLoopReplacement = `    if (!crossMatrixPreflightBlocked) for (const prepared of preparedUpdates.values()) {`;
if (!code.includes(updateLoopNeedle)) throw new Error('Task 4b UPDATE loop marker not found');
code = code.replace(updateLoopNeedle, updateLoopReplacement);

const addLoopNeedle = `    if (!cancelled) for (const created of preparedAdds.values()) {`;
const addLoopReplacement = `    if (!cancelled && !crossMatrixPreflightBlocked) for (const created of preparedAdds.values()) {`;
if (!code.includes(addLoopNeedle)) throw new Error('Task 4b ADD loop marker not found');
code = code.replace(addLoopNeedle, addLoopReplacement);

fs.writeFileSync(userPath, code);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/cross-matrix-atomic-apply.mjs';
if (!pkg.scripts.test.includes('node tests/cross-matrix-preflight-gate.mjs')) {
  if (!pkg.scripts.test.includes(marker)) throw new Error('Task 4b package marker not found');
  pkg.scripts.test = pkg.scripts.test.replace(marker, `${marker} && node tests/cross-matrix-preflight-gate.mjs`);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task 4b transfer preflight all-or-nothing gate applied');
