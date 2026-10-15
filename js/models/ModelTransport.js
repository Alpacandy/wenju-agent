/**
 * Shared HTTP/SSE transport contract for model providers.
 *
 * The transport owns request timeouts, bounded retries, response errors and
 * OpenAI-compatible SSE decoding. Provider/model selection remains outside
 * this module. It is intentionally dependency-free so it can run in a
 * browser and in Node.js tests.
 */

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function redact(value, secret) {
  let text = String(value == null ? '' : value);
  if (secret && String(secret).length >= 4) text = text.split(String(secret)).join('[REDACTED_KEY]');
  return text
    .replace(/Bearer\s+[^\s"',}]+/gi, '[REDACTED_AUTH]')
    .replace(/(?:sk|key|token)[-_][A-Za-z0-9._-]{4,}/gi, '[REDACTED_SECRET]');
}

function logTransportError(event, error) {
  const payload = { event, error: String(error && error.message || error || 'unknown') };
  if (typeof globalThis !== 'undefined' && globalThis.StructuredLogger && typeof globalThis.StructuredLogger.warn === 'function') {
    globalThis.StructuredLogger.warn(event, payload);
  } else if (typeof console !== 'undefined' && console.debug) {
    console.debug(`[ModelTransport] ${event}`, payload);
  }
}

function numeric(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

class ModelTransportError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ModelTransportError';
    this.code = details.code || 'TRANSPORT_ERROR';
    this.status = details.status == null ? undefined : details.status;
    this.retryable = !!details.retryable;
    this.attempts = numeric(details.attempts, 1);
    this.incomplete = !!details.incomplete;
    this.partialContent = details.partialContent || '';
    this.details = details.details || undefined;
    if (details.cause) this.cause = details.cause;
  }
}

function isAbortError(error) {
  return !!error && (error.name === 'AbortError' || error.code === 'ABORT_ERR' || error.code === 'ABORTED');
}

function throwIfAborted(signal, details = {}) {
  if (signal && signal.aborted) throw new ModelTransportError('Model request aborted by caller', { ...details, code: 'ABORTED' });
}

function awaitWithSignal(operation, signal, details = {}) {
  throwIfAborted(signal, details);
  if (!signal) return operation();
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new ModelTransportError('Model request aborted by caller', { ...details, code: 'ABORTED' }));
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { throwIfAborted(signal, details); return operation(); }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function createAbortController(signal, timeoutMs) {
  const controller = new AbortController();
  let timer = null;
  let callerAborted = false;
  const abort = () => {
    callerAborted = true;
    try { controller.abort(signal && signal.reason); } catch (error) { logTransportError('caller_abort_fallback', error); controller.abort(); }
  };
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      try { controller.abort(new Error('transport timeout')); } catch (error) { logTransportError('timeout_abort_fallback', error); controller.abort(); }
    }, timeoutMs);
  }
  return {
    signal: controller.signal,
    wasCallerAborted: () => callerAborted,
    dispose: () => {
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
    }
  };
}

