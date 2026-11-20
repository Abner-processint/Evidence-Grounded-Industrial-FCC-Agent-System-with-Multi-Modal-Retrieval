# -*- coding: utf-8 -*-
"""r1120c：THRESHOLD_SPLIT_VERDICT_V1——报警定值有几套、按不同出处结论不同时，开头结论句也要分出处写（11-18 用户「修结论句」）。
来由：副本实跑 R10 两次，正文已把报警位号表 H 355 与 DCS 控制点统计表 H 345 / HH 348、350 并列并分别判断，但首稿模型（Answer Finalizer）开头一句只按 DCS 表写「确实超过报警值」，后面各步原样保留。
① Evidence Packet Builder：比对按完整位号取到多套表格定值时，代码按每套（每份资料）分别判断是否越过任一报警档；结论不一致时在比对句开头写
   「结论随报警定值的出处而不同（未择一）：按《A》（…）未越过任何报警档；按《B》（…）高于 H 345 …」。判断由代码算，不交给模型。
② Answer Finalizer LLM 提示词：在已有「多个取值都写出来、不得只取其一」一句后补：computed 条目以这句开头时，回答开头的结论句照这个分出处的结论写，不得写成笼统的超过 / 未超过。
用法：python r1120c_build.py <in.json> <out.json>"""
import sys, io, json
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
MARK = 'THRESHOLD_SPLIT_VERDICT_V1'


def rep(code, old, new, cnt=1):
    assert code.count(old) == cnt, (old[:90], code.count(old))
    return code.replace(old, new)


p = N['Evidence Packet Builder']['parameters']; c = p['jsCode']
assert MARK not in c and 'THRESHOLD_ALL_VALUES_V1' in c
c = rep(c, "        if (sets.length > 1) out.table_tie = { sets: sets.length, total_rows: total };\n",
        "        if (sets.length > 1) { out.table_tie = { sets: sets.length, total_rows: total }; out.table_sets = sets.map(s0 => ({ source: s0.source, vals: s0.vals })); } // THRESHOLD_SPLIT_VERDICT_V1\n")
c = rep(c, "      const m = { column: __m.column, max: vmax, min: vmin, range: rmax || rmin || ((__m.rows[0] || {}).range || '') };\n      const parts = [];\n",
        """      const m = { column: __m.column, max: vmax, min: vmin, range: rmax || rmin || ((__m.rows[0] || {}).range || '') };
      const parts = [];
      // THRESHOLD_SPLIT_VERDICT_V1：多套表格定值时按每套（每份资料）分别判断是否越过任一报警档；结论不一致时放在比对句最前，供开头结论句照写
      if (Array.isArray(rec.table_sets) && rec.table_sets.length > 1) {
        const __hitOf = vals => {
          const hit = [];
          for (const l of ['HH', 'H']) if ((l in vals) && Number.isFinite(m.max) && m.max > Number(vals[l])) hit.push('高于 ' + l + ' ' + vals[l]);
          for (const l of ['LL', 'L']) if ((l in vals) && Number.isFinite(m.min) && m.min < Number(vals[l])) hit.push('低于 ' + l + ' ' + vals[l]);
          return hit;
        };
        const __rows = rec.table_sets.map(s0 => ({ src: String(s0.source || ''), vals: asObject(s0.vals), hit: __hitOf(asObject(s0.vals)) }));
        if (__rows.some(r => r.hit.length) && __rows.some(r => !r.hit.length)) {
          const __fv = v0 => ALARM.filter(l => l in v0).map(l => l + ' ' + v0[l]).join('、');
          parts.push('结论随报警定值的出处而不同（未择一）：' + __rows.map(r => '按《' + r.src + '》（' + __fv(r.vals) + '）' + (r.hit.length ? r.hit.join('、') : '未越过任何报警档')).join('；'));
        }
      }
""")
p['jsCode'] = c


def fin(s):
    old = "computed 条目指出某一档位有多个取值（本次对话中出现过多个，或证据表格里几套定值不一致）、未择一时，把这几个取值及各自的判断都写出来，不得只取其一。"
    new = old + ("computed 条目以「结论随报警定值的出处而不同」开头时，回答开头的结论句照这个分出处的结论写（按哪份资料越过了哪一档、按哪份资料未越过），"
                 "不得写成笼统的「超过报警值」或「未超过报警值」（THRESHOLD_SPLIT_VERDICT_V1）。")
    return rep(s, old, new)


N['Answer Finalizer LLM']['parameters'] = json.loads(fin(json.dumps(N['Answer Finalizer LLM']['parameters'], ensure_ascii=False)))

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out:
    out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
