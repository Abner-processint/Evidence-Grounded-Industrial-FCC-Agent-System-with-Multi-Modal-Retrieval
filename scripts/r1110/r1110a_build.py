# -*- coding: utf-8 -*-
r"""r1110a：按公司 11-10 确认与用户同日要求改知识库与提示词（副本验证用）。
① PLANT_KB_1110（Plant Knowledge Base）：K2 柴油只用 FT3231、不讨论两表差异；新增 K3 回炼油浆 FRC3250（公司原话写进备注）。
② SECTION_BASIS_ALTERNATIVES_V1 / HOLDUP_FROM_LEVEL_V1（Derived Quantity LLM 末尾两条）：同一段有几种划分依据时每种各出一个定义，可算的算出、不可算的照实报；持液体积由液位 + 几何定义。
③ FORMULA_SOURCE_NOTE_V1（Append Factor Resolution Result）：计算量文字写明公式来源，通用定义的标「请用户确认」。
④ USER_INSTRUCTION_PRIORITY_V1（Answer Finalizer LLM、Answer Composer LLM）：提问人明确要求与呈现规则冲突时以提问人为准；Composer 输入加提问原文。
⑤ MISSING_VS_NOT_APPLICABLE_V1（Answer Composer LLM）：只有查过没有才写「未检索到」，本来不提供的统计项写「—」。
用法：python r1110a_build.py <main.json（含 activeVersion）> <out_nodes.json> [基线版本前缀]"""
import json, sys, io, os
src = json.load(io.open(sys.argv[1], encoding='utf-8'))
base_prefix = sys.argv[3] if len(sys.argv) > 3 else 'c7b73e28'
assert src['activeVersionId'].startswith(base_prefix), src['activeVersionId']
av = src['activeVersion']
N = {n['name']: n for n in av['nodes']}


def rep(code, old, new, name):
    assert code.count(old) == 1, (name, code.count(old), old[:80])
    return code.replace(old, new)


# ---------- ① 知识库 ----------
n = N['Plant Knowledge Base']; c = n['parameters']['jsCode']
i0 = c.index('const KB = {'); i1 = c.index('};\n', i0) + 3
kb = json.loads(c[i0 + len('const KB = '):i1 - 2])
assert [e['id'] for e in kb['entries']] == ['K1', 'K2'], [e['id'] for e in kb['entries']]
kb['version'] = 'demo-20261110'
k2 = kb['entries'][1]
k2['meaning'] = '分馏出装置的柴油产品流量，本装置看 FT3231（公司 2026-11-10）。柴油收率等用它作分子。回答直接用 FT3231，不讨论其他柴油表与它的差别及原因。'
k2['not_this'] = 'FRQ3231 是累积量，不是流量；中段回流、柴油抽出温度不是柴油产量。'
k2['options'] = [{'tags': ['FT3231'], 'note': '分馏柴油出装置流量'}]
k2['remarks'] = '公司 2026-11-10：算收率、问柴油产品流量看 FT3231，不用指明两块柴油表差异的原因，给出原因反而不恰当。'
k2['source'] = '公司 2026-10-27 收率口径图一：柴油收率 = 柴油出装置流量 [FT3231] / 新鲜进料；2026-11-10 公司确认只看 FT3231'
kb['entries'].append({
    'id': 'K3', 'name': '回炼油浆',
    'aliases': ['回炼油浆量', '回炼油浆流量', '油浆回炼量', '油浆回炼流量', '回炼浆', 'recycle slurry'],
    'meaning': '回炼回提升管的油浆流量，本装置看 FRC3250（公司 2026-11-10）。回炼比等以它计入回炼量。',
    'not_this': 'FI3251 不作回炼油浆量用；塔底油浆循环流量（FRC3215、FRC3217）和油浆出装置量不是回炼油浆。',
    'unit': 't/h',
    'options': [{'tags': ['FRC3250'], 'note': '回炼油浆流量'}],
    'remarks': '公司 2026-11-10：回炼油浆看 FRC3250；本装置目前已经没有回炼油（批注原话写作「没有回炼油浆了」，用户 2026-11-10 确认是笔误，指回炼油）。',
    'source': '公司 2026-11-10 对周报遗留问题的批注'})
kb['entries'].append({
    'id': 'K4', 'name': '回炼油',
    'aliases': ['回炼油量', '回炼油流量', '轻柴油回炼', '回炼轻柴油', 'recycle oil', 'heavy cycle oil recycle'],
    'meaning': '本装置目前已经没有回炼油（公司 2026-11-10）：回炼量只有回炼油浆（K3，FRC3250）。回炼比、联合进料比等含回炼量的量，回炼油一项不存在，不作为待查或缺失的输入，只计回炼油浆。',
    'not_this': '回炼油浆（K3）不是回炼油；FRC3250 是回炼油浆流量，不能当回炼油用。',
    'unit': 't/h',
    'options': [],
    'remarks': '公司 2026-11-10 批注，用户同日确认。',
    'source': '公司 2026-11-10 对周报遗留问题的批注'})
