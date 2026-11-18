# -*- coding: utf-8 -*-
r"""把副本已验证的 r1115（删 9 月两处文档对照机制，DOC_TAG_MATCH_REMOVED_V1）发布到主线。
默认只核对；APPLY=1 才备份并写入。写入前确认：① 主线草稿 = 已发布 = b0fa9d5f；② 副本已发布版仍是 2f253f4c；
③ 以主线现版为底跑 r1115_build.py，改动正好是 Dependency Gate、Grouped RAGFlow Retrieval、无增删、连线不变；④ 该节点与副本已发布版逐字相同；
⑤ 语法通过；⑥ 以往标记都在、卡片标记（EARLIER_TURN_CARDS）不在。"""
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
assert wf['activeVersionId'].startswith('b0fa9d5f'), wf['activeVersionId']
assert key(wf['nodes']) == key(av['nodes']) and ck(wf['connections']) == ck(av['connections']), "主线有未发布草稿，停止"
cp = s.get(f"{BASE}/api/v1/workflows/{CP}", timeout=180).json(); cav = cp.get('activeVersion') or {}
assert str(cp.get('activeVersionId', '')).startswith('2f253f4c'), cp.get('activeVersionId')
td = tempfile.mkdtemp(prefix='r1115_')
p0 = os.path.join(td, 'main.json'); pc = os.path.join(td, 'm.json')
json.dump(wf, io.open(p0, 'w', encoding='utf-8'), ensure_ascii=False)
r = subprocess.run([sys.executable, os.path.join(HERE, '..', 'r1115', 'r1115_build.py'), p0, pc, 'b0fa9d5f'], capture_output=True, text=True, encoding='utf-8')
assert r.returncode == 0, ('r1115_build.py', r.stderr[-800:])
new = json.load(io.open(pc, encoding='utf-8'))['activeVersion']; shutil.rmtree(td)
EXP = ['Dependency Gate', 'Grouped RAGFlow Retrieval']
M = {n['name']: n for n in av['nodes']}; Nn = {n['name']: n for n in new['nodes']}; C = {n['name']: n for n in cav['nodes']}
changed = sorted(n for n in M if ck(strip(M[n])) != ck(strip(Nn[n])))
print('改动', changed); assert changed == EXP and set(M) == set(Nn), "改动范围与预期不符"
assert ck(new['connections']) == ck(av['connections']), "连线有变化"
diff_cp = [n for n in EXP if ck(Nn[n]['parameters']) != ck(C[n]['parameters'])]
print('与副本不同的节点', diff_cp); assert not diff_cp, "与副本已验证版不一致"
NODE = shutil.which('node')
for _nn in EXP:
    c = Nn[_nn]['parameters']['jsCode']; assert c.count('DOC_TAG_MATCH_REMOVED_V1') == 1, _nn
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as f: f.write('(async function(){\n' + c + '\n});'); p = f.name
    rr = subprocess.run([NODE, '--check', p], capture_output=True, text=True); os.unlink(p)
    print('  ' + _nn + ' 语法', 'OK' if rr.returncode == 0 else rr.stderr[:300]); assert rr.returncode == 0
blob = json.dumps(new['nodes'], ensure_ascii=False)
for mk in ('DOC_TAG_MATCH_REMOVED_V1', 'SI_LENGTH_FACTS_V1', 'TAG_DOCUMENT_RETRIEVAL_V7', 'INPUT_INSTRUMENT_FACTS_V2', 'INPUT_INSTRUMENT_FACTS_V1', 'EARLIER_TURNS_FOR_EDIT_V1', 'EDIT_SOURCE_SCOPE_V1', 'ABDICATION_SCOPE_V1', 'RECENT_TURNS_CONTEXT_V1', 'PERIOD_CARRY_FORWARD_V1',
           'CROSS_TURN_CONSISTENCY_V1', 'FOLLOWUP_RESOLVED_PERIOD_V1', 'PLANT_KB_1110', 'POINT_SERIES_STATS_V1', 'MISSING_CLAIM_CHECK_V1', 'PLANNER_DEFAULT_MODEL_V1',
           'FINALIZER_OUTPUT_BUDGET_V1', 'PLANT_GAP_LOOKUP_V1', 'PLANT_KNOWLEDGE_BASE_V1'):
    assert mk in blob, mk
assert 'EARLIER_TURN_CARDS' not in blob, '卡片不应上主线'
print('节点数', len(av['nodes']), '->', len(new['nodes']))
if os.environ.get("APPLY") != "1": print("（仅核对，未写入）"); raise SystemExit
stamp = time.strftime('%Y%m%d-%H%M%S')
io.open(os.path.join(BK, f"workflow_{WF}_backup_before_r1115_{stamp}.json"), 'w', encoding='utf-8').write(json.dumps({k: wf[k] for k in ('id', 'name', 'versionId', 'activeVersionId', 'updatedAt', 'nodes', 'connections', 'settings') if k in wf}, ensure_ascii=False, indent=2))
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
json.dump(b, io.open(os.path.join(BK, f"workflow_{WF}_after_r1115_{stamp}.json"), 'w', encoding='utf-8'), ensure_ascii=False)
