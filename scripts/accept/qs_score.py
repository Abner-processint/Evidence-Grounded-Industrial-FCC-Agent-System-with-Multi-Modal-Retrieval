# -*- coding: utf-8 -*-
"""QS001–020 按公司逐项评分细则打分（模型评分，非专家评分；与线上同一 DeepSeek，温度 0）。每份回答评 JREP 遍取均值。
每个小项给 got（0–max，可给部分分），并标 kind：mechanism 机理 / plant_data 本装置资料数据 / data_scope 数据口径说明 / structure 组织与实用。
另由代码标出依赖《2024年催化裂化标定报告》（检索库里没有）的小项，单列「拿不到的分」。用法：RUNDIR=... python qs_score.py"""
import json, io, os, sys, glob, re, collections, statistics
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import score as S
Q = {q['id']: q for q in json.load(io.open(os.path.join(HERE, 'qs_questions.json'), encoding='utf-8'))}
RUNDIR = os.environ.get('RUNDIR', 'runs_qs'); JREP = int(os.environ.get('JREP', '2'))
SYS = ('你是催化裂化（FCC）装置的资深工艺专家，按公司给定的逐项评分细则给智能体的回答打分。严格按细则：每个小项列出满分 max 和得分 got（0 到 max，可给部分分，例如要求「至少 5 项数据」只给了 3 项就按比例给）；'
       '数值要与细则一致才得分（允许四舍五入），未给出、给错或张冠李戴的不得分；不要因篇幅长加分。参考答案只用来理解细则，不要求措辞一致。\n'
       '每个小项标 kind：mechanism（机理原理）/ plant_data（需要本装置资料里的具体数据、位号、公式、限值）/ data_scope（说明是否需要调实时库或 LIMS 及原因）/ structure（组织、清晰、操作建议、口径表述）。\n'
       '只输出 JSON：{"items":[{"part":"准确性|完整性|清晰度和实用性","item":"小项简述 ≤30 字","max":1.0,"got":0.5,"kind":"...","why":"≤25 字"}],"accuracy":0-5,"completeness":0-3,"clarity":0-2}')
runs = sorted(glob.glob(os.path.join(HERE, RUNDIR, 'QS*.json')))
items, keys = [], []
for p in runs:
    r = json.load(io.open(p, encoding='utf-8'))
    if r.get('http') != 200: continue
    q = Q[r['id']]
    u = '问题：%s\n\n公司评分细则：\n%s\n\n参考答案（仅供理解细则）：\n%s\n\n智能体回答：\n%s' % (q['question'], q['rubric'], q['reference'][:3000], str(r['answer'])[:14000])
    for j in range(JREP): items.append({'system': SYS, 'user': u}); keys.append(S.run_key(p))
outs = S.bench(items)
res = collections.defaultdict(list)
for k, o in zip(keys, outs): res[k].append(S.pj(o) or {'parse_fail': True})
json.dump(res, io.open(os.path.join(HERE, RUNDIR + '_score.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
rows = []; kind_lost = collections.Counter(); kind_max = collections.Counter(); calib_lost = 0.0
for k, v in sorted(res.items()):
    ok = [x for x in v if 'items' in x]
    if not ok: rows.append((k, None)); continue
    tots = []
    for x in ok:
        t = sum(float(i.get('got') or 0) for i in x['items']); tots.append(min(10.0, t))
        for i in x['items']:
            kind_lost[i.get('kind')] += (float(i.get('max') or 0) - float(i.get('got') or 0)) / len(ok); kind_max[i.get('kind')] += float(i.get('max') or 0) / len(ok)
            if '标定' in str(i.get('item')): calib_lost += (float(i.get('max') or 0) - float(i.get('got') or 0)) / len(ok)
    rows.append((k, round(statistics.mean(tots), 2), round(max(tots) - min(tots), 2)))
v = [r for r in rows if r[1] is not None]
first = [r for r in v if r[0].endswith('_1')]
print('有效', len(v), '| ≥7 分', sum(1 for r in v if r[1] >= 7), '| 第 1 次 ≥7', sum(1 for r in first if r[1] >= 7), '/', len(first), '| 均分', round(statistics.mean(r[1] for r in v), 2))
print('各类小项 失分 / 满分（平均每份回答）:', {k: '%.2f/%.2f' % (kind_lost[k] / len(v), kind_max[k] / len(v)) for k in kind_max})
print('涉及标定报告的小项平均每份失分 %.2f' % (calib_lost / len(v)))
for r in rows: print(r)
