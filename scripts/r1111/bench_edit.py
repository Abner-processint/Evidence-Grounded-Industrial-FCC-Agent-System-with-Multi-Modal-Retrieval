# -*- coding: utf-8 -*-
"""改稿一步离线重放：从本地执行记录取每次 Answer Edit 的原输入，现行提示词 vs 候选提示词各跑 N 遍（试验台 v3hpJcnpnggzfXNj，同型号温度 0）。
用法：python bench_edit.py <main.json> <e_*.json ...>；结果写 bench_edit_out.json。"""
import json, io, sys, os, glob, re, time, requests
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'tools'))
from edit_prompt import patch_system, patch_text
N_REP = int(os.environ.get('NREP', '3'))
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
m = json.load(io.open(sys.argv[1], encoding='utf-8')); NN = {n['name']: n for n in m['activeVersion']['nodes']}
ep = NN['Answer Edit LLM']['parameters']; SYS0 = ep['options']['systemMessage']; TXT0 = ep['text']
SYS1, TXT1 = patch_system(SYS0), patch_text(TXT0)
js = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))
def render(tpl, pk):
    t = tpl[1:] if tpl.startswith('=') else tpl
    t = t.replace('{{ $json.answer_edit_packet.question }}', pk['question']).replace('{{ $json.answer_edit_packet.draft }}', pk['draft'])
    for k in ('findings', 'evidence', 'thresholds'):
        t = t.replace('{{ JSON.stringify($json.answer_edit_packet.%s) }}' % k, js(pk[k]))
    t = t.replace('{{ JSON.stringify($json.answer_edit_packet.earlier_turns || []) }}', js(pk.get('earlier_turns', [])))
    assert '{{' not in t, t[:200]
    return t
cases = []
for f in sys.argv[2:]:
    e = json.load(io.open(f, encoding='utf-8')); rd = e['data']['resultData']['runData']
    crps = rd.get('Compact Result Projector', [])
    cc = {}
    for r in crps:
        cc = r['data']['main'][0][0]['json'].get('finalizer_payload', {}).get('conversation_consistency_context') or cc
    earlier = [{'turn_ref': t.get('turn_ref'), 'question': t.get('question'), 'told_user': t.get('confirmed_answer_context')} for t in (cc or {}).get('matched_turns', [])]
    for k, r in enumerate(rd.get('Prepare Answer Edit', [])):
        pk = dict(r['data']['main'][0][0]['json']['answer_edit_packet']); old = rd['Answer Edit LLM'][k]['data']['main'][0][0]['json'].get('output', '')
        pk1 = dict(pk, earlier_turns=earlier)
        cases.append({'case': os.path.basename(f)[2:-5] + '#%d' % k, 'live': old,
                      'u0': render(TXT0, pk), 'u1': render(TXT1, pk1), 'n_earlier': len(earlier)})
print('cases', [(c['case'], c['n_earlier']) for c in cases])
items = []
for c in cases:
    for rep in range(N_REP):
        items.append({'system': SYS0, 'user': c['u0']}); items.append({'system': SYS1, 'user': c['u1']})
outs = []
for i in range(0, len(items), 8):
    r = s.post(HOOK, json={'items': items[i:i + 8]}, timeout=900); r.raise_for_status()
    outs += r.json()['outputs'] if isinstance(r.json(), dict) else r.json()[0]['outputs']
    print('batch', i // 8, 'ok', flush=True)
res = []
for ci, c in enumerate(cases):
    o = outs[ci * 2 * N_REP:(ci + 1) * 2 * N_REP]
    res.append({'case': c['case'], 'live': c['live'], 'cur': o[0::2], 'new': o[1::2]})
json.dump(res, io.open(os.path.join(HERE, 'bench_edit_out.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(res))
