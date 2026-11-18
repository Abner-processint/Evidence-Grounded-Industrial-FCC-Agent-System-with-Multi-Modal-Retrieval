const helperContext = this;

function readConfig(name, fallback = '') {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name];
  } catch (e) {}
  try {
    if (typeof $env !== 'undefined' && $env && $env[name]) return $env[name];
  } catch (e) {}
  try {
    if (typeof $vars !== 'undefined' && $vars && $vars[name]) return $vars[name];
  } catch (e) {}
  return fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numericScore(chunk) {
  const candidates = [
    chunk.similarity,
    chunk.score,
    chunk.rank_score,
    chunk.rerank_score,
    chunk.vector_similarity,
  ];

  for (const value of candidates) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

function getPage(chunk, end = false) {
  const direct = end
    ? [chunk.page_end, chunk.end_page, chunk.page_to]
    : [chunk.page_start, chunk.start_page, chunk.page, chunk.page_num];

  for (const value of direct) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }

  if (Array.isArray(chunk.positions) && chunk.positions.length) {
    const pages = chunk.positions
      .map((p) => Number(p && (p.page_num ?? p.page ?? p[0])))
      .filter((n) => Number.isFinite(n));
    if (pages.length) return end ? Math.max(...pages) : Math.min(...pages);
  }

  return null;
}

function getChunkText(chunk) {
  for (const key of ['content', 'text', 'chunk', 'page_content', 'highlight']) {
    const value = chunk[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const joined = value.filter((x) => typeof x === 'string').join(' ').trim();
      if (joined) return joined;
    }
  }

  const doc = chunk.document || chunk.doc;
  if (doc && typeof doc === 'object') {
    for (const key of ['content', 'text', 'name']) {
      const value = doc[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }

  return '';
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function preview(value, maxLen = 700) {
  const text = normalizeWhitespace(value);
  return text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;
}

function fingerprint(text) {
  const normalized = normalizeWhitespace(text).toLowerCase().slice(0, 900);
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
  }
  return String(hash);
}

// RAGFLOW_DOCUMENT_KEYWORD_NAME_V7
// RAGFlow /api/v1/retrieval 的片段用 document_keyword 携带文档名、dataset_id 携带数据集（实测）；
// 原先只认 document_name/doc_name/filename，展示区「文档」「数据集」因此一直为空。
let __datasetNameById = new Map();
function documentName(chunk) {
  const doc = chunk.document || chunk.doc || {};
  return firstText(
    chunk.document_name,
    chunk.document_keyword,
    chunk.docnm_kwd,
    chunk.doc_name,
    chunk.filename,
    chunk.name,
    doc.name,
    doc.filename,
  ) || null;
}

function documentId(chunk) {
  const doc = chunk.document || chunk.doc || {};
  return firstText(
    chunk.document_id,
    chunk.doc_id,
    chunk.documentId,
    doc.id,
  ) || null;
}

function datasetName(chunk) {
  const byName = firstText(
    chunk.dataset_name,
    chunk.kb_name,
    chunk.knowledgebase_name,
  );
  if (byName) return byName;
  const dsId = firstText(chunk.dataset_id, chunk.kb_id);
  if (dsId && __datasetNameById.has(dsId)) return __datasetNameById.get(dsId);
  return firstText(chunk.dataset) || null;
}

function sectionTitle(chunk) {
  return firstText(
    chunk.section_title,
    chunk.title,
    chunk.heading,
    chunk.section,
  ) || null;
}

function dedupeKey(candidate) {
  const chunk = candidate.chunk;
  const id = firstText(chunk.id, chunk.chunk_id, chunk.chunkId);
  if (id) return 'id:' + id;

  return [
    'fp',
    documentId(chunk) || documentName(chunk) || '',
    sectionTitle(chunk) || '',
    getPage(chunk, false) ?? '',
    fingerprint(candidate.text),
  ].join('|');
}

function buildPayload(params, variant) {
  const payload = {
    question: variant.question,
  };

  const settingNames = [
    'dataset_ids',
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
    'use_kg',
    'toc_enhance',
  ];

  for (const name of settingNames) {
    const value = variant[name] ?? params[name];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === '') continue;
    payload[name] = value;
  }

  // RETRIEVAL_WINDOW_FLOOR_V7
  // Match Tools 提示词把 page_size=8 写成默认值，规划器写出检索步骤时就带上 8/64，
  // 检索单元由后续节点补出时则不传（RAGFlow 用自身默认 30），窗口随规划器行为摆动。
  // 实测 exec 140030：含 PRCA3101/3102 的片段排在第 8 名之外未被取回。
  // 这里只抬高到 20/128（阈值类问题已在用的窗口），不压低；未传时保持不传。
  if (payload.page_size !== undefined && Number(payload.page_size) < 20) payload.page_size = 20;
  if (payload.top_k !== undefined && Number(payload.top_k) < 128) payload.top_k = 128;

  return payload;
}


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const message = err.message || String(err);
  return normalizeWhitespace(message).slice(0, 1200);
}

function isRetriableRetrievalError(err) {
  const text = errorText(err).toLowerCase();
  return [
    'timeout',
    'timed out',
    'eof',
    'ssl',
    'connection',
    'connreset',
    'socket',
    'temporarily unavailable',
    'max retries',
    '502',
    '503',
    '504',
    'code":100',
    'code 100',
  ].some((needle) => text.includes(needle));
}

