# -*- coding: utf-8 -*-
"""检索负载对比：按 RUNDIR 里各次运行的会话号对上 WFID 的执行记录，只取 Grouped RAGFlow Retrieval 的统计（不落整份执行记录），
存 loadstats/<RUNDIR>.json：每次执行的检索单元数、查询写法数、失败数（及原因）、0 段数、各写法使用次数、检索节点耗时合计与最长。
用法：RUNDIR=runs_copy1118 WFID=EIBVIi74m90EYSsB python load_stats.py fetch | python load_stats.py report <rundir> [<rundir> ...]"""
import json, io, os, sys, glob, datetime, collections, statistics
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
OUT = os.path.join(HERE, 'loadstats'); os.makedirs(OUT, exist_ok=True)

def parse_t(x): return datetime.datetime.fromisoformat(str(x).replace('Z', '+00:00')).replace(tzinfo=None)

if sys.argv[1] == 'fetch':
    import n8nkey  # noqa
    import requests
    s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, 'n8n_server.pem'); s.headers['X-N8N-API-KEY'] = os.environ['N8N_API_KEY']
    RD = os.environ['RUNDIR']; WF = os.environ['WFID']; fp = os.path.join(OUT, RD + '.json')
    have = json.load(io.open(fp, encoding='utf-8')) if os.path.exists(fp) else {}
    need = {}; t0 = None; t1 = None
    for p in sorted(glob.glob(os.path.join(HERE, RD, '*.json'))):
        r = json.load(io.open(p, encoding='utf-8'))
        if r.get('http') != 200: continue
        k = os.path.basename(p)[:-5]
        if k in have: continue
        need[r['session']] = (k, r.get('sec'))
        st = parse_t(r['started']); t0 = min(t0 or st, st); t1 = max(t1 or st, st + datetime.timedelta(seconds=(r.get('sec') or 0)))
    print('need', len(need), t0, t1, flush=True)
    cur = None
    while need:
        params = {'workflowId': WF, 'limit': 100}
        if cur: params['cursor'] = cur
        page = s.get('https://<HOST>:5678/n8n/api/v1/executions', params=params, timeout=180).json()
        stop = False
        for e in page.get('data', []):
            st = parse_t(e['startedAt'])
            if st > t1 + datetime.timedelta(minutes=10): continue
            if st < t0 - datetime.timedelta(minutes=10): stop = True; break
            full = s.get('https://<HOST>:5678/n8n/api/v1/executions/%s' % e['id'], params={'includeData': 'true'}, timeout=900).json()
            rd = ((full.get('data') or {}).get('resultData') or {}).get('runData') or {}
            try: sid = str(rd['Capture context'][0]['data']['main'][0][0]['json'].get('chatSessionId') or '').replace('debug:', '')
            except Exception: continue
            if sid not in need: continue
            units = []
            for g in rd.get('Grouped RAGFlow Retrieval') or []:
                try: j = g['data']['main'][0][0]['json']; oo = json.loads(j.get('output') or '{}')
                except Exception: oo = {}
                rr = oo.get('raw_result') or {}
                vcc = rr.get('variant_chunk_counts') or []
                units.append({'ms': g.get('executionTime'), 'n_var': rr.get('variant_count', len(vcc)),
                              'failed': rr.get('failed_variant_count', 0),
                              'fail_why': [str(f.get('error') or f.get('reason') or f.get('status') or f)[:80] for f in (rr.get('variant_failures') or [])],
                              'zero': sum(1 for v in vcc if v.get('status') == 'ok' and not v.get('chunk_count')),
                              'langs': [v.get('lang_variant') for v in vcc], 'selected': rr.get('deduped_selected_chunk_count')})
            k, sec = need.pop(sid)
            have[k] = {'exec_id': e['id'], 'sec': sec, 'units': units}
            print('got', k, e['id'], len(units), flush=True)
            json.dump(have, io.open(fp, 'w', encoding='utf-8'), ensure_ascii=False)
            if not need: break
        cur = page.get('nextCursor')
        if stop or not cur: break
    print('still missing', sorted(v[0] for v in need.values()))

if sys.argv[1] == 'report':
    for RD in sys.argv[2:]:
        D = json.load(io.open(os.path.join(OUT, RD + '.json'), encoding='utf-8'))
        U = [u for x in D.values() for u in x['units']]
        nv = sum(u['n_var'] or 0 for u in U); nf = sum(u['failed'] or 0 for u in U); nz = sum(u['zero'] for u in U)
        per_exec_req = [sum(u['n_var'] or 0 for u in x['units']) for x in D.values()]
        per_exec_ms = [sum(u['ms'] or 0 for u in x['units']) for x in D.values()]
        why = collections.Counter(w for u in U for w in u['fail_why'])
        print('== %s  执行 %d  检索单元 %d  查询 %d（每次执行中位数 %s）  失败 %d（%.1f%%） 有失败的单元 %d  成功但0段 %d' % (
            RD, len(D), len(U), nv, statistics.median(per_exec_req) if per_exec_req else '-', nf, 100.0 * nf / max(nv, 1), sum(1 for u in U if u['failed']), nz))
        ums = [u['ms'] for u in U if u['ms']]
        print('   检索单元耗时 中位数 %.1f s  最长 %.1f s；每次执行检索耗时合计 中位数 %.1f s；整题耗时 中位数 %s s  均值 %.0f s' % (
            statistics.median(ums) / 1000, max(ums) / 1000, statistics.median(per_exec_ms) / 1000,
            statistics.median([x['sec'] for x in D.values()]), statistics.mean([x['sec'] for x in D.values()])))
        print('   失败原因', why.most_common(4))
