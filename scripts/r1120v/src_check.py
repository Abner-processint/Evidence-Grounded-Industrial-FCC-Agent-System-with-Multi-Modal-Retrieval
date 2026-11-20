# -*- coding: utf-8 -*-
"""BACKGROUND_SOURCE_VERIFY_V1：模型自述出处的书若在 RAGFlow 库里，按原文核对；原文完全支持的句子由 [K#] 改为正式引用 [E#]。构建脚本与离线试验共用。"""
from judge_prompt import JSYS  # noqa: F401  判定提示词（离线试验定稿）

PREP_JS = r'''// BACKGROUND_SOURCE_VERIFY_V1（11-18 用户：「要，先做这个」）：模型自述出处的书若在 RAGFlow 库里（如陈俊武《催化裂化工艺与工程》、Sadeghbeigi FCC Handbook），
// 按书名找到库里的文档，把该句限定在这本书里检索原文，交给下一步模型判定；原文完全支持的句子改为正式引用 [E#]，其余仍为 [K#]。
// 每份回答最多核对 6 句，并发 3，单次 25 秒、总共 45 秒；检索失败或超时的句子保持 [K#]。
__CFG__
const item = $input.first().json || {};
const helper = this;
const base = String(defaultBaseUrl || '').replace(/\/+$/, '');
const H = { Authorization: 'Bearer ' + defaultApiKey, 'Content-Type': 'application/json' };
const deadline = Date.now() + 45000;
const trace = { candidates: 0, checked: 0, errors: 0, matched_books: [] };
const call = async (o) => {
  const left = deadline - Date.now(); if (left < 3000) throw new Error('budget');
  return await helper.helpers.httpRequest(Object.assign({ json: true, timeout: Math.min(25000, left - 1000), headers: H, skipSslCertificateValidation: true }, o));
};
const norm = x => String(x || '').toLowerCase().replace(/\.(pdf|docx?|xlsx?|txt|md)$/i, '').replace(/[^0-9a-z一-龥]/g, '');
const books = Array.isArray(item.bg_books) ? item.bg_books : [];
const marks = Array.isArray(item.bg_marks) ? item.bg_marks : [];
let pairs = [];
if (books.length && marks.length && base) {
  try {
    // 库里全部数据集与文档名（每次几十毫秒）
    const dsr = await call({ method: 'GET', url: base + '/api/v1/datasets?page=1&page_size=100' });
    const datasets = (((dsr || {}).data) || []).map(d => ({ id: d.id, name: d.name }));
    const docs = [];
    for (const ds of datasets) {
      const r = await call({ method: 'GET', url: base + '/api/v1/datasets/' + ds.id + '/documents?page=1&page_size=500' });
      for (const d of ((((r || {}).data || {}).docs) || [])) docs.push({ id: d.id, name: d.name, ds: ds.id, ds_name: ds.name });
    }
    // 书名（去标点、小写）前 18 个字须出现在文档名里；书名太短（< 6 字）不认
    const bookDocs = books.map(b => {
      const t = norm(b.title); if (t.length < 6) return [];
      const k = t.slice(0, 18);
      return docs.filter(d => norm(d.name).indexOf(k) >= 0);
    });
    bookDocs.forEach((ds, i) => { if (ds.length) trace.matched_books.push(books[i].title); });
    const cands = [];
    for (const mk of marks) {
      const ns = String(mk.label || '').match(/\d+/g) || [];
      const hit = ns.map(n => bookDocs[Number(n) - 1] || []).find(x => x.length);
      if (hit) cands.push({ mk, docs: hit });
    }
    trace.candidates = cands.length;
    const todo = cands.slice(0, 6);
    for (let i = 0; i < todo.length; i += 3) {
      const batch = todo.slice(i, i + 3);
      const res = await Promise.all(batch.map(async c => {
        const dsId = c.docs[0].ds; const ids = c.docs.filter(d => d.ds === dsId).map(d => d.id);
        try {
          const r = await call({ method: 'POST', url: base + '/api/v1/retrieval', body: { question: String(c.mk.text || '').replace(/\[[EK]\d+\]/g, ''), dataset_ids: [dsId], document_ids: ids, page_size: 3, top_k: 64, keyword: true, similarity_threshold: 0.2, vector_similarity_weight: 0.3 } });
          const chunks = ((((r || {}).data || {}).chunks) || []).slice(0, 3).map(ch => ({ doc: ch.document_keyword || ch.docnm_kwd || '', ds_name: c.docs[0].ds_name, content: String(ch.content || '').replace(/\s+/g, ' ').trim().slice(0, 600),
            pages: Array.from(new Set((Array.isArray(ch.positions) ? ch.positions : []).map(p => Array.isArray(p) ? Number(p[0]) : NaN).filter(Number.isFinite))).sort((a, b) => a - b) }));
          trace.checked += 1;
          return { mk: c.mk, chunks };
        } catch (e) { trace.errors += 1; return null; }
      }));
      pairs = pairs.concat(res.filter(x => x && x.chunks.length));
      if (deadline - Date.now() < 5000) break;
    }
  } catch (e) { trace.errors += 1; }
}
const lines = [];
pairs.forEach((p, i) => {
  lines.push('S' + (i + 1) + '：' + String(p.mk.text || '').replace(/\[[EK]\d+\]/g, ''));
  p.chunks.forEach((c, j) => lines.push('  C' + (j + 1) + '（' + c.doc + '）：' + c.content));
});
return [{ json: { ...item, src_check_pairs: pairs, src_check_trace: trace,
  src_check_user: pairs.length ? lines.join('\n') : '没有需要核对的句子。输出 {"results":[]}' } }];
'''

