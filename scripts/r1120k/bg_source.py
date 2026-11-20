# -*- coding: utf-8 -*-
"""BACKGROUND_SOURCE_CITE_V1 三个节点的提示词与代码（构建脚本与离线试验共用同一份）。"""

RSYS = '''你是化工炼油领域的资料出处标注助手。输入是一份回答里没有资料引用的句子，每句前有编号（S1、S2……）。

任务：对其中陈述化工、炼油、催化裂化通识性知识（机理、规律、工艺原理、经验判断、通用公式与定义）的句子，说明这条知识在你的背景知识里出自哪本书或哪篇文献。

要求：
1. 只写你确信真实存在、并且确实讲到这条知识的书或文献。记不清出处的句子不要列出；不得编造书名、作者、出版社、年份或章节。
2. 书名写全称，不加书名号；作者写主编或作者；出版社（或期刊）、出版年有把握才写；章节有把握才写，没把握留空。
3. 每句最多两个出处。以下句子不要列：本装置的数据、位号、事件，对本装置情况的判断，提问复述，过渡句，总结句，建议下一步核查的句子。
4. confidence 只用 high 或 medium：high 表示确信这本书讲了这条知识；medium 表示确信书存在、较有把握讲到这条知识。把握更低的不要列。

只输出 JSON，不要任何说明：
{"items":[{"s":"S3","sources":[{"title":"","author":"","publisher":"","year":"","chapter":""}],"confidence":"high"}]}
没有可标注的句子时输出 {"items":[]}。'''

PREP_JS = r'''// BACKGROUND_SOURCE_CITE_V1（11-18 用户）：厂里离线千问 / DeepSeek 自带化工炼油背景通识资料，希望除 RAGFlow 资料外，把模型自带的背景资料也引用出来，写出哪本书、出处是什么。
// 用户确认这些资料只在模型参数里、没有原文文件，所以出处只能由模型自述、无法用原文核对，回答里明确这样标注。
// 做法：成稿定下之后、存会话之前，代码把正文里没有 [E#] 引用的句子编号交给模型；模型给出各句知识点的出处（书名 / 作者 / 出版社 / 年份 / 章节，记不清的不写）；
// 下一步代码在这些句子末尾加 [K#]，并在回答末尾加「背景知识出处」一节。只加标记、不改正文文字。表格行、标题行不处理。
const item = $input.first().json || {};
const full = String(item.output || '');
const m = /(^|\n)####\s/.exec(full);
const cut = m ? m.index : full.length;
const body = full.slice(0, cut);
const sents = [];
let pos = 0;
for (const line of body.split('\n')) {
  const start = pos; pos += line.length + 1;
  const t = line.trim();
  if (!t || /^(\||#|>|```)/.test(t)) continue;
  const re = /[^。！？；]+[。！？；]?/g; let mm;
  while ((mm = re.exec(line)) && sents.length < 60) {
    const s = mm[0]; const st = s.trim();
    if (st.length < 12 || /\[[EK]\d+\]/.test(st) || !/[一-龥A-Za-z]{6}/.test(st)) continue;
    const sTrim = s.replace(/\s+$/, '');
    // 标记放在句末标点之前（与 [E#] 的写法一致）
    const at = start + mm.index + sTrim.length - (/[。！？；]$/.test(sTrim) ? 1 : 0);
    sents.push({ id: 'S' + (sents.length + 1), text: st.slice(0, 240), at });
  }
}
let q = String(item.originalUserMessage || '');
if (!q) { try { q = String((($('Capture context').first().json) || {}).originalUserMessage || ''); } catch (e) {} }
const needed = sents.length > 0;
const user = needed ? ('用户问题：' + q + '\n\n回答正文里没有资料引用的句子（编号：原文）：\n' + sents.map(s => s.id + '：' + s.text).join('\n'))
  : '没有需要标注的句子。输出 {"items":[]}';
return [{ json: { ...item, bg_source_needed: needed, bg_sentences: sents, bg_source_user: user } }];
'''

