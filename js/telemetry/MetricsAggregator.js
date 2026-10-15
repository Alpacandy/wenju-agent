/**
 * MetricsAggregator —— 运行指标聚合（P7-H6，对齐 AGENTS 第 21 条与接管白皮书 P2-4）
 *
 * 输入：AgentTracer 的 span 记录（含 name/durationMs/status/attributes.usage）。
 * 输出：按 span 名聚合的 count / p50 / p95 / p99 / max / mean、错误率、token 汇总与成本估算。
 *
 * 口径纪律：
 *   - 分位数用最近秩法（nearest-rank，ceil(p/100 * n) 位）——小样本下可手算对拍；
 *   - 成本估算只在模型价目表存在时给出；缺价目 → 显式 'UNKNOWN'（不猜测单价）；
 *   - 无样本 → 返回 null 而非 0（区分"未观测"与"观测到 0"）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MetricsAggregator = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  /** 每 1K token 的美元单价（USD / 1K tokens）；未列出的模型 → UNKNOWN */
  const DEFAULT_PRICE_TABLE = {
    'Qwen/Qwen2.5-7B-Instruct': { prompt: 0, completion: 0, note: '平台免费体验额度（占位 0；实际计费以供应商账单为准）' },
    'MiniMax-M3': { prompt: 0.0003, completion: 0.0012 },
    'MiniMax-M3.1-Flash-Preview': { prompt: 0.0003, completion: 0.0012 }
  };

  /** 最近秩分位数（p ∈ (0,100]）；空数组 → null */
  function percentile(values, p) {
    const arr = values.filter((v) => typeof v === 'number' && !Number.isNaN(v)).slice().sort((a, b) => a - b);
    if (!arr.length) return null;
    const rank = Math.max(1, Math.ceil((p / 100) * arr.length));
    return arr[Math.min(rank, arr.length) - 1];
  }

  function summarize(values, statuses) {
    const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
    if (!nums.length) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    const errs = statuses.filter((s) => s && s !== 'ok').length;
    return {
      count: nums.length,
      mean: Number((sum / nums.length).toFixed(2)),
      p50: percentile(nums, 50),
      p95: percentile(nums, 95),
      p99: percentile(nums, 99),
      max: Math.max(...nums),
      min: Math.min(...nums),
      errorCount: errs,
      errorRate: Number((errs / nums.length).toFixed(4))
    };
  }

  /**
   * 聚合 span 列表。
   * @param {Array} spans - AgentTracer 导出记录
   * @param {object} [options] - { priceTable }
   * @returns {{byName:Object, totals:Object, tokens:Object, cost:Object, traceCount:number}}
   */
  function aggregate(spans, options = {}) {
    const list = Array.isArray(spans) ? spans : [];
    const priceTable = options.priceTable || DEFAULT_PRICE_TABLE;
    const byName = {};
    const traces = new Set();
    let tokenPrompt = 0; let tokenCompletion = 0; let tokenTotal = 0; let tokenSamples = 0; let tokensUnknown = 0;
    const costUnknownModels = new Set();
    let costUsd = 0;

    for (const span of list) {
      if (!span || !span.name) continue;
      if (span.traceId) traces.add(span.traceId);
      const bucket = byName[span.name] || (byName[span.name] = { durations: [], statuses: [] });
      bucket.durations.push(span.durationMs);
      bucket.statuses.push(span.status);

      const usage = span.attributes && span.attributes.usage;
      if (usage && typeof usage === 'object') {
        const p = Number(usage.prompt);
        const c = Number(usage.completion);
        if (Number.isFinite(p) && Number.isFinite(c)) {
          tokenPrompt += p; tokenCompletion += c;
          tokenTotal += Number.isFinite(Number(usage.total)) ? Number(usage.total) : (p + c);
          tokenSamples += 1;
          const model = span.attributes && span.attributes.model;
          const price = model && priceTable[model];
          if (price && Number.isFinite(price.prompt) && Number.isFinite(price.completion)) {
            costUsd += (p / 1000) * price.prompt + (c / 1000) * price.completion;
          } else if (model) {
            costUnknownModels.add(model);
          }
        } else {
          tokensUnknown += 1;
        }
      }
    }

    const summary = {};
    const allDurations = [];
    const allStatuses = [];
    for (const [name, bucket] of Object.entries(byName)) {
      summary[name] = summarize(bucket.durations, bucket.statuses);
      allDurations.push(...bucket.durations);
      allStatuses.push(...bucket.statuses);
    }

    return {
      byName: summary,
      totals: summarize(allDurations, allStatuses),
      tokens: tokenSamples || tokensUnknown
        ? { prompt: tokenPrompt, completion: tokenCompletion, total: tokenTotal, samples: tokenSamples, unknownSamples: tokensUnknown }
        : null,
      cost: (tokenSamples > 0)
        ? {
            usd: costUnknownModels.size ? 'UNKNOWN' : Number(costUsd.toFixed(6)),
            usdKnownPart: Number(costUsd.toFixed(6)),
            unknownModels: [...costUnknownModels]
          }
        : null,
      traceCount: traces.size
    };
  }

  /** 人类可读报告（/metrics 命令使用） */
  function formatReport(agg) {
    const lines = ['📊 运行指标（本会话 span 聚合）'];
    if (!agg || !agg.totals) { lines.push('  （暂无样本：请先发起至少一次会话请求）'); return lines.join('\n'); }
    const row = (label, s) => s ? `  ${label}：n=${s.count} p50=${s.p50}ms p95=${s.p95}ms p99=${s.p99}ms max=${s.max}ms 错误率=${(s.errorRate * 100).toFixed(1)}%` : `  ${label}：（无样本）`;
    lines.push(row('全部 span', agg.totals));
    for (const [name, s] of Object.entries(agg.byName)) lines.push(row('· ' + name, s));
    if (agg.tokens) lines.push(`  Token：prompt=${agg.tokens.prompt} completion=${agg.tokens.completion} total=${agg.tokens.total}（样本 ${agg.tokens.samples}）`);
    if (agg.cost) lines.push(`  成本估算：$${agg.cost.usdKnownPart}${agg.cost.unknownModels.length ? ' + UNKNOWN（未列价目：' + agg.cost.unknownModels.join(', ') + '）' : ''}`);
    lines.push(`  会话 trace 数：${agg.traceCount}`);
    return lines.join('\n');
  }

  return { aggregate, percentile, formatReport, DEFAULT_PRICE_TABLE };
});
