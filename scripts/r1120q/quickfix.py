# -*- coding: utf-8 -*-
"""三件快修（11-19 用户「先做三个快修」；来源：讨论稿_未修问题_GPT6.2与Gemini4_20261119.md 两边一致意见）。构建脚本与单测共用。"""

ROUTE_JS = r'''
// PERIOD_REPORT_ROUTING_V1（快修 1）：月报按期次用 document_ids 限定——本轮完整问句写了年月就查那几个月的月报（区间展开，最多取 4 个月），
// 没写时段就查最新一期，只写年份不写月份的不定向。来由：QS 题评分默认最新一期（2026 年 6 月），回答常引 2023 年旧月报（40 份只有 10 份提到 2026 年 6 月）。
// REGULATION_DOC_VARIANT_V1（快修 2）：同一问句再限定在《操作规程》各册里查一次，使规程里的控制指标、限值与本题相关段落进入候选（按位号的结构化指标表另做）。
// 只增加查询、不改原有写法；列文档或解析失败时不加。
const __MONTHLY_DS = '1877d018f6f311f0a7b933d55f4fdf13', __STATIC_DS = '18b63458f6f211f0a7b933d55f4fdf13';
function __periodMonths(q) {
  let months = []; let m;
  const rng = /(\d{4})\s*年\s*(\d{1,2})\s*月?\s*(?:至|到|~|～|－|—|-)\s*(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月/g;
  while ((m = rng.exec(q))) {
    let y = +m[1], mo = +m[2]; const y2 = m[3] ? +m[3] : y, mo2 = +m[4];
    for (let k = 0; k < 36 && y * 100 + mo <= y2 * 100 + mo2; k += 1) { months.push(y * 100 + mo); mo += 1; if (mo > 12) { mo = 1; y += 1; } }
  }
  const one = /(\d{4})\s*年\s*(\d{1,2})\s*月/g;
  while ((m = one.exec(q))) months.push(+m[1] * 100 + +m[2]);
  months = Array.from(new Set(months)).filter(x => x % 100 >= 1 && x % 100 <= 12).sort((a, b) => a - b);
  if (months.length > 4) months = [months[0], months[Math.floor(months.length / 3)], months[Math.floor(2 * months.length / 3)], months[months.length - 1]];
  return { months, yearOnly: !months.length && /\d{4}\s*年/.test(q) };
}
async function __routedVariants(params, raw, baseUrl, headers, verifySsl) {
  try {
    const dsIds = Array.isArray(params.dataset_ids) ? params.dataset_ids.map(String) : [];
    const wantMonthly = !dsIds.length || dsIds.includes(__MONTHLY_DS);
    const wantReg = !dsIds.length || dsIds.includes(__STATIC_DS);
    if (!wantMonthly && !wantReg) return [];
    const plain = raw.find(v => v && /plain|single/.test(String(v.lang_variant || v.variant_id || ''))) || raw[0] || {};
    const q = String(plain.question || params.question || '').trim();
    if (!q) return [];
    const base = baseUrl.replace(/\/+$/, '');
    const list = async ds => {
      const r = await helperContext.helpers.httpRequest({ method: 'GET', url: base + '/api/v1/datasets/' + ds + '/documents?page=1&page_size=500', headers, json: true, timeout: 8000, skipSslCertificateValidation: !verifySsl });
      return ((((r || {}).data || {}).docs) || []).map(d => ({ id: d.id, name: String(d.name || '') }));
    };
    const out = [];
    if (wantMonthly) {
      const docs = (await list(__MONTHLY_DS)).map(d => { const mm = d.name.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/); return mm ? Object.assign({}, d, { ym: +mm[1] * 100 + +mm[2] }) : null; }).filter(Boolean);
      const pm = __periodMonths(q);
      let pick = [];
      if (pm.months.length) pick = docs.filter(d => pm.months.includes(d.ym));
      else if (!pm.yearOnly && docs.length) { const top = Math.max(...docs.map(d => d.ym)); pick = docs.filter(d => d.ym === top); }
      pick = pick.slice(0, 6);
      if (pick.length) out.push({ question: q, variant_id: 'period_report_routed', lang_variant: 'period_report_routed', dataset_ids: [__MONTHLY_DS], document_ids: pick.map(d => d.id) });
    }
    if (wantReg) {
      const reg = (await list(__STATIC_DS)).filter(d => /规程/.test(d.name));
      if (reg.length) out.push({ question: q, variant_id: 'regulation_routed', lang_variant: 'regulation_routed', dataset_ids: [__STATIC_DS], document_ids: reg.map(d => d.id) });
    }
    return out;
  } catch (e) { return []; }
}
'''

SCOPE_JS = r'''// DATA_SCOPE_STATEMENT_V1（快修 3）：按本轮实际执行的步骤，由代码在正文末尾写一句取数口径（是否调用历史实时库 / LIMS、原因）。
// 放在「去掉没有」与出处核对之后，免得被删改。没有安排任何实时库取数的写「不针对具体时段、未调用」；取到了的写明取自实时库及时段；
// 安排了取数但没取到的不写这句（不说「没有」）。来由：QS 题每题都有这一项分，40 份回答一份都没写。
const item = $input.first().json || {};
let epb = {};
try { epb = $('Evidence Packet Builder').first().json || {}; } catch (e) {}
const units = Array.isArray(epb.completed_units) ? epb.completed_units : [];
const isData = t => /^(arctic_|mongo_)/.test(t) && t !== 'mongo_find_tags';
const dataUnits = units.filter(u => isData(String((u && u.tool) || '')));
const okData = dataUnits.filter(u => String((u && u.execution_status) || '').toUpperCase() === 'SUCCESS');
const findRange = o => {
  const seen = new Set(); const stack = [o];
  while (stack.length) {
    const x = stack.pop(); if (!x || typeof x !== 'object' || seen.has(x)) continue; seen.add(x);
    for (const k of ['date_range', 'time_range', 'returned_time_ranges']) {
      const v = x[k];
      if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'string' && typeof v[1] === 'string') return String(v[0]).slice(0, 10) + ' 至 ' + String(v[1]).slice(0, 10);
    }
    for (const v of Object.values(x)) if (v && typeof v === 'object') stack.push(v);
  }
  return '';
};
let line = '';
if (!dataUnits.length) {
  line = '取数口径：本题问的是机理、规律与操作经验，不针对某一具体时段或批次，回答依据检索到的装置文档与通识资料，未调用历史实时库和 LIMS 化验数据；若要判断某一时段的实际工况，需调取对应时段的实时趋势与化验数据。';
} else if (okData.length) {
  const rg = (Array.isArray(epb.factor_resolution_date_range) && epb.factor_resolution_date_range.length >= 2)
    ? String(epb.factor_resolution_date_range[0]).slice(0, 10) + ' 至 ' + String(epb.factor_resolution_date_range[1]).slice(0, 10) : findRange(okData);
  line = '取数口径：本题的实测数据取自历史实时库' + (rg ? '（' + rg + '）' : '') + '，其余依据检索到的装置文档资料；未调用 LIMS 化验数据。';
}
const full = String(item.output || '');
const m = /(^|\n)####\s/.exec(full);
const cut = m ? m.index : full.length;
const body = full.slice(0, cut).replace(/\s+$/, ''); const tail = full.slice(cut);
const out = (line && body && body.indexOf('取数口径：') < 0) ? body + '\n\n' + line + '\n' + (tail ? '\n' + tail.replace(/^\n+/, '') : '') : full;
return [{ json: { ...item, output: out, data_scope_statement: line || null } }];
'''