APPLY_JS = r'''// BACKGROUND_SOURCE_VERIFY_V1：判为 full、且 quote 去空白后确实出现在所选原文里的句子，把句末 [K#] 换成新的 [E#]，并在「数据依据」末尾补上原文摘录；
// 其余保持 [K#]。最后按正文先后把剩下的 K 重新编号、重建「背景知识出处」一节。模型失败或无法解析时原样放行。
const base = $('Prepare Source Check').first().json || {};
const full = String(base.output || '');
const trace = Object.assign({}, base.src_check_trace || {}, { verified: 0, parse_ok: false });
let raw = '';
try { const j = $input.first().json || {}; raw = String(j.output || j.text || ''); } catch (e) {}
let results = [];
try { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); const o = JSON.parse(raw.slice(a, b + 1)); results = Array.isArray(o.results) ? o.results : []; trace.parse_ok = true; } catch (e) {}
const pairs = Array.isArray(base.src_check_pairs) ? base.src_check_pairs : [];
const books = Array.isArray(base.bg_books) ? base.bg_books : [];
// 正文 / 原有附录 / 背景知识出处一节分开
const bgHead = '\n\n#### 背景知识出处';
let rest = full; let bgOld = '';
const bi = full.indexOf(bgHead); if (bi >= 0) { rest = full.slice(0, bi); bgOld = full.slice(bi); }
const m = /(^|\n)####\s/.exec(rest); const cut = m ? m.index : rest.length;
let body = rest.slice(0, cut); let tail = rest.slice(cut);
const sq = x => String(x || '').replace(/\s+/g, '');
let maxE = 0; for (const mm of full.match(/\[E(\d+)\]/g) || []) maxE = Math.max(maxE, Number(mm.slice(2, -1)));
for (const mm of full.match(/\*\*E(\d+)\*\*/g) || []) maxE = Math.max(maxE, Number(mm.replace(/\D/g, '')));
const entries = [];
for (const r of results) {
  const k = Number(String((r && r.s) || '').replace(/\D/g, '')) - 1; const p = pairs[k];
  if (!p || String(r.verdict || '').toLowerCase() !== 'full') continue;
  const ci = Number(String(r.chunk || '').replace(/\D/g, '')) - 1; const ch = p.chunks[ci];
  if (!ch || sq(r.quote).length < 8 || sq(ch.content).indexOf(sq(r.quote)) < 0) continue;
  const st = String(p.mk.text || '').replace(/[。！？；]\s*$/, '');
  const key = st + ' ' + p.mk.label;
  if (body.split(key).length !== 2) continue;
  maxE += 1;
  body = body.replace(key, () => st + ' [E' + maxE + ']');
  const pages = Array.isArray(ch.pages) && ch.pages.length ? '\n  - 页码: 第 ' + (ch.pages.length > 1 ? ch.pages[0] + '-' + ch.pages[ch.pages.length - 1] : ch.pages[0]) + ' 页' : '';
  entries.push('- **E' + maxE + '**\n  - 文档: ' + ch.doc + '\n  - 数据集: ' + (ch.ds_name || '') + '\n  - Chunk Reference: background source check' + pages +
    '\n  - 摘录: ' + ch.content + '\n  - 答案用途: ' + st + '（模型自述出处的书，经原文核对）');
  trace.verified += 1;
}
if (entries.length) {
  const di = tail.indexOf('#### 数据依据');
  if (di >= 0) {
    const nx = tail.indexOf('\n#### ', di + 5);
    const end = nx >= 0 ? nx : tail.length;
    tail = tail.slice(0, end).replace(/\s+$/, '') + '\n\n' + entries.join('\n\n') + '\n' + tail.slice(end);
  } else {
    tail = tail.replace(/\s+$/, '') + '\n\n#### 数据依据\n' + entries.join('\n\n') + '\n';
  }
}
// 剩下的 K 按正文先后重新编号，重建「背景知识出处」
const order = []; for (const mm of body.match(/\[K(\d+)\]/g) || []) { const n = Number(mm.slice(2, -1)); if (order.indexOf(n) < 0) order.push(n); }
const remap = new Map(order.map((n, i) => [n, i + 1]));
body = body.replace(/\[K(\d+)\]/g, (s0, n) => (remap.has(Number(n)) ? '[K' + remap.get(Number(n)) + ']' : ''));
let bg = '';
if (order.length && books.length) {
  const isEn = x => /^[\x00-\x7F]+$/.test(x);
  const lines = order.map((n, i) => { const b = books[n - 1] || {}; return '- [K' + (i + 1) + '] ' + (isEn(b.title || '') ? b.title : '《' + (b.title || '') + '》') +
    [b.author, b.publisher, b.year].filter(Boolean).map(x => '，' + x).join('') + ((b.chapters || []).length ? '，' + b.chapters.slice(0, 3).join('；') : '') + '（模型把握：' + (b.high ? '高' : '中') + '）'; });
  bg = '\n\n#### 背景知识出处（模型自带的化工炼油背景知识；出处为模型自述，未经原文核对）\n' + lines.join('\n');
} else if (bgOld && !order.length) { bg = ''; } else { bg = bgOld; }
const out = body + tail.replace(/\s+$/, '') + bg;
const { src_check_pairs, src_check_user, bg_marks, bg_books, ...keep } = base;
return [{ json: { ...keep, output: out, background_source_verify: trace } }];
'''
