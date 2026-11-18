# -*- coding: utf-8 -*-
"""单测 r1113：用真实执行记录里 Prepare Derived Quantity Check 的输入，去掉其中 DR3110 的事实，跑改后的节点代码；
装置模型请求用假服务器（返回与线上同形的 DR3110 仪表数据），看 DR3110 取压口事实是否被代码补回、输出给模型的输入里是否带上。
另测：已有 DR3110 事实时不发请求；请求出错时照常输出。用法：python test_pdqc.py <main.json> <e_id> ...（LOCAL_EXEC_DIR 下有 e_<id>.json）"""
import json, io, os, sys, subprocess, shutil, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); LOCAL = os.environ['LOCAL_EXEC_DIR']
wf = sys.argv[1]
td = tempfile.mkdtemp(); out = os.path.join(td, 'o.json')
r = subprocess.run([sys.executable, os.path.join(HERE, 'r1113_build.py'), wf, out], capture_output=True, text=True, encoding='utf-8'); assert r.returncode == 0, r.stderr
N = {n['name']: n for n in (json.load(io.open(out, encoding='utf-8')).get('activeVersion') or {}).get('nodes') or json.load(io.open(out, encoding='utf-8'))['nodes']}
CODE = N['Prepare Derived Quantity Check']['parameters']['jsCode']; shutil.rmtree(td)
INS = {"status": "ok", "instrument": {"tag": "DR3110", "service": "一再稀相密度",
       "taps": {"hi": {"el_mm": {"value": 30000, "unit": "mm", "status": "source_bound", "source": "YB8864-48", "locator": "30-1"}},
                "lo": {"el_mm": {"value": 25800, "unit": "mm", "status": "source_bound", "source": "YB8864-48", "locator": "30-2"}}},
       "span_mm": {"value": 4200, "unit": "mm", "status": "derived", "derivation": "hi-lo", "inputs": ["taps.hi.el_mm", "taps.lo.el_mm"]}}}
for i in sys.argv[2:]:
    e = json.load(io.open(os.path.join(LOCAL, 'e_%s.json' % i), encoding='utf-8')); rd = e['data']['resultData']['runData']
    run = rd['Prepare Derived Quantity Check'][-1]
    src = run['source'][0]['previousNode']; srun = run['source'][0].get('previousNodeRun') or 0
    inp = rd[src][srun]['data']['main'][0][0]['json']
    def g(n):
        try: return rd[n][0]['data']['main'][0][0]['json']
        except Exception: return {}
    for mode in ('strip', 'keep', 'error'):
        j = json.loads(json.dumps(inp))
        if mode != 'keep': j['engineering_facts'] = [f for f in (j.get('engineering_facts') or []) if not str(f.get('equipment_tag', '')).startswith('DR3110')]
        ctx = g('Parse Device Context'); ctx = json.loads(json.dumps(ctx))
        dc = ctx.get('device_context') or {}
        if mode != 'keep': dc['engineering_facts'] = [f for f in (dc.get('engineering_facts') or []) if not str(f.get('equipment_tag', '')).startswith('DR3110')]
        ctx['device_context'] = dc
        nodes = {'Parse Device Context': ctx, 'Load aliases': g('Load aliases'), 'Plant Knowledge Base': g('Plant Knowledge Base')}
        harness = ('const NODES = ' + json.dumps(nodes, ensure_ascii=False) + ';\nconst INPUT = ' + json.dumps(j, ensure_ascii=False) + ';\nconst INS = ' + json.dumps(INS, ensure_ascii=False) + ';\n'
                   'const MODE = ' + json.dumps(mode) + '; let CALLS = 0;\n'
                   'const $ = n => ({ first: () => ({ json: NODES[n] || {} }), last: () => ({ json: NODES[n] || {} }) });\n'
                   'const $input = { first: () => ({ json: INPUT }), all: () => [{ json: INPUT }] };\n'
                   'const ctx = { helpers: { httpRequest: async (o) => { CALLS++; if (MODE === "error") throw new Error("ECONNREFUSED");\n'
                   '  const b = JSON.parse(o.body); if (b.method === "initialize") return { headers: { "mcp-session-id": "s1" }, body: "{}" };\n'
                   '  if (b.method === "tools/call") return { headers: {}, body: "event: message\\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { content: [{ type: "text", text: JSON.stringify(b.params.arguments.tag === "DR3110" ? INS : { status: "not_found" }) }] } }) };\n'
                   '  return { headers: {}, body: "" }; } } };\n'
                   '(async function () {\n' + CODE + '\n}).call(ctx).then(r => { const o = r[0].json; console.log(JSON.stringify({ calls: CALLS, trace: o.input_instrument_facts,\n'
                   '  dr: o.engineering_facts.filter(f => f.equipment_tag === "DR3110").map(f => [f.field_path, f.value, f.status, f.usable_for_calculation]),\n'
                   '  in_prompt: o.derived_check_input.includes("taps.hi.el_mm") })); }).catch(e => { console.log("THROW " + e.stack); });\n')
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(harness); p = f.name
        rr = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
        print(i, mode, (rr.stdout or rr.stderr).strip()[:600])
