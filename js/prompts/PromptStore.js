/**
 * Local prompt library with deterministic indexing and quick search.
 * Entries never contain model credentials; callers explicitly provide public
 * prompt metadata and the store enforces per-entry and total storage quotas.
 */
(function (root, factory) {
  const quota = typeof require !== 'undefined' ? require('../mcp/QuotaPolicy.js') : { QuotaPolicy: root && root.QuotaPolicy };
  const api = factory(quota);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PromptStore = api.PromptStore;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (quotaApi) {
  'use strict';
  const QuotaPolicy = quotaApi.QuotaPolicy || class { assertStorageEntry() {} size(value) { return JSON.stringify(value).length; } };
  const STORE_KEY = 'teachagent_prompt_library_v1';
  const MAX_ENTRIES = 10000;

  function now() { return new Date().toISOString(); }
  function id() { return `prompt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }
  function tokens(text) {
    const source = String(text || '').toLowerCase();
    const words = source.match(/[a-z0-9_]+/g) || [];
    const han = (source.match(/[\u3400-\u9fff]/g) || []);
    const bigrams = [];
    for (let i = 0; i < han.length - 1; i++) bigrams.push(han[i] + han[i + 1]);
    return [...new Set([...words, ...han, ...bigrams])];
  }
  function sanitize(entry) {
    return {
      id: String(entry.id || id()), title: String(entry.title || '').trim(), content: String(entry.content || ''),
      tags: Array.isArray(entry.tags) ? [...new Set(entry.tags.map(String).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20) : [],
      source: String(entry.source || 'local'), createdAt: entry.createdAt || now(), updatedAt: entry.updatedAt || now(), useCount: Number.isSafeInteger(entry.useCount) && entry.useCount >= 0 ? entry.useCount : 0
    };
  }

  class PromptStore {
    constructor(options = {}) {
      this.storageKey = options.storageKey || STORE_KEY;
      this.quota = options.quotaPolicy || new QuotaPolicy(options.quotas || {});
      this.maxEntries = Math.min(options.maxEntries || MAX_ENTRIES, MAX_ENTRIES);
      this.entries = new Map();
      this._load();
    }
    _storage() { return typeof localStorage !== 'undefined' ? localStorage : null; }
    _save() {
      const payload = JSON.stringify([...this.entries.values()]);
      try {
        this.quota.assertStorageEntry(payload);
        const storage = this._storage();
        if (storage) storage.setItem(this.storageKey, payload);
        return { ok: true };
      } catch (error) { return { ok: false, code: error.code || 'LOCAL_STORAGE_QUOTA_EXCEEDED', message: error.message, details: error.details || {} }; }
    }
    _load() {
      const storage = this._storage(); if (!storage) return;
      const raw = storage.getItem(this.storageKey); if (!raw) return;
      try {
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) throw new Error('prompt library must be an array');
        for (const item of list.slice(0, this.maxEntries)) { const entry = sanitize(item); this.entries.set(entry.id, entry); }
      } catch (error) { this.entries.clear(); }
    }
    list() { return [...this.entries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
    get(promptId) { return this.entries.get(promptId) || null; }
    upsert(input) {
      const entry = sanitize(input);
      if (!entry.title || !entry.content) return { ok: false, code: 'INVALID_PARAMS', message: 'title and content are required' };
      try { this.quota.assertStorageEntry(entry.content); } catch (error) { return { ok: false, code: error.code || 'LOCAL_STORAGE_QUOTA_EXCEEDED', message: error.message, details: error.details || {} }; }
      const previous = this.entries.get(entry.id);
      if (!previous && this.entries.size >= this.maxEntries) return { ok: false, code: 'PROMPT_QUOTA_EXCEEDED', message: 'prompt entry quota exceeded', limit: this.maxEntries };
      entry.createdAt = previous?.createdAt || entry.createdAt; entry.updatedAt = now(); entry.useCount = previous?.useCount || entry.useCount;
      this.entries.set(entry.id, entry);
      const saved = this._save();
      if (!saved.ok) { if (previous) this.entries.set(entry.id, previous); else this.entries.delete(entry.id); return saved; }
      return { ok: true, entry };
    }
    remove(promptId) {
      const previous = this.entries.get(promptId); if (!previous) return { ok: false, code: 'PROMPT_NOT_FOUND', message: 'prompt not found' };
      this.entries.delete(promptId); const saved = this._save();
      if (!saved.ok) this.entries.set(promptId, previous);
      return saved.ok ? { ok: true, id: promptId } : saved;
    }
    use(promptId) {
      const entry = this.entries.get(promptId); if (!entry) return { ok: false, code: 'PROMPT_NOT_FOUND', message: 'prompt not found' };
      entry.useCount += 1; entry.updatedAt = now(); const saved = this._save();
      if (!saved.ok) { entry.useCount -= 1; return saved; }
      return { ok: true, entry };
    }
    search(query, options = {}) {
      const q = String(query || '').trim().toLowerCase(); if (!q) return this.list().slice(0, options.limit || 20).map((entry) => ({ entry, score: 0, snippet: entry.content.slice(0, 160) }));
      const qs = tokens(q); const limit = Math.max(1, Math.min(100, options.limit || 20));
      const results = [];
      for (const entry of this.entries.values()) {
        if (options.tag && !entry.tags.includes(options.tag)) continue;
        const hay = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase();
        let score = 0;
        if (entry.title.toLowerCase() === q) score += 1000;
        if (entry.title.toLowerCase().startsWith(q)) score += 500;
        if (entry.title.toLowerCase().includes(q)) score += 300;
        for (const token of qs) { if (entry.title.toLowerCase().includes(token)) score += 80; if (hay.includes(token)) score += 20; }
        if (score > 0) {
          const idx = hay.indexOf(q); const start = Math.max(0, idx < 0 ? 0 : idx - 60);
          results.push({ entry, score: score + Math.min(entry.useCount, 50), snippet: entry.content.slice(start, start + 160) });
        }
      }
      return results.sort((a, b) => b.score - a.score || b.entry.updatedAt.localeCompare(a.entry.updatedAt)).slice(0, limit);
    }
  }
  return { PromptStore, tokens };
});
