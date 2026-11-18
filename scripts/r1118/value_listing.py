# -*- coding: utf-8 -*-
"""r1118 节点内容：VALUE_CONFLICT_LISTING_V1（同一位号 / 设备的规定值资料里有多个，回答只写了一个时，由代码并列写出另一来源的值）。
来由：11-17 预验收基线 19 道前后矛盾题里约 5 道是「资料本身多个值、两次各取一个」（两次证据里两个值都在）：R10 TIA3216 报警值、Q06 WRCA3101 HH、R06 DR3110 量程等。
离线（accept/value_bench.py v2，基线 68 份）：报 9 份 15 条，人工看约 13 条真。"""

XSYS = ('从催化裂化问答系统的回答正文里抽出本装置的关键取值：必须是本装置某个位号或某台设备的规定值或参数，如报警值 / 联锁值 / 控制指标 / 工艺卡片范围 / 量程 / 设计参数 / 标高 / 设定值。'
        '不要列：实测统计值（均值、最大最小、最新值、样本数）、由回答自己计算出的结果、教材或通识资料里的一般数值与算例、公式系数。每条：object（必须含位号或设备号，如「WRCA3101」「R1104」）、'
        'attribute（属性，如「HH 报警」「工艺卡片范围」「量程」）、value（回答原文里的数值写法，逐字复制，带单位）、cited（该句引用的 E 编号）、terms（2–4 个检索词：位号、设备号必须在内）。最多 15 条。'
        '只输出 JSON：{"values":[{"object":"","attribute":"","value":"","cited":["E1"],"terms":[""]}]}')
JSYS = ('判断资料片段里是否给出与回答不同的取值：同一位号或设备、同一属性（同一档报警、同一种指标），数值不同。以下都不算不同：不同工况或步骤（开工、停工、恢复开工、事故处理里的临时值 vs 正常操作值）、不同时段、'
        '不同档位（H 与 HH）、控制目标 / 控制范围 / 工艺卡片指标与报警值（属性不同）、不同设备或位号、实测统计值、教材算例或其他装置的数、单位换算后相同、回答的值本身也在该片段里且片段另一个值属于别的属性。'
        '对每条回答取值输出：{"i":序号,"conflict":true|false,"other_value":"另一个值（带单位）","source":"片段的文档名","evidence_id":"E编号","quote":"片段原文 ≤60 字"}。'
        '只输出 JSON：{"results":[...]}')

PREP_JS = r'''// VALUE_CONFLICT_LISTING_V1（11-17）：「回答与回答之间不能有矛盾」。同一位号 / 设备的规定值（报警、联锁、量程、工艺卡片、设计参数）资料里有多个时，
// 回答只写一个，下一轮检索到另一份资料就写另一个（基线 R10 TIA3216 报警值、R06 DR3110 量程）。按「冲突全部列出」，由代码在原值后并列另一来源的值。
// 本节点准备抽取模型输入（只看正文，第一个「#### 」附录之前）。
const item = $input.first().json || {};
const full = String(item.output || '');
const m = /(^|\n)####\s/.exec(full);
const body = full.slice(0, m ? m.index : full.length);
return [{ json: { ...item, value_check_needed: body.trim().length >= 200, value_extract_user: body.trim().length >= 200 ? body.slice(0, 14000) : '（无正文）' } }];
'''

