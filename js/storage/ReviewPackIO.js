/**
 * Offline review package exchange. The platform does not provide a teacher UI;
 * this module creates an auditable JSON package for external review and only
 * imports entries carrying an explicit reviewer attestation and content hash.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ReviewPackIO = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const SCHEMA_VERSION = 'teachagent.review-pack.v1';
  const MAX_ENTRIES = 1000;
  const MAX_BYTES = 4 * 1024 * 1024;
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function hash(value) {
    let h = 5381;
    const text = stable(value);
    for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
  }
  function fail(code, message, details = {}) { return { ok: false, code, message, details }; }
  function exportPackage({ taskId, events = [], pendingItems = [], artifacts = [], source = 'teachagent' } = {}) {
    if (!taskId) return fail('INVALID_PARAMS', 'taskId is required');
    const payload = { schemaVersion: SCHEMA_VERSION, packageId: `review_${Date.now().toString(36)}`, taskId: String(taskId), source, exportedAt: new Date().toISOString(), events, pendingItems, artifacts };
    const pack = { ...payload, contentHash: hash(payload) };
    const bytes = typeof Buffer !== 'undefined' && Buffer.byteLength ? Buffer.byteLength(JSON.stringify(pack), 'utf8') : JSON.stringify(pack).length;
    if (bytes > MAX_BYTES) return fail('PAYLOAD_TOO_LARGE', 'review package exceeds quota', { maxBytes: MAX_BYTES });
    return { ok: true, package: pack };
  }
  function importPackage(input, { maxEntries = MAX_ENTRIES } = {}) {
    let pack = input;
    try { if (typeof input === 'string') pack = JSON.parse(input); } catch (error) { return fail('INVALID_JSON', error.message); }
    if (!pack || pack.schemaVersion !== SCHEMA_VERSION) return fail('SCHEMA_VALIDATION_FAILED', 'unsupported review package schema');
    const { contentHash, ...payload } = pack;
    if (!contentHash || contentHash !== hash(payload)) return fail('HASH_MISMATCH', 'review package content hash mismatch');
    const entries = Array.isArray(pack.pendingItems) ? pack.pendingItems : [];
    if (entries.length > Math.min(maxEntries, MAX_ENTRIES)) return fail('PAYLOAD_TOO_LARGE', 'review entry quota exceeded');
    const accepted = [];
    const rejected = [];
    for (const item of entries) {
      if (!item || item.reviewed !== true || !item.reviewerId || !item.reviewedAt) { rejected.push({ id: item && item.id, code: 'REVIEW_ATTESTATION_REQUIRED' }); continue; }
      const { reviewed, reviewerId, reviewedAt, entryHash, ...entry } = item;
      if (!entryHash || entryHash !== hash(entry)) { rejected.push({ id: item.id, code: 'HASH_MISMATCH' }); continue; }
      accepted.push({ ...entry, reviewed: true, reviewerId: String(reviewerId), reviewedAt: String(reviewedAt), entryHash });
    }
    return { ok: true, package: { ...pack, pendingItems: accepted }, accepted, rejected };
  }
  function attestEntry(entry, { reviewerId, reviewedAt = new Date().toISOString() } = {}) {
    if (!entry || !reviewerId) return fail('INVALID_PARAMS', 'entry and reviewerId are required');
    return { ...entry, reviewed: true, reviewerId: String(reviewerId), reviewedAt, entryHash: hash(entry) };
  }
  return { SCHEMA_VERSION, MAX_BYTES, exportPackage, importPackage, attestEntry, hash };
});
