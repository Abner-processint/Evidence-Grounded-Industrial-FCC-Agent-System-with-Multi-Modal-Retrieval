# -*- coding: utf-8 -*-
"""r1120k：BACKGROUND_SOURCE_CITE_V1。在「存会话」前加三个节点：Prepare Background Sources → Background Source LLM（DeepSeek-BackgroundSource，温度 0）
→ Apply Background Sources → Save Conversation State。原来 Apply No-Absence Rewrite → Save Conversation State 的连线改接到 Prepare Background Sources。
用法：python r1120k_build.py <in.json> <out.json>"""
import sys, io, json, os, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from bg_source import RSYS, PREP_JS, APPLY_JS
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); C = json.loads(json.dumps(av['connections'])); N = {n['name']: n for n in nodes}
assert 'Prepare Background Sources' not in N and 'Apply No-Absence Rewrite' in N
uid = lambda s: str(uuid.uuid5(uuid.NAMESPACE_URL, 'r1120k/' + s))
px, py = N['Save Conversation State']['position']
cred = N['DeepSeek-NoAbsence']['credentials']
# 存会话往右挪，给新节点让位
for nm in ('Save Conversation State', 'Store Conversation State', 'Restore Chat Output'):
    N[nm]['position'] = [N[nm]['position'][0] + 900, N[nm]['position'][1]]
nodes += [
    {'id': uid('prep'), 'name': 'Prepare Background Sources', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [px, py], 'parameters': {'jsCode': PREP_JS}},
    {'id': uid('llm'), 'name': 'Background Source LLM', 'type': '@n8n/n8n-nodes-langchain.agent', 'typeVersion': 3.1, 'position': [px + 250, py],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 5000, 'onError': 'continueRegularOutput',
     'parameters': {'promptType': 'define', 'text': '={{ $json.bg_source_user }}', 'options': {'systemMessage': RSYS}}},
    {'id': uid('model'), 'name': 'DeepSeek-BackgroundSource', 'type': '@n8n/n8n-nodes-langchain.lmChatDeepSeek', 'typeVersion': 1, 'position': [px + 250, py + 200],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 15000, 'credentials': cred, 'parameters': {'options': {'temperature': 0}}},
    {'id': uid('apply'), 'name': 'Apply Background Sources', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [px + 550, py], 'parameters': {'jsCode': APPLY_JS}},
]
lst = C['Apply No-Absence Rewrite']['main'][0]
assert [e['node'] for e in lst] == ['Save Conversation State'], lst
C['Apply No-Absence Rewrite']['main'][0] = [{'node': 'Prepare Background Sources', 'type': 'main', 'index': 0}]
C['Prepare Background Sources'] = {'main': [[{'node': 'Background Source LLM', 'type': 'main', 'index': 0}]]}
C['Background Source LLM'] = {'main': [[{'node': 'Apply Background Sources', 'type': 'main', 'index': 0}]]}
C['DeepSeek-BackgroundSource'] = {'ai_languageModel': [[{'node': 'Background Source LLM', 'type': 'ai_languageModel', 'index': 0}]]}
C['Apply Background Sources'] = {'main': [[{'node': 'Save Conversation State', 'type': 'main', 'index': 0}]]}
out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes; tgt['connections'] = C
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = C
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst, len(nodes))
