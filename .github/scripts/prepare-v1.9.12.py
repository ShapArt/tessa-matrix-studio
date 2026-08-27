from pathlib import Path

version_old = '1.9.11'
version_new = '1.9.12'

# Production userscript metadata + runtime version.
path = Path('tessa-matrix-studio.user.js')
text = path.read_text(encoding='utf-8')
text = text.replace('// @version      1.9.11', '// @version      1.9.12', 1)
text = text.replace("    version: '1.9.11',", "    version: '1.9.12',", 1)
if '// @version      1.9.12' not in text or "version: '1.9.12'," not in text:
    raise SystemExit('userscript version bump failed')
path.write_text(text, encoding='utf-8')

# package.json keeps the full regression suite assembled during TDD.
path = Path('package.json')
text = path.read_text(encoding='utf-8')
text = text.replace('"version": "1.9.11"', '"version": "1.9.12"', 1)
path.write_text(text, encoding='utf-8')

# Smoke release guard.
path = Path('tests/smoke.mjs')
text = path.read_text(encoding='utf-8')
text = text.replace("// @version      1.9.11", "// @version      1.9.12", 1)
path.write_text(text, encoding='utf-8')

# Public bug template.
path = Path('.github/ISSUE_TEMPLATE/bug_report.yml')
text = path.read_text(encoding='utf-8')
text = text.replace('placeholder: 1.9.11', 'placeholder: 1.9.12', 1)
path.write_text(text, encoding='utf-8')

# README current-version references + usage documentation for selective review.
path = Path('README.md')
text = path.read_text(encoding='utf-8')
text = text.replace('1.9.11', '1.9.12')
anchor = 'Перед применением проверьте три вещи: ожидаемое количество `ИЗМЕНИТЬ / ДОБАВИТЬ / УДАЛИТЬ`, отсутствие неожиданных удалений и правильность затронутых строк.\n\n'
addition = '''### Исключить случайное изменение прямо в preview

Если в строке есть случайная правка, **не нужно переделывать исходный Excel и запускать проверку заново**:

- у каждого изменённого поля есть кнопка **«Не применять»** — поле останется со значением из текущей TESSA;
- отключённое поле становится приглушённым и его можно вернуть кнопкой **«Вернуть»**;
- кнопка **«Не применять всю строку»** исключает из записи все изменения этой строки;
- **«Вернуть все изменения строки»** полностью восстанавливает исходный план для строки;
- счётчики и кнопка **«Применить к TESSA»** сразу пересчитываются по выбранному набору изменений.

Эта настройка действует **только для текущего preview**. Загруженный `.xlsx` не переписывается. При новом **«Проверить изменения»** выбор сбрасывается. Если частичная отмена создаёт дублирующую строку или другой небезопасный результат, Studio блокирует применение и показывает причину.

'''
if anchor not in text:
    raise SystemExit('README preview anchor missing')
text = text.replace(anchor, anchor + addition, 1)
path.write_text(text, encoding='utf-8')

# Changelog entry.
path = Path('CHANGELOG.md')
text = path.read_text(encoding='utf-8')
entry = '''## 1.9.12 — 2026-08-27

- в preview добавлена выборочная отмена отдельных изменений поля без изменения исходного Excel;
- для UPDATE-строки можно одним действием исключить все её изменения и затем полностью вернуть их;
- отключённые поля визуально помечаются, а счётчики и Apply используют только reviewed/effective plan;
- исключённые поля восстанавливают не только отображаемые значения, но и исходные reference/role ID из текущей TESSA;
- после частичной отмены повторно проверяются дубли и safety-ограничения; новый preview всегда сбрасывает временный review-state.

'''
anchor = '# Changelog\n\n'
if anchor not in text:
    raise SystemExit('CHANGELOG anchor missing')
text = text.replace(anchor, anchor + entry, 1)
path.write_text(text, encoding='utf-8')
