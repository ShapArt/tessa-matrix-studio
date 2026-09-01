from pathlib import Path
from textwrap import dedent

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

if 'function reconciliationSemanticKey(' in text:
    raise SystemExit('Task 3 helpers already exist; refusing duplicate patch.')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one marker, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    "    capabilityCheckedCardId: null,\n    busy: false,",
    "    capabilityCheckedCardId: null,\n    lastMutationReceipts: null,\n    busy: false,",
    'APP receipt slot',
)

typed_range = '''  function typedRangeSemantic(kind, value, to = null) {
    const fromSemantic = typedScalarSemantic(kind, value);
    const toSemantic = to === null || to === undefined || normalizeSpace(to) === '' ? '' : typedScalarSemantic(kind, to);
    return toSemantic ? `${fromSemantic}..${toSemantic}` : fromSemantic;
  }
'''
helpers = r'''

  function reconciliationCriterionToken(item) {
    const id = item?.id;
    if (id !== null && id !== undefined && id !== '') return `ref:${canonicalValue(id)}`;
    const kind = normalizeSpace(item?.kind || 'String') || 'String';
    const value = item?.value ?? item?.display ?? '';
    const to = item?.to === null || item?.to === undefined ? null : item.to;
    return typedRangeSemantic(kind, value, to);
  }

  function reconciliationSemanticKey(row, structure) {
    const parts = [];
    const conditions = [...(structure?.conditions || [])]
      .sort((a, b) => canonicalValue(a?.criterionRowId || '').localeCompare(canonicalValue(b?.criterionRowId || '')));
    for (const condition of conditions) {
      const criterionId = condition?.criterionRowId;
      const tokens = (row?.values?.[criterionId] || [])
        .map(reconciliationCriterionToken)
        .sort();
      parts.push(`c:${canonicalValue(criterionId || '')}=[${tokens.join(',')}]`);
    }
    const functions = [...(structure?.functions || [])]
      .sort((a, b) => canonicalValue(a?.id || '').localeCompare(canonicalValue(b?.id || '')));
    for (const fn of functions) {
      const tokens = (row?.roles?.[fn?.id] || [])
        .map(item => `role:${canonicalValue(item?.id || '')}:${canonicalValue(item?.roleTypeId || '')}`)
        .sort();
      parts.push(`f:${canonicalValue(fn?.id || '')}=[${tokens.join(',')}]`);
    }
    return hashText(parts.join('|'));
  }

  function createMutationReceipt({ type, action, rowCardId, versionId, expectedRow, structure }) {
    const rowNumber = Number(action?.excelRow?.excelRow);
    return {
      type,
      excelRow: Number.isFinite(rowNumber) ? rowNumber : null,
      rowCardId: rowCardId ? String(rowCardId) : null,
      versionId: versionId ? String(versionId) : null,
      expectedSemanticKey: type === 'delete' ? null : reconciliationSemanticKey(expectedRow, structure),
    };
  }
'''
replace_once(typed_range, typed_range + helpers, 'typed semantic helper insertion')

replace_once(
    "    APP.abortRequested = false;\n    let preflight;",
    "    APP.abortRequested = false;\n    APP.lastMutationReceipts = null;\n    let preflight;",
    'clear stale receipts before Apply',
)

replace_once(
    "    const successfulMutationRows = new Set();\n    const result = {",
    "    const successfulMutationRows = new Set();\n    const receipts = [];\n    const result = {",
    'receipt accumulator',
)

