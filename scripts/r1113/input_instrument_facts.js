// INPUT_INSTRUMENT_FACTS_V1：计算量的实测输入在定义里写明了位号（documented_tags）时，由代码去装置模型取该仪表的数据
// （取压口标高、跨距等），并入 engineering_facts，不再靠定义因子一步的模型决定查不查。
// 起因：11-11 测试副本上模型少查 DR3110 仪表 → 稀相压降算不出（主线 2/2 对、副本 0/6）。
// 已有该位号事实的不再查；最多 4 个，并行，每个 12 秒；失败只记在 input_instrument_facts 里，不影响后续。
// 取回的数值格式与 Coverage Retry 的 PLANT_GAP_LOOKUP_V1 相同（retrieval_tool 记 plant_equipment，才能被 pmNormalizeFacts 收下）。
let engineeringFacts = pmCurrentFacts(j.engineering_facts);
const __insTrace = [];
try {
  const __have = new Set(engineeringFacts.map(f => pmStr(f.equipment_tag).toUpperCase()));
  const __tags = [...new Set(pmArr(params.factors).flatMap(f => pmArr(pmObj(f).documented_tags))
    .map(t => String(t == null ? '' : t).trim().toUpperCase().replace(/\.PV$/, '')))]
    .filter(t => /^[A-Z][A-Z0-9_]{1,20}$/.test(t) && !__have.has(t)).slice(0, 4);
  if (__tags.length) {
    const __http = __insHelper.helpers.httpRequest.bind(__insHelper.helpers);
    const __url = 'http://<HOST>:9390/mcp';
    const __post = (payload, sid) => __http({ method: 'POST', url: __url, json: false, returnFullResponse: true, timeout: 12000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sid ? { 'Mcp-Session-Id': sid } : {}) },
      body: JSON.stringify(payload) });
    const __unpack = body => {
      if (body && typeof body === 'object') return body;
      const t = String(body || '');
      try { return JSON.parse(t); } catch (e) {}
      for (const line of t.split('\n')) { if (!line.startsWith('data:')) continue; try { const x = JSON.parse(line.slice(5).trim()); if (x.id != null) return x; } catch (e) {} }
      return {};
    };
    const __parse = t => { try { return JSON.parse(t); } catch (e) { return {}; } };
    const __walk = (tag, obj, path, out) => {
      if (!obj || typeof obj !== 'object' || Array.isArray(obj) || out.length >= 16) return;
      if (Object.prototype.hasOwnProperty.call(obj, 'value') && typeof obj.value === 'number' && Number.isFinite(obj.value) && pmStr(obj.unit)) {
        if (!path || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*$/.test(path)) return;
        out.push({ equipment_tag: tag, field_path: path, value: obj.value, unit: pmStr(obj.unit), status: pmStr(obj.status), retrieval_tool: 'plant_equipment', found: true,
          source: pmStr(obj.source), locator: pmStr(obj.locator), note: pmStr(obj.note).slice(0, 300), grade: obj.grade ?? null,
          ...(Object.prototype.hasOwnProperty.call(obj, 'derivation') ? { derivation: obj.derivation, inputs: pmArr(obj.inputs) } : {}) });
        return;
      }
      for (const [k, v] of Object.entries(obj)) if (v && typeof v === 'object' && !Array.isArray(v)) __walk(tag, v, path ? path + '.' + k : k, out);
    };
    let sid = '';
    const init = await __post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fcc-input-instrument-facts', version: '1' } } });
    const h = pmObj(init && init.headers);
    sid = pmStr(h['mcp-session-id'] || h['Mcp-Session-Id']);
    await __post({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
    const got = await Promise.all(__tags.map(async (tag, i) => {
      try {
        const res = await __post({ jsonrpc: '2.0', id: 10 + i, method: 'tools/call', params: { name: 'plant_instruments', arguments: { tag } } }, sid);
        const rpc = __unpack(pmObj(res).body);
        const b = __parse(pmStr(pmObj(pmArr(pmObj(rpc.result).content)[0]).text));
        const ins = pmObj(pmObj(b).instrument), out = [];
        __walk(pmStr(ins.tag) || tag, ins, '', out);
        __insTrace.push({ tag, status: pmStr(pmObj(b).status) || null, facts: out.length });
        return out;
      } catch (e) { __insTrace.push({ tag, error: String(e && e.message || e).slice(0, 160) }); return []; }
    }));
    const __new = got.flat();
    if (__new.length) engineeringFacts = pmCurrentFacts([...pmArr(j.engineering_facts), ...__new]);
  }
} catch (e) { __insTrace.push({ error: String(e && e.message || e).slice(0, 160) }); }
