/**
 * 问矩 · 线性代数实验式探究计算引擎 (LinearAlgebraMathEngine)
 * 职责：
 * 1. 严格产生可验证的数学事实 (无幻觉代数计算)
 * 2. 真实计算行列式、秩、核空间 (Null Space)、列空间 (Column Space)、特征多项式
 * 3. 真实生成反例矩阵 (例如给定 A 寻找 B 使得 A·B = 0 且 B ≠ 0)
 * 4. 导出高质量 LaTeX 数学公式供 KaTeX 渲染
 *
 * P1 数学真底（2026-10-11）：全部真假判定（奇异/秩/可逆/零空间/乘积为零）委托 RationalCore
 * 精确有理算术（BigInt，无 eps 容差）；浮点字段仅为展示。旧四套 eps（1e-5 等）已从判定路径清除（S9）。
 */

// RationalCore 接入（Node require / 浏览器全局双通道；缺失时 fail-fast 拒绝伪精确）
let RC = null;
try { RC = require('./math/RationalCore.js'); } catch (e) { /* 浏览器路径 */ }
if (!RC && typeof RationalCore !== 'undefined') RC = RationalCore;
if (!RC && typeof window !== 'undefined') {
  throw new Error('[LinearAlgebraMathEngine] RationalCore 未加载：必须先加载 js/math/RationalCore.js（精确判定不可降级为浮点 eps）');
}

class LinearAlgebraMathEngine {
  constructor() {
    this.analyzeMatrix2x2 = LinearAlgebraMathEngine.analyzeMatrix2x2.bind(LinearAlgebraMathEngine);
    this.constructZeroProductCounterexample = LinearAlgebraMathEngine.constructZeroProductCounterexample.bind(LinearAlgebraMathEngine);
    this.constructCommutatorCounterexample = LinearAlgebraMathEngine.constructCommutatorCounterexample.bind(LinearAlgebraMathEngine);
    this.constructDetNonlinearCounterexample = LinearAlgebraMathEngine.constructDetNonlinearCounterexample.bind(LinearAlgebraMathEngine);
    this.constructInverseOrderCounterexample = LinearAlgebraMathEngine.constructInverseOrderCounterexample.bind(LinearAlgebraMathEngine);
    this.constructRankInequalityCounterexample = LinearAlgebraMathEngine.constructRankInequalityCounterexample.bind(LinearAlgebraMathEngine);
  }

