/**
 * Shared quota, path and rejection-code policy.
 * The policy is deliberately dependency-free so browser and Node runtimes use
 * identical limits and error shapes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.QuotaPolicy = api.QuotaPolicy;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    fileMaxBytes: 2 * 1024 * 1024,
    workspaceMaxBytes: 200 * 1024 * 1024,
    artifactVersionMaxBytes: 4 * 1024 * 1024,
    artifactTotalBytes: 200 * 1024 * 1024,
    logEventMaxBytes: 64 * 1024,
    localStorageEntryMaxBytes: 2 * 1024 * 1024,
    localStorageTotalBytes: 10 * 1024 * 1024,
    maxJsonDepth: 12,
    maxToolInputBytes: 2 * 1024 * 1024,
    maxToolOutputBytes: 4 * 1024 * 1024,
    toolTimeoutMs: 30 * 1000,
    toolCallsPerMinute: 120
  });

  const CODES = Object.freeze({
    INVALID_PARAMS: 'INVALID_PARAMS',
    SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
    PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
    FILE_QUOTA_EXCEEDED: 'FILE_QUOTA_EXCEEDED',
    ARTIFACT_QUOTA_EXCEEDED: 'ARTIFACT_QUOTA_EXCEEDED',
    LOG_QUOTA_EXCEEDED: 'LOG_QUOTA_EXCEEDED',
    LOCAL_STORAGE_QUOTA_EXCEEDED: 'LOCAL_STORAGE_QUOTA_EXCEEDED',
    RATE_LIMITED: 'RATE_LIMITED',
    TOOL_TIMEOUT: 'TOOL_TIMEOUT',
    PATH_FORBIDDEN: 'PATH_FORBIDDEN'
  });

  function byteLength(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text || '').byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(text || '', 'utf8');
    return unescape(encodeURIComponent(text || '')).length;
  }

  function rejection(code, message, details = {}) {
    const err = new Error(message);
    err.code = code;
    err.rejectionCode = code;
    err.details = details;
    return err;
  }

  function assertSize(value, limit, code, label) {
    const actualBytes = byteLength(value);
    if (actualBytes > limit) {
      throw rejection(code, `${label} exceeds quota`, { actualBytes, limitBytes: limit });
    }
    return actualBytes;
  }

  function normalizeRelativePath(input) {
    if (typeof input !== 'string' || input.length === 0) throw rejection(CODES.PATH_FORBIDDEN, 'path must be a non-empty string');
    if (input.includes('\0')) throw rejection(CODES.PATH_FORBIDDEN, 'NUL bytes are forbidden');
    const slashPath = input.replace(/\\/g, '/');
    if (slashPath.startsWith('/') || /^[A-Za-z]:\//.test(slashPath) || slashPath.startsWith('//')) {
      throw rejection(CODES.PATH_FORBIDDEN, 'absolute paths are forbidden');
    }
    const parts = slashPath.split('/');
    if (parts.some((part) => part === '..')) throw rejection(CODES.PATH_FORBIDDEN, 'path traversal is forbidden');
    const normalized = parts.filter((part) => part && part !== '.').join('/');
    if (!normalized) throw rejection(CODES.PATH_FORBIDDEN, 'path must resolve inside the workspace');
    return normalized;
  }

  class QuotaPolicy {
    constructor(overrides = {}) {
      this.limits = Object.freeze({ ...DEFAULTS, ...overrides });
      this._calls = new Map();
    }

    size(value) { return byteLength(value); }
    assertFile(value) { return assertSize(value, this.limits.fileMaxBytes, CODES.FILE_QUOTA_EXCEEDED, 'file'); }
    assertArtifactVersion(value) { return assertSize(value, this.limits.artifactVersionMaxBytes, CODES.ARTIFACT_QUOTA_EXCEEDED, 'artifact version'); }
    assertLogEvent(value) { return assertSize(value, this.limits.logEventMaxBytes, CODES.LOG_QUOTA_EXCEEDED, 'log event'); }
    assertStorageEntry(value) { return assertSize(value, this.limits.localStorageEntryMaxBytes, CODES.LOCAL_STORAGE_QUOTA_EXCEEDED, 'localStorage entry'); }
    assertToolPayload(value) { return assertSize(value, this.limits.maxToolInputBytes, CODES.PAYLOAD_TOO_LARGE, 'tool input'); }
    assertToolOutput(value) { return assertSize(value, this.limits.maxToolOutputBytes, CODES.PAYLOAD_TOO_LARGE, 'tool output'); }
    path(input) { return normalizeRelativePath(input); }

    assertWorkspaceTotal(totalBytes, incomingBytes, replacingBytes = 0) {
      const next = totalBytes - replacingBytes + incomingBytes;
      if (next > this.limits.workspaceMaxBytes) {
        throw rejection(CODES.FILE_QUOTA_EXCEEDED, 'workspace quota exceeded', {
          totalBytes, incomingBytes, replacingBytes, limitBytes: this.limits.workspaceMaxBytes
        });
      }
      return next;
    }

    assertArtifactTotal(totalBytes, incomingBytes, replacingBytes = 0) {
      const next = totalBytes - replacingBytes + incomingBytes;
      if (next > this.limits.artifactTotalBytes) {
        throw rejection(CODES.ARTIFACT_QUOTA_EXCEEDED, 'artifact quota exceeded', {
          totalBytes, incomingBytes, replacingBytes, limitBytes: this.limits.artifactTotalBytes
        });
      }
      return next;
    }

    assertStorageTotal(totalBytes, incomingBytes, replacingBytes = 0) {
      const next = totalBytes - replacingBytes + incomingBytes;
      if (next > this.limits.localStorageTotalBytes) {
        throw rejection(CODES.LOCAL_STORAGE_QUOTA_EXCEEDED, 'localStorage quota exceeded', {
          totalBytes, incomingBytes, replacingBytes, limitBytes: this.limits.localStorageTotalBytes
        });
      }
      return next;
    }

    checkRate(toolName, now = Date.now()) {
      const windowStart = now - 60 * 1000;
      const recent = (this._calls.get(toolName) || []).filter((at) => at > windowStart);
      if (recent.length >= this.limits.toolCallsPerMinute) {
        throw rejection(CODES.RATE_LIMITED, `tool rate limit exceeded: ${toolName}`, {
          limit: this.limits.toolCallsPerMinute, retryAfterMs: Math.max(1, recent[0] + 60 * 1000 - now)
        });
      }
      recent.push(now);
      this._calls.set(toolName, recent);
      return recent.length;
    }
  }

  return { QuotaPolicy, CODES, DEFAULTS, byteLength, rejection, normalizeRelativePath };
});
