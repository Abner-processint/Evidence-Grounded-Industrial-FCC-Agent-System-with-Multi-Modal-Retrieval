# -*- coding: utf-8 -*-
"""r1117：NO_ABSENCE_REWRITE_V1。在「存会话」前加三个节点：Prepare No-Absence Rewrite → No-Absence Rewrite LLM（DeepSeek-NoAbsence，温度 0）→ Apply No-Absence Rewrite → Save Conversation State。
Verification Gate 第 2 出口、Verification Action 第 1 出口原来直连 Save Conversation State，改连到 Prepare No-Absence Rewrite。
用法：python r1117_build.py <in.json> <out.json> [底版前缀]"""
import sys, io, json, os, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from no_absence import RSYS, PREP_JS, APPLY_JS
src, dst = sys.argv[1], sys.argv[2]; pfx = sys.argv[3] if len(sys.argv) > 3 else None
wf = json.load(io.open(src, encoding='utf-8'))
if pfx: assert str(wf.get('activeVersionId', '')).startswith(pfx), wf.get('activeVersionId')
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); C = json.loads(json.dumps(av['connections'])); N = {n['name']: n for n in nodes}
assert 'Prepare No-Absence Rewrite' not in N
uid = lambda s: str(uuid.uuid5(uuid.NAMESPACE_URL, 'r1117/' + s))
px, py = N['Save Conversation State']['position']
cred = N['DeepSeek-MissingClaim']['credentials']
nodes += [
    {'id': uid('prep'), 'name': 'Prepare No-Absence Rewrite', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [px - 800, py], 'parameters': {'jsCode': PREP_JS}},
    {'id': uid('llm'), 'name': 'No-Absence Rewrite LLM', 'type': '@n8n/n8n-nodes-langchain.agent', 'typeVersion': 3.1, 'position': [px - 600, py],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 5000, 'onError': 'continueRegularOutput',
     'parameters': {'promptType': 'define', 'text': '={{ $json.no_absence_user }}', 'options': {'systemMessage': RSYS}}},
    {'id': uid('model'), 'name': 'DeepSeek-NoAbsence', 'type': '@n8n/n8n-nodes-langchain.lmChatDeepSeek', 'typeVersion': 1, 'position': [px - 600, py + 200],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 15000, 'credentials': cred, 'parameters': {'options': {'temperature': 0}}},
    {'id': uid('apply'), 'name': 'Apply No-Absence Rewrite', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [px - 300, py], 'parameters': {'jsCode': APPLY_JS}},
]
def repoint(src_name, out_idx):
    lst = C[src_name]['main'][out_idx]
    assert [e['node'] for e in lst] == ['Save Conversation State'], (src_name, lst)
    C[src_name]['main'][out_idx] = [{'node': 'Prepare No-Absence Rewrite', 'type': 'main', 'index': 0}]
repoint('Verification Gate', 1); repoint('Verification Action', 0)
C['Prepare No-Absence Rewrite'] = {'main': [[{'node': 'No-Absence Rewrite LLM', 'type': 'main', 'index': 0}]]}
C['No-Absence Rewrite LLM'] = {'main': [[{'node': 'Apply No-Absence Rewrite', 'type': 'main', 'index': 0}]]}
C['DeepSeek-NoAbsence'] = {'ai_languageModel': [[{'node': 'No-Absence Rewrite LLM', 'type': 'ai_languageModel', 'index': 0}]]}
C['Apply No-Absence Rewrite'] = {'main': [[{'node': 'Save Conversation State', 'type': 'main', 'index': 0}]]}
out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes; tgt['connections'] = C
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = C
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst, len(nodes))
