# -*- coding: utf-8 -*-
"""python put_copy.py <nodes.json>：把构建好的节点写进测试副本（入口节点保留副本自己的），发布并启用；写前把副本现状存进 n8n_project。"""
import sys, os, io, json, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools'))
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; CP = "EIBVIi74m90EYSsB"
BK = r"<USER_HOME>\Desktop\processint\n8n_project"
s = requests.Session(); s.trust_env = False
s.verify = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tools', 'n8n_server.pem')
s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
trig = lambda n: n['type'] == 'n8n-nodes-base.webhook' or n['type'].endswith('chatTrigger')
built = json.load(io.open(sys.argv[1], encoding='utf-8'))
cp = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
json.dump(cp, io.open(os.path.join(BK, f'workflow_{CP}_copy_before_r1109_{stamp}.json'), 'w', encoding='utf-8'), ensure_ascii=False)
CT = {n['name']: n for n in cp['nodes'] if trig(n)}
nodes = [CT.get(n['name'], n) if trig(n) else n for n in built['nodes']]
assert sorted(n['name'] for n in nodes if trig(n)) == sorted(CT), 'trigger set differs'
body = {'name': cp['name'], 'nodes': nodes, 'connections': built['connections'], 'settings': cp.get('settings', {})}
r = s.put(f"{BASE}/api/v1/workflows/{CP}", json=body, timeout=300); print('PUT', r.status_code, r.text[:200] if r.status_code >= 300 else '')
r.raise_for_status()
r = s.post(f"{BASE}/api/v1/workflows/{CP}/activate", timeout=120); print('activate', r.status_code, r.text[:200] if r.status_code >= 300 else '')
cp2 = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json()
av = cp2.get('activeVersion') or {}
same = {n['name']: json.dumps(n['parameters'], sort_keys=True) for n in av.get('nodes', [])}
bad = [n['name'] for n in nodes if json.dumps(n['parameters'], sort_keys=True) != same.get(n['name'])]
print('active', cp2.get('active'), 'version', cp2.get('activeVersionId'), 'nodes', len(av.get('nodes', [])), 'mismatch', bad)
