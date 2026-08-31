from pathlib import Path
import re

path = Path('README.md')
text = path.read_text(encoding='utf-8')

start = 'Начиная с **v1.9.20**, Preview дополнительно выполняет read-only preflight'
end = '> В Roundtrip V6 физический DELETE и новые строки без MatrixRowID/MatrixVersionID нельзя смешивать в одном файле: такая комбинация неотличима от повреждения hidden identity и поэтому fail-closed блокируется. Выполняйте DELETE и ADD отдельными пакетами из свежих выгрузок.'

si = text.find(start)
ei = text.find(end)
if si == -1 or ei == -1:
    raise SystemExit('README history block markers not found')
ei += len(end)

replacement = '''Studio перед Apply повторно проверяет актуальное состояние TESSA, справочники, дубли, версии строк и destructive-операции. Небезопасные действия переводятся в **ПРОПУСТИТЬ**, а большие планы можно просмотреть, отфильтровать и разбить на контролируемые пакеты прямо в Preview.\n\nТехнические детали защит, совместимости XLSX и изменения по версиям вынесены из README:\n\n- **[CHANGELOG.md](CHANGELOG.md)** — история изменений по версиям;\n- **[docs/PRODUCTION-RUNBOOK.md](docs/PRODUCTION-RUNBOOK.md)** — production/safety-поведение, лимиты и эксплуатационные правила.\n'''
text = text[:si] + replacement + text[ei:]

text = text.replace('Реальный интерфейс TESSA Matrix Studio v1.9.3', 'Интерфейс TESSA Matrix Studio')
text = text.replace('- **Версия:** `1.9.36`', '- **Версия:** `1.9.37`')

# Keep the user-facing workflow in README, move detailed version-by-version parser hardening deeper.
for version in ('1.9.23', '1.9.24', '1.9.25', '1.9.26'):
    pattern = re.compile(rf'\n> \[!IMPORTANT\]\n> Начиная с \*\*v{re.escape(version)}\*\*,.*?(?=\n> \[!|\n## |\n# |\n---)', re.S)
    text = pattern.sub('', text)

# Replace any remaining detailed Roundtrip V6 engineering paragraph in the usage section with one user-level caution.
text = re.sub(
    r'Roundtrip V6 дополнительно хранит на veryHidden-листе \*\*baseline-ledger\*\*.*?просит свежую выгрузку\.',
    'Служебные hidden/veryHidden данные нужны Studio для безопасного сопоставления строк. Не изменяйте и не удаляйте их вручную; при повреждении служебной identity Studio попросит свежую выгрузку.',
    text,
    flags=re.S,
)

path.write_text(text, encoding='utf-8')
print('README simplified')
