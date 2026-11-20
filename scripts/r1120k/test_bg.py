# -*- coding: utf-8 -*-
"""BACKGROUND_SOURCE_CITE_V1 离线试验：已有回答 → PREP_JS（node）→ 试验台 DeepSeek（温度 0，RSYS）→ APPLY_JS（node），存 test_out/<run>.md 与汇总。
用法：python test_bg.py <runs 目录> [<runs 目录> ...]"""
import sys, os, io, json, glob, subprocess, shutil, tempfile, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'accept'))
from bg_source import RSYS, PREP_JS, APPLY_JS
import score as S  # 试验台调用
OUT = os.path.join(HERE, 'test_out'); os.makedirs(OUT, exist_ok=True)


def node(code, inp, nodes):
    h = ('const NODES = ' + json.dumps(nodes, ensure_ascii=False) + ';\nconst INPUT = ' + json.dumps(inp, ensure_ascii=False) + ';\n'
         'const $ = n => ({ first: () => ({ json: NODES[n] || {} }) });\nconst $input = { first: () => ({ json: INPUT }) };\n'
         '(async function () {\n' + code + '\n})().then(r => console.log(JSON.stringify(r[0].json))).catch(e => console.log(JSON.stringify({ THROW: String(e.message) })));\n')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(h); p = f.name
    rr = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
    return json.loads(rr.stdout.strip().splitlines()[-1])


runs = []
for d in sys.argv[1:]:
    for p in sorted(glob.glob(os.path.join(d, '*_1.json'))):
        r = json.load(io.open(p, encoding='utf-8'))
        if r.get('http') == 200: runs.append(r)
preps = []
for r in runs:
    pr = node(PREP_JS, {'output': r['answer'], 'originalUserMessage': r['question']}, {})
    preps.append(pr)
outs = S.bench([{'system': RSYS, 'user': p['bg_source_user']} for p in preps])
stat = collections.Counter(); rows = []
for r, pr, o in zip(runs, preps, outs):
    ap = node(APPLY_JS, {'output': o}, {'Prepare Background Sources': pr})
    t = ap.get('background_source_cite') or {}
    stat['answers'] += 1; stat['sentences'] += len(pr.get('bg_sentences') or []); stat['marked'] += t.get('marked', 0); stat['books'] += t.get('books', 0)
    stat['with_k'] += 1 if t.get('marked') else 0; stat['parse_fail'] += 0 if t.get('parse_ok') else 1
    # 只加标记不改文字：去掉新加的 [K#] 与附录后应与原文一致
    import re
    body_new = ap['output'].split('\n\n#### 背景知识出处')[0]
    same = re.sub(r' \[K\d+\](\[K\d+\])*', '', body_new).rstrip() == r['answer'].rstrip()
    stat['text_unchanged'] += 1 if same else 0
    io.open(os.path.join(OUT, '%s_%d.md' % (r['id'], r['rep'])), 'w', encoding='utf-8').write(ap['output'])
    rows.append((r['id'], len(pr.get('bg_sentences') or []), t.get('marked'), t.get('books')))
print(dict(stat))
for x in rows: print(x)
