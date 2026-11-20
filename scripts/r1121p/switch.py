# -*- coding: utf-8 -*-
"""副本在两个版本之间切换（只用于对比实跑）：python switch.py <备份或构建好的工作流 json> <期望当前版本前缀>
把文件里的已发布节点与连线写入副本并发布；写前核对当前版本前缀、无未发布草稿；写后回读。"""
import sys, os, io, json, time
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; CP = "EIBVIi74m90EYSsB"
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, "n8n_server.pem"); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
ck = lambda x: json.dumps(x, sort_keys=True); key = lambda ns: ck(sorted(ns, key=lambda n: n['name']))
src = json.load(io.open(sys.argv[1], encoding='utf-8')); sav = src.get('activeVersion') or src
cp = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
assert cp['activeVersionId'].startswith(sys.argv[2]), cp['activeVersionId']
assert key(cp['nodes']) == key(cp['activeVersion']['nodes']), '副本有未发布草稿'
ALLOWED = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"}
r = s.put(f"{BASE}/api/v1/workflows/{CP}", json={"name": cp["name"], "nodes": sav["nodes"], "connections": sav["connections"], "settings": {k: v for k, v in (cp.get("settings") or {}).items() if k in ALLOWED}}, timeout=300)
print("PUT", r.status_code)
b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
if key(b['activeVersion']['nodes']) != key(sav['nodes']):
    print('activate', s.post(f"{BASE}/api/v1/workflows/{CP}/activate", timeout=120).status_code); b = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
print('回读', b['activeVersionId'], '一致', key(b['activeVersion']['nodes']) == key(sav['nodes']), '节点', len(b['activeVersion']['nodes']))
