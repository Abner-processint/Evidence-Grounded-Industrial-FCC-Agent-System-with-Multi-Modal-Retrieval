# -*- coding: utf-8 -*-
"""r1119u：THRESHOLD_ALL_VALUES_V1——报警定值四处修正（在 r1119t 之上；11-18 与 GPT 6.2 讨论后用户定「接着改」）。
① 表格解析：单元格里没有数字（报警位号表的 NaN、「-」「无」）不再被 normNum 读成 0。原先报警位号表里 HH 为 NaN 的行 → HH 0 < H，大小次序不成立整行丢弃
   （exec 204278：TIA3216 H 355 / L 310 / LL 305 就在证据 E18 里，却从未进入比对）；LL 为 NaN 的行则被登记成 LL 0。
② 同一位号有多套表格定值时一律并列（各档不同取值都列出、分别判断），不再按多数行择一（用户规则：冲突全部列出、不替用户择一）。
③ 比对按完整位号取表格定值：回路键（首字母 + 数字）只用来找候选；本轮表格里有点名该位号的行就只用这些行，
   只有同回路其他位号（LRC3201A / LRC3201B 之于 LT3201B）的行时，表格定值不用于该位号。
④ 跨轮：会话保存时带上全部几套（all_sets），下一轮证据里没有该表时按保存的各套补回，仍并列，不退回只用一套。
用法：python r1119u_build.py <in.json> <out.json>"""
import sys, io, json
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
MARK = 'THRESHOLD_ALL_VALUES_V1'


def rep(code, old, new, cnt=1):
    assert code.count(old) == cnt, (old[:90], code.count(old))
    return code.replace(old, new)


p = N['Evidence Packet Builder']['parameters']; c = p['jsCode']
assert MARK not in c and 'THRESHOLD_TABLE_TIE_V1' in c

# ① 非数字单元格不当 0
c = rep(c, "for (const [lab, i] of Object.entries(idx)) { const v = normNum(r[i]); if (String(r[i] || '').trim() !== '' && Number.isFinite(v)) vals[lab] = v; }",
        "for (const [lab, i] of Object.entries(idx)) { const v = normNum(r[i]); if (/\\d/.test(String(r[i] || '')) && Number.isFinite(v)) vals[lab] = v; } // THRESHOLD_ALL_VALUES_V1：NaN / - / 无 不当 0")
c = rep(c, "if (String(r[hiIdx] || '').trim() !== '' && String(r[loIdx] || '').trim() !== '' && Number.isFinite(vhi)",
        "if (/\\d/.test(String(r[hiIdx] || '')) && /\\d/.test(String(r[loIdx] || '')) && Number.isFinite(vhi)")

# ④ 跨轮：保存过的各套补回（放在表格解析之后、取定值之前）
c = rep(c, "    // 某回路的表格定值：行数唯一最多的一套；本轮观察与会话已存的观察取总行数多的一次（持平沿用已存的）\n",
        """    // THRESHOLD_ALL_VALUES_V1：会话里保存过各套定值（all_sets）、本轮证据没再出现该表的回路，按保存的各套补回，跨轮仍并列
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
""")

# ② 多套一律并列
c = rep(c, "      if (ranked.length < 2 || ranked[0].count > ranked[1].count) return null;\n",
        "      if (ranked.length < 2) return null; // THRESHOLD_ALL_VALUES_V1：不再只在打平时并列，多数行也不替用户择一\n")
c = rep(c, """      const tset = tableSetFor(key);
      const ttie = tset ? null : tableTieFor(key); // THRESHOLD_TABLE_TIE_V1""",
        """      const ttie = tableTieFor(key); // THRESHOLD_ALL_VALUES_V1：同一位号有多套表格定值时一律并列
      const tset = ttie ? null : tableSetFor(key);""")
