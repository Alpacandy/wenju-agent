/**
 * ToolRegistry: MCP tool dispatch with JSON Schema validation, quotas and
 * deterministic error envelopes. This file runs in browser and CommonJS.
 */
(function (root, factory) {
  const api = factory(
    typeof require !== 'undefined' ? require('./QuotaPolicy.js') : (root && root.QuotaPolicy ? { QuotaPolicy: root.QuotaPolicy, CODES: root.QuotaPolicyCodes, rejection: root.quotaRejection } : {}),
    typeof require !== 'undefined' ? require('./JsonSchemaLite.js') : root && root.TeachAgentSchema
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ToolRegistry = api.ToolRegistry;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (quotaApi, schemaApi) {
  'use strict';

  const QuotaPolicy = quotaApi.QuotaPolicy || class {
    assertToolPayload() {}
    assertToolOutput() {}
    checkRate() {}
  };
  const CODES = quotaApi.CODES || {
    SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
    RATE_LIMITED: 'RATE_LIMITED',
    TOOL_TIMEOUT: 'TOOL_TIMEOUT'
  };
  const makeRejection = quotaApi.rejection || ((code, message, details = {}) => {
    const err = new Error(message); err.code = code; err.rejectionCode = code; err.details = details; return err;
  });

  function traceId() {
    return `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  if (!schemaApi || typeof schemaApi.validateJsonSchema !== 'function') throw new Error('SCHEMA_VALIDATOR_UNAVAILABLE');
  const validateJsonSchema = schemaApi.validateJsonSchema;

  class ToolRegistry {
    constructor(options = {}) {
      this.tools = new Map();
      this.middlewares = [];
      this.metrics = new Map();
      this.quota = options.quotaPolicy || new QuotaPolicy(options.quotas || {});
      this.validation = { maxDepth: options.maxSchemaDepth || 12, maxErrors: options.maxSchemaErrors || 25 };
    }

    use(middleware) {
      if (typeof middleware !== 'function') throw new TypeError('middleware must be a function');
      this.middlewares.push(middleware);
    }

    register(schema, handler, metadata = {}) {
      if (!schema || typeof schema !== 'object' || typeof schema.name !== 'string' || !schema.name.trim()) throw new Error('[ToolRegistry] schema.name is required');
      if (typeof handler !== 'function') throw new TypeError(`[ToolRegistry] handler for ${schema.name} must be a function`);
      if (schema.parameters !== undefined && (!schema.parameters || typeof schema.parameters !== 'object' || Array.isArray(schema.parameters))) throw new Error(`[ToolRegistry] parameters for ${schema.name} must be an object schema`);
      schemaApi.compile(schema.parameters || schema.inputSchema || { type: 'object' }, {strict:metadata.strictSchema===true});
      this.tools.set(schema.name, { schema, handler, metadata: { category: 'general', version: '2.0.0', ...metadata } });
      this.metrics.set(schema.name, { calls: 0, errors: 0, totalLatencyMs: 0, rejected: 0 });
    }

    getSchemas() { return Array.from(this.tools.values()).map((tool) => tool.schema); }

    validateArgs(schema, args) {
      const target = schema.parameters || schema.inputSchema || { type: 'object' };
      const errors = validateJsonSchema(args, target, '$', this.validation);
      if (errors.length === 0) return { valid: true, errors: [] };
      return { valid: false, code: CODES.SCHEMA_VALIDATION_FAILED, errors, error: errors.map((e) => `${e.path} ${e.message}`).join('; ') };
    }

    async invoke(name, args = {}, context = {}) {
      const tool = this.tools.get(name);
      const requestTraceId = context.traceId || traceId();
      if (!tool) return { success: false, code: -32601, rejectionCode: 'TOOL_NOT_FOUND', message: `Tool not found: "${name}"`, traceId: requestTraceId };
      const metric = this.metrics.get(name);
      const reject = (code, message, details = {}, numericCode = -32000) => {
        metric.rejected += 1;
        return { success: false, code: numericCode, rejectionCode: code, message, details, traceId: requestTraceId };
      };
      const validation = this.validateArgs(tool.schema, args);
      if (!validation.valid) return reject(validation.code, `Invalid params for "${name}": ${validation.error}`, { errors: validation.errors }, -32602);
      try {
        this.quota.assertToolPayload(args);
        this.quota.checkRate(name);
      } catch (err) {
        return reject(err.code || CODES.PAYLOAD_TOO_LARGE, err.message, err.details || {});
      }

      metric.calls += 1;
      const startTime = Date.now();
      const timeoutMs = Math.min(tool.metadata.timeoutMs || this.quota.limits?.toolTimeoutMs || 30000, 30 * 1000);
      let timeoutHandle;
      const abortController = new AbortController();
      const hasLinkedSignal = !!(context.signal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function');
      const invocationSignal = hasLinkedSignal ? AbortSignal.any([context.signal, abortController.signal]) : abortController.signal;
      let completed = false;
      let rejectCancellation;
      const cancelled = new Promise((_, rejectPromise) => { rejectCancellation = rejectPromise; });
      const callerAbort = () => {
        abortController.abort(context.signal && context.signal.reason);
        rejectCancellation(makeRejection('ABORTED', `Tool "${name}" aborted`));
      };
      if (context.signal) {
        if (context.signal.aborted) callerAbort();
        else context.signal.addEventListener('abort', callerAbort, { once: true });
      }
      const invocationContext = {
        ...context, traceId: requestTraceId, signal: invocationSignal,
        isRunActive: () => !invocationSignal.aborted && (!context.isRunActive || context.isRunActive()),
        throwIfCancelled: () => {
          if (invocationSignal.aborted) throw makeRejection('ABORTED', `Tool "${name}" aborted`);
          if (context.throwIfCancelled) context.throwIfCancelled();
        }
      };
      try {
        let currentIdx = 0;
        const executeChain = async (currArgs) => {
          invocationContext.throwIfCancelled();
          if (currentIdx < this.middlewares.length) return this.middlewares[currentIdx++](name, currArgs, executeChain);
          return tool.handler(currArgs, invocationContext);
        };
        const execution = Promise.resolve().then(() => executeChain(args));
        const timeout = new Promise((_, rejectPromise) => timeoutHandle = setTimeout(() => { abortController.abort(); rejectPromise(makeRejection(CODES.TOOL_TIMEOUT, `Tool "${name}" timed out`, { timeoutMs })); }, timeoutMs));
        const result = await Promise.race([execution, timeout, cancelled]);
        invocationContext.throwIfCancelled();
        this.quota.assertToolOutput(result);
        const latency = Date.now() - startTime;
        metric.totalLatencyMs += latency;
        completed = true;
        return { success: true, data: result, traceId: requestTraceId, meta: { tool: name, latencyMs: latency } };
      } catch (err) {
        metric.errors += 1;
        const code = err.code || 'TOOL_EXECUTION_FAILED';
        return { success: false, code: code === CODES.TOOL_TIMEOUT ? -32001 : -32000, rejectionCode: code, message: err.message || `Tool "${name}" execution failed`, details: err.details || {}, traceId: requestTraceId, errorDetail: err.stack };
      } finally {
        clearTimeout(timeoutHandle);
        // Successful tools may keep an iframe or animation alive until this turn stops.
        // AbortSignal.any preserves that link after the invocation promise has settled.
        if (hasLinkedSignal || !completed) context.signal?.removeEventListener('abort', callerAbort);
      }
    }

    getMetrics() {
      const report = {};
      for (const [name, metric] of this.metrics.entries()) report[name] = {
        calls: metric.calls, errors: metric.errors, rejected: metric.rejected,
        avgLatencyMs: metric.calls > 0 ? (metric.totalLatencyMs / metric.calls).toFixed(2) : 0
      };
      return report;
    }
  }

  return { ToolRegistry, validateJsonSchema };
});
