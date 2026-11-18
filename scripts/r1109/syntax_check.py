# -*- coding: utf-8 -*-
"""python syntax_check.py <nodes.json>：对 changed 里的代码节点做 node --check。"""
import json, subprocess, tempfile, os, shutil, sys, io
d = json.load(io.open(sys.argv[1], encoding='utf-8'))
NODE = shutil.which('node')
bad = 0
for n in d['nodes']:
    if n['name'] in d['changed'] and n['parameters'].get('jsCode'):
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f:
            f.write('(async function(){\n' + n['parameters']['jsCode'] + '\n});'); p = f.name
        r = subprocess.run([NODE, '--check', p], capture_output=True, text=True); os.unlink(p)
        print(n['name'], 'OK' if r.returncode == 0 else r.stderr[:600]); bad += r.returncode != 0
sys.exit(1 if bad else 0)
