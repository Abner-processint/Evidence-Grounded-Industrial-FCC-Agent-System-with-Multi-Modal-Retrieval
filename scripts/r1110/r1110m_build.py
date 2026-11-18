# -*- coding: utf-8 -*-
r"""r1110m：多轮一致（用户 11-10「上下文截断」= 证据截短致多轮不一致；实测来源是下面三处，不是截短）。
① RECENT_TURNS_CONTEXT_V1（Relevant Memory Retriever）：retrieval_state 新增 recent_turns——最近 3 轮的问句、完整问句、
   取数时段（问题卡 data_scope.windows）和回答开头，不靠关键词命中。原检索按空格切词，中文问句整句成一个词，
   主线多轮 m1–m3 第 3 轮（196365/196366/196367）选中的问题卡、事实卡、位号都是 0。原有字段不动。
② PERIOD_CARRY_FORWARD_V1（Decompose Question）：追问问装置数据且没说时段时，沿用所接那一轮的时段写进 resolved_question。
   m3 第 3 轮「一中回流取热量能算吗？」没带 3 月，取数落到默认近 90 天，FRC3209 均值 449 vs 前两轮 430。
③ CROSS_TURN_CONSISTENCY_V1（Answer Finalizer LLM）：本轮对同一个量用了与前一轮不同的位号 / 数值 / 时段时并列写明各是第几轮，
   不悄悄换。m3 第 3 轮引「一中量以 FRC3208 为准」改了主表，没说前两轮按 FRC3209。定稿原本就收到上一轮回答
  （conversation_consistency_context），只是提示词里没有用它的规则。
用法：python r1110m_build.py <main.json（含 activeVersion）> <out_nodes.json> [基线版本前缀，默认 1e472a4a]"""
import json, sys, io
src = json.load(io.open(sys.argv[1], encoding='utf-8'))
base_prefix = sys.argv[3] if len(sys.argv) > 3 else '1e472a4a'
assert src['activeVersionId'].startswith(base_prefix), src['activeVersionId']
av = src['activeVersion']
N = {n['name']: n for n in av['nodes']}


def rep(code, old, new, name):
    assert code.count(old) == 1, (name, code.count(old), old[:80])
    return code.replace(old, new)


# ---------- ① 最近几轮 ----------
n = N['Relevant Memory Retriever']; c = n['parameters']['jsCode']
assert 'RECENT_TURNS_CONTEXT_V1' not in c
block = r"""// RECENT_TURNS_CONTEXT_V1：最近 3 轮（新的在前）的问句、完整问句、取数时段和回答开头，不靠关键词命中。
// 来由：上面按空格切词，中文问句整句成一个词，多轮第 3 轮（196365/196366/196367）选中的卡片全是 0，
// 拆题只剩 latest_resolved_question 一句，没继承时段；结构化时段就在问题卡 data_scope.windows 里。
const recentTurns = (function () {
  try {
    return cards.map((card, index) => ({ card: asObject(card), index }))
      .map(row => ({ ...row, ts: Date.parse(text(asObject(row.card.internal).ts, 40)) || 0 }))
      .sort((a, b) => (b.ts - a.ts) || (b.index - a.index))
      .slice(0, 3)
      .map(({ card }) => ({
        turn_ref: text(asObject(card.internal).turn_ref || card.turn_ref, 30),
        question: text(card.current_question, 300),
        resolved_question: text(card.resolved_question, 360),
        data_period: Array.from(new Set(asArray(asObject(card.data_scope).windows)
          .filter(w => Array.isArray(w) && w.length === 2).map(w => JSON.stringify(w.map(x => text(x, 40))))))
          .slice(0, 3).map(s => JSON.parse(s)),
        answer_head: text(card.current_answer_summary, 400)
      }));
  } catch (e) { return []; }
})();

const retrievalState = {"""
c = rep(c, "const retrievalState = {", block, 'RMR1')
c = rep(c, "  latest_resolved_question: text(state.latest_resolved_question, 420)\n};",
        "  latest_resolved_question: text(state.latest_resolved_question, 420),\n  recent_turns: recentTurns\n};", 'RMR2')
n['parameters']['jsCode'] = c

# ---------- ② 追问沿用时段 ----------
n = N['Decompose Question']; sm = n['parameters']['options']['systemMessage']
assert 'PERIOD_CARRY_FORWARD_V1' not in sm
sm = sm.rstrip('\n') + (
    "\n\nPERIOD_CARRY_FORWARD_V1\n"
    "Conversation State.recent_turns lists the latest turns of this conversation, newest first; each has resolved_question and data_period (the time windows its plant data was read for).\n"
    "When the current question is a follow-up that asks for a value, statistic, calculation, comparison, check or exceedance about plant operation, and it does not name a time period itself:\n"
    "1. Take the period of the turn it follows (normally recent_turns[0]): copy the explicit period words from that turn's resolved_question verbatim (for example 「2025年3月」 or 「2025年1月1日」); if that resolved_question has none but data_period is not empty, write the period as the date range in data_period.\n"
    "2. Put that period into resolved_question and list it in context_binding.inherited_terms.\n"
    "3. Do not carry a period when the current question names its own period, asks about all history or a different time, or only asks for a definition or a document and needs no plant data. Asking whether something can be calculated, or how much it is, is a calculation question and carries the period.\n"
    "Relative words in the follow-up such as 「当天」「当月」「同期」 refer to the inherited period.\n")
