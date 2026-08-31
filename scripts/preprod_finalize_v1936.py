from pathlib import Path

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one marker, got {count}: {old!r}')
    return text.replace(old, new, 1)


def replace_optional(text, old, new):
    return text.replace(old, new)


# --- Production userscript: query-aware package builder + final UX polish + version bump.
path = 'tessa-matrix-studio.user.js'
text = read(path)
text = replace_once(text, '// @version      1.9.35', '// @version      1.9.36', path)
text = replace_once(text, "version: '1.9.35'", "version: '1.9.36'", path)

old = """    const executable = (plan.actions || []).filter(action => action?.type && action.type !== 'noop');
    const candidates = executable.filter(action => filter === 'all' || action.type === filter);
    const keepKeys = new Set(candidates.slice(0, limit).map(planReviewActionKey));"""
new = """    const executable = (plan.actions || []).filter(action => action?.type && action.type !== 'noop');
    const query = canonicalValue(options.query || '');
    const candidates = executable
      .filter(action => filter === 'all' || action.type === filter)
      .filter(action => !query || previewActionSearchText(action).includes(query));
    const keepKeys = new Set(candidates.slice(0, limit).map(planReviewActionKey));"""
text = replace_once(text, old, new, 'query-aware keepReviewedPackage')

old = """          APP.review = keepReviewedPackage(APP.plan, APP.review, { filter: APP.previewView.filter, limit });"""
new = """          APP.review = keepReviewedPackage(APP.plan, APP.review, {
            filter: APP.previewView.filter,
            query: APP.previewView.query,
            limit,
          });"""
text = replace_once(text, old, new, 'UI query pass-through')

old = """        <span>${selection.filter === 'all' ? 'Из всех операций' : selection.filter === 'skip' ? 'Пропущенные строки не применяются' : `Только: ${selection.filter === 'update' ? 'изменить' : selection.filter === 'add' ? 'добавить' : 'удалить'}`}</span>"""
new = """        <span>${selection.filter === 'skip'
          ? 'Пропущенные строки не применяются'
          : selection.query
            ? 'По текущему фильтру и поиску'
            : selection.filter === 'all'
              ? 'Из всех операций'
              : `Только: ${selection.filter === 'update' ? 'изменить' : selection.filter === 'add' ? 'добавить' : 'удалить'}`}</span>"""
text = replace_once(text, old, new, 'package scope caption')

old = """      ${applyState.batchBlocked ? `<div class=\"tms-fatal\"><b>Пакет слишком большой для одного Apply</b><br>${escapeHtml(applyState.reason || '')}<br><span class=\"tms-review-state\">Preview остаётся доступен: можно проверить все строки и подготовить меньший контролируемый пакет.</span></div>` : ''}"""
new = """      ${applyState.batchBlocked ? `<div class=\"tms-fatal\"><b>Пакет для Apply превышает лимит</b><br>Сейчас: ${applyState.count} · максимум: 2000. Ниже в Preview выберите тип/поиск, размер пакета и нажмите «Оставить в Apply».</div>` : ''}"""
text = replace_once(text, old, new, 'oversized inline guidance')

text = replace_once(
    text,
    '<div class="tms-step tms-step-apply"><div class="tms-step-label">4 · Применить корректные строки</div><button id="tms-apply" class="tms-primary" disabled>Применить к TESSA</button><div id="tms-apply-note" class="tms-step-caption"></div></div>',
    '<div class="tms-step tms-step-apply"><div class="tms-step-label">4 · Применение</div><button id="tms-apply" class="tms-primary" disabled>Применить к TESSA</button><div id="tms-apply-note" class="tms-step-caption"></div></div>',
    'neutral Apply step title',
)
write(path, text)

# --- package.json
path = 'package.json'
text = read(path)
text = replace_once(text, '"version": "1.9.35"', '"version": "1.9.36"', path)
write(path, text)

# --- README: only current-version surfaces are replaced; historical v1.9.35 note is preserved.
path = 'README.md'
text = read(path)
for old, new in [
    ('version-1.9.35-EF233C', 'version-1.9.36-EF233C'),
    ('**v1.9.35 · Автор: Шаповалов Артём**', '**v1.9.36 · Автор: Шаповалов Артём**'),
    ('Подтвердите установку версии **1.9.35**', 'Подтвердите установку версии **1.9.36**'),
    ('- **Версия:** `1.9.35`', '- **Версия:** `1.9.36`'),
    ('Текущая версия: **1.9.35**', 'Текущая версия: **1.9.36**'),
]:
    if old not in text:
        raise SystemExit(f'README current-version marker missing: {old}')
    text = text.replace(old, new)

