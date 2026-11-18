function canonicalMongoTool(tool) {
  const value = String(tool || '').trim();
  return value.replace(/^arctic_/, 'mongo_');
}

const item = $input.first().json || {};
const unit = {
  ...(item.unit || {}),
  tool: canonicalMongoTool(item?.unit?.tool)
};
const deps = Array.isArray(unit.depends_on) ? unit.depends_on.map(Number).filter(Number.isFinite) : [];

const chainKey = 'chain_' + (item.chatSessionId || 'default');
const sd = $getWorkflowStaticData('global');
const globalCompleted = Array.isArray(sd[chainKey]) ? sd[chainKey] : [];
const localCompleted = Array.isArray(item.completed_units) ? item.completed_units : [];

function unitIdOf(u) {
  if (!u || typeof u !== 'object') return null;
  if (u.unit_id != null) return Number(u.unit_id);
  if (u.unit && u.unit.unit_id != null) return Number(u.unit.unit_id);
  return null;
}

function normalizeCompletedUnit(u) {
  if (!u || typeof u !== 'object') return null;

  const id = unitIdOf(u);
  if (id == null || !Number.isFinite(id)) return null;

  return {
    ...u,
    unit_id: id,
    tool: canonicalMongoTool(u.tool || (u.unit && u.unit.tool) || ''),
    execution_status: u.execution_status || '',
    answer: u.answer || '',
    executor_answer: u.executor_answer || u.tool_answer || '',
    tag_selection_trace: u.tag_selection_trace || null,
    // CANDIDATE_VALIDATION_GATE_V5
    resolved_tags: Array.isArray(u.resolved_tags) ? u.resolved_tags : [],
    raw_result: u.raw_result || null,
    normalized_result: u.normalized_result || null
  };
}

function mergeCompleted(local, global) {
  const out = [];
  const seen = new Set();

  for (const src of [local, global]) {
    for (const raw of src || []) {
      const u = normalizeCompletedUnit(raw);
      if (!u) continue;
      const id = Number(u.unit_id);

      if (!seen.has(id)) {
        seen.add(id);
        out.push(u);
        continue;
      }

      const idx = out.findIndex(x => Number(x.unit_id) === id);
      if (idx >= 0) {
        const prev = out[idx];
        const prevScore = scoreCompleted(prev);
        const nextScore = scoreCompleted(u);
        if (nextScore >= prevScore) out[idx] = u;
      }
    }
  }

  return out;
}

function scoreCompleted(u) {
  let s = 0;
  if (u.execution_status === 'SUCCESS') s += 10;
  if (u.execution_status === 'DATE_RANGE_NO_DATA') s += 8;
  if (u.execution_status === 'PARTIAL_DATA_COVERAGE') s += 8;
  if (u.answer) s += 2;
  if (u.executor_answer) s += 2;
  if (Array.isArray(u.tag_selection_trace) && u.tag_selection_trace.length) s += 5;
  if (u.raw_result) s += 1;
  return s;
}

function extractStepRefs(params) {
  const refs = new Set();
  const s = JSON.stringify(params || {});
  const re = /\$ref:(?:step_?)?(\d+)\./g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) refs.add(n);
  }
  return refs;
}

function parseTagsFromText(text) {
  const s = String(text || '');
  const tags = [];

  // Matches common DCS tag patterns such as TRC3202.PV, FT3231.PV, PI1701.PV
  const re = /\b[A-Z]{1,6}[A-Z0-9_]*\d{2,6}[A-Z0-9_]*\.PV\b/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    tags.push(m[0]);
  }

  // Also keep LIMS/catalyst/emissions tags such as LCO04_D86V095, DG002_H2VolP,
  // EcatAct, StackFG_SO2, and Sample_NOx. These do not use the .PV suffix.
  const structuredTag = /\b(?:[A-Za-z][A-Za-z0-9]*\d[A-Za-z0-9]*_[A-Za-z0-9]+|(?:Ecat|Scat|SRcat)[A-Za-z0-9]+|(?:StackFG|Sample)_[A-Za-z0-9]+)\b/g;
  while ((m = structuredTag.exec(s)) !== null) {
    tags.push(m[0]);
  }

  return Array.from(new Set(tags));
}

