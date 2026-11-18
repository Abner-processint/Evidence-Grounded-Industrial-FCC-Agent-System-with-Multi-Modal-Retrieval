# -*- coding: utf-8 -*-
r"""r1109：「能算没算」两处修改，在测试副本上验证。
① POINT_SERIES_STATS_V1：合计量（知识库 / DCS 两步选位号的几表相加）与计算量，逐点读数后由代码算最小、最大、最新、逐点均值，速率量另算全时段累计。
   改 Apply DCS Tag Pick、Compute Derived Quantities、Append Factor Resolution Result。
② MISSING_ITEM_SYMBOL_V1：定义模型给每个缺项写它指的是公式里哪个变量（symbol），查到可用数据的变量不再当缺项挡住计算；没写 symbol 的照旧按名称比。
   改 Derived Quantity LLM（提示词末尾加一条）、Apply Derived Quantities（保留 symbol）、Prepare Derived Binding（按 symbol 判）。
底版：主线已发布 a833d14e。python r1109_build.py <main.json> <out_nodes.json>"""
import json, sys, io, os
HERE = os.path.dirname(os.path.abspath(__file__))
src = json.load(io.open(sys.argv[1], encoding='utf-8'))
assert src['activeVersionId'].startswith('a833d14e'), src['activeVersionId']
av = src['activeVersion']
N = {n['name']: n for n in av['nodes']}
lib = io.open(os.path.join(HERE, 'ps_lib.js'), encoding='utf-8').read()


def rep(code, old, new, name):
    assert code.count(old) == 1, (name, code.count(old), old[:80])
    return code.replace(old, new)


# ---------- ① Apply DCS Tag Pick ----------
n = N['Apply DCS Tag Pick']; c = n['parameters']['jsCode']
anchor = "return [{ json: { ...base, factor_results: results,"
block = r"""// POINT_SERIES_STATS_V1：直接要的量（知识库 / DCS 两步选位号，不是计算量的构成量）每组位号逐点相加，
// 写出该组自己的最小、最大、最新与累计（单块表只在速率量时写累计）。取不到逐点读数时写明没算，不说「未检索到」。
{
  const __psUnitOf = p => {
    const r = results.find(x => fid(x) === p.factor_id) || {}, e = p.kb ? __kbE.find(x => asString(x.id) === p.kb) : null;
    return asString(e && e.unit) || asString(asObject(r.factor).unit);
  };
  const __psUse = picks.filter(p => p.why !== 'derived_component' && p.kept.length && (p.kept.some(a => a.tags.length > 1) || !!__psRateUnit(__psUnitOf(p))));
  const __psCols = Array.from(new Set(__psUse.flatMap(p => p.kept.flatMap(a => a.tags)))).map(t => t + '.PV');
  if (__psCols.length && __psCols.length <= 24 && dateRange.length === 2) {
    let ser;
    try { ser = await __psSeries(this.helpers, __psCols, dateRange); } catch (e) { ser = { error: String(e && e.message || e).slice(0, 160) }; }
    for (const p of __psUse) {
      const r = results.find(x => fid(x) === p.factor_id);
      if (!r) continue;
      if (ser.error) { r.sum_series_note = '逐点读数没取到（' + ser.error + '），合计的最小、最大、累计本轮没算'; continue; }
      const unit = __psUnitOf(p);
      r.sum_series = p.kept.map(a => {
        const cols = a.tags.map(t => t + '.PV');
        const st = __psStats(ser, rec => { if (!rec) return NaN; let s = 0; for (const k of cols) { const v = rec[k]; if (typeof v !== 'number' || !Number.isFinite(v)) return NaN; s += v; } return s; }, unit, null);
        return { tags: a.tags, unit, stats: st };
      });
      r.sum_series_note = r.sum_series.filter(x => x.stats && (x.tags.length > 1 || x.stats.cumulative != null)).map(x => x.tags.length > 1
        ? x.tags.join('+') + ' 合计（' + x.unit + '）' + __psText(x.stats)
        : x.tags[0] + ' 按' + x.stats.resolution + '逐点累计全时段 ' + x.stats.cumulative + ' ' + x.stats.cumulative_unit + '（' + x.stats.points + ' 个时刻，只计有数的时刻）').join('；');
    }
  }
}
"""
c = rep(c, anchor, block + anchor, 'ADTP')
n['parameters']['jsCode'] = lib + "\n" + c

