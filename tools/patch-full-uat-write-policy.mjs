import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const write = (path, text) => fs.writeFileSync(path, text, 'utf8');

function replaceOnce(text, before, after, label) {
  const count = text.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return text.replace(before, after);
}

function insertBeforeOnce(text, anchor, addition, label) {
  const count = text.split(anchor).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one anchor, got ${count}`);
  return text.replace(anchor, `${addition}${anchor}`);
}

// ---------------------------------------------------------------------------
// Canonical userscript: scoped Apply options + Full UAT accepted-write policy.
// ---------------------------------------------------------------------------
const userPath = 'tessa-matrix-studio.user.js';
let source = read(userPath);

source = replaceOnce(
  source,
  `  async function applyPlan(plan) {\n    if (!plan) throw new Error('Сначала проверьте Excel.');`,
  `  async function applyPlan(plan, options = {}) {\n    if (!plan) throw new Error('Сначала проверьте Excel.');\n    const confirmApply = typeof options.confirm === 'function' ? options.confirm : message => window.confirm(message);`,
  'Apply options',
);

source = replaceOnce(
  source,
  `      const okBatch = window.confirm(\`${'${batch.reason}'}\n\nПродолжить?\`);`,
  `      const okBatch = confirmApply(\`${'${batch.reason}'}\n\nПродолжить?\`);`,
  'Apply batch confirmer',
);
source = replaceOnce(
  source,
  `      const okLow = window.confirm('Есть строки с низкой уверенностью сопоставления. Продолжить после проверки предпросмотра?');`,
  `      const okLow = confirmApply('Есть строки с низкой уверенностью сопоставления. Продолжить после проверки предпросмотра?');`,
  'Apply low-confidence confirmer',
);
source = replaceOnce(
  source,
  `      const ok = window.confirm(\`Применить корректные изменения к TESSA?\\n\\nИзменить: ${'${c.update}'}\\nДобавить: ${'${c.add}'}\\nУдалить: ${'${c.delete}'}\\nПропустить: ${'${c.skip || 0}'}${'${plan.skippedFields?.length ? `\\nОставить без изменения отдельных полей: ${plan.skippedFields.length}` : \'\'}'}\\n\\nОшибочные строки и указанные в Preview поля не будут применены.\`);`,
  `      const ok = confirmApply(\`Применить корректные изменения к TESSA?\\n\\nИзменить: ${'${c.update}'}\\nДобавить: ${'${c.add}'}\\nУдалить: ${'${c.delete}'}\\nПропустить: ${'${c.skip || 0}'}${'${plan.skippedFields?.length ? `\\nОставить без изменения отдельных полей: ${plan.skippedFields.length}` : \'\'}'}\\n\\nОшибочные строки и указанные в Preview поля не будут применены.\`);`,
  'Apply standard confirmer',
);

source = replaceOnce(
  source,
  `    result.matrixSave = await persistMainMatrixAfterApply(bridge, result);`,
  `    if (options.deferMatrixSave === true) {\n      // FULL_UAT_DEFER_MATRIX_SAVE_V1\n      result.matrixSave = {\n        ok: false, skipped: true, reason: 'deferred-by-caller',\n        acceptedCount: (result.rows || []).filter(row => row?.status === 'ok').length,\n      };\n      result.matrixSaveDeferred = true;\n    } else {\n      result.matrixSave = await persistMainMatrixAfterApply(bridge, result);\n    }`,
  'defer main matrix Save',
);

source = insertBeforeOnce(
  source,
  `  async function runFullUat(options = {}) {`,
  `  function fullUatAcceptedWriteResult(result) {\n    // FULL_UAT_ACCEPTED_WRITE_V2\n    if (!result || result.cancelled === true || result.status === 'cancelled') return false;\n    const accepted = Number(result.appliedCount ?? result.acceptedCount ?? 0);\n    return accepted === 1\n      && Number(result.failedCount || 0) === 0\n      && Number(result.notStartedCount || 0) === 0\n      && Number(result.preflightSkippedCount || 0) === 0\n      && Number(result.storeSkippedCount || 0) === 0;\n  }\n\n`,
  'Full UAT accepted-write helper',
);

source = insertBeforeOnce(
  source,
  `    async function freshSnapshot() {`,
  `    let fullUatMainSavePending = false;\n    let fullUatBatchedSaveAttempted = false;\n    async function flushFullUatMainSave() {\n      if (!fullUatMainSavePending || fullUatBatchedSaveAttempted) return { ok: true, skipped: true, reason: 'nothing-pending' };\n      fullUatBatchedSaveAttempted = true;\n      // FULL_UAT_BATCHED_MAIN_SAVE_V1\n      try {\n        if (!bridge || typeof bridge.saveMainMatrixAfterApply !== 'function') throw new Error('Нативный Save основной карточки недоступен.');\n        const outcome = await bridge.saveMainMatrixAfterApply();\n        const ok = outcome?.ok !== false;\n        addCheck('full-uat-batched-save', 'Единое сохранение write-фазы', ok ? 'PASS' : 'FAIL', ok\n          ? 'Все временные ADD/UPDATE/DELETE объединены в один штатный Save основной карточки TESSA.'\n          : `Единый Save основной карточки не подтверждён: ${'${outcome?.error || outcome?.reason || \'unknown\'}'}.`,\n          { required: true, data: E.safePlain(outcome || {}, { maxDepth: 4, maxKeys: 100, maxArray: 50 }) });\n        if (ok) fullUatMainSavePending = false;\n        return { ...(outcome || {}), ok };\n      } catch (error) {\n        const detail = String(error?.message || error);\n        addCheck('full-uat-batched-save', 'Единое сохранение write-фазы', 'FAIL', detail, { required: true });\n        return { ok: false, skipped: false, error: detail };\n      }\n    }\n\n`,
  'Full UAT batched Save helper',
);

source = replaceOnce(
  source,
  `      const result = await E.applyPlan(plan);\n      if (!result) throw new Error(\`${'${label}'}: применение отменено.\`);\n      report.writesCompleted += 1;\n      return result;`,
  `      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat', deferMatrixSave: true });\n      if (!result) throw new Error(\`${'${label}'}: применение отменено.\`);\n      if (!fullUatAcceptedWriteResult(result)) {\n        throw new Error(\`${'${label}'}: серверная мутация не принята полностью (status=${'${result.status}'}, applied=${'${result.appliedCount}'}, skipped=${'${result.skippedCount}'}, notStarted=${'${result.notStartedCount}'}).\`);\n      }\n      fullUatMainSavePending = true;\n      report.writesCompleted += 1;\n      return result;`,
  'Full UAT internal Apply policy',
);

source = replaceOnce(
  source,
  `\n\n      const applyEvidence = report.checks.find(check => check.id === 'write-add-delete' && check.status === 'PASS') || report.checks.find(check => check.id === 'write-update-delete' && check.status === 'PASS');`,
  `\n\n      await flushFullUatMainSave();\n      const applyEvidence = report.checks.find(check => check.id === 'write-add-delete' && check.status === 'PASS') || report.checks.find(check => check.id === 'write-update-delete' && check.status === 'PASS');`,
  'flush Full UAT main Save once',
);

source = replaceOnce(
  source,
  `baselineRestoreProof, runFullUat, installUi`,
  `baselineRestoreProof, fullUatAcceptedWriteResult, runFullUat, installUi`,
  'export Full UAT accepted-write helper',
);

write(userPath, source);

// ---------------------------------------------------------------------------
// Artifact transforms: do not re-patch canonical v1.14 behavior.
// ---------------------------------------------------------------------------
const lifecyclePath = 'hotfixes/v1.13.0-user-row-lifecycle-transform.mjs';
let lifecycle = read(lifecyclePath);
const applyPatchStart = `replaceExact(\n\`  async function applyPlan(plan) {`;
const applyPatchEnd = `\n\n// Since v1.14 the live-card diagnostics fix is canonical source.`;
const lifecycleStart = lifecycle.indexOf(applyPatchStart);
const lifecycleEnd = lifecycle.indexOf(applyPatchEnd, lifecycleStart);
if (lifecycleStart < 0 || lifecycleEnd < 0) throw new Error('lifecycle Apply patch block not found');
const legacyApplyPatchBlock = lifecycle.slice(lifecycleStart, lifecycleEnd);
if (!legacyApplyPatchBlock.includes('standard confirmation policy')) throw new Error('lifecycle Apply patch block incomplete');
lifecycle = lifecycle.slice(0, lifecycleStart)
  + `if (!source.includes("const confirmApply = typeof options.confirm === 'function'")) {\n${legacyApplyPatchBlock.replace(/^/gm, '  ')}\n}`
  + lifecycle.slice(lifecycleEnd);
write(lifecyclePath, lifecycle);

const finalizerPath = 'hotfixes/v1.13.0-full-uat-live-finalize.mjs';
let finalizer = read(finalizerPath);
finalizer = replaceOnce(
  finalizer,
  `replaceExact(\n\`      const result = await E.applyPlan(plan);\`,\n\`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat' });\`,\n  'pre-approved Full UAT Apply',\n);`,
  `if (!source.includes("E.applyPlan(plan, { confirm: () => true, source: 'full-uat', deferMatrixSave: true })")) {\n  replaceExact(\n\`      const result = await E.applyPlan(plan);\`,\n\`      const result = await E.applyPlan(plan, { confirm: () => true, source: 'full-uat', deferMatrixSave: true });\`,\n    'pre-approved Full UAT Apply',\n  );\n}`,
  'idempotent Full UAT Apply finalizer',
);

const strictStart = finalizer.indexOf(`// A truthy Apply object may still represent partial/cancelled work.`);
const receiptStart = finalizer.indexOf(`// Task9 introduced a cleanup-obligation ledger`, strictStart);
if (strictStart < 0 || receiptStart < 0) throw new Error('strict Full UAT result block not found');
finalizer = finalizer.slice(0, strictStart)
  + `// v1.14 separates accepted server mutations from ordinary Apply verification.\n// Full UAT performs its own fresh read-back, so the accepted-write policy is canonical.\nif (!source.includes('FULL_UAT_ACCEPTED_WRITE_V2')) {\n  throw new Error('Canonical Full UAT accepted-write policy is missing.');\n}\n\n`
  + finalizer.slice(receiptStart);
finalizer = finalizer.replace(
  `"E.applyPlan(plan, { confirm: () => true, source: 'full-uat' })",`,
  `"E.applyPlan(plan, { confirm: () => true, source: 'full-uat', deferMatrixSave: true })",`,
);
finalizer = finalizer.replace(`  'FULL_UAT_STRICT_APPLY_RESULT_V1',`, `  'FULL_UAT_ACCEPTED_WRITE_V2',\n  'FULL_UAT_BATCHED_MAIN_SAVE_V1',`);
if (finalizer.includes('FULL_UAT_STRICT_APPLY_RESULT_V1')) throw new Error('obsolete strict Apply marker survived finalizer patch');
write(finalizerPath, finalizer);

// ---------------------------------------------------------------------------
// Regression expectations for the composed installable artifact.
// ---------------------------------------------------------------------------
const livePath = 'tests/live-uat-regressions.mjs';
let live = read(livePath);
live = replaceOnce(
  live,
  `/E\\.applyPlan\\(plan, \\{ confirm: \\(\\) => true, source: 'full-uat' \\}\\)/,`,
  `/E\\.applyPlan\\(plan, \\{ confirm: \\(\\) => true, source: 'full-uat', deferMatrixSave: true \\}\\)/,`,
  'live UAT apply regex',
);
live = replaceOnce(
  live,
  `assert.match(source, /FULL_UAT_STRICT_APPLY_RESULT_V1/,\n  'Full UAT must reject partial, skipped or incomplete Apply results');`,
  `assert.match(source, /FULL_UAT_ACCEPTED_WRITE_V2/,\n  'Full UAT must separate accepted server mutations from its own authoritative fresh read-back');\nassert.match(source, /FULL_UAT_BATCHED_MAIN_SAVE_V1/,\n  'Full UAT must batch native main-card persistence into one Save');`,
  'live UAT accepted-write marker',
);
live = replaceOnce(
  live,
  `assert.ok(globalThis.__TMS_FULL_UAT_V1__?.runFullUat);`,
  `assert.ok(globalThis.__TMS_FULL_UAT_V1__?.runFullUat);\nassert.equal(globalThis.__TMS_FULL_UAT_V1__?.fullUatAcceptedWriteResult?.({\n  cancelled: false, status: 'partial', appliedCount: 1, acceptedCount: 1, failedCount: 0,\n  notStartedCount: 0, preflightSkippedCount: 0, storeSkippedCount: 0, verificationIncomplete: true,\n}), true, 'composed artifact must let Full UAT fresh-read an accepted-but-not-yet-verified mutation');`,
  'live UAT composed policy assertion',
);
write(livePath, live);

const packagePath = 'package.json';
const pkg = JSON.parse(read(packagePath));
if (!pkg.scripts?.test?.includes('node tests/full-uat-write-policy.mjs')) {
  pkg.scripts.test = pkg.scripts.test.replace(
    'node tests/full-uat-runner-contract.mjs',
    'node tests/full-uat-runner-contract.mjs && node tests/full-uat-write-policy.mjs',
  );
}
write(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Full UAT accepted-write + auto-confirm + single-save patch applied.');
