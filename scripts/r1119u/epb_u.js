(async function(){
function asArray(x) {
  return Array.isArray(x) ? x : [];
}

function asObject(x) {
  return x && typeof x === 'object' && !Array.isArray(x) ? x : {};
}

function asString(x) {
  return typeof x === 'string' ? x.trim() : '';
}

// MONGODB_EVIDENCE_PACKET_BOUNDARY_V1
// Keep the established packet-building logic stable internally while
// enforcing MongoDB naming for all external inputs and emitted evidence.
const MONGO_TO_INTERNAL_TOOL = Object.freeze({
  mongo_find_tags: 'arctic_find_tags',
  mongo_resolve_factors: 'arctic_resolve_factors',
  mongo_read: 'arctic_read',
  mongo_stats: 'arctic_stats',
  mongo_analyze: 'arctic_analyze',
  mongo_describe: 'arctic_describe'
});
const INTERNAL_TO_MONGO_TOOL = Object.freeze(
  Object.fromEntries(Object.entries(MONGO_TO_INTERNAL_TOOL).map(([mongo, internal]) => [internal, mongo]))
);

function replacePacketVocabulary(value, direction) {
  let out = String(value == null ? '' : value);
  const replacements = direction === 'internal'
    ? { ...MONGO_TO_INTERNAL_TOOL, MongoDB: 'ArcticDB', mongodb_: 'arctic_', mongodb: 'arcticdb' }
    : { ...INTERNAL_TO_MONGO_TOOL, ArcticDB: 'MongoDB', arctic_: 'mongodb_', arcticdb: 'mongodb' };
  for (const [from, to] of Object.entries(replacements)) {
    out = out.replace(new RegExp(`\\b${from}`, 'g'), to);
  }
  return out;
}

function packetContractKey(key, direction) {
  if (direction === 'internal') {
    if (MONGO_TO_INTERNAL_TOOL[key]) return MONGO_TO_INTERNAL_TOOL[key];
    if (key.startsWith('mongo_analyze_')) return key.replace(/^mongo_analyze_/, 'arctic_analyze_');
    if (key === 'mongodb_target_registry') return 'arctic_target_registry';
    if (key === 'mongodb') return 'arctic';
    return key;
  }
  if (INTERNAL_TO_MONGO_TOOL[key]) return INTERNAL_TO_MONGO_TOOL[key];
  if (key.startsWith('arctic_analyze_')) return key.replace(/^arctic_analyze_/, 'mongo_analyze_');
  if (key === 'arctic_target_registry') return 'mongodb_target_registry';
  if (key === 'arctic') return 'mongodb';
  return key;
}

function translatePacketContract(value, direction) {
  if (Array.isArray(value)) return value.map(v => translatePacketContract(v, direction));
  if (typeof value === 'string') return replacePacketVocabulary(value, direction);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[packetContractKey(key, direction)] = translatePacketContract(child, direction);
  }

  const toInternal = direction === 'internal';
  const historianObject = toInternal
    ? (String(out.tool || '').startsWith('arctic_') ||
      (Object.prototype.hasOwnProperty.call(out, 'database') && Object.prototype.hasOwnProperty.call(out, 'collection')))
    : (String(out.tool || '').startsWith('mongo_') ||
      (Object.prototype.hasOwnProperty.call(out, 'library') && Object.prototype.hasOwnProperty.call(out, 'symbol')));

  if (historianObject && toInternal) {
    if (out.library == null && out.database != null) out.library = out.database;
    if (out.symbol == null && out.collection != null) out.symbol = out.collection;
    delete out.database;
    delete out.collection;
  } else if (historianObject) {
    if (out.database == null && out.library != null) out.database = out.library;
    if (out.collection == null && out.symbol != null) out.collection = out.symbol;
    delete out.library;
    delete out.symbol;
  }
  return out;
}

function toInternalPacketContract(value) {
  return translatePacketContract(value, 'internal');
}

function toPublicMongoPacketContract(value) {
  return translatePacketContract(value, 'public');
}

function normalizeId(x, fallback) {
  const s = asString(x).replace(/[\[\]]/g, '').toUpperCase();
  if (/^E\d+$/.test(s)) return s;
  return fallback;
}

function compact(x, maxLen = 1600) {
  const s = String(x || '').replace(/\s+/g, ' ').trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '...';
}

const item = toInternalPacketContract($input.first().json || {});
const payload = asObject(item.aggregated_payload);

const completedUnits = asArray(
  item.completed_units ||
  payload.completed_units ||
  item.units ||
  []
);

// EVIDENCE_RECALL_V1：Evidence Recall LLM 点回的条目（按单元序号 + 字段 + 序号定位，与 Build Evidence Index 的编号一致），
// 在下方追加席位；收集时不受单元上限限制，主体过滤不剔除。
const __recallObjs = new Map();
let __recallInPacket = 0, __recallExtraSeats = 0;
for (const __p of asArray(asObject(item.evidence_recall).picks)) {
  const __s = asString(asObject(__p).loc).split(':');
  let __d = null;
  if (__s[0] === 'u') {
    const __u = asObject(completedUnits[Number(__s[1])]);
    const __arr = __s[2] === 'n' ? asArray(asObject(__u.normalized_result).evidence_digest) : asArray(__u.evidence_digest);
    __d = __arr[Number(__s[3])];
  } else if (__s[0] === 'i') __d = asArray(item.evidence_digest)[Number(__s[2])];
  else if (__s[0] === 'p') __d = asArray(payload.evidence_digest)[Number(__s[2])];
  if (__d && typeof __d === 'object') __recallObjs.set(__d, asString(asObject(__p).need) || 'recalled');
}

// MISSING_CLAIM_CHECK_V1：缺失核对查到、但不在上一稿证据包里的条目，修改轮按条目（正文前 400 字，与 Build Evidence Index 同一认法）追加入包，
// 用证据取回的追加席（≤8 席，共用）。首稿之前 Apply Missing Claim Check 还没运行，取不到就跳过。
try {
  const __mcR = asArray(asObject(asObject($('Apply Missing Claim Check').last().json).missing_claim_check).recall).map(asObject);
  if (__mcR.length) {
    const __want = new Map(__mcR.map(r => [String(r.key || ''), String(r.need || 'missing_claim')]).filter(x => x[0]));
    const __cl = t => String(t || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const __visit = d => { const o = asObject(d); const k = __cl(o.content_summary || o.snippet || o.summary).slice(0, 400); if (k && __want.has(k) && !__recallObjs.has(d)) __recallObjs.set(d, __want.get(k)); };
    for (const __u of completedUnits) { asArray(asObject(__u).evidence_digest).forEach(__visit); asArray(asObject(asObject(__u).normalized_result).evidence_digest).forEach(__visit); }
    asArray(item.evidence_digest).forEach(__visit); asArray(payload.evidence_digest).forEach(__visit);
  }
} catch (e) {}

// F35：原为 12，是个没有出处的魔数；下游 Compact Result Projector 写的是
// slice(0, 24)，一直预留着 24 的余量没用上。提到 24 把余量用起来。
// DOCUMENT_PERIOD_PRIORITY_V7：问题有明确时段时，按文档名中的日期（通用 YYYY年M月 / YYYY-MM / YYYY年）标注条目所属时段，
// 并让同期文档优先入包。report8 Q1 exec 152345：问 2025-03，包内 27 条仅 1 条同期、17 条为其他年月月报；
// exec 152304 还把《技术月报2026年3月》的原因当成 2025-03 的原因。
function __periodOf(name) {
  const s = String(name || '');
  let m = /((?:19|20)\d{2})\s*年\s*(\d{1,2})\s*月/.exec(s) || /((?:19|20)\d{2})[-_.\/](\d{1,2})(?!\d)/.exec(s);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return { label: y + '-' + String(mo).padStart(2, '0'), start: Date.UTC(y, mo - 1, 1), end: Date.UTC(y, mo, 1) - 1 };
  }
  m = /((?:19|20)\d{2})\s*年/.exec(s);
  if (m) { const y = Number(m[1]); return { label: String(y), start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) - 1 }; }
  return null;
}
const __requestedPeriod = (() => {
  const r = asArray(item.factor_resolution_date_range);
  if (r.length !== 2) return null;
  const t = r.map(v => Date.parse(String(v).slice(0, 10) + 'T00:00:00Z'));
  if (!t.every(Number.isFinite)) return null;
  const months = [];
  const d = new Date(t[0]);
  while (d.getTime() <= t[1] && months.length < 36) {
    const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1;
    months.push(new RegExp(y + '\\s*年\\s*0?' + mo + '\\s*月|' + y + '[-./]0?' + mo + '(?!\\d)'));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return { start: t[0], end: t[1] + 86399999, months };
})();
function __periodFields(docName, body) {
  if (!__requestedPeriod) return {};
  const p = __periodOf(docName);
  if (!p) return {};
  const inPeriod = p.end >= __requestedPeriod.start && p.start <= __requestedPeriod.end;
  const out = { document_period: p.label, period_relation: inPeriod ? 'in_period' : 'other_period' };
  if (!inPeriod) out.requested_period_mentioned = __requestedPeriod.months.some(re => re.test(String(body || '')));
  return out;
}

const MAX_PACKET_ITEMS = 24;
// 每个有产出的单元的保底席位。原实现按相关度全局排序后直接截断，
// 一个单元可占满全部席位——实测 exec 136355：声明了必答项的 unit 2
// 检索回 45 条（含 18 处「滑阀」），最终一席未得。
const FLOOR_PER_UNIT = 3;
const packet = [];
const seen = new Set();
const __collectedPerUnit = new Map();
// UNIQUE_EVIDENCE_ID_V7
// 每个执行单元的 evidence_digest 都各自从 E1 开始编号，拼进同一个包时必然相撞。
// 实测 T3（exec 134235）包内 E1-E6 各出现两次：正文按第二组写作，
// 展示层按 id 匹配却渲染第一组，导致引用与出处对不上（评审十.1 / 十.2）。
// 编号必须在整个答案内唯一，重复的顺延到下一个空位。
const usedIds = new Set();
const idRemap = [];
// CLAIM_ID_TRANSLATION_V7：(来源单元|原编号) → 包内编号；内容键 → 包内编号
const __idByContentKey = new Map();
const __claimIdMap = new Map();
function __claimKey(unitId, oid) {
  return (unitId == null ? '' : String(unitId)) + '|' + String(oid || '').trim().toUpperCase();
}


// SOURCE_TIER_V7
// 同一个量在多个来源里都出现时，谁更可信？按"是否装置专属 + 是否结构化"分三层。
//   1 装置专属·结构化：装置模型、位号目录、控制图谱（本装置组态/图纸/台账，字段化）
//   2 装置专属·文档：<厂名>系列资料、操作规程、设备供货表、说明书、YB 图号（讲本装置，但是文本）
//   3 通识：通识库、FCC English books、教材专著（讲这类装置的一般情况）
// 层级不用于丢弃证据，只用于排序与标注适用范围——见 finalizer 的冲突处置规则。
function bossSourceTierV7(obj) {
  const src = asObject(obj);
  // DEVICE_CONTEXT_PROVENANCE_V7：调用方已确知来源时（如由前序对话整理的设备上下文）直接采用
  if (src.source_tier_override) {
    return { tier: Number(src.source_tier_override), label: String(src.source_tier_label_override || '') };
  }
  const blob = [src.document_name, src.dataset_name, src.section_title]
    .filter(Boolean).map(String).join(' ');
  const meta = asObject(src.db_meta);
  if (meta && meta.source_label) return { tier: 1, label: '装置专属·结构化' };
  if (/Plant Model|装置模型|Control Graph|控制图谱|位号目录|tag_catalog|标签目录/i.test(blob)) {
    return { tier: 1, label: '装置专属·结构化' };
  }
  if (/<厂名>|操作规程|设备台账|供货表|说明书|铭牌|P&ID|PID图|组态|联锁逻辑|DCS控制|统计表|\bYB\d{3,5}\b/i.test(blob)) {
    return { tier: 2, label: '装置专属·文档' };
  }
  if (/通识|English books|教材|专著|手册|大作业|培训/i.test(blob)) {
    return { tier: 3, label: '通识资料' };
  }
  return { tier: 2, label: '装置专属·文档' };
}

// EVIDENCE_SOURCE_UNIT_V7
// 证据条目原先不带任何溯源字段，而 required_evidence_types 声明在执行单元上，
// 两个单元的 digest 又各自从 E1 编号，导致覆盖校验无法按 id 把两边对起来，
// 只能拿必答项字面去正文里找；而该字段时而中文时而英文代号，后者永远查不到。
// 这里在建包处把来源单元盖上，下游即可做纯 id 连接。
function addEntry(entry, sourceUnit) {
  const obj = asObject(entry);
  const su = asObject(sourceUnit);
  const __recallNeed = __recallObjs.get(entry) || ''; // EVIDENCE_RECALL_V1
  let id = normalizeId(obj.evidence_id || obj.id, `E${packet.length + 1}`);
  const __origId = id;
  if (usedIds.has(id)) {
    let n = packet.length + 1;
    while (usedIds.has('E' + n)) n++;
    idRemap.push({ from: id, to: 'E' + n, document_name: obj.document_name || '' });
    id = 'E' + n;
  }

  // DEDUP_BY_CONTENT_V7
  // 原去重键含 id 与文档名/页码/章节。F17 把重复编号改为新编号后，同一片段经单元结果与
  // 顶层汇总两条路径进入时编号、元数据都不同，去重永不命中。实测 exec 138917 收集 72 条
  // 仅 34 条内容唯一，入包 24 条中重复 10 条，关键证据「PRCA3101 和 PRCA3102 分别控制
  // 双动滑阀开度」因名额被重复拷贝占用而落选。改为只按正文内容去重。
  const key = String(obj.content_summary || obj.snippet || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);

  if (seen.has(key)) {
    if (__recallNeed) { const __k = __idByContentKey.get(key); const __pe = packet.find(e => e.evidence_id === __k); if (__pe && !__pe.recalled_for) __pe.recalled_for = __recallNeed; } // EVIDENCE_RECALL_V1
    // 内容重复：本条不入包，但它的 (单元, 原编号) 仍应指向保留下来的那一条
    const __kept = __idByContentKey.get(key);
    if (__kept && su.unit_id != null) __claimIdMap.set(__claimKey(su.unit_id, __origId), __kept);
    return;
  }
  // F21：收齐阶段放宽到 3 倍上限，最终名额由下方按相关度排序后统一裁定。
  // 原实现在这里先到先得地丢弃，与相关度无关，导致 PDRA3125B 被无关的
  // FIC/PIC/LIC 行挤出（实测 exec 135057）。
  // PER_UNIT_COLLECTION_CAP_V7：收集上限按单元计算。原为全局 72 条先到先得，exec 143028 单元 1 独占 76 条，
  // 位号资料检索单元（13）的报警位号表与月报身份原文根本没进候选，每单元保底席位无从生效。
  const __uk = su.unit_id == null ? '__none' : String(su.unit_id);
  if (!__recallNeed && (__collectedPerUnit.get(__uk) || 0) >= MAX_PACKET_ITEMS * 3) return; // EVIDENCE_RECALL_V1：点回的条目不受单元收集上限
  __collectedPerUnit.set(__uk, (__collectedPerUnit.get(__uk) || 0) + 1);
  seen.add(key);
  __idByContentKey.set(key, id);
  __claimIdMap.set(__claimKey(su.unit_id, __origId), id);
  usedIds.add(id);

  packet.push({
    evidence_id: id,
    source_unit_id: su.unit_id != null ? su.unit_id : null,
    source_evidence_id: __origId,
    source_required_types: asArray(su.required_evidence_types),
    document_name: obj.document_name || '',
    dataset_name: obj.dataset_name || '',
    page_start: obj.page_start ?? null,
    page_end: obj.page_end ?? null,
    section_title: obj.section_title || '',
    content_summary: compact(obj.content_summary || obj.summary || ''),
    key_points: asArray(obj.key_points).map(x => compact(x, 500)),
    key_values: asArray(obj.key_values).map(x => compact(x, 300)),
    operational_actions: asArray(obj.operational_actions).map(x => compact(x, 500)),
    limitations: asArray(obj.limitations).map(x => compact(x, 500)),
    relevance_to_question: compact(obj.relevance_to_question || '', 700),
    snippet: /<table\b/i.test(obj.snippet || '')
  ? obj.snippet
  : compact(obj.snippet || '', 900),
    // DB_EVIDENCE_TAG_DETAIL_V6：结构化的数据库元数据必须透传到展示层
    db_meta: obj.db_meta || null,
    source_kind: obj.source_kind || null, // HISTORIAN_EVIDENCE_ENTRIES_V7
    // SOURCE_TIER_V7：来源分级，供 finalizer 在多来源冲突时排序与标注
    source_tier: bossSourceTierV7(obj).tier,
    source_tier_label: bossSourceTierV7(obj).label
  });
  if (__recallNeed) packet[packet.length - 1].recalled_for = __recallNeed; // EVIDENCE_RECALL_V1
}


// PLANT_MODEL_EVIDENCE_INTO_PACKET_V7
// Parse Device Context 已解析出结构化的 device_context，含取压点标高、管口编号、
// 跨距、设计图号与跨器归属（实测 exec 133653：PDRA3125 hi 管口8 @EL52700 /
// lo 管口9 @EL37500，跨距 15200mm，YB8864/8865）。device_context.evidence 的
// 字段结构与 RAG 证据一致，但本节点与 Result Aggregator 从不读它，这些事实
// 因此永远进不了答案——复杂22 T5、MT02 T1 只能回答"需从 P&ID 获取"。
// 先于 completedUnits 注入：自然拿到靠前的 E 编号，无需重编号，
// 并与其它证据一起接受下方 SUBJECT_RELEVANCE_EVIDENCE_FILTER_V6 的主体检查。
(function injectPlantModelEvidenceV7() {
  let dc = null;
  try {
    dc = toInternalPacketContract($('Parse Device Context').first().json.device_context || null);
  } catch (e) {
    dc = null;
  }
  if (!dc || typeof dc !== 'object') return;
  if (String(dc.status || '').toLowerCase() !== 'resolved') return;

  const dev = asObject(dc.device);
  const ids = asArray(dev.identifiers).map(x => String(x || '')).filter(Boolean);
  const desc = String(dev.description || '');
  // ENGINEERING_FACTS_IN_FINAL_EVIDENCE_V2: include static facts even when no
  // derived quantity can be computed. Put them before identity descriptions.
  const __facts = asArray(dc.engineering_facts).map(asObject).filter(f =>
    ['plant_trace','plant_equipment'].includes(f.retrieval_tool) && f.found === true &&
    typeof f.equipment_tag === 'string' && f.equipment_tag.trim() &&
    typeof f.field_path === 'string' && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/.test(f.field_path) &&
    typeof f.value === 'number' && Number.isFinite(f.value) && String(f.unit || '') &&
    ['source_bound','derived'].includes(String(f.status || '')));
  const entries = __facts.map(f => {
    const ref = String(f.equipment_tag || '')+'.'+String(f.field_path || '');
    const sn = String(f.section || '')+' '+String(f.quantity || '')+': '+ref+' = '+f.value+' '+f.unit+
      '; status='+f.status+
      (f.source ? '; source='+String(f.source) : '')+
      (f.locator ? '; locator='+String(f.locator) : '')+
      (f.derivation ? '; derivation='+String(f.derivation) : '')+
      (asArray(f.inputs).length ? '; derivation inputs='+asArray(f.inputs).map(String).join(', ') : '')+
      '; '+String(f.note || '')+
      (f.interpretation_basis ? '; section interpretation: '+f.interpretation_basis : '')+
      '. This static input is available even when a flow/density calculation is not computed.';
    return {document_name:'Plant Model '+f.retrieval_tool+' '+ref,dataset_name:'Plant Model（装置模型）',
      section_title:String(f.section || f.field_path),content_summary:sn,snippet:sn,
      key_values:[ref+' = '+f.value+' '+f.unit],
      relevance_to_question:'已取到的流通截面积/静态工程参数，可用于对应位置计算。流量、密度、单位缺失不表示这个静态值缺失。保留其派生状态与参考图的位置解释。',
      source_kind:'plant_model_static',
      source_tier_override:2,source_tier_label_override:'Plant Model·静态工程参数（保留证据状态）'};
  });

  if (desc) {
    entries.push({
      document_name: 'Plant Model - ' + (dev.canonical_name || '设备上下文'),
      dataset_name: 'Plant Model（装置模型）',
      section_title: ids.join(' / '),
      content_summary: desc,
      snippet: desc,
      relevance_to_question: '装置模型解析出的设备身份、取压点标高、管口与跨器归属，可直接用于本轮回答；设备标识为精确字符串，R1101 与 R1101A 属不同设备，不得混用。',
      key_values: ids.slice(0, 12)
    });
  }
  for (const row of asArray(dc.evidence)) {
    const o = asObject(row);
    const sn = String(o.snippet || '');
    if (!sn) continue;
    // PLANT_MODEL_ROW_RELEVANCE_BY_SOURCE_V7
    // 原先每一行都写死「装置模型返回的结构化物理事实」，但行内自带的来源可能是通识资料
    // （exec 139513：E2 文档名「催化裂化通识库中文资料」，用途却写装置模型）。
    // 用途按行的实际来源决定：来源本身是装置模型才用原句。
    const __rowSource = String(o.dataset_name || o.document_name || '').trim();
    const __isPlantModelRow = !__rowSource || /plant\s*model|装置模型/i.test(__rowSource);
    const __rowRelevance = String(o.relevance_to_question || '').trim()
      || (__isPlantModelRow
        ? '装置模型返回的结构化物理事实（标高 EL、管口、跨距、所属器体、设计图号）。'
        : '装置模型工具附带返回的文档片段，来源：' + __rowSource + '。');
    entries.push({
      document_name: o.document_name || 'Plant Model',
      dataset_name: o.dataset_name || 'Plant Model（装置模型）',
      page_start: o.page_start ?? null,
      page_end: o.page_end ?? null,
      section_title: o.section_title || '',
      content_summary: sn,
      snippet: sn,
      relevance_to_question: __rowRelevance
    });
  }
  // DEVICE_CONTEXT_PROVENANCE_V7
  // Neo4j 不可用时，Device Context Retriever 没有可调用的图工具（exec 140050/140060 中 Neo4j Tool、
  // Control Graph Tool 均未运行），返回的「设备上下文」是把前序轮次的回答重新整理；原先一律标成
  // 「Plant Model（装置模型）」、来源等级 1 并在排序中加分，T5/T8 回答因此称「装置模型明确给出 PRCA3101」——
  // 前一轮自己的说法被当作权威结构化资料回引。这里以目录的 neo4j 可用性判定来源，不可用时如实标注。
  let __graphAvailable = false;
  try {
    __graphAvailable = ((((($('Catalog').first().json || {}).catalog) || {}).neo4j) || {}).available === true;
  } catch (err) { __graphAvailable = false; }
  if (!__graphAvailable && !__facts.length) {
    for (const __ent of entries) {
      const __orig = String(__ent.document_name || '').replace(/^Plant Model(?:\s*-\s*)?/i, '').trim();
      __ent.document_name = '前序对话整理的设备上下文' + (__orig ? '（' + __orig + '）' : '');
      __ent.dataset_name = '会话上下文（非检索来源）';
      __ent.relevance_to_question = '来自前序轮次回答的整理：可作为本次对话中已给出的结论引用，须注明来自前序轮次；不是本轮新检索到的独立证据。';
      __ent.source_tier_override = 4;
      __ent.source_tier_label_override = '会话上下文·前序轮次结论';
    }
  }
  for (const e of entries.slice(0, 12)) addEntry(e);
})();

for (const unit of completedUnits) {
  const u = asObject(unit);
  const nr = asObject(u.normalized_result);

  for (const d of asArray(u.evidence_digest)) addEntry(d, u);
  for (const d of asArray(nr.evidence_digest)) addEntry(d, u);
}

for (const d of asArray(item.evidence_digest)) addEntry(d);
for (const d of asArray(payload.evidence_digest)) addEntry(d);

// HISTORIAN_EVIDENCE_ENTRIES_V7：历史库单元只有确定性摘要（evidence_summary）、没有 digest，
// 实测数据与越限定位从未进入证据包，finalizer 无从引用（MT25 T7 exec 148704、T8 exec 148708 正文 0 引用）。
(function addHistorianEvidenceEntries() {
  for (const unit of completedUnits) {
    const u = asObject(unit);
    const m = /^(?:arctic|mongo)_(read|stats|analyze|find_tags|resolve_factors)$/.exec(asString(u.tool)); // HISTORIAN_GAP_FACTOR_RESOLUTION_V7：因子解析结果同样是历史库实测
    if (!m) continue;
    if (/FAIL|ERROR|BLOCK|SKIP/i.test(asString(u.execution_status))) continue;
    const lines = [];
    for (const x of asArray(u.evidence_summary)) {
      const t = typeof x === 'string' ? x : asString(asObject(x).snippet || asObject(x).summary || asObject(x).content_summary);
      if (t && lines.indexOf(t) < 0) lines.push(t);
    }
    const ref = asObject(asObject(u.params).event_anchor_refinement);
    if (ref.status === 'located') {
      const lim = asObject(ref.crossing_limit);
      lines.push('越限时刻定位：' + asString(ref.column) + ' 在 ' + asString(ref.period_start) + ' 起的周期内' +
        (lim.side === 'above' ? '高于' : '低于') + asString(lim.label) + ' ' + lim.value + '，首次 ' + asString(ref.first_crossing) +
        '，末次 ' + asString(ref.last_crossing) + '，极值 ' + ref.extreme_value + ' @ ' + asString(ref.extreme_time) + '（UTC' +
        (ref.granularity ? '，按 ' + ref.granularity + ' 聚合' : '') + '）');
      // EXCEEDANCE_LOCATE_BY_SEGMENTED_TREND_V7 / EXCEEDANCE_SEGMENT_LIMIT_ADAPT_V7：分段读数时，时刻为段起点、极值为段内分钟读数极值；附逐小时趋势供读走势
      if (ref.method === 'segmented_period_profile') {
        lines.push('定位方式：按 ' + asString(ref.granularity) + ' 分段读取该周期全部读数，越限段 ' + ref.rows_crossing + ' 个' +
          (Number(ref.out_of_range_segments) ? '（另有 ' + ref.out_of_range_segments + ' 段极值超出量程，未计入）' : '') +
          (ref.refined_granularity ? '，首次/末次/极值所在段再按 ' + asString(ref.refined_granularity) + ' 细分定位' : '') +
          '；时刻均为所在分段起点，极值为段内分钟读数的' + (lim.side === 'above' ? '最大值' : '最小值'));
        const th = asArray(ref.trend_hourly);
        if (th.length) lines.push('逐小时趋势（UTC，最小/均值/最大）：' + th.map(h => asString(h.hour).slice(11, 13) + '时 ' + h.min + '/' + h.mean + '/' + h.max + (h.out_of_range ? '（含量程外读数）' : '')).join('；'));
      }
    }
    if (!lines.length) continue;
    // EVIDENCE_DBMETA_OWN_ID_V7：条目自带数据库元数据，展示层不再按编号到别的来源里兜底（三套编号会串）
    const __p = asObject(u.params);
    const __t0 = asArray(__p.targets).length ? asObject(asArray(__p.targets)[0]) : {};
    const __dr = asArray(__p.date_range).length ? asArray(__p.date_range) : asArray(rawResultOf(u).date_range);
    // HISTORIAN_ENTRY_HEADER_V7：正文以「工具 + 查询时段」开头。
    // Q5 exec 152239：因子解析单元的逐因子摘要另经 evidence_digest（单元级与顶层汇总两条路径）先入包，
    // 汇总条目正文前 400 字与第 1 条逐因子摘要相同，被内容去重当成副本丢弃；逐因子条目无历史库标记，
    // 在相关性筛选中几乎全部落选，5 月实测表于是无出处可引。加抬头后汇总条目有独立内容，且注明统计覆盖的时段。
    const body = 'mongo_' + m[1] + (__dr.length === 2 ? '（' + __dr.map(String).join(' ~ ') + '）' : '') + '：' + lines.join('；');
    // 库名只取单元参数；原先从正文里匹配「字母/字母」兜底，因子解析摘要里的「target/range」被当成库名（exec 149371）。
    // 有库名的单元参数里都带库名（MT25、report8 全部核对过），正文匹配从未提供过参数之外的信息。
    const __db = asString(__p.database || __p.library || __t0.database || __t0.library);
    const __coll = asString(__p.collection || __p.symbol || __t0.collection || __t0.symbol);
    const where = __db && __coll ? __db + '/' + __coll : '';
    addEntry({
      document_name: '历史实时数据库' + (where ? ' ' + where : '') + ' · ' + 'mongo_' + m[1],
      dataset_name: '历史实时数据库（本轮查询结果）',
      section_title: asString(u.question_part),
      content_summary: body,
      snippet: body,
      key_values: lines.slice(0, 12),
      relevance_to_question: '本轮对历史实时数据库的实际查询结果（确定性工具输出），可直接作为实测数据的出处引用。',
      source_kind: 'historian',
      db_meta: {
        source_label: 'ArcticDB', tool: 'mongo_' + m[1], // 与 Result Aggregator 的标签约定一致，展示层统一替换为「MongoDB 历史库」
        database: __db || null, collection: __coll || null, library: __db || null, symbol: __coll || null,
        date_range: __dr.length === 2 ? __dr.map(String).join(' ~ ') : null, tags: []
      },
      source_tier_override: 1,
      source_tier_label_override: '装置专属·结构化（历史库实测）'
    }, u);
  }
})();

if (!packet.length) {
  const evidenceSummary = asArray(
    item.evidence_summary ||
    payload.evidence_summary ||
    []
  );

  for (let i = 0; i < evidenceSummary.length; i++) {
    const ev = asObject(evidenceSummary[i]);

    addEntry({
      evidence_id: ev.evidence_id || `E${i + 1}`,
      document_name: ev.document_name || '',
      dataset_name: ev.dataset_name || '',
      page_start: ev.page_start ?? null,
      page_end: ev.page_end ?? null,
      section_title: ev.section_title || ev.section || '',
      content_summary: ev.snippet || '',
      key_points: ev.snippet ? [ev.snippet] : [],
      key_values: [],
      operational_actions: [],
      limitations: [],
      relevance_to_question: 'This fallback packet was built from evidence_summary because no evidence_digest was available.',
      snippet: ev.snippet || ''
    });
  }
}

// TAG_EVIDENCE_STATUS_MATRIX_V5
function rawResultOf(unit) {
  const u = asObject(unit);
  const direct = asObject(u.raw_result);
  if (Object.keys(direct).length) return direct;
  const normalized = asObject(asObject(u.normalized_result).raw_result);
  if (Object.keys(normalized).length) return normalized;
  return {};
}

function buildTagEvidenceStatus(units) {
  const byTag = new Map();

  function ensure(tag) {
    const key = asString(tag);
    if (!key) return null;
    if (!byTag.has(key)) {
      byTag.set(key, {
        tag: key,
        // FINALIZER_TAG_STATUS_PRECEDENCE_V5
        semantic_status: 'unconfirmed',
        semantic_match_type: '',
        selected_for_direct_use: false,
        process_factor: '',
        data_status: 'not_checked',
        classification: 'unresolved',
        desc_cn: '',
        desc_en: '',
        count: null,
        source_tools: []
      });
    }
    return byTag.get(key);
  }

  function addSource(row, tool) {
    if (tool && !row.source_tools.includes(tool)) row.source_tools.push(tool);
  }

  for (const unit of asArray(units)) {
    const u = asObject(unit);
    const tool = asString(u.tool);
    const rr = rawResultOf(u);

    if (tool === 'arctic_find_tags') {
      const traces = asArray(u.tag_selection_trace).length
        ? asArray(u.tag_selection_trace)
        : asArray(rr.tags);
      for (const traceValue of traces) {
        const trace = asObject(traceValue);
        const row = ensure(trace.tag || trace.name);
        if (!row) continue;
        row.desc_cn = asString(trace.desc_cn || trace.description_cn) || row.desc_cn;
        row.desc_en = asString(trace.desc_en || trace.description_en) || row.desc_en;
        const matchType = asString(trace.match_type).toLowerCase();
        const direct = trace.selected === true && matchType === 'direct_match';
        const priority = { direct_match: 3, contextual_match: 2, reject: 1, rejected: 1 };
        if ((priority[matchType] || 0) >= (priority[row.semantic_match_type] || 0)) {
          row.semantic_match_type = matchType;
          row.selected_for_direct_use = direct;
          row.process_factor = asString(trace.process_factor || trace.process_factor_id);
          row.semantic_status = direct
            ? 'confirmed_direct_match'
            : (matchType === 'contextual_match' ? 'contextual_candidate' : 'unconfirmed');
        }
        addSource(row, tool);
      }
    }

    if (tool === 'arctic_stats') {
      const stats = asObject(rr.column_stats);
      const missing = new Set(asArray(rr.missing_columns).map(asString));
      const allNull = new Set(asArray(rr.all_null_columns).map(asString));
      const requested = new Set([
        ...asArray(rr.requested_columns).map(asString),
        ...Object.keys(stats)
      ]);

      for (const tag of requested) {
        const row = ensure(tag);
        if (!row) continue;
        const stat = asObject(stats[tag]);
        const count = Number(stat.count);
        row.count = Number.isFinite(count) ? count : null;
        if (missing.has(tag)) row.data_status = 'missing_column';
        else if (allNull.has(tag) || count === 0) row.data_status = 'all_null_or_empty';
        else if (Number.isFinite(count) && count > 0) row.data_status = 'confirmed_non_null';
        else row.data_status = 'returned_without_count';
        addSource(row, tool);
      }
    }

    // ARCTIC_READ_AVAILABILITY_STATUS_V5
    // Presence reads prove data existence independently from semantic identity.
    // A null boundary sample remains unverified; it is never promoted to a
    // whole-history missing-column conclusion.
    if (tool === 'arctic_read') {
      const params = asObject(u.params);
      const requested = asArray(rr.columns).length
        ? asArray(rr.columns)
        : (asArray(rr.requested_columns).length
          ? asArray(rr.requested_columns)
          : asArray(params.columns));
      const nonNull = new Set(asArray(rr.non_null_columns).map(value => asString(value).toUpperCase()));
      const nullOnly = new Set(asArray(rr.null_columns).map(value => asString(value).toUpperCase()));
      for (const tagValue of requested) {
        const tag = asString(tagValue);
        const row = ensure(tag);
        if (!row) continue;
        const key = tag.toUpperCase();
        if (nonNull.has(key)) row.data_status = 'confirmed_non_null';
        else if (nullOnly.has(key)) row.data_status = 'non_null_not_confirmed';
        else row.data_status = 'returned_without_presence_classification';
        addSource(row, tool);
      }
    }
  }

  for (const row of byTag.values()) {
    const semanticConfirmed = row.semantic_status === 'confirmed_direct_match';
    const contextual = row.semantic_status === 'contextual_candidate';
    const dataConfirmed = row.data_status === 'confirmed_non_null';
    if (semanticConfirmed && dataConfirmed) row.classification = 'direct_use_semantic_and_data_confirmed';
    else if (contextual && dataConfirmed) row.classification = 'data_confirmed_contextual_candidate';
    else if (dataConfirmed) row.classification = 'data_confirmed_semantics_unconfirmed';
    else if (semanticConfirmed) row.classification = 'direct_metadata_match_data_unverified';
    else if (contextual) row.classification = 'contextual_candidate_data_unverified';
    else if (row.data_status === 'missing_column' || row.data_status === 'all_null_or_empty') {
      row.classification = 'data_unavailable_semantics_unconfirmed';
    } else row.classification = 'unresolved';
  }

  return Array.from(byTag.values());
}

// EVENT_CORRELATION_INTEGRITY_V5
// Some Arctic Analyzer responses expose anomaly details in the normalized
// answer while raw_result contains only a count summary. Recover the same
// structured contract from standard tag/time/value/z-score records.
function parseAnomaliesFromAnalysisText(text) {
  const source = String(text || '');
  const out = [];
  const pattern = /\b([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?)\s*[,，]\s*(20\d{2}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?)?)[^\n]*?(?:value|值)\s*[:=]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))[^\n]*?(?:z(?:-?score)?|zscore)\s*[:=]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))/gi;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const value = Number(match[3]);
    const zscore = Number(match[4]);
    if (!Number.isFinite(value) || !Number.isFinite(zscore)) continue;
    out.push({
      column: match[1],
      timestamp: match[2],
      value,
      zscore,
      direction: zscore >= 0 ? 'high' : 'low',
      source: 'normalized_arctic_analysis_text'
    });
  }
  return out;
}

