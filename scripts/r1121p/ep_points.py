# -*- coding: utf-8 -*-
"""EXPECTED_POINT_RETRIEVAL_V1（11-19 用户「先改检索」；诊断实验：按要点限定文件检索取回的原文能补约 1 分）。
Capture context 的又一路下游（画布位置在主流程之上，v1 顺序先跑完）：
Prepare Expected Points → Expected Points LLM（DeepSeek 温度 0）→ Expected Point Retrieval（按要点限定资料检索，输出证据条目）。
Evidence Packet Builder 注入这些条目、视为切题、席位外追加至多 8 条（每个要点优先一条）。构建脚本与离线试验共用。"""

PTS_SYS = '''你是催化裂化（FCC）装置的资深工艺专家。为下面的问题列出一份优秀回答必须包含的要点，供检索资料用。
要点覆盖：机理原理、本装置的数据与月报结论、本装置的控制指标 / 限值 / 位号、运行判断与操作处置；按问题需要取舍，最多 8 条。
每条给出：
- point：要点（30 字以内）
- query：用于检索资料的中文问句，写具体的参数、现象、设备，不要写泛泛的「影响」「分析」
- source：去哪类资料找，只能是 latest_monthly（本装置技术月报）、regulation（本装置操作规程 / 工艺卡片 / 操作提纲）、textbook（催化裂化通识书与技术问答）、events（本装置事故与异常分析）、any（不限）之一
只问某个量的数值、统计值或位号是什么的问题，输出空列表。
只输出 JSON：{"points":[{"point":"","query":"","source":"textbook"}]}'''

PREP_JS = r'''// EXPECTED_POINT_RETRIEVAL_V1：给要点模型组输入（本轮问题；多轮时附前文已确认的完整问句）。
const cap = $input.first().json || {};
let q = String(cap.originalUserMessage || cap.chatInput || '');
try { const st = typeof cap.conversation_state === 'string' ? JSON.parse(cap.conversation_state || '{}') : (cap.conversation_state || {}); if (st.latest_resolved_question) q += '\n（前文已确认的完整问句：' + String(st.latest_resolved_question).slice(0, 300) + '）'; } catch (e) {}
return [{ json: { ep_question: q, ep_user: '问题：' + q } }];
'''

