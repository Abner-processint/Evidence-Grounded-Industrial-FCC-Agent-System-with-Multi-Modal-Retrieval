# -*- coding: utf-8 -*-
"""跨轮换表核对离线重放：从本地执行记录取首稿的对照问题输入（Prepare Answer Verification 首轮输出），
补上 answered_turns（定稿用的同一份 conversation_consistency_context.matched_turns），用改后的 Split Verification Parts 代码拼消息，
在试验台（同型号温度 0）跑 N 遍。用法：python bench_xturn.py <main.json> <e_*.json ...>；结果写 bench_xturn_out.json。"""
import json, io, sys, os, subprocess, shutil, tempfile, requests
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from xturn_prompt import patch_svp
N_REP = int(os.environ.get('NREP', '3'))
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
m = json.load(io.open(sys.argv[1], encoding='utf-8')); NN = {n['name']: n for n in m['activeVersion']['nodes']}
SYS = NN['Answer Verification LLM']['parameters']['options']['systemMessage']
SVP = patch_svp(NN['Split Verification Parts']['parameters']['jsCode'])
NODE = shutil.which('node')
cases = []
for f in sys.argv[2:]:
    rd = json.load(io.open(f, encoding='utf-8'))['data']['resultData']['runData']
    pav = rd['Prepare Answer Verification'][0]['data']['main'][0][0]['json']
    if not pav.get('question_coverage_packet'): continue
    crp = rd['Compact Result Projector'][0]['data']['main'][0][0]['json']
    cc = (crp.get('finalizer_payload') or {}).get('conversation_consistency_context') or {}
    at = [{'turn_ref': t.get('turn_ref'), 'question': t.get('question'), 'told_user': t.get('confirmed_answer_context')}
          for t in cc.get('matched_turns', []) if t.get('confirmed_answer_context')]
    if not at: continue
    it = dict(pav); it['question_coverage_packet'] = dict(pav['question_coverage_packet'], answered_turns=at)
    js = 'const __I=' + json.dumps(it, ensure_ascii=False) + ';\nconst $input={first:()=>({json:__I})};\nconst __r=(function(){\n' + SVP + \
         '\n})();\nconst q=__r.find(x=>x.json.verify_task==="question_coverage");process.stdout.write(JSON.stringify(q?q.json.verify_user:""));'
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as fh: fh.write(js); p = fh.name
    r = subprocess.run([NODE, p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
    assert r.returncode == 0, r.stderr[:500]
    u = json.loads(r.stdout); assert 'CROSS_TURN_CHECK_V1' in u and 'Earlier answered turns' in u
    live = ''
    for it2 in rd['Answer Verification LLM'][0]['data']['main'][0]:
        o = it2['json'].get('output', '')
        if '"needs"' in o: live = o
    cases.append({'case': os.path.basename(f)[2:-5], 'user': u, 'live': live, 'turns': [t['turn_ref'] for t in at]})
print('cases', [c['case'] for c in cases], flush=True)
items = [{'system': SYS, 'user': c['user']} for c in cases for _ in range(N_REP)]
outs = []
for i in range(0, len(items), 8):
    r = s.post(HOOK, json={'items': items[i:i + 8]}, timeout=900); r.raise_for_status(); b = r.json()
    outs += (b if isinstance(b, dict) else b[0])['outputs']; print('batch', i // 8, '/', (len(items) + 7) // 8, flush=True)
res = [{'case': c['case'], 'turns': c['turns'], 'live': c['live'], 'new': outs[k * N_REP:(k + 1) * N_REP], 'user': c['user']} for k, c in enumerate(cases)]
json.dump(res, io.open(os.path.join(HERE, 'bench_xturn_out.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(res))
