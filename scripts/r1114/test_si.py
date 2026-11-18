# -*- coding: utf-8 -*-
"""单测 r1114：用真实执行记录，按改后的代码依次跑计算量一链四个节点：
$() 取该执行里各节点的记录输出，但已重跑过的节点用重跑结果；$input 取本节点的记录输入（上游若已重跑则用重跑结果）。
看：DR3110 事实是否换成米并带 converted_from、有无因合并判冲突丢事实、Compute 能否按米取值算出。
记录里定义变量的单位是 mm（旧口径），另跑一遍「定义里装置模型变量单位改 m」，模拟模型按新事实声明单位。
装置模型请求用同形假数据（DR3110）。用法：LOCAL_EXEC_DIR=... python test_si.py <workflow.json(含 r1113b)> <execId>"""
import json, io, os, sys, subprocess, shutil, tempfile, re
HERE = os.path.dirname(os.path.abspath(__file__)); LOCAL = os.environ['LOCAL_EXEC_DIR']
td = tempfile.mkdtemp(); out = os.path.join(td, 'o.json')
r = subprocess.run([sys.executable, os.path.join(HERE, 'r1114_build.py'), sys.argv[1], out], capture_output=True, text=True, encoding='utf-8'); assert r.returncode == 0, r.stderr
w = json.load(io.open(out, encoding='utf-8')); NEW = {n['name']: n for n in (w.get('activeVersion') or w)['nodes']}; shutil.rmtree(td)
rd = json.load(io.open(os.path.join(LOCAL, 'e_%s.json' % sys.argv[2]), encoding='utf-8'))['data']['resultData']['runData']
INS = {"status": "ok", "instrument": {"tag": "DR3110", "service": "一再稀相密度",
       "taps": {"hi": {"el_mm": {"value": 30000, "unit": "mm", "status": "source_bound", "source": "YB8864-48", "locator": "30-1"}},
                "lo": {"el_mm": {"value": 25800, "unit": "mm", "status": "source_bound", "source": "YB8864-48", "locator": "30-2"}}},
       "span_mm": {"value": 4200, "unit": "mm", "status": "derived", "derivation": "hi-lo", "inputs": ["taps.hi.el_mm", "taps.lo.el_mm"]}}}
CHAIN = ['Prepare Derived Quantity Check', 'Apply Derived Quantities', 'Prepare Derived Binding', 'Compute Derived Quantities']


def first(n):
    try: return rd[n][0]['data']['main'][0][0]['json']
    except Exception: return {}


def src(name):
    s = rd[name][0]['source'][0]; return s['previousNode'], s.get('previousNodeRun') or 0, s.get('previousNodeOutput') or 0


def to_m(x):  # 定义里装置模型变量的单位 mm → m
    s = json.dumps(x, ensure_ascii=False, separators=(',', ':'))
    s = re.sub(r'("plant_model_ref":\{[^{}]*\},"unit":)"mm"', r'\1"m"', s)
    s = re.sub(r'(\\"plant_model_ref\\":\s*\{[^{}]*\},\s*\\"unit\\":\s*)\\"mm\\"', r'\1\\"m\\"', s)  # 模型原文（字符串里转义的 JSON）
    return json.loads(s)


def run(name, nodes, inp):
    code = NEW[name]['parameters']['jsCode']
    h = ('const NODES = ' + json.dumps(nodes, ensure_ascii=False) + ';\nconst INPUT = ' + json.dumps(inp, ensure_ascii=False) + ';\n'
         'const INS = ' + json.dumps(INS, ensure_ascii=False) + ';\n'
         'const $ = n => ({ first: () => ({ json: NODES[n] || {} }), last: () => ({ json: NODES[n] || {} }), all: () => [{ json: NODES[n] || {} }], item: { json: NODES[n] || {} } });\n'
         'const $input = { first: () => ({ json: INPUT }), all: () => [{ json: INPUT }], item: { json: INPUT } };\nconst $json = INPUT;\n'
         'const ctx = { helpers: { httpRequest: async (o) => { const b = JSON.parse(o.body); if (b.method === "initialize") return { headers: { "mcp-session-id": "s1" }, body: "{}" };\n'
         '  if (b.method === "tools/call") return { headers: {}, body: "event: message\\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { content: [{ type: "text", text: JSON.stringify(b.params.arguments.tag === "DR3110" ? INS : { status: "not_found" }) }] } }) };\n'
         '  return { headers: {}, body: "" }; } } };\n'
         '(async function () {\n' + code + '\n}).call(ctx).then(r => console.log(JSON.stringify(r[0].json))).catch(e => console.log(JSON.stringify({ THROW: String(e.stack) })));\n')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(h); p = f.name
    rr = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
    return json.loads(rr.stdout.strip().splitlines()[-1]) if rr.stdout.strip() else {'THROW': rr.stderr[-600:]}


def dr(facts): return [(f['field_path'], f['value'], f['unit'], f.get('converted_from')) for f in facts or [] if f.get('equipment_tag') == 'DR3110']


for tag, conv in (('定义变量单位原样 mm', lambda x: x), ('定义变量单位改 m', to_m)):
    print('######', tag)
    nodes = {n: conv(first(n)) for n in rd}; redone = {}
    for name in CHAIN:
        pn, pr, po = src(name)
        inp = redone.get(pn) if pn in redone else conv((rd[pn][pr]['data']['main'][po] or [{}])[0]['json'])
        o = run(name, nodes, inp)
        if 'THROW' in o: print(name, 'THROW', o['THROW'][:600]); break
        redone[name] = o; nodes[name] = o
        if name != 'Compute Derived Quantities':
            print('==', name, '| 事实数 旧/新', len(first(name).get('engineering_facts') or []), len(o.get('engineering_facts') or []),
                  '| 仍为 mm', sum(1 for f in o.get('engineering_facts') or [] if f.get('unit') == 'mm'), '| DR3110', dr(o.get('engineering_facts')))
        else:
            for d in o.get('derived_quantity_results') or []:
                res = (d.get('results') or [{}])[0]
                print('== Compute', d.get('source_label'), d.get('status'), res.get('value_rounded'), d.get('result_unit'), '|', d.get('expression'),
                      '|', [(c.get('symbol'), c.get('value'), c.get('unit')) for c in d.get('constants') or []])
            for d in o.get('derived_not_computed') or []: print('   未算', d.get('source_label') or d.get('name'), str(d.get('reason') or d.get('missing'))[:160])
    # 下游节点读的 Compute 若有 $() 引用上游，以上已按重跑结果给
