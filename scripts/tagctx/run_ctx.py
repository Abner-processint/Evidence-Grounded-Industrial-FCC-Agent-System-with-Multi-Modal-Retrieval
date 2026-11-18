# -*- coding: utf-8 -*-
"""RAGFlow 上下文 + 相关位号辅助判定位号（离线试验，不改工作流）。
第一步 gather：每个量按量名查 RAGFlow → 片段里出现的位号按出现次数取前 N 个为「相关位号」；每个候选再按「位号.PV」查一次，
  留含该位号的表格行（<tr>…</tr>）或前后 160 字。结果存 ctx_gather.json。
第二步 judge：同一模型（核对试验台，温度 0）两种条件各跑 REP 遍：D = 只给画面位号表描述；R = 描述 + RAGFlow 上下文。结果存 ctx_judge.json。
用法：python run_ctx.py gather | judge | score"""
import json, io, os, re, sys, collections, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import requests
NCAND = int(os.environ.get('NCAND', '8')); REP = int(os.environ.get('REP', '2'))
DCS = json.load(io.open(os.environ['DCS_TABLE'], encoding='utf-8'))
DESC = {}
for rows in DCS['screens'].values():
    for r in rows:
        if r and r[0]: DESC.setdefault(str(r[0]).upper(), str(r[1] or ''))
# 标准答案：groups = 可接受的取法（每组内相加），任一组即对；none=True 表示应答「没有位号」
TESTS = [
    ('一再稀相密度', 'kg/m3', '计算一再稀相段压降', [['DR3110']], False),
    ('回炼油浆量', 't/h', '计算回炼比的分子', [['FRC3250']], False),
    ('柴油出装置流量', 't/h', '计算柴油收率的分子', [['FT3231']], False),
    ('新鲜进料量', 't/h', '收率的分母，进装置的新鲜原料油总量', [['FIC3260', 'FRC3226', 'FT3227']], False),
    ('一中回流流量', 't/h', '计算一中回流取热量', [['FRC3209'], ['FRC3208'], ['FRC3208', 'FRC3209']], False),
    ('一中回流返塔温度', '℃', '计算一中回流取热量', [['TI3220_1'], ['TI3240']], False),
    ('一中回流抽出温度', '℃', '计算一中回流取热量', [['TI3220_2']], False),
    ('一中回流油比热容', 'kJ/(kg·℃)', '计算一中回流取热量', [], True),
    ('粗汽油干点', '℃', '判断操作窗口', [], True),
    ('日加工量', 't/d', '月度处理量对比', [], True),
    ('反应压力', 'kPa', '判断反应条件', [['PR3112']], False),
    ('气压机反飞动阀开度', '%', '判断气压机工况', [['FZI3501']], False),
    ('柴油汽提蒸汽流量', 't/h', '判断柴油汽提', [['FRC3213']], False),
    ('溶剂再生塔底温度', '℃', '判断溶剂再生', [['TI3811']], False),
    ('溶剂再生塔重沸器蒸汽流量', 't/h', '判断溶剂再生', [['FR3810']], False),
    ('液化气出装置流量', 't/h', '计算液化气收率', [['FT3854'], ['FRC3309']], False),
    ('干气产量', 'Nm3/h', '计算干气产率', [['FR3811', 'FI3612A']], False),
    ('稳定汽油出装置总流量', 't/h', '计算汽油收率', [['FRC3307', 'FIC3350'], ['FI3307_1', 'FIC3350']], False),
    ('顶循回流量', 't/h', '分馏塔热平衡', [['FRC3204']], False),
    ('分馏塔底液位', '%', '判断塔底液位是否正常', [['LRC3201'], ['LRC3201A'], ['LRC3201B'], ['LT3201A'], ['LT3201B']], False),
    ('两器差压', 'kPa', '判断两器压力平衡', [['PDRA3125'], ['PDRA3125B']], False),
    ('提升管入口压力', 'kPa', '判断提升管工况', [], True),
    ('原料硫含量', '%', '原料性质', [], True),
    ('平衡剂活性', '', '催化剂性能', [], True),
    ('分馏塔进料流量', 't/h', '分馏塔物料平衡', [], True),
    ('二再藏量', 't', '判断二再藏量', [['WRCA3102']], False),
]
TAG_RE = re.compile(r'(?<![A-Za-z0-9])(?:[A-Z]{1,3}-)?([A-Z]{1,6}\d{3,5}[A-Z]?(?:_\d)?)(?![A-Za-z0-9])')


def snippets(tag, text, k=3):
    out = []
    for m in re.finditer(r'<tr>(?:(?!</tr>).)*?(?<![A-Za-z0-9])' + re.escape(tag) + r'(?![A-Za-z0-9_]).*?</tr>', text, re.S):
        row = re.sub(r'<[^>]+>', ' | ', m.group(0)); out.append(re.sub(r'(\s*\|\s*)+', ' | ', row).strip(' |')[:300])
        if len(out) >= k: return out
    for m in re.finditer(r'(?<![A-Za-z0-9])' + re.escape(tag) + r'(?![A-Za-z0-9_])', text):
        seg = re.sub(r'<[^>]+>', ' ', text[max(0, m.start() - 160):m.end() + 160]); out.append(re.sub(r'\s+', ' ', seg))
        if len(out) >= k: break
    return out