async function retrieveVariant(url, headers, payload, verifySsl, variant, options) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts ?? 1));
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 1000));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs ?? 25000));
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await postJson(url, headers, payload, verifySsl, timeoutMs);
      if (response && response.code !== undefined && response.code !== 0) {
        const err = new Error(
          'RAGFlow retrieval error for ' +
            variant.variant_id +
            ': ' +
            JSON.stringify(response).slice(0, 1200)
        );
        err.ragflowPayload = response;
        throw err;
      }

      return { ok: true, response, attempts: attempt };
    } catch (err) {
      lastError = err;
      const shouldRetry = attempt < maxAttempts && isRetriableRetrievalError(err);
      if (!shouldRetry) break;
      await sleep(baseDelayMs * attempt);
    }
  }

  return {
    ok: false,
    attempts: maxAttempts,
    error: errorText(lastError),
  };
}

async function postJson(url, headers, body, verifySsl, timeoutMs) {
  const requestTimeoutMs = Math.max(1000, Number(timeoutMs || 25000));

  if (!verifySsl) {
    try {
      if (typeof process !== 'undefined' && process.env) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      }
    } catch (e) {}
  }

  if (helperContext && helperContext.helpers && helperContext.helpers.httpRequest) {
    return await helperContext.helpers.httpRequest({
      method: 'POST',
      url,
      headers,
      body,
      json: true,
      timeout: requestTimeoutMs,
      rejectUnauthorized: verifySsl,
      agentOptions: { rejectUnauthorized: verifySsl },
      skipSslCertificateValidation: !verifySsl,
    });
  }

  if (typeof fetch !== 'function') {
    throw new Error('No HTTP client is available in the Code node. Enable this.helpers.httpRequest or Node fetch.');
  }

  const fetchOptions = {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  };

  try {
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      fetchOptions.signal = AbortSignal.timeout(requestTimeoutMs);
    }
  } catch (e) {}

  const response = await fetch(url, fetchOptions);
  const text = await response.text();
  if (!response.ok) {
    throw new Error('HTTP ' + response.status + ' from RAGFlow: ' + text.slice(0, 1000));
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('RAGFlow returned non-JSON response: ' + text.slice(0, 1000));
  }
}

function extractChunks(payload) {
  const result = payload && payload.data !== undefined ? payload.data : payload;

  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];

  for (const value of [result.chunks, result.records, result.items]) {
    if (Array.isArray(value)) return value;
  }

  return [];
}

