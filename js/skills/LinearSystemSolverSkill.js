/**
 * 问矩 · 线性方程组相伴解系求解器技能 (LinearSystemSolverSkill)
 * 职责：
 * 1. 给定系数矩阵 A 与非齐次项 b，求解 Ax = b；
 * 2. 基于鲁歇-卡佩里定理 (Rouché–Capelli Theorem) 严格判别：
 *    - rank(A) < rank(A|b) -> 无解 (Inconsistent)
 *    - rank(A) = rank(A|b) = 2 -> 唯一解 (Unique)
 *    - rank(A) = rank(A|b) = 1 -> 无穷多解 (特解 + 齐次通解 c * eta)
 * 3. 杜绝 LLM 针对奇异系统求解的浮点幻觉与自造答案。
 */

let BaseSkillSys;
if (typeof require !== 'undefined') {
  try { BaseSkillSys = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('LinearSystemSolverSkill', 'if', e); }
}
if (!BaseSkillSys && typeof window !== 'undefined') {
  BaseSkillSys = window.BaseSkill;
}
if (!BaseSkillSys) {
  BaseSkillSys = class { constructor(n, d) { this.name = n; this.description = d; } };
}

class LinearSystemSolverSkill extends BaseSkillSys {
  constructor() {
    super(
      'solve_linear_system',
      '精确符号求解二阶线性方程组 Ax = b 的相伴解系，输出秩相容性判别式、特解与齐次零空间通解结构。'
    );
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: false, // B 线契约 GATE-CONTRACT-01：本工具是否要求画布环境
      parameters: {
        type: 'object',
        properties: {
          matrix_a: {
            type: 'array',
            items: {
              type: 'array',
              items: { type: 'number' },
              minItems: 2,
              maxItems: 2
            },
            minItems: 2,
            maxItems: 2,
            description: '系数矩阵 A 的 2x2 数组 [[a, b], [c, d]]'
          },
          vector_b: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2,
            description: '非齐次常数向量 b [b1, b2]'
          }
        },
        required: ['matrix_a', 'vector_b']
      }
    };
  }

  async execute(args, context = {}) {
    // T1.5 防御（前轮探针④）：无参/残缺参数 fail-fast，不再解构 undefined 崩溃为 TypeError
    const A = args && args.matrix_a;
    const b = args && args.vector_b;
    if (!Array.isArray(A) || !Array.isArray(b) || !Array.isArray(A[0]) || !Array.isArray(A[1]) ||
        ![A[0][0], A[0][1], A[1][0], A[1][1], b[0], b[1]].every((x) => typeof x === 'number' && Number.isFinite(x))) {
      return {
        status: 'error',
        error: 'INVALID_LINEAR_SYSTEM_ARGS',
        detail: '[T1.5] solve_linear_system 需要 matrix_a（2×2 数值矩阵）与 vector_b（2 维数值向量）；收到: ' + JSON.stringify(args || {}),
        uiVisible: true
      };
    }
    const a = A[0][0], b1 = A[0][1];
    const c = A[1][0], d = A[1][1];
    const b_vec = [b[0], b[1]];

    const det = a * d - b1 * c;
    const EPS = 1e-6;

    if (Math.abs(det) > EPS) {
      // 唯一解: 克莱姆法则或求逆
      const invDet = 1.0 / det;
      const x0 = invDet * (d * b_vec[0] - b1 * b_vec[1]);
      const x1 = invDet * (-c * b_vec[0] + a * b_vec[1]);
      return {
        status: 'success',
        solutionType: 'UNIQUE',
        rankA: 2,
        rankAugmented: 2,
        particularSolution: [x0, x1],
        homogeneousBasis: [],
        detail: `系统具有唯一解: x = [${x0.toFixed(3)}, ${x1.toFixed(3)}]^T (det=${det.toFixed(3)})`
      };
    }

    // det === 0, 判定相容性
    // 检查行向量是否平行
    const row1 = [a, b1, b_vec[0]];
    const row2 = [c, d, b_vec[1]];

    // 检查 rank(A)
    const aIsZero = Math.abs(a) < EPS && Math.abs(b1) < EPS && Math.abs(c) < EPS && Math.abs(d) < EPS;
    const rankA = aIsZero ? 0 : 1;

    // 检查增广矩阵增量
    let isConsistent = false;
    let particularSolution = [0, 0];
    let homogeneousBasis = [];

    if (rankA === 1) {
      // 找出非零行
      const pivotRow = (Math.abs(a) > EPS || Math.abs(b1) > EPS) ? row1 : row2;
      const otherRow = pivotRow === row1 ? row2 : row1;

      // 检查比值
      let scale = 0;
      if (Math.abs(pivotRow[0]) > EPS) scale = otherRow[0] / pivotRow[0];
      else if (Math.abs(pivotRow[1]) > EPS) scale = otherRow[1] / pivotRow[1];

      const diffB = otherRow[2] - scale * pivotRow[2];
      isConsistent = Math.abs(diffB) < EPS;

      if (isConsistent) {
        // 求一个特解与齐次通解
        if (Math.abs(pivotRow[0]) > EPS) {
          particularSolution = [pivotRow[2] / pivotRow[0], 0];
          homogeneousBasis = [[-pivotRow[1], pivotRow[0]]];
        } else {
          particularSolution = [0, pivotRow[2] / pivotRow[1]];
          homogeneousBasis = [[1, 0]];
        }
      }
    } else {
      isConsistent = (Math.abs(b_vec[0]) < EPS && Math.abs(b_vec[1]) < EPS);
    }

    if (!isConsistent) {
      return {
        status: 'success',
        solutionType: 'INCONSISTENT',
        rankA,
        rankAugmented: rankA + 1,
        particularSolution: null,
        homogeneousBasis: [],
        detail: `系统矛盾无解: rank(A)=${rankA} < rank(A|b)=${rankA + 1}，非齐次向量 b 不在列空间 Col(A) 中。`
      };
    }

    return {
      status: 'success',
      solutionType: 'INFINITE',
      rankA,
      rankAugmented: rankA,
      particularSolution,
      homogeneousBasis,
      detail: `系统有无穷多解: x = x_p + c * eta，特解=[${particularSolution.map(v => v.toFixed(2)).join(', ')}]，零空间基底 eta=[${homogeneousBasis[0].map(v => v.toFixed(2)).join(', ')}]`
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LinearSystemSolverSkill };
}
if (typeof window !== 'undefined') {
  window.LinearSystemSolverSkill = LinearSystemSolverSkill;
}
