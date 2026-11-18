# -*- coding: utf-8 -*-
"""写测试副本：以副本 r1112 之前的备份（17a6a94b，= 主线 847d97b5 内容）为底，依次跑给定的构建脚本，PUT + 发布。
默认只核对，APPLY=1 写入。环境变量：CUR=副本现版前缀，BUILDS=逗号分隔的构建脚本（相对 n8n_project），EXPECT=逗号分隔、与副本现版相比应改动的节点，TAG=备份文件名标记。"""
import sys, os, io, json, time, subprocess, tempfile, shutil, glob
HERE = os.path.dirname(os.path.abspath(__file__)); PROJ = os.path.join(HERE, '..'); TOOLS = os.path.join(PROJ, 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; CP = "EIBVIi74m90EYSsB"
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, "n8n_server.pem"); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
ck = lambda x: json.dumps(x, sort_keys=True); key = lambda nodes: ck(sorted(nodes, key=lambda n: n['name']))
cp = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json(); cav = cp['activeVersion']
assert cp['activeVersionId'].startswith(os.environ['CUR']), cp['activeVersionId']
assert key(cp['nodes']) == key(cav['nodes']), "副本有未发布草稿"
bf = sorted(glob.glob(os.path.join(PROJ, f"workflow_{CP}_copy_before_r1112_*.json")))[-1]
cur = json.load(io.open(bf, encoding='utf-8')); assert cur['activeVersionId'].startswith('17a6a94b')
td = tempfile.mkdtemp()
for k, b in enumerate([x for x in os.environ['BUILDS'].split(',') if x]):
    p0 = os.path.join(td, '%d_in.json' % k); p1 = os.path.join(td, '%d_out.json' % k)
    json.dump(cur, io.open(p0, 'w', encoding='utf-8'), ensure_ascii=False)
    r = subprocess.run([sys.executable, os.path.join(PROJ, b), p0, p1], capture_output=True, text=True, encoding='utf-8'); assert r.returncode == 0, (b, r.stderr[-800:])
    cur = json.load(io.open(p1, encoding='utf-8'))
shutil.rmtree(td)
new = cur['activeVersion']
C = {n['name']: n for n in cav['nodes']}; Nn = {n['name']: n for n in new['nodes']}
assert sorted(C) == sorted(Nn)
changed = sorted(n for n in C if ck(C[n]) != ck(Nn[n])); print('与副本现版相比改动', changed); assert changed == sorted(os.environ['EXPECT'].split(','))
assert ck(new['connections']) == ck(cav['connections'])
for nn, n in Nn.items():
    c = n['parameters'].get('jsCode')
    if not c or ck(n) == ck(C[nn]): continue
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write('(async function(){\n' + c + '\n});'); p = f.name
    rr = subprocess.run([shutil.which('node'), '--check', p], capture_output=True, text=True); os.unlink(p); assert rr.returncode == 0, (nn, rr.stderr); print(nn, 'syntax OK')
if os.environ.get("APPLY") != "1": print("（仅核对，未写入）"); raise SystemExit
stamp = time.strftime('%Y%m%d-%H%M%S')
io.open(os.path.join(PROJ, f"workflow_{CP}_copy_before_{os.environ.get('TAG', 'x')}_{stamp}.json"), 'w', encoding='utf-8').write(json.dumps(cp, ensure_ascii=False))
ALLOWED = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"}
r = s.put(f"{BASE}/api/v1/workflows/{CP}", json={"name": cp["name"], "nodes": new["nodes"], "connections": new["connections"], "settings": {k: v for k, v in (cp.get("settings") or {}).items() if k in ALLOWED}}, timeout=300)
print("PUT:", r.status_code, r.text[:200] if r.status_code >= 300 else '')
b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
if key((b.get('activeVersion') or {}).get('nodes') or []) != key(new['nodes']):
    print("补发布:", s.post(f"{BASE}/api/v1/workflows/{CP}/activate", timeout=120).status_code); b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
print("回读: 副本已发布版", b.get('activeVersionId'), "| 已发布 = 写入", key(b['activeVersion']['nodes']) == key(new['nodes']), "| 启用", b.get('active'))
