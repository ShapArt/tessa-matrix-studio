import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { buildPagingCandidate } from '../tools/build-paging-candidate.mjs';

// Behavioral contract from the supplied TESSA platform bundle (2026-09-23).
// No proprietary bundle, business data, or captured identifiers are committed.
// In particular: named addParameter requires registered metadata; addCriteria
// takes (operator, TEXT, VALUE); serialization requires a scheme field type.
class ParameterMetadata {
  clone() { return Object.assign(new ParameterMetadata(), this); }
}
class ParameterBuilder {
  constructor() { this.parameter = { name: '', criteriaValues: [] }; }
  withMetadata(metadata) { this.parameter.metadata = metadata; this.parameter.name = metadata.alias; return this; }
  withName(name) { this.parameter.name = name; return this; }
  addCriteria(operator, text, value) {
    assert.equal(operator.valuesCount, 1);
    assert.notEqual(text, undefined, 'criteria display text is required');
    this.parameter.criteriaValues.push({ criteriaName: operator.name, values: [{ text, value }] });
    return this;
  }
  asRequestParameter() { return this.parameter; }
}
class ViewRequest {
  constructor(metadata) { this.view = metadata; this.viewAlias = metadata.alias; this.parameters = []; }
  addParameter(nameOrCallback, callback) {
    let parameter;
    if (typeof nameOrCallback === 'function') parameter = nameOrCallback(new ParameterBuilder());
    else {
      const metadata = this.view.parameters.get(nameOrCallback);
      if (!metadata) throw new Error(`Can not add parameter with name '${nameOrCallback}'.`);
      parameter = callback(new ParameterBuilder().withMetadata(metadata));
    }
    this.parameters.push(parameter);
    return this;
  }
  serializeToStorage() {
    return { Parameters: this.parameters.map(parameter => {
      const type = parameter.metadata?.schemeType?.fieldType;
      assert.ok(type, 'Can not serialize view criteria value without view parameter metadata scheme type.');
      const criterion = parameter.criteriaValues[0];
      const { text, value } = criterion.values[0];
      assert.equal(typeof text, 'string');
      assert.equal(typeof value, type === 'Guid' ? 'string' : 'number');
      return { Name: parameter.name, Type: type, Text: text, Value: value, Operator: criterion.criteriaName };
    }) };
  }
}

