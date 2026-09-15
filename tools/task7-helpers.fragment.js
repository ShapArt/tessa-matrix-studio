  function buildWritableFieldInventory(book, structure, currentCatalog) {
    const criterionById = new Map();
    for (const definition of structure?.conditions || []) {
      const id = definition?.criterionRowId || definition?.id || definition?.rowId || definition?.criterionId;
      if (id !== undefined && id !== null && String(id).trim()) criterionById.set(canon(id), definition);
    }
    const functionById = new Map();
    for (const definition of structure?.functions || []) {
      const id = definition?.id || definition?.functionId || definition?.rowId;
      if (id !== undefined && id !== null && String(id).trim()) functionById.set(canon(id), definition);
    }
    const strategyForKind = kind => ({
      Function: 'dictionary', ReferenceGuid: 'dictionary', ReferenceInt: 'dictionary', Boolean: 'boolean',
      Int: 'integer', Decimal: 'decimal', Date: 'date', DateTime: 'datetime', String: 'string',
    })[kind] || null;
    const inventory = [];
    for (let index = 0; index < (book?.schemaTokens || []).length; index += 1) {
      const token = String(book.schemaTokens[index] || '');
      if (!/^(criterion|function):/.test(token)) continue;
      const [scope, ...tail] = token.split(':');
      const id = tail.join(':');
      const definition = scope === 'criterion' ? criterionById.get(canon(id)) : functionById.get(canon(id));
      if (!definition) continue;
      const kind = scope === 'function' ? 'Function' : E.operandKind({ kind: 'criterion', ...definition });
      const strategy = strategyForKind(kind);
      if (!strategy) continue;
      inventory.push({
        token,
        index,
        label: String(scope === 'function'
          ? (definition.name || definition.functionName || definition.typeName || token)
          : (definition.criterionName || definition.name || token)),
        kind,
        strategy,
        definition,
        entries: strategy === 'dictionary' ? authoritativeEntries(currentCatalog, token) : [],
      });
    }
    return inventory;
  }

  function parseSimpleNumber(text) {
    const value = Number(String(text ?? '').trim().replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }

  function splitSimpleRange(text) {
    const match = String(text ?? '').trim().match(/^(.+?)\s+(?:-|–|—|\.\.|до)\s+(.+)$/i);
    return match ? [match[1].trim(), match[2].trim()] : null;
  }

  function formatCandidateNumber(value, integer, comma) {
    const rendered = integer ? String(Math.trunc(value)) : String(Math.round(value * 1000) / 1000);
    return comma ? rendered.replace('.', ',') : rendered;
  }

  function parseUatDate(text) {
    const raw = String(text ?? '').trim();
    let match = raw.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) {
      const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatUatDate(date, withTime) {
    const pad = value => String(value).padStart(2, '0');
    const day = pad(date.getUTCDate()), month = pad(date.getUTCMonth() + 1), year = date.getUTCFullYear();
    if (!withTime) return `${day}.${month}.${year}`;
    return `${day}.${month}.${year} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  }

  function shiftedDateCandidate(text, withTime, days = 1) {
    const parsed = parseUatDate(text);
    if (!parsed) return null;
    parsed.setUTCDate(parsed.getUTCDate() + days);
    return formatUatDate(parsed, withTime);
  }

  function fieldCandidateValues(item, currentValue) {
    const currentText = String(currentValue ?? '').trim();
    if (!item) return [];
    if (item.strategy === 'dictionary') {
      return [...(item.entries || [])]
        .sort((a, b) => String(a.selector || a.display || a.id || '').localeCompare(String(b.selector || b.display || b.id || ''), 'ru'))
        .filter(entry => canon(entry.selector || entry.display || '') !== canon(currentText));
    }
    if (item.strategy === 'boolean') {
      const current = canon(currentText);
      if (['да', 'true', '1'].includes(current)) return ['Нет'];
      if (['нет', 'false', '0'].includes(current)) return ['Да'];
      return ['Да', 'Нет'];
    }
    if (item.strategy === 'integer' || item.strategy === 'decimal') {
      const integer = item.strategy === 'integer';
      const comma = currentText.includes(',');
      const range = splitSimpleRange(currentText);
      if (range) {
        const from = parseSimpleNumber(range[0]), to = parseSimpleNumber(range[1]);
        if (from !== null && to !== null) {
          return [`${formatCandidateNumber(from + 1, integer, comma)} – ${formatCandidateNumber(to + 1, integer, comma)}`];
        }
      }
      const current = parseSimpleNumber(currentText);
      if (current === null) return integer ? ['1', '2'] : ['1,5', '2,5'];
      return [formatCandidateNumber(current + 1, integer, comma), formatCandidateNumber(current - 1, integer, comma)]
        .filter(value => canon(value) !== canon(currentText));
    }
    if (item.strategy === 'date' || item.strategy === 'datetime') {
      const withTime = item.strategy === 'datetime';
      const range = splitSimpleRange(currentText);
      if (range) {
        const from = shiftedDateCandidate(range[0], withTime, 1), to = shiftedDateCandidate(range[1], withTime, 1);
        if (from && to) return [`${from} – ${to}`];
      }
      const shifted = shiftedDateCandidate(currentText, withTime, 1);
      const fallbacks = withTime ? ['01.01.2030 12:00', '02.01.2030 12:00'] : ['01.01.2030', '02.01.2030'];
      return [shifted, ...fallbacks].filter((value, index, array) => value && canon(value) !== canon(currentText) && array.indexOf(value) === index);
    }
    if (item.strategy === 'string') {
      const base = currentText ? currentText.slice(0, 70) : 'TMS UAT';
      return [`${base} · UAT`, `${base} · UAT 2`].filter(value => canon(value) !== canon(currentText));
    }
    return [];
  }

  function setFieldCandidate(book, row, item, candidate) {
    if (item.strategy === 'dictionary') return setDictionaryValue(book, row, item.token, candidate);
    row.values[item.index] = String(candidate ?? '');
    const idIndex = companionIndex(book, item.token);
    if (idIndex >= 0) row.values[idIndex] = '';
    return row;
  }

  function canonicalFieldValues(values) {
    const list = Array.isArray(values) ? values : (values === null || values === undefined || values === '' ? [] : [values]);
    return list.map(value => canon(value)).filter(Boolean).sort();
  }

  function candidateEvidenceValue(candidate) {
    if (candidate && typeof candidate === 'object') return {
      id: candidate.id ?? null,
      roleTypeId: candidate.roleTypeId ?? null,
      display: String(candidate.selector || candidate.display || ''),
    };
    return String(candidate ?? '');
  }
