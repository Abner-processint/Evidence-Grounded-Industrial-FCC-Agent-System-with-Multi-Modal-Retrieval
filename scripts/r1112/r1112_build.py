# -*- coding: utf-8 -*-
"""r1112：历史卡片 EARLIER_TURN_CARDS_V3。改 3 个节点：
- Capture context：读会话状态时保留 turn_cards；
- Save Conversation State：每轮结束由代码记一张卡（turn_card_v3.js），追加进 turn_cards（最多 8 张）；
- Coverage Check LLM：用户消息在「Plant synonym list」前插入前几轮卡片（没有卡片时不插，首轮提示词不变），系统消息末尾加 EARLIER_TURN_CARDS_V4 规则（ctx_audit/rule_v4.py；卡片格式仍记作 V3）。
用法：python r1112_build.py <in.json> <out.json> [底版前缀]；in 可以是 GET 回来的工作流（用 activeVersion）。"""
import sys, os, io, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'ctx_audit'))
from rule_v5 import RULE  # 11-11：v3 少查 DR3110 仪表（8/8 → 5/8）→ v4 补「卡片不顶替装置模型查询」→ v5 补「卡片列了位号也照查」（副本提示词 0/8 → 2/8、2/8 → 7/8）
src, dst = sys.argv[1], sys.argv[2]; pfx = sys.argv[3] if len(sys.argv) > 3 else None
wf = json.load(io.open(src, encoding='utf-8'))
if pfx: assert str(wf.get('activeVersionId', '')).startswith(pfx), wf.get('activeVersionId')
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
MARK = 'EARLIER_TURN_CARDS_V3'


def rep1(s, old, new, where):
    assert s.count(old) == 1, (where, s.count(old), old[:80])
    return s.replace(old, new)


# 1) Capture context
p = N['Capture context']['parameters']; c = p['jsCode']; assert MARK not in c
c = rep1(c, "    turn_counter: Number(obj.turn_counter) || 0, // TURN_COUNTER_V7\n",
         "    turn_counter: Number(obj.turn_counter) || 0, // TURN_COUNTER_V7\n"
         "    turn_cards: asArray(obj.turn_cards).filter(x => x && typeof x === 'object' && !Array.isArray(x)).slice(-8), // EARLIER_TURN_CARDS_V3：每轮由代码记的卡片，供定义因子沿用前轮位号\n",
         'capture normalize')
p['jsCode'] = c

# 2) Save Conversation State
p = N['Save Conversation State']['parameters']; c = p['jsCode']; assert MARK not in c
fn = io.open(os.path.join(HERE, 'turn_card_v3.js'), encoding='utf-8').read().rstrip('\n') + '\n\n'
c = rep1(c, "const finalOutput = String($json.output || '').trim();\n", fn + "const finalOutput = String($json.output || '').trim();\n", 'save fn')
c = rep1(c, "    turn_counter: Number(state.turn_counter) || 0, // TURN_COUNTER_V7\n",
         "    turn_counter: Number(state.turn_counter) || 0, // TURN_COUNTER_V7\n"
         "    turn_cards: asArray(state.turn_cards), // EARLIER_TURN_CARDS_V3\n", 'save previous')
c = rep1(c, "      turn_counter: Number(String(turn.turn_ref).replace(/^T/i, '')) || 0,\n",
         "      turn_counter: Number(String(turn.turn_ref).replace(/^T/i, '')) || 0,\n"
         "      turn_cards: (function () { // EARLIER_TURN_CARDS_V3：本轮卡片追加在后，重复的一轮不再记\n"
         "        const prev = asArray(previous.turn_cards);\n"
         "        if (duplicate) return prev;\n"
         "        const card = buildTurnCardV3(turn.turn_ref, turn.user_question || originalQuestion);\n"
         "        return (card ? prev.concat(card) : prev).slice(-8);\n"
         "      })(),\n", 'save next')
p['jsCode'] = c

# 3) Coverage Check LLM
p = N['Coverage Check LLM']['parameters']; t = p['text']; sm = p['options']['systemMessage']
assert MARK not in t and 'EARLIER_TURN_CARDS' not in sm
EXPR = ("{{ (function () { try { const c = ((($('Capture context').first().json || {}).conversation_state || {}).turn_cards || []).slice(-6); "
        "return c.length ? \"\\n\\nEarlier turns of this conversation (EARLIER_TURN_CARDS_V3; cards built by code from those turns' structured results):\\n\" + JSON.stringify(c) : ''; "
        "} catch (e) { return ''; } })() }}")
t = rep1(t, "\n\nPlant synonym list", EXPR + "\n\nPlant synonym list", 'cc text')
p['text'] = t
p['options']['systemMessage'] = sm.rstrip('\n') + RULE

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
