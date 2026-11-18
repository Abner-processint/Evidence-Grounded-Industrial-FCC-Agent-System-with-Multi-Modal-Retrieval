# -*- coding: utf-8 -*-
"""r1111b：覆盖检查（Coverage Check LLM）CALC_INPUTS_TO_FACTORS_V1 后补 FACTOR_SCOPE_V1（试验台与构建共用同一份文字）。"""
ANCHOR = "Count these within the limit of 8.\n"
ADD = ("   (FACTOR_SCOPE_V1) Each input factor is the quantity the calculation needs, named as that quantity (for example the flow of the whole circuit the formula refers to), "
       "not a narrower stream, branch, equipment or instrument that some evidence statement happens to mention. documented_tags holds a tag only when the evidence says "
       "that tag measures that same quantity: a statement about the meter of one branch (for example 「…以 X 为准」 about that branch) does not document the tag of the whole circuit; "
       "then leave documented_tags [] so that tag selection finds the candidates.\n")


def patch_cc(sm):
    assert sm.count(ANCHOR) == 1 and 'FACTOR_SCOPE_V1' not in sm
    return sm.replace(ANCHOR, ANCHOR + ADD)
