# -*- coding: utf-8 -*-
"""r1120s：DATA_SCOPE_STATEMENT_V1 补充——正文很短时不加取数口径句。
来由：r1120q 实跑 R01（「只给结论数字，不要表格，不要分析」），回答正文只有一句数字，后面却被代码加上了取数口径句，违背提问人要求（提问人要求优先是已有规则）。
工作流里没有结构化的格式要求字段，这里用结构信号：正文去掉引用与空白后不足 300 字，视为按提问人要求刻意写短的回答，不加这句。
用法：python r1120s_build.py <in.json> <out.json>"""
import sys, io, json
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
p = N['Append Data Scope']['parameters']; c = p['jsCode']; assert 'DATA_SCOPE_SHORT_ANSWER_SKIP' not in c
old = "const out = (line && body && body.indexOf('取数口径：') < 0) ?"
assert c.count(old) == 1
c = c.replace(old, "// DATA_SCOPE_SHORT_ANSWER_SKIP：正文去掉引用与空白后不足 300 字，视为按提问人要求刻意写短（如「只给结论数字」），不加这句\n"
                   "const __bodyLen = body.replace(/\\[[EK]\\d+\\]/g, '').replace(/\\s+/g, '').length;\n"
                   "if (__bodyLen < 300) line = '';\n" + old)
p['jsCode'] = c
out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out:
    out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