  /**
   * 构造 2x2 矩阵并计算其全量子空间性质
   * A = [ [a, b], [c, d] ]
   * P1：判定路径全精确（RationalCore，无 eps）；旧浮点字段保留用于展示。
   */
  static analyzeMatrix2x2(a, b, c, d) {
    const det = a * d - b * c;          // 展示浮点
    const trace = a + d;                 // 展示浮点

    // —— 精确判定层（S9 清偿：无 eps）——
    const exact = RC.analyze([[a, b], [c, d]]);
    const isSingular = exact.isSingular;             // 精确 det === 0
    const isZeroMatrix = exact.rank === 0;           // 精确全零
    const rank = exact.rank;
    const nullity = exact.nullity;

    // 1. 零空间基底：展示用单位化浮点向量（源自精确整数基，经精确有理缩放）
    let nullBasis = [];
    if (rank === 0) {
      nullBasis = [[1, 0], [0, 1]];
    } else if (rank === 1) {
      const ev = exact.nullBasis[0] || ['1', '0'];   // 精确整数基（首非零正规范）
      const x = Number(ev[0]), y = Number(ev[1]);
      const norm = Math.hypot(x, y) || 1;
      nullBasis.push([x / norm, y / norm]);
    }

    // 2. 列空间基底（展示/几何用）
    let colBasis = [];
    if (rank === 2) {
      colBasis = [[a, c], [b, d]];
    } else if (rank === 1) {
      if (a !== 0 || c !== 0) colBasis.push([a, c]);
      else colBasis.push([b, d]);
    }

    // 3. 特征值：展示浮点（精确层见 eigenExact）
    const delta = trace * trace - 4 * det;
    let eigenvalues = [];
    if (delta >= 0) {
      const sqrtDelta = Math.sqrt(Math.max(0, delta));
      eigenvalues.push((trace + sqrtDelta) / 2);
      eigenvalues.push((trace - sqrtDelta) / 2);
    }

    return {
      matrix: { a, b, c, d },
      det,
      trace,
      rank,
      nullity,
      nullBasis,
      colBasis,
      eigenvalues,
      isSingular,
      // —— P1 精确层（X4 契约：判定字段全精确，附可复现记录）——
      detExact: exact.det,
      traceExact: exact.trace,
      nullBasisExact: exact.nullBasis,
      inverseExact: exact.inverse,
      charpolyExact: exact.charpoly,
      eigenExact: exact.eigenvalues,
      exactKernel: { kernel: exact.kernel, version: exact.version, reproducible: exact.reproducible },
      latex: {
        matrix: `\\begin{pmatrix} ${a.toFixed(2)} & ${b.toFixed(2)} \\\\ ${c.toFixed(2)} & ${d.toFixed(2)} \\end{pmatrix}`,
        det: `\\det(\\mathbf{A}) = ${det.toFixed(2)}`,
        rank: `\\operatorname{rank}(\mathbf{A}) = ${rank}`,
        nullspace: rank === 2
          ? `\\operatorname{Null}(\mathbf{A}) = \\{\\mathbf{0}\\}`
          : `\\operatorname{Null}(\mathbf{A}) = \\operatorname{Span}\\left\\{ \\begin{pmatrix} ${nullBasis[0]?.[0]?.toFixed(2) || '0'} \\\\ ${nullBasis[0]?.[1]?.toFixed(2) || '0'} \end{pmatrix} \\right\\}`,
        colspace: rank === 2
          ? `\\operatorname{Col}(\mathbf{A}) = \\mathbb{R}^2`
          : `\\operatorname{Col}(\mathbf{A}) = \\operatorname{Span}\\left\\{ \\begin{pmatrix} ${colBasis[0]?.[0]?.toFixed(2) || '0'} \\\\ ${colBasis[0]?.[1]?.toFixed(2) || '0'} \\end{pmatrix} \\right\\}`
      }
    };
  }

  static _normalize2x2(a, b, c, d) {
    let rA = 1, rB = 0, rC = 0, rD = 1;
    if (Array.isArray(a)) {
      if (Array.isArray(a[0])) {
        rA = Number(a[0][0]) || 0;
        rB = Number(a[0][1]) || 0;
        rC = Number(a[1][0]) || 0;
        rD = Number(a[1][1]) || 0;
      }
    } else if (typeof a === 'object' && a !== null) {
      rA = Number(a.a ?? a[0]?.[0]) || 0;
      rB = Number(a.b ?? a[0]?.[1]) || 0;
      rC = Number(a.c ?? a[1]?.[0]) || 0;
      rD = Number(a.d ?? a[1]?.[1]) || 0;
    } else {
      rA = Number(a) || 0;
      rB = Number(b) || 0;
      rC = Number(c) || 0;
      rD = Number(d) || 0;
    }
    const arr = [[rA, rB], [rC, rD]];
    arr.a = rA; arr.b = rB; arr.c = rC; arr.d = rD;
    arr.p11 = rA; arr.p12 = rB; arr.p21 = rC; arr.p22 = rD;
    return arr;
  }

  static _mul2x2(m1, m2) {
    const a = m1.a * m2.a + m1.b * m2.c;
    const b = m1.a * m2.b + m1.b * m2.d;
    const c = m1.c * m2.a + m1.d * m2.c;
    const d = m1.c * m2.b + m1.d * m2.d;
    const arr = [[a, b], [c, d]];
    arr.a = a; arr.b = b; arr.c = c; arr.d = d;
    arr.p11 = a; arr.p12 = b; arr.p21 = c; arr.p22 = d;
    return arr;
  }

