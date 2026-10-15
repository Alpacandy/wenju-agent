const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const DEFAULTS = Object.freeze({ fileMaxBytes: 2 * 1024 * 1024, workspaceMaxBytes: 200 * 1024 * 1024 });

class FileServiceError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

function bytes(value) { return Buffer.byteLength(value, 'utf8'); }
function normalizeRelativePath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) throw new FileServiceError('PATH_FORBIDDEN', 'path must be a non-empty relative path');
  const normalized = input.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) throw new FileServiceError('PATH_FORBIDDEN', 'absolute path is forbidden');
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new FileServiceError('PATH_FORBIDDEN', 'path traversal is forbidden');
  return parts.join('/');
}

class FileService {
  constructor(options = {}) {
    if (!options.root) throw new TypeError('workspace root is required');
    this.root = path.resolve(options.root);
    this.trash = path.join(this.root, '.teachagent-trash');
    this.limits = { ...DEFAULTS, ...(options.limits || {}) };
    this.audit = typeof options.audit === 'function' ? options.audit : () => {};
  }

  async initialize() {
    const stat = await fsp.stat(this.root).catch((error) => { throw new FileServiceError('WORKSPACE_NOT_FOUND', error.message); });
    if (!stat.isDirectory()) throw new FileServiceError('WORKSPACE_NOT_DIRECTORY', 'workspace root is not a directory');
    await fsp.mkdir(this.trash, { recursive: true });
    const resolved = await fsp.realpath(this.root);
    this.root = resolved;
    return { root: this.root };
  }

  _resolve(relativePath) {
    const safe = normalizeRelativePath(relativePath);
    const target = path.resolve(this.root, safe);
    const relative = path.relative(this.root, target);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new FileServiceError('PATH_FORBIDDEN', 'resolved path escapes workspace');
    return { safe, target };
  }

  async _insideRealRoot(target, allowMissing = false) {
    const parent = allowMissing ? path.dirname(target) : target;
    let resolved;
    try { resolved = await fsp.realpath(parent); }
    catch (error) {
      if (allowMissing && error.code === 'ENOENT') return this._insideRealRoot(path.dirname(parent), true);
      throw new FileServiceError('PATH_NOT_FOUND', error.message);
    }
    const rel = path.relative(this.root, resolved);
    if (rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw new FileServiceError('PATH_FORBIDDEN', 'symlink escapes workspace');
    return resolved;
  }

  async _usageBytes(dir = this.root) {
    let total = 0;
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.teachagent-trash') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await this._usageBytes(full);
      else if (entry.isFile()) total += (await fsp.stat(full)).size;
    }
    return total;
  }

  async list() {
    const walk = async (dir, prefix = '') => {
      const result = [];
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.teachagent-trash') continue;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) result.push(...await walk(full, rel));
        else if (entry.isFile()) result.push({ path: rel, size: (await fsp.stat(full)).size });
      }
      return result;
    };
    const files = (await walk(this.root)).sort((a, b) => a.path.localeCompare(b.path));
    const usageBytes = files.reduce((sum, file) => sum + file.size, 0);
    this.audit({ type: 'workspace_list', files: files.length, usageBytes });
    return { files, usageBytes, quotaBytes: this.limits.workspaceMaxBytes };
  }

  async read(relativePath) {
    const { safe, target } = this._resolve(relativePath);
    await this._insideRealRoot(target);
    let value;
    try { value = await fsp.readFile(target, 'utf8'); }
    catch (error) { throw new FileServiceError(error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'FILE_READ_FAILED', error.message); }
    this.audit({ type: 'file_read', path: safe, bytes: bytes(value) });
    return { path: safe, content: value, size: bytes(value) };
  }

  async write(relativePath, content) {
    const { safe, target } = this._resolve(relativePath);
    if (typeof content !== 'string') throw new FileServiceError('INVALID_CONTENT', 'content must be a UTF-8 string');
    const size = bytes(content);
    if (size > this.limits.fileMaxBytes) throw new FileServiceError('FILE_QUOTA_EXCEEDED', 'file quota exceeded', { size, limit: this.limits.fileMaxBytes });
    await this._insideRealRoot(target, true);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    let previousSize = 0;
    try { previousSize = (await fsp.stat(target)).size; } catch (error) { if (error.code !== 'ENOENT') throw new FileServiceError('FILE_STAT_FAILED', error.message); }
    const usage = await this._usageBytes();
    if (usage - previousSize + size > this.limits.workspaceMaxBytes) throw new FileServiceError('FILE_QUOTA_EXCEEDED', 'workspace quota exceeded', { usage, previousSize, size, limit: this.limits.workspaceMaxBytes });
    const temp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
    try {
      const handle = await fsp.open(temp, 'wx', 0o600);
      try { await handle.writeFile(content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fsp.rename(temp, target);
    } catch (error) {
      await fsp.rm(temp, { force: true }).catch((cleanupError) => this.audit({ type: 'file_temp_cleanup_failed', error: cleanupError.message }));
      throw new FileServiceError('FILE_WRITE_FAILED', error.message);
    }
    this.audit({ type: 'file_written', path: safe, bytes: size, previousBytes: previousSize });
    return { path: safe, size, replaced: previousSize > 0 };
  }

  async remove(relativePath) {
    const { safe, target } = this._resolve(relativePath);
    await this._insideRealRoot(target);
    const destination = path.join(this.trash, `${Date.now()}-${crypto.randomUUID()}-${path.basename(target)}`);
    await fsp.rename(target, destination).catch((error) => { throw new FileServiceError(error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'FILE_DELETE_FAILED', error.message); });
    this.audit({ type: 'file_deleted', path: safe, trashPath: path.relative(this.root, destination) });
    return { path: safe, deleted: true };
  }
}

module.exports = { FileService, FileServiceError, normalizeRelativePath };
