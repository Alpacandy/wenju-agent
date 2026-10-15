/**
 * ExactKernel —— 精确数学内核门面（P1 数学真底）
 *
 * 双层架构：
 *   1) RationalCore（同步、零依赖、离线可用）：det/rank/逆/零空间/charpoly/有理特征根，
 *      全 BigInt 精确判定，无 eps——保证底线（file://、断网、Node 测试环境均可用）；
 *   2) SymPy Worker（浏览器可用时按需加载，锁定 v0.28.3/sympy 1.13.3）：无理/复特征根精确根式、
 *      对角化判定。不可用时如实返回 needs_symbolic，绝不伪造。
 *
 * API：
 *   ExactKernel.analyze(elements)          —— 同步精确分析（RationalCore 层）
 *   await ExactKernel.analyzeFull(elements)—— 补全符号层（SymPy ready 时覆盖 eigenvalues/diagonalizable）
 *   ExactKernel.getStatus()               —— { mode: 'rational-core' | 'rational+sympy', workerReady }
 *
 * UMD：浏览器 window.ExactKernel；Node module.exports（Worker 不可用，恒 RationalCore 模式）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExactKernel = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  let RC;
  try { RC = require('./RationalCore.js'); } catch (e) { /* 浏览器全局回退 */ }
  if (!RC && typeof RationalCore !== 'undefined') RC = RationalCore;
  if (!RC) throw new Error('[ExactKernel] RationalCore 未加载（需先加载 js/math/RationalCore.js）');

  const state = { worker: null, workerReady: false, pending: new Map(), seq: 0, unavailable: false };

  function initWorker() {
    if (state.worker || state.unavailable) return;
    if (typeof window === 'undefined' || typeof Worker === 'undefined') { state.unavailable = true; return; }
    // file:// 协议下 Worker 受限：降级 RationalCore（部署文档维持 http.server 建议）
    if (typeof location !== 'undefined' && location.protocol === 'file:') { state.unavailable = true; return; }
    try {
      state.worker = new Worker('js/math/exactKernelWorker.js');
      state.worker.onmessage = (ev) => {
        const d = ev.data || {};
        if (d.type === 'ready') { state.workerReady = true; return; }
        if (d.type === 'unavailable') { state.unavailable = true; return; }
        if (d.id && state.pending.has(d.id)) {
          const { resolve, reject } = state.pending.get(d.id);
          state.pending.delete(d.id);
          d.ok ? resolve(d.result) : reject(new Error(d.error));
        }
      };
      state.worker.onerror = () => { state.unavailable = true; };
    } catch (e) { state.unavailable = true; }
  }
  initWorker();

  function workerCall(op, args, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (!state.workerReady) { reject(new Error('SYMPY_WORKER_NOT_READY')); return; }
      const id = 'k' + (++state.seq);
      const timer = setTimeout(() => { state.pending.delete(id); reject(new Error('SYMPY_WORKER_TIMEOUT')); }, timeoutMs);
      state.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      state.worker.postMessage({ id, op, args });
    });
  }

  return {
    /** 同步精确分析（保证层，永不失败于网络/环境） */
    analyze(elements) { return RC.analyze(elements); },

    /** 异步全量分析：RationalCore 底 + SymPy 补全（不可用时如实标注） */
    async analyzeFull(elements) {
      const base = RC.analyze(elements);
      if (!state.workerReady || state.unavailable) return base;
      try {
        const sym = await workerCall('analyze', { elements, ops: ['det', 'rank', 'eigen', 'charpoly', 'diagonalizable'] });
        return {
          ...base,
          det: sym.det !== undefined ? sym.det : base.det,
          rank: sym.rank !== undefined ? sym.rank : base.rank,
          eigenvalues: {
            kind: 'symbolic',
            values: sym.eigenvalues || [],
            diagonalizable: sym.diagonalizable === true,
            kernel: 'sympy/' + sym.version
          },
          symbolicLayer: { kernel: 'sympy', version: sym.version, pyodide: sym.pyodide }
        };
      } catch (e) {
        return { ...base, symbolicLayer: { kernel: 'sympy', error: e.message } };
      }
    },

    /** 精确乘积（RationalCore 同步层即可；SymPy 版供一致性对拍） */
    mul(a, b) {
      const A = RC.M.from(a), B = RC.M.from(b);
      return RC.M.toStrMatrix(RC.M.mul(A, B));
    },

    getStatus() {
      return {
        mode: state.unavailable ? 'rational-core' : (state.workerReady ? 'rational+sympy' : 'rational-core(sympy-loading)'),
        workerReady: state.workerReady,
        rationalCoreVersion: RC.VERSION
      };
    },

    _RationalCore: RC
  };
});
