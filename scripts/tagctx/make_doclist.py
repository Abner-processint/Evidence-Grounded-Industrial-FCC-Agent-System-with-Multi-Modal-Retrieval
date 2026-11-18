# -*- coding: utf-8 -*-
"""临时只读小工作流：列出 RAGFlow 各数据集的全部文档名（测完删除）。密钥从主线 Grouped RAGFlow Retrieval 节点代码原样搬，不打印、不落盘。
用法：python make_doclist.py run   → 建、调一次、存 ragflow_docs.json、删"""
import sys, os, io, json, re, secrets, time
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; WF = "WdjEhxyWuv5DPwcs"
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, "n8n_server.pem"); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
CODE = r'''
__KEYLINE__
const base = 'https://<HOST>:8091';
const H = { Authorization: 'Bearer ' + defaultApiKey };
const get = url => this.helpers.httpRequest({ method: 'GET', url: base + url, json: true, timeout: 40000, headers: H, skipSslCertificateValidation: true });
const ds = (((await get('/api/v1/datasets?page=1&page_size=100')) || {}).data) || [];
const out = [];
for (const d of ds) {
  let page = 1, docs = [];
  while (page <= 20) {
    const r = await get('/api/v1/datasets/' + d.id + '/documents?page=' + page + '&page_size=200');
    const items = ((((r || {}).data) || {}).docs) || [];
    docs = docs.concat(items.map(x => ({ name: x.name, run: x.run, chunks: x.chunk_count, size: x.size, updated: x.update_date || x.update_time })));
    if (items.length < 200) break; page += 1;
  }
  out.push({ id: d.id, name: d.name, doc_count: d.document_count, docs });
}
return [{ json: { datasets: out } }];
'''
wf = s.get(f"{BASE}/api/v1/workflows/{WF}", timeout=180).json()
c = {n['name']: n for n in wf['activeVersion']['nodes']}['Grouped RAGFlow Retrieval']['parameters']['jsCode']
m = re.search(r"const defaultApiKey =[\s\S]*?;\n", c); assert m
code = CODE.replace('__KEYLINE__', "function readConfig(n, f) { return f; }\n" + m.group(0))
path = 'tmp-ragdocs-' + secrets.token_hex(6)
body = {"name": "TMP RAGFlow doc list (delete after test)", "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "none"},
        "nodes": [{"id": "b1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "webhookId": secrets.token_hex(8),
                   "parameters": {"httpMethod": "POST", "path": path, "responseMode": "lastNode", "options": {}}},
                  {"id": "b2", "name": "List", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [300, 0], "parameters": {"jsCode": code}}],
        "connections": {"Webhook": {"main": [[{"node": "List", "type": "main", "index": 0}]]}}}
r = s.post(f"{BASE}/api/v1/workflows", json=body, timeout=120); r.raise_for_status(); wid = r.json()['id']
try:
    s.post(f"{BASE}/api/v1/workflows/{wid}/activate", timeout=120)
    time.sleep(2)
    p = requests.Session(); p.trust_env = False; p.verify = os.path.join(TOOLS, "n8n_server.pem")
    rr = p.post(f"{BASE}/webhook/{path}", json={}, timeout=600); print('call', rr.status_code)
    b = rr.json(); b = b[0] if isinstance(b, list) else b
    json.dump(b, io.open(os.path.join(HERE, 'ragflow_docs.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for d in b.get('datasets', []): print(d['name'], d.get('doc_count'), len(d['docs']))
finally:
    print('deactivate', s.post(f"{BASE}/api/v1/workflows/{wid}/deactivate", timeout=120).status_code, 'delete', s.delete(f"{BASE}/api/v1/workflows/{wid}", timeout=120).status_code)
