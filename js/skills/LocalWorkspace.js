/**
 * Browser backed local workspace.
 *
 * The module deliberately accepts a File System Access API directory handle
 * instead of an operating-system path. The directory selected by the user is
 * the only root that can be accessed by this class.
 */

(function () {
let BaseSkillFile;
if (typeof require !== 'undefined') {
  try { BaseSkillFile = require('./BaseSkill.js').BaseSkill; } catch (error) { /* browser build */ }
}
if (!BaseSkillFile && typeof window !== 'undefined') BaseSkillFile = window.BaseSkill;
if (!BaseSkillFile) BaseSkillFile = class { constructor(name, description) { this.name = name; this.description = description; } };

class LocalWorkspaceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'LocalWorkspaceError';
    this.code = code;
    Object.assign(this, details);
  }
}

const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024;
const NOT_FOUND_CODES = new Set(['NotFoundError', 'ENOENT']);

function errorName(error) {
  return error && (error.name || error.code);
}

function isNotFound(error) {
  return NOT_FOUND_CODES.has(errorName(error));
}

function byteLength(value) {
  if (typeof value === 'string') {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(value).byteLength;
    if (typeof Buffer !== 'undefined') return Buffer.byteLength(value, 'utf8');
    return unescape(encodeURIComponent(value)).length;
  }
  if (value && typeof value.size === 'number') return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  throw new TypeError('content must be a string, Blob, ArrayBuffer, or typed array');
}

async function fileText(file) {
  if (file && typeof file.text === 'function') return file.text();
  if (file && typeof file.arrayBuffer === 'function') {
    const bytes = await file.arrayBuffer();
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    return String.fromCharCode(...new Uint8Array(bytes));
  }
  throw new TypeError('FileSystemFileHandle.getFile() returned an unsupported object');
}

