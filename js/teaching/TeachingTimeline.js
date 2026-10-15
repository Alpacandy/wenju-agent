/**
 * TeachingTimeline —— 教学事件时间线（P3 T3.1 · Z1 物理载体）
 *
 * 职责：把散落在各模块的教学事件聚合为**单链哈希时间线**（每任务一条链）：
 *   conjecture / prediction / parse_confirm / experiment_fact / conflict /
 *   discriminating_q / evidence / status_change / hypothesis / deduction /
 *   variant_issue / variant_grade / hint_revealed / termination
 *
 * 真实性保证：
 *   - 事件仅由真实调用路径写入（collector/store/tracker 事件订阅 + flow 动作），无测试专用写入口；
 *   - 每事件 hash = djb2(prevHash | type | taskId | payload)，跨事件链式——回放一致性对拍（Z1）
 *     与演示包完整性校验（Z5/Z2）同源；篡改任一事件 verify() 必报 brokenAt。
 *
 * 持久化：localStorage 'wenju_timeline_v1'（容量上限 2000 事件，FIFO 淘汰最旧）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.TeachingTimeline = api.TeachingTimeline; root.teachingTimeline = api.getSharedTimeline(); }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const STORE_KEY = 'wenju_timeline_v1';

  let PayloadMigrationsApi = null;
  if (typeof require !== 'undefined') {
    try { PayloadMigrationsApi = require('../storage/PayloadMigrations.js'); } catch (error) { PayloadMigrationsApi = null; }
  }
  if (!PayloadMigrationsApi && typeof window !== 'undefined') PayloadMigrationsApi = window.PayloadMigrations;
  const MAX_EVENTS = 2000;

  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
  }

  class TeachingTimeline {
    constructor(options = {}) {
      this.events = [];
      this.chainHead = {}; // taskId -> 最新 hash
      this.seqByTask = {}; // taskId -> 序号
      this.maxEvents = options.maxEvents || MAX_EVENTS; // 审计修复：可配上限（长历史截断后链校验仍成立）
      this._load();
      if (options.store) this.attachStore(options.store);
      if (options.collector) this.attachCollector(options.collector);
      if (options.tracker) this.attachTracker(options.tracker);
    }

    // ---------- 真实事件源订阅（无测试专用入口） ----------
    attachStore(store) {
      this.store = store;
      let lastStamp = 0;
      store.subscribe((snap) => {
        if (!snap || snap.updatedAt === lastStamp) return; // 同一次迁移去重（badge 重入）
        lastStamp = snap.updatedAt;
        if (snap.source === 'init' || snap.stage === 'IDLE' && snap.source === 'init') return;
        this.append('status_change', { stage: snap.stage, source: snap.source }, (store.chain && store.chain.taskId) || null);
      });
    }

    attachCollector(collector) {
      this.collector = collector;
      collector.on('submit', (kind, rec) => {
        this.append('prediction', { key: rec.key, value: rec.value, prediction: rec.prediction, rationale: rec.rationale }, rec.taskId);
      });
      collector.on('fact', (kind, rec) => {
        this.append('experiment_fact', { key: rec.key, fact: rec.fact, kernel: rec.kernel, reproducibleRef: rec.reproducibleRef }, rec.taskId);
        if (rec.conflict === true) {
          this.append('conflict', { key: rec.key, prediction: rec.value, fact: rec.fact, kernel: rec.kernel, reproducibleRef: rec.reproducibleRef }, rec.taskId);
        }
      });
    }

    attachTracker(tracker) {
      this.tracker = tracker;
      if (typeof tracker.on === 'function') {
        // 审计修复：原映射将 evidence 错标为 status_change（candidate/evidence 均属证据域，统一落 'evidence'，
        // 具体子类保存在 payload.kind 中）
        tracker.on((evt) => this.append('evidence', evt, evt.taskId || null));
      }
    }

    // ---------- 链式追加 ----------
    append(type, payload, taskId) {
      const tid = taskId || '__global__';
      const seq = (this.seqByTask[tid] || 0) + 1;
      this.seqByTask[tid] = seq;
      const prevHash = this.chainHead[tid] || 'GENESIS';
      const clean = payload === undefined ? null : JSON.parse(JSON.stringify(payload));
      const hash = djb2([prevHash, type, tid, JSON.stringify(clean)].join('|'));
      const evt = { seq, ts: new Date().toISOString(), type, taskId: tid, payload: clean, prevHash, hash };
      this.events.push(evt);
      this.chainHead[tid] = hash;
      if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
      this._save();
      return evt;
    }

    // ---------- 查询与校验 ----------
    list(taskId) { return this.events.filter((e) => e.taskId === taskId); }
    tasks() { return [...new Set(this.events.map((e) => e.taskId))]; }

    /**
     * 整链重放校验：重算每条 hash 与上链引用（Z1 对拍核心）。
     * 审计修复：容忍容量截断——链首事件以自身 prevHash 为基点（trust-on-first），
     * 链尾与 chainHead 对账；任一中间事件的载荷/删除篡改均在下一事件处暴露。
     */
    verify(taskId) {
      const chain = this.list(taskId);
      if (!chain.length) return { ok: true, length: 0, head: this.chainHead[taskId] || null };
      let prev = chain[0].prevHash;
      for (const e of chain) {
        if (e.prevHash !== prev) {
          return { ok: false, brokenAt: e.seq, reason: 'PREV_HASH_MISMATCH' };
        }
        const expect = djb2([prev, e.type, e.taskId, JSON.stringify(e.payload)].join('|'));
        if (e.hash !== expect) {
          return { ok: false, brokenAt: e.seq, reason: 'EVENT_HASH_MISMATCH' };
        }
        prev = e.hash;
      }
      const storedHead = this.chainHead[taskId];
      if (storedHead && storedHead !== prev) {
        return { ok: false, brokenAt: chain[chain.length - 1].seq, reason: 'CHAIN_HEAD_MISMATCH（链尾被篡改或截断不对称）' };
      }
      return { ok: true, length: chain.length, head: prev };
    }

    countByType(taskId) {
      const out = {};
      for (const e of this.list(taskId)) out[e.type] = (out[e.type] || 0) + 1;
      return out;
    }

    // ---------- 持久化（P6-A：localStorage 同步主路径 + StoragePort 异步镜像；SQLite 就绪） ----------
    _save() {
      const payload = { schemaVersion: 1, events: this.events, chainHead: this.chainHead, seqByTask: this.seqByTask, savedAt: Date.now() };
      this._savedAt = payload.savedAt;
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(payload));
      } catch (e) { /* 只读降级 */ }
      // 端口镜像（IndexedDB / Host SQLite）：异步写，失败不影响主路径
      if (this.port) {
        try { this.port.set('teaching_timeline_v1', payload).catch(() => {}); } catch (e) { /* 端口异常忽略 */ }
      }
    }

    /** P7-H1 竞态修复：端口挂接后补推当前状态（挂接前发生的追加在端口不可见） */
    syncToPort() { if (!this.port) return false; this._save(); return true; }

    _load() {
      try {
        if (typeof localStorage === 'undefined') return;
        const raw = localStorage.getItem(STORE_KEY);
        if (!raw) return;
      const d = JSON.parse(raw);
      // P7：统一版本迁移（v0 无 savedAt → v1 规范信封）；失败显式记录并保持空态（不写半迁移态）
      if (PayloadMigrationsApi && typeof PayloadMigrationsApi.runMigrations === 'function') {
        const mig = PayloadMigrationsApi.runMigrations(d, 'teaching_timeline');
        if (mig.ok) {
          this.events = mig.payload.events || [];
          this.chainHead = mig.payload.chainHead || {};
          this.seqByTask = mig.payload.seqByTask || {};
          this._savedAt = mig.payload.savedAt || null;
          return;
        }
        if (typeof recordIssue === 'function') recordIssue('TeachingTimeline', 'migrate_timeline', { code: mig.code, at: mig.at || null });
        return;
      }
      this.events = d.events || [];
      this.chainHead = d.chainHead || {};
      this.seqByTask = d.seqByTask || {};
      this._savedAt = d.savedAt || null;
      } catch (e) { this.events = []; }
    }

    /** P6-A：挂载存储端口（存储 SQLite 化就绪——端口后端可插拔） */
    attachPort(port) { this.port = port || null; return this; }

    /**
     * P6-A：从端口（IndexedDB/SQLite）恢复——当端口快照比本地 localStorage 更新时整体替换。
     * 返回 { ok, source, events, savedAt, chainsOK }；端口无数据/损坏时显式说明（不猜测）。
     */
    async rehydrate() {
      if (!this.port) return { ok: false, code: 'NO_PORT' };
      let remote = null;
      try { remote = await this.port.get('teaching_timeline_v1'); } catch (e) { return { ok: false, code: 'PORT_ERROR', message: String(e && e.message || e) }; }
      if (!remote || !Array.isArray(remote.events)) return { ok: false, code: 'PORT_EMPTY' };
      if (this._savedAt && remote.savedAt && remote.savedAt <= this._savedAt) {
        return { ok: true, source: 'local-newer', events: this.events.length, savedAt: this._savedAt };
      }
      this.events = remote.events;
      this.chainHead = remote.chainHead || {};
      this.seqByTask = remote.seqByTask || {};
      this._savedAt = remote.savedAt || null;
      // 恢复后逐任务链校验（数据完整性断言）
      let chainsOK = true;
      for (const tid of this.tasks()) {
        if (!this.verify(tid).ok) { chainsOK = false; break; }
      }
      return { ok: true, source: 'port', events: this.events.length, savedAt: this._savedAt, chainsOK };
    }
  }

  let shared = null;
  function getSharedTimeline(options) {
    if (shared) return shared;
    if (typeof window === 'undefined') return null;
    shared = new TeachingTimeline(options);
    window.teachingTimeline = shared;
    return shared;
  }

  return { TeachingTimeline, djb2, getSharedTimeline };
});
