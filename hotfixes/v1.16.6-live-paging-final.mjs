import fs from 'node:fs';

const BUILD = 'TMS_V1_16_6_PAGING_V7_VALIDATED_OFFSETS';
function once(source,before,after,label){const n=source.split(before).length-1;if(n!==1)throw new Error(`${label}: expected 1, got ${n}`);return source.replace(before,after)}
export function apply(input){
 let s=String(input??'');
 if(s.includes(`pagingFinalBuild: '${BUILD}'`)) return s;
 s=once(s,"    pagingXlsxFixBuild: 'TMS_V1_16_4_PAGING_V5_XLSX_EDIT_V3',\n","    pagingXlsxFixBuild: 'TMS_V1_16_4_PAGING_V5_XLSX_EDIT_V3',\n    pagingFinalBuild: '"+BUILD+"',\n",'build');
 s=once(s,'    // SERVER_PAGED_NATIVE_VIEW_V5\n','    // SERVER_PAGED_NATIVE_VIEW_V5\n    // SERVER_PAGED_NATIVE_VIEW_V6\n    // SERVER_PAGED_NATIVE_VIEW_V7\n','markers');
 s=once(s,"        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V5',\n        build: APP.buildFingerprint || null,","        format: 'TESSA_SERVER_VIEW_PAGING_DIAGNOSTICS_V7',\n        build: APP.pagingFinalBuild || APP.pagingXlsxFixBuild || APP.buildFingerprint || null,",'diagnostics');
 s=once(s,"      let reportedRowCount = 0;\n","      let reportedRowCount = 0;\n      let lastAcceptedOffset = null;\n      let previousPageVersions = [];\n",'paging state');
 s=once(s,"      const withoutPaging = list => normalizeParameterList(list)\n        .filter(item => !/^(?:pageoffset|pagelimit)$/i.test(parameterName(item).replace(/s+/g, '')));\n      const pageParamEvidence = parameters => normalizeParameterList(parameters).map(item => ({\n        name: parameterName(item),\n        value: safePlain(item?.value ?? item?.Value ?? item?.values ?? item?.Values ?? null, { maxDepth: 3, maxKeys: 20, maxArray: 20 }),\n      })).filter(item => /pageoffset|pagelimit/i.test(item.name));\n      const hasExplicitPaging = parameters => {\n        const names = new Set(pageParamEvidence(parameters).map(item => canonicalValue(item.name).replace(/\\s+/g, '')));\n        return names.has(canonicalValue('PageLimit')) && names.has(canonicalValue('PageOffset'));\n      };\n",
`      const withoutPaging = list => normalizeParameterList(list)
        .filter(item => !/^(?:pageoffset|pagelimit)$/i.test(parameterName(item).replace(/\\s+/g, '')));
      const requestParameterValue = item => {
        const direct = item?.value ?? item?.Value ?? item?.values ?? item?.Values;
        if (direct !== null && direct !== undefined) return safePlain(direct, { maxDepth: 4, maxKeys: 30, maxArray: 30 });
        const criteria = item?.criteriaValues ?? item?.CriteriaValues ?? [];
        try {
          for (const criterion of Array.from(criteria || [])) {
            const values = criterion?.values ?? criterion?.Values ?? [];
            for (const criterionValue of Array.from(values || [])) {
              const value = criterionValue?.value ?? criterionValue?.Value;
              if (value !== null && value !== undefined) return safePlain(value, { maxDepth: 4, maxKeys: 30, maxArray: 30 });
            }
          }
        } catch (_) {}
        return null;
      };
      const pageParamEvidence = parameters => normalizeParameterList(parameters).map(item => ({
        name: parameterName(item),
        value: requestParameterValue(item),
      })).filter(item => /pageoffset|pagelimit/i.test(item.name));
      const hasExplicitPaging = parameters => {
        const names = new Set(pageParamEvidence(parameters).map(item => canonicalValue(item.name).replace(/\\s+/g, '')));
        return names.has(canonicalValue('PageLimit')) && names.has(canonicalValue('PageOffset'));
      };
      const pagingNumber = value => {
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (typeof value === 'string' && value.trim()) {
          const parsed = Number(value.trim().replace(',', '.'));
          return Number.isFinite(parsed) ? parsed : null;
        }
        if (Array.isArray(value) && value.length === 1) return pagingNumber(value[0]);
        if (value && typeof value === 'object') {
          for (const key of ['value', 'Value', 'item2', 'Item2']) {
            if (value[key] !== null && value[key] !== undefined) {
              const parsed = pagingNumber(value[key]);
              if (parsed !== null) return parsed;
            }
          }
        }
        return null;
      };
      const pagingValues = parameters => {
        const evidence = pageParamEvidence(parameters);
        const limitEntry = evidence.find(item => canonicalValue(item.name).replace(/\\s+/g, '') === canonicalValue('PageLimit'));
        const offsetEntry = evidence.find(item => canonicalValue(item.name).replace(/\\s+/g, '') === canonicalValue('PageOffset'));
        return { limit: pagingNumber(limitEntry?.value), offset: pagingNumber(offsetEntry?.value) };
      };
      const isPagingUsableForPage = (parameters, page, previousOffset = null) => {
        if (!hasExplicitPaging(parameters)) return false;
        const values = pagingValues(parameters);
        if (!Number.isFinite(values.limit) || values.limit < pageLimit) return false;
        if (!Number.isFinite(values.offset) || values.offset < 0) return false;
        if (page > 1 && previousOffset !== null && values.offset <= previousOffset) return false;
        return true;
      };
`,'paging value decoder');
 s=once(s,"          evidence.outcome = 'built';\n          evidence.paging = pageParamEvidence(built.parameters);\n          diagnostics.attempts.push(evidence);\n          return { ...built, strategy };\n",
`          evidence.paging = pageParamEvidence(built.parameters);
          if (!isPagingUsableForPage(built.parameters, page, lastAcceptedOffset)) {
            evidence.outcome = 'paging-values-invalid';
            evidence.decodedPaging = pagingValues(built.parameters);
            diagnostics.attempts.push(evidence);
            return null;
          }
          evidence.outcome = 'built';
          evidence.decodedPaging = pagingValues(built.parameters);
          diagnostics.attempts.push(evidence);
          return { ...built, strategy };
`,'builder validation');
 s=once(s,'              if (!hasExplicitPaging(parameters)) {\n','              if (!isPagingUsableForPage(parameters, page, lastAcceptedOffset)) {\n','create precheck');
 s=once(s,'                  if (hasExplicitPaging(candidate)) {\n','                  if (isPagingUsableForPage(candidate, page, lastAcceptedOffset)) {\n','setup acceptance');
 s=once(s,'              if (!hasExplicitPaging(parameters)) return null;\n','              if (!isPagingUsableForPage(parameters, page, lastAcceptedOffset)) return null;\n','create final check');
 s=once(s,"          const rowsForPage = rawRows.slice(0, pageLimit);\n          const rowCount = Number(result?.rowCount ?? result?.RowCount ?? 0) || 0;",
`          const rowsForPage = rawRows.slice(0, pageLimit);
          const cellValue = (rawValue, columnName) => {
            if (Array.isArray(rawValue) && rawValue.length >= 2
              && canonicalValue(rawValue[0]) === canonicalValue(columnName)) return resultValue(rawValue[1]);
            const item1 = rawValue?.Item1 ?? rawValue?.item1;
            const item2 = rawValue?.Item2 ?? rawValue?.item2;
            if (item2 !== null && item2 !== undefined && canonicalValue(item1) === canonicalValue(columnName)) return resultValue(item2);
            return resultValue(rawValue);
          };
          const rowCount = Number(result?.rowCount ?? result?.RowCount ?? 0) || 0;`,'cell values');
 s=once(s,'            const rowCardId = resultValue(raw[cardIndex]);\n            const versionId = resultValue(raw[versionIndex]);','            const rowCardId = cellValue(raw[cardIndex], columns[cardIndex]);\n            const versionId = cellValue(raw[versionIndex], columns[versionIndex]);','ids');
 s=once(s,'            const order = orderIndex >= 0 ? resultValue(raw[orderIndex]) : null;','            const order = orderIndex >= 0 ? cellValue(raw[orderIndex], columns[orderIndex]) : null;','order');
 s=once(s,"              source: 'native-view-server-paged-v5',","              source: 'native-view-server-paged-v7',",'source');
 const diagAnchor=`          diagnostics.attempts.push({\n            page,\n            strategy: built.strategy,\n`;
 s=once(s,diagAnchor,`          if (page > 1 && pageVersions.length && previousPageVersions.length
            && pageVersions.slice(0, Math.min(8, pageVersions.length)).every((value, index) => value === previousPageVersions[index])) {
            diagnostics.attempts.push({ page, strategy: built.strategy, executor: execution.executor, outcome: 'duplicate-page-detected', paging: pageParamEvidence(built.parameters), decodedPaging: pagingValues(built.parameters), sampleVersionIds: pageVersions.slice(0, 8) });
            diagnostics.status = \`page-\${page}-duplicate-page-detected\`;
            return null;
          }
          const currentPagingValues = pagingValues(built.parameters);
          lastAcceptedOffset = currentPagingValues.offset;
          previousPageVersions = pageVersions.slice(0, 8);

`+diagAnchor,'duplicate guard');
 s=once(s,'            paging: pageParamEvidence(built.parameters),\n            visiblePageAfter:','            paging: pageParamEvidence(built.parameters),\n            decodedPaging: pagingValues(built.parameters),\n            visiblePageAfter:','decoded evidence');
 s=once(s,'          if (reportedRowCount > 0 && collected.length >= reportedRowCount) break;','          if (!sectionCount && reportedRowCount > 0 && collected.length >= reportedRowCount) break;','rowcount stop');
 s=once(s,"        if (version !== '1.16.4') {\n          throw new Error(`Загружена версия ${version || '(нет)'}, ожидалась 1.16.4.`);\n        }\n        return { detail: `Подтверждён v1.16.4 · ${actualBuild} · ${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",
"        if (version !== '1.16.6') {\n          throw new Error(`Загружена версия ${version || '(нет)'}, ожидалась 1.16.6.`);\n        }\n        return { detail: `Подтверждён v1.16.6 · ${actualBuild} · ${actualPerformanceBuild}.`, data: { version, build: actualBuild, performanceBuild: actualPerformanceBuild } };",'provenance');
 return s;
}
const target=process.argv[2]; if(target){const out=apply(fs.readFileSync(target,'utf8'));fs.writeFileSync(target,out);console.log('v1.16.6 live paging final: OK')}
