import fs from 'node:fs';

const path = 'tessa-matrix-studio.user.js';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(label, before, after) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected source block not found`);
  if (source.indexOf(before, first + 1) >= 0) throw new Error(`${label}: source block is not unique`);
  source = source.slice(0, first) + after + source.slice(first + before.length);
}

replaceOnce(
  'CardNew creation helpers',
`    async createRowCard(templateId) {
      const req = new this.cards.CardNewRequest();
      req.cardTypeId = this.cardTypes.mtxRouteMatrixRow.id;
      req.cardTypeName = this.cardTypes.mtxRouteMatrixRow.alias;
      const methodName = this.assertCanCreateRows();
      const response = await this.cardService[methodName](req);
      const error = this.validationError(response, 'Не удалось получить структуру новой строки матрицы');
      if (error) throw error;
      const card = response?.card;
      if (!card) throw new Error(\`CardService.\${methodName} не вернул структуру карточки новой строки.\`);
      card.id = this.Guid.newGuid();
      this.section(card, S.MatrixRow, true).fields.set(F.TemplateID, templateId, this.FieldType.Guid);
      const version = this.addRow(this.section(card, S.Versions, true));
      version.rowId = this.Guid.newGuid();
      version.state = this.CardRowState.Inserted;
      version.set(F.LinkCount, 0, this.FieldType.Int);
      return { card, cardId: String(card.id), versionId: String(version.rowId), newMethod: methodName };
    }`,
`    async createRowCard(templateId) {
      // Production/preflight keeps the platform's native CardNew default exactly as before.
      // Diagnostic CardNew modes must go through createDiagnosticRowCard and never leak into Apply.
      return this.createRowCardInternal(templateId);
    }

    async createDiagnosticRowCard(templateId, modeName = 'Valid') {
      const mode = this.cards?.CardNewMode?.[modeName];
      if (mode === null || mode === undefined) {
        const error = new Error(\`CardNewMode.\${modeName} недоступен в runtime этой сборки TESSA. Диагностический запрос не отправлен.\`);
        error.code = 'cardnew-mode-unavailable';
        throw error;
      }
      return this.createRowCardInternal(templateId, mode, { diagnosticNewMode: modeName });
    }

    async createRowCardInternal(templateId, newMode = undefined, metadata = {}) {
      const req = new this.cards.CardNewRequest();
      req.cardTypeId = this.cardTypes.mtxRouteMatrixRow.id;
      req.cardTypeName = this.cardTypes.mtxRouteMatrixRow.alias;
      if (newMode !== undefined) req.newMode = newMode;
      const methodName = this.assertCanCreateRows();
      const response = await this.cardService[methodName](req);
      const error = this.validationError(response, 'Не удалось получить структуру новой строки матрицы');
      if (error) throw error;
      const card = response?.card;
      if (!card) throw new Error(\`CardService.\${methodName} не вернул структуру карточки новой строки.\`);
      card.id = this.Guid.newGuid();
      this.section(card, S.MatrixRow, true).fields.set(F.TemplateID, templateId, this.FieldType.Guid);
      const version = this.addRow(this.section(card, S.Versions, true));
      version.rowId = this.Guid.newGuid();
      version.state = this.CardRowState.Inserted;
      version.set(F.LinkCount, 0, this.FieldType.Int);
      return { card, cardId: String(card.id), versionId: String(version.rowId), newMethod: methodName, ...metadata };
    }`
);

replaceOnce(
  'deepest interval diagnostic probe',
`                if (rejectedExtractor(allRows)) {
                  await probe('proposed-add-clear-main-section-changed', created.card, created.versionId, action.excelRow.excelRow, 'clear-main-section-changed');
                }`,
`                if (rejectedExtractor(allRows)) {
                  const envelope = await probe('proposed-add-clear-main-section-changed', created.card, created.versionId, action.excelRow.excelRow, 'clear-main-section-changed');
                  // If every bounded payload/topology probe still reproduces the extractor
                  // failure, compare one independently created CardNewMode.Valid card. This
                  // stays read-only and deliberately does not change createRowCard/Apply.
                  if (rejectedExtractor(envelope)) {
                    try {
                      await assertContext();
                      const validCreated = await bridge.createDiagnosticRowCard(structure.templateId, 'Valid');
                      await assertContext();
                      bridge.rebuildRowCard(validCreated.card, validCreated.versionId, action.excelRow, structure, snapshot);
                      const validSample = await probe('proposed-add-newmode-valid', validCreated.card, validCreated.versionId, action.excelRow.excelRow);
                      validSample.cardNewMode = 'Valid';
                    } catch (error) {
                      report.samples.push({
                        kind: 'proposed-add-newmode-valid',
                        excelRow: action.excelRow.excelRow,
                        outcome: 'not-sent',
                        code: error?.code || 'cardnew-mode-valid-unavailable',
                        message: String(error?.message || error).slice(0, 20000),
                        cardNewMode: 'Valid',
                      });
                    }
                  }
                }`
);

fs.writeFileSync(path, source, 'utf8');

const testPath = 'tests/interval-diagnostics.mjs';
let testSource = fs.readFileSync(testPath, 'utf8');
function replaceTestOnce(label, before, after) {
  const first = testSource.indexOf(before);
  if (first < 0) throw new Error(`${label}: expected test block not found`);
  if (testSource.indexOf(before, first + 1) >= 0) throw new Error(`${label}: test block is not unique`);
  testSource = testSource.slice(0, first) + after + testSource.slice(first + before.length);
}

replaceTestOnce(
  'existing interval fixture CardNew controls',
`    createRowCard: async () => { calls.push(['new']); const versionId = \`new-\${++serial}\`; return { card: card(\`card-\${serial}\`, versionId, false), versionId }; },`,
`    createRowCard: async () => { calls.push(['new', 'default']); const versionId = \`new-\${++serial}\`; return { card: card(\`card-\${serial}\`, versionId, false), versionId }; },
    createDiagnosticRowCard: async (_templateId, modeName) => {
      assert.equal(modeName, 'Valid', 'interval diagnostics must request only CardNewMode.Valid');
      calls.push(['new', 'Valid']);
      const versionId = \`new-\${++serial}\`;
      return { card: card(\`card-\${serial}\`, versionId, false), versionId, diagnosticNewMode: modeName };
    },`
);

replaceTestOnce(
  'accepted rebuilt expected CardNewMode sample',
`  'proposed-add-clear-main-section-changed',
  'proposed-add',
]);`,
`  'proposed-add-clear-main-section-changed',
  'proposed-add-newmode-valid',
  'proposed-add',
]);
assert.equal(acceptedResult.samples.at(-2).cardNewMode, 'Valid', 'deepest rejected path must include the explicit Valid CardNew control');`
);

replaceTestOnce(
  'accepted rebuilt request budget',
`assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'request').length, 13, 'accepted rebuilt path is bounded to two controls + nine detached probes + second proposed-add baseline');`,
`assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'request').length, 14, 'accepted rebuilt path is bounded to two controls + nine detached probes + one Valid CardNew control + second proposed-add baseline');`
);
replaceTestOnce(
  'accepted rebuilt CardNew budget',
`assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'new').length, 2, 'structural probes must not allocate extra CardNew cards');`,
`assert.equal(acceptedRebuilt.calls.filter(c => c[0] === 'new').length, 3, 'structural probes reuse the default CardNew; only one explicit Valid control may allocate an extra card');`
);

fs.writeFileSync(testPath, testSource, 'utf8');
console.log('Applied CardNewMode.Valid read-only interval diagnostic patch and updated regression contract.');
