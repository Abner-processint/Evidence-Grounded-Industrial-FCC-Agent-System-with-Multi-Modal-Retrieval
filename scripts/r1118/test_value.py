# -*- coding: utf-8 -*-
"""本地单测：基线真实回答 + 该次执行的证据包与显示编号表，按节点代码跑 Prepare / Search / Apply，模型调用走试验台（同一 DeepSeek，温度 0）。"""
import json, io, os, sys, subprocess, shutil, tempfile, re
HERE = os.path.dirname(os.path.abspath(__file__)); ACC = os.path.join(HERE, '..', 'accept'); sys.path.insert(0, HERE); sys.path.insert(0, ACC)
from value_listing import XSYS, JSYS, PREP_JS, SEARCH_JS, APPLY_JS
import score as S
def node(code, NODES, INPUT):
    h = ('const NODES=' + json.dumps(NODES, ensure_ascii=False) + ';const INPUT=' + json.dumps(INPUT, ensure_ascii=False) + ';\n'
         'const $=n=>({first:()=>({json:NODES[n]||{}}),last:()=>({json:NODES[n]||{}})});const $input={first:()=>({json:INPUT})};\n(async function(){\n' + code + '\n})().then(r=>console.log(JSON.stringify(r[0].json)));')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(h); p = f.name
    r = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
    return json.loads(r.stdout) if r.stdout.strip() else {'ERR': r.stderr[-500:]}
for k in sys.argv[1:]:
    ans = json.load(io.open(os.path.join(ACC, 'runs', k + '.json'), encoding='utf-8'))['answer']
    X = json.load(io.open(os.path.join(ACC, 'exec', k + '.json'), encoding='utf-8'))
    prep = node(PREP_JS, {}, {'output': ans})
    ext = S.bench([{'system': XSYS, 'user': prep['value_extract_user']}])[0]
    NODES = {'Prepare Value Check': prep, 'Compact Result Projector': {'evidence_packet': X['crp_packet']}, 'Code in JavaScript': {'evidence_display_id_map': X['display_map']}}
    sr = node(SEARCH_JS, NODES, {'output': ext})
    jd = S.bench([{'system': JSYS, 'user': sr['value_judge_user']}])[0] if sr.get('value_judge_needed') else ''
    out = node(APPLY_JS, {'Search Value Snippets': sr}, {'output': jd})
    print('=====', k, '| 候选', len(sr.get('value_candidates') or []), '| 判定需要', sr.get('value_judge_needed'), '|', out.get('value_conflict_listing'))
    for mm in re.finditer(r'.{0,50}（另有来源[^）]*）', out['output']): print('   ', mm.group(0).replace('\n', ' '))
    i = ans.find('\n#### '); j = out['output'].find('\n#### ')
    print('    附录不变', ans[i:] == out['output'][j:] if i > 0 else '无附录', '| 字数', len(ans), '->', len(out['output']))
