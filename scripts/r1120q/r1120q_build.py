# -*- coding: utf-8 -*-
"""r1120q：三件快修（PERIOD_REPORT_ROUTING_V1、REGULATION_DOC_VARIANT_V1、DATA_SCOPE_STATEMENT_V1）。
① ② Grouped RAGFlow Retrieval：每个检索单元按需多加「月报按期次限定」「操作规程限定」两路查询；跨单元去重的键加上 document_ids。
③ 新节点 Append Data Scope：Apply Source Check → Append Data Scope → Save Conversation State。
用法：python r1120q_build.py <in.json> <out.json>"""
import sys, io, json, os, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from quickfix import ROUTE_JS, SCOPE_JS
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); C = json.loads(json.dumps(av['connections'])); N = {n['name']: n for n in nodes}
assert 'Append Data Scope' not in N and 'Apply Source Check' in N


def rep(code, old, new, cnt=1):
    assert code.count(old) == cnt, (old[:90], code.count(old))
    return code.replace(old, new)


p = N['Grouped RAGFlow Retrieval']['parameters']; c = p['jsCode']; assert 'PERIOD_REPORT_ROUTING_V1' not in c
c = rep(c, "const outputItems = [];\n", ROUTE_JS + "\nconst outputItems = [];\n")
c = rep(c, """  const rawVariants = nonEmptyArray(params.query_variants)
    ? params.query_variants
    : [{ question: params.question, variant_id: 'single_query', lang_variant: params.lang_variant || null }];
""", """  const __rawVariants0 = nonEmptyArray(params.query_variants)
    ? params.query_variants
    : [{ question: params.question, variant_id: 'single_query', lang_variant: params.lang_variant || null }];
  const rawVariants = __rawVariants0.concat(await __routedVariants(params, __rawVariants0, baseUrl, headers, verifySsl)); // PERIOD_REPORT_ROUTING_V1 / REGULATION_DOC_VARIANT_V1
""")
c = rep(c, """    JSON.stringify((Array.isArray(v && v.dataset_ids) && v.dataset_ids.length ? v.dataset_ids : (Array.isArray(p && p.dataset_ids) ? p.dataset_ids : [])).map(String).sort());""",
        """    JSON.stringify((Array.isArray(v && v.dataset_ids) && v.dataset_ids.length ? v.dataset_ids : (Array.isArray(p && p.dataset_ids) ? p.dataset_ids : [])).map(String).sort()) +
    '|' + JSON.stringify((Array.isArray(v && v.document_ids) ? v.document_ids : []).map(String).sort()); // PERIOD_REPORT_ROUTING_V1：限定文档的查询另算""")
p['jsCode'] = c

uid = lambda s: str(uuid.uuid5(uuid.NAMESPACE_URL, 'r1120q/' + s))
px, py = N['Save Conversation State']['position']
for nm in ('Save Conversation State', 'Store Conversation State', 'Restore Chat Output'):
    N[nm]['position'] = [N[nm]['position'][0] + 300, N[nm]['position'][1]]
nodes.append({'id': uid('scope'), 'name': 'Append Data Scope', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [px, py], 'parameters': {'jsCode': SCOPE_JS}})
lst = C['Apply Source Check']['main'][0]
assert [e['node'] for e in lst] == ['Save Conversation State'], lst
C['Apply Source Check']['main'][0] = [{'node': 'Append Data Scope', 'type': 'main', 'index': 0}]
C['Append Data Scope'] = {'main': [[{'node': 'Save Conversation State', 'type': 'main', 'index': 0}]]}
out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes; tgt['connections'] = C
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = C
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst, len(nodes))