update_old = '''        log(`Обновляю строку Excel ${action.excelRow.excelRow}`);
        await bridge.storeRowCard(prepared.card);
        successfulMutationRows.add(Number(action.excelRow.excelRow));
        result.rows.push({ type: 'update', excelRow: action.excelRow.excelRow, versionId: prepared.current.versionId, status: 'ok' });
'''
update_new = '''        log(`Обновляю строку Excel ${action.excelRow.excelRow}`);
        const expectedRow = typeof bridge.readMatrixRowFromCard === 'function'
          ? bridge.readMatrixRowFromCard(prepared.card, {
            index: prepared.current.index,
            rowCardId: prepared.current.rowCardId,
            versionId: prepared.current.versionId,
            rowName: prepared.current.rowName,
            source: 'apply-expected-update',
          }, structure)
          : null;
        await bridge.storeRowCard(prepared.card);
        if (expectedRow) receipts.push(createMutationReceipt({
          type: 'update', action,
          rowCardId: prepared.current.rowCardId,
          versionId: prepared.current.versionId,
          expectedRow, structure,
        }));
        successfulMutationRows.add(Number(action.excelRow.excelRow));
        result.rows.push({ type: 'update', excelRow: action.excelRow.excelRow, versionId: prepared.current.versionId, status: 'ok' });
'''
replace_once(update_old, update_new, 'UPDATE receipt capture')

add_old = '''        log(`Добавляю строку Excel ${action.excelRow.excelRow}`);
        // Re-check immediately before Store: another session may have created the
        // same matrix row after preflight completed.
        await bridge.validateDuplicate(created.card, created.versionId);
        const storeResponse = await bridge.storeRowCard(created.card);
        const storedCardId = String(storeResponse?.cardId || created.cardId);
        const verification = await bridge.tryGetCard(storedCardId);
        if (verification.error || !verification.card) throw new Error(`Новая карточка строки ${storedCardId} не открывается после сохранения.`);
        successfulMutationRows.add(Number(action.excelRow.excelRow));
'''
add_new = '''        log(`Добавляю строку Excel ${action.excelRow.excelRow}`);
        const expectedRow = typeof bridge.readMatrixRowFromCard === 'function'
          ? bridge.readMatrixRowFromCard(created.card, {
            index: -1,
            rowCardId: created.cardId,
            versionId: created.versionId,
            rowName: `Excel ${action.excelRow.excelRow}`,
            source: 'apply-expected-add',
          }, structure)
          : null;
        // Re-check immediately before Store: another session may have created the
        // same matrix row after preflight completed.
        await bridge.validateDuplicate(created.card, created.versionId);
        const storeResponse = await bridge.storeRowCard(created.card);
        const storedCardId = String(storeResponse?.cardId || created.cardId);
        const verification = await bridge.tryGetCard(storedCardId);
        if (verification.error || !verification.card) throw new Error(`Новая карточка строки ${storedCardId} не открывается после сохранения.`);
        if (expectedRow) receipts.push(createMutationReceipt({
          type: 'add', action,
          rowCardId: storedCardId,
          versionId: created.versionId,
          expectedRow, structure,
        }));
        successfulMutationRows.add(Number(action.excelRow.excelRow));
'''
replace_once(add_old, add_new, 'ADD receipt capture')

replace_once(
    "        await bridge.deleteMatrixRow(action.currentRow.versionId);\n        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'ok' });",
    "        await bridge.deleteMatrixRow(action.currentRow.versionId);\n        receipts.push(createMutationReceipt({\n          type: 'delete', action,\n          rowCardId: prepared.current.rowCardId,\n          versionId: prepared.current.versionId,\n          expectedRow: null, structure,\n        }));\n        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'ok' });",
    'DELETE receipt capture',
)

replace_once(
    "    finalizeApplyResult(result, { cancelled });\n    const resultLevel = result.partial ? 'warn' : 'info';",
    "    finalizeApplyResult(result, { cancelled });\n    APP.lastMutationReceipts = result.startedCount > 0 ? {\n      planId: plan.id,\n      matrixId: plan.matrixId,\n      templateId: structure.templateId,\n      receipts,\n      createdAt: nowIso(),\n    } : null;\n    const resultLevel = result.partial ? 'warn' : 'info';",
    'persist private receipt context',
)

replace_once(
    "typedScalarSemantic, typedRangeSemantic, deletionGuard",
    "typedScalarSemantic, typedRangeSemantic, reconciliationSemanticKey, createMutationReceipt, deletionGuard",
    'test exports',
)

path.write_text(text, encoding='utf-8')