class LocalWorkspace extends BaseSkillFile {
  constructor(options = {}) {
    super('local_workspace', '访问用户授权的浏览器本地工作区，支持受限路径读写、配额校验、失败回滚与审计事件。');
    if (!options || typeof options !== 'object') throw new TypeError('options must be an object');
    this.picker = options.picker || null;
    this.quotaBytes = options.quotaBytes === undefined ? DEFAULT_QUOTA_BYTES : options.quotaBytes;
    if (!(this.quotaBytes === Infinity || (Number.isSafeInteger(this.quotaBytes) && this.quotaBytes >= 0))) {
      throw new TypeError('quotaBytes must be a non-negative safe integer or Infinity');
    }
    this.maxPathLength = options.maxPathLength === undefined ? 4096 : options.maxPathLength;
    this.maxSegmentLength = options.maxSegmentLength === undefined ? 255 : options.maxSegmentLength;
    this.maxDepth = options.maxDepth === undefined ? 32 : options.maxDepth;
    this.auditSink = typeof options.auditSink === 'function' ? options.auditSink : null;
    this.storageEstimate = typeof options.storageEstimate === 'function' ? options.storageEstimate : null;
    this.clock = typeof options.clock === 'function' ? options.clock : () => new Date().toISOString();
    this.rootHandle = null;
    this.auditEvents = [];
    this.auditSinkErrors = [];
    this.knownUsageBytes = null;
    this.listeners = new Set();
    this.busy = false;
    this.sequence = 0;
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: false,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['authorize', 'list', 'read', 'write', 'delete'] },
          filepath: { type: 'string', description: '相对于授权目录的路径，不允许绝对路径或 ..' },
          content: { description: 'write 操作接受字符串、Blob、ArrayBuffer 或 typed array' }
        },
        required: ['action']
      }
    };
  }

  isAuthorized() { return Boolean(this.rootHandle); }

  getAuditEvents() { return this.auditEvents.map((event) => ({ ...event })); }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async _operation(action, run, permission = true) {
    if (this.busy) throw new LocalWorkspaceError('WORKSPACE_BUSY', 'another workspace operation is in progress');
    this.busy = true;
    const started = Date.now();
    this.traceId = `workspace-${++this.sequence}-${started}`;
    try {
      if (permission) {
        this._requireAuthorization();
        if (await this.rootHandle.queryPermission({ mode: 'readwrite' }) !== 'granted') {
          throw new LocalWorkspaceError('PERMISSION_DENIED', 'directory access was revoked; select the directory again');
        }
      }
      return await run();
    } catch (error) {
      this._audit('workspace_operation_failed', { ok: false, action, code: error.code || error.name, error: error.message, durationMs: Date.now() - started });
      throw error;
    } finally { this.busy = false; }
  }

  authorize(options = {}) { return this._operation('authorize', () => this._authorize(options), false); }
  list() { return this._operation('list', () => this._list()); }
  read(path) { return this._operation('read', () => this._read(path)); }
  write(path, content) { return this._operation('write', () => this._write(path, content)); }
  delete(path) { return this._operation('delete', () => this._delete(path)); }

  revoke() {
    if (this.busy) throw new LocalWorkspaceError('WORKSPACE_BUSY', 'wait for the current operation before detaching');
    const hadHandle = Boolean(this.rootHandle);
    this.rootHandle = null;
    this.knownUsageBytes = null;
    if (hadHandle) this._audit('workspace_revoked', { ok: true });
    return { ok: true, revoked: hadHandle };
  }

  _audit(type, details = {}) {
    const event = Object.freeze({
      type,
      timestamp: this.clock(),
      traceId: this.traceId || 'workspace-session',
      workspaceAuthorized: this.isAuthorized(),
      ...details
    });
    this.auditEvents.push(event);
    if (this.auditEvents.length > 500) this.auditEvents.shift();
    if (this.auditSink) {
      try { this.auditSink(event); } catch (error) {
        this.auditSinkErrors.push({ type: errorName(error) || 'Error', message: String(error.message || error) });
      }
    }
    for (const listener of this.listeners) {
      try { listener(event); } catch (error) {
        this.auditSinkErrors.push({ type: error.name, message: error.message });
      }
    }
    return event;
  }

  _requireAuthorization() {
    if (!this.rootHandle) throw new LocalWorkspaceError('NOT_AUTHORIZED', 'workspace directory authorization is required');
  }

  _normalizePath(filepath) {
    if (typeof filepath !== 'string') throw new LocalWorkspaceError('INVALID_PATH', 'filepath must be a string');
    const raw = filepath.trim();
    if (!raw || raw.length > this.maxPathLength || raw.includes('\0')) {
      throw new LocalWorkspaceError('INVALID_PATH', 'filepath must be a non-empty relative path');
    }
    const slashPath = raw.replace(/\\/g, '/');
    if (slashPath.startsWith('/') || /^[A-Za-z]:/.test(slashPath) || slashPath.startsWith('//')) {
      throw new LocalWorkspaceError('INVALID_PATH', 'absolute paths are not allowed');
    }
    const segments = slashPath.split('/');
    if (segments.length > this.maxDepth || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new LocalWorkspaceError('INVALID_PATH', 'filepath contains an empty, dot, or parent segment');
    }
    if (segments.some((segment) => segment.length > this.maxSegmentLength)) {
      throw new LocalWorkspaceError('INVALID_PATH', 'filepath segment exceeds the configured limit');
    }
    return segments.join('/');
  }

  async _permission(handle) {
    if (!handle || handle.kind !== 'directory' || typeof handle.queryPermission !== 'function' || typeof handle.getFileHandle !== 'function') {
      throw new LocalWorkspaceError('PERMISSION_DENIED', 'a File System Access directory handle is required');
    }
    const options = { mode: 'readwrite' };
    if (typeof handle.queryPermission === 'function') {
      const state = await handle.queryPermission(options);
      if (state !== 'granted' && typeof handle.requestPermission === 'function') {
        const requested = await handle.requestPermission(options);
        if (requested !== 'granted') throw new LocalWorkspaceError('PERMISSION_DENIED', 'directory permission was not granted');
      } else if (state !== 'granted') {
        throw new LocalWorkspaceError('PERMISSION_DENIED', 'directory permission was not granted');
      }
    }
  }

  async _authorize(options = {}) {
    let handle = options.handle || null;
    if (!handle) {
      const picker = options.picker || this.picker || (typeof globalThis !== 'undefined' && globalThis.showDirectoryPicker);
      if (typeof picker !== 'function') {
        const error = new LocalWorkspaceError('FSA_UNAVAILABLE', 'showDirectoryPicker is unavailable in this environment');
        this._audit('workspace_authorization_failed', { ok: false, code: error.code });
        throw error;
      }
      try {
        handle = await picker.call(globalThis, { ...(options.pickerOptions || {}), mode: 'readwrite' });
      } catch (cause) {
        const error = new LocalWorkspaceError(cause.name === 'AbortError' ? 'AUTHORIZATION_CANCELLED' : 'AUTHORIZATION_FAILED', cause.message || 'directory selection failed', { cause });
        this._audit('workspace_authorization_failed', { ok: false, code: error.code });
        throw error;
      }
    }
    try {
      await this._permission(handle);
    } catch (cause) {
      const error = cause instanceof LocalWorkspaceError ? cause : new LocalWorkspaceError('PERMISSION_DENIED', String(cause.message || cause), { cause });
      this._audit('workspace_authorization_failed', { ok: false, code: error.code });
      throw error;
    }
    this.rootHandle = handle;
    this.knownUsageBytes = null;
    this._audit('workspace_authorized', { ok: true, name: handle.name || null });
    return { ok: true, authorized: true, name: handle.name || null };
  }

  async _parentHandle(filepath, create, created = []) {
    this._requireAuthorization();
    const segments = filepath.split('/');
    const filename = segments.pop();
    let parent = this.rootHandle;
    for (const segment of segments) {
      try {
        try { parent = await parent.getDirectoryHandle(segment, { create: false }); }
        catch (error) {
          if (!create || !isNotFound(error)) throw error;
          const ancestor = parent;
          parent = await parent.getDirectoryHandle(segment, { create: true });
          created.push({ parent: ancestor, name: segment });
        }
      } catch (cause) {
        if (isNotFound(cause)) throw new LocalWorkspaceError('NOT_FOUND', `directory not found: ${segment}`, { cause });
        throw cause;
      }
    }
    return { parent, filename };
  }

  async _getFile(filepath, create = false) {
    const { parent, filename } = await this._parentHandle(filepath, create);
    try {
      return { parent, filename, handle: await parent.getFileHandle(filename, { create: Boolean(create) }) };
    } catch (cause) {
      if (isNotFound(cause)) throw new LocalWorkspaceError('NOT_FOUND', `file not found: ${filepath}`, { cause });
      throw cause;
    }
  }

  async _readHandle(handle) {
    const file = await handle.getFile();
    const text = await fileText(file);
    return {
      text,
      rollbackValue: file && typeof file.arrayBuffer === 'function' ? file : text,
      size: typeof file.size === 'number' ? file.size : byteLength(text)
    };
  }

  async _walk(directory, prefix = '') {
    const entries = [];
    if (typeof directory.entries === 'function') {
      for await (const entry of directory.entries()) {
        const name = entry[0];
        const handle = entry[1];
        const path = prefix ? `${prefix}/${name}` : name;
        if (handle && handle.kind === 'directory') entries.push(...await this._walk(handle, path));
        else if (handle && handle.kind === 'file') {
          const file = await handle.getFile();
          entries.push({ path, size: typeof file.size === 'number' ? file.size : 0, kind: 'file' });
        }
      }
    } else if (typeof directory.values === 'function') {
      for await (const handle of directory.values()) {
        if (!handle || !handle.name) continue;
        const path = prefix ? `${prefix}/${handle.name}` : handle.name;
        if (handle.kind === 'directory') entries.push(...await this._walk(handle, path));
        else if (handle.kind === 'file') {
          const file = await handle.getFile();
          entries.push({ path, size: typeof file.size === 'number' ? file.size : 0, kind: 'file' });
        }
      }
    } else {
      throw new LocalWorkspaceError('UNSUPPORTED_HANDLE', 'directory handle does not expose entries() or values()');
    }
    return entries;
  }

  async _effectiveQuotaBytes() {
    let quota = this.quotaBytes;
    // Origin storage estimates do not measure free space on a selected disk.
    const estimate = this.storageEstimate;
    if (typeof estimate === 'function') {
      const storage = typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;
      const result = await estimate.call(storage);
      if (result && Number.isFinite(result.quota) && result.quota >= 0) quota = Math.min(quota, result.quota);
    }
    return quota;
  }

  async _list() {
    this._requireAuthorization();
    const files = (await this._walk(this.rootHandle)).sort((a, b) => a.path.localeCompare(b.path));
    this.knownUsageBytes = files.reduce((sum, file) => sum + file.size, 0);
    const quotaBytes = await this._effectiveQuotaBytes();
    this._audit('workspace_list', { ok: true, totalFiles: files.length, usageBytes: this.knownUsageBytes, quotaBytes });
    return { ok: true, files, totalFiles: files.length, usageBytes: this.knownUsageBytes, quotaBytes };
  }

  async _read(filepath) {
    const normalized = this._normalizePath(filepath);
    const { handle } = await this._getFile(normalized, false);
    const result = await this._readHandle(handle);
    this._audit('file_read', { ok: true, path: normalized, bytes: result.size });
    return { ok: true, path: normalized, content: result.text, size: result.size };
  }

  async _delete(filepath) {
    const normalized = this._normalizePath(filepath);
    const { parent, filename } = await this._getFile(normalized, false);
    try {
      await parent.removeEntry(filename);
    } catch (cause) {
      if (isNotFound(cause)) throw new LocalWorkspaceError('NOT_FOUND', `file not found: ${normalized}`, { cause });
      throw cause;
    }
    this.knownUsageBytes = null;
    this._audit('file_deleted', { ok: true, path: normalized });
    return { ok: true, path: normalized, deleted: true };
  }

  async _write(filepath, content) {
    const normalized = this._normalizePath(filepath);
    const nextSize = byteLength(content);
    let parent;
    let filename;
    const createdDirectories = [];
    let existingHandle = null;
    let previousContent = null;
    let previousSize = 0;
    try {
      ({ parent, filename } = await this._parentHandle(normalized, false));
      existingHandle = await parent.getFileHandle(filename, { create: false });
      const previous = await this._readHandle(existingHandle);
      previousContent = previous.rollbackValue;
      previousSize = previous.size;
    } catch (cause) {
      if (!isNotFound(cause) && cause.code !== 'NOT_FOUND') throw cause;
    }
    const currentUsage = (await this._list()).usageBytes;
    const quotaBytes = await this._effectiveQuotaBytes();
    if (quotaBytes !== Infinity && currentUsage - previousSize + nextSize > quotaBytes) {
      const error = new LocalWorkspaceError('QUOTA_EXCEEDED', 'write exceeds local workspace quota', {
        quotaBytes, usageBytes: currentUsage, requestedBytes: nextSize, previousBytes: previousSize
      });
      this._audit('file_write_rejected', { ok: false, code: error.code, path: normalized, bytes: nextSize });
      throw error;
    }
    let target = existingHandle;
    let writable;
    try {
      if (!parent) ({ parent, filename } = await this._parentHandle(normalized, true, createdDirectories));
      if (!target) target = await parent.getFileHandle(filename, { create: true });
      writable = await target.createWritable();
      await writable.write(content);
      await writable.close();
      this.knownUsageBytes = currentUsage - previousSize + nextSize;
      this._audit('file_written', { ok: true, path: normalized, bytes: nextSize, replaced: Boolean(existingHandle) });
      return { ok: true, path: normalized, size: nextSize, replaced: Boolean(existingHandle) };
    } catch (cause) {
      let rollbackError = null;
      if (writable && typeof writable.abort === 'function') {
        try { await writable.abort(); } catch (abortError) {
          this._audit('file_write_abort_failed', { ok: false, path: normalized, error: abortError.message });
        }
      }
      try {
        if (existingHandle && previousContent !== null) {
          const rollbackWriter = await existingHandle.createWritable();
          await rollbackWriter.write(previousContent);
          await rollbackWriter.close();
        } else if (target) {
          await parent.removeEntry(filename);
        }
        for (const directory of createdDirectories.reverse()) await directory.parent.removeEntry(directory.name);
        this._audit('file_write_rollback', { ok: true, path: normalized, bytes: previousSize });
      } catch (rollbackCause) {
        rollbackError = rollbackCause;
        this._audit('file_write_rollback', { ok: false, path: normalized, code: 'ROLLBACK_FAILED' });
      }
      this.knownUsageBytes = null;
      const error = new LocalWorkspaceError(rollbackError ? 'ROLLBACK_FAILED' : 'WRITE_FAILED', 'file write failed', { cause, rollbackError });
      this._audit('file_write_failed', { ok: false, code: error.code, path: normalized, bytes: nextSize });
      throw error;
    }
  }

  async execute(args = {}) {
    const action = String(args.action || '').toLowerCase();
    try {
      if (action === 'authorize') return { status: 'success', action, ...(await this.authorize(args)) };
      if (action === 'list') return { status: 'success', action, ...(await this.list()) };
      if (action === 'read') return { status: 'success', action, ...(await this.read(args.filepath)) };
      if (action === 'write') return { status: 'success', action, ...(await this.write(args.filepath, args.content)) };
      if (action === 'delete') return { status: 'success', action, ...(await this.delete(args.filepath)) };
      throw new LocalWorkspaceError('INVALID_ACTION', `unsupported local workspace action: ${action || '(empty)'}`);
    } catch (error) {
      const normalized = error instanceof LocalWorkspaceError ? error : new LocalWorkspaceError('OPERATION_FAILED', String(error.message || error), { cause: error });
      return { status: 'error', action, code: normalized.code, error: normalized.message };
    }
  }
}

if (typeof window !== 'undefined') {
  window.LocalWorkspace = LocalWorkspace;
  window.LocalWorkspaceError = LocalWorkspaceError;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { LocalWorkspace, LocalWorkspaceError };
})();

