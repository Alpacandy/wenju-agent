/**
 * PECHDT 单一状态源（徽章只读此 store，禁止用 rank 冒充）
 * M1 刀③；P2（2026-10-11）加法式扩展：
 *   - 六步探究闭环两站新增：PREDICT（预测先行）与 TRANSFER（无提示变式迁移）
 *   - 持久化 + 哈希链防篡改/防重放（stage+taskId+seq+ts 链式哈希，djb2 非加密级防篡改检测）
 *   - 实验工具门禁：PREDICT 态下实验类工具被引擎层强制拦截（PREDICT_REQUIRED）
 * 既有五站（PERCEIVE/ENGAGE/CHALLENGE/CONFLICT/DECONSTRUCT）行为与字段完全保持向后兼容。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.PechdtStateStore = api.PechdtStateStore;
    root.pechdtStateStore = api.getSharedStore();
  }
})(typeof window !== 'undefined' ? window : global, function () {
  const STAGE_LABELS = {
    IDLE: '○ IDLE · 未进入脚手架',
    UNKNOWN: '? UNKNOWN · 状态未知',
    PREDICT: '🔮 PREDICT · 预测先行（实验门禁生效）',
    PERCEIVE: '✦ PERCEIVE · 概念感知',
    ENGAGE: '◆ ENGAGE · 空间映射',
    CHALLENGE: '⚡ CHALLENGE · 认知挑战',
    CONFLICT: '⚡ CONFLICT · 认知冲突',
    HYPOTHESIZE: '❓ HYPOTHESIZE · 边界猜想',
    DEDUCE: '∑ DEDUCE · 推导验证',
    DECONSTRUCT: '▣ DECONSTRUCT · 结构拆解',
    TRANSFER: '🚀 TRANSFER · 无提示变式迁移'
  };

  // 六步顺序（申报书口径）：预测 → 解析确认 → 实验 → 冲突 → 边界猜想 → 推导验证 → 无提示变式
  const SIX_STEP_ORDER = ['PREDICT', 'PERCEIVE', 'ENGAGE', 'CONFLICT', 'HYPOTHESIZE', 'DEDUCE', 'TRANSFER'];

  // 实验类工具：PREDICT 态下被强制拦截（引擎层，非提示词约定）
  const EXPERIMENT_TOOLS = [
    'solve_matrix_kernel_sympy',
    'construct_counterexample_matrix',
    'drive_canvas_affine_transform',
    'render_canvas_graphics',
    'solve_linear_system'
  ];

  const PERSIST_KEY = 'wenju_pechdt_state_v2';

  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
  }

  class PechdtStateStore {
    constructor() {
      this.state = {
        stage: 'IDLE',
        antiSpoilerTriggered: false,
        updatedAt: null,
        source: 'init'
      };
      this.listeners = new Set();
      // P2 哈希链游标
      this.chain = { taskId: null, seq: 0, prevHash: '0'.repeat(8) };
      this._loadPersisted();
    }

    getState() {
      return Object.assign({}, this.state);
    }

    getStageLabel(stage) {
      return STAGE_LABELS[stage] || STAGE_LABELS.UNKNOWN;
    }

    /** P2：持久化记录（哈希链：hash = djb2(stage|taskId|seq|ts|prevHash)） */
    _persist() {
      try {
        if (typeof localStorage === 'undefined') return;
        const { stage } = this.state;
        const rec = {
          stage,
          antiSpoilerTriggered: this.state.antiSpoilerTriggered,
          taskId: this.chain.taskId,
          seq: this.chain.seq,
          ts: this.state.updatedAt,
          prevHash: this.chain.prevHash
        };
        rec.hash = djb2([rec.stage, rec.taskId, rec.seq, rec.ts, rec.prevHash].join('|'));
        localStorage.setItem(PERSIST_KEY, JSON.stringify(rec));
        this.chain.prevHash = rec.hash;
      } catch (e) { /* 存储不可用时静默降级为内存态（测试环境注入 localStorage 模拟） */ }
    }

    _loadPersisted() {
      try {
        if (typeof localStorage === 'undefined') return;
        const raw = localStorage.getItem(PERSIST_KEY);
        if (!raw) return;
        const rec = JSON.parse(raw);
        const expect = djb2([rec.stage, rec.taskId, rec.seq, rec.ts, rec.prevHash].join('|'));
        if (rec.hash !== expect) return; // 篡改检测：校验失败回退 IDLE，不采用被改状态
        this.state = { stage: rec.stage, antiSpoilerTriggered: !!rec.antiSpoilerTriggered, updatedAt: rec.ts, source: 'restored' };
        this.chain = { taskId: rec.taskId, seq: rec.seq, prevHash: rec.hash };
      } catch (e) { /* 损坏记录忽略 */ }
    }

    setStage(stage, meta) {
      const next = stage || 'UNKNOWN';
      this.state = {
        stage: next,
        antiSpoilerTriggered: !!(meta && meta.antiSpoilerTriggered),
        updatedAt: Date.now(),
        source: (meta && meta.source) || 'scaffold'
      };
      if (meta && meta.taskId) this.chain.taskId = meta.taskId;
      this.chain.seq += 1;
      this._persist();
      this.notify();
      this.syncBadgeDom();
      return this.getState();
    }

    /** P2：开启探究任务 → 进入 PREDICT（预测不可绕过的入口态） */
    startTask(taskId) {
      this.chain.taskId = taskId || ('task_' + Date.now());
      return this.setStage('PREDICT', { source: 'six-step', taskId: this.chain.taskId });
    }

    /** P2：PREDICT 态下实验类工具是否被拦截 */
    isExperimentBlocked(toolName) {
      return this.state.stage === 'PREDICT' && EXPERIMENT_TOOLS.includes(toolName);
    }

    /** P2：重放/篡改防御——外部提交带 seq 的状态推进时校验单调性 */
    guardReplay(seq) {
      if (typeof seq === 'number' && seq <= this.chain.seq) {
        return { blocked: true, code: 'REPLAY_DETECTED', message: '状态序列号未前进（seq=' + seq + ' ≤ ' + this.chain.seq + '），判定为重放，拒绝' };
      }
      return { blocked: false };
    }

    subscribe(fn) {
      if (typeof fn === 'function') {
        this.listeners.add(fn);
        fn(this.getState());
      }
      return () => this.listeners.delete(fn);
    }

    notify() {
      const snap = this.getState();
      for (const fn of this.listeners) {
        try { fn(snap); } catch (e) { if (typeof recordIssue === 'function') recordIssue('pechdtStateStore', 'for', e); }
      }
    }

    syncBadgeDom() {
      if (typeof document === 'undefined') return;
      const el = document.getElementById('pechdt-stage-badge');
      if (!el) return;
      const label = this.getStageLabel(this.state.stage);
      el.textContent = '对话 · ' + (this.state.antiSpoilerTriggered ? ('🛡 ' + label) : label);
      el.title='对话引导阶段；课程进度显示在课程作答栏中';
      el.className = 'pechdt-badge-chip' + (this.state.stage === 'CHALLENGE' || this.state.stage === 'CONFLICT' ? ' challenge' : '');
      el.dataset.pechdtStage = this.state.stage;
      el.dataset.pechdtSource = this.state.source;
    }
  }

  let shared = null;
  function getSharedStore() {
    if (!shared) shared = new PechdtStateStore();
    if (typeof window !== 'undefined') window.pechdtStateStore = shared;
    return shared;
  }

  return { PechdtStateStore, getSharedStore, STAGE_LABELS, SIX_STEP_ORDER, EXPERIMENT_TOOLS };
});