function tagSearchRejectedAll(u) {
  if (!u || u.tool !== 'mongo_find_tags') return false;
  const text = (
    String(u.executor_answer || '') + '\n' +
    String(u.answer || '') + '\n' +
    JSON.stringify(u.normalized_result || {})
  ).toLowerCase();

  return /no\s+(?:direct|usable|relevant|matching)\s+tags|no\s+tags\s+(?:found|matching)|none\s+(?:of\s+the\s+)?(?:returned\s+)?(?:candidate\s+)?tags?\s+(?:directly\s+)?(?:match|measure)|all\s+(?:returned\s+)?candidates?\s+(?:were\s+)?rejected|all\s+.*rejected|did\s+not\s+find\s+any\s+matching\s+tags|returned\s+zero\s+results|not\s+directly\s+measure|not\s+a\s+direct\s+measurement|none\s+were\s+selected|none\s+of\s+(?:these|the)\s+tags?\s+measure|no\s+tags?\s+directly\s+(?:match|matching|measure|measures)|no\s+tags?\s+matched|未找到.*标签|没有.*匹配|无.*标签/.test(text);
}

function tagsFromUnit(u) {
  if (!u) return [];

  if (Array.isArray(u.resolved_tags) && u.resolved_tags.length) {
    return Array.from(new Set(
      u.resolved_tags.map(String).map(value => value.trim()).filter(Boolean)
    ));
  }

  if (Array.isArray(u.tag_selection_trace)) {
    const accepted = u.tag_selection_trace
      .filter(x => x && x.tag)
      .filter(x => {
        const matchType = String(x.match_type || '').trim().toLowerCase();
        if (x.selected === false) return false;
        if (matchType === 'reject' || matchType === 'rejected' || matchType === 'no_clear_match') return false;
        return true;
      })
      .map(x => x.tag)
      .filter(Boolean);
    if (accepted.length) return Array.from(new Set(accepted));

    const directOrContextual = u.tag_selection_trace
      .filter(x => x && x.tag && x.selected !== false)
      .filter(x => /direct|contextual|secondary/i.test(String(x.match_type || '')))
      .map(x => x.tag)
      .filter(Boolean);
    if (directOrContextual.length) return Array.from(new Set(directOrContextual));

    if (u.tag_selection_trace.length) return [];
  }

  // STRICT_VERTICAL_SELECTION_V5
  // Multi-query selection is valid only through structured trace/resolved tags.
  // Never promote tag-shaped prose or the candidate catalog after format loss.
  if (Array.isArray(u?.params?.queries)) return [];

  const raw = u.raw_result;
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.tags)) {
      const arr = raw.tags.map(x => typeof x === 'string' ? x : x && x.tag).filter(Boolean);
      if (arr.length) return Array.from(new Set(arr));
    }
    if (Array.isArray(raw.results)) {
      const arr = raw.results.map(x => typeof x === 'string' ? x : x && (x.tag || x.name)).filter(Boolean);
      if (arr.length) return Array.from(new Set(arr));
    }
  }

  // PARTIAL_TAG_RESULT_PRECEDENCE_V5
  // Apply whole-result rejection language only after structured selections and
  // raw tool output have been exhausted. A partial-match explanation can
  // legitimately contain both selected tags and descriptions of missing ones.
  if (tagSearchRejectedAll(u)) return [];

  const text =
    String(u.executor_answer || '') + '\n' +
    String(u.answer || '') + '\n' +
    JSON.stringify(u.normalized_result || {});

  return parseTagsFromText(text);
}

