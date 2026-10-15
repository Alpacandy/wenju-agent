/**
 * 问矩 · 画板空间微遥测与环境感知总线 (SpatialTelemetryBus)
 * 职责：
 * 1. 毫秒级感知学生在画布上的几何操作与基向量形变
 * 2. 依托真实 LinearAlgebraMathEngine 进行严格拓扑态判定 (零 Mock)
 * 3. 实时发布 5 类核心空间拓扑突变事件：
 *    - SINGULAR_COLLAPSE (奇异降维)
 *    - ORIENTATION_FLIP (手性反转)
 *    - ORTHOGONAL_EIGEN (对称/正交态)
 *    - KERNEL_ABSORPTION (核吸收/零空间坍缩)
 *    - AREA_DILATION (等面积剪切/保容变换)
 * 4. 驱动右上角环境感知启发微气泡 (AmbientScaffoldBubble)
 */

let MathEngineClass = null;
if (typeof LinearAlgebraMathEngine !== 'undefined') {
  MathEngineClass = LinearAlgebraMathEngine;
} else if (typeof require !== 'undefined') {
  try {
    const mod = require('../linearAlgebraEngine.js');
    MathEngineClass = mod.LinearAlgebraMathEngine || mod;
  } catch (e) { if (typeof recordIssue === 'function') recordIssue('SpatialTelemetryBus', 'if', e); }
}

class SpatialTelemetryBus {
  /**
   * @param {object} options
   * @param {object} [options.visualizer] - 绑定的 Workspace2DVisualizer 实例
   * @param {number} [options.debounceMs=200] - 防抖等待时长 (毫秒)
   */
  constructor(options = {}) {
    this.visualizer = options.visualizer || null;
    this.debounceMs = typeof options.debounceMs === 'number' ? options.debounceMs : 200;
    this.subscribers = new Map(); // eventType -> Set<Function>
    
    // 拓扑状态快照
    this.lastState = null;
    this.lastNotifiedEvent = null;
    this.debounceTimer = null;
    this.eventHistory = [];
    this.originalVisualizerCallback = null;

    if (this.visualizer) {
      this.attach(this.visualizer);
    }
  }

  /**
   * 静态分析给定矩阵与探针向量的代数拓扑性质
   * @param {object} matrix - { a, b, c, d }
   * @param {object} [probeVector] - { x, y }
   * @returns {object}
   */
  static analyzeTopology(matrix, probeVector = null) {
    if (!matrix) return null;
    const a = Number(matrix.a) || 0;
    const b = Number(matrix.b) || 0;
    const c = Number(matrix.c) || 0;
    const d = Number(matrix.d) || 0;

    let mathData = null;
    if (MathEngineClass && typeof MathEngineClass.analyzeMatrix2x2 === 'function') {
      mathData = MathEngineClass.analyzeMatrix2x2(a, b, c, d);
    } else {
      // 纯净本地解析兜底 (严格公式)
      const det = a * d - b * c;
      const rank = Math.abs(det) < 0.05 ? (Math.hypot(a, b, c, d) < 0.01 ? 0 : 1) : 2;
      mathData = {
        matrix: { a, b, c, d },
        det,
        rank,
        isSingular: rank < 2
      };
    }

    const det = mathData.det;
    const absDet = Math.abs(det);
    const rank = mathData.rank;
    const isSingular = rank < 2;

    // 手性反转 (定向翻转)
    const isOrientationFlipped = det < -0.05;

    // 对称矩阵检测 (|b - c| < 0.05 且非对角元显著存在)
    const isSymmetric = Math.abs(b - c) < 0.05 && (Math.abs(b) > 0.1 || Math.abs(c) > 0.1);

    // 正交矩阵检测 (Aᵀ A ≈ I)
    const col1NormSq = a * a + c * c;
    const col2NormSq = b * b + d * d;
    const dotCols = a * b + c * d;
    const isOrthogonal = Math.abs(col1NormSq - 1) < 0.08 && 
                         Math.abs(col2NormSq - 1) < 0.08 && 
                         Math.abs(dotCols) < 0.08;

    // 等面积纯剪切检测 (det ≈ 1.0, 且主对角线接近 1, 非对角线存在显著剪切)
    const isShear = Math.abs(det - 1.0) < 0.06 && 
                    Math.abs(a - 1.0) < 0.08 && 
                    Math.abs(d - 1.0) < 0.08 && 
                    (Math.abs(b) >= 0.4 || Math.abs(c) >= 0.4);

    // 探针向量是否被原点吸收 (Ax ≈ 0 且 ||x|| > 0.1)
    let isKernelAbsorbed = false;
    let probeImageNorm = null;
    if (probeVector && typeof probeVector.x === 'number' && typeof probeVector.y === 'number') {
      const px = probeVector.x;
      const py = probeVector.y;
      const probeNorm = Math.hypot(px, py);
      if (probeNorm > 0.15) {
        const imgX = a * px + b * py;
        const imgY = c * px + d * py;
        probeImageNorm = Math.hypot(imgX, imgY);
        if (probeImageNorm < 0.08 && isSingular) {
          isKernelAbsorbed = true;
        }
      }
    }

    return {
      matrix: { a, b, c, d },
      det,
      absDet,
      rank,
      isSingular,
      isOrientationFlipped,
      isSymmetric,
      isOrthogonal,
      isShear,
      isKernelAbsorbed,
      probeImageNorm,
      rawMath: mathData
    };
  }

