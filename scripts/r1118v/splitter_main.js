function safeParse(x) {
  if (x === null || x === undefined) return {};
  if (typeof x === 'object') return x;
  if (typeof x !== 'string') return {};

  const cleaned = x
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return {};
  }
}

// MONGODB_TOOL_CONTRACT_V1
// The normalizer's established implementation still uses the historical
// arctic_* vocabulary internally. Keep that implementation stable, while
// accepting and emitting the public mongo_* MCP contract at this boundary.
const MONGO_TO_INTERNAL_TOOL = Object.freeze({
  mongo_find_tags: 'arctic_find_tags',
  mongo_resolve_factors: 'arctic_resolve_factors',
  mongo_read: 'arctic_read',
  mongo_stats: 'arctic_stats',
  mongo_analyze: 'arctic_analyze',
  mongo_describe: 'arctic_describe'
});

const INTERNAL_TO_MONGO_TOOL = Object.freeze(
  Object.fromEntries(Object.entries(MONGO_TO_INTERNAL_TOOL).map(([mongo, internal]) => [internal, mongo]))
);

function toInternalTool(tool) {
  const value = String(tool || '').trim();
  return MONGO_TO_INTERNAL_TOOL[value] || value;
}

function toMongoTool(tool) {
  const value = String(tool || '').trim();
  return INTERNAL_TO_MONGO_TOOL[value] || value;
}

function mapToolVocabularyDeep(value, mapper) {
  if (Array.isArray(value)) return value.map(v => mapToolVocabularyDeep(v, mapper));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, mapToolVocabularyDeep(child, mapper)])
    );
  }
  return typeof value === 'string' ? mapper(value) : value;
}

function toInternalParams(params, tool) {
  const out = mapToolVocabularyDeep(
    params && typeof params === 'object' && !Array.isArray(params) ? params : {},
    toInternalTool
  );
  if (!String(tool || '').startsWith('arctic_')) return out;
  if (out.library == null && out.database != null) out.library = out.database;
  if (out.symbol == null && out.collection != null) out.symbol = out.collection;
  delete out.database;
  delete out.collection;
  return out;
}

function toMongoParams(params, tool) {
  const out = mapToolVocabularyDeep(
    params && typeof params === 'object' && !Array.isArray(params) ? params : {},
    toMongoTool
  );
  if (!String(tool || '').startsWith('mongo_')) return out;
  if (out.database == null && out.library != null) out.database = out.library;
  if (out.collection == null && out.symbol != null) out.collection = out.symbol;
  delete out.library;
  delete out.symbol;
  return out;
}

function toInternalUnit(unit) {
  if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return unit;
  const tool = toInternalTool(unit.tool);
  const out = { ...unit, tool, params: toInternalParams(unit.params, tool) };
  for (const key of ['source_tool', 'required_tool', 'fallback_tool', 'tool_name']) {
    if (typeof out[key] === 'string') out[key] = toInternalTool(out[key]);
  }
  if (Array.isArray(unit.fallback_units)) out.fallback_units = unit.fallback_units.map(toInternalUnit);
  return out;
}

function toMongoUnit(unit) {
  if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return unit;
  const tool = toMongoTool(unit.tool);
  const out = { ...unit, tool, params: toMongoParams(unit.params, tool) };
  for (const key of ['source_tool', 'required_tool', 'fallback_tool', 'tool_name']) {
    if (typeof out[key] === 'string') out[key] = toMongoTool(out[key]);
  }
  if (Array.isArray(unit.fallback_units)) out.fallback_units = unit.fallback_units.map(toMongoUnit);
  return out;
}

function toInternalCatalog(catalog) {
  const out = { ...(catalog && typeof catalog === 'object' && !Array.isArray(catalog) ? catalog : {}) };
  const mongo = out.mongodb && typeof out.mongodb === 'object' ? out.mongodb : null;
  if (mongo) {
    const target = mongo.default_target && typeof mongo.default_target === 'object'
      ? mongo.default_target
      : {};
    out.arcticdb = {
      ...mongo,
      default_target: {
        ...target,
        library: target.library ?? target.database,
        symbol: target.symbol ?? target.collection
      }
    };
  }
  return out;
}

function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function uniqueOrdered(arr) {
  const out = [];
  const seen = new Set();

  for (const x of arr || []) {
    const v = String(x || '').trim();
    if (!v) continue;

    const k = normKey(v);
    if (seen.has(k)) continue;

    seen.add(k);
    out.push(v);
  }

  return out;
}

function isChineseText(s) {
  return /[\u4e00-\u9fff]/.test(String(s || ''));
}

function materiallyDifferent(a, b) {
  const x = normKey(a);
  const y = normKey(b);
  if (!x || !y) return false;
  if (x === y) return false;
  if (x.includes(y) || y.includes(x)) return false;
  return true;
}