function probeTagsFromUnit(u) {
  if (!u || u.tool !== 'mongo_find_tags') return [];
  const sources = [u.raw_result, u.normalized_result?.raw_result];
  for (const source of sources) {
    if (!source || !Array.isArray(source.probe_tags)) continue;
    const tags = source.probe_tags.map(String).map(value => value.trim()).filter(Boolean);
    if (tags.length) return Array.from(new Set(tags));
  }
  // Unit Accumulator intentionally compacts raw_result, but preserves the
  // semantic trace. Recover only direct/contextual candidates from that trace
  // for existence probing; their selected/match_type status remains unchanged.
  return Array.from(new Set(
    (Array.isArray(u.tag_selection_trace) ? u.tag_selection_trace : [])
      .filter(entry => entry && entry.tag)
      .filter(entry => /direct|contextual|secondary/i.test(String(entry.match_type || '')))
      .map(entry => String(entry.tag).trim())
      .filter(Boolean)
  ));
}

function isSatisfied(depUnit) {
  if (!depUnit) return false;

  // Tag discovery only satisfies downstream data dependencies when usable tags
  // were actually selected or extracted. A successful no-match tag search should
  // block its paired stats/read unit instead of leaking "$ref:stepN.tags".
  if (depUnit.tool === 'mongo_find_tags') {
    return tagsFromUnit(depUnit).length > 0;
  }

  const s = depUnit.execution_status;
  if (s === 'SUCCESS') return true;
  if (s === 'PARTIAL_DATA_COVERAGE') return true;
  if (s === 'DATE_RANGE_NO_DATA') return true;

  return false;
}

function inferBlockedJudgment(tool) {
  const notes = {
    mongo_read: 'Cannot read sensor time-series data; actual operating parameter comparison is blocked',
    mongo_stats: 'Cannot compute statistics; operating range assessment is blocked',
    mongo_find_tags: 'Cannot discover sensor tags; downstream tag-dependent steps are blocked',
    mongo_describe: 'Cannot retrieve data schema',
    mongo_analyze: 'Cannot compute MongoDB historian analysis tables; correlation, lag, anomaly, or baseline analysis is blocked',
    mean_tool: 'Cannot compute averages; numerical analysis is blocked',
    postgres_query: 'Cannot query structured data table',
    neo4j_query: 'Cannot execute graph query',
    ragflow_retrieval: 'Cannot retrieve knowledge-base documents',
  };

  return notes[tool] || ('Step ' + tool + ' cannot execute due to unmet dependency');
}

const completed = mergeCompleted(localCompleted, globalCompleted);

