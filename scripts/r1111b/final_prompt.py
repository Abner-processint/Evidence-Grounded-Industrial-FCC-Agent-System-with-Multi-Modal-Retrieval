# -*- coding: utf-8 -*-
"""r1111b：定稿加 SOURCE_STATEMENT_SCOPE_V1（试验台与构建共用同一份文字）。放在 CROSS_TURN_CONSISTENCY_V1 之后，不改其原文。"""
ANCHOR = "CROSS_TURN_CONSISTENCY_V1\n"
RULE = ("\n\nSOURCE_STATEMENT_SCOPE_V1\n"
        "This applies 主体纪律 to document statements that settle a choice. A statement that settles which tag, meter, value or period to use "
        "(for example 「以 X 为准」) applies only to the object it names: the stream, branch, equipment, instrument or period in that statement. "
        "Do not use it to decide a different or larger quantity; a statement about the meter of one branch does not make that meter the flow of the whole circuit.\n"
        "When the evidence does not settle which tag represents a calculation input or the quantity asked about, list the candidate tags with their values and "
        "the object each one measures (from their descriptions), and leave the choice open; do not pick one yourself.\n")


def patch_finalizer(sm):
    assert sm.count(ANCHOR) == 1 and 'SOURCE_STATEMENT_SCOPE_V1' not in sm
    return sm.rstrip('\n') + RULE
