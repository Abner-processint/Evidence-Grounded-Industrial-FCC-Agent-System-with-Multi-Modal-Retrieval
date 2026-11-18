// EARLIER_TURN_CARDS_V3：每轮结束时由代码记一张卡（不经模型总结），供后续轮定义因子时沿用同一量的位号。
// 原料只取本轮的结构化结果：计算量实际用过的输入（量、位号、依据）、因子解析选中的位号、直接查历史库的位号；不记数值。
// 依据由计算步骤的代码写明，以「装置知识库」开头的记为来自知识库；一个因子测了几块表又没说明相加的，记 settled=false（只是候选，不作选表依据）。
// 证据里写明该位号的原句只在因子引用的证据编号能对上时附上。离线原型与试验台见 ctx_audit/（bench_cards_out_v3.json）。
function buildTurnCardV3(turnRef, question) {
  try {
    const epb = nodeJson('Evidence Packet Builder');
    const units = asArray(epb.completed_units).filter(u => u && typeof u === 'object');
    const rawOf = u => {
      const d = asObject(u.raw_result);
      return Object.keys(d).length ? d : asObject(asObject(u.normalized_result).raw_result);
    };
    const ev = {};
    for (const u of asArray(asObject(nodeJson('Coverage Gate').coverage_packet).evidence)) {
      for (const it of asArray(asObject(u).items)) if (it && it.ref) ev[String(it.ref)] = it;
    }
    const sortedKey = tags => tags.map(String).sort().join('|');
    const base = t => String(t).split('.')[0];
    const qs = [], der = [], seenName = new Set(), seenTags = new Set();
    const factorUnits = units.filter(u => /resolve_factors/i.test(asString(u.tool)));
    // 1) 计算量实际用过的输入
    for (const u of factorUnits) {
      for (const d of asArray(rawOf(u).derived_quantity_results)) {
        const name = asString(d.source_label) || asString(d.name);
        der.push({ name, status: asString(d.status) });
        const res = asObject(asArray(d.results)[0]);
        for (const inp of asArray(res.inputs)) {
          const tags = asArray(inp.tags).map(String).filter(Boolean);
          if (!tags.length || seenTags.has(sortedKey(tags))) continue; // 几个计算量共用同一输入只记一次
          const basis = asString(inp.basis);
          const q = { quantity: asString(inp.quantity), tags };
          if (tags.length > 1) q.combined_as = 'sum of ' + tags.map(base).join('+');
          q.how_chosen = basis || 'used_in_calculation';
          q.from_plant_knowledge_base = basis.startsWith('装置知识库');
          q.settled = true;
          q.used_in = name;
          qs.push(q); seenName.add(q.quantity); seenTags.add(sortedKey(tags));
        }
      }
    }
    // 2) 因子解析选中的位号
    for (const u of factorUnits) {
      for (const f of asArray(rawOf(u).factor_results)) {
        const fa = asObject(f.factor);
        const tags = asArray(f.tags).map(t => asString(asObject(t).tag)).filter(Boolean);
        const name = asString(fa.source_label) || asString(fa.name);
        if (!tags.length || seenName.has(name) || seenTags.has(sortedKey(tags))) continue;
        const doc = asArray(fa.documented_tags).map(base);
        const refs = asArray(fa.evidence_ids).map(String);
        const stated = tags.filter(t => doc.includes(base(t)));
        const ss = asArray(f.sum_series).filter(x => asArray(asObject(x).tags).length);
        const e = { quantity: name, tags, tag_descriptions: {} };
        for (const t of asArray(f.tags)) { const o = asObject(t); if (o.tag) e.tag_descriptions[o.tag] = asString(o.desc_en) || asString(o.what_it_measures); }
        e.how_chosen = stated.length && stated.length === tags.length ? 'stated_in_document' : 'picked_among_candidates';
        e.from_plant_knowledge_base = refs.some(r => /^K/i.test(r));
        if (ss.length) {
          e.combined_as = 'sum of ' + asArray(ss[0].tags).map(String).join('+');
          e.how_chosen = 'picked_on_DCS_screens: ' + asArray(f.dcs_alternatives).map(a => asString(asObject(a).basis)).join('; ');
        }
        e.settled = Boolean(tags.length === 1 || ss.length || (stated.length && stated.length === tags.length));
        if (stated.length) {
          for (const r of refs) {
            const txt = asString(asObject(ev[r]).text); const k = txt.indexOf(base(stated[0]));
            if (k >= 0) { e.source_statement = { doc: asString(asObject(ev[r]).doc), quote: txt.slice(Math.max(0, k - 70), k + base(stated[0]).length + 70) }; break; }
          }
        }
        const same = qs.find(q => sortedKey(q.tags) === sortedKey(tags) && (q.combined_as || null) === (e.combined_as || null));
        if (same) { if (e.quantity && e.quantity !== same.quantity && !asArray(same.also_called).includes(e.quantity)) same.also_called = asArray(same.also_called).concat(e.quantity); continue; }
        qs.push(e); seenName.add(name); seenTags.add(sortedKey(tags));
      }
    }
    // 3) 直接查历史库的位号（stats / read；探测数据有无的查询不算）
    const desc = {};
    for (const u of units) {
      if (!/find_tags/i.test(asString(u.tool))) continue;
      for (const t of asArray(rawOf(u).tags)) { const o = asObject(t); if (o.tag) desc[o.tag] = asString(o.desc_en) || asString(o.desc_cn); }
    }
    let statsRange = null;
    for (const u of units) {
      if (!/(^|_)(stats|read)$/i.test(asString(u.tool)) || asString(u.execution_status) !== 'SUCCESS') continue;
      const p = asObject(u.params), rr = rawOf(u);
      if (p.presence_probe === true || rr.presence_probe === true || p.full_available_range === true || asArray(p.date_range).length !== 2) continue;
      const got = (asArray(rr.returned_columns).length ? asArray(rr.returned_columns) : asArray(rr.non_null_columns)).map(String);
      if (!got.length) continue;
      if (!statsRange) statsRange = asArray(p.date_range).map(String);
      for (const c of asArray(p.columns).map(String)) {
        if (!got.includes(c) || seenTags.has(c)) continue;
        qs.push({ quantity: desc[c] || c, tags: [c], how_chosen: 'direct_historian_query', from_plant_knowledge_base: false, settled: true });
        seenTags.add(c);
      }
    }
    for (const d of asArray(asObject(nodeJson('Compute Derived Quantities')).derived_not_computed)) {
      const o = asObject(d); const name = asString(o.name) || asString(o.label);
      if (name && !der.some(x => x.name === name)) der.push({ name, status: asString(o.status) || 'not_computed' });
    }
    const pfr = nodeJson('Prepare Factor Resolution');
    let period = asArray(pfr.factor_resolution_date_range).length === 2 ? asArray(pfr.factor_resolution_date_range).map(String) : null;
    let periodSource = period ? (asString(pfr.factor_resolution_period_source) || 'question') : null;
    if (!period) {
      const fu = factorUnits.find(u => asArray(asObject(u.params).date_range).length === 2);
      if (fu) { period = asArray(asObject(fu.params).date_range).map(String); periodSource = 'factor_resolution'; }
      else if (statsRange) { period = statsRange; periodSource = 'historian_query'; }
    }
    if (!qs.length && !der.length) return null;
    const card = { turn_ref: asString(turnRef), question: asString(question).slice(0, 200), period_used: period, period_source: periodSource, quantities: qs.slice(0, 10) };
    if (der.length) card.derived_quantities = der.slice(0, 6);
    return card;
  } catch (e) {
    return null;
  }
}
