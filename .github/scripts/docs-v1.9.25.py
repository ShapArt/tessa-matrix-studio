from pathlib import Path

# CHANGELOG: prepend only the new release section, preserve all history byte-for-byte below it.
p = Path('CHANGELOG.md')
s = p.read_text(encoding='utf-8')
anchor = '# Changelog\n\n'
section = '''# Changelog

## 1.9.25 — 2026-08-28

- рабочие ячейки roundtrip-Excel теперь выгружаются с форматом Excel Text, чтобы значения вроде `3 - 18`, `1-10` и похожие строки не превращались в даты при ручном редактировании;
- XLSX-reader разбирает `styles.xml` и сохраняет для каждой рабочей ячейки style index, number format и исходный тип SpreadsheetML;
- если Excel уже преобразовал числовое значение в дату и сохранил serial (реальный UAT: `3 - 18` → `мар.18` → `43160`), не-Date/DateTime критерий переводится в ПРОПУСТИТЬ с явной причиной вместо применения двусмысленного числа;
- настоящий Int/Decimal в General/Text не блокируется, а Date/DateTime по-прежнему поддерживает штатные Excel serial values;
- TDD regression покрывает Text export, реальный `43160 + date style` fail-closed, genuine integer `43160` и настоящий Date serial; внутренние XLSX и данные TESSA в репозиторий не добавляются.

'''
assert s.startswith(anchor), 'CHANGELOG header mismatch'
s = section + s[len(anchor):]
p.write_text(s, encoding='utf-8')

# README: update only current-version surfaces; historical v1.9.24 security note remains intact.
p = Path('README.md')
s = p.read_text(encoding='utf-8')
replacements = {
    'version-1.9.24-EF233C': 'version-1.9.25-EF233C',
    '**v1.9.24 · Автор: Шаповалов Артём**': '**v1.9.25 · Автор: Шаповалов Артём**',
    'Подтвердите установку версии **1.9.24**': 'Подтвердите установку версии **1.9.25**',
    '- **Версия:** `1.9.24`': '- **Версия:** `1.9.25`',
    'Текущая версия: **1.9.24**': 'Текущая версия: **1.9.25**',
}
for old, new in replacements.items():
    assert s.count(old) == 1, f'README anchor mismatch: {old!r} count={s.count(old)}'
    s = s.replace(old, new)

anchor = '''> Начиная с **v1.9.24**, после ZIP/OPC-проверки каждый SpreadsheetML-лист проходит отдельную структурную валидацию до построения workbook: Studio ограничивает используемый номер строки **100 000**, столбцы — штатным пределом Excel **XFD / 16 384**, физически разбираемые строки — **100 000**, ячейки — **500 000**. Дубли номеров строк/координат ячеек, некорректные ссылки и несовпадение `cell r` с родительской строкой приводят к `XLSX отклонён`; такой файл не доходит до Preview/Apply.

'''
note = '''> Начиная с **v1.9.25**, редактируемые ячейки матрицы выгружаются в формате Excel **Text**, чтобы Excel не превращал значения вроде `3 - 18` в даты. При импорте Studio также читает `styles.xml`: если Excel уже сохранил числовой serial как дату, а критерий TESSA не является Date/DateTime, строка fail-closed переводится в **ПРОПУСТИТЬ** с понятной причиной. Настоящие Date/DateTime serial values остаются поддержанными.

'''
assert s.count(anchor) == 1, 'README v1.9.24 note anchor mismatch'
s = s.replace(anchor, anchor + '> [!IMPORTANT]\n' + note)
p.write_text(s, encoding='utf-8')
