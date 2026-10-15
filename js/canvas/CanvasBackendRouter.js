/**
 * CanvasBackendRouter —— 画布后端切换器（P4 T4.4 · W6 裁决：接线）
 *
 * 裁决：JSXGraphAdapter 接入 CanvasPort 契约，作为几何检查视图（与主 Canvas2D 并行驱动）。
 * 理由：1) 适配器已实现完整 CanvasPort 契约（含 dispose 防泄漏）；2) 拜罗伊特大学双许可无碍；
 *       3) 双后端一致性对拍（同矩阵 → det/rank/基向量像逐值一致）是 W6 核心断言。
 * 移除方案不再需要（接线后"加载零调用"状态消除）。
 *
 * 使用：Agent 工具或学生 UI 切换 'canvas2d' | 'jsxgraph' 模式，双轨下矩阵变更同步驱动两后端。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.CanvasBackendRouter = api.CanvasBackendRouter; window.canvasBackendRouter = api.getSharedRouter(); }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  class CanvasBackendRouter {
    /**
     * @param {object} primaryViz - 主 Canvas2D 视觉器（可为 null，运行时动态取 window.workspaceVisualizer）
     * @param {string} jsxContainerId - JSXGraph 挂载容器 id
     */
    constructor(primaryViz, jsxContainerId, threeContainerId) {
      this._primaryViz = primaryViz || null; // 可能懒初始化前为 null
      this.mode = 'canvas2d';
      this.jsxAdapter = null;
      this.jsxPort = null;
      this.primaryPort = null;
      this.threeAdapter = null;
      this.jsxContainerId = jsxContainerId || 'jsxgraph-viewport';
      this.threeContainerId = threeContainerId || 'threejs-viewport';
    }

    /** 动态获取主视觉器（懒初始化安全） */
    get primaryViz() {
      return this._primaryViz || (typeof window !== 'undefined' ? window.workspaceVisualizer : null) || null;
    }

    set primaryViz(v) { this._primaryViz = v; }

    /** 切换到 jsxgraph 模式（创建 board 并同步当前矩阵） */
    enableJsxGraph() {
      if (this.mode === 'jsxgraph') return { ok: true, already: true };
      if (typeof window === 'undefined' || !window.JSXGraphAdapter) {
        return { ok: false, code: 'JSXGRAPH_ADAPTER_MISSING', message: 'JSXGraphAdapter 未加载' };
      }
      const container = document.getElementById(this.jsxContainerId);
      if (!container) return { ok: false, code: 'CONTAINER_MISSING', message: '容器 #' + this.jsxContainerId + ' 不存在' };

      const viz = this.primaryViz;
      const m = viz && typeof viz.getMatrix === 'function' ? viz.getMatrix() : { a: 1, b: 0, c: 0, d: 1 };
      this.jsxAdapter = new window.JSXGraphAdapter(container, { a: m.a, b: m.b, c: m.c, d: m.d });
      container.style.display = '';
      this.mode = 'jsxgraph';
      return { ok: true, mode: this.mode };
    }

    /** 切回 canvas2d（释放 JSXGraph board） */
    disableJsxGraph() {
      if (this.mode === 'canvas2d') return { ok: true, already: true };
      if (this.jsxAdapter && typeof this.jsxAdapter.dispose === 'function') {
        this.jsxAdapter.dispose(); // 根除 Issue #267 内存泄漏
      }
      this.jsxAdapter = null;
      this.jsxPort = null;
      const container = document.getElementById(this.jsxContainerId);
      if (container) container.style.display = 'none';
      this.mode = 'canvas2d';
      return { ok: true };
    }

    /** 切换到 threespace 模式（创建 Three.js 场景并同步当前 3x3 矩阵） */
    enableThreeSpace() {
      if (this.mode === 'threespace') return { ok: true, already: true };
      const ThreeAdapter = (typeof window !== 'undefined' && window.ThreeSpaceAdapter) ||
                           (typeof global !== 'undefined' && global.ThreeSpaceAdapter);
      if (!ThreeAdapter) {
        return { ok: false, code: 'THREE_SPACE_ADAPTER_MISSING', message: 'ThreeSpaceAdapter 未加载' };
      }
      const container = (typeof document !== 'undefined') ? document.getElementById(this.threeContainerId) : null;
      if (!container && typeof window !== 'undefined') {
        return { ok: false, code: 'CONTAINER_MISSING', message: '容器 #' + this.threeContainerId + ' 不存在' };
      }

      const viz = this.primaryViz;
      const m = viz && typeof viz.getMatrix === 'function' ? viz.getMatrix() : { a: 1, b: 0, c: 0, d: 1 };
      const matrix3 = {
        m00: m.a, m01: m.b, m02: 0,
        m10: m.c, m11: m.d, m12: 0,
        m20: 0,   m21: 0,   m22: 1
      };

      this.threeAdapter = new ThreeAdapter(container, { matrix3 });
      if (container) container.style.display = '';
      this.mode = 'threespace';
      return { ok: true, mode: this.mode };
    }

    /** 切回 canvas2d（释放 WebGL 场景与显存） */
    disableThreeSpace() {
      if (this.mode !== 'threespace') return { ok: true, already: true };
      if (this.threeAdapter && typeof this.threeAdapter.dispose === 'function') {
        this.threeAdapter.dispose(); // 严格释放 Geometry、Material、Renderer
      }
      this.threeAdapter = null;
      const container = (typeof document !== 'undefined') ? document.getElementById(this.threeContainerId) : null;
      if (container) container.style.display = 'none';
      this.mode = 'canvas2d';
      return { ok: true };
    }

    /** 驱动变换（多后端同步） */
    setMatrix(m) {
      if (this.primaryViz && typeof this.primaryViz.setMatrix === 'function') this.primaryViz.setMatrix(m);
      if (this.mode === 'jsxgraph' && this.jsxAdapter) this.jsxAdapter.setMatrix(m);
      if (this.mode === 'threespace' && this.threeAdapter && typeof this.threeAdapter.setMatrix === 'function') {
        this.threeAdapter.setMatrix(m);
      }
    }

    animateTo(target, duration = 600, onComplete) {
      if (this.primaryViz && typeof this.primaryViz.animateTo === 'function') {
        this.primaryViz.animateTo(target, duration, onComplete);
      } else if (onComplete) onComplete();
      if (this.mode === 'jsxgraph' && this.jsxAdapter) {
        this.jsxAdapter.animateTo(target, duration);
      }
      if (this.mode === 'threespace' && this.threeAdapter && typeof this.threeAdapter.animateTo === 'function') {
        this.threeAdapter.animateTo(target, duration);
      }
    }

    getMatrix() {
      return this.primaryViz ? this.primaryViz.getMatrix() : { a: 1, b: 0, c: 0, d: 1 };
    }

    getOracleSnapshot(options = {}) {
      const port = (this.mode === 'threespace' && this.threeAdapter) ? this.threeAdapter :
                   (this.mode === 'jsxgraph' && this.jsxAdapter) ? this.jsxAdapter : this.primaryViz;
      if (!port) return { status: 'error', code: 'CANVAS_BACKEND_MISSING' };
      if (typeof port.getOracleSnapshot === 'function') return port.getOracleSnapshot(options);
      if (typeof window !== 'undefined' && window.CanvasOracle) return window.CanvasOracle.snapshot(this.getMatrix(), { kind: '2d', ...options });
      return { status: 'error', code: 'CANVAS_ORACLE_MISSING' };
    }

    /** W6 核心：双后端一致性对拍（同矩阵下 det/rank 逐值一致） */
    consistencyCheck() {
      if (this.mode !== 'jsxgraph' || !this.jsxAdapter || !this.primaryViz) {
        return { ok: false, code: 'NOT_IN_JSX_MODE', message: '须在 jsxgraph 模式下检查' };
      }
      const m1 = this.primaryViz.getMatrix();
      const m2 = this.jsxAdapter.getMatrix();
      const det1 = m1.a * m1.d - m1.b * m1.c;
      const det2 = m2.a * m2.d - m2.b * m2.c;
      const rank1 = Math.abs(det1) < 1e-5 ? (Math.hypot(m1.a, m1.b, m1.c, m1.d) < 1e-5 ? 0 : 1) : 2;
      const rank2 = Math.abs(det2) < 1e-5 ? (Math.hypot(m2.a, m2.b, m2.c, m2.d) < 1e-5 ? 0 : 1) : 2;
      const eps = 1e-9;
      const matrixMatch = Math.abs(m1.a - m2.a) < eps && Math.abs(m1.b - m2.b) < eps && Math.abs(m1.c - m2.c) < eps && Math.abs(m1.d - m2.d) < eps;
      const detMatch = Math.abs(det1 - det2) < 1e-6;
      const rankMatch = rank1 === rank2;
      return {
        ok: matrixMatch && detMatch && rankMatch,
        detail: { matrixMatch, detMatch, rankMatch, det1, det2, rank1, rank2, m1, m2 }
      };
    }

    getStatus() { return { mode: this.mode, hasBoard: !!(this.jsxAdapter && this.jsxAdapter.board) }; }
  }

  let shared = null;
  function getSharedRouter() {
    if (shared) return shared;
    if (typeof window === 'undefined') return null;
    shared = new CanvasBackendRouter(window.workspaceVisualizer, 'jsxgraph-viewport');
    return shared;
  }

  return { CanvasBackendRouter, getSharedRouter };
});