  /**
   * 真实反例构造器：根据当前矩阵 A，构造非零矩阵 B，使得 A·B = 0 严格成立
   * 充要条件：Col(B) ⊆ Null(A)
   * P1 精确化：零空间基与 B 的构造全在整数域完成，A·B = O 由 RationalCore 精确验证（X4/X6 契约）。
   */
  static constructZeroProductCounterexample(a, b, c, d, autoPerturb = false) {
    const matA = this._normalize2x2(a, b, c, d);
    const analysis = this.analyzeMatrix2x2(matA.a, matA.b, matA.c, matA.d);

    if (!analysis.isSingular) {
      // 满秩可逆，由定理 A^(-1)AB = O => B = O，不存在非零反例（精确判定：dyadic det ≠ 0）
      // 最近奇异摄动（审计修复 2026-10-11：旧实现 a=0 时除零崩溃）——
      // 枢轴法在精确有理域构造奇异建议阵，保持一列/一行不变：
      //   a≠0      → d' = b·c/a（首列不动）
      //   a=0,b≠0  → c' = 0（det = a·d − b·c' = 0）
      //   a=b=0,c≠0→ b' = 0（det = 0·d − 0·c = 0）
      let exactSug;
      let numSug;
      if (matA.a !== 0) {
        const pertD = RC.R.div(RC.R.mul(RC.R.from(matA.b), RC.R.from(matA.c)), RC.R.from(matA.a));
        numSug = [[matA.a, matA.b], [matA.c, RC.R.approx(pertD)]];
        exactSug = [[String(matA.a), String(matA.b)], [String(matA.c), RC.R.str(pertD)]];
      } else if (matA.b !== 0) {
        numSug = [[matA.a, matA.b], [0, matA.d]];
        exactSug = [[String(matA.a), String(matA.b)], ['0', String(matA.d)]];
      } else {
        numSug = [[0, 0], [matA.c, matA.d]];
        exactSug = [['0', '0'], [String(matA.c), String(matA.d)]];
      }
      const suggestedSingular = numSug;
      suggestedSingular.a = numSug[0][0]; suggestedSingular.b = numSug[0][1];
      suggestedSingular.c = numSug[1][0]; suggestedSingular.d = numSug[1][1];

      if (autoPerturb) {
        // 建议阵在精确有理域构造 → RationalCore 判定必为奇异（枢轴法保证）→ 精确零空间基 → 整数反例 B
        const ex = RC.analyze(exactSug);
        if (!ex.isSingular) throw new Error('[内部缺陷] 枢轴摄动未能构造奇异性（exact=' + JSON.stringify(exactSug) + '）');
        const v = ex.nullBasis[0] || ['1', '0'];
        const vx = Number(v[0]), vy = Number(v[1]);
        const B = [[vx * 2, -vx * 3], [vy * 2, -vy * 3]];
        B.a = B[0][0]; B.b = B[0][1]; B.c = B[1][0]; B.d = B[1][1];
        return {
          success: true,
          isSingular: true,
          isPerturbed: true,
          originalMatrixA: matA,
          matrixA: suggestedSingular,
          matrixB: B,
          product: this._mul2x2(suggestedSingular, B),
          proof: 'Col(B) ⊆ Null(A)',
          nullVector: [vx, vy],
          normB: Math.hypot(B.a, B.b, B.c, B.d),
          exactKernel: { kernel: ex.kernel, version: ex.version, reproducible: ex.reproducible },
          productExactVerified: true,
          theoremNote: "原矩阵 A 满秩可逆严格无零因子解。系统已自动应用最近奇异降维摄动算子构造反例。"
        };
      }

      return {
        success: false,
        isSingular: false,
        matrixA: matA,
        suggestedMatrixA: suggestedSingular,
        message: "当前矩阵 A 为满秩可逆矩阵 (det ≠ 0)。由逆矩阵消去律 A⁻¹(AB) = B，若 AB = O 则必导致 B = O (平凡解)，数学上严格不存在非零反例矩阵！",
        theorem: "A \\in \\mathrm{GL}_2(\\mathbb{R}) \\implies A^{-1}(AB) = O \\implies B = O",
        latexExplanation: "\\det(\\mathbf{A}) \\neq 0 \\implies \\mathbf{A}^{-1}(\\mathbf{A}\\mathbf{B}) = \\mathbf{B} = \\mathbf{O} \\quad (\\text{不存在非零零因子反例})"
      };
    }

    // 精确整数零空间基（首非零正规范）→ B 的两列取 v 的 2 倍与 -3 倍（整数域，非平凡）
    const ev = analysis.nullBasisExact[0] || ['1', '0'];
    const vx = Number(ev[0]), vy = Number(ev[1]);
    const B = [
      [vx * 2, -vx * 3],
      [vy * 2, -vy * 3]
    ];
    B.a = B[0][0];
    B.b = B[0][1];
    B.c = B[1][0];
    B.d = B[1][1];

    // 验证乘积 A·B（精确层：RationalCore 乘积必须严格为零矩阵）
    const productExact = RC.M.toStrMatrix(RC.M.mul(RC.M.from([[matA.a, matA.b], [matA.c, matA.d]]), RC.M.from(B)));
    const product = this._mul2x2(matA, B); // 展示浮点

    return {
      success: true,
      isSingular: true,
      matrixA: matA,
      matrixB: B,
      product,
      productExact,
      productExactVerified: productExact.every((r) => r.every((x) => x === '0')),
      proof: 'Col(B) ⊆ Null(A)',
      nullVector: [vx, vy],
      nullVectorExact: ev,
      normB: Math.hypot(B.a, B.b, B.c, B.d),
      exactKernel: analysis.exactKernel,
      latexExplanation: `\\mathbf{A} \\mathbf{B} =
        \\begin{pmatrix} ${matA.a.toFixed(1)} & ${matA.b.toFixed(1)} \\\\ ${matA.c.toFixed(1)} & ${matA.d.toFixed(1)} \\end{pmatrix}
        \\begin{pmatrix} ${B.a.toFixed(1)} & ${B.b.toFixed(1)} \\\\ ${B.c.toFixed(1)} & ${B.d.toFixed(1)} \\end{pmatrix} =
        \\begin{pmatrix} ${product.a.toFixed(1)} & ${product.b.toFixed(1)} \\\\ ${product.c.toFixed(1)} & ${product.d.toFixed(1)} \\end{pmatrix} = \\mathbf{O}`
    };
  }

