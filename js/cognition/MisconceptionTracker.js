/**
 * MisconceptionTracker —— 三态误解诊断引擎（P2 T2.4）
 *
 * 状态机（申报书口径）：
 *   candidate（候选）→ probing（追问中）→ pending_confirm（待确认，无教师复核环——D-03）
 *   证据矛盾时回落 candidate 并保留记录。
 *
 * 分工纪律（Agentic KT, arXiv:2606.25358 的核心教训）：
 *   置信度一律由 BKT 数值给出（LLM 仅生成追问措辞/证据解释，不得输出概率）。
 *
 * BKT 更新（Corbett & Anderson 1995）：
 *   观测后验：p' = p(1−S)/[p(1−S)+(1−p)G]   （答对）
 *             p' = p·S/[p·S+(1−p)(1−G)]      （答错）
 *   学习转移：p'' = p' + (1−p')T
 * 参数首版为保守常数（pyBKT 离线拟合导出前的默认表），标注"未拟合"。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MisconceptionTracker = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const STORE_KEY = 'wenju_misconception_tracker_v1';
  const DEFAULT_BKT = { L0: 0.3, T: 0.1, G: 0.2, S: 0.1 };

  /** 纯函数 BKT 步进（单步，可独立测试） */
  function bktStep(p, obs, { T, G, S }) {
    const lik = obs ? p * (1 - S) + (1 - p) * G : p * S + (1 - p) * (1 - G);
    let post = obs ? (p * (1 - S)) / lik : (p * S) / (p * S + (1 - p) * (1 - G));
    return post + (1 - post) * T;
  }

  class MisconceptionTracker {
    constructor(library, options = {}) {
      this.library = library || null;
      this.states = {}; // id -> {status, pL, evidence:[], updatedAt}
      this.confirmThreshold = options.confirmThreshold || 0.75;
      this.listeners = new Set(); // P3：真实事件发射（TeachingTimeline 等订阅）
      this._load();
    }

    /** 订阅状态变更：fn({kind:'candidate'|'evidence', id, status, pL, taskId?, at}) */
    on(fn) { if (typeof fn === 'function') this.listeners.add(fn); return () => this.listeners.delete(fn); }
    _emit(evt) { for (const fn of this.listeners) { try { fn(evt); } catch (e) { if (typeof recordIssue === 'function') recordIssue('MisconceptionTracker', 'for', e); } } }

    _load() {
      try {
        if (typeof localStorage === 'undefined') return;
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) this.states = JSON.parse(raw) || {};
      } catch (e) { this.states = {}; }
    }

    _save() {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(this.states));
      } catch (e) { /* 只读存储降级内存态 */ }
    }

    _entry(id) {
      if (!this.states[id]) {
        const params = this.library ? (this.library.getBktParams(id) || DEFAULT_BKT) : DEFAULT_BKT;
        this.states[id] = { status: 'candidate', pL: params.L0, evidence: [], updatedAt: new Date().toISOString(), fitted: false };
      }
      return this.states[id];
    }

    /** 预测-事实冲突 → 登记候选（一次错误预测不归因——申报书三态语义） */
    registerCandidate(id, evidence) {
      const e = this._entry(id);
      e.evidence.push({ kind: 'prediction_conflict', at: new Date().toISOString(), ...evidence });
      e.updatedAt = new Date().toISOString();
      this._save();
      this._emit({ kind: 'candidate', id, status: e.status, pL: e.pL, taskId: evidence && evidence.taskId, at: e.updatedAt });
      return this.getStatus(id);
    }

    /**
     * 区分性追问回答 → BKT 更新 + 状态转移。
     * answer.correct：回答是否"命中误解选项"（correct=true 表示表现出该误解）。
     * 转移规则：两次独立同向证据且 pL ≥ 阈值 → pending_confirm；反向证据 → 回落 candidate。
     */
    submitEvidence(id, { correct, detail, taskId }) {
      const e = this._entry(id);
      const params = this.library ? (this.library.getBktParams(id) || DEFAULT_BKT) : DEFAULT_BKT;
      e.pL = bktStep(e.pL, correct, params);
      e.evidence.push({ kind: 'discriminating_answer', correct, detail: detail || '', taskId: taskId || null, at: new Date().toISOString() });
      e.updatedAt = new Date().toISOString();

      if (e.status === 'candidate') {
        e.status = 'probing';
      } else if (e.status === 'probing') {
        const last2 = e.evidence.filter((x) => x.kind === 'discriminating_answer').slice(-2);
        if (last2.length === 2) {
          const consistent = last2[0].correct === last2[1].correct;
          if (!consistent) {
            e.status = 'candidate'; // 证据矛盾 → 回落候选并保留记录
          } else if (last2[0].correct === true && e.pL >= this.confirmThreshold) {
            e.status = 'pending_confirm'; // 两次独立同向证据 + 阈值 → 待确认（沉淀档案）
          } else if (last2[0].correct === false) {
            e.status = 'candidate'; // 反向证据：误解不成立
          }
        }
      }
      this._save();
      this._emit({ kind: 'evidence', id, status: e.status, pL: e.pL, correct, taskId: taskId || null, at: e.updatedAt });
      return this.getStatus(id);
    }

    getStatus(id) {
      const e = this.states[id];
      return e ? { id, status: e.status, pL: e.pL, evidenceCount: e.evidence.length, updatedAt: e.updatedAt } : null;
    }

    /** 不可压缩区快照（Y5：compaction 前后必须逐字节一致） */
    protectedSnapshot() {
      return JSON.stringify({ v: 1, states: this.states });
    }

    all() { return Object.keys(this.states).map((id) => this.getStatus(id)); }
  }

  return { MisconceptionTracker, bktStep, DEFAULT_BKT };
});
