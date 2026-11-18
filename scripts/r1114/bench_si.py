# -*- coding: utf-8 -*-
"""毫米换米试验：把已记录的「Derived Quantity LLM」提示词里的装置模型事实改写后原样重放（核对试验台，同模型、温度 0）。
  A = 原样（mm）；B = 代码把 mm 事实换成 m（value/1000、unit m），别的不动；C = B 再加 converted_from:"30000 mm"。
判：按模型写的式子、用该变体里的事实数值代入（rho=24.7255、g=9.80665），取压口那条 ≈1.018 kPa 为 ok，×1000 / ÷1000 分别记 x1000 / d1000。
非稀相题只记式子，看 A/B 是否一样。用法：LOCAL_EXEC_DIR=... NREP=4 python bench_si.py <execId> ..."""
import json, io, os, re, sys, collections, concurrent.futures as cf
import requests
HERE = os.path.dirname(os.path.abspath(__file__)); LOCAL = os.environ['LOCAL_EXEC_DIR']; N = int(os.environ.get('NREP', '4'))
HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
HEAD = 'Already retrieved Plant Model facts (use exact references; do not invent values):\n'


def prompt(i):
    rd = json.load(io.open(os.path.join(LOCAL, 'e_%s.json' % i), encoding='utf-8'))['data']['resultData']['runData']
    for n, runs in rd.items():
        for r in runs:
            src = ((r.get('source') or [{}])[0] or {}).get('previousNode')
            if src == 'Derived Quantity LLM' and 'ai_languageModel' in (r.get('inputOverride') or {}):
                m = r['inputOverride']['ai_languageModel'][0][0]['json']['messages'][0]; k = m.index('\nHuman: ')
                return m[len('System: '):k], m[k + len('\nHuman: '):]


def split(user):
    a = user.index(HEAD) + len(HEAD); dec = json.JSONDecoder(); facts, end = dec.raw_decode(user, a)
    return user[:a], facts, user[end:]


def variant(user, v):
    pre, facts, post = split(user)
    if v == 'A': return user, facts
    out = []
    for f in facts:
        f = dict(f)
        if str(f.get('unit', '')).strip().lower() == 'mm' and isinstance(f.get('value'), (int, float)):
            src = f['value']; f['value'] = round(src / 1000, 6); f['unit'] = 'm'
            if v == 'C': f['converted_from'] = '%g mm' % src
        out.append(f)
    return pre + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + post, out


def judge(text, facts):
    try:
        a, b = text.find('{'), text.rfind('}'); j = json.loads(text[a:b + 1])
    except Exception: return 'F', []
    V = {(f.get('equipment_tag'), f.get('field_path')): f.get('value') for f in facts}
    kinds, exprs = [], []
    for d in j.get('derived_quantities', []):
        vs = d.get('variables', []); exprs.append(d.get('expression'))
        refs = [((v.get('plant_model_ref') or {}).get('equipment_tag'), (v.get('plant_model_ref') or {}).get('field_path')) for v in vs]
        if not any(r in V for r in refs): continue
        env = {}
        for v, r in zip(vs, refs):
            env[v['symbol']] = V.get(r, 9.80665 if re.match(r'^g', v['symbol']) else 24.7255)
        try: x = eval(re.sub(r'\^', '**', d['expression']), {'__builtins__': {}}, env)
        except Exception: kinds.append('E'); continue
        if any(r[0] == 'DR3110' for r in refs):
            kinds.append('ok' if 0.5 < x < 2 else ('x1000' if 500 < x < 2000 else ('d1000' if 5e-4 < x < 2e-3 else 'other:%.4g' % x)))
        else: kinds.append('zone')
    k = 'ok' if 'ok' in kinds else ('x1000' if 'x1000' in kinds else ('d1000' if 'd1000' in kinds else ('|'.join(kinds) or 'none')))
    return k, exprs


if __name__ == '__main__':
    s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
    items = []
    for i in sys.argv[1:]:
        p = prompt(i)
        if not p: print('no prompt', i); continue
        for v in os.environ.get('VARIANTS', 'ABC'):
            u, facts = variant(p[1], v)
            items += [((i, v), {'system': p[0], 'user': u}, facts)] * N


    def post(chunk):
        r = s.post(HOOK, json={'items': [x[1] for x in chunk]}, timeout=1800); r.raise_for_status(); b = r.json()
        return (b if isinstance(b, dict) else b[0])['outputs']


    chunks = [items[k:k + 8] for k in range(0, len(items), 8)]
    with cf.ThreadPoolExecutor(3) as ex: outs = [o for res in ex.map(post, chunks) for o in res]
    res = collections.defaultdict(list); ex_ = collections.defaultdict(list)
    for (key, _, facts), o in zip(items, outs):
        k, e = judge(o, facts); res[key].append(k); ex_[key].append(e)
    tag = os.environ.get('OUT', 'bench_si_out')
    json.dump({'res': {'%s_%s' % k: v for k, v in res.items()}, 'expr': {'%s_%s' % k: v for k, v in ex_.items()}, 'outs': outs},
              io.open(os.path.join(HERE, tag + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    tot = collections.defaultdict(collections.Counter)
    for (i, v), ks in sorted(res.items()):
        print(i, v, dict(collections.Counter(ks))); tot[v].update(ks)
    for v in sorted(tot): print('合计', v, dict(tot[v]))
