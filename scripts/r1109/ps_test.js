const fs = require('fs');
eval(fs.readFileSync(__dirname + '/ps_lib.js', 'utf8').replace(/^async function __psSeries/m, 'globalThis.__psSeries = async function').replace(/^function (__ps\w+)/gm, 'globalThis.$1 = function $1'));
globalThis.$ = () => ({ first: () => ({ json: { run_params: { mongodb: { rest_base_url: 'http://x:9000' }, arcticdb: { default_target: { library: 'eFCC', symbol: 'xitaiFCCphd' } } } } }) });
let calls = 0;
const helpers = { httpRequest: async ({ body }) => {
  calls++;
  const [a, b] = body.date_range.map(s => Date.parse(s.replace(' ', 'T') + 'Z'));
  const recs = [];
  for (let t = a; t <= b; t += 60000) {
    const r = { time: new Date(t).toISOString().slice(0, 19).replace('T', ' ') + '+00:00' };
    for (const c of body.columns) r[c] = (c === 'B' && t % 3600000 === 0) ? null : 10 + Math.sin(t / 1e7) + (c === 'B' ? 5 : 0);
    recs.push(r);
  }
  if (recs.length > 5000) throw new Error('413');
  return { data: '', records: recs };
} };
(async () => {
  const ser = await __psSeries(helpers, ['A', 'B'], ['2025-03-01 00:00:00', '2025-03-31 23:59:59']);
  console.log('calls', calls, 'times', ser.times.length, 'dt', ser.dtMs, ser.resolution, ser.error);
  const st = __psStats(ser, r => r && typeof r.A === 'number' && typeof r.B === 'number' ? r.A + r.B : NaN, 't/h', null);
  console.log(st); console.log(__psText(st));
  const st2 = __psStats(ser, r => r && typeof r.A === 'number' && typeof r.B === 'number' ? r.A / r.B * 100 : NaN, '%', [0, 60]);
  console.log(__psText(st2));
  const ser2 = await __psSeries(helpers, ['A'], ['2025-01-01 00:00:00', '2025-07-31 23:59:59']);
  console.log('hourly?', ser2.error || ser2.resolution, ser2.windows);
})();