function tokenCount(s) {
  return String(s || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

function isEvidenceIntentRagProfile(unit) {
  const part = String(unit?.question_part || '').trim();
  const evidenceParts = new Set([
    'factor_identification',
    'target_or_ideal_range',
    'period_verification',
    'cause_diagnosis',
    'event_retrieval',
    'comparison',
    'trend_or_change_analysis',
    'correlation_or_dependency_analysis',
    'anomaly_or_exceedance',
    'measurement_lookup',
    'tag_or_signal_discovery',
    'data_quality_or_availability',
    'procedure_or_action',
    'recommendation_or_optimization',
    'definition_or_explanation',
    'summary_or_synthesis',
    'relationship_lookup',
    'structured_lookup',
    'calculation_or_estimation',
    'document_lookup',
  ]);
  return evidenceParts.has(part);
}

function getDatasetMetaMaps(catalog) {
  const byId = new Map();
  const datasets = Array.isArray(catalog?.ragflow?.datasets)
    ? catalog.ragflow.datasets
    : [];

  for (const ds of datasets) {
    const id = String(ds?.id || '').trim();
    if (!id) continue;

    const meta = {
      id,
      name: String(ds?.name || '').trim(),
      language: String(ds?.language || '').trim().toLowerCase(),
      chunk_count: Number(ds?.chunk_count || 0),
      token_num: Number(ds?.token_num || 0),
      is_searchable:
        ds?.is_searchable === true ||
        (
          String(ds?.name || '') !== 'Test' &&
          Number(ds?.chunk_count || 0) > 0 &&
          Number(ds?.token_num || 0) > 0
        ),
    };

    byId.set(id, meta);
  }

  return { byId };
}

function filterSearchableDatasetIds(datasetIds, catalog) {
  const { byId } = getDatasetMetaMaps(catalog);

  return uniqueOrdered(
    (Array.isArray(datasetIds) ? datasetIds : []).filter(rawId => {
      const id = String(rawId || '').trim();
      if (!id) return false;
      const meta = byId.get(id);
      return !!(meta && meta.is_searchable);
    })
  );
}

function splitDatasetIdsByLanguage(datasetIds, catalog) {
  const { byId } = getDatasetMetaMaps(catalog);

  const groups = {
    zh: [],
    en: [],
    other: []
  };

  for (const rawId of (Array.isArray(datasetIds) ? datasetIds : [])) {
    const id = String(rawId || '').trim();
    if (!id) continue;

    const meta = byId.get(id);
    if (!meta) {
      groups.other.push(id);
      continue;
    }

    const lang = meta.language || '';
    if (lang.includes('chinese') || lang.includes('中文')) {
      groups.zh.push(id);
    } else if (lang.includes('english')) {
      groups.en.push(id);
    } else {
      groups.other.push(id);
    }
  }

  return groups;
}

function normalizeRuntimeRef(ref) {
  const s = String(ref || '').trim();
  if (!s) return s;

  // "$ref:step_2.tags" -> "$ref:step2.tags"
  return s.replace(/^\$ref:(?:step_?)?(\d+)\./, '$ref:step$1.');
}

function sanitizeArcticPlaceholders(unit) {
  if (!unit || typeof unit !== 'object') return unit;

  const out = JSON.parse(JSON.stringify(unit));
  const p = out.params || {};

  if (out.tool === 'arctic_stats' || out.tool === 'arctic_read') {
    if (Array.isArray(p.columns) && p.columns.length === 1 && typeof p.columns[0] === 'string') {
      const v = normalizeRuntimeRef(p.columns[0]);
      if (/^\$ref:step\d+\.[A-Za-z0-9_]+$/.test(v)) {
        p.columns = v; // must be string, not array
      }
    } else if (typeof p.columns === 'string') {
      const v = normalizeRuntimeRef(p.columns);
      if (/^\$ref:step\d+\.[A-Za-z0-9_]+$/.test(v)) {
        p.columns = v;
      }
    }
  }

  out.params = p;
  return out;
}

function chooseScopedCandidates(unit, ctx) {
  const p = unit.params || {};

  const primary = String(p.question || '').trim();
  const qEn = String(p.question_en || '').trim();
  const qZh = String(p.question_zh || '').trim();
  const keywordQueries = buildKeywordBundleQueries(p);
  const hasKeywordBundleQuery = Boolean(keywordQueries.en || keywordQueries.zh);

  const originalIsZh = isChineseText(ctx.originalUserMessage || '');
  const longQuestion = tokenCount(primary) > 18;

  const out = [];

  function push(question, langVariant, scopedDatasetIds) {
    const q = String(question || '').trim();
    const ids = Array.isArray(scopedDatasetIds) ? uniqueOrdered(scopedDatasetIds) : [];
    if (!q) return;

    const key = normKey(q) + '|' + ids.slice().sort().join(',');
    if (out.some(x => x._key === key)) return;

    out.push({
      _key: key,
      question: q,
      lang_variant: langVariant,
      dataset_ids: ids.length ? ids : undefined
    });
  }


  function termList(value) {
    if (Array.isArray(value)) {
      return value
        .flatMap(termList)
        .map(v => String(v || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    }
    if (value && typeof value === 'object') {
      return Object.values(value).flatMap(termList);
    }
    if (typeof value === 'string') {
      return value
        .split(/[\n,;|]+/)
        .map(v => v.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    }
    return [];
  }

  function uniqueTerms(...groups) {
    const seenTerms = new Set();
    const outTerms = [];
    for (const group of groups) {
      for (const raw of termList(group)) {
        const term = raw.replace(/^["'â€œâ€â€˜â€™]+|["'â€œâ€â€˜â€™]+$/g, '').trim();
        if (!term || term.length > 80) continue;
        const key = term.toLowerCase();
        if (seenTerms.has(key)) continue;
        seenTerms.add(key);
        outTerms.push(term);
      }
    }
    return outTerms;
  }

  function languageTerms(terms, language) {
    return termList(terms).filter(term => {
      const hasZh = isChineseText(term);
      if (language === 'zh') return hasZh || /^[A-Z0-9_.-]{2,12}$/.test(term);
      return !hasZh;
    });
  }

  function buildEventEvidenceQueries() {
    const part = String(unit.question_part || '').trim();
    const eventRelevantParts = new Set([
      'factor_identification',
      'cause_diagnosis',
      'event_retrieval',
      'period_verification',
      'anomaly_or_exceedance',
      'trend_or_change_analysis'
    ]);

    if (!eventRelevantParts.has(part)) return { en: '', zh: '' };

    const enSeed = String(keywordQueries.en || qEn || (!isChineseText(primary) ? primary : '') || '').trim();
    const zhSeed = String(keywordQueries.zh || qZh || (isChineseText(primary) ? primary : '') || '').trim();

    return {
      en: uniqueTerms([
        enSeed,
        'historical record',
        'incident',
        'event',
        'operating change',
        'disturbance',
        'failure',
        'interruption',
        'before after',
        'production impact',
        'measured impact'
      ]).join(' '),
      zh: uniqueTerms([
        zhSeed,
        '\u5386\u53f2\u8bb0\u5f55',
        '\u4e8b\u4ef6',
        '\u4e8b\u6545',
        '\u64cd\u4f5c\u53d8\u52a8',
        '\u6ce2\u52a8',
        '\u6545\u969c',
        '\u4e2d\u65ad',
        '\u524d\u540e\u53d8\u5316',
        '\u4ea7\u91cf\u5f71\u54cd',
        '\u6d4b\u91cf\u5f71\u54cd'
      ]).join(' ')
    };
  }

  function buildKeywordBundleQueries(p) {
    const kb = p.keyword_bundle || p.retrieval_keywords || p.keywords || null;
    if (!kb || typeof kb !== 'object' || Array.isArray(kb)) {
      return { en: '', zh: '' };
    }

    const sharedMust = termList(kb.must_have_terms || kb.must_terms || kb.core_terms);
    const sharedShould = termList(kb.should_have_terms || kb.supporting_terms || kb.optional_terms);
    const sharedIntent = termList(kb.intent_terms || kb.intent_keywords);

    const enTerms = uniqueTerms(
      kb.english_equivalents,
      kb.terms_en,
      kb.en_terms,
      kb.en_keywords,
      kb.must_have_terms_en,
      kb.should_have_terms_en,
      languageTerms(sharedMust, 'en'),
      languageTerms(sharedShould, 'en'),
      kb.intent_terms_en,
      languageTerms(sharedIntent, 'en')
    ).slice(0, 32);

    const zhTerms = uniqueTerms(
      kb.chinese_equivalents,
      kb.terms_zh,
      kb.zh_terms,
      kb.zh_keywords,
      kb.must_have_terms_zh,
      kb.should_have_terms_zh,
      languageTerms(sharedMust, 'zh'),
      languageTerms(sharedShould, 'zh'),
      kb.intent_terms_zh,
      languageTerms(sharedIntent, 'zh')
    ).slice(0, 32);

    return {
      en: enTerms.join(' '),
      zh: zhTerms.join(' ')
    };
  }


  function stableProfileForPart(part) {
    const profiles = {
      factor_identification: {
        label: 'factor',
        en: 'factors operating parameters drivers mechanism effect relationship production yield quality',
        zh: '\u5f71\u54cd\u56e0\u7d20 \u64cd\u4f5c\u53c2\u6570 \u9a71\u52a8\u56e0\u7d20 \u673a\u7406 \u5173\u7cfb \u4ea7\u91cf \u6536\u7387 \u8d28\u91cf'
      },
      target_or_ideal_range: {
        label: 'target_range',
        en: 'target range ideal range recommended range operating window setpoint limit specification benchmark',
        zh: '\u76ee\u6807\u8303\u56f4 \u6700\u4f73\u8303\u56f4 \u63a8\u8350\u8303\u56f4 \u64cd\u4f5c\u7a97\u53e3 \u8bbe\u5b9a\u503c \u9650\u503c \u6307\u6807'
      },
      period_verification: {
        label: 'period',
        en: 'actual operation period data monthly report statistics trend deviation measured value',
        zh: '\u5b9e\u9645\u8fd0\u884c \u65f6\u6bb5\u6570\u636e \u6708\u62a5 \u7edf\u8ba1 \u8d8b\u52bf \u504f\u5dee \u6d4b\u91cf\u503c'
      },
      event_retrieval: {
        label: 'event',
        en: 'incident historical record case event alarm leak failure before after measured impact',
        zh: '\u4e8b\u6545 \u5386\u53f2\u8bb0\u5f55 \u6848\u4f8b \u4e8b\u4ef6 \u62a5\u8b66 \u6cc4\u6f0f \u6545\u969c \u524d\u540e\u53d8\u5316'
      },
      cause_diagnosis: {
        label: 'cause',
        en: 'cause mechanism root cause failure mode abnormal condition contributing factor troubleshooting',
        zh: '\u539f\u56e0 \u673a\u7406 \u6839\u672c\u539f\u56e0 \u6545\u969c\u6a21\u5f0f \u5f02\u5e38\u5de5\u51b5 \u5f71\u54cd\u56e0\u7d20 \u6392\u67e5'
      },
      procedure_or_action: {
        label: 'prevention',
        en: 'prevention mitigation inspection maintenance operating procedure corrective action avoid recurrence',
        zh: '\u9884\u9632 \u7f13\u89e3 \u68c0\u67e5 \u7ef4\u62a4 \u64cd\u4f5c\u89c4\u7a0b \u7ea0\u6b63\u63aa\u65bd \u907f\u514d\u518d\u53d1'
      },
      anomaly_or_exceedance: {
        label: 'risk_implication',
        en: 'process implication operating risk safety risk excursion alarm exceedance shutdown emission consequence',
        zh: '\u5de5\u827a\u5f71\u54cd \u64cd\u4f5c\u98ce\u9669 \u5b89\u5168\u98ce\u9669 \u504f\u79bb \u62a5\u8b66 \u8d85\u6807 \u505c\u8f66 \u6392\u653e \u540e\u679c'
      },
      recommendation_or_optimization: {
        label: 'recommendation',
        en: 'recommendation optimization improvement priority adjustment operating target constraint action',
        zh: '\u5efa\u8bae \u4f18\u5316 \u6539\u8fdb \u4f18\u5148\u7ea7 \u8c03\u6574 \u64cd\u4f5c\u76ee\u6807 \u7ea6\u675f \u63aa\u65bd'
      },
      measurement_lookup: {
        label: 'measurement',
        en: 'real time data online measurement reading value statistic trend monitor control detector analyzer',
        zh: '\u5b9e\u65f6\u6570\u636e \u5728\u7ebf\u6d4b\u91cf \u8bfb\u6570 \u6570\u503c \u7edf\u8ba1 \u8d8b\u52bf \u76d1\u6d4b \u63a7\u5236 \u68c0\u6d4b\u5668 \u5206\u6790\u4eea'
      },
      tag_or_signal_discovery: {
        label: 'tag_signal',
        en: 'tag signal sensor variable monitored parameter direct measurement indirect indicator DCS alarm',
        zh: '\u4f4d\u53f7 \u4fe1\u53f7 \u4f20\u611f\u5668 \u53d8\u91cf \u76d1\u6d4b\u53c2\u6570 \u76f4\u63a5\u6d4b\u91cf \u95f4\u63a5\u6307\u6807 DCS\u62a5\u8b66'
      },
      correlation_or_dependency_analysis: {
        label: 'indirect_indicator',
        en: 'indirect indicator correlation dependency upstream downstream leading signal interaction trend',
        zh: '\u95f4\u63a5\u6307\u6807 \u76f8\u5173 \u4f9d\u8d56 \u4e0a\u6e38 \u4e0b\u6e38 \u9886\u5148\u4fe1\u53f7 \u76f8\u4e92\u4f5c\u7528 \u8d8b\u52bf'
      },
      trend_or_change_analysis: {
        label: 'trend',
        en: 'trend change increase decrease before after movement over time what changed first',
        zh: '\u8d8b\u52bf \u53d8\u5316 \u4e0a\u5347 \u4e0b\u964d \u524d\u540e\u53d8\u5316 \u968f\u65f6\u95f4\u53d8\u5316 \u5148\u53d8\u5316\u9879'
      },
      data_quality_or_availability: {
        label: 'data_quality',
        en: 'data availability missing data data quality no data null flatline coverage limitation',
        zh: '\u6570\u636e\u53ef\u7528\u6027 \u7f3a\u5931\u6570\u636e \u6570\u636e\u8d28\u91cf \u65e0\u6570\u636e \u7a7a\u503c \u5e73\u76f4 \u8986\u76d6\u8303\u56f4 \u9650\u5236'
      },
      calculation_or_estimation: {
        label: 'calculation',
        en: 'calculation composition formula energy consumption statistical method contribution breakdown',
        zh: '\u8ba1\u7b97 \u6784\u6210 \u516c\u5f0f \u80fd\u8017 \u7edf\u8ba1\u65b9\u6cd5 \u8d21\u732e \u5206\u89e3'
      },
      relationship_lookup: {
        label: 'relationship',
        en: 'relationship connected upstream downstream equipment dependency process path interaction',
        zh: '\u5173\u7cfb \u8fde\u63a5 \u4e0a\u6e38 \u4e0b\u6e38 \u8bbe\u5907 \u4f9d\u8d56 \u5de5\u827a\u8def\u5f84 \u76f8\u4e92\u4f5c\u7528'
      },
      document_lookup: {
        label: 'document',
        en: 'technical report monthly report procedure manual incident report document record citation',
        zh: '\u6280\u672f\u62a5\u544a \u6708\u62a5 \u89c4\u7a0b \u624b\u518c \u4e8b\u6545\u62a5\u544a \u6587\u6863 \u8bb0\u5f55 \u5f15\u7528'
      },
      definition_or_explanation: {
        label: 'explanation',
        en: 'definition explanation principle feasibility possible behavior process basis mechanism',
        zh: '\u5b9a\u4e49 \u89e3\u91ca \u539f\u7406 \u53ef\u884c\u6027 \u53ef\u80fd\u73b0\u8c61 \u5de5\u827a\u4f9d\u636e \u673a\u7406'
      }
    };
    return profiles[part] || { label: 'general', en: 'evidence document information process operation measurement', zh: '\u8bc1\u636e \u6587\u6863 \u4fe1\u606f \u5de5\u827a \u64cd\u4f5c \u6d4b\u91cf' };
  }

  function extractStableSearchTerms(text, maxTerms = 28) {
    const stop = new Set([
      'what','which','where','when','why','how','could','would','should','have','has','had','been','being','there','their',
      'this','that','these','those','with','from','into','onto','about','does','did','done','ever','also','any','all',
      'the','and','for','are','was','were','can','you','tell','me','please','possible','happen','happening','happened',
      'question','run','check','look','looking','based','data','information'
    ]);
    const s = String(text || '').replace(/[_./-]/g, ' ');
    const matches = s.match(/[A-Za-z][A-Za-z0-9]{2,}|\d{4}(?:\s+\d{1,2}){0,2}|\d+(?:\.\d+)?/g) || [];
    const terms = [];
    const seen = new Set();
    for (const raw of matches) {
      const term = raw.trim();
      const key = term.toLowerCase();
      if (!term || stop.has(key)) continue;
      if (/^\d+$/.test(term) && term.length < 4) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
      if (terms.length >= maxTerms) break;
    }
    return terms;
  }

  function stableEntitySeed() {
    return uniqueTerms(
      extractStableSearchTerms(ctx.originalUserMessage || '', 24),
      extractStableSearchTerms(p.resolved_question || '', 16),
      extractStableSearchTerms(p.question_literal || '', 16),
      extractStableSearchTerms(primary || '', 16),
      extractStableSearchTerms(qEn || '', 12)
    ).slice(0, 32).join(' ');
  }

  function pushStableIntentProfiles(scopedDatasetIds, languageScope) {
    if (!isEvidenceIntentRagProfile(unit)) return;
    const part = String(unit.question_part || '').trim();
    const profile = stableProfileForPart(part);
    const seed = stableEntitySeed() || primary || qEn || ctx.originalUserMessage || '';
    if ((languageScope === 'en' || languageScope === 'mixed' || languageScope === 'all') && seed) {
      push(`${seed} ${profile.en}`, `en_stable_${profile.label}_profile`, scopedDatasetIds);
    }
    if ((languageScope === 'zh' || languageScope === 'mixed' || languageScope === 'all')) {
      const zhSeed = String(qZh || keywordQueries.zh || '').trim();
      if (zhSeed) {
        push(`${zhSeed} ${profile.zh}`, `zh_stable_${profile.label}_profile`, scopedDatasetIds);
      } else if (seed && languageScope === 'zh') {
        push(`${seed} ${profile.en}`, `en_stable_${profile.label}_on_zh`, scopedDatasetIds);
      }
    }
  }

  function pushEvidenceIntentProfiles(scopedDatasetIds, languageScope) {
    if (!isEvidenceIntentRagProfile(unit)) return;

    const part = String(unit.question_part || '').trim();
    const profileKey = `${part}:${languageScope || 'mixed'}`;
    const profiledParts = ctx.ragProfiledParts;
    if (profiledParts && profiledParts.has(profileKey)) return;

    const beforeCount = out.length;
    const allowEn = languageScope !== 'zh';
    const allowZh = languageScope !== 'en';
    const enSeed = String(keywordQueries.en || qEn || (!isChineseText(primary) ? primary : '') || '').trim();
    const zhSeed = String(keywordQueries.zh || qZh || (isChineseText(primary) ? primary : '') || '').trim();

    const profileTerms = {
      factor_identification: {
        en: 'causes factors operating parameters mechanism effect relationship adjustment troubleshooting',
        zh: '\u539f\u56e0 \u5f71\u54cd\u56e0\u7d20 \u64cd\u4f5c\u53c2\u6570 \u673a\u7406 \u5173\u7cfb \u8c03\u6574\u65b9\u6cd5 \u5904\u7406\u63aa\u65bd',
        label: 'factor_evidence_profile'
      },
      target_or_ideal_range: {
        en: 'target range recommended range ideal operating range setpoint limit constraint specification benchmark optimization APC',
        zh: '\u76ee\u6807\u8303\u56f4 \u63a8\u8350\u8303\u56f4 \u6700\u4f73 \u64cd\u4f5c\u8303\u56f4 \u8bbe\u5b9a\u503c \u9650\u503c \u7ea6\u675f \u6307\u6807 \u4f18\u5316 APC \u63a7\u5236\u76ee\u6807',
        label: 'target_range_evidence_profile'
      },
      period_verification: {
        en: 'monthly report technical report historical record statistics trend incident event operating change period verification actual operation deviation',
        zh: '\u6708\u62a5 \u6280\u672f\u6708\u62a5 \u5386\u53f2\u8bb0\u5f55 \u7edf\u8ba1 \u8d8b\u52bf \u4e8b\u6545 \u4e8b\u4ef6 \u64cd\u4f5c\u53d8\u52a8 \u65f6\u6bb5\u9a8c\u8bc1 \u5b9e\u9645\u8fd0\u884c \u504f\u5dee',
        label: 'period_evidence_profile'
      },
      cause_diagnosis: {
        en: 'cause mechanism failure mode root cause troubleshooting abnormal condition process reason contributing factor',
        zh: '\u539f\u56e0 \u673a\u7406 \u6545\u969c\u6a21\u5f0f \u6839\u672c\u539f\u56e0 \u6392\u67e5 \u5f02\u5e38\u5de5\u51b5 \u5de5\u827a\u539f\u56e0 \u5f71\u54cd\u56e0\u7d20',
        label: 'cause_diagnosis_evidence_profile'
      },
      event_retrieval: {
        en: 'incident historical record case event operating disturbance before after measured impact',
        zh: '\u4e8b\u6545 \u5386\u53f2\u8bb0\u5f55 \u6848\u4f8b \u4e8b\u4ef6 \u64cd\u4f5c\u6ce2\u52a8 \u524d\u540e\u53d8\u5316 \u6d4b\u91cf\u5f71\u54cd',
        label: 'event_evidence_profile'
      },
      procedure_or_action: {
        en: 'prevention mitigation inspection maintenance operating procedure response corrective action avoid recurrence',
        zh: '\u9884\u9632 \u7f13\u89e3 \u68c0\u67e5 \u7ef4\u62a4 \u64cd\u4f5c\u89c4\u7a0b \u5e94\u5bf9 \u7ea0\u6b63\u63aa\u65bd \u907f\u514d\u518d\u53d1',
        label: 'procedure_action_evidence_profile'
      },
      anomaly_or_exceedance: {
        en: 'abnormal excursion alarm risk safety implication operating constraint offline bypass unavailable consequence',
        zh: '\u5f02\u5e38 \u504f\u79bb \u62a5\u8b66 \u98ce\u9669 \u5b89\u5168\u5f71\u54cd \u64cd\u4f5c\u7ea6\u675f \u79bb\u7ebf \u65c1\u8def \u4e0d\u53ef\u7528 \u540e\u679c',
        label: 'anomaly_risk_evidence_profile'
      },
      measurement_lookup: {
        en: 'measurement reading online measurement real time data value statistic trend control monitor',
        zh: '\u6d4b\u91cf \u8bfb\u6570 \u5728\u7ebf\u6d4b\u91cf \u5b9e\u65f6\u6570\u636e \u6570\u503c \u7edf\u8ba1 \u8d8b\u52bf \u63a7\u5236 \u76d1\u6d4b',
        label: 'measurement_evidence_profile'
      },
      tag_or_signal_discovery: {
        en: 'tag signal sensor indicator variable monitored parameter direct measurement indirect measurement',
        zh: '\u4f4d\u53f7 \u4fe1\u53f7 \u4f20\u611f\u5668 \u6307\u6807 \u53d8\u91cf \u76d1\u6d4b\u53c2\u6570 \u76f4\u63a5\u6d4b\u91cf \u95f4\u63a5\u6d4b\u91cf',
        label: 'tag_signal_evidence_profile'
      },
      correlation_or_dependency_analysis: {
        en: 'indirect indicator correlation dependency upstream downstream leading signal interaction sensitivity',
        zh: '\u95f4\u63a5\u6307\u6807 \u76f8\u5173 \u4f9d\u8d56 \u4e0a\u6e38 \u4e0b\u6e38 \u9886\u5148\u4fe1\u53f7 \u76f8\u4e92\u4f5c\u7528 \u654f\u611f\u6027',
        label: 'correlation_dependency_evidence_profile'
      },
      trend_or_change_analysis: {
        en: 'trend change increase decrease before after movement over time what changed first',
        zh: '\u8d8b\u52bf \u53d8\u5316 \u4e0a\u5347 \u4e0b\u964d \u524d\u540e\u53d8\u5316 \u968f\u65f6\u95f4\u53d8\u5316 \u5148\u53d8\u5316\u9879',
        label: 'trend_change_evidence_profile'
      },
      data_quality_or_availability: {
        en: 'data availability missing data data quality reliability flatline constant value coverage limitation',
        zh: '\u6570\u636e\u53ef\u7528\u6027 \u7f3a\u5931\u6570\u636e \u6570\u636e\u8d28\u91cf \u53ef\u9760\u6027 \u5e73\u76f4 \u6052\u5b9a\u503c \u8986\u76d6\u8303\u56f4 \u9650\u5236',
        label: 'data_quality_evidence_profile'
      },
      calculation_or_estimation: {
        en: 'calculation formula composition breakdown energy consumption sub item statistic method contribution',
        zh: '\u8ba1\u7b97 \u516c\u5f0f \u6784\u6210 \u5206\u89e3 \u80fd\u8017 \u5b50\u9879 \u7edf\u8ba1\u65b9\u6cd5 \u8d21\u732e',
        label: 'calculation_estimation_evidence_profile'
      },
      relationship_lookup: {
        en: 'relationship graph directly connected upstream downstream equipment dependency process path',
        zh: '\u5173\u7cfb\u56fe \u76f4\u63a5\u8fde\u63a5 \u4e0a\u6e38 \u4e0b\u6e38 \u8bbe\u5907 \u4f9d\u8d56 \u5de5\u827a\u8def\u5f84',
        label: 'relationship_lookup_evidence_profile'
      },
      document_lookup: {
        en: 'technical report monthly report document record procedure incident report cited source',
        zh: '\u6280\u672f\u62a5\u544a \u6708\u62a5 \u6587\u6863 \u8bb0\u5f55 \u89c4\u7a0b \u4e8b\u6545\u62a5\u544a \u5f15\u7528\u6765\u6e90',
        label: 'document_lookup_evidence_profile'
      },
      recommendation_or_optimization: {
        en: 'recommendation optimization improve priority adjustment operating target constraint action tradeoff',
        zh: '\u5efa\u8bae \u4f18\u5316 \u6539\u8fdb \u4f18\u5148\u7ea7 \u8c03\u6574 \u64cd\u4f5c\u76ee\u6807 \u7ea6\u675f \u63aa\u65bd \u6743\u8861',
        label: 'recommendation_optimization_evidence_profile'
      },
      definition_or_explanation: {
        en: 'definition explanation principle mechanism feasibility possible behavior process basis',
        zh: '\u5b9a\u4e49 \u89e3\u91ca \u539f\u7406 \u673a\u7406 \u53ef\u884c\u6027 \u53ef\u80fd\u73b0\u8c61 \u5de5\u827a\u4f9d\u636e',
        label: 'definition_explanation_evidence_profile'
      }
    };

    const profile = profileTerms[part];
    if (profile) {
      if (allowEn && enSeed) {
        push(`${enSeed} ${profile.en}`, `en_${profile.label}`, scopedDatasetIds);
      }
      if (allowZh && zhSeed) {
        push(`${zhSeed} ${profile.zh}`, `zh_${profile.label}`, scopedDatasetIds);
      }
    }

    if (profiledParts && out.length > beforeCount) {
      profiledParts.add(profileKey);
    }
  }

  const eventEvidenceQueries = buildEventEvidenceQueries();

  // RESOLVED_QUESTION_PLAIN_VARIANT_V7
  // 原先所有变体都是「问句 + 大量意图词」的词袋，primary 只在无关键词包且无
  // question_zh 时才发出（规划器每次都给这两样，故从未发出），末尾又只保留前 2~4 条。
  // 实测 exec 138887：实际发出的 4 条变体里报警设定表 PDRA3125 那一行名次全为「无」；
  // 规划器解析出的原问句「两器差压控制的报警阈值是什么？」单独查询排第 1、2 名。
  // 这里在压入任何变体之前先压入 resolved_question，并把名额 +1，原有变体不减。
  const plainResolved = (function () {
    const rq = String(p.resolved_question || '').replace(/\s+/g, ' ').trim();
    if (!rq || rq.length > 80) return '';
    return rq;
  })();
  // CANONICAL_SUBJECT_VARIANT_V7
  // 用户说法（「两器压差」）与资料写法（「沉降器与二再差压」「差压控制」）字面对不上，
  // 向量权重 0.3→0.9 也救不回（MT25 T3 报警行一次未命中）。设备上下文的规范名由 LLM 按领域知识展开
  // （如「两器（沉降器与再生器）差压测量回路」），用它替换问句中出现的别名、以空格分隔余下部分：
  // 实测 T3 报警行第 1、2 名、T6 PDRA3125 第 1、3 名、T9 相关段落 2/5/6 名（原分别为 无/无/14）。
  // 规范名与别名均来自 Device Context Retriever 的输出，不维护词表；作为附加变体，名额 +1。
  const canonicalVariant = (function () {
    try {
      const dc = (($('Parse Device Context').first().json || {}).device_context) || {};
      if (String(dc.status || '').toLowerCase() !== 'resolved') return '';
      const dev = dc.device || {};
      const canon = String(dev.canonical_name || '').replace(/\s+/g, ' ').trim();
      if (!canon || canon.length < 2) return '';
      const rq = String(p.resolved_question || p.question || '').replace(/\s+/g, ' ').trim();
      if (!rq || rq.includes(canon)) return '';
      const aliases = (Array.isArray(dev.aliases) ? dev.aliases : [])
        .map(x => String(x || '').trim())
        .filter(x => x.length >= 2 && rq.includes(x))
        .sort((a, b) => b.length - a.length);
      if (!aliases.length) return '';
      const rest = rq.replace(aliases[0], ' ').replace(/[？?。！!]+$/, '').replace(/\s+/g, ' ').trim();
      if (rest.length < 2) return '';
      return (canon + ' ' + rest).slice(0, 120);
    } catch (e) {
      return '';
    }
  })();
  const candidateLimit = (isEvidenceIntentRagProfile(unit) ? 4 : (hasKeywordBundleQuery ? 3 : 2))
    + (plainResolved ? 1 : 0) + (canonicalVariant ? 1 : 0);

  let datasetIds = getAllSearchableDatasetIds(ctx.catalog || {});
  if (plainResolved) {
    push(plainResolved, 'resolved_question_plain', datasetIds.length ? datasetIds : undefined);
  }
  if (canonicalVariant) {
    push(canonicalVariant, 'canonical_subject', datasetIds.length ? datasetIds : undefined);
  }

  if (datasetIds.length) {
    const groups = splitDatasetIdsByLanguage(datasetIds, ctx.catalog || {});
    pushStableIntentProfiles(datasetIds, 'all');

    if (groups.zh.length) {
      if (keywordQueries.zh) {
        push(keywordQueries.zh, 'zh_keyword_bundle', groups.zh);
        if (qZh && materiallyDifferent(qZh, keywordQueries.zh)) {
          push(qZh, 'zh_scoped_preserved', groups.zh);
        }
        if (eventEvidenceQueries.zh) {
          push(eventEvidenceQueries.zh, 'zh_event_evidence_profile', groups.zh);
        }
      } else if (qZh) {
        push(qZh, 'zh_scoped', groups.zh);
        if (eventEvidenceQueries.zh) {
          push(eventEvidenceQueries.zh, 'zh_event_evidence_profile', groups.zh);
        }
      }
      else if (primary) push(primary, 'zh_dataset_primary_query', groups.zh);
    }

    if (groups.en.length) {
      if (keywordQueries.en) {
        push(keywordQueries.en, 'en_keyword_bundle', groups.en);
        if (qEn && materiallyDifferent(qEn, keywordQueries.en)) {
          push(qEn, 'en_scoped_preserved', groups.en);
        }
        if (eventEvidenceQueries.en) {
          push(eventEvidenceQueries.en, 'en_event_evidence_profile', groups.en);
        }
      } else if (qEn) {
        push(qEn, 'en_scoped', groups.en);
        if (eventEvidenceQueries.en) {
          push(eventEvidenceQueries.en, 'en_event_evidence_profile', groups.en);
        }
      }
      else if (primary) push(primary, 'en_dataset_primary_query', groups.en);
    }

    if (groups.other.length) {
      if (originalIsZh) {
        if (keywordQueries.zh) {
          push(keywordQueries.zh, 'zh_keyword_bundle_mixed', groups.other);
          if (qZh && materiallyDifferent(qZh, keywordQueries.zh)) {
            push(qZh, 'zh_scoped_preserved_mixed', groups.other);
          }
          if (eventEvidenceQueries.zh) {
            push(eventEvidenceQueries.zh, 'zh_event_evidence_profile_mixed', groups.other);
          }
        } else if (qZh) {
          push(qZh, 'zh_mixed', groups.other);
          if (eventEvidenceQueries.zh) {
            push(eventEvidenceQueries.zh, 'zh_event_evidence_profile_mixed', groups.other);
          }
        }
        else if (primary) push(primary, 'primary_mixed', groups.other);

        if (!longQuestion && qEn && materiallyDifferent(qEn, qZh || primary)) {
          push(qEn, 'en_backup_mixed', groups.other);
        }
      } else {
        if (keywordQueries.en) {
          push(keywordQueries.en, 'en_keyword_bundle_mixed', groups.other);
          if (qEn && materiallyDifferent(qEn, keywordQueries.en)) {
            push(qEn, 'en_scoped_preserved_mixed', groups.other);
          }
          if (eventEvidenceQueries.en) {
            push(eventEvidenceQueries.en, 'en_event_evidence_profile_mixed', groups.other);
          }
        } else if (qEn) {
          push(qEn, 'en_mixed', groups.other);
          if (eventEvidenceQueries.en) {
            push(eventEvidenceQueries.en, 'en_event_evidence_profile_mixed', groups.other);
          }
        }
        else if (primary) push(primary, 'primary_mixed', groups.other);

        if (!longQuestion && qZh && materiallyDifferent(qZh, qEn || primary)) {
          push(qZh, 'zh_backup_mixed', groups.other);
        }
      }
    }

    if (!out.length) {
      if (primary) push(primary, 'primary_scoped', datasetIds);
      else if (originalIsZh && qZh) push(qZh, 'zh_scoped_fallback', datasetIds);
      else if (!originalIsZh && qEn) push(qEn, 'en_scoped_fallback', datasetIds);
      else if (qZh) push(qZh, 'zh_scoped_fallback', datasetIds);
      else if (qEn) push(qEn, 'en_scoped_fallback', datasetIds);
    }

    if (groups.zh.length) pushEvidenceIntentProfiles(groups.zh, 'zh');
    if (groups.en.length) pushEvidenceIntentProfiles(groups.en, 'en');
    if (groups.other.length) pushEvidenceIntentProfiles(groups.other, 'mixed');

    return out.slice(0, candidateLimit).map(({ _key, ...rest }) => rest);
  }

  if (originalIsZh) {
    if (keywordQueries.zh) {
      push(keywordQueries.zh, 'zh_keyword_bundle', undefined);
      if (qZh && materiallyDifferent(qZh, keywordQueries.zh)) {
        push(qZh, 'zh_scoped_preserved', undefined);
      }
      if (eventEvidenceQueries.zh) {
        push(eventEvidenceQueries.zh, 'zh_event_evidence_profile', undefined);
      }
    } else if (qZh) {
      push(qZh, 'zh', undefined);
      if (eventEvidenceQueries.zh) {
        push(eventEvidenceQueries.zh, 'zh_event_evidence_profile', undefined);
      }
    }
    else if (primary) push(primary, 'primary', undefined);

    if (!longQuestion && qEn && materiallyDifferent(qEn, qZh || primary)) {
      push(qEn, 'en_backup', undefined);
    }
  } else {
    if (keywordQueries.en) {
      push(keywordQueries.en, 'en_keyword_bundle', undefined);
      if (qEn && materiallyDifferent(qEn, keywordQueries.en)) {
        push(qEn, 'en_scoped_preserved', undefined);
      }
      if (eventEvidenceQueries.en) {
        push(eventEvidenceQueries.en, 'en_event_evidence_profile', undefined);
      }
    } else if (qEn) {
      push(qEn, 'en', undefined);
      if (eventEvidenceQueries.en) {
        push(eventEvidenceQueries.en, 'en_event_evidence_profile', undefined);
      }
    }
    else if (primary) push(primary, 'primary', undefined);

    if (!longQuestion && qZh && materiallyDifferent(qZh, qEn || primary)) {
      push(qZh, 'zh_backup', undefined);
    }
  }

  if (!out.length) {
    if (primary) push(primary, 'primary_fallback', undefined);
    else if (qZh) push(qZh, 'zh_fallback', undefined);
    else if (qEn) push(qEn, 'en_fallback', undefined);
  }

  if (!hasKeywordBundleQuery) {
    pushEvidenceIntentProfiles(undefined, 'mixed');
  }

  return out.slice(0, candidateLimit).map(({ _key, ...rest }) => rest);
}

function extractStepRefsFromParams(params) {
  const refs = new Set();
  const s = JSON.stringify(params || {});

  const re = /\$ref:(?:step_?)?(\d+)\./g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) refs.add(n);
  }

  return refs;
}

function getToolByUnitId(units) {
  const byId = new Map();

  for (const u of units || []) {
    if (!u || u.unit_id == null) continue;
    byId.set(Number(u.unit_id), String(u.tool || '').trim());
  }

  return byId;
}

function replaceStepRefs(value, refMap) {
  if (typeof value === 'string') {
    return value.replace(/\$ref:step_?(\d+)\./g, function(match, n) {
      const mapped = refMap.get(Number(n));
      return mapped != null ? ('$ref:step' + mapped + '.') : match;
    });
  }

  if (Array.isArray(value)) return value.map(function(v) { return replaceStepRefs(v, refMap); });

  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = replaceStepRefs(v, refMap);
    return out;
  }

  return value;
}

function arcticFindTagDedupeKey(u) {
  const p = u?.params || {};
  const library = normKey(p.library);
  const symbol = normKey(p.symbol);
  const query = normKey(p.query);

  if (!library || !symbol || !query) return null;
  return `${library}|${symbol}|${query}`;
}

function collapseDuplicateArcticFindTags(units) {
  const list = Array.isArray(units) ? units : [];
  const firstByKey = new Map();
  const refMap = new Map();

  for (const u of list) {
    if (!u || u.tool !== 'arctic_find_tags' || u.unit_id == null) continue;

    const id = Number(u.unit_id);
    if (!Number.isFinite(id)) continue;

    const key = arcticFindTagDedupeKey(u);
    if (!key) continue;

    if (!firstByKey.has(key)) {
      firstByKey.set(key, id);
      continue;
    }

    refMap.set(id, firstByKey.get(key));
  }

  if (!refMap.size) return list;

  const seenStats = new Set();
  const out = [];

  for (const u of list) {
    if (!u || typeof u !== 'object') continue;
    const id = Number(u.unit_id);
    if (u.tool === 'arctic_find_tags' && refMap.has(id)) continue;

    const next = {
      ...u,
      depends_on: Array.isArray(u.depends_on)
        ? uniqueOrdered(u.depends_on.map(function(dep) { return refMap.get(Number(dep)) || Number(dep); }).filter(Number.isFinite))
        : [],
      params: replaceStepRefs(u.params || {}, refMap)
    };

    if (next.tool === 'arctic_stats' || next.tool === 'arctic_read' || next.tool === 'arctic_analyze') {
      const key = next.tool + ':' + JSON.stringify(next.params || {});
      if (seenStats.has(key)) continue;
      seenStats.add(key);
    }

    out.push(next);
  }

  return out;
}


function isDirectNoRetrievalUnit(unit) {
  const p = unit?.params || {};
  return String(unit?.tool || '').trim() === 'direct_response' && (
    p.no_retrieval === true ||
    String(p.mode || '').trim() === 'conversation_summary' ||
    String(p.mode || '').trim() === 'missing_exceedance_window'
  );
}

function keepOnlyDirectNoRetrievalIfPresent(units) {
  const list = Array.isArray(units) ? units : [];
  const direct = list.find(isDirectNoRetrievalUnit);
  return direct ? [direct] : list;
}

function normalizeArcticDependencies(units) {
  const list = Array.isArray(units) ? units : [];

  return list.map(u => {
    if (!u || typeof u !== 'object') return u;

    const declared = Array.isArray(u.depends_on)
      ? u.depends_on.map(Number).filter(Number.isFinite)
      : [];

    const referenced = [...extractStepRefsFromParams(u.params || {})];

    return {
      ...u,
      depends_on: [...new Set([...declared, ...referenced])]
    };
  });
}

const item = $input.first().json;
const parsed = safeParse(item.output || item);
// SPLITTER_FALLBACK_TO_NORMALIZED_UNITS_V5
let units = Array.isArray(parsed.units) ? parsed.units.map(toInternalUnit) : [];
if (!units.length) {
  try {
    const normalizedUnits = $('Normalize Execution Units').first().json.units;
    if (Array.isArray(normalizedUnits) && normalizedUnits.length) {
      units = normalizedUnits.map(toInternalUnit);
    }
  } catch (e) {}
}

// SINGLE_PLAN_BOUNDARY_V5
// Normalize Execution Units owns the executable plan. Query Normalizer may
// refine parameters for an existing unit, but it cannot add, remove, reorder,
// or change tools. Reconcile by the stable unit_id + tool identity and always
// emit every planned unit.
function reconcileNormalizedParamsWithPlannedUnits(normalized) {
  let planned = [];
  try {
    planned = asArray($('Normalize Execution Units').first().json.units).map(toInternalUnit);
  } catch (e) {}
  if (!planned.length) return asArray(normalized);

  const normalizedByIdentity = new Map();
  for (const candidate of asArray(normalized)) {
    const identity = `${Number(candidate?.unit_id)}|${String(candidate?.tool || '')}`;
    if (!normalizedByIdentity.has(identity)) normalizedByIdentity.set(identity, candidate);
  }

  return planned.map(original => {
    const identity = `${Number(original?.unit_id)}|${String(original?.tool || '')}`;
    const candidate = normalizedByIdentity.get(identity);
    if (!candidate) return cloneForContract(original);

    const merged = {
      ...original,
      ...candidate,
      unit_id: original.unit_id,
      tool: original.tool,
      depends_on: cloneForContract(asArray(original.depends_on)),
      required_evidence_types: cloneForContract(asArray(original.required_evidence_types)),
      optional_evidence_types: cloneForContract(asArray(original.optional_evidence_types)),
      allow_synthesis: original.allow_synthesis,
      params: { ...asObject(original.params), ...asObject(candidate.params) }
    };

    if (original.tool === 'direct_response') {
      for (const key of ['text', 'conversation_turns', 'fact_cards', 'topic_summaries', 'event_status', 'memory_resolution', 'matched_fact_cards', 'safe_response']) {
        if (asObject(original.params)[key] !== undefined) merged.params[key] = cloneForContract(asObject(original.params)[key]);
      }
    }
    for (const key of ['presence_probe', 'presence_probe_strategy']) {
      if (asObject(original.params)[key] !== undefined) merged.params[key] = cloneForContract(asObject(original.params)[key]);
    }
    return merged;
  });
}

function cloneForContract(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

units = reconcileNormalizedParamsWithPlannedUnits(units);
units = keepOnlyDirectNoRetrievalIfPresent(collapseDuplicateArcticFindTags(units));

const rawBuilder = $('Execution Unit Builder').first().json;
const builder = {
  ...rawBuilder,
  catalog: toInternalCatalog(rawBuilder.catalog || {}),
  completed_units: Array.isArray(rawBuilder.completed_units)
    ? rawBuilder.completed_units.map(toInternalUnit)
    : []
};

const ctx = {
  catalog: builder.catalog || {},
  originalUserMessage: builder.originalUserMessage || '',
  chatSessionId: builder.chatSessionId || '',
  redisSessionKey: builder.redisSessionKey || '',
  plan_intent: builder.plan_intent || 'qa',
  completed_units: Array.isArray(builder.completed_units) ? builder.completed_units : [],
  ragProfiledParts: new Set()
};


function isCauseHypothesisOnlyText(text) {
  const q = String(text || '');
  const asksCause = /原因|可能|为什么|为何|cause|causes|possible\s+reason|why/i.test(q);
  const asksData = /历史|实时|数据库|时序|趋势|筛|查|统计|从数据|看数据|historical|real-time|trend|statistics|from\s+data|based\s+on\s+data/i.test(q);
  return asksCause && !asksData;
}

function limitCauseHypothesisUnits(list, ctx) {
  const units = Array.isArray(list) ? list : [];
  // CAUSE_LIMIT_KEEPS_DATA_UNITS_V7
  // 原判据是问句措辞：含「原因|可能|…」且不含「历史|实时|数据库|…」即判为纯推测题，
  // 再把 units 整体替换成 ≤2 个检索单元，取数单元被连带丢弃。
  // report8 Q2（exec 140783 / 149342）问「以 2025 年 7 月的实际运行数据为基准…及其可能影响」：
  // 「可能」命中，而「实际运行数据」不在数据词表里，7 个单元只剩 2 个，整条取数链消失。
  // 改用结构化判据：规划器只要排了取数单元或按期核验单元，就说明本轮需要数据，不做限额；
  // 仅当整份计划都是检索单元时才沿用原限额（限的本就是检索变体的扇出）。
  const planWantsData = units.some(u =>
    String(u?.tool || '') !== 'ragflow_retrieval' ||
    String(u?.question_part || '') === 'period_verification'
  );
  if (planWantsData) return units;
  if (!isCauseHypothesisOnlyText(ctx?.originalUserMessage || '')) return units;

  const rag = units.filter(u => String(u?.tool || '') === 'ragflow_retrieval');
  if (!rag.length) return units;

  const questionIsZh = isChineseText(ctx?.originalUserMessage || '');
  const preferred = questionIsZh
    ? rag.filter(u => !String(u?.lang_variant || '').startsWith('en_') && String(u?.lang_variant || '') !== 'en_scoped')
    : rag.filter(u => !String(u?.lang_variant || '').startsWith('zh_') && String(u?.lang_variant || '') !== 'zh_scoped');

  const chosen = (preferred.length ? preferred : rag).slice(0, 2);
  return chosen.length ? chosen : rag.slice(0, 2);
}

// SPECIAL_TAG_LOCK_REMOVED_V5
// Runtime units are governed only by normalized generic contracts.

// FINAL_MEASURED_PRESENCE_CONTRACT_V5
function compactSemanticKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function semanticKeysOverlap(left, right) {
  const a = compactSemanticKey(left);
  const b = compactSemanticKey(right);
  if (!a || !b) return false;
  const minimum = /[\u3400-\u9fff]/.test(a + b) ? 4 : 6;
  return Math.min(a.length, b.length) >= minimum && (a.includes(b) || b.includes(a));
}

function asksMeasuredPresence(text) {
  const q = String(text || '');
  const asksHistory = /历史|实时数据库|历史库|时序|historian|historical|time[-\s]?series|real[-\s]?time\s+database/i.test(q);
  const asksPresence = /是否存在|有没有|有无|有效数据|可直接使用|缺失|候选|数据可用|存在性|availability|available|exist|missing|candidate|usable|non[-\s]?null/i.test(q);
  return asksHistory && asksPresence;
}

function isExactHistorianTag(value) {
  const text = String(value || '').trim();
  return /\d/.test(text) && /^[A-Z][A-Z0-9_]{1,30}\.(?:PV|SP|OP|MV|SV|CV)$/i.test(text);
}

function semanticPresenceColumns(unit) {
  if (unit?.tool !== 'arctic_read' || unit?.params?.presence_probe !== true) return [];
  return (Array.isArray(unit.params?.columns) ? unit.params.columns : [])
    .map(value => String(value || '').trim())
    .filter(value => value && !value.startsWith('$ref:') && !isExactHistorianTag(value));
}

function plannedFactorNames(list) {
  const names = [];
  for (const unit of (Array.isArray(list) ? list : [])) {
    if (!unit) continue;
    if (unit.tool === 'arctic_resolve_factors') {
      for (const factor of (Array.isArray(unit.params?.factors) ? unit.params.factors : [])) {
        const name = typeof factor === 'string'
          ? factor
          : String(factor?.name || factor?.query || factor?.factor || '').trim();
        if (name) names.push(name);
      }
      continue;
    }
    const semanticColumns = semanticPresenceColumns(unit);
    if (semanticColumns.length) {
      names.push(...semanticColumns);
      const query = String(unit.params?.query || '').trim();
      if (query) {
        names.push(...query
          .split(/\s*(?:\||,|，|;|；|、|\r?\n)\s*|\s+/)
          .map(value => String(value || '').trim())
          .filter(Boolean));
      }
      continue;
    }
    if (unit.tool !== 'arctic_find_tags') continue;
    const query = String(unit.params?.query || '').trim();
    if (!query) continue;
    const cjkParts = query
      .split(/\s*(?:\||,|，|;|；|、|\r?\n)\s*|\s+/)
      .map(value => String(value || '').trim())
      .filter(value => /[\u3400-\u9fff]/.test(value));
    if (cjkParts.length) names.push(...cjkParts);
    else names.push(query);
  }
  return uniqueOrdered(names);
}

function inheritedConfirmedFactorSubjects(seedNames) {
  let state = {};
  try {
    // PRESENCE_STATE_READ_AND_TRACE_V5
    const capture = $('Relevant Memory Retriever').first().json || {};
    const compact = capture.retrieval_state;
    const full = capture.retrieval_state;
    state = compact && typeof compact === 'object' && Object.keys(compact).length
      ? compact
      : (full && typeof full === 'object' ? full : {});
  } catch (e) {}

  const anchors = uniqueOrdered(
    (Array.isArray(seedNames) ? seedNames : []).concat([
      state.latest_resolved_question,
      state.latest_topic
    ])
  );
  const relatedTurns = new Set();
  for (const card of (Array.isArray(state.question_memory_cards) ? state.question_memory_cards : [])) {
    const cardTerms = (Array.isArray(card?.entities) ? card.entities : [])
      .concat([card?.current_question, card?.resolved_question])
      .filter(Boolean);
    if (!anchors.some(anchor => cardTerms.some(term => semanticKeysOverlap(anchor, term)))) continue;
    const turn = String(card?.internal?.turn_ref || card?.turn_ref || '').trim();
    if (turn) relatedTurns.add(turn);
  }

  const subjects = [];
  for (const fact of (Array.isArray(state.fact_cards) ? state.fact_cards : [])) {
    if (!relatedTurns.has(String(fact?.source_turn || '').trim())) continue;
    if (String(fact?.status || '').trim().toLowerCase() !== 'confirmed') continue;
    const subject = String(fact?.subject || '').trim();
    if (subject) subjects.push(subject);
  }
  return uniqueOrdered(subjects);
}

// STRUCTURED_REQUIRED_INPUT_INHERITANCE_V5
// Availability follow-ups inherit the latest evidence-grounded required-input
// inventory. The inventory is data, not a fixed domain list: it is rebuilt
// from conversation fact cards on every turn.
function splitStructuredRequiredInputs(value) {
  const splitTopLevel = (text, delimiters) => {
    const parts = [];
    let current = '';
    let depth = 0;
    for (const char of String(text || '')) {
      if (char === '(' || char === '（') depth += 1;
      if (char === ')' || char === '）') depth = Math.max(0, depth - 1);
      if (depth === 0 && delimiters.has(char)) {
        if (current.trim()) parts.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  };
  const parts = splitTopLevel(
    String(value || '').replace(/^[^：:]{0,40}[：:]/, ''),
    new Set(['，', ',', '；', ';', '、', '\n'])
  )
    .map(item => item.replace(/\[[EC]\d+\]/g, '').trim())
    .filter(Boolean);
  const expanded = [];
  for (const part of parts) {
    const slashParts = splitTopLevel(part, new Set(['/', '／']));
    const slash = slashParts.length === 2 ? [part, slashParts[0], slashParts[1]] : null;
    if (!slash) {
      expanded.push(part);
      continue;
    }
    const left = slash[1].trim();
    const right = slash[2].trim();
    const measurementSuffix = right.match(/(差压|压差|压降|压力|顶压|静压|背压|密度|流量|流率|流速|温度|料位|液位|开度|阀位)$/)?.[1] || '';
    // COORDINATED_FACTOR_EXPANSION_V5
    // "立管/提升管密度" shares only the measurement suffix, while
    // "待生/再生滑阀压降" shares an equipment phrase plus that suffix.
    // Detect this grammatically rather than enumerating whole factors.
    const leftHasEquipment = /(?:阀|管|器|塔|泵|机|床|板|段)$/.test(left);
    const rightEquipmentTail = right.match(/((?:滑阀|塞阀|阀门|立管|提升管|分布板|分布管|压缩机|反应器|再生器|沉降器|旋风分离器).*)$/)?.[1] || '';
    const sharedTail = leftHasEquipment
      ? measurementSuffix
      : (rightEquipmentTail || measurementSuffix);
    expanded.push(`${left}${sharedTail}`);
    expanded.push(right);
  }
  return uniqueOrdered(expanded);
}

function structuredRequiredInputProfiles(nonHistorianOnly = false) {
  let state = {};
  try {
    const relevant = $('Relevant Memory Retriever').first().json || {};
    const capture = $('Capture context').first().json || {};
    const compact = relevant.retrieval_state && typeof relevant.retrieval_state === 'object'
      ? relevant.retrieval_state
      : {};
    const full = capture.conversation_state && typeof capture.conversation_state === 'object'
      ? capture.conversation_state
      : {};
    // Required-input cards are already compact structured facts. Preserve
    // their classification fields even when general memory retrieval projects
    // a smaller schema for prose context.
    state = Array.isArray(full.fact_cards) && full.fact_cards.some(fact =>
      String(fact?.relation || '').trim().replace(/[\s-]+/g, '_') === 'required_input'
    ) ? full : compact;
  } catch (e) {}
  const facts = Array.isArray(state.fact_cards) ? state.fact_cards : [];
  const atomicInventory = facts.slice().reverse().find(fact =>
    /^(?:required_input)$/i.test(
      String(fact?.relation || '').trim().replace(/[\s-]+/g, '_')
    ) &&
    String(fact?.status || '').toLowerCase() === 'confirmed' &&
    fact?.evidence_grounded === true
  );
  if (atomicInventory) {
    const sourceTurn = String(atomicInventory.source_turn || '');
    // Follow the explicit question-memory links for the current calculation
    // chain. This recovers inputs established by an immediately related prior
    // question without importing unrelated facts from the whole conversation.
    const relatedSourceTurns = new Set([sourceTurn]);
    const questionCards = Array.isArray(state.question_memory_cards)
      ? state.question_memory_cards
      : [];
    const sourceCard = questionCards.slice().reverse().find(card =>
      String(card?.internal?.turn_ref || card?.turn_ref || '') === sourceTurn
    );
    for (const related of (Array.isArray(sourceCard?.related_questions)
      ? sourceCard.related_questions
      : [])) {
      const turn = String(
        related?.internal?.turn_ref || related?.turn_ref || related?.source_turn || ''
      ).trim();
      if (turn) relatedSourceTurns.add(turn);
    }
    return facts.filter(fact =>
      relatedSourceTurns.has(String(fact?.source_turn || '')) &&
      /^(?:required_input)$/i.test(
        String(fact?.relation || '').trim().replace(/[\s-]+/g, '_')
      ) &&
      String(fact?.status || '').toLowerCase() === 'confirmed' &&
      fact?.evidence_grounded === true &&
      (nonHistorianOnly
        ? String(fact?.historian_relevance || '').toLowerCase() === 'not_expected'
        : String(fact?.historian_relevance || 'direct').toLowerCase() !== 'not_expected')
    ).flatMap(fact => {
      const name = String(fact.value || fact.subject || '').trim();
      const parenthetical = name.match(/^(.+?)[\uff08(]([^\uff09)]+)[\uff09)]$/);
      const quantitySource = parenthetical ? parenthetical[1] : name;
      const quantity = quantitySource.match(/(\u5bc6\u5ea6|\u538b\u964d|\u5dee\u538b|\u538b\u529b|\u6d41\u91cf|\u6599\u4f4d|\u6db2\u4f4d|\u5f00\u5ea6)$/)?.[1] || '';
      let names = splitStructuredRequiredInputs(name);
      if (parenthetical && quantity) {
        const components = splitStructuredRequiredInputs(parenthetical[2])
          .map(value => value.trim())
          .filter(Boolean);
        if (components.length > 1) {
          names = components.flatMap(component => {
            const hasQuantity = /(\u5bc6\u5ea6|\u538b\u964d|\u5dee\u538b|\u538b\u529b|\u6d41\u91cf|\u6599\u4f4d|\u6db2\u4f4d|\u5f00\u5ea6|\u62bd\u529b)$/.test(component);
            return splitStructuredRequiredInputs(hasQuantity ? component : `${component}${quantity}`);
          });
        }
      }
      return uniqueOrdered(names).map(expandedName => ({
        name: expandedName,
        aliases: uniqueOrdered((fact.aliases || []).concat([name])),
        source_turn: String(fact.source_turn || sourceTurn),
        input_class: String(fact.input_class || ''),
        historian_relevance: String(fact.historian_relevance || 'direct')
      }));
    }).filter(item => item.name);
  }
  // REQUIRED_INPUT_RELATION_NORMALIZATION_V5
  // Finalizers may emit singular/plural and active/passive relation labels.
  // Treat equivalent relation spellings as one structured contract.
  const inventory = facts.slice().reverse().find(fact =>
    /^(?:requires?_inputs?|required_inputs?)$/i.test(
      String(fact?.relation || '').trim().replace(/[\s-]+/g, '_')
    ) &&
    String(fact?.status || '').toLowerCase() === 'confirmed' &&
    fact?.evidence_grounded === true
  );
  if (!inventory) return [];
  const profiles = splitStructuredRequiredInputs(inventory.value).map(name => ({
    name,
    aliases: [],
    source_turn: String(inventory.source_turn || '')
  }));

  for (const fact of facts) {
    if (String(fact?.source_turn || '') !== String(inventory.source_turn || '')) continue;
    if (String(fact?.entity_type || '').toLowerCase() !== 'tag') continue;
    if (String(fact?.status || '').toLowerCase() !== 'confirmed') continue;
    if (fact?.evidence_grounded !== true) continue;
    const tags = (Array.isArray(fact.entities) ? fact.entities : [])
      .map(value => String(value || '').trim())
      .filter(value => /[A-Z]/i.test(value) && /\d/.test(value));
    if (!tags.length) continue;
    const label = String(fact.subject || '')
      .replace(new RegExp(tags.map(tag => tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi'), '')
      .trim();
    let profile = profiles.find(item =>
      semanticKeysOverlap(item.name, label) ||
      semanticKeysOverlap(item.name, String(fact.value || ''))
    );
    if (!profile && label) {
      profile = { name: label, aliases: [], source_turn: String(inventory.source_turn || '') };
      profiles.push(profile);
    }
    if (profile) {
      profile.aliases = uniqueOrdered((profile.aliases || []).concat(tags));
      profile.preferred_tag_query = uniqueOrdered(tags.concat([profile.name])).join(' ');
    }
  }
  return profiles;
}

function mergePresenceFactorProfiles(planned, structured, inherited) {
  const profiles = [];
  const add = value => {
    const incoming = value && typeof value === 'object'
      ? { ...value, name: String(value.name || '').trim() }
      : { name: String(value || '').trim(), aliases: [] };
    if (!incoming.name) return;
    const existing = profiles.find(item =>
      semanticKeysOverlap(item.name, incoming.name)
    );
    if (!existing) {
      profiles.push({ ...incoming, aliases: uniqueOrdered(incoming.aliases || []) });
      return;
    }
    existing.aliases = uniqueOrdered(
      (existing.aliases || []).concat(incoming.aliases || [])
    );
    if (!existing.preferred_tag_query && incoming.preferred_tag_query) {
      existing.preferred_tag_query = incoming.preferred_tag_query;
    }
  };
  planned.forEach(add);
  structured.forEach(add);
  if (profiles.length < 2) inherited.forEach(add);
  return profiles;
}

function canonicalizeMeasuredPresencePlan(list) {
  const source = Array.isArray(list) ? list : [];
  if (!asksMeasuredPresence(ctx.originalUserMessage)) return source;
  if (!source.some(unit =>
    unit?.tool === 'arctic_find_tags' ||
    unit?.tool === 'arctic_resolve_factors' ||
    semanticPresenceColumns(unit).length > 0
  )) return source;

  const planned = plannedFactorNames(source);
  const structured = structuredRequiredInputProfiles();
  const inherited = inheritedConfirmedFactorSubjects(planned);

  // ANAPHORIC_REQUIRED_INPUT_AUTHORITY_V5
  // A follow-up such as "these inputs" points to the latest confirmed
  // required-input inventory. Planner-generated abstractions must not be
  // unioned into that inventory. When the current question explicitly names
  // factors, the normal merge path remains available.
  const currentQuestion = String(ctx.originalUserMessage || '');
  const anaphoricReference = /这些|上述|前述|刚才(?:这些|提到的)?|它们|该(?:批|组|些)?(?:输入|因子|变量|测点)|these\s+(?:inputs|factors|variables|measurements)|the\s+(?:above|previous|aforementioned)\s+(?:inputs|factors|variables)/i.test(currentQuestion);
  const explicitCurrentTags = currentQuestion.match(/\b[A-Z]{1,8}[A-Z0-9_]*\d{2,8}[A-Z0-9_]*(?:\.[A-Z0-9_]+)?\b/g) || [];
  const explicitCurrentList = /(?:包括|分别是|如下|例如|such\s+as|including|namely)\s*[:：]?/i.test(currentQuestion) ||
    explicitCurrentTags.length >= 2;
  const structuredOwnsReference =
    anaphoricReference && !explicitCurrentList && structured.length >= 2;
  const factors = structuredOwnsReference
    ? mergePresenceFactorProfiles([], structured, [])
    : mergePresenceFactorProfiles(planned, structured, inherited);
  if (factors.length < 1) return source;

  const config = configuredArcticBatching();
  const defaultTarget = config.defaultTarget || {};
  return [{
    unit_id: 1,
    tool: 'arctic_resolve_factors',
    params: {
      factors,
      ...(defaultTarget.library ? { library: defaultTarget.library } : {}),
      ...(defaultTarget.symbol ? { symbol: defaultTarget.symbol } : {}),
      contract_source: 'final_measured_presence_contract'
    },
    depends_on: [],
    question_part: 'period_verification',
    required_evidence_types: ['tag_mapping', 'measured_data_availability'],
    optional_evidence_types: [],
    allow_synthesis: true,
    presence_contract_debug: {
      planned_factors: planned,
      structured_required_inputs: structured.map(item => item.name),
      structured_non_historian_inputs: structuredRequiredInputProfiles(true).map(item => item.name),
      inherited_confirmed_subjects: inherited,
      inheritance_applied: structured.length > 0 || planned.length < 2,
      anaphoric_reference: anaphoricReference,
      explicit_current_list: explicitCurrentList,
      structured_inventory_authoritative: structuredOwnsReference,
      factor_source: structuredOwnsReference
        ? 'structured_required_inputs_for_anaphoric_follow_up'
        : (structured.length
          ? 'current_plan_plus_structured_required_inputs'
          : (planned.length >= 2 ? 'current_plan' : 'current_plus_history_fallback')),
      final_factor_count: factors.length
    }
  }];
}

units = canonicalizeMeasuredPresencePlan(units);

// PART_FANOUT_MERGE_V6 — 按问题部分扇出检索单元（中文优先判据）。
// 放在 5.0 纵向扇出循环之前，两套机制叠加：先按问题部分拆，再按因子/测点拆。
try {
  units = ensureDeterministicRagIntentUnits(units, ctx);
} catch (e) {
  // 扇出失败不应影响主计划
}

// Clear stale chain state
const chainKey = 'chain_' + (ctx.chatSessionId || 'default');
const resultNormSessionKey = ctx.chatSessionId || 'default';
const sd = $getWorkflowStaticData('global');
sd[chainKey] = [];
sd.result_norm_active_session = resultNormSessionKey;
for (const key of [resultNormSessionKey, 'default']) {
  for (const tool of ['arctic_find_tags', 'arctic_stats', 'arctic_read', 'arctic_describe', 'arctic_analyze']) {
    delete sd[`result_norm_unit_${key}_${tool}`];
  }
}

const expanded = [];

for (let rawUnit of units) {
  const unit = sanitizeArcticPlaceholders(rawUnit);

  if (unit?.tool !== 'ragflow_retrieval') {
    expanded.push(unit);
    continue;
  }

  const group = `retrieval_group_${unit.unit_id || expanded.length + 1}`;
  const candidates = chooseScopedCandidates(unit, ctx);

  if (!candidates.length) {
    expanded.push(unit);
    continue;
  }

  expanded.push(buildGroupedRagUnit(unit, candidates, ctx, group));
}

// ARCTIC_STRUCTURAL_WORKLOAD_BATCHING_V5
function configuredArcticBatching() {
  let arctic = {};
  try {
    const raw = $('Workflow Configuration').first().json.run_params;
    const params = raw && typeof raw === 'object' ? raw : JSON.parse(raw || '{}');
    arctic = params?.arcticdb && typeof params.arcticdb === 'object' ? params.arcticdb : {};
  } catch (e) {}
  const bounded = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 && number <= 24 ? Math.floor(number) : fallback;
  };
  const defaultTarget = arctic.default_target && typeof arctic.default_target === 'object'
    ? arctic.default_target
    : {};
  return {
    factorBatchSize: bounded(arctic.resolve_factor_batch_size, 3),
    factorLookupTopK: bounded(arctic.factor_lookup_top_k, 5),
    verticalQueryTermLimit: bounded(arctic.vertical_query_term_limit, 6),
    verticalContextAliasLimit: bounded(arctic.vertical_context_alias_limit, 3),
    verticalQueryBatchSize: bounded(arctic.vertical_query_batch_size, 18),
    verticalOutputCharBudget: bounded(arctic.vertical_output_char_budget, 7000),
    verticalContextCandidateLimit: bounded(arctic.vertical_context_candidate_limit, 6),
    presenceStatsDependencyBatchSize: bounded(arctic.presence_stats_dependency_batch_size, 20),
    // RESOLUTION_FALLBACK_AND_LABEL_V5
    // The deployed Arctic service has no server-side selection key. If runtime
    // config lookup is unavailable, retain the workflow's local metadata path.
    factorResolutionMode: String(arctic.factor_resolution_mode || 'metadata_search').trim().toLowerCase(),
    defaultTarget: {
      library: String(defaultTarget.library || '').trim(),
      symbol: String(defaultTarget.symbol || '').trim()
    },
    analyzeColumnBatchSize: bounded(arctic.analyze_column_batch_size, 3),
    separableAnalysisTypes: new Set(
      (Array.isArray(arctic.column_separable_analysis_types)
        ? arctic.column_separable_analysis_types
        : ['data_quality', 'period_profile', 'column_statistics', 'anomaly_windows'])
        .map(value => String(value || '').toLowerCase())
        .filter(Boolean)
    )
  };
}

function referencedUnitIds(source) {
  const referenced = new Set();
  for (const unit of source) {
    for (const dep of (Array.isArray(unit?.depends_on) ? unit.depends_on : [])) referenced.add(Number(dep));
    const blob = JSON.stringify(unit?.params || {});
    const re = /\$ref:step_?(\d+)\./g;
    let match;
    while ((match = re.exec(blob)) !== null) referenced.add(Number(match[1]));
  }
  return referenced;
}

function splitIndependentArcticWorkloads(list) {
  const source = Array.isArray(list) ? list : [];
  const config = configuredArcticBatching();
  const referenced = referencedUnitIds(source);
  let nextId = source.reduce((max, unit) => Math.max(max, Number(unit?.unit_id) || 0), 0) + 1;
  const out = [];

  for (const unit of source) {
    const params = unit?.params && typeof unit.params === 'object' ? unit.params : {};
    const id = Number(unit?.unit_id);

    // DETERMINISTIC_FACTOR_PRESENCE_FALLBACK_V5
    if (unit?.tool === 'arctic_resolve_factors') {
      const factors = Array.isArray(params.factors) ? params.factors : [];
      const deterministicFallback = ['metadata_search', 'deterministic', 'no_server_llm']
        .includes(config.factorResolutionMode);

      if (deterministicFallback && factors.length) {
        const sourceDependencies = Array.isArray(unit.depends_on) ? [...unit.depends_on] : [];
        const library = String(params.library || config.defaultTarget.library || '').trim();
        const symbol = String(params.symbol || config.defaultTarget.symbol || '').trim();
        const tagSteps = [];

        // T4_GLOBAL_METADATA_DISCOVERY_V5
        // Discover factor-to-tag mappings from the global metadata catalog,
        // where descriptions may be richer than the target historian symbol.
        // The later stats call still verifies every selected tag against the
        // configured target library and symbol.
        // COMPACT_VERTICAL_SEMANTIC_RETRIEVAL_V5
        // Build a metadata query from independent semantic dimensions. This
        // keeps batching as an execution concern; factors are never joined as
        // opaque "A | B | C" phrases.
        const measurementAliases = [
          { test: /差压|压差|压降|differential\s+pressure|pressure\s+(?:difference|drop)|\bdp\b/i,
            terms: ['差压', '压差', '压降', 'differential pressure', 'pressure difference', 'pressure drop', 'dp'] },
          { test: /压力|顶压|静压|背压|pressure/i,
            terms: ['压力', 'pressure', 'top pressure', 'static pressure', 'back pressure'] },
          { test: /料位|液位|level/i, terms: ['料位', '液位', 'level'] },
          { test: /密度|density/i, terms: ['密度', 'density'] },
          { test: /流量|流率|流速|速度|flow|rate|velocity|speed/i,
            terms: ['流量', '流率', '流速', '速度', 'flow', 'rate', 'velocity', 'speed'] },
          { test: /开度|阀位|opening|position/i, terms: ['开度', '阀位', 'opening', 'position'] },
          { test: /温度|temperature/i, terms: ['温度', 'temperature'] }
        ];

        const uniqueText = values => Array.from(new Set(
          values
            .map(entry => String(entry || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
        ));

        // GENERIC_VERTICAL_IO_COMPACTION_V5
        // Build one compact semantic representation per factor. Character
        // n-grams inflate every request and weaken retrieval with fragments;
        // structured dimensions and aliases preserve meaning without that
        // duplication. These limits are execution budgets, not domain rules.
        const compactText = (value, maxChars = 120) =>
          String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
        const aliasLimit = Math.max(1, Math.min(config.verticalContextAliasLimit, 8));
        const queryTermLimit = Math.max(3, Math.min(config.verticalQueryTermLimit, 12));

        // PRIOR_FACTOR_CONTEXT_RECALL_V5
        // Elliptical availability questions often inherit conceptual factors
        // from the preceding answer. Recover one factor-specific sentence from
        // recent question memory so catalog retrieval retains equipment and
        // location context. Selection is similarity-based and contains no
        // fixed tag, factor, test id, or question text.
        const priorFactorContext = factorName => {
          let state = {};
          try {
            const capture = $('Relevant Memory Retriever').first().json || {};
            state = capture.retrieval_state && typeof capture.retrieval_state === 'object'
              ? capture.retrieval_state
              : {};
          } catch (e) {}
          const factorKey = compactSemanticKey(factorName);
          if (!factorKey) return '';
          const factorChars = new Set(Array.from(factorKey));
          const cards = Array.isArray(state.question_memory_cards)
            ? state.question_memory_cards.slice(-4).reverse()
            : [];
          let best = { score: 0, text: '' };
          for (const card of cards) {
            const source = String(card?.current_answer_summary || '');
            const sentences = source
              .split(/(?<=[。！？.!?；;])\s*/u)
              .map(value => value.replace(/\[[EC]\d+\]/g, '').replace(/\s+/g, ' ').trim())
              .filter(Boolean);
            for (const sentence of sentences) {
              const sentenceKey = compactSemanticKey(sentence);
              if (!sentenceKey) continue;
              const exact = sentenceKey.includes(factorKey) ? 1 : 0;
              let overlap = 0;
              for (const char of factorChars) {
                if (sentenceKey.includes(char)) overlap += 1;
              }
              const ratio = factorChars.size ? overlap / factorChars.size : 0;
              const score = exact * 2 + ratio;
              if (overlap >= 3 && ratio >= 0.6 && score > best.score) {
                best = { score, text: sentence };
              }
            }
          }
          return compactText(best.text, 180);
        };

        // FACTOR_LOCAL_QUERY_CONSTRUCTION_V5
        // FACTOR_QUERY_CROSS_CONTAMINATION_GUARD_V5
        const factorNames = uniqueText(factors.map(value => {
          const row = value && typeof value === 'object' && !Array.isArray(value) ? value : { name: value };
          return compactText(row.name || row.factor || row.label || row.query || row.preferred_tag_query);
        }));

        function conversationAliasVariants(name) {
          let state = {};
          try { state = $('Relevant Memory Retriever').first().json.retrieval_state || {}; } catch (e) {}
          const text = (Array.isArray(state.turns) ? state.turns : [])
            .slice(-6)
            .map(turn => String(turn && turn.assistant_answer || ''))
            .join(' ');
          const variants = [name];
          const pattern = /([\p{L}\p{N}]{2,24})[（(]([\p{L}\p{N}]{2,16})[）)]/gu;
          const matchingSuffix = (container, captured) => {
            const value = compactText(captured, 40);
            for (let size = Math.min(12, value.length); size >= 2; size -= 1) {
              const suffix = value.slice(-size);
              if (container.includes(suffix)) return suffix;
            }
            return '';
          };
          let match;
          while ((match = pattern.exec(text)) !== null) {
            const left = compactText(match[1], 40);
            const right = compactText(match[2], 40);
            const leftTerm = matchingSuffix(name, left);
            const rightTerm = matchingSuffix(name, right);
            if (leftTerm && right) variants.push(name.replace(leftTerm, right));
            if (rightTerm && left) variants.push(name.replace(rightTerm, left));
          }
          return uniqueText(variants);
        }

        function localFactorContext(name, source) {
          const text = compactText(source, 180);
          const nameKey = compactSemanticKey(name);
          if (!text || !compactSemanticKey(text).includes(nameKey)) return '';
          if (/\d/.test(text) || /[\/／]/.test(text)) return '';
          const hasSibling = factorNames.some(other => {
            const otherKey = compactSemanticKey(other);
            return otherKey && otherKey !== nameKey && compactSemanticKey(text).includes(otherKey);
          });
          if (hasSibling) return '';
          return text;
        }

        function lexicalFactorVariants(name) {
          const variants = [name];
          if (/顶压力/.test(name)) {
            variants.push(name.replace(/顶压力/g, '顶部压力'));
            variants.push(name.replace(/顶压力/g, '顶压'));
          }
          if (/顶部压力/.test(name)) variants.push(name.replace(/顶部压力/g, '顶压'));
          if (/顶压(?!力)/.test(name)) {
            variants.push(name.replace(/顶压/g, '顶压力'));
            variants.push(name.replace(/顶压/g, '顶部压力'));
          }
          if (/静压/.test(name)) variants.push(name.replace(/静压/g, '静压力'));
          if (/背压/.test(name)) variants.push(name.replace(/背压/g, '背压力'));
          if (/压降/.test(name)) {
            variants.push(name.replace(/压降/g, '差压'));
            variants.push(name.replace(/压降/g, '压差'));
          }
          return uniqueText(variants);
        }

        const verticalFactorProfile = (factor, index) => {
          const value = factor && typeof factor === 'object' && !Array.isArray(factor)
            ? factor
            : { name: String(factor || '') };
          const name = compactText(
            value.name || value.factor || value.label || value.query || value.preferred_tag_query
          );
          const recalled = value.process_context || value.description || priorFactorContext(name);
          const processContext = localFactorContext(name, recalled);
          const measurementType = compactText(value.measurement_type);
          const searchTerms = uniqueText(Array.isArray(value.search_terms) ? value.search_terms : [])
            .map(term => compactText(term, 80))
            .filter(Boolean);
          const aliases = uniqueText([
            ...searchTerms,
            ...(Array.isArray(value.aliases) ? value.aliases : [])
          ])
            .map(alias => compactText(alias, 80))
            .filter(Boolean)
            .slice(0, aliasLimit);
          const semanticSource = uniqueText([
            compactText(value.preferred_tag_query),
            ...searchTerms,
            ...conversationAliasVariants(name).flatMap(lexicalFactorVariants),
            ...aliases,
            processContext,
            measurementType
          ]);
          // Measurement dimensions are derived only from factor-local fields.
          // A neighbouring quantity mentioned in recalled prose must not alter
          // this factor's query.
          const localMeasurementSource = uniqueText([
            name,
            measurementType,
            ...aliases
          ]).join(' ');
          const dimensions = measurementAliases
            .filter(rule => rule.test.test(localMeasurementSource))
            .flatMap(rule => rule.terms);
          const queryTerms = uniqueText([...semanticSource, ...dimensions])
            .slice(0, queryTermLimit);
          return {
            factor_id: compactText(value.id || value.factor_id || `factor_${index + 1}`, 80),
            name,
            process_context: processContext,
            measurement_type: measurementType,
            aliases,
            query: queryTerms.join(' ')
          };
        };

        // VERTICAL_MULTI_QUERY_RETRIEVAL_V5
        // Keep every factor as an independent semantic query, but execute the
        // queries inside one Arctic Agent unit. This preserves per-factor
        // recall while avoiding a full n8n LLM chain for every factor.
        const factorProfiles = factors
          .map(verticalFactorProfile)
          .filter(profile => Boolean(profile.query));

        // GENERIC_VERTICAL_TRUNCATION_GUARD_V5
        // Bound each Agent response structurally. Every factor is retained,
        // while oversized factor sets become independent metadata batches.
        if (factorProfiles.length) {
          // Keep metadata rerank responses below the model output envelope.
          // Broad factors can return many candidates; small independent
          // batches preserve every factor without risking a truncated JSON.
          const batchSize = Math.min(3, config.verticalQueryBatchSize);
          const totalBatches = Math.ceil(factorProfiles.length / batchSize);
          for (let offset = 0; offset < factorProfiles.length; offset += batchSize) {
            const batch = factorProfiles.slice(offset, offset + batchSize);
            const findId = nextId++;
            tagSteps.push(findId);
            out.push({
              ...unit,
              unit_id: findId,
              tool: 'arctic_find_tags',
              params: {
                queries: batch.map(profile => ({
                  query: profile.query,
                  // TARGET_SCOPED_VERTICAL_LOOKUP_V5
                  // Preserve the target named by the normalized presence
                  // contract. Omitting these fields silently changes a
                  // historian-specific question into a global catalog search.
                  ...(library ? { library } : {}),
                  ...(symbol ? { symbol } : {}),
                  // STRICT_VERTICAL_SELECTION_V5
                  top_k: Math.min(18, Math.max(10, config.factorLookupTopK)),
                  semantic: true,
                  llm_select: false,
                  llm_decide: false
                }))
              },
              depends_on: sourceDependencies,
              factor_context: batch,
              factor_batch: {
                index: Math.floor(offset / batchSize) + 1,
                total: totalBatches,
                query_count: batch.length,
                total_factor_count: factorProfiles.length
              },
              output_contract: {
                max_chars: config.verticalOutputCharBudget,
                contextual_candidate_limit: Math.max(8, config.verticalContextCandidateLimit)
              },
              tag_discovery_scope: library || symbol
                ? 'target_metadata'
                : 'global_metadata',
              tag_selection_mode: 'vertical_multi_query'
            });
          }
        }

        if (tagSteps.length) {
          const dateRange = Array.isArray(params.date_range) && params.date_range.length === 2
            ? params.date_range
            : null;
          // Isolate lookup failures. A malformed response from one independent
          // metadata batch must not block historian checks for every successful
          // batch in the same turn.
          const dependencyBatchSize = Math.min(2, config.presenceStatsDependencyBatchSize);
          const totalStatsBatches = Math.ceil(tagSteps.length / dependencyBatchSize);
          for (let offset = 0; offset < tagSteps.length; offset += dependencyBatchSize) {
            const dependencyBatch = tagSteps.slice(offset, offset + dependencyBatchSize);
            let boundaryId = null;

            // For an unbounded availability question, locate the symbol's real
            // first and last index timestamps with tiny reads. The downstream
            // injector derives contiguous bounded windows from these results.
            if (!dateRange) {
              boundaryId = nextId++;
              const boundaryColumns = dependencyBatch.map(stepId => `$ref:step${stepId}.probe_tags`);
              out.push({
                ...unit,
                unit_id: boundaryId,
                tool: 'arctic_read',
                params: {
                  ...(library ? { library } : {}),
                  ...(symbol ? { symbol } : {}),
                  columns: boundaryColumns
                },
                depends_on: dependencyBatch,
                history_boundary_probe: 'start_and_end',
                history_boundary_queries: [
                  { head: 1 },
                  { tail: 1 }
                ]
              });
            }

            out.push({
              ...unit,
              unit_id: nextId++,
              tool: 'arctic_stats',
              params: {
                ...(library ? { library } : {}),
                ...(symbol ? { symbol } : {}),
                columns: boundaryId == null
                  ? dependencyBatch.map(stepId => `$ref:step${stepId}.probe_tags`)
                  // Boundary reads locate the symbol's time extent only. A
                  // column may be null at both endpoints yet contain valid
                  // records inside the history, so endpoint non-null status
                  // must never filter the full-range statistics column set.
                  : dependencyBatch.map(stepId => `$ref:step${stepId}.probe_tags`),
                ...(dateRange ? { date_range: dateRange } : {})
              },
              depends_on: dependencyBatch.concat(
                boundaryId == null ? [] : [boundaryId]
              ),
              full_history_presence: !dateRange,
              history_boundary_steps: boundaryId == null ? null : {
                start: boundaryId,
                end: boundaryId
              },
              factor_presence_fallback: {
                source_tool: 'arctic_resolve_factors',
                factor_count: factors.length,
                tag_step_ids: dependencyBatch,
                presence_batch_index: Math.floor(offset / dependencyBatchSize) + 1,
                presence_batch_total: totalStatsBatches
              }
            });
          }
          continue;
        }
      }

      if (factors.length > config.factorBatchSize && !referenced.has(id)) {
        for (let offset = 0; offset < factors.length; offset += config.factorBatchSize) {
          out.push({
            ...unit,
            unit_id: offset === 0 ? id : nextId++,
            params: {
              ...params,
              factors: factors.slice(offset, offset + config.factorBatchSize),
              factor_batch: {
                index: Math.floor(offset / config.factorBatchSize) + 1,
                total: Math.ceil(factors.length / config.factorBatchSize)
              }
            },
            depends_on: []
          });
        }
        continue;
      }
    }

    // ARCTIC_ANALYZE_SINGLE_PLAN_EXECUTION_V5
    // arctic_analyze already accepts multiple targets and columns. Preserve
    // the authoritative normalized unit so the server performs one analysis
    // and the workflow performs one synthesis, instead of multiplying both.


    out.push(unit);
  }
  return out;
}

// STRUCTURED_ANALYSIS_INTEGRITY_V5
// When history supplies exact columns for one or more registry targets, an
// empty target is not an instruction to analyze every column in another
// library. Retain only targets that explicitly own inherited columns.
function scopeAnalyzeTargetsToBoundColumns(list) {
  return (Array.isArray(list) ? list : []).map(unit => {
    if (unit?.tool !== 'arctic_analyze') return unit;
    const params = unit.params && typeof unit.params === 'object' ? unit.params : {};
    const targets = Array.isArray(params.targets) ? params.targets : [];
    const bound = targets.filter(target =>
      target &&
      Array.isArray(target.columns) &&
      target.columns.length > 0 &&
      String(target.target_resolution_source || '').trim()
    );
    const registryScoped = bound.some(target =>
      String(target.target_resolution_source || '') === 'conversation_arctic_target_registry'
    );
    if (!registryScoped || !bound.length || bound.length === targets.length) return unit;
    return {
      ...unit,
      params: { ...params, targets: bound },
      target_scope_debug: {
        requested_target_count: targets.length,
        retained_target_count: bound.length,
        dropped_unbound_target_count: targets.length - bound.length,
        policy: 'inherited_columns_require_explicit_target_ownership'
      }
    };
  });
}

const expandedForExecution = splitIndependentArcticWorkloads(
  limitCauseHypothesisUnits(scopeAnalyzeTargetsToBoundColumns(expanded), ctx)
);

// The planned Arctic units are authoritative; this stage must not synthesize a new plan.
const stabilizedUnits = expandedForExecution;

function removeRedundantPresenceReads(units) {
  const list = Array.isArray(units) ? units : [];
  const byId = new Map(
    list
      .filter(unit => unit && Number.isFinite(Number(unit.unit_id)))
      .map(unit => [Number(unit.unit_id), unit])
  );
  return list.filter(unit => {
    if (unit?.tool !== 'arctic_read' || unit?.params?.presence_probe !== true) return true;
    const dependencies = (Array.isArray(unit.depends_on) ? unit.depends_on : [])
      .map(Number)
      .filter(Number.isFinite);
    if (!dependencies.length) return true;
    const sources = dependencies.map(id => byId.get(id)).filter(Boolean);
    if (sources.length !== dependencies.length) return true;
    return !sources.every(source => source.tool === 'arctic_stats');
  });
}

// DIRECT_AVAILABILITY_FAST_PATH_V5
// Match Tools may already know the exact historian columns and emit a direct
// arctic_stats unit. Apply the same runtime boundary contract used by the
// factor-discovery path. Detection relies only on planner evidence contracts,
// never on a test question, language phrase, date, or plant tag.
function availabilityEvidenceContract(unit) {
  const required = Array.isArray(unit?.required_evidence_types)
    ? unit.required_evidence_types
    : [];
  return required.some(value =>
    /(?:data[_ -]?availability|non[_ -]?null|presence|existence)/i.test(String(value || ''))
  );
}

function splitBoundedDateRange(dateRange, maxDays = 175) {
  if (!Array.isArray(dateRange) || dateRange.length !== 2) return [];
  const startMs = Date.parse(dateRange[0]);
  const endMs = Date.parse(dateRange[1]);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];
  const span = Math.max(1, Math.min(Number(maxDays) || 175, 179)) * 86400000;
  if (endMs - startMs < span) return [];
  const windows = [];
  let cursor = startMs;
  while (cursor <= endMs && windows.length < 64) {
    const stop = Math.min(endMs, cursor + span - 1);
    windows.push([new Date(cursor).toISOString(), new Date(stop).toISOString()]);
    cursor = stop + 1;
  }
  return windows;
}

// Existence checks need per-column non-null statistics, not relationship,
// lag, or anomaly analysis. Convert only a pure data-quality request; richer
// analysis requests keep arctic_analyze unchanged.
function convertAvailabilityAnalyzeToStats(units) {
  const list = Array.isArray(units) ? units : [];
  let nextId = list.reduce(
    (maxId, unit) => Math.max(maxId, Number(unit?.unit_id) || 0),
    0
  ) + 1;
  const out = [];

  for (const unit of list) {
    const params = unit?.params && typeof unit.params === 'object' ? unit.params : {};
    const analysisTypes = Array.isArray(params.analysis_types)
      ? params.analysis_types.map(value => String(value).toLowerCase())
      : [];
    const pureQuality = analysisTypes.length > 0 && analysisTypes.every(value =>
      /^(?:data_quality|period_profile)$/.test(value)
    );
    const targets = Array.isArray(params.targets) ? params.targets : [];
    if (unit?.tool !== 'arctic_analyze' || !availabilityEvidenceContract(unit) || !pureQuality || !targets.length) {
      out.push(unit);
      continue;
    }

    const groups = new Map();
    for (const target of targets) {
      const library = String(target?.library || params.library || '').trim();
      const symbol = String(target?.symbol || params.symbol || '').trim();
      const columns = Array.isArray(target?.columns) ? target.columns.filter(Boolean) : [];
      if (!columns.length) continue;
      const key = `${library}|${symbol}`;
      if (!groups.has(key)) groups.set(key, { library, symbol, columns: [] });
      groups.get(key).columns.push(...columns);
    }
    if (!groups.size) {
      out.push(unit);
      continue;
    }

    const dateRange = Array.isArray(params.date_range) && params.date_range.length === 2
      ? params.date_range
      : null;
    const windows = splitBoundedDateRange(dateRange);
    let groupIndex = 0;
    for (const group of groups.values()) {
      const convertedId = groupIndex++ === 0 ? unit.unit_id : nextId++;
      out.push({
        ...unit,
        unit_id: convertedId,
        tool: 'arctic_stats',
        params: {
          ...(group.library ? { library: group.library } : {}),
          ...(group.symbol ? { symbol: group.symbol } : {}),
          columns: uniqueOrdered(group.columns),
          ...(!windows.length && dateRange ? { date_range: dateRange } : {})
        },
        ...(windows.length ? {
          full_history_windows: windows,
          full_available_range: true,
          verification_intent: 'bounded_full_range_presence'
        } : {}),
        converted_from_tool: 'arctic_analyze',
        conversion_reason: 'pure_availability_statistics'
      });
    }
  }
  return out;
}

function collapseDirectAvailabilityReads(units) {
  const list = Array.isArray(units) ? units : [];
  const referenced = referencedUnitIds(list);
  const config = configuredArcticBatching();
  const columnLimit = Math.max(1, Number(config.readColumnLimit) || 20);
  const groups = new Map();

  const eligible = unit => {
    const params = unit?.params && typeof unit.params === 'object' ? unit.params : {};
    const columns = Array.isArray(params.columns) ? params.columns.filter(Boolean) : [];
    const bounded = Array.isArray(params.date_range) && params.date_range.length === 2;
    return (
      unit?.tool === 'arctic_read' &&
      params.presence_probe === true &&
      !bounded &&
      columns.length > 0 &&
      columns.every(value => typeof value === 'string' && isExactHistorianTag(value)) &&
      !referenced.has(Number(unit.unit_id)) &&
      availabilityEvidenceContract(unit)
    );
  };

  for (const [index, unit] of list.entries()) {
    if (!eligible(unit)) continue;
    const params = unit.params || {};
    const dependencies = (Array.isArray(unit.depends_on) ? unit.depends_on : [])
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const key = [params.library || '', params.symbol || '', dependencies.join(',')].join('|');
    if (!groups.has(key)) groups.set(key, { firstIndex: index, units: [] });
    groups.get(key).units.push(unit);
  }

  const replacementByIndex = new Map();
  const omittedIndexes = new Set();
  for (const group of groups.values()) {
    if (!group.units.length) continue;
    const replacements = [];
    for (let offset = 0; offset < group.units.length; offset += columnLimit) {
      const batch = group.units.slice(offset, offset + columnLimit);
      const representative = batch[0];
      const params = representative.params || {};
      const columns = uniqueOrdered(batch.flatMap(unit => unit.params?.columns || []));
      replacements.push({
        ...representative,
        params: {
          ...(params.library ? { library: params.library } : {}),
          ...(params.symbol ? { symbol: params.symbol } : {}),
          columns,
          presence_probe: true
        },
        required_evidence_types: uniqueOrdered(
          batch.flatMap(unit => unit.required_evidence_types || [])
        ),
        optional_evidence_types: uniqueOrdered(
          batch.flatMap(unit => unit.optional_evidence_types || [])
        ),
        history_boundary_probe: 'start_and_end',
        history_boundary_queries: [{ head: 1 }, { tail: 1 }],
        merged_presence_unit_count: batch.length
      });
    }
    replacementByIndex.set(group.firstIndex, replacements);
    for (const unit of group.units.slice(1)) {
      const index = list.indexOf(unit);
      if (index >= 0) omittedIndexes.add(index);
    }
  }

  const out = [];
  for (const [index, unit] of list.entries()) {
    if (replacementByIndex.has(index)) out.push(...replacementByIndex.get(index));
    else if (!omittedIndexes.has(index)) out.push(unit);
  }
  return out;
}

function expandDirectAvailabilityStats(units) {
  const list = Array.isArray(units) ? units : [];
  let nextBoundaryId = list.reduce(
    (maxId, unit) => Math.max(maxId, Number(unit?.unit_id) || 0),
    0
  ) + 1;
  const expanded = [];

  for (const unit of list) {
    const params = unit?.params && typeof unit.params === 'object' ? unit.params : {};
    const columns = Array.isArray(params.columns) ? params.columns.filter(Boolean) : [];
    const bounded = Array.isArray(params.date_range) && params.date_range.length === 2;
    const concreteColumns = columns.length > 0 && columns.every(value =>
      typeof value === 'string' && !value.startsWith('$ref:')
    );
    const eligible =
      unit?.tool === 'arctic_stats' &&
      !bounded &&
      concreteColumns &&
      availabilityEvidenceContract(unit) &&
      unit.full_history_presence !== true;

    if (!eligible) {
      expanded.push(unit);
      continue;
    }

    const boundaryId = nextBoundaryId++;
    const dependencies = Array.isArray(unit.depends_on) ? unit.depends_on : [];
    expanded.push({
      ...unit,
      unit_id: boundaryId,
      tool: 'arctic_read',
      params: {
        ...(params.library ? { library: params.library } : {}),
        ...(params.symbol ? { symbol: params.symbol } : {}),
        columns
      },
      depends_on: dependencies,
      history_boundary_probe: 'start_and_end',
      history_boundary_queries: [{ head: 1 }, { tail: 1 }],
      availability_probe_for: unit.unit_id
    });
    expanded.push({
      ...unit,
      params: { ...params, columns },
      depends_on: Array.from(new Set(dependencies.concat(boundaryId))),
      full_history_presence: true,
      history_boundary_steps: { start: boundaryId, end: boundaryId }
    });
  }
  return expanded;
}



// ===== PART_FANOUT_MERGE_V6 begin =====
// DETERMINISTIC_RAG_PART_FANOUT_ZH_V6
// 此处以中文为主重写，英文模式保留在后作为兼容。
function inferRequiredRagParts(question) {
  const raw = String(question || '');
  const q = normKey(raw);
  const parts = [];
  const hit = (zh, en) => zh.test(raw) || (en ? en.test(q) : false);

  const asksForHistory = hit(
    /历史|以往|过去|曾经|发生过|事件|案例|记录|台账|月报|技术报告|事故/,
    /incident|historical|history|ever been|previous|past|case|record|monthly report/);
  const asksForCause = hit(
    /原因|为什么|为何|机理|机制|根因|成因|导致|引起|造成|why/,
    /what cause|caused|causes|why|root cause|mechanism|reason/);
  const asksForAction = hit(
    /处置|怎么办|如何处理|如何应对|措施|操作步骤|调整|排查|应急|预防|防止|维护|检修|整改/,
    /prevent|mitigat|avoid|inspection|maintenance|procedure|fix|measures|recommend/);
  const asksForRisk = hit(
    /超标|越限|超限|超出|异常|波动|风险|安全|后果|影响|联锁|跳车|停工|报警/,
    /risk|safety|consequence|impact|exceedance|alarm|abnormal|shutdown/);
  const asksForRelationship = hit(
    /关系|相关|关联|依赖|上下游|联动|滞后|连通|拓扑|影响链/,
    /relationship|correlat|dependency|upstream|downstream|interaction|lag/);
  const asksForFactors = hit(
    /因素|影响因素|工况|操作参数|驱动|变量|指标/,
    /operating condition|operating parameter|affect|factor|driver|influence/);
  const asksForTargets = hit(
    /阈值|限值|上下限|上限|下限|设定值|目标值|正常范围|控制范围|联锁值|跳车值|自保值|高高报|低低报/,
    /threshold|setpoint|limit|target|ideal range|interlock|trip/);
  const asksForCalculation = hit(
    /计算|怎么算|如何计算|公式|方程|核算|估算|推导/,
    /calculate|calculation|formula|equation|estimate/);
  const asksForRecommendation = hit(
    /建议|优化|改进|提升|推荐|方案/,
    /recommend|improve|optimi[sz]e|suggestion/);
  const asksForData = hit(
    /数据|实时|历史库|历史实时数据库|统计|趋势|数值|测量|监测|采样/,
    /real[- ]?time|measurement|statistics?|trend|historical data|query.*data/);
  const asksForTags = hit(
    /位号|标签|测点|信号|点号|tag/,
    /\btag\b|signal|instrument number/);
  const asksForDocuments = hit(
    /文档|资料|规程|手册|图纸|标准|说明书|处置卡/,
    /document|manual|procedure document|drawing|specification/);
  const asksForTime = hit(
    /\d{4}\s*年|\d{1,2}\s*月|\d{1,2}\s*日|时段|期间|前后|小时|近期|最近|当天|那次/,
    /\b20\d{2}\b|last month|last week|during|period/);

  if (asksForHistory) addRequiredPart(parts, 'event_retrieval');
  if (asksForCause) addRequiredPart(parts, 'cause_diagnosis');
  if (asksForAction) addRequiredPart(parts, 'procedure_or_action');
  if (asksForRisk) addRequiredPart(parts, 'anomaly_or_exceedance');
  if (asksForData) {
    addRequiredPart(parts, 'measurement_lookup');
    if (asksForTags) addRequiredPart(parts, 'tag_or_signal_discovery');
  } else if (asksForTags) {
    addRequiredPart(parts, 'tag_or_signal_discovery');
  }
  if (asksForRelationship) {
    addRequiredPart(parts, 'correlation_or_dependency_analysis');
    addRequiredPart(parts, 'relationship_lookup');
  }
  if (asksForFactors) addRequiredPart(parts, 'factor_identification');
  if (asksForTargets) addRequiredPart(parts, 'target_or_ideal_range');
  if (asksForTime && asksForData) addRequiredPart(parts, 'period_verification');
  if (asksForCalculation) addRequiredPart(parts, 'calculation_or_estimation');
  if (asksForRecommendation) addRequiredPart(parts, 'recommendation_or_optimization');
  if (asksForDocuments) addRequiredPart(parts, 'document_lookup');
  if (explicitDefinitionQuestion(q) || /是什么|什么是|定义|含义|指的是|概念/.test(raw)) {
    addRequiredPart(parts, 'definition_or_explanation');
  }

  // 单一部分不值得扇出：交给既有的纵向拆分处理
  const ordered = prioritizeRagParts(parts);
  return ordered.length >= 2 ? ordered : [];
}

function ensureDeterministicRagIntentUnits(units, ctx) {
  let out = (Array.isArray(units) ? units : []).slice();
  const base = firstRagUnit(out);
  if (!base) return out;

  const question = String(ctx.originalUserMessage || base.params?.resolved_question || base.params?.question_literal || base.params?.question || '').trim();
  if (!question) return out;

  const requiredParts = inferRequiredRagParts(question);
  if (!requiredParts.length) return out;

  out = out.filter(unit => !shouldDropWeakGenericRagUnit(unit, requiredParts, question));

  let maxId = out.reduce((m, u) => Math.max(m, Number(u?.unit_id || 0)), 0);
  const maxTotalRagParts = Math.max(6, Math.min(9, requiredParts.length + 2));

  for (const part of requiredParts) {
    if (hasQuestionPart(out, part)) continue;
    const currentRagParts = new Set(
      out
        .filter(u => u && u.tool === 'ragflow_retrieval')
        .map(u => String(u.question_part || '').trim())
        .filter(Boolean)
    );
    if (currentRagParts.size >= maxTotalRagParts) break;
    out.push(cloneRagUnitForPart(base, part, ++maxId, question, requiredParts));
  }

  for (const unit of out) {
    if (unit && unit.tool === 'ragflow_retrieval') {
      unit.deterministic_evidence_frame_parts = requiredParts;
      unit.params = unit.params || {};
      unit.params.deterministic_evidence_frame_parts = requiredParts;
    }
  }

  return out;
}

function cloneRagUnitForPart(base, part, unitId, question, frameParts) {
  const p = JSON.parse(JSON.stringify(base.params || {}));
  p.question_literal = p.question_literal || question;
  p.resolved_question = p.resolved_question || question;
  p.question = `${question} ${part.replace(/_/g, ' ')}`.trim();
  p.question_en = p.question_en || p.question;
  p.deterministic_evidence_frame_parts = frameParts || [];
  delete p.keyword_bundle;
  delete p.retrieval_keywords;
  delete p.keywords;

  return {
    ...JSON.parse(JSON.stringify(base)),
    unit_id: unitId,
    tool: 'ragflow_retrieval',
    params: p,
    depends_on: [],
    question_part: part,
    required_evidence_types: uniqueOrdered([part].concat(base.required_evidence_types || [])),
    optional_evidence_types: uniqueOrdered(base.optional_evidence_types || []),
    allow_synthesis: true,
    deterministic_intent_frame_added: true
  };
}

function prioritizeRagParts(parts) {
  return uniqueOrdered(parts || []).sort((a, b) => ragPartPriority(a) - ragPartPriority(b));
}

function ragPartPriority(part) {
  const order = [
    'event_retrieval',
    'cause_diagnosis',
    'factor_identification',
    'target_or_ideal_range',
    'period_verification',
    'measurement_lookup',
    'tag_or_signal_discovery',
    'correlation_or_dependency_analysis',
    'trend_or_change_analysis',
    'anomaly_or_exceedance',
    'procedure_or_action',
    'recommendation_or_optimization',
    'calculation_or_estimation',
    'relationship_lookup',
    'document_lookup',
    'data_quality_or_availability',
    'definition_or_explanation',
    'summary_or_synthesis',
    'structured_lookup',
    'comparison',
    'other'
  ];
  const idx = order.indexOf(String(part || ''));
  return idx >= 0 ? idx : order.length;
}

function addRequiredPart(list, part) {
  if (!list.includes(part)) list.push(part);
}

function hasQuestionPart(units, part) {
  return (units || []).some(u => u && u.tool === 'ragflow_retrieval' && String(u.question_part || '') === part);
}

function explicitDefinitionQuestion(q) {
  return /define|definition|explain|explanation|principle|composition|calculation process|calculation|calculate|analy[sz]e in detail|what is|how .* calculated|how .* composed/.test(q);
}

function firstRagUnit(units) {
  return (units || []).find(u => u && u.tool === 'ragflow_retrieval') || null;
}
function shouldDropWeakGenericRagUnit(unit, requiredParts, question) {
  if (!unit || unit.tool !== 'ragflow_retrieval') return false;
  const part = String(unit.question_part || '').trim();
  if (!requiredParts.length) return false;
  if (requiredParts.includes(part)) return false;
  if (part === 'definition_or_explanation' && !explicitDefinitionQuestion(normKey(question))) return true;
  if (part === 'summary_or_synthesis' && requiredParts.some(p => p !== 'summary_or_synthesis')) return true;
  if (part === 'other' && requiredParts.length) return true;
  return false;
}

// ===== PART_FANOUT_MERGE_V6 end =====

// ===== KEYWORD_BUNDLE_MERGE_V6 begin =====
// KEYWORD_BUNDLE_ZH_V6 — termList：原版按空格切词，中文串会被整条丢弃。
function termList(value) {
  const out = [];
  const push = (v) => {
    const t = String(v == null ? '' : v).trim();
    if (t) out.push(t);
  };
  if (Array.isArray(value)) {
    for (const v of value) {
      if (Array.isArray(v)) { for (const x of v) push(x); }
      else push(v);
    }
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) push(v);
  } else if (typeof value === 'string') {
    // 中英混排：中文用顿号/逗号/分号切，英文保留空格切
    for (const seg of value.split(/[、,；;\n\r\t|]+/)) {
      const t = seg.trim();
      if (!t) continue;
      if (/[\u4e00-\u9fff]/.test(t)) push(t);
      else for (const w of t.split(/\s{2,}/)) push(w);
    }
  }
  return out;
}

// KEYWORD_BUNDLE_ZH_V6 — extractStableSearchTerms：
// 原版正则 /[A-Za-z][A-Za-z0-9]{2,}|\d{4}...|\d+/ 只认拉丁字母与数字，
// 中文问句提取结果恒为空。这里补中文片段提取（2-6 字）与中文停用词，
// 拉丁/数字部分保持原有行为，中英混排可同时命中。
function extractStableSearchTerms(text, maxTerms = 28) {
  const stopEn = new Set([
    'what','which','where','when','why','how','could','would','should','have','has','had','been','being','there','their',
    'this','that','these','those','with','from','into','onto','about','does','did','done','ever','also','any','all',
    'the','and','for','are','was','were','can','you','tell','me','please','possible','happen','happening','happened',
    'question','run','check','look','looking','based','data','information'
  ]);
  // 句首/句尾虚词：只在边界剥离，不切断词内部
  const edgeZh = ['请问','请','帮我','麻烦','我想','想问','告诉我','看看','查一下','说一下','讲一下',
                  '是什么','什么是','有哪些','哪些','什么','怎么样','怎么','如何','为什么','为何',
                  '呢','吗','吧','啊','的话','一下','了','的','是','在','和','与','及','或'];
  // 功能性连接词：作为切分点，两侧内容各自成词
  const splitZh = /，|。|、|；|;|,|\?|？|！|!|\s+|以及|并且|同时|然后|还有|或者|如何|怎么|为什么|哪些|什么/;

  const raw = String(text || '');
  const terms = [];
  const seen = new Set();
  const add = (t) => {
    let term = String(t || '').trim();
    if (!term) return;
    // 边界虚词剥离（反复剥到稳定）
    let changed = true;
    while (changed) {
      changed = false;
      for (const w of edgeZh) {
        if (term.length > w.length && term.startsWith(w)) { term = term.slice(w.length); changed = true; }
        if (term.length > w.length && term.endsWith(w)) { term = term.slice(0, -w.length); changed = true; }
      }
      term = term.trim();
    }
    if (term.length < 2 || term.length > 24) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };

  // 1) 完整位号优先
  for (const tag of raw.match(/[A-Z]{2,6}\d{3,5}[A-Z]?(?:\.[A-Z]{2,4})?/g) || []) add(tag);

  // 2) 中文：按功能词与标点切段，整段保留，不做滑窗
  for (const seg of raw.split(splitZh)) {
    const t = String(seg || '').trim();
    if (!t || !/[\u4e00-\u9fff]/.test(t)) continue;
    add(t);
    if (terms.length >= maxTerms) break;
  }

  // 3) 拉丁字母 / 数字（原有行为）
  const s2 = raw.replace(/[_./-]/g, ' ');
  for (const m of s2.match(/[A-Za-z][A-Za-z0-9]{2,}|\d{4}(?:\s+\d{1,2}){0,2}|\d+(?:\.\d+)?/g) || []) {
    const term = m.trim();
    if (!term || stopEn.has(term.toLowerCase())) continue;
    if (/^\d+$/.test(term) && term.length < 4) continue;
    add(term);
  }

  return terms.slice(0, maxTerms);
}

function uniqueTerms(...groups) {
  const seenTerms = new Set();
  const outTerms = [];
  for (const group of groups) {
    for (const raw of termList(group)) {
      const term = raw.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
      if (!term || term.length > 80) continue;
      const key = term.toLowerCase();
      if (seenTerms.has(key)) continue;
      seenTerms.add(key);
      outTerms.push(term);
    }
  }
  return outTerms;
}

function languageTerms(terms, language) {
  return termList(terms).filter(term => {
    const hasZh = isChineseText(term);
    if (language === 'zh') return hasZh || /^[A-Z0-9_.-]{2,12}$/.test(term);
    return !hasZh;
  });
}

function buildKeywordBundleQueries(p) {
  const kb = p.keyword_bundle || p.retrieval_keywords || p.keywords || null;
  if (!kb || typeof kb !== 'object' || Array.isArray(kb)) {
    return { en: '', zh: '' };
  }

  const sharedMust = termList(kb.must_have_terms || kb.must_terms || kb.core_terms);
  const sharedShould = termList(kb.should_have_terms || kb.supporting_terms || kb.optional_terms);
  const sharedIntent = termList(kb.intent_terms || kb.intent_keywords);

  const enTerms = uniqueTerms(
    kb.english_equivalents,
    kb.terms_en,
    kb.en_terms,
    kb.en_keywords,
    kb.must_have_terms_en,
    kb.should_have_terms_en,
    languageTerms(sharedMust, 'en'),
    languageTerms(sharedShould, 'en'),
    kb.intent_terms_en,
    languageTerms(sharedIntent, 'en')
  ).slice(0, 32);

  const zhTerms = uniqueTerms(
    kb.chinese_equivalents,
    kb.terms_zh,
    kb.zh_terms,
    kb.zh_keywords,
    kb.must_have_terms_zh,
    kb.should_have_terms_zh,
    languageTerms(sharedMust, 'zh'),
    languageTerms(sharedShould, 'zh'),
    kb.intent_terms_zh,
    languageTerms(sharedIntent, 'zh')
  ).slice(0, 32);

  return {
    en: enTerms.join(' '),
    zh: zhTerms.join(' ')
  };
}

function buildEventEvidenceQueries() {
  const part = String(unit.question_part || '').trim();
  const eventRelevantParts = new Set([
    'factor_identification',
    'cause_diagnosis',
    'event_retrieval',
    'period_verification',
    'anomaly_or_exceedance',
    'trend_or_change_analysis'
  ]);

  if (!eventRelevantParts.has(part)) return { en: '', zh: '' };

  const enSeed = String(keywordQueries.en || qEn || (!isChineseText(primary) ? primary : '') || '').trim();
  const zhSeed = String(keywordQueries.zh || qZh || (isChineseText(primary) ? primary : '') || '').trim();

  return {
    en: uniqueTerms([
      enSeed,
      'historical record',
      'incident',
      'event',
      'operating change',
      'disturbance',
      'failure',
      'interruption',
      'before after',
      'production impact',
      'measured impact'
    ]).join(' '),
    zh: uniqueTerms([
      zhSeed,
      '\u5386\u53f2\u8bb0\u5f55',
      '\u4e8b\u4ef6',
      '\u4e8b\u6545',
      '\u64cd\u4f5c\u53d8\u52a8',
      '\u6ce2\u52a8',
      '\u6545\u969c',
      '\u4e2d\u65ad',
      '\u524d\u540e\u53d8\u5316',
      '\u4ea7\u91cf\u5f71\u54cd',
      '\u6d4b\u91cf\u5f71\u54cd'
    ]).join(' ')
  };
}

function getAllSearchableDatasetIds(catalog) {
  const explicit = Array.isArray(catalog?.ragflow?.searchable_dataset_ids)
    ? catalog.ragflow.searchable_dataset_ids
    : [];

  const fromDatasets = Array.isArray(catalog?.ragflow?.datasets)
    ? catalog.ragflow.datasets
        .filter(ds => ds?.is_searchable === true)
        .map(ds => ds?.id)
    : [];

  const candidates = explicit.length ? explicit : fromDatasets;
  return filterSearchableDatasetIds(candidates, catalog);
}

function stableEntitySeed() {
  return uniqueTerms(
    extractStableSearchTerms(ctx.originalUserMessage || '', 24),
    extractStableSearchTerms(p.resolved_question || '', 16),
    extractStableSearchTerms(p.question_literal || '', 16),
    extractStableSearchTerms(primary || '', 16),
    extractStableSearchTerms(qEn || '', 12)
  ).slice(0, 32).join(' ');
}

function stableProfileForPart(part) {
  const profiles = {
    factor_identification: {
      label: 'factor',
      en: 'factors operating parameters drivers mechanism effect relationship production yield quality',
      zh: '\u5f71\u54cd\u56e0\u7d20 \u64cd\u4f5c\u53c2\u6570 \u9a71\u52a8\u56e0\u7d20 \u673a\u7406 \u5173\u7cfb \u4ea7\u91cf \u6536\u7387 \u8d28\u91cf'
    },
    target_or_ideal_range: {
      label: 'target_range',
      en: 'target range ideal range recommended range operating window setpoint limit specification benchmark',
      zh: '\u76ee\u6807\u8303\u56f4 \u6700\u4f73\u8303\u56f4 \u63a8\u8350\u8303\u56f4 \u64cd\u4f5c\u7a97\u53e3 \u8bbe\u5b9a\u503c \u9650\u503c \u6307\u6807'
    },
    period_verification: {
      label: 'period',
      en: 'actual operation period data monthly report statistics trend deviation measured value',
      zh: '\u5b9e\u9645\u8fd0\u884c \u65f6\u6bb5\u6570\u636e \u6708\u62a5 \u7edf\u8ba1 \u8d8b\u52bf \u504f\u5dee \u6d4b\u91cf\u503c'
    },
    event_retrieval: {
      label: 'event',
      en: 'incident historical record case event alarm leak failure before after measured impact',
      zh: '\u4e8b\u6545 \u5386\u53f2\u8bb0\u5f55 \u6848\u4f8b \u4e8b\u4ef6 \u62a5\u8b66 \u6cc4\u6f0f \u6545\u969c \u524d\u540e\u53d8\u5316'
    },
    cause_diagnosis: {
      label: 'cause',
      en: 'cause mechanism root cause failure mode abnormal condition contributing factor troubleshooting',
      zh: '\u539f\u56e0 \u673a\u7406 \u6839\u672c\u539f\u56e0 \u6545\u969c\u6a21\u5f0f \u5f02\u5e38\u5de5\u51b5 \u5f71\u54cd\u56e0\u7d20 \u6392\u67e5'
    },
    procedure_or_action: {
      label: 'prevention',
      en: 'prevention mitigation inspection maintenance operating procedure corrective action avoid recurrence',
      zh: '\u9884\u9632 \u7f13\u89e3 \u68c0\u67e5 \u7ef4\u62a4 \u64cd\u4f5c\u89c4\u7a0b \u7ea0\u6b63\u63aa\u65bd \u907f\u514d\u518d\u53d1'
    },
    anomaly_or_exceedance: {
      label: 'risk_implication',
      en: 'process implication operating risk safety risk excursion alarm exceedance shutdown emission consequence',
      zh: '\u5de5\u827a\u5f71\u54cd \u64cd\u4f5c\u98ce\u9669 \u5b89\u5168\u98ce\u9669 \u504f\u79bb \u62a5\u8b66 \u8d85\u6807 \u505c\u8f66 \u6392\u653e \u540e\u679c'
    },
    recommendation_or_optimization: {
      label: 'recommendation',
      en: 'recommendation optimization improvement priority adjustment operating target constraint action',
      zh: '\u5efa\u8bae \u4f18\u5316 \u6539\u8fdb \u4f18\u5148\u7ea7 \u8c03\u6574 \u64cd\u4f5c\u76ee\u6807 \u7ea6\u675f \u63aa\u65bd'
    },
    measurement_lookup: {
      label: 'measurement',
      en: 'real time data online measurement reading value statistic trend monitor control detector analyzer',
      zh: '\u5b9e\u65f6\u6570\u636e \u5728\u7ebf\u6d4b\u91cf \u8bfb\u6570 \u6570\u503c \u7edf\u8ba1 \u8d8b\u52bf \u76d1\u6d4b \u63a7\u5236 \u68c0\u6d4b\u5668 \u5206\u6790\u4eea'
    },
    tag_or_signal_discovery: {
      label: 'tag_signal',
      en: 'tag signal sensor variable monitored parameter direct measurement indirect indicator DCS alarm',
      zh: '\u4f4d\u53f7 \u4fe1\u53f7 \u4f20\u611f\u5668 \u53d8\u91cf \u76d1\u6d4b\u53c2\u6570 \u76f4\u63a5\u6d4b\u91cf \u95f4\u63a5\u6307\u6807 DCS\u62a5\u8b66'
    },
    correlation_or_dependency_analysis: {
      label: 'indirect_indicator',
      en: 'indirect indicator correlation dependency upstream downstream leading signal interaction trend',
      zh: '\u95f4\u63a5\u6307\u6807 \u76f8\u5173 \u4f9d\u8d56 \u4e0a\u6e38 \u4e0b\u6e38 \u9886\u5148\u4fe1\u53f7 \u76f8\u4e92\u4f5c\u7528 \u8d8b\u52bf'
    },
    trend_or_change_analysis: {
      label: 'trend',
      en: 'trend change increase decrease before after movement over time what changed first',
      zh: '\u8d8b\u52bf \u53d8\u5316 \u4e0a\u5347 \u4e0b\u964d \u524d\u540e\u53d8\u5316 \u968f\u65f6\u95f4\u53d8\u5316 \u5148\u53d8\u5316\u9879'
    },
    data_quality_or_availability: {
      label: 'data_quality',
      en: 'data availability missing data data quality no data null flatline coverage limitation',
      zh: '\u6570\u636e\u53ef\u7528\u6027 \u7f3a\u5931\u6570\u636e \u6570\u636e\u8d28\u91cf \u65e0\u6570\u636e \u7a7a\u503c \u5e73\u76f4 \u8986\u76d6\u8303\u56f4 \u9650\u5236'
    },
    calculation_or_estimation: {
      label: 'calculation',
      en: 'calculation composition formula energy consumption statistical method contribution breakdown',
      zh: '\u8ba1\u7b97 \u6784\u6210 \u516c\u5f0f \u80fd\u8017 \u7edf\u8ba1\u65b9\u6cd5 \u8d21\u732e \u5206\u89e3'
    },
    relationship_lookup: {
      label: 'relationship',
      en: 'relationship connected upstream downstream equipment dependency process path interaction',
      zh: '\u5173\u7cfb \u8fde\u63a5 \u4e0a\u6e38 \u4e0b\u6e38 \u8bbe\u5907 \u4f9d\u8d56 \u5de5\u827a\u8def\u5f84 \u76f8\u4e92\u4f5c\u7528'
    },
    document_lookup: {
      label: 'document',
      en: 'technical report monthly report procedure manual incident report document record citation',
      zh: '\u6280\u672f\u62a5\u544a \u6708\u62a5 \u89c4\u7a0b \u624b\u518c \u4e8b\u6545\u62a5\u544a \u6587\u6863 \u8bb0\u5f55 \u5f15\u7528'
    },
    definition_or_explanation: {
      label: 'explanation',
      en: 'definition explanation principle feasibility possible behavior process basis mechanism',
      zh: '\u5b9a\u4e49 \u89e3\u91ca \u539f\u7406 \u53ef\u884c\u6027 \u53ef\u80fd\u73b0\u8c61 \u5de5\u827a\u4f9d\u636e \u673a\u7406'
    }
  };
  return profiles[part] || { label: 'general', en: 'evidence document information process operation measurement', zh: '\u8bc1\u636e \u6587\u6863 \u4fe1\u606f \u5de5\u827a \u64cd\u4f5c \u6d4b\u91cf' };
}

function pushStableIntentProfiles(scopedDatasetIds, languageScope) {
  if (!isEvidenceIntentRagProfile(unit)) return;
  const part = String(unit.question_part || '').trim();
  const profile = stableProfileForPart(part);
  const seed = stableEntitySeed() || primary || qEn || ctx.originalUserMessage || '';
  if ((languageScope === 'en' || languageScope === 'mixed' || languageScope === 'all') && seed) {
    push(`${seed} ${profile.en}`, `en_stable_${profile.label}_profile`, scopedDatasetIds);
  }
  if ((languageScope === 'zh' || languageScope === 'mixed' || languageScope === 'all')) {
    const zhSeed = String(qZh || keywordQueries.zh || '').trim();
    if (zhSeed) {
      push(`${zhSeed} ${profile.zh}`, `zh_stable_${profile.label}_profile`, scopedDatasetIds);
    } else if (seed && languageScope === 'zh') {
      push(`${seed} ${profile.en}`, `en_stable_${profile.label}_on_zh`, scopedDatasetIds);
    }
  }
}

function buildGroupedRagUnit(unit, candidates, ctx, group) {
  const p = unit.params || {};
  const allRagflowDatasetIds = getAllSearchableDatasetIds(ctx.catalog || {});

  const queryVariants = [];
  const seen = new Set();

  for (const cand of candidates || []) {
    const question = String(cand?.question || '').trim();
    if (!question) continue;

    const datasetIds = allRagflowDatasetIds.length
      ? allRagflowDatasetIds
      : (Array.isArray(cand.dataset_ids) && cand.dataset_ids.length ? cand.dataset_ids : p.dataset_ids);

    const key = normKey(question) + '|' + uniqueOrdered(datasetIds || []).slice().sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);

    const variant = {
      variant_id: `${group}_variant_${queryVariants.length + 1}`,
      lang_variant: cand.lang_variant || null,
      question,
      dataset_ids: datasetIds
    };

    for (const k of [
      'document_ids',
      'page',
      'page_size',
      'similarity_threshold',
      'vector_similarity_weight',
      'keyword',
      'top_k',
      'rerank_id',
      'highlight',
      'cross_languages',
      'metadata_condition',
      'use_kg'
    ]) {
      if (p[k] !== undefined) variant[k] = p[k];
    }

    queryVariants.push(variant);
  }

  if (!queryVariants.length) return unit;

  return {
    ...unit,
    unit_id: Number(unit.unit_id) || expanded.length + 1,
    retrieval_group: group,
    lang_variant: 'grouped_query_variants',
    rag_grouped: true,
    allow_synthesis: true,
    params: {
      ...p,
      question: queryVariants[0].question,
      dataset_ids: queryVariants[0].dataset_ids,
      retrieval_mode: 'grouped_query_variants',
      variant_count: queryVariants.length,
      query_variants: queryVariants,
      post_rag_max_evidence_chunks: p.post_rag_max_evidence_chunks ?? p.max_grouped_evidence_chunks ?? 240,
      post_rag_near_duplicate_threshold: p.post_rag_near_duplicate_threshold ?? 0.74,
      post_rag_max_chunks_per_document: p.post_rag_max_chunks_per_document ?? 90,
      post_rag_max_chunks_per_variant: p.post_rag_max_chunks_per_variant ?? 120
    }
  };
}
// ===== KEYWORD_BUNDLE_MERGE_V6 end =====


let finalUnits = removeRedundantPresenceReads(
  expandDirectAvailabilityStats(
    collapseDirectAvailabilityReads(
      convertAvailabilityAnalyzeToStats(
        keepOnlyDirectNoRetrievalIfPresent(
          normalizeArcticDependencies(collapseDuplicateArcticFindTags(stabilizedUnits))
        )
      )
    )
  )
);

if (!finalUnits.length) {
  finalUnits.push({
    unit_id: 1,
    tool: 'direct_response',
    params: { text: 'No steps to execute.' },
    depends_on: [],
    allow_synthesis: false
  });
}

const publicFinalUnits = finalUnits.map(toMongoUnit);
const publicCtx = {
  ...ctx,
  catalog: rawBuilder.catalog || {},
  completed_units: Array.isArray(rawBuilder.completed_units)
    ? rawBuilder.completed_units.map(toMongoUnit)
    : []
};

sd[`result_norm_planned_units_${resultNormSessionKey}`] = publicFinalUnits;
sd.result_norm_planned_units_default = publicFinalUnits;

return publicFinalUnits.map(unit => ({
  json: { ...publicCtx, unit }
}));
