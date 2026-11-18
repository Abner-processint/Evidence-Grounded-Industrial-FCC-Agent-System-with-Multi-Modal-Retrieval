# -*- coding: utf-8 -*-
r"""r1111：核对→改稿不得扩大资料范围、换位号要说明前几轮（用户 11-11「先修改稿换位号」）。
来由（主线 d0d30dd5，exec 196623 一中回流第 3 轮）：定稿草稿写「F 取 FRC3209 单路还是两路之和不能判定」，与前两轮一致；
核对第 1 遍按前轮回答转述的调研资料（原文「一中进E1309AB稳定塔重沸器总流量FRC3208与分支流量FIC3311和FIC3312总和存在较大偏差？
仪表测量误差，一中量以FRC3208为准」）判「上下文已有」，改稿把它扩成「所以 F 应取 FRC3208」；核对第 2 遍又判「F 口径已有依据」。
改稿看不到前几轮回答，CROSS_TURN_CONSISTENCY_V1 只在定稿。试验台重放（bench_edit.py / bench_verify.py）结果见工作日志 11-11。
① Prepare Answer Edit：answer_edit_packet 新增 earlier_turns（定稿用的同一份 conversation_consistency_context.matched_turns）。
② Answer Edit LLM：ABDICATION 条后加 EDIT_SOURCE_SCOPE_V1、CROSS_TURN_CONSISTENCY_V1；规则 6、7 对应放开；用户消息加 earlier_turns。
③ Answer Verification LLM：规则 6 后加 ABDICATION_SCOPE_V1。
用法：python r1111_build.py <main.json（含 activeVersion）> <out_nodes.json> [基线版本前缀，默认 d0d30dd5]"""
import json, sys, io, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from edit_prompt import patch_system, patch_text, patch_verifier
src = json.load(io.open(sys.argv[1], encoding='utf-8'))
base_prefix = sys.argv[3] if len(sys.argv) > 3 else 'd0d30dd5'
assert src['activeVersionId'].startswith(base_prefix), src['activeVersionId']
av = src['activeVersion']; N = {n['name']: n for n in av['nodes']}

# ① 前几轮回答进改稿材料
n = N['Prepare Answer Edit']; c = n['parameters']['jsCode']
assert 'EARLIER_TURNS_FOR_EDIT_V1' not in c
old = "    thresholds: asArray(crp.established_thresholds).slice(0, 14)\n  }\n} }];"
assert c.count(old) == 1
c = c.replace(old, "    thresholds: asArray(crp.established_thresholds).slice(0, 14),\n"
              "    // EARLIER_TURNS_FOR_EDIT_V1：前几轮已告诉用户的内容（与定稿 CROSS_TURN_CONSISTENCY_V1 同一份），改稿换位号 / 数值 / 时段时要说明\n"
              "    earlier_turns: asArray(asObject(asObject(crp.finalizer_payload).conversation_consistency_context).matched_turns).map(asObject)\n"
              "      .map(t => ({ turn_ref: asString(t.turn_ref), question: asString(t.question), told_user: asString(t.confirmed_answer_context) }))\n"
              "      .filter(t => t.told_user)\n"
              "  }\n} }];")
n['parameters']['jsCode'] = c

# ② 改稿提示词
n = N['Answer Edit LLM']; p = n['parameters']
assert 'EDIT_SOURCE_SCOPE_V1' not in p['options']['systemMessage']
p['options']['systemMessage'] = patch_system(p['options']['systemMessage'])
p['text'] = patch_text(p['text'])

# ③ 核对提示词
n = N['Answer Verification LLM']; p = n['parameters']
assert 'ABDICATION_SCOPE_V1' not in p['options']['systemMessage']
p['options']['systemMessage'] = patch_verifier(p['options']['systemMessage'])

CHANGED = ['Answer Edit LLM', 'Answer Verification LLM', 'Prepare Answer Edit']
json.dump({'nodes': av['nodes'], 'connections': av['connections'], 'changed': CHANGED}, io.open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print('ok', CHANGED)
