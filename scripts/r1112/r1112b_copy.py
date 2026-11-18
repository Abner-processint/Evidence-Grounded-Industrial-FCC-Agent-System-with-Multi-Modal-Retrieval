# -*- coding: utf-8 -*-
"""r1112b 写到测试副本：卡片补记直接读历史库（mongo_read）、几个计算量共用的输入只记一次。
以副本 r1112 之前的备份（17a6a94b）为底重跑 r1112_build.py，与副本现版（5263dc77）相比应只改 Save Conversation State。默认只核对，APPLY=1 写入。"""
import sys, os, io, json, time, subprocess, tempfile, shutil, glob
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; CP = "EIBVIi74m90EYSsB"; BK = os.path.join(HERE, '..')
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, "n8n_server.pem"); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
ck = lambda x: json.dumps(x, sort_keys=True); key = lambda nodes: ck(sorted(nodes, key=lambda n: n['name']))
cp = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json(); cav = cp['activeVersion']
assert cp['activeVersionId'].startswith('5263dc77'), cp['activeVersionId']
assert key(cp['nodes']) == key(cav['nodes']), "副本有未发布草稿"
bf = sorted(glob.glob(os.path.join(BK, f"workflow_{CP}_copy_before_r1112_*.json")))[-1]
old = json.load(io.open(bf, encoding='utf-8')); assert old['activeVersionId'].startswith('17a6a94b')
td = tempfile.mkdtemp(); p0 = os.path.join(td, 'c.json'); p1 = os.path.join(td, 'o.json')
json.dump(old, io.open(p0, 'w', encoding='utf-8'), ensure_ascii=False)
r = subprocess.run([sys.executable, os.path.join(HERE, 'r1112_build.py'), p0, p1, '17a6a94b'], capture_output=True, text=True, encoding='utf-8'); assert r.returncode == 0, r.stderr[-800:]
new = json.load(io.open(p1, encoding='utf-8')); shutil.rmtree(td)
C = {n['name']: n for n in cav['nodes']}; Nn = {n['name']: n for n in new['nodes']}
assert sorted(C) == sorted(Nn)
changed = sorted(n for n in C if ck(C[n]) != ck(Nn[n])); print('与副本现版相比改动', changed); assert changed == ['Save Conversation State']
assert ck(new['connections']) == ck(cav['connections'])
c = Nn['Save Conversation State']['parameters']['jsCode']
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write('(async function(){\n' + c + '\n});'); p = f.name
rr = subprocess.run([shutil.which('node'), '--check', p], capture_output=True, text=True); os.unlink(p); assert rr.returncode == 0, rr.stderr; print('syntax OK')
assert 'stats|read' in c and 'seenTags.has(sortedKey(tags))) continue; // 几个计算量' in c
if os.environ.get("APPLY") != "1": print("（仅核对，未写入）"); raise SystemExit
stamp = time.strftime('%Y%m%d-%H%M%S')
io.open(os.path.join(BK, f"workflow_{CP}_copy_before_r1112b_{stamp}.json"), 'w', encoding='utf-8').write(json.dumps(cp, ensure_ascii=False))
ALLOWED = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"}
r = s.put(f"{BASE}/api/v1/workflows/{CP}", json={"name": cp["name"], "nodes": new["nodes"], "connections": new["connections"], "settings": {k: v for k, v in (cp.get("settings") or {}).items() if k in ALLOWED}}, timeout=300)
print("PUT:", r.status_code, r.text[:200] if r.status_code >= 300 else '')
b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
if key((b.get('activeVersion') or {}).get('nodes') or []) != key(new['nodes']):
    print("补发布:", s.post(f"{BASE}/api/v1/workflows/{CP}/activate", timeout=120).status_code); b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
print("回读: 副本已发布版", b.get('activeVersionId'), "| 已发布 = 写入", key(b['activeVersion']['nodes']) == key(new['nodes']), "| 启用", b.get('active'))
