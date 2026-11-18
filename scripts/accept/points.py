# -*- coding: utf-8 -*-
"""公司 20 题按要点逐条判（答到 covered / 部分 partial / 没答到 missing），与 10-23 基线（224 条：87/68/69）同口径对照。模型评分，非专家评分。"""
import json, io, os, sys, glob, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import score as S  # noqa  （score.py 只在 argv 匹配时运行各阶段）
PSYS = ('你是 FCC 工艺专家。先把参考要点拆成 6–12 条可独立判断的得分点（每条一句话），再逐条判断智能体回答是否答到：covered = 完整答到；partial = 答到一部分或不够准确；missing = 没答到。'
        '只输出 JSON：{"points":[{"point":"得分点","layer":"mechanism|general|plant|data","verdict":"covered|partial|missing"}]}')
items, keys = [], []
for p in sorted(glob.glob(os.path.join(HERE, 'runs', 'Q*.json'))):
    r = json.load(io.open(p, encoding='utf-8')); q = S.Q[r['id']]
    items.append({'system': PSYS, 'user': '问题：%s\n\n参考要点：\n%s\n\n智能体回答：\n%s' % (q['question'], q['points'], str(r['answer'])[:14000])}); keys.append(S.run_key(p))
outs = S.bench(items)
res = {k: (S.pj(o) or {'parse_fail': True}) for k, o in zip(keys, outs)}
json.dump(res, io.open(os.path.join(HERE, 'score', 'points.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
tot = collections.Counter(); first = collections.Counter(); lay = collections.defaultdict(collections.Counter)
for k, v in res.items():
    for x in v.get('points') or []:
        tot[x.get('verdict')] += 1; lay[x.get('layer')][x.get('verdict')] += 1
        if k.endswith('_1'): first[x.get('verdict')] += 1
print('全部两次', dict(tot)); print('第1次', dict(first)); print({k: dict(v) for k, v in lay.items()})
