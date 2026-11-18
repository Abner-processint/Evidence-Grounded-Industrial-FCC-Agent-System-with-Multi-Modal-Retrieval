# -*- coding: utf-8 -*-
"""核对一步离线重放：本地执行记录里每段核对的原输入（Split Verification Parts 的 verify_user），现行 vs 候选（ABDICATION_SCOPE_V1）各 N 遍。
用法：python bench_verify.py <main.json> <e_*.json ...>；结果写 bench_verify_out.json。"""
import json, io, sys, os, requests
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from edit_prompt import patch_verifier
N_REP = int(os.environ.get('NREP', '3'))
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
m = json.load(io.open(sys.argv[1], encoding='utf-8')); NN = {n['name']: n for n in m['activeVersion']['nodes']}
SYS0 = NN['Answer Verification LLM']['parameters']['options']['systemMessage']; SYS1 = patch_verifier(SYS0)
cases = []
for f in sys.argv[2:]:
    rd = json.load(io.open(f, encoding='utf-8'))['data']['resultData']['runData']
    for k, r in enumerate(rd.get('Split Verification Parts', [])):
        outs = rd['Answer Verification LLM'][k]['data']['main'][0]
        for j, it in enumerate(r['data']['main'][0]):
            u = it['json'].get('verify_user')
            if not u or u.startswith('TASK: QUESTION COVERAGE'): continue
            cases.append({'case': '%s#%d.%d' % (os.path.basename(f)[2:-5], k, j), 'user': u, 'live': outs[j]['json'].get('output', '') if j < len(outs) else ''})
print('parts', len(cases), flush=True)
items = []
for c in cases:
    for rep in range(N_REP): items += [{'system': SYS0, 'user': c['user']}, {'system': SYS1, 'user': c['user']}]
outs = []
for i in range(0, len(items), 8):
    r = s.post(HOOK, json={'items': items[i:i + 8]}, timeout=900); r.raise_for_status(); b = r.json()
    outs += (b if isinstance(b, dict) else b[0])['outputs']; print('batch', i // 8, '/', (len(items) + 7) // 8, flush=True)
res = [{'case': c['case'], 'live': c['live'], 'cur': outs[i * 2 * N_REP:(i + 1) * 2 * N_REP][0::2], 'new': outs[i * 2 * N_REP:(i + 1) * 2 * N_REP][1::2]} for i, c in enumerate(cases)]
json.dump(res, io.open(os.path.join(HERE, 'bench_verify_out.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(res))
