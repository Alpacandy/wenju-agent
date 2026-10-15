/**
 * 问矩 · 概念反例构造技能 (CounterexampleSkill)
 * 职责：
 * 遵循 MCP 规范强类型契约，针对经典代数误解
 * （如零乘反例、非对易李括号、行列式加法非线性、逆矩阵穿脱袜顺序、西尔维斯特秩不等式）
 * 严格基于数学计算引擎构造反例矩阵并生成可验证的 LaTeX 证明。
 */

let BaseSkillCounter;
if (typeof require !== 'undefined') {
  try { BaseSkillCounter = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('CounterexampleSkill', 'if', e); }
}
if (!BaseSkillCounter && typeof window !== 'undefined') {
  BaseSkillCounter = window.BaseSkill;
}
if (!BaseSkillCounter) {
  BaseSkillCounter = class { constructor(n, d) { this.name = n; this.description = d; } };
}

let LinearAlgebraMathEngineClass;
if (typeof require !== 'undefined') {
  try { LinearAlgebraMathEngineClass = require('../linearAlgebraEngine.js').LinearAlgebraMathEngine; } catch (e) { if (typeof recordIssue === 'function') recordIssue('CounterexampleSkill', 'if', e); }
}
if (!LinearAlgebraMathEngineClass && typeof window !== 'undefined') {
  LinearAlgebraMathEngineClass = window.LinearAlgebraMathEngine;
}


