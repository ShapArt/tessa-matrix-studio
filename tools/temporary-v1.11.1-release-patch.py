from pathlib import Path

OLD = '1.11.0'
NEW = '1.11.1'
DATE = '2026-09-05'


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, before, after, label):
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, got {count}')
    return text.replace(before, after, 1)


# Runtime identity only; diagnostic logic was already merged and verified in PR #67.
path = 'tessa-matrix-studio.user.js'
text = read(path)
text = replace_once(text, '// @version      1.11.0', '// @version      1.11.1', 'userscript @version')
text = replace_once(text, "    version: '1.11.0',", "    version: '1.11.1',", 'APP.version')
write(path, text)

# npm metadata.
path = 'package.json'
text = read(path)
text = replace_once(text, '"version": "1.11.0"', '"version": "1.11.1"', 'package version')
write(path, text)

path = 'package-lock.json'
text = read(path)
count = text.count('"version": "1.11.0"')
if count != 2:
    raise RuntimeError(f'package-lock version: expected 2 matches, got {count}')
text = text.replace('"version": "1.11.0"', '"version": "1.11.1"', 2)
write(path, text)

# Public README version references.
path = 'README.md'
text = read(path)
for before, after, label in [
    ('version-1.11.0-EF233C', 'version-1.11.1-EF233C', 'README badge'),
    ('**v1.11.0 · Автор: Шаповалов Артём**', '**v1.11.1 · Автор: Шаповалов Артём**', 'README title version'),
    ('Подтвердите установку версии **1.11.0**', 'Подтвердите установку версии **1.11.1**', 'README install version'),
    ('Текущая версия: **1.11.0**', 'Текущая версия: **1.11.1**', 'README current version'),
]:
    text = replace_once(text, before, after, label)
write(path, text)

# Bug report default.
path = '.github/ISSUE_TEMPLATE/bug_report.yml'
text = read(path)
text = replace_once(text, '      placeholder: 1.11.0', '      placeholder: 1.11.1', 'bug report placeholder')
write(path, text)

# Diagnostic-only changelog entry.
path = 'CHANGELOG.md'
text = read(path)
anchor = '# Changelog\n\n'
if not text.startswith(anchor):
    raise RuntimeError('CHANGELOG header changed')
entry = f'''## {NEW} — {DATE}\n\n- Расширена read-only «Диагностика интервалов» для live-кейса issue #57: если `saved-rebuilt` проходит duplicate-check, но первый новый `proposed-add` отклоняется с `duplicate-interval-extractor / LeftOperandExtractor is null`, Studio теперь запускает три однофакторные проверки именно на том же CardNew payload.\n- Добавлены samples `proposed-add-clear-interval-changed`, `proposed-add-clear-interval-state` и `proposed-add-clear-interval-markers`. Они меняют только detached-сериализацию interval-row перед duplicate-check; исходная SDK Card не мутируется и дополнительные CardNew для probes не создаются.\n- Диагностика остаётся ограниченной: при одном candidate максимум 6 duplicate-check запросов (2 control + proposed-add + 3 structural), при двух candidates максимум 7. Если structural probes уже запускались на `saved-rebuilt`, второй набор для `proposed-add` не запускается.\n- Store/Delete не выполняются, `writesAttempted = 0`; Apply, preflight и серверный ValidateDuplicate не менялись. Релиз не объявляет `LeftOperandExtractor is null` исправленным — ошибка по-прежнему fail-closed и должна быть классифицирована по свежему live JSON.\n\n'''
text = anchor + entry + text[len(anchor):]
write(path, text)

# Self-clean temporary release machinery before the release commit.
for temp in [
    Path('.github/workflows/temporary-v1.11.1-release-patch.yml'),
    Path('tools/temporary-v1.11.1-release-patch.py'),
]:
    if temp.exists():
        temp.unlink()

print('Prepared v1.11.1 release metadata and removed temporary patch files')
