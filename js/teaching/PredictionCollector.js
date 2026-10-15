/**
 * PredictionCollector —— 预测提交协议 + 预测-事实冲突记录（P2 T2.2）
 *
 * 申报书差异化第 1 点的落地机制："强制预测 + 理由说明"是系统协议而非对话惯例。
 * 职责：
 *  1. 受理结构化预测（预测值 + 理由），理由门槛：非空且 ≥8 字符；
 *  2. 提交成功即把 PECHDT 状态从 PREDICT 推进到 PERCEIVE（解析确认），解锁实验工具；
 *  3. 实验事实到达后（recordFact）与预测对拍，产出六元组冲突记录：
 *     { prediction, rationale, fact, conflict, kernel, reproducibleRef }；
 *  4. 冲突 → 状态机进入 CONFLICT；一致 → ENGAGE。全部记录可序列化（localStorage）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.PredictionCollector = api.PredictionCollector; root.predictionCollector = api.getSharedCollector(); }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const STORE_KEY = 'wenju_predictions_v1';

  class PredictionCollector {
    constructor(store) {
      this.store = store; // PechdtStateStore 共享实例
      this.records = [];
      this.listeners = new Set();
      this._load();
    }

    _load() {
      try {
        if (typeof localStorage === 'undefined') return;
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) this.records = JSON.parse(raw) || [];
      } catch (e) { this.records = []; }
    }

    _save() {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(this.records));
      } catch (e) { /* 只读存储时降级内存态 */ }
    }

    /** 校验理由门槛：非空、≥8 字符 */
    static validateRationale(rationale) {
      return typeof rationale === 'string' && rationale.trim().length >= 8;
    }

    /**
     * 受理预测：{taskId, key, value(预测值), prediction(自由文本), rationale(理由)}
     * 返回 {ok} 或 {ok:false, code}。成功后推进状态 PREDICT → PERCEIVE。
     */
    submitPrediction({ taskId, key, value, prediction, rationale }) {
      if (!taskId || !key) return { ok: false, code: 'MISSING_TASK_OR_KEY', message: '需要 taskId 与预测键 key' };
      if (!PredictionCollector.validateRationale(rationale)) {
        return { ok: false, code: 'RATIONALE_TOO_SHORT', message: '理由说明不足 8 字——预测不可绕过：请先写下你的预测与理由' };
      }
      const rec = {
        taskId, key,
        value,
        prediction: String(prediction || value),
        rationale: String(rationale).trim(),
        submittedAt: new Date().toISOString(),
        fact: null, conflict: null, kernel: null, reproducibleRef: null
      };
      this.records.push(rec);
      this._save();
      if (this.store && this.store.getState().stage === 'PREDICT') {
        this.store.setStage('PERCEIVE', { source: 'six-step:predict', taskId });
      }
      this._notify('submit', rec);
      return { ok: true, record: rec };
    }

    /**
     * 实验事实到达：与同 taskId+key 的预测对拍，写回六元组并驱动状态机。
     * 返回冲突记录（若无对应预测返回 null）。
     */
    recordFact({ taskId, key, fact, kernel, reproducibleRef }) {
      const rec = this.records.find((r) => r.taskId === taskId && r.key === key && r.fact === null);
      if (!rec) return null;
      rec.fact = fact;
      rec.kernel = kernel || null;
      rec.reproducibleRef = reproducibleRef || null;
      rec.conflict = !this._factsEqual(rec.value, fact);
      rec.recordedAt = new Date().toISOString();
      this._save();
      if (this.store && rec.conflict) {
        this.store.setStage('CONFLICT', { source: 'six-step:conflict', taskId });
      } else if (this.store) {
        this.store.setStage('ENGAGE', { source: 'six-step:fact', taskId });
      }
      this._notify('fact', rec);
      return rec;
    }

    _factsEqual(a, b) {
      if (a === b) return true;
      if (a == null || b == null) return false;
      return String(a) === String(b); // 精确有理字符串/布尔统一字符串比较
    }

    getRecords() { return this.records.slice(); }
    getConflicts() { return this.records.filter((r) => r.conflict === true); }
    getPendingForTask(taskId) { return this.records.filter((r) => r.taskId === taskId && r.fact === null); }

    /**
     * 订阅事件。两种签名：
     *   on(fn)               —— 接收全部事件 fn(kind, record)
     *   on('fact', fn)       —— 仅接收指定 kind（kind ∈ 'submit' | 'fact'）
     */
    on(eventKindOrFn, maybeFn) {
      let fn = eventKindOrFn;
      if (typeof eventKindOrFn === 'string' && typeof maybeFn === 'function') {
        const kind = eventKindOrFn;
        fn = (k, rec) => { if (k === kind) maybeFn(k, rec); };
      }
      if (typeof fn !== 'function') return () => {};
      this.listeners.add(fn);
      return () => this.listeners.delete(fn);
    }
    _notify(kind, rec) { for (const fn of this.listeners) { try { fn(kind, rec); } catch (e) { if (typeof recordIssue === 'function') recordIssue('PredictionCollector', 'for', e); } } }
  }

  let sharedCollector = null;
  function getSharedCollector(store) {
    if (sharedCollector) return sharedCollector;
    let st = store;
    if (!st) {
      try {
        const mod = require('../pechdtStateStore.js');
        st = mod.getSharedStore();
      } catch (e) { /* 浏览器路径 */ }
    }
    if (!st && typeof window !== 'undefined') {
      // 浏览器：pechdtStateStore UMD 已挂 window.pechdtStateStore（共享实例）；
      // 兼容早于 stateStore 加载的极端顺序——经类静态获取
      st = window.pechdtStateStore
        || (window.PechdtStateStore && typeof window.PechdtStateStore.getSharedStore === 'function'
          ? window.PechdtStateStore.getSharedStore() : null);
    }
    sharedCollector = new PredictionCollector(st);
    if (typeof window !== 'undefined') window.predictionCollector = sharedCollector;
    return sharedCollector;
  }

  PredictionCollector.getSharedCollector = getSharedCollector; // 浏览器 window.PredictionCollector 为类本体，静态挂载

  return { PredictionCollector, getSharedCollector };
});