  /**
   * 订阅空间拓扑事件
   * @param {string} eventType - 'SINGULAR_COLLAPSE' | 'ORIENTATION_FLIP' | 'ORTHOGONAL_EIGEN' | 'KERNEL_ABSORPTION' | 'AREA_DILATION' | '*'
   * @param {Function} callback
   * @returns {Function} 取消订阅函数
   */
  subscribe(eventType, callback) {
    if (typeof callback !== 'function') return () => {};
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType).add(callback);

    return () => {
      const set = this.subscribers.get(eventType);
      if (set) {
        set.delete(callback);
      }
    };
  }

  /**
   * 派发事件通知
   * @param {string} eventType
   * @param {object} payload
   */
  emit(eventType, payload) {
    payload.timestamp = Date.now();
    this.eventHistory.push({ type: eventType, payload, at: payload.timestamp });
    if (this.eventHistory.length > 50) {
      this.eventHistory.shift();
    }

    const typeSet = this.subscribers.get(eventType);
    if (typeSet) {
      for (const cb of typeSet) {
        try {
          cb(payload);
        } catch (e) {
          console.error(`[SpatialTelemetryBus] Error in subscriber for ${eventType}:`, e);
        }
      }
    }

    const allSet = this.subscribers.get('*');
    if (allSet) {
      for (const cb of allSet) {
        try {
          cb({ type: eventType, ...payload });
        } catch (e) {
          console.error(`[SpatialTelemetryBus] Error in wildcard subscriber:`, e);
        }
      }
    }
  }

  /**
   * 挂载至 Workspace2DVisualizer
   * @param {object} visualizer
   */
  attach(visualizer) {
    if (!visualizer) return;
    this.visualizer = visualizer;
    this.originalVisualizerCallback = visualizer.onMatrixChange;

    visualizer.onMatrixChange = (state) => {
      // 触发原有回调
      if (typeof this.originalVisualizerCallback === 'function') {
        try {
          this.originalVisualizerCallback(state);
        } catch (e) {
          console.error('[SpatialTelemetryBus] Original onMatrixChange error:', e);
        }
      }

      // 送入遥测总线管道
      const probe = visualizer.probeVector || null;
      this.feedMatrix(state.matrix, probe);
    };

    // 初始状态采样
    if (visualizer.getMatrix) {
      this.lastState = SpatialTelemetryBus.analyzeTopology(
        visualizer.getMatrix(),
        visualizer.probeVector || null
      );
    }
  }

  /**
   * 卸载
   */
  detach() {
    if (this.visualizer) {
      this.visualizer.onMatrixChange = this.originalVisualizerCallback;
      this.visualizer = null;
      this.originalVisualizerCallback = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * 注入矩阵更新流
   * @param {object} matrix
   * @param {object} [probeVector]
   * @param {boolean} [immediate=false] - 是否绕过防抖立即执行 (供测试用)
   */
  feedMatrix(matrix, probeVector = null, immediate = false) {
    if (!matrix) return;

    const executeAnalysis = () => {
      const currentState = SpatialTelemetryBus.analyzeTopology(matrix, probeVector);
      if (!currentState) return;

      const events = this._detectTopologicalTransitions(currentState, this.lastState);
      this.lastState = currentState;

      for (const ev of events) {
        this.emit(ev.type, ev);
      }
    };

    if (immediate || this.debounceMs <= 0) {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
      }
      executeAnalysis();
    } else {
      if (this.debounceTimer) {
        clearTimeout(this.debounceTimer);
      }
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        executeAnalysis();
      }, this.debounceMs);
    }
  }

  /**
   * 内部核心：比较当前拓扑态与前一拓扑态，发现相变事件
   * @private
   */
  _detectTopologicalTransitions(curr, prev) {
    const transitions = [];
    if (!curr) return transitions;

    const prevDet = prev ? prev.det : 1.0;
    const prevRank = prev ? prev.rank : 2;
    const prevFlipped = prev ? prev.isOrientationFlipped : false;
    const prevAbsorbed = prev ? prev.isKernelAbsorbed : false;
    const prevShear = prev ? prev.isShear : false;
    const prevOrthogonal = prev ? prev.isOrthogonal : false;

    // 1. 奇异降维坍缩 (Singular Collapse)
    if (curr.isSingular && prevRank === 2) {
      transitions.push({
        type: 'SINGULAR_COLLAPSE',
        title: '空间降维坍缩',
        tag: '奇异降维',
        icon: '💥',
        color: '#ec4899',
        description: `变换矩阵发生奇异降维 (det ≈ ${curr.det.toFixed(2)}, rank = ${curr.rank})，全平面被压缩为一条直线！`,
        suggestedQuery: '我刚才在画板上把基向量压缩成了奇异矩阵 (det ≈ 0)，请从零空间和降维的角度，引导我思考哪些向量被映射到了原点？',
        matrix: curr.matrix,
        det: curr.det,
        rank: curr.rank
      });
    }

    // 2. 手性反转 (Orientation Flip)
    if (curr.isOrientationFlipped && !prevFlipped) {
      transitions.push({
        type: 'ORIENTATION_FLIP',
        title: '基底手性与定向反转',
        tag: '空间镜像',
        icon: '🪞',
        color: '#f59e0b',
        description: `行列式变为负数 (det = ${curr.det.toFixed(2)})，平面定向发生翻转，基底手性由右手系变为了左手系。`,
        suggestedQuery: '画板上的基底行列式变成了负数，空间定向发生了翻转。请引导我理解负行列式在几何上的手性反转与代数含义。',
        matrix: curr.matrix,
        det: curr.det,
        rank: curr.rank
      });
    }

    // 3. 探针向量落入零空间 (Kernel Absorption)
    if (curr.isKernelAbsorbed && !prevAbsorbed) {
      transitions.push({
        type: 'KERNEL_ABSORPTION',
        title: '探针向量被核空间吸收',
        tag: '核映射',
        icon: '🕳️',
        color: '#8b5cf6',
        description: '非零探针向量落入零空间 Null(A)，其像向量 A·x 被严格压缩至原点！',
        suggestedQuery: '我拖动探针向量发现它的像被压缩到了原点 (Ax = 0)，请解释为什么非零向量会消失在核空间中？',
        matrix: curr.matrix,
        det: curr.det,
        rank: curr.rank
      });
    }

    // 4. 等面积剪切变换 (Area Dilation / Shear)
    if (curr.isShear && !prevShear) {
      transitions.push({
        type: 'AREA_DILATION',
        title: '等面积剪切变换 (Shear)',
        tag: '保容剪切',
        icon: '📐',
        color: '#06b6d4',
        description: `网格发生连续倾斜剪切，但有向面积严格守恒 (det = ${curr.det.toFixed(2)})！`,
        suggestedQuery: '我观察到剪切变换下网格发生了倾斜，但行列式仍然等于 1。请引导我分析剪切变换为何能保持面积不变？',
        matrix: curr.matrix,
        det: curr.det,
        rank: curr.rank
      });
    }

    // 5. 对称与正交几何态 (Orthogonal / Symmetric Eigenstate)
    if (curr.isOrthogonal && !prevOrthogonal) {
      transitions.push({
        type: 'ORTHOGONAL_EIGEN',
        title: '正交等距变换态 (Isometry)',
        tag: '正交保距',
        icon: '🛡️',
        color: '#10b981',
        description: '基向量相互正交且保单位模长 (Aᵀ A = I)，空间进行刚体保角保距运动。',
        suggestedQuery: '我把基底调成了正交变换态 (AᵀA = I)，请引导我探究这种变换在保内积和正交性上的几何意义。',
        matrix: curr.matrix,
        det: curr.det,
        rank: curr.rank
      });
    }

    return transitions;
  }

  /**
   * 获取最近捕获的遥测事件历史
   * @param {number} [limit=10]
   * @returns {Array}
   */
  getRecentEvents(limit = 10) {
    return this.eventHistory.slice(-limit);
  }
}

if (typeof window !== 'undefined') {
  window.SpatialTelemetryBus = SpatialTelemetryBus;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpatialTelemetryBus };
}
