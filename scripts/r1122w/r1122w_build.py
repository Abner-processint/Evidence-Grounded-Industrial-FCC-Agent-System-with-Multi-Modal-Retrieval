# -*- coding: utf-8 -*-
"""r1122w：轻改首稿要求（11-20 用户选「轻改首稿要求」）。只加、不删不改原句：
1. Answer Finalizer LLM：证据规则后加 PLANT_FACTS_IN_BODY_V1，界定哪些本装置文档资料属于「直接回答本问」、必须写进正文
   （与 Evidence packet rule 3、Core rule 10/15、Evidence admissibility rule 12 不冲突：只说明什么算 directly answer；实时库数据照旧按原规则）。
2. Answer Composer LLM：界定什么算推测（原句不动）。
诊断依据：诊断实验_QS未过线11题_20261119.md 第二、五节（原回答正文只有 185 个数值、教材机理被写成「待验证的推断」）。
用法：python r1122w_build.py <in.json> <out.json>"""
import sys, io, json
src, dst = sys.argv[1], sys.argv[2]
wf = json.load(io.open(src, encoding='utf-8'))
av = wf.get('activeVersion') or wf
nodes = json.loads(json.dumps(av['nodes'])); N = {n['name']: n for n in nodes}
M1, M2 = 'PLANT_FACTS_IN_BODY_V1', 'MECHANISM_NOT_SPECULATION_V1'


def rep(code, old, new):
    assert code.count(old) == 1, (old[:60], code.count(old))
    return code.replace(old, new)


FIN_ADD = """本装置资料写进正文（PLANT_FACTS_IN_BODY_V1）：
- 适用：问题问的是机理、影响、原因、判断、操作或控制，而不只是查一个数值、一个位号或一段数据；且 evidence_packet 里有本装置的文档资料（技术月报、标定报告、事故 / 事件记录、操作规程、工艺卡片、规程指标）。
- 下列本装置文档资料属于直接回答本问的内容（即 Evidence packet rule 3、Core rule 15 所说的 directly answer），要写进正文论述，不能只留给下游的证据附录：
  ① 把本问所涉因素与结果写在一起的记录：同一句或同一段写明了方向或归因（例如月报写「原料密度上升、可裂化性减弱，焦炭选择性偏高」）。写出时段、数值和资料里的归因；这类记录满足 Evidence admissibility rule 12。
  ② 本问所涉参数在本装置的控制指标、报警值、联锁值和工艺卡片范围。
  ③ 本问所涉的量在最近一期月报里的数值；资料里有上期值或计划值时一并对比。
- 写法：放在一节里（例如「本装置情况」），或写在对应论点之下；两项以上按 ANSWER PRESENTATION POLICY 制表，每个数带引用。用这些数据说明机理在本装置上的表现，或支撑运行判断与建议，不要只罗列。
- 每个数写明属于哪一期、出自哪类资料（哪年哪月的月报、哪份规程或工艺卡片）。不得把累计量、年度量写成月度量，不得把实测值写成限值。
- 不满足 ①②③ 的本装置数据照旧不写。本条只管文档资料；实时库 / MongoDB 数据仍按 Core rule 10、15 处理。讲其他设备、其他位号的证据仍按原规则处理。

"""
f = N['Answer Finalizer LLM']['parameters']['options']; assert M1 not in f['systemMessage']
f['systemMessage'] = rep(f['systemMessage'], '本轮必答项（REQUIRED_COVERAGE_V7）：', FIN_ADD + '本轮必答项（REQUIRED_COVERAGE_V7）：')

COMP_OLD = '     仅使用“说明”“意味着”等措辞不能使推断成为已确认事实。\n'
COMP_ADD = ('   - 什么算推测（MECHANISM_NOT_SPECULATION_V1）：通行的化工原理，以及教材、手册里的一般机理（例如密度与烃族组成的关系、\n'
            '     重金属对催化剂的污染作用），是专业知识，不是推测。直接陈述，不要因为它没有 [E#] 就加「待验证」「推断」一类标签；\n'
            '     下游会为这类句子补背景知识出处。机理本身有多种解释并存时，照常说明各种解释。\n'
            '     要写成可能性或建议的，是关于本装置的未经证据支持的判断：本装置为何如此、某时段发生了什么、本装置该怎样调。\n')
c = N['Answer Composer LLM']['parameters']['options']; assert M2 not in c['systemMessage']
c['systemMessage'] = rep(c['systemMessage'], COMP_OLD, COMP_OLD + COMP_ADD)

out = json.loads(json.dumps(wf)); tgt = out.get('activeVersion') or out
tgt['nodes'] = nodes
if 'activeVersion' in out: out['nodes'] = nodes
json.dump(out, io.open(dst, 'w', encoding='utf-8'), ensure_ascii=False)
print('built', dst, len(nodes))
