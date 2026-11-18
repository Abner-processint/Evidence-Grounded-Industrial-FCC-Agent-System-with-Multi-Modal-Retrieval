# -*- coding: utf-8 -*-
"""r1117 上主线：以主线现发布版（0fa46042）为底跑 r1117_build.py；新增 4 节点须与副本已发布版逐字相同。核对：副本草稿 = 已发布；新增节点正好 4 个、原有节点一个不改；
连线只改 Verification Gate / Verification Action 两处并新增 4 个节点的连线；新代码节点语法通过。默认只核对，APPLY=1 写入。"""
import sys, os, io, json, time, subprocess, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; CP = "WdjEhxyWuv5DPwcs"; COPY = "EIBVIi74m90EYSsB"; PROJ = os.path.join(HERE, '..')
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, "n8n_server.pem"); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
ck = lambda x: json.dumps(x, sort_keys=True); key = lambda nodes: ck(sorted(nodes, key=lambda n: n['name']))
cp = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json(); cav = cp['activeVersion']
assert cp['activeVersionId'].startswith(os.environ.get('CUR', '0fa46042')), cp['activeVersionId']
assert key(cp['nodes']) == key(cav['nodes']), "主线有未发布草稿，停止"
td = tempfile.mkdtemp(); p0 = os.path.join(td, 'in.json'); p1 = os.path.join(td, 'out.json')
json.dump(cp, io.open(p0, 'w', encoding='utf-8'), ensure_ascii=False)
r = subprocess.run([sys.executable, os.path.join(HERE, 'r1117_build.py'), p0, p1], capture_output=True, text=True, encoding='utf-8'); assert r.returncode == 0, r.stderr[-800:]
new = json.load(io.open(p1, encoding='utf-8'))['activeVersion']; shutil.rmtree(td)
O = {n['name']: n for n in cav['nodes']}; Nn = {n['name']: n for n in new['nodes']}
added = sorted(set(Nn) - set(O)); changed = sorted(n for n in O if ck(O[n]) != ck(Nn.get(n)))
print('新增', added, '| 改动', changed)
assert added == sorted(['Prepare No-Absence Rewrite', 'No-Absence Rewrite LLM', 'DeepSeek-NoAbsence', 'Apply No-Absence Rewrite']) and not changed and set(O) <= set(Nn)
cc = sorted(k for k in set(cav['connections']) | set(new['connections']) if ck(cav['connections'].get(k)) != ck(new['connections'].get(k)))
print('连线有变的源节点', cc)
assert cc == sorted(['Verification Gate', 'Verification Action'] + added)
cpw = s.get(f"{BASE}/api/v1/workflows/{COPY}", timeout=180).json(); assert str(cpw.get('activeVersionId', '')).startswith('07b0b78d'), cpw.get('activeVersionId')
CC = {n['name']: n for n in cpw['activeVersion']['nodes']}
strip = lambda n: {k: v for k, v in n.items() if k not in ('position',)}
diff = [n for n in added if ck(strip(Nn[n])) != ck(strip(CC.get(n, {})))]
print('新增节点与副本不同', diff); assert not diff
for n in ('Prepare No-Absence Rewrite', 'Apply No-Absence Rewrite'):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write('(async function(){\n' + Nn[n]['parameters']['jsCode'] + '\n});'); p = f.name
    rr = subprocess.run([shutil.which('node'), '--check', p], capture_output=True, text=True); os.unlink(p); assert rr.returncode == 0, rr.stderr; print(n, 'syntax OK')
if os.environ.get("APPLY") != "1": print("（仅核对，未写入）"); raise SystemExit
stamp = time.strftime('%Y%m%d-%H%M%S')
io.open(os.path.join(PROJ, f"workflow_{CP}_backup_before_r1117_{stamp}.json"), 'w', encoding='utf-8').write(json.dumps(cp, ensure_ascii=False))
ALLOWED = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"}
r = s.put(f"{BASE}/api/v1/workflows/{CP}", json={"name": cp["name"], "nodes": new["nodes"], "connections": new["connections"], "settings": {k: v for k, v in (cp.get("settings") or {}).items() if k in ALLOWED}}, timeout=300)
print("PUT:", r.status_code, r.text[:300] if r.status_code >= 300 else '')
b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
if key((b.get('activeVersion') or {}).get('nodes') or []) != key(new['nodes']):
    print("补发布:", s.post(f"{BASE}/api/v1/workflows/{CP}/activate", timeout=120).status_code); b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
print("回读: 副本已发布版", b.get('activeVersionId'), "| 已发布 = 写入", key(b['activeVersion']['nodes']) == key(new['nodes']), "| 连线一致", ck(b['activeVersion']['connections']) == ck(new['connections']), "| 启用", b.get('active'), "| 节点", len(b['activeVersion']['nodes']))
