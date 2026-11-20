# -*- coding: utf-8 -*-
"""Evidence Packet Builder 改前改后离线对照（r1119t）。
fetch：按 accept/loadstats/<RUNDIR>.json 的执行编号拉执行记录，只留 EPB 引用到的节点输出与 EPB 每次运行的输入 / 已记录输出的阈值字段，存 rec/<exec>.json（整份执行记录不落盘）。
replay：旧代码（副本现发布版）与新代码各跑一遍（外部请求一律拒绝，两边一样），比较阈值相关字段；并核对旧代码离线结果与线上记录是否一致。
用法：RUNDIR=runs_copy1118 python replay_epb.py fetch | python replay_epb.py replay <old_wf.json> <new_wf.json>"""
import json, io, os, sys, glob, subprocess, shutil, tempfile, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
REC = os.path.join(HERE, '..', 'r1119t', 'rec'); os.makedirs(REC, exist_ok=True)
REF = ['Apply Missing Claim Check', 'Build Verification Retry', 'Capture context', 'Catalog', 'Decompose Question', 'Extract Plan Data',
       'Parse Device Context', 'Prepare Answer Verification', 'Workflow Configuration']
TF = ('threshold_registry', 'threshold_comparison', 'established_thresholds', 'alarm_table_majority')


def j0(x):
    try: return x['data']['main'][0][0]['json']
    except Exception: return {}


if sys.argv[1] == 'fetch':
    import n8nkey  # noqa
    import requests
    s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, 'n8n_server.pem'); s.headers['X-N8N-API-KEY'] = os.environ['N8N_API_KEY']
    L = json.load(io.open(os.path.join(HERE, '..', 'accept', 'loadstats', os.environ['RUNDIR'] + '.json'), encoding='utf-8'))
    def one(item):
        k, v = item; eid = v['exec_id']; fp = os.path.join(REC, '%s.json' % eid)
        if os.path.exists(fp): return k, 'skip'
        full = s.get('https://<HOST>:5678/n8n/api/v1/executions/%s' % eid, params={'includeData': 'true'}, timeout=900).json()
        rd = full['data']['resultData']['runData']
        nodes = {n: [j0(x) for x in rd[n]] for n in REF if n in rd}
        epb = []
        for r in rd.get('Evidence Packet Builder', []):
            src = (r.get('source') or [{}])[0] or {}
            try: inp = rd[src['previousNode']][src.get('previousNodeRun') or 0]['data']['main'][src.get('previousNodeOutput') or 0][0]['json']
            except Exception: inp = None
            out = j0(r); epb.append({'input': inp, 'recorded': {f: out.get(f) for f in TF}, 'full_out': out})
        json.dump({'run': k, 'exec_id': eid, 'nodes': nodes, 'epb': epb}, io.open(fp, 'w', encoding='utf-8'), ensure_ascii=False)
        return k, len(epb)
    with cf.ThreadPoolExecutor(3) as ex:
        for k, r in ex.map(one, sorted(L.items())): print(k, r, flush=True)

