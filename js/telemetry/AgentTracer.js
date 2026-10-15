/**
 * AgentTracer —— 结构化智能体遥测（P6-B · OTel 风格，满足 AGENTS.md 第 13 条）
 *
 * 对齐 zcode `telemetry/src/agent-trace-runtime.ts` + `agent-metrics.ts` 的 span 生命周期语义：
 *   trace（会话级，复用引擎 traceId）→ span 树（model.request / tool.call / round）
 *   每条 span 记录：时间戳、traceId/spanId/parentSpanId、名称、耗时、状态、属性
 *   属性强制含：模型名、轮次 stage、HTTP 状态码、输入/输出字符数与 token 用量（可得时）、工具名与结果状态
 *
 * 导出器端口（多路广播）：
 *   MemoryExporter（容量环形，测试/查询）
 *   ConsoleJsonlExporter（JSONL 单行——结构化日志，可接任意 sink，默认 console.debug）
 *   LocalStorageRingExporter（本地持久化环形，上限可配，淘汰最旧）
 *
 * 关键纪律：tracer 任何异常不得影响主流程（所有导出 try/catch 隔离）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.AgentTracer = api.AgentTracer; root.agentTracerExporters = { MemoryExporter: api.MemoryExporter, ConsoleJsonlExporter: api.ConsoleJsonlExporter, LocalStorageRingExporter: api.LocalStorageRingExporter }; root.getSharedAgentTracer = api.getSharedTracer; }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const SPAN_SCHEMA = 'teachagent.span.v1';

  function rid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- 导出器 ----------
  class MemoryExporter {
    constructor(capacity) { this.capacity = capacity || 2000; this.spans = []; }
    export(span) {
      this.spans.push(span);
      if (this.spans.length > this.capacity) this.spans.splice(0, this.spans.length - this.capacity);
    }
    query(traceId) { return traceId ? this.spans.filter((s) => s.traceId === traceId) : this.spans.slice(); }
    /** P7-H6：已记录的全部 traceId（/metrics 聚合枚举用） */
    traceIds() { return [...new Set(this.spans.map((s) => s.traceId))]; }
    clear() { this.spans = []; }
  }

  class ConsoleJsonlExporter {
    constructor(sink) { this.sink = typeof sink === 'function' ? sink : null; }
    export(span) {
      const line = JSON.stringify(span);
      if (this.sink) { this.sink(line); return; }
      if (typeof console !== 'undefined' && console.debug) console.debug(line);
    }
  }

  class LocalStorageRingExporter {
    constructor(key, capacity, storage) {
      this.key = key || 'wenju_spans_v1';
      this.capacity = capacity || 500;
      this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    }
    _read() {
      if (!this.storage) return [];
      try { return JSON.parse(this.storage.getItem(this.key) || '[]'); } catch (e) { return []; }
    }
    export(span) {
      if (!this.storage) return;
      try {
        const all = this._read();
        all.push(span);
        if (all.length > this.capacity) all.splice(0, all.length - this.capacity);
        this.storage.setItem(this.key, JSON.stringify(all));
      } catch (e) { /* 容量超限等：静默丢弃本次导出，不影响主流程 */ }
    }
    read() { return this._read(); }
  }

  // ---------- Tracer ----------
  class AgentTracer {
    /**
     * @param {object} [options] { exporters: [], clock: ()=>ms }
     */
    constructor(options = {}) {
      this.exporters = options.exporters || [];
      this.clock = options.clock || (() => Date.now());
      this.traces = new Map(); // traceId -> { name, startedAt, attributes }
      this.openSpans = new Map(); // spanId -> span（未结束）
      // P7-H6：自持环形记录——spansOf/traceIds 不依赖具体导出器配置（浏览器共享 tracer 仅挂环形导出器时也可查询）
      this.records = [];
      this.recordCapacity = options.recordCapacity || 2000;
    }

    /** 采用外部 traceId（与引擎会话 traceId 对齐）；首次见到的 trace 注册元信息 */
    useTrace(traceId, name, attributes) {
      const tid = traceId || rid('trace_');
      if (!this.traces.has(tid)) {
        this.traces.set(tid, { name: name || 'session', startedAt: new Date().toISOString(), attributes: attributes || {} });
      }
      return tid;
    }

    /** 开 span；parentSpanId 可选（树形） */
    startSpan({ traceId, name, parentSpanId = null, attributes = {} }) {
      const tid = this.useTrace(traceId, 'session');
      const span = {
        spanId: rid('span_'),
        traceId: tid,
        parentSpanId,
        name,
        startMs: this.clock(),
        attributes: Object.assign({}, attributes)
      };
      this.openSpans.set(span.spanId, span);
      return span;
    }

    /** 结束 span → 生成记录并广播给全部导出器 */
    endSpan(span, { status = 'ok', attributes = {} } = {}) {
      if (!span || !this.openSpans.has(span.spanId)) return null;
      this.openSpans.delete(span.spanId);
      const endMs = this.clock();
      const record = {
        schema: SPAN_SCHEMA,
        ts: new Date(endMs).toISOString(),
        traceId: span.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        durationMs: endMs - span.startMs,
        status,
        attributes: Object.assign({}, span.attributes, attributes)
      };
      this.records.push(record);
      if (this.records.length > this.recordCapacity) this.records.splice(0, this.records.length - this.recordCapacity);
      for (const ex of this.exporters) {
        try { ex.export(record); } catch (e) { /* 导出隔离：不影响主流程 */ }
      }
      return record;
    }

    /**
     * 便捷测量：fn 抛出时记录 status='error' + errorCode 后原样 rethrow（不吞错）。
     */
    async measure(span, fn, onDone) {
      try {
        const result = await fn();
        const attrs = typeof onDone === 'function' ? onDone(result, null) : {};
        this.endSpan(span, { status: 'ok', attributes: attrs || {} });
        return result;
      } catch (err) {
        const code = (err && (err.code || err.status)) || 'ERROR';
        this.endSpan(span, { status: 'error', attributes: { errorCode: String(code), errorMessage: String(err && err.message || err).slice(0, 240) } });
        throw err;
      }
    }

    /** 某 trace 的全部 span（按结束时间；自持记录 ∪ Memory 导出器，按 spanId 去重） */
    spansOf(traceId) {
      const byId = new Map();
      for (const rec of this.records) {
        if (!traceId || rec.traceId === traceId) byId.set(rec.spanId, rec);
      }
      for (const ex of this.exporters) {
        if (ex instanceof MemoryExporter) for (const rec of ex.query(traceId)) byId.set(rec.spanId, rec);
      }
      return [...byId.values()].sort((a, b) => a.ts.localeCompare(b.ts));
    }

    /** P7-H6：当前 tracer 已知的全部 traceId（/metrics 聚合枚举用） */
    traceIds() {
      const ids = new Set(this.traces ? [...this.traces.keys()] : []);
      for (const rec of this.records) ids.add(rec.traceId);
      for (const ex of this.exporters) {
        if (ex instanceof MemoryExporter && typeof ex.traceIds === 'function') for (const id of ex.traceIds()) ids.add(id);
      }
      return [...ids];
    }

    /** span 树构造（parentSpanId 链接；孤儿挂根） */
    treeOf(traceId) {
      const spans = this.spansOf(traceId);
      const byId = new Map(spans.map((s) => [s.spanId, { span: s, children: [] }]));
      const roots = [];
      for (const node of byId.values()) {
        if (node.span.parentSpanId && byId.has(node.span.parentSpanId)) byId.get(node.span.parentSpanId).children.push(node);
        else roots.push(node);
      }
      return roots;
    }

    getStatus() {
      return { traces: this.traces.size, openSpans: this.openSpans.size, exporters: this.exporters.map((e) => e.constructor.name) };
    }
  }

  let shared = null;
  function getSharedTracer() {
    if (shared) return shared;
    if (typeof window === 'undefined') return null;
    shared = new AgentTracer({ exporters: [new LocalStorageRingExporter('wenju_spans_v1', 500)] });
    window.agentTracer = shared;
    return shared;
  }

  return { AgentTracer, MemoryExporter, ConsoleJsonlExporter, LocalStorageRingExporter, SPAN_SCHEMA, getSharedTracer };
});
