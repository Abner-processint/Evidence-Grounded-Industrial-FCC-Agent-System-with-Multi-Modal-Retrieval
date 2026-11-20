# -*- coding: utf-8 -*-
"""REGULATION_LIMITS_TABLE_V1：规程 / 工艺卡片控制指标结构化表 → 运行时挑选与入包的三个节点（构建脚本与离线试验共用）。
数据来源：records_raw.json（extract.py 抽取并经代码核对引句与数值）。"""
import json, io, os, re, collections
HERE = os.path.dirname(os.path.abspath(__file__))


def short_doc(d):
    return re.sub(r'\.(docx?|pdf)$', '', d).replace('催化裂化装置', '')


def build_data():
    R = json.load(io.open(os.path.join(HERE, 'records_raw.json'), encoding='utf-8'))
    seen = set(); groups = collections.OrderedDict()
    for r in R:
        k = (r['tag'], r['name'], r['kind'], r['low'], r['high'], r['unit'], r['condition'], r['doc'])
        if k in seen: continue
        seen.add(k)
        key = r['tag'] or re.sub(r'\s+', '', r['name'])
        if not key: continue
        g = groups.setdefault(key, {'key': key, 'tag': r['tag'], 'names': [], 'recs': []})
        if r['name'] and r['name'] not in g['names']: g['names'].append(r['name'])
        g['recs'].append([r['kind'], r['low'], r['high'], r['unit'], r['condition'][:40], r['quote'][:90], short_doc(r['doc']),
                          (r['pages'][0] if r['pages'] else None)])
    data = list(groups.values())
    catalog = [(g['key'] + ' ' + '、'.join(g['names'][:2])).strip()[:40] for g in data]
    return data, catalog


PICK_SYS = '''你在为催化裂化装置问答挑选需要引用的本装置控制指标。输入是用户问题和本装置参数目录（每行：位号或参数名 + 参数名称）。
从目录里挑出回答这个问题时应当给出其控制指标、工艺卡片指标、报警或联锁值、操作限制的参数，最多 8 个，按相关程度排序。
- 问题涉及操作调整、工况判断、异常处置、机理对本装置的影响、风险、限值时才挑；只问某个量的数值、统计值或位号是什么的问题，返回空。
- 只挑目录里有的条目，原样写出该行开头的位号或参数名（第一个空格之前的部分）。
只输出 JSON：{"keys":["TRCA3101","提降量速度"]}'''

PREP_TMPL = r'''// REGULATION_LIMITS_TABLE_V1（11-19 用户「做规程指标表」）：本装置控制指标结构化表（操作规程上下册、三级工艺卡片、提降量操作提纲，
// 离线经 DeepSeek 逐段抽取、代码核对原文引句与数值，共 __N__ 条、__K__ 个参数）。本节点给挑选模型组输入：用户问题 + 参数目录（只给位号与名称）。
// 挑选与入包在 Apply Regulation Pick、Evidence Packet Builder；挑不出或失败时不影响其他流程。
const CATALOG = __CATALOG__;
const cap = $input.first().json || {};
let q = String(cap.originalUserMessage || cap.chatInput || '');
try { const st = typeof cap.conversation_state === 'string' ? JSON.parse(cap.conversation_state || '{}') : (cap.conversation_state || {}); if (st.latest_resolved_question) q += '\n（前文已确认的完整问句：' + String(st.latest_resolved_question).slice(0, 300) + '）'; } catch (e) {}
return [{ json: { reg_pick_user: '用户问题：' + q + '\n\n本装置参数目录：\n' + CATALOG.join('\n') } }];
'''

APPLY_TMPL = r'''// REGULATION_LIMITS_TABLE_V1：按挑选模型给出的参数，取出结构化表里这些参数的全部指标记录，组成证据条目（同一参数按文档各一条），
// 交给 Evidence Packet Builder 在席位之外追加（至多 8 条）。模型失败或挑不出时输出空。
const DATA = __DATA__;
const byKey = new Map(DATA.map(g => [g.key, g]));
let raw = '';
try { const j = $input.first().json || {}; raw = String(j.output || j.text || ''); } catch (e) {}
let keys = [];
try { const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); const o = JSON.parse(raw.slice(a, b + 1)); keys = Array.isArray(o.keys) ? o.keys.map(x => String(x || '').trim()) : []; } catch (e) {}
const fmtVal = (lo, hi, u) => (lo && hi ? lo + '～' + hi : hi ? '≤' + hi : lo ? '≥' + lo : '') + (u ? ' ' + u : '');
const entries = [];
for (const k of keys.slice(0, 8)) {
  const g = byKey.get(k) || byKey.get(k.toUpperCase()); if (!g) continue;
  const byDoc = new Map();
  for (const r of g.recs) { if (!byDoc.has(r[6])) byDoc.set(r[6], []); byDoc.get(r[6]).push(r); }
  for (const [doc, rs] of Array.from(byDoc.entries()).slice(0, 3)) {
    const title = (g.tag ? g.tag + ' ' : '') + g.names.slice(0, 2).join('、');
    const val = r => ((r[0] === '报警' || r[0] === '联锁') && !(r[1] && r[2]) ? (r[0] + '值 ' + (r[1] || r[2]) + (r[3] ? ' ' + r[3] : '')) : fmtVal(r[1], r[2], r[3]));
    const lines = rs.slice(0, 12).map(r => r[0] + '：' + val(r) + (r[4] ? '（' + r[4] + '）' : '') + '；原文：「' + r[5] + '」');
    const pages = rs.map(r => r[7]).filter(x => x != null);
    const text = '【本装置控制指标】' + title + '\n' + lines.join('\n');
    entries.push({ document_name: '催化裂化装置' + doc, dataset_name: '<厂名>催化裂化静态资料', section_title: title + ' 控制指标',
      page_start: pages.length ? Math.min(...pages) : null, page_end: pages.length ? Math.max(...pages) : null,
      content_summary: text, snippet: text, key_values: rs.slice(0, 12).map(r => title + ' ' + r[0] + ' ' + val(r)),
      relevance_to_question: '本装置操作规程 / 工艺卡片给出的该参数控制指标与限值（结构化表，数值已与原文核对）；同一参数有多个取值时并列给出、不择一。' + '规程原文里的位号写法可能与实时库位号不同（笔误或旧位号）：测点以实时库位号字典与本轮实际取数的位号为准；两者不一致时并列说明「规程原文写作 X」，不得因此把本轮实测位号改称代理或替代测点。',
      source_kind: 'regulation_limits', source_tier_override: 1, source_tier_label_override: '装置专属·文档（操作规程 / 工艺卡片指标）' });
  }
}
return [{ json: { reg_pick_keys: keys, reg_entries: entries.slice(0, 16) } }];
'''


def node_codes():
    data, catalog = build_data()
    n = sum(len(g['recs']) for g in data)
    prep = PREP_TMPL.replace('__N__', str(n)).replace('__K__', str(len(data))).replace('__CATALOG__', json.dumps(catalog, ensure_ascii=False))
    apply = APPLY_TMPL.replace('__DATA__', json.dumps(data, ensure_ascii=False))
    return prep, apply, data, catalog


if __name__ == '__main__':
    prep, apply, data, catalog = node_codes()
    print('参数', len(data), '记录', sum(len(g['recs']) for g in data), '目录字数', sum(len(c) for c in catalog), '入包节点代码字节', len(apply.encode('utf-8')))
