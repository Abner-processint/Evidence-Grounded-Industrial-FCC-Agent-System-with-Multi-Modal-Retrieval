# -*- coding: utf-8 -*-
"""r1120v：BACKGROUND_SOURCE_VERIFY_V1（在 r1120k 之上）。
① Apply Background Sources 换成新版（多输出 bg_books / bg_marks 给下一步）；
② 在 Apply Background Sources 与 Save Conversation State 之间加：Prepare Source Check（按书名找库里文档、限定该书检索原文）→ Source Check LLM（DeepSeek-SourceCheck，温度 0，判 full / partial / none 并引原文句）
   → Apply Source Check（full 且引句核对无误的句子 [K#] → [E#]，数据依据补原文摘录，剩余 K 重新编号）。
RAGFlow 地址与密钥：从本工作流 Grouped RAGFlow Retrieval 节点代码里原样搬 readConfig / defaultBaseUrl / defaultApiKey 三段，脚本不打印。
用法：python r1120v_build.py <in.json> <out.json>"""
import sys, io, json, os, re, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'r1120k'))
from src_check import JSYS, PREP_JS, APPLY_JS
from bg_source import APPLY_JS as BG_APPLY_JS
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); C = json.loads(json.dumps(av['connections'])); N = {n['name']: n for n in nodes}
assert 'Prepare Source Check' not in N and 'Apply Background Sources' in N
g = N['Grouped RAGFlow Retrieval']['parameters']['jsCode']
cfg = (re.search(r"function readConfig\(name, fallback = ''\) \{[\s\S]*?\n\}\n", g).group(0) + re.search(r"const defaultBaseUrl =[\s\S]*?;\n", g).group(0)
       + re.search(r"const defaultApiKey =[\s\S]*?;\n", g).group(0))
N['Apply Background Sources']['parameters']['jsCode'] = BG_APPLY_JS
uid = lambda s: str(uuid.uuid5(uuid.NAMESPACE_URL, 'r1120v/' + s))
px, py = N['Save Conversation State']['position']
cred = N['DeepSeek-BackgroundSource']['credentials']
for nm in ('Save Conversation State', 'Store Conversation State', 'Restore Chat Output'):
    N[nm]['position'] = [N[nm]['position'][0] + 900, N[nm]['position'][1]]
nodes += [
    {'id': uid('prep'), 'name': 'Prepare Source Check', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [px, py], 'parameters': {'jsCode': PREP_JS.replace('__CFG__', cfg)}},
    {'id': uid('llm'), 'name': 'Source Check LLM', 'type': '@n8n/n8n-nodes-langchain.agent', 'typeVersion': 3.1, 'position': [px + 250, py],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 5000, 'onError': 'continueRegularOutput',
     'parameters': {'promptType': 'define', 'text': '={{ $json.src_check_user }}', 'options': {'systemMessage': JSYS}}},
    {'id': uid('model'), 'name': 'DeepSeek-SourceCheck', 'type': '@n8n/n8n-nodes-langchain.lmChatDeepSeek', 'typeVersion': 1, 'position': [px + 250, py + 200],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 15000, 'credentials': cred, 'parameters': {'options': {'temperature': 0}}},
    {'id': uid('apply'), 'name': 'Apply Source Check', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [px + 550, py], 'parameters': {'jsCode': APPLY_JS}},
]
lst = C['Apply Background Sources']['main'][0]
assert [e['node'] for e in lst] == ['Save Conversation State'], lst
C['Apply Background Sources']['main'][0] = [{'node': 'Prepare Source Check', 'type': 'main', 'index': 0}]
C['Prepare Source Check'] = {'main': [[{'node': 'Source Check LLM', 'type': 'main', 'index': 0}]]}
C['Source Check LLM'] = {'main': [[{'node': 'Apply Source Check', 'type': 'main', 'index': 0}]]}
C['DeepSeek-SourceCheck'] = {'ai_languageModel': [[{'node': 'Source Check LLM', 'type': 'ai_languageModel', 'index': 0}]]}
C['Apply Source Check'] = {'main': [[{'node': 'Save Conversation State', 'type': 'main', 'index': 0}]]}
out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes; tgt['connections'] = C
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = C
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst, len(nodes))