function buildEventEvidenceStatus(units) {
  const anomalies = [];
  const thresholdEvents = [];
  const reversalEvents = [];
  const validCorrelations = [];
  const validLags = [];
  const removedRelationships = [];
  const scopes = [];

  for (const unit of asArray(units)) {
    const u = asObject(unit);
    if (asString(u.tool) !== 'arctic_analyze') continue;
    const rr = rawResultOf(u);
    const structuredAnomalies = asArray(rr.anomaly_windows).map(asObject);
    if (structuredAnomalies.length) {
      anomalies.push(...structuredAnomalies);
    } else {
      const analysisText = [
        asString(u.answer),
        asString(u.executor_answer),
        asString(asObject(u.normalized_result).answer)
      ].join('\n');
      anomalies.push(...parseAnomaliesFromAnalysisText(analysisText));
    }
    for (const row of asArray(rr.threshold_exceedances).concat(asArray(rr.alarm_events))) {
      thresholdEvents.push(asObject(row));
    }
    for (const row of asArray(rr.reversal_events).concat(asArray(rr.sign_reversals)).concat(asArray(rr.zero_crossings))) {
      reversalEvents.push(asObject(row));
    }
    for (const row of asArray(rr.ranked_correlations)) validCorrelations.push(asObject(row));
    for (const row of asArray(rr.lag_findings)) validLags.push(asObject(row));
    const validation = asObject(rr.correlation_validation);
    for (const row of asArray(validation.removed_self_or_duplicate_correlations)) removedRelationships.push(asObject(row));
    for (const row of asArray(validation.removed_self_or_duplicate_lags)) removedRelationships.push(asObject(row));
    if (asArray(rr.date_range).length) {
      scopes.push({
        date_range: asArray(rr.date_range).slice(0, 2),
        resample_rule: asString(rr.resample_rule)
      });
    }
    for (const targetRaw of asArray(rr.targets)) {
      const target = asObject(targetRaw);
      if (asArray(target.time_range).length !== 2) continue;
      scopes.push({
        target: asString(target.name),
        date_range: asArray(target.time_range).slice(0, 2),
        resample_rule: asString(rr.resample_rule)
      });
    }
  }

  const strongest = anomalies
    .filter(row => Number.isFinite(Number(row.zscore)))
    .sort((a, b) => Math.abs(Number(b.zscore)) - Math.abs(Number(a.zscore)))[0] || null;
  const timestamp = strongest ? asString(strongest.timestamp) : '';

  return {
    status: anomalies.length ? 'confirmed' : 'unknown',
    event_type: anomalies.length ? 'statistical_anomaly' : '',
    statistical_anomaly: {
      status: anomalies.length ? 'confirmed' : 'not_found',
      count: anomalies.length,
      strongest_event: strongest,
      meaning: 'A distribution-relative anomaly is confirmed by the configured statistical rule only.'
    },
    threshold_exceedance: {
      status: thresholdEvents.length ? 'confirmed' : 'unconfirmed',
      events: thresholdEvents,
      missing_requirements: thresholdEvents.length ? [] : ['explicit threshold or alarm setting', 'value-to-threshold comparison']
    },
    direction_reversal: {
      status: reversalEvents.length ? 'confirmed' : 'unconfirmed',
      events: reversalEvents,
      missing_requirements: reversalEvents.length ? [] : ['explicit sign-crossing or reversal calculation']
    },
    event_window: timestamp ? {
      status: 'anchor_available',
      anchor_timestamp: timestamp,
      source: 'strongest_statistical_anomaly'
    } : {
      status: 'unavailable',
      anchor_timestamp: ''
    },
    relationship_evidence: {
      valid_correlation_count: validCorrelations.length,
      valid_lag_count: validLags.length,
      removed_self_or_duplicate_count: removedRelationships.length,
      causal_status: 'not_established',
      rule: 'Correlation and lag among distinct columns are candidate associations, not causes.'
    },
    analysis_scopes: scopes,
    missing_requirements: [
      ...(thresholdEvents.length ? [] : ['confirmed operating/alarm threshold']),
      ...(reversalEvents.length ? [] : ['confirmed sign reversal']),
      'independent process signals and mechanism evidence for causal attribution'
    ]
  };
}

const eventEvidenceStatus = buildEventEvidenceStatus(completedUnits);

// CONSISTENCY_CONTEXT_BRIDGE_V5
// The decomposer already decides whether history is relevant. Carry only its
// matched turns and facts into the finalizer instead of passing the full state.
function parseNodeJson(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  const cleaned = value.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try { return JSON.parse(cleaned); } catch (e) { return {}; }
}

function consistencyContextFromMatchedHistory() {
  let state = {};
  let decomposition = {};
  let currentQuestion = '';
  try {
    const captured = toInternalPacketContract($('Capture context').first().json || {});
    currentQuestion = asString(captured.originalUserMessage || captured.chatInput);
    // FULL_STATE_FACT_CONSISTENCY_V5
    // Prompt compression may omit old facts, but omission cannot change their
    // truth status. Reconcile fact cards against full structured state; only
    // the small matched projection below is sent onward to the finalizer.
    state = asObject(captured.conversation_state || captured.conversation_state_for_llm);
  } catch (e) {}
  try {
    const decomposed = toInternalPacketContract($('Decompose Question').first().json || {});
    decomposition = toInternalPacketContract(parseNodeJson(decomposed.output || decomposed.answer || decomposed));
  } catch (e) {}

  const resolution = asObject(decomposition.memory_resolution);
  if (resolution.depends_on_history !== true) {
    return {
      depends_on_history: false,
      matched_turns: [],
      matched_facts: [],
      inherited_entities: []
    };
  }

  const matchedTurnIds = new Set(asArray(resolution.matched_turns).map(asString).filter(Boolean));
  const matchedFactIds = new Set(asArray(resolution.matched_fact_ids).map(asString).filter(Boolean));

  // PREVIOUS_TURN_TIMESTAMP_AUTHORITY_V5
  // The turn array may be grouped by question-memory order rather than update
  // order. An explicit previous-turn binding therefore uses the newest ts and
  // overrides stale ids selected by the decomposer.
  const binding = asObject(decomposition.context_binding);
  if (
    binding.used_history === true &&
    /^previous_(?:resolved_question|assistant_answer|turn)$/i.test(
      asString(binding.source_turn)
    )
  ) {
    matchedTurnIds.clear();
    const latestTurn = asArray(state.turns)
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(asString(asObject(a).ts)) || 0;
        const bTime = Date.parse(asString(asObject(b).ts)) || 0;
        return bTime - aTime;
      })[0];
    const latestTurnRef = asString(asObject(latestTurn).turn_ref);
    if (latestTurnRef) {
      matchedTurnIds.add(latestTurnRef);
      // PREVIOUS_TURN_FACT_ID_FALLBACK_V5
      // Repeated-question memory can update a question card while preserving
      // the card's earlier fact ids. Replace decomposer ids only when the
      // newest timestamped turn actually owns fact cards.
      const latestFactIds = asArray(state.fact_cards)
        .filter(factValue => {
          const fact = asObject(factValue);
          return (
            asString(fact.source_turn) === latestTurnRef &&
            asString(fact.fact_id)
          );
        })
        .map(factValue => asString(asObject(factValue).fact_id));
      if (latestFactIds.length > 0) {
        matchedFactIds.clear();
        for (const factId of latestFactIds) matchedFactIds.add(factId);
      }
    }
  }

  // MATCHED_FACT_BUNDLE_CLOSURE_V5
  // A fact's status dimensions belong together. If memory retrieval selects
  // one fact for a source-turn/subject pair, include its siblings from that
  // same pair so data, semantics, and availability cannot be split apart.
  const selectedFactBundleKeys = new Set(
    asArray(state.fact_cards)
      .filter(factValue =>
        matchedFactIds.has(asString(asObject(factValue).fact_id))
      )
      .map(factValue => {
        const fact = asObject(factValue);
        return `${asString(fact.source_turn)}|${asString(fact.subject)}`;
      })
      .filter(key => key !== '|')
  );
  for (const factValue of asArray(state.fact_cards)) {
    const fact = asObject(factValue);
    const key = `${asString(fact.source_turn)}|${asString(fact.subject)}`;
    if (selectedFactBundleKeys.has(key) && asString(fact.fact_id)) {
      matchedFactIds.add(asString(fact.fact_id));
    }
  }

  // NONCONFIRMING_EVIDENCE_PRECEDENCE_V5
  // A later lookup that cannot confirm a fact is not evidence that an earlier
  // confirmed fact became false. For each selected subject/relation dimension,
  // retain the newest evidence-grounded confirmation unless the matched facts
  // contain an explicit contradiction.
  const selectedFacts = asArray(state.fact_cards).filter(factValue =>
    matchedFactIds.has(asString(asObject(factValue).fact_id))
  );
  const selectedRelationKeys = new Set(
    selectedFacts
      .map(factValue => {
        const fact = asObject(factValue);
        return `${asString(fact.subject)}|${asString(fact.relation)}`;
      })
      .filter(key => key !== '|')
  );
  const contradictedRelationKeys = new Set(
    selectedFacts
      .filter(factValue => asString(asObject(factValue).status) === 'contradicted')
      .map(factValue => {
        const fact = asObject(factValue);
        return `${asString(fact.subject)}|${asString(fact.relation)}`;
      })
  );
  const latestConfirmedByRelation = new Map();
  for (const factValue of asArray(state.fact_cards)) {
    const fact = asObject(factValue);
    const key = `${asString(fact.subject)}|${asString(fact.relation)}`;
    const value = asString(fact.value).toLowerCase();
    if (
      !selectedRelationKeys.has(key) ||
      contradictedRelationKeys.has(key) ||
      asString(fact.status) !== 'confirmed' ||
      ['unconfirmed', 'unknown', 'missing', 'all_null', 'zero_match', 'completed_zero_match'].includes(value) ||
      !asString(fact.fact_id)
    ) {
      continue;
    }
    const prior = latestConfirmedByRelation.get(key);
    const factTime = Date.parse(asString(fact.source_ts)) || 0;
    const priorTime = Date.parse(asString(asObject(prior).source_ts)) || 0;
    if (!prior || factTime >= priorTime) latestConfirmedByRelation.set(key, fact);
  }
  for (const fact of latestConfirmedByRelation.values()) {
    matchedFactIds.add(asString(fact.fact_id));
  }

  // MATCHED_SUBJECT_FACT_CLOSURE_V5
  // Follow-up retrieval often selects only the relation named in the current
  // question. Carry the newest evidence-grounded confirmations for every
  // relation of the same matched subject so data, semantics, and event status
  // cannot silently diverge across turns.
  const selectedSubjects = new Set(
    selectedFacts.map(factValue => asString(asObject(factValue).subject)).filter(Boolean)
  );
  const latestConfirmedBySubjectRelation = new Map();
  for (const factValue of asArray(state.fact_cards)) {
    const fact = asObject(factValue);
    const subject = asString(fact.subject);
    const relation = asString(fact.relation);
    const value = asString(fact.value).toLowerCase();
    if (
      !selectedSubjects.has(subject) ||
      !relation ||
      asString(fact.status) !== 'confirmed' ||
      fact.evidence_grounded === false ||
      ['unconfirmed', 'unknown', 'missing', 'all_null', 'zero_match', 'completed_zero_match'].includes(value) ||
      !asString(fact.fact_id)
    ) continue;
    const key = `${subject}|${relation}`;
    const prior = latestConfirmedBySubjectRelation.get(key);
    const factTime = Date.parse(asString(fact.source_ts)) || 0;
    const priorTime = Date.parse(asString(asObject(prior).source_ts)) || 0;
    if (!prior || factTime >= priorTime) latestConfirmedBySubjectRelation.set(key, fact);
  }
  for (const fact of latestConfirmedBySubjectRelation.values()) {
    matchedFactIds.add(asString(fact.fact_id));
  }

  // SUPERSEDE_SAME_QUESTION_HISTORY_V5
  // A rerun of the same question may be used to repair stale or incorrect
  // output. When fresh tool evidence exists, old answer prose for that same
  // question is not consistency evidence and must not compete with the current
  // result. Structured fact cards remain available below.
  const canonicalQuestion = value => asString(value)
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
  const currentQuestionKey = canonicalQuestion(currentQuestion);
  const hasFreshToolEvidence = asArray(completedUnits).some(unitValue => {
    const unit = asObject(unitValue);
    const tool = asString(unit.tool);
    const status = asString(unit.execution_status || unit.status).toUpperCase();
    return tool && tool !== 'direct_response' && status !== 'TOOL_RUNTIME_ERROR' && status !== 'NO_EVIDENCE';
  });

  const turns = asArray(state.turns)
    .filter(turn => matchedTurnIds.has(asString(asObject(turn).turn_ref)))
    .filter(turnValue => {
      if (!hasFreshToolEvidence || !currentQuestionKey) return true;
      const turn = asObject(turnValue);
      return canonicalQuestion(turn.user_question || turn.resolved_question) !== currentQuestionKey;
    })
    .slice(-3)
    .map(turnValue => {
      const turn = asObject(turnValue);
      return {
        turn_ref: asString(turn.turn_ref),
        question: compact(turn.user_question || turn.resolved_question, 700),
        confirmed_answer_context: compact(turn.assistant_answer, 6000),
        answer_mode: asString(turn.answer_mode)
      };
    });
  // NO_SECONDARY_MATCHED_FACT_TRUNCATION_V5
  // Decompose already selected the relevant fact ids and conversation memory
  // already enforces its configured budget. A second positional truncation
  // can remove one status dimension while retaining its conflicting peer.
  const facts = asArray(state.fact_cards)
    .filter(fact => matchedFactIds.has(asString(asObject(fact).fact_id)))
    .map(factValue => {
      const fact = asObject(factValue);
      return {
        fact_id: asString(fact.fact_id),
        source_turn: asString(fact.source_turn),
        subject: asString(fact.subject),
        relation: asString(fact.relation),
        value: compact(
          typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value),
          1200
        ),
        status: asString(fact.status),
        entity_type: asString(fact.entity_type),
        entities: asArray(fact.entities).map(asString).filter(Boolean).slice(0, 12),
        note: compact(fact.note, 500)
      };
    });

  // STRUCTURED_REGISTRY_SEMANTIC_BRIDGE_V5
  // Older saved turns may contain availability facts while their catalog
  // descriptions live only in the structured Arctic target registry. Rejoin
  // that status dimension without inferring semantics from the tag code.
  const factSubjects = new Set(facts.map(fact => asString(fact.subject)).filter(Boolean));
  const semanticFactSubjects = new Set(
    facts
      .filter(fact => asString(fact.relation) === 'has_measurement_semantics')
      .map(fact => asString(fact.subject).toUpperCase())
      .filter(Boolean)
  );
  const registrySemanticFacts = asArray(state.arctic_target_registry)
    .map(asObject)
    .filter(row => {
      const sourceTurn = asString(row.source_turn);
      const tag = asString(row.tag);
      return tag &&
        !semanticFactSubjects.has(tag.toUpperCase()) &&
        (
          factSubjects.has(tag) ||
          (sourceTurn && matchedTurnIds.has(sourceTurn))
        );
    })
    .map(row => {
      const tag = asString(row.tag);
      const description = asString(row.desc_cn || row.desc_en);
      return {
        fact_id: `registry:${asString(row.source_turn) || 'saved'}:${tag}:semantics`,
        source_turn: asString(row.source_turn),
        subject: tag,
        relation: 'has_measurement_semantics',
        value: description || 'unconfirmed',
        // A catalog description identifies the physical column but does not prove
        // that the column is the requested engineering variable. Only an explicit
        // structured semantic status may promote it to a confirmed calculation input.
        status: [
          'confirmed_direct_match',
          'confirmed_by_explicit_mapping',
          'confirmed_by_user'
        ].includes(asString(row.semantic_status)) ? 'confirmed' : 'unconfirmed',
        entity_type: 'tag',
        entities: [tag],
        note: description
          ? 'Measurement semantics preserved from structured catalog metadata.'
          : 'Structured catalog metadata has no measurement description.'
      };
    });
  const combinedFacts = facts.concat(registrySemanticFacts);

  return {
    depends_on_history: true,
    matched_turns: turns,
    matched_facts: combinedFacts,
    inherited_entities: asArray(resolution.inherited_entities).map(asString).filter(Boolean).slice(0, 24),
    contract: {
      role: 'consistency_and_follow_up_context',
      current_direct_tool_evidence_precedence: true,
      old_evidence_ids_are_not_current_citations: true,
      same_question_answers_superseded_by_current_evidence: hasFreshToolEvidence
    }
  };
}

function buildCatalogLookupScopeStatus(units) {
  // CATALOG_LOOKUP_SCOPE_STATUS_V5
  const lookups = [];
  for (const unitValue of asArray(units)) {
    const unit = asObject(unitValue);
    if (asString(unit.tool) !== 'arctic_find_tags') continue;
    const raw = rawResultOf(unit);
    const tags = asArray(raw.tags);
    const executionStatus = asString(unit.execution_status) || 'UNKNOWN';
    const completed = executionStatus === 'SUCCESS';
    const classification = executionStatus === 'TOOL_RUNTIME_ERROR'
      ? 'runtime_error'
      : (completed && tags.length === 0 && Number(raw.count || 0) === 0
          ? 'completed_zero_match'
          : (completed && tags.length > 0 ? 'matched' : 'unknown'));
    lookups.push({
      query: asString(asObject(unit.params).query || raw.query),
      library: asString(raw.library || asObject(unit.params).library),
      symbol: asString(raw.symbol || asObject(unit.params).symbol),
      classification,
      match_count: tags.length,
      execution_status: executionStatus
    });
  }
  return {
    lookups,
    completed_zero_match_queries: lookups
      .filter(row => row.classification === 'completed_zero_match')
      .map(row => row.query),
    runtime_error_queries: lookups
      .filter(row => row.classification === 'runtime_error')
      .map(row => row.query),
    contract: {
      completed_zero_match_means: 'No catalog candidate was located in the stated lookup scope.',
      completed_zero_match_does_not_mean: 'The whole historian has no corresponding column or data.',
      runtime_error_means: 'Data availability remains unknown because lookup did not complete.'
    }
  };
}

