# -*- coding: utf-8 -*-
"""r1121g 写测试副本：以副本现发布版（da3fd537）为底跑 r1121g_build.py，无增删、连线不变、语法通过。默认只核对，APPLY=1 写入。"""
import sys, os, io, json, time, subprocess, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; CP = "EIBVIi74m90EYSsB"; PROJ = os.path.join(HERE, '..')
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, "n8n_server.pem"); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
ck = lambda x: json.dumps(x, sort_keys=True); key = lambda nodes: ck(sorted(nodes, key=lambda n: n['name']))
cp = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json(); cav = cp['activeVersion']
assert cp['activeVersionId'].startswith(os.environ.get('CUR', 'da3fd537')), cp['activeVersionId']
assert key(cp['nodes']) == key(cav['nodes']), "副本有未发布草稿"
td = tempfile.mkdtemp(); p0 = os.path.join(td, 'in.json'); p1 = os.path.join(td, 'out.json')
json.dump(cp, io.open(p0, 'w', encoding='utf-8'), ensure_ascii=False)
r = subprocess.run([sys.executable, os.path.join(HERE, 'r1121g_build.py'), p0, p1], capture_output=True, text=True, encoding='utf-8'); assert r.returncode == 0, r.stderr[-800:]
new = json.load(io.open(p1, encoding='utf-8'))['activeVersion']; shutil.rmtree(td)
O = {n['name']: n for n in cav['nodes']}; Nn = {n['name']: n for n in new['nodes']}
changed = sorted(n for n in O if n in Nn and ck(O[n]) != ck(Nn[n])); added = sorted(set(Nn) - set(O)); print('新增', added, '改动', changed)
assert set(O) <= set(Nn) and added == ['Apply Regulation Pick', 'DeepSeek-RegulationPick', 'Prepare Regulation Pick', 'Regulation Pick LLM'] and changed == ['Evidence Packet Builder']
oc, nc = cav['connections'], new['connections']
diff = sorted(k for k in set(oc) | set(nc) if ck(oc.get(k)) != ck(nc.get(k))); print('连线变化', diff)
assert diff == ['Capture context', 'DeepSeek-RegulationPick', 'Prepare Regulation Pick', 'Regulation Pick LLM']
for n in ('Evidence Packet Builder', 'Prepare Regulation Pick', 'Apply Regulation Pick'):
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write('(async function(){\n' + Nn[n]['parameters']['jsCode'] + '\n});'); p = f.name
    rr = subprocess.run([shutil.which('node'), '--check', p], capture_output=True, text=True); os.unlink(p); assert rr.returncode == 0, rr.stderr; print(n, 'syntax OK')
if os.environ.get("APPLY") != "1": print("（仅核对，未写入）"); raise SystemExit
stamp = time.strftime('%Y%m%d-%H%M%S')
io.open(os.path.join(PROJ, f"workflow_{CP}_copy_before_r1121g_{stamp}.json"), 'w', encoding='utf-8').write(json.dumps(cp, ensure_ascii=False))
ALLOWED = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"}
r = s.put(f"{BASE}/api/v1/workflows/{CP}", json={"name": cp["name"], "nodes": new["nodes"], "connections": new["connections"], "settings": {k: v for k, v in (cp.get("settings") or {}).items() if k in ALLOWED}}, timeout=300)
print("PUT:", r.status_code, r.text[:300] if r.status_code >= 300 else '')
b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
if key((b.get('activeVersion') or {}).get('nodes') or []) != key(new['nodes']):
    print("补发布:", s.post(f"{BASE}/api/v1/workflows/{CP}/activate", timeout=120).status_code); b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
print("回读: 副本已发布版", b.get('activeVersionId'), "| 已发布 = 写入", key(b['activeVersion']['nodes']) == key(new['nodes']), "| 启用", b.get('active'), "| 节点", len(b['activeVersion']['nodes']))
