import fs from 'node:fs';

const file = new URL('../tessa-matrix-studio.user.js', import.meta.url);
let code = fs.readFileSync(file, 'utf8');

if (code.includes('NATIVE_DELETE_REQUEST_CONTRACT_V1') && code.includes('NATIVE_EDITOR_SAVE_CONTRACT_V1')) {
  console.log('Live native DELETE/SAVE contract already applied');
  process.exit(0);
}

function replaceOnce(before, after, label) {
  const first = code.indexOf(before);
  if (first < 0) throw new Error(`pattern not found: ${label}`);
  if (code.indexOf(before, first + before.length) >= 0) throw new Error(`pattern not unique: ${label}`);
  code = code.slice(0, first) + after + code.slice(first + before.length);
}

const oldSave = `    async saveMainMatrixAfterApply(options = {}) {
      const hasEditorChanges = typeof this.editor?.cardModel?.hasChanges === 'function'
        ? await this.editor.cardModel.hasChanges()
        : Boolean(this._ownedMatrixDeleteSectionRowIds?.size);
      const ownedChanges = Boolean(this._ownedMatrixDeleteSectionRowIds?.size || options.allowOwnedChanges);
      if (!hasEditorChanges) {
        return { ok: false, skipped: true, reason: 'no-main-card-changes', method: null };
      }
      if (!ownedChanges) {
        throw new Error('Основная карточка матрицы получила несохранённые изменения, не созданные текущим Apply. Автосохранение остановлено, чтобы не перезаписать параллельную правку.');
      }
      if (!this.mainCard || typeof this.mainCard.clone !== 'function') {
        throw new Error('Не удалось подготовить основную карточку матрицы к сохранению.');
      }
      const card = this.mainCard.clone();
      if (typeof card.removeAllButChanged !== 'function') {
        throw new Error('Текущая версия TESSA не поддерживает безопасную подготовку карточки к сохранению.');
      }
      // Preserve row .state/.changed markers. Calling clean() here destroys the
      // very membership transition the Store request must persist.
      card.removeAllButChanged();

      const req = new this.cards.CardStoreRequest();
      req.card = card;
      if ('affectVersion' in req) req.affectVersion = true;
      const response = await this.cardService.store(req);
      const error = this.validationError(response, 'Не удалось сохранить основную карточку матрицы');
      if (error) throw error;
      this._ownedMatrixDeleteSectionRowIds?.clear?.();
      return {
        ok: true,
        skipped: false,
        method: 'changed-card-store',
        cardId: String(response?.cardId || this.mainCard.id || ''),
        cardVersion: response?.cardVersion ?? null,
      };
    }`;

const newSave = `    async saveMainMatrixAfterApply() {
      // NATIVE_EDITOR_SAVE_CONTRACT_V1
      // Live TESSA evidence shows that the ordinary Save action goes through the
      // card editor pipeline and then produces CardService.store -> CardService.get.
      // Do not synthesize a partial CardStoreRequest here: client/server extensions
      // attached by the editor are part of the platform save contract.
      const methodName = typeof this.editor?.saveCard === 'function'
        ? 'saveCard'
        : typeof this.editor?.trySaveCard === 'function'
          ? 'trySaveCard'
          : null;
      if (!methodName) {
        throw new Error('Текущая версия TESSA не предоставляет штатный метод сохранения карточки editor.saveCard/trySaveCard.');
      }
      const outcome = await this.editor[methodName]();
      if (outcome === false) throw new Error('Штатное сохранение основной карточки TESSA было отклонено.');
      this.mainCard = this.editor?.cardModel?.card || this.mainCard;
      return {
        ok: true,
        skipped: false,
        method: 'native-editor-save',
        editorMethod: methodName,
        cardId: String(this.mainCard?.id || ''),
        cardVersion: this.mainCard?.version ?? null,
      };
    }`;
replaceOnce(oldSave, newSave, 'saveMainMatrixAfterApply native editor pipeline');

const oldDelete = `    async deleteMatrixRow(versionId) {
      // Native matrix membership is a collection row on the main card. Stage that
      // row as Deleted and let the ordinary changed-card Store persist the deletion.
      // RowID/RowRowID are never treated as CardID.
      return stageMatrixRowDelete.call(this, versionId);
    }`;
const newDelete = `    async deleteMatrixRow(versionId) {
      // NATIVE_DELETE_REQUEST_CONTRACT_V1
      // Captured from the live Cherkizovo TESSA client: native row deletion is a
      // custom CardRequest against the matrix card. Local MtxRouteMatrixRows stays
      // unchanged/clean while this request runs; the following native Save is separate.
      const req = new this.cards.CardRequest();
      req.requestType = REQUEST.DeleteRow;
      req.cardId = this.mainCard.id;
      req.info.MatrixRowVersionID = this.TypedField.createGuid(versionId);
      const response = await this.cardService.request(req);
      const error = this.validationError(response, \`Не удалось удалить строку \${versionId}\`);
      if (error) throw error;
      return response;
    }`;
replaceOnce(oldDelete, newDelete, 'deleteMatrixRow native DeleteRow request');

replaceOnce(
  "    const acceptedCount = (result?.rows || []).filter(row => row?.status === 'ok' || row?.status === 'staged').length;",
  "    const acceptedCount = (result?.rows || []).filter(row => row?.status === 'ok').length;",
  'persist accepted count',
);

replaceOnce(
  "        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'staged' });",
  "        result.rows.push({ type: 'delete', versionId: action.currentRow.versionId, status: 'ok' });",
  'DELETE result accepted after native request',
);

const stagedAccounting = `    const stagedDeletes = result.rows.filter(row => row.type === 'delete' && row.status === 'staged');
    if (stagedDeletes.length) {
      if (result.matrixSave.ok) {
        stagedDeletes.forEach(row => { row.status = 'ok'; });
      } else {
        const reason = result.matrixSave.error || result.matrixSave.reason || 'Основная карточка матрицы не сохранена.';
        stagedDeletes.forEach(row => { row.status = 'skipped'; row.reason = reason; });
        for (let index = receipts.length - 1; index >= 0; index -= 1) {
          if (receipts[index]?.type === 'delete') receipts.splice(index, 1);
        }
        for (const prepared of readyDeletes) {
          result.skipped.push(makeSkippedRow(null, reason, 'store-delete-membership', 'delete'));
        }
      }
    }
`;
replaceOnce(stagedAccounting, '', 'remove staged DELETE accounting');

fs.writeFileSync(file, code);
console.log('Applied live native TESSA DeleteRow + editor Save contract');
