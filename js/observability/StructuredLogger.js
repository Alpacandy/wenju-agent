/**
 * Structured JSON-lines logger shared by browser modules and Node checks.
 *
 * The logger writes one JSON object per call.  It accepts an injected sink so
 * callers can route records to console, a telemetry buffer, or a test double.
 */
(function initStructuredLogger(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.StructuredLogger = root.StructuredLogger || factory().createLogger();
    root.StructuredLoggerClass = root.StructuredLoggerClass || factory().StructuredLogger;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function structuredLoggerFactory() {
  const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
  const REDACTED = '[REDACTED]';
  const SECRET_KEY = /(api[-_]?key|authorization|token|password|secret|credential)/i;
  let traceCounter = 0;

  function createTraceId(scope) {
    traceCounter += 1;
    return `${scope}-${Date.now().toString(36)}-${traceCounter}`;
  }

  function safeError(error) {
    if (!error) return undefined;
    if (error instanceof Error) {
      return { name: error.name, message: error.message, stack: error.stack };
    }
    if (typeof error === 'object') return error;
    return { message: String(error) };
  }

  function sanitize(value, key, seen) {
    if (SECRET_KEY.test(String(key || ''))) return REDACTED;
    if (value === null || value === undefined) return value;
    if (typeof value === 'bigint') return `${value}n`;
    if (value instanceof Error) return safeError(value);
    if (typeof value !== 'object') return value;
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.map((entry) => sanitize(entry, '', seen));
    const result = {};
    Object.keys(value).forEach((childKey) => {
      result[childKey] = sanitize(value[childKey], childKey, seen);
    });
    return result;
  }

  class StructuredLogger {
    constructor(options = {}) {
      this.scope = options.scope || 'teachagent';
      this.traceId = options.traceId || createTraceId(this.scope);
      this.spanId = options.spanId || null;
      this.minLevel = options.minLevel || 'debug';
      if (!Object.prototype.hasOwnProperty.call(LEVELS, this.minLevel)) {
        throw new TypeError(`Unsupported minimum log level: ${this.minLevel}`);
      }
      this.clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
      this.sink = typeof options.sink === 'function' ? options.sink : null;
    }

    child(fields = {}) {
      return new StructuredLogger({
        scope: fields.scope || this.scope,
        traceId: fields.traceId || this.traceId,
        spanId: fields.spanId || this.spanId,
        minLevel: this.minLevel,
        clock: this.clock,
        sink: this.sink
      });
    }

    log(level, event, fields = {}) {
      const normalizedLevel = String(level || 'info').toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(LEVELS, normalizedLevel)) {
        throw new TypeError(`Unsupported log level: ${level}`);
      }
      if (LEVELS[normalizedLevel] < LEVELS[this.minLevel]) return null;

      let context = fields;
      let error;
      if (fields instanceof Error) {
        error = fields;
        context = {};
      }
      const record = {
        timestamp: this.clock(),
        level: normalizedLevel,
        scope: this.scope,
        event: String(event || 'log')
      };
      Object.assign(record, sanitize(context || {}, '', new WeakSet()));
      record.traceId = this.traceId;
      record.spanId = context && context.spanId !== undefined ? context.spanId : this.spanId;
      ['inputTokens', 'outputTokens', 'durationMs', 'statusCode'].forEach((field) => {
        if (record[field] === undefined) record[field] = null;
      });
      if (error) record.error = safeError(error);

      const line = JSON.stringify(record);
      if (this.sink) {
        this.sink(line, record);
      } else if (typeof console !== 'undefined') {
        const writer = console[normalizedLevel] || console.log;
        if (typeof writer === 'function') writer.call(console, line);
      }
      return record;
    }

    debug(event, fields) { return this.log('debug', event, fields); }
    info(event, fields) { return this.log('info', event, fields); }
    warn(event, fields) { return this.log('warn', event, fields); }

    error(errorOrEvent, fields = {}) {
      if (errorOrEvent instanceof Error) {
        return this.log('error', fields.event || 'error', Object.assign({}, fields, { error: safeError(errorOrEvent) }));
      }
      return this.log('error', errorOrEvent || 'error', fields);
    }
  }

  function createLogger(options) {
    return new StructuredLogger(options);
  }

  return { StructuredLogger, createLogger, LEVELS };
});
