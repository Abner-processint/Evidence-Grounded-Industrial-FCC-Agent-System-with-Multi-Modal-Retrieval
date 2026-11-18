# -*- coding: utf-8 -*-
"""r1117 节点内容：NO_ABSENCE_REWRITE_V1（「要说没有就不说」，用户 11-17）。供 r1117_build.py 引用。"""

RSYS = ('你在修订一个催化裂化装置问答系统的最终回答正文。规则（用户定）：回答里不出现「没有某信息」的断言——包括「未检索到」「没有给出」「证据中没有」「未提供」「缺少」「未找到」「无法获取」「无法判定」「不能判定」「无法确认」「无法给出」等说法；'
        '要说没有就不说。\n'
        '逐处处理：\n'
        '1. 正文里断言没有的句子或分句：删去该句或该分句；若同一句里还有其他有用内容，只删断言没有的部分，保留其余内容和其中的 [E数字] 引用。\n'
        '2. 「不能判定的部分」「未确认项」「下一步核查」这类小节里的条目：改写成「建议下一步核查 X」（X 写清对象，如位号、设备、时段），不写「未检索到 X」「无法判定 X」。整节删空时连同小节标题一起删去。\n'
        '3. 用户问「能不能算 / 有没有 / 是否超过」这类问题时，若断言没有就是回答本身：改写成正面说法——能算的写「能算，需要 A、B、C」，需要补的写「还需要 X」；不要写「缺 X 所以算不了」。\n'
        '4. 不是「没有」断言的不要改：数值、位号、结论、引用、口径说明、状态说明（「待现场确认」「推断」「不可用于计算」「通用定义、需用户确认」）、表格里本来不提供的统计项「—」。\n'
        '5. 查过数据得出的否定结论不是「没有某信息」，不要改：「未超过报警限」「没有越限日期」「低于 L 的日期没有」「0 天」「未见越限」「两表读数一致、没有偏差」这类是实测结果，原样保留。\n'
        '6. 「数据依据」「证据」小节以及其中的「摘录」是资料原文，原样保留，一个字都不改。\n'
        '7. 表格单元格里的「未检索到」改成「—」。\n'
        '每条修改的 find 必须是回答原文里连续的一段，逐字复制（含标点、空格、[E数字]），长度 8–200 字，并且在原文中只出现一次；replace 是替换后的文字（删除则为空字符串）。\n'
        '只输出 JSON：{"edits":[{"find":"…","replace":"…","why":"≤15字"}]}；没有需要改的输出 {"edits":[]}。')

PREP_JS = r'''// NO_ABSENCE_REWRITE_V1（11-17 用户）：「回答与回答之间可以不说，但不能有矛盾」「要说没有就不说」；保留「不能判定的部分 / 下一步核查」一节，
// 但只写「建议下一步核查 X」，不写「未检索到 X」「无法判定」这类断言，正文里的「没有 / 未检索到」都删掉。
// 来由：11-17 预验收基线 34 题 × 2，约 19 题两次回答互相矛盾，其中约 5 题是一次说「未检索到 / 无法判定」、另一次给出了内容。
// 做法：成稿定下之后、存会话之前，模型给出逐字查找替换，由下一步代码执行；只改正文（第一个「#### 」小标题——数据依据附录——之前），附录是资料原文，不动。
// 本节点只准备模型输入；模型失败时下一步原样放行。
const item = $input.first().json || {};
const full = String(item.output || '');
const m = /(^|\n)####\s/.exec(full);
const cut = m ? m.index : full.length;
const body = full.slice(0, cut);
let q = String(item.originalUserMessage || '');
if (!q) { try { q = String((($('Capture context').first().json) || {}).originalUserMessage || ''); } catch (e) {} }
const needed = body.trim().length >= 40;
return [{ json: { ...item, no_absence_needed: needed, no_absence_user: '用户问题：' + q + '\n\n最终回答正文：\n' + body.slice(0, 16000) } }];
'''

APPLY_JS = r'''// NO_ABSENCE_REWRITE_V1：执行模型给出的查找替换。只在正文里改；find 须在正文中恰好出现一次，否则跳过并留痕；模型失败或输出无法解析时原样放行。
// 离线试验（11-17，基线 68 份回答）：正文里断言没有的句子 243 → 67；数值被删 0 份；数据依据附录改动 0 处；实测否定结论（未越限等）误删 1 处。
const base = $('Prepare No-Absence Rewrite').first().json || {};
const full = String(base.output || '');
const m = /(^|\n)####\s/.exec(full);
const cut = m ? m.index : full.length;
let body = full.slice(0, cut);
const tail = full.slice(cut);
const trace = { applied: 0, skipped: [], parse_ok: false, edits: 0 };
let raw = '';
try { const j = $input.first().json || {}; raw = String(j.output || j.text || ''); } catch (e) {}
let edits = [];
try {
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  const o = JSON.parse(raw.slice(a, b + 1));
  edits = Array.isArray(o.edits) ? o.edits : [];
  trace.parse_ok = true;
} catch (e) {}
trace.edits = edits.length;
if (base.no_absence_needed) {
  for (const e of edits) {
    const f = String((e && e.find) || ''), r = String((e && e.replace) || '');
    if (f.length < 4 || body.split(f).length !== 2) { trace.skipped.push(f.slice(0, 40)); continue; }
    body = body.replace(f, () => r);
    trace.applied += 1;
  }
}
const out = (body.replace(/\n{3,}/g, '\n\n') + tail);
const { no_absence_user, ...rest } = base;
return [{ json: { ...rest, output: out, no_absence_rewrite: trace } }];
'''