if __name__ == '__main__' and sys.argv[1] == 'gather':
    from probe import probe
    t0 = time.time()
    res1 = {x['id']: x for x in probe([{'id': t[0], 'question': t[0]} for t in TESTS])}
    G = {}
    for name, unit, use, groups, none in TESTS:
        r = res1.get(name, {}); cnt = collections.Counter(); first = {}
        for c in r.get('chunks') or []:
            for m in TAG_RE.finditer(c['content']):
                t = m.group(1); cnt[t] += 1; first.setdefault(t, len(first))
        cands = sorted(cnt, key=lambda t: (-cnt[t], first[t]))[:NCAND]
        G[name] = {'name_query_ms': r.get('ms'), 'name_chunks': [(c['doc'], round(c['sim'] or 0, 3)) for c in r.get('chunks') or []],
                   'name_snips': [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', c['content']))[:400] for c in (r.get('chunks') or [])[:4]],
                   'cands': cands, 'cand_counts': {t: cnt[t] for t in cands}, 'ctx': {}}
    allc = sorted({t for g in G.values() for t in g['cands']})
    res2 = {x['id']: x for x in probe([{'id': t, 'question': t + '.PV'} for t in allc])}
    for g in G.values():
        for t in g['cands']:
            r = res2.get(t, {}); sn = []
            for c in r.get('chunks') or []:
                for x in snippets(t, c['content'], 2): sn.append('《%s》%s' % (c['doc'][:30], x))
                if len(sn) >= 4: break
            g['ctx'][t] = {'ms': r.get('ms'), 'n': r.get('n'), 'snips': sn[:4]}
    json.dump(G, io.open(os.path.join(HERE, 'ctx_gather.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('gather done', round(time.time() - t0), 's; name queries', len(TESTS), 'tag queries', len(allc))

SYS = ('你在为催化裂化装置的问答系统确定「要取的量」对应实时数据库里的哪个位号（或哪几块表相加）。只根据给出的材料判断，不要编造位号。\n'
       '规则：一个量分几路、每路一块表时这几路放一组相加；同一路的两块表、或描述相同的冗余表是互为备选的不同组，不放在同一组；'
       '阀位、开度、累积量不能当流量；温度、压力不相加。材料里没有能直接测这个量的位号（例如只有化验分析、文档统计、物性参数），就回答没有。\n'
       '只输出 JSON：{"groups":[["位号",...],...],"none":true|false,"reason":"一句话"}。groups 为空且 none=true 表示没有位号。')


def user_msg(name, unit, use, g, with_ctx):
    lines = ['要取的量：%s（单位 %s；用途：%s）' % (name, unit or '无', use), '', '候选位号：']
    for t in g['cands']:
        lines.append('- %s：DCS 画面描述「%s」' % (t, DESC.get(t, '（画面表里没有）')))
        if with_ctx:
            for s in g['ctx'].get(t, {}).get('snips', [])[:3]: lines.append('    文档：' + s[:260])
    if with_ctx and g.get('name_snips'):
        lines += ['', '按量名检索到的文档片段（前 4 段，节选）：'] + ['  ' + s for s in g['name_snips']]
    return '\n'.join(lines)


if __name__ == '__main__' and sys.argv[1] == 'judge':
    G = json.load(io.open(os.path.join(HERE, 'ctx_gather.json'), encoding='utf-8'))
    s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
    HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
    items = [((name, cond), {'system': SYS, 'user': user_msg(name, unit, use, G[name], cond == 'R')})
             for name, unit, use, groups, none in TESTS for cond in 'DR' for _ in range(REP)]
    outs = []
    for i in range(0, len(items), 8):
        r = s.post(HOOK, json={'items': [x[1] for x in items[i:i + 8]]}, timeout=1800); r.raise_for_status(); b = r.json()
        outs += (b if isinstance(b, dict) else b[0])['outputs']; print('batch', i // 8 + 1, flush=True)
    json.dump({'keys': [k for k, _ in items], 'outs': outs, 'users': [x[1]['user'] for x in items]},
              io.open(os.path.join(HERE, 'ctx_judge.json'), 'w', encoding='utf-8'), ensure_ascii=False)

if __name__ == '__main__' and sys.argv[1] in ('judge', 'score'):
    G = json.load(io.open(os.path.join(HERE, 'ctx_gather.json'), encoding='utf-8'))
    J = json.load(io.open(os.path.join(HERE, 'ctx_judge.json'), encoding='utf-8'))
    T = {t[0]: t for t in TESTS}
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
    for (name, cond), o in zip(J['keys'], J['outs']):
        rows[(name, cond)].append(grade(o, T[name][3], T[name][4]))
    tot = collections.defaultdict(collections.Counter)
    print('量 | 答案进候选 | D 只给描述 | R 加上下文')
    for name, unit, use, groups, none in TESTS:
        need = {t for g in groups for t in g}
        recall = '—' if none else ('全' if all(any(t in G[name]['cands'] for t in g) for g in groups[:1]) else ('部分' if need & set(G[name]['cands']) else '无'))
        d = rows[(name, 'D')]; r = rows[(name, 'R')]
        for k in d: tot['D'][k[0]] += 1
        for k in r: tot['R'][k[0]] += 1
        print(name, '|', recall, '|', [x[0] for x in d], d[0][1], '|', [x[0] for x in r], r[0][1])
    print('合计 D', dict(tot['D']), '| R', dict(tot['R']))
