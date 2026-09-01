from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')

probe_rows = '''  function probeControlRows(control) {
    for (const candidate of [control, control?.control, control?.model, control?.viewModel]) {
      try {
        if (candidate?.table?.rows) return Array.from(candidate.table.rows);
      } catch (_) { /* continue */ }
    }
    return [];
  }

  function inspectNativeViewCapabilitiesReadOnly(editor, typedField = null) {
    for (const [, original] of probeControlEntries(editor)) {
      const rows = probeControlRows(original);
      const hasMatrixIdentity = rows.some(row => {
        const data = row?.data || row?.selectedObject || null;
        return Boolean(
          probeDataValue(data, 'MatrixRowID', typedField)
          && probeDataValue(data, 'MatrixVersionID', typedField)
        );
      });
      if (!hasMatrixIdentity) continue;
      const candidates = [original, original?.control, original?.model, original?.viewModel].filter(Boolean);
      const target = candidates.find(item =>
        typeof item?.setPageAndRefresh === 'function'
        || typeof item?.refresh === 'function'
        || item?.viewComponent
        || item?.component
      ) || candidates[0] || null;
      const component = target?.viewComponent || target?.component || target;
      return {
        found: true,
        paging: Boolean(
          typeof target?.setPageAndRefresh === 'function'
          || Number.isFinite(Number(component?.currentPage ?? component?._currentPage))
        ),
        refresh: Boolean(
          typeof target?.refresh === 'function'
          || typeof component?.refresh === 'function'
          || typeof target?.setPageAndRefresh === 'function'
        ),
      };
    }
    return { found: false, paging: false, refresh: false };
  }
'''
probe_new = '''  function probeControlRows(control) {
    for (const candidate of [control, control?.control, control?.model, control?.viewModel]) {
      try {
        if (candidate?.table?.rows) return Array.from(candidate.table.rows);
      } catch (_) { /* continue */ }
    }
    return [];
  }

  function nativeMatrixControlCandidates(original) {
    return [original, original?.control, original?.model, original?.viewModel].filter(Boolean);
  }

  function nativeMatrixControlTarget(original) {
    const candidates = nativeMatrixControlCandidates(original);
    return candidates.find(item => typeof item?.doubleClickAction === 'function')
      || candidates.find(item =>
        typeof item?.setPageAndRefresh === 'function'
        || typeof item?.refresh === 'function'
        || typeof item?.viewComponent?.refresh === 'function'
        || typeof item?.component?.refresh === 'function'
      )
      || null;
  }

  function nativeMatrixControlStructuralScore(controlName, original) {
    const candidates = nativeMatrixControlCandidates(original);
    const hasRowsSurface = candidates.some(item => {
      try { return item?.table && item.table.rows !== null && item.table.rows !== undefined; }
      catch (_) { return false; }
    });
    const target = nativeMatrixControlTarget(original);
    if (!hasRowsSurface || !target) return 0;
    const pieces = [controlName];
    for (const item of candidates) {
      const metadata = [item?.viewMetadata, item?.metadata, item?.viewComponent?.viewMetadata, item?.viewComponent?.metadata, item?.component?.viewMetadata, item?.component?.metadata];
      pieces.push(item?.name, item?.alias, item?.caption);
      for (const meta of metadata) pieces.push(meta?.name, meta?.alias, meta?.caption);
    }
    const text = canonicalValue(pieces.filter(Boolean).join(' '));
    let score = 0;
    if (/mtxroutematrixdummyview/.test(text)) score += 320;
    if (/testmatrixview/.test(text)) score += 240;
    if (/mtxroutematrix/.test(text)) score += 180;
    if (/routematrix/.test(text)) score += 120;
    return score;
  }

  function pickNativeMatrixControl(entries, rowsOf, dataValue) {
    let identityBest = null;
    const structural = [];
    for (const [controlName, original] of entries || []) {
      const target = nativeMatrixControlTarget(original);
      if (!target) continue;
      const rows = rowsOf(original) || [];
      const validRows = rows.filter(row => {
        const data = row?.data || row?.selectedObject || null;
        return Boolean(dataValue(data, 'MatrixRowID') && dataValue(data, 'MatrixVersionID'));
      });
      if (validRows.length && (!identityBest || validRows.length > identityBest.rows.length)) {
        identityBest = { controlName: String(controlName), target, rows: validRows, structuralFallback: false };
      }
      // Structural evidence is allowed only for a genuinely empty rendered table.
      // If rows exist but hidden identities are absent, keep failing closed.
      if (!rows.length) {
        const score = nativeMatrixControlStructuralScore(controlName, original);
        if (score >= 180) structural.push({ controlName: String(controlName), target, rows: [], score, structuralFallback: true });
      }
    }
    if (identityBest) return identityBest;
    structural.sort((a, b) => b.score - a.score);
    if (!structural.length) return null;
    if (structural.length > 1 && structural[0].score === structural[1].score) return null;
    return structural[0];
  }

  function inspectNativeViewCapabilitiesReadOnly(editor, typedField = null) {
    const selected = pickNativeMatrixControl(
      probeControlEntries(editor),
      probeControlRows,
      (data, key) => probeDataValue(data, key, typedField),
    );
    if (!selected) return { found: false, paging: false, refresh: false };
    const target = selected.target;
    const component = target?.viewComponent || target?.component || target;
    return {
      found: true,
      paging: Boolean(
        typeof target?.setPageAndRefresh === 'function'
        || Number.isFinite(Number(component?.currentPage ?? component?._currentPage))
      ),
      refresh: Boolean(
        typeof target?.refresh === 'function'
        || typeof component?.refresh === 'function'
        || typeof target?.setPageAndRefresh === 'function'
      ),
    };
  }
'''
if probe_rows not in text:
    raise SystemExit('probe/native capability marker not found')
