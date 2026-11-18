# -*- coding: utf-8 -*-
r"""把副本已验证的 r1110（公司 11-10 确认 + 用户同日要求，r1110a→b→c）发布到主线。
默认只核对；APPLY=1 才备份并写入。写入前确认：① 主线草稿 = 已发布 = c7b73e28；② 副本已发布版仍是 2c2001c6；
③ 以主线现版为底依次跑 r1110a/b/c 构建，改动正好是 7 个节点、无增删、连线不变；④ 这 7 个节点与副本已发布版逐字相同；⑤ 代码节点语法通过。"""
import sys, os, io, json, time, subprocess, tempfile, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); TOOLS = os.path.join(HERE, '..', 'tools')
sys.path.insert(0, TOOLS)
import n8nkey  # noqa
import requests
BASE = "https://<HOST>:5678/n8n"; WF = "WdjEhxyWuv5DPwcs"; CP = "EIBVIi74m90EYSsB"
BK = r"<USER_HOME>\Desktop\processint\n8n_project"
s = requests.Session(); s.trust_env = False; s.verify = os.path.join(TOOLS, "n8n_server.pem"); s.headers["X-N8N-API-KEY"] = os.environ["N8N_API_KEY"]
ck = lambda x: json.dumps(x, sort_keys=True)
key = lambda nodes: ck(sorted(nodes, key=lambda n: n['name']))
strip = lambda n: {k: v for k, v in n.items() if k != 'position'}
wf = s.get(f"{BASE}/api/v1/workflows/{WF}", timeout=180).json(); av = wf['activeVersion']
assert wf['activeVersionId'].startswith('c7b73e28'), wf['activeVersionId']
assert key(wf['nodes']) == key(av['nodes']) and ck(wf['connections']) == ck(av['connections']), "主线有未发布草稿，停止"
cp = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json(); cav = cp.get('activeVersion') or {}
assert str(cp.get('activeVersionId', '')).startswith('2c2001c6'), cp.get('activeVersionId')
td = tempfile.mkdtemp(prefix='r1110_')
p0 = os.path.join(td, 'main.json'); pa = os.path.join(td, 'a.json'); pb = os.path.join(td, 'b.json'); pc = os.path.join(td, 'c.json')
json.dump(wf, io.open(p0, 'w', encoding='utf-8'), ensure_ascii=False)
for script, i, o in (('r1110a_build.py', p0, pa), ('r1110b_build.py', pa, pb), ('r1110c_build.py', pb, pc)):
    r = subprocess.run([sys.executable, os.path.join(HERE, script), i, o], capture_output=True, text=True, encoding='utf-8')
    assert r.returncode == 0, (script, r.stderr[-800:])
new = json.load(io.open(pc, encoding='utf-8')); shutil.rmtree(td)
EXP = sorted(new['changed'])
assert EXP == sorted(['Answer Composer LLM', 'Answer Finalizer LLM', 'Append Factor Resolution Result', 'Derived Quantity LLM',
                      'Evidence Packet Builder', 'Plant Knowledge Base', 'Prepare Factor Resolution']), EXP
M = {n['name']: n for n in av['nodes']}; Nn = {n['name']: n for n in new['nodes']}; C = {n['name']: n for n in cav['nodes']}
changed = sorted(n for n in M if ck(strip(M[n])) != ck(strip(Nn[n])))
print('改动', changed); assert changed == EXP and set(M) == set(Nn), "改动范围与预期不符"
assert ck(new['connections']) == ck(av['connections']), "连线有变化"
diff_cp = [n for n in EXP if ck(Nn[n]['parameters']) != ck(C[n]['parameters'])]
print('与副本不同的节点', diff_cp); assert not diff_cp, "与副本已验证版不一致"
NODE = shutil.which('node')
for n in new['nodes']:
    if n['name'] in EXP and n['parameters'].get('jsCode'):
        with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write('(async function(){\n' + n['parameters']['jsCode'] + '\n});'); p = f.name
        rr = subprocess.run([NODE, '--check', p], capture_output=True, text=True); os.unlink(p)
        print('  %-34s 语法 %s' % (n['name'], 'OK' if rr.returncode == 0 else rr.stderr[:300])); assert rr.returncode == 0
blob = json.dumps(new['nodes'], ensure_ascii=False)
for mk in ('PLANT_KB_1110', 'SECTION_BASIS_ALTERNATIVES_V1', 'HOLDUP_FROM_LEVEL_V1', 'FORMULA_SOURCE_NOTE_V1', 'USER_INSTRUCTION_PRIORITY_V1',
           'MISSING_VS_NOT_APPLICABLE_V1', 'POINT_LEVEL_EXCEEDANCE_V1', 'MONTH_RANGE_PERIOD_V1',
           'POINT_SERIES_STATS_V1', 'MISSING_ITEM_SYMBOL_V1', 'MISSING_CLAIM_CHECK_V1', 'PLANNER_DEFAULT_MODEL_V1', 'FINALIZER_OUTPUT_BUDGET_V1'):
    assert mk in blob, mk
print('节点数', len(av['nodes']), '->', len(new['nodes']))
if os.environ.get("APPLY") != "1": print("（仅核对，未写入）"); raise SystemExit
stamp = time.strftime('%Y%m%d-%H%M%S')
io.open(os.path.join(BK, f"workflow_{WF}_backup_before_r1110_{stamp}.json"), 'w', encoding='utf-8').write(json.dumps({k: wf[k] for k in ('id', 'name', 'versionId', 'activeVersionId', 'updatedAt', 'nodes', 'connections', 'settings') if k in wf}, ensure_ascii=False, indent=2))
print("已备份", stamp)
ALLOWED = {"saveExecutionProgress", "saveManualExecutions", "saveDataErrorExecution", "saveDataSuccessExecution", "executionTimeout", "errorWorkflow", "timezone", "executionOrder"}
r = s.put(f"{BASE}/api/v1/workflows/{WF}", json={"name": wf["name"], "nodes": new["nodes"], "connections": new["connections"], "settings": {k: v for k, v in (wf.get("settings") or {}).items() if k in ALLOWED}}, timeout=300)
print("PUT:", r.status_code, r.text[:200] if r.status_code >= 300 else '')
b = s.get(f"{BASE}/api/v1/workflows/{WF}", timeout=180).json(); bav = b.get('activeVersion') or {}
if key(bav.get('nodes') or []) != key(new['nodes']):
    a = s.post(f"{BASE}/api/v1/workflows/{WF}/activate", timeout=120); print("补发布:", a.status_code)
    b = s.get(f"{BASE}/api/v1/workflows/{WF}", timeout=180).json(); bav = b.get('activeVersion') or {}
print("回读: 已发布版", b.get('activeVersionId'), "| 已发布 = 写入定义", key(bav.get('nodes') or []) == key(new['nodes']),
      "| 连线一致", ck(bav.get('connections')) == ck(new['connections']), "| 草稿 = 已发布", key(b['nodes']) == key(bav.get('nodes') or []), "| 启用", b.get('active'), "| 节点", len(bav.get('nodes') or []))
json.dump(b, io.open(os.path.join(BK, f"workflow_{WF}_after_r1110_{stamp}.json"), 'w', encoding='utf-8'), ensure_ascii=False)
