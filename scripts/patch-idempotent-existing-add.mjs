import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');

const replaceOnce = (needle, replacement, label) => {
  const first = source.indexOf(needle);
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(needle, first + needle.length) >= 0) throw new Error(`Ambiguous patch anchor: ${label}`);
  source = source.slice(0, first) + replacement + source.slice(first + needle.length);
};

if (source.includes('function normalizeIdempotentExistingAdds(')) {
  console.log('Idempotent existing ADD patch is already installed.');
  process.exit(0);
}

const detectAnchor = `  function detectPlanDuplicateConflicts(actions, snapshot, structure = null) {`;
const helper = `  /**
   * Makes repeated imports idempotent without weakening duplicate safety.
   *
   * A new Excel ADD that is semantically identical to exactly one unchanged current
   * TESSA row is already satisfied by server state. Treat it as a read-only NOOP and
   * attach the exact current identity. No ValidateDuplicate/Store call is skipped for
   * a real mutation because there is no mutation left to execute.
   *
   * We deliberately do NOT collapse:
   * - matches against multiple current rows (server state is ambiguous),
   * - matches against a row that another action UPDATEs/DELETEs,
   * - duplicate new ADDs when no current row already satisfies them.
   */
  function normalizeIdempotentExistingAdds(actions, snapshot, structure = null) {
    const input = [...(actions || [])];
    const touchedCurrent = new Set();
    for (const action of input) {
      if (!['update', 'delete'].includes(action?.type) || !action.currentRow) continue;
      const identity = canonicalValue(action.currentRow.versionId || action.currentRow.rowCardId);
      if (identity) touchedCurrent.add(identity);
    }

    const currentBySemanticKey = new Map();
    for (const row of snapshot?.rows || []) {
      const identity = canonicalValue(row.versionId || row.rowCardId);
      if (!identity || touchedCurrent.has(identity)) continue;
      const key = duplicateRowKey(row, null, structure);
      if (!currentBySemanticKey.has(key)) currentBySemanticKey.set(key, []);
      currentBySemanticKey.get(key).push(row);
    }

    const excelRows = [];
    const normalized = input.map(action => {
      if (action?.type !== 'add' || !action.excelRow) return action;
      const key = duplicateRowKey(null, action.excelRow, structure);
      const matches = currentBySemanticKey.get(key) || [];
      if (matches.length !== 1) return action;
      const currentRow = matches[0];
      excelRows.push(Number(action.excelRow.excelRow));
      return {
        ...action,
        type: 'noop',
        currentRow,
        changes: [],
        match: { ...(action.match || {}), matchedBy: 'existing-identical-add', lowConfidence: false },
        expectedFingerprint: currentRow.fingerprint,
        originalType: action.originalType || 'add',
        idempotentExistingAdd: true,
      };
    });

    return {
      actions: normalized,
      excelRows: [...new Set(excelRows.filter(Number.isFinite))].sort((a, b) => a - b),
    };
  }

${detectAnchor}`;
replaceOnce(detectAnchor, helper, 'insert normalizeIdempotentExistingAdds');

const plannerAnchor = `    // Дубликаты локализуются до устойчивого состояния. Это важно для каскада:\n    // пропуск одного конфликтующего UPDATE может вернуть исходную строку TESSA и тем\n    // самым обнаружить дубль у следующего ADD. Весь корректный пакет при этом живёт.\n    const localizedDuplicates = localizeDuplicateConflicts(actions, skippedRows, snapshot, structure);`;
const plannerReplacement = `    // Повторный импорт уже применённого точного ADD — не ошибка и не новая запись.\n    // Привязываем его только к единственной неизменяемой строке TESSA и превращаем\n    // в NOOP до duplicate-localization. Неоднозначные/настоящие дубли остаются fail-closed.\n    const idempotentExistingAdds = normalizeIdempotentExistingAdds(actions, snapshot, structure);\n    actions = idempotentExistingAdds.actions;\n\n    // Дубликаты локализуются до устойчивого состояния. Это важно для каскада:\n    // пропуск одного конфликтующего UPDATE может вернуть исходную строку TESSA и тем\n    // самым обнаружить дубль у следующего ADD. Весь корректный пакет при этом живёт.\n    const localizedDuplicates = localizeDuplicateConflicts(actions, skippedRows, snapshot, structure);`;
replaceOnce(plannerAnchor, plannerReplacement, 'planner idempotent normalization');

const warningsAnchor = `    const warnings = [...columnMap.warnings, ...(built.warnings || [])];`;
const warningsReplacement = `${warningsAnchor}\n    if (idempotentExistingAdds.excelRows.length) {\n      warnings.push(\`Уже существуют в TESSA и считаются без изменений: Excel \${idempotentExistingAdds.excelRows.join(', ')}. Повторная запись не выполняется.\`);\n    }`;
replaceOnce(warningsAnchor, warningsReplacement, 'planner warning');

const reviewAnchor = `    // Частичная отмена тоже может собрать дубль. Как и Planner, локализуем только\n    // конфликтующую Excel-операцию и продолжаем с остальными. Повторяем проверку до\n    // устойчивого состояния, потому что один локальный SKIP может открыть следующий.\n    const localizedDuplicates = localizeDuplicateConflicts(actions, plan.skippedRows || [], plan.snapshot, plan.structure);`;
const reviewReplacement = `    // Review может убрать часть UPDATE и тем самым сделать ADD уже удовлетворённым\n    // текущей строкой TESSA. Повторяем ту же безопасную idempotency-нормализацию.\n    actions = normalizeIdempotentExistingAdds(actions, plan.snapshot, plan.structure).actions;\n\n    // Частичная отмена тоже может собрать дубль. Как и Planner, локализуем только\n    // конфликтующую Excel-операцию и продолжаем с остальными. Повторяем проверку до\n    // устойчивого состояния, потому что один локальный SKIP может открыть следующий.\n    const localizedDuplicates = localizeDuplicateConflicts(actions, plan.skippedRows || [], plan.snapshot, plan.structure);`;
replaceOnce(reviewAnchor, reviewReplacement, 'review idempotent normalization');

fs.writeFileSync(path, source);
console.log('Installed idempotent existing ADD normalization.');
