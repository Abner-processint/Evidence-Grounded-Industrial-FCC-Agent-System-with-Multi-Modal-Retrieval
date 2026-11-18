# -*- coding: utf-8 -*-
"""r1112u：历史卡片 EARLIER_TURN_CARDS_V3，规则 V5 放在用户消息里、紧挨卡片块（有卡片才出现）；系统消息不动，首轮提示词与主线逐字一致。
由 r1112_build.py 改来（那一版把规则加在系统消息末尾，首轮也带规则，副本单题压降 aT10 没算出）。改 3 个节点：
- Capture context：读会话状态时保留 turn_cards；
- Save Conversation State：每轮结束由代码记一张卡（turn_card_v3.js），追加进 turn_cards（最多 8 张）；
- Coverage Check LLM：用户消息在「Plant synonym list」前插入「规则 V5 + 前几轮卡片」（没有卡片时整段不插）。
用法：python r1112u_build.py <in.json> <out.json> [底版前缀]；in 可以是 GET 回来的工作流（用 activeVersion）。"""
import sys, os, io, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'ctx_audit'))
from rule_v5 import RULE
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

# 3) Coverage Check LLM：只改用户消息
p = N['Coverage Check LLM']['parameters']; t = p['text']; sm = p['options']['systemMessage']
assert MARK not in t and 'EARLIER_TURN_CARDS' not in sm
assert '{{' not in RULE and '}}' not in RULE
HEAD = json.dumps('\n\n' + RULE.strip('\n') + "\n\nEarlier turns of this conversation (EARLIER_TURN_CARDS_V3; cards built by code from those turns' structured results):\n", ensure_ascii=False)
EXPR = ("{{ (function () { try { const c = ((($('Capture context').first().json || {}).conversation_state || {}).turn_cards || []).slice(-6); "
        "return c.length ? " + HEAD + " + JSON.stringify(c) : ''; } catch (e) { return ''; } })() }}")
t = rep1(t, "\n\nPlant synonym list", EXPR + "\n\nPlant synonym list", 'cc text')
p['text'] = t

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out: out['nodes'] = nodes; out['connections'] = av['connections']
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst)
