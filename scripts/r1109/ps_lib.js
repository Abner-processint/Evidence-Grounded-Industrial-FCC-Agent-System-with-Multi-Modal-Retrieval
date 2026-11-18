// POINT_SERIES_STATS_V1：逐点读数后由代码对齐时刻，算合计量 / 计算量自己的最小、最大、最新与累计。
// 来由：191811、191919 三表合计的最小、最大写「未检索到」，194687 说没有累计量——时段统计只有各表各自的值，
// 合计与计算量的极值、累计要逐点相加或代入才有，以前没有这一步。历史库 /read 一次最多约 5000 行（7 天逐分钟报 413），
// 按 2 天一段分段读（每段约 0.3 秒，4 段并行）；时段超过 120 天改读小时均值，结果里写明分辨率。
async function __psSeries(helpers, cols, dateRange) {
  const ao = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  let rp = {};
  try { const wc = $('Workflow Configuration').first().json || {}; rp = typeof wc.run_params === 'string' ? JSON.parse(wc.run_params) : (wc.run_params || {}); } catch (e) {}
  const restBase = String(ao(rp.mongodb).rest_base_url || '').replace(/\/+$/, '');
  if (!restBase) return { error: 'no rest_base_url' };
  const tgt = ao(ao(rp.arcticdb).default_target);
  const db = tgt.library || tgt.database || 'eFCC', coll = tgt.symbol || tgt.collection || 'xitaiFCCphd';
  const P = s => Date.parse(String(s).trim().replace(' ', 'T').slice(0, 19) + 'Z');
  const F = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const a = P(dateRange[0]), b = P(dateRange[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return { error: 'bad date_range' };
  const hourly = (b - a) > 120 * 86400000;
  const step = hourly ? 160 * 86400000 : 2 * 86400000;
  const windows = [];
  for (let s = a; s <= b; s += step) windows.push([F(s), F(Math.min(s + step - 1000, b))]);
  if (windows.length > 80) return { error: 'too many windows' };
  const bodyOf = w => ({ database: db, collection: coll, columns: cols, date_range: w,
    ...(hourly ? { resample: { rule: '1h', agg: Object.fromEntries(cols.map(c => [c, 'mean'])) } } : {}) });
  const rows = new Map();
  let err = '';
  for (let i = 0; i < windows.length && !err; i += 4) {
    const part = await Promise.all(windows.slice(i, i + 4).map(w =>
      helpers.httpRequest({ method: 'POST', url: restBase + '/read', json: true, timeout: 30000, body: bodyOf(w) })
        .then(r => Array.isArray(ao(r).records) ? r.records : null).catch(e => { err = String(e && e.message || e).slice(0, 160); return null; })));
    for (const recs of part) {
      if (!recs) { if (!err) err = 'no records'; continue; }
      for (const rec of recs) {
        const t = String(rec.time || rec.timestamp || rec.index || '').slice(0, 19);
        if (t) rows.set(t, rec);
      }
    }
  }
  if (err) return { error: err };
  const times = Array.from(rows.keys()).sort();
  const gaps = [];
  for (let i = 1; i < times.length && gaps.length < 2000; i++) gaps.push(P(times[i]) - P(times[i - 1]));
  gaps.sort((x, y) => x - y);
  const dtMs = gaps.length ? gaps[Math.floor(gaps.length / 2)] : (hourly ? 3600000 : 60000);
  return { times, rows, dtMs, resolution: hourly ? '小时均值' : (dtMs === 60000 ? '逐分钟' : '每 ' + Math.round(dtMs / 1000) + ' 秒'), windows: windows.length };
}
// 单位是「…/h、/d、/min」的速率量，逐点值 × 采样间隔累加为全时段累计（只计有数的时刻）
function __psRateUnit(unit) {
  const m = String(unit || '').trim().match(/^(.+?)\s*\/\s*(h|hr|hour|d|day|min)$/i);
  if (!m) return null;
  const per = /^d/i.test(m[2]) ? 86400000 : /^min/i.test(m[2]) ? 60000 : 3600000;
  return { base: m[1].trim(), perMs: per };
}
// fn(rec) 给出该时刻的值（任一输入缺失时返回 NaN）；bounds 给出时，超出的逐点值不计入并计数
function __psStats(series, fn, unit, bounds) {
  let n = 0, s = 0, s2 = 0, mn = Infinity, mx = -Infinity, mnT = '', mxT = '', last = NaN, lastT = '', miss = 0, out = 0;
  for (const t of series.times) {
    const v = fn(series.rows.get(t));
    if (!Number.isFinite(v)) { miss++; continue; }
    if (Array.isArray(bounds) && bounds.length === 2 && (v < bounds[0] || v > bounds[1])) { out++; continue; }
    n++; s += v; s2 += v * v;
    if (v < mn) { mn = v; mnT = t; }
    if (v > mx) { mx = v; mxT = t; }
    last = v; lastT = t;
  }
  if (!n) return null;
  const r4 = v => Number(Math.abs(v) >= 100 ? v.toFixed(2) : v.toPrecision(4));
  const res = { resolution: series.resolution, points: n, missing_points: miss, out_of_bounds_points: out || undefined,
    mean: r4(s / n), std: r4(Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n)))), min: r4(mn), min_time: mnT, max: r4(mx), max_time: mxT, latest: r4(last), latest_time: lastT };
  const ru = __psRateUnit(unit);
  if (ru) { res.cumulative = r4(s * series.dtMs / ru.perMs); res.cumulative_unit = ru.base; }
  return res;
}
function __psText(st) {
  if (!st) return '';
  return '按' + st.resolution + '读数逐点算（' + st.points + ' 个时刻' + (st.missing_points ? '，另有 ' + st.missing_points + ' 个时刻输入不全未计' : '') +
    (st.out_of_bounds_points ? '，' + st.out_of_bounds_points + ' 个时刻超出定义范围未计' : '') + '）：最小 ' + st.min + '（' + st.min_time + '）、最大 ' + st.max + '（' + st.max_time + '）、最新 ' + st.latest + '（' + st.latest_time + '）、逐点均值 ' + st.mean + '、标准差 ' + st.std +
    (st.cumulative != null ? '、全时段累计 ' + st.cumulative + ' ' + st.cumulative_unit + '（只计有数的时刻）' : '');
}
