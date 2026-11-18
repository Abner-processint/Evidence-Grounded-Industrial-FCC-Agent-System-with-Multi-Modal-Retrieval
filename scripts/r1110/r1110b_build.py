# -*- coding: utf-8 -*-
r"""r1110b：POINT_LEVEL_EXCEEDANCE_V1（Evidence Packet Builder）。
越限扫描（EXCEEDANCE_EPISODES_V7）最严重那天原来只定位到 5min 段（首次 / 末次是段起点，时长按段计）；
用户 11-10：「三个月的数据分析细化到五分钟，现在需要对于五分钟继续细化到时间点」。
改为：最严重那天再读整天逐分钟原始读数（/read 一天 1440 行约 0.2 秒），由代码定出首次、末次越过的分钟、极值及时刻、越限总分钟数，
以及各连续越限段的起止（最多列 5 段）。读不到或时间预算不够时保留原 5min 结果并照旧标明分段。
用法：python r1110b_build.py <in_nodes.json> <out_nodes.json>（in 为 r1110a 的输出）"""
import json, sys, io
d = json.load(io.open(sys.argv[1], encoding='utf-8'))
N = {n['name']: n for n in d['nodes']}


def rep(code, old, new, name):
    assert code.count(old) == 1, (name, code.count(old), old[:80])
    return code.replace(old, new)


n = N['Evidence Packet Builder']; c = n['parameters']['jsCode']
assert 'POINT_LEVEL_EXCEEDANCE_V1' not in c
anchor = "        top_days: top5.map(x => ({ day: naive(x.t).slice(0, 10), value: edge(x) })), frozen_days: frozenHit.length };\n"
block = anchor + r"""      // POINT_LEVEL_EXCEEDANCE_V1：最严重那天读整天逐分钟原始读数，定到时间点（用户 11-10：5 分钟段继续细化到时间点）。
      // 读不到或时间预算不够时保留上面的 5min 段结果。
      try {
        const leftMs = __epbDeadline - Date.now();
        if (leftMs > 4000) {
          const iso = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
          const rr = await __epbCtx.helpers.httpRequest({ method: 'POST', url: restBase + '/read', json: true, timeout: Math.min(15000, leftMs - 1000),
            body: { database: tgt.database, collection: tgt.collection, columns: [row.column], date_range: [iso(worst.t), iso(worst.end - 1000)] } });
          const pts = asArray(asObject(rr).records).map(r0 => ({ t: __pt(String(asObject(r0).time || asObject(r0).timestamp || '').slice(0, 19)), v: Number(asObject(r0)[row.column]) }))
            .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v) && inRange(p.v)).sort((a, b) => a.t - b.t);
          if (pts.length > 1) {
            const gaps = pts.slice(1).map((p, i) => p.t - pts[i].t).sort((a, b) => a - b);
            const dt = gaps[Math.floor(gaps.length / 2)] || 60000;
            const hitP = p => (sideName === 'above' ? p.v > value : p.v < value);
            const hits = pts.filter(hitP);
            if (hits.length) {
              const runs = [];
              for (const p of hits) {
                const cur = runs[runs.length - 1];
                if (cur && p.t - cur.last <= 1.5 * dt) { cur.last = p.t; cur.n++; if (sideName === 'above' ? p.v > cur.ext : p.v < cur.ext) { cur.ext = p.v; cur.extT = p.t; } }
                else runs.push({ first: p.t, last: p.t, n: 1, ext: p.v, extT: p.t });
              }
              const ex = hits.reduce((m, p) => (sideName === 'above' ? (p.v > m.v ? p : m) : (p.v < m.v ? p : m)));
              Object.assign(ep, { point_level: true, first_crossing: naive(hits[0].t), last_crossing: naive(hits[hits.length - 1].t),
                extreme_value: ex.v, extreme_time: naive(ex.t), crossing_minutes_in_worst_day: Math.round(hits.length * dt / 60000),
                duration_basis_minutes: dt / 60000, fine_minutes: dt / 60000, point_samples: pts.length,
                runs: runs.slice().sort((a, b) => b.n - a.n).slice(0, 5).sort((a, b) => a.first - b.first)
                  .map(r1 => ({ start: naive(r1.first), end: naive(r1.last), minutes: Math.round(r1.n * dt / 60000), extreme_value: r1.ext, extreme_time: naive(r1.extT) })),
                run_count: runs.length });
            }
          }
        }
      } catch (e) { ep.point_level_error = String(e && e.message || e).slice(0, 120); }
"""
c = rep(c, anchor, block, 'EPB_INSERT')
old = ("          '，当日首次越过 ' + ep.first_crossing + '、末次 ' + ep.last_crossing + '（UTC，' + ep.fine_minutes + 'min 段起点），越限累计约 ' +\n"
       "          (ep.crossing_minutes_in_worst_day >= 120 ? Math.round(ep.crossing_minutes_in_worst_day / 6) / 10 + ' 小时' : ep.crossing_minutes_in_worst_day + ' 分钟') + '（按 ' + ep.duration_basis_minutes + 'min 分段计）' : ''));")
new = ("          '，当日首次越过 ' + ep.first_crossing + '、末次 ' + ep.last_crossing + (ep.point_level ? '（UTC，逐分钟读数的时间点），越限共 ' : '（UTC，' + ep.fine_minutes + 'min 段起点），越限累计约 ') +\n"
       "          (ep.crossing_minutes_in_worst_day >= 120 ? Math.round(ep.crossing_minutes_in_worst_day / 6) / 10 + ' 小时' : ep.crossing_minutes_in_worst_day + ' 分钟') +\n"
       "          (ep.point_level ? '（按逐分钟读数计，' + ep.point_samples + ' 个读数）' + (ep.run_count > 1 ? '，分 ' + ep.run_count + ' 段' + (ep.run_count > ep.runs.length ? '（列最长 ' + ep.runs.length + ' 段）' : '') + '：' +\n"
       "            ep.runs.map(r1 => r1.start.slice(11) + '–' + r1.end.slice(11) + '（' + r1.minutes + ' 分钟，' + (sideName === 'above' ? '最高 ' : '最低 ') + r1.extreme_value + ' @ ' + r1.extreme_time.slice(11) + '）').join('、') : '')\n"
       "            : '（按 ' + ep.duration_basis_minutes + 'min 分段计）') : ''));")
c = rep(c, old, new, 'EPB_TEXT')
n['parameters']['jsCode'] = c
d['changed'] = sorted(set(d['changed']) | {'Evidence Packet Builder'})
json.dump(d, io.open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print('ok', d['changed'])