APPLY_JS = r'''// BACKGROUND_SOURCE_CITE_V1：在模型给出出处的句子末尾加 [K#]（同一本书共用一个编号，按正文先后编号），回答末尾加「背景知识出处」一节。
// 只加标记，不改正文文字；模型失败或输出无法解析时原样放行。出处为模型自述、未经原文核对，附录标题写明。
const base = $('Prepare Background Sources').first().json || {};
const full = String(base.output || '');
const m = /(^|\n)####\s/.exec(full);
const cut = m ? m.index : full.length;
let body = full.slice(0, cut);
const tail = full.slice(cut);
const trace = { parse_ok: false, items: 0, marked: 0, books: 0 };
let raw = '';
try { const j = $input.first().json || {}; raw = String(j.output || j.text || ''); } catch (e) {}
let items = [];
try {
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  const o = JSON.parse(raw.slice(a, b + 1));
  items = Array.isArray(o.items) ? o.items : [];
  trace.parse_ok = true;
} catch (e) {}
trace.items = items.length;
const S = new Map((Array.isArray(base.bg_sentences) ? base.bg_sentences : []).map(s => [String(s.id), s]));
const clean = x => String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
const books = []; const bookIdx = new Map(); const marks = [];
const picked = items
  .map(it => ({ it, s: S.get(clean(it && it.s)) }))
  .filter(x => x.s && ['high', 'medium'].indexOf(clean(x.it.confidence).toLowerCase()) >= 0)
  .sort((a, b) => a.s.at - b.s.at);
for (const { it, s } of picked) {
  const labs = [];
  for (const src0 of (Array.isArray(it.sources) ? it.sources : []).slice(0, 2)) {
    const src = src0 || {};
    const title = clean(src.title).replace(/^[《〈]+|[》〉]+$/g, '');
    // 书名与作者都要有（11-18 试验：没有作者的多是泛称，如「统计过程控制（SPC）」）
    if (title.length < 2 || !clean(src.author)) continue;
    const key = title.replace(/\s/g, '').toLowerCase() + '|' + clean(src.author).replace(/\s/g, '');
    if (!bookIdx.has(key)) { bookIdx.set(key, books.length + 1); books.push({ title, author: clean(src.author), publisher: clean(src.publisher), year: clean(src.year), chapters: [], high: false }); }
    const n = bookIdx.get(key); const ch = clean(src.chapter);
    if (clean(it.confidence).toLowerCase() === 'high') books[n - 1].high = true;
    if (ch && books[n - 1].chapters.indexOf(ch) < 0) books[n - 1].chapters.push(ch);
    if (labs.indexOf('[K' + n + ']') < 0) labs.push('[K' + n + ']');
  }
  if (labs.length) marks.push({ at: s.at, label: labs.join(''), text: s.text, sid: s.id });
}
for (const mk of marks.slice().sort((a, b) => b.at - a.at)) {
  if (mk.at < 0 || mk.at > body.length) continue;
  body = body.slice(0, mk.at) + ' ' + mk.label + body.slice(mk.at);
  trace.marked += 1;
}
let appendix = '';
if (trace.marked && books.length) {
  trace.books = books.length;
  const isEn = x => /^[\x00-\x7F]+$/.test(x);
  const lines = books.map((b, i) => '- [K' + (i + 1) + '] ' + (isEn(b.title) ? b.title : '《' + b.title + '》') +
    [b.author, b.publisher, b.year].filter(Boolean).map(x => '，' + x).join('') + (b.chapters.length ? '，' + b.chapters.slice(0, 3).join('；') : '') +
    '（模型把握：' + (b.high ? '高' : '中') + '）');
  appendix = '\n\n#### 背景知识出处（模型自带的化工炼油背景知识；出处为模型自述，未经原文核对）\n' + lines.join('\n');
}
const out = body + tail.replace(/\s+$/, '') + appendix;
const { bg_source_user, bg_sentences, ...rest } = base;
// BACKGROUND_SOURCE_VERIFY_V1：交给原文核对一步用（书目按 K 编号顺序、已加标记的句子）
return [{ json: { ...rest, output: out, background_source_cite: trace,
  bg_books: books.map(b => ({ title: b.title, author: b.author, publisher: b.publisher, year: b.year, chapters: b.chapters, high: b.high })),
  bg_marks: marks.slice().sort((a, b) => a.at - b.at).map(x => ({ sid: x.sid, text: x.text, label: x.label })) } }];
'''
