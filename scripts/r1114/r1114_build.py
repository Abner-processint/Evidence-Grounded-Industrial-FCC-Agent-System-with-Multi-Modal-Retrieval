# -*- coding: utf-8 -*-
"""r1114：装置模型的毫米数值由代码换成米（SI_LENGTH_FACTS_V1）。
计算量一链四个节点（Prepare Derived Quantity Check、Apply Derived Quantities、Prepare Derived Binding、Compute Derived Quantities）
各有一份相同的 pmNormalizeFacts；在其中把 unit=mm 的事实换成 value/1000、unit=m，并记 converted_from:"<原值> mm"。
已是米的（含已换过的）不再换，四个节点各自合并 Parse Device Context 的原始事实与上游传来的已换事实时数值一致、不会判成冲突。
不改提示词（「用事实的实际单位、换算写进式子」照旧，实际单位变成了米）。Parse Device Context 及给成稿用的证据不动。
用法：python r1114_build.py <in.json> <out.json> [底版前缀]"""
import sys, io, json
src, dst = sys.argv[1], sys.argv[2]; pfx = sys.argv[3] if len(sys.argv) > 3 else None
wf = json.load(io.open(src, encoding='utf-8'))
if pfx: assert str(wf.get('activeVersionId', '')).startswith(pfx), wf.get('activeVersionId')
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
MARK = 'SI_LENGTH_FACTS_V1'
NODES = ['Prepare Derived Quantity Check', 'Apply Derived Quantities', 'Prepare Derived Binding', 'Compute Derived Quantities']


def rep1(s, old, new, where):
    assert s.count(old) == 1, (where, s.count(old), old[:80])
    return s.replace(old, new)


OLD1 = "    if (!['source_bound', 'derived', 'field_confirm', 'conflict'].includes(status)) continue;\n"
NEW1 = OLD1 + ("    // SI_LENGTH_FACTS_V1：毫米数值由代码换成米再交给计算量一步（11-12 试验台 68 次：模型自己换算 ×1000 出错 28 次，换成米并注明原值后 3 次）。\n"
               "    let siValue = value, siUnit = unit, convertedFrom = pmStr(v.converted_from);\n"
               "    if (pmUnit(unit) === 'mm') { siValue = Number((value / 1000).toPrecision(12)); siUnit = 'm'; convertedFrom = value + ' mm'; }\n")
OLD2 = "    const f = { ...ref, value, unit, status, retrieval_tool: v.retrieval_tool, found: true,\n"
NEW2 = "    const f = { ...ref, value: siValue, unit: siUnit, status, retrieval_tool: v.retrieval_tool, found: true,\n"
OLD3 = ("      else if (Object.prototype.hasOwnProperty.call(v, key)) f[key] = v[key];\n"
        "    }\n")
NEW3 = OLD3 + "    if (convertedFrom) f.converted_from = convertedFrom;\n"
for name in NODES:
    p = N[name]['parameters']; c = p['jsCode']; assert MARK not in c, name
    i = c.index('function pmNormalizeFacts'); j = c.index('function pmCurrentFacts')
    blk = c[i:j]
    blk = rep1(blk, OLD1, NEW1, name + ' status'); blk = rep1(blk, OLD2, NEW2, name + ' f'); blk = rep1(blk, OLD3, NEW3, name + ' keys')
    p['jsCode'] = c[:i] + blk + c[j:]

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
