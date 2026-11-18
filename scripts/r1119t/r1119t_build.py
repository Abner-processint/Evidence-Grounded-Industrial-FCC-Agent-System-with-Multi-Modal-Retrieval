# -*- coding: utf-8 -*-
"""r1119t：THRESHOLD_TABLE_TIE_V1——阈值比对三处修正（11-18 追查 R10，副本 exec 204278）。
① Evidence Packet Builder：证据表格几套报警定值行数相同（无唯一多数）时，原先整套放弃、也不记冲突（TIA3216 三套各 1 行 → 登记为空、无比对）；
   改为逐档列出各套取值：只有一个取值的档位照常登记，取值不同的记为冲突（带各取值的出处表名），比对句对每个取值各给一次判断；出处写「取自证据表格、几套行数相同未择一」。
② Evidence Packet Builder：比对行排序——对话已给过阈值的在前（原有），其次本轮主分析读到的位号（时序统计 / 全时段分析），因子解析附带读到的在后（只留前 2 行，原先所问位号可能被挤掉）。
③ 出处措辞：Answer Finalizer LLM「本次对话中已确认的阈值」改为「阈值与确定性比对」，说明 computed 条目按条目写明的出处写、只适用于它写明的位号；
   Compose Guard 置顶比对段前缀不再写「按本次对话已给出的阈值」。
用法：python r1119t_build.py <in.json> <out.json>"""
import sys, io, json
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
MARK = 'THRESHOLD_TABLE_TIE_V1'


def rep(code, old, new, cnt=1):
    assert code.count(old) == cnt, (old[:80], code.count(old))
    return code.replace(old, new)


# ---------- Evidence Packet Builder ----------
p = N['Evidence Packet Builder']['parameters']; c = p['jsCode']; assert MARK not in c
c = rep(c, """    const addStat = (col, mn, mx, range) => {
      const c = String(col || '').trim(); if (!c) return;
      const lo = Number(mn), hi = Number(mx);
      if (!Number.isFinite(lo) && !Number.isFinite(hi)) return;
      if (!measured.has(c)) measured.set(c, { column: c, rows: [] });
      measured.get(c).rows.push({ min: lo, max: hi, range: range || '' });
    };""", """    // THRESHOLD_TABLE_TIE_V1：primary = 本轮主分析（时序统计 / 全时段分析）读到的列；因子解析附带读到的为 false
    const addStat = (col, mn, mx, range, primary) => {
      const c = String(col || '').trim(); if (!c) return;
      const lo = Number(mn), hi = Number(mx);
      if (!Number.isFinite(lo) && !Number.isFinite(hi)) return;
      if (!measured.has(c)) measured.set(c, { column: c, rows: [], primary: false });
      measured.get(c).rows.push({ min: lo, max: hi, range: range || '' });
      if (primary) measured.get(c).primary = true;
    };""")
c = rep(c, "        addStat(r.column, r.min, r.max, __rr || range);\n", "        addStat(r.column, r.min, r.max, __rr || range, true);\n")
c = rep(c, "for (const [col, st] of Object.entries(asObject(raw.column_stats))) { const r = asObject(st); addStat(col, r.min, r.max, range); }",
        "for (const [col, st] of Object.entries(asObject(raw.column_stats))) { const r = asObject(st); addStat(col, r.min, r.max, range, true); }")
c = rep(c, "        addStat(r.tag || r.column, r.min, r.max, asArray(r.time_range).map(String).join(' 至 ') || range);\n",
        "        addStat(r.tag || r.column, r.min, r.max, asArray(r.time_range).map(String).join(' 至 ') || range, false);\n")
c = rep(c, """      if (stored && now) return now.total_rows > stored.total_rows ? now : stored;
      return stored || now;
    };
""", """      if (stored && now) return now.total_rows > stored.total_rows ? now : stored;
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
      if (ranked.length < 2 || ranked[0].count > ranked[1].count) return null;
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
""")
c = rep(c, """      const tset = tableSetFor(key);
      const labels = new Set(Object.keys(storedVals));
      for (const vk of __cand.keys()) if (vk.indexOf(key + '|') === 0) labels.add(vk.slice(key.length + 1));
      if (tset) for (const l of Object.keys(tset.values)) labels.add(l);
""", """      const tset = tableSetFor(key);
      const ttie = tset ? null : tableTieFor(key); // THRESHOLD_TABLE_TIE_V1
      const labels = new Set(Object.keys(storedVals));
      for (const vk of __cand.keys()) if (vk.indexOf(key + '|') === 0) labels.add(vk.slice(key.length + 1));
      if (tset) for (const l of Object.keys(tset.values)) labels.add(l);
      if (ttie) for (const l of Object.keys(ttie.byLabel)) labels.add(l);
""")
c = rep(c, """          rec.table_used = tset;
        } else if (hasStored) {""", """          rec.table_used = tset;
        } else if (ttie && (label in ttie.byLabel)) {
          // THRESHOLD_TABLE_TIE_V1：各套表格只有一个取值、对话里也没有别的取值时照常登记；否则记为冲突，候选值连同出处表名一起保留
          const tv = ttie.byLabel[label];
          const extra = ranked.map(x => x[0]).filter(x => !tv.some(e => e.value === x));
          if (hasStored && !tv.some(e => e.value === Number(storedVals[label])) && extra.indexOf(Number(storedVals[label])) < 0) extra.push(Number(storedVals[label]));
          if (tv.length === 1 && !extra.length) { rec.values[label] = tv[0].value; rec.sources[label] = 'table'; }
          else rec.conflicts.push({ label, candidates: tv.map(e => e.value).concat(extra), origin: 'table_tie', candidate_sources: tv.map(e => ({ value: e.value, sources: e.sources.slice(0, 3) })) });
          rec.table_tie = ttie;
        } else if (hasStored) {""")