# ---------- ① Compute Derived Quantities ----------
n = N['Compute Derived Quantities']; c = n['parameters']['jsCode']
anchor = "const { derived_binding_packet, derived_definitions, ...rest } = prep;"
block = r"""// POINT_SERIES_STATS_V1：按时段均值算出的计算量，另用同一组位号逐点代入同一公式，给出该量自己的最小、最大、最新、逐点均值（速率量另给累计）。
// 结论值仍是时段均值代入（比值类即累计量之比）；逐点结果超出该量定义范围的时刻不计入并计数。含单位换算的输入不逐点算（只换算过均值）。
{
  const __need = out.filter(d => d.status === 'computed' && d.method === 'period_mean_substitution');
  const __conv = new Set();
  for (const pq of asArray(pkt.quantities).map(asObject)) for (const pv of asArray(pq.variables).map(asObject))
    for (const cd of asArray(pv.candidates).map(asObject)) if (cd.unit_converted_from) __conv.add(asString(cd.tag));
  const __cols = Array.from(new Set(__need.flatMap(d => asArray(d.results).flatMap(r => asArray(r.inputs).flatMap(i => asArray(i.tags))))));
  const __dr = asArray(pkt.date_range);
  if (__need.length && __cols.length && __cols.length <= 24 && __dr.length === 2) {
    let ser;
    try { ser = await __psSeries(this.helpers, __cols, __dr); } catch (e) { ser = { error: String(e && e.message || e).slice(0, 160) }; }
    for (const d of __need) {
      const def = asObject(asObject(prep.derived_definitions)[d.derived_id]);
      const b = asArray(def.result_bounds).map(Number);
      const hb = b.length === 2 && b.every(Number.isFinite) ? b : null;
      const env0 = {};
      for (const k of asArray(d.constants)) env0[k.symbol] = Number(k.value);
      for (const r of asArray(d.results)) {
        if (ser.error) { r.point_series_error = ser.error; continue; }
        if (asArray(r.inputs).some(i => asArray(i.tags).some(t => __conv.has(t)))) { r.point_series_error = '输入含单位换算，未逐点计算'; continue; }
        const st = __psStats(ser, rec => {
          if (!rec) return NaN;
          const env = { ...env0 };
          for (const i of asArray(r.inputs)) { let s = 0; for (const t of asArray(i.tags)) { const v = rec[t]; if (typeof v !== 'number' || !Number.isFinite(v)) return NaN; s += v; } env[i.symbol] = s; }
          try { return evaluate(d.expression, env); } catch (e) { return NaN; }
        }, d.result_unit, hb);
        if (st) r.point_series = st; else r.point_series_error = '没有输入齐全的时刻';
      }
    }
  }
}
"""
c = rep(c, anchor, block + anchor, 'CDQ')
n['parameters']['jsCode'] = lib + "\n" + c

# ---------- ① Append Factor Resolution Result ----------
n = N['Append Factor Resolution Result']; c = n['parameters']['jsCode']
old = "    asString(row.kb_note),  // PLANT_KB_FE_AND_DIRECT_V1：知识库口径写在量名之后，不被截短\n"
c = rep(c, old, old + "    asString(row.sum_series_note),  // POINT_SERIES_STATS_V1：几表合计逐点算出的最小、最大、最新、累计，紧跟知识库口径\n", 'AFR1')
old = "      (point ? ' @ '+asArray(i.timestamps).join(',') : '')).join('; ')+' → '+r.value_rounded);"
new = ("      (point ? ' @ '+asArray(i.timestamps).join(',') : '')).join('; ')+' → '+r.value_rounded+\n"
       "    // POINT_SERIES_STATS_V1：同一取法逐点代入的最小、最大、最新、累计\n"
       "    (r.point_series ? '（'+__psText(r.point_series)+'）' : r.point_series_error ? '（逐点未算：'+r.point_series_error+'）' : ''));")
