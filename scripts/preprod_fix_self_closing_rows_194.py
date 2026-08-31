from pathlib import Path

ROOT = Path('.')
source = ROOT / 'tessa-matrix-studio.user.js'
text = source.read_text(encoding='utf-8')

old_loop = "    for (const rowMatch of xml.matchAll(/<(?:[A-Za-z_][\\w.-]*:)?row\\b([^>]*)>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?row>/gi)) {"
new_loop = "    const rowRegex = /<(?:[A-Za-z_][\\w.-]*:)?row\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?row>)/gi;\n    for (const rowMatch of xml.matchAll(rowRegex)) {"
if text.count(old_loop) != 1:
    raise SystemExit(f'expected exactly one old row loop, got {text.count(old_loop)}')
text = text.replace(old_loop, new_loop, 1)

for old, new, label in [
    ('// @version      1.9.33', '// @version      1.9.34', '@version'),
    ("version: '1.9.33'", "version: '1.9.34'", 'APP.version'),
]:
    if text.count(old) != 1:
        raise SystemExit(f'{label}: expected exactly one marker, got {text.count(old)}')
    text = text.replace(old, new, 1)
source.write_text(text, encoding='utf-8')

# Keep public release/version contract synchronized.
pkg = ROOT / 'package.json'
pkg_text = pkg.read_text(encoding='utf-8')
if '"version": "1.9.33"' not in pkg_text:
    raise SystemExit('package version 1.9.33 marker missing')
pkg.write_text(pkg_text.replace('"version": "1.9.33"', '"version": "1.9.34"', 1), encoding='utf-8')

readme = ROOT / 'README.md'
readme_text = readme.read_text(encoding='utf-8')
if '1.9.33' not in readme_text:
    raise SystemExit('README 1.9.33 marker missing')
readme.write_text(readme_text.replace('1.9.33', '1.9.34'), encoding='utf-8')

bug = ROOT / '.github/ISSUE_TEMPLATE/bug_report.yml'
bug_text = bug.read_text(encoding='utf-8')
if '1.9.33' not in bug_text:
    raise SystemExit('bug template 1.9.33 marker missing')
bug.write_text(bug_text.replace('1.9.33', '1.9.34'), encoding='utf-8')

changelog = ROOT / 'CHANGELOG.md'
ch = changelog.read_text(encoding='utf-8')
entry = """## 1.9.34 — 2026-08-31

- XLSX SpreadsheetML parser корректно принимает легальные self-closing пустые строки вида `<row r=\"2\"/>`; раньше row-regex ошибочно захватывал следующую строку и мог сообщать `A3 ... находится внутри строки 2`;
- security-проверка координат не ослаблена: реальный mismatch `<row r=\"2\"><c r=\"A3\">` по-прежнему fail-closed отклоняется, как и дубли строк/ячеек и структурные лимиты;
- версия userscript поднята до 1.9.34, чтобы установленная 1.9.33 с ошибочным row-parser гарантированно отличалась при обновлении.

"""
marker = '# Changelog\n\n'
if not ch.startswith(marker):
    raise SystemExit('CHANGELOG header marker missing')
if '## 1.9.34 —' not in ch:
    ch = ch.replace(marker, marker + entry, 1)
changelog.write_text(ch, encoding='utf-8')
