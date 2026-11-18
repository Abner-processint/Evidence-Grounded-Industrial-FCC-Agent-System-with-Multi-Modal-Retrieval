# -*- coding: utf-8 -*-
"""预验收基线：对主线入口按题集发题，每题 NREP 次、每次新会话，并发 CONC。结果存 runs/<id>_<k>.json（含会话号，事后按会话号对执行记录）。
已存在且 http=200 的跳过（可断点续跑）。用法：python run_batch.py [题号前缀过滤]"""
import json, io, os, sys, time, requests, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools')
HOOK = os.environ.get('HOOK', '<WEBHOOK_PATH>')
NREP = int(os.environ.get('NREP', '2')); CONC = int(os.environ.get('CONC', '4'))
Q = json.load(io.open(os.path.join(HERE, os.environ.get('QFILE', 'questions.json')), encoding='utf-8'))
flt = sys.argv[1] if len(sys.argv) > 1 else ''
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, 'n8n_server.pem')


def one(q, k):
    out = os.path.join(HERE, os.environ.get('RUNDIR', 'runs'), '%s_%d.json' % (q['id'], k))
    if os.path.exists(out):
        try:
            if json.load(io.open(out, encoding='utf-8')).get('http') == 200: return q['id'], k, 'skip'
        except Exception: pass
    sid = 'accept-%s-%s-%d' % (time.strftime('%Y%m%d-%H%M%S'), q['id'], k)
    t0 = time.time()
    try:
        r = s.post('https://<HOST>:5678/n8n/webhook/' + HOOK, json={'chatInput': q['question'], 'sessionId': sid}, timeout=1800)
        code, txt = r.status_code, r.text
    except Exception as e:
        code, txt = 'ERR', str(e)
    ans = txt
    try:
        b = json.loads(txt); b = b[0] if isinstance(b, list) and b else b
        ans = (b or {}).get('output') or (b or {}).get('text') or txt
    except Exception: pass
    json.dump({'id': q['id'], 'rep': k, 'question': q['question'], 'session': sid, 'http': code, 'sec': round(time.time() - t0),
               'started': time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime(t0)), 'answer': ans}, io.open(out, 'w', encoding='utf-8'), ensure_ascii=False)
    return q['id'], k, '%s %ss' % (code, round(time.time() - t0))


jobs = [(q, k) for k in range(1, NREP + 1) for q in Q if q['id'].startswith(flt)]
with cf.ThreadPoolExecutor(CONC) as ex:
    for fid, k, st in ex.map(lambda a: one(*a), jobs):
        print(time.strftime('%H:%M:%S'), fid, k, st, flush=True)
