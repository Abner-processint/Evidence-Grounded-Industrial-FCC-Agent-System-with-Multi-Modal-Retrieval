# -*- coding: utf-8 -*-
"""r1113b 重放：主线 198574（定义因子没写 DR3110、本轮读过 DR3110）那次「Derived Quantity LLM」。
A = 原样提示词（无 DR3110 事实，主线当时的输入）；B = 同一输入经 r1113b 节点代码（装置模型用同形假数据）后的 derived_check_input。
各发 NREP 遍到核对试验台（同模型、温度 0），按模型写的式子代入判：
  ok = 用 DR3110 取压口且 ≈1.018 kPa；x1000 = 用了取压口但毫米没换米；zone = 只用了稀相段上下界；other / none / F。
用法：LOCAL_EXEC_DIR=... python replay_b.py <含 r1113 的工作流 json>"""
import json, io, os, re, sys, subprocess, shutil, tempfile, collections
import requests
HERE = os.path.dirname(os.path.abspath(__file__)); LOCAL = os.environ['LOCAL_EXEC_DIR']; N = int(os.environ.get('NREP', '8'))
HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
VAL = {'taps.hi.el_mm': 30000, 'taps.lo.el_mm': 25800, 'span_mm': 4200, 'zones.dilute.top_el_mm': 39650, 'zones.dilute.bottom_el_mm': 25800}
INS = {"status": "ok", "instrument": {"tag": "DR3110", "service": "一再稀相密度",
       "taps": {"hi": {"el_mm": {"value": 30000, "unit": "mm", "status": "source_bound", "source": "YB8864-48", "locator": "30-1"}},
                "lo": {"el_mm": {"value": 25800, "unit": "mm", "status": "source_bound", "source": "YB8864-48", "locator": "30-2"}}},
       "span_mm": {"value": 4200, "unit": "mm", "status": "derived", "derivation": "hi-lo", "inputs": ["taps.hi.el_mm", "taps.lo.el_mm"]}}}
EID = os.environ.get('EID', '198574')

# 1) 构建 r1113b 节点代码
td = tempfile.mkdtemp(); out = os.path.join(td, 'o.json')
r = subprocess.run([sys.executable, os.path.join(HERE, 'r1113b_build.py'), sys.argv[1], out], capture_output=True, text=True, encoding='utf-8'); assert r.returncode == 0, r.stderr
w = json.load(io.open(out, encoding='utf-8')); N_ = {n['name']: n for n in (w.get('activeVersion') or w)['nodes']}
CODE = N_['Prepare Derived Quantity Check']['parameters']['jsCode']; shutil.rmtree(td)

# 2) 取执行记录：节点输入、原提示词
e = json.load(io.open(os.path.join(LOCAL, 'e_%s.json' % EID), encoding='utf-8')); rd = e['data']['resultData']['runData']
run = rd['Prepare Derived Quantity Check'][-1]
src = run['source'][0]['previousNode']; srun = run['source'][0].get('previousNodeRun') or 0
inp = rd[src][srun]['data']['main'][0][0]['json']
def g(n):
    try: return rd[n][0]['data']['main'][0][0]['json']
    except Exception: return {}
SYS = USER_A = None
for n, runs in rd.items():
    for x in runs:
        sp = ((x.get('source') or [{}])[0] or {}).get('previousNode')
        if sp == 'Derived Quantity LLM' and 'ai_languageModel' in (x.get('inputOverride') or {}):
            m = x['inputOverride']['ai_languageModel'][0][0]['json']['messages'][0]; k = m.index('\nHuman: ')
            SYS, USER_A = m[len('System: '):k], m[k + len('\nHuman: '):]
assert SYS and USER_A
nodes = {'Parse Device Context': g('Parse Device Context'), 'Load aliases': g('Load aliases'), 'Plant Knowledge Base': g('Plant Knowledge Base')}
harness = ('const NODES = ' + json.dumps(nodes, ensure_ascii=False) + ';\nconst INPUT = ' + json.dumps(inp, ensure_ascii=False) + ';\nconst INS = ' + json.dumps(INS, ensure_ascii=False) + ';\n'
           'const $ = n => ({ first: () => ({ json: NODES[n] || {} }), last: () => ({ json: NODES[n] || {} }) });\n'
           'const $input = { first: () => ({ json: INPUT }), all: () => [{ json: INPUT }] };\n'
           'const ctx = { helpers: { httpRequest: async (o) => { const b = JSON.parse(o.body); if (b.method === "initialize") return { headers: { "mcp-session-id": "s1" }, body: "{}" };\n'
           '  if (b.method === "tools/call") return { headers: {}, body: "event: message\\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: b.id, result: { content: [{ type: "text", text: JSON.stringify(b.params.arguments.tag === "DR3110" ? INS : { status: "not_found" }) }] } }) };\n'
           '  return { headers: {}, body: "" }; } } };\n'
           '(async function () {\n' + CODE + '\n}).call(ctx).then(r => { const o = r[0].json; console.log(JSON.stringify({ trace: o.input_instrument_facts, user: o.derived_check_input })); });\n')
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(harness); p = f.name
rr = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
o = json.loads(rr.stdout); USER_B = o['user']
print('代码补取', o['trace']); print('A 含取压口', 'taps.hi.el_mm' in USER_A, '| B 含取压口', 'taps.hi.el_mm' in USER_B, '| A 与 B 差', len(USER_B) - len(USER_A), '字')


def judge(text):
    try:
        a, b = text.find('{'), text.rfind('}'); j = json.loads(text[a:b + 1])
    except Exception: return 'F'
    kinds = []
    for d in j.get('derived_quantities', []):
        vs = d.get('variables', []); refs = [(v.get('plant_model_ref') or {}) for v in vs]
        if not any(x.get('field_path') in VAL for x in refs): continue
        env = {v['symbol']: VAL.get((v.get('plant_model_ref') or {}).get('field_path'), 24.7255) for v in vs}
        env.setdefault('g', 9.80665)
        try: x = eval(re.sub(r'\^', '**', d['expression']), {'__builtins__': {}}, env)
        except Exception: kinds.append('E'); continue
        tap = any(x_.get('equipment_tag') == 'DR3110' for x_ in refs)
        if tap: kinds.append('ok' if 0.5 < x < 2 else ('x1000' if 500 < x < 2000 else 'other:%g' % x))
        else: kinds.append('zone:%.3g' % x)
    if not kinds: return 'none'
    return 'ok' if 'ok' in kinds else ('x1000' if 'x1000' in kinds else '|'.join(kinds))


items = [('A', USER_A)] * N + [('B', USER_B)] * N
outs = []
for i in range(0, len(items), 8):
    r = s.post(HOOK, json={'items': [{'system': SYS, 'user': u} for _, u in items[i:i + 8]]}, timeout=1800); r.raise_for_status(); b = r.json()
    outs += (b if isinstance(b, dict) else b[0])['outputs']; print('batch', i // 8 + 1, flush=True)
res = collections.defaultdict(list)
for (k, _), t in zip(items, outs): res[k].append(judge(t))
json.dump({'res': res, 'outs': outs, 'trace': o['trace']}, io.open(os.path.join(HERE, 'replay_b_out_%s.json' % EID), 'w', encoding='utf-8'), ensure_ascii=False)
for k in ('A', 'B'): print(k, collections.Counter(res[k]))