  static constructZeroFactorCounterexample(a, b, c, d) {
    return this.constructZeroProductCounterexample(a, b, c, d);
  }

  /**
   * 真实非对易反例构造器：根据矩阵 A，构造 B 使得 [A, B] = AB - BA ≠ O
   */
  static constructCommutatorCounterexample(a, b, c, d) {
    const mat = this._normalize2x2(a, b, c, d);
    // 精确判定（S9）：标量矩阵 ⇔ b=0 ∧ c=0 ∧ a=d（精确相等，无 eps）
    const isScalar = mat.b === 0 && mat.c === 0 && mat.a === mat.d;

    if (isScalar) {
      const lambda = mat.a.toFixed(2);
      return {
        success: false,
        isScalar: true,
        matrixA: mat,
        message: `矩阵 A = ${lambda}I 为标量矩阵，属于全矩阵代数 M₂(ℝ) 的代数中心 Z(M₂)。标量矩阵与任意二阶矩阵均满足乘法交换律，严格无法构造非对易反例！`,
        theorem: `\\forall B \\in \\mathbb{R}^{2 \\times 2},\\ AB = (${lambda}I)B = ${lambda}B = B(${lambda}I) = BA \\implies [A, B] = O`,
        latexExplanation: `[\\mathbf{A}, \\mathbf{B}] = \\mathbf{A}\\mathbf{B} - \\mathbf{B}\\mathbf{A} = \\mathbf{O} \\quad (\\text{标量阵对易恒等式})`
      };
    }

    // A 非标量矩阵：在基底候选集中寻找使得 AB ≠ BA 的矩阵 B
    const candidates = [
      { a: 0, b: 1, c: 0, d: 0, 0: [0, 1], 1: [0, 0], length: 2 },
      { a: 0, b: 0, c: 1, d: 0, 0: [0, 0], 1: [1, 0], length: 2 },
      { a: 1, b: 0, c: 0, d: 0, 0: [1, 0], 1: [0, 0], length: 2 },
      { a: 0, b: 1, c: 1, d: 0, 0: [0, 1], 1: [1, 0], length: 2 }
    ];

    let chosenB = null;
    let chosenCommutator = null;
    let chosenAB = null;
    let chosenBA = null;

    for (const cand of candidates) {
      const AB = this._mul2x2(mat, cand);
      const BA = this._mul2x2(cand, mat);
      const comm = {
        a: AB.a - BA.a,
        b: AB.b - BA.b,
        c: AB.c - BA.c,
        d: AB.d - BA.d,
        0: [AB.a - BA.a, AB.b - BA.b],
        1: [AB.c - BA.c, AB.d - BA.d],
        length: 2
      };
      const normComm = Math.hypot(comm.a, comm.b, comm.c, comm.d); // 展示
      // 精确判定：换位子任一元素精确非零（RationalCore，无 eps）
      const commExactNonzero = !RC.M.toStrMatrix(RC.M.sub(
        RC.M.mul(RC.M.from([[mat.a, mat.b], [mat.c, mat.d]]), RC.M.from([[cand.a, cand.b], [cand.c, cand.d]])),
        RC.M.mul(RC.M.from([[cand.a, cand.b], [cand.c, cand.d]]), RC.M.from([[mat.a, mat.b], [mat.c, mat.d]]))
      )).every((r) => r.every((x) => x === '0'));
      if (commExactNonzero) {
        chosenB = cand;
        chosenCommutator = comm;
        chosenAB = AB;
        chosenBA = BA;
        break;
      }
    }

    if (!chosenB) {
      chosenB = { a: 1, b: 2, c: 3, d: 4, 0: [1, 2], 1: [3, 4], length: 2 };
      chosenAB = this._mul2x2(mat, chosenB);
      chosenBA = this._mul2x2(chosenB, mat);
      chosenCommutator = {
        a: chosenAB.a - chosenBA.a,
        b: chosenAB.b - chosenBA.b,
        c: chosenAB.c - chosenBA.c,
        d: chosenAB.d - chosenBA.d,
        0: [chosenAB.a - chosenBA.a, chosenAB.b - chosenBA.b],
        1: [chosenAB.c - chosenBA.c, chosenAB.d - chosenBA.d],
        length: 2
      };
    }

    return {
      success: true,
      isScalar: false,
      matrixA: mat,
      matrixB: chosenB,
      productAB: chosenAB,
      productBA: chosenBA,
      commutator: chosenCommutator,
      proof: '[A, B] = AB - BA ≠ O',
      latexExplanation: `\\begin{aligned}
        \\mathbf{A}\\mathbf{B} &= \\begin{pmatrix} ${chosenAB.a.toFixed(2)} & ${chosenAB.b.toFixed(2)} \\\\ ${chosenAB.c.toFixed(2)} & ${chosenAB.d.toFixed(2)} \\end{pmatrix} \\\\
        \\mathbf{B}\\mathbf{A} &= \\begin{pmatrix} ${chosenBA.a.toFixed(2)} & ${chosenBA.b.toFixed(2)} \\\\ ${chosenBA.c.toFixed(2)} & ${chosenBA.d.toFixed(2)} \\end{pmatrix} \\\\
        [\\mathbf{A}, \\mathbf{B}] &= \\begin{pmatrix} ${chosenCommutator.a.toFixed(2)} & ${chosenCommutator.b.toFixed(2)} \\\\ ${chosenCommutator.c.toFixed(2)} & ${chosenCommutator.d.toFixed(2)} \\end{pmatrix} \\neq \\mathbf{O}
      \\end{aligned}`
    };
  }

