import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let code = fs.readFileSync(path, 'utf8');
const indent = fn => fn.toString().split('\n').map(line => `  ${line}`).join('\n');

function replacementConfirmationModel(plan) {
  if (!plan?.crossMatrixReplacement?.enabled) return null;
  const counts = countActions(plan.actions || [], plan.skippedRows || []);
  const source = plan.crossMatrixReplacement || {};
  return {
    title: 'Перенос из другой матрицы',
    sourceMatrixId: source.sourceMatrixId || null,
    targetMatrixId: source.targetMatrixId || plan.matrixId || null,
    sourceMatrixName: normalizeSpace(source.sourceMatrixName || '') || 'Исходная матрица',
    targetMatrixName: normalizeSpace(source.targetMatrixName || '') || 'Открытая матрица',
    keepCount: counts.noop || 0,
    addCount: counts.add || 0,
    deleteCount: counts.delete || 0,
    skipCount: counts.skip || 0,
    retiredColumnCount: plan.columnMap?.retiredColumns?.length || 0,
    missingCurrentColumnCount: plan.columnMap?.missingCurrentColumns?.length || 0,
    warning: 'Excel относится к другой карточке того же шаблона. После проверки Studio перенесёт желаемые строки в открытую матрицу; лишние строки открытой матрицы будут удалены. Чужие служебные ID из Excel не используются как цели записи.',
  };
}

function confirmCrossMatrixReplacement(plan, doc = document) {
  const model = replacementConfirmationModel(plan);
  if (!model) return Promise.resolve(true);
  if (!doc?.createElement || !(doc.body || doc.documentElement)) {
    return Promise.resolve(Boolean(window.confirm(`${model.title}\n\n${model.warning}\n\nДобавить ${model.addCount}\nУдалить ${model.deleteCount}\nСохранить без изменений ${model.keepCount}`)));
  }
  doc.querySelector?.('#tms-replacement-confirm')?.remove?.();
  return new Promise(resolve => {
    const overlay = doc.createElement('div');
    overlay.id = 'tms-replacement-confirm';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tms-replacement-confirm-title');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.46);display:flex;align-items:center;justify-content:center;padding:20px;box-sizing:border-box';
    const card = doc.createElement('div');
    card.style.cssText = 'width:min(560px,100%);max-height:90vh;overflow:auto;background:#fff;color:#242424;border-radius:10px;box-shadow:0 18px 60px rgba(0,0,0,.3);padding:20px;font:13px/1.45 Arial,sans-serif';
    card.innerHTML = `<h2 id="tms-replacement-confirm-title" style="margin:0 0 12px;font-size:18px">${escapeHtml(model.title)}</h2>
      <p style="margin:0 0 14px">${escapeHtml(model.warning)}</p>
      <div style="display:grid;gap:6px;padding:12px;background:#f5f6f7;border-radius:7px;margin-bottom:12px">
        <div><b>Источник:</b> ${escapeHtml(model.sourceMatrixName)}</div>
        <div><b>Цель:</b> ${escapeHtml(model.targetMatrixName)}</div>
        <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:5px"><b>Сохранить ${model.keepCount}</b><b>Добавить ${model.addCount}</b><b>Удалить ${model.deleteCount}</b>${model.skipCount ? `<b>Пропустить ${model.skipCount}</b>` : ''}</div>
      </div>
      ${(model.retiredColumnCount || model.missingCurrentColumnCount) ? `<p style="margin:0 0 14px"><b>Изменения структуры:</b> архивных колонок ${model.retiredColumnCount}; новых/отсутствующих в Excel ${model.missingCurrentColumnCount}.</p>` : ''}
      <p style="margin:0 0 16px"><b>Это замена содержимого открытой матрицы.</b> Перед удалением старых строк новый набор должен пройти проверки и сохранение.</p>
      <div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap"><button type="button" id="tms-replacement-confirm-cancel">Отмена</button><button type="button" id="tms-replacement-confirm-yes"><b>Да, выполнить перенос</b></button></div>`;
    overlay.appendChild(card);
    (doc.body || doc.documentElement).appendChild(overlay);
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      doc.removeEventListener?.('keydown', onKeyDown, true);
      overlay.remove?.();
      resolve(Boolean(value));
    };
    const onKeyDown = event => {
      if (event?.key === 'Escape') finish(false);
    };
    doc.addEventListener?.('keydown', onKeyDown, true);
    card.querySelector('#tms-replacement-confirm-cancel')?.addEventListener('click', () => finish(false));
    card.querySelector('#tms-replacement-confirm-yes')?.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', event => { if (event.target === overlay) finish(false); });
    card.querySelector('#tms-replacement-confirm-cancel')?.focus?.();
  });
}

