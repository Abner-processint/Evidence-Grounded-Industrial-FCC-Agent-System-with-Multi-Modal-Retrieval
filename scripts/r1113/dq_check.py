# -*- coding: utf-8 -*-
"""计算量一链核对：每次执行看 代码补取仪表数据的记录、因子与写明的位号、DR 仪表事实、模型写的式子、算出的值。
用法：python dq_check.py <execId> ...（先下到 LOCAL_EXEC_DIR/e_<id>.json，没有就取）"""
import sys, os, io, json
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools'); sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
LOCAL = os.environ['LOCAL_EXEC_DIR']
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, 'n8n_server.pem'); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]


def load(i):
    p = os.path.join(LOCAL, 'e_%s.json' % i)
    if not os.path.exists(p):
        r = s.get(f"https://<HOST>:5678/n8n/api/v1/executions/{i}", params={'includeData': 'true'}, timeout=900).json()
        json.dump(r, io.open(p, 'w', encoding='utf-8'), ensure_ascii=False)
    return json.load(io.open(p, encoding='utf-8'))['data']['resultData']['runData']


def g(rd, n, i=-1):
    try: return rd[n][i]['data']['main'][0][0]['json']
    except Exception: return None


for i in sys.argv[1:]:
    rd = load(i); q = (g(rd, 'Capture context', 0) or {}).get('originalUserMessage', '')
    p = g(rd, 'Prepare Derived Quantity Check')
    print('==', i, q[:40])
    if not p: print('   没走计算量'); continue
    print('   代码补取:', p.get('input_instrument_facts'))
    print('   因子:', [(f.get('source_label'), f.get('documented_tags')) for f in p['unit']['params'].get('factors', [])])
    print('   DR 事实:', sorted({(f['equipment_tag'], f['field_path'], f['value']) for f in p.get('engineering_facts', []) if str(f.get('equipment_tag', '')).startswith('DR')}))
    dq = g(rd, 'Derived Quantity LLM')
    try:
        o = json.loads(dq['output'][dq['output'].find('{'):dq['output'].rfind('}') + 1])
        for d in o.get('derived_quantities', []):
            print('   式子:', d.get('source_label'), '|', d.get('expression'), '|', [(v.get('symbol'), (v.get('plant_model_ref') or {}).get('equipment_tag'), (v.get('plant_model_ref') or {}).get('field_path'), v.get('unit')) for v in d.get('variables', [])])
    except Exception as e:
        print('   式子解析失败', e)
    c = g(rd, 'Compute Derived Quantities')
    if c:
        print('   结果:', [(d.get('source_label'), d.get('status'), (d.get('results') or [{}])[0].get('value_rounded'), d.get('result_unit')) for d in c.get('derived_quantity_results') or []])