function getFetch(explicitFetch) {
  const fn = explicitFetch || (typeof fetch === 'function' ? fetch : null);
  if (typeof fn !== 'function') throw new ModelTransportError('Fetch API is unavailable', { code: 'FETCH_UNAVAILABLE' });
  return fn;
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

class ModelTransport {
  constructor(options = {}) {
    if (!options || typeof options !== 'object') throw new TypeError('ModelTransport options must be an object');
    this.fetch = options.fetch || null;
    this.defaultTimeoutMs = numeric(options.timeoutMs, 30000);
    this.maxRetries = Math.max(0, Math.floor(numeric(options.maxRetries, 2)));
    this.retryBaseMs = Math.max(0, numeric(options.retryBaseMs, 250));
    this.maxRetryDelayMs = Math.max(this.retryBaseMs, numeric(options.maxRetryDelayMs, 10000));
    this.sleep = typeof options.sleep === 'function'
      ? options.sleep
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    this.secret = options.apiKey || options.secret || null;
  }

  _normaliseRequestArgs(urlOrRequest, requestOptions) {
    if (typeof urlOrRequest === 'string' || (typeof URL !== 'undefined' && urlOrRequest instanceof URL)) {
      return { url: String(urlOrRequest), options: { ...(requestOptions || {}) } };
    }
    if (urlOrRequest && typeof urlOrRequest === 'object' && typeof urlOrRequest.url === 'string') {
      const { url, ...rest } = urlOrRequest;
      return { url, options: { ...rest, ...(requestOptions || {}) } };
    }
    throw new TypeError('ModelTransport.request requires a URL or { url } request');
  }

  _isRetryable(error, response) {
    if (response) return RETRYABLE_STATUS.has(response.status);
    if (!error) return false;
    return !isAbortError(error) && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.name === 'TypeError' || error.code === 'NETWORK_ERROR');
  }

  _delayFor(attempt, response) {
    const retryAfter = response && response.headers && typeof response.headers.get === 'function'
      ? parseRetryAfter(response.headers.get('retry-after'))
      : null;
    if (retryAfter != null) return Math.min(this.maxRetryDelayMs, retryAfter);
    return Math.min(this.maxRetryDelayMs, this.retryBaseMs * Math.pow(2, Math.max(0, attempt - 1)));
  }

  async request(urlOrRequest, requestOptions = {}) {
    const { url, options } = this._normaliseRequestArgs(urlOrRequest, requestOptions);
    const fetchFn = getFetch(options.fetch || this.fetch);
    const timeoutMs = options.timeoutMs == null ? this.defaultTimeoutMs : numeric(options.timeoutMs, this.defaultTimeoutMs);
    const maxRetries = options.maxRetries == null ? this.maxRetries : Math.max(0, Math.floor(numeric(options.maxRetries, this.maxRetries)));
    const headers = { ...(options.headers || {}) };
    const fetchOptions = { ...options };
    if (fetchOptions.json !== undefined && fetchOptions.body === undefined) {
      fetchOptions.body = JSON.stringify(fetchOptions.json);
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
    }
    delete fetchOptions.fetch;
    delete fetchOptions.json;
    delete fetchOptions.timeoutMs;
    delete fetchOptions.maxRetries;
    delete fetchOptions.retryBaseMs;
    delete fetchOptions.maxRetryDelayMs;
    delete fetchOptions.idleTimeoutMs;
    delete fetchOptions.secret;
    delete fetchOptions.callbacks;
    delete fetchOptions.onChunk;
    delete fetchOptions.onReasoning;
    delete fetchOptions.onToolCall;
    delete fetchOptions.onEvent;
    delete fetchOptions.onDone;
    delete fetchOptions.onError;
    let attempt = 0;

    while (true) {
      throwIfAborted(fetchOptions.signal, { attempts: attempt });
      attempt += 1;
      const controller = createAbortController(fetchOptions.signal, timeoutMs);
      try {
        const response = await awaitWithSignal(() => fetchFn(url, { ...fetchOptions, headers, signal: controller.signal }), controller.signal, { attempts: attempt });
        throwIfAborted(fetchOptions.signal, { attempts: attempt });
        controller.dispose();
        const status = response && response.status;
        const success = response && (response.ok === true || (response.ok == null && status >= 200 && status < 300));
        if (success) return response;
        const retryable = this._isRetryable(null, response);
        if (!retryable || attempt > maxRetries) {
          let body = '';
          try { body = response && typeof response.text === 'function' ? await awaitWithSignal(() => response.text(), fetchOptions.signal) : ''; } catch (error) { if (isAbortError(error)) throw error; logTransportError('error_body_read_failed', error); body = ''; }
          const code = status === 401 || status === 403 ? 'AUTH_ERROR' : `HTTP_${status || 'ERROR'}`;
          throw new ModelTransportError(`Model request failed (${status || 'no status'})${body ? `: ${redact(body.slice(0, 500), options.secret || this.secret)}` : ''}`, {
            code, status, retryable, attempts: attempt,
            details: { body: redact(body.slice(0, 500), options.secret || this.secret) }
          });
        }
        await awaitWithSignal(() => this.sleep(this._delayFor(attempt, response)), fetchOptions.signal, { attempts: attempt });
      } catch (error) {
        controller.dispose();
        if (controller.wasCallerAborted() || fetchOptions.signal?.aborted) {
          throw new ModelTransportError('Model request aborted by caller', { code: 'ABORTED', attempts: attempt, cause: error });
        }
        if (error instanceof ModelTransportError && error.status != null) throw error;
        const timedOut = controller.signal.aborted || isAbortError(error);
        const retryable = !timedOut && this._isRetryable(error);
        if (!retryable || attempt > maxRetries) {
          throw new ModelTransportError(timedOut ? `Model request timed out after ${timeoutMs}ms` : `Model request failed: ${redact(error && error.message, options.secret || this.secret)}`, {
            code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', retryable, attempts: attempt, cause: error
          });
        }
        await awaitWithSignal(() => this.sleep(this._delayFor(attempt)), fetchOptions.signal, { attempts: attempt });
      }
    }
  }

  async json(urlOrRequest, requestOptions = {}) {
    const { options } = this._normaliseRequestArgs(urlOrRequest, requestOptions);
    const response = await this.request(urlOrRequest, requestOptions);
    try {
      const result = await awaitWithSignal(() => response.json(), options.signal);
      throwIfAborted(options.signal);
      return result;
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ModelTransportError('Model response is not valid JSON', { code: 'INVALID_JSON', attempts: 1, cause: error });
    }
  }

  requestJson(urlOrRequest, requestOptions = {}) {
    return this.json(urlOrRequest, requestOptions);
  }

  _normaliseSseArgs(urlOrResponse, requestOptions, callbacks) {
    if (urlOrResponse && typeof urlOrResponse === 'object' && typeof urlOrResponse.body?.getReader === 'function') {
      return { response: urlOrResponse, options: requestOptions || {}, callbacks: callbacks || {} };
    }
    const options = this._normaliseRequestArgs(urlOrResponse, requestOptions).options;
    return { response: null, options, callbacks: callbacks || options.callbacks || {} };
  }

  async streamSSE(urlOrResponse, requestOptions = {}, callbacks) {
    const normalised = this._normaliseSseArgs(urlOrResponse, requestOptions, callbacks);
    const response = normalised.response || await this.request(urlOrResponse, normalised.options);
    const options = normalised.options;
    const cbs = { onChunk: options.onChunk, onReasoning: options.onReasoning, onToolCall: options.onToolCall, onEvent: options.onEvent, onDone: options.onDone, onError: options.onError, ...(options.callbacks || {}), ...(normalised.callbacks || {}) };
    if (!response || !response.body || typeof response.body.getReader !== 'function') {
      throw new ModelTransportError('SSE response body is not readable', { code: 'SSE_BODY_UNAVAILABLE' });
    }
    if (response.ok === false) throw new ModelTransportError(`SSE request failed (${response.status})`, { code: `HTTP_${response.status}`, status: response.status });

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let content = '';
    let reasoning = '';
    let model = options.model;
    let usage = {};
    let finishReason = null;
    let endedByDone = false;
    const toolCalls = [];
    const emit = (name, ...args) => { if ((name === 'onError' || !options.signal?.aborted) && typeof cbs[name] === 'function') cbs[name](...args); };
    const idleTimeoutMs = options.idleTimeoutMs == null
      ? (options.timeoutMs == null ? this.defaultTimeoutMs : numeric(options.timeoutMs, this.defaultTimeoutMs))
      : numeric(options.idleTimeoutMs, this.defaultTimeoutMs);
    const readChunk = () => {
      throwIfAborted(options.signal, { incomplete: true, partialContent: content });
      return new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => { if (timer) clearTimeout(timer); options.signal?.removeEventListener('abort', abort); };
        const abort = () => { cleanup(); reject(new ModelTransportError('Model stream aborted by caller', { code: 'ABORTED', incomplete: true, partialContent: content })); };
        options.signal?.addEventListener('abort', abort, { once: true });
        if (idleTimeoutMs > 0) timer = setTimeout(() => {
          cleanup();
          reject(new ModelTransportError(`SSE stream idle timeout after ${idleTimeoutMs}ms`, { code: 'TIMEOUT', incomplete: true, partialContent: content }));
        }, idleTimeoutMs);
        Promise.resolve().then(() => { throwIfAborted(options.signal); return reader.read(); }).then(
          (chunk) => { cleanup(); resolve(chunk); },
          (error) => { cleanup(); reject(error); }
        );
      });
    };

    const applyEvent = async (rawData) => {
      throwIfAborted(options.signal, { incomplete: true, partialContent: content });
      const data = rawData.trim();
      if (!data) return;
      if (data === '[DONE]') { endedByDone = true; return; }
      let parsed;
      try { parsed = JSON.parse(data); } catch (error) {
        if (options.ignoreParseErrors) return;
        throw new ModelTransportError('Invalid SSE JSON payload', { code: 'SSE_PARSE_ERROR', cause: error, incomplete: true, partialContent: content });
      }
      emit('onEvent', parsed);
      throwIfAborted(options.signal, { incomplete: true, partialContent: content });
      if (parsed && parsed.error) {
        const detail = typeof parsed.error === 'object' ? [parsed.error.code, parsed.error.type, parsed.error.message].filter(Boolean).join(' ') : String(parsed.error);
        throw new ModelTransportError(`Cloud stream returned an error: ${redact(detail, options.secret || this.secret).slice(0, 500)}`, {
          code: 'CLOUD_ERROR', incomplete: true, partialContent: content,
          details: { error: redact(JSON.stringify(parsed.error), options.secret || this.secret).slice(0, 500) }
        });
      }
      model = parsed.model || model;
      usage = parsed.usage || usage;
      const choice = parsed.choices && parsed.choices[0];
      if (!choice) return;
      finishReason = choice.finish_reason || finishReason;
      const delta = choice.delta || {};
      const thought = delta.reasoning_content || delta.thinking || (delta.reasoning_details && delta.reasoning_details.text) || '';
      if (thought) { reasoning += String(thought); emit('onReasoning', String(thought), reasoning); }
      throwIfAborted(options.signal, { incomplete: true, partialContent: content });
      if (delta.content) { content += String(delta.content); emit('onChunk', String(delta.content), content); }
      if (Array.isArray(delta.tool_calls)) {
        delta.tool_calls.forEach((call, position) => {
          throwIfAborted(options.signal, { incomplete: true, partialContent: content });
          const index = Number.isInteger(call.index) ? call.index : position;
          const current = toolCalls[index] || { index, id: '', type: 'function', function: { name: '', arguments: '' } };
          if (call.id) current.id = call.id;
          if (call.type) current.type = call.type;
          const fn = call.function || {};
          if (fn.name) current.function.name += String(fn.name);
          if (fn.arguments) current.function.arguments += String(fn.arguments);
          toolCalls[index] = current;
          emit('onToolCall', call, toolCalls.slice());
        });
      }
    };

    try {
      let dataLines = [];
      while (true) {
        const chunk = await readChunk();
        throwIfAborted(options.signal, { incomplete: true, partialContent: content });
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line === '') {
            if (dataLines.length) { await applyEvent(dataLines.join('\n')); dataLines = []; }
            continue;
          }
          if (line.startsWith(':')) continue;
          if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        if (endedByDone) { try { if (typeof reader.cancel === 'function') await reader.cancel(); } catch (error) { logTransportError('sse_reader_cancel_failed', error); } break; }
      }
      buffer += decoder.decode();
      if (buffer.trim()) buffer.split(/\r?\n/).forEach((line) => { if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, '')); });
      if (dataLines.length) await applyEvent(dataLines.join('\n'));
      throwIfAborted(options.signal, { incomplete: true, partialContent: content });
      const result = { content, reasoning_content: reasoning, tool_calls: toolCalls.filter(Boolean), model, usage, finish_reason: finishReason, endedByDone, incomplete: false };
      emit('onDone', result);
      return result;
    } catch (error) {
      let transportError = options.signal?.aborted
        ? new ModelTransportError('Model stream aborted by caller', { code: 'ABORTED', cause: error, incomplete: true, partialContent: content })
        : (error instanceof ModelTransportError ? error : new ModelTransportError(`SSE stream failed: ${redact(error && error.message, options.secret || this.secret)}`, { code: 'SSE_ERROR', cause: error, incomplete: true, partialContent: content }));
      if (!transportError.partialContent) transportError.partialContent = content;
      if (!transportError.incomplete) transportError.incomplete = true;
      emit('onError', transportError);
      try { if (typeof reader.cancel === 'function') Promise.resolve(reader.cancel()).catch((error) => logTransportError('sse_reader_cancel_after_error_failed', error)); } catch (error) { logTransportError('sse_reader_cancel_after_error_failed', error); }
      throw transportError;
    }
  }

  stream(urlOrResponse, requestOptions = {}, callbacks) {
    return this.streamSSE(urlOrResponse, requestOptions, callbacks);
  }
}

if (typeof window !== 'undefined') {
  window.ModelTransport = ModelTransport;
  window.ModelTransportError = ModelTransportError;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ModelTransport, ModelTransportError, redact, RETRYABLE_STATUS };
}
