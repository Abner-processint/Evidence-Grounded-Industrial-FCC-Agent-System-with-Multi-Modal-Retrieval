# -*- coding: utf-8 -*-
"""诊断实验（11-19 用户「做诊断实验」；讨论稿 GPT 建议）：第一次回答未过 7 分的 QS 题，分别用「标准资料」与「工作流实际证据包」
以同一提示词、同一模型（DeepSeek 温度 0，核对试验台）重答，按公司逐项细则评分，与工作流原回答对比，分清卡在资料、检索还是写法。
阶段：map → retrieve（临时检索工作流，测完删）→ fetch_ev → gen → score → report。用法：python diag.py <阶段>"""
import json, io, os, sys, re, glob, statistics, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ACC = os.path.join(HERE, '..', 'accept'); sys.path.insert(0, ACC); sys.path.insert(0, os.path.join(HERE, '..', 'tools'))
Q = {q['id']: q for q in json.load(io.open(os.path.join(ACC, 'qs_questions.json'), encoding='utf-8'))}
BASE_RUN = 'runs_qs_copy1121g'
norm = lambda x: re.sub(r'[^0-9a-z一-鿿]', '', str(x or '').lower())
J = lambda p: json.load(io.open(os.path.join(HERE, p), encoding='utf-8'))
W = lambda p, o: json.dump(o, io.open(os.path.join(HERE, p), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def tot(v):
    ok = [x for x in v if 'items' in x]
    return round(statistics.mean(min(10, sum(float(i.get('got') or 0) for i in x['items'])) for x in ok), 2) if ok else None


def failing():
    S = json.load(io.open(os.path.join(ACC, BASE_RUN + '_score.json'), encoding='utf-8'))
    return [k[:-2] for k, v in sorted(S.items()) if k.endswith('_1') and (tot(v) or 0) < 7]


stage = sys.argv[1]
if stage == 'map':
    docs = J('docs_all.json')  # {ds: [{id,name}]}
    flat = [(ds, d['id'], d['name']) for ds, v in docs.items() for d in v]
    plan = {}
    for qid in failing():
        q = Q[qid]; srcs = []
        for line in str(q['sources']).split('\n'):
            m = re.search(r'`([^`]+)`(?:、`([^`]+)`)?[：:]?\s*(.*)', line)
            if not m: continue
            for path in [m.group(1), m.group(2)]:
                if not path: continue
                base = os.path.basename(path); key = norm(re.sub(r'\.(docx?|pdf|xlsx?)$', '', base))
                key2 = re.sub(r'^\d+', '', key)[:16]
                def lcs(a, b):
                    best = 0; prev = [0] * (len(b) + 1)
                    for x in a:
                        cur = [0] * (len(b) + 1)
                        for j, y in enumerate(b):
                            if x == y: cur[j + 1] = prev[j] + 1; best = max(best, cur[j + 1])
                        prev = cur
                    return best
                sc = [(lcs(key, norm(re.sub(r'\.(docx?|pdf|xlsx?)$', '', n))), ds, i, n) for ds, i, n in flat]
                mx = max([s[0] for s in sc] or [0])
                hit = [(ds, i, n) for L, ds, i, n in sc if mx >= 8 and L == mx]
                srcs.append({'file': base, 'desc': m.group(3).strip()[:200], 'docs': hit[:4]})
        rub = [l.strip(' -*') for l in str(q['rubric']).split('\n') if len(l.strip()) > 8]
        plan[qid] = {'question': q['question'], 'sources': srcs, 'rubric_lines': rub[:20]}
    W('plan.json', plan)
    for qid, p in plan.items():
        print(qid, [(s['file'][:22], len(s['docs'])) for s in p['sources']])

if stage == 'queries':
    # 每个能对上的参考文件：用它的说明 + 每条评分细则各查一次，限定在该文件
    plan = J('plan.json'); qs = []
    for qid, p in plan.items():
        for s in p['sources']:
            if not s['docs']: continue
            ds = s['docs'][0][0]; ids = [d[1] for d in s['docs'] if d[0] == ds]
            for k, text in enumerate([s['desc']] + p['rubric_lines']):
                qs.append({'id': '%s|%s|%d' % (qid, s['file'], k), 'question': text[:300], 'dataset_ids': [ds], 'document_ids': ids})
    W('queries.json', qs); print('queries', len(qs))