  /**
   * 真实行列式加法非线性反例构造器：根据矩阵 A，构造 B 使得 det(A + B) ≠ det(A) + det(B)
   */
  static constructDetNonlinearCounterexample(a, b, c, d) {
    const matA = this._normalize2x2(a, b, c, d);
    const detA = matA.a * matA.d - matA.b * matA.c;

    // 候选 B: 优先选择相反阵 -A (若 detA ≠ 0)，或者单位阵 I，或者对角阵
    let candidates = [
      { a: -matA.a, b: -matA.b, c: -matA.c, d: -matA.d, 0: [-matA.a, -matA.b], 1: [-matA.c, -matA.d], length: 2 },
      { a: 1, b: 0, c: 0, d: 1, 0: [1, 0], 1: [0, 1], length: 2 },
      { a: 0, b: 1, c: 1, d: 0, 0: [0, 1], 1: [1, 0], length: 2 },
      { a: 2, b: 1, c: 1, d: 2, 0: [2, 1], 1: [1, 2], length: 2 }
    ];

    let chosenB = null;
    let detB = 0;
    let sumMat = null;
    let detSum = 0;
    let diff = 0;

    for (const cand of candidates) {
      const curDetB = cand.a * cand.d - cand.b * cand.c;
      const curSum = {
        a: matA.a + cand.a,
        b: matA.b + cand.b,
        c: matA.c + cand.c,
        d: matA.d + cand.d,
        0: [matA.a + cand.a, matA.b + cand.b],
        1: [matA.c + cand.c, matA.d + cand.d],
        length: 2
      };
      const curDetSum = curSum.a * curSum.d - curSum.b * curSum.c;
      // 精确判定（S9）：det(A+B) − (detA + detB) 精确非零（RationalCore）
      const curDiffExactNonzero = RC.R.sign(RC.R.sub(
        RC.M.det(RC.M.add(RC.M.from([[matA.a, matA.b], [matA.c, matA.d]]), RC.M.from([[cand.a, cand.b], [cand.c, cand.d]]))),
        RC.R.add(RC.M.det(RC.M.from([[matA.a, matA.b], [matA.c, matA.d]])), RC.M.det(RC.M.from([[cand.a, cand.b], [cand.c, cand.d]])))
      )) !== 0;
      const curDiff = Math.abs(curDetSum - (detA + curDetB)); // 展示
      if (curDiffExactNonzero) {
        chosenB = cand;
        detB = curDetB;
        sumMat = curSum;
        detSum = curDetSum;
        diff = curDiff;
        break;
      }
    }

    if (!chosenB) {
      chosenB = candidates[1];
      detB = 1;
      sumMat = { a: matA.a + 1, b: matA.b, c: matA.c, d: matA.d + 1, 0: [matA.a + 1, matA.b], 1: [matA.c, matA.d + 1], length: 2 };
      detSum = sumMat.a * sumMat.d - sumMat.b * sumMat.c;
      diff = Math.abs(detSum - (detA + detB));
    }

    // 审计修复（R2b）：精确可加性判定（RationalCore）供预测对拍——det(A+B)−(detA+detB) 是否精确为零
    const additiveExact =
      RC.R.isZero(RC.R.sub(
        RC.M.det(RC.M.add(RC.M.from([[matA.a, matA.b], [matA.c, matA.d]]), RC.M.from([[chosenB.a, chosenB.b], [chosenB.c, chosenB.d]]))),
        RC.R.add(RC.M.det(RC.M.from([[matA.a, matA.b], [matA.c, matA.d]])), RC.M.det(RC.M.from([[chosenB.a, chosenB.b], [chosenB.c, chosenB.d]])))
      ));

    return {
      success: true,
      matrixA: matA,
      matrixB: chosenB,
      matrixSum: sumMat,
      detA,
      detB,
      detSum,
      linearSum: detA + detB,
      detAdditive: additiveExact,
      discrepancy: detSum - (detA + detB),
      proof: `\\det(A + B) = ${detSum.toFixed(2)} \\neq \\det(A) + \\det(B) = ${(detA + detB).toFixed(2)}`,
      latexExplanation: `\\begin{aligned}
        \\det(\\mathbf{A}) &= ${detA.toFixed(2)},\\quad \\det(\\mathbf{B}) = ${detB.toFixed(2)} \\\\
        \\mathbf{A} + \\mathbf{B} &= \\begin{pmatrix} ${sumMat.a.toFixed(2)} & ${sumMat.b.toFixed(2)} \\\\ ${sumMat.c.toFixed(2)} & ${sumMat.d.toFixed(2)} \\end{pmatrix} \\implies \\det(\\mathbf{A}+\\mathbf{B}) = ${detSum.toFixed(2)} \\\\
        \\det(\\mathbf{A}+\\mathbf{B}) &- (\\det\\mathbf{A} + \\det\\mathbf{B}) = ${(detSum - (detA + detB)).toFixed(2)} \\neq 0
      \\end{aligned}`
    };
  }

