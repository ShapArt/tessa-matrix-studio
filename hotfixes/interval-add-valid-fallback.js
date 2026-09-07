(() => {
  'use strict';

  const INSTALL_KEY = '__TMS_INSTALL_INTERVAL_ADD_VALID_FALLBACK__';
  const PATCH_KEY = Symbol.for('tessa-matrix-studio.interval-add-valid-fallback.v1');

  function installIntervalAddValidFallback(proto) {
    if (!proto || typeof proto !== 'object') throw new Error('TESSA Matrix Studio: invalid TessaBridge prototype for interval fallback.');
    if (proto[PATCH_KEY]) return proto[PATCH_KEY];

    const originalCreateRowCard = proto.createRowCard;
    const originalRebuildRowCard = proto.rebuildRowCard;
    const originalValidateDuplicate = proto.validateDuplicate;
    if (typeof originalCreateRowCard !== 'function'
      || typeof originalRebuildRowCard !== 'function'
      || typeof originalValidateDuplicate !== 'function') {
      throw new Error('TESSA Matrix Studio: interval fallback cannot bind required TessaBridge methods.');
    }

    const holderByCard = new WeakMap();
    const dynamicKeys = ['card', 'cardId', 'versionId', 'newMethod', 'diagnosticNewMode', 'intervalExtractorFallback'];

    proto.createRowCard = async function patchedCreateRowCard(templateId) {
      const initial = await originalCreateRowCard.call(this, templateId);
      if (!initial?.card) return initial;

      const holder = {
        current: initial,
        templateId,
        rebuildArgs: null,
        retrying: false,
      };
      holderByCard.set(initial.card, holder);

      // Preflight keeps the returned object and later spreads it into preparedAdds.
      // Accessors make that spread observe the server-accepted Valid card if the
      // first duplicate-check hit only the known interval extractor defect.
      const facade = {};
      for (const key of dynamicKeys) {
        Object.defineProperty(facade, key, {
          enumerable: true,
          configurable: false,
          get() { return holder.current?.[key]; },
        });
      }
      for (const [key, value] of Object.entries(initial)) {
        if (!(key in facade)) facade[key] = value;
      }
      return facade;
    };

    proto.rebuildRowCard = function patchedRebuildRowCard(card, versionId, excelRow, structure, snapshot) {
      const holder = card && typeof card === 'object' ? holderByCard.get(card) : null;
      if (holder && !holder.retrying) {
        holder.rebuildArgs = { excelRow, structure, snapshot };
      }
      return originalRebuildRowCard.call(this, card, versionId, excelRow, structure, snapshot);
    };

    proto.validateDuplicate = async function patchedValidateDuplicate(card, versionId) {
      const holder = card && typeof card === 'object' ? holderByCard.get(card) : null;
      try {
        return await originalValidateDuplicate.call(this, card, versionId);
      } catch (error) {
        if (error?.code !== 'duplicate-interval-extractor'
          || !holder
          || holder.retrying
          || !holder.rebuildArgs
          || typeof this.createDiagnosticRowCard !== 'function') {
          throw error;
        }

        holder.retrying = true;
        try {
          // CardNewMode.Valid is a second CardNew only. Nothing is stored here.
          // The same desired row is rebuilt and the SAME server ValidateDuplicate
          // contract must allow it before this card can reach preparedAdds/Store.
          const valid = await this.createDiagnosticRowCard(holder.templateId, 'Valid');
          if (!valid?.card || !valid?.versionId) throw error;
          const { excelRow, structure, snapshot } = holder.rebuildArgs;
          originalRebuildRowCard.call(this, valid.card, valid.versionId, excelRow, structure, snapshot);
          await originalValidateDuplicate.call(this, valid.card, valid.versionId);

          valid.intervalExtractorFallback = 'CardNewMode.Valid';
          holder.current = valid;
          holderByCard.set(valid.card, holder);
          console.warn('[TESSA Matrix Studio] ValidateDuplicate rejected default CardNew with duplicate-interval-extractor; CardNewMode.Valid passed the same server validation and will be used for this ADD.');
          return;
        } finally {
          holder.retrying = false;
        }
      }
    };

    const state = Object.freeze({
      installed: true,
      mode: 'CardNewMode.Valid',
      reasonCode: 'duplicate-interval-extractor',
      validatesAgain: true,
      bypassesDuplicateCheck: false,
    });
    Object.defineProperty(proto, PATCH_KEY, { value: state, enumerable: false, configurable: false });
    return state;
  }

  window[INSTALL_KEY] = installIntervalAddValidFallback;
  const exports = window.__TESSA_MATRIX_SYNC_EXPORTS__;
  if (exports?.TessaBridge?.prototype) {
    try {
      installIntervalAddValidFallback(exports.TessaBridge.prototype);
    } catch (error) {
      console.error('[TESSA Matrix Studio] Failed to install interval ADD fallback.', error);
    }
  }
})();
