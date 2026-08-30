from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')
old = '''  function deletionGuard(plan) {
    const deleteCount = Number(plan?.counts?.delete || 0);
    const snapshotCount = Number(plan?.snapshot?.rows?.length || plan?.sourceRowCount || 0);
    if (!deleteCount || !snapshotCount) return { blocked: false, deleteCount, snapshotCount, ratio: 0 };
    const ratio = deleteCount / snapshotCount;
    const blocked = deleteCount >= 10 && ratio >= 0.20;
    return {
      blocked, deleteCount, snapshotCount, ratio,
      reason: blocked ? `Excel удаляет ${deleteCount} из ${snapshotCount} строк (${Math.round(ratio * 100)}%). Эти удаления будут пропущены; разделите массовое удаление на несколько меньших пакетов.` : null,
    };
  }
'''
new = '''  function deletionGuard(plan) {
    const deleteCount = Number(plan?.counts?.delete || 0);
    const snapshotCount = Number(plan?.snapshot?.rows?.length || plan?.sourceRowCount || 0);
    if (!deleteCount || !snapshotCount) return { blocked: false, deleteCount, snapshotCount, ratio: 0, rule: null, reason: null };
    const ratio = deleteCount / snapshotCount;
    const absoluteBlocked = deleteCount >= 100;
    const ratioBlocked = deleteCount >= 10 && ratio >= 0.20;
    const rule = absoluteBlocked ? 'absolute' : ratioBlocked ? 'ratio' : null;
    const blocked = Boolean(rule);
    const reason = rule === 'absolute'
      ? `Excel удаляет ${deleteCount} строк. За один пакет нельзя удалять 100 и более строк; разделите массовое удаление на несколько контролируемых пакетов.`
      : rule === 'ratio'
        ? `Excel удаляет ${deleteCount} из ${snapshotCount} строк (${Math.round(ratio * 100)}%). Эти удаления будут пропущены; разделите массовое удаление на несколько меньших пакетов.`
        : null;
    return { blocked, deleteCount, snapshotCount, ratio, rule, reason };
  }
'''
if text.count(old) != 1:
    raise SystemExit(f'deletionGuard patch expected one match, found {text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Applied destructive DELETE guard patch')