n['parameters']['options']['systemMessage'] = sm

# ---------- ③ 跨轮一致 ----------
n = N['Answer Finalizer LLM']; sm = n['parameters']['options']['systemMessage']
assert 'CROSS_TURN_CONSISTENCY_V1' not in sm and 'USER_INSTRUCTION_PRIORITY_V1' in sm
sm = sm.rstrip('\n') + (
    "\n\nCROSS_TURN_CONSISTENCY_V1\n"
    "aggregated_payload.conversation_consistency_context.matched_turns[].confirmed_answer_context is what an earlier turn of this conversation already told the user (turn_ref gives the turn).\n"
    "When this turn's answer, for the same quantity, uses a different tag or meter, a different value, or a different period than that earlier answer:\n"
    "1. Do not switch silently. State both: what the earlier turn used (cite it as 「第N轮」, never as an [E#] id) and what this turn uses with its [E#] citation.\n"
    "2. Say which one this turn's numbers are based on and the reason given by the current evidence. If the current evidence does not settle which is right, present both as unresolved under the source-conflict rules; do not pick one yourself.\n"
    "3. When the same tag over the same period comes out with a different value, say so and give the period and statistic each value refers to.\n"
    "If this turn only extends the earlier answer without contradicting it, no remark is needed.\n")
n['parameters']['options']['systemMessage'] = sm

# ---------- ④ 因子解析时段：原话没有时，用拆题的完整问句、再退到所接那一轮的取数时段 ----------
n = N['Prepare Factor Resolution']; c = n['parameters']['jsCode']
assert 'FOLLOWUP_RESOLVED_PERIOD_V1' not in c
c = rep(c, "const dateRange = parseRequestedDateRange(originalQuestion);", r"""// FOLLOWUP_RESOLVED_PERIOD_V1：追问原话常不带完整日期（「那3月的回炼比呢？」「计算当天…的压降」），原先只解析原话，
// 时段为空 → 因子解析不跑、Coverage Retry 按默认近 90 天取数（副本 196521 回炼比算成 9–12 月，196524 压降没算，196517 新鲜进料没走知识库）。
// 原话没有时段时依次用：拆题给出的 resolved_question；拆题认定所接那一轮（memory_resolution.matched_turns）的取数时段（问题卡 data_scope.windows）。
let dateRange = parseRequestedDateRange(originalQuestion);
let __periodSource = dateRange ? 'question' : null;
if (!dateRange) {
  try {
    const __raw = $('Decompose Question').first().json || {};
    let __d = __raw.output !== undefined ? __raw.output : __raw;
    if (typeof __d === 'string') { const a = __d.indexOf('{'), b = __d.lastIndexOf('}'); __d = a >= 0 && b > a ? JSON.parse(__d.slice(a, b + 1)) : {}; }
    __d = asObject(__d);
    const __bind = asObject(__d.context_binding), __mem = asObject(__d.memory_resolution);
    if (__d.is_follow_up === true || __bind.used_history === true || __mem.depends_on_history === true) {
      dateRange = parseRequestedDateRange(asString(__d.resolved_question));
      if (dateRange) __periodSource = 'resolved_question';
      if (!dateRange) {
        const __matched = asArray(__mem.matched_turns).map(x => asString(x));
        const __recent = asArray(asObject(($('Relevant Memory Retriever').first().json || {}).retrieval_state).recent_turns);
        const __t = __recent.find(t => __matched.includes(asString(asObject(t).turn_ref)) && asArray(asObject(t).data_period).length);
        const __w = __t ? asArray(asArray(__t.data_period)[0]) : [];
        if (__w.length === 2 && __w.every(x => !Number.isNaN(Date.parse(asString(x).replace(' ', 'T'))))) {
          dateRange = [asString(__w[0]), asString(__w[1])];
          __periodSource = 'previous_turn_period:' + asString(__t.turn_ref);
        }
      }
    }
  } catch (e) {}
}""", 'PFR1')
c = rep(c, "    factor_resolution_date_range: dateRange,\n", "    factor_resolution_date_range: dateRange,\n    factor_resolution_period_source: __periodSource,\n", 'PFR2')
n['parameters']['jsCode'] = c

CHANGED = ['Answer Finalizer LLM', 'Decompose Question', 'Prepare Factor Resolution', 'Relevant Memory Retriever']
json.dump({'nodes': av['nodes'], 'connections': av['connections'], 'changed': CHANGED}, io.open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print('ok', CHANGED)
