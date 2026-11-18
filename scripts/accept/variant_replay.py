# -*- coding: utf-8 -*-
"""检索变体贡献：把 16 次基线执行里每组检索的全部变体按原参数重放（临时检索小工作流，每批 3 条、串行，避开高并发超时），
算每个变体取回的段、只有它取到的段（同组其他变体都没取到），以及这些独有段是否进了该次回答的引用。
用法：python variant_replay.py replay | stats"""
import json, io, os, sys, re, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'tagctx'))
U = json.load(io.open(os.path.join(HERE, 'variant', 'units.json'), encoding='utf-8'))
norm = lambda s: re.sub(r'\s+|<[^>]+>', '', str(s or ''))[:60]

if sys.argv[1] == 'replay':
    from probe import probe
    qs = {}
    for k, units in U.items():
        for ui, u in enumerate(units):
            p = u['params']
            for v in u['variants']:
                ds = tuple(v.get('dataset_ids') or p.get('dataset_ids') or [])
                key = v['question'] + '|' + ','.join(ds)
                qs.setdefault(key, {'id': str(len(qs)), 'question': v['question'], 'dataset_ids': list(ds) or None,
                                    'page_size': p.get('page_size') or 30, 'top_k': max(128, p.get('top_k') or 128), 'keyword': p.get('keyword') is not False,
                                    'similarity_threshold': p.get('similarity_threshold') if p.get('similarity_threshold') is not None else 0.2,
                                    'vector_similarity_weight': p.get('vector_similarity_weight') if p.get('vector_similarity_weight') is not None else 0.3})
    L = list(qs.values()); print('queries', len(L))
    res = {}
    for i in range(0, len(L), 3):
        for x in probe([{k2: v2 for k2, v2 in q.items() if v2 is not None} for q in L[i:i + 3]]): res[x['id']] = x
        print('done', min(i + 3, len(L)), flush=True)
    out = {key: [norm(c['doc']) + '|' + norm(c['content']) for c in (res.get(q['id'], {}).get('chunks') or [])] for key, q in qs.items()}
    err = {key: res.get(q['id'], {}).get('error') for key, q in qs.items() if res.get(q['id'], {}).get('error')}
    json.dump({'chunks': out, 'errors': err}, io.open(os.path.join(HERE, 'variant', 'replay.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    print('errors', len(err))

if sys.argv[1] == 'stats':
    R = json.load(io.open(os.path.join(HERE, 'variant', 'replay.json'), encoding='utf-8'))['chunks']
    st = collections.defaultdict(lambda: collections.Counter())
    for k, units in U.items():
        X = json.load(io.open(os.path.join(HERE, 'exec', k + '.json'), encoding='utf-8'))
        ans = str(json.load(io.open(os.path.join(HERE, 'runs', k + '.json'), encoding='utf-8'))['answer'])
        body = ans.split('\n#### ')[0]
        cited_disp = set(re.findall(r'\[(E\d+)\]', body))
        inv = {d: o for o, d in (X.get('display_map') or {}).items()}
        crp = {x['evidence_id']: x for x in X.get('crp_packet') or []}
        cited = {norm(crp[inv[d]].get('snippet')) for d in cited_disp if d in inv and inv[d] in crp}
        for u in units:
            p = u['params']; sets = {}
            for v in u['variants']:
                key = v['question'] + '|' + ','.join(v.get('dataset_ids') or p.get('dataset_ids') or [])
                sets[v['variant_id']] = (v['lang_variant'], set(R.get(key, [])))
            for vid, (lv, s) in sets.items():
                others = set().union(*[x for o, (l2, x) in sets.items() if o != vid]) if len(sets) > 1 else set()
                uniq = s - others
                st[lv]['units'] += 1; st[lv]['chunks'] += len(s); st[lv]['unique'] += len(uniq)
                st[lv]['unique_cited'] += sum(1 for c in uniq if c.split('|', 1)[1] in cited)
                st[lv]['cited'] += sum(1 for c in s if c.split('|', 1)[1] in cited)
    print('%-34s %5s %6s %6s %6s %8s' % ('变体', '次数', '取回段', '独有段', '被引用', '独有且被引用'))
    for lv, c in sorted(st.items(), key=lambda kv: -kv[1]['unique_cited']):
        print('%-34s %5d %6d %6d %6d %8d' % (lv, c['units'], c['chunks'], c['unique'], c['cited'], c['unique_cited']))
