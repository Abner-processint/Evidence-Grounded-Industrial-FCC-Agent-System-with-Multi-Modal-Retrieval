# -*- coding: utf-8 -*-
"""Dependency Gate 删前删后对照：用本地执行记录里每次运行的真实输入，分别跑旧代码 / 新代码，比较输出是否完全相同。"""
import json, io, os, sys, glob, subprocess, shutil, tempfile
LOCAL = os.environ['LOCAL_EXEC_DIR']
old = io.open(sys.argv[1], encoding='utf-8').read()
new = {n['name']: n for n in json.load(io.open(sys.argv[2], encoding='utf-8'))['activeVersion']['nodes']}['Dependency Gate']['parameters']['jsCode']
def run(code, nodes, inp, ri):
    h = ('const NODES = ' + json.dumps(nodes, ensure_ascii=False) + ';\nconst INPUT = ' + json.dumps(inp, ensure_ascii=False) + ';\n'
         'const $ = n => ({ first: () => ({ json: (NODES[n]||[{}])[0] || {} }), last: () => ({ json: (NODES[n]||[{}]).slice(-1)[0] || {} }), all: (a, r) => (NODES[n]||[]).map(j => ({ json: j })), item: { json: (NODES[n]||[{}])[0] || {} } });\n'
         'const $input = { first: () => ({ json: INPUT }), all: () => [{ json: INPUT }], item: { json: INPUT } };\nconst $json = INPUT; const __sd = {}; const $getWorkflowStaticData = () => __sd; const $runIndex = ' + str(ri) + ';\n'
         '(async function () {\n' + code + '\n}).call({}).then(r => console.log(JSON.stringify(r))).catch(e => console.log(JSON.stringify({ THROW: String(e.message) })));\n')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(h); p = f.name
    rr = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
    return rr.stdout.strip()
same = diff = thr = 0
for fp in sorted(glob.glob(os.path.join(LOCAL, 'e_*.json')))[-40:]:
    try: rd = json.load(io.open(fp, encoding='utf-8'))['data']['resultData']['runData']
    except Exception: continue
    nodes = {n: [((x.get('data') or {}).get('main') or [[{}]])[0][0].get('json', {}) if ((x.get('data') or {}).get('main') or [[None]])[0] else {} for x in runs] for n, runs in rd.items()}
    for ri, r in enumerate(rd.get('Dependency Gate', [])[:6]):
        s = r['source'][0]; src = rd[s['previousNode']][s.get('previousNodeRun') or 0]['data']['main'][s.get('previousNodeOutput') or 0]
        if not src: continue
        inp = src[0]['json']; a = run(old, nodes, inp, ri); b = run(new, nodes, inp, ri)
        if 'THROW' in a or 'THROW' in b: thr += 1
        elif a == b: same += 1
        else: diff += 1; print('DIFF', fp[-12:], ri)
print('相同', same, '不同', diff, '报错', thr)