text = text.replace(probe_rows, probe_new, 1)

bridge_old = '''    findNativeMatrixControl() {
      let best = null;
      for (const [controlName, original] of this.controlEntries()) {
        const candidates = [original, original?.control, original?.model, original?.viewModel].filter(Boolean);
        const rows = this.rowsOfControl(original);
        if (!rows.length) continue;
        const target = candidates.find(item => typeof item?.doubleClickAction === 'function') || null;
        const validRows = rows.filter(row => {
          const data = row?.data || row?.selectedObject;
          return this.dataValue(data, 'MatrixRowID') && this.dataValue(data, 'MatrixVersionID');
        });
        if (target && validRows.length && (!best || validRows.length > best.rows.length)) {
          best = { controlName: String(controlName), target, rows: validRows };
        }
      }
      return best;
    }
'''
bridge_new = '''    findNativeMatrixControl() {
      return pickNativeMatrixControl(
        this.controlEntries(),
        control => this.rowsOfControl(control),
        (data, key) => this.dataValue(data, key),
      );
    }
'''
if bridge_old not in text:
    raise SystemExit('findNativeMatrixControl marker not found')
text = text.replace(bridge_old, bridge_new, 1)

snapshot_old = '''      if (links.length && (!sectionCount || links.length >= sectionCount)) {
        const pageNote = native.pagingUsed ? `, страниц: ${native.pagesVisited.length}/${native.pageCount}` : '';
        log(`Источник строк TESSA: нативное представление «${native.controlName}» (${links.length}${pageNote}).`);
      } else if (links.length && sectionCount > links.length) {
        log(`Представление вернуло ${links.length} из ${sectionCount} строк; проверяю сопоставление по MatrixVersionID без CardGet по служебным RowID.`, 'warn');
        links = await this.resolveMatrixSectionLinks(links);
      } else {
        throw new Error(
          'В нативном представлении TESSA не найдены скрытые MatrixRowID/MatrixVersionID. '
          + 'Обновите карточку TESSA (F5) и повторите операцию.'
        );
      }
'''
snapshot_new = '''      if (!links.length && sectionCount === 0) {
        // A brand-new matrix can legitimately have no MatrixRowID yet. This is safe
        // only when the authoritative card section agrees that membership is empty.
        log(`Источник строк TESSA: нативное представление «${native.controlName || 'матрица'}» (0 строк).`);
      } else if (links.length && (!sectionCount || links.length >= sectionCount)) {
        const pageNote = native.pagingUsed ? `, страниц: ${native.pagesVisited.length}/${native.pageCount}` : '';
        log(`Источник строк TESSA: нативное представление «${native.controlName}» (${links.length}${pageNote}).`);
      } else if (links.length && sectionCount > links.length) {
        log(`Представление вернуло ${links.length} из ${sectionCount} строк; проверяю сопоставление по MatrixVersionID без CardGet по служебным RowID.`, 'warn');
        links = await this.resolveMatrixSectionLinks(links);
      } else {
        throw new Error(
          'В нативном представлении TESSA не найдены скрытые MatrixRowID/MatrixVersionID. '
          + 'Обновите карточку TESSA (F5) и повторите операцию.'
        );
      }
'''
if snapshot_old not in text:
    raise SystemExit('loadSnapshot empty marker not found')
text = text.replace(snapshot_old, snapshot_new, 1)

path.write_text(text, encoding='utf-8')
print('v1.9.40 empty-matrix support fix applied')