function normalizeVariant(params, rawVariant, index) {
  const variant = rawVariant && typeof rawVariant === 'object' ? rawVariant : {};
  const question = firstText(variant.question, variant.query, params.question);
  return {
    ...variant,
    variant_id: firstText(variant.variant_id, variant.id) || 'variant_' + (index + 1),
    lang_variant: firstText(variant.lang_variant, variant.language, variant.lang) || null,
    question,
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Math.min(items.length, Number(concurrency) || items.length || 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

function rankStopwords() {
  return new Set([
    'the','and','for','with','that','this','from','into','onto','over','under','between','within','without',
    'what','when','where','which','while','does','did','had','has','have','been','being','were','was','are','is',
    'how','why','can','could','would','should','shall','will','may','might','about','into','than','then',
    'operating','operation','conditions','condition','parameter','parameters','effect','effects','affect','affected',
    'question','query','answer','evidence','retrieval','ragflow','analysis','during','period','ideal','target'
  ]);
}

function tokenizeRankText(value) {
  const stop = rankStopwords();
  const text = String(value || '');
  const out = [];
  const seen = new Set();

  function add(token) {
    const t = String(token || '').toLowerCase().replace(/^[-_.:/]+|[-_.:/]+$/g, '');
    if (!t || t.length < 2 || stop.has(t)) return;
    if (/^\d+$/.test(t) && t.length < 4) return;
    if (seen.has(t)) return;
    seen.add(t);
    out.push(t);
  }

  const tagMatches = text.match(/\b[A-Z]{1,8}[A-Z0-9_]*\d+[A-Z0-9_]*(?:\.PV)?\b|\bEcat[A-Za-z0-9_]+\b|\bLCO\d{2}_D86V\d{3}\b/g) || [];
  for (const tag of tagMatches) add(tag);

  const latin = text
    .toLowerCase()
    .replace(/[^\w.%/°℃-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const token of latin) add(token);

  const cjkSegments = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const segment of cjkSegments) {
    if (segment.length <= 6) add(segment);
    for (let i = 0; i < segment.length - 1; i += 1) add(segment.slice(i, i + 2));
    for (let i = 0; i < segment.length - 2; i += 1) add(segment.slice(i, i + 3));
  }

  return out;
}

function weightedTokenMap(tokens, weight) {
  const map = new Map();
  for (const token of tokens || []) {
    if (!token) continue;
    map.set(token, Math.max(map.get(token) || 0, weight));
  }
  return map;
}

function addWeightedTokens(map, tokens, weight) {
  for (const token of tokens || []) {
    if (!token) continue;
    map.set(token, Math.max(map.get(token) || 0, weight));
  }
}

function intentRankTerms(questionPart) {
  const part = String(questionPart || '').trim();
  const profiles = {
    factor_identification: 'factor cause causes mechanism influence increases decreases drives relationship parameter variable operating condition sensitivity',
    target_or_ideal_range: 'target range recommended ideal optimum benchmark limit constraint specification setpoint operating window',
    period_verification: 'trend actual observed during period date month compare deviation stable unstable above below average minimum maximum',
    cause_diagnosis: 'cause root cause mechanism symptom consequence indication diagnosis reason failure abnormal issue',
    event_retrieval: 'incident event case trip failure upset historical occurred date consequence recovery',
    comparison: 'compare difference higher lower before after versus baseline benchmark',
    trend_or_change_analysis: 'trend increase decrease change shift movement ramp step before after',
    correlation_or_dependency_analysis: 'correlation dependency relationship coupled associated lag response sensitivity',
    anomaly_or_exceedance: 'anomaly exceedance abnormal limit threshold outlier excursion high low',
    measurement_lookup: 'measurement tag signal value observed reading data trend',
    tag_or_signal_discovery: 'tag signal measurement instrument transmitter controller indicator',
    data_quality_or_availability: 'missing flatline constant zero bad data availability quality unreliable gap',
    procedure_or_action: 'procedure action mitigation adjustment troubleshooting operation control response',
    recommendation_or_optimization: 'recommend optimize improve adjustment priority action tradeoff constraint',
    definition_or_explanation: 'definition explanation principle mechanism process basis'
  };
  return tokenizeRankText(profiles[part] || '');
}

function buildRankContext(params, unit, item, variants) {
  const weighted = new Map();
  const coreTexts = [
    item && item.originalUserMessage,
    item && item.original_question,
    params && params.question,
    params && params.question_en,
    params && params.question_zh,
    params && params.resolved_question,
    params && params.question_literal,
    unit && unit.question_part,
    ...(Array.isArray(unit && unit.required_evidence_types) ? unit.required_evidence_types : []),
    ...(Array.isArray(unit && unit.optional_evidence_types) ? unit.optional_evidence_types : []),
  ];

  for (const text of coreTexts) addWeightedTokens(weighted, tokenizeRankText(text), 2.0);
  for (const variant of variants || []) addWeightedTokens(weighted, tokenizeRankText(variant && variant.question), 1.2);
  addWeightedTokens(weighted, intentRankTerms(unit && unit.question_part), 1.4);

  const totalWeight = [...weighted.values()].reduce((sum, value) => sum + value, 0) || 1;
  return {
    weighted,
    totalWeight,
    tokens: [...weighted.keys()],
    question_part: String(unit && unit.question_part || '').trim(),
  };
}

function tokenSetForCandidate(candidate) {
  if (candidate._rank_token_set) return candidate._rank_token_set;
  const chunk = candidate.chunk || {};
  const parts = [
    candidate.text,
    documentName(chunk),
    datasetName(chunk),
    sectionTitle(chunk),
    candidate.variant && candidate.variant.question,
  ];
  candidate._rank_token_set = new Set(tokenizeRankText(parts.filter(Boolean).join(' ')));
  return candidate._rank_token_set;
}

function normalizedRagScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 1) return Math.max(0, Math.min(1, n));
  if (n <= 100) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, Math.log10(n + 1) / 4));
}

function candidateRankFeatures(candidate, rankContext) {
  const tokens = tokenSetForCandidate(candidate);
  let matchedWeight = 0;
  let hits = 0;
  for (const [token, weight] of rankContext.weighted.entries()) {
    if (tokens.has(token)) {
      matchedWeight += weight;
      hits += 1;
    }
  }

  const tokenCoverage = Math.min(1, matchedWeight / rankContext.totalWeight);
  const score = normalizedRagScore(numericScore(candidate.chunk));
  const textLength = Math.min(1, normalizeWhitespace(candidate.text).length / 1800);
  const docMetaText = [documentName(candidate.chunk), datasetName(candidate.chunk), sectionTitle(candidate.chunk)].filter(Boolean).join(' ');
  const metaTokens = new Set(tokenizeRankText(docMetaText));
  let metaHits = 0;
  for (const token of rankContext.tokens) {
    if (metaTokens.has(token)) metaHits += 1;
  }
  const metaCoverage = Math.min(1, metaHits / 8);

  const finalScore =
    score * 0.50 +
    tokenCoverage * 0.34 +
    metaCoverage * 0.08 +
    textLength * 0.04 +
    Math.max(0, 1 - candidate.order / 10000) * 0.04;

  candidate._rank_features = {
    final_score: Number(finalScore.toFixed(6)),
    rag_score_normalized: Number(score.toFixed(6)),
    query_token_coverage: Number(tokenCoverage.toFixed(6)),
    query_token_hits: hits,
    metadata_token_coverage: Number(metaCoverage.toFixed(6)),
  };

  return candidate._rank_features;
}

function tokenSimilarity(a, b) {
  const setA = tokenSetForCandidate(a);
  const setB = tokenSetForCandidate(b);
  if (!setA.size || !setB.size) return { jaccard: 0, containment: 0 };

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }

  const union = setA.size + setB.size - intersection;
  return {
    jaccard: union > 0 ? intersection / union : 0,
    containment: intersection / Math.min(setA.size, setB.size),
  };
}