let applyObservationToCanvasRefCE = null;
(function loadObsSyncCE() {
  if (typeof require !== 'undefined') {
    try {
      applyObservationToCanvasRefCE = require('../observationCanvasSync.js').applyObservationToCanvas;
    } catch (e) { if (typeof recordIssue === 'function') recordIssue('CounterexampleSkill', 'if', e); }
  }
  if (!applyObservationToCanvasRefCE && typeof window !== 'undefined' && window.applyObservationToCanvas) {
    applyObservationToCanvasRefCE = window.applyObservationToCanvas;
  }
})();
class CounterexampleSkill extends BaseSkillCounter {
  constructor() {
    super(
      'construct_counterexample_matrix',
      '针对经典概念误解（如零因子误解、交换律误解、行列式线性误解、逆矩阵顺序、秩乘积），构造严格满足数学断言的反例矩阵并给出代数证明。'
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
          target_property: {
            type: 'string',
            enum: ['AB_ZERO', 'NON_COMMUTATIVE', 'DET_ADDITION_NONLINEAR', 'INVERSE_ORDER', 'RANK_INEQUALITY'],
            description: '反例构造目标性质：AB_ZERO(零乘反例), NON_COMMUTATIVE(非对易李括号), DET_ADDITION_NONLINEAR(行列式非加性), INVERSE_ORDER(逆矩阵穿脱袜顺序), RANK_INEQUALITY(西尔维斯特秩不等式)'
          },
          matrix_elements: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2
            },
            minItems: 2,
            maxItems: 2,
            description: '二阶方阵 A 的数值分量 [[a, b], [c, d]]'
          },
          matrix_a: {
            type: 'array',
            description: '向前兼容别名：矩阵 A 的元素 [[a, b], [c, d]]'
          },
          auto_perturb: {
            type: 'boolean',
            default: false,
            description: '若矩阵满秩且要求零乘反例，是否自动计算最近奇异降维摄动矩阵'
          }
        },
        required: ['target_property']
      }
    };
  }

  /**
   * 防御性参数校验与清洗
   */
  _validateInput(args) {
    const validProps = ['AB_ZERO', 'NON_COMMUTATIVE', 'DET_ADDITION_NONLINEAR', 'INVERSE_ORDER', 'RANK_INEQUALITY'];
    const prop = args.target_property || 'AB_ZERO';

    if (!validProps.includes(prop)) {
      return {
        valid: false,
        error: {
          code: 'INVALID_TARGET_PROPERTY',
          message: `未知的反例性质: "${prop}". 合法值范围: [${validProps.join(', ')}]`
        }
      };
    }

    const rawMat = args.matrix_elements || args.matrix_a;
    let mat = [[2, 1], [1, 0.5]]; // 默认测试奇异矩阵

    if (rawMat !== undefined && rawMat !== null) {
      if (!Array.isArray(rawMat) || rawMat.length !== 2 || !Array.isArray(rawMat[0]) || !Array.isArray(rawMat[1]) || rawMat[0].length !== 2 || rawMat[1].length !== 2) {
        return {
          valid: false,
          error: {
            code: 'INVALID_MATRIX_DIMENSIONS',
            message: '输入矩阵必须为 2x2 嵌套数组 [[a, b], [c, d]]'
          }
        };
      }

      const a = Number(rawMat[0][0]);
      const b = Number(rawMat[0][1]);
      const c = Number(rawMat[1][0]);
      const d = Number(rawMat[1][1]);

      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) {
        return {
          valid: false,
          error: {
            code: 'INVALID_MATRIX_ELEMENTS',
            message: '矩阵元素必须为有效实数，不允许包含 NaN、Infinity 或 null'
          }
        };
      }

      mat = [[a, b], [c, d]];
    }

    return {
      valid: true,
      property: prop,
      matrix: mat,
      autoPerturb: Boolean(args.auto_perturb)
    };
  }


  __m1AttachCanvasSync(result, context = {}) {
    if (!result || result.status !== "success") return result;
    if (context.signal?.aborted || (typeof context.isRunActive === 'function' && !context.isRunActive())) return { status: 'cancelled', code: 'RUN_ABORTED', error: 'RUN_ABORTED' };
    if (context.visualTask?.preferredSurface === 'artifact' || context.visualTask?.surface === 'artifact') return { status: 'error', code: 'VISUAL_SURFACE_MISMATCH', error: '当前任务使用 Artifact；二维画板保持不变。' };
    const viz = context.workspaceVisualizer || (typeof window !== "undefined" ? window.workspaceVisualizer : null);
    // S4 清偿（B 线，normal 与 no-sync 双模式统一）：requiresCanvas 工具无画布环境一律拒绝假 success
    if (!viz) {
      return {
        status: "error",
        error: "CANVAS_REQUIRED",
        detail: "[S4] construct_counterexample_matrix 为 requiresCanvas 工具：无 workspaceVisualizer 时拒绝假 success（反例必须同屏可验证）。",
        canvasSync: { applied: false, reason: "no_visualizer", oracleBReadable: false }
      };
    }
    const applyFn = applyObservationToCanvasRefCE || (typeof window !== "undefined" ? window.applyObservationToCanvas : null);
    const matrixA = result.matrixA || (result.data && result.data.matrixA);
    const matrixB = result.matrixB || (result.data && result.data.matrixB);
    if (typeof applyFn === "function") {
      const sync = applyFn(viz, {
        kind: "counterexample",
        matrixA,
        matrixB,
        proof: result.proof || (result.data && result.data.proof)
      }, context);
      result.canvasSync = sync;
      if (sync?.code) return { status: sync.code === 'RUN_ABORTED' ? 'cancelled' : 'error', code: sync.code, error: sync.code, canvasSync: sync };
      if (viz) {
        if (!sync || !sync.applied || !sync.oracleBReadable) {
          return {
            status: "error",
            error: "CANVAS_SYNC_B_NOT_READABLE",
            detail: "反例 B 未写入画布/同屏 Oracle，判定为假回流",
            canvasSync: sync || null,
            matrixA,
            matrixB
          };
        }
        if (sync.matched === false) {
          return {
            status: "error",
            error: "CANVAS_SYNC_MISMATCH",
            detail: "反例 Observation 与画布终态不一致",
            canvasSync: sync
          };
        }
      }
      return result;
    }
    if (viz) {
      if (typeof viz.prepareScene === 'function') viz.prepareScene(context.sceneId, context);
      if (context.visualTask) context.visualTask.surface = 'canvas';
      if (matrixA && typeof viz.setMatrix === "function") {
        const A = Array.isArray(matrixA)
          ? { a: matrixA[0][0], b: matrixA[0][1], c: matrixA[1][0], d: matrixA[1][1] }
          : matrixA;
        viz.setMatrix(A);
      }
      if (matrixB) {
        const B = Array.isArray(matrixB)
          ? { a: matrixB[0][0], b: matrixB[0][1], c: matrixB[1][0], d: matrixB[1][1] }
          : { a: matrixB.a, b: matrixB.b, c: matrixB.c, d: matrixB.d };
        viz.oracleMatrixB = B;
      } else {
        return {
          status: "error",
          error: "CANVAS_SYNC_B_NOT_READABLE",
          detail: "反例 B 缺失，无法同屏展示"
        };
      }
      // S3 清偿（B 线）：无 DOM 同屏横幅即无可读性证据；本分支未写 A 矩阵，matched 仅表示画布终态可读
      const finalMatrix = typeof viz.getMatrix === "function" ? viz.getMatrix() : null;
      result.canvasSync = {
        applied: true,
        oracleBReadable: false,
        matched: !!finalMatrix,
        finalMatrix,
        matrixB: viz.oracleMatrixB
      };
      return result;
    }
    // S4 清偿（B 线）：requiresCanvas 工具无画布环境不得假 success
    return {
      status: "error",
      error: "CANVAS_REQUIRED",
      detail: "[S4] construct_counterexample_matrix 为 requiresCanvas 工具：无 workspaceVisualizer 时拒绝假 success（反例必须同屏可验证）。",
      canvasSync: { applied: false, reason: "no_visualizer", oracleBReadable: false }
    };
  }

  async execute(args, context = {}) {
    const result = await this.__executeM1Core(args, context);
    return this.__m1AttachCanvasSync(result, context);
  }

  async __executeM1Core(args, context = {}) {
    const startTime = Date.now();
    const validation = this._validateInput(args || {});

    if (!validation.valid) {
      return {
        status: 'error',
        error: validation.error,
        metadata: {
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }

    const { property: prop, matrix: matA, autoPerturb } = validation;
    const MathEngine = context.mathEngine || (LinearAlgebraMathEngineClass ? new LinearAlgebraMathEngineClass() : null);

    if (!MathEngine) {
      return {
        status: 'error',
        error: {
          code: 'MATH_ENGINE_UNAVAILABLE',
          message: '未挂载可用的数学计算引擎 LinearAlgebraMathEngine'
        },
        metadata: {
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }

    try {
      if (prop === 'AB_ZERO') {
        const res = MathEngine.constructZeroProductCounterexample(matA, null, null, null, autoPerturb);
        if (!res.success) {
          return {
            status: 'error',
            property: 'AB_ZERO',
            matrixA: matA,
            error: {
              code: 'INVERTIBLE_MATRIX_NO_KERNEL',
              message: res.message,
              theorem: res.theorem,
              latexExplanation: res.latexExplanation,
              suggestedMatrixA: res.suggestedMatrixA
            },
            data: {
              isSingular: false,
              suggestedMatrixA: res.suggestedMatrixA
            },
            metadata: {
              duration_ms: Date.now() - startTime,
              timestamp: new Date().toISOString()
            }
          };
        }

        const bArr = [
          [res.matrixB[0][0], res.matrixB[0][1]],
          [res.matrixB[1][0], res.matrixB[1][1]]
        ];
        bArr.a = bArr[0][0]; bArr.b = bArr[0][1];
        bArr.c = bArr[1][0]; bArr.d = bArr[1][1];

        return {
          status: 'success',
          property: 'AB_ZERO',
          matrixA: matA,
          matrixB: bArr,
          product: res.product,
          proof: res.proof || 'Col(B) ⊆ Null(A)',
          latexExplanation: res.latexExplanation,
          isPerturbed: Boolean(res.isPerturbed),
          originalMatrixA: res.originalMatrixA || null,
          theoremNote: res.theoremNote || null,
          data: {
            matrixA: matA,
            matrixB: bArr,
            product: res.product,
            proof: res.proof,
            latexExplanation: res.latexExplanation
          },
          detail: `成功构造非零矩阵 B 使得 A·B = O: B=[[${bArr[0].join(', ')}], [${bArr[1].join(', ')}]]`,
          metadata: {
            duration_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          }
        };
      }

      if (prop === 'NON_COMMUTATIVE') {
        const res = MathEngine.constructCommutatorCounterexample(matA);
        if (!res.success) {
          return {
            status: 'error',
            property: 'NON_COMMUTATIVE',
            matrixA: matA,
            error: {
              code: 'SCALAR_MATRIX_CENTRAL',
              message: res.message,
              theorem: res.theorem,
              latexExplanation: res.latexExplanation
            },
            metadata: {
              duration_ms: Date.now() - startTime,
              timestamp: new Date().toISOString()
            }
          };
        }

        const bArr = [
          [res.matrixB[0][0], res.matrixB[0][1]],
          [res.matrixB[1][0], res.matrixB[1][1]]
        ];
        bArr.a = bArr[0][0]; bArr.b = bArr[0][1];
        bArr.c = bArr[1][0]; bArr.d = bArr[1][1];

        return {
          status: 'success',
          property: 'NON_COMMUTATIVE',
          matrixA: matA,
          matrixB: bArr,
          productAB: res.productAB,
          productBA: res.productBA,
          commutator: res.commutator,
          proof: res.proof,
          latexExplanation: res.latexExplanation,
          data: {
            matrixA: matA,
            matrixB: bArr,
            productAB: res.productAB,
            productBA: res.productBA,
            commutator: res.commutator
          },
          detail: '成功构造非对易反例矩阵: [A, B] = AB - BA ≠ O',
          metadata: {
            duration_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          }
        };
      }

      if (prop === 'DET_ADDITION_NONLINEAR') {
        const res = MathEngine.constructDetNonlinearCounterexample(matA);
        const bArr = [
          [res.matrixB[0][0], res.matrixB[0][1]],
          [res.matrixB[1][0], res.matrixB[1][1]]
        ];
        bArr.a = bArr[0][0]; bArr.b = bArr[0][1];
        bArr.c = bArr[1][0]; bArr.d = bArr[1][1];

        return {
          status: 'success',
          property: 'DET_ADDITION_NONLINEAR',
          matrixA: matA,
          matrixB: bArr,
          matrixSum: res.matrixSum,
          detA: res.detA,
          detB: res.detB,
          detSum: res.detSum,
          detAdditive: res.detAdditive,
          discrepancy: res.discrepancy,
          proof: res.proof,
          latexExplanation: res.latexExplanation,
          data: {
            matrixA: matA,
            matrixB: bArr,
            matrixSum: res.matrixSum,
            detA: res.detA,
            detB: res.detB,
            detSum: res.detSum
          },
          detail: '成功构造行列式非加性反例: det(A + B) ≠ det(A) + det(B)',
          metadata: {
            duration_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          }
        };
      }

      if (prop === 'INVERSE_ORDER') {
        const res = MathEngine.constructInverseOrderCounterexample(matA);
        if (!res.success) {
          return {
            status: 'error',
            property: 'INVERSE_ORDER',
            matrixA: matA,
            error: {
              code: 'SINGULAR_MATRIX_NO_INVERSE',
              message: res.message,
              theorem: res.theorem
            },
            metadata: {
              duration_ms: Date.now() - startTime,
              timestamp: new Date().toISOString()
            }
          };
        }

        const bArr = [
          [res.matrixB[0][0], res.matrixB[0][1]],
          [res.matrixB[1][0], res.matrixB[1][1]]
        ];
        bArr.a = bArr[0][0]; bArr.b = bArr[0][1];
        bArr.c = bArr[1][0]; bArr.d = bArr[1][1];

        return {
          status: 'success',
          property: 'INVERSE_ORDER',
          matrixA: matA,
          matrixB: bArr,
          matrixAB: res.matrixAB,
          invAB: res.invAB,
          invBinvA: res.invBinvA,
          invAinvB: res.invAinvB,
          proof: res.proof,
          latexExplanation: res.latexExplanation,
          data: {
            matrixA: matA,
            matrixB: bArr,
            matrixAB: res.matrixAB,
            invAB: res.invAB,
            invBinvA: res.invBinvA,
            invAinvB: res.invAinvB
          },
          detail: '成功构造逆矩阵顺序反例: (AB)⁻¹ = B⁻¹A⁻¹ ≠ A⁻¹B⁻¹',
          metadata: {
            duration_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          }
        };
      }

      if (prop === 'RANK_INEQUALITY') {
        const res = MathEngine.constructRankInequalityCounterexample(matA);
        const bArr = [
          [res.matrixB[0][0], res.matrixB[0][1]],
          [res.matrixB[1][0], res.matrixB[1][1]]
        ];
        bArr.a = bArr[0][0]; bArr.b = bArr[0][1];
        bArr.c = bArr[1][0]; bArr.d = bArr[1][1];

        return {
          status: 'success',
          property: 'RANK_INEQUALITY',
          matrixA: matA,
          matrixB: bArr,
          productAB: res.productAB,
          rankA: res.rankA,
          rankB: res.rankB,
          rankAB: res.rankAB,
          minRank: res.minRank,
          proof: res.proof,
          latexExplanation: res.latexExplanation,
          data: {
            matrixA: matA,
            matrixB: bArr,
            productAB: res.productAB,
            rankA: res.rankA,
            rankB: res.rankB,
            rankAB: res.rankAB,
            minRank: res.minRank
          },
          detail: `成功验证西尔维斯特秩不等式: rank(AB) ≤ min(rank A, rank B)`,
          metadata: {
            duration_ms: Date.now() - startTime,
            timestamp: new Date().toISOString()
          }
        };
      }

      return {
        status: 'error',
        error: {
          code: 'UNHANDLED_PROPERTY',
          message: `未处理的反例类型: ${prop}`
        },
        metadata: {
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    } catch (err) {
      return {
        status: 'error',
        error: {
          code: 'EXECUTION_EXCEPTION',
          message: err.message || '内部计算异常'
        },
        metadata: {
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CounterexampleSkill };
}
if (typeof window !== 'undefined') {
  window.CounterexampleSkill = CounterexampleSkill;
}

