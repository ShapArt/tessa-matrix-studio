from pathlib import Path

# Userscript version must move so Tampermonkey can distinguish the live-UAT UX fix.
script_path = Path('tessa-matrix-studio.user.js')
script = script_path.read_text(encoding='utf-8')
replacements = [
    ('// @version      1.9.34', '// @version      1.9.35'),
    ("version: '1.9.34'", "version: '1.9.35'"),
]
for old, new in replacements:
    if script.count(old) != 1:
        raise SystemExit(f'userscript marker {old!r}: count={script.count(old)}')
    script = script.replace(old, new, 1)
script_path.write_text(script, encoding='utf-8')

# Public README: change only current-version surfaces, retain historical notes.
readme_path = Path('README.md')
readme = readme_path.read_text(encoding='utf-8')
readme_replacements = [
    ('version-1.9.34-EF233C', 'version-1.9.35-EF233C'),
    ('**v1.9.34 · Автор: Шаповалов Артём**', '**v1.9.35 · Автор: Шаповалов Артём**'),
    ('Подтвердите установку версии **1.9.34**', 'Подтвердите установку версии **1.9.35**'),
    ('Текущая версия: **1.9.34**', 'Текущая версия: **1.9.35**'),
    ('- **Версия:** `1.9.32`', '- **Версия:** `1.9.35`'),
]
for old, new in readme_replacements:
    if old not in readme:
        raise SystemExit(f'README marker missing: {old!r}')
    readme = readme.replace(old, new, 1)

note_anchor = '> [!IMPORTANT]\n> В Roundtrip V6 физический DELETE'
new_note = '''> [!NOTE]\n> Начиная с **v1.9.35**, ожидаемый operational block виден прямо в Preview: если после selective review остаётся более 2000 мутаций, кнопка Apply отключена заранее и показывает текущий размер пакета/лимит. Такой policy-block больше не маскируется под runtime-ошибку, не открывает лишний modal alert и не скачивает `TESSA_Matrix_ErrorReport_*.json`; hard-stop внутри `applyPlan()` сохранён как второй защитный слой.\n\n'''
if readme.count(note_anchor) != 1:
    raise SystemExit(f'README note anchor count={readme.count(note_anchor)}')
readme = readme.replace(note_anchor, new_note + note_anchor, 1)
readme_path.write_text(readme, encoding='utf-8')

# Changelog: add, never rewrite, the new version entry.
changelog_path = Path('CHANGELOG.md')
changelog = changelog_path.read_text(encoding='utf-8')
if '## 1.9.35 —' in changelog:
    raise SystemExit('1.9.35 changelog entry already exists')
anchor = '# Changelog\n\n'
entry = '''## 1.9.35 — 2026-08-31\n\n- live MAX UAT подтвердил корректный hard-stop для пакета на 8505 операций, но выявил UX-разрыв: кнопка Apply оставалась кликабельной, поэтому ожидаемый лимит >2000 показывался как modal-ошибка и автоматически скачивал ErrorReport;\n- Preview теперь вычисляет единое `applyAvailability`: operational ceiling, общий safety-state и selective review определяют доступность Apply до клика;\n- при >2000 операций кнопка Apply disabled и показывает `Пакет слишком большой · N / 2000`, рядом выводится встроенное объяснение, а Preview/paging/filter/search остаются доступными;\n- ожидаемый policy-block больше не создаёт `TESSA_Matrix_ErrorReport_*.json` и не открывает alert; внутренний hard-stop `applyPlan()` сохранён как defense-in-depth;\n- добавлен regression на форму реального UAT: 8505 executable + 4 SKIP должны быть blocked в Preview, 2000 операций остаются разрешёнными, пустой план не включает Apply.\n\n'''
if changelog.count(anchor) != 1:
    raise SystemExit('changelog anchor missing')
changelog = changelog.replace(anchor, anchor + entry, 1)
changelog_path.write_text(changelog, encoding='utf-8')
