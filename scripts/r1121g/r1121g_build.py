# -*- coding: utf-8 -*-
"""r1121g：REGULATION_LIMITS_TABLE_V1——规程 / 工艺卡片控制指标结构化表接入。
① 新增一路（Capture context 的第三个下游，画布位置在主流程之上，v1 顺序下先于主流程跑完）：
   Prepare Regulation Pick → Regulation Pick LLM（DeepSeek-RegulationPick，温度 0）→ Apply Regulation Pick（无出口）。
② Evidence Packet Builder：读 Apply Regulation Pick 的 reg_entries 加入候选（与装置模型条目同样先注入）；主体过滤视为切题；在席位之外追加至多 8 席。
用法：python r1121g_build.py <in.json> <out.json>"""
import sys, io, json, os, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from reg_table import node_codes, PICK_SYS
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); C = json.loads(json.dumps(av['connections'])); N = {n['name']: n for n in nodes}
assert 'Prepare Regulation Pick' not in N
MARK = 'REGULATION_LIMITS_TABLE_V1'


def rep(code, old, new, cnt=1):
    assert code.count(old) == cnt, (old[:90], code.count(old))
    return code.replace(old, new)


prep, apply, data, catalog = node_codes()
uid = lambda s: str(uuid.uuid5(uuid.NAMESPACE_URL, 'r1121g/' + s))
dx, dy = N['Device Context Retriever']['position']
cred = N['DeepSeek-BackgroundSource']['credentials']
nodes += [
    {'id': uid('prep'), 'name': 'Prepare Regulation Pick', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [dx, dy - 420], 'parameters': {'jsCode': prep}},
    {'id': uid('llm'), 'name': 'Regulation Pick LLM', 'type': '@n8n/n8n-nodes-langchain.agent', 'typeVersion': 3.1, 'position': [dx + 260, dy - 420],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 5000, 'onError': 'continueRegularOutput',
     'parameters': {'promptType': 'define', 'text': '={{ $json.reg_pick_user }}', 'options': {'systemMessage': PICK_SYS}}},
    {'id': uid('model'), 'name': 'DeepSeek-RegulationPick', 'type': '@n8n/n8n-nodes-langchain.lmChatDeepSeek', 'typeVersion': 1, 'position': [dx + 260, dy - 220],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 15000, 'credentials': cred, 'parameters': {'options': {'temperature': 0}}},
    {'id': uid('apply'), 'name': 'Apply Regulation Pick', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [dx + 560, dy - 420], 'parameters': {'jsCode': apply}},
]
lst = C['Capture context']['main'][0]
assert [e['node'] for e in lst] == ['Free Insight Gate', 'Device Context Retriever'], lst
lst.append({'node': 'Prepare Regulation Pick', 'type': 'main', 'index': 0})
C['Prepare Regulation Pick'] = {'main': [[{'node': 'Regulation Pick LLM', 'type': 'main', 'index': 0}]]}
C['Regulation Pick LLM'] = {'main': [[{'node': 'Apply Regulation Pick', 'type': 'main', 'index': 0}]]}
C['DeepSeek-RegulationPick'] = {'ai_languageModel': [[{'node': 'Regulation Pick LLM', 'type': 'ai_languageModel', 'index': 0}]]}

p = N['Evidence Packet Builder']['parameters']; c = p['jsCode']; assert MARK not in c
c = rep(c, "  for (const e of entries.slice(0, 12)) addEntry(e);\n})();\n",
        """  for (const e of entries.slice(0, 12)) addEntry(e);
})();

// REGULATION_LIMITS_TABLE_V1：规程 / 工艺卡片控制指标结构化表里、本题挑出的参数（Apply Regulation Pick），与装置模型条目一样先注入；
// 主体过滤视为切题，席位之外追加至多 8 条（见下方席位一节）。没跑或挑不出时不注入。
(function injectRegulationLimitsV1() {
  let ents = [];
  try { ents = asArray(($('Apply Regulation Pick').first().json || {}).reg_entries); } catch (e) { ents = []; }
  for (const e of ents.slice(0, 16)) addEntry(e);
})();
""")
c = rep(c, "    const hit = entry.source_kind === 'historian' || entry.source_kind === 'plant_model_static' || termList.some(",
        "    const hit = entry.source_kind === 'historian' || entry.source_kind === 'plant_model_static' || entry.source_kind === 'regulation_limits' || termList.some(")
c = rep(c, "  // EVIDENCE_RECALL_V1：模型按索引点回的条目在 MAX_PACKET_ITEMS 之外追加至多 8 席，原有席位不动（做法同上面的追加席）。\n",
        """  // REGULATION_LIMITS_TABLE_V1：本题挑出的规程 / 工艺卡片指标条目，包里已有的计入，不够的在席位之外追加，合计至多 8 条，原有席位不动。
  {
    let __rl = picked.filter(x => x.e.source_kind === 'regulation_limits').length;
    for (const x of scored) {
      if (__rl >= 8) break;
      if (takenIdx.has(x.i) || x.e.source_kind !== 'regulation_limits') continue;
      picked.push(x); takenIdx.add(x.i); __rl++;
    }
  }

  // EVIDENCE_RECALL_V1：模型按索引点回的条目在 MAX_PACKET_ITEMS 之外追加至多 8 席，原有席位不动（做法同上面的追加席）。
""")
p['jsCode'] = c
out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes; tgt['connections'] = C
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = C
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst, len(nodes))
