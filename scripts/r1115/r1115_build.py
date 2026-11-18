# -*- coding: utf-8 -*-
"""r1115：删除 9 月的两处文档对照机制（11-13 评估：基本不起作用）。
① Grouped RAGFlow Retrieval：删 TAG_IDENTITY_PROBE_V7（含 TAG_IDENTITY_SUBJECT_NAMES_V7）补查块，以及「身份依据片段不参与排序截断」那段强行并入。
   74 次执行触发 6 次，5 次位号与问题无关；取回 7 段、进证据包 1 段、被引用 0 次。
② Dependency Gate：删 DOCUMENT_BOUND_TAG_PROMOTION_V7 整段（IIFE）。83 次执行 0 次触发。
位号资料检索 TAG_DOCUMENT_RETRIEVAL_V7 保留。用法：python r1115_build.py <in.json> <out.json> [底版前缀]"""
import sys, io, json
src, dst = sys.argv[1], sys.argv[2]; pfx = sys.argv[3] if len(sys.argv) > 3 else None
wf = json.load(io.open(src, encoding='utf-8'))
if pfx: assert str(wf.get('activeVersionId', '')).startswith(pfx), wf.get('activeVersionId')
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
MARK = 'DOC_TAG_MATCH_REMOVED_V1'

# ① 分组检索
p = N['Grouped RAGFlow Retrieval']['parameters']; c = p['jsCode']; assert MARK not in c
a = c.index('  // TAG_IDENTITY_PROBE_V7\n  // MT25 T3')
b_anchor = '  } catch (e) {}\n\n  const maxEvidenceRaw ='
b = c.index(b_anchor, a); assert c.count(b_anchor) == 1
c = c[:a] + ('  // DOC_TAG_MATCH_REMOVED_V1（11-13）：原 TAG_IDENTITY_PROBE_V7 按位号补查身份已删除——74 次执行触发 6 次、5 次位号与问题无关、\n'
             '  // 进证据包 1 段、被引用 0 次；位号身份原文由位号资料检索单元（TAG_DOCUMENT_RETRIEVAL_V7，按「位号.PV」查）取回。\n') + c[b + len('  } catch (e) {}\n'):]
old = ("  // TAG_IDENTITY_PROBE_V7：身份依据片段不参与排序截断，确保进入所选证据。\n"
       "  for (const c of __identityCandidates) {\n"
       "    if (!selected.includes(c)) selected.push(c);\n"
       "  }\n")
assert c.count(old) == 1; c = c.replace(old, '')
for k in ('__identityCandidates', '__bindingLabel', '__probeTags', 'TAG_IDENTITY_PROBE_V7：身份', 'TAG_IDENTITY_SUBJECT_NAMES_V7'):
    assert k not in c, k
p['jsCode'] = c

# ② 依赖关卡
p = N['Dependency Gate']['parameters']; c = p['jsCode']; assert MARK not in c
a = c.index('// DOCUMENT_BOUND_TAG_PROMOTION_V7\n')
b = c.index('\n})();\n', a) + len('\n})();\n')
assert c[b:].lstrip('\n').startswith('if (!deps.length)'), c[b:b + 60]
c = c[:a] + ('// DOC_TAG_MATCH_REMOVED_V1（11-13）：原 DOCUMENT_BOUND_TAG_PROMOTION_V7「按文档把上下文相关候选提升为直接匹配」已删除——\n'
             '// 83 次执行 0 次触发；只认「名称(位号)」括号写法，文档里位号多在表格行里，匹配不上。\n') + c[b:]
assert 'DOCUMENT_BOUND_TAG_PROMOTION_V7\n' not in c and 'promotable' not in c
p['jsCode'] = c

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
