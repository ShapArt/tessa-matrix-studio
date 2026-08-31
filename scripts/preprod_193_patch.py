from pathlib import Path

ROOT = Path('.')
script_path = ROOT / 'tessa-matrix-studio.user.js'
text = script_path.read_text(encoding='utf-8')

# Version bump: userscript managers compare @version and otherwise may keep the old build.
for old, new in [
    ('// @version      1.9.32', '// @version      1.9.33'),
    ("    version: '1.9.32',", "    version: '1.9.33',"),
]:
    if text.count(old) != 1:
        raise SystemExit(f'expected exactly one marker: {old!r}, got {text.count(old)}')
    text = text.replace(old, new, 1)

old_abort = """  function requestApplyAbort() {
    APP.abortRequested = true;
  }
"""
new_abort = """  function requestApplyAbort() {
    APP.abortRequested = true;
  }

  function preflightAbortError() {
    const error = new Error('Предварительная проверка остановлена пользователем.');
    error.code = 'TMS_PREFLIGHT_ABORTED';
    return error;
  }

  function isPreflightAbortError(error) {
    return error?.code === 'TMS_PREFLIGHT_ABORTED';
  }

  /**
   * TESSA internal promises do not expose AbortSignal. During read-only preflight we can
   * still stop waiting immediately and refuse to schedule further checks. The underlying
   * already-started request may finish later, but no Store/Delete is allowed from it.
   */
  async function awaitPreflightAbortable(promise) {
    if (APP.abortRequested) throw preflightAbortError();
    let timer = null;
    const abortPromise = new Promise((_, reject) => {
      timer = setInterval(() => {
        if (!APP.abortRequested) return;
        if (timer !== null) clearInterval(timer);
        timer = null;
        reject(preflightAbortError());
      }, 25);
    });
    try {
      return await Promise.race([Promise.resolve(promise), abortPromise]);
    } finally {
      if (timer !== null) clearInterval(timer);
    }
  }
"""
if text.count(old_abort) != 1:
    raise SystemExit('requestApplyAbort marker mismatch')
text = text.replace(old_abort, new_abort, 1)

start = text.index('  async function preflightPlan(plan, options = {}) {')
end = text.index('\n  /**\n   * Operational write ceiling.', start)
pre = text[start:end]

replacements = [
    ("const bridge = options.bridge || await TessaBridge.create();",
     "const bridge = options.bridge || await awaitPreflightAbortable(TessaBridge.create());", 1),
    ("const structure = options.structure || await bridge.requestStructure(bridge.templateId());",
     "const structure = options.structure || await awaitPreflightAbortable(bridge.requestStructure(bridge.templateId()));", 1),
    ("const fresh = options.fresh || await bridge.loadSnapshot(structure);",
     "const fresh = options.fresh || await awaitPreflightAbortable(bridge.loadSnapshot(structure));", 1),
    ("    for (const action of plan.actions.filter(x => x.type === 'update')) {\n      try {",
     "    for (const action of plan.actions.filter(x => x.type === 'update')) {\n      if (APP.abortRequested) throw preflightAbortError();\n      try {", 1),
    ("await hydrateMissingIdsForAction(action, structure, fresh, bridge);",
     "await awaitPreflightAbortable(hydrateMissingIdsForAction(action, structure, fresh, bridge));", 2),
    ("const card = await bridge.getCard(current.rowCardId);",
     "const card = await awaitPreflightAbortable(bridge.getCard(current.rowCardId));", 1),
    ("await bridge.validateDuplicate(card, current.versionId);",
     "await awaitPreflightAbortable(bridge.validateDuplicate(card, current.versionId));", 1),
    ("        const created = await bridge.createRowCard(structure.templateId);",
     "        const created = await awaitPreflightAbortable(bridge.createRowCard(structure.templateId));", 1),
    ("        await bridge.validateDuplicate(created.card, created.versionId);",
     "        await awaitPreflightAbortable(bridge.validateDuplicate(created.card, created.versionId));", 1),
    ("    for (const action of plan.actions.filter(x => x.type === 'delete')) {\n      try {",
     "    for (const action of plan.actions.filter(x => x.type === 'delete')) {\n      if (APP.abortRequested) throw preflightAbortError();\n      try {", 1),
]
for old, new, expected in replacements:
    actual = pre.count(old)
    if actual != expected:
        raise SystemExit(f'preflight marker mismatch {old!r}: expected {expected}, got {actual}')
    pre = pre.replace(old, new, expected)

# Cancellation must escape row-level SKIP accounting and abort the whole read-only preflight.
old_update_catch = """      } catch (error) {
        const excelRow = Number(action.excelRow?.excelRow);
        if (Number.isFinite(excelRow)) failedMutationRows.add(excelRow);
        runtimeSkippedActions.add(action);
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-update'));
      }
"""
new_update_catch = """      } catch (error) {
        if (isPreflightAbortError(error)) throw error;
        const excelRow = Number(action.excelRow?.excelRow);
        if (Number.isFinite(excelRow)) failedMutationRows.add(excelRow);
        runtimeSkippedActions.add(action);
        runtimeSkips.push(runtimeSkip(action, error, 'preflight-update'));
      }
"""
if pre.count(old_update_catch) != 1:
    raise SystemExit('update catch marker mismatch')
pre = pre.replace(old_update_catch, new_update_catch, 1)

old_add_try = """    const validateAddAction = async action => {
      try {
"""
new_add_try = """    const validateAddAction = async action => {
      if (APP.abortRequested) throw preflightAbortError();
      try {
"""
if pre.count(old_add_try) != 1:
    raise SystemExit('ADD try marker mismatch')