// DOCUMENT_BOUND_TAG_PROMOTION_V7
// 单题实测（exec 142408）：位号检索把 PDRA3125.PV「沉降器与二再差压」判为 contextual_match、未选中，
// 依赖它的阈值检索被判依赖未满足、全时段分析解析不出测点列；而同一轮已完成检索的装置文档原文写着
// 「催化裂化反再两器差压(FC-PDRA3125.PV)」。规则：本轮已完成检索的文档里，候选位号紧邻的名称
// 覆盖了该位号所属工艺量名称的全部字，即视为有文档依据的直接匹配；目录描述与之完全相同的冗余位号一并选中。
// 只提升 contextual/secondary，不动 reject；依据写进 trace 的 promotion 字段。
(function () {
  try {
    const docText = completed
      .filter(u => u && u.tool === 'ragflow_retrieval')
      .map(u => { try { return JSON.stringify(u); } catch (e) { return ''; } })
      .join('\n');
    if (!docText) return;
    const esc = x => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const charsOf = x => Array.from(String(x || '')
      .replace(/[（(][^）)]*[）)]/g, '')
      .replace(/[\s\p{P}\p{S}A-Za-z0-9]/gu, ''));
    // F59：exec 142964 的位号检索 trace 没有 process_factor，F58 没有触发。名称除 process_factor 外补上设备上下文的
    // 名称与别名（括号内外分开）；覆盖判定改为「名称 ≥3 个字、label 覆盖其中 ≥3 个且 ≥60%」。
    const covers = (label, factor) => {
      const f = Array.from(new Set(charsOf(factor)));
      if (f.length < 3) return false;
      const l = new Set(charsOf(label));
      const hit = f.filter(ch => l.has(ch)).length;
      return hit >= 3 && hit / f.length >= 0.6;
    };
    const __deviceNames = (function () {
      try {
        const d = ((($('Parse Device Context').first().json || {}).device_context) || {}).device || {};
        const names = [d.canonical_name].concat(Array.isArray(d.aliases) ? d.aliases : []).map(x => String(x || '').trim()).filter(Boolean);
        const out = [];
        for (const n of names) {
          out.push(n.replace(/[（(][^）)]*[）)]/g, ''));
          for (const m of n.matchAll(/[（(]([^）)]*)[）)]/g)) out.push(m[1]);
        }
        return out.filter(Boolean);
      } catch (e) { return []; }
    })();
    const labelsFor = tag => {
      const base = String(tag || '').toUpperCase().replace(/\.[A-Z]{1,4}$/, '');
      if (!/^[A-Z]{1,6}\d{2,6}[A-Z]?$/.test(base)) return [];
      const T = '(?<![A-Za-z0-9])(?:[A-Z]{1,4}[-_])?' + esc(base) + '(?![A-Za-z0-9])(?:\\.[A-Z]{1,4})?';
      const out = [];
      const before = new RegExp('([^、，,；;。：:\\s()（）\\[\\]"\\\\|]{2,40})\\s*[（(]\\s*' + T + '\\s*[)）]', 'g');
      const after = new RegExp(T + '\\s*[（(]([^()（）"\\\\]{2,40})[)）]', 'g');
      let m;
      while ((m = before.exec(docText)) !== null) out.push(m[1]);
      while ((m = after.exec(docText)) !== null) out.push(m[1]);
      return out;
    };
    const promotable = x => x && x.tag && x.selected !== true && /contextual|secondary/i.test(String(x.match_type || ''));
    const descOf = x => String(x.desc_cn || x.desc_en || x.description || '').trim();
    for (const u of completed) {
      if (!u || u.tool !== 'mongo_find_tags' || !Array.isArray(u.tag_selection_trace)) continue;
      const factorOf = x => String(x.process_factor || (u.params && u.params.factor_query) || '').trim();
      const bound = [];
      for (const x of u.tag_selection_trace) {
        if (!promotable(x)) continue;
        const names = [factorOf(x)].concat(__deviceNames).filter(Boolean);
        let label = '', factor = '';
        for (const l of labelsFor(x.tag)) {
          const hitName = names.find(nm => covers(l, nm));
          if (hitName) { label = l; factor = hitName; break; }
        }
        if (label) bound.push({ entry: x, promotion: { policy: 'DOCUMENT_BOUND_TAG_PROMOTION_V7', document_label: label, factor } });
      }
      if (!bound.length) continue;
      const boundDescs = new Set(bound.map(b => descOf(b.entry)).filter(Boolean));
      for (const x of u.tag_selection_trace) {
        if (!promotable(x) || bound.some(b => b.entry === x)) continue;
        if (descOf(x) && boundDescs.has(descOf(x))) {
          bound.push({ entry: x, promotion: { policy: 'DOCUMENT_BOUND_TAG_PROMOTION_V7', same_catalog_description: descOf(x), factor: factorOf(x) } });
        }
      }
      for (const b of bound) {
        b.entry.promoted_from = b.entry.match_type;
        b.entry.match_type = 'direct_match';
        b.entry.selected = true;
        b.entry.promotion = b.promotion;
      }
      const prev = Array.isArray(u.resolved_tags) ? u.resolved_tags : [];
      u.resolved_tags = Array.from(new Set(prev.concat(bound.map(b => b.entry.tag))));
    }
  } catch (e) {}
})();

if (!deps.length) {
  return [{
    json: {
      ...item,
      unit,
      completed_units: completed,
      dependency_ok: true
    }
  }];
}

const byId = {};
for (const c of completed) {
  byId[Number(c.unit_id)] = c;
}

