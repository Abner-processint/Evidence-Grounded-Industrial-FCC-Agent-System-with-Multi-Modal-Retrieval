# -*- coding: utf-8 -*-
import json, os, sys, subprocess, shutil, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from no_absence import PREP_JS, APPLY_JS
def node(code, NODES, INPUT):
    h = ('const NODES=' + json.dumps(NODES, ensure_ascii=False) + ';const INPUT=' + json.dumps(INPUT, ensure_ascii=False) + ';\n'
         'const $=n=>({first:()=>({json:NODES[n]||{}})});const $input={first:()=>({json:INPUT})};\n(async function(){\n' + code + '\n})().then(r=>console.log(JSON.stringify(r[0].json)));')
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write(h); p = f.name
    r = subprocess.run([shutil.which('node'), p], capture_output=True, text=True, encoding='utf-8'); os.unlink(p)
    return json.loads(r.stdout)
ans = '正文第一句：两器压差位号为 PDRA3125，三月均值 20.2454 kPa，本轮未检索到报警值。正文第二句：建议结合工艺卡片核对。\n#### 数据依据\n- 摘录：未检索到报警值。'
prep = node(PREP_JS, {}, {'output': ans, 'originalUserMessage': 'q'})
cases = {'模型输出非 JSON': 'not json',
         'find 在附录里': json.dumps({'edits': [{'find': '摘录：未检索到报警值', 'replace': ''}]}, ensure_ascii=False),
         '正常删分句': json.dumps({'edits': [{'find': '，本轮未检索到报警值。', 'replace': '。'}]}, ensure_ascii=False),
         'find 在正文不唯一': json.dumps({'edits': [{'find': '正文', 'replace': 'X'}]}, ensure_ascii=False)}
for name, raw in cases.items():
    out = node(APPLY_JS, {'Prepare No-Absence Rewrite': prep}, {'output': raw})
    print(name, '|', out['no_absence_rewrite'], '|', out['output'].replace('\n', '⏎'))
