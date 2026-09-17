import fs from 'node:fs';

const replaceOnce = (source, before, after, label) => {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  return source.replace(before, after);
};

export function applyFullUatScopeFix(input) {
  let source = String(input ?? '');
  if (source.includes('LIVE_EXCEL_FULL_UAT_SCOPE_FIX_V1')) return source;

  source = replaceOnce(
    source,
    "        const text = pickerSelectionText([item]);",
    "        // LIVE_EXCEL_FULL_UAT_SCOPE_FIX_V1\n        if (typeof E.pickerSelectionText !== 'function') throw new Error('Full UAT export pickerSelectionText недоступен.');\n        const text = E.pickerSelectionText([item]);",
    'picker UAT helper scope',
  );

  source = replaceOnce(
    source,
    "        const summary = previewAttentionSummary(syntheticPlan, createPlanReviewState());",
    "        if (typeof E.previewAttentionSummary !== 'function' || typeof E.createPlanReviewState !== 'function') throw new Error('Full UAT Preview exports недоступны.');\n        const summary = E.previewAttentionSummary(syntheticPlan, E.createPlanReviewState());",
    'preview summary UAT helper scope',
  );

  source = replaceOnce(
    source,
    "        const windowed = resolutionCenterWindow(Array.from({ length: 747 }, (_, index) => ({ excelRow: 15 + (index % 196) })), 0, 50);",
    "        if (typeof E.resolutionCenterWindow !== 'function') throw new Error('Full UAT export resolutionCenterWindow недоступен.');\n        const windowed = E.resolutionCenterWindow(Array.from({ length: 747 }, (_, index) => ({ excelRow: 15 + (index % 196) })), 0, 50);",
    'resolution paging UAT helper scope',
  );

  return source;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const file = process.argv[2];
  if (!file) throw new Error('usage: node hotfixes/v1.14.2-full-uat-scope-fix.mjs <userscript>');
  const input = fs.readFileSync(file, 'utf8');
  const output = applyFullUatScopeFix(input);
  fs.writeFileSync(file, output);
}