// HISTORICAL_CALCULATION_CAPABILITY_BOUNDARY_V5
// Convert matched availability facts into one generic capability contract.
// This does not infer measurement semantics or recognize fixed questions/tags.
function buildHistoricalCalculationCapabilityBoundary(contextValue) {
  const context = asObject(contextValue);
  const bySubject = new Map();
  const dataRelations = new Set(['has_data_availability', 'has_data']);
  const semanticRelations = new Set([
    'has_measurement_semantics',
    'measurement_semantics',
    'semantic_identity'
  ]);
  const catalogRelations = new Set(['has_catalog_match', 'catalog_availability']);

  function ensure(subject) {
    if (!bySubject.has(subject)) {
      bySubject.set(subject, {
        subject,
        data_facts: [],
        semantic_facts: [],
        catalog_facts: []
      });
    }
    return bySubject.get(subject);
  }

  for (const factValue of asArray(context.matched_facts)) {
    const fact = asObject(factValue);
    const subject = asString(fact.subject);
    const relation = asString(fact.relation);
    if (!subject) continue;
    const row = {
      subject,
      relation,
      value: asString(fact.value),
      status: asString(fact.status),
      source_turn: asString(fact.source_turn),
      source_ts: asString(fact.source_ts),
      fact_id: asString(fact.fact_id)
    };
    const group = ensure(subject);
    if (dataRelations.has(relation)) group.data_facts.push(row);
    if (semanticRelations.has(relation)) group.semantic_facts.push(row);
    if (catalogRelations.has(relation)) group.catalog_facts.push(row);
  }

  function latestRelationFacts(rows) {
    const values = asArray(rows);
    if (!values.length) return [];
    const rank = row => {
      const turnMatch = asString(row.source_turn).match(/(\d+)/);
      if (turnMatch) return Number(turnMatch[1]);
      const timestamp = Date.parse(asString(row.source_ts));
      return Number.isFinite(timestamp) ? timestamp : 0;
    };
    const latest = Math.max(...values.map(rank));
    return values.filter(row => rank(row) === latest);
  }

  const confirmedInputs = [];
  const candidateInputs = [];
  const unavailableOrUnconfirmedInputs = [];
  for (const group of bySubject.values()) {
    const currentDataFacts = latestRelationFacts(group.data_facts);
    const currentSemanticFacts = latestRelationFacts(group.semantic_facts);
    const currentCatalogFacts = latestRelationFacts(group.catalog_facts);
    const dataConfirmed = currentDataFacts.some(
      row => row.status === 'confirmed' && row.value === 'confirmed_non_null'
    );
    // Conflicting same-turn facts must not promote a candidate. Confirmation is
    // authoritative only when every latest semantic record agrees.
    const semanticsConfirmed = currentSemanticFacts.length > 0 &&
      currentSemanticFacts.every(
        row => row.status === 'confirmed' && row.value !== 'unconfirmed'
      );
    const catalogUnconfirmed = currentCatalogFacts.some(
      row =>
        row.status !== 'confirmed' ||
        ['zero_match', 'completed_zero_match'].includes(row.value)
    );

    if (dataConfirmed && semanticsConfirmed) {
      confirmedInputs.push({
        subject: group.subject,
        data_status: 'confirmed_non_null',
        semantic_status: 'confirmed',
        source_fact_ids: currentDataFacts
          .concat(currentSemanticFacts)
          .map(row => row.fact_id)
          .filter(Boolean)
      });
    } else if (dataConfirmed) {
      candidateInputs.push({
        subject: group.subject,
        data_status: 'confirmed_non_null',
        semantic_status: 'unconfirmed',
        source_fact_ids: currentDataFacts.map(row => row.fact_id).filter(Boolean)
      });
    } else if (catalogUnconfirmed || group.data_facts.length || group.semantic_facts.length) {
      unavailableOrUnconfirmedInputs.push({
        subject: group.subject,
        data_status: 'unavailable_or_unconfirmed',
        semantic_status: semanticsConfirmed ? 'confirmed' : 'unconfirmed',
        source_fact_ids: currentCatalogFacts
          .concat(currentDataFacts, currentSemanticFacts)
          .map(row => row.fact_id)
          .filter(Boolean)
      });
    }
  }

  const active =
    confirmedInputs.length > 0 ||
    candidateInputs.length > 0 ||
    unavailableOrUnconfirmedInputs.length > 0;
  return {
    active,
    confirmed_inputs: confirmedInputs,
    candidate_inputs: candidateInputs,
    unavailable_or_unconfirmed_inputs: unavailableOrUnconfirmedInputs,
    current_execution_contract: {
      executable_now:
        'Only calculations whose complete required input set is contained in confirmed_inputs may be described as currently executable.',
      candidate_only:
        'candidate_inputs have non-null data but unconfirmed measurement semantics and cannot be used directly.',
      conditional_only:
        'A documented formula or method is theoretical/conditional when any required input is candidate, unavailable, or unconfirmed.',
      prohibited_overclaim:
        'Do not convert literature examples, generic formulas, or partial measurements into a claim that the full current calculation can be performed.',
      scope:
        'Zero catalog match is limited to the matched historical lookup scope and does not prove whole-historian absence.'
    }
  };
}

// SCOPED_CALCULATION_CLAIMS_V5
// Keep theoretical method claims usable without allowing them to masquerade
// as calculations executable with the currently confirmed input set.
function scopeCalculationClaims(claimsValue, boundaryValue) {
  const boundary = asObject(boundaryValue);
  if (boundary.active !== true) return asArray(claimsValue);

  return asArray(claimsValue).map(claimValue => {
    const claim = asObject(claimValue);
    const sourceType = asString(claim.source_type);
    if (sourceType !== 'document_knowledge') return claim;
    return {
      ...claim,
      current_executability: 'theoretical_or_conditional',
      current_executability_reason:
        'Matched history contains one or more unavailable or unconfirmed required inputs.'
    };
  });
}

const conversationConsistencyContext = consistencyContextFromMatchedHistory();

// CONFIRMED_EVENT_CHARACTERIZATION_V5
function confirmedMatchedEventAnchor(contextValue) {
  const candidates = asArray(asObject(contextValue).matched_facts)
    .filter(factValue => {
      const fact = asObject(factValue);
      const value = asString(fact.value).toLowerCase();
      const isEventFact =
        asString(fact.entity_type).toLowerCase() === 'event' ||
        ['event_identity', 'has_statistical_anomaly'].includes(
          asString(fact.relation).toLowerCase()
        );
      return (
        isEventFact &&
        asString(fact.status).toLowerCase() === 'confirmed' &&
        value &&
        value !== 'none'
      );
    });
  if (!candidates.length) return null;

  // PRIMARY_MATCHED_EVENT_FACT_V5
  // Subject closure may add related historical events. The event explicitly
  // selected by the current decomposition remains the authoritative anchor.
  let primaryIds = new Set();
  try {
    const decomposed = toInternalPacketContract($('Decompose Question').first().json || {});
    const parsed = parseNodeJson(decomposed.output || decomposed.answer || decomposed);
    primaryIds = new Set(
      asArray(asObject(parsed.memory_resolution).matched_fact_ids)
        .map(asString)
        .filter(Boolean)
    );
  } catch (e) {}
  const preferred = candidates.filter(
    factValue => primaryIds.has(asString(asObject(factValue).fact_id))
  );
  const fact = asObject((preferred.length ? preferred : candidates)[0]);
  const eventText = [
    asString(fact.value),
    asString(fact.note),
    asArray(fact.numbers).join(' ')
  ].join(' ');
  const timestampMatch = eventText.match(
    /\b(20\d{2}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}(?::\d{2})?))?\b/
  );
  // ARCTIC_TIMEZONE_EVENT_ANCHOR_V5
  let priorComputedAnchor = '';
  try {
    const state = asObject(toInternalPacketContract($('Capture context').first().json.conversation_state));
    const priorEvent = asObject(state.event_status);
    const priorWindow = asObject(priorEvent.event_window);
    const strongest = asObject(asObject(priorEvent.statistical_anomaly).strongest_event);
    const factEntities = new Set(
      asArray(fact.entities).concat([fact.subject]).map(asString).filter(Boolean)
    );
    const sameEvent =
      !asString(strongest.column) ||
      factEntities.has(asString(strongest.column));
    if (
      asString(priorEvent.status).toLowerCase() === 'confirmed' &&
      sameEvent &&
      asString(priorWindow.anchor_timestamp)
    ) {
      // STRONGEST_EVENT_ANCHOR_PRECEDENCE_V5
      priorComputedAnchor =
        asString(strongest.timestamp) ||
        asString(priorWindow.anchor_timestamp);
    }
  } catch (e) {}
  const anchorTimestamp = priorComputedAnchor || (
    timestampMatch
      ? `${timestampMatch[1]} ${timestampMatch[2] || '00:00:00'}`
      : ''
  );
  return {
    source_fact_id: asString(fact.fact_id),
    source_turn: asString(fact.source_turn),
    subject: asString(fact.subject),
    relation: asString(fact.relation),
    value: fact.value,
    entities: asArray(fact.entities),
    note: asString(fact.note),
    anchor_timestamp: anchorTimestamp,
    status: 'confirmed',
    interpretation_rule:
      'The current turn characterizes this inherited event. Other anomalies found in a wider context window cannot replace it.'
  };
}

const anchoredFollowUpEvent =
  confirmedMatchedEventAnchor(conversationConsistencyContext);
const effectiveEventEvidenceStatus = anchoredFollowUpEvent
  ? {
      ...eventEvidenceStatus,
      status: 'confirmed',
      event_type: 'inherited_statistical_anomaly',
      inherited_event_anchor: anchoredFollowUpEvent,
      event_window: {
        status: 'anchor_from_matched_fact',
        source: anchoredFollowUpEvent.source_fact_id,
        anchor_timestamp: anchoredFollowUpEvent.anchor_timestamp,
        description: anchoredFollowUpEvent.note
      }
    }
  : eventEvidenceStatus;

let historicalCalculationCapabilityBoundary =
  buildHistoricalCalculationCapabilityBoundary(conversationConsistencyContext);
const scopedCalculationClaims = scopeCalculationClaims(
  payload.claim_blocks,
  historicalCalculationCapabilityBoundary
);
const catalogLookupScopeStatus = buildCatalogLookupScopeStatus(completedUnits);

// DETERMINISTIC_PERIOD_PROFILE_CLAIMS_V5
// Period-profile numbers already come from the computation tool. Rebuild their
// claims from structured fields so an LLM cannot add unsupported rankings or
// reinterpret percentage direction for a non-positive baseline.
function finiteNumber(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
}

function deterministicPeriodProfileClaims(units, claims) {
  const sourceClaims = asArray(claims);
  const replacements = [];
  const replacedUnitIds = new Set();

  for (const unitValue of asArray(units)) {
    const unit = asObject(unitValue);
    if (asString(unit.tool) !== 'arctic_analyze') continue;
    const raw = rawResultOf(unit);
    const rows = asArray(raw.period_profile);
    if (!rows.length) continue;

    const unitId = Number(unit.unit_id);
    const evidenceIds = Array.from(new Set(
      sourceClaims
        .filter(claimValue => Number(asObject(claimValue).unit_id) === unitId)
        .flatMap(claimValue => asArray(asObject(claimValue).supported_by_evidence_ids))
        .map(asString)
        .filter(Boolean)
    ));
    replacedUnitIds.add(unitId);

    for (const rowValue of rows) {
      const row = asObject(rowValue);
      const column = asString(row.column);
      if (!column) continue;
      const count = finiteNumber(row.count);
      const first = finiteNumber(row.first);
      const latest = finiteNumber(row.latest);
      const changeAbs = finiteNumber(row.change_abs);
      const changePct = finiteNumber(row.change_pct);
      const allNull = row.all_null === true || count === 0;
      const parts = [`${column}: count=${count ?? 0}`];

      if (allNull) {
        parts.push('all_null=true');
      } else {
        parts.push(`first=${first ?? 'unknown'}`);
        parts.push(`latest=${latest ?? 'unknown'}`);
        parts.push(`change_abs=${changeAbs ?? 'unknown'}`);
        if (first != null && first > 0 && changePct != null) {
          parts.push(`change_pct=${changePct}`);
        } else if (changePct != null) {
          parts.push('change_pct omitted because the baseline is non-positive');
        }
      }

      replacements.push({
        claim_id: `PP${unitId}_${replacements.length + 1}`,
        unit_id: unitId,
        claim_type: 'historical_observation',
        source_type: 'sensor_data',
        tool: 'arctic_analyze',
        claim_text: parts.join(', '),
        supported_by_evidence_ids: evidenceIds,
        confidence_note: null,
        scope: 'measured_period_verification',
        supports_question_part: 'period_verification',
        inferential_use: 'period_evidence',
        analysis_note:
          'Deterministically generated from ArcticDB period_profile; no ranking or engineering semantics inferred.'
      });
    }
  }

  if (!replacedUnitIds.size) return sourceClaims;
  return sourceClaims
    .filter(claimValue => {
      const claim = asObject(claimValue);
      return !(
        replacedUnitIds.has(Number(claim.unit_id)) &&
        asString(claim.supports_question_part) === 'period_verification'
      );
    })
    .concat(replacements);
}

const finalCalculationClaims = deterministicPeriodProfileClaims(
  completedUnits,
  scopedCalculationClaims
);

// HISTORICAL_TAG_SEMANTIC_INHERITANCE_V5
// Empty metadata in a later lookup is not contradictory evidence. Preserve a
// measurement identity already confirmed by matched history until current
// evidence explicitly supplies a different identity.
function inheritMatchedHistoryTagSemantics(rowsValue, boundaryValue) {
  const confirmedSubjects = new Set(
    asArray(asObject(boundaryValue).confirmed_inputs)
      .map(row => asString(asObject(row).subject).toUpperCase())
      .filter(Boolean)
  );
  return asArray(rowsValue).map(rowValue => {
    const row = asObject(rowValue);
    const key = asString(row.tag).toUpperCase();
    if (
      !confirmedSubjects.has(key) ||
      asString(row.semantic_status) !== 'unconfirmed' ||
      asString(row.desc_cn) ||
      asString(row.desc_en)
    ) {
      return row;
    }
    const dataConfirmed = asString(row.data_status) === 'confirmed_non_null';
    return {
      ...row,
      semantic_status: 'confirmed_by_matched_history',
      classification: dataConfirmed
        ? 'semantic_and_data_confirmed'
        : 'metadata_confirmed_data_unverified',
      semantic_source: 'matched_history'
    };
  });
}

const tagEvidenceStatus = inheritMatchedHistoryTagSemantics(
  buildTagEvidenceStatus(completedUnits),
  historicalCalculationCapabilityBoundary
);

// CURRENT_RUN_CALCULATION_BOUNDARY_RECONCILIATION_V5
// Matched history supplies candidate semantics; the current execution is
// authoritative for which columns were actually checked and found non-null.
function reconcileCalculationBoundary(boundaryValue, statusRows) {
  const boundary = asObject(boundaryValue);
  const confirmed = new Map(asArray(boundary.confirmed_inputs).map(row => [asString(asObject(row).subject).toUpperCase(), asObject(row)]));
  const candidates = new Map(asArray(boundary.candidate_inputs).map(row => [asString(asObject(row).subject).toUpperCase(), asObject(row)]));
  const unresolved = new Map(asArray(boundary.unavailable_or_unconfirmed_inputs).map(row => [asString(asObject(row).subject).toUpperCase(), asObject(row)]));

  for (const value of asArray(statusRows)) {
    const row = asObject(value);
    const subject = asString(row.tag);
    const key = subject.toUpperCase();
    if (!key) continue;
    const dataConfirmed = asString(row.data_status) === 'confirmed_non_null';
    const semanticConfirmed = [
      'confirmed_direct_match',
      'confirmed_by_matched_history'
    ].includes(asString(row.semantic_status));
    if (dataConfirmed) {
      confirmed.delete(key);
      candidates.delete(key);
      unresolved.delete(key);
      const target = semanticConfirmed ? confirmed : candidates;
      target.set(key, {
        subject,
        data_status: 'confirmed_non_null',
        semantic_status: semanticConfirmed ? 'confirmed' : 'unconfirmed',
        verification_source: 'current_execution'
      });
    } else if (unresolved.has(key)) {
      unresolved.set(key, {
        ...unresolved.get(key),
        data_status: asString(row.data_status) === 'not_checked'
          ? 'not_verified_in_current_run'
          : asString(row.data_status)
      });
    }
  }

  return {
    ...boundary,
    active: confirmed.size > 0 || candidates.size > 0 || unresolved.size > 0,
    confirmed_inputs: Array.from(confirmed.values()),
    candidate_inputs: Array.from(candidates.values()),
    unavailable_or_unconfirmed_inputs: Array.from(unresolved.values())
  };
}

historicalCalculationCapabilityBoundary = reconcileCalculationBoundary(
  historicalCalculationCapabilityBoundary,
  tagEvidenceStatus
);

const enrichedPayload = {
  ...payload,
  claim_blocks: finalCalculationClaims,
  conversation_consistency_context: conversationConsistencyContext,
  historical_calculation_capability_boundary: historicalCalculationCapabilityBoundary,
  current_calculation_status: historicalCalculationCapabilityBoundary.active
    ? {
        full_calculation: (
          historicalCalculationCapabilityBoundary.candidate_inputs.length > 0 ||
          historicalCalculationCapabilityBoundary.unavailable_or_unconfirmed_inputs.length > 0
        ) ? 'incomplete' : 'not_assessed',
        currently_confirmed_inputs:
          historicalCalculationCapabilityBoundary.confirmed_inputs.map(row => row.subject),
        candidate_inputs_requiring_semantic_confirmation:
          historicalCalculationCapabilityBoundary.candidate_inputs.map(row => row.subject),
        inputs_requiring_resolution:
          historicalCalculationCapabilityBoundary.unavailable_or_unconfirmed_inputs
            .map(row => row.subject),
        document_methods_status: (
          historicalCalculationCapabilityBoundary.candidate_inputs.length > 0 ||
          historicalCalculationCapabilityBoundary.unavailable_or_unconfirmed_inputs.length > 0
        ) ? 'theoretical_or_conditional' : 'not_assessed',
        partial_calculation_capability: {
          per_signal_descriptive_analysis:
            historicalCalculationCapabilityBoundary.confirmed_inputs.length > 0
              ? 'executable_for_confirmed_inputs'
              : 'no_confirmed_input',
          synchronized_multi_signal_analysis:
            historicalCalculationCapabilityBoundary.confirmed_inputs.length >= 2
              ? 'executable_after_time_and_unit_alignment'
              : 'insufficient_confirmed_inputs',
          formula_subset_terms:
            'requires_explicit_formula_dependency_and_unit_mapping',
          full_formula_closure: (
            historicalCalculationCapabilityBoundary.candidate_inputs.length > 0 ||
            historicalCalculationCapabilityBoundary.unavailable_or_unconfirmed_inputs.length > 0
          ) ? 'not_executable_with_current_inputs' : 'not_assessed'
        }
      }
    : { full_calculation: 'not_assessed' },
  catalog_lookup_scope_status: catalogLookupScopeStatus,
  event_evidence_status: effectiveEventEvidenceStatus,
  anchored_follow_up_event: anchoredFollowUpEvent,
  tag_evidence_status: tagEvidenceStatus,
  tag_evidence_status_contract: {
    mutually_exclusive: true,
    direct_use_requires: ['confirmed_direct_match', 'confirmed_non_null'],
    rule: 'A tag is direct-use only when selected=true and match_type=direct_match, and stats confirm non-null data. contextual_match remains candidate-only even when data is non-null.'
  }
};

// COMPACT_FINALIZER_BOUNDARY_V5
// Keep the full payload for audit/state handling, but send the final-answer
// model one non-duplicated projection. Repeated search queries and derived
// question buckets do not add factual support.
function tagsMentionedInClaims(claims) {
  const text = JSON.stringify(asArray(claims));
  const matches = text.match(/\b[A-Za-z][A-Za-z0-9_]*\d[A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)?\b/g) || [];
  return new Set(matches.map(value => value.toUpperCase()));
}

const finalizerClaimTags = tagsMentionedInClaims(finalCalculationClaims);
const fullTagTrace = asArray(enrichedPayload.tag_selection_trace);
let finalizerTagTrace = fullTagTrace.filter(traceValue => {
  const trace = asObject(traceValue);
  return finalizerClaimTags.has(asString(trace.tag || trace.name).toUpperCase());
});
if (!finalizerTagTrace.length) finalizerTagTrace = fullTagTrace;
finalizerTagTrace = finalizerTagTrace.slice(0, 20).map(traceValue => {
  const trace = asObject(traceValue);
  return {
    tag: asString(trace.tag || trace.name),
    desc_cn: asString(trace.desc_cn || trace.description_cn),
    desc_en: asString(trace.desc_en || trace.description_en),
    rank: trace.rank ?? null,
    match_type: asString(trace.match_type),
    selected: trace.selected === true,
    process_factor: asString(trace.process_factor || trace.process_factor_id),
    reason: compact(trace.reason || trace.selection_reason || '', 500),
    source: asString(trace.source),
    library: asString(trace.library),
    symbol: asString(trace.symbol),
    what_it_measures: compact(trace.what_it_measures || trace.target || '', 500)
  };
});

const finalizerTraceTags = new Set(
  finalizerTagTrace.map(row => asString(row.tag).toUpperCase()).filter(Boolean)
);
const finalizerTagStatus = tagEvidenceStatus
  .filter(rowValue => {
    const row = asObject(rowValue);
    const tag = asString(row.tag).toUpperCase();
    return (
      finalizerTraceTags.has(tag) ||
      asString(row.data_status) !== 'not_checked' ||
      asString(row.semantic_status) !== 'unconfirmed'
    );
  })
  .slice(0, 32);

// AUTHORITATIVE_MEASURED_RESULTS_V5
function compactMeasuredResult(unitValue) {
  const unit = asObject(unitValue);
  const tool = asString(unit.tool);
  if (!tool.startsWith('arctic_')) return null;
  const raw = rawResultOf(unit);
  const params = asObject(unit.params);
  const requestedColumns = asArray(raw.requested_columns).length
    ? asArray(raw.requested_columns)
    : asArray(params.columns);
  const returnedColumns = asArray(raw.returned_columns);
  const analyzedColumns = asArray(raw.columns_analyzed);
  const missingColumns = asArray(raw.missing_columns);
  const allNullColumns = asArray(raw.all_null_columns);
  const columnStats = asObject(raw.column_stats);
  const constantColumns = Object.entries(columnStats)
    .filter(([, stats]) => asObject(stats).constant === true)
    .map(([column]) => column);
  const variableColumns = Object.entries(columnStats)
    .filter(([, stats]) => asObject(stats).constant === false)
    .map(([column]) => column);

  const requestedTargets = asArray(params.targets);
  const returnedTargets = asArray(raw.targets);
  const requestedTargetNames = requestedTargets.map(t => asString(asObject(t).name)).filter(Boolean);
  const returnedTargetNames = returnedTargets.map(t => asString(asObject(t).name)).filter(Boolean);
  const missingTargetNames = requestedTargetNames.filter(name => !returnedTargetNames.includes(name));
  const coverageComplete = !requestedTargetNames.length || missingTargetNames.length === 0;

  const correlations = asArray(raw.ranked_correlations);
  const lags = asArray(raw.lag_findings);
  const relationshipRequested = asArray(raw.analysis_types)
    .some(type => /correlation|lag/i.test(asString(type)));
  const relationshipIdentifiability = relationshipRequested
    ? {
        sample_coverage_status: asArray(raw.data_quality).length
          ? 'reported'
          : 'not_reported',
        variability_status: asArray(raw.period_profile).some(row => {
          const value = asObject(row);
          return Number.isFinite(Number(value.std)) && Number(value.std) > 0;
        }) ? 'demonstrated' : 'not_demonstrated',
        retained_correlation_count: correlations.length,
        retained_lag_count: lags.length,
        relationship_judgment_supported: correlations.length > 0 || lags.length > 0,
        rule:
          'Complete samples alone do not prove sufficient variability. Empty result tables do not prove zero or statistically insignificant relationships.'
      }
    : null;

  const factorContext = asArray(unit.factor_context);
  const trace = asArray(unit.tag_selection_trace);
  const factorResolution = factorContext.map(factorValue => {
    const factor = asObject(factorValue);
    const name = asString(factor.name || factor.factor || factor.query);
    const matches = trace.filter(rowValue => {
      const row = asObject(rowValue);
      return asString(row.process_factor) === name || asString(row.process_factor_id) === name;
    });
    return {
      factor: name,
      direct_tags: matches
        .filter(row => asObject(row).selected === true && /direct/i.test(asString(asObject(row).match_type)))
        .map(row => asString(asObject(row).tag))
        .filter(Boolean),
      contextual_tags: matches
        .filter(row => /contextual/i.test(asString(asObject(row).match_type)))
        .map(row => asString(asObject(row).tag))
        .filter(Boolean)
        .slice(0, 3),
      resolution: matches.some(row => asObject(row).selected === true && /direct/i.test(asString(asObject(row).match_type)))
        ? 'direct_match'
        : 'unresolved'
    };
  }).filter(row => row.factor);

  return {
    unit_id: unit.unit_id ?? null,
    tool,
    execution_status: asString(unit.execution_status),
    authoritative_answer: asString(unit.answer),
    requested_range: asArray(raw.date_range).length ? asArray(raw.date_range) : asArray(params.date_range),
    returned_time_ranges: returnedTargets
      .map(target => asArray(asObject(target).time_range))
      .filter(range => range.length === 2),
    coverage_contract: {
      requested_target_count: requestedTargetNames.length,
      returned_target_count: returnedTargetNames.length,
      requested_target_names: requestedTargetNames,
      returned_target_names: returnedTargetNames,
      missing_target_names: missingTargetNames,
      full_requested_scope_returned: coverageComplete
    },
    column_counts: {
      requested: requestedColumns.length,
      returned: returnedColumns.length,
      analyzed: analyzedColumns.length,
      missing: missingColumns.length,
      all_null: allNullColumns.length,
      constant: constantColumns.length,
      variable: variableColumns.length
    },
    requested_columns: requestedColumns.slice(0, 64),
    returned_columns: returnedColumns.slice(0, 64),
    analyzed_columns: analyzedColumns.slice(0, 64),
    missing_columns: missingColumns.slice(0, 64),
    all_null_columns: allNullColumns.slice(0, 64),
    non_null_columns: asArray(raw.non_null_columns).slice(0, 64),
    null_columns: asArray(raw.null_columns).slice(0, 64),
    data_scope: asString(raw.data_scope),
    existence_conclusion_allowed: raw.existence_conclusion_allowed === true,
    constant_columns: constantColumns.slice(0, 64),
    variable_columns: variableColumns.slice(0, 64),
    factor_resolution: factorResolution.slice(0, 40),
    derived_quantity_results: asArray(raw.derived_quantity_results).slice(0, 6), // DERIVED_QUANTITY_COMPUTE_V8：代码算出的计算量（公式、各构成量位号与时段均值、结果）
    period_profile: asArray(raw.period_profile).slice(0, 24),
    baseline_comparison: asArray(raw.baseline_comparison).slice(0, 24),
    anomaly_windows: asArray(raw.anomaly_windows).slice(0, 24),
    data_quality: asArray(raw.data_quality).slice(0, 32),
    ranked_correlations: correlations.slice(0, 24),
    lag_findings: lags.slice(0, 24),
    warnings: asArray(raw.warnings).slice(0, 12),
    caveats: asArray(raw.caveats).slice(0, 12),
    timezone_contract: asObject(raw.timezone_contract),
    relationship_identifiability: relationshipIdentifiability
  };
}

const authoritativeMeasuredResults = completedUnits
  .map(compactMeasuredResult)
  .filter(Boolean);

// EVENT_LINKING_V7：汇总事件对照（数据↔文件、文件↔文件），并标出各自入包的证据编号
const __eventLinks = [];
for (const u of completedUnits) {
  const lk = asObject(asObject(asObject(u).params).event_link);
  if (!lk.kind) continue;
  __eventLinks.push({ ...lk, unit_id: u.unit_id, result: String(asObject(u).answer || '').slice(0, 600),
    evidence_ids: packet.filter(x => String(x.source_unit_id) === String(u.unit_id)).map(x => x.evidence_id) });
}

