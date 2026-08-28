from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')


def replace_once(before: str, after: str, label: str) -> None:
    global text
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, got {count}')
    text = text.replace(before, after, 1)


replace_once(
"""  function fingerprintFlat(flat) {
    const normalized = {};
    Object.keys(flat || {}).sort().forEach(key => {
      normalized[key] = sortedCanon(flat[key]);
    });
    return hashText(JSON.stringify(stableObject(normalized)));
  }

  function similarityFlat(a, b, keys) {""",
"""  function fingerprintFlat(flat) {
    const normalized = {};
    Object.keys(flat || {}).sort().forEach(key => {
      normalized[key] = sortedCanon(flat[key]);
    });
    return hashText(JSON.stringify(stableObject(normalized)));
  }

  // DELETE dependency matching has a different goal from stale/integrity fingerprints.
  // It must compare the semantic final row state, not the raw display representation.
  // Example: Excel Boolean «Да» and TESSA raw «true» are the same matrix value but have
  // different fingerprintFlat hashes. Keep fingerprintFlat exact for stale protection and
  // normalize typed values only for UPDATE/ADD -> DELETE dependency detection.
  function dependencySemanticKey(flat, structure) {
    const normalized = {};
    let definitionCount = 0;
    const semanticValue = (kind, value) => {
      if (['Boolean', 'Int', 'Decimal', 'Date', 'DateTime'].includes(kind)) {
        return typedScalarSemantic(kind, value);
      }
      const text = canonicalValue(value);
      return text ? `text:${text}` : '';
    };
    for (const condition of structure?.conditions || []) {
      definitionCount += 1;
      const key = definitionKey('criterion', condition.criterionRowId);
      const kind = operandKind({ kind: 'criterion', operandTypeId: condition.operandTypeId, refSection: condition.refSection });
      normalized[key] = (flat?.[key] || []).map(value => semanticValue(kind, value)).filter(Boolean).sort();
    }
    for (const fn of structure?.functions || []) {
      definitionCount += 1;
      const key = definitionKey('function', fn.id);
      normalized[key] = (flat?.[key] || []).map(value => semanticValue('Function', value)).filter(Boolean).sort();
    }
    return definitionCount ? JSON.stringify(stableObject(normalized)) : '';
  }

  function similarityFlat(a, b, keys) {""",
'insert dependencySemanticKey')

replace_once(
"""    const mutationRowsByDesiredFingerprint = new Map();
    for (const action of plan.actions.filter(x => (x.type === 'update' || x.type === 'add') && x.excelRow)) {
      const resultingFlat = action.type === 'update'
        ? { ...(action.currentRow?.flat || {}), ...(action.excelRow.flat || {}) }
        : (action.excelRow.flat || {});
      const desiredFingerprint = canonicalValue(fingerprintFlat(resultingFlat));
      const excelRow = Number(action.excelRow.excelRow);
      if (!desiredFingerprint || !Number.isFinite(excelRow)) continue;
      if (!mutationRowsByDesiredFingerprint.has(desiredFingerprint)) mutationRowsByDesiredFingerprint.set(desiredFingerprint, []);
      mutationRowsByDesiredFingerprint.get(desiredFingerprint).push(excelRow);
    }
    const deleteDependencies = new Map();
    for (const action of plan.actions.filter(x => x.type === 'delete')) {
      const currentFingerprint = canonicalValue(action.currentRow?.fingerprint || '');
      deleteDependencies.set(action, [...(mutationRowsByDesiredFingerprint.get(currentFingerprint) || [])]);
    }""",
"""    const mutationRowsByDesiredSemanticKey = new Map();
    for (const action of plan.actions.filter(x => (x.type === 'update' || x.type === 'add') && x.excelRow)) {
      const resultingFlat = action.type === 'update'
        ? { ...(action.currentRow?.flat || {}), ...(action.excelRow.flat || {}) }
        : (action.excelRow.flat || {});
      const desiredSemanticKey = dependencySemanticKey(resultingFlat, structure);
      const excelRow = Number(action.excelRow.excelRow);
      if (!desiredSemanticKey || !Number.isFinite(excelRow)) continue;
      if (!mutationRowsByDesiredSemanticKey.has(desiredSemanticKey)) mutationRowsByDesiredSemanticKey.set(desiredSemanticKey, []);
      mutationRowsByDesiredSemanticKey.get(desiredSemanticKey).push(excelRow);
    }
    const deleteDependencies = new Map();
    for (const action of plan.actions.filter(x => x.type === 'delete')) {
      const currentSemanticKey = dependencySemanticKey(action.currentRow?.flat || {}, structure);
      deleteDependencies.set(action, [...(mutationRowsByDesiredSemanticKey.get(currentSemanticKey) || [])]);
    }""",
'use typed semantic dependency keys')

path.write_text(text, encoding='utf-8')
print('v1.9.21 typed semantic dependent DELETE patch applied')
# trigger workflow after helper definition exists
