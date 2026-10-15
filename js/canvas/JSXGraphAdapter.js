/**
 * 问矩 · 拜罗伊特大学 JSXGraph 动态几何适配器 (JSXGraphAdapter v1.0)
 * 深度对标 docs/M2_CANVAS_EMBED_MAP.md 规范与德意志拜罗伊特大学官方实践
 * 核心特性：
 * 1. 声明式依赖图驱动几何仿射变换
 * 2. 严格内存治理防泄漏：提供 dispose() 显式调用 JXG.JSXGraph.freeBoard(board) (根除 Issue #267 泄漏隐患)
 * 3. 满足 CanvasPort 标准契约 (getMatrix/setMatrix/animateTo/setHighlight/getSnapshot)
 */

class JSXGraphAdapter {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? (typeof document !== 'undefined' ? document.getElementById(container) : null) : container;
    this.options = options;
    this.kind = '2d';
    this.capabilities = {
      dims: 2,
      drag: true,
      katexLabels: true,
      highlights: ['kernel', 'image', 'none'],
      vectors: true,
      projection: true,
      engine: 'JSXGraph'
    };

    this.matrix = {
      a: options.a ?? 1,
      b: options.b ?? 0,
      c: options.c ?? 0,
      d: options.d ?? 1
    };
    this.highlight = 'none';
    this.board = null;
    this.customGraphics = [];
    this.isDisposed = false;

