# -*- coding: utf-8 -*-
"""「同一个量资料里有多个值」并列核对的离线试验（工作流未改）。用基线回答 + 该次执行的证据包（显示编号已映射）。
1 抽取：回答正文里的关键取值 {对象, 属性, 数值, 引用}；
2 代码：按对象里的位号 / 设备号 / 名称在本轮全部证据里找片段（不限于所引编号）；
3 判定：片段里是否有同一对象同一属性、不同的值（不同工况 / 不同时段 / 不同档位不算）；
4 输出需要并列的条目。量：已知矛盾题里能否找出另一个值；每份回答报出多少条（看是否乱报）。
用法：python value_bench.py [题号前缀，逗号分隔]"""
import json, io, os, sys, re, glob, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import score as S  # noqa

XSYS = ('从催化裂化问答系统的回答正文里抽出本装置的关键取值：必须是本装置某个位号或某台设备的规定值或参数，如报警值 / 联锁值 / 控制指标 / 工艺卡片范围 / 量程 / 设计参数 / 标高 / 设定值。'
        '不要列：实测统计值（均值、最大最小、最新值、样本数）、由回答自己计算出的结果、教材或通识资料里的一般数值与算例、公式系数。每条：object（必须含位号或设备号，如「WRCA3101」「R1104」）、'
        'attribute（属性，如「HH 报警」「工艺卡片范围」「量程」）、value（原文数值带单位）、cited（该句引用的 E 编号）、terms（2–4 个检索词：位号、设备号必须在内）。最多 15 条。'
        '只输出 JSON：{"values":[{"object":"","attribute":"","value":"","cited":["E1"],"terms":[""]}]}')
JSYS = ('判断资料片段里是否给出与回答不同的取值：同一位号或设备、同一属性（同一档报警、同一种指标），数值不同。以下都不算不同：不同工况或步骤（开工、停工、恢复开工、事故处理里的临时值 vs 正常操作值）、不同时段、'
        '不同档位（H 与 HH）、不同设备或位号、实测统计值、教材算例或其他装置的数、单位换算后相同、回答的值本身也在该片段里且片段另一个值属于别的属性。'
        '对每条回答取值输出：{"i":序号,"conflict":true|false,"other_value":"另一个值（带单位）","source":"片段的文档名","evidence_id":"E编号","quote":"片段原文 ≤60 字"}。'
        '只输出 JSON：{"results":[...]}')


def ev_texts(k, EXEC='exec'):
    X = json.load(io.open(os.path.join(HERE, EXEC, k + '.json'), encoding='utf-8'))
    orig = {x['evidence_id']: x for x in X.get('crp_packet') or []}
    inv = {o: d for o, d in (X.get('display_map') or {}).items()}
    out = []
    for oid, x in orig.items():
        txt = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' | ', ' '.join(str(x.get(f) or '') for f in ('snippet', 'content_summary', 'key_values'))))
        out.append((inv.get(oid, oid + '*'), x.get('document_name') or x.get('dataset_name') or '', txt))
    return out


def find_snips(texts, terms, half=160, cap=6):
    hits = []
    for eid, doc, t in texts:
        score = sum(1 for w in terms if w and w in t)
        if not score: continue
        w0 = next(w for w in terms if w and w in t); i = t.find(w0)
        hits.append((score, eid, doc, t[max(0, i - half):i + half]))
    hits.sort(key=lambda x: -x[0])
    return hits[:cap]


if __name__ == '__main__':
    flt = tuple(x for x in (sys.argv[1].split(',') if len(sys.argv) > 1 else ['']))
    runs = [p for p in sorted(glob.glob(os.path.join(HERE, 'runs', '*.json'))) if os.path.basename(p).startswith(flt)]
    A = {S.run_key(p): str(json.load(io.open(p, encoding='utf-8'))['answer']) for p in runs}
    keys = list(A)
    body = lambda t: t[:t.find('\n#### ')] if '\n#### ' in t else t
    ex = S.bench([{'system': XSYS, 'user': body(A[k])[:14000]} for k in keys])
    items, ikeys = [], []
    for k, o in zip(keys, ex):
        vals = (S.pj(o) or {}).get('values') or []
        T = ev_texts(k)
        blocks = []
        for i, v in enumerate(vals):
            terms = [str(x) for x in (v.get('terms') or [])][:5]
            sn = find_snips(T, terms)
            if not sn: continue
            blocks.append('【%d】回答：%s 的 %s = %s（引用 %s）\n%s' % (i, v.get('object'), v.get('attribute'), v.get('value'), ','.join(v.get('cited') or []),
                          '\n'.join('  - [%s]《%s》…%s…' % (e, d[:30], s) for _, e, d, s in sn)))
        if blocks:
            items.append({'system': JSYS, 'user': '\n\n'.join(blocks)[:18000]}); ikeys.append((k, vals))
    jo = S.bench(items)
    res = {}
    for (k, vals), o in zip(ikeys, jo):
        rs = [r for r in ((S.pj(o) or {}).get('results') or []) if r.get('conflict')]
        res[k] = [{'value': vals[r['i']] if isinstance(r.get('i'), int) and r['i'] < len(vals) else None, **r} for r in rs]
    json.dump(res, io.open(os.path.join(HERE, 'score', os.environ.get('VOUT', 'value_bench') + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    n = collections.Counter(len(v) for v in res.values())
    print('回答数', len(keys), '| 报出多值的回答', sum(1 for v in res.values() if v), '| 条数分布', dict(n))
    for k in sorted(res):
        for r in res[k][:4]:
            v = r.get('value') or {}
            print(k, '|', v.get('object'), v.get('attribute'), v.get('value'), '→ 另', r.get('other_value'), '《%s》' % str(r.get('source'))[:20], r.get('evidence_id'))
