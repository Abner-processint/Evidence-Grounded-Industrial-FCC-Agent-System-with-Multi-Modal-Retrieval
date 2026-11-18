# -*- coding: utf-8 -*-
"""计算量一步的毫米换米漏除：把主线 / 副本稀相第 3 轮「Derived Quantity LLM」实际提示词原样重放 N 遍，
按模型写的式子代入（rho=24.7255，DR3110 取压口 30000/25800、span 4200；稀相上下界 39650/25800），看取压口跨距那条算出 ≈1.018 还是 ≈1018。"""
import json, io, os, re, sys, requests, collections
HERE = os.path.dirname(os.path.abspath(__file__)); LOCAL = os.environ['LOCAL_EXEC_DIR']
N = int(os.environ.get('NREP', '8'))
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
VAL = {'taps.hi.el_mm': 30000, 'taps.lo.el_mm': 25800, 'span_mm': 4200, 'zones.dilute.top_el_mm': 39650, 'zones.dilute.bottom_el_mm': 25800}


def prompt(i):
    rd = json.load(io.open(os.path.join(LOCAL, 'e_%s.json' % i), encoding='utf-8'))['data']['resultData']['runData']
    for n, runs in rd.items():
        for r in runs:
            src = ((r.get('source') or [{}])[0] or {}).get('previousNode')
            if src == 'Derived Quantity LLM' and 'ai_languageModel' in (r.get('inputOverride') or {}):
                m = r['inputOverride']['ai_languageModel'][0][0]['json']['messages'][0]
                k = m.index('\nHuman: '); return m[len('System: '):k], m[k + len('\nHuman: '):]


def judge(o):
    try:
        a, b = o.find('{'), o.rfind('}'); j = json.loads(o[a:b + 1])
    except Exception: return 'F'
    for d in j.get('derived_quantities', []):
        vs = d.get('variables', [])
        if not any((v.get('plant_model_ref') or {}).get('equipment_tag') == 'DR3110' for v in vs): continue
        env = {}
        for v in vs:
            fp = (v.get('plant_model_ref') or {}).get('field_path')
            env[v['symbol']] = VAL.get(fp, 24.7255) if fp else 24.7255
        try:
            x = eval(re.sub(r'\^', '**', d['expression']), {'__builtins__': {}}, env)
        except Exception: return 'E'
        return 'ok' if 0.5 < x < 2 else ('x1000' if 500 < x < 2000 else 'other:%g' % x)
    return 'none'


V = {}
for tag, i in [('main_197659', 197659), ('main_197660', 197660), ('copy_198520', 198520), ('copy_198521', 198521), ('copy_198516', 198516)]:
    p = prompt(i)
    if p: V[tag] = p
    else: print('no prompt', tag)
items = [(k, {'system': v[0], 'user': v[1]}) for k, v in V.items() for _ in range(N)]
outs = []
for i in range(0, len(items), 8):
    r = s.post(HOOK, json={'items': [x[1] for x in items[i:i + 8]]}, timeout=1800); r.raise_for_status(); b = r.json()
    outs += (b if isinstance(b, dict) else b[0])['outputs']; print('batch', i // 8 + 1, flush=True)
res = collections.defaultdict(list)
for (k, _), o in zip(items, outs): res[k].append(judge(o))
json.dump({'res': res, 'outs': outs}, io.open(os.path.join(HERE, 'bench_dq_unit_out.json'), 'w', encoding='utf-8'), ensure_ascii=False)
for k in V: print(k, collections.Counter(res[k]))