c = rep(c, """        parts.push(c.label + '在本次对话中出现过 ' + c.candidates.join('、') + ' 共 ' + c.candidates.length + ' 个取值，未择一：实测' + (upper ? '最大值 ' : '最小值 ') + fmt(x) + ' ' +""",
        """        // THRESHOLD_TABLE_TIE_V1：表格几套定值打平的冲突写出各取值的出处表名，不写「在本次对话中出现过」
        const __cs = asArray(c.candidate_sources);
        const __head = c.origin === 'table_tie'
          ? c.label + ' 在证据表格中有 ' + __cs.map(e => e.value + '（《' + asArray(e.sources).join('》《') + '》）').join('、') +
            (c.candidates.length > __cs.length ? '，对话中另有 ' + c.candidates.slice(__cs.length).join('、') : '')
          : c.label + '在本次对话中出现过 ' + c.candidates.join('、');
        parts.push(__head + ' 共 ' + c.candidates.length + ' 个取值，未择一：实测' + (upper ? '最大值 ' : '最小值 ') + fmt(x) + ' ' +""")
c = rep(c, """      let __src = turns ? '阈值取自本次对话第 ' + turns + ' 轮已给出的设定' : (rec.table_used ? '阈值取自证据表格' : '阈值取自本次对话前序轮次已给出的设定');""",
        """      let __src = turns ? '阈值取自本次对话第 ' + turns + ' 轮已给出的设定' : ((rec.table_used || rec.table_tie) ? '阈值取自证据表格' : '阈值取自本次对话前序轮次已给出的设定');
      if (rec.table_tie) __src += '；证据表格里该位号有 ' + rec.table_tie.sets + ' 套报警定值、行数相同（共 ' + rec.table_tie.total_rows + ' 行），未择一'; // THRESHOLD_TABLE_TIE_V1""")
c = rep(c, """        thresholds: v, threshold_turns: Array.from(rec.turns),""", """        thresholds: v, threshold_turns: Array.from(rec.turns), primary_measurement: Boolean(__m.primary),""")
c = rep(c, """    return out.map((r, i) => [r, i]).sort((a, b) => ((b[0].threshold_turns.length > 0) - (a[0].threshold_turns.length > 0)) || (a[1] - b[1])).map(x => x[0]).slice(0, 2);""",
        """    // THRESHOLD_TABLE_TIE_V1：其次本轮主分析读到的位号在前、因子解析附带读到的在后（只留前 2 行，所问位号不被挤掉）
    return out.map((r, i) => [r, i]).sort((a, b) => ((b[0].threshold_turns.length > 0) - (a[0].threshold_turns.length > 0)) || ((b[0].primary_measurement ? 1 : 0) - (a[0].primary_measurement ? 1 : 0)) || (a[1] - b[1])).map(x => x[0]).slice(0, 2);""")
p['jsCode'] = c


# ---------- Answer Finalizer LLM（提示词）----------
def edit_params(node, f):
    s = json.dumps(N[node]['parameters'], ensure_ascii=False)
    N[node]['parameters'] = json.loads(f(s))


def fin(s):
    s = rep(s, "本次对话中已确认的阈值（强制复用）", "阈值与确定性比对（强制复用）")
    s = rep(s, "直接采用其中的数值与判断，出处按该条目自己写明的来源表述。",
            "直接采用其中的数值与判断，出处按该条目自己写明的来源表述：写明第几轮的，才说是本次对话前面给过的；写明取自证据表格的，写表名，不要写成「本次对话已确认」「本次对话已给出」。"
            "每条 computed 条目只适用于它写明的那个位号；所问的量对应的位号没有 computed 条目时，不得把其他位号（同回路附属位号、相邻测点）的比对结论当成所问量的结论。")
    s = rep(s, "computed 条目指出某一档位在本次对话中出现过多个取值、未择一时",
            "computed 条目指出某一档位有多个取值（本次对话中出现过多个，或证据表格里几套定值不一致）、未择一时")
    return s


edit_params('Answer Finalizer LLM', fin)

# ---------- Compose Guard ----------
p = N['Compose Guard']['parameters']; c = p['jsCode']; assert MARK not in c
c = rep(c, "const __cmpPara = '阈值比对（按本次对话已给出的阈值与本轮实测极值确定性计算）：' +",
        "const __cmpPara = '阈值比对（按各句写明出处的阈值与本轮实测极值确定性计算）：' + // THRESHOLD_TABLE_TIE_V1：阈值可能取自本轮证据表格，不写「本次对话已给出」")
p['jsCode'] = c

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out:
    out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