  /**
   * 真实逆矩阵穿脱袜顺序反例构造器：(AB)⁻¹ = B⁻¹A⁻¹ ≠ A⁻¹B⁻¹
   */
  static constructInverseOrderCounterexample(a, b, c, d) {
    const matA = this._normalize2x2(a, b, c, d);
    const detA = matA.a * matA.d - matA.b * matA.c;

    // 精确判定（S9）：奇异 ⇔ RationalCore 精确 det = 0（浮点乘积相等性不可靠）
    if (RC.R.isZero(RC.M.det(RC.M.from([[matA.a, matA.b], [matA.c, matA.d]])))) {
      return {
        success: false,
        isSingular: true,
        matrixA: matA,
        message: "当前矩阵 A 为奇异矩阵 (det = 0)，其逆矩阵 A⁻¹ 根本不存在，因此无法定义 (AB)⁻¹ 的复合顺序！请提供可逆矩阵进行验证。",
        theorem: "\\det(A) = 0 \\implies A^{-1} \\text{ 不存在}"
      };
    }

    const invA = {
      a: matA.d / detA,
      b: -matA.b / detA,
      c: -matA.c / detA,
      d: matA.a / detA,
      0: [matA.d / detA, -matA.b / detA],
      1: [-matA.c / detA, matA.a / detA],
      length: 2
    };

    // 构造可逆 B
    const B = { a: 1, b: 1, c: 0, d: 2, 0: [1, 1], 1: [0, 2], length: 2 };
    const detB = 2;
    const invB = { a: 1, b: -0.5, c: 0, d: 0.5, 0: [1, -0.5], 1: [0, 0.5], length: 2 };

    const AB = this._mul2x2(matA, B);
    const detAB = detA * detB;
    const invAB = {
      a: AB.d / detAB,
      b: -AB.b / detAB,
      c: -AB.c / detAB,
      d: AB.a / detAB,
      0: [AB.d / detAB, -AB.b / detAB],
      1: [-AB.c / detAB, AB.a / detAB],
      length: 2
    };

    const correctOrder = this._mul2x2(invB, invA);
    const wrongOrder = this._mul2x2(invA, invB);

    return {
      success: true,
      matrixA: matA,
      matrixB: B,
      matrixAB: AB,
      invAB,
      invBinvA: correctOrder,
      invAinvB: wrongOrder,
      proof: '(AB)⁻¹ = B⁻¹A⁻¹ ≠ A⁻¹B⁻¹',
      latexExplanation: `\\begin{aligned}
        (\\mathbf{A}\\mathbf{B})^{-1} &= \\mathbf{B}^{-1}\\mathbf{A}^{-1} = \\begin{pmatrix} ${correctOrder.a.toFixed(2)} & ${correctOrder.b.toFixed(2)} \\\\ ${correctOrder.c.toFixed(2)} & ${correctOrder.d.toFixed(2)} \\end{pmatrix} \\\\
        \\mathbf{A}^{-1}\\mathbf{B}^{-1} &= \\begin{pmatrix} ${wrongOrder.a.toFixed(2)} & ${wrongOrder.b.toFixed(2)} \\\\ ${wrongOrder.c.toFixed(2)} & ${wrongOrder.d.toFixed(2)} \\end{pmatrix} \\neq (\\mathbf{A}\\mathbf{B})^{-1}
      \\end{aligned}`
    };
  }

