# -*- coding: utf-8 -*-
"""覆盖检查离线重放：从本地执行记录取 Coverage Check LLM 首次调用的输入（Coverage Gate 输出 + 同次执行的同义词库 / 知识库），
按节点模板拼用户消息，现行 vs 加 FACTOR_SCOPE_V1 各 N 遍（试验台同型号温度 0）。
用法：python bench_cc.py <main.json> <e_*.json ...>；结果写 bench_cc_out.json。"""
import json, io, sys, os, requests
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from cc_prompt import patch_cc
N_REP = int(os.environ.get('NREP', '2'))
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(HERE, '..', 'tools', 'n8n_server.pem')
HOOK = 'https://<HOST>:5678/n8n/webhook/<WEBHOOK_PATH>'
m = json.load(io.open(sys.argv[1], encoding='utf-8')); NN = {n['name']: n for n in m['activeVersion']['nodes']}
P = NN['Coverage Check LLM']['parameters']; SYS0 = P['options']['systemMessage']; SYS1 = patch_cc(SYS0); T = P['text']
assert T.count('{{') == 8, T.count('{{')  # 模板若改了，这里要跟着改
js = lambda v: json.dumps(v, ensure_ascii=False, separators=(',', ':'))
st = lambda v: v.strip() if isinstance(v, str) else ('' if v is None else str(v).strip())
def render(cp, d, kb):
    dic = '\n'.join([str(t.get('规范术语')) + '：' + str(t.get('同义词/别名')) for t in (d.get('专业术语同义词') or [])] +
                    [str(e.get('规范设备名称')) + ((' ' + str(e.get('设备ID'))) if e.get('设备ID') else '') + '：' + str(e.get('设备别名')) for e in (d.get('设备别名') or [])])
    kbs = '\n'.join(str(e.get('id')) + ' ' + st(e.get('name')) + '（又叫：' + '、'.join(map(str, e.get('aliases') or [])) + '；单位 ' + st(e.get('unit')) + '）：' + st(e.get('meaning')) +
                    ((' 注意：' + st(e.get('not_this'))) if st(e.get('not_this')) else '') for e in ((kb or {}).get('entries') or []))
    i1 = T.index('Plant synonym list'); i2 = T.index('Plant knowledge base (PLANT_KNOWLEDGE_BASE_V1)')
    head = T[1:i1]
    for k in ('question',):
        head = head.replace('{{ $json.coverage_packet.%s }}' % k, cp.get(k) or '')
    for k in ('date_range', 'question_parts', 'historian', 'evidence'):
        head = head.replace('{{ JSON.stringify($json.coverage_packet.%s) }}' % k, js(cp.get(k)))
    head = head.replace('{{ JSON.stringify($json.coverage_packet.planned_historian_without_measurements === true) }}', js(cp.get('planned_historian_without_measurements') is True))
    assert '{{' not in head
    syn = T[i1:i2]; syn = syn[:syn.index('{{')] + dic + syn[syn.index('}}', syn.rindex('})()')) + 2:]
    kbt = T[i2:]; kbt = kbt[:kbt.index('{{')] + kbs + kbt[kbt.rindex('}}') + 2:]
    return head + syn + kbt
cases = []
for f in sys.argv[2:]:
    rd = json.load(io.open(f, encoding='utf-8'))['data']['resultData']['runData']
    if not rd.get('Coverage Check LLM'): continue
    cp = rd['Coverage Gate'][0]['data']['main'][0][0]['json']['coverage_packet']
    d = rd['Read MongoDB dictionary'][0]['data']['main'][0][0]['json']
    kb = (rd.get('Plant Knowledge Base') or [{'data': {'main': [[{'json': {}}]]}}])[0]['data']['main'][0][0]['json'].get('plant_knowledge')
    live = rd['Coverage Check LLM'][0]['data']['main'][0][0]['json'].get('output', '')
    cases.append({'case': os.path.basename(f)[2:-5], 'user': render(cp, d, kb), 'live': live})
print('cases', [c['case'] for c in cases], flush=True)
items = []
for c in cases:
    for _ in range(N_REP): items += [{'system': SYS0, 'user': c['user']}, {'system': SYS1, 'user': c['user']}]
outs = []
for i in range(0, len(items), 8):
    r = s.post(HOOK, json={'items': items[i:i + 8]}, timeout=1800); r.raise_for_status(); b = r.json()
    outs += (b if isinstance(b, dict) else b[0])['outputs']; print('batch', i // 8, '/', (len(items) + 7) // 8, flush=True)
res = [{'case': c['case'], 'live': c['live'], 'cur': outs[k * 2 * N_REP:(k + 1) * 2 * N_REP][0::2], 'new': outs[k * 2 * N_REP:(k + 1) * 2 * N_REP][1::2]} for k, c in enumerate(cases)]
json.dump(res, io.open(os.path.join(HERE, 'bench_cc_out.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('done', len(res))
