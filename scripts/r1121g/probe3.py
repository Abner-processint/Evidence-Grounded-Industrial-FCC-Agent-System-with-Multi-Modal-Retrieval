# -*- coding: utf-8 -*-
"""临时 RAGFlow 小工作流（测完删除）：①列数据集文档 ②按文档限定检索。密钥与地址由脚本从副本 Grouped RAGFlow Retrieval 节点原样搬，不打印、不落盘。
用法：python probe2.py create | test | delete"""
import sys, os, io, json, re, secrets, time
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; WF = "EIBVIi74m90EYSsB"
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, "n8n_server.pem"); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
IDF = os.path.join(HERE, 'probe3_id.json')
CODE = r'''
__CFG__
const base = defaultBaseUrl.replace(/\/+$/, '');
const H = { Authorization: 'Bearer ' + defaultApiKey, 'Content-Type': 'application/json' };
const body0 = $input.first().json.body || {};
const call = async (o) => { const t = Date.now(); try { const r = await this.helpers.httpRequest(Object.assign({ json: true, timeout: 30000, headers: H, skipSslCertificateValidation: true }, o)); return { ms: Date.now() - t, r }; } catch (e) { return { ms: Date.now() - t, error: String(e && e.message || e).slice(0, 200) }; } };
const out = {};
if (body0.docs) {
  out.docs = {};
  for (const ds of body0.docs) { const x = await call({ method: 'GET', url: base + '/api/v1/datasets/' + ds + '/documents?page=1&page_size=200' }); out.docs[ds] = { ms: x.ms, error: x.error, names: ((((x.r || {}).data || {}).docs) || []).map(d => ({ id: d.id, name: d.name, run: d.run })) }; }
}
if (body0.enumerate) {
  out.enum = {};
  for (const q of body0.enumerate) {
    const got = new Map(); let pages = 0, err = null;
    for (const qq of (q.questions || ['操作指标'])) {
      for (let page = 1; page <= (q.max_pages || 12); page += 1) {
        const x = await call({ method: 'POST', url: base + '/api/v1/retrieval', body: { question: qq, dataset_ids: [q.ds], document_ids: [q.doc], page, page_size: 100, top_k: 1024, keyword: false, similarity_threshold: 0, vector_similarity_weight: 1 } });
        pages += 1; if (x.error) { err = x.error; break; }
        const cs = ((((x.r || {}).data || {}).chunks) || []);
        for (const c of cs) if (!got.has(c.id)) got.set(c.id, { id: c.id, content: String(c.content || ''), positions: c.positions || null });
        if (cs.length < 100) break;
      }
    }
    out.enum[q.doc] = { n: got.size, pages, err, chunks: Array.from(got.values()) };
  }
}
if (body0.download) {
  out.files = {};
  for (const q of body0.download) {
    try {
      const r = await this.helpers.httpRequest({ method: 'GET', url: base + '/api/v1/datasets/' + q.ds + '/documents/' + q.doc, headers: { Authorization: H.Authorization }, encoding: 'arraybuffer', json: false, timeout: 60000, skipSslCertificateValidation: true });
      const b = Buffer.from(r); out.files[q.doc] = { size: b.length, b64: b.toString('base64') };
    } catch (e) { out.files[q.doc] = { error: String(e && e.message || e).slice(0, 200) }; }
  }
}
if (body0.trial) {
  out.trial = [];
  for (const qs of body0.trial.qs) { const x = await call({ method: 'GET', url: base + '/api/v1/datasets/' + body0.trial.ds + '/documents/' + body0.trial.doc + '/chunks' + qs });
    out.trial.push({ qs, n: ((((x.r || {}).data || {}).chunks) || []).length, total: (((x.r || {}).data || {}).total), err: x.error }); }
}
if (body0.chunks) {
  out.chunks = {};
  for (const q of body0.chunks) {
    const all = [];
    for (let page = 1; page <= 60; page += 1) {
      const x = await call({ method: 'GET', url: base + '/api/v1/datasets/' + q.ds + '/documents/' + q.doc + '/chunks?page=' + page + '&page_size=100' });
      const cs = ((((x.r || {}).data || {}).chunks) || []);
      if (page === 1) out['dbg_' + q.doc] = JSON.stringify(x.r || x.error || null).slice(0, 600);
      if (x.error) { out.chunks[q.doc] = { error: x.error, got: all.length }; break; }
      for (const c of cs) all.push({ id: c.id, content: String(c.content || ''), positions: c.positions || null });
      if (cs.length < 100) break;
    }
    if (!out.chunks[q.doc]) out.chunks[q.doc] = { chunks: all };
  }
}
if (body0.queries) {
  out.results = await Promise.all(body0.queries.map(async q => { const x = await call({ method: 'POST', url: base + '/api/v1/retrieval', body: { question: q.question, dataset_ids: q.dataset_ids, document_ids: q.document_ids, page_size: 3, top_k: 64, keyword: true, similarity_threshold: 0.2, vector_similarity_weight: 0.3 } });
    return { id: q.id, ms: x.ms, error: x.error, chunks: ((((x.r || {}).data || {}).chunks) || []).map(c => ({ doc: c.document_keyword, sim: c.similarity, positions: c.positions, content: String(c.content || '').slice(0, 500) })) }; }));
}
return [{ json: out }];
'''
if sys.argv[1] == 'create':
    wf = s.get(f"{BASE}/api/v1/workflows/{WF}", timeout=180).json()
    c = {n['name']: n for n in wf['activeVersion']['nodes']}['Grouped RAGFlow Retrieval']['parameters']['jsCode']
    rc = re.search(r"function readConfig\(name, fallback = ''\) \{[\s\S]*?\n\}\n", c).group(0)
    bu = re.search(r"const defaultBaseUrl =[\s\S]*?;\n", c).group(0); ak = re.search(r"const defaultApiKey =[\s\S]*?;\n", c).group(0)
    code = CODE.replace('__CFG__', rc + bu + ak)
    path = 'tmp-ragprobe3-' + secrets.token_hex(6)
    body = {"name": "TMP RAGFlow chunk dump (delete after test)", "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "none"},
            "nodes": [{"id": "a1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0], "webhookId": secrets.token_hex(8),
                       "parameters": {"httpMethod": "POST", "path": path, "responseMode": "lastNode", "options": {}}},
                      {"id": "a2", "name": "Probe", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [300, 0], "parameters": {"jsCode": code}}],
            "connections": {"Webhook": {"main": [[{"node": "Probe", "type": "main", "index": 0}]]}}}
    r = s.post(f"{BASE}/api/v1/workflows", json=body, timeout=120); r.raise_for_status(); wid = r.json()['id']
    print('activate', s.post(f"{BASE}/api/v1/workflows/{wid}/activate", timeout=120).status_code)
    json.dump({'id': wid, 'path': path}, io.open(IDF, 'w', encoding='utf-8')); print('created', wid)
elif sys.argv[1] == 'call':
    d = json.load(io.open(IDF, encoding='utf-8'))
    payload = json.load(io.open(sys.argv[2], encoding='utf-8'))
    t = time.time(); r = s.post(f"{BASE}/webhook/{d['path']}", json=payload, timeout=300)
    print('http', r.status_code, round(time.time() - t, 1), 's')
    json.dump(r.json(), io.open(sys.argv[3], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
elif sys.argv[1] == 'delete':
    d = json.load(io.open(IDF, encoding='utf-8'))
    print('deactivate', s.post(f"{BASE}/api/v1/workflows/{d['id']}/deactivate", timeout=120).status_code)
    print('delete', s.delete(f"{BASE}/api/v1/workflows/{d['id']}", timeout=120).status_code)
    os.remove(IDF)
