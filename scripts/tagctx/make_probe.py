# -*- coding: utf-8 -*-
"""临时 RAGFlow 检索小工作流（测完删除）：Webhook → Code（按主线 Grouped RAGFlow Retrieval 同样的地址、密钥、数据集调 /api/v1/retrieval）。
密钥：从主线已发布版该节点代码里原样搬 `const defaultApiKey = ...;` 那一句进临时节点，脚本不打印、不落盘。
用法：python make_probe.py create   → 打印 workflow id 与 webhook 路径（存 probe_id.json）
      python make_probe.py delete   → 停用并删除"""
import sys, os, io, json, re, secrets
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; WF = "WdjEhxyWuv5DPwcs"
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, "n8n_server.pem"); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
IDF = os.path.join(HERE, 'probe_id.json')

CODE_TMPL = r'''
// 临时：按位号 / 按量名检索 RAGFlow（与主线 Grouped RAGFlow Retrieval 同地址、同密钥）
__KEYLINE__
const base = 'https://<HOST>:8091';
const DS = ['ed6ad896f6f411f0a7b933d55f4fdf13','2baed3e8f6f311f0a7b933d55f4fdf13','1877d018f6f311f0a7b933d55f4fdf13','f70101a2f6f211f0a7b933d55f4fdf13','e85e9d30f6f211f0a7b933d55f4fdf13','18b63458f6f211f0a7b933d55f4fdf13'];
const body0 = $input.first().json.body || $input.first().json || {};
const qs = (body0.queries || []).slice(0, 8);
const t0 = Date.now();
const one = async (q) => {
  const t = Date.now();
  try {
    const r = await this.helpers.httpRequest({ method: 'POST', url: base + '/api/v1/retrieval', json: true, timeout: 40000,
      headers: { Authorization: 'Bearer ' + defaultApiKey, 'Content-Type': 'application/json' },
      skipSslCertificateValidation: true,
      body: { question: q.question, dataset_ids: q.dataset_ids || DS, page_size: q.page_size || 10, top_k: q.top_k || 64, keyword: q.keyword !== false,
              similarity_threshold: q.similarity_threshold ?? 0.1, vector_similarity_weight: q.vector_similarity_weight ?? 0.3 } });
    const chunks = (((r || {}).data || {}).chunks || []).map(c => ({ doc: c.document_keyword || c.docnm_kwd || '', sim: c.similarity, content: String(c.content || '').slice(0, 400) }));
    return { id: q.id, question: q.question, ms: Date.now() - t, n: chunks.length, chunks };
  } catch (e) { return { id: q.id, question: q.question, ms: Date.now() - t, error: String(e && e.message || e).slice(0, 200) }; }
};
const results = await Promise.all(qs.map(one));
return [{ json: { ms: Date.now() - t0, results } }];
'''

if sys.argv[1] == 'create':
    wf = s.get(f"{BASE}/api/v1/workflows/{WF}", timeout=180).json()
    c = {n['name']: n for n in wf['activeVersion']['nodes']}['Grouped RAGFlow Retrieval']['parameters']['jsCode']
    m = re.search(r"const defaultApiKey =[\s\S]*?;\n", c); assert m, 'key line not found'
    code = CODE_TMPL.replace('__KEYLINE__', "function readConfig(n, f) { return f; }\n" + m.group(0))
    path = 'tmp-ragprobe-' + secrets.token_hex(6)
    body = {"name": "TMP RAGFlow tag probe (delete after test)", "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "none"},
            "nodes": [
                {"id": "a1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "webhookId": secrets.token_hex(8),
                 "parameters": {"httpMethod": "POST", "path": path, "responseMode": "lastNode", "options": {}}},
                {"id": "a2", "name": "Probe", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [300, 0], "parameters": {"jsCode": code}}],
            "connections": {"Webhook": {"main": [[{"node": "Probe", "type": "main", "index": 0}]]}}}
    r = s.post(f"{BASE}/api/v1/workflows", json=body, timeout=120); r.raise_for_status(); wid = r.json()['id']
    a = s.post(f"{BASE}/api/v1/workflows/{wid}/activate", timeout=120); print('activate', a.status_code)
    json.dump({'id': wid, 'path': path}, io.open(IDF, 'w', encoding='utf-8'))
    print('created', wid, path)
elif sys.argv[1] == 'delete':
    d = json.load(io.open(IDF, encoding='utf-8'))
    print('deactivate', s.post(f"{BASE}/api/v1/workflows/{d['id']}/deactivate", timeout=120).status_code)
    print('delete', s.delete(f"{BASE}/api/v1/workflows/{d['id']}", timeout=120).status_code)
    os.remove(IDF)
