from pathlib import Path


def replace_once(path: str, before: str, after: str, label: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(before)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match in {path}, got {count}')
    file.write_text(text.replace(before, after, 1), encoding='utf-8')


replace_once('tessa-matrix-studio.user.js', '// @version      1.9.20', '// @version      1.9.21', 'metadata version')
replace_once('tessa-matrix-studio.user.js', "    version: '1.9.20',", "    version: '1.9.21',", 'runtime version')
replace_once('package.json', '"version": "1.9.20"', '"version": "1.9.21"', 'package version')
replace_once('tests/smoke.mjs', "assert(code.includes('// @version      1.9.20'), 'wrong userscript version');", "assert(code.includes('// @version      1.9.21'), 'wrong userscript version');", 'smoke version')
replace_once('.github/ISSUE_TEMPLATE/bug_report.yml', '      placeholder: 1.9.20', '      placeholder: 1.9.21', 'issue version')

replace_once('README.md', 'version-1.9.20-EF233C', 'version-1.9.21-EF233C', 'README badge')
replace_once('README.md', '**v1.9.20 · Автор: Шаповалов Артём**', '**v1.9.21 · Автор: Шаповалов Артём**', 'README current version')
replace_once('README.md', 'Подтвердите установку версии **1.9.20** в Tampermonkey.', 'Подтвердите установку версии **1.9.21** в Tampermonkey.', 'README quick start version')
replace_once('README.md', '- **Версия:** `1.9.20`', '- **Версия:** `1.9.21`', 'README install version')

changelog = Path('CHANGELOG.md')
text = changelog.read_text(encoding='utf-8')
marker = '# Changelog\n\n'
if text.count(marker) != 1:
    raise RuntimeError('CHANGELOG header mismatch')
entry = '''## 1.9.21 — 2026-08-28\n\n- исправлена safety-зависимость UPDATE/ADD → DELETE для типизированных значений, которые семантически равны, но по-разному отображаются в Excel и TESSA;\n- Boolean `Да` / `true`, а также Int, Decimal, Date и DateTime теперь нормализуются только при сопоставлении зависимого DELETE;\n- основной `fingerprintFlat` намеренно не изменён: stale/integrity-проверки продолжают использовать точный исходный fingerprint;\n- добавлен regression из реального UAT: если UPDATE в состояние удаляемой строки отклонён как duplicate, связанный DELETE также обязан перейти в ПРОПУСТИТЬ.\n\n'''
changelog.write_text(text.replace(marker, marker + entry, 1), encoding='utf-8')

print('v1.9.21 release metadata finalized')
# trigger workflow after finalizer definition exists
