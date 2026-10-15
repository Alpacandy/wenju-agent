/**
 * 宿主 SQLite 存储服务（P7-H1：会话 SQLite 化）
 *
 * 语义：namespace+key → JSON 值 的持久化 KV（value 以 JSON 文本落盘，savedAt 毫秒时间戳）。
 * 实现：Node 内置 `node:sqlite`（零新依赖；封装在本文件单点，升级宿主只需改此处）。
 * 纪律：损坏值读取显式抛 STORAGE_CORRUPT（不静默返回 null）；写入超过配额抛 STORAGE_QUOTA_EXCEEDED。
 */
const path = require('path');
const fs = require('fs');

class StorageServiceError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

const DEFAULT_MAX_VALUE_BYTES = 8 * 1024 * 1024;
const KEY_PATTERN = /^[A-Za-z0-9._-]{1,160}$/;

function assertKeyPart(value, label) {
  if (typeof value !== 'string' || !KEY_PATTERN.test(value)) {
    throw new StorageServiceError('STORAGE_KEY_INVALID', `${label} must match ${KEY_PATTERN}`, { [label]: value });
  }
  return value;
}

class SqliteKvStore {
  constructor(options = {}) {
    const DatabaseSync = options.DatabaseSync || require('node:sqlite').DatabaseSync;
    this.file = options.file;
    if (!this.file) throw new TypeError('SqliteKvStore requires file');
    this.maxValueBytes = options.maxValueBytes || DEFAULT_MAX_VALUE_BYTES;
    fs.mkdirSync(path.dirname(path.resolve(this.file)), { recursive: true });
    this.db = new DatabaseSync(path.resolve(this.file));
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      );
    `);
  }

  get(namespace, key) {
    assertKeyPart(namespace, 'namespace');
    assertKeyPart(key, 'key');
    const row = this.db.prepare('SELECT value, saved_at FROM kv WHERE namespace = ? AND key = ?').get(namespace, key);
    if (!row) return null;
    let parsed;
    try { parsed = JSON.parse(row.value); }
    catch (error) { throw new StorageServiceError('STORAGE_CORRUPT', `stored value for ${namespace}/${key} is not valid JSON`, { namespace, key }); }
    return { value: parsed, savedAt: Number(row.saved_at) };
  }

  set(namespace, key, value) {
    assertKeyPart(namespace, 'namespace');
    assertKeyPart(key, 'key');
    const text = JSON.stringify(value === undefined ? null : value);
    if (Buffer.byteLength(text, 'utf8') > this.maxValueBytes) {
      throw new StorageServiceError('STORAGE_QUOTA_EXCEEDED', 'value exceeds storage quota', { bytes: Buffer.byteLength(text, 'utf8'), limit: this.maxValueBytes });
    }
    const savedAt = Date.now();
    this.db.prepare(`
      INSERT INTO kv (namespace, key, value, saved_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, saved_at = excluded.saved_at
    `).run(namespace, key, text, savedAt);
    return { namespace, key, savedAt };
  }

  remove(namespace, key) {
    assertKeyPart(namespace, 'namespace');
    assertKeyPart(key, 'key');
    const result = this.db.prepare('DELETE FROM kv WHERE namespace = ? AND key = ?').run(namespace, key);
    return { namespace, key, removed: Number(result.changes) > 0 };
  }

  keys(namespace) {
    assertKeyPart(namespace, 'namespace');
    return this.db.prepare('SELECT key FROM kv WHERE namespace = ? ORDER BY key').all(namespace).map((row) => row.key);
  }

  close() { try { this.db.close(); } catch (error) { /* 关闭幂等 */ } }
}

module.exports = { SqliteKvStore, StorageServiceError, assertKeyPart, DEFAULT_MAX_VALUE_BYTES, KEY_PATTERN };