c = rep(c, old, new, 'AFR2')
fn = lib[lib.index('function __psText'):]
c = rep(c, "const __derivedLines = __derivedResults.map(d => {", fn + "\nconst __derivedLines = __derivedResults.map(d => {", 'AFR3')
n['parameters']['jsCode'] = c

# ---------- ② Derived Quantity LLM ----------
n = N['Derived Quantity LLM']; sm = n['parameters']['options']['systemMessage']
assert 'MISSING_ITEM_SYMBOL_V1' not in sm
sm = sm.rstrip('\n') + ("\n\nMISSING_ITEM_SYMBOL_V1\nWrite each missing item as an object {\"name\": \"...\", \"symbol\": \"...\"}. "
                        "symbol is the symbol of this definition's own variable that the item is about, for example a flow or temperature that has not been retrieved yet; "
                        "use null when the item is not one of this definition's variables (for example a design dimension or a stream property for which the definition has no variable). "
                        "After this step the workflow looks up every variable and decides from the lookup result whether an item is still missing, so naming the variable is required, not optional.\n")
n['parameters']['options']['systemMessage'] = sm

# ---------- ② Apply Derived Quantities ----------
n = N['Apply Derived Quantities']; c = n['parameters']['jsCode']
old = "    missing: asArray(raw.missing).map(m => typeof m === 'string' ? m : asString(asObject(m).name || asObject(m).input)).filter(Boolean),\n"
new = old + ("    // MISSING_ITEM_SYMBOL_V1：缺项指向本定义哪个变量（模型给的 symbol）原样留下，Prepare Derived Binding 按该变量查到没有来判；展开过依赖的定义缺项已是文字，没有这一项\n"
             "    missing_symbols: asArray(raw.missing).filter(m => m && typeof m === 'object' && !Array.isArray(m) && Object.prototype.hasOwnProperty.call(m, 'symbol'))\n"
             "      .map(m => ({ name: asString(m.name || m.input), symbol: m.symbol == null ? null : asString(m.symbol) })).filter(m => m.name),\n")
c = rep(c, old, new, 'ADQ')
n['parameters']['jsCode'] = c

# ---------- ② Prepare Derived Binding ----------
n = N['Prepare Derived Binding']; c = n['parameters']['jsCode']
old = "  const unresolvedMissing = declaredMissing.filter(m => !resolvedVars.some(v => names(m, v)));\n"
new = ("  // MISSING_ITEM_SYMBOL_V1：缺项带 symbol 且是本定义的变量时，按该变量有没有查到可用数据判（与上面数据、单位、同类核对同一结果）；\n"
       "  // symbol 为 null（模型说明不是公式变量，如设计尺寸）照旧挡住；没给 symbol 或 symbol 不在变量里的，仍按原来的名称比较。\n"
       "  // 来由：194684 首轮「Missing inputs: diesel product flow (FT3231/FRC3214), fresh feed flow」两项都已查到，名称写法与因子名不同没比上，柴油收率首轮未算；\n"
       "  // 191901 汽油收率、转化率同一原因整题没算，证据里却又写着柴油收率 21.45。\n"
       "  const __msym = new Map(asArray(d.missing_symbols).map(asObject).map(m => [asString(m.name), m.symbol == null ? null : asString(m.symbol)]));\n"
       "  const __vsyms = new Set(asArray(d.variables).map(asObject).map(v => asString(v.symbol)));\n"
       "  const unresolvedMissing = declaredMissing.filter(m => {\n"
       "    if (__msym.has(m)) { const s = __msym.get(m); if (s === null) return true; if (__vsyms.has(s)) return !resolvedVars.some(v => asString(v.symbol) === s); }\n"
       "    return !resolvedVars.some(v => names(m, v));\n"
       "  });\n")
c = rep(c, old, new, 'PDB')
n['parameters']['jsCode'] = c

CHANGED = ['Append Factor Resolution Result', 'Apply DCS Tag Pick', 'Apply Derived Quantities', 'Compute Derived Quantities', 'Derived Quantity LLM', 'Prepare Derived Binding']
json.dump({'nodes': av['nodes'], 'connections': av['connections'], 'changed': CHANGED}, io.open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print('ok', CHANGED)
