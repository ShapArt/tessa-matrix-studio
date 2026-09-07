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
console.log('Applied CardNewMode.Valid read-only interval diagnostic patch.');