const tool = String(unit.tool || '');
const stepRefs = extractStepRefs(unit.params || {});
const __tagRebinds = [];
const paramsString = JSON.stringify(unit.params || {});
const hasTagRuntimeRef = /\$ref:(?:step_?)?\d+\.(tags|probe_tags|columns)\b/.test(paramsString);
const isMongoDataTool = tool === 'mongo_read' || tool === 'mongo_stats' || tool === 'mongo_analyze';
const anyTagSource = completed.find(u =>
  u.tool === 'mongo_find_tags' &&
  tagsFromUnit(u).length > 0
);

// PARTIAL_FACTOR_DEPENDENCY_GATE_V5
// A multi-factor existence check intentionally combines several independent
// tag searches. Missing candidates for one factor must not suppress statistics
// for factors that did resolve. Single-reference data chains remain strict.
const columnValues = Array.isArray(unit?.params?.columns) ? unit.params.columns : [];
const columnRefIds = columnValues
  .map(value => {
    const match = /^\$ref:(?:step_?)?(\d+)\.(?:tags|probe_tags)$/i.exec(String(value || '').trim());
    return match ? Number(match[1]) : null;
  })
  .filter(Number.isFinite);
const probeRefIds = columnValues
  .map(value => {
    const match = /^\$ref:(?:step_?)?(\d+)\.probe_tags$/i.exec(String(value || '').trim());
    return match ? Number(match[1]) : null;
  })
  .filter(Number.isFinite);
const isPartialFactorAggregate =
  (tool === 'mongo_stats' || tool === 'mongo_read') &&
  columnRefIds.length > 1 &&
  columnRefIds.every(id => deps.includes(id));
const aggregateHasUsableTags = isPartialFactorAggregate && columnRefIds.some(id => {
  const source = completed.find(entry => Number(entry.unit_id) === id);
  const tags = probeRefIds.includes(id) ? probeTagsFromUnit(source) : tagsFromUnit(source);
  return source && source.tool === 'mongo_find_tags' && tags.length > 0;
});

let failedDepIds = [];

