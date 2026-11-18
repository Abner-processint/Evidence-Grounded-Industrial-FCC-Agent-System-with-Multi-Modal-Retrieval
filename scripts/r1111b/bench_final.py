# -*- coding: utf-8 -*-
"""定稿首稿离线重放：从本地执行记录取 Answer Finalizer LLM 首次调用的输入（Compact Result Projector 首轮输出），
按节点模板拼用户消息，现行 vs 加 SOURCE_STATEMENT_SCOPE_V1 各 N 遍（试验台同型号温度 0）。
用法：python bench_final.py <main.json> <e_*.json ...>；结果写 bench_final_out.json。"""
import json, io, sys, os, re, requests
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from final_prompt import patch_finalizer
N_REP = int(os.environ.get('NREP', '2'))
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
m = json.load(io.open(sys.argv[1], encoding='utf-8')); NN = {n['name']: n for n in m['activeVersion']['nodes']}
P = NN['Answer Finalizer LLM']['parameters']; SYS0 = P['options']['systemMessage']; SYS1 = patch_finalizer(SYS0)
js2 = lambda v: json.dumps(v, ensure_ascii=False, indent=2)
def render(j, orig):
    q = j.get('originalUserMessage') or orig or ''
    return ('Original question:\n' + q + '\n\nTarget answer language:\n' + ('Chinese' if re.search('[一-鿿]', q) else 'English') +
            '\n\nAnswer mode:\n' + (j.get('answer_mode') or '') +
            '\n\nStructured aggregated payload:\n' + js2(j.get('finalizer_payload') or j.get('aggregated_payload') or {}) +
            '\n\nEvidence packet:\n' + js2(j.get('evidence_packet') or []) +
            '\n\nTag evidence status:\n' + js2(j.get('tag_evidence_status') or {}) +
            '\n\nEstablished thresholds:\n' + js2(j.get('established_thresholds') or []) +
            '\n\nFINALIZER_PROMPT_DEDUP_V5:\nApply all rules from the system message. Return only the required JSON object.')
assert P['text'].count('{{') == 7, P['text'].count('{{')  # 模板若改了，这里要跟着改
cases = []
for f in sys.argv[2:]:
    rd = json.load(io.open(f, encoding='utf-8'))['data']['resultData']['runData']
    j = rd['Compact Result Projector'][0]['data']['main'][0][0]['json']
    orig = rd['Capture context'][0]['data']['main'][0][0]['json'].get('originalUserMessage', '')
    live = rd['Answer Finalizer LLM'][0]['data']['main'][0][0]['json'].get('output', '')
    cases.append({'case': os.path.basename(f)[2:-5], 'user': render(j, orig), 'live': live})
print('cases', [(c['case'], len(c['user'])) for c in cases], flush=True)
items = []
for c in cases:
    for _ in range(N_REP): items += [{'system': SYS0, 'user': c['user']}, {'system': SYS1, 'user': c['user']}]
outs = []
for i in range(0, len(items), 8):
    r = s.post(HOOK, json={'items': items[i:i + 8]}, timeout=1800); r.raise_for_status(); b = r.json()
    outs += (b if isinstance(b, dict) else b[0])['outputs']; print('batch', i // 8, '/', (len(items) + 7) // 8, flush=True)
res = [{'case': c['case'], 'live': c['live'], 'cur': outs[k * 2 * N_REP:(k + 1) * 2 * N_REP][0::2], 'new': outs[k * 2 * N_REP:(k + 1) * 2 * N_REP][1::2]} for k, c in enumerate(cases)]
json.dump(res, io.open(os.path.join(HERE, 'bench_final_out.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(res))
