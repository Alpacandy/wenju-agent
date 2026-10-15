/**
 * StoragePort —— 存储端口层（P6-A · 会话 SQLite 化就绪抽象）
 *
 * 对齐 zcode `adapters/src/storage/session-store/session-store.port.ts` 的端口模式：
 *   - 上层模块只依赖端口契约（async get/set/remove/keys/clear），不直接触碰 localStorage；
 *   - 后端可插拔：MemoryBackend（测试/降级）→ LocalStorageBackend（现状）→ IndexedDBBackend（浏览器终态）
 *     → SQLiteBackend（Host 阶段，P5 宿主实现同一契约即可无缝替换）；
 *   - 统一 JSON 序列化与命名空间前缀，杜绝键冲突与脏写。
 *
 * 契约（全部 async，值经 JSON 序列化往返）：
 *   get(key) -> value | null          set(key, value) -> void
 *   remove(key) -> void               keys() -> string[]（去前缀）
 *   clear() -> void
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.StoragePort = api.StoragePort; root.StoragePortBackends = { MemoryBackend: api.MemoryBackend, LocalStorageBackend: api.LocalStorageBackend, IndexedDBBackend: api.IndexedDBBackend, HostStorageBackend: api.HostStorageBackend }; root.getSharedStoragePort = api.getSharedPort; root.connectHostStorage = api.connectHostStorage; }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  // ---------- 后端 1：内存（测试 / 无存储环境降级） ----------
  class MemoryBackend {
    constructor() { this.map = new Map(); }
    async getRaw(k) { return this.map.has(k) ? this.map.get(k) : null; }
    async setRaw(k, v) { this.map.set(k, String(v)); }
    async removeRaw(k) { this.map.delete(k); }
    async keysRaw() { return [...this.map.keys()]; }
    async clearRaw() { this.map.clear(); }
  }

  // ---------- 后端 2：localStorage（现状兼容） ----------
  class LocalStorageBackend {
    constructor(storage) { this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null); }
    async getRaw(k) { return this.storage ? this.storage.getItem(k) : null; }
    async setRaw(k, v) { if (this.storage) this.storage.setItem(k, String(v)); }
    async removeRaw(k) { if (this.storage) this.storage.removeItem(k); }
    async keysRaw() {
      if (!this.storage) return [];
      const out = [];
      for (let i = 0; i < this.storage.length; i++) out.push(this.storage.key(i));
      return out;
    }
    async clearRaw() { if (this.storage) this.storage.clear(); }
  }

  // ---------- 后端 3：IndexedDB（浏览器终态；容量远超 localStorage） ----------
  class IndexedDBBackend {
    constructor(dbName, storeName) {
      this.dbName = dbName || 'wenju-storage';
      this.storeName = storeName || 'kv';
      this._dbPromise = null;
    }
    _open() {
      if (this._dbPromise) return this._dbPromise;
      this._dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('INDEXEDDB_OPEN_FAILED'));
      });
      return this._dbPromise;
    }
    async _tx(mode, fn) {
      const db = await this._open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, mode);
        const store = tx.objectStore(this.storeName);
        const req = fn(store);
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error || new Error('INDEXEDDB_TX_FAILED'));
        tx.onabort = () => reject(tx.error || new Error('INDEXEDDB_TX_ABORTED'));
      });
    }
    async getRaw(k) { const v = await this._tx('readonly', (s) => s.get(k)); return v === undefined ? null : v; }
    async setRaw(k, v) { await this._tx('readwrite', (s) => s.put(String(v), k)); }
    async removeRaw(k) { await this._tx('readwrite', (s) => s.delete(k)); }
    async keysRaw() { return (await this._tx('readonly', (s) => s.getAllKeys())) || []; }
    async clearRaw() { await this._tx('readwrite', (s) => s.clear()); }
  }

  // ---------- 后端 4：宿主 SQLite（P7-H1；经本地宿主 /v1/storage 落盘真实 SQLite） ----------
  /**
   * 契约：与其余后端一致（getRaw/setRaw/removeRaw/keysRaw/clearRaw）。
   * 传输：HTTP 到 127.0.0.1 宿主，Bearer 令牌；值以字符串无损往返（宿主按 JSON 文本存储）。
   * 失败语义：非 2xx 显式抛 HOST_STORAGE_* 错误码（不静默降级为 null）。
   */
  class HostStorageBackend {
    constructor(options = {}) {
      if (!options.baseUrl) throw new Error('HOST_STORAGE_BASEURL_REQUIRED');
      if (!options.token) throw new Error('HOST_STORAGE_TOKEN_REQUIRED');
      this.baseUrl = String(options.baseUrl).replace(/\/+$/, '');
      this.token = options.token;
      this.confirmToken = options.confirmToken || null;
      this.timeoutMs = options.timeoutMs || 10000;
      this.namespace = options.namespace || 'wenju';
      this.fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
      if (!this.fetchImpl) throw new Error('HOST_STORAGE_FETCH_UNAVAILABLE');
    }
    _url(key) { return `${this.baseUrl}/v1/storage/${encodeURIComponent(this.namespace)}/${encodeURIComponent(key)}`; }
    _headers() { return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...(this.confirmToken ? { 'x-wenju-confirm': this.confirmToken } : {}) }; }
    async _request(url, method, body) {
      const signal = AbortSignal.timeout(this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, { headers: this._headers(), method, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (res.status === 404 && method === 'GET') return null;
        if (!res.ok) {
          let errorBody; try { errorBody = await res.json(); } catch (error) { if (signal.aborted) throw error; }
          throw Object.assign(new Error(errorBody?.message || `本地存储请求失败：HTTP ${res.status}`), { code: errorBody?.code || 'HOST_STORAGE_' + method + '_FAILED', status: res.status });
        }
        if (method !== 'GET') return true;
        try { return await res.json(); }
        catch (error) { if (signal.aborted) throw error; throw Object.assign(new Error('本地存储响应不是有效 JSON'), { code: 'HOST_STORAGE_INVALID_RESPONSE' }); }
      } catch (error) {
        if (signal.aborted) throw Object.assign(new Error('本地存储响应超时'), { code: 'HOST_STORAGE_TIMEOUT' });
        throw error;
      }
    }
    async getRaw(k) {
      const body = await this._request(this._url(k), 'GET');
      if (body === null) return null;
      if (!body || !Object.hasOwn(body, 'value')) throw Object.assign(new Error('本地存储响应缺少 value'), { code: 'HOST_STORAGE_INVALID_RESPONSE' });
      const value = body && body.value;
      return typeof value === 'string' ? value : JSON.stringify(value === undefined ? null : value);
    }
    async setRaw(k, v) {
      await this._request(this._url(k), 'PUT', { value: String(v) });
    }
    async removeRaw(k) {
      await this._request(this._url(k), 'DELETE');
    }
    async keysRaw() {
      const body = await this._request(`${this.baseUrl}/v1/storage/${encodeURIComponent(this.namespace)}`, 'GET');
      if (!Array.isArray(body?.keys) || body.keys.some(key => typeof key !== 'string')) throw Object.assign(new Error('本地存储响应缺少有效 keys'), { code: 'HOST_STORAGE_INVALID_RESPONSE' });
      return body.keys;
    }
    async clearRaw() { for (const k of await this.keysRaw()) await this.removeRaw(k); }
  }

  // ---------- 端口 ----------
  class StoragePort {
    /**
     * @param {object} backend - MemoryBackend | LocalStorageBackend | IndexedDBBackend | SQLiteBackend(Host 阶段)
     * @param {object} [options] - { namespace: 'wenju.' , name }
     */
    constructor(backend, options = {}) {
      if (!backend) throw new Error('STORAGE_BACKEND_MISSING');
      this.backend = backend;
      this.namespace = options.namespace || 'wenju.';
      this.name = options.name || backend.constructor.name;
    }

    _handleBackendFailure(error, operation) {
      const isQuota = error?.name === 'QuotaExceededError' || error?.code === 22 || error?.code === 1014 || String(error?.message).toLowerCase().includes('quota');
      const isSecurity = error?.name === 'SecurityError' || String(error?.message).toLowerCase().includes('security') || String(error?.message).includes('INDEXEDDB');
      if (isQuota || isSecurity) {
        if (!(this.backend instanceof MemoryBackend)) {
          console.warn(`[StoragePort] 持久层异常 (${error?.name || error?.code || error?.message})，自动自愈降级至内存存储后端`);
          const memory = new MemoryBackend();
          this.backend = memory;
          this.name = 'memory-fallback';
          return true;
        }
      }
      return false;
    }

    _full(key) { return this.namespace + String(key); }

    async get(key) {
      let raw;
      try {
        raw = await this.backend.getRaw(this._full(key));
      } catch (err) {
        if (this._handleBackendFailure(err, 'get')) {
          raw = await this.backend.getRaw(this._full(key));
        } else {
          throw err;
        }
      }
      if (raw == null) return null;
      try { return JSON.parse(raw); }
      catch (error) { throw Object.assign(new Error('存储记录无法解析，已保留原始记录：' + String(key)), { code: 'STORAGE_CORRUPT', cause: error }); }
    }
    async set(key, value) {
      try {
        await this.backend.setRaw(this._full(key), JSON.stringify(value));
      } catch (err) {
        if (this._handleBackendFailure(err, 'set')) {
          await this.backend.setRaw(this._full(key), JSON.stringify(value));
          return;
        }
        throw err;
      }
    }
    async remove(key) {
      try {
        await this.backend.removeRaw(this._full(key));
      } catch (err) {
        if (this._handleBackendFailure(err, 'remove')) {
          await this.backend.removeRaw(this._full(key));
          return;
        }
        throw err;
      }
    }
    async keys() {
      let all;
      try {
        all = await this.backend.keysRaw();
      } catch (err) {
        if (this._handleBackendFailure(err, 'keys')) {
          all = await this.backend.keysRaw();
        } else {
          throw err;
        }
      }
      const pre = this.namespace;
      return all.filter((k) => k && k.startsWith(pre)).map((k) => k.slice(pre.length));
    }
    async clear() {
      for (const k of await this.keys()) await this.remove(k);
    }
    getStatus() { return { name: this.name, namespace: this.namespace, backend: this.backend.constructor.name }; }
  }

  /**
   * P7-H1：连接宿主 SQLite 存储端口。健康探测（/health + 鉴权 storage 探针）通过才返回端口。
   * @returns {{ok:true, port:StoragePort}|{ok:false, code:string, message?:string}}
   */
  async function connectHostStorage(config = {}) {
    const baseUrl = config.baseUrl;
    const token = config.token;
    if (!baseUrl || !token) return { ok: false, code: 'HOST_CONFIG_REQUIRED', message: 'baseUrl 与 token 必填' };
    const fetchImpl = config.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    if (!fetchImpl) return { ok: false, code: 'HOST_FETCH_UNAVAILABLE' };
    const base = String(baseUrl).replace(/\/+$/, '');
    try {
      const signal = AbortSignal.timeout(config.timeoutMs || 5000);
      const health = await fetchImpl(`${base}/health`, { method: 'GET', signal });
      if (!health.ok) return { ok: false, code: 'HOST_UNREACHABLE', message: 'health ' + health.status };
      const probe = await fetchImpl(`${base}/v1/storage/${encodeURIComponent('wenju_probe')}`, { headers: { authorization: `Bearer ${token}` }, method: 'GET', signal });
      if (probe.status === 401 || probe.status === 403) return { ok: false, code: 'HOST_UNAUTHORIZED', message: 'token 被拒绝（' + probe.status + '）' };
      if (!probe.ok) return { ok: false, code: 'HOST_STORAGE_UNAVAILABLE', message: 'storage ' + probe.status };
      const backend = new HostStorageBackend({ baseUrl: base, token, confirmToken: config.confirmToken, timeoutMs: config.timeoutMs, namespace: config.namespace || 'wenju', fetchImpl });
      const port = new StoragePort(backend, { namespace: config.portNamespace || 'wenju.port.', name: 'host-sqlite' });
      return { ok: true, port };
    } catch (e) {
      return { ok: false, code: e?.name === 'TimeoutError' ? 'HOST_STORAGE_TIMEOUT' : 'HOST_UNREACHABLE', message: String(e && e.message || e) };
    }
  }

  // ---------- 共享端口（浏览器优先 IndexedDB → localStorage → 内存） ----------
  let shared = null;
  function getSharedPort() {
    if (shared) return shared;
    if (typeof window !== 'undefined') {
      let backend;
      if (typeof indexedDB !== 'undefined') {
        backend = new IndexedDBBackend();
      } else if (typeof localStorage !== 'undefined') {
        backend = new LocalStorageBackend();
      } else {
        backend = new MemoryBackend();
      }
      shared = new StoragePort(backend, { namespace: 'wenju.port.', name: 'shared' });
      window.storagePort = shared;
      return shared;
    }
    // Node（测试）：内存后端；调用方可显式注入
    shared = new StoragePort(new MemoryBackend(), { namespace: 'wenju.port.', name: 'node-shared' });
    return shared;
  }

  return { StoragePort, MemoryBackend, LocalStorageBackend, IndexedDBBackend, HostStorageBackend, getSharedPort, connectHostStorage };
});
