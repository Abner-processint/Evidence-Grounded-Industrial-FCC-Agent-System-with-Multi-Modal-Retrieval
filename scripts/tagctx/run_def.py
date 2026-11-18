# -*- coding: utf-8 -*-
"""重测：判定时只给「定义类来源」的上下文（报警位号表、DCS 控制点统计表、仪表信息收集表、调研问题、装置级工艺卡片），
不用规程操作步骤、月报、教科书、事件报告。候选集沿用 ctx_gather.json（含标准答案与干扰位号）。
gather：每个候选按「位号.PV」查 page_size 20（每批 4 条，防并发丢结果），原始片段存 def_raw.json，只留定义类文档的行；
       量名也重查一次，只留定义类片段。
judge：三种条件各 REP 遍——D 只给描述；F 描述 + 定义类上下文（没有条目的位号写明「定义类资料里没有该位号的条目」）；
       F0 同 F 但没有条目的位号不写说明（看那句说明本身有没有影响）。
用法：python run_def.py gather | judge | score"""
import json, io, os, re, sys, collections, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_ctx as R
REP = int(os.environ.get('REP', '3'))
DEF = re.compile(r'报警位号|DCS显示控制点统计|仪表工业安全信息收集|调研问题|工艺卡片')
G = json.load(io.open(os.path.join(HERE, 'ctx_gather.json'), encoding='utf-8'))

if __name__ == '__main__' and sys.argv[1] == 'gather':
    from probe import probe
    t0 = time.time(); raw = {}
    tags = sorted({t for g in G.values() for t in g['cands']})
    qs = [{'id': 'T:' + t, 'question': t + '.PV', 'page_size': 20} for t in tags] + [{'id': 'N:' + n, 'question': n, 'page_size': 20} for n, *_ in R.TESTS]
    for i in range(0, len(qs), 4):
        for x in probe(qs[i:i + 4]): raw[x['id']] = x
    zero = [k for k, v in raw.items() if not v.get('n')]
    for k in zero:  # 空结果再单条重查一次
        raw[k] = probe([q for q in qs if q['id'] == k])[0]
    json.dump(raw, io.open(os.path.join(HERE, 'def_raw.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    D = {}
    for name, *_ in R.TESTS:
        g = G[name]; ctx = {}
        for t in g['cands']:
            sn = []
            for ch in raw.get('T:' + t, {}).get('chunks') or []:
                if not DEF.search(ch['doc']): continue
                for x in R.snippets(t, ch['content'], 2):
                    s = '《%s》%s' % (ch['doc'][:30], x)
                    if s not in sn: sn.append(s)
                if len(sn) >= 4: break
            ctx[t] = sn[:4]
        nm = [ '《%s》%s' % (ch['doc'][:30], re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' | ', ch['content']))[:400])
               for ch in raw.get('N:' + name, {}).get('chunks') or [] if DEF.search(ch['doc'])][:4]
        D[name] = {'ctx': ctx, 'name_snips': nm}
    json.dump(D, io.open(os.path.join(HERE, 'def_ctx.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    still0 = [k for k, v in raw.items() if not v.get('n')]
    have = sum(1 for d in D.values() for v in d['ctx'].values() if v); tot = sum(len(d['ctx']) for d in D.values())
    print('gather', round(time.time() - t0), 's; queries', len(qs), '; still empty', len(still0), still0[:10], '; 候选有定义类条目', have, '/', tot)


def user_msg(name, unit, use, cond):
    g = G[name]; d = DC[name]
    lines = ['要取的量：%s（单位 %s；用途：%s）' % (name, unit or '无', use), '', '候选位号：']
    for t in g['cands']:
        lines.append('- %s：DCS 画面描述「%s」' % (t, R.DESC.get(t, '（画面表里没有）')))
        if cond in ('F', 'F0'):
            sn = d['ctx'].get(t) or []
            for s in sn[:3]: lines.append('    定义类资料：' + s[:260])
            if not sn and cond == 'F': lines.append('    定义类资料：（没有该位号的条目，不代表该位号不对）')
    if cond in ('F', 'F0') and d['name_snips']:
        lines += ['', '按量名在定义类资料里检索到的片段（节选）：'] + ['  ' + s for s in d['name_snips']]
    return '\n'.join(lines)


if __name__ == '__main__' and sys.argv[1] in ('judge', 'score'):
    import requests
    DC = json.load(io.open(os.path.join(HERE, 'def_ctx.json'), encoding='utf-8'))
    OUT = os.path.join(HERE, 'def_judge.json')
    if sys.argv[1] == 'judge':
        s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
        HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
        items = [((name, cond), {'system': R.SYS, 'user': user_msg(name, unit, use, cond)})
                 for name, unit, use, groups, none in R.TESTS for cond in ('D', 'F', 'F0') for _ in range(REP)]
        outs = []
        for i in range(0, len(items), 8):
            r = s.post(HOOK, json={'items': [x[1] for x in items[i:i + 8]]}, timeout=1800); r.raise_for_status(); b = r.json()
            outs += (b if isinstance(b, dict) else b[0])['outputs']
        json.dump({'keys': [k for k, _ in items], 'outs': outs, 'users': [x[1]['user'] for x in items]}, io.open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    J = json.load(io.open(OUT, encoding='utf-8'))
    T = {t[0]: t for t in R.TESTS}

    def grade(o, groups, none):
        try:
            a, b = o.find('{'), o.rfind('}'); j = json.loads(o[a:b + 1])
        except Exception: return 'F', None
        gs = [sorted({str(x).upper().split('.')[0] for x in g}) for g in j.get('groups') or [] if g]
        ok = [sorted(g) for g in groups]
        if none: return ('对' if not gs else '错'), gs
        if not gs: return '漏', gs
        good = [g for g in gs if g in ok]
        return ('对' if good and len(good) == len(gs) else ('混' if good else '错')), gs
    rows = collections.defaultdict(list)
    for (name, cond), o in zip(J['keys'], J['outs']): rows[(name, cond)].append(grade(o, T[name][3], T[name][4]))
    tot = collections.defaultdict(collections.Counter)
    print('量 | 答案有定义类条目 | D | F | F0')
    for name, unit, use, groups, none in R.TESTS:
        ans = [t for gg in groups for t in gg]
        hasdef = '—' if none else '%d/%d' % (sum(1 for t in ans if DC[name]['ctx'].get(t)), len(ans))
        cells = []
        for cond in ('D', 'F', 'F0'):
            xs = rows[(name, cond)]
            for k in xs: tot[cond][k[0]] += 1
            cells.append('%s %s' % (''.join(k[0] for k in xs), xs[0][1]))
        print(name, '|', hasdef, '|', ' | '.join(cells))
    for cond in ('D', 'F', 'F0'): print('合计', cond, dict(tot[cond]))
