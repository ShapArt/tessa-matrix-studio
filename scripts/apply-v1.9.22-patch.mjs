import fs from 'node:fs';

const userPath = 'tessa-matrix-studio.user.js';
const packagePath = 'package.json';
let source = fs.readFileSync(userPath, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: source anchor not found`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}: source anchor is not unique`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce('metadata version', '// @version      1.9.21', '// @version      1.9.22');
replaceOnce('APP version', "    version: '1.9.21',", "    version: '1.9.22',");

replaceOnce(
  'matrixInfo localization',
  `      const fields = {};
      for (const name of names) fields[name] = this.fieldFromSection(section, name);
      return { matrixId: String(this.mainCard.id), ...fields };`,
  `      const fields = {};
      for (const name of names) fields[name] = this.fieldFromSection(section, name);
      // StateName в TESSA может приходить как $Mtx_Enums_* localization key.
      // Локализуем его в bridge один раз, чтобы UI, Excel и safety-guard видели одно состояние.
      if (fields.StateName) fields.StateName = this.localizeValue(fields.StateName);
      return { matrixId: String(this.mainCard.id), ...fields };`,
);

replaceOnce(
  'semantic current-row helper insertion',
  `  // ---------------------------------------------------------------------------
  // 9. PLANNER: EXCEL -> ПЛАН ИЗМЕНЕНИЙ`,
  `  /**
   * Семантический fingerprint текущей строки: ссылочные поля и исполнители
   * сравниваются по стабильным ID, а типизированные значения — по нормализованному
   * значению. Raw fingerprint остаётся отдельным строгим барьером для DELETE.
   */
  function currentRowCompareFingerprint(currentRow, structure) {
    const compare = {};
    for (const condition of structure?.conditions || []) {
      const key = definitionKey('criterion', condition.criterionRowId);
      compare[key] = currentCompareValues(currentRow, {
        ...condition,
        kind: 'criterion',
        id: condition.criterionRowId,
      });
    }
    for (const fn of structure?.functions || []) {
      const key = definitionKey('function', fn.id);
      compare[key] = currentCompareValues(currentRow, { ...fn, kind: 'function', id: fn.id });
    }
    return fingerprintFlat(compare);
  }

  function rawFingerprintChangedSinceExport(excelRow, currentRow) {
    const exported = canonicalValue(excelRow?.system?.baseFingerprint || '');
    const fresh = canonicalValue(currentRow?.fingerprint || fingerprintFlat(currentRow?.flat || {}));
    return Boolean(currentRow && exported && fresh && exported !== fresh);
  }

  function exportedRowSemanticallyStale(excelRow, currentRow, structure) {
    if (!rawFingerprintChangedSinceExport(excelRow, currentRow)) return false;
    const exportedSemantic = canonicalValue(excelRow?.compareFingerprint || '');
    const freshSemantic = canonicalValue(currentRowCompareFingerprint(currentRow, structure));
    // Fail closed when semantic evidence is unavailable. We relax stale protection only
    // when stable IDs / typed values prove that the raw drift is display-only.
    return !exportedSemantic || !freshSemantic || exportedSemantic !== freshSemantic;
  }

  // ---------------------------------------------------------------------------
  // 9. PLANNER: EXCEL -> ПЛАН ИЗМЕНЕНИЙ`,
);

replaceOnce(
  'matrix state helpers',
  `  function matrixStateCaption(matrixInfo) {
    const raw = normalizeSpace(matrixInfo?.StateName || matrixInfo?.StateID || 'неизвестно');
    const state = canonicalHeader(raw);
    if (state.includes('draft') || state.includes('чернов')) return 'Черновик';
    if (state.includes('active') || state.includes('актив')) return 'Активная';
    if (state.includes('obsolete') || state.includes('outdated') || state.includes('устар')) return 'Устаревшая';
    if (state.includes('approval') || state.includes('coordination') || state.includes('соглас')) return 'Согласование';
    return raw.startsWith('$Mtx_Enums_') ? 'Неизвестное состояние' : raw;
  }

  function isWritableMatrixDraft(matrixInfo) {
    const state = canonicalHeader(matrixInfo?.StateName || '');
    if (!state) return false;
    return state.includes('draft') || state.includes('чернов');
  }

  function assertWritableMatrixDraft(bridge) {
    const matrixInfo = bridge.matrixInfo();
    if (!isWritableMatrixDraft(matrixInfo)) {
      throw new Error(\`Открыта матрица в состоянии «\${matrixStateCaption(matrixInfo)}». Изменения разрешены только в черновике. Создайте или откройте актуальный черновик матрицы и повторите сравнение.\`);
    }
    return matrixInfo;
  }`,
  `  function resolvedMatrixState(matrixInfo, localize = null) {
    const source = normalizeSpace(matrixInfo?.StateName || matrixInfo?.StateID || 'неизвестно');
    if (!source.startsWith('$') || typeof localize !== 'function') return source;
    try {
      return normalizeSpace(localize(source)) || source;
    } catch (_) {
      return source;
    }
  }

  function matrixStateCaption(matrixInfo, localize = null) {
    const raw = resolvedMatrixState(matrixInfo, localize);
    const state = canonicalHeader(raw);
    if (state.includes('draft') || state.includes('чернов')) return 'Черновик';
    if (state.includes('active') || state.includes('актив')) return 'Активная';
    if (state.includes('obsolete') || state.includes('outdated') || state.includes('устар')) return 'Устаревшая';
    if (state.includes('approval') || state.includes('coordination') || state.includes('соглас')) return 'Согласование';
    return raw.startsWith('$Mtx_Enums_') ? 'Неизвестное состояние' : raw;
  }

  function isWritableMatrixDraft(matrixInfo, localize = null) {
    const state = canonicalHeader(resolvedMatrixState(matrixInfo, localize));
    if (!state) return false;
    return state.includes('draft') || state.includes('чернов');
  }

  function assertWritableMatrixDraft(bridge) {
    const matrixInfo = bridge.matrixInfo();
    const localize = typeof bridge?.localizeValue === 'function' ? bridge.localizeValue.bind(bridge) : null;
    if (!isWritableMatrixDraft(matrixInfo, localize)) {
      throw new Error(\`Открыта матрица в состоянии «\${matrixStateCaption(matrixInfo, localize)}». Изменения разрешены только в черновике. Создайте или откройте актуальный черновик матрицы и повторите сравнение.\`);
    }
    return matrixInfo;
  }`,
);

replaceOnce(
  'evaluate safety localizer',
  `  function evaluatePlanSafety(plan, bridge) {
    const matrixInfo = bridge.matrixInfo();
    const totalHeaders = plan.columnMap.dataHeaderCount;`,
  `  function evaluatePlanSafety(plan, bridge) {
    const matrixInfo = bridge.matrixInfo();
    const stateLocalizer = typeof bridge?.localizeValue === 'function' ? bridge.localizeValue.bind(bridge) : null;
    const totalHeaders = plan.columnMap.dataHeaderCount;`,
);
replaceOnce(
  'evaluate safety state usage',
  `    if (!isWritableMatrixDraft(matrixInfo)) {
      blockedReasons.push(\`Открыта матрица в состоянии «\${matrixStateCaption(matrixInfo)}». Изменения возможны только в черновике.\`);`,
  `    if (!isWritableMatrixDraft(matrixInfo, stateLocalizer)) {
      blockedReasons.push(\`Открыта матрица в состоянии «\${matrixStateCaption(matrixInfo, stateLocalizer)}». Изменения возможны только в черновике.\`);`,
);

replaceOnce(
  'replace source stale check',
  `        const sourceCurrentRow = findCurrent(excelRow);
        if (sourceCurrentRow && excelRow.system.baseFingerprint && sourceCurrentRow.fingerprint
          && canonicalValue(excelRow.system.baseFingerprint) !== canonicalValue(sourceCurrentRow.fingerprint)) {
          if (identityKey) usedCurrent.add(identityKey);
          issues.push(\`Строка Excel \${excelRow.excelRow}: исходная строка, из которой сделана замена, изменилась в TESSA после выгрузки. Скачайте свежий файл. Целевая строка TESSA не изменялась.\`);
          continue;
        }`,
  `        const sourceCurrentRow = findCurrent(excelRow);
        const sourceBaselineExcelRow = primaryExcelRow || excelRow;
        if (sourceCurrentRow && exportedRowSemanticallyStale(sourceBaselineExcelRow, sourceCurrentRow, structure)) {
          if (identityKey) usedCurrent.add(identityKey);
          issues.push(\`Строка Excel \${excelRow.excelRow}: исходная строка, из которой сделана замена, изменилась в TESSA после выгрузки. Скачайте свежий файл. Целевая строка TESSA не изменялась.\`);
          continue;
        }`,
);
replaceOnce(
  'replace source match freshness',
  `          match: { matchedBy: overwriteMatchedBy.get(excelRow) || 'position-overwrite', lowConfidence: false, sourceIdentity },`,
  `          match: {
            matchedBy: overwriteMatchedBy.get(excelRow) || 'position-overwrite',
            lowConfidence: false,
            sourceIdentity,
            sourceVersionId: excelRow.system.versionId || '',
            sourceRowCardId: excelRow.system.rowCardId || '',
            // После Preview следим уже от свежего raw fingerprint, а не от старой выгрузки.
            sourceFingerprint: sourceCurrentRow?.fingerprint || excelRow.system.baseFingerprint || '',
          },`,
);

replaceOnce(
  'copied add source stale check',
  `      if (currentRow && copiedFromExisting && action === 'keep') {
        if (excelRow.system.baseFingerprint && currentRow.fingerprint && canonicalValue(excelRow.system.baseFingerprint) !== canonicalValue(currentRow.fingerprint)) {
          issues.push(\`Строка Excel \${excelRow.excelRow}: исходная строка TESSA изменилась после выгрузки Excel. Скопированная строка пропущена, чтобы не создавать её из устаревших данных.\`);
          continue;
        }`,
  `      if (currentRow && copiedFromExisting && action === 'keep') {
        const sourceBaselineExcelRow = primaryExcelRow || excelRow;
        if (exportedRowSemanticallyStale(sourceBaselineExcelRow, currentRow, structure)) {
          issues.push(\`Строка Excel \${excelRow.excelRow}: исходная строка TESSA изменилась после выгрузки Excel. Скопированная строка пропущена, чтобы не создавать её из устаревших данных.\`);
          continue;
        }`,
);
replaceOnce(
  'copied add source fingerprint refresh',
  `            sourceFingerprint: excelRow.system.baseFingerprint || currentRow.fingerprint || '',`,
  `            sourceFingerprint: currentRow.fingerprint || excelRow.system.baseFingerprint || '',`,
);

replaceOnce(
  'ordinary row stale check',
  `      if (currentRow && excelRow.system.baseFingerprint && currentRow.fingerprint && canonicalValue(excelRow.system.baseFingerprint) !== canonicalValue(currentRow.fingerprint)) {
        if (identityKey) usedCurrent.add(identityKey);
        issues.push(\`Строка Excel \${excelRow.excelRow}: строка TESSA изменилась после выгрузки Excel. Скачайте свежий файл, чтобы не затереть чужие изменения.\`);
        continue;
      }`,
  `      if (currentRow && rawFingerprintChangedSinceExport(excelRow, currentRow)) {
        // DELETE остаётся строго raw-stale: удаление нельзя разрешать только по semantic ID.
        // Для обычной неизменённой строки допускаем лишь доказанный display-only drift.
        const stale = action === 'delete' || exportedRowSemanticallyStale(excelRow, currentRow, structure);
        if (stale) {
          if (identityKey) usedCurrent.add(identityKey);
          issues.push(\`Строка Excel \${excelRow.excelRow}: строка TESSA изменилась после выгрузки Excel. Скачайте свежий файл, чтобы не затереть чужие изменения.\`);
          continue;
        }
      }`,
);

replaceOnce(
  'replace preflight source fingerprint',
  `          const sourceExpectedFingerprint = canonicalValue(action.excelRow?.system?.baseFingerprint || '');`,
  `          const sourceExpectedFingerprint = canonicalValue(action.match?.sourceFingerprint || action.excelRow?.system?.baseFingerprint || '');`,
);

fs.writeFileSync(userPath, source);

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
if (pkg.version !== '1.9.21') throw new Error(`package version anchor mismatch: ${pkg.version}`);
pkg.version = '1.9.22';
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

// The patch workflow is deliberately ephemeral. The resulting production branch contains
// only runtime/test/version changes, not a self-modifying CI helper.
for (const path of ['scripts/apply-v1.9.22-patch.mjs', '.github/workflows/apply-v1.9.22-patch.yml']) {
  if (fs.existsSync(path)) fs.unlinkSync(path);
}

console.log('Applied v1.9.22 runtime patch and removed temporary patch helper.');
