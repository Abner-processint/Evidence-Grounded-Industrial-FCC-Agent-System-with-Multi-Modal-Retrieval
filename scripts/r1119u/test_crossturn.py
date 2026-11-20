# -*- coding: utf-8 -*-
"""跨轮模拟：R10 第 1 次的真实输入跑新代码得到 alarm_table_majority（含 all_sets）；再把它放进会话状态、
并把本轮输入里的表格全部抹掉（<table → <tabl_），模拟下一轮证据里没有该表。期望：TIA3216 仍按各套并列，不退回只用一套。"""
import json, io, os, sys, subprocess, shutil, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
REC = os.path.join(HERE, '..', 'r1119t', 'rec')
new = {n['name']: n for n in json.load(io.open(sys.argv[1], encoding='utf-8'))['activeVersion']['nodes']}['Evidence Packet Builder']['parameters']['jsCode']


def run(c, nodes, inp, ri):
    h = ('const NODES = ' + json.dumps(nodes, ensure_ascii=False) + ';\nconst INPUT = ' + json.dumps(inp, ensure_ascii=False) + ';\n'
         'const $ = n => ({ first: () => ({ json: (NODES[n]||[{}])[0] || {} }), last: () => ({ json: (NODES[n]||[{}]).slice(-1)[0] || {} }), all: (a, r) => (NODES[n]||[]).slice(0, r == null ? undefined : r + 1).map(j => ({ json: j })), item: { json: (NODES[n]||[{}])[0] || {} } });\n'
         'const $input = { first: () => ({ json: INPUT }), all: () => [{ json: INPUT }], item: { json: INPUT } };\nconst $json = INPUT; const __sd = {}; const $getWorkflowStaticData = () => __sd; const $runIndex = ' + str(ri) + ';\n'
         'const __ctx = { helpers: { httpRequest: async () => { throw new Error("offline"); } } };\n'
         '(async function () {\n' + c + '\n}).call(__ctx).then(r => { const j = (Array.isArray(r) ? r[0] : r) || {}; const o = j.json || j; '
         'console.log(JSON.stringify({ reg: o.threshold_registry, cmp: o.threshold_comparison, maj: o.alarm_table_majority })); }).catch(e => console.log(JSON.stringify({ THROW: String(e && e.message) })));\n')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(h); p = f.name
    rr = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8', timeout=300); os.unlink(p)
    return json.loads(rr.stdout.strip().splitlines()[-1])


R = json.load(io.open(os.path.join(REC, '204278.json'), encoding='utf-8'))
nodes = dict(R['nodes']); nodes['Evidence Packet Builder'] = [x['full_out'] for x in R['epb']]
a = run(new, nodes, R['epb'][0]['input'], 0)
maj = a['maj'] or {}
print('第 1 轮 T3216 保存的套数:', len((maj.get('T3216') or {}).get('all_sets') or []))
print('第 1 轮 TIA3216 比对:', [x['statement'][:200] for x in a['cmp'] or [] if 'TIA3216' in x['column']])
# 第 2 轮：会话状态带上第 1 轮保存的定值，本轮输入与上游节点里的表格全部抹掉
cap = json.loads(json.dumps(nodes['Capture context'][0]))
st = cap.get('conversation_state') or {}
if isinstance(st, str): st = json.loads(st or '{}')
st['alarm_table_majority'] = maj; cap['conversation_state'] = st
nodes2 = json.loads(json.dumps(nodes, ensure_ascii=False).replace('<table', '<tabl_')); nodes2['Capture context'] = [cap]
inp2 = json.loads(json.dumps(R['epb'][0]['input'], ensure_ascii=False).replace('<table', '<tabl_'))
b = run(new, nodes2, inp2, 0)
print('第 2 轮 T3216 登记:', json.dumps((b.get('reg') or {}).get('T3216'), ensure_ascii=False)[:600])
print('第 2 轮 TIA3216 比对:', [x['statement'][:400] for x in b.get('cmp') or [] if 'TIA3216' in x['column']])
