# -*- coding: utf-8 -*-
"""r1111 改稿一步：候选提示词（与 r1111_build.py 共用，试验台和构建用同一份文字）。"""
OLD_ABD_TAIL = "When the note says it is in uncitable_material, state it without an [E..] citation and name in words the document it comes from.\n"
NEW_ABD_TAIL = OLD_ABD_TAIL + (
    "     (EDIT_SOURCE_SCOPE_V1) State it with the scope the source gives it: the stream, branch, instrument, equipment or period that source statement is about. "
    "Do not turn it into a conclusion the source does not draw, such as which tag or meter the answer should use for a different or larger quantity; "
    "when the draft said such a choice cannot yet be decided and the source does not decide it for that quantity, keep that choice undecided. "
    "When the note quotes an earlier turn and the original statement is in the evidence given to you, use the original wording and cite it.\n"
    "   - (CROSS_TURN_CONSISTENCY_V1) earlier_turns is what earlier turns of this conversation already told the user. "
    "When a replacement makes this answer use, for the same quantity, a different tag or meter, a different value or a different period than an earlier turn did, "
    "the replacement also states what that turn used (cite it as 「第N轮」, never as an [E..] id) and why this answer uses the other, from the source. "
    "Do not mention earlier turns otherwise.\n")
OLD_R6 = "Do not add claims that the findings do not require, and do not touch text that no finding concerns."
NEW_R6 = "Do not add claims that the findings (or rule CROSS_TURN_CONSISTENCY_V1) do not require, and do not touch text that no finding concerns."
OLD_R7 = "(A sentence about an earlier turn of the conversation, required by a correction_missing finding, is part of the answer, not a mention of this check.)"
NEW_R7 = "(A sentence about an earlier turn of the conversation, required by a correction_missing finding, by ABDICATION_CHECK_V7 or by CROSS_TURN_CONSISTENCY_V1, is part of the answer, not a mention of this check.)"
OLD_TEXT_TAIL = "Established thresholds (for reference):\n{{ JSON.stringify($json.answer_edit_packet.thresholds) }}\n\nReturn only the JSON object."
NEW_TEXT_TAIL = ("Established thresholds (for reference):\n{{ JSON.stringify($json.answer_edit_packet.thresholds) }}\n\n"
                 "Earlier turns of this conversation (earlier_turns: turn_ref, question, what that turn told the user):\n{{ JSON.stringify($json.answer_edit_packet.earlier_turns || []) }}\n\n"
                 "Return only the JSON object.")


def patch_system(sm):
    for a, b in ((OLD_ABD_TAIL, NEW_ABD_TAIL), (OLD_R6, NEW_R6), (OLD_R7, NEW_R7)):
        assert sm.count(a) == 1, a[:60]
        sm = sm.replace(a, b)
    return sm


def patch_text(t):
    assert t.count(OLD_TEXT_TAIL) == 1
    return t.replace(OLD_TEXT_TAIL, NEW_TEXT_TAIL)

# ---------- 核对一步（Answer Verification LLM）规则 6 的范围条 ----------
OLD_V6 = "If the context does not contain it, the statement is supported_by_context.\n"
NEW_V6 = OLD_V6 + (
    "   (ABDICATION_SCOPE_V1) The context contains that thing only when it settles the same question for the same object. "
    "A statement about one stream, branch, instrument, equipment or period does not settle a choice the draft left open for a different or larger quantity "
    "(for example which meter to use for a total flow); such a draft statement is supported_by_context. "
    "In note, quote the source statement in its own words together with the object it is about, not a paraphrase that widens it.\n")


def patch_verifier(sm):
    assert sm.count(OLD_V6) == 1
    return sm.replace(OLD_V6, NEW_V6)