const temp = process.env.TMS_TEST_SOURCE ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'tms-paging-'));
try {
  const source = fs.readFileSync(process.env.TMS_TEST_SOURCE || buildPagingCandidate(path.join(temp, 'candidate.js')), 'utf8');
  const start = source.indexOf('    async collectNativeMatrixViewLinksServerPaged(options = {}) {');
  const end = source.indexOf('\n    async collectNativeMatrixViewLinksAllPages(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    APP: {}, normalizeSpace: value => String(value ?? '').trim(),
    canonicalValue: value => String(value ?? '').trim().toLowerCase(),
    safePlain: value => value, log() {},
    window: { tessa: { apiLoader: id => {
      assert.equal(id, 660623);
      return { ViewParameterMetadata: ParameterMetadata, SchemeType: { Guid: { fieldType: 'Guid' }, Int32: { fieldType: 'Int' } } };
    } } },
  });
  const collect = vm.runInContext(`({${source.slice(start, end)}}).collectNativeMatrixViewLinksServerPaged`, context);

  async function scenario({ count = 103, registered = false, helpers = false, repeated = false, missingMatrix = false, serializationError = false, missingIdentity = false } = {}) {
    const matrixId = '11111111-1111-4111-8111-111111111111';
    const pageWrites = [];
    const requests = [];
    let mountedHelperCalls = 0;
    const metadata = { alias: 'SyntheticMatrixView', parameters: new Map(), pageLimit: 50 };
    if (registered) for (const name of ['MatrixID', 'PageLimit', 'PageOffset']) {
      metadata.parameters.set(name, Object.assign(new ParameterMetadata(), { alias: name, schemeType: { fieldType: name === 'MatrixID' ? 'Guid' : 'Int' } }));
    }
    const target = { viewMetadata: metadata };
    for (const [key, value] of [['currentPage', 2], ['pageLimit', 50]]) Object.defineProperty(target, key, {
      get: () => value, set: next => { pageWrites.push([key, next]); },
    });
    if (helpers) for (const name of ['createDataRequest', 'getRequestParams', 'setupPagingParameters']) target[name] = () => {
      mountedHelperCalls++; throw new Error('e is not iterable');
    };
    const view = { metadata, async getData(request) {
      assert.equal(request.canUseCache, false);
      const storage = request.serializeToStorage();
      if (serializationError) throw new Error('synthetic serialization failure');
      const parameters = Object.fromEntries(storage.Parameters.map(p => [p.Name, p]));
      assert.equal(parameters.MatrixID.Value, matrixId);
      assert.equal(parameters.MatrixID.Type, 'Guid');
      assert.equal(parameters.PageLimit.Type, 'Int');
      assert.equal(parameters.PageOffset.Type, 'Int');
      assert.equal(parameters.PageLimit.Value, 51);
      assert.equal(parameters.PageOffset.Value, requests.length * 50 + 1);
      assert.equal(request.calculateRowCounting, requests.length === 0);
      requests.push(storage);
      const offset = repeated ? 0 : parameters.PageOffset.Value - 1;
      return { columns: missingIdentity ? ['Other'] : ['MatrixRowID', 'MatrixVersionID', 'Order'], rowCount: count,
        rows: Array.from({ length: Math.max(0, Math.min(51, count - offset)) }, (_, i) => [`row-${offset + i}`, `version-${offset + i}`, offset + i + 1]) };
    } };
    const bridge = {
      mainCard: missingMatrix ? {} : { id: matrixId },
      findNativeMatrixControl: () => ({ target, controlName: 'TestMatrixView', rows: [] }),
      viewApi: () => ({ service: { getByName: () => view }, serviceModule: { TessaViewRequest: ViewRequest }, platformModule: { ViewCriteriaOperators: { EqualsTo: { name: 'Equals', valuesCount: 1 } } } }),
      nativePagingInfo: () => ({ currentPage: target.currentPage, pageLimit: target.pageLimit }),
      rawMatrixSectionLinks: () => Array.from({ length: count }), unwrapTyped: value => value,
    };
    const result = await collect.call(bridge, { pageLimit: 50 });
    return { result, diagnostics: bridge.lastServerPagingDiagnostics, requests, pageWrites, mountedHelperCalls };
  }

  for (const registered of [false, true]) for (const helpers of [true, false]) {
    const run = await scenario({ registered, helpers });
    assert.ok(run.result?.serverPaging, JSON.stringify(run.diagnostics));
    assert.equal(run.result.links.length, 103);
    assert.equal(new Set(run.result.links.map(row => row.versionId)).size, 103);
    assert.equal(run.requests.length, 3);
    assert.deepEqual(run.pageWrites, [], 'even transient paging property writes can trigger MobX/UI reactions');
    assert.equal(run.mountedHelperCalls, 0);
  }
  for (const count of [0, 1, 50, 51, 100, 101]) {
    const run = await scenario({ count });
    assert.equal(run.result?.links.length, count, JSON.stringify(run.diagnostics));
    assert.deepEqual(run.pageWrites, []);
  }
  for (const options of [{ repeated: true }, { missingMatrix: true }, { serializationError: true }, { missingIdentity: true }]) {
    const run = await scenario(options);
    assert.equal(run.result, null, 'failed direct reads must fall back, never claim completeness');
    assert.notEqual(run.diagnostics.status, 'passed');
  }
  console.log('Native paging runtime contract: PASS (14 scenarios, typed wire values, 103 rows, zero UI writes)');
} finally {
  if (temp) fs.rmSync(temp, { recursive: true, force: true });
}