marker = '> Начиная с **v1.9.35**, ожидаемый operational block виден прямо в Preview: если после selective review остаётся более 2000 мутаций, кнопка Apply отключена заранее и показывает текущий размер пакета/лимит. Такой policy-block больше не маскируется под runtime-ошибку, не открывает лишний modal alert и не скачивает `TESSA_Matrix_ErrorReport_*.json`; hard-stop внутри `applyPlan()` сохранён как второй защитный слой.\n'
addition = marker + '\n> [!NOTE]\n> Начиная с **v1.9.36**, большой Preview можно превратить в контролируемый пакет без ручного отключения тысяч строк: блок **«Пакет для Apply»** оставляет первые `1 / 10 / 100 / 500 / 2000` операций из текущего фильтра **и текущего поиска**. Остальные операции используют обычный selective review и не попадают в Apply; **«Вернуть всё»** восстанавливает исходный план. Это не обходит operational guards — каждый реально применяемый пакет по-прежнему проходит свежий серверный preflight перед записью.\n'
text = replace_once(text, marker, addition, 'README v1.9.36 note insertion')
write(path, text)

# --- bug report current version.
path = '.github/ISSUE_TEMPLATE/bug_report.yml'
text = read(path)
text = replace_once(text, 'placeholder: 1.9.35', 'placeholder: 1.9.36', path)
write(path, text)

# --- changelog: add a new release-candidate entry, preserve 1.9.35 history.
path = 'CHANGELOG.md'
text = read(path)
if '## 1.9.36 —' in text:
    raise SystemExit('CHANGELOG already contains 1.9.36')
entry = """## 1.9.36 — 2026-08-31

- большой Preview получил встроенный **«Пакет для Apply»**: можно оставить первые `1 / 10 / 100 / 500 / 2000` операций из выбранного типа и быстро вернуть исходный план без ручного выключения тысяч строк;
- пакетный выбор теперь учитывает не только фильтр `Все / Изменить / Добавить / Удалить`, но и активный поиск Preview, поэтому видимая найденная строка не может быть подменена первой строкой того же типа вне поиска;
- oversized UX стал компактнее и actionable: Step 4 называется **«Применение»**, а блокировка >2000 прямо указывает использовать «Пакет для Apply» вместо повторения одного и того же error-текста;
- production runbook синхронизирован с фактическим UX: отдельного DELETE-only confirm больше нет, destructive guards остаются, а контролируемое разбиение большого Preview выполняется через selective review/package builder;
- версия поднята до 1.9.36, чтобы Tampermonkey видел новый package-builder как отдельное обновление через `@version`.

"""
text = replace_once(text, '# Changelog\n\n', '# Changelog\n\n' + entry, 'CHANGELOG insertion')
write(path, text)

# --- production runbook: remove stale DELETE-confirm wording and document package builder.
path = 'docs/PRODUCTION-RUNBOOK.md'
text = read(path)
text = replace_once(
    text,
    'При наличии DELETE Studio запрашивает отдельное подтверждение. Не подтверждайте удаление только потому, что общий Preview выглядит знакомо — сначала откройте соответствующую строку Preview и проверьте identity/значения.',
    'Для DELETE отдельного browser-confirm больше нет: количество удалений видно в общем подтверждении Apply, а конкретные DELETE нужно проверить в Preview. Destructive guards, свежий preflight и финальный target recheck перед удалением остаются обязательными.',
    'runbook DELETE confirmation',
)
marker = '- прежний ratio guard сохраняется: 10 и более DELETE при удалении не менее 20% исходной матрицы блокируются.\n'
addition = marker + '\nНачиная с v1.9.36 большой Preview можно сузить прямо в Studio через **«Пакет для Apply»**. Выберите `Все / Изменить / Добавить / Удалить`, при необходимости задайте поиск, затем оставьте `1 / 10 / 100 / 500 / 2000` операций. Пакет формируется обычными review-exclusions: исходный Excel не переписывается, **«Вернуть всё»** восстанавливает полный Preview, а перед реальной записью выбранный пакет всё равно проходит свежий server preflight.\n'
text = replace_once(text, marker, addition, 'runbook package builder')
write(path, text)