for (const depId of deps) {
  const depUnit = byId[depId];

  // A probe_tags reference deliberately asks the data layer to check both
  // direct selections and semantic candidates for non-null existence. This
  // does not promote candidates to calculation-ready inputs.
  if (
    isMongoDataTool &&
    probeRefIds.includes(depId) &&
    depUnit?.tool === 'mongo_find_tags' &&
    probeTagsFromUnit(depUnit).length > 0
  ) {
    continue;
  }

  // CATALOG_PROBES_JOIN_DATA_CHAIN_V7：主目录查询与声明的备份查询任一有位号即视为满足；备份查询零命中不单独拦截。
  const __probeIds = Array.isArray(unit && unit.params && unit.params.catalog_probe_unit_ids)
    ? unit.params.catalog_probe_unit_ids.map(Number).filter(Number.isFinite) : [];
  if (__probeIds.length && (__probeIds.includes(depId) || (depUnit && depUnit.tool === 'mongo_find_tags'))) {
    const __group = Array.from(new Set(deps.filter(id => __probeIds.includes(id) || (byId[id] && byId[id].tool === 'mongo_find_tags'))))
      .map(id => byId[id]).filter(Boolean);
    if (__group.some(g => tagsFromUnit(g).length > 0)) continue;
  }

  if (isSatisfied(depUnit)) continue;

  if (
    aggregateHasUsableTags &&
    columnRefIds.includes(depId) &&
    depUnit &&
    depUnit.tool === 'mongo_find_tags'
  ) {
    continue;
  }

  // RAG context for tag discovery is enrichment, not a hard data dependency.
  // If one optional inventory retrieval found no evidence, still let MongoDB historian tag
  // search use the other completed RAG outputs.
  if (
    tool === 'mongo_find_tags' &&
    depUnit &&
    depUnit.tool === 'ragflow_retrieval' &&
    depUnit.execution_status === 'NO_EVIDENCE'
  ) {
    continue;
  }

  // The RAG-to-MongoDB historian factor extractor can work from partial RAG evidence.
  // If one language/profile branch has no evidence, do not block extraction
  // as long as completed successful RAG units are available in the chain.
  if (
    tool === 'rag_factor_extraction' &&
    depUnit &&
    depUnit.tool === 'ragflow_retrieval' &&
    depUnit.execution_status === 'NO_EVIDENCE'
  ) {
    continue;
  }

  // Explicit tag references are strict: a data step with "$ref:stepN.tags"
  // can run only after that exact mongo_find_tags unit has produced usable
  // tags. Do not recover from a different tag step here; doing so can leak a
  // literal unresolved reference into MongoDB historian or mix tags across factors.
  if (isMongoDataTool && (stepRefs.has(depId) || hasTagRuntimeRef)) {
    const depIsTagDiscovery = depUnit && depUnit.tool === 'mongo_find_tags';
    const depHasTags = depIsTagDiscovery && tagsFromUnit(depUnit).length > 0;
    if (depHasTags) {
      continue;
    }

    // mongo_analyze is a multi-target summary. Let it proceed when a factor
    // tag-search dependency completed but selected no usable tags; Param Injector
    // will resolve that target to [] and drop it. Stats/read remain strict.
    if (tool === 'mongo_analyze' && depIsTagDiscovery) {
      continue;
    }

    // TAG_SOURCE_REBIND_V7
    // 实测 exec 136382：unit 1 的位号查询解析出 0 个，unit 3 同样是
    // mongo_find_tags 却解析出 PDRA3125.PV/PDRA3125B.PV，而数据单元绑的是
    // unit 1，于是整轮拿不到数据。上面那条严格规则担心两件事——未解析的
    // $ref 泄进 MongoDB historian、多因子场景混淆位号——这里把两条都堵住再放行：
    // 只在被依赖方「一个都没有」且全轮「有且只有一个」成功来源时改指，
    // 并同步把 params 里的 $ref:stepN 重写到新来源，不留字面量。
    if (depIsTagDiscovery && tagsFromUnit(depUnit).length === 0) {
      const __sources = completed.filter(u =>
        u.tool === 'mongo_find_tags' &&
        Number(u.unit_id) !== Number(depId) &&
        tagsFromUnit(u).length > 0
      );
      if (__sources.length === 1) {
        const __src = __sources[0];
        const __before = JSON.stringify(unit.params || {});
        const __after = __before.replace(
          new RegExp('\\$ref:(?:step_?)' + depId + '\\.', 'g'),
          '$ref:step' + __src.unit_id + '.'
        );
        if (__after !== __before) {
          try {
            unit.params = JSON.parse(__after);
            __tagRebinds.push({
              from_unit_id: depId,
              to_unit_id: __src.unit_id,
              tags: tagsFromUnit(__src).slice(0, 6)
            });
            continue;
          } catch (e) {
            // 解析失败就维持原样阻断，不冒险放行
          }
        }
      }
    }
  }

  failedDepIds.push(depId);
}

if (!failedDepIds.length) {
  return [{
    json: {
      ...item,
      unit,
      completed_units: completed,
      dependency_ok: true,
      tag_rebinds: __tagRebinds
    }
  }];
}

const firstFailedUnit = byId[failedDepIds[0]];

return [{
  json: {
    ...item,
    unit,
    completed_units: completed,
    dependency_ok: false,
    execution_status: 'DEPENDENCY_BLOCKED',
    answer: 'Dependency not met: step cannot execute.',
    evidence_summary: [],
    blocked_by_unit_id: failedDepIds[0] != null ? failedDepIds[0] : null,
    blocked_by_tool: (firstFailedUnit && firstFailedUnit.tool) || 'unknown',
    blocked_by_status: (firstFailedUnit && firstFailedUnit.execution_status) || 'unknown',
    blocked_judgment_note: inferBlockedJudgment(tool),
    all_blocked_dep_ids: failedDepIds
  }
}];