RETR_TMPL = r'''// EXPECTED_POINT_RETRIEVAL_V1：按模型列出的要点逐条限定资料检索（每条取前 3 段），组成证据条目交给 Evidence Packet Builder。
// 资料类型 → 限定范围：latest_monthly 月报（问句写了年月查那几个月，没写查最新一期）；regulation 静态资料里文件名带「规程 / 工艺卡片 / 提纲」的；
// textbook 通识库；events 事故分析库；any 不限。并发 4、单次 25 秒、总共 45 秒；失败的要点跳过。
__CFG__
const helper = this;
const base = String(defaultBaseUrl || '').replace(/\/+$/, '');
const H = { Authorization: 'Bearer ' + defaultApiKey, 'Content-Type': 'application/json' };
const DS = { monthly: '1877d018f6f311f0a7b933d55f4fdf13', static: '18b63458f6f211f0a7b933d55f4fdf13', textbook: 'ed6ad896f6f411f0a7b933d55f4fdf13', events: '2baed3e8f6f311f0a7b933d55f4fdf13' };
const ALL = ['ed6ad896f6f411f0a7b933d55f4fdf13', '2baed3e8f6f311f0a7b933d55f4fdf13', '1877d018f6f311f0a7b933d55f4fdf13', 'f70101a2f6f211f0a7b933d55f4fdf13', 'e85e9d30f6f211f0a7b933d55f4fdf13', '18b63458f6f211f0a7b933d55f4fdf13'];
__PM__
const deadline = Date.now() + 45000;
const trace = { points: 0, queried: 0, errors: 0, chunks: 0 };
const call = async (o) => {
  const left = deadline - Date.now(); if (left < 3000) throw new Error('budget');
  return await helper.helpers.httpRequest(Object.assign({ json: true, timeout: Math.min(25000, left - 1000), headers: H, skipSslCertificateValidation: true }, o));
};
let q = '';
try { q = String(($('Prepare Expected Points').first().json || {}).ep_question || ''); } catch (e) {}
let raw = '';
try { const j = $input.first().json || {}; raw = String(j.output || j.text || ''); } catch (e) {}
let points = [];
try { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); const o = JSON.parse(raw.slice(a, b + 1)); points = Array.isArray(o.points) ? o.points : []; } catch (e) {}
points = points.filter(p => p && String(p.query || '').trim()).slice(0, 8);
trace.points = points.length;
const entries = [];
if (points.length && base) {
  const list = async ds => ((((await call({ method: 'GET', url: base + '/api/v1/datasets/' + ds + '/documents?page=1&page_size=500' })) || {}).data || {}).docs || []).map(d => ({ id: d.id, name: String(d.name || '') }));
  let monthlyIds = null, regIds = null;
  try {
    const need = new Set(points.map(p => String(p.source || '')));
    if (need.has('latest_monthly')) {
      const docs = (await list(DS.monthly)).map(d => { const m = d.name.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/); return m ? Object.assign({}, d, { ym: +m[1] * 100 + +m[2] }) : null; }).filter(Boolean);
      const pm = __periodMonths(q); let pick = [];
      if (pm.months.length) pick = docs.filter(d => pm.months.includes(d.ym));
      else if (!pm.yearOnly && docs.length) { const top = Math.max(...docs.map(d => d.ym)); pick = docs.filter(d => d.ym === top); }
      monthlyIds = pick.slice(0, 6).map(d => d.id);
    }
    if (need.has('regulation')) regIds = (await list(DS.static)).filter(d => /规程|工艺卡片|提纲/.test(d.name)).map(d => d.id);
  } catch (e) { trace.errors += 1; }
  const scope = p => {
    const s = String(p.source || '');
    if (s === 'latest_monthly') return monthlyIds && monthlyIds.length ? { dataset_ids: [DS.monthly], document_ids: monthlyIds } : { dataset_ids: [DS.monthly] };
    if (s === 'regulation') return regIds && regIds.length ? { dataset_ids: [DS.static], document_ids: regIds } : { dataset_ids: [DS.static] };
    if (s === 'textbook') return { dataset_ids: [DS.textbook] };
    if (s === 'events') return { dataset_ids: [DS.events] };
    return { dataset_ids: ALL };
  };
  const seen = new Set();
  for (let i = 0; i < points.length; i += 4) {
    const batch = points.slice(i, i + 4);
    const res = await Promise.all(batch.map(async (p, k) => {
      try {
        const r = await call({ method: 'POST', url: base + '/api/v1/retrieval', body: Object.assign({ question: String(p.query).slice(0, 300), page_size: 3, top_k: 128, keyword: true, similarity_threshold: 0.2, vector_similarity_weight: 0.3 }, scope(p)) });
        trace.queried += 1;
        return { p, idx: i + k, chunks: ((((r || {}).data || {}).chunks) || []).slice(0, 3) };
      } catch (e) { trace.errors += 1; return null; }
    }));
    for (const x of res) {
      if (!x) continue;
      x.chunks.forEach((c, rank) => {
        const body = String(c.content || '').replace(/\s+/g, ' ').trim();
        const key = body.slice(0, 120); if (!body || seen.has(key)) return; seen.add(key);
        const pages = Array.from(new Set((Array.isArray(c.positions) ? c.positions : []).map(pp => Array.isArray(pp) ? Number(pp[0]) : NaN).filter(Number.isFinite))).sort((a, b) => a - b);
        entries.push({ document_name: c.document_keyword || c.docnm_kwd || '', dataset_name: '', page_start: pages.length ? pages[0] : null, page_end: pages.length ? pages[pages.length - 1] : null,
          section_title: String(x.p.point || '').slice(0, 60), content_summary: body.slice(0, 1500), snippet: body.slice(0, 1500),
          relevance_to_question: '按本题要点「' + String(x.p.point || '').slice(0, 60) + '」限定资料定向检索取回的原文。',
          source_kind: 'expected_point', ep_point_index: x.idx, ep_rank: rank, ep_similarity: Number(c.similarity) || 0 });
        trace.chunks += 1;
      });
    }
    if (deadline - Date.now() < 5000) break;
  }
}
return [{ json: { ep_points: points, ep_entries: entries.slice(0, 24), expected_point_trace: trace } }];
'''