pre = pre.replace(old_add_try, new_add_try, 1)

old_add_catch = """      } catch (error) {
        return { action, error };
      }
    };
"""
new_add_catch = """      } catch (error) {
        if (isPreflightAbortError(error)) throw error;
        return { action, error };
      }
    };
"""
if pre.count(old_add_catch) != 1:
    raise SystemExit('ADD catch marker mismatch')
pre = pre.replace(old_add_catch, new_add_catch, 1)

# Ensure an abort that arrives after the last row check cannot fall through as a successful preflight.
return_marker = """    preflightProgress(42,
      skipServerAddValidation ? 'Быстрый Preview завершён' : 'Предварительная проверка завершена',
"""
if pre.count(return_marker) != 1:
    raise SystemExit('preflight final progress marker mismatch')
pre = pre.replace(return_marker,
    "    if (APP.abortRequested) throw preflightAbortError();\n\n" + return_marker, 1)

text = text[:start] + pre + text[end:]

# Apply catches read-only preflight cancellation and returns an exact cancelled result without refresh/store.
old_apply = """    APP.abortRequested = false;
    const { bridge, structure, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips } = await preflightPlan(plan);
"""
new_apply = """    APP.abortRequested = false;
    let preflight;
    try {
      preflight = await preflightPlan(plan);
    } catch (error) {
      if (!isPreflightAbortError(error)) throw error;
      const result = {
        planId: plan.id,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        rows: [],
        skipped: [...(plan.skippedRows || [])],
        success: false,
        partial: true,
        status: 'cancelled',
        cancelled: true,
        sourceSkippedCount: (plan.skippedRows || []).length,
        preflightSkippedCount: 0,
        requestedCount: executable.length,
        plannedCount: executable.length,
        startedCount: 0,
        appliedCount: 0,
        skippedCount: 0,
        storeSkippedCount: 0,
        failedCount: 0,
        notStartedCount: executable.length,
        verificationIncomplete: false,
        refreshError: null,
      };
      finalizeApplyResult(result, { cancelled: true });
      log(`Предварительная проверка остановлена. Запись в TESSA не начиналась; не начато: ${result.notStartedCount}.`, 'warn');
      downloadJson(result, `TESSA_Matrix_Apply_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      setProgress(100, 'Применение остановлено', `Запись не начиналась · не начато: ${result.notStartedCount}`);
      return result;
    }
    const { bridge, structure, preparedUpdates, preparedAdds, readyDeletes, runtimeSkips } = preflight;
"""
if text.count(old_apply) != 1:
    raise SystemExit('apply preflight marker mismatch')
text = text.replace(old_apply, new_apply, 1)

script_path.write_text(text, encoding='utf-8')

# package.json version only; the new regression was already added to the test command.
pkg = ROOT / 'package.json'
pkg_text = pkg.read_text(encoding='utf-8')
if pkg_text.count('"version": "1.9.32"') != 1:
    raise SystemExit('package version marker mismatch')
pkg.write_text(pkg_text.replace('"version": "1.9.32"', '"version": "1.9.33"', 1), encoding='utf-8')

# Public docs must advertise the same userscript version.
readme = ROOT / 'README.md'
r = readme.read_text(encoding='utf-8')
for old, new in [
    ('version-1.9.32-', 'version-1.9.33-'),
    ('**v1.9.32 · Автор: Шаповалов Артём**', '**v1.9.33 · Автор: Шаповалов Артём**'),
    ('Подтвердите установку версии **1.9.32**', 'Подтвердите установку версии **1.9.33**'),
    ('Текущая версия: **1.9.32**', 'Текущая версия: **1.9.33**'),
]:
    if old not in r:
        raise SystemExit(f'README marker missing: {old!r}')
    r = r.replace(old, new)
readme.write_text(r, encoding='utf-8')

bug = ROOT / '.github/ISSUE_TEMPLATE/bug_report.yml'
b = bug.read_text(encoding='utf-8')
if 'placeholder: 1.9.32' not in b:
    raise SystemExit('bug template version marker missing')
bug.write_text(b.replace('placeholder: 1.9.32', 'placeholder: 1.9.33', 1), encoding='utf-8')

changelog = ROOT / 'CHANGELOG.md'
c = changelog.read_text(encoding='utf-8')
entry = """## 1.9.33 — 2026-08-31

- версия userscript поднята после pre-prod UX/performance изменений, чтобы Tampermonkey/Violentmonkey гарантированно увидел новую сборку через `@version`, а не продолжал выполнять старую 1.9.32;
- Stop во время read-only preflight теперь прекращает ожидание зависшего TESSA Promise и не запускает следующие проверки; уже стартовавший внутренний запрос может завершиться позже, но Store/Delete после такой остановки не начинаются;
- ADD/DELETE можно целиком переключить в «Не применять»/вернуть из Preview, UPDATE сохраняет и целиковое, и поколоночное selective review;
- отдельный DELETE-only `confirm()` удалён; число удалений остаётся в общем подтверждении, destructive guards и свежие проверки цели сохранены;
- глубокий ADD-preflight показывает `0 из N · жду ответ TESSA`, heartbeat по времени ожидания и затем обычный ETA, вместо визуально зависшего прогресса.

"""
if '## 1.9.33 —' in c:
    raise SystemExit('1.9.33 changelog already exists')
if '# Changelog\n\n' not in c:
    raise SystemExit('changelog header marker missing')
c = c.replace('# Changelog\n\n', '# Changelog\n\n' + entry, 1)
changelog.write_text(c, encoding='utf-8')