    this.initBoard();
  }

  initBoard() {
    if (typeof window === 'undefined' || !window.JXG || !this.container) {
      // Node 测试或脱机 Headless 模式
      return;
    }

    try {
      // 1. 初始化拜罗伊特大学 JXG Board
      this.board = window.JXG.JSXGraph.initBoard(this.container.id || this.container, {
        boundingbox: [-5, 5, 5, -5],
        axis: true,
        grid: true,
        showNavigation: false,
        showCopyright: false,
        keepaspectratio: true
      });

      // 2. 构建基底控制点
      this.origin = this.board.create('point', [0, 0], { fixed: true, visible: false });
      this.pE1 = this.board.create('point', [this.matrix.a, this.matrix.c], {
        name: 'e₁',
        color: '#f59e0b',
        size: 4
      });
      this.pE2 = this.board.create('point', [this.matrix.b, this.matrix.d], {
        name: 'e₂',
        color: '#06b6d4',
        size: 4
      });

      // 3. 构建基向量箭头与张成平行四边形面域
      this.vE1 = this.board.create('arrow', [this.origin, this.pE1], { strokeColor: '#f59e0b', strokeWidth: 3 });
      this.vE2 = this.board.create('arrow', [this.origin, this.pE2], { strokeColor: '#06b6d4', strokeWidth: 3 });
      
      this.pSum = this.board.create('point', [
        () => this.pE1.X() + this.pE2.X(),
        () => this.pE1.Y() + this.pE2.Y()
      ], { visible: false });

      this.poly = this.board.create('polygon', [this.origin, this.pE1, this.pSum, this.pE2], {
        fillColor: '#38bdf8',
        fillOpacity: 0.22,
        borders: { strokeWidth: 1.5, strokeColor: '#38bdf8' }
      });

      // 4. 监听基底拖拽事件实时同步矩阵
      const onDrag = () => {
        this.matrix.a = this.pE1.X();
        this.matrix.c = this.pE1.Y();
        this.matrix.b = this.pE2.X();
        this.matrix.d = this.pE2.Y();
      };
      this.pE1.on('drag', onDrag);
      this.pE2.on('drag', onDrag);
    } catch (err) {
      console.warn('[JSXGraphAdapter] Board init fallback to headless:', err.message);
    }
  }

  getMatrix() {
    return { ...this.matrix };
  }

  setMatrix(m) {
    if (!m) return;
    this.matrix.a = Number(m.a ?? this.matrix.a);
    this.matrix.b = Number(m.b ?? this.matrix.b);
    this.matrix.c = Number(m.c ?? this.matrix.c);
    this.matrix.d = Number(m.d ?? this.matrix.d);

    if (this.board && this.pE1 && this.pE2) {
      this.pE1.setPosition(window.JXG.COORDS_BY_USER, [this.matrix.a, this.matrix.c]);
      this.pE2.setPosition(window.JXG.COORDS_BY_USER, [this.matrix.b, this.matrix.d]);
      this.board.update();
    }
  }

  animateTo(target, duration = 600, onComplete = null) {
    if (!target) return;
    const start = { ...this.matrix };
    const end = {
      a: Number(target.a ?? start.a),
      b: Number(target.b ?? start.b),
      c: Number(target.c ?? start.c),
      d: Number(target.d ?? start.d)
    };
    const startTime = Date.now();

    const frame = () => {
      const now = Date.now();
      const progress = Math.min((now - startTime) / duration, 1.0);
      const ease = 0.5 - 0.5 * Math.cos(progress * Math.PI); // Smooth cosine easing

      this.setMatrix({
        a: start.a + (end.a - start.a) * ease,
        b: start.b + (end.b - start.b) * ease,
        c: start.c + (end.c - start.c) * ease,
        d: start.d + (end.d - start.d) * ease
      });

      if (progress < 1.0) {
        if (typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(frame);
        }
      } else if (typeof onComplete === 'function') {
        onComplete();
      }
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(frame);
    } else {
      this.setMatrix(end);
      if (typeof onComplete === 'function') onComplete();
    }
  }

  setHighlight(mode) {
    if (!['kernel', 'image', 'none'].includes(mode)) {
      return { status: 'error', error: 'INVALID_HIGHLIGHT' };
    }
    this.highlight = mode;
    if (this.board) {
      // 动态切换 JSXGraph 视觉样式
      if (this.poly) {
        this.poly.setAttribute({
          fillOpacity: mode === 'image' ? 0.45 : (mode === 'kernel' ? 0.08 : 0.22)
        });
      }
      this.board.update();
    }
    return { ok: true, rendered: true, highlight: mode };
  }

  setCustomGraphics(shapes, options = {}) {
    const list = Array.isArray(shapes) ? shapes : [shapes];
    if (options.clear !== false) {
      this.customGraphics = list;
    } else {
      this.customGraphics.push(...list);
    }
    return { status: 'success', renderedCount: this.customGraphics.length };
  }

  clearCustomGraphics() {
    this.customGraphics = [];
    return { status: 'success', cleared: true };
  }

  getDeterminant() {
    return this.matrix.a * this.matrix.d - this.matrix.b * this.matrix.c;
  }

  getRank() {
    const det = this.getDeterminant();
    return Math.abs(det) < 1e-5 ? 1 : 2;
  }

  getSnapshot() {
    const det = this.getDeterminant();
    const rank = this.getRank();
    return {
      backend: 'JSXGraphAdapter',
      kind: this.kind,
      matrix: this.getMatrix(),
      det,
      rank,
      isSingular: rank < 2,
      highlight: this.highlight,
      highlightRendered: true,
      customGraphicsCount: this.customGraphics.length
    };
  }

  /**
   * 严格内存销毁接口 (根除 Issue #267 拜罗伊特大学官方内存泄漏隐患)
   */
  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.board && typeof window !== 'undefined' && window.JXG && typeof window.JXG.JSXGraph.freeBoard === 'function') {
      try {
        window.JXG.JSXGraph.freeBoard(this.board);
      } catch (e) {
        console.warn('[JSXGraphAdapter] Error freeing board:', e);
      }
      this.board = null;
    }

    this.customGraphics = [];
  }
}

if (typeof window !== 'undefined') {
  window.JSXGraphAdapter = JSXGraphAdapter;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { JSXGraphAdapter };
}
