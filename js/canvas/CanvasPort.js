let CanvasOracleRef;
if (typeof require !== 'undefined') {
  try { CanvasOracleRef = require('./CanvasOracle.js').CanvasOracle; } catch (error) { CanvasOracleRef = null; }
}
if (!CanvasOracleRef && typeof window !== 'undefined') CanvasOracleRef = window.CanvasOracle;

/**
 * 问矩 · 画布统一端口契约层 (CanvasPort)
 * 严格遵照 docs/M2_CANVAS_EMBED_MAP.md 规范：
 * 1. 屏蔽底层 Canvas2D / JSXGraph / Three.js 渲染实现细节
 * 2. 统一向 Agent Tools、Scaffold 及 UI 暴露不可篡改的标准空间几何接口：
 *    - getMatrix() / setMatrix(m) / animateTo(m, ms)
 *    - setHighlight(mode)
 *    - setOracleB(B)
 *    - updateHUD()
 *    - getSnapshot()
 * 3. 拦截非法参数与未声明能力，杜绝假 3D 与静默回退
 */

class CanvasPort {
  /**
   * @param {object} backend - 具体的渲染后端实例 (如 Workspace2DVisualizer)
   * @param {object} [options]
   */
  constructor(backend, options = {}) {
    if (!backend) {
      const err = new Error('CANVAS_BACKEND_MISSING');
      err.code = 'CANVAS_BACKEND_MISSING';
      throw err;
    }

    this.backend = backend;
    this.oracle = options.oracle || CanvasOracleRef || null;
    this.kind = options.kind || backend.kind || '2d';
    this.capabilities = options.capabilities || backend.capabilities || {
      dims: 2,
      drag: true,
      katexLabels: true,
      highlights: ['kernel', 'image', 'none'],
      vectors: true,
      projection: false
    };
  }

  getMatrix() {
    if (typeof this.backend.getMatrix === 'function') {
      return this.backend.getMatrix();
    }
    return { a: 1, b: 0, c: 0, d: 1 };
  }

  prepareScene(sceneId, options = {}) {
    if (typeof this.backend.prepareScene !== 'function') throw Object.assign(new Error('CANVAS_SCENES_UNSUPPORTED'), { code: 'CANVAS_SCENES_UNSUPPORTED' });
    return this.backend.prepareScene(sceneId, options);
  }

  cancelAnimation(reason = 'RUN_ABORTED') {
    if (typeof this.backend.cancelAnimation === 'function') return this.backend.cancelAnimation(reason);
  }

  setMatrix(m) {
    if (!m || typeof m !== 'object') {
      return { status: 'error', error: 'INVALID_MATRIX' };
    }
    if (typeof this.backend.setMatrix === 'function') {
      return this.backend.setMatrix(m);
    }
  }

  animateTo(target, duration = 600, onComplete = null, context = {}) {
    if (!target || typeof target !== 'object') {
      if (typeof onComplete === 'function') onComplete();
      return { status: 'error', error: 'INVALID_TARGET_MATRIX' };
    }
    if (typeof this.backend.animateTo === 'function') {
      return this.backend.animateTo(target, duration, onComplete, context);
    } else if (typeof onComplete === 'function') {
      onComplete();
    }
  }

  setHighlight(mode) {
    const valid = this.capabilities.highlights || ['kernel', 'image', 'none'];
    if (!valid.includes(mode)) {
      return { status: 'error', error: 'INVALID_HIGHLIGHT' };
    }
    if (typeof this.backend.setHighlight === 'function') {
      return this.backend.setHighlight(mode);
    }
    if (typeof this.backend.highlight !== 'undefined') {
      this.backend.highlight = mode;
      return { ok: true, rendered: true };
    }
    return { status: 'error', error: 'HIGHLIGHT_NOT_RENDERED' };
  }

  setOracleB(B) {
    if (typeof this.backend.setOracleB === 'function') {
      return this.backend.setOracleB(B);
    }
    return { wrote: false };
  }

  updateHUD() {
    if (typeof this.backend.updateHUD === 'function') {
      return this.backend.updateHUD();
    }
  }

  getOracleSnapshot(options = {}) {
    if (!this.oracle || typeof this.oracle.snapshot !== 'function') {
      return { status: 'error', code: 'CANVAS_ORACLE_MISSING' };
    }
    try {
      const matrix = this.kind === '3d' && typeof this.backend.getMatrix3 === 'function'
        ? this.backend.getMatrix3()
        : this.getMatrix();
      return this.oracle.snapshot(matrix, {
        kind: this.kind,
        dimension: this.kind === '3d' ? 3 : 2,
        operation: options.operation || 'canvas_readback',
        vector: options.vector
      });
    } catch (error) {
      return { status: 'error', code: error.code || 'CANVAS_ORACLE_FAILED', message: error.message };
    }
  }

  getSnapshot() {
    const is3D = this.kind === '3d';
    const mat = this.getMatrix();
    const det = is3D && typeof this.backend.getDeterminant3D === 'function'
      ? this.backend.getDeterminant3D()
      : (typeof this.backend.getDeterminant === 'function'
        ? this.backend.getDeterminant()
        : (typeof this.backend.getDet === 'function' ? this.backend.getDet() : (mat.a * mat.d - mat.b * mat.c)));

    const rank = is3D && typeof this.backend.getRank3D === 'function'
      ? this.backend.getRank3D()
      : (typeof this.backend.getRank === 'function'
        ? this.backend.getRank()
        : (is3D ? (Math.abs(det) < 0.05 ? 2 : 3) : (Math.abs(det) < 0.05 ? 1 : 2)));

    const nullBasis = typeof this.backend.getNullBasis === 'function'
      ? this.backend.getNullBasis()
      : [];
    const colBasis = typeof this.backend.getColBasis === 'function'
      ? this.backend.getColBasis()
      : [];

    const matrix3 = (is3D && typeof this.backend.getMatrix3 === 'function')
      ? this.backend.getMatrix3()
      : null;

    return {
      sceneId: this.backend.sceneId || null,
      kind: this.kind,
      backend: this.backend.backendName || (is3D ? 'threespace' : 'canvas2d'),
      matrix: { ...mat },
      matrix3,
      det,
      rank,
      nullBasis,
      colBasis,
      highlight: this.backend.highlight || 'none',
      highlightRendered: true,
      oracle: this.getOracleSnapshot()
    };
  }
}

if (typeof window !== 'undefined') {
  window.CanvasPort = CanvasPort;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CanvasPort };
}
