# -*- coding: utf-8 -*-
r"""r1110c：
① MONTH_RANGE_PERIOD_V1（Prepare Factor Resolution）：「2025年1月至3月」「2025年1-3月」按整段月份取数。原先只认「YYYY年M月」，
   副本 196018「2025年1月至3月分馏塔底温度」只取了 1 月，回答说 2、3 月没覆盖。
② POINT_LEVEL_EXCEEDANCE_V1 补：极值按 4 位小数写（原来写成 343.478202819824）。
用法：python r1110c_build.py <in_nodes.json（r1110b 输出）> <out_nodes.json>"""
import json, sys, io
d = json.load(io.open(sys.argv[1], encoding='utf-8'))
N = {n['name']: n for n in d['nodes']}


def rep(code, old, new, name):
    assert code.count(old) == 1, (name, code.count(old), old[:80])
    return code.replace(old, new)


n = N['Prepare Factor Resolution']; c = n['parameters']['jsCode']
anchor = "  // DOCUMENT_PERIOD_RELATION_V7：问句含多个「YYYY年M月」时取最早到最晚的整月区间"
block = r"""  // MONTH_RANGE_PERIOD_V1：「2025年1月至3月」「2025年1-3月」「2025年11月到2026年2月」按整段月份取数（原先只认到第一个「YYYY年M月」，196018 只取了 1 月）
  const cnMonthRange = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月?\s*(?:至|到|~|-|—|–)\s*(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月/);
  if (cnMonthRange) {
    const sy = Number(cnMonthRange[1]), sm = Number(cnMonthRange[2]);
    const ey = Number(cnMonthRange[3] || cnMonthRange[1]), em = Number(cnMonthRange[4]);
    if (sm >= 1 && sm <= 12 && em >= 1 && em <= 12 && ey * 12 + em >= sy * 12 + sm) {
      const pad = n => String(n).padStart(2, '0');
      const last = String(new Date(Date.UTC(ey, em, 0)).getUTCDate()).padStart(2, '0');
      return [`${sy}-${pad(sm)}-01 00:00:00`, `${ey}-${pad(em)}-${last} 23:59:59`];
    }
  }

"""
c = rep(c, anchor, block + anchor, 'PFR')
n['parameters']['jsCode'] = c

n = N['Evidence Packet Builder']; c = n['parameters']['jsCode']
c = rep(c, "                extreme_value: ex.v, extreme_time: naive(ex.t),", "                extreme_value: Number(ex.v.toFixed(4)), extreme_time: naive(ex.t),", 'EPB1')
c = rep(c, ".map(r1 => ({ start: naive(r1.first), end: naive(r1.last), minutes: Math.round(r1.n * dt / 60000), extreme_value: r1.ext,",
        ".map(r1 => ({ start: naive(r1.first), end: naive(r1.last), minutes: Math.round(r1.n * dt / 60000), extreme_value: Number(r1.ext.toFixed(4)),", 'EPB2')
n['parameters']['jsCode'] = c
d['changed'] = sorted(set(d['changed']) | {'Prepare Factor Resolution', 'Evidence Packet Builder'})
json.dump(d, io.open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print('ok', d['changed'])
