# -*- coding: utf-8 -*-
"""本地单测：真实回答 + 试验台模型真实输出，按节点代码跑 Prepare / Apply；另测模型失败、find 在附录里、find 不唯一三种情况。"""
import json, io, os, sys, subprocess, shutil, tempfile, glob
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'accept'))
from no_absence import RSYS, PREP_JS, APPLY_JS
import score as S
def node(code, NODES, INPUT):
    h = ('const NODES=' + json.dumps(NODES, ensure_ascii=False) + ';const INPUT=' + json.dumps(INPUT, ensure_ascii=False) + ';\n'
         'const $=n=>({first:()=>({json:NODES[n]||{}})});const $input={first:()=>({json:INPUT})};\n(async function(){\n' + code + '\n})().then(r=>console.log(JSON.stringify(r[0].json)));')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(h); p = f.name
    r = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
    return json.loads(r.stdout) if r.stdout.strip() else {'ERR': r.stderr[-400:]}
for k in ('R13_1', 'R09_1', 'R01_1'):
    ans = json.load(io.open(os.path.join(HERE, '..', 'accept', 'runs', k + '.json'), encoding='utf-8'))['answer']
    prep = node(PREP_JS, {'Capture context': {'originalUserMessage': S.Q[k[:3]]['question']}}, {'output': ans, 'originalUserMessage': S.Q[k[:3]]['question']})
    llm = S.bench([{'system': RSYS, 'user': prep['no_absence_user']}])[0]
    out = node(APPLY_JS, {'Prepare No-Absence Rewrite': prep}, {'output': llm})
    i = ans.find('\n#### '); j = out['output'].find('\n#### ')
    print(k, 'needed', prep['no_absence_needed'], '| trace', out['no_absence_rewrite'], '| 字数', len(ans), '->', len(out['output']), '| 附录不变', ans[i:] == out['output'][j:] if i > 0 else 'no appendix')
# 失败 / 附录 / 不唯一
ans = '正文第一句未检索到报警值。正文第二句。\n#### 数据依据\n- 摘录：未检索到报警值。'
prep = node(PREP_JS, {}, {'output': ans, 'originalUserMessage': 'q'})
for raw in ('not json', json.dumps({'edits': [{'find': '摘录：未检索到报警值', 'replace': ''}]}, ensure_ascii=False),
            json.dumps({'edits': [{'find': '，本轮未检索到报警值。', 'replace': '。'}]}, ensure_ascii=False), json.dumps({'edits': [{'find': '正文', 'replace': 'X'}]}, ensure_ascii=False)):
    out = node(APPLY_JS, {'Prepare No-Absence Rewrite': prep}, {'output': raw})
    print(repr(raw[:30]), out['no_absence_rewrite'], repr(out['output']))
