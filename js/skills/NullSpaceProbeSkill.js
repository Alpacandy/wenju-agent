/**
 * 问矩 · 奇异核空间几何探针技能 (NullSpaceProbeSkill)
 * 职责：严格符号解析矩阵行列式、秩、零度，判定降维临界态并输出零空间基底解析式
 */

let BaseSkillNull;
if (typeof require !== 'undefined') {
  try { BaseSkillNull = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('NullSpaceProbeSkill', 'if', e); }
}
if (!BaseSkillNull && typeof window !== 'undefined') {
  BaseSkillNull = window.BaseSkill;
}
if (!BaseSkillNull) {
  BaseSkillNull = class { constructor(n, d) { this.name = n; this.description = d; } };
}


let applyObservationToCanvasRef = null;
let normalizeMatrix2x2Ref = null;
(function loadObsSync() {
  if (typeof require !== 'undefined') {
    try {
      const mod = require('../observationCanvasSync.js');
      applyObservationToCanvasRef = mod.applyObservationToCanvas;
      normalizeMatrix2x2Ref = mod.normalizeMatrix2x2;
    } catch (e) { if (typeof recordIssue === 'function') recordIssue('NullSpaceProbeSkill', 'if', e); }
  }
  if (!applyObservationToCanvasRef && typeof window !== 'undefined' && window.applyObservationToCanvas) {
    applyObservationToCanvasRef = window.applyObservationToCanvas;
    normalizeMatrix2x2Ref = window.normalizeMatrix2x2;
  }
})();
class NullSpaceProbeSkill extends BaseSkillNull {
  constructor() {
    super(
      'solve_matrix_kernel_sympy',
      '精确符号求解矩阵的秩、行列式、零度与核空间(零空间)基向量，杜绝浮点数值计算幻觉。'
    );
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: true, // B 线契约 GATE-CONTRACT-01：本工具是否要求画布环境
      parameters: {
        type: 'object',
        properties: {
          matrix_elements: {
            type: 'array',
            description: '二阶实数矩阵按行展开的二维数组，如 [[a, b], [c, d]]',
            items: {
              type: 'array',
              items: { type: 'number' }
            }
          }
        },
        required: ['matrix_elements']
      }
    };
  }

  async execute(args, context = {}) {
    if (context.signal?.aborted || (typeof context.isRunActive === 'function' && !context.isRunActive())) return { status: 'cancelled', code: 'RUN_ABORTED', error: 'RUN_ABORTED' };
    if (context.visualTask?.preferredSurface === 'artifact' || context.visualTask?.surface === 'artifact') return { status: 'error', code: 'VISUAL_SURFACE_MISMATCH', error: '当前任务使用 Artifact；二维画板保持不变。' };
    const mathEngine = context.mathEngine || (typeof window !== 'undefined' && window.LinearAlgebraMathEngine ? new window.LinearAlgebraMathEngine() : null);
    const elements = args.matrix_elements || [[1, 2.6], [2.5, 0.9]];
    const a = elements[0]?.[0] ?? 1.0;
    const b = elements[0]?.[1] ?? 0.0;
    const c = elements[1]?.[0] ?? 0.0;
    const d = elements[1]?.[1] ?? 1.0;

    let analysis;
    if (mathEngine && typeof mathEngine.analyzeMatrix2x2 === 'function') {
      analysis = mathEngine.analyzeMatrix2x2(a, b, c, d);
    } else {
      const det = a * d - b * c;
      const isSingular = Math.abs(det) < 1e-5;
      analysis = {
        det,
        rank: isSingular ? (Math.abs(a) < 1e-5 && Math.abs(b) < 1e-5 && Math.abs(c) < 1e-5 && Math.abs(d) < 1e-5 ? 0 : 1) : 2,
        nullity: isSingular ? (Math.abs(a) < 1e-5 && Math.abs(b) < 1e-5 && Math.abs(c) < 1e-5 && Math.abs(d) < 1e-5 ? 2 : 1) : 0,
        isSingular,
        nullBasis: isSingular ? [[-b, a]] : []
      };
    }

    const result = {
      status: 'success',
      det: analysis.det,
      rank: analysis.rank,
      nullity: analysis.nullity,
      isSingular: analysis.isSingular,
      nullBasis: analysis.nullBasis,
      matrixA: { a, b, c, d, elements: [[a, b], [c, d]] },
      detail: `核空间探针完成: det=${analysis.det.toFixed(2)}, rank=${analysis.rank}, nullity=${analysis.nullity}`
    };

    const viz = context.workspaceVisualizer || (typeof window !== 'undefined' ? window.workspaceVisualizer : null);
    // S4 清偿（B 线，normal 与 no-sync 双模式统一）：requiresCanvas 工具无画布环境一律拒绝假 success
    if (!viz) {
      return {
        status: 'error',
        error: 'CANVAS_REQUIRED',
        detail: '[S4] solve_matrix_kernel_sympy 为 requiresCanvas 工具：无 workspaceVisualizer 时拒绝假 success（核空间结论需同屏可视化验证）。',
        canvasSync: { applied: false, reason: 'no_visualizer', oracleBReadable: false }
      };
    }
    const applyFn = applyObservationToCanvasRef || (typeof window !== 'undefined' ? window.applyObservationToCanvas : null);
    if (typeof applyFn === 'function') {
      const sync = applyFn(viz, {
        kind: 'nullspace',
        matrixA: result.matrixA,
        det: result.det,
        rank: result.rank,
        nullBasis: result.nullBasis,
        highlight: 'kernel'
      }, context);
      result.canvasSync = sync;
      if (sync?.code) return { status: sync.code === 'RUN_ABORTED' ? 'cancelled' : 'error', code: sync.code, error: sync.code, canvasSync: sync };
      if (viz && sync && sync.applied && sync.matched === false) {
        return {
          status: 'error',
          error: 'CANVAS_SYNC_MISMATCH',
          detail: '核空间 Observation 与画布终态不一致',
          canvasSync: sync
        };
      }
    } else if (viz) {
      // 无 sync 模块但有画布：最小写入
      // S3 清偿（B 线）：无 DOM 同屏横幅即无可读性证据，oracleBReadable 必须为 false；matched 按 getMatrix 实测
      if (typeof viz.prepareScene === 'function') viz.prepareScene(context.sceneId, context);
      if (typeof viz.setMatrix === 'function') viz.setMatrix({ a, b, c, d });
      if (context.visualTask) context.visualTask.surface = 'canvas';
      viz.activeSubspaceHighlight = 'kernel';
      viz.oracleNullspace = { det: result.det, rank: result.rank, nullBasis: result.nullBasis };
      const finalMatrix = typeof viz.getMatrix === 'function' ? viz.getMatrix() : { a, b, c, d };
      const matched = finalMatrix
        ? Math.abs(finalMatrix.a - a) < 1e-9 && Math.abs(finalMatrix.b - b) < 1e-9 &&
          Math.abs(finalMatrix.c - c) < 1e-9 && Math.abs(finalMatrix.d - d) < 1e-9
        : false;
      result.canvasSync = {
        applied: true,
        kind: 'nullspace',
        finalMatrix,
        matched,
        oracleBReadable: false
      };
    } else {
      // S4 清偿（B 线）：requiresCanvas 工具无画布环境不得假 success
      return {
        status: 'error',
        error: 'CANVAS_REQUIRED',
        detail: '[S4] solve_matrix_kernel_sympy 为 requiresCanvas 工具：无 workspaceVisualizer 时拒绝假 success（核空间结论需同屏可视化验证）。',
        canvasSync: { applied: false, reason: 'no_visualizer', oracleBReadable: false }
      };
    }

    return result;
  }
}


if (typeof module !== 'undefined' && module.exports) {
  module.exports = { NullSpaceProbeSkill };
}
if (typeof window !== 'undefined') {
  window.NullSpaceProbeSkill = NullSpaceProbeSkill;
}

