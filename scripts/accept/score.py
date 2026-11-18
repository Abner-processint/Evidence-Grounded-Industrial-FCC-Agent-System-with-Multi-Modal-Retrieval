# -*- coding: utf-8 -*-
"""预验收基线评分（模型评分，非专家评分）。阶段：
  fetch   按会话号对上执行记录，只留最终回答与证据包（evidence_packet）存 exec/<id>_<k>.json，整份执行记录不落盘。
  judge   10 分制：准确性 5 + 完整性 3 + 清晰实用 2，≥7 计成功；对照参考要点；与线上同一模型（核对试验台，温度 0），每份回答评 JREP 遍取均值。
  cite    关键陈述出处：抽出回答里的关键陈述（事实、数据、标准、操作步骤），判其引用是否有效（引用的证据里确有该内容且来源具体）。
  consist 同一题两次回答是否矛盾（只是一次没说不算矛盾）。
  report  汇总写 baseline_summary.json，并打印。
用法：python score.py fetch|judge|cite|consist|report"""
import json, io, os, sys, re, glob, time, collections, statistics, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import requests
BENCH = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
Q = {q['id']: q for q in json.load(io.open(os.path.join(HERE, 'questions.json'), encoding='utf-8'))}
RUNS = sorted(glob.glob(os.path.join(HERE, os.environ.get('RUNDIR', 'runs'), '*.json')))
os.makedirs(os.path.join(HERE, os.environ.get('EXECDIR', 'exec')), exist_ok=True); os.makedirs(os.path.join(HERE, os.environ.get('SCOREDIR', 'score')), exist_ok=True)
bs = requests.Session(); bs.trust_env = False; bs.verify = os.path.join(TOOLS, 'n8n_server.pem')


def bench(items):
    outs = []
    def call(batch):
        for k in range(3):
            try:
                r = bs.post(BENCH, json={'items': batch}, timeout=1800); r.raise_for_status(); b = r.json()
                return (b if isinstance(b, dict) else b[0])['outputs']
            except Exception: time.sleep(5)
        return [''] * len(batch)
    batches = [items[i:i + 8] for i in range(0, len(items), 8)]
    with cf.ThreadPoolExecutor(2) as ex:
        for o in ex.map(call, batches): outs += o
    return outs


def pj(o):
    try:
        a, b = o.find('{'), o.rfind('}'); return json.loads(o[a:b + 1])
    except Exception: return None


def run_key(p): return os.path.basename(p)[:-5]