SEARCH_JS = r'''// VALUE_CONFLICT_LISTING_V1：按抽出的位号 / 设备检索词，在本轮给写回答模型的全部证据（Compact Result Projector 的证据包，不限于回答引用的那几条）里找片段，交判定模型。
// 回答里的 [E#] 是 Code in JavaScript 重编后的显示编号（evidence_display_id_map：原编号 → 显示编号）；证据没被回答引用的没有显示编号，判定结果里只写文档名。
const base = $('Prepare Value Check').first().json || {};
const pj = t => { try { const s = String(t || ''); return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch (e) { return null; } };
let raw = ''; try { const j = $input.first().json || {}; raw = String(j.output || j.text || ''); } catch (e) {}
const vals = (((pj(raw) || {}).values) || []).filter(v => v && v.value).slice(0, 15);
let packet = [], dmap = {};
try { packet = ($('Compact Result Projector').last().json || {}).evidence_packet || []; } catch (e) {}
try { dmap = ($('Code in JavaScript').last().json || {}).evidence_display_id_map || {}; } catch (e) {}
const texts = packet.map(x => ({ id: dmap[x.evidence_id] || '', doc: String(x.document_name || x.dataset_name || ''),
  t: String([x.snippet, x.content_summary, typeof x.key_values === 'string' ? x.key_values : JSON.stringify(x.key_values || '')].join(' ')).replace(/<[^>]+>/g, ' | ').replace(/\s+/g, ' ') }));
const blocks = [];
vals.forEach((v, i) => {
  const terms = (Array.isArray(v.terms) ? v.terms : []).map(String).filter(Boolean).slice(0, 5);
  const hits = [];
  for (const x of texts) {
    const sc = terms.filter(w => x.t.includes(w)).length; if (!sc) continue;
    const w0 = terms.find(w => x.t.includes(w)); const k = x.t.indexOf(w0);
    hits.push({ sc, id: x.id, doc: x.doc, s: x.t.slice(Math.max(0, k - 160), k + 160) });
  }
  hits.sort((a, b) => b.sc - a.sc);
  if (!hits.length) return;
  blocks.push('【' + i + '】回答：' + v.object + ' 的 ' + v.attribute + ' = ' + v.value + '（引用 ' + (v.cited || []).join(',') + '）\n' +
    hits.slice(0, 6).map(h => '  - [' + (h.id || '未引用') + ']《' + h.doc.slice(0, 30) + '》…' + h.s + '…').join('\n'));
});
const needed = Boolean(base.value_check_needed && blocks.length);
return [{ json: { ...base, value_candidates: vals, value_judge_needed: needed, value_judge_user: needed ? blocks.join('\n\n').slice(0, 18000) : '（无）' } }];
'''

APPLY_JS = r'''// VALUE_CONFLICT_LISTING_V1：判定为「同一对象同一属性、资料另有不同值」的，在回答原值后插入「（另有来源《文档》[E#] 给出 Y）」；
// 只改正文；原值在正文里找不到、或旁边已写了另一个值的跳过；每份回答至多 6 处；模型失败原样放行。
const base = $('Search Value Snippets').first().json || {};
const pj = t => { try { const s = String(t || ''); return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch (e) { return null; } };
const full = String(base.output || '');
const m = /(^|\n)####\s/.exec(full); const cut = m ? m.index : full.length;
let body = full.slice(0, cut); const tail = full.slice(cut);
const trace = { candidates: (base.value_candidates || []).length, conflicts: 0, inserted: 0, skipped: [] };
let raw = ''; try { const j = $input.first().json || {}; raw = String(j.output || j.text || ''); } catch (e) {}
const res = base.value_judge_needed ? (((pj(raw) || {}).results) || []).filter(r => r && r.conflict === true) : [];
trace.conflicts = res.length;
const tagOf = s => (String(s || '').match(/[A-Z]{1,6}\d{3,5}[A-Z]?(?:_\d)?/) || [''])[0];
for (const r of res.slice(0, 6)) {
  const v = (base.value_candidates || [])[r.i]; if (!v) continue;
  const val = String(v.value || '').trim(), other = String(r.other_value || '').trim();
  if (!val || !other || val.replace(/\s/g, '') === other.replace(/\s/g, '')) { trace.skipped.push('same:' + val); continue; }
  const tag = tagOf(v.object);
  let pos = -1, from = 0;
  while ((from = body.indexOf(val, from)) >= 0) {
    if (!tag || body.slice(Math.max(0, from - 120), from).includes(tag)) { pos = from; break; }
    from += val.length;
  }
  if (pos < 0) pos = body.indexOf(val);
  if (pos < 0) { trace.skipped.push('notfound:' + val); continue; }
  const end = pos + val.length;
  if (body.slice(end, end + 80).includes(other)) { trace.skipped.push('already:' + val); continue; }
  const src = String(r.source || '').slice(0, 40), eid = /^E\d+$/.test(String(r.evidence_id || '')) && String(r.evidence_id) !== '未引用' ? '[' + r.evidence_id + ']' : '';
  const ins = '（另有来源' + (src ? '《' + src + '》' : '') + eid + '给出 ' + other + '）';
  body = body.slice(0, end) + ins + body.slice(end);
  trace.inserted += 1;
}
const { value_extract_user, value_judge_user, ...rest } = base;
return [{ json: { ...rest, output: body + tail, value_conflict_listing: trace } }];
'''
