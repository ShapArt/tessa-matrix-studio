from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    text = text.replace(old, new, 1)

helper = '''  /**
   * Operational write ceiling. XLSX/planner may analyze larger books, but one Apply
   * is intentionally bounded so an accidental bulk edit cannot fire thousands of
   * CardStore/CardRequest calls from a single confirmation.
   */
  function evaluateApplyBatch(actions) {
    const count = (actions || []).filter(action => action?.type && action.type !== 'noop').length;
    const blocked = count > 2000;
    const warning = !blocked && count > 500;
    const reason = blocked
      ? `Пакет содержит ${count} операций. За один Apply разрешено не более 2000 операций; разделите изменения на несколько контролируемых пакетов.`
      : warning
        ? `Большой пакет: ${count} операций. Перед продолжением дополнительно проверьте Preview и подтвердите массовое применение.`
        : null;
    return { count, warning, blocked, reason };
  }

'''
replace_once(
    "  /**\n   * Применяет только заранее построенный и прошедший preflight план.",
    helper + "  /**\n   * Применяет только заранее построенный и прошедший preflight план.",
    'batch helper insertion',
)

old = '''    const executable = (plan.actions || []).filter(action => action.type !== 'noop');
    if (!executable.length) throw new Error(plan.skippedRows?.length ? 'Нет корректных изменений для применения: все изменяемые строки будут пропущены.' : 'Изменений для применения нет.');
    if (plan.actions.some(a => a.match?.lowConfidence)) {'''
new = '''    const executable = (plan.actions || []).filter(action => action.type !== 'noop');
    if (!executable.length) throw new Error(plan.skippedRows?.length ? 'Нет корректных изменений для применения: все изменяемые строки будут пропущены.' : 'Изменений для применения нет.');
    const batch = evaluateApplyBatch(executable);
    if (batch.blocked) throw new Error(batch.reason);
    if (batch.warning) {
      const okBatch = window.confirm(`${batch.reason}\n\nПродолжить?`);
      if (!okBatch) return null;
    }
    if (plan.actions.some(a => a.match?.lowConfidence)) {'''
replace_once(old, new, 'apply batch integration')

replace_once(
    "    parseBoolean, parseRange, headerSimilarity, countActions, matrixStateCaption, operandKind, typedScalarSemantic, typedRangeSemantic, deletionGuard,",
    "    parseBoolean, parseRange, headerSimilarity, countActions, matrixStateCaption, operandKind, typedScalarSemantic, typedRangeSemantic, deletionGuard, evaluateApplyBatch,",
    'batch helper export',
)

path.write_text(text, encoding='utf-8')
print('Applied operational Apply batch limits')
