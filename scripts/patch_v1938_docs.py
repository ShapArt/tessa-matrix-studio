from pathlib import Path

replacements = {
    'README.md': [
        ('version-1.9.37-', 'version-1.9.38-'),
        ('**v1.9.37 · Автор: Шаповалов Артём**', '**v1.9.38 · Автор: Шаповалов Артём**'),
        ('Подтвердите установку версии **1.9.37**', 'Подтвердите установку версии **1.9.38**'),
        ('- **Версия:** `1.9.37`', '- **Версия:** `1.9.38`'),
        ('Текущая версия: **1.9.37**', 'Текущая версия: **1.9.38**'),
    ],
    '.github/ISSUE_TEMPLATE/bug_report.yml': [
        ('placeholder: 1.9.37', 'placeholder: 1.9.38'),
    ],
}

for path_str, pairs in replacements.items():
    path = Path(path_str)
    text = path.read_text(encoding='utf-8')
    for old, new in pairs:
        if old not in text:
            raise SystemExit(f'{path}: marker not found: {old!r}')
        text = text.replace(old, new, 1)
    path.write_text(text, encoding='utf-8')

changelog = Path('CHANGELOG.md')
text = changelog.read_text(encoding='utf-8')
entry = '''## 1.9.38 — 2026-08-31\n\n- global workbook blocker (например, Excel от другой MatrixID/TemplateID) теперь является единственной авторитетной причиной отказа в пользовательском Preview;\n- вторичные row-level SKIP, накопленные до обнаружения глобального контекстного blocker, скрываются из UI и счётчиков вместо тысяч однотипных сообщений про hidden identity;\n- исходные candidate actions / skipped rows / counts сохраняются только как диагностический payload, поэтому fail-closed guards не ослабляются и данные для расследования не теряются;\n- добавлен RED→GREEN regression, воспроизводящий живой UAT: wrong-matrix blocker + 2000 candidate actions + 2130 secondary identity issues;\n- версия поднята до 1.9.38.\n\n'''
marker = '# Changelog\n\n'
if marker not in text:
    raise SystemExit('CHANGELOG marker missing')
text = text.replace(marker, marker + entry, 1)
changelog.write_text(text, encoding='utf-8')
