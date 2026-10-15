/**
 * MisconceptionLibrary —— 误解条目库（P2 T2.3）
 * 只读种子库（D-03：审核环推迟至上线前，动态入库结构预留）。
 * 溯源字段 source ∈ {legacy-card, local-annotation, eedi-taxonomy}；
 * EEDI 映射条目的 eediMisconceptionId 在 Kaggle 数据获取前保持 null（不伪造溯源）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MisconceptionLibrary = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const REQUIRED = ['id', 'chapter', 'statement', 'source', 'eediMisconceptionId', 'discriminating', 'boundaryPrompt', 'bkt'];
  const ALLOWED_SOURCES = ['legacy-card', 'local-annotation', 'eedi-taxonomy'];
  const ALLOWED_OPTION_KEYS = ['misconception', 'calculation', 'misreading'];

  function loadLibrary(rawJson) {
    const data = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    const errors = [];
    if (!data || !Array.isArray(data.entries)) throw new Error('[MisconceptionLibrary] 缺少 entries 数组');
    data.entries.forEach((e, i) => {
      for (const k of REQUIRED) if (e[k] === undefined) errors.push(`#${i}(${e.id || '?'}) 缺字段 ${k}`);
      if (!ALLOWED_SOURCES.includes(e.source)) errors.push(`#${i} 非法 source: ${e.source}`);
      const d = e.discriminating || {};
      if (!d.stem || !Array.isArray(d.options) || d.options.length !== 3) errors.push(`#${i} 区分性追问必须为 3 选项`);
      else {
        const keys = d.options.map((o) => o.key).sort();
        const want = [...ALLOWED_OPTION_KEYS].sort();
        if (JSON.stringify(keys) !== JSON.stringify(want)) errors.push(`#${i} 选项 key 集合非法: ${keys}`);
        if (!ALLOWED_OPTION_KEYS.includes(d.correctKey)) errors.push(`#${i} correctKey 非法: ${d.correctKey}`);
      }
      const b = e.bkt || {};
      for (const p of ['L0', 'T', 'G', 'S']) {
        if (typeof b[p] !== 'number' || b[p] < 0 || b[p] > 1) errors.push(`#${i} bkt.${p} 越界`);
      }
      if (b.G !== undefined && b.S !== undefined && b.G + b.S >= 1) errors.push(`#${i} G+S ≥ 1（BKT 可辨识性破坏）`);
    });
    if (errors.length) throw new Error('[MisconceptionLibrary] 校验失败:\n' + errors.join('\n'));
    return data;
  }

  class MisconceptionLibrary {
    constructor(rawJson) {
      // Node：从同目录 JSON 读取；浏览器：fetch 由宿主负责，亦允许注入
      let raw = rawJson;
      if (!raw) {
        if (typeof require !== 'undefined') {
          raw = require('./misconceptions.json');
        } else if (typeof window !== 'undefined' && window.__MISCONCEPTIONS_SEED__) {
          raw = window.__MISCONCEPTIONS_SEED__;
        }
      }
      if (!raw) throw new Error('[MisconceptionLibrary] 未提供种子数据（Node require 或 window.__MISCONCEPTIONS_SEED__）');
      this.data = loadLibrary(raw);
    }

    size() { return this.data.entries.length; }
    chapters() { return this.data.chapters.slice(); }
    byChapter(ch) { return this.data.entries.filter((e) => e.chapter === ch); }
    byId(id) { return this.data.entries.find((e) => e.id === id) || null; }
    bySource(src) { return this.data.entries.filter((e) => e.source === src); }
    unmappedEedi() { return this.data.entries.filter((e) => e.source === 'eedi-taxonomy' && e.eediMisconceptionId === null); }
    getDiscriminatingQuestion(id) {
      const e = this.byId(id);
      return e ? e.discriminating : null;
    }
    getBktParams(id) {
      const e = this.byId(id);
      return e ? e.bkt : null;
    }
    stats() {
      const s = { total: this.size(), bySource: {} };
      for (const e of this.data.entries) s.bySource[e.source] = (s.bySource[e.source] || 0) + 1;
      s.unmappedEedi = this.unmappedEedi().length;
      return s;
    }
  }

  return { MisconceptionLibrary, loadLibrary };
});