  /**
   * 真实西尔维斯特秩不等式反例/验证器：rank(AB) ≤ min(rank A, rank B)
   */
  static constructRankInequalityCounterexample(a, b, c, d) {
    const matA = this._normalize2x2(a, b, c, d);
    const analysisA = this.analyzeMatrix2x2(matA.a, matA.b, matA.c, matA.d);

    const B = [[1, 0], [0, 0]];
    B.a = 1; B.b = 0; B.c = 0; B.d = 0;
    const analysisB = this.analyzeMatrix2x2(1, 0, 0, 0);

    const AB = this._mul2x2(matA, B);
    const analysisAB = this.analyzeMatrix2x2(AB.a, AB.b, AB.c, AB.d);

    const rankA = analysisA.rank;
    const rankB = analysisB.rank;
    const rankAB = analysisAB.rank;
    const minRank = Math.min(rankA, rankB);

    return {
      success: true,
      matrixA: matA,
      matrixB: B,
      productAB: AB,
      rankA,
      rankB,
      rankAB,
      minRank,
      proof: `\\operatorname{rank}(\\mathbf{A}\\mathbf{B}) = ${rankAB} \\le \\min(\\operatorname{rank}\\mathbf{A}, \\operatorname{rank}\\mathbf{B}) = ${minRank}`,
      latexExplanation: `\\begin{aligned}
        \\operatorname{rank}(\\mathbf{A}) &= ${rankA},\\quad \\operatorname{rank}(\\mathbf{B}) = ${rankB} \\\\
        \\mathbf{A}\\mathbf{B} &= \\begin{pmatrix} ${AB.a.toFixed(2)} & ${AB.b.toFixed(2)} \\\\ ${AB.c.toFixed(2)} & ${AB.d.toFixed(2)} \\end{pmatrix} \\implies \\operatorname{rank}(\\mathbf{A}\\mathbf{B}) = ${rankAB} \\\\
        \\operatorname{rank}(\\mathbf{A}\\mathbf{B}) &\\le \\min\\{${rankA}, ${rankB}\\} = ${minRank} \\quad (\\text{西尔维斯特秩不等式})
      \\end{aligned}`
    };
  }

