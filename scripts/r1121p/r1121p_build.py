# -*- coding: utf-8 -*-
"""r1121p：EXPECTED_POINT_RETRIEVAL_V1。Capture context 新增一路（画布在主流程之上）：Prepare Expected Points → Expected Points LLM → Expected Point Retrieval（无出口）；
Evidence Packet Builder 注入 ep_entries、视为切题、席位外追加至多 8 条（每个要点先保一条，再按相似度）。RAGFlow 地址与密钥从 Grouped RAGFlow Retrieval 原样搬，不打印。
用法：python r1121p_build.py <in.json> <out.json>"""
import sys, io, json, os, re, uuid
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'r1120q'))
from ep_points import PTS_SYS, PREP_JS, RETR_TMPL
from quickfix import ROUTE_JS
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); C = json.loads(json.dumps(av['connections'])); N = {n['name']: n for n in nodes}
assert 'Prepare Expected Points' not in N and 'Prepare Regulation Pick' in N
MARK = 'EXPECTED_POINT_RETRIEVAL_V1'


def rep(code, old, new, cnt=1):
    assert code.count(old) == cnt, (old[:90], code.count(old))
    return code.replace(old, new)


g = N['Grouped RAGFlow Retrieval']['parameters']['jsCode']
cfg = (re.search(r"function readConfig\(name, fallback = ''\) \{[\s\S]*?\n\}\n", g).group(0) + re.search(r"const defaultBaseUrl =[\s\S]*?;\n", g).group(0)
       + re.search(r"const defaultApiKey =[\s\S]*?;\n", g).group(0))
pm_fn = ROUTE_JS[ROUTE_JS.index('function __periodMonths(q) {'):ROUTE_JS.index('async function __routedVariants')]
retr = RETR_TMPL.replace('__CFG__', cfg).replace('__PM__', pm_fn)
uid = lambda s: str(uuid.uuid5(uuid.NAMESPACE_URL, 'r1121p/' + s))
rx, ry = N['Prepare Regulation Pick']['position']
cred = N['DeepSeek-RegulationPick']['credentials']
nodes += [
    {'id': uid('prep'), 'name': 'Prepare Expected Points', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [rx, ry - 420], 'parameters': {'jsCode': PREP_JS}},
    {'id': uid('llm'), 'name': 'Expected Points LLM', 'type': '@n8n/n8n-nodes-langchain.agent', 'typeVersion': 3.1, 'position': [rx + 260, ry - 420],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 5000, 'onError': 'continueRegularOutput',
     'parameters': {'promptType': 'define', 'text': '={{ $json.ep_user }}', 'options': {'systemMessage': PTS_SYS}}},
    {'id': uid('model'), 'name': 'DeepSeek-ExpectedPoints', 'type': '@n8n/n8n-nodes-langchain.lmChatDeepSeek', 'typeVersion': 1, 'position': [rx + 260, ry - 220],
     'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 15000, 'credentials': cred, 'parameters': {'options': {'temperature': 0}}},
    {'id': uid('retr'), 'name': 'Expected Point Retrieval', 'type': 'n8n-nodes-base.code', 'typeVersion': 2, 'position': [rx + 560, ry - 420], 'parameters': {'jsCode': retr}},
]
C['Capture context']['main'][0].append({'node': 'Prepare Expected Points', 'type': 'main', 'index': 0})
C['Prepare Expected Points'] = {'main': [[{'node': 'Expected Points LLM', 'type': 'main', 'index': 0}]]}
C['Expected Points LLM'] = {'main': [[{'node': 'Expected Point Retrieval', 'type': 'main', 'index': 0}]]}
C['DeepSeek-ExpectedPoints'] = {'ai_languageModel': [[{'node': 'Expected Points LLM', 'type': 'ai_languageModel', 'index': 0}]]}

p = N['Evidence Packet Builder']['parameters']; c = p['jsCode']; assert MARK not in c
c = rep(c, "  for (const e of ents.slice(0, 16)) addEntry(e);\n})();\n",
        """  for (const e of ents.slice(0, 16)) addEntry(e);
})();

// EXPECTED_POINT_RETRIEVAL_V1：按本题要点限定资料定向检索取回的原文（Expected Point Retrieval），先注入；主体过滤视为切题，席位外追加至多 8 条。
(function injectExpectedPointsV1() {
  let ents = [];
  try { ents = asArray(($('Expected Point Retrieval').first().json || {}).ep_entries); } catch (e) { ents = []; }
  for (const e of ents.slice(0, 24)) addEntry(e);
})();
""")
c = rep(c, "entry.source_kind === 'regulation_limits' || termList.some(",
        "entry.source_kind === 'regulation_limits' || entry.source_kind === 'expected_point' || termList.some(")
c = rep(c, "  // EVIDENCE_RECALL_V1：模型按索引点回的条目在 MAX_PACKET_ITEMS 之外追加至多 8 席，原有席位不动（做法同上面的追加席）。\n",
        """  // EXPECTED_POINT_RETRIEVAL_V1：要点定向检索的条目，包里已有的计入；不够 8 条时席位外追加——先给还没有条目的要点（按要点文字区分）各补一条，再按证据包分数补满。
  {
    const __isEp = e => e.source_kind === 'expected_point';
    let __n = picked.filter(x => __isEp(x.e)).length;
    const __covered = new Set(picked.filter(x => __isEp(x.e)).map(x => String(x.e.section_title || '')));
    const __cand = scored.filter(x => !takenIdx.has(x.i) && __isEp(x.e));
    for (const x of __cand) {
      if (__n >= 8) break;
      if (__covered.has(String(x.e.section_title || ''))) continue;
      picked.push(x); takenIdx.add(x.i); __covered.add(String(x.e.section_title || '')); __n++;
    }
    for (const x of __cand) {
      if (__n >= 8) break;
      if (takenIdx.has(x.i)) continue;
      picked.push(x); takenIdx.add(x.i); __n++;
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
