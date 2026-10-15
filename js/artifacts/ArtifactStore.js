/**
 * ArtifactStore —— 工件版本栈内核（P4 T4.1 · W3）
 *
 * 设计（FINAL 白皮书 Artifact 内容域合同 + P4 计划）：
 *  - 内容寻址：versionId = djb2(artifactId|kind|sourceHash|parentVersionId|seq)；
 *    sourceHash = djb2(规范化内容全文)——同内容重复提交幂等返回既有版本；
 *  - 不可变 DAG：每版本 {versionId, artifactId, parentVersionId, kind, sourceHash, content, createdAt, seq}，
 *    提交后内容不可变（快照存储，非引用）；
 *  - 冲突拒绝：parentVersionId 非该工件链尾 → VERSION_CONFLICT（附当前链尾），绝不静默合并；
 *  - 持久化：localStorage 'wenju_artifacts_v1'，容量上限 FIFO 淘汰（整工件淘汰，不撕链）；
 *    载入时逐版本重算 sourceHash 校验（防篡改，篡改版本剔除并标记）。
 *
 * 事件回调：onCommit(fn) 供 TeachingTimeline 联动（W7）——仅真实提交触发。
 */
(function (root, factory) {
  const api = factory(typeof require !== 'undefined' ? require('../mcp/QuotaPolicy.js') : {
    QuotaPolicy: root && root.QuotaPolicy
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.ArtifactStore = api.ArtifactStore; root.artifactStore = api.getSharedStore(); }
})(typeof window !== 'undefined' ? window : global, function (quotaApi) {
  'use strict';
  quotaApi = quotaApi || {};

  const QuotaPolicy = quotaApi.QuotaPolicy || class {
    assertArtifactVersion() {}
    assertArtifactTotal() {}
    assertStorageEntry() {}
    size(value) { return typeof value === 'string' ? value.length : JSON.stringify(value).length; }
  };

  const STORE_KEY = 'wenju_artifacts_v1';
  const MAX_VERSIONS = 500; // 全局版本数上限（FIFO 按整工件淘汰）

  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
  }

  class ArtifactStore {
    constructor(options = {}) {
      this.storageKey = options.storageKey || STORE_KEY;
      this.sessionId = null;
      this.versions = {};       // versionId -> version record
      this.heads = {};          // artifactId -> 链尾 versionId
      this.seqByArtifact = {};  // artifactId -> seq counter
      this.maxVersions = options.maxVersions || MAX_VERSIONS;
      this.quota = options.quotaPolicy || new QuotaPolicy(options.quotas || {});
      this.listeners = new Set();
      this._load();
    }

    setSession(sessionId) {
      if (!sessionId || typeof sessionId !== 'string') throw new Error('INVALID_SESSION_ID');
      if (this.sessionId === sessionId) return;
      this.sessionId = sessionId;
      this.storageKey = STORE_KEY + ':' + encodeURIComponent(sessionId);
      this.versions = {}; this.heads = {}; this.seqByArtifact = {};
      this._load();
    }

    importLegacyReferences(references) {
      if (!this.sessionId || this.artifacts().length || typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      let legacy;
      try {
        legacy = JSON.parse(raw);
      } catch (e) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[ArtifactStore] Legacy references corrupt, skipping legacy import:', e);
        }
        return;
      }
      if (!legacy || typeof legacy !== 'object') return;
      const selected = new Set((references || []).map(ref => ref?.artifactId).filter(Boolean));
      for (const [id, version] of Object.entries(legacy.versions || {})) {
        if (version && selected.has(version.artifactId) && djb2(version.content) === version.sourceHash) this.versions[id] = version;
      }
      for (const id of selected) {
        if (this.versions[legacy.heads?.[id]]) { this.heads[id] = legacy.heads[id]; this.seqByArtifact[id] = legacy.seqByArtifact?.[id] || this.versions[this.heads[id]].seq; }
      }
      const saved = this._save();
      if (!saved.ok) throw Object.assign(new Error(saved.message), { code: saved.code });
    }

    on(fn) { if (typeof fn === 'function') this.listeners.add(fn); return () => this.listeners.delete(fn); }
    _emit(evt) {
      for (const fn of this.listeners) {
        try { fn(evt); } catch (error) {
          const payload = { event: 'artifact_listener_failed', error: String(error && error.message || error), artifactId: evt && evt.artifactId };
          if (typeof globalThis !== 'undefined' && globalThis.StructuredLogger?.warn) globalThis.StructuredLogger.warn('artifact_listener_failed', payload);
          else if (typeof console !== 'undefined' && console.warn) console.warn('[ArtifactStore] artifact_listener_failed', payload);
        }
      }
    }

    // ---------- 提交 ----------
    /**
     * @param {object} p
     * @param {string} p.artifactId - 工件标识（Agent 二次生成同 id → 新版本）
     * @param {string} p.kind - 'html' | 'svg' | 'interactive' | 'geometry' | 'academic_proof' | 'vector_graphics'
     * @param {string} p.content - 工件全文（html/svg 源码）
     * @param {string} [p.parentVersionId] - 期望父版本（缺省 = 当前链尾；显式传过期值 → 冲突）
     * @param {string} [p.title]
     * @param {object} [p.meta] - 额外元数据（如 reproducibleRef）
     * @returns {{ok:true, version, created:boolean} | {ok:false, code, message, head}}
     */
    commit({ artifactId, kind, content, parentVersionId, title, meta }) {
      if (!artifactId || !kind || typeof content !== 'string') {
        return { ok: false, code: 'INVALID_COMMIT', message: '需要 artifactId/kind/content' };
      }
      try {
        this.quota.assertArtifactVersion(content);
      } catch (err) {
        return { ok: false, code: err.code || 'ARTIFACT_QUOTA_EXCEEDED', message: err.message, details: err.details || {} };
      }
      // 静态安全校验：仅拦截恶意外链脚本注入与逃逸伪协议，放行所有绘图标签与样式
      if (['html', 'svg', 'interactive'].includes(kind)) {
        const dangerousRules = [
          {
            regex: /<\s*script\b[^>]*\bsrc\s*=\s*["']\s*(?:https?:|\/\/)/i,
            reason: '不得外嵌不可信外部脚本文件'
          },
          {
            regex: /\b(?:href|src|action)\s*=\s*["']\s*javascript:/i,
            reason: '不得使用 javascript: 伪协议'
          },
          {
            regex: /\b(?:src|href)\s*=\s*["']\s*blob:/i,
            reason: '不得使用 blob: 协议'
          },
          {
            regex: /<\s*(?:iframe|object|embed)\b/i,
            reason: '不得嵌入 <iframe>、<object>、<embed> 标签'
          }
        ];
        for (const rule of dangerousRules) {
          const match = content.match(rule.regex);
          if (match) {
            return {
              ok: false,
              code: 'EXTERNAL_SRC_FORBIDDEN',
              matched: match[0],
              message: `工件内容不得引用外部网络资源或危险内嵌标签（离线自包含契约）：检测到「${match[0]}」(${rule.reason})。请使用自包含 HTML/SVG/Canvas 与内联脚本绘制图形`
            };
          }
        }
      }

      const sourceHash = djb2(content);
      const head = this.heads[artifactId] || null;

      // 冲突检测：显式 parentVersionId 且非链尾 → 拒绝（W3 断言）
      if (parentVersionId !== undefined && parentVersionId !== head) {
        return {
          ok: false, code: 'VERSION_CONFLICT',
          message: 'parentVersionId 非当前链尾（并发修订冲突，拒绝静默覆盖）',
          head, requestedParent: parentVersionId
        };
      }

      // 幂等：同内容同父 → 返回既有版本（不新建）
      if (head) {
        const existing = this.versions[head];
        if (existing && existing.sourceHash === sourceHash) {
          return { ok: true, version: existing, created: false };
        }
      }

      const existingBytes = head && this.versions[head] ? this.quota.size(this.versions[head].content) : 0;
      const currentBytes = Object.values(this.versions).reduce((sum, item) => sum + this.quota.size(item.content), 0);
      try {
        this.quota.assertArtifactTotal(currentBytes, this.quota.size(content), existingBytes);
      } catch (err) {
        return { ok: false, code: err.code || 'ARTIFACT_QUOTA_EXCEEDED', message: err.message, details: err.details || {} };
      }

      const seq = (this.seqByArtifact[artifactId] || 0) + 1;
      const versionId = djb2([artifactId, kind, sourceHash, head || 'ROOT', seq].join('|'));
      const version = {
        versionId, artifactId, parentVersionId: head, kind,
        sourceHash, content, title: title || '',
        meta: meta || null, createdAt: new Date().toISOString(), seq
      };
      const previousVersions = this.versions;
      const previousHeads = this.heads;
      const previousSeq = this.seqByArtifact;
      this.versions = { ...this.versions, [versionId]: version };
      this.heads = { ...this.heads, [artifactId]: versionId };
      this.seqByArtifact = { ...this.seqByArtifact, [artifactId]: seq };
      this._evictIfNeeded();
      const persisted = this._save();
      if (!persisted.ok) {
        this.versions = previousVersions;
        this.heads = previousHeads;
        this.seqByArtifact = previousSeq;
        return persisted;
      }

      this._emit({
        type: head ? 'artifact_version' : 'artifact_created',
        artifactId, versionId, parentVersionId: head, kind, sourceHash, seq
      });
      return { ok: true, version, created: true };
    }

    // ---------- 查询与回溯 ----------
    checkout(versionId) {
      const v = this.versions[versionId];
      if (!v) return { ok: false, code: 'VERSION_NOT_FOUND', message: '版本不存在: ' + versionId };
      // 内容完整性校验：重算哈希（W3 回溯一致性）
      if (djb2(v.content) !== v.sourceHash) {
        return { ok: false, code: 'CONTENT_TAMPERED', message: '版本内容与 sourceHash 不符（篡改检测）' };
      }
      return { ok: true, version: { ...v, content: v.content } };
    }

    head(artifactId) { return this.heads[artifactId] || null; }
    history(artifactId) {
      const out = [];
      const visited = new Set();
      let cur = this.heads[artifactId] || null;
      while (cur && !visited.has(cur)) {
        visited.add(cur);
        const v = this.versions[cur];
        if (!v) break;
        out.push({ versionId: v.versionId, seq: v.seq, kind: v.kind, sourceHash: v.sourceHash, createdAt: v.createdAt, title: v.title });
        cur = v.parentVersionId;
      }
      return out.reverse(); // 时间正序
    }
    artifacts() { return Object.keys(this.heads); }

    // ---------- 持久化 ----------
    _save() {
      try {
        if (typeof localStorage === 'undefined') return { ok: true, skipped: true };
        const serialized = JSON.stringify({
          versions: this.versions, heads: this.heads, seqByArtifact: this.seqByArtifact
        });
        this.quota.assertStorageEntry(serialized);
        localStorage.setItem(this.storageKey, serialized);
        return { ok: true };
      } catch (e) {
        return { ok: false, code: e.code || 'LOCAL_STORAGE_QUOTA_EXCEEDED', message: e.message || 'artifact persistence failed', details: e.details || {} };
      }
    }

    _load() {
      try {
        if (typeof localStorage === 'undefined') return;
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) return;
        const d = JSON.parse(raw);
        this.versions = d.versions || {};
        this.heads = d.heads || {};
        this.seqByArtifact = d.seqByArtifact || {};
        // 逐版本哈希校验（防篡改：被改的版本剔除并修链）
        for (const [vid, v] of Object.entries(this.versions)) {
          if (djb2(v.content) !== v.sourceHash) {
            delete this.versions[vid];
          }
        }
        // 修链：heads 指向被剔除版本 → 从剩余完好版本中寻找序号最大的有效版本
        for (const [aid, hid] of Object.entries(this.heads)) {
          if (!this.versions[hid]) {
            const validVersions = Object.values(this.versions)
              .filter(v => v && v.artifactId === aid)
              .sort((a, b) => (b.seq || 0) - (a.seq || 0));
            if (validVersions.length > 0) {
              this.heads[aid] = validVersions[0].versionId;
            } else {
              delete this.heads[aid];
              delete this.seqByArtifact[aid];
            }
          }
        }
      } catch (e) { this.versions = {}; this.heads = {}; this.seqByArtifact = {}; }
    }

    /** FIFO 淘汰：全局版本数超限 → 按 createdAt 淘汰最旧工件的全部版本（整链删除，不撕中间，防死循环与充分淘汰） */
    _evictIfNeeded() {
      let maxRounds = 100;
      while (Object.keys(this.versions).length > this.maxVersions && maxRounds-- > 0) {
        let oldest = null, oldestTime = Infinity;
        for (const aid of Object.keys(this.heads)) {
          const h = this.versions[this.heads[aid]];
          if (!h) continue;
          let first = h;
          const visited = new Set([first.versionId]);
          while (first.parentVersionId && this.versions[first.parentVersionId]) {
            if (visited.has(first.parentVersionId)) break;
            visited.add(first.parentVersionId);
            first = this.versions[first.parentVersionId];
          }
          const t = new Date(first.createdAt).getTime();
          if (t < oldestTime) {
            oldestTime = t;
            oldest = aid;
          }
        }
        if (!oldest) {
          // 兜底：若 heads 未关联孤儿版本，直接剔除最旧版本
          const sorted = Object.values(this.versions).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          if (sorted.length > 0) {
            delete this.versions[sorted[0].versionId];
          } else {
            break;
          }
          continue;
        }
        // 彻底删除该工件全部版本
        for (const [vid, v] of Object.entries(this.versions)) {
          if (v.artifactId === oldest) delete this.versions[vid];
        }
        delete this.heads[oldest];
        delete this.seqByArtifact[oldest];
      }
    }
  }

  let shared = null;
  function getSharedStore() {
    if (shared) return shared;
    // 审计修复（P4 第四轮）：Node 环境下 window 不存在时不应拒绝——
    // 直接构造单例（无 window 引用），浏览器环境额外挂到 window
    shared = new ArtifactStore();
    if (typeof window !== 'undefined') window.artifactStore = shared;
    return shared;
  }

  return { ArtifactStore, djb2, getSharedStore };
});
