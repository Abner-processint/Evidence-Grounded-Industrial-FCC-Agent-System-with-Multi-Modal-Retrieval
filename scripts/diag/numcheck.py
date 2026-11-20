# -*- coding: utf-8 -*-
"""诊断实验后续（11-20 用户「时间并不是测试重点」→ 转去改写法）：换写法前，先逐条核对简单写法回答里的数值与位号有没有出处。
简单写法（runs_wfev / runs_both / runs_oracle）没经过工作流的核对与守卫；这里查它的分数是不是靠编数换来的。
证据编号与当时重答一致：wfev=[wf_ev]，oracle=[oracle_ev]，both=wf_ev+oracle_ev，从 [1] 起；提示词里资料截到 30000 字。
阶段：match（代码比对：数值是否出现在所引条目 / 其它条目 / 都没有）→ judge（对不上的交 DeepSeek 试验台分类）→ report。
用法：python numcheck.py <阶段>"""
import json, io, os, re, sys, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, '..', 'accept'))
J = lambda p: json.load(io.open(os.path.join(HERE, p), encoding='utf-8'))
W = lambda p, o: json.dump(o, io.open(os.path.join(HERE, p), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
WF, OR = J('wf_ev.json'), J('oracle_ev.json')
ARMS = {'wfev': lambda q: WF[q], 'oracle': lambda q: OR[q], 'both': lambda q: WF[q] + OR[q]}


def shown(ev):
    """模型实际看到的条目：按当时格式拼接后截 30000 字，之后的条目看不到。"""
    out, n = [], 0
    for i, c in enumerate(ev):
        line = '[%d]（%s）：%s' % (i + 1, c['doc'], c['content'].replace('\n', ' '))
        if n + len(line) > 30000: break
        out.append('（%s）%s' % (c['doc'], c['content'])); n += len(line) + 1  # 文件名里的年月也算出处
    return out


NUM = re.compile(r'(?<![\[\dA-Za-z.／/])(\d+(?:\.\d+)?)(?![\d\]])')
TAG = re.compile(r'(?<![A-Za-z])([A-Z]{1,5}\d{3,5}[A-Z]?)(?![\dA-Za-z])')
UNIT = re.compile(r'^\s*(%|℃|°C|t/h|t|kPa|MPa|mg|g/|kg|m/s|m3|Nm|ppm|万|吨|小时|h\b|min|分钟|元|倍|wt|v%)')


def fnums(text):
    s = set()
    for m in re.finditer(r'\d+(?:\.\d+)?', text):
        try: s.add(float(m.group(0)))
        except ValueError: pass
    return s


def sentences(ans):
    # 以句号 / 分号 / 换行切句，引用号随句
    for part in re.split(r'(?<=[。；;\n])', ans):
        if part.strip(): yield part


stage = sys.argv[1]
if stage == 'match':
    rows = []
    for arm, f in ARMS.items():
        for fn in sorted(os.listdir(os.path.join(HERE, 'runs_' + arm))):
            q = fn.split('_')[0]; ans = J(os.path.join('runs_' + arm, fn))['answer']
            ev = shown(f(q)); evn = [fnums(c) for c in ev]; evt = [c.upper() for c in ev]
            for sent in sentences(ans):
                sent = re.sub(r'[［【〔](\d+)[］】〕]', r'[\1]', sent)  # 全角引用号与半角同等对待
                cites = [int(x) - 1 for x in re.findall(r'\[(\d+)\]', sent)]
                body = re.sub(r'\[\d+\]', '', sent)
                body_nolist = re.sub(r'^\s*(#+\s*|\d+[.、)]\s*|[-*]\s*)', '', body)
                for m in NUM.finditer(body_nolist):
                    tok = m.group(1); v = float(tok); after = body_nolist[m.end():m.end() + 6]
                    if '.' not in tok and v < 10 and not UNIT.match(after): continue  # 序号、小整数不查
                    if re.match(r'^\s*(年|月|日)', after) and '.' not in tok: kind = 'date'
                    else: kind = 'num'
                    inc = [i for i in cites if 0 <= i < len(ev) and v in evn[i]]
                    oth = [i for i in range(len(ev)) if v in evn[i]]
                    st = 'cited' if inc else ('other' if oth else 'none')
                    rows.append({'arm': arm, 'q': q, 'kind': kind, 'tok': tok + after[:4].strip(), 'st': st, 'cites': [i + 1 for i in cites],
                                 'other': [i + 1 for i in oth[:4]], 'sent': body.strip()[:300]})
                for m in TAG.finditer(body):
                    t = m.group(1)
                    inc = [i for i in cites if 0 <= i < len(ev) and t in evt[i]]
                    oth = [i for i in range(len(ev)) if t in evt[i]]
                    rows.append({'arm': arm, 'q': q, 'kind': 'tag', 'tok': t, 'st': 'cited' if inc else ('other' if oth else 'none'),
                                 'cites': [i + 1 for i in cites], 'other': [i + 1 for i in oth[:4]], 'sent': body.strip()[:300]})
    W('numcheck_rows.json', rows)
    c = collections.Counter((r['arm'], r['kind'], r['st']) for r in rows)
    for arm in ARMS:
        for kind in ['num', 'tag', 'date']:
            tot = sum(c[(arm, kind, s)] for s in ['cited', 'other', 'none'])
            print(arm, kind, tot, {s: c[(arm, kind, s)] for s in ['cited', 'other', 'none']})

JSYS = ('你在核对一份催化裂化（FCC）问题回答里的一个数值或位号是否有出处。给你：回答里含该数的句子、该句引用的资料原文、以及全部资料里数值相近的几条。'
        '按下列之一分类，只输出 JSON {"cls":"…","why":"一句话"}：\n'
        'same：资料里有同一事实，只是写法不同（单位换算、四舍五入、全角半角、范围写法、百分比与小数）；\n'
        'calc：由资料里的数直接算出（差值、和、比值、平均），且算得对；\n'
        'calc_wrong：想由资料里的数算出，但算错了；\n'
        'general：通用的教材 / 行业常识数值（如典型操作范围、通用经验关系），不是在说本装置的数据、位号或限值；\n'
        'misread：资料里有相关数，但回答把数、单位、时段、位号或对象张冠李戴了；\n'
        'invented：在说本装置的数据、位号、限值或历史，但资料里找不到依据。\n'
        '只看给出的资料，不用你自己的装置知识替回答补出处。')

if stage == 'judge':
    S = __import__('score')
    rows = J('numcheck_rows.json'); todo = [i for i, r in enumerate(rows) if r['st'] != 'cited' and r['kind'] != 'date']
    items = []
    for i in todo:
        r = rows[i]; ev = shown(ARMS[r['arm']](r['q']))
        cited = '\n'.join('[%d] %s' % (k, ev[k - 1][:700]) for k in r['cites'] if 0 < k <= len(ev)) or '（该句没有引用）'
        oth = '\n'.join('[%d] %s' % (k, ev[k - 1][:700]) for k in r['other'] if k not in r['cites']) or '（其它资料里没有同一数值）'
        items.append({'system': JSYS, 'user': '要核对的：%s\n\n回答原句：%s\n\n该句引用的资料：\n%s\n\n其它含同一数值的资料：\n%s' % (r['tok'], r['sent'], cited, oth)})
    outs = S.bench(items)
    for i, o in zip(todo, outs):
        rows[i]['judge'] = S.pj(o or '') or {'cls': 'err', 'why': (o or '')[:100]}
    W('numcheck_rows.json', rows); print('judged', len(todo))

if stage == 'report':
    rows = J('numcheck_rows.json')
    for arm in ARMS:
        R = [r for r in rows if r['arm'] == arm and r['kind'] != 'date']
        c = collections.Counter(r['st'] if r['st'] == 'cited' else 'j:' + (r.get('judge') or {}).get('cls', '?') for r in R)
        print(arm, len(R), dict(c.most_common()))
