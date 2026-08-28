from pathlib import Path

p = Path('tessa-matrix-studio.user.js')
s = p.read_text(encoding='utf-8')
old = """        const formulaMatch = cellBody.match(/<(?:[A-Za-z_][\\w.-]*:)?f\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?f>/i);\n        metaValues[coordinate.col] = {\n"""
new = """        // Formula nodes can contain an expression (<f>1+1</f>) or be self-closing\n        // for shared formulas (<f t=\"shared\" si=\"0\"/>). Both mean the cached <v>\n        // is formula output, never a user-entered scalar that may be applied to TESSA.\n        const formulaMatch = cellBody.match(/<(?:[A-Za-z_][\\w.-]*:)?f\\b([^>]*?)(?:\\/\\s*>|>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?f>)/i);\n        metaValues[coordinate.col] = {\n"""
if old not in s:
    raise SystemExit('formula anchor not found')
s = s.replace(old, new, 1)
old2 = """          hasFormula: Boolean(formulaMatch),\n          formula: formulaMatch ? xmlDecode(formulaMatch[1]) : '',\n"""
new2 = """          hasFormula: Boolean(formulaMatch),\n          formula: formulaMatch ? xmlDecode(formulaMatch[2] || '') : '',\n"""
if old2 not in s:
    raise SystemExit('formula metadata anchor not found')
s = s.replace(old2, new2, 1)
p.write_text(s, encoding='utf-8')
