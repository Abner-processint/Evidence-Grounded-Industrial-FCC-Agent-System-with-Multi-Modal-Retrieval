# -*- coding: utf-8 -*-
"""从操作规程 / 工艺卡片 / 提降量提纲的候选片段里抽取本装置控制指标记录（DeepSeek 温度 0，核对试验台），代码核对引句与数值。
用法：python extract.py test | all"""
import json, io, os, sys, re, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'accept'))
import score as S

XSYS = '''你从催化裂化装置的操作规程、工艺卡片原文里抽取「本装置的控制指标与操作限值」。
要抽的：某个参数在本装置的控制范围、控制指标、工艺卡片指标、报警值、联锁 / 自保值、操作限制（如提降量速度、升温速度上限）。
不要抽：通用原理里举例的数值、设备设计参数（除非原文写明是控制或操作限值）、开停工某一步骤里临时的过程数值、化验分析方法。
每条记录：
- tag：原文写出的位号（如 TRCA3101），没写位号留空
- name：参数名称（原文写法，如「提升管出口温度」「提降量速度」）
- kind：控制范围 / 控制指标 / 工艺卡片 / 报警 / 联锁 / 操作限制 之一
- low、high：数值下限、上限（只有一个限值时另一个留空；「≤25」high=25）
- unit：单位（原文写法）
- condition：适用条件或工况（原文有才写，如「正常生产」「开工时」）
- quote：从原文逐字复制、包含该数值的一段（10 到 120 字）
只输出 JSON：{"records":[{"tag":"","name":"","kind":"","low":"","high":"","unit":"","condition":"","quote":""}]}；没有就输出 {"records":[]}。'''


def pieces(c, n=6000):
    t = c['content']
    return [t[i:i + n] for i in range(0, len(t), n)] or ['']


def sq(x): return re.sub(r'[^0-9A-Za-z一-鿿.~～≤≥<>≯≮℃%/+-]', '', re.sub(r'<[^>]+>', '', str(x or ''))).replace('～', '~')


def run(cands):
    items, meta = [], []
    for c in cands:
        for k, t in enumerate(pieces(c)):
            items.append({'system': XSYS, 'user': '文档：《%s》\n原文：\n%s' % (c['doc'], t)}); meta.append((c, t))
    outs = S.bench(items)
    recs, stat = [], collections.Counter()
    for (c, t), o in zip(meta, outs):
        j = S.pj(o) or {}
        for r in j.get('records') or []:
            stat['raw'] += 1
            q = sq(r.get('quote'))
            if len(q) < 6 or q not in sq(t): stat['quote_miss'] += 1; continue
            nums = [x for x in (str(r.get('low') or ''), str(r.get('high') or '')) if x.strip()]
            if not nums or any(sq(x) not in q for x in nums): stat['num_miss'] += 1; continue
            r = {k: str(r.get(k) or '').strip() for k in ('tag', 'name', 'kind', 'low', 'high', 'unit', 'condition', 'quote')}
            r['tag'] = r['tag'].upper(); r['doc'] = c['doc']; r['chunk_id'] = c['id']; r['pages'] = c.get('pages') or []
            recs.append(r); stat['kept'] += 1
    return recs, stat


if __name__ == '__main__':
    cands = json.load(io.open(os.path.join(HERE, 'cand.json'), encoding='utf-8'))
    if sys.argv[1] == 'test':
        pick = [c for c in cands if 'TRCA3101' in c['content'] or '提降量' in c['doc']][:6]
        recs, stat = run(pick)
        print(dict(stat))
        for r in recs[:30]: print(r['tag'], r['name'], r['kind'], r['low'], r['high'], r['unit'], '|', r['condition'], '|', r['doc'][:8])
    else:
        recs, stat = run(cands)
        print(dict(stat))
        json.dump(recs, io.open(os.path.join(HERE, 'records_raw.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
