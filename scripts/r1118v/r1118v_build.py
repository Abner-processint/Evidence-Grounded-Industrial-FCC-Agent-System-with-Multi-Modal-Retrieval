# -*- coding: utf-8 -*-
"""r1118v：RETRIEVAL_VARIANT_PRUNE_V1——去掉实测零贡献的检索查询写法，降低 RAGFlow 负载（并发高时超时 36%）。
依据：11-17 accept/variant_replay.py，16 次执行 99 个查询原样重放，「只有它取到且被回答引用」的段：原问句 33、中文关键词 10、中文限定 7、规范主体 5、
英文因素 2、英文关键词 2、中文因素 1、中文指标范围 1；下面 DROP 里的写法共 30 次使用、0 段。
① Unit ordered Splitter：两处 `return out.slice(0, candidateLimit)` 截取之后再滤掉 DROP（只减不加，名额不让给后面的写法）；滤空时保留原第一个。
② Param Injector：位号资料检索单元只留「位号.PV」一路（裸位号与 .PV 互相重复，裸位号常 0 段）；TAG_ANCHORED 那一路不动。
用法：python r1118v_build.py <in.json> <out.json> [底版前缀]"""
import sys, io, json
src, dst = sys.argv[1], sys.argv[2]; pfx = sys.argv[3] if len(sys.argv) > 3 else None
wf = json.load(io.open(src, encoding='utf-8'))
if pfx: assert str(wf.get('activeVersionId', '')).startswith(pfx), wf.get('activeVersionId')
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
MARK = 'RETRIEVAL_VARIANT_PRUNE_V1'
DROP = ['en_scoped_preserved', 'en_stable_target_range_profile', 'en_stable_prevention_profile', 'zh_stable_prevention_profile',
        'en_stable_period_profile', 'zh_stable_period_profile', 'en_stable_general_profile', 'zh_stable_general_profile', 'zh_scoped',
        'zh_event_evidence_profile', 'en_stable_measurement_profile', 'zh_stable_measurement_profile', 'en_scoped',
        'en_stable_calculation_profile', 'zh_stable_calculation_profile']

p = N['Unit ordered Splitter']['parameters']; c = p['jsCode']; assert MARK not in c
old = "  return out.slice(0, candidateLimit).map(({ _key, ...rest }) => rest);\n"
assert c.count("    return out.slice(0, candidateLimit).map(({ _key, ...rest }) => rest);\n") == 1 and c.count(old) == 2, (c.count(old),)
helper = ("// RETRIEVAL_VARIANT_PRUNE_V1（11-17）：截取之后滤掉实测零贡献的查询写法（16 次执行 99 个查询重放，这些写法 30 次使用、独有且被引用 0 段），\n"
          "// 降低 RAGFlow 负载（同时 ≥7 个执行时检索超时 36%）。只减不加；滤空时保留原第一个。\n"
          "const __PRUNE_DROP = new Set(" + json.dumps(DROP) + ");\n"
          "function __pruneVariants(list) { const kept = (list || []).filter(v => !__PRUNE_DROP.has(String((v && v.lang_variant) || ''))); return kept.length ? kept : (list || []).slice(0, 1); }\n")
c = helper + c
c = c.replace("    return out.slice(0, candidateLimit).map(({ _key, ...rest }) => rest);\n", "    return __pruneVariants(out.slice(0, candidateLimit)).map(({ _key, ...rest }) => rest);\n")
c = c.replace(old, "  return __pruneVariants(out.slice(0, candidateLimit)).map(({ _key, ...rest }) => rest);\n")
assert c.count('__pruneVariants(out.slice(0, candidateLimit))') == 2
p['jsCode'] = c

p = N['Param Injector']['parameters']; c = p['jsCode']; assert MARK not in c
old2 = "        { ...tmpl, variant_id: 'tag_document_bare', lang_variant: 'resolved_tag_identifiers', question: bases.join(' ') },\n"
assert c.count(old2) == 1, c.count(old2)
c = c.replace(old2, "        // RETRIEVAL_VARIANT_PRUNE_V1：裸位号一路去掉（与「位号.PV」一路互相重复、常 0 段）\n")
p['jsCode'] = c

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
