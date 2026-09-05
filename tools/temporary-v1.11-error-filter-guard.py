from pathlib import Path

path = Path('tessa-matrix-studio.user.js')
code = path.read_text(encoding='utf-8')

def replace_once(label, before, after):
    global code
    count = code.count(before)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, got {count}')
    code = code.replace(before, after, 1)

replace_once(
    'bulk package guard',
    "    if (options.filter === 'skip') throw new Error('Пропущенные строки нельзя включить в пакет Apply.');",
    "    if (options.filter === 'skip' || options.filter === 'error') throw new Error('Пропущенные строки и ошибки нельзя включить в пакет Apply.');",
)
replace_once(
    'bulk package button disabled',
    "<button type=\"button\" data-review-package=\"keep\" ${selection.filter === 'skip' ? 'disabled' : ''}>Выбрать</button>",
    "<button type=\"button\" data-review-package=\"keep\" ${selection.filter === 'skip' || selection.filter === 'error' ? 'disabled' : ''}>Выбрать</button>",
)
replace_once(
    'bulk package helper text',
    "        <span>${selection.filter === 'skip'\n          ? 'Пропущенные строки не применяются'",
    "        <span>${selection.filter === 'skip' || selection.filter === 'error'\n          ? (selection.filter === 'error' ? 'Ошибки не применяются' : 'Пропущенные строки не применяются')",
)
replace_once(
    'empty Error state',
    "      empty.textContent = selection.filter === 'skip' ? 'Пропущенных строк по этому фильтру нет.' : 'Изменений по этому фильтру нет.';",
    "      empty.textContent = selection.filter === 'skip' ? 'Пропущенных строк по этому фильтру нет.' : selection.filter === 'error' ? 'Ошибок по этому фильтру нет.' : 'Изменений по этому фильтру нет.';",
)
path.write_text(code, encoding='utf-8')

for temp in [
    Path('.github/workflows/temporary-v1.11-error-filter-guard.yml'),
    Path('tools/temporary-v1.11-error-filter-guard.py'),
]:
    if temp.exists():
        temp.unlink()

print('Error-filter bulk Apply guard patched; temporary files removed')