function sameDocumentOrSection(a, b) {
  const aDoc = documentId(a.chunk) || documentName(a.chunk) || '';
  const bDoc = documentId(b.chunk) || documentName(b.chunk) || '';
  if (aDoc && bDoc && aDoc === bDoc) return true;
  const aSection = sectionTitle(a.chunk) || '';
  const bSection = sectionTitle(b.chunk) || '';
  return !!(aSection && bSection && aSection === bSection);
}

function isNearDuplicate(candidate, selected, threshold) {
  if (/<table\b/i.test(candidate.text || '')) return false;
  for (const existing of selected) {
    const sim = tokenSimilarity(candidate, existing);
    if (sim.jaccard >= threshold) return true;
    if (sameDocumentOrSection(candidate, existing) && sim.containment >= 0.82) return true;
    if (sim.containment >= 0.93 && Math.min(candidate.text.length, existing.text.length) > 220) return true;
  }
  return false;
}

function selectedEvidence(candidates, maxEvidence, rankContext, options = {}) {
  const byKey = new Map();
  const stats = {
    ranker_version: 'post_rag_deterministic_ranker_v2',
    input_candidate_count: candidates.length,
    exact_duplicate_replaced_count: 0,
    exact_deduped_candidate_count: 0,
    near_duplicate_skipped_count: 0,
    document_soft_cap_skipped_count: 0,
    selected_count: 0,
  };

  for (const candidate of candidates) {
    if (!candidate.text) continue;
    const key = dedupeKey(candidate);
    candidateRankFeatures(candidate, rankContext);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }

    const existingRank = candidateRankFeatures(existing, rankContext).final_score;
    const candidateRank = candidate._rank_features.final_score;
    const betterRank = candidateRank > existingRank;
    const betterText = candidateRank === existingRank && candidate.text.length > existing.text.length;
    if (betterRank || betterText) {
      byKey.set(key, candidate);
      stats.exact_duplicate_replaced_count += 1;
    }
  }

  const ranked = [...byKey.values()]
    .sort((a, b) => {
      const rankA = candidateRankFeatures(a, rankContext).final_score;
      const rankB = candidateRankFeatures(b, rankContext).final_score;
      if (rankA !== rankB) return rankB - rankA;

      const scoreA = normalizedRagScore(numericScore(a.chunk));
      const scoreB = normalizedRagScore(numericScore(b.chunk));
      if (scoreA !== scoreB) return scoreB - scoreA;

      const docA = documentName(a.chunk) || '';
      const docB = documentName(b.chunk) || '';
      if (docA !== docB) return docA.localeCompare(docB);

      return a.order - b.order;
    });

  stats.exact_deduped_candidate_count = ranked.length;

  const selected = [];
  const docCounts = new Map();
  const variantCounts = new Map();
  const nearDuplicateThreshold = Number(options.nearDuplicateThreshold ?? 0.74);
  const maxPerDocument = Number(options.maxPerDocument ?? 90);
  const maxPerVariant = Number(options.maxPerVariant ?? 120);
  const finiteLimit = Number.isFinite(maxEvidence) && maxEvidence > 0 ? maxEvidence : Infinity;

  for (const candidate of ranked) {
    if (selected.length >= finiteLimit) break;

    const docKey = documentId(candidate.chunk) || documentName(candidate.chunk) || 'unknown_document';
    const variantKey = candidate.variant && candidate.variant.variant_id || 'unknown_variant';
    const docCount = docCounts.get(docKey) || 0;
    const variantCount = variantCounts.get(variantKey) || 0;

    if (Number.isFinite(maxPerDocument) && maxPerDocument > 0 && docCount >= maxPerDocument) {
      stats.document_soft_cap_skipped_count += 1;
      continue;
    }

    if (Number.isFinite(maxPerVariant) && maxPerVariant > 0 && variantCount >= maxPerVariant) {
      stats.document_soft_cap_skipped_count += 1;
      continue;
    }

    if (isNearDuplicate(candidate, selected, nearDuplicateThreshold)) {
      stats.near_duplicate_skipped_count += 1;
      continue;
    }

    candidate._post_rag_rank = selected.length + 1;
    selected.push(candidate);
    docCounts.set(docKey, docCount + 1);
    variantCounts.set(variantKey, variantCount + 1);
  }

  stats.selected_count = selected.length;
  stats.unique_document_count = docCounts.size;
  stats.unique_variant_count = variantCounts.size;
  stats.max_evidence_limit = finiteLimit === Infinity ? 'all' : finiteLimit;
  stats.near_duplicate_threshold = nearDuplicateThreshold;
  stats.max_chunks_per_document = maxPerDocument;
  stats.max_chunks_per_variant = maxPerVariant;
  selectedEvidence.lastStats = stats;

  return selected;
}


