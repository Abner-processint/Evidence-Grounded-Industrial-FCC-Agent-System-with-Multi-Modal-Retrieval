# -*- coding: utf-8 -*-
"""单测：从本地执行记录取各节点输出，喂给 turn_card_v3.js 的 buildTurnCardV3，打印卡片；与 ctx_audit/build_cards.py（Python 原型 v3）对照位号集合。
用法：python test_card.py <id> ...（需 LOCAL_EXEC_DIR 下有 e_<id>.json）"""
import json, io, os, sys, subprocess, shutil, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'ctx_audit'))
from build_cards import cards_for
LOCAL = os.environ['LOCAL_EXEC_DIR']
JS = io.open(os.path.join(HERE, 'turn_card_v3.js'), encoding='utf-8').read()
NODES = ['Evidence Packet Builder', 'Coverage Gate', 'Prepare Factor Resolution', 'Compute Derived Quantities']
for i in sys.argv[1:]:
    e = json.load(io.open(os.path.join(LOCAL, 'e_%s.json' % i), encoding='utf-8')); rd = e['data']['resultData']['runData']
    data = {}
    for n in NODES:
        runs = rd.get(n) or []
        try: data[n] = runs[int(os.environ.get('RUN', '-1'))]['data']['main'][0][0]['json'] if runs else {}
        except Exception: data[n] = {}
    q = (rd['Capture context'][0]['data']['main'][0][0]['json']).get('originalUserMessage')
    harness = ('const D = ' + json.dumps(data, ensure_ascii=False) + ';\n'
               'function nodeJson(n){ return D[n] || {}; }\n'
               'function asString(x){ return typeof x === "string" ? x.trim() : (x == null ? "" : String(x).trim()); }\n'
               'function asArray(x){ return Array.isArray(x) ? x : []; }\n'
               'function asObject(x){ return x && typeof x === "object" && !Array.isArray(x) ? x : {}; }\n'
               + JS + '\nconsole.log(JSON.stringify(buildTurnCardV3("T1", ' + json.dumps(q, ensure_ascii=False) + ')));\n')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(harness); p = f.name
    r = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
    if r.returncode: print(i, 'JS ERROR', r.stderr[-600:]); continue
    c = json.loads(r.stdout or 'null')
    py = cards_for([int(i)])[0]
    jt = sorted((q['quantity'], tuple(sorted(q['tags'])), q['settled']) for q in (c or {}).get('quantities', []))
    pt = sorted((q['quantity'], tuple(sorted(q['tags'])), q['settled']) for q in py.get('quantities', []))
    print('==', i, q, '| period', (c or {}).get('period_used'), (c or {}).get('period_source'), '| chars', len(r.stdout))
    for x in jt: print('   JS', x, '' if x in pt else '  <- 原型没有')
    for x in pt:
        if x not in jt: print('   PY only', x)
    print('   derived', (c or {}).get('derived_quantities'))
