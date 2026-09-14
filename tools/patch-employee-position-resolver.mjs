import fs from 'node:fs';

const path = process.argv[2] || 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');
const marker = '// EMPLOYEE_POSITION_ONLY_RESOLUTION_V1';
if (source.includes(marker)) {
  console.log('Employee position-only resolver patch already applied');
  process.exit(0);
}

const oldBlock = `      const partial = lookup.searchRows
        .filter(row => tokens.length ? tokens.every(token => row.haystack.includes(token)) : row.haystack.includes(needle))
        .map(row => row.item);
      if (partial.length === 1) return cacheResolution(resolvedItem(partial[0], 'unique-fragment'));
      if (partial.length > 1) {
        const variants = partial.slice(0, 10).map(item => item.selector).join('; ');
        const suffix = partial.length > 10 ? \`; … ещё \${partial.length - 10}\` : '';
        return cacheResolution({ display: visibleText, explicit: '', resolved: false, resolution: null, issue: \`По запросу «\${visibleText}» в столбце «\${column.excelHeader}» найдено \${partial.length} вариантов: \${variants}\${suffix}. Добавьте ещё слово, чтобы остался один вариант.\` });
      }`;

const newBlock = `      const partial = lookup.searchRows
        .filter(row => tokens.length ? tokens.every(token => row.haystack.includes(token)) : row.haystack.includes(needle))
        .map(row => row.item);

      ${marker}
      // For personal roles, position/department are searchable hints, never identity.
      // A fragment may auto-resolve only when the typed text carries a real name signal.
      // Do NOT use displayName here: it deliberately contains the position for UX and
      // would make a position-only query look like a person-name match.
      const personalPartial = column.kind === 'function'
        ? partial.filter(item => Number(item?.roleTypeId) === PERSONAL_ROLE_TYPE_ID)
        : [];
      if (personalPartial.length) {
        const candidateDto = item => ({
          id: item.id,
          roleTypeId: item.roleTypeId,
          display: item.displayName || item.display || item.selector || '',
          selector: item.selector || item.display || '',
          shortName: item.shortName || '',
          fullName: item.fullName || '',
          position: item.position || '',
          department: item.department || '',
        });
        const hasNameSignal = item => {
          const nameText = searchCanonical([
            item.shortName,
            item.fullName,
            item.nativeDisplay,
          ].filter(Boolean).join(' '));
          if (!nameText) return false;
          return tokens.length
            ? tokens.some(token => token.length >= 2 && nameText.includes(token))
            : Boolean(needle && nameText.includes(needle));
        };
        const nameCandidates = personalPartial.filter(hasNameSignal);
        if (!nameCandidates.length) {
          const candidates = personalPartial.slice(0, 20).map(candidateDto);
          return cacheResolution({
            display: visibleText,
            explicit: '',
            resolved: false,
            resolution: 'employee-position-only',
            candidates,
            issue: \`«\${visibleText}» похоже на должность, а не на ФИО сотрудника. Выберите сотрудника явно из актуального справочника «\${column.excelHeader}».\`,
          });
        }
        if (nameCandidates.length === 1) return cacheResolution(resolvedItem(nameCandidates[0], 'unique-name-fragment'));
        const candidates = nameCandidates.slice(0, 20).map(candidateDto);
        const variants = candidates.slice(0, 10).map(item => item.selector).join('; ');
        const suffix = nameCandidates.length > 10 ? \`; … ещё \${nameCandidates.length - 10}\` : '';
        return cacheResolution({
          display: visibleText,
          explicit: '',
          resolved: false,
          resolution: 'employee-name-ambiguous',
          candidates,
          issue: \`Значение «\${visibleText}» в столбце «\${column.excelHeader}» неоднозначно. Выберите сотрудника явно: \${variants}\${suffix}.\`,
        });
      }

      if (partial.length === 1) return cacheResolution(resolvedItem(partial[0], 'unique-fragment'));
      if (partial.length > 1) {
        const variants = partial.slice(0, 10).map(item => item.selector).join('; ');
        const suffix = partial.length > 10 ? \`; … ещё \${partial.length - 10}\` : '';
        return cacheResolution({ display: visibleText, explicit: '', resolved: false, resolution: null, issue: \`По запросу «\${visibleText}» в столбце «\${column.excelHeader}» найдено \${partial.length} вариантов: \${variants}\${suffix}. Добавьте ещё слово, чтобы остался один вариант.\` });
      }`;

if (!source.includes(oldBlock)) throw new Error('Expected resolver partial-search block was not found');
source = source.replace(oldBlock, newBlock);
fs.writeFileSync(path, source, 'utf8');
console.log('Patched employee position-only resolution');