function evidenceObjects(selected) {
  const evidence_summary = [];
  const evidence_digest = [];

  selected.forEach((candidate, index) => {
    const chunk = candidate.chunk;
    const evidenceId = 'E' + (index + 1);
    const snippet = /<table\b/i.test(candidate.text || '')
  ? candidate.text
  : preview(candidate.text, 700);
    const docName = documentName(chunk);
    const dsName = datasetName(chunk);
    const pageStart = getPage(chunk, false);
    const pageEnd = getPage(chunk, true);
    const score = numericScore(chunk);

    evidence_summary.push({
      evidence_id: evidenceId,
      document_id: documentId(chunk),
      document_name: docName,
      dataset_name: dsName,
      page_start: pageStart,
      page_end: pageEnd,
      section_title: sectionTitle(chunk),
      snippet,
      retrieval_score: score,
      source_type: 'ragflow',
      variant_id: candidate.variant.variant_id,
      lang_variant: candidate.variant.lang_variant,
      retrieval_query: candidate.variant.question,
      post_rag_rank: candidate._post_rag_rank || index + 1,
      post_rag_rank_score: candidate._rank_features ? candidate._rank_features.final_score : null,
      query_token_coverage: candidate._rank_features ? candidate._rank_features.query_token_coverage : null,
      query_token_hits: candidate._rank_features ? candidate._rank_features.query_token_hits : null,
    });

    evidence_digest.push({
      evidence_id: evidenceId,
      document_name: docName,
      dataset_name: dsName,
      page_start: pageStart,
      page_end: pageEnd,
      section_title: sectionTitle(chunk),
      content_summary: snippet,
      key_points: [],
      key_values: [],
      operational_actions: [],
      limitations: [],
      // 原为 'Retrieved for grouped query variant: ' + variant_id 的占位，展示区会原样当作「答案用途」显示。
      // 答案用途改由展示节点按最终回答中引用该证据的句子生成，这里置空。
      relevance_to_question: '',
      snippet,
      variant_id: candidate.variant.variant_id,
      lang_variant: candidate.variant.lang_variant,
      retrieval_query: candidate.variant.question,
      post_rag_rank: candidate._post_rag_rank || index + 1,
      post_rag_rank_score: candidate._rank_features ? candidate._rank_features.final_score : null,
      query_token_coverage: candidate._rank_features ? candidate._rank_features.query_token_coverage : null,
    });
  });

  return { evidence_summary, evidence_digest };
}

const defaultBaseUrl =
  readConfig('RAGFLOW_BASE_URL') ||
  readConfig('RAGFLOW_URL') ||
  "https://<HOST>:8091";

const defaultApiKey =
  readConfig('RAGFLOW_API_KEY') ||
  readConfig('RAGFLOW_TOKEN') ||
  "<RAGFLOW_API_KEY>";

const defaultVerifySslValue = readConfig('RAGFLOW_TLS_VERIFY', 'false');

const outputItems = [];

