# -*- coding: utf-8 -*-
"""按 exec/<run>.json 里已记下的执行编号重拉，补存 display_map 与 crp_packet。"""
import json, io, os, sys, glob, concurrent.futures as cf
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, 'n8n_server.pem'); s.headers['X-N8N-API-KEY'] = os.environ['N8N_API_KEY']
F = ('evidence_id', 'document_name', 'dataset_name', 'section_title', 'source_tier_label', 'snippet', 'content_summary', 'key_values')
def one(p):
    X = json.load(io.open(p, encoding='utf-8'))
    if 'display_map' in X: return p, 'skip'
    full = s.get('https://<HOST>:5678/n8n/api/v1/executions/%s' % X['exec_id'], params={'includeData': 'true'}, timeout=900).json()
    rd = full['data']['resultData']['runData']
    try: X['display_map'] = rd['Code in JavaScript'][-1]['data']['main'][0][0]['json'].get('evidence_display_id_map') or {}
    except Exception: X['display_map'] = {}
    try: X['crp_packet'] = [{k: x.get(k) for k in F} for x in rd['Compact Result Projector'][-1]['data']['main'][0][0]['json'].get('evidence_packet') or []]
    except Exception: X['crp_packet'] = []
    json.dump(X, io.open(p, 'w', encoding='utf-8'), ensure_ascii=False)
    return p, '%d map, %d crp' % (len(X['display_map']), len(X['crp_packet']))
with cf.ThreadPoolExecutor(4) as ex:
    for p, st in ex.map(one, sorted(glob.glob(os.path.join(HERE, 'exec', '*.json')))): print(os.path.basename(p), st, flush=True)