c = rep(c, "if (rec.table_tie) __src += '；证据表格里该位号有 ' + rec.table_tie.sets + ' 套报警定值、行数相同（共 ' + rec.table_tie.total_rows + ' 行），未择一'; // THRESHOLD_TABLE_TIE_V1",
        "if (rec.table_tie) __src += '；证据表格里该位号有 ' + rec.table_tie.sets + ' 套报警定值（共 ' + rec.table_tie.total_rows + ' 行），各档不同取值并列、未择一'; // THRESHOLD_ALL_VALUES_V1")

# ④ 保存时带上全部几套
c = rep(c, """      __alarmTableMajorityOut[key] = { values: ranked[0].vals, rows: ranked[0].count, total_rows: ranked.reduce((n, x) => n + x.count, 0), source: ranked[0].source, tags: Array.from(ranked[0].tags).slice(0, 12), sets: ranked.length };
    }
""", """      __alarmTableMajorityOut[key] = { values: ranked[0].vals, rows: ranked[0].count, total_rows: ranked.reduce((n, x) => n + x.count, 0), source: ranked[0].source, tags: Array.from(ranked[0].tags).slice(0, 12), sets: ranked.length };
    }
    // THRESHOLD_ALL_VALUES_V1：有多套定值的回路，保存时带上全部几套（下一轮证据里没有该表时按各套补回）
    for (const [key, m] of __tblNow) {
      if (m.size < 2) continue;
      if (!(key in __alarmTableMajorityOut) && Object.keys(__alarmTableMajorityOut).length >= 30) continue;
      const all = Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, 6).map(x => ({ vals: x.vals, count: x.count, source: x.source, tags: Array.from(x.tags).slice(0, 12) }));
      const base = asObject(__alarmTableMajorityOut[key]);
      __alarmTableMajorityOut[key] = Object.assign({}, base, { all_sets: all, sets: m.size, total_rows: Math.max(Number(base.total_rows) || 0, all.reduce((n, x) => n + x.count, 0)) });
    }
""")

# ③ 比对按完整位号取表格定值
c = rep(c, """    for (const __m of measured.values()) {
      const rec = byLoop.get(loopKey(__m.column));
      if (!rec) continue;
      const v = rec.values;
""", """    // THRESHOLD_ALL_VALUES_V1：比对按完整位号取表格定值。回路键只用来找候选；本轮表格里有点名该位号的行，就只用这些行（各档不同取值并列）；
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
""")
# ⑤ 按日扫描越限：某档有多个取值（未择一）时按最宽的取值扫描，越过任一取值的日子都列出；文字写出全部取值
c = rep(c, "    const v = asObject(row.crossing_bounds || row.thresholds); const sp = row.instrument_range || null;\n",
        """    const v = Object.assign({}, asObject(row.crossing_bounds || row.thresholds)); const sp = row.instrument_range || null;
    // THRESHOLD_ALL_VALUES_V1：某档有多个取值、未择一时，按最宽的那个扫描（越过任一取值的日子都列出），文字写出全部取值
    const __candOf = {};
    for (const cf of asArray(row.conflicts)) {
      const cs = asArray(asObject(cf).candidates).map(Number).filter(Number.isFinite); if (cs.length < 2) continue;
      v[cf.label] = HIGH.indexOf(cf.label) >= 0 ? Math.min(...cs) : Math.max(...cs); __candOf[cf.label] = cs;
    }
    const __lt = (k, val) => (__candOf[k] ? k + ' ' + __candOf[k].join('/') + '（取值未择一，按 ' + val + ' 扫描，各日极值可与各取值对照）' : k + ' ' + val);
""")
c = rep(c, "texts.push(word + loosest + ' ' + v[loosest] + ' 的日期没有' +", "texts.push(word + __lt(loosest, v[loosest]) + ' 的日期没有' +")
c = rep(c, "texts.push(word + label + ' ' + value + ' 的日期共 ' + ep.days", "texts.push(word + __lt(label, value) + ' 的日期共 ' + ep.days")
p['jsCode'] = c

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out:
    out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
