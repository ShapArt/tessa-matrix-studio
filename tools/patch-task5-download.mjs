import fs from 'node:fs';
import assert from 'node:assert/strict';

const userscriptPath = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(userscriptPath, 'utf8');

function replaceOne(before, after, label) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `${label}: source block not found`);
  assert.equal(source.indexOf(before, first + before.length), -1, `${label}: source block is not unique`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOne(
  "    lastPerformanceUat: null,\n    nativeRecorder: null,",
  "    lastPerformanceUat: null,\n    reviewedChangesArtifact: null,\n    reviewedChangesArtifactBuild: null,\n    reviewedChangesArtifactRequest: 0,\n    nativeRecorder: null,",
  'APP reviewed changes artifact state',
);

const oldDownload = `  async function downloadReviewedChangesXlsx() {
    if (APP.busy || !APP.plan || !APP.structure) return;
    setBusy(true);
    try {
      const reviewed = buildReviewedPlan(APP.plan, APP.review);
      const model = buildChangesReportModel(reviewed, APP.structure);
      if (!model.operations.length) throw new Error('В текущем Preview нет изменений или пропущенных строк для выгрузки.');
      setProgress(35, 'Формирую Excel изменений', \`\${model.operations.length} операций\`);
      const bytes = await performanceStage('changes-report.xlsx-build', () => createChangesReportXlsxBytes(reviewed, APP.structure), { operation: 'changes-report', rows: model.operations.length });
      const shortId = String(reviewed.matrixId || '').slice(0, 8);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const name = \`TESSA_Изменения_\${shortId || "matrix"}_\${stamp}.xlsx\`;
      downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
      setProgress(100, 'Excel изменений готов', \`\${model.operations.length} операций · файл только для просмотра\`);
    } catch (error) {
      setProgress(100, 'Не удалось выгрузить изменения', friendlyErrorMessage(error));
    } finally {
      setBusy(false);
      if (APP.plan) renderPlan(APP.plan);
    }
  }
`;

const newDownload = `  function reviewedChangesArtifactDescriptor(reviewed, structure) {
    const model = buildChangesReportModel(reviewed, structure);
    const payload = {
      matrixId: model.matrixId || '',
      templateId: model.templateId || '',
      operations: model.operations || [],
      details: model.details || [],
    };
    return {
      model,
      key: \`\${Number(model.operations?.length || 0)}:\${hashText(JSON.stringify(payload))}\`,
    };
  }

  function revokeReviewedChangesArtifact(state = APP) {
    if (!state) return;
    const artifact = state.reviewedChangesArtifact;
    state.reviewedChangesArtifact = null;
    if (!artifact?.url) return;
    try { URL.revokeObjectURL(artifact.url); } catch (_) { /* best effort */ }
  }

  function clearReviewedChangesArtifact(state = APP) {
    if (!state) return;
    state.reviewedChangesArtifactRequest = Number(state.reviewedChangesArtifactRequest || 0) + 1;
    state.reviewedChangesArtifactBuild = null;
    revokeReviewedChangesArtifact(state);
  }

  function updateReviewedChangesDownloadControl({ hasChanges = false, ready = false, error = '' } = {}) {
    const button = document.querySelector?.('#tms-download-changes');
    if (!button) return;
    button.hidden = !hasChanges;
    setControlDisabled(button, !ready);
    button.title = ready
      ? 'Скачать только операции из текущего Preview'
      : hasChanges
        ? (error || 'Формирую Excel изменений…')
        : '';
  }

  async function prepareReviewedChangesArtifact(plan = APP.plan, reviewedSnapshot = null) {
    const structure = APP.structure;
    if (!plan || !structure) {
      clearReviewedChangesArtifact(APP);
      updateReviewedChangesDownloadControl();
      return null;
    }

    const reviewed = reviewedSnapshot || buildReviewedPlan(plan, APP.review);
    const descriptor = reviewedChangesArtifactDescriptor(reviewed, structure);
    if (!descriptor.model.operations.length) {
      clearReviewedChangesArtifact(APP);
      updateReviewedChangesDownloadControl();
      return null;
    }

    if (APP.reviewedChangesArtifact?.key === descriptor.key) {
      updateReviewedChangesDownloadControl({ hasChanges: true, ready: true });
      return APP.reviewedChangesArtifact;
    }
    if (APP.reviewedChangesArtifactBuild?.key === descriptor.key) {
      updateReviewedChangesDownloadControl({ hasChanges: true, ready: false });
      return APP.reviewedChangesArtifactBuild.promise;
    }

    clearReviewedChangesArtifact(APP);
    const token = APP.reviewedChangesArtifactRequest;
    const shortId = String(reviewed.matrixId || '').slice(0, 8);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = \`TESSA_Изменения_\${shortId || 'matrix'}_\${stamp}.xlsx\`;
    updateReviewedChangesDownloadControl({ hasChanges: true, ready: false });

    const promise = (async () => {
      const bytes = await performanceStage(
        'changes-report.xlsx-build',
        () => createChangesReportXlsxBytes(reviewed, structure),
        { operation: 'changes-report', rows: descriptor.model.operations.length },
      );
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);

      // Preview/review may have changed while ZIP/XML generation yielded to the event loop.
      // Never publish an artifact that belongs to an obsolete selection.
      if (token !== APP.reviewedChangesArtifactRequest || APP.plan !== plan || APP.structure !== structure) {
        try { URL.revokeObjectURL(url); } catch (_) { /* best effort */ }
        return null;
      }
      const currentReviewed = buildReviewedPlan(APP.plan, APP.review);
      const currentDescriptor = reviewedChangesArtifactDescriptor(currentReviewed, APP.structure);
      if (currentDescriptor.key !== descriptor.key) {
        try { URL.revokeObjectURL(url); } catch (_) { /* best effort */ }
        return null;
      }

      revokeReviewedChangesArtifact(APP);
      const artifact = {
        key: descriptor.key,
        url,
        blob,
        name,
        operationCount: descriptor.model.operations.length,
        preparedAt: nowIso(),
      };
      APP.reviewedChangesArtifact = artifact;
      if (APP.reviewedChangesArtifactBuild?.token === token) APP.reviewedChangesArtifactBuild = null;
      updateReviewedChangesDownloadControl({ hasChanges: true, ready: true });
      return artifact;
    })().catch(error => {
      if (token === APP.reviewedChangesArtifactRequest) {
        APP.reviewedChangesArtifactBuild = null;
        revokeReviewedChangesArtifact(APP);
        updateReviewedChangesDownloadControl({
          hasChanges: true,
          ready: false,
          error: \`Не удалось подготовить Excel: \${friendlyErrorMessage(error)}\`,
        });
      }
      return null;
    });

    APP.reviewedChangesArtifactBuild = { key: descriptor.key, token, promise };
    return promise;
  }

  // The actual anchor activation is deliberately synchronous. The expensive XLSX build
  // happens after Preview; the click only consumes the already prepared Blob URL, so the
  // browser still sees the download as part of the user's gesture.
  function downloadReviewedChangesXlsx() {
    if (APP.busy || !APP.plan || !APP.structure) return;
    const reviewed = buildReviewedPlan(APP.plan, APP.review);
    const descriptor = reviewedChangesArtifactDescriptor(reviewed, APP.structure);
    if (!descriptor.model.operations.length) {
      setProgress(100, 'Нет изменений для выгрузки', 'Текущий Preview не содержит операций или пропущенных строк.');
      return;
    }

    const artifact = APP.reviewedChangesArtifact;
    if (!artifact?.url || artifact.key !== descriptor.key) {
      updateReviewedChangesDownloadControl({ hasChanges: true, ready: false });
      void prepareReviewedChangesArtifact(APP.plan, reviewed);
      setProgress(100, 'Excel изменений ещё готовится', 'Дождитесь, пока кнопка станет доступна, и нажмите её ещё раз.');
      return;
    }

    const host = document.body || document.documentElement;
    const anchor = document.createElement('a');
    anchor.href = artifact.url;
    anchor.download = artifact.name;
    anchor.rel = 'noopener';
    anchor.hidden = true;
    if (anchor.style) anchor.style.display = 'none';
    if (host?.appendChild) host.appendChild(anchor);
    try {
      anchor.click();
      setProgress(100, 'Excel изменений готов', \`\${artifact.operationCount} операций · файл только для просмотра\`);
    } catch (error) {
      setProgress(100, 'Не удалось скачать изменения', friendlyErrorMessage(error));
    } finally {
      try { anchor.remove?.(); } catch (_) { /* best effort */ }
    }
  }
`;

replaceOne(oldDownload, newDownload, 'activation-safe reviewed changes download');

const oldRenderButton = `    const reviewed = buildReviewedPlan(plan, APP.review);
    const changesButton = document.querySelector?.('#tms-download-changes');
    const hasReviewedChanges = (reviewed.actions || []).some(action => ['update', 'add', 'delete'].includes(action?.type)) || Boolean(reviewed.skippedRows?.length);
    if (changesButton) {
      if (hasReviewedChanges) {
        changesButton.hidden = false;
        setControlDisabled(changesButton, false);
        changesButton.title = 'Скачать только операции из текущего Preview';
      } else {
        changesButton.hidden = true;
        setControlDisabled(changesButton, true);
        changesButton.title = '';
      }
    }
`;

const newRenderButton = `    const reviewed = buildReviewedPlan(plan, APP.review);
    const changesButton = document.querySelector?.('#tms-download-changes');
    const hasReviewedChanges = (reviewed.actions || []).some(action => ['update', 'add', 'delete'].includes(action?.type)) || Boolean(reviewed.skippedRows?.length);
    if (changesButton) {
      if (hasReviewedChanges) {
        const descriptor = reviewedChangesArtifactDescriptor(reviewed, APP.structure);
        const ready = Boolean(APP.reviewedChangesArtifact?.url && APP.reviewedChangesArtifact.key === descriptor.key);
        updateReviewedChangesDownloadControl({ hasChanges: true, ready });
        if (!ready && APP.reviewedChangesArtifactBuild?.key !== descriptor.key) {
          void prepareReviewedChangesArtifact(plan, reviewed);
        }
      } else {
        clearReviewedChangesArtifact(APP);
        updateReviewedChangesDownloadControl();
      }
    }
`;
replaceOne(oldRenderButton, newRenderButton, 'Preview prepares reviewed changes artifact');

replaceOne(
  "  function resetFilePreview() {\n    clearTimeout(APP.previewSearchTimer);\n",
  "  function resetFilePreview() {\n    clearTimeout(APP.previewSearchTimer);\n    clearReviewedChangesArtifact(APP);\n",
  'resetFilePreview artifact cleanup',
);

replaceOne(
  "    if (!started && !applied) return false;\n    state.plan = null;",
  "    if (!started && !applied) return false;\n    clearReviewedChangesArtifact(state);\n    state.plan = null;",
  'post-apply artifact cleanup',
);

replaceOne(
  "    window.addEventListener('pagehide', () => {\n      restoreNativeRecorderMethods(APP.nativeRecorder);",
  "    window.addEventListener('pagehide', () => {\n      clearReviewedChangesArtifact(APP);\n      restoreNativeRecorderMethods(APP.nativeRecorder);",
  'pagehide artifact cleanup',
);

fs.writeFileSync(userscriptPath, source);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/changes-report-ui.mjs';
const addition = `${marker} && node tests/changes-report-download-dom.cjs && node tests/changes-report-download-lifecycle.cjs`;
assert.match(pkg.scripts?.test || '', /node tests\/changes-report-ui\.mjs/, 'package test marker missing');
if (!pkg.scripts.test.includes('changes-report-download-dom.cjs')) {
  pkg.scripts.test = pkg.scripts.test.replace(marker, addition);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task5 download patch applied: prepared Blob URL + synchronous activation + lifecycle cleanup');