# --- Gold candidate document: supersede the unreleased v1.9.35 candidate.
old_gold = ROOT / 'docs/GOLD-CANDIDATE-v1.9.35.md'
new_gold = ROOT / 'docs/GOLD-CANDIDATE-v1.9.36.md'
if not old_gold.exists():
    raise SystemExit('old gold candidate document missing')
new_gold.write_text("""# TESSA Matrix Studio v1.9.36 — Gold Candidate

Status document for PR #46. Automated evidence must always be read from the latest PR head and its `Quality & Security` run; copied SHAs in prose are not release authority.

## Automated gates — complete

- Large Preview is fully reviewable: paging, type filters, search and selective review beyond the first 40 actions.
- UPDATE supports whole-row/per-field exclusion; ADD and DELETE support whole-operation exclusion/restore.
- Large Preview can be reduced through **«Пакет для Apply»** to `1 / 10 / 100 / 500 / 2000` operations. Selection follows both the active type filter and active Preview search; **«Вернуть всё»** restores the source review state.
- Apply limits remain defense-in-depth: `<=500` normal, `501–2000` extra confirmation, `>2000` hard block both in Preview availability and inside `applyPlan()`.
- DELETE safety remains `>=100` absolute hard block plus `>=10 && >=20%` ratio guard; the redundant DELETE-only browser confirm is intentionally absent.
- Stop/preflight cancellation, partial-result accounting, refresh-after-Store recovery, race guards, baseline identity and XLSX ZIP/XML/OPC protections remain in the full regression suite.
- Large blocked Preview uses the local ADD fast path; every package that is actually allowed to Apply still receives fresh server preflight before Store.
- External GitHub Actions remain pinned to full SHAs and maintained by Dependabot.

## Live evidence already obtained

The real browser/Tampermonkey/TESSA MAX runs confirmed:

- v1.9.34 parsed the 56-column / 8636-row MAX workbook, loaded 18 criteria / 8 functions and a 135-row TESSA snapshot, and built 8505 executable operations + 4 expected SKIP over 213 Preview pages;
- prepared clear-row, unknown-dictionary, duplicate and dependent-delete cases stayed fail-closed;
- the >2000 safety ceiling prevented Store;
- v1.9.35 fixed the discovered UX gap: on the same 8505-operation MAX, Apply is disabled before click, `8505 / 2000` is visible, Preview remains usable, and no policy-block modal/ErrorReport is produced.

## Remaining manual gates before gold release

1. **Controlled live Apply on v1.9.36.** Start from a fresh export. On the MAX/derived test flow use the Preview filter/search plus **«Пакет для Apply»** to leave a very small package (recommended `1–10` safe ADD/UPDATE operations, no DELETE for the first proof). Confirm the effective counters, Apply once, preserve the result JSON, then download a new fresh export and reconcile the changed rows. Do not Apply the 8500-row master as-is.
2. **Release Immutability.** Enable GitHub Release Immutability in repository `Settings -> Releases` before publishing, then verify the published tag/assets/checksums/attestation.

If the controlled live Apply fails a P0 invariant, keep PR #46 draft and do not publish.

## Accepted residual risks / deferred work

- The userscript is still a large single file; modular build/refactor is a post-gold task.
- `@include https://tessa-app*.cherkizovsky.net/*` stays until an approved production host inventory exists; runtime still requires TESSA API/webpack presence before mounting.
- Custom DELETE retains the documented client-side micro-window between final targeted recheck and custom delete request because this path has no server-side `AffectVersion` equivalent.
- SpreadsheetML limits intentionally fail closed; practical maximum rows depend on workbook width and the parsed-cell ceiling.
- Full automated browser-extension E2E against internal TESSA is not available in the Node CI harness; controlled live UAT remains the final integration proof.

## Release rule

Re-verify the exact PR head immediately before integration. After the controlled live Apply passes: mark PR ready, merge to `main`, let the release workflow rerun the full suite/build/checksums, publish v1.9.36 only once, then verify the immutable release and Tampermonkey `latest` delivery.
""", encoding='utf-8')
old_gold.unlink()

print('v1.9.36 finalization patch prepared successfully')