const marker = `  /**\n   * Применяет только заранее построенный и прошедший preflight план.`;
if (!code.includes(marker)) throw new Error('applyPlan marker not found');
if (!code.includes('function replacementConfirmationModel(')) {
  code = code.replace(marker, `${indent(replacementConfirmationModel)}\n\n${indent(confirmCrossMatrixReplacement)}\n\n${marker}`);
}

const oldConfirm = `    const c = plan.counts;
    const ok = window.confirm(\`Применить корректные изменения к TESSA?\\n\\nИзменить: \${c.update}\\nДобавить: \${c.add}\\nУдалить: \${c.delete}\\nПропустить: \${c.skip || 0}\${plan.skippedFields?.length ? \`\\nОставить без изменения отдельных полей: \${plan.skippedFields.length}\` : ''}\\n\\nОшибочные строки и указанные в Preview поля не будут применены.\`);
    if (!ok) return null;
`;
const newConfirm = `    const c = plan.counts;
    if (plan.crossMatrixReplacement?.enabled) {
      const transferConfirmed = await confirmCrossMatrixReplacement(plan);
      if (!transferConfirmed) return null;
    } else {
      const ok = window.confirm(\`Применить корректные изменения к TESSA?\\n\\nИзменить: \${c.update}\\nДобавить: \${c.add}\\nУдалить: \${c.delete}\\nПропустить: \${c.skip || 0}\${plan.skippedFields?.length ? \`\\nОставить без изменения отдельных полей: \${plan.skippedFields.length}\` : ''}\\n\\nОшибочные строки и указанные в Preview поля не будут применены.\`);
      if (!ok) return null;
    }
`;
if (!code.includes(oldConfirm)) throw new Error('generic Apply confirmation block not found');
code = code.replace(oldConfirm, newConfirm);

const exportMarker = `    parseBoolean, parseRange, headerSimilarity, countActions, matrixStateCaption, operandKind, typedScalarSemantic, typedRangeSemantic, reconciliationSemanticKey, createMutationReceipt, indexSnapshotForReconciliation, reconcileMutationReceipts, runReconciliationRead, deletionGuard, evaluateApplyBatch, applyAvailability, previewPreflightPolicy, isWriterLockError, persistMainMatrixAfterApply, refreshNativeMatrixViewAfterApply, finalizeApplyResult, applyResultMessage,`;
if (!code.includes(exportMarker)) throw new Error('apply exports marker not found');
code = code.replace(exportMarker, `    parseBoolean, parseRange, headerSimilarity, countActions, matrixStateCaption, operandKind, typedScalarSemantic, typedRangeSemantic, reconciliationSemanticKey, createMutationReceipt, indexSnapshotForReconciliation, reconcileMutationReceipts, runReconciliationRead, deletionGuard, evaluateApplyBatch, applyAvailability, previewPreflightPolicy, replacementConfirmationModel, confirmCrossMatrixReplacement, isWriterLockError, persistMainMatrixAfterApply, refreshNativeMatrixViewAfterApply, finalizeApplyResult, applyResultMessage,`);
fs.writeFileSync(path, code);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const testMarker = 'node tests/cross-matrix-schema-drift.mjs';
if (!pkg.scripts.test.includes('node tests/cross-matrix-confirmation.mjs')) {
  if (!pkg.scripts.test.includes(testMarker)) throw new Error('Task 2 test marker not found in package');
  pkg.scripts.test = pkg.scripts.test.replace(testMarker, `${testMarker} && node tests/cross-matrix-confirmation.mjs`);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log('Task 3 dedicated replacement confirmation patch applied');
