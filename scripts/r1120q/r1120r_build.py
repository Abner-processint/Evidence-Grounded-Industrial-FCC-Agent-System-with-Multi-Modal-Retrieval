# -*- coding: utf-8 -*-
"""r1120r：ROUTED_DOC_EXTRA_SEATS_V1（快修 1、2 的配套）。
来由：r1120q 实跑 QS × 2，按期次限定的最新月报片段在检索结果里入选（QS001 有 18 段），但组证据包时一条不剩（24 席按分数排，月报片段排不上），
回答因此仍多引 2023 年月报（40 份只有 14 份提到 2026 年 6 月）；按文档限定查回的操作规程条目同理。
Evidence Packet Builder：① 收集候选时，本题对应月份的月报条目（没写时段则任一月报，组包时再取最新一期）与文件名带「规程」的条目不受每单元 72 条的收集上限；
② 在 24 席之外给「本题对应月份的月报」「操作规程」各追加至多 3 席（包里已有的计入），原有席位不动——做法同已有的补缺口追加席、点回追加席。
用法：python r1120r_build.py <in.json> <out.json>"""
import sys, io, json, os
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from quickfix import ROUTE_JS
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
MARK = 'ROUTED_DOC_EXTRA_SEATS_V1'


def rep(code, old, new, cnt=1):
    assert code.count(old) == cnt, (old[:90], code.count(old))
    return code.replace(old, new)


# 与检索节点同一份年月解析
pm_fn = ROUTE_JS[ROUTE_JS.index('function __periodMonths(q) {'):ROUTE_JS.index('async function __routedVariants')]
p = N['Evidence Packet Builder']['parameters']; c = p['jsCode']; assert MARK not in c
helper = ("// ROUTED_DOC_EXTRA_SEATS_V1：按期次限定的月报、按文档限定的操作规程（检索节点 PERIOD_REPORT_ROUTING_V1 / REGULATION_DOC_VARIANT_V1 查回的）组包时保留席位\n"
          + pm_fn +
          "const __routedQ = (function () { try { return String(toInternalPacketContract($input.first().json || {}).originalUserMessage || ''); } catch (e) { return ''; } })();\n"
          "const __routedPM = __periodMonths(__routedQ);\n"
          "const __ymOf = n => { const m = String(n || '').match(/(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月/); return m ? +m[1] * 100 + +m[2] : 0; };\n"
          "const __isMonthlyDoc = n => /月报|月（年）报/.test(String(n || '')) && __ymOf(n) > 0;\n"
          "const __isRegDoc = n => /规程/.test(String(n || ''));\n"
          "const __routedCandidate = o => { const n = (o && o.document_name) || ''; if (__isRegDoc(n)) return true; if (!__isMonthlyDoc(n)) return false;\n"
          "  return __routedPM.months.length ? __routedPM.months.includes(__ymOf(n)) : !__routedPM.yearOnly; };\n")
c = rep(c, "const MAX_PACKET_ITEMS = 24;\n", "const MAX_PACKET_ITEMS = 24;\n" + helper)
c = rep(c, "  if (!__recallNeed && (__collectedPerUnit.get(__uk) || 0) >= MAX_PACKET_ITEMS * 3) return; // EVIDENCE_RECALL_V1：点回的条目不受单元收集上限\n",
        "  if (!__recallNeed && !__routedCandidate(obj) && (__collectedPerUnit.get(__uk) || 0) >= MAX_PACKET_ITEMS * 3) return; // EVIDENCE_RECALL_V1：点回的条目不受单元收集上限；ROUTED_DOC_EXTRA_SEATS_V1：本题月份月报与操作规程条目同样不受\n")
c = rep(c, "  // EVIDENCE_RECALL_V1：模型按索引点回的条目在 MAX_PACKET_ITEMS 之外追加至多 8 席，原有席位不动（做法同上面的追加席）。\n",
        """  // ROUTED_DOC_EXTRA_SEATS_V1：本题对应月份的月报（没写时段取候选里最新一期）、操作规程各保至多 3 席，包里已有的计入，不够的在席位之外追加，原有席位不动。
  {
    let __targets = __routedPM.months.slice();
    if (!__targets.length && !__routedPM.yearOnly) {
      const __yms = scored.map(x => (__isMonthlyDoc(x.e.document_name) ? __ymOf(x.e.document_name) : 0)).filter(Boolean);
      if (__yms.length) __targets = [Math.max(...__yms)];
    }
    const __isTargetMonthly = e => __isMonthlyDoc(e.document_name) && __targets.includes(__ymOf(e.document_name));
    for (const __want of [__isTargetMonthly, e => __isRegDoc(e.document_name)]) {
      let __have = picked.filter(x => __want(x.e)).length;
      for (const x of scored) {
        if (__have >= 3) break;
        if (takenIdx.has(x.i) || x.e.off_subject || !__want(x.e)) continue;
        picked.push(x); takenIdx.add(x.i); __have++;
      }
    }
  }

  // EVIDENCE_RECALL_V1：模型按索引点回的条目在 MAX_PACKET_ITEMS 之外追加至多 8 席，原有席位不动（做法同上面的追加席）。
""")
p['jsCode'] = c
out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out:
    out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
