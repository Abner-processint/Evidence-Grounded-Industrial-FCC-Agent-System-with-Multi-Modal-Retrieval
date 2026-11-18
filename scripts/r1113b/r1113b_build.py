# -*- coding: utf-8 -*-
"""r1113b：在 r1113（INPUT_INSTRUMENT_FACTS_V1）之上，把「本轮已成功读过数据的位号」也纳入由代码取仪表数据（INPUT_INSTRUMENT_FACTS_V2）。
只改 Prepare Derived Quantity Check 里选位号那几行和记录行：
  顺序：① 定义因子写明的位号（原 r1113）；② 定义因子 evidence_ids 引用到的本轮时序读数单元（U<n>）里的位号；③ 本轮其余时序读数单元的位号。
  时序读数单元 = completed_units 里 source_type=sensor_data、执行成功、不是 mongo_find_tags（找位号不算读过）；位号取 resolved_tags / params.columns / columns_requested。
  已有该位号事实的不查；合计仍 ≤4；记录里注明每个位号的来源（documented / read_cited / read）。
用法：python r1113b_build.py <in.json> <out.json> [底版前缀]；in 必须已含 r1113。"""
import sys, io, json
src, dst = sys.argv[1], sys.argv[2]; pfx = sys.argv[3] if len(sys.argv) > 3 else None
wf = json.load(io.open(src, encoding='utf-8'))
if pfx: assert str(wf.get('activeVersionId', '')).startswith(pfx), wf.get('activeVersionId')
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}


def rep1(s, old, new, where):
    assert s.count(old) == 1, (where, s.count(old), old[:80])
    return s.replace(old, new)


p = N['Prepare Derived Quantity Check']['parameters']; c = p['jsCode']
assert 'INPUT_INSTRUMENT_FACTS_V1' in c and 'INPUT_INSTRUMENT_FACTS_V2' not in c
OLD = ("  const __tags = [...new Set(pmArr(params.factors).flatMap(f => pmArr(pmObj(f).documented_tags))\n"
       "    .map(t => String(t == null ? '' : t).trim().toUpperCase().replace(/\\.PV$/, '')))]\n"
       "    .filter(t => /^[A-Z][A-Z0-9_]{1,20}$/.test(t) && !__have.has(t)).slice(0, 4);\n")
NEW = ("  // INPUT_INSTRUMENT_FACTS_V2：除定义写明的位号外，本轮已成功读过数据的位号也取（定义因子漏写位号时，例如稀相密度没写 DR3110）。\n"
       "  // 顺序：定义写明 → 定义因子引用的本轮读数单元 → 本轮其余读数单元；找位号（mongo_find_tags）不算读过。\n"
       "  const __norm = t => String(t == null ? '' : t).trim().toUpperCase().replace(/\\.PV$/, '');\n"
       "  const __cited = new Set(pmArr(params.factors).flatMap(f => pmArr(pmObj(f).evidence_ids))\n"
       "    .map(x => (String(x == null ? '' : x).trim().match(/^U(\\d+)(?:#|$)/) || [])[1]).filter(Boolean));\n"
       "  const __reads = pmArr(j.completed_units).map(pmObj).filter(u => u.source_type === 'sensor_data'\n"
       "    && pmStr(u.execution_status).toUpperCase() === 'SUCCESS' && pmStr(u.tool) !== 'mongo_find_tags');\n"
       "  const __unitTags = u => [...pmArr(u.resolved_tags), ...pmArr(pmObj(u.params).columns), ...pmArr(u.columns_requested)];\n"
       "  const __from = new Map();\n"
       "  const __cand = [\n"
       "    ...pmArr(params.factors).flatMap(f => pmArr(pmObj(f).documented_tags)).map(t => [t, 'documented']),\n"
       "    ...__reads.filter(u => __cited.has(String(u.unit_id))).flatMap(__unitTags).map(t => [t, 'read_cited']),\n"
       "    ...__reads.filter(u => !__cited.has(String(u.unit_id))).flatMap(__unitTags).map(t => [t, 'read'])];\n"
       "  for (const [t, why] of __cand) { const k = __norm(t); if (/^[A-Z][A-Z0-9_]{1,20}$/.test(k) && !__have.has(k) && !__from.has(k)) __from.set(k, why); }\n"
       "  const __tags = [...__from.keys()].slice(0, 4);\n")
c = rep1(c, OLD, NEW, 'tags')
c = rep1(c, "        __insTrace.push({ tag, status: pmStr(pmObj(b).status) || null, facts: out.length });\n",
         "        __insTrace.push({ tag, from: __from.get(tag), status: pmStr(pmObj(b).status) || null, facts: out.length });\n", 'trace ok')
c = rep1(c, "      } catch (e) { __insTrace.push({ tag, error: String(e && e.message || e).slice(0, 160) }); return []; }\n",
         "      } catch (e) { __insTrace.push({ tag, from: __from.get(tag), error: String(e && e.message || e).slice(0, 160) }); return []; }\n", 'trace err')
p['jsCode'] = c

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