for (const inputItem of $input.all()) {
  const item = inputItem.json || {};
  const unit = item.unit || {};
  const params = unit.params || {};

  const baseUrl = firstText(params.ragflow_base_url, params.ragflow_url, defaultBaseUrl);
  const apiKey = firstText(params.ragflow_api_key, params.ragflow_token, defaultApiKey);

  if (!baseUrl) {
    throw new Error('RAGFLOW_BASE_URL environment variable is required for deterministic grouped RAG retrieval.');
  }

  if (!apiKey) {
    throw new Error('RAGFLOW_API_KEY environment variable is required for deterministic grouped RAG retrieval.');
  }

  const verifySslRaw = params.ragflow_tls_verify ?? params.verify_ssl ?? defaultVerifySslValue;
  const verifySslValue = String(verifySslRaw).toLowerCase();
  const verifySsl = !['0', 'false', 'no', 'off'].includes(verifySslValue);
  const retrievalUrl = baseUrl.replace(/\/+$/, '') + '/api/v1/retrieval';
  const headers = {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
  };

  const rawVariants = nonEmptyArray(params.query_variants)
    ? params.query_variants
    : [{ question: params.question, variant_id: 'single_query', lang_variant: params.lang_variant || null }];

  const variants = rawVariants
    .map((variant, index) => normalizeVariant(params, variant, index))
    .filter((variant) => variant.question);

  if (!variants.length) {
    // NO_QUERY_PASSTHROUGH_V6 — a direct/no-retrieval unit has no query by design.
    // Emit an empty retrieval result instead of failing the whole execution.
    return {
      ...params,
      chunks: [],
      total_chunks: 0,
      variant_chunk_counts: [],
      variant_failures: [],
      retrieval_skipped: true,
      retrieval_skip_reason: 'no_query_direct_unit',
    };
  }

  const variantChunkCounts = [];
  const variantFailures = [];
  const candidates = [];
  let totalChunks = 0;
  let order = 0;

  const retryOptions = {
    maxAttempts: params.ragflow_retry_attempts ?? params.retry_attempts ?? 1,
    baseDelayMs: params.ragflow_retry_delay_ms ?? params.retry_delay_ms ?? 1000,
    timeoutMs: params.ragflow_request_timeout_ms ?? params.request_timeout_ms ?? 30000,
  };
  // RAG_VARIANT_DEDUP_PARALLEL_V7：同一次执行里前面的检索单元已请求过的变体（问句 + 数据集相同）不再重复请求，
  // 其余变体并发请求。MT25 T10 exec 154594：5 个按子问题类型克隆的检索单元共 30 个变体，14 个完全重复，
  // 且逐个串行（每个约 7 秒），检索合计 240 秒。
  const variantConcurrency = 3;
  const groupStartMs = Date.now();
  const groupTimeoutMs = Math.max(5000, Number(params.ragflow_group_timeout_ms ?? params.group_timeout_ms ?? 56000));
  const __variantKey = (p, v) => String((v && v.question) || '').replace(/\s+/g, ' ').trim() + '|' +
    JSON.stringify((Array.isArray(v && v.dataset_ids) && v.dataset_ids.length ? v.dataset_ids : (Array.isArray(p && p.dataset_ids) ? p.dataset_ids : [])).map(String).sort());
  const __doneKeys = new Set();
  try {
    const ri = typeof $runIndex === 'number' ? $runIndex : 0;
    for (let r = 0; r < ri; r += 1) {
      const prev = $('Grouped RAGFlow Retrieval').all(0, r)[0];
      const pp = (prev && prev.json && prev.json.unit && prev.json.unit.params) || {};
      for (const v of (Array.isArray(pp.query_variants) ? pp.query_variants : [])) __doneKeys.add(__variantKey(pp, v));
    }
  } catch (e) {}
  const __fresh = [], __dups = [];
  variants.forEach((variant, variantIndex) => { (__doneKeys.has(__variantKey(params, variant)) ? __dups : __fresh).push({ variant, variantIndex }); });
  if (!__fresh.length && __dups.length) __fresh.push(__dups.shift()); // 至少请求 1 个变体
  for (const d of __dups) {
    variantChunkCounts.push({ variant_id: d.variant.variant_id, lang_variant: d.variant.lang_variant, question: d.variant.question,
      status: 'skipped_already_retrieved_by_earlier_unit', chunk_count: 0 });
  }
  const retrievalResults = await mapWithConcurrency(__fresh, variantConcurrency, async ({ variant, variantIndex }) => {
    const elapsedMs = Date.now() - groupStartMs;
    const remainingMs = groupTimeoutMs - elapsedMs - 1000;

    if (remainingMs <= 1000) {
      return {
        variant,
        variantIndex,
        retrieval: {
          ok: false,
          attempts: 0,
          error: 'Skipped because grouped retrieval time budget was exhausted before this variant.',
        },
        chunks: [],
      };
    }

    const payload = buildPayload(params, variant);
    const perVariantOptions = {
      ...retryOptions,
      timeoutMs: Math.max(1000, Math.min(Number(retryOptions.timeoutMs || 20000), remainingMs)),
    };
    const retrieval = await retrieveVariant(retrievalUrl, headers, payload, verifySsl, variant, perVariantOptions);
    return {
      variant,
      variantIndex,
      retrieval,
      chunks: retrieval.ok ? extractChunks(retrieval.response) : [],
    };
  });

  for (const retrievalResult of retrievalResults) {
    const variant = retrievalResult.variant;
    const retrieval = retrievalResult.retrieval;

    if (!retrieval.ok) {
      const failure = {
        variant_id: variant.variant_id,
        lang_variant: variant.lang_variant,
        question: variant.question,
        status: 'failed',
        attempts: retrieval.attempts,
        error: retrieval.error,
      };
      variantFailures.push(failure);
      variantChunkCounts.push({
        ...failure,
        chunk_count: 0,
      });
      continue;
    }

    const chunks = retrievalResult.chunks;
    totalChunks += chunks.length;
    variantChunkCounts.push({
      variant_id: variant.variant_id,
      lang_variant: variant.lang_variant,
      question: variant.question,
      status: 'ok',
      attempts: retrieval.attempts,
      chunk_count: chunks.length,
    });

    for (const chunk of chunks) {
      const text = getChunkText(chunk);
      if (!text) continue;
      candidates.push({
        chunk,
        text,
        variant,
        order,
      });
      order += 1;
    }
  }

  if (!candidates.length && variantFailures.length) {
    candidates.push({
      chunk: {
        document_name: 'RAGFlow retrieval status',
        dataset_name: 'RAGFlow',
        content: 'No RAGFlow chunks were retrieved for this query group because all query variants failed or timed out: ' +
          variantFailures.map((f) => f.variant_id + ': ' + f.error).join(' | ').slice(0, 1600),
        score: 0,
      },
      text: 'No RAGFlow chunks were retrieved for this query group because all query variants failed or timed out: ' +
        variantFailures.map((f) => f.variant_id + ': ' + f.error).join(' | ').slice(0, 1600),
      variant: {
        variant_id: 'retrieval_group_failure',
        lang_variant: 'status',
        question: params.question || '',
      },
      order,
      retrieval_status_only: true,
    });
    order += 1;
  }

  // TAG_IDENTITY_PROBE_V7
  // MT25 T3（exec 140946）：证据里 PDRA3125 只以报警位号表的一行出现（描述「沉降器与二再差压」），没有材料写明它就是
  // 问句里的「两器压差」，finalizer 写「两器压差本身的报警阈值未检索到」又把 PDRA3125 的值当参考给出。装置技术月报原文
  // 「催化裂化反再两器差压(FC-PDRA3125.PV)」能证明两者等同，但问句式检索召回不到，以位号为查询词可以召回。
  // 对召回片段中出现最多的位号（≤4 个）各补查一次，只保留「名称紧邻该位号且名称与本轮问句共享 ≥3 个汉字」的片段，
  // 作为位号身份依据并入所选证据；当前候选里已有这种依据的位号不补查。
  const __identityCandidates = [];
  try {
    const __qText = [params.resolved_question, params.question, ...variants.map(v => v.question)]
      .map(x => String(x || '')).join(' ');
    const __qChars = new Set(Array.from(__qText.replace(/[^\u4e00-\u9fff]/g, '')));
    const __cjk = x => Array.from(new Set(Array.from(String(x || '').replace(/[^一-鿿]/g, ''))));
    const __sharedWithQ = x => __cjk(x).filter(ch => __qChars.has(ch)).length;
    // TAG_IDENTITY_SUBJECT_NAMES_V7：相关度以设备上下文的主体名称衡量（exec 142990：长问句几乎覆盖所有描述，
    // 按问句共享字数挑出的是 V3204 / LRC3283 等无关位号）。没有设备上下文时退回问句共享字数。
    const __subjectNames = (function () {
      try {
        const d = ((($('Parse Device Context').first().json || {}).device_context) || {}).device || {};
        const names = [d.canonical_name].concat(Array.isArray(d.aliases) ? d.aliases : []).map(x => String(x || '').trim()).filter(Boolean);
        const out = [];
        for (const n of names) {
          out.push(n.replace(/[（(][^）)]*[）)]/g, ''));
          for (const m of n.matchAll(/[（(]([^）)]*)[）)]/g)) out.push(m[1]);
        }
        return out.map(__cjk).filter(chars => chars.length >= 3);
      } catch (e) { return []; }
    })();
    const __coverRatio = x => {
      const l = new Set(__cjk(x));
      let best = 0;
      for (const chars of __subjectNames) {
        const hit = chars.filter(ch => l.has(ch)).length;
        if (hit >= 3 && hit / chars.length >= 0.6) best = Math.max(best, hit / chars.length);
      }
      return best;
    };
    // F62：没有设备上下文主体名称时不补查（按问句共享字数挑位号噪声大，exec 143004）；位号资料由 tag_document_lookup 单元检索。
    const __relevance = x => __subjectNames.length ? __coverRatio(x) : 0;
    const __namesSubject = x => __subjectNames.length ? __coverRatio(x) > 0 : false;
    // 候选位号按「位号旁描述与问句共享的汉字数」挑（位号 描述 / 描述(位号) 两种写法），不按出现频次。
    const __TAGDESC = [
      /(?<![A-Za-z0-9])([A-Z]{1,6}\d{3,5}[A-Z]?)(?![A-Za-z0-9])(?:\.[A-Z]{1,6})?\s*[:：]?\s*([一-鿿][^\s\d<>|，,。；;（）()]{1,30})/g,
      /([一-鿿][^、，,；;。：:\s()（）<>]{1,30})\s*[（(]\s*(?:[A-Z]{1,4}-)?([A-Z]{1,6}\d{3,5}[A-Z]?)(?![A-Za-z0-9])/g
    ];
    const __score = new Map();
    const __descChars = new Map();
    const __noteDesc = (tag, desc) => {
      const sc = __relevance(desc);
      if (!(sc > 0)) return;
      __score.set(tag, Math.max(__score.get(tag) || 0, sc));
      const set = __descChars.get(tag) || new Set();
      for (const ch of __cjk(desc)) set.add(ch);
      __descChars.set(tag, set);
    };
    for (const c of candidates.slice(0, 60)) {
      const text = String(c.text || '').replace(/<[^>]+>/g, ' ');
      for (const m of text.matchAll(__TAGDESC[0])) __noteDesc(m[1], m[2]);
      for (const m of text.matchAll(__TAGDESC[1])) __noteDesc(m[2], m[1]);
    }
    const __bindingLabel = (text, tag) => {
      const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const T = '(?<![A-Za-z0-9])(?:[A-Z]{1,4}[-_])?' + esc + '(?![A-Za-z0-9])(?:\\.[A-Z]{1,4})?';
      const forms = [
        new RegExp('([\\u4e00-\\u9fff][^、，,；;。：:\\s()（）\\[\\]"|]{1,39})\\s*[（(]\\s*' + T + '\\s*[)）]', 'g'),
        new RegExp(T + '\\s*[（(]([^()（）"]{2,40})[)）]', 'g'),
        new RegExp('([\\u4e00-\\u9fff]{2,12})\\s*' + T, 'g')
      ];
      for (const re of forms) {
        for (const m of String(text || '').matchAll(re)) {
          const label = m[1];
          if (!__namesSubject(label)) continue;
          // 身份依据须给出位号自身描述之外的叫法（exec 142964 里 PIC3803 的紧邻名称就是它自己的描述，不算）。
          const own = __descChars.get(tag);
          if (own && __cjk(label).every(ch => own.has(ch))) continue;
          return label;
        }
      }
      return '';
    };
    const __probeTags = Array.from(__score.entries())
      .sort((a, b) => b[1] - a[1])
      .map(x => x[0])
      .filter(tag => !candidates.some(c => __bindingLabel(c.text, tag)))
      .slice(0, 4);
    for (const tag of __probeTags) {
      // NODE_TIME_BUDGET_V7：代码节点 60 秒硬超时（exec 143055 在此被中止）。已用 >40 秒不再补查，单次不越过 52 秒。
      const __elapsed = Date.now() - groupStartMs;
      if (__elapsed > 40000) break;
      const __probeTimeout = Math.min(8000, 52000 - __elapsed);
      if (__probeTimeout < 2000) break;
      // 历史库写法「位号.PV」能召回装置月报「名称(FC-位号.PV)」原文（RAGFlow 实测排第 1）；裸位号召回不到。
      const v = { variant_id: 'identity_probe_' + tag, lang_variant: 'tag_identity_probe', question: tag + '.PV' };
      const payload = buildPayload(params, v);
      payload.page_size = 8;
      const r = await retrieveVariant(retrievalUrl, headers, payload, verifySsl, v, { ...retryOptions, maxAttempts: 1, timeoutMs: __probeTimeout });
      if (!r.ok) continue;
      for (const chunk of extractChunks(r.response)) {
        const text = getChunkText(chunk);
        const label = __bindingLabel(text, tag);
        if (!label) continue;
        const cand = { chunk, text, variant: v, order, identity_probe: { tag, label } };
        order += 1;
        candidates.push(cand);
        __identityCandidates.push(cand);
        break;
      }
    }
    variantChunkCounts.push({ variant_id: 'identity_probe', status: 'ok', probed_tags: __probeTags,
      bound: __identityCandidates.map(c => c.identity_probe) });
  } catch (e) {}

  const maxEvidenceRaw = params.max_grouped_evidence_chunks ?? params.max_evidence_chunks ?? params.post_rag_max_evidence_chunks ?? 80;
  const maxEvidenceText = String(maxEvidenceRaw).trim().toLowerCase();
  const unlimitedEvidence =
    maxEvidenceRaw === undefined ||
    maxEvidenceRaw === null ||
    maxEvidenceText === '' ||
    ['all', 'unlimited', 'none', '0'].includes(maxEvidenceText);
  const maxEvidence = Number(maxEvidenceRaw);
  const selectedLimit =
    unlimitedEvidence || !(Number.isFinite(maxEvidence) && maxEvidence > 0)
      ? Infinity
      : maxEvidence;
  const rankContext = buildRankContext(params, unit, item, variants);
  // RAGFLOW_DOCUMENT_KEYWORD_NAME_V7：数据集 id→名称 取自目录
  __datasetNameById = new Map();
  try {
    const __ds = (((item.catalog || {}).ragflow || {}).datasets) || [];
    for (const d of __ds) {
      if (d && d.id && d.name) __datasetNameById.set(String(d.id), String(d.name));
    }
  } catch (e) {}
  const __chunkFieldNames = (() => {
    const first = candidates.find(c => c && c.chunk && !c.retrieval_status_only);
    return first ? Object.keys(first.chunk).filter(k => !/^(content|content_ltks|content_with_weight|vector|highlight)$/.test(k)) : [];
  })();
  const selected = selectedEvidence(candidates, selectedLimit, rankContext, {
    nearDuplicateThreshold: params.post_rag_near_duplicate_threshold ?? 0.74,
    maxPerDocument: params.post_rag_max_chunks_per_document ?? 20,
    maxPerVariant: params.post_rag_max_chunks_per_variant ?? 40,
  });
  // TAG_IDENTITY_PROBE_V7：身份依据片段不参与排序截断，确保进入所选证据。
  for (const c of __identityCandidates) {
    if (!selected.includes(c)) selected.push(c);
  }
  const postRagRankerStats = selectedEvidence.lastStats || {};
  const { evidence_summary, evidence_digest } = evidenceObjects(selected);

  const noEvidence = evidence_summary.length === 0;
  const result = {
    tool: 'ragflow_retrieval',
    status: 'ok',
    raw_result: {
      retrieval_mode: 'deterministic_grouped_http',
      chunk_count: totalChunks,
      candidate_text_chunk_count: candidates.length,
      deduped_selected_chunk_count: evidence_summary.length,
      variant_count: variants.length,
      variant_chunk_counts: variantChunkCounts,
      variant_failures: variantFailures,
      failed_variant_count: variantFailures.length,
      retry_attempts: Number(retryOptions.maxAttempts || 1),
      request_timeout_ms: Number(retryOptions.timeoutMs || 30000),
      group_timeout_ms: groupTimeoutMs,
      variant_concurrency: variantConcurrency,
      max_evidence_chunks: selectedLimit === Infinity ? 'all' : selectedLimit,
      post_rag_ranker: postRagRankerStats,
      chunk_field_names: __chunkFieldNames,
    },
    answer: noEvidence
      ? 'NO_EVIDENCE'
      : 'Retrieved and combined RAGFlow evidence across ' + variants.length + ' query variant(s); deterministically ranked, near-deduplicated, and selected ' + evidence_summary.length + ' chunk(s) for synthesis.',
    evidence_summary,
    evidence_digest,
    analysis_notes: [
      {
        note_type: 'retrieval_group',
        text: 'Deterministic grouped retrieval ran all query variants first, retried transient retrieval failures, continued past failed variants when other variants returned evidence, combined chunks, exact- and near-deduplicated them, ranked them deterministically by query-token coverage plus RAGFlow score, and passed the selected evidence to the deterministic normalizer and one final answer pass.',
        related_evidence_indices: [],
        related_claim_indices: [],
      },
    ],
  };

  outputItems.push({
    json: {
      ...item,
      output: JSON.stringify(result),
    },
    pairedItem: inputItem.pairedItem,
  });
}

return outputItems;