if sys.argv[1] == 'replay':
    code = lambda p: {n['name']: n for n in json.load(io.open(p, encoding='utf-8'))['activeVersion']['nodes']}['Evidence Packet Builder']['parameters']['jsCode']
    old, new = code(sys.argv[2]), code(sys.argv[3])
    def run(c, nodes, inp, ri):
        h = ('const NODES = ' + json.dumps(nodes, ensure_ascii=False) + ';\nconst INPUT = ' + json.dumps(inp, ensure_ascii=False) + ';\n'
             'const $ = n => ({ first: () => ({ json: (NODES[n]||[{}])[0] || {} }), last: () => ({ json: (NODES[n]||[{}]).slice(-1)[0] || {} }), all: (a, r) => (NODES[n]||[]).slice(0, r == null ? undefined : r + 1).map(j => ({ json: j })), item: { json: (NODES[n]||[{}])[0] || {} } });\n'
             'const $input = { first: () => ({ json: INPUT }), all: () => [{ json: INPUT }], item: { json: INPUT } };\nconst $json = INPUT; const __sd = {}; const $getWorkflowStaticData = () => __sd; const $runIndex = ' + str(ri) + ';\n'
             'const __ctx = { helpers: { httpRequest: async () => { throw new Error("offline"); }, httpRequestWithAuthentication: async () => { throw new Error("offline"); } } };\n'
             '(async function () {\n' + c + '\n}).call(__ctx).then(r => { const j = (Array.isArray(r) ? r[0] : r) || {}; const o = j.json || j; '
             'console.log(JSON.stringify({ ' + ', '.join('%s: o.%s' % (f, f) for f in TF) + ' })); }).catch(e => console.log(JSON.stringify({ THROW: String(e && e.message) })));\n')
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(h); p = f.name
        rr = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8', timeout=300); os.unlink(p)
        try: return json.loads(rr.stdout.strip().splitlines()[-1])
        except Exception: return {'THROW': (rr.stderr or rr.stdout)[-300:]}
    stats = {'runs': 0, 'same': 0, 'diff': 0, 'throw': 0, 'old_vs_recorded_diff': 0}
    rows = []
    for fp in sorted(glob.glob(os.path.join(REC, '*.json'))):
        R = json.load(io.open(fp, encoding='utf-8'))
        for ri, e in enumerate(R['epb']):
            if e['input'] is None: continue
            nodes = dict(R['nodes']); nodes['Evidence Packet Builder'] = [x['full_out'] for x in R['epb']]
            a = run(old, nodes, e['input'], ri); b = run(new, nodes, e['input'], ri); stats['runs'] += 1
            if 'THROW' in a or 'THROW' in b: stats['throw'] += 1; print('THROW', R['run'], ri, a.get('THROW'), b.get('THROW')); continue
            ka = json.dumps({f: a.get(f) for f in ('threshold_registry', 'established_thresholds', 'alarm_table_majority')}, sort_keys=True, ensure_ascii=False)
            ra = json.dumps({f: e['recorded'].get(f) for f in ('threshold_registry', 'alarm_table_majority')}, sort_keys=True, ensure_ascii=False)
            ka2 = json.dumps({f: a.get(f) for f in ('threshold_registry', 'alarm_table_majority')}, sort_keys=True, ensure_ascii=False)
            if ka2 != ra: stats['old_vs_recorded_diff'] += 1
            sa = [x.get('statement') for x in (a.get('threshold_comparison') or [])]; sb = [x.get('statement') for x in (b.get('threshold_comparison') or [])]
            kb = json.dumps({f: b.get(f) for f in ('threshold_registry', 'established_thresholds', 'alarm_table_majority')}, sort_keys=True, ensure_ascii=False)
            if ka == kb and sa == sb: stats['same'] += 1
            else:
                stats['diff'] += 1
                rows.append({'run': R['run'], 'exec': R['exec_id'], 'ri': ri,
                             'old_cols': [x.get('column') for x in (a.get('threshold_comparison') or [])], 'new_cols': [x.get('column') for x in (b.get('threshold_comparison') or [])],
                             'old_statements': sa, 'new_statements': sb,
                             'reg_changed': {k: (a['threshold_registry'] or {}).get(k) for k in set(a.get('threshold_registry') or {}) | set(b.get('threshold_registry') or {})
                                             if (a.get('threshold_registry') or {}).get(k) != (b.get('threshold_registry') or {}).get(k)},
                             'reg_new': {k: (b['threshold_registry'] or {}).get(k) for k in set(a.get('threshold_registry') or {}) | set(b.get('threshold_registry') or {})
                                         if (a.get('threshold_registry') or {}).get(k) != (b.get('threshold_registry') or {}).get(k)}})
        print(R['run'], 'done', flush=True)
    json.dump({'stats': stats, 'diffs': rows}, io.open(os.path.join(HERE, 'replay_result.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(stats)
