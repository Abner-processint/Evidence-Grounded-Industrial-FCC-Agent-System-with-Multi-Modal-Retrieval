# -*- coding: utf-8 -*-
"""r1111b：对照问题核对里加「跨轮换位号 / 数值 / 时段」一问（试验台与构建共用同一份文字）。
锚点用原始字符串：Split Verification Parts 的 TASK 是 JS 字符串，源码里换行写作 \\n、引号写作 \\"。"""
OLD_INPUT = r"earlier turns of this conversation that the assistant did not answer; the numbered answer lines."
NEW_INPUT = r"earlier turns of this conversation that the assistant did not answer; earlier turns that were answered, with what each already told the user; the numbered answer lines."
OLD_RET = r'\n\nReturn JSON only:\n{\"needs\"'
NEW_ITEM3 = (r'\n3. (CROSS_TURN_CHECK_V1) For each earlier answered turn, list in \"switches\" every quantity for which this answer' + "'" + r's numbers rest on a different tag or meter, '
             r'a different value, or a different period than that turn already gave the user for the same quantity. Only the same quantity counts: a different quantity, '
             r'a value this answer adds, or a choice among candidates that the earlier turn left open, is not a switch. For each switch give \"turn_ref\", \"quantity\", '
             r'\"earlier\" (what that turn used, in its own words), \"now\" (what this answer uses), and \"named_line\": the number of the line that explicitly says what that '
             r'earlier turn used (by its number, or as \"the earlier answer\") and that this answer uses something else; null when no line does this. Do not judge which one is right. '
             r'Use [] when there is no switch.')
OLD_RET_TAIL = r'\"named_quote\":\"\"}]}";'
NEW_RET_TAIL = r'\"named_quote\":\"\"}],\"switches\":[{\"turn_ref\":\"T2\",\"quantity\":\"...\",\"earlier\":\"...\",\"now\":\"...\",\"named_line\":null}]}";'
OLD_MSG = "    '\\n\\nEarlier unanswered turns:\\n' + JSON.stringify(qc.turns || []) +\n"
NEW_MSG = OLD_MSG + "    '\\n\\nEarlier answered turns (turn_ref, question, what that turn told the user):\\n' + JSON.stringify(qc.answered_turns || []) + // CROSS_TURN_CHECK_V1\n"


def patch_svp(code):
    for a, b in ((OLD_INPUT, NEW_INPUT), (OLD_RET, NEW_ITEM3 + OLD_RET), (OLD_RET_TAIL, NEW_RET_TAIL), (OLD_MSG, NEW_MSG)):
        assert code.count(a) == 1, (code.count(a), a[:70])
        code = code.replace(a, b)
    return code
