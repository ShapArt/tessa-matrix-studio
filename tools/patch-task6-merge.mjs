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

const oldMergeTail = `    return { workbook: { ...workbook, dictionaryCatalog: mergeCatalog, rows, roundtrip: { ...workbook.roundtrip, baselineRows: outputBases.filter(base => byCard.has(canonicalValue(base.rowCardId))) } }, conflicts, unresolved: conflicts.filter(c => !['mine', 'server'].includes(choices[c.id])), highlights };
  }

  function resolveMergeConflicts(conflicts) {`;

const newMergeTail = `    const unresolved = conflicts.filter(c => !['mine', 'server'].includes(choices[c.id]));
    // Until every BASE/MINE/TESSA conflict has an explicit decision, keep the original
    // workbook and its BASE metadata untouched. The prepared rows above are provisional
    // only; publishing a fresh VersionID/fingerprint early would make a later Preview
    // treat an unresolved user decision as already rebased.
    if (unresolved.length) return { workbook, conflicts, unresolved, highlights };
    return { workbook: { ...workbook, dictionaryCatalog: mergeCatalog, rows, roundtrip: { ...workbook.roundtrip, baselineRows: outputBases.filter(base => byCard.has(canonicalValue(base.rowCardId))) } }, conflicts, unresolved, highlights };
  }

  function mergeConflictsToResolutionItems(conflicts) {
    return (conflicts || []).map((conflict, index) => ({
      ...conflict,
      source: 'three-way-merge',
      issue: conflict.kind === 'local-delete' || conflict.kind === 'remote-delete'
        ? 'Строка была удалена с одной стороны и изменена с другой. Выберите итог явно.'
        : 'Это поле изменено и в Excel, и в TESSA. Выберите итоговое значение.',
      candidates: [
        { id: 'mine', display: conflict.mine, selector: \`Оставить мой Excel: \${conflict.mine}\` },
        { id: 'server', display: conflict.server, selector: \`Использовать TESSA: \${conflict.server}\` },
      ],
      resolutionIndex: index,
    }));
  }

  function resolveMergeConflictsInResolutionCenter(conflicts) {
    const host = document.querySelector('#tms-resolution-center');
    if (!host) throw new Error('Не удалось открыть Центр разрешения конфликтов.');
    const items = mergeConflictsToResolutionItems(conflicts);
    if (!items.length) return Promise.resolve({});
    APP.abortRequested = false;
    host.hidden = false;
    host.innerHTML = '<div class="tms-review-note"><b>Конфликты Excel ↔ TESSA: ' + items.length + '</b><br>Это тот же Центр разрешения, что и для неоднозначных значений. Для каждого конфликта явно выберите, что сохранить.</div>'
      + items.map((item, itemIndex) => {
        const title = item.excelRow ? 'Excel ' + item.excelRow + ' · ' + (item.column || 'поле') : (item.column || 'Конфликт строки');
        const base = item.base == null ? '' : '<div>BASE: ' + escapeHtml(item.base) + '</div>';
        return '<details class="tms-action" open><summary><b>' + escapeHtml(title) + '</b></summary><div class="tms-action-body"><div class="tms-warning">' + escapeHtml(item.issue) + '</div>' + base
          + '<div class="tms-resolution-choice"><span>' + escapeHtml(item.candidates[0].selector) + '</span><button type="button" data-resolution-choice="' + itemIndex + ':mine">Оставить мой Excel</button></div>'
          + '<div class="tms-resolution-choice"><span>' + escapeHtml(item.candidates[1].selector) + '</span><button type="button" data-resolution-choice="' + itemIndex + ':server">Использовать TESSA</button></div>'
          + '<div data-merge-resolution-status="' + itemIndex + '" class="tms-step-caption"></div></div></details>';
      }).join('')
      + '<div class="tms-row"><button type="button" id="tms-resolution-merge-cancel">Отмена</button></div>';

    return new Promise(resolve => {
      const choices = {};
      const finishIfReady = () => {
        if (Object.keys(choices).length !== items.length) return;
        host.hidden = true;
        host.innerHTML = '';
        resolve(choices);
      };
      host.querySelectorAll('button[data-resolution-choice]').forEach(button => button.addEventListener('click', () => {
        const [itemIndexText, choice] = String(button.dataset.resolutionChoice || '').split(':');
        const itemIndex = Number(itemIndexText);
        const item = items[itemIndex];
        if (!item || !['mine', 'server'].includes(choice)) return;
        choices[item.id] = choice;
        const status = host.querySelector('[data-merge-resolution-status="' + itemIndex + '"]');
        if (status) status.textContent = choice === 'mine' ? 'Выбрано: мой Excel' : 'Выбрано: TESSA';
        host.querySelectorAll('button[data-resolution-choice^="' + itemIndex + ':"]').forEach(candidateButton => {
          candidateButton.disabled = candidateButton.dataset.resolutionChoice !== itemIndex + ':' + choice;
        });
        finishIfReady();
      }));
      host.querySelector('#tms-resolution-merge-cancel')?.addEventListener('click', () => {
        APP.abortRequested = true;
        host.hidden = true;
        host.innerHTML = '';
        resolve({});
      });
      host.querySelector('button[data-resolution-choice]')?.focus();
    });
  }

  function resolveMergeConflicts(conflicts) {`;
replaceOne(oldMergeTail, newMergeTail, 'defer BASE + shared Resolution Center adapter');

replaceOne(
  '      const choices = await resolveMergeConflicts(prepared.unresolved);',
  '      const choices = await resolveMergeConflictsInResolutionCenter(prepared.unresolved);',
  'production three-way merge Resolution Center routing',
);

fs.writeFileSync(userscriptPath, source);

const packagePath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const marker = 'node tests/three-way-merge.mjs';
assert.ok(pkg.scripts?.test?.includes(marker), 'package test marker missing');
if (!pkg.scripts.test.includes('recovery-task6-contracts.mjs')) {
  pkg.scripts.test = pkg.scripts.test.replace(marker, `${marker} && node tests/recovery-task6-contracts.mjs`);
}
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log('Task6 merge patch applied: deferred BASE + shared Resolution Center routing');