// PRIOR_DECLINED_TURN_CORRECTION_V7：之前没答上（守卫直答 / 要求澄清）、之后也还没有被带证据的回答接续过的轮次。
// 本轮有证据时交给 finalizer，由它说明该轮回答作废、现在确定了什么。
const __priorDeclinedTurns = (function () {
  try {
    if (!asArray(packet).length) return [];
    const cap = toInternalPacketContract($('Capture context').first().json || {});
    let st = cap.conversation_state || {};
    if (typeof st === 'string') { try { st = JSON.parse(st); } catch (e) { st = {}; } }
    const turns = asArray(st.turn_archive).length ? asArray(st.turn_archive) : asArray(st.turns);
    let pending = [];
    // PRIOR_TURN_CLEARED_WHEN_CORRECTED_V7：一直列出，直到后续某轮的回答点名纠正过它（该轮记录的 corrected_turns），或已过去 8 轮
    const __refOf = t => String(asObject(t).turn_ref || '').replace(/^T/i, '');
    const __corrected = new Set();
    for (const raw of turns) for (const r of asArray(asObject(raw).corrected_turns)) __corrected.add(String(r));
    turns.forEach((raw, i) => {
      const t = asObject(raw);
      if (t.declined_mode && !__corrected.has(__refOf(t)) && turns.length - i <= 8) pending.push(t);
    });
    return pending.slice(-3).map(t => ({
      turn_ref: String(t.turn_ref || '').replace(/^T/i, ''),
      user_question: String(t.user_question || '').slice(0, 120),
      declined_mode: String(t.declined_mode),
      said: String(t.assistant_answer || '').replace(/\s+/g, ' ').slice(0, 160)
    }));
  } catch (e) { return []; }
})();
const finalizerPayload = {
  prior_declined_turns: __priorDeclinedTurns,
  event_links: __eventLinks,
  draft_answer: enrichedPayload.draft_answer,
  claim_blocks: finalCalculationClaims,
  dependency_explanations: asArray(enrichedPayload.dependency_explanations),
  source_status: asObject(enrichedPayload.source_status),
  missing_evidence_flags: asArray(enrichedPayload.missing_evidence_flags),
  tag_selection_trace: finalizerTagTrace,
  evidence_summary: asArray(enrichedPayload.evidence_summary),
  evidence_digest: asArray(enrichedPayload.evidence_digest),
  analysis_notes: asArray(enrichedPayload.analysis_notes),
  cross_evidence_analysis: asObject(enrichedPayload.cross_evidence_analysis),
  conversation_consistency_context: asObject(enrichedPayload.conversation_consistency_context),
  historical_calculation_capability_boundary:
    asObject(enrichedPayload.historical_calculation_capability_boundary),
  current_calculation_status: asObject(enrichedPayload.current_calculation_status),
  catalog_lookup_scope_status: asObject(enrichedPayload.catalog_lookup_scope_status),
  event_evidence_status: asObject(enrichedPayload.event_evidence_status),
  anchored_follow_up_event: enrichedPayload.anchored_follow_up_event || null,
  tag_evidence_status: finalizerTagStatus,
  tag_evidence_status_contract: asObject(enrichedPayload.tag_evidence_status_contract),
  authoritative_measured_results: authoritativeMeasuredResults
};


// CROSS_TURN_ESTABLISHED_THRESHOLDS_V7
// T3 给出过 PDRA3125 的 LL10/L12/H42/HH45 与联锁 -15/60，T7 做完历史筛查却写
// "本轮未检索到明确的报警阈值"，把同一次对话里已确认的信息丢了。
// 数就在会话状态的 turns[].assistant_answer 里，但没有进 fact_cards（那里只有
// 位号→描述），finalizer 因此没有可比对的结构化输入。
// 摘原句而不是解析数值：解析正则易碎，原句能让 finalizer 自己读懂并对照。
const establishedThresholds = (function () {
  try {
    const cap = toInternalPacketContract($('Capture context').first().json || {});
    let st = cap.conversation_state || {};
    if (typeof st === 'string') { try { st = JSON.parse(st); } catch (e) { st = {}; } }
    const turns = (asArray(st.turn_archive).length ? asArray(st.turn_archive) : asArray(st.turns)); // CONVERSATION_ARCHIVE_V7：前序阈值句取自完整存档
    const TH = /(?:\bLL\b|\bHH\b|高高报|低低报|联锁低限|联锁高限|联锁值|报警值|报警设定|量程)/;
    const TAGRE = /[A-Z]{2,6}\d{3,5}[A-Z]?(?:\.[A-Z]{2,4})?/g;
    // F18b：只保留与本轮主体相关的阈值。实测 exec 134994 摘出的 4 条全是无关位号
    // （PDRCA3106 滑阀压降、PRC3201B 火炬压差、TRCA3101 出口温度），送进 finalizer
    // 轻则干扰，重则被拿去和两器压差的统计量做错误比对。
    const stripSuffix = function (x) {
      return String(x || '').toUpperCase().replace(/\.(PV|SP|OP|MV|SV|CV)$/i, '');
    };
    const subjectTags = (function () {
      const bag = new Set();
      const add = function (txt) {
        const found = String(txt || '').toUpperCase().match(TAGRE) || [];
        for (const m of found) bag.add(stripSuffix(m));
      };
      add(cap.originalUserMessage);
      add(cap.chatInput);
      add(st.latest_topic);
      add(st.latest_resolved_question);
      for (const c of asArray(st.fact_cards)) {
        const o = asObject(c);
        if (String(o.status || '') === 'confirmed') add(o.subject);
      }
      // THRESHOLD_EXTRACTION_NUMERIC_V7：设备上下文解析出的位号也算本轮主体
      // （MT25 T7：T3/T4 的联锁值句写的是 PDR3125，不在原主体位号集合里而被滤掉）
      try {
        const __dc = toInternalPacketContract(((($('Parse Device Context').first().json || {}).device_context) || {}));
        for (const x of asArray((__dc.device || {}).identifiers)) add(x);
      } catch (err) {}
      return bag;
    })();
    const out = [];
    const seenTxt = new Set();
    const __seenRec = new Map();
    const __expandTables = text => {
      const cells = L => String(L).trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.replace(/\s*\[E\d+\]/g, '').replace(/\*\*/g, '').trim());
      const lines = String(text || '').split('\n');
      const res = [];
      for (let i = 0; i < lines.length; i++) {
        const L = lines[i];
        if (/^\s*\|.*\|\s*$/.test(L) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
          const hdr = cells(L);
          i += 2;
          for (; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]); i++) {
            const c = cells(lines[i]);
            const body = hdr.map((h, k) => (c[k] && !/^[—\-–]+$/.test(c[k]) ? h + ' ' + c[k] : '')).filter(Boolean).join('，');
            if (body) res.push('表格行：' + body + '。');
          }
          i--;
          continue;
        }
        res.push(L);
      }
      return res.join('\n');
    };
    const __pending = []; // THRESHOLD_SUBJECT_FALLBACK_V7：因位号不属本轮主体而被滤掉的阈值句
    const __lk = x => { const m = String(x || '').match(/^([A-Z])[A-Z]*?(\d{3,5})/); return m ? m[1] + m[2] : ''; };
    for (let i = 0; i < turns.length; i++) {
      const t = asObject(turns[i]);
      const ans = String(t.assistant_answer || t.answer || '');
      if (!ans) continue;
      // THRESHOLDS_FROM_ANSWER_TABLES_V7：前序回答把阈值写进 Markdown 表格时（exec 155240），逐行展开成「表头 值」句子再解析
      for (const raw of __expandTables(ans).split(/(?<=[。；;\n])/)) {
        const sent = String(raw || '').trim();
        if (sent.length < 8 || sent.length > (sent.indexOf('表格行：') === 0 ? 480 : 320)) continue;
        if (!TH.test(sent)) continue;
        // THRESHOLD_EXTRACTION_NUMERIC_V7：去掉位号后须含带单位或比较符号的数值。
        // 原「含数字」会被位号自身的数字满足（MT25 T7 摘到的是 T6 一句不含任何阈值的建议）。
        // 也接受「阈值标签紧跟数值」（「报警设定为 HH 38、H 37、L 10、LL 9」这类不带单位的写法，简单多轮 T5 实测）。
        const __noTag = sent.replace(TAGRE, ' ');
        const __hasUnitOrCmp = /(?:[<>＜＞≤≥]\s*-?\d|-?\d+(?:\.\d+)?\s*(?:kPa|MPa|Pa|℃|°C|%|t\/h|mm|μm|um|N?m3\/h|Nm³\/h|kg\/m3))/i.test(__noTag);
        const __hasLabelNum = /(?:\bLL\b|\bHH\b|\bHI?\b|\bLO?\b|高高报|低低报|报警值|报警设定|联锁值|联锁低限|联锁高限|上限|下限|低限|高限)\s*[为是:：=]?\s*-?\d/i.test(__noTag);
        if (!__hasUnitOrCmp && !__hasLabelNum) continue;
        const sentTags = new Set((sent.toUpperCase().match(TAGRE) || []).map(stripSuffix));
        if (!sentTags.size) continue;
        if (subjectTags.size) {
          // THRESHOLD_EXTRACTION_NUMERIC_V7：同一回路的不同功能位号（PDR3125 / PDRA3125：首字母相同、回路号相同）视为同一主体。
          // 简单多轮 T5 实测：应急处置卡写 PDR3125、DCS 表写 PDRA3125，前者的联锁值句被当作无关位号滤掉。
          const __loopKey = t => { const m = String(t || '').match(/^([A-Z])[A-Z]*?(\d{3,5})/); return m ? m[1] + m[2] : ''; };
          const __subjectLoops = new Set(Array.from(subjectTags).map(__loopKey).filter(Boolean));
          let related = false;
          for (const x of sentTags) { if (subjectTags.has(x) || __subjectLoops.has(__loopKey(x))) { related = true; break; } }
          if (!related) { __pending.push({ t, sent, loops: Array.from(new Set(Array.from(sentTags).map(__lk).filter(Boolean))) }); continue; }
        }
        // 表格行按全文去重并计数（同一套定值出现几行就是几票）；普通句子仍按前 60 字去重
        const k = sent.indexOf('表格行：') === 0 ? sent : sent.slice(0, 60);
        if (seenTxt.has(k)) { const prevRec = __seenRec.get(k); if (prevRec) prevRec.weight = (prevRec.weight || 1) + 1; continue; }
        seenTxt.add(k);
        out.push({
          // THRESHOLD_STATUS_FROM_COMPARISON_V7：turns 是滑动窗口，下标不是轮次号，取记录自带的 turn_ref（"T3"）。
          turn_ref: t.turn_ref ? String(t.turn_ref).replace(/^T/i, '') : null,
          user_question: String(t.user_question || t.question || '').slice(0, 80),
          // PRIOR_CITATION_STRIP_V7：前序轮次的 [E…] 编号在本轮证据里不存在（exec 148647 T7 因此 0 引用），出处以 turn_ref 标注
          statement: sent.replace(/\s*\[E\d+\]/g, '').slice(0, 480)
        });
        __seenRec.set(k, out[out.length - 1]);
      }
    }
    // THRESHOLD_SUBJECT_FALLBACK_V7：主体位号集合里没有阈值所属回路时（exec 154572：位号目录查询返回 0、无已确认事实卡，
    // T3 的阈值句全部被滤掉），退到阈值句里出现最多的回路——至少 2 句且多于第二名，只取该回路的句子
    if (!out.length && __pending.length) {
      const cnt = new Map();
      for (const p of __pending) for (const l of p.loops) cnt.set(l, (cnt.get(l) || 0) + 1);
      const top = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]);
      if (top.length && top[0][1] >= 2 && (top.length === 1 || top[0][1] > top[1][1])) {
        for (const p of __pending) {
          if (p.loops.indexOf(top[0][0]) < 0) continue;
          const k = p.sent.indexOf('表格行：') === 0 ? p.sent : p.sent.slice(0, 60);
          if (seenTxt.has(k)) { const prevRec = __seenRec.get(k); if (prevRec) prevRec.weight = (prevRec.weight || 1) + 1; continue; }
          seenTxt.add(k);
          out.push({ turn_ref: p.t.turn_ref ? String(p.t.turn_ref).replace(/^T/i, '') : null,
            user_question: String(p.t.user_question || p.t.question || '').slice(0, 80),
            statement: p.sent.replace(/\s*\[E\d+\]/g, '').slice(0, 480) });
          __seenRec.set(k, out[out.length - 1]);
        }
      }
    }
    return out.slice(0, 12);
  } catch (e) {
    return [];
  }
})();

