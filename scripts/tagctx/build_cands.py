# -*- coding: utf-8 -*-
"""判定试验的候选集：文档里取到的仪表位号（滤掉设备号、管径）+ 标准答案位号 + 画面表里叫法相近的 ≤4 个干扰位号；
新加进来的位号补查「位号.PV」上下文。改写 ctx_gather.json（原文件留 ctx_gather_name_only.json）。"""
import json, io, os, re, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_ctx as R
from probe import probe
G = json.load(io.open(os.path.join(HERE, 'ctx_gather.json'), encoding='utf-8'))
if not os.path.exists(os.path.join(HERE, 'ctx_gather_name_only.json')): shutil.copy(os.path.join(HERE, 'ctx_gather.json'), os.path.join(HERE, 'ctx_gather_name_only.json'))
INSTR = re.compile(r'^(?!DN|STD)[A-Z]{2,5}\d{3,5}[A-Z]?(?:_\d)?$')
def bigrams(s): s = re.sub(r'[^一-鿿]', '', s); return {s[i:i + 2] for i in range(len(s) - 1)}
need = set()
for name, unit, use, groups, none in R.TESTS:
    g = G[name]; ans = [t for gg in groups for t in gg]
    docs = [t for t in g['cands'] if INSTR.match(t)]
    qb = bigrams(name)
    near = sorted(((len(qb & bigrams(d)), t) for t, d in R.DESC.items() if t not in ans and t not in docs and len(qb & bigrams(d)) >= 2), reverse=True)[:4]
    c = []
    for t in docs + ans + [t for _, t in near]:
        if t not in c: c.append(t)
    g['doc_cands'] = docs; g['cands'] = c
    for t in c:
        if t not in g['ctx']: need.add(t)
res = {x['id']: x for x in probe([{'id': t, 'question': t + '.PV'} for t in sorted(need)])}
for g in G.values():
    for t in g['cands']:
        if t in g['ctx']: continue
        r = res.get(t, {}); sn = []
        for ch in r.get('chunks') or []:
            for x in R.snippets(t, ch['content'], 2): sn.append('《%s》%s' % (ch['doc'][:30], x))
            if len(sn) >= 4: break
        g['ctx'][t] = {'ms': r.get('ms'), 'n': r.get('n'), 'snips': sn[:4]}
json.dump(G, io.open(os.path.join(HERE, 'ctx_gather.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('补查', len(need))
for name, *_ in R.TESTS: print(name, G[name]['cands'], '| 无上下文', [t for t in G[name]['cands'] if not G[name]['ctx'][t]['snips']])
