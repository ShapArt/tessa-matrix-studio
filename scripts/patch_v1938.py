from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one occurrence of {old!r}, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

replace_once('tessa-matrix-studio.user.js', '// @version      1.9.37', '// @version      1.9.38')
replace_once('tessa-matrix-studio.user.js', "version: '1.9.37'", "version: '1.9.38'")

readme = Path('README.md')
text = readme.read_text(encoding='utf-8')
for old, new in [
    ('version-1.9.37-EF233C', 'version-1.9.38-EF233C'),
    ('**v1.9.37 · Автор: Шаповалов Артём**', '**v1.9.38 · Автор: Шаповалов Артём**'),
    ('Подтвердите установку версии **1.9.37**', 'Подтвердите установку версии **1.9.38**'),
    ('- **Версия:** `1.9.37`', '- **Версия:** `1.9.38`'),
    ('Текущая версия: **1.9.37**', 'Текущая версия: **1.9.38**'),
]:
    if old not in text:
        raise SystemExit(f'README marker missing: {old}')
    text = text.replace(old, new, 1)
readme.write_text(text, encoding='utf-8')

changelog = Path('CHANGELOG.md')
text = changelog.read_text(encoding='utf-8')
marker = '# Changelog\n\n'
entry = '''## 1.9.38 — 2026-08-31\n\n- live UAT выявил шумный UX при глобальной несовместимости Excel: файл от другой карточки матрицы корректно блокировался, но Preview дополнительно показывал тысячи нерелевантных row-level `ПРОПУСТИТЬ`;\n- global context blockers (другая MatrixID/TemplateID, неподходящий контекст или иная причина `suppressUnsafePreview`) теперь скрывают executable actions и row-level SKIP из пользовательского Preview, оставляя одну глобальную причину блокировки;\n- исходные candidate actions/counts/skippedRows сохраняются отдельно для диагностики, поэтому подавление шума не теряет технические данные и не ослабляет safety;\n- добавлен RED→GREEN regression `global-context-suppression.mjs`; стратегия UAT переведена с искусственных тысяч однотипных ADD на компактное покрытие пользовательских сценариев и граничных классов.\n\n'''
if marker not in text:
    raise SystemExit('CHANGELOG marker missing')
if '## 1.9.38 —' not in text:
    text = text.replace(marker, marker + entry, 1)
changelog.write_text(text, encoding='utf-8')

replace_once('.github/ISSUE_TEMPLATE/bug_report.yml', 'placeholder: 1.9.37', 'placeholder: 1.9.38')
print('synced v1.9.38 release surfaces except package.json')