// THRESHOLD_COMPARISON_V7
// MT25 T7（exec 140834）：established_thresholds 已含 PDRA3125 的 HH 38 / H 37 / L 10 / LL 9 与联锁值 ＜-15、＞60 kPa，
// 实测 PDRA3125.PV 最大 43.9307，回答仍称「本轮未取到报警或联锁设定值」。提示词规则未被遵守，
// 因此在证据层直接算好比对结论交给 finalizer：只解析单一回路的阈值句，按「首字母+回路号」与实测列对应。
let __anchorLoops = null; // EXCEEDANCE_ANCHOR_SELECTION_V7：回路阈值与量程，供锚点选择用
let __thresholdRegistryOut = {}; // THRESHOLD_REGISTRY_V7
let __alarmTableMajorityOut = {}; // ALARM_TABLE_MAJORITY_V7
const __thresholdComparison = (function () {
  try {
    const TAG = /[A-Z]{2,6}\d{3,5}[A-Z]?/g;
    const loopKey = t => { const m = String(t || '').toUpperCase().match(/^([A-Z])[A-Z]*?(\d{3,5})/); return m ? m[1] + m[2] : ''; };
    const NUM = '(-?\\d+(?:\\.\\d+)?)';
    const SEP = '\\s*(?:均为|均是|为|是|[:：=])?\\s*'; // THRESHOLD_MAJORITY_V7：「均为」
    const LABELS = [
      ['HH', new RegExp('(?:PVHHALM(?:\\.\\s*TP)?|(?<![A-Za-z])HH(?![A-Za-z])|高高报(?:警)?(?:设定)?(?:值)?)' + SEP + NUM)],
      ['LL', new RegExp('(?:PVLLALM(?:\\.\\s*TP)?|(?<![A-Za-z])LL(?![A-Za-z])|低低报(?:警)?(?:设定)?(?:值)?)' + SEP + NUM)],
      ['H', new RegExp('(?:PVHIALM(?:\\.\\s*TP)?|(?<![A-Za-z])HI?(?![A-Za-z])|(?<!高)高报(?:警)?(?:设定)?(?:值)?)' + SEP + NUM)],
      ['L', new RegExp('(?:PVLOALM(?:\\.\\s*TP)?|(?<![A-Za-z])LO?(?![A-Za-z])|(?<!低)低报(?:警)?(?:设定)?(?:值)?)' + SEP + NUM)]
    ];
    // THRESHOLD_RESOLVER_V8：阈值「哪个值算数」只在这里裁决一次（取代原先分散的 9 条规则：note 先到先得、登记表先播种、
    // 逐档句数多数、表格多数加票、表格整行多数、表格补缺、状态保存先到先得、联锁两种写法各一套、量程先到先得）。
    // 候选来源三类：证据表格的整行定值、前序回答里的阈值句、会话已登记的值。规则：
    //   ① 报警四档（LL/L/H/HH）：有表格定值时整套取表格（多套时取行数唯一最多的一套；本轮表格与会话已存的表格观察取行数多的一次），
    //      与已登记值不同则更正并写明；
    //   ② 其余档位、以及没有表格定值的报警档：已登记的值沿用；未登记的，阈值句里只出现过一个取值才登记；
    //   ③ 出现过多个取值的不登记，记为「有冲突」，比对句里对每个候选值各给一次判断，不替用户择一
    //      （不按句数取多数：回答里复述某个值的句子会给它加票，exec 155457 把「工艺卡片/联锁高限 40（另一行 60）」登记成联锁上限 40）；
    //   ④ 报警四档须满足 LL ≤ L < H ≤ HH，不满足的整套不用（表格里未组态的档位常填 0，exec 155443 给一再三旋差压登记了 HH 0 / H 0 / LL 0）。
    const byLoop = new Map();
    const recOf = key => { if (!byLoop.has(key)) byLoop.set(key, { values: {}, turns: new Set(), sources: {}, conflicts: [], corrected: [] }); return byLoop.get(key); };
    const ALARM = ['LL', 'L', 'H', 'HH'];
    const monotonic = v => {
      const xs = ALARM.filter(l => l in v).map(l => [l, Number(v[l])]);
      if (xs.some(x => !Number.isFinite(x[1]))) return false;
      for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
        const sameSide = (xs[i][0].charAt(0) === xs[j][0].charAt(0));
        if (sameSide ? xs[i][1] > xs[j][1] : xs[i][1] >= xs[j][1]) return false;
      }
      return true;
    };
    const normNum = s => Number(String(s == null ? '' : s).replace(/[−－﹣]/g, '-').replace(/[^\d.+-]/g, ''));
    let __st = {};
    try {
      const __cap = toInternalPacketContract($('Capture context').first().json || {});
      __st = __cap.conversation_state || {};
      if (typeof __st === 'string') { try { __st = JSON.parse(__st); } catch (err) { __st = {}; } }
    } catch (err) { __st = {}; }
    const __storedReg = asObject(asObject(__st).threshold_registry);
    const __storedMaj = asObject(asObject(__st).alarm_table_majority);
    // 会话已登记的回路先建档，量程沿用（会话 turns 只保留最近几轮，登记表是跨轮的依据）
    for (const [key, raw] of Object.entries(__storedReg)) {
      const rec = recOf(key);
      const sp = asObject(asObject(raw).span);
      if (Number.isFinite(Number(sp.lo)) && Number.isFinite(Number(sp.hi)) && sp.lo !== null && sp.hi !== null) rec.span = { lo: Number(sp.lo), hi: Number(sp.hi) };
    }
    // —— 阈值句候选：每个（回路，档位）下各取值的票数 ——
    const __cand = new Map(); let __order = 0;
    const vote = (key, label, val, turn, weight) => {
      if (!Number.isFinite(val)) return;
      const vk = key + '|' + label;
      if (!__cand.has(vk)) __cand.set(vk, new Map());
      const mm = __cand.get(vk);
      if (!mm.has(val)) mm.set(val, { n: 0, order: __order++, turn });
      mm.get(val).n += Number(weight) || 1;
    };
    for (const th of establishedThresholds) {
      // Unicode 负号（− U+2212、－、﹣）归一为 "-"（exec 154373：「量程 −100～100」「＜−15」均未解析）
      const sent = String((th && th.statement) || '').replace(/[−－﹣](?=\s*\d)/g, '-');
      const loops = new Set((sent.toUpperCase().match(TAG) || []).map(loopKey).filter(Boolean));
      if (loops.size !== 1) continue;
      const key = Array.from(loops)[0];
      const rec0 = recOf(key);
      // 阈值句点名的位号，表格取值时只认这些位号的行（回路号相同的附属位号不算）
      const __tb = rec0.tag_bases = rec0.tag_bases || new Set();
      for (const t of (sent.toUpperCase().match(TAG) || [])) __tb.add(t);
      let body = sent.replace(TAG, ' ');
      // THRESHOLD_LABEL_LIST_V8：「LL/L/H/HH 9/10/37/38」这类并列写法，档位串与数值串按位置对应；个数对不上的整段不解析。
      // 解析过的片段从句子里抹掉，免得单档正则把 HH 后面的第一个数（9）当成 HH（回归 T7 exec 156182）
      body = body.replace(/(?<![A-Za-z])((?:HH|LL|HI?|LO?)(?:\s*[\/／、]\s*(?:HH|LL|HI?|LO?)){1,3})(?![A-Za-z])\s*(?:均为|为|是|[:：=＝])?\s*(-?\d+(?:\.\d+)?(?:\s*[\/／、]\s*-?\d+(?:\.\d+)?){1,3})(?![\d.])/g, (all, ls, ns) => {
        const labs = ls.split(/[\/／、]/).map(x => x.trim().toUpperCase()).map(x => (x === 'HI' ? 'H' : (x === 'LO' ? 'L' : x)));
        const nums = ns.split(/[\/／、]/).map(x => Number(x.trim()));
        if (labs.length === nums.length && new Set(labs).size === labs.length) labs.forEach((lab, i) => vote(key, lab, nums[i], th.turn_ref, th.weight));
        return ' '.repeat(all.length);
      });
      for (const [label, re] of LABELS) {
        const m = body.match(re);
        if (m) vote(key, label, Number(m[1]), th.turn_ref, th.weight);
      }
      // 联锁值两种写法进同一个票池：「联锁低限 / 高限 N」（同一格里写了几个数的都算候选，如「-5（另一行 -15）」）与「联锁…＜N、＞N」
      for (const [label, re] of [['联锁下限', /联锁(?:低限|下限)\s*(?:为|是|[:：=])?\s*(-?\d+(?:\.\d+)?)([^，,、。；;：:）)]*)/], ['联锁上限', /联锁(?:高限|上限)\s*(?:为|是|[:：=])?\s*(-?\d+(?:\.\d+)?)([^，,、。；;：:）)]*)/]]) {
        const m = body.match(re);
        if (!m) continue;
        vote(key, label, Number(m[1]), th.turn_ref, th.weight);
        for (const extra of (String(m[2] || '').match(/-?\d+(?:\.\d+)?/g) || [])) if (Number(extra) !== Number(m[1])) vote(key, label, Number(extra), th.turn_ref, th.weight);
      }
      if (/联锁/.test(body)) {
        const lo = body.match(/(?:[<＜]|小于)\s*(-?\d+(?:\.\d+)?)/);
        const hi = body.match(/(?:[>＞]|大于)\s*(-?\d+(?:\.\d+)?)/);
        if (lo) vote(key, '联锁下限', Number(lo[1]), th.turn_ref, th.weight);
        if (hi) vote(key, '联锁上限', Number(hi[1]), th.turn_ref, th.weight);
      }
      const ctl = body.match(/(?:控制目标|控制区间|控制范围)[^。；\d-]{0,8}(-?\d+(?:\.\d+)?)\s*[-~～至]\s*(-?\d+(?:\.\d+)?)/);
      if (ctl) { vote(key, '控制区间下限', Number(ctl[1]), th.turn_ref, th.weight); vote(key, '控制区间上限', Number(ctl[2]), th.turn_ref, th.weight); }
      // 量程与阈值同源解析，单独存放（不进阈值表，免得被当成一条上/下限阈值）；已有量程的回路不改
      const __euHi = body.match(/(?:PVEUHI|量程上限)\s*(?:为|是|[:：=])?\s*(-?\d+(?:\.\d+)?)/);
      const __euLo = body.match(/(?:PVEULO|量程下限)\s*(?:为|是|[:：=])?\s*(-?\d+(?:\.\d+)?)/);
      const __span = body.match(/量程\s*(?:为|是|[:：])?\s*(-?\d+(?:\.\d+)?)\s*[~～至]\s*(-?\d+(?:\.\d+)?)/);
      // 「量程上限 100、下限 -100」：下限前不重复「量程」（exec 147601 的 T3/T6/T7 原话）
      const __pair = body.match(/量程上限\s*(?:为|是|[:：=])?\s*(-?\d+(?:\.\d+)?)\s*(?:[A-Za-z%℃°\/()（）]+\s*)?[，、,；;]?\s*下限\s*(?:为|是|[:：=])?\s*(-?\d+(?:\.\d+)?)/);
      let __lo = __euLo ? Number(__euLo[1]) : (__pair ? Number(__pair[2]) : (__span ? Number(__span[1]) : NaN));
      let __hi = __euHi ? Number(__euHi[1]) : (__pair ? Number(__pair[1]) : (__span ? Number(__span[2]) : NaN));
      // 兜底——「量程」后短距离内两个数，小者为下限、大者为上限（exec 148623：「量程上下限为 100 与 -100」）；两个数都要完整（exec 154373）
      if (!(Number.isFinite(__lo) && Number.isFinite(__hi))) {
        const __g = body.match(/量程[^。；;\d-]{0,12}(-?\d+(?:\.\d+)?)(?![\d.])([^。；;\d]{0,12}?)(?<![\d.])(-?\d+(?:\.\d+)?)(?![\d.])/);
        if (__g) {
          const a1 = Number(__g[1]);
          // 「0-800」：两数之间无其他字符时，连字符是范围符号而不是负号
          const a2 = (__g[2] === '' && __g[3].charAt(0) === '-') ? Number(__g[3].slice(1)) : Number(__g[3]);
          if (Number.isFinite(a1) && Number.isFinite(a2) && a1 !== a2) { __lo = Math.min(a1, a2); __hi = Math.max(a1, a2); }
        }
      }
      if (Number.isFinite(__lo) && Number.isFinite(__hi) && __hi > __lo && !rec0.span) rec0.span = { lo: __lo, hi: __hi };
    }
    // —— 证据表格候选：一次遍历，同时读量程列与报警档列 ——
    const HEADS = [
      ['HH', /PVHHALM|报警\s*[-－_]?\s*HH(?![A-Za-z])|高高报/i],
      ['H', /PVHIALM|报警\s*[-－_]?\s*H(?![A-Za-z])|(?<!高)高报(?!警值)/i],
      ['L', /PVLOALM|报警\s*[-－_]?\s*L(?![A-Za-z])|(?<!低)低报(?!警值)/i],
      ['LL', /PVLLALM|报警\s*[-－_]?\s*LL(?![A-Za-z])|低低报/i]
    ];
    const __tblNow = new Map(); // 回路 -> Map(整行定值签名 -> { vals, count, source, tags })
    for (const ent of packet) {
      const html = String((ent && (ent.snippet || ent.content_summary)) || '');
      if (!/<table\b/i.test(html)) continue;
      const rows = html.split(/<tr[^>]*>/i).slice(1)
        .map(r => r.split(/<t[hd][^>]*>/i).slice(1).map(c => c.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()));
      let hiIdx = -1, loIdx = -1, idx = null;
      for (const r of rows) {
        const hi = r.findIndex(c => /PVEUHI|量程\s*[-－_]?\s*(?:高|上)限/i.test(c));
        const lo = r.findIndex(c => /PVEULO|量程\s*[-－_]?\s*(?:低|下)限/i.test(c));
        const found = {};
        for (const [lab, re] of HEADS) { const i = r.findIndex(c => re.test(c)); if (i >= 0) found[lab] = i; }
        const isAlarmHead = Object.keys(found).length >= 2 && new Set(Object.values(found)).size === Object.keys(found).length;
        const isSpanHead = hi >= 0 && lo >= 0;
        if (isAlarmHead) idx = found;
        if (isSpanHead) { hiIdx = hi; loIdx = lo; }
        if (isAlarmHead || isSpanHead) continue;
        const rowTags = r.flatMap(c => (c.toUpperCase().match(TAG) || []));
        const keys = new Set(rowTags.map(loopKey).filter(Boolean));
        if (keys.size !== 1) continue;
        const key = Array.from(keys)[0];
        const rec = byLoop.get(key);
        const named = !rec || !rec.tag_bases || !rec.tag_bases.size || rowTags.some(t => rec.tag_bases.has(t));
        // 量程：只补已有记录的回路（不把表里其他回路带进登记表），只取阈值句点名位号的行，已有量程的不改
        if (hiIdx >= 0 && rec && named && !rec.span) {
          const vhi = normNum(r[hiIdx]), vlo = normNum(r[loIdx]);
          if (/\d/.test(String(r[hiIdx] || '')) && /\d/.test(String(r[loIdx] || '')) && Number.isFinite(vhi) && Number.isFinite(vlo) && vhi > vlo) rec.span = { lo: vlo, hi: vhi };
        }
        if (idx) {
          const vals = {};
          for (const [lab, i] of Object.entries(idx)) { const v = normNum(r[i]); if (/\d/.test(String(r[i] || '')) && Number.isFinite(v)) vals[lab] = v; } // THRESHOLD_ALL_VALUES_V1：NaN / - / 无 不当 0
          if (Object.keys(vals).length >= 2 && monotonic(vals)) {
            if (!__tblNow.has(key)) __tblNow.set(key, new Map());
            const m = __tblNow.get(key); const sig = JSON.stringify(ALARM.filter(l => l in vals).map(l => [l, vals[l]]));
            const cur = m.get(sig) || { vals, count: 0, source: String(ent.document_name || ''), tags: new Set() };
            cur.count++; for (const t of rowTags) cur.tags.add(t); m.set(sig, cur);
          }
        }
      }
    }
    // THRESHOLD_ALL_VALUES_V1：会话里保存过各套定值（all_sets）、本轮证据没再出现该表的回路，按保存的各套补回，跨轮仍并列
    for (const [k0, sv] of Object.entries(__storedMaj)) {
      if (__tblNow.has(k0) || !asArray(asObject(sv).all_sets).length) continue;
      const mm = new Map();
      for (const s0 of asArray(asObject(sv).all_sets)) {
        const o = asObject(s0); const vals0 = asObject(o.vals);
        if (Object.keys(vals0).length < 2 || !monotonic(vals0)) continue;
        mm.set(JSON.stringify(ALARM.filter(l => l in vals0).map(l => [l, vals0[l]])), { vals: vals0, count: Number(o.count) || 1, source: String(o.source || ''), tags: new Set(asArray(o.tags)), stored: true });
      }
      if (mm.size) __tblNow.set(k0, mm);
    }
    // 某回路的表格定值：行数唯一最多的一套；本轮观察与会话已存的观察取总行数多的一次（持平沿用已存的）
    const tableSetFor = key => {
      const rec = byLoop.get(key); const tb = rec && rec.tag_bases;
      const okTags = tags => !tb || !tb.size || !asArray(tags).length || asArray(tags).some(t => tb.has(t));
      let now = null;
      const m = __tblNow.get(key);
      if (m) {
        const ranked = Array.from(m.values()).filter(x => okTags(Array.from(x.tags))).sort((a, b) => b.count - a.count);
        if (ranked.length && (ranked.length === 1 || ranked[0].count > ranked[1].count)) {
          now = { values: ranked[0].vals, rows: ranked[0].count, total_rows: ranked.reduce((n, x) => n + x.count, 0), source: ranked[0].source, tags: Array.from(ranked[0].tags).slice(0, 12), sets: ranked.length };
        }
      }
      const sm = asObject(__storedMaj[key]); let stored = null;
      if (Object.keys(asObject(sm.values)).length >= 2 && monotonic(asObject(sm.values)) && okTags(sm.tags)) {
        stored = { values: asObject(sm.values), rows: Number(sm.rows) || 0, total_rows: Number(sm.total_rows) || 0, source: String(sm.source || ''), tags: asArray(sm.tags), sets: Number(sm.sets) || 2 };
      }
      if (stored && now) return now.total_rows > stored.total_rows ? now : stored;
      return stored || now;
    };
    // THRESHOLD_TABLE_TIE_V1：本轮证据表格里几套定值行数相同（没有唯一多数）时，按档位汇总各套取值与出处表名。
    // 原先 tableSetFor 返回空、也不记冲突，整套被静默放弃（exec 204278：TIA3216 报警位号表 H355/L310/LL305、
    // DCS 控制点统计表 HH348/H345/L310/LL305、Sheet2 HH350/H345/L280 各 1 行 → 登记为空、无比对，回答改用邻近 TR3217 的比对）。
    const tableTieFor = key => {
      const rec = byLoop.get(key); const tb = rec && rec.tag_bases;
      const okTags = tags => !tb || !tb.size || !asArray(tags).length || asArray(tags).some(t => tb.has(t));
      const m = __tblNow.get(key); if (!m) return null;
      const ranked = Array.from(m.values()).filter(x => okTags(Array.from(x.tags))).sort((a, b) => b.count - a.count);
      if (ranked.length < 2) return null; // THRESHOLD_ALL_VALUES_V1：不再只在打平时并列，多数行也不替用户择一
      // 各套都点名同一个位号才算同一块表的冲突；几套分属不同位号（如 LRC3201A / LRC3201B 同回路号）时不是冲突，仍不登记
      const common = ranked.map(x => new Set(x.tags)).reduce((a, b) => new Set(Array.from(a).filter(t => b.has(t))));
      if (!common.size) return null;
      const byLabel = {};
      for (const s0 of ranked) for (const [lab, v0] of Object.entries(s0.vals)) {
        const arr = byLabel[lab] = byLabel[lab] || [];
        let e = arr.find(x => x.value === Number(v0)); if (!e) { e = { value: Number(v0), sources: [] }; arr.push(e); }
        if (s0.source && e.sources.indexOf(s0.source) < 0) e.sources.push(s0.source);
      }
      return { byLabel, sets: ranked.length, total_rows: ranked.reduce((n, x) => n + x.count, 0) };
    };
    const measured = new Map();
    // INSTRUMENT_RANGE_VALIDITY_V7：按行保留（全时段分析每窗一行、统计每列一行），比对时按量程筛选
    // THRESHOLD_TABLE_TIE_V1：primary = 本轮主分析（时序统计 / 全时段分析）读到的列；因子解析附带读到的为 false
    const addStat = (col, mn, mx, range, primary) => {
      const c = String(col || '').trim(); if (!c) return;
      const lo = Number(mn), hi = Number(mx);
      if (!Number.isFinite(lo) && !Number.isFinite(hi)) return;
      if (!measured.has(c)) measured.set(c, { column: c, rows: [], primary: false });
      measured.get(c).rows.push({ min: lo, max: hi, range: range || '' });
      if (primary) measured.get(c).primary = true;
    };
    for (const u of asArray(completedUnits)) {
      const unit = asObject(u);
      if (!String(unit.tool || '').startsWith('arctic_')) continue;
      const raw = rawResultOf(unit);
      const tr = asArray(raw.time_range).length ? asArray(raw.time_range) : (asArray(raw.returned_time_ranges)[0] || []);
      const range = asArray(tr).map(String).join(' 至 ');
      for (const row of asArray(raw.period_profile)) {
        const r = asObject(row);
        const __rr = [r.first_timestamp || r.start || (asArray(r.date_range)[0]), r.latest_timestamp || r.last_timestamp || r.end || (asArray(r.date_range)[1])].filter(Boolean).map(String).join(' 至 ');
        addStat(r.column, r.min, r.max, __rr || range, true);
      }
      for (const [col, st] of Object.entries(asObject(raw.column_stats))) { const r = asObject(st); addStat(col, r.min, r.max, range, true); }
      // SAME_TURN_THRESHOLD_COMPARISON_V8：因子解析结果里的逐位号统计同样计入（阈值与实测同轮拿到的轮次，实测往往就来自这里）
      for (const fr of asArray(raw.factor_results)) for (const st of asArray(asObject(fr).stats)) {
        const r = asObject(st);
        addStat(r.tag || r.column, r.min, r.max, asArray(r.time_range).map(String).join(' 至 ') || range, false);
      }
    }
    // SAME_TURN_THRESHOLD_COMPARISON_V8：阈值与实测在同一轮拿到时（会话里还没有登记、也没有前序阈值句），
    // 本轮实测到的回路只要证据表格里有它的定值，就建档比对。原先这种轮次没有确定性比对，全靠模型自己比
    // （exec 159007 / 159028：「最小值 -3.6778 未达到低报 10，低侧无越限」），错话再被后面的轮次沿用。
    for (const col of measured.keys()) {
      const key = loopKey(col);
      if (!key || !__tblNow.has(key)) continue;
      if (byLoop.has(key) && !byLoop.get(key).same_turn) continue;
      const rec = recOf(key); rec.same_turn = true;
      const base = (String(col).toUpperCase().match(TAG) || [])[0];
      if (base) (rec.tag_bases = rec.tag_bases || new Set()).add(base);
    }
    // —— 裁决 ——
    for (const [key, rec] of byLoop.entries()) {
      const storedVals = asObject(asObject(__storedReg[key]).values);
      const storedTurns = asArray(asObject(__storedReg[key]).turns).filter(x => x != null && x !== '' && x !== 'computed');
      const ttie = tableTieFor(key); // THRESHOLD_ALL_VALUES_V1：同一位号有多套表格定值时一律并列
      const tset = ttie ? null : tableSetFor(key);
      const labels = new Set(Object.keys(storedVals));
      for (const vk of __cand.keys()) if (vk.indexOf(key + '|') === 0) labels.add(vk.slice(key.length + 1));
      if (tset) for (const l of Object.keys(tset.values)) labels.add(l);
      if (ttie) for (const l of Object.keys(ttie.byLabel)) labels.add(l);
      for (const label of labels) {
        const mm = __cand.get(key + '|' + label);
        const ranked = mm ? Array.from(mm.entries()).sort((a, b) => (b[1].n - a[1].n) || (a[1].order - b[1].order)) : [];
        const single = ranked.length === 1;
        const hasStored = (label in storedVals) && storedVals[label] !== null && Number.isFinite(Number(storedVals[label]));
        if (tset && (label in tset.values)) {
          const v = Number(tset.values[label]);
          rec.values[label] = v; rec.sources[label] = 'table';
          if (hasStored && Number(storedVals[label]) !== v) rec.corrected.push({ label, from: Number(storedVals[label]), to: v });
          const same = ranked.find(x => x[0] === v);
          if (same && same[1].turn != null) rec.turns.add(same[1].turn);
          const others = ranked.map(x => x[0]).filter(x => x !== v);
          if (others.length) (rec.table_others = rec.table_others || []).push(label + ' ' + others.join('/'));
          rec.table_used = tset;
        } else if (ttie && (label in ttie.byLabel)) {
          // THRESHOLD_TABLE_TIE_V1：各套表格只有一个取值、对话里也没有别的取值时照常登记；否则记为冲突，候选值连同出处表名一起保留
          const tv = ttie.byLabel[label];
          const extra = ranked.map(x => x[0]).filter(x => !tv.some(e => e.value === x));
          if (hasStored && !tv.some(e => e.value === Number(storedVals[label])) && extra.indexOf(Number(storedVals[label])) < 0) extra.push(Number(storedVals[label]));
          if (tv.length === 1 && !extra.length) { rec.values[label] = tv[0].value; rec.sources[label] = 'table'; }
          else rec.conflicts.push({ label, candidates: tv.map(e => e.value).concat(extra), origin: 'table_tie', candidate_sources: tv.map(e => ({ value: e.value, sources: e.sources.slice(0, 3) })) });
          rec.table_tie = ttie;
        } else if (hasStored) {
          rec.values[label] = Number(storedVals[label]); rec.sources[label] = 'stored';
          if (storedTurns.length) rec.turns.add(storedTurns[0]);
        } else if (single) {
          rec.values[label] = ranked[0][0]; rec.sources[label] = 'sentence';
          if (ranked[0][1].turn != null) rec.turns.add(ranked[0][1].turn);
        } else if (ranked.length) {
          rec.conflicts.push({ label, candidates: ranked.map(x => x[0]) });
        }
      }
      if (!monotonic(rec.values)) {
        const drop = ALARM.filter(l => (l in rec.values) && (!rec.table_used || rec.sources[l] !== 'table'));
        const all = monotonic(Object.fromEntries(Object.entries(rec.values).filter(([l]) => drop.indexOf(l) < 0))) ? drop : ALARM.filter(l => l in rec.values);
        rec.non_monotonic = all.map(l => l + ' ' + rec.values[l]);
        for (const l of all) { delete rec.values[l]; delete rec.sources[l]; }
        if (!ALARM.some(l => l in rec.values)) { rec.table_used = null; rec.table_others = []; }
      }
    }
    // 表格观察随会话保存：本轮主体回路的裁决所用观察，以及有多套定值且多数明确的其他回路（上限 30 个）
    for (const key of byLoop.keys()) { const t = tableSetFor(key); if (t) __alarmTableMajorityOut[key] = t; }
    for (const [key, m] of __tblNow) {
      if (key in __alarmTableMajorityOut || m.size < 2 || Object.keys(__alarmTableMajorityOut).length >= 30) continue;
      const ranked = Array.from(m.values()).sort((a, b) => b.count - a.count);
      if (ranked[0].count <= ranked[1].count) continue;
      __alarmTableMajorityOut[key] = { values: ranked[0].vals, rows: ranked[0].count, total_rows: ranked.reduce((n, x) => n + x.count, 0), source: ranked[0].source, tags: Array.from(ranked[0].tags).slice(0, 12), sets: ranked.length };
    }
    // THRESHOLD_ALL_VALUES_V1：有多套定值的回路，保存时带上全部几套（下一轮证据里没有该表时按各套补回）
    for (const [key, m] of __tblNow) {
      if (m.size < 2) continue;
      if (!(key in __alarmTableMajorityOut) && Object.keys(__alarmTableMajorityOut).length >= 30) continue;
      const all = Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 6).map(x => ({ vals: x.vals, count: x.count, source: x.source, tags: Array.from(x.tags).slice(0, 12) }));
      const base = asObject(__alarmTableMajorityOut[key]);
      __alarmTableMajorityOut[key] = Object.assign({}, base, { all_sets: all, sets: m.size, total_rows: Math.max(Number(base.total_rows) || 0, all.reduce((n, x) => n + x.count, 0)) });
    }
    // 有冲突的档位没有登记值；只在「是否越过」的定位里用各候选值中最外侧的一个（越过它即越过全部候选值），不用于「未越过」的判断
    for (const rec of byLoop.values()) {
      rec.certain = {};
      for (const c of asArray(rec.conflicts)) {
        const upper = ['HH', 'H', '联锁上限', '控制区间上限'].indexOf(c.label) >= 0;
        rec.certain[c.label] = upper ? Math.max.apply(null, c.candidates) : Math.min.apply(null, c.candidates);
      }
    }
    if (!byLoop.size) return [];
    __anchorLoops = new Map(byLoop);
    for (const [k, r] of byLoop.entries()) __thresholdRegistryOut[k] = { values: Object.assign({}, r.values), span: r.span || null, turns: Array.from(r.turns || []).filter(x => x != null && x !== '' && x !== 'computed'),
      sources: Object.assign({}, r.sources), conflicts: asArray(r.conflicts).slice(0, 8) };
    // 既没有阈值、也没有待裁决冲突的回路（只有量程）不参与比对
    for (const [k, r] of Array.from(byLoop.entries())) if (!Object.keys(r.values).length && !asArray(r.conflicts).length) byLoop.delete(k);
    if (!byLoop.size) return [];

    const fmt = x => (Number.isFinite(x) ? String(Math.round(x * 10000) / 10000) : '—');
    const out = [];
    // THRESHOLD_ALL_VALUES_V1：比对按完整位号取表格定值。回路键只用来找候选；本轮表格里有点名该位号的行，就只用这些行（各档不同取值并列）；
    // 表格里只有同回路其他位号的行（如 LRC3201A / LRC3201B 之于 LT3201B），表格定值不用于该位号。会话登记、对话原句来的档位照旧。
    const __colRec = (rec, col) => {
      const base = (String(col).toUpperCase().match(TAG) || [])[0];
      const m = __tblNow.get(loopKey(col));
      if (!base || !m || !m.size) return rec;
      const sets = Array.from(m.values()).filter(x => x.tags && x.tags.has(base));
      const out = Object.assign({}, rec, { values: {}, sources: {}, conflicts: [], table_used: null, table_tie: null, table_others: [], non_monotonic: [] });
      for (const [l, val] of Object.entries(rec.values)) if (rec.sources[l] !== 'table') { out.values[l] = val; out.sources[l] = rec.sources[l]; }
      for (const cf of asArray(rec.conflicts)) if (cf.origin !== 'table_tie') out.conflicts.push(cf);
      if (sets.length) {
        const byLabel = {};
        for (const s0 of sets) for (const [lab, v0] of Object.entries(s0.vals)) {
          const arr = byLabel[lab] = byLabel[lab] || [];
          let e = arr.find(x => x.value === Number(v0)); if (!e) { e = { value: Number(v0), sources: [] }; arr.push(e); }
          if (s0.source && e.sources.indexOf(s0.source) < 0) e.sources.push(s0.source);
        }
        for (const [lab, tv] of Object.entries(byLabel)) {
          delete out.values[lab]; delete out.sources[lab]; out.conflicts = out.conflicts.filter(x => x.label !== lab);
          if (tv.length === 1) { out.values[lab] = tv[0].value; out.sources[lab] = 'table'; }
          else out.conflicts.push({ label: lab, candidates: tv.map(e => e.value), origin: 'table_tie', candidate_sources: tv.map(e => ({ value: e.value, sources: e.sources.slice(0, 3) })) });
        }
        const total = sets.reduce((n, x) => n + x.count, 0);
        if (sets.length > 1) out.table_tie = { sets: sets.length, total_rows: total };
        else out.table_used = { values: sets[0].vals, rows: sets[0].count, total_rows: total, source: sets[0].source, sets: 1 };
        if (!monotonic(out.values)) {
          out.non_monotonic = ALARM.filter(l => l in out.values).map(l => l + ' ' + out.values[l]);
          for (const l of ALARM) { delete out.values[l]; delete out.sources[l]; }
        }
      }
      out.certain = {};
      for (const cf of out.conflicts) {
        const upper = ['HH', 'H', '联锁上限', '控制区间上限'].indexOf(cf.label) >= 0;
        out.certain[cf.label] = upper ? Math.max.apply(null, cf.candidates) : Math.min.apply(null, cf.candidates);
      }
      return (Object.keys(out.values).length || out.conflicts.length) ? out : null;
    };
    for (const __m of measured.values()) {
      const __rec0 = byLoop.get(loopKey(__m.column));
      if (!__rec0) continue;
      const rec = __colRec(__rec0, __m.column);
      if (!rec) continue;
      const v = rec.values;
      // INSTRUMENT_RANGE_VALIDITY_V7：超出量程的极值是量程外读数（坏值），不计入越限判定
      let sp = rec.span || null;
      // SPAN_PLAUSIBILITY_V7：登记的量程把一半以上的统计极值都排除在外，说明量程登记有误（exec 154386：量程被解析成 0～10，
      // 正常读数全被当成量程外，得出「最大值 0、未超过 HH」）。此时本轮不按量程剔除、不写回登记表，并在比对句里注明。
      let __spanNote = '';
      if (sp) {
        const ext = __m.rows.flatMap(r => [r.min, r.max]).filter(Number.isFinite);
        const outside = ext.filter(x => x < sp.lo || x > sp.hi).length;
        if (ext.length >= 2 && outside * 2 > ext.length) {
          __spanNote = '登记的量程 ' + sp.lo + '～' + sp.hi + ' 与实测不符（' + ext.length + ' 个统计极值中 ' + outside + ' 个在其外），本轮未按该量程剔除读数，量程需重新确认';
          rec.span = null; rec.span_implausible = true; sp = null;
          const __rk = loopKey(__m.column);
          if (__thresholdRegistryOut[__rk]) { __thresholdRegistryOut[__rk].span = null; __thresholdRegistryOut[__rk].span_rejected = true; }
        }
      }
      const inRange = x => Number.isFinite(x) && (!sp || (x >= sp.lo && x <= sp.hi));
      const oor = [];
      let vmax = NaN, vmin = NaN, rmax = '', rmin = '';
      for (const r of __m.rows) {
        if (Number.isFinite(r.max)) {
          if (inRange(r.max)) { if (!Number.isFinite(vmax) || r.max > vmax) { vmax = r.max; rmax = r.range; } }
          else oor.push({ side: 'max', value: r.max, range: r.range });
        }
        if (Number.isFinite(r.min)) {
          if (inRange(r.min)) { if (!Number.isFinite(vmin) || r.min < vmin) { vmin = r.min; rmin = r.range; } }
          else oor.push({ side: 'min', value: r.min, range: r.range });
        }
      }
      const m = { column: __m.column, max: vmax, min: vmin, range: rmax || rmin || ((__m.rows[0] || {}).range || '') };
      const parts = [];
      if (Number.isFinite(m.max)) {
        const hiBits = [];
        if ('HH' in v) hiBits.push((m.max > v.HH ? '高于' : '未超过') + ' HH ' + v.HH);
        if ('H' in v) hiBits.push((m.max > v.H ? '高于' : '未超过') + ' H ' + v.H);
        if ('联锁上限' in v) hiBits.push((m.max > v['联锁上限'] ? '高于' : '未超过') + '联锁上限 ' + v['联锁上限']);
        if ('控制区间上限' in v) hiBits.push((m.max > v['控制区间上限'] ? '高于' : '未超过') + '控制区间上限 ' + v['控制区间上限']);
        if (hiBits.length) parts.push('实测最大值 ' + fmt(m.max) + '，' + hiBits.join('、'));
      }
      if (Number.isFinite(m.min)) {
        const loBits = [];
        if ('LL' in v) loBits.push((m.min < v.LL ? '低于' : '未低于') + ' LL ' + v.LL);
        if ('L' in v) loBits.push((m.min < v.L ? '低于' : '未低于') + ' L ' + v.L);
        if ('联锁下限' in v) loBits.push((m.min < v['联锁下限'] ? '低于' : '未低于') + '联锁下限 ' + v['联锁下限']);
        if ('控制区间下限' in v) loBits.push((m.min < v['控制区间下限'] ? '低于' : '未低于') + '控制区间下限 ' + v['控制区间下限']);
        if (loBits.length) parts.push('实测最小值 ' + fmt(m.min) + '，' + loBits.join('、'));
      }
      // THRESHOLD_RESOLVER_V8：得票并列、未登记的档位，对每个候选值各给一次判断
      for (const c of asArray(rec.conflicts)) {
        const upper = ['HH', 'H', '联锁上限', '控制区间上限'].indexOf(c.label) >= 0;
        const x = upper ? m.max : m.min;
        if (!Number.isFinite(x)) continue;
        // THRESHOLD_TABLE_TIE_V1：表格几套定值打平的冲突写出各取值的出处表名，不写「在本次对话中出现过」
        const __cs = asArray(c.candidate_sources);
        const __head = c.origin === 'table_tie'
          ? c.label + ' 在证据表格中有 ' + __cs.map(e => e.value + '（《' + asArray(e.sources).join('》《') + '》）').join('、') +
            (c.candidates.length > __cs.length ? '，对话中另有 ' + c.candidates.slice(__cs.length).join('、') : '')
          : c.label + '在本次对话中出现过 ' + c.candidates.join('、');
        parts.push(__head + ' 共 ' + c.candidates.length + ' 个取值，未择一：实测' + (upper ? '最大值 ' : '最小值 ') + fmt(x) + ' ' +
          c.candidates.map(cv => (upper ? (x > cv ? '高于 ' : '未超过 ') : (x < cv ? '低于 ' : '未低于 ')) + cv).join('、'));
      }
      if (__spanNote) parts.push(__spanNote);
      if (oor.length && sp) {
        const worst = oor.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
        parts.push('另有 ' + oor.length + ' 个统计极值超出量程 ' + sp.lo + '～' + sp.hi + '（如 ' + fmt(worst.value) + (worst.range ? '，' + worst.range : '') + '），属量程外读数，未计入越限判定');
      }
      if (!parts.length) continue;
      const turns = Array.from(rec.turns).filter(x => x != null && x !== '').join('、');
      // THRESHOLD_RESOLVER_V8：出处按裁决结果如实写（哪一轮给出、是否取自证据表格、是否更正过已登记的值）
      let __src = turns ? '阈值取自本次对话第 ' + turns + ' 轮已给出的设定' : ((rec.table_used || rec.table_tie) ? '阈值取自证据表格' : '阈值取自本次对话前序轮次已给出的设定');
      if (rec.table_tie) __src += '；证据表格里该位号有 ' + rec.table_tie.sets + ' 套报警定值（共 ' + rec.table_tie.total_rows + ' 行），各档不同取值并列、未择一'; // THRESHOLD_ALL_VALUES_V1
      // 表格定值与对话一致、也没有更正时不另加说明
      if (rec.table_used && (!turns || asArray(rec.table_others).length || asArray(rec.corrected).length)) {
        __src += '；其中报警档按证据表格里' + (rec.table_used.sets > 1 ? '多数行一致的定值' : '的定值') + '取用（《' + rec.table_used.source + '》等 ' + rec.table_used.total_rows + ' 行中 ' + rec.table_used.rows + ' 行一致）';
        if (asArray(rec.table_others).length) __src += '，对话文字中另列的 ' + asArray(rec.table_others).join('、') + ' 属另一套定值，比对以本句所列数值为准';
      }
      if (asArray(rec.corrected).length) __src += '；此前登记的 ' + rec.corrected.map(x => x.label + ' ' + x.from).join('、') + ' 已按证据表格更正';
      if (asArray(rec.non_monotonic).length) __src += '；' + rec.non_monotonic.join('、') + ' 大小次序不成立，未用于比对';
      out.push({
        column: m.column,
        measured_max: m.max, measured_min: m.min, data_range: m.range,
        instrument_range: sp, out_of_range_extremes: oor.slice(0, 12),
        thresholds: v, threshold_turns: Array.from(rec.turns), primary_measurement: Boolean(__m.primary),
        crossing_bounds: Object.assign({}, rec.certain, v), conflicts: asArray(rec.conflicts),
        summary: parts.join('；') + '。' + __src + '；比对用的是统计区间极值，工具未返回极值出现时刻，越限时段需按时序定位。',
        statement: '确定性比对（' + m.column + (m.range ? '，数据范围 ' + m.range : '') + '）：' + parts.join('；') +
          '。' + __src + '；比对用的是统计区间极值，工具未返回极值出现时刻，越限时段需按时序定位。'
      });
    }
    // 对话里已给出过阈值的回路排在前面，同轮才从表格建档的在后
    // THRESHOLD_TABLE_TIE_V1：其次本轮主分析读到的位号在前、因子解析附带读到的在后（只留前 2 行，所问位号不被挤掉）
    return out.map((r, i) => [r, i]).sort((a, b) => ((b[0].threshold_turns.length > 0) - (a[0].threshold_turns.length > 0)) || ((b[0].primary_measurement ? 1 : 0) - (a[0].primary_measurement ? 1 : 0)) || (a[1] - b[1])).map(x => x[0]).slice(0, 2);
  } catch (err) {
    return [];
  }
})();
// EXCEEDANCE_EPISODES_V7：确定性比对后按日扫描越限日期与时段（公司点评 MT25 T7：越限起止与时长是本轮就应给出的结果）。
// 统计单元窗口（默认近 90 天，最多 120 天）按天分段读 period_profile，每侧取窗口内实际越过的最严档位，列出越限日期；
// 最严重那天按粗段 + 5min 细分定位首次 / 末次 / 极值与累计时长。整天读数恒定的日子疑为仪表 / 信号异常，不计入。
// 取数预算：Code 节点约 60 秒被终止（实测），本块与 EVENT_WINDOW_DRIVERS_V7 共用截止时间；EPB 在补检 / 反查回环里会再跑一次，
// 第二次直接沿用上一次运行的结果，不重复取数。
const __epbCtx = this;
const __epbDeadline = Date.now() + 40000;
const __exceedanceEpisodes = []; // 越限时段，随 EPB 输出写入会话状态，供后续轮次（关联变量扫描）继承
const __prevEpbRun = (() => {
  try { return typeof $runIndex === 'number' && $runIndex > 0 ? asObject(($('Evidence Packet Builder').all(0, $runIndex - 1)[0] || {}).json) : null; } catch (e) { return null; }
})();
await (async () => {
  if (!__thresholdComparison.length) return;
  // 回环第二次运行：同列同区间的扫描结果直接沿用
  if (__prevEpbRun) {
    const prevRows = new Map(asArray(__prevEpbRun.threshold_comparison).map(r => [String(asObject(r).column) + '|' + String(asObject(r).data_range), asObject(r)]));
    let reused = 0;
    for (const row of __thresholdComparison) {
      const p = prevRows.get(String(row.column) + '|' + String(row.data_range));
      if (!p || !p.episodes_text) continue;
      row.episodes = asArray(p.episodes); row.episodes_text = p.episodes_text;
      row.summary = String(row.summary || '').replace('比对用的是统计区间极值，工具未返回极值出现时刻，越限时段需按时序定位。', '') + p.episodes_text;
      row.statement = String(row.statement || '').replace('比对用的是统计区间极值，工具未返回极值出现时刻，越限时段需按时序定位。', '') + p.episodes_text;
      reused++;
    }
    if (reused) { __exceedanceEpisodes.push(...asArray(__prevEpbRun.exceedance_episodes)); return; }
  }
  let rp = {};
  try { const wc = $('Workflow Configuration').first().json || {}; rp = typeof wc.run_params === 'string' ? JSON.parse(wc.run_params) : (wc.run_params || {}); } catch (e) {}
  const restBase = String(asObject(rp.mongodb).rest_base_url || '').replace(/\/+$/, '');
  const ruleMs = (() => { const m = String(asObject(rp.arcticdb).relationship_resample_rule || '').trim().match(/^(\d*)\s*(min|T|h|H)$/); return m ? (m[1] ? Number(m[1]) : 1) * (/^h$/i.test(m[2]) ? 3600000 : 60000) : NaN; })();
  const tzm = /^([+-])(\d{2}):?(\d{2})$/.exec(String(asObject(rp.arcticdb).default_timezone || ''));
  const tzMs = tzm ? (tzm[1] === '-' ? -1 : 1) * (Number(tzm[2]) * 60 + Number(tzm[3])) * 60000 : null;
  let anPath = '';
  try { const cat = asObject($('Extract Plan Data').first().json.catalog); anPath = String((asArray(asObject(cat.mongodb).tools).find(t => t && /_analyze$/.test(String(t.name || '')) && t.path && !t.deprecated) || {}).path || ''); } catch (e) {}
  // 取读过该列的历史库单元的库 / 符号；没有列信息时退到首个历史库单元
  const targetFor = col => {
    let fb = null;
    for (const u of asArray(completedUnits)) {
      if (!/^(?:arctic|mongo)_/.test(String(asObject(u).tool || ''))) continue;
      const p = asObject(asObject(u).params); const t0 = asObject(asArray(p.targets)[0]);
      const db = p.database || p.library || t0.database || t0.library; const co = p.collection || p.symbol || t0.collection || t0.symbol;
      if (!db || !co) continue;
      const cols = asArray(p.columns).concat(...asArray(p.targets).map(t => asArray(asObject(t).columns))).map(String);
      if (cols.includes(col)) return { database: String(db), collection: String(co) };
      if (!fb) fb = { database: String(db), collection: String(co) };
    }
    return fb;
  };
  if (!restBase || !anPath || !(ruleMs > 0)) return;
  const naive = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
  const local = ms => tzMs == null ? '' : '（当地 ' + naive(ms + tzMs) + '）';
  let limit = 288;
  const post = async body => {
    const left = __epbDeadline - Date.now();
    if (left < 3000) return { status: 0, body: { error: 'time_budget' } };
    try {
      const r = await __epbCtx.helpers.httpRequest({ method: 'POST', url: restBase + anPath, body, json: true, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: Math.min(25000, left - 1000) });
      let b = r && r.body !== undefined ? r.body : r; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) {} }
      return { status: Number((r && r.statusCode) || 200), body: b || {} };
    } catch (e) { return { status: 0, body: { error: String(e && e.message || e) } }; }
  };
  const readOnce = async (tgt, col, segs) => {
    const resp = await post({ targets: segs.map((s0, i) => ({ name: 'seg' + i, database: tgt.database, collection: tgt.collection, columns: [col], date_range: [new Date(s0[0]).toISOString(), new Date(s0[1] - 1000).toISOString()] })),
      date_range: [new Date(segs[0][0]).toISOString(), new Date(segs[segs.length - 1][1]).toISOString()], analysis_types: ['period_profile'] });
    if (resp.status >= 400 || resp.status === 0) {
      const mx = Number(asObject(asObject(resp.body).detail).max_columns);
      return { error: true, max: Number.isFinite(mx) && mx > 0 ? mx : null };
    }
    const byName = new Map(asArray(asObject(resp.body).period_profile).filter(r => String(asObject(r).column || '') === col).map(r => [String(r.target || ''), r]));
    return { rows: segs.map((s0, i) => { const r = asObject(byName.get('seg' + i)); return { t: s0[0], end: s0[1], n: Number(r.count) || 0, min: Number(r.min), max: Number(r.max) }; }).filter(x => x.n > 0 && Number.isFinite(x.min) && Number.isFinite(x.max)) };
  };
  // 按 max_columns 分批、并发；遇 400 按返回的上限重分
  const read = async (tgt, col, segs) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const chunks = [];
      for (let i = 0; i < segs.length; i += limit) chunks.push(segs.slice(i, i + limit));
      const out = []; let shrink = null, failed = false;
      for (let i = 0; i < chunks.length && !failed; i += 4) {
        const res = await Promise.all(chunks.slice(i, i + 4).map(ch => readOnce(tgt, col, ch)));
        for (let k = 0; k < res.length; k++) {
          const r = res[k];
          if (r.error) { failed = true; if (r.max && r.max < chunks[i + k].length) shrink = r.max; continue; }
          out.push(...r.rows);
        }
      }
      if (!failed) return out.sort((a, b) => a.t - b.t);
      if (!shrink) return null;
      limit = shrink;
    }
    return null;
  };
  const split = (a, b, step) => { const o = []; for (let t = a; t < b; t += step) o.push([t, Math.min(b, t + step)]); return o; };
  // 扫描范围：统计单元窗口（全历史分窗分析时比对行的 data_range 只是极值所在的一窗；逐日读取成本随行数线性增长，
  // /analyze 约 1.6 万行/秒，6 年约 200 秒），最多最近 120 天
  const __pt = x => { const v = String(x || '').trim().replace(' ', 'T'); return v ? Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : v + 'Z') : NaN; };
  const __cover = [];
  for (const u of asArray(completedUnits)) {
    if (!/^(?:arctic|mongo)_stats$/.test(String(asObject(u).tool || ''))) continue;
    let rr = {}; try { rr = asObject(rawResultOf(u)); } catch (e) {}
    const dr = asArray(rr.date_range).length === 2 ? rr.date_range : asArray(asObject(asObject(u).params).date_range);
    const a = __pt(dr[0]), b = __pt(dr[1]);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) __cover.push([a, b]);
  }
  const MAX_SCAN_MS = 120 * 86400000;
  const LOW = ['联锁下限', 'LL', 'L'], HIGH = ['联锁上限', 'HH', 'H'];
  await Promise.all(__thresholdComparison.slice(0, 2).map(async row => {
    let [ra, rb] = String(row.data_range || '').split(/\s*至\s*/).map(__pt);
    const rowRange = [ra, rb];
    if (__cover.length) { ra = Math.min(...__cover.map(c => c[0])); rb = Math.max(...__cover.map(c => c[1])); }
    if (!Number.isFinite(ra) || !Number.isFinite(rb) || rb <= ra) return;
    if (rb - ra > MAX_SCAN_MS) ra = rb - MAX_SCAN_MS;
    const tgt = targetFor(row.column); if (!tgt) return;
    const v = Object.assign({}, asObject(row.crossing_bounds || row.thresholds)); const sp = row.instrument_range || null;
    // THRESHOLD_ALL_VALUES_V1：某档有多个取值、未择一时，按最宽的那个扫描（越过任一取值的日子都列出），文字写出全部取值
    const __candOf = {};
    for (const cf of asArray(row.conflicts)) {
      const cs = asArray(asObject(cf).candidates).map(Number).filter(Number.isFinite); if (cs.length < 2) continue;
      v[cf.label] = HIGH.indexOf(cf.label) >= 0 ? Math.min(...cs) : Math.max(...cs); __candOf[cf.label] = cs;
    }
    const __lt = (k, val) => (__candOf[k] ? k + ' ' + __candOf[k].join('/') + '（取值未择一，按 ' + val + ' 扫描，各日极值可与各取值对照）' : k + ' ' + val);
    const inRange = x => !sp || (x >= sp.lo && x <= sp.hi);
    const lows = LOW.filter(k => Number.isFinite(Number(v[k]))), highs = HIGH.filter(k => Number.isFinite(Number(v[k])));
    if (!lows.length && !highs.length) return;
    const days0 = await read(tgt, row.column, split(Math.floor(ra / 86400000) * 86400000, rb, 86400000));
    if (!days0 || !days0.length) return;
    const frozen = days0.filter(x => x.n > 1 && x.max === x.min);
    const days = days0.filter(x => !(x.n > 1 && x.max === x.min));
    const texts = []; row.episodes = [];
    for (const [sideName, labels] of [['below', lows], ['above', highs]]) {
      if (!labels.length) continue;
      const edge = x => (sideName === 'above' ? x.max : x.min);
      const crossAt = val => x => inRange(edge(x)) && (sideName === 'above' ? x.max > val : x.min < val);
      // 该侧窗口内实际越过的最严档位
      const label = labels.find(k => days.some(crossAt(Number(v[k]))));
      const word = sideName === 'above' ? '高于 ' : '低于 ';
      if (!label) {
        const loosest = labels[labels.length - 1];
        const fz = frozen.filter(crossAt(Number(v[loosest])));
        texts.push(word + __lt(loosest, v[loosest]) + ' 的日期没有' + (fz.length ? '（另有 ' + fz.length + ' 天整天读数恒定，如 ' + naive(fz[0].t).slice(0, 10) + ' 恒为 ' + fz[0].min + '，疑为仪表或信号异常，未计入）' : ''));
        continue;
      }
      const value = Number(v[label]); const cross = crossAt(value);
      const hitDays = days.filter(cross);
      const frozenHit = frozen.filter(cross);
      const top5 = hitDays.slice().sort((a, b) => (sideName === 'above' ? b.max - a.max : a.min - b.min)).slice(0, 5);
      const worst = top5[0];
      const coarseMs = Math.max(ruleMs, Math.ceil(86400000 / Math.min(limit, 288) / ruleMs) * ruleMs);
      const coarse = await read(tgt, row.column, split(worst.t, worst.end, coarseMs)) || [];
      const cr = coarse.filter(cross);
      let first = cr[0], last = cr[cr.length - 1], ext = cr.length ? cr.reduce((m, x) => (sideName === 'above' ? (x.max > m.max ? x : m) : (x.min < m.min ? x : m))) : null;
      let fineCount = null;
      if (cr.length && coarseMs > ruleMs) {
        // 越限粗段不多时全部细分（时长按细段计），否则只细分首次 / 末次 / 极值段
        const all = cr.length * coarseMs / ruleMs <= 3 * limit;
        const picks = all ? cr : Array.from(new Set([first, last, ext]));
        const fine = await read(tgt, row.column, picks.flatMap(x => split(x.t, x.end, ruleMs))) || [];
        const fr = fine.filter(cross);
        if (all && fine.length) fineCount = fr.length;
        const inSeg = (r, s0) => r.t >= s0.t && r.t < s0.end;
        first = fr.find(r => inSeg(r, first)) || first;
        const lastIn = fr.filter(r => inSeg(r, last)); last = lastIn.length ? lastIn[lastIn.length - 1] : last;
        const extIn = fr.filter(r => inSeg(r, ext)); if (extIn.length) ext = extIn.reduce((m, x) => (sideName === 'above' ? (x.max > m.max ? x : m) : (x.min < m.min ? x : m)));
      }
      const durMin = fineCount != null ? fineCount * ruleMs / 60000 : cr.length * coarseMs / 60000;
      const durBasis = fineCount != null ? ruleMs / 60000 : coarseMs / 60000;
      const ep = { side: sideName, label, limit: value, days: hitDays.length, first_day: naive(hitDays[0].t).slice(0, 10), last_day: naive(hitDays[hitDays.length - 1].t).slice(0, 10),
        worst_day: naive(worst.t).slice(0, 10), extreme_value: ext ? edge(ext) : edge(worst), extreme_time: ext ? naive(ext.t) : null,
        first_crossing: first ? naive(first.t) : null, last_crossing: last ? naive(last.t) : null, crossing_minutes_in_worst_day: cr.length ? durMin : null,
        duration_basis_minutes: durBasis, coarse_minutes: coarseMs / 60000, fine_minutes: ruleMs / 60000,
        top_days: top5.map(x => ({ day: naive(x.t).slice(0, 10), value: edge(x) })), frozen_days: frozenHit.length };
      // POINT_LEVEL_EXCEEDANCE_V1：最严重那天读整天逐分钟原始读数，定到时间点（用户 11-10：5 分钟段继续细化到时间点）。
      // 读不到或时间预算不够时保留上面的 5min 段结果。
      try {
        const leftMs = __epbDeadline - Date.now();
        if (leftMs > 4000) {
          const iso = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
          const rr = await __epbCtx.helpers.httpRequest({ method: 'POST', url: restBase + '/read', json: true, timeout: Math.min(15000, leftMs - 1000),
            body: { database: tgt.database, collection: tgt.collection, columns: [row.column], date_range: [iso(worst.t), iso(worst.end - 1000)] } });
          const pts = asArray(asObject(rr).records).map(r0 => ({ t: __pt(String(asObject(r0).time || asObject(r0).timestamp || '').slice(0, 19)), v: Number(asObject(r0)[row.column]) }))
            .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v) && inRange(p.v)).sort((a, b) => a.t - b.t);
          if (pts.length > 1) {
            const gaps = pts.slice(1).map((p, i) => p.t - pts[i].t).sort((a, b) => a - b);
            const dt = gaps[Math.floor(gaps.length / 2)] || 60000;
            const hitP = p => (sideName === 'above' ? p.v > value : p.v < value);
            const hits = pts.filter(hitP);
            if (hits.length) {
              const runs = [];
              for (const p of hits) {
                const cur = runs[runs.length - 1];
                if (cur && p.t - cur.last <= 1.5 * dt) { cur.last = p.t; cur.n++; if (sideName === 'above' ? p.v > cur.ext : p.v < cur.ext) { cur.ext = p.v; cur.extT = p.t; } }
                else runs.push({ first: p.t, last: p.t, n: 1, ext: p.v, extT: p.t });
              }
              const ex = hits.reduce((m, p) => (sideName === 'above' ? (p.v > m.v ? p : m) : (p.v < m.v ? p : m)));
              Object.assign(ep, { point_level: true, first_crossing: naive(hits[0].t), last_crossing: naive(hits[hits.length - 1].t),
                extreme_value: Number(ex.v.toFixed(4)), extreme_time: naive(ex.t), crossing_minutes_in_worst_day: Math.round(hits.length * dt / 60000),
                duration_basis_minutes: dt / 60000, fine_minutes: dt / 60000, point_samples: pts.length,
                runs: runs.slice().sort((a, b) => b.n - a.n).slice(0, 5).sort((a, b) => a.first - b.first)
                  .map(r1 => ({ start: naive(r1.first), end: naive(r1.last), minutes: Math.round(r1.n * dt / 60000), extreme_value: Number(r1.ext.toFixed(4)), extreme_time: naive(r1.extT) })),
                run_count: runs.length });
            }
          }
        }
      } catch (e) { ep.point_level_error = String(e && e.message || e).slice(0, 120); }
      row.episodes.push(ep);
      __exceedanceEpisodes.push(Object.assign({ column: row.column, instrument_range: sp, thresholds: v, database: tgt.database, collection: tgt.collection }, ep));
      texts.push(word + __lt(label, value) + ' 的日期共 ' + ep.days + ' 天（' + ep.first_day + ' 至 ' + ep.last_day + '）' +
        (hitDays.length > 1 ? '，最严重的 ' + top5.length + ' 天为 ' + top5.map(x => naive(x.t).slice(0, 10) + '（' + (sideName === 'above' ? '最高 ' : '最低 ') + edge(x) + '）').join('、') : '') +
        (frozenHit.length ? '；另有 ' + frozenHit.length + ' 天整天读数恒定（如 ' + naive(frozenHit[0].t).slice(0, 10) + ' 恒为 ' + frozenHit[0].min + '），疑为仪表或信号异常，未计入' : '') +
        (ep.extreme_time ? '；最严重的 ' + ep.worst_day + ' 当日' + (sideName === 'above' ? '最高 ' : '最低 ') + ep.extreme_value + ' 出现在 ' + ep.extreme_time + ' UTC' + local(Date.parse(ep.extreme_time.replace(' ', 'T') + ':00Z')) +
          '，当日首次越过 ' + ep.first_crossing + '、末次 ' + ep.last_crossing + (ep.point_level ? '（UTC，逐分钟读数的时间点），越限共 ' : '（UTC，' + ep.fine_minutes + 'min 段起点），越限累计约 ') +
          (ep.crossing_minutes_in_worst_day >= 120 ? Math.round(ep.crossing_minutes_in_worst_day / 6) / 10 + ' 小时' : ep.crossing_minutes_in_worst_day + ' 分钟') +
          (ep.point_level ? '（按逐分钟读数计，' + ep.point_samples + ' 个读数）' + (ep.run_count > 1 ? '，分 ' + ep.run_count + ' 段' + (ep.run_count > ep.runs.length ? '（列最长 ' + ep.runs.length + ' 段）' : '') + '：' +
            ep.runs.map(r1 => r1.start.slice(11) + '–' + r1.end.slice(11) + '（' + r1.minutes + ' 分钟，' + (sideName === 'above' ? '最高 ' : '最低 ') + r1.extreme_value + ' @ ' + r1.extreme_time.slice(11) + '）').join('、') : '')
            : '（按 ' + ep.duration_basis_minutes + 'min 分段计）') : ''));
    }
    if (texts.length) {
      const outside = Number.isFinite(rowRange[0]) && (rowRange[0] < ra - 86400000 || rowRange[1] > rb + 86400000);
      const add = '按日扫描 ' + naive(ra).slice(0, 10) + ' 至 ' + naive(rb).slice(0, 10) + '：' + texts.join('；') + '。' +
        (outside ? '上面比对用的极值来自该窗口之外的 ' + String(row.data_range || '') + '，更早时段只做了分窗极值比对，未逐日扫描。' : '');
      row.episodes_text = add;
      row.summary = String(row.summary || '').replace('比对用的是统计区间极值，工具未返回极值出现时刻，越限时段需按时序定位。', '') + add;
      row.statement = String(row.statement || '').replace('比对用的是统计区间极值，工具未返回极值出现时刻，越限时段需按时序定位。', '') + add;
    }
  }));
})();

