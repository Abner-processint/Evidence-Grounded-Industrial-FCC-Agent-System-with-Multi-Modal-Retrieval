# -*- coding: utf-8 -*-
"""调临时检索小工作流：probe(queries) -> results；queries=[{id, question, ...}]，每次 ≤8 条。"""
import json, io, os, requests, time, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__))
_s = requests.Session(); _s.trust_env = False; _s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
def _path(): return json.load(io.open(os.path.join(HERE, 'probe_id.json'), encoding='utf-8'))['path']
def probe(queries):
    out = []
    def call(batch):
        for k in range(3):
            try:
                r = _s.post('https://<HOST>:5678/n8n/webhook/' + _path(), json={'queries': batch}, timeout=180); r.raise_for_status()
                b = r.json(); b = b[0] if isinstance(b, list) else b; return b['results']
            except Exception as e:
                err = str(e); time.sleep(3)
        return [{'id': q['id'], 'error': err} for q in batch]
    batches = [queries[i:i + 8] for i in range(0, len(queries), 8)]
    with cf.ThreadPoolExecutor(2) as ex:
        for res in ex.map(call, batches): out += res
    return out
