# -*- coding: utf-8 -*-
"""r1113：计算量输入的仪表数据由代码取（INPUT_INSTRUMENT_FACTS_V1）。只改 Prepare Derived Quantity Check：
定义里写明位号的因子，若 engineering_facts 里还没有该位号，代码调装置模型 plant_instruments 取回并入。
用法：python r1113_build.py <in.json> <out.json> [底版前缀]；in 可以是 GET 回来的工作流（用 activeVersion）。"""
import sys, os, io, json
HERE = os.path.dirname(os.path.abspath(__file__))
src, dst = sys.argv[1], sys.argv[2]; pfx = sys.argv[3] if len(sys.argv) > 3 else None
wf = json.load(io.open(src, encoding='utf-8'))
if pfx: assert str(wf.get('activeVersionId', '')).startswith(pfx), wf.get('activeVersionId')
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
MARK = 'INPUT_INSTRUMENT_FACTS_V1'


def rep1(s, old, new, where):
    assert s.count(old) == 1, (where, s.count(old), old[:80])
    return s.replace(old, new)


p = N['Prepare Derived Quantity Check']['parameters']; c = p['jsCode']; assert MARK not in c
block = io.open(os.path.join(HERE, 'input_instrument_facts.js'), encoding='utf-8').read().rstrip('\n') + '\n'
c = 'const __insHelper = this; // INPUT_INSTRUMENT_FACTS_V1：代码节点的 helpers（发请求用）\n' + c
c = rep1(c, "const engineeringFacts = pmCurrentFacts(j.engineering_facts);\n", block, 'facts line')
c = rep1(c, "return [{ json: { ...j, unit: { ...unit, params }, engineering_facts: engineeringFacts,\n",
         "return [{ json: { ...j, unit: { ...unit, params }, engineering_facts: engineeringFacts, input_instrument_facts: __insTrace,\n", 'return')
p['jsCode'] = c

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