for (let __i = __thresholdComparison.length - 1; __i >= 0; __i--) {
  establishedThresholds.unshift({ turn_ref: 'computed', user_question: '', statement: __thresholdComparison[__i].statement });
}

// THRESHOLD_STATUS_FROM_COMPARISON_V7
// threshold_exceedance 原先只认 arctic_analyze 原始结果里的 threshold_exceedances / alarm_events，
// 现有 arctic 工具都不返回这两个字段，状态恒为 unconfirmed、缺失项恒为写死的「缺阈值」「缺比对」，
// 与上面算出的比对结论矛盾；展示节点又据此删掉越限句并补「没有完成比较」（MT25 exec 140905 / 140910）。
// 改为按本轮实际情况推导。工具直接返回越限事件（confirmed）时不动。
(function () {
  try {
    const hasMeasured = asArray(completedUnits).some(u => {
      const r = rawResultOf(asObject(u));
      return Object.keys(asObject(r.column_stats)).length > 0 || asArray(r.period_profile).length > 0;
    });
    const hasStatedThreshold = establishedThresholds.some(t => t && t.turn_ref !== 'computed');
    let next = null;
    if (__thresholdComparison.length) {
      const events = [];
      for (const c of __thresholdComparison) {
        for (const [label, raw] of Object.entries(asObject(c.thresholds))) {
          const limit = Number(raw);
          const upper = /^H{1,2}$|上限$/.test(label);
          const measuredExtreme = Number(upper ? c.measured_max : c.measured_min);
          if (!Number.isFinite(limit) || !Number.isFinite(measuredExtreme)) continue;
          events.push({
            column: c.column, limit_label: label, limit_value: limit,
            extreme: upper ? 'max' : 'min', measured_extreme: measuredExtreme,
            crossed: upper ? measuredExtreme > limit : measuredExtreme < limit,
            data_range: c.data_range || ''
          });
        }
      }
      next = {
        status: 'compared',
        result: events.some(x => x.crossed) ? 'limit_crossed_within_period' : 'within_limits_for_period',
        basis: 'period min/max of measured data compared with thresholds stated earlier in this conversation',
        events,
        comparison_statements: __thresholdComparison.map(c => c.statement),
        crossing_timestamps_available: false,
        missing_requirements: []
      };
    } else if (!hasMeasured) {
      // 本轮没有实测数据：不存在「是否越限」要确认的对象，不是「未确认」。
      next = { status: 'not_applicable', reason: 'no measured data in this turn', events: [], missing_requirements: [] };
    } else {
      const missing = hasStatedThreshold
        ? ['stated thresholds and measured columns do not belong to the same loop']
        : ['alarm/interlock threshold for the measured tag'];
      next = { status: 'unconfirmed', events: [], missing_requirements: missing };
    }
    const targets = Array.from(new Set([eventEvidenceStatus, effectiveEventEvidenceStatus]));
    for (const target of targets) {
      if (!target || typeof target !== 'object') continue;
      if (asString(asObject(target.threshold_exceedance).status) === 'confirmed') continue;
      target.threshold_exceedance = next;
      target.missing_requirements = asArray(target.missing_requirements)
        .filter(x => x !== 'confirmed operating/alarm threshold')
        .concat(next.missing_requirements);
    }
  } catch (err) {}
})();

// EXCEEDANCE_ANCHOR_SELECTION_V7
// MT25 T7（exec 147631）：锚点取 |z| 最大的异常（2022-12-21 PDRA3125B.PV 日均 491.77，超出量程），T8 围绕量程外读数取窗，
// 找不到真实越限。改为：剔除量程外异常 → 按越过阈值条数、|z| 排序 → 量程内越限异常作锚点，其余作候选随事件保存。
// 异常点时间是聚合周期起点，不是越限时刻；周期长度随候选保存，由 Param Injector 读当期原始读数定位。
(function () {
  try {
    const loops = __anchorLoops;
    if (!loops || !loops.size) return;
    const loopKey = t => { const m = String(t || '').toUpperCase().match(/^([A-Z])[A-Z]*?(\d{3,5})/); return m ? m[1] + m[2] : ''; };
    const isUpper = label => /^H{1,2}$|上限$/.test(label);
    // pandas 聚合周期写法（D / 1h / 5min …）换算毫秒
    const periodMs = rule => {
      const m = String(rule || '').trim().match(/^(\d*)\s*(W|D|d|H|h|min|T|S|s)$/);
      if (!m) return NaN;
      const unitMs = { W: 604800000, D: 86400000, d: 86400000, H: 3600000, h: 3600000, min: 60000, T: 60000, S: 1000, s: 1000 }[m[2]];
      return (m[1] ? Number(m[1]) : 1) * unitMs;
    };
    const fmt = x => (Number.isFinite(x) ? String(Math.round(x * 10000) / 10000) : '—');
    const cands = [], inRangeOnly = [], excluded = [];
    const rules = new Set();
    for (const u of asArray(completedUnits)) {
      const unit = asObject(u);
      if (asString(unit.tool) !== 'arctic_analyze') continue;
      const rr = rawResultOf(unit);
      const pm = periodMs(rr.resample_rule);
      for (const raw of asArray(rr.anomaly_windows)) {
        const a = asObject(raw);
        const col = asString(a.column);
        const value = Number(a.value);
        const rec = loops.get(loopKey(col));
        if (!col || !rec || !Number.isFinite(value)) continue;
        const sp = rec.span || null;
        if (sp && (value < sp.lo || value > sp.hi)) { excluded.push({ column: col, timestamp: asString(a.timestamp), value }); continue; }
        const crossed = Object.entries(Object.assign({}, asObject(rec.certain), asObject(rec.values)))
          .map(([label, v]) => ({ label, value: Number(v), upper: isUpper(label) }))
          .filter(x => Number.isFinite(x.value) && (x.upper ? value > x.value : value < x.value));
        const base = {
          column: col, column_id: asString(a.column_id) || col, timestamp: asString(a.timestamp), value,
          zscore: Number(a.zscore), direction: asString(a.direction), column_ref: a.column_ref || null,
          instrument_range: sp, period_ms: Number.isFinite(pm) ? pm : null, resample_rule: asString(rr.resample_rule)
        };
        if (!crossed.length) { inRangeOnly.push(base); continue; }
        const ups = crossed.filter(x => x.upper), downs = crossed.filter(x => !x.upper);
        if (ups.length && downs.length) continue; // 阈值自相矛盾，不作锚点
        const lim = ups.length
          ? ups.reduce((m, x) => (x.value > m.value ? x : m))
          : downs.reduce((m, x) => (x.value < m.value ? x : m));
        if (asString(rr.resample_rule)) rules.add(asString(rr.resample_rule));
        cands.push(Object.assign(base, {
          crossed_limits: crossed.map(x => ({ label: x.label, value: x.value })),
          search_limit: { label: lim.label, value: lim.value, side: lim.upper ? 'above' : 'below' }
        }));
      }
    }
    const byZ = (a, b) => Math.abs(Number(b.zscore) || 0) - Math.abs(Number(a.zscore) || 0);
    cands.sort((a, b) => (b.crossed_limits.length - a.crossed_limits.length) || byZ(a, b));
    inRangeOnly.sort(byZ);
    let chosen = null, basis = '';
    if (cands.length) {
      chosen = Object.assign({}, cands[0], {
        alternatives: cands.slice(1).map(c => ({
          column: c.column, timestamp: c.timestamp, value: c.value, zscore: c.zscore,
          search_limit: c.search_limit, crossed_limits: c.crossed_limits,
          instrument_range: c.instrument_range, period_ms: c.period_ms
        }))
      });
      basis = 'in_range_threshold_crossing';
    } else if (excluded.length && inRangeOnly.length) {
      chosen = inRangeOnly[0];
      basis = 'strongest_in_range_statistical_anomaly';
    }
    if (!chosen) return;
    for (const target of Array.from(new Set([eventEvidenceStatus, effectiveEventEvidenceStatus]))) {
      if (!target || typeof target !== 'object') continue;
      const sa = asObject(target.statistical_anomaly);
      target.statistical_anomaly = Object.assign({}, sa, {
        strongest_event: chosen,
        strongest_zscore_event: sa.strongest_zscore_event || sa.strongest_event || null,
        anchor_basis: basis,
        threshold_crossing_count: cands.length,
        excluded_out_of_range_count: excluded.length
      });
      const ew = asObject(target.event_window);
      if (!ew.status || asString(ew.source) === 'strongest_statistical_anomaly') {
        target.event_window = Object.assign({}, ew, {
          status: 'anchor_available', anchor_timestamp: chosen.timestamp, source: basis,
          anchor_period_ms: chosen.period_ms
        });
      }
    }
    const te = asObject(eventEvidenceStatus.threshold_exceedance);
    if (cands.length && te.status === 'compared') {
      te.crossing_periods = cands.map(c => ({ column: c.column, period_start: c.timestamp, value: c.value, crossed_limits: c.crossed_limits }));
    }
    if (cands.length) {
      const ruleText = rules.size ? '（聚合周期 ' + Array.from(rules).join('、') + '，时间为周期起点）' : '';
      const top = cands.slice(0, 5).map(c => c.timestamp + ' ' + c.column + ' ' + fmt(c.value) + '（' +
        c.crossed_limits.map(x => (isUpper(x.label) ? '高于' : '低于') + x.label + ' ' + x.value).join('、') + '）');
      const stmt = '确定性异常点定位：量程内且越过阈值的统计异常 ' + cands.length + ' 个' + ruleText +
        '，按越过阈值条数与偏离程度排序，前列为 ' + top.join('；') +
        (excluded.length ? '。另有 ' + excluded.length + ' 个异常点超出量程，属量程外读数，不作越限锚点' : '') +
        '。这些是聚合值，具体越限时刻需读取该周期原始读数定位。';
      for (const th of establishedThresholds) {
        if (th && th.turn_ref === 'computed' && /越限时段需按时序定位/.test(String(th.statement || ''))) {
          th.statement = String(th.statement).replace('越限时段需按时序定位', '越限日期见下条异常点定位');
        }
      }
      let at = 0;
      while (at < establishedThresholds.length && establishedThresholds[at] && establishedThresholds[at].turn_ref === 'computed') at++;
      establishedThresholds.splice(at, 0, { turn_ref: 'computed', user_question: '', statement: stmt });
    }
  } catch (err) {}
})();