if len(sys.argv) > 1 and sys.argv[1] == 'fetch':
    import n8nkey  # noqa
    s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, 'n8n_server.pem'); s.headers['X-N8N-API-KEY'] = os.environ['N8N_API_KEY']
    need = {}
    for p in RUNS:
        r = json.load(io.open(p, encoding='utf-8'))
        ep = os.path.join(HERE, os.environ.get('EXECDIR', 'exec'), run_key(p) + '.json')
        if not os.path.exists(ep) or 'display_map' not in json.load(io.open(ep, encoding='utf-8')): need[r['session']] = run_key(p)
    print('need', len(need))
    cur = None; seen = 0
    while need and seen < 600:
        params = {'workflowId': os.environ.get('WFID', 'WdjEhxyWuv5DPwcs'), 'limit': 50}
        if cur: params['cursor'] = cur
        page = s.get('https://<HOST>:5678/n8n/api/v1/executions', params=params, timeout=180).json()
        for e in page.get('data', []):
            seen += 1
            full = s.get('https://<HOST>:5678/n8n/api/v1/executions/%s' % e['id'], params={'includeData': 'true'}, timeout=900).json()
            rd = ((full.get('data') or {}).get('resultData') or {}).get('runData') or {}
            try: cc = rd['Capture context'][0]['data']['main'][0][0]['json']
            except Exception: continue
            sid = str(cc.get('chatSessionId') or '').replace('debug:', '')
            if sid not in need: continue
            try: ev = rd['Evidence Packet Builder'][-1]['data']['main'][0][0]['json'].get('evidence_packet') or []
            except Exception: ev = []
            try: ans = rd['Restore Chat Output'][-1]['data']['main'][0][0]['json']
            except Exception: ans = {}
            F = ('evidence_id', 'document_name', 'dataset_name', 'section_title', 'source_tier_label', 'snippet', 'content_summary', 'key_values')
            keep = [{k: x.get(k) for k in F} for x in ev]
            # 回答里的 [E#] 是 Code in JavaScript 重新编号后的显示编号；原编号对应 Compact Result Projector 给写回答模型的证据包
            try: dmap = rd['Code in JavaScript'][-1]['data']['main'][0][0]['json'].get('evidence_display_id_map') or {}
            except Exception: dmap = {}
            try: crp = rd['Compact Result Projector'][-1]['data']['main'][0][0]['json'].get('evidence_packet') or []
            except Exception: crp = []
            json.dump({'exec_id': e['id'], 'session': sid, 'evidence_packet': keep, 'display_map': dmap, 'crp_packet': [{k: x.get(k) for k in F} for x in crp], 'final': ans},
                      io.open(os.path.join(HERE, os.environ.get('EXECDIR', 'exec'), need[sid] + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)
            print('got', need[sid], e['id'], flush=True); need.pop(sid)
            if not need: break
        cur = page.get('nextCursor')
        if not cur: break
    print('still missing', sorted(need.values()))

JSYS = ('你是催化裂化（FCC）装置的资深工艺专家，按验收标准给智能体的回答打分。只依据问题、参考要点和你的专业知识判断，不要因篇幅长而加分。\n'
        '评分（10 分制）：准确性 0–5（核心事实、数据、原理无误；有事实或数据错误要扣分，关键错误最多给 2 分）；完整性 0–3（覆盖参考要点里的关键点，无重大遗漏）；'
        '清晰与实用性 0–2（表述清晰，对实际操作或理解有直接帮助）。参考要点里「本装置数据分析」「氮平衡计算」这类加分项没做到只扣完整性，不扣准确性。\n'
        '只输出 JSON：{"accuracy":0-5,"completeness":0-3,"clarity":0-2,"errors":["事实或数据错误，逐条"],"missing":["遗漏的关键点，逐条"],"note":"一句话"}')

if len(sys.argv) > 1 and sys.argv[1] == 'judge':
    JREP = int(os.environ.get('JREP', '2'))
    items, keys = [], []
    for p in RUNS:
        r = json.load(io.open(p, encoding='utf-8')); q = Q[r['id']]
        if r.get('http') != 200: continue
        u = '问题：%s\n\n参考要点（%s）：\n%s\n\n智能体回答：\n%s' % (q['question'], q['points_source'], q['points'], str(r['answer'])[:14000])
        for j in range(JREP): items.append({'system': JSYS, 'user': u}); keys.append((run_key(p), j))
    outs = bench(items)
    res = collections.defaultdict(list)
    for (k, j), o in zip(keys, outs): res[k].append(pj(o) or {'parse_fail': True, 'raw': (o or '')[:300]})
    json.dump(res, io.open(os.path.join(HERE, os.environ.get('SCOREDIR', 'score'), 'judge.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('judged', len(res))

CSYS = ('你在核查智能体回答里关键陈述的出处。关键陈述 = 回答中的关键事实、数据、标准限值、设备参数、操作步骤、机理结论（不含过渡句、总结句、提问复述）。\n'
        '回答里用 [E数字] 引用证据；下面给出这些编号对应的证据原文。逐条判断：\n'
        '- valid：陈述带了引用，所引证据里确实包含该内容（数值、对象一致），且证据来源是具体的文档 / 数据库 / 装置模型；\n'
        '- wrong：带了引用，但所引证据里没有该内容或内容不一致；\n'
        '- vague：出处模糊（如「通识资料」「通用定义」「相关资料」「行业共识」）或只写「按通用公式」而未指明具体来源；\n'
        '- none：没有引用出处。\n'
        '- absence：陈述本身是在断言「没有 / 未检索到 / 没找到 / 无法判定 / 不能算 / 缺少某项」（这类陈述单独计数，不判出处）。\n'
        '关键陈述最多列 25 条，优先列数值、限值、位号、步骤。只输出 JSON：{"statements":[{"text":"陈述（≤40字）","cited":["E1"],"verdict":"valid|wrong|vague|none|absence","why":"≤20字"}]}')

if len(sys.argv) > 1 and sys.argv[1] == 'cite':
    items, keys = [], []
    for p in RUNS:
        r = json.load(io.open(p, encoding='utf-8'))
        ep = os.path.join(HERE, os.environ.get('EXECDIR', 'exec'), run_key(p) + '.json')
        if r.get('http') != 200 or not os.path.exists(ep): continue
        X = json.load(io.open(ep, encoding='utf-8'))
        orig = {x['evidence_id']: x for x in (X.get('crp_packet') or []) if x.get('evidence_id')}
        ev = {disp: orig[o] for o, disp in (X.get('display_map') or {}).items() if o in orig}  # 显示编号 → 原证据
        ans = str(r['answer'])
        body = ans.split('数据依据')[0] if '数据依据' in ans else ans
        cited = sorted(set(re.findall(r'\[(E\d+)\]', body)), key=lambda x: int(x[1:]))
        evtxt = []
        for e in cited[:40]:
            x = ev.get(e)
            if not x: evtxt.append('%s：（证据包里没有这个编号）' % e); continue
            txt = ' '.join(str(x.get(k) or '') for k in ('snippet', 'content_summary', 'key_values'))
            evtxt.append('%s：《%s》%s｜%s' % (e, x.get('document_name') or x.get('dataset_name') or '', x.get('section_title') or '', re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', txt))[:700]))
        u = '回答正文：\n%s\n\n回答引用的证据原文：\n%s' % (body[:12000], '\n'.join(evtxt))
        items.append({'system': CSYS, 'user': u}); keys.append(run_key(p))
    outs = bench(items)
    res = {k: (pj(o) or {'parse_fail': True}) for k, o in zip(keys, outs)}
    json.dump(res, io.open(os.path.join(HERE, os.environ.get('SCOREDIR', 'score'), 'cite.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('cited', len(res))

KSYS = ('比较同一个问题的两次回答（来自两个独立会话）。找出两次回答之间互相矛盾的地方：同一个量的数值、位号、结论、判断（如「有」与「没有」、「超过」与「未超过」、「能算」与「不能算」）不一致。\n'
        '只是一次说了、另一次没说的，不算矛盾，记为 omission。数值因四舍五入不同不算矛盾。\n'
        '注意（用户 11-17 定）：一次说「没有 / 未检索到 / 没找到 / 无法判定 / 不能算」，另一次给出了该内容或结论，算矛盾（absence_vs_presence），不算 omission。\n'
        '只输出 JSON：{"verdict":"consistent|omission_only|contradiction","contradictions":[{"type":"value|conclusion|absence_vs_presence","what":"≤40字","a":"第一次怎么说","b":"第二次怎么说"}]}')

if len(sys.argv) > 1 and sys.argv[1] == 'consist':
    by = collections.defaultdict(dict)
    for p in RUNS:
        r = json.load(io.open(p, encoding='utf-8'))
        if r.get('http') == 200: by[r['id']][r['rep']] = str(r['answer'])
    items, keys = [], []
    for qid, d in sorted(by.items()):
        if 1 in d and 2 in d:
            items.append({'system': KSYS, 'user': '问题：%s\n\n第一次回答：\n%s\n\n第二次回答：\n%s' % (Q[qid]['question'], d[1][:10000], d[2][:10000])}); keys.append(qid)
    outs = bench(items)
    res = {k: (pj(o) or {'parse_fail': True}) for k, o in zip(keys, outs)}
    json.dump(res, io.open(os.path.join(HERE, os.environ.get('SCOREDIR', 'score'), 'consist.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('compared', len(res))

if len(sys.argv) > 1 and sys.argv[1] == 'report':
    J = json.load(io.open(os.path.join(HERE, os.environ.get('SCOREDIR', 'score'), 'judge.json'), encoding='utf-8'))
    C = json.load(io.open(os.path.join(HERE, os.environ.get('SCOREDIR', 'score'), 'cite.json'), encoding='utf-8')) if os.path.exists(os.path.join(HERE, os.environ.get('SCOREDIR', 'score'), 'cite.json')) else {}
    K = json.load(io.open(os.path.join(HERE, os.environ.get('SCOREDIR', 'score'), 'consist.json'), encoding='utf-8')) if os.path.exists(os.path.join(HERE, os.environ.get('SCOREDIR', 'score'), 'consist.json')) else {}
    rows = []
    for p in RUNS:
        k = run_key(p); r = json.load(io.open(p, encoding='utf-8')); js = [x for x in J.get(k, []) if 'accuracy' in x]
        tot = [x.get('accuracy', 0) + x.get('completeness', 0) + x.get('clarity', 0) for x in js]
        st = collections.Counter(s.get('verdict') for s in (C.get(k) or {}).get('statements') or [])
        rows.append({'run': k, 'id': r['id'], 'set': Q[r['id']]['set'], 'http': r.get('http'), 'sec': r.get('sec'),
                     'score': round(statistics.mean(tot), 2) if tot else None, 'score_spread': (max(tot) - min(tot)) if tot else None,
                     'acc': round(statistics.mean(x.get('accuracy', 0) for x in js), 2) if js else None,
                     'cite': dict(st)})
    def rate(rs, key):
        v = [x for x in rs if x['score'] is not None]
        return len([x for x in v if x['score'] >= 7]), len(v)
    out = {'rows': rows}
    for name, rs in (('全部', rows), ('公司20题', [x for x in rows if x['set'] == 'company20']), ('回归14题', [x for x in rows if x['set'] == 'regression'])):
        a, b = rate(rs, 'score'); first = [x for x in rs if x['run'].endswith('_1')]; a1, b1 = rate(first, 'score')
        ct = collections.Counter()
        for x in rs: ct.update(x['cite'])
        n = sum(ct.values())
        out[name] = {'成功(≥7)/有效回答': '%d/%d' % (a, b), '第1次成功率': '%d/%d' % (a1, b1), '均分': round(statistics.mean(x['score'] for x in rs if x['score'] is not None), 2) if b else None,
                     '关键陈述': dict(ct), '出处有效率（不含 absence）': ('%.0f%%' % (100 * ct.get('valid', 0) / max(1, n - ct.get('absence', 0)))) if n else None,
                     '断言没有的陈述数': ct.get('absence', 0)}
    kv = collections.Counter(v.get('verdict') for v in K.values())
    out['前后一致'] = dict(kv)
    json.dump(out, io.open(os.path.join(HERE, os.environ.get('SCOREDIR', 'score'), 'baseline_summary.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for k in ('全部', '公司20题', '回归14题', '前后一致'): print(k, out[k])
    for x in rows: print(x['run'], x['score'], x['score_spread'], x['acc'], x['cite'], x['sec'])
