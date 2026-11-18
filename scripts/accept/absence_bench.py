# -*- coding: utf-8 -*-
"""「要说没有就不说」改写一步的离线试验（工作流未改）。
用户 11-17：保留「不能判定的部分 / 下一步核查」一节，但只写「建议下一步核查 X」，不写「未检索到 X」「无法判定」这类断言；正文里的「没有 / 未检索到」都删掉。
做法：模型读最终回答，给出逐字查找替换（find/replace）；代码只在 find 在原文里恰好出现一次时替换。
量：改写前后断言没有的句子数（同一检测提示，两遍取并）；关键数值是否被删（回答里出现的数值，改写后少了哪些）；改动字数。
用法：python absence_bench.py [题号前缀]"""
import json, io, os, sys, glob, re, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import score as S  # noqa

RSYS = ('你在修订一个催化裂化装置问答系统的最终回答。规则（用户定）：回答里不出现「没有某信息」的断言——包括「未检索到」「没有给出」「证据中没有」「未提供」「缺少」「未找到」「无法获取」「无法判定」「不能判定」「无法确认」「无法给出」等说法；'
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

DSYS = ('找出下面回答里所有断言「某信息没有」的句子：未检索到、没有给出、证据中没有、未提供、缺少、未找到、无法获取、无法判定、不能判定、无法确认、无法给出、不能算出等。'
        '「待现场确认」「推断」「不可用于计算」这类状态说明不算；表格里的「—」不算。只输出 JSON：{"sentences":["原句，≤60字"]}')


def apply_edits(ans, edits):
    out, done, skip = ans, 0, []
    for e in edits or []:
        f, r = str(e.get('find') or ''), str(e.get('replace') or '')
        if len(f) < 4 or out.count(f) != 1: skip.append(f[:40]); continue
        out = out.replace(f, r); done += 1
    out = re.sub(r'\n{3,}', '\n\n', out)
    return out, done, skip


def nums(s): return collections.Counter(re.findall(r'\d+\.\d+|\d{3,}', s))


if __name__ == '__main__':
    flt = sys.argv[1] if len(sys.argv) > 1 else ''
    runs = [p for p in sorted(glob.glob(os.path.join(HERE, 'runs', '*.json'))) if os.path.basename(p).startswith(flt)]
    A = {S.run_key(p): str(json.load(io.open(p, encoding='utf-8'))['answer']) for p in runs}
    keys = list(A)
    outs = S.bench([{'system': RSYS, 'user': '用户问题：%s\n\n最终回答：\n%s' % (S.Q[k.rsplit('_', 1)[0]]['question'], A[k][:16000])} for k in keys])
    new, stat = {}, {}
    for k, o in zip(keys, outs):
        j = S.pj(o) or {}
        n, done, skip = apply_edits(A[k], j.get('edits'))
        new[k] = n; stat[k] = {'edits': len(j.get('edits') or []), 'applied': done, 'skipped': skip, 'parse_ok': bool(j)}
    # 检测：前后各两遍
    det_items, det_keys = [], []
    for k in keys:
        for tag, txt in (('before', A[k]), ('after', new[k])):
            for r in range(2): det_items.append({'system': DSYS, 'user': txt[:16000]}); det_keys.append((k, tag))
    det = S.bench(det_items)
    cnt = collections.defaultdict(set)
    for (k, tag), o in zip(det_keys, det):
        for s in (S.pj(o) or {}).get('sentences') or []: cnt[(k, tag)].add(str(s)[:30])
    tot = collections.Counter(); lost = []
    for k in keys:
        b, a = len(cnt[(k, 'before')]), len(cnt[(k, 'after')])
        tot['before'] += b; tot['after'] += a
        nb, na = nums(A[k]), nums(new[k])
        gone = [x for x in nb if na[x] == 0]
        stat[k].update({'absence_before': b, 'absence_after': a, 'chars_before': len(A[k]), 'chars_after': len(new[k]), 'numbers_gone': gone[:12]})
        if gone: lost.append((k, gone[:8]))
    json.dump({'stat': stat, 'new': new}, io.open(os.path.join(HERE, 'score', os.environ.get('ABOUT', 'absence_bench') + '.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('断言没有的句子 前', tot['before'], '后', tot['after'])
    print('改写条数', sum(v['edits'] for v in stat.values()), '执行', sum(v['applied'] for v in stat.values()), '跳过', sum(len(v['skipped']) for v in stat.values()), '解析失败', sum(1 for v in stat.values() if not v['parse_ok']))
    print('字数 前/后', sum(v['chars_before'] for v in stat.values()), sum(v['chars_after'] for v in stat.values()))
    print('有数值被删的回答', len(lost)); [print('  ', x) for x in lost[:15]]
    import difflib
    neg = app = 0
    for k in keys:
        a, b = A[k], new[k]; cut = a.find('数据依据')
        for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
            if op == 'equal': continue
            if re.search(r'未超过|没有越限|未越限|未见越限|的日期没有|0 ?天', a[i1:i2]): neg += 1
            if cut >= 0 and i1 >= cut: app += 1
    print('删改了实测否定结论的处数', neg, '| 改到「数据依据」之后的处数', app)