// EXCEEDANCE_ANCHOR_SELECTION_V7：Param Injector 按原始读数定位的越限时刻，写成确定性说明
(function () {
  try {
    let tz = '';
    try {
      const wc = $('Workflow Configuration').first().json || {};
      const rp = typeof wc.run_params === 'string' ? JSON.parse(wc.run_params) : (wc.run_params || {});
      tz = asString((rp.arcticdb || {}).default_timezone || (rp.mongodb || {}).default_timezone);
    } catch (e) {}
    const tzm = tz.match(/^([+-])(\d{2}):?(\d{2})$/);
    const offMs = tzm ? (tzm[1] === '-' ? -1 : 1) * (Number(tzm[2]) * 60 + Number(tzm[3])) * 60000 : 0;
    const show = t => {
      const s = asString(t).replace(' ', 'T');
      const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z');
      if (!Number.isFinite(ms)) return asString(t);
      return new Date(ms + offMs).toISOString().slice(0, 16).replace('T', ' ') + (tzm ? '（' + tz + '）' : '（UTC）');
    };
    const fmt = x => (Number.isFinite(Number(x)) ? String(Math.round(Number(x) * 10000) / 10000) : '—');
    for (const u of asArray(completedUnits)) {
      const ref = asObject(asObject(asObject(u).params).event_anchor_refinement);
      if (!Object.keys(ref).length) continue;
      // EVIDENCE_STATEMENTS_CONSISTENT_V7：区分「该周期没有越限读数」与「接口返回的行不在该周期内、无法判断」（exec 147717 把后者写成了前者）
      const tried = asArray(ref.tried).map(asObject);
      const listOf = arr => arr.slice(0, 3).map(t => t.period_start + ' ' + t.column).join('；') + (arr.length > 3 ? ' 等 ' + arr.length + ' 个' : '');
      const noRows = tried.filter(t => t.rows === 0 && !Number(t.out_of_range_rows) && !t.error);
      const offPeriod = tried.filter(t => t.rows === 0 && Number(t.out_of_range_rows) > 0);
      const failed = tried.filter(t => t.rows === undefined && t.error);
      const skipText = [
        noRows.length ? '候选周期 ' + listOf(noRows) + ' 内未找到量程内越限的读数，已跳过；' : '',
        offPeriod.length ? '候选周期 ' + listOf(offPeriod) + ' 读数接口返回的行都不在所请求的周期内（接口未按周期取数），无法据此判断，已跳过；' : '',
        failed.length ? '候选周期 ' + listOf(failed) + ' 读取出错，已跳过；' : ''
      ].join('');
      let stmt = '';
      if (ref.status === 'located') {
        const lim = asObject(ref.crossing_limit);
        const word = lim.side === 'above' ? '高于' : '低于';
        stmt = '确定性越限时刻定位（' + ref.column + '）：' + skipText + '在 ' + ref.period_start + ' 起的聚合周期内，量程内' + word + lim.label + ' ' + lim.value +
          (ref.granularity ? ' 的读数（按 ' + ref.granularity + ' 聚合）' + ref.rows_crossing + ' 个' : ' 的原始读数 ' + ref.rows_crossing + (ref.truncated ? '+' : '') + ' 条') +
          '，首次 ' + show(ref.first_crossing) + '，末次 ' + show(ref.last_crossing) +
          '，最' + (lim.side === 'above' ? '高' : '低') + ' ' + fmt(ref.extreme_value) + ' 出现在 ' + show(ref.extreme_time) +
          '；本轮事件窗口以该时刻为中心，前后各 ' + ref.context_hours + ' 小时。';
      } else {
        stmt = '确定性越限时刻定位：' + skipText + '未能定位到真实越限时刻，本轮窗口仍按聚合周期起点取，不能当作真实越限时刻。';
      }
      if (ref.status === 'located') {
        // 比对句不再称「越限时段需按时序定位」，改指向定位句；越限状态同步带上定位结果
        for (const th of establishedThresholds) {
          // 只改同一列的比对句（另一列的统计区间与定位时刻无关）
          if (th && th.turn_ref === 'computed' && /越限时段需按时序定位/.test(String(th.statement || '')) &&
              String(th.statement).indexOf('确定性比对（' + ref.column + '，') === 0) {
            th.statement = String(th.statement).replace('工具未返回极值出现时刻，越限时段需按时序定位', '越限时刻见本轮「确定性越限时刻定位」');
          }
        }
        for (const target of Array.from(new Set([eventEvidenceStatus, effectiveEventEvidenceStatus]))) {
          const te = asObject(target && target.threshold_exceedance);
          if (te.status === 'compared') Object.assign(te, { crossing_timestamps_available: true, located_crossing: ref });
        }
      }
      establishedThresholds.unshift({ turn_ref: 'computed', user_question: '', statement: stmt });
      for (const target of Array.from(new Set([eventEvidenceStatus, effectiveEventEvidenceStatus]))) {
        if (target && typeof target === 'object') target.event_window = Object.assign({}, asObject(target.event_window), { precise_anchor: ref });
      }
      break;
    }
  } catch (err) {}
})();

// EVENT_WINDOW_DRIVERS_V7：越限时段内关联变量扫描（公司点评 MT25 T10：希望从影响两器压差的关键变量中找到超标时段内影响的变量）。
// 上一版 T10（exec 153398）只重新分析了差压本身，没有读取任何关联变量，只能列出候选原因清单。
// ① 越限锚点：本轮 F118 按日扫描得到的越限时段优先作事件锚点（替代日聚合 z 分数锚点），并随会话状态保存，后续轮次继承同一次越限；
// ② 关联变量：目标位号描述中的设备词（按描述表词频选极大 n-gram，不写死词表）命中的位号 + 本次对话 / 本轮证据中出现的位号；
// ③ 先比「窗口前 24 小时基线范围」与「越限前 1 小时至越限后 30 分钟」，越出基线范围的变量再按 5min 分段找首次越出时刻，按先后排序。
// 只在继承了越限时段、且本轮执行了历史库单元的轮次运行（筛选越限的那一轮不跑）。
let __windowDrivers = null;
await (async () => {
  try {
    const __cap = toInternalPacketContract($('Capture context').first().json || {});
    let __st = __cap.conversation_state || {};
    if (typeof __st === 'string') { try { __st = JSON.parse(__st); } catch (e) { __st = {}; } }
    const utcMs = t => { const v = String(t || '').trim().replace(' ', 'T'); if (!v) return NaN; return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : v + (v.length <= 16 ? ':00Z' : 'Z')); };
    const sevRank = l => (/联锁/.test(l) ? 3 : /^(HH|LL)$/.test(l) ? 2 : 1);
    const pickPrimary = eps => eps.slice().sort((a, b) => (sevRank(b.label) - sevRank(a.label)) ||
      (Math.abs(Number(b.extreme_value) - Number(b.limit)) / Math.max(1e-9, asObject(b.instrument_range).hi - asObject(b.instrument_range).lo || 1)) -
      (Math.abs(Number(a.extreme_value) - Number(a.limit)) / Math.max(1e-9, asObject(a.instrument_range).hi - asObject(a.instrument_range).lo || 1)))[0];
    let rp = {};
    try { const wc = $('Workflow Configuration').first().json || {}; rp = typeof wc.run_params === 'string' ? JSON.parse(wc.run_params) : (wc.run_params || {}); } catch (e) {}
    const ruleMs = (() => { const m = String(asObject(rp.arcticdb).relationship_resample_rule || '').trim().match(/^(\d*)\s*(min|T|h|H)$/); return m ? (m[1] ? Number(m[1]) : 1) * (/^h$/i.test(m[2]) ? 3600000 : 60000) : NaN; })();

    // ① 本轮越限时段 → 事件锚点（Param Injector 下一轮据此在该日内定位越限读数）
    // 会话里已保存的越限时段（前序轮次筛出）；有则本轮是后续轮次，要做关联变量扫描
    const saved = asArray(__st.exceedance_episodes).map(asObject).filter(e => e.column && e.first_crossing);
    const curEps = typeof __exceedanceEpisodes !== 'undefined' ? __exceedanceEpisodes : [];
    if (curEps.length) {
      const p = pickPrimary(curEps);
      const dayStart = String(p.worst_day) + ' 00:00:00';
      const strongest = {
        column: p.column, column_id: p.column, timestamp: dayStart, value: p.extreme_value, zscore: null, direction: p.side === 'above' ? 'high' : 'low',
        instrument_range: p.instrument_range || null, period_ms: 86400000, resample_rule: 'D',
        crossed_limits: [{ label: p.label, value: p.limit }], search_limit: { label: p.label, value: p.limit, side: p.side },
        alternatives: curEps.filter(e => e !== p).map(e => ({ column: e.column, timestamp: String(e.worst_day) + ' 00:00:00', value: e.extreme_value, zscore: null,
          search_limit: { label: e.label, value: e.limit, side: e.side }, crossed_limits: [{ label: e.label, value: e.limit }], instrument_range: e.instrument_range || null, period_ms: 86400000 }))
      };
      for (const target of Array.from(new Set([eventEvidenceStatus, effectiveEventEvidenceStatus]))) {
        if (!target || typeof target !== 'object') continue;
        const sa = asObject(target.statistical_anomaly);
        target.statistical_anomaly = Object.assign({}, sa, { status: sa.status || 'confirmed', strongest_event: strongest,
          strongest_zscore_event: sa.strongest_zscore_event || sa.strongest_event || null, anchor_basis: 'threshold_episode_scan' });
        target.event_window = Object.assign({}, asObject(target.event_window), { status: 'anchor_available', anchor_timestamp: p.extreme_time, source: 'threshold_episode_scan', anchor_period_ms: 86400000 });
      }
      // 日聚合 z 分数异常点列表被按日扫描取代，避免两套越限日期并存
      for (let i = establishedThresholds.length - 1; i >= 0; i--) {
        const th = establishedThresholds[i];
        if (th && th.turn_ref === 'computed' && /^确定性异常点定位：/.test(String(th.statement || ''))) establishedThresholds.splice(i, 1);
      }
      // EVENT_WINDOW_DRIVERS_GATE_V7：筛选越限的那一轮（会话里还没有保存的越限时段）不做关联变量扫描；F118 在后续轮次也会重扫出越限时段，
      // 只按「本轮有越限时段」判断会把 T8/T10 也当成筛选轮（run121 T8 exec 154473 因此未扫描）
      if (!saved.length) return;
    }

    // 回环第二次运行：沿用上一次的扫描结果（不重复取数）
    const __prevWd = asObject(__prevEpbRun && __prevEpbRun.window_drivers);
    if (__prevWd.statement) {
      __windowDrivers = __prevWd;
      let at0 = 0;
      while (at0 < establishedThresholds.length && establishedThresholds[at0] && establishedThresholds[at0].turn_ref === 'computed') at0++;
      establishedThresholds.splice(at0, 0, { turn_ref: 'computed', user_question: '', statement: __prevWd.statement });
      for (const target of Array.from(new Set([eventEvidenceStatus, effectiveEventEvidenceStatus]))) {
        if (target && typeof target === 'object') target.relationship_evidence = Object.assign({}, asObject(target.relationship_evidence),
          { window_drivers: __prevWd.leading, window_related_movers: __prevWd.related_movers, window: __prevWd.window });
      }
      return;
    }
    // 取数预算不足（与 F118 共用截止时间，Code 节点约 60 秒被终止）时不做扫描
    if (Date.now() > __epbDeadline - 12000) { __windowDrivers = { skipped: 'time_budget' }; return; }
    // ② 事件窗口：本轮 Param Injector 定位结果 > 会话保存的越限时段
    let win = null;
    for (const u of asArray(completedUnits)) {
      const ref = asObject(asObject(asObject(u).params).event_anchor_refinement);
      if (ref.status !== 'located') continue;
      const a = utcMs(ref.first_crossing), b = utcMs(ref.last_crossing);
      if (Number.isFinite(a) && Number.isFinite(b)) { win = { column: String(ref.column || ''), first: a, last: b, source: 'param_injector_refinement', limit: asObject(ref.crossing_limit) }; break; }
    }
    if (!win && saved.length) {
      const p = pickPrimary(saved);
      const a = utcMs(p.first_crossing), b = utcMs(p.last_crossing);
      if (Number.isFinite(a) && Number.isFinite(b)) win = { column: String(p.column), first: a, last: b, source: 'saved_exceedance_episode' + (p.turn_ref ? '（第 ' + p.turn_ref + ' 轮）' : ''), limit: { label: p.label, value: p.limit, side: p.side } };
    }
    const histUnits = asArray(completedUnits).filter(u => /^arctic_/.test(String(asObject(u).tool || '')));
    if (!win || !histUnits.length || !(ruleMs > 0)) return;
    const restBase = String(asObject(rp.mongodb).rest_base_url || '').replace(/\/+$/, '');
    let tools = [];
    try { tools = asArray(asObject(asObject($('Extract Plan Data').first().json.catalog).mongodb).tools); } catch (e) {}
    const anPath = String((tools.find(t => t && /_analyze$/.test(String(t.name || '')) && t.path && !t.deprecated) || {}).path || '');
    const mdPath = String((tools.find(t => t && /_metadata$/.test(String(t.name || '')) && t.path && !t.deprecated) || {}).path || '');
    const tgt = (() => {
      for (const u of histUnits) {
        const p = asObject(asObject(u).params); const t0 = asObject(asArray(p.targets)[0]);
        const db = p.database || p.library || t0.database || t0.library; const co = p.collection || p.symbol || t0.collection || t0.symbol;
        if (db && co) return { database: String(db), collection: String(co) };
      }
      const e = saved[0] || {};
      return e.database && e.collection ? { database: String(e.database), collection: String(e.collection) } : null;
    })();
    if (!restBase || !anPath || !mdPath || !tgt) return;
    const http = async (o) => {
      const left = __epbDeadline - Date.now();
      if (left < 3000) return { status: 0, body: { error: 'time_budget' } };
      try {
        const r = await __epbCtx.helpers.httpRequest(Object.assign({ json: true, returnFullResponse: true, ignoreHttpStatusErrors: true, timeout: Math.min(20000, left - 1000) }, o));
        let b = r && r.body !== undefined ? r.body : r; if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) {} }
        return { status: Number((r && r.statusCode) || 200), body: b || {} };
      } catch (e) { return { status: 0, body: { error: String(e && e.message || e) } }; }
    };
    const md = await http({ method: 'GET', url: restBase + mdPath + '?database=' + encodeURIComponent(tgt.database) + '&collection=' + encodeURIComponent(tgt.collection) });
    const tdsc = asObject(asObject(asObject(md.body).metadata).tag_descriptions);
    const en = asObject(tdsc.desc_en), cn = asObject(tdsc.desc_cn);
    const allCols = Array.from(new Set(Object.keys(en).concat(Object.keys(cn))));
    if (!allCols.length) return;
    const desc = c => String(cn[c] || en[c] || '').trim();
    const described = allCols.filter(c => desc(c));
    const loopKey = t => { const m = String(t || '').toUpperCase().match(/^([A-Z])[A-Z]*?(\d{3,5})/); return m ? m[1] + m[2] : ''; };
    const targetKey = loopKey(win.column);
    const tDesc = desc(win.column);
    // 关键关联变量（相关集）：目标描述里的设备词命中的位号（按描述表词频选极大 n-gram：至少 3 个位号共有、不超过有描述位号的 10%，不写死词表）
    // + 本次对话 / 本轮证据中出现的位号
    const cap = Math.max(30, Math.round(described.length * 0.1));
    const grams = [];
    for (let n = 2; n <= Math.min(8, tDesc.length); n++) for (let i = 0; i + n <= tDesc.length; i++) grams.push(tDesc.slice(i, i + n));
    const df = new Map(Array.from(new Set(grams)).map(g => [g, described.filter(c => desc(c).includes(g)).length]));
    const okGrams = Array.from(df.entries()).filter(([g, n]) => n >= 3 && n <= cap)
      .filter(([g, n]) => !Array.from(df.entries()).some(([h, m]) => h !== g && h.includes(g) && m === n))
      .map(([g]) => g);
    const related = new Map();
    for (const c of described) if (okGrams.some(g => desc(c).includes(g))) related.set(c, 'same_equipment');
    const TAG = /[A-Z]{1,6}_?\d{3,5}[A-Z]?(?:_\d+)?/g;
    // EVENT_WINDOW_RELATED_SET_V7：提到的位号只取会话状态（各轮问答、事实卡）与阈值句；
    // 证据表格（报警位号表 / DCS 统计表）整表列着几百个位号，不算「提到」（exec 154550 因此混入 B 炉、汽轮机、稳定塔位号）
    const texts = [JSON.stringify(__st).slice(0, 400000)]
      .concat(establishedThresholds.map(t => String(asObject(t).statement || '')));
    const byBase = new Map();
    for (const c of allCols) { const b = c.split('.')[0].toUpperCase(); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(c); }
    const mentioned = new Set();
    for (const t of texts) for (const m of (t.toUpperCase().match(TAG) || [])) mentioned.add(m);
    for (const m of mentioned) for (const c of (byBase.get(m) || [])) if (!related.has(c)) related.set(c, 'mentioned');
    // 扫描集：全部有描述的位号 + 相关集中无描述的位号（同回路的另一块表单独报告）
    const peers = allCols.filter(c => loopKey(c) === targetKey && c !== win.column && desc(c) && desc(c) === tDesc);
    const scan = Array.from(new Set(described.concat(Array.from(related.keys())))).filter(c => loopKey(c) !== targetKey);
    if (!scan.length) return;

    let limit = 80;
    const callOnce = async (segs, chunk) => http({ method: 'POST', url: restBase + anPath, body: {
      targets: segs.map(s0 => ({ name: s0.name, database: tgt.database, collection: tgt.collection, columns: chunk, date_range: [new Date(s0.a).toISOString(), new Date(s0.b - 1000).toISOString()] })),
      date_range: [new Date(Math.min(...segs.map(s0 => s0.a))).toISOString(), new Date(Math.max(...segs.map(s0 => s0.b))).toISOString()], analysis_types: ['period_profile'] } });
    // 多段 × 多列，按 max_columns 分批，4 路并发；遇 400 按返回的上限重分
    const profile = async (segs, columns) => {
      const idx = new Map();
      for (let attempt = 0; attempt < 4; attempt++) {
        const segGroups = [];
        for (let i = 0; i < segs.length; i += limit) segGroups.push(segs.slice(i, i + limit));
        const jobs = [];
        for (const sg of segGroups) { const pc = Math.max(1, Math.floor(limit / sg.length)); for (let i = 0; i < columns.length; i += pc) jobs.push([sg, columns.slice(i, i + pc)]); }
        let failed = false, shrink = null;
        for (let i = 0; i < jobs.length && !failed; i += 4) {
          const res = await Promise.all(jobs.slice(i, i + 4).map(([sg, ch]) => callOnce(sg, ch)));
          for (const resp of res) {
            if (resp.status >= 400 || resp.status === 0) {
              failed = true;
              const mx = Number(asObject(asObject(resp.body).detail).max_columns);
              if (Number.isFinite(mx) && mx > 0 && mx < limit) shrink = mx; else if (resp.status === 400 && limit > 1) shrink = Math.floor(limit / 2);
              continue;
            }
            for (const r of asArray(asObject(resp.body).period_profile)) {
              const o = asObject(r);
              if (Number(o.count) > 0 && Number.isFinite(Number(o.min)) && Number.isFinite(Number(o.max)))
                idx.set(String(o.target || '') + '|' + String(o.column || ''), { n: Number(o.count), min: Number(o.min), mean: Number(o.mean), max: Number(o.max) });
            }
          }
        }
        if (!failed) return idx;
        if (!shrink) return null;
        limit = shrink; idx.clear();
      }
      return null;
    };
    const step = ruleMs;
    const evA = Math.floor((win.first - 3600000) / step) * step;
    const evB = Math.ceil((win.last + step + 1800000) / step) * step;
    const cut1 = Math.floor((win.first - 900000) / step) * step, cut2 = Math.floor(win.first / step) * step + step;
    // 第一步：基线（窗口前 24h）/ 越限前（窗口起点至首次越限前 15min）/ 临界（首次越限前 15min 至越限所在分段）/ 越限后
    const s1 = await profile([{ name: 'base', a: evA - 86400000, b: evA }, { name: 'pre', a: evA, b: cut1 }, { name: 'lead', a: cut1, b: cut2 }, { name: 'post', a: cut2, b: evB }],
      scan.concat([win.column], peers));
    if (!s1) return;
    const scored = [];
    for (const c of scan.concat([win.column])) {
      const b = s1.get('base|' + c); if (!b) continue;
      const w = Math.max(b.max - b.min, Math.abs(b.mean) * 0.01, 1e-6);
      const sc = k => { const e = s1.get(k + '|' + c); return e ? Math.max((e.max - b.max) / w, (b.min - e.min) / w, 0) : 0; };
      scored.push({ column: c, desc: desc(c), rel: related.get(c) || '', base: b, w, pre: sc('pre'), lead: sc('lead'), post: sc('post') });
    }
    const MOVE = 0.5; // 越出基线范围超过基线幅度的一半
    const others = scored.filter(x => x.column !== win.column);
    const moved = others.filter(x => Math.max(x.pre, x.lead, x.post) >= MOVE);
    // 同类测点：描述去掉编号后相同（如 1#～8# 喷嘴、T1201/T1202 塔顶压力、_1/_2 冗余温度），每类只列偏离最大的一个并注明同类数
    const kindOf = x => (x.desc ? x.desc.replace(/[0-9A-Za-z#＃_-]+/g, '') : x.column) || x.column;
    const dedupe = arr => { const seen = new Map(); const out = []; for (const x of arr) { const k = kindOf(x); if (seen.has(k)) { seen.get(k).same_kind++; continue; } const y = Object.assign({}, x, { same_kind: 1 }); seen.set(k, y); out.push(y); } return out; };
    const leading = dedupe(moved.filter(x => Math.max(x.pre, x.lead) >= MOVE).sort((a, b) => Math.max(b.pre, b.lead) - Math.max(a.pre, a.lead))).slice(0, 25);
    const relMoved = dedupe(moved.filter(x => x.rel).sort((a, b) => Math.max(b.pre, b.lead, b.post) - Math.max(a.pre, a.lead, a.post))).slice(0, 15);
    // 第二步：5min 分段定首次越出时刻与方向
    const fine = Array.from(new Set(leading.concat(relMoved).map(x => x.column).concat([win.column])));
    const segs = [];
    for (let t = evA; t < evB; t += step) segs.push({ name: 's' + segs.length, a: t, b: t + step });
    const s2 = (await profile(segs, fine)) || new Map();
    const timeline = (x, sg = segs, mp = s2) => {
      const rows = sg.map(s0 => ({ t: s0.a, r: mp.get(s0.name + '|' + x.column) })).filter(y => y.r);
      const hiL = x.base.max + 0.1 * x.w, loL = x.base.min - 0.1 * x.w;
      const upAt = rows.find(y => y.r.max > hiL), dnAt = rows.find(y => y.r.min < loL);
      const hi = rows.length ? rows.reduce((m, y) => (y.r.max > m.r.max ? y : m)) : null;
      const lo = rows.length ? rows.reduce((m, y) => (y.r.min < m.r.min ? y : m)) : null;
      const firstOut = [upAt, dnAt].filter(Boolean).sort((a, b) => a.t - b.t)[0] || null;
      return { first_out: firstOut ? firstOut.t : null, up: upAt ? upAt.t : null, down: dnAt ? dnAt.t : null, hi, lo };
    };
    const tz = /^([+-])(\d{2}):?(\d{2})$/.exec(String(asObject(rp.arcticdb).default_timezone || ''));
    const tzMs = tz ? (tz[1] === '-' ? -1 : 1) * (Number(tz[2]) * 60 + Number(tz[3])) * 60000 : null;
    const hm = ms => new Date(ms).toISOString().slice(11, 16);
    const full = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
    const r4 = v => String(Math.round(Number(v) * 10000) / 10000);
    const tRow = scored.find(x => x.column === win.column);
    const tLine = tRow ? timeline(tRow) : null;
    const tFirst = tLine && tLine.first_out != null ? tLine.first_out : Math.floor(win.first / step) * step;
    let tFirstMinute = null;
    const describe = x => {
      const L = x.tl;
      const up = L.up != null, dn = L.down != null;
      const move = up && dn ? (L.up < L.down ? '先升后降' : L.down < L.up ? '先降后升' : '同段内上下波动') + '，窗口内最高 ' + r4(L.hi.r.max) + '（' + hm(L.hi.t) + '）、最低 ' + r4(L.lo.r.min) + '（' + hm(L.lo.t) + '）'
        : up ? '升高，窗口内最高 ' + r4(L.hi.r.max) + '（' + hm(L.hi.t) + '）' : dn ? '降低，窗口内最低 ' + r4(L.lo.r.min) + '（' + hm(L.lo.t) + '）' : '越出基线（5min 分段未定位到时刻）';
      return (L.first_out != null ? hm(L.first_out) + ' 起 ' : '') + x.column + (x.desc ? '（' + x.desc + (x.same_kind > 1 ? '，同类测点共 ' + x.same_kind + ' 个' : '') + '）' : '') + move + '，基线 ' + r4(x.base.min) + '～' + r4(x.base.max);
    };
    const withTl = arr => arr.map(x => Object.assign({}, x, { tl: timeline(x) }));
    let lead2 = withTl(leading).filter(x => x.tl.first_out != null && x.tl.first_out <= tFirst)
      .sort((a, b) => (a.tl.first_out - b.tl.first_out) || (Math.max(b.pre, b.lead) - Math.max(a.pre, a.lead))).slice(0, 12);
    // 第三步：领先变量与目标再按 1min 分段（历史库为分钟数据）区分同一 5min 分段内的先后；分钟段取不到数据时保留 5min 结果
    let minuteNote = '';
    if (lead2.length && step > 60000) {
      const mA = Math.min(...lead2.map(x => x.tl.first_out)) - step, mB = tFirst + step;
      const mSegs = [];
      for (let t = mA; t < mB; t += 60000) mSegs.push({ name: 'm' + mSegs.length, a: t, b: t + 60000 });
      const s3 = mSegs.length <= 60 ? await profile(mSegs, lead2.map(x => x.column).concat([win.column])) : null;
      const filled = s3 ? mSegs.filter(m0 => s3.has(m0.name + '|' + win.column)).length : 0;
      if (s3 && filled >= mSegs.length * 0.8) {
        const tm = x => timeline(x, mSegs, s3).first_out;
        const tMin = tRow ? tm(tRow) : null;
        for (const x of lead2) { const m = tm(x); if (m != null) x.tl.first_out = m; }
        lead2 = lead2.filter(x => tMin == null || x.tl.first_out <= tMin)
          .sort((a, b) => (a.tl.first_out - b.tl.first_out) || (Math.max(b.pre, b.lead) - Math.max(a.pre, a.lead)));
        if (tMin != null) tFirstMinute = tMin;
        minuteNote = '（首次越出时刻按 1min 分段）';
      }
    }
    // 已在领先列表出现过的同类测点不重复；同设备的排在前，再按首次越出时刻
    const shownKinds = new Set(lead2.map(kindOf));
    const rel2 = withTl(relMoved.filter(x => !shownKinds.has(kindOf(x))))
      .sort((a, b) => ((b.rel === 'same_equipment') - (a.rel === 'same_equipment')) || ((a.tl.first_out == null) - (b.tl.first_out == null)) || ((a.tl.first_out || 0) - (b.tl.first_out || 0))).slice(0, 8);
    const circ = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫';
    const peerTxt = peers.map(c => { const e = s1.get('post|' + c) || s1.get('lead|' + c); return e ? c + ' 越限后 ' + r4(e.min) + '～' + r4(e.max) : ''; }).filter(Boolean);
    const stmt = '确定性关联变量扫描（' + win.column + (tDesc ? '，' + tDesc : '') + '）：事件窗口 ' + full(evA) + ' 至 ' + full(evB) + ' UTC' +
      (tzMs != null ? '（当地 ' + full(evA + tzMs) + ' 至 ' + full(evB + tzMs) + '）' : '') + '，越限时段取自' +
      (win.source === 'param_injector_refinement' ? '本轮原始读数定位' : '本次对话已筛出的越限' + String(win.source).replace('saved_exceedance_episode', '')) +
      '（首次 ' + full(win.first) + '、末次 ' + full(win.last) + ' UTC），基线取窗口前 24 小时的读数范围，「越出」指超出基线范围达基线幅度的一半以上。' +
      '全厂 ' + others.length + ' 个有数据的位号中，' + moved.length + ' 个在窗口内越出基线，其中在目标越出基线（' + hm(tFirstMinute != null ? tFirstMinute : tFirst) + '）之前或同时就已越出的（同类测点只列偏离最大的一个）按先后' + minuteNote + '为：' +
      (lead2.length ? lead2.map((x, i) => circ[i] + ' ' + describe(x)).join('；') : '无') + '。' +
      (rel2.length ? '与目标同设备或本次对话提到的关键变量另有：' + rel2.map(describe).join('；') + '。' : '') +
      (peerTxt.length ? '同回路另一块表 ' + peerTxt.join('、') + '。' : '') +
      '同一分段内的先后无法区分；先后与幅度只说明同窗变化，不等于因果，主次需结合机理判断。';
    const pack = x => ({ column: x.column, desc: x.desc, related: x.rel || null, first_out: x.tl.first_out != null ? full(x.tl.first_out) : null,
      up_at: x.tl.up != null ? full(x.tl.up) : null, down_at: x.tl.down != null ? full(x.tl.down) : null,
      max: x.tl.hi ? x.tl.hi.r.max : null, min: x.tl.lo ? x.tl.lo.r.min : null, base_min: x.base.min, base_max: x.base.max });
    __windowDrivers = { window: { start: full(evA), end: full(evB), first_crossing: full(win.first), last_crossing: full(win.last), source: win.source, target_first_out: full(tFirstMinute != null ? tFirstMinute : tFirst) },
      grams: okGrams, compared: others.length, moved: moved.length, leading: lead2.map(pack), related_movers: rel2.map(pack), statement: stmt };
    let at = 0;
    while (at < establishedThresholds.length && establishedThresholds[at] && establishedThresholds[at].turn_ref === 'computed') at++;
    establishedThresholds.splice(at, 0, { turn_ref: 'computed', user_question: '', statement: stmt });
    for (const target of Array.from(new Set([eventEvidenceStatus, effectiveEventEvidenceStatus]))) {
      if (target && typeof target === 'object') target.relationship_evidence = Object.assign({}, asObject(target.relationship_evidence),
        { window_drivers: __windowDrivers.leading, window_related_movers: __windowDrivers.related_movers, window: __windowDrivers.window });
    }
  } catch (err) { __windowDrivers = { error: String(err && err.message || err).slice(0, 300) }; }
})();