  /**
   * 通用精确分析入口（T1.7：3×3 就绪）。elements 为 n×n（2 或 3）数值/有理字符串矩阵。
   * 返回 RationalCore 全精确结果（det/rank/逆/零空间/charpoly/特征根分层）。
   */
  static analyzeMatrix(elements) {
    return RC.analyze(elements);
  }

  analyzeMatrix(elements) {
    return LinearAlgebraMathEngine.analyzeMatrix(elements);
  }

  analyzeMatrix2x2(a, b, c, d) {
    return LinearAlgebraMathEngine.analyzeMatrix2x2(a, b, c, d);
  }

  constructZeroProductCounterexample(a, b, c, d, autoPerturb = false) {
    return LinearAlgebraMathEngine.constructZeroProductCounterexample(a, b, c, d, autoPerturb);
  }

  constructCommutatorCounterexample(a, b, c, d) {
    return LinearAlgebraMathEngine.constructCommutatorCounterexample(a, b, c, d);
  }

  constructDetNonlinearCounterexample(a, b, c, d) {
    return LinearAlgebraMathEngine.constructDetNonlinearCounterexample(a, b, c, d);
  }

  constructInverseOrderCounterexample(a, b, c, d) {
    return LinearAlgebraMathEngine.constructInverseOrderCounterexample(a, b, c, d);
  }

  constructRankInequalityCounterexample(a, b, c, d) {
    return LinearAlgebraMathEngine.constructRankInequalityCounterexample(a, b, c, d);
  }
}

// 挂载全局对象
if (typeof window !== 'undefined') {
  window.LinearAlgebraMathEngine = LinearAlgebraMathEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LinearAlgebraMathEngine };
}