new_kb = 'const KB = ' + json.dumps(kb, ensure_ascii=False, indent=1) + ';\n'
c = c[:i0] + new_kb + c[i1:]
c = '// PLANT_KB_1110：公司 11-10 批注（柴油只看 FT3231、不说两表差异原因；回炼油浆看 FRC3250；目前没有回炼油）\n' + c
n['parameters']['jsCode'] = c

# ---------- ② 定义模型 ----------
n = N['Derived Quantity LLM']; sm = n['parameters']['options']['systemMessage']
assert 'SECTION_BASIS_ALTERNATIVES_V1' not in sm
sm = sm.rstrip('\n') + (
    "\n\nSECTION_BASIS_ALTERNATIVES_V1\n"
    "When the supplied Plant Model facts give more than one way to bound the requested section or interval (for example an instrument's own pressure-tap elevations versus the equipment zone's boundary elevations), return one definition per basis instead of choosing one. Each gets the same replaces, its own plant_model_ref inputs, and a name and source_label that state the basis (for example 「一再稀相段压降（DR3110 取压口跨距）」 and 「一再稀相段压降（稀相段上下界）」). Return a basis even when its facts are marked field_confirm or are otherwise not usable for calculation; the workflow reports that one as not computable, so the answer can give the value on the usable basis and state that the other basis cannot be calculated.\n"
    "\nHOLDUP_FROM_LEVEL_V1\n"
    "A liquid holdup or inventory volume is not measured by any instrument. Define it from the vessel's level measurement (a level tag normally reports percent of the instrument span) and vessel geometry: add the level measurement as a component variable with unit %, use plant_model_ref inputs for supplied geometry (level-instrument tap elevations or span, vessel internal diameter or cross-section), and list geometry that is not in the supplied facts as missing items with symbol null. Never bind a level percentage directly to a volume symbol.\n")
n['parameters']['options']['systemMessage'] = sm

# ---------- ③ 公式来源 ----------
n = N['Append Factor Resolution Result']; c = n['parameters']['jsCode']
old = "  return '计算量 '+label+' = '+d.expression+'，由代码按'+basis+'代入计算；请求范围 '"
new = ("  // FORMULA_SOURCE_NOTE_V1：写明公式来源；通用定义（本装置文件没给）的标明请用户确认（用户 11-10：可用通用知识找公式、数据核对、最后用户确认）\n"
       "  const __fs = asString(d.formula_source) === 'standard_definition' ? '公式来源：通用定义（非本装置文件给出），请用户确认'\n"
       "    : '公式来源：' + (asString(d.formula_source_doc) || asString(d.formula_source) || '未注明');\n"
       "  return '计算量 '+label+' = '+d.expression+'（'+__fs+'），由代码按'+basis+'代入计算；请求范围 '")
c = rep(c, old, new, 'AFR')
n['parameters']['jsCode'] = c

# ---------- ④ 提问人要求优先 ----------
UIP_EN = ("\n\nUSER_INSTRUCTION_PRIORITY_V1\n"
          "When the original question explicitly asks for something about the answer (which meter or source to use, whether to give reasons, scope, format, length or language) and that conflicts with a presentation, parallel-listing, structure or format rule in this message, follow the question. This never permits inventing data, changing a measured or computed value, or dropping citations for the facts that remain.\n")
n = N['Answer Finalizer LLM']; sm = n['parameters']['options']['systemMessage']
assert 'USER_INSTRUCTION_PRIORITY_V1' not in sm
n['parameters']['options']['systemMessage'] = sm.rstrip('\n') + UIP_EN
n = N['Answer Composer LLM']; sm = n['parameters']['options']['systemMessage']
sm = rep(sm, "   - 缺失字段写“未检索到”或对应语言的等义表达；\n",
         "   - 缺失字段：本轮查过、确实没有的写“未检索到”或对应语言的等义表达；\n"
         "     证据本来就不提供的统计项（例如计算量没有给出的样本数、标准差）写“—”或不设该列，\n"
         "     不写“未检索到”（MISSING_VS_NOT_APPLICABLE_V1）；\n", 'COMP_MISS')
sm = sm.rstrip('\n') + ("\n\n提问人要求优先（USER_INSTRUCTION_PRIORITY_V1）：\n"
                        "- 输入里给出了提问原文。提问里明确提出的要求（只看哪块表或哪个来源、要不要说原因、范围、格式、长度）\n"
                        "  与本消息的结构、表格、并列规则冲突时，以提问要求为准。\n"
                        "- 这不允许编造数据、改动数值，也不允许删去保留下来的事实的引用。\n")
n['parameters']['options']['systemMessage'] = sm
t = n['parameters']['text']
t = rep(t, "=证据正文：\n", "=提问原文：\n{{ $('Capture context').first().json.originalUserMessage || '' }}\n\n证据正文：\n", 'COMP_TEXT')
n['parameters']['text'] = t

CHANGED = ['Answer Composer LLM', 'Answer Finalizer LLM', 'Append Factor Resolution Result', 'Derived Quantity LLM', 'Plant Knowledge Base']
json.dump({'nodes': av['nodes'], 'connections': av['connections'], 'changed': CHANGED}, io.open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print('ok', CHANGED)