// SUBJECT_RELEVANCE_EVIDENCE_FILTER_V6
// T9 实测（exec 115446 / 121598）：召回的 27 条证据几乎全是别的设备——
// 烟气脱硫 SO2、SCR 氨逃逸、汽包液位、过热蒸汽温度，没有一条讲两器压差；
// finalizer 顺着证据把答案写成了"烟气排放超标的原因"。
// 仅在 finalizer 提示词里加主体纪律拦不住（已验证无效），因此下沉到证据层：
// 按本轮主体给每条证据打标，主体证据足够时剔除离题条目；全部离题时保留但
// 打上 off_subject，让 finalizer 只能说"未检索到本主体的证据"。
(function applySubjectRelevanceToPacket() {
  const ZH_STOP = new Set([
    '什么', '怎么', '如何', '哪些', '哪个', '是否', '可以', '能否', '需要', '请问',
    '一下', '这个', '那个', '我们', '你们', '进行', '出现', '存在', '以及', '还有',
    '或者', '但是', '因为', '所以', '如果', '然后', '目前', '当前', '相关', '有关',
    '给出', '提供', '说明', '解释', '分析', '看看', '帮我', '告诉', '之后', '之前',
    '方面', '情况', '问题', '原因', '可能', '数据', '结果', '内容', '资料'
  ]);
  let source = '';
  try {
    const cap = toInternalPacketContract($('Capture context').first().json || {});
    const st = (cap && cap.conversation_state) || {};
    source = [cap.originalUserMessage, cap.chatInput, st.latest_topic,
              st.latest_resolved_question].filter(Boolean).map(String).join(' ');
  } catch (e) { source = ''; }
  if (!source) return;

  const terms = new Set();
  for (const tag of (source.match(/[A-Z]{2,6}\d{3,5}[A-Z]?(?:\.[A-Z]{2,4})?/g) || [])) {
    terms.add(tag.toUpperCase());
  }
  for (const seg of source.split(/[^\u4e00-\u9fff]+/)) {
    if (!seg || seg.length < 2) continue;
    for (let n = Math.min(6, seg.length); n >= 2; n--) {
      for (let i = 0; i + n <= seg.length; i++) {
        const w = seg.slice(i, i + n);
        if (!ZH_STOP.has(w)) terms.add(w);
      }
    }
  }
  // SUBJECT_TERM_ORDER_VARIANTS_V7
  // 中文工艺词大量存在词序互换：压差/差压、温差/差温、液位差/差液位。
  // 问句说「两器压差」，DCS 表那一行却写「沉降器与二再差压」，
  // 词序一反就匹配不上，整批文档证据被判离题剔除（实测 exec 135018：
  // 输入里 PDRA3125 出现 390 次，最终 packet 只剩 2 条且无一条 DCS 统计表）。
  // 09-03 已在目录查询归一化里处理过同一问题，这里补上主体过滤这一侧。
  (function addOrderVariants() {
    const PAIRS = [['压差', '差压'], ['温差', '差温'], ['压降', '降压']];
    for (const t of Array.from(terms)) {
      for (const [a, b] of PAIRS) {
        if (t.indexOf(a) >= 0) terms.add(t.split(a).join(b));
        if (t.indexOf(b) >= 0) terms.add(t.split(b).join(a));
      }
    }
    // 主体是两器压差时，表行里的等价说法也算命中
    const joined = Array.from(terms).join(' ');
    if (/两器|反再/.test(joined) && /压差|差压/.test(joined)) {
      for (const x of ['差压', '压差', '沉降器', '二再', '一再', '再生器', '反再差压']) terms.add(x);
    }
  })();

  const termList = Array.from(terms).filter(t => t.length >= 2).slice(0, 80);
  if (termList.length < 2) return;

  let onCount = 0;
  for (const entry of packet) {
    const blob = [entry.document_name, entry.section_title, entry.content_summary,
                  entry.snippet, entry.relevance_to_question]
      .filter(Boolean).map(String).join(' ');
    const upper = blob.toUpperCase();
    // HISTORIAN_EVIDENCE_ENTRIES_V7：历史库条目按本轮主体位号查出，视为切题
    const hit = entry.source_kind === 'historian' || entry.source_kind === 'plant_model_static' || termList.some(t => (/^[A-Z]/.test(t) ? upper.includes(t) : blob.includes(t)));
    entry.off_subject = !hit;
    if (hit) onCount++;
  }
  // 主体证据够用时才剔除；不够就全部保留并打标，避免把本来就稀薄的证据清空
  if (onCount >= 3) {
    for (let i = packet.length - 1; i >= 0; i--) {
      if (packet[i].off_subject && !packet[i].recalled_for) packet.splice(i, 1); // EVIDENCE_RECALL_V1：点回的条目不按字面主体过滤剔除
    }
  }

  // F21：按相关度排序后再裁到 MAX_PACKET_ITEMS，最后连续重编号。
  // 相关度而非到达顺序决定名额；重编号消除 splice 留下的空洞（E1 E2 E4 …）。
  const subjTags = new Set();
  for (const t of termList) if (/^[A-Z]{2,6}\d{3,5}/.test(t)) subjTags.add(t.toUpperCase());
  const cjkTerms = termList.filter(t => /[\u4e00-\u9fff]/.test(t) && t.length >= 2);
  for (const entry of packet) {
    const blob = [entry.document_name, entry.section_title, entry.content_summary,
                  entry.snippet, entry.relevance_to_question]
      .filter(Boolean).map(String).join(' ');
    const upper = blob.toUpperCase();
    let score = entry.source_kind === 'plant_model_static' ? 100 : 0;
    // TERM_FREQUENCY_SCORE_V7
    // 原打分只看命中几个不同的词，不看命中多少次：一条里 PDRA3125 出现 20 次
    // 与出现 1 次同分，「顺带提一句」和「通篇在讲它」区分不出来。
    // 这里按出现次数补一项，用 log2 压缩并封顶 +3（1 次→1、3 次→2、7 次→3），
    // 避免 E5/E8 那种 2200+ 字符的重复表头长条目靠体量压过切题的短条目；
    // 上限低于主体位号命中的 +4，不改变「位号直接命中优先」的既定口径。
    let occ = 0;
    for (const tg of subjTags) {
      let from = 0;
      while (true) {
        const at = upper.indexOf(tg, from);
        if (at < 0) break;
        occ++; from = at + tg.length;
        if (occ > 64) break;
      }
      if (occ > 64) break;
    }
    if (occ <= 64) {
      for (const w of cjkTerms) {
        let from = 0;
        while (true) {
          const at = blob.indexOf(w, from);
          if (at < 0) break;
          occ++; from = at + w.length;
          if (occ > 64) break;
        }
        if (occ > 64) break;
      }
    }
    if (occ > 0) score += Math.min(3, Math.log(1 + occ) / Math.log(2));
    for (const tg of subjTags) if (upper.includes(tg)) { score += 4; break; }
    if (Number(entry.source_tier) === 1) score += 2;
    let n = 0;
    for (const w of cjkTerms) { if (blob.includes(w)) n++; if (n >= 3) break; }
    score += n;
    if (entry.off_subject) score -= 5;
    // DOCUMENT_PERIOD_PRIORITY_V7：同期文档优先；非同期且正文未写到所问月份的让位（不删除）
    Object.assign(entry, __periodFields(entry.document_name, [entry.section_title, entry.content_summary, entry.snippet].join(' ')));
    if (entry.period_relation === 'in_period') score += 3;
    else if (entry.period_relation === 'other_period' && !entry.requested_period_mentioned) score -= 3;
    entry.__score = score;
  }
  // PER_UNIT_PACKET_QUOTA_V7
  // 先给每个有产出的单元保底 FLOOR_PER_UNIT 席，余额再按全局相关度补齐。
  // 原实现直接按分数截断，属赢者通吃：exec 136355 里 unit 1 占 9 席、
  // 非单元来源 3 席，声明了必答项的 unit 2（45 条、含 18 处「滑阀」）一席未得，
  // finalizer 因此拿不到操作步骤序列。
  const scored = packet
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (b.e.__score - a.e.__score) || (a.i - b.i));

  const byUnit = new Map();
  for (const x of scored) {
    const k = x.e.source_unit_id == null ? '__none' : String(x.e.source_unit_id);
    if (!byUnit.has(k)) byUnit.set(k, []);
    byUnit.get(k).push(x);
  }

  const picked = [];
  const takenIdx = new Set();
  for (const arr of byUnit.values()) {
    for (const x of arr.slice(0, FLOOR_PER_UNIT)) {
      if (picked.length >= MAX_PACKET_ITEMS) break;
      picked.push(x);
      takenIdx.add(x.i);
    }
  }
  for (const x of scored) {
    if (picked.length >= MAX_PACKET_ITEMS) break;
    if (takenIdx.has(x.i)) continue;
    picked.push(x);
    takenIdx.add(x.i);
  }

  // TAG_REQUIREMENT_EXTRA_SEATS_V7
  // 位号类轮次在 MAX_PACKET_ITEMS 之外追加至多 3 席，原有席位不动。
  // 实测 exec 139554（T5「压差控制器的位号是什么？」）：含 PRCA3101/3102 的条目得 5.00 分、
  // 第 36 名，门槛 6.00，未入包。改用加分会挤出本轮回答实际引用的 4 条证据，故改为追加。
  // 触发：任一条目的必答项类型名含 tag（字面判断，不维护类型表）；
  // 选取：未入包条目按原分数从高到低，正文带有包内尚未出现的位号标识者。
  {
    const __tagTurn = packet.some(e => Array.isArray(e.source_required_types) &&
      e.source_required_types.some(t => /tag/i.test(String(t || ''))));
    if (__tagTurn) {
      const __TAG_RE = /[A-Z]{2,6}\d{3,5}/g;
      const __bodyOf = e => String(e.content_summary || e.snippet || '').toUpperCase();
      const __present = new Set();
      for (const x of picked) for (const t of (__bodyOf(x.e).match(__TAG_RE) || [])) __present.add(t);
      let __extra = 0;
      for (const x of scored) {
        if (__extra >= 3) break;
        if (takenIdx.has(x.i) || x.e.off_subject) continue;
        const __allTags = [...new Set(__bodyOf(x.e).match(__TAG_RE) || [])];
        // 只收「点名少数几个位号」的条目：整表罗列几十个位号的控制点清单不占追加席
        //（离线实测不加此限时，3 席全被 DCS 控制点表行占去，PRCA3101 那条仍进不来）。
        if (__allTags.length > 4) continue;
        const __newTags = __allTags.filter(t => !__present.has(t));
        if (!__newTags.length) continue;
        picked.push(x);
        takenIdx.add(x.i);
        __extra++;
        for (const t of __newTags) __present.add(t);
      }
    }
  }

  // COVERAGE_GAP_EXTRA_SEATS_V1：自查环为补缺口查回的证据在 MAX_PACKET_ITEMS 之外追加至多 6 席，原有席位不动。
  // 来由：exec 184378（Q8）自查环读进的 2 月月报「2.1 物料平衡表」是该单元第 5 条，单元保底 3 席、24 席已满而未入包，
  // 回答因此写「2 月月报本轮未检索到物料平衡表」。自查环查它正是因为缺这一块，不该被挤掉。
  {
    let __gapExtra = 0;
    for (const x of scored) {
      if (__gapExtra >= 6) break;
      if (takenIdx.has(x.i) || x.e.off_subject) continue;
      if (!/^Coverage retry/i.test(String(x.e.relevance_to_question || ''))) continue;
      if (x.e.period_relation === 'other_period' && !x.e.requested_period_mentioned) continue;
      picked.push(x);
      takenIdx.add(x.i);
      __gapExtra++;
    }
  }

  // EVIDENCE_RECALL_V1：模型按索引点回的条目在 MAX_PACKET_ITEMS 之外追加至多 8 席，原有席位不动（做法同上面的追加席）。
  // 已在包里的不占席。来由：exec 184378 的 2 月物料平衡表、182710 的 3 月历史库统计条目按分数排在席位之外，回答因此写「未检索到」。
  {
    for (const x of picked) if (x.e.recalled_for) __recallInPacket++;
    for (const x of scored) {
      if (__recallExtraSeats >= 8) break;
      if (takenIdx.has(x.i) || !x.e.recalled_for) continue;
      picked.push(x);
      takenIdx.add(x.i);
      __recallExtraSeats++;
    }
  }

  // CITED_EVIDENCE_KEPT_ON_EDIT_V8
  // 反查环的修改轮：上一稿成稿引用过的证据、以及反查结论点名的证据，在席位之外追加入包，原有席位不动（做法同上面的位号追加席）。
  // 来由：补检取回新证据后证据包按分数重排，上一稿引用过的证据有 28% 不在下一轮的包里（方案 A 后 48 轮重写里 42 轮都丢）。
  // 修改轮只换掉被反查标出的句子，其余句子连同引用原样保留；它们引用的证据必须仍在包里，否则证据卡片和下一轮反查都对不上。
  // 认证据按条目本身（文档名 + 正文开头），不按编号：历史库证据条目的编号排在文档证据之后，文档证据一增加它就顺延
  //（exec 160744：E60/E61/E62 下一轮变成 E73/E74/E75），旧编号还可能被新取回的文档证据占用。
  // 只在本次执行里已有成稿（Prepare Answer Verification 跑过）时生效；首稿之前的各次运行不受影响。
  {
    const __evKey = (doc, body) => String(doc || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').slice(0, 40) + '|' + String(body || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').slice(0, 160);
    const __wantKeys = new Map(); // 条目特征 -> 上一稿里的原编号
    try {
      const __pv = $('Prepare Answer Verification').last().json || {};
      const __full = String(__pv.output || '');
      const __cut = /(^|\n)####\s/.exec(__full);
      const __body = __cut ? __full.slice(0, __cut.index) : __full;
      const __map = __pv.verification_id_map && typeof __pv.verification_id_map === 'object' ? __pv.verification_id_map : {};
      const __citedDisplay = new Set((__body.match(/\[E\d+\]/gi) || []).map(t => t.slice(1, -1).toUpperCase()));
      // 反查结论点名的证据（它认为真正相关的条目）同样留住：修改时要拿它们改引用、改说法
      try {
        const __o2d = new Map(Object.entries(__map).map(([d, o]) => [String(o).toUpperCase(), String(d).toUpperCase()]));
        const __fs = ($('Build Verification Retry').last().json || {}).verification_findings;
        for (const f of (Array.isArray(__fs) ? __fs : [])) for (const id of [].concat((f && f.cited) || [], (f && f.ids) || [])) { const d = __o2d.get(String(id || '').toUpperCase()); if (d) __citedDisplay.add(d); }
      } catch (e) {}
      const __sent = __pv.answer_verification_packet && Array.isArray(__pv.answer_verification_packet.evidence) ? __pv.answer_verification_packet.evidence : [];
      for (const ev of __sent) {
        const d = String((ev && ev.id) || '').toUpperCase();
        if (__citedDisplay.has(d)) __wantKeys.set(__evKey(ev.doc, ev.text), String(__map[d] || '').toUpperCase());
      }
    } catch (e) { __wantKeys.clear(); }
    if (__wantKeys.size) {
      // 本节点内部用内部词汇（ArcticDB、arctic_*），输出时才换成对外词汇；上一稿送检的证据是换过的。比之前先用同一个换词函数统一，
      // 否则正文开头带这类词的历史库条目认不出来（副本 exec 160918：「MongoDB tag catalog: no matching tags…」一条被引用 3 处，全部丢了引用）。
      const __keyOf = e => __evKey(replacePacketVocabulary(e.document_name, 'public'), replacePacketVocabulary(e.snippet || e.content_summary, 'public'));
      for (const x of picked) __wantKeys.delete(__keyOf(x.e));
      // 同一特征有多条候选时（同一文档里开头相同的相邻片段），优先取编号与上一稿一致的那条
      for (const pass of [0, 1]) {
        for (const x of scored) {
          if (!__wantKeys.size) break;
          if (takenIdx.has(x.i)) continue;
          const k = __keyOf(x.e);
          if (!__wantKeys.has(k)) continue;
          if (pass === 0 && String(x.e.evidence_id || '').toUpperCase() !== __wantKeys.get(k)) continue;
          picked.push(x);
          takenIdx.add(x.i);
          __wantKeys.delete(k);
        }
      }
    }
  }

  const ordered = picked
    .sort((a, b) => (b.e.__score - a.e.__score) || (a.i - b.i))
    .map(x => x.e);
  packet.length = 0;
  for (const e of ordered) { delete e.__score; packet.push(e); }
  // F28：这里原先按序重编号成 E1..En，已撤。
  // 空洞是展示层 buildEvidenceDisplayIdMap 自己会消的（按引用顺序重映射），
  // 而重编号会把 packet 的 id 与 claim_blocks.supported_by_evidence_ids
  // 引用的 digest 原始编号错开——实测 exec 135983（T9）同一条证据的
  // 「摘录」与「答案用途」因此来自两份不同文档。排序保留，编号不动。
})();


// CLAIM_ID_TRANSLATION_V7
// claim 的 supported_by_evidence_ids 是检索单元内编号；包内编号经顺延后与之不同。
// 实测 exec 138947：送给 finalizer 的 3 个 claim 引用全部指向包内另一条内容，
// 展示层「答案用途」10/10 挂错。按 claim.unit_id 换算，换算不到或已不在最终包里的剔除。
const __packetIds = new Set(packet.map(e => String(e.evidence_id || '').trim().toUpperCase()));
const __claimIdStats = { claims_with_ids: 0, ids_in: 0, translated: 0, dropped: 0,
                         repaste_by_content: 0, repaste_not_in_packet: 0 };
// 重贴型 claim（claim_text 以 "Retrieved evidence N:" 开头，正文即原文片段）：
// 上游有时文字里的第 N 条与 supported_by_evidence_ids 本身就不一致
// （exec 138917 单元 3：Retrieved evidence 15 标 E17、16 标 E18、2 标 E4），
// 按编号换算治不了，改为按正文开头在最终证据包里匹配。
// CLAIM_CONTENT_CONTAINMENT_V7
// 原按正文开头 60 字匹配，同一张表的不同行开头都是表头，会被当成同一条
// （exec 139509：11 条控制点表行开头完全相同，claim 全部挂到 E4）。
// 改为整段 10 字片段包含度取最高分。实测真正对应的条目得分 ≥0.99；
// 包内没有的表行只靠表头重合，得分 0.5~0.62 且与次高分相差不到 0.05。
// 故要求最高分 ≥0.8 且领先次高分 ≥0.15，否则不挂（宁可不显示用途，也不挂错）。
function __normText(t) {
  return String(t || '').replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}
function __shingleSet(t, n) {
  const out = new Set();
  for (let i = 0; i + n <= t.length; i++) out.add(t.slice(i, i + n));
  return out;
}
const __packetShingles = packet.map(e => ({
  id: e.evidence_id,
  s: __shingleSet(__normText(e.content_summary || e.snippet), 10)
}));
function __bestPacketMatch(text) {
  const cs = __shingleSet(__normText(text), 10);
  if (cs.size < 8) return null;
  let best = null, bestScore = 0, second = 0;
  for (const p of __packetShingles) {
    let hit = 0;
    for (const x of cs) if (p.s.has(x)) hit++;
    const sc = hit / cs.size;
    if (sc > bestScore) { second = bestScore; bestScore = sc; best = p.id; }
    else if (sc > second) { second = sc; }
  }
  return (bestScore >= 0.8 && bestScore - second >= 0.15) ? best : null;
}
const __REPASTE = /^\s*Retrieved evidence\s*\d+\s*[:：]\s*/i;
// CLAIM_CONTENT_FIRST_V7
// F50 补全文档名后，重贴型 claim 的标签由「Retrieved evidence N:」变为文档名（「报警位号.xlsx - Parameters: …」），
// 上面的正则认不出，这类 claim 改走编号换算；其编号是位置序号，多单元轮次换算错位
// （最后一轮 146 条中 12 条挂到别的文档，T5 10 条、T2 2 条）。
// 改为：先按内容匹配证据包；开头标签为「Retrieved evidence N」或等于任一证据的文档名/章节名
// （含未入包的单元证据）者视为重贴型，内容匹配不上就不挂，不再退回编号换算。
const __docLabels = new Set();
const __addDocLabel = x => { const v = String(x || '').trim(); if (v.length >= 4) __docLabels.add(v); };
for (const __pe of packet) { __addDocLabel(__pe.document_name); __addDocLabel(__pe.section_title); }
for (const __u of asArray(completedUnits)) {
  const __nr = asObject(asObject(__u).normalized_result);
  // UNIT_TRANSPORT_SLIM_V7：normalized_result 内与单元顶层相同的副本已在 Result Aggregator 删去，同时读单元顶层
  for (const __d of asArray(__nr.evidence_digest).concat(asArray(__nr.evidence_summary), asArray(asObject(__u).evidence_digest), asArray(asObject(__u).evidence_summary))) {
    __addDocLabel(asObject(__d).document_name); __addDocLabel(asObject(__d).section_title);
  }
}
function __splitClaimLabel(t) {
  const v = String(t || '');
  if (__REPASTE.test(v)) return { body: v.replace(__REPASTE, ''), labeled: true };
  const m = v.match(/^\s*([^:：\n]{4,200}?)\s*[:：]\s*/);
  if (m && __docLabels.has(m[1].trim())) return { body: v.slice(m[0].length), labeled: true };
  return { body: v, labeled: false };
}
for (const __c of asArray(finalCalculationClaims)) {
  const __co = asObject(__c);
  const __ids = asArray(__co.supported_by_evidence_ids);
  if (!__ids.length) continue;
  __claimIdStats.claims_with_ids += 1;
  const __ctext = String(__co.claim_text || '');
  const __split = __splitClaimLabel(__ctext);
  const __contentHit = __bestPacketMatch(__split.body);
  if (__split.labeled || __contentHit) {
    __claimIdStats.ids_in += __ids.length;
    const __hit = __contentHit;
    __co.original_supported_by_evidence_ids = __ids;
    if (__hit) {
      __co.supported_by_evidence_ids = [__hit];
      __claimIdStats.repaste_by_content += 1;
    } else {
      __co.supported_by_evidence_ids = [];
      __claimIdStats.repaste_not_in_packet += 1;
    }
    continue;
  }
  const __out = [];
  for (const __raw of __ids) {
    __claimIdStats.ids_in += 1;
    const __mapped = __claimIdMap.get(__claimKey(__co.unit_id, __raw));
    if (__mapped && __packetIds.has(String(__mapped).toUpperCase())) {
      __out.push(__mapped); __claimIdStats.translated += 1;
    } else {
      __claimIdStats.dropped += 1;
    }
  }
  __co.original_supported_by_evidence_ids = __ids;
  __co.supported_by_evidence_ids = Array.from(new Set(__out));
}

// DOCUMENT_PERIOD_PRIORITY_V7：论断同样标注所属时段；无证据编号的标 citable=false（finalizer 不得借用别的编号）
for (const __c of asArray(finalCalculationClaims)) {
  const __co = asObject(__c);
  const __t = String(__co.claim_text || '');
  const __doc = __co.document_name || (/^([^:：]{2,160}?\.(?:docx?|pdf|xlsx?|csv|txt|md))\s*[:：]/i.exec(__t) || [])[1] || '';
  Object.assign(__co, __periodFields(__doc, __t));
  if (!asArray(__co.supported_by_evidence_ids).length) __co.citable = false;
}

return [
  {
    json: toPublicMongoPacketContract({
      ...item,
      claim_id_translation: __claimIdStats,
      evidence_recall_result: { picks: asArray(asObject(item.evidence_recall).picks).length, located: __recallObjs.size, already_in_packet: __recallInPacket, extra_seats: __recallExtraSeats }, // EVIDENCE_RECALL_V1
      aggregated_payload: enrichedPayload,
      finalizer_payload: finalizerPayload,
      event_evidence_status: effectiveEventEvidenceStatus,
      threshold_registry: __thresholdRegistryOut,
      tag_evidence_status: tagEvidenceStatus,
      evidence_packet: packet,
      evidence_id_remap: idRemap,
      established_thresholds: establishedThresholds,
      threshold_comparison: __thresholdComparison,
      exceedance_episodes: __exceedanceEpisodes, // EXCEEDANCE_EPISODES_V7
      alarm_table_majority: __alarmTableMajorityOut, // ALARM_TABLE_MAJORITY_V7
      window_drivers: __windowDrivers // EVENT_WINDOW_DRIVERS_V7
    })
  }
];

});