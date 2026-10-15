/**
 * RationalCore —— BigInt 精确有理数矩阵内核（P1 数学真底 · X4 契约）
 *
 * 设计约定（教学领域合同 §10.3）：
 *  - 一切判定路径（奇异/秩/可逆/核空间/乘积为零）使用精确有理算术，无 eps 容差；
 *  - JS number 输入按其二进制表示取精确 dyadic 有理值（x = m·2^e），不经十进制近似——
 *    故 [[1,0],[0,1e-6]] 的 det 精确非零（X4），拖拽产生的 0.30000000000000004 亦保持真值；
 *  - 字符串输入支持 "p/q"、"-3/7"、"5"；对象输入支持 {n,d}；
 *  - 浮点数仅允许出现在输出展示字段（approx），不参与任何真假判定；
 *  - 全部运算确定性可重放：同输入同输出，无随机、无浮点结合序歧义。
 *
 * UMD：浏览器挂 window.RationalCore，Node 走 module.exports。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RationalCore = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  // ---------- 基础有理数 ----------
  function bigAbs(x) { return x < 0n ? -x : x; }
  function bigGcd(a, b) { a = bigAbs(a); b = bigAbs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
  function bigSqrt(n) { // n>=0；非完全平方返回 null
    if (n < 0n) return null;
    if (n < 2n) return n;
    let x = n, y = (x + 1n) / 2n;
    while (y < x) { x = y; y = (x + n / x) / 2n; }
    return x * x === n ? x : null;
  }

  /** 规范化有理数 {n: BigInt, d: BigInt>0, s: 'p/q'} */
  function rat(n, d) {
    if (d === 0n) throw new Error('[RationalCore] 零分母被拒绝');
    if (d < 0n) { n = -n; d = -d; }
    const g = bigGcd(n, d) || 1n;
    n = n / g; d = d / g;
    return { n, d };
  }

  /** number → 精确 dyadic 有理数（m·2^e）。NaN/Infinity 拒绝。 */
  function ratFromNumber(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('[RationalCore] 非有限数值被拒绝: ' + x);
    if (Number.isInteger(x)) return rat(BigInt(x), 1n);
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, x);
    let bits = buf.getBigUint64(0);
    const sign = (bits >> 63n) === 1n ? -1n : 1n;
    const exp = Number((bits >> 52n) & 0x7ffn);
    let mant = bits & 0xfffffffffffffn;
    let e;
    if (exp === 0) { e = -1074; } else { mant |= 1n << 52n; e = exp - 1075; }
    let n = sign * mant, d = 1n;
    if (e > 0) n <<= BigInt(e); else d <<= BigInt(-e);
    return rat(n, d);
  }

  /** 'p/q' | '-3/7' | '5' | {n,d}|number → rat */
  function ratFrom(v) {
    if (typeof v === 'number') return ratFromNumber(v);
    if (typeof v === 'bigint') return rat(v, 1n);
    if (typeof v === 'string') {
      const t = v.trim();
      const m = t.match(/^([+-]?\d+)(?:\s*\/\s*([+-]?\d+))?$/);
      if (!m) throw new Error('[RationalCore] 无法解析为精确有理数: "' + v + '"');
      return rat(BigInt(m[1]), m[2] ? BigInt(m[2]) : 1n);
    }
    if (v && typeof v === 'object' && 'n' in v && 'd' in v) return rat(BigInt(v.n), BigInt(v.d));
    throw new Error('[RationalCore] 不支持的输入类型: ' + JSON.stringify(v));
  }

  const R = {
    zero: { n: 0n, d: 1n }, one: { n: 1n, d: 1n },
    from: ratFrom,
    isZero: (a) => a.n === 0n,
    eq: (a, b) => a.n === b.n && a.d === b.d,
    neg: (a) => ({ n: -a.n, d: a.d }),
    add: (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d),
    sub: (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d),
    mul: (a, b) => rat(a.n * b.n, a.d * b.d),
    div: (a, b) => { if (b.n === 0n) throw new Error('[RationalCore] 除零'); return rat(a.n * b.d, a.d * b.n); },
    sign: (a) => (a.n > 0n ? 1 : a.n < 0n ? -1 : 0),
    cmp: (a, b) => R.sign(R.sub(a, b)),
    /** 精确字符串 'p/q'（q=1 时 'p'） */
    str: (a) => (a.d === 1n ? a.n.toString() : a.n.toString() + '/' + a.d.toString()),
    /** 展示用浮点（仅显示，不参与判定） */
    approx: (a) => Number(a.n) / Number(a.d)
  };

  // ---------- 矩阵（通用 n 阶，元素为有理数） ----------
  const M = {
    /** elements: number[][] | string[][] | rat[][]（行主序）→ rat 矩阵 */
    from(elements) {
      if (!Array.isArray(elements) || !elements.length || !elements.every((r) => Array.isArray(r) && r.length === elements[0].length)) {
        throw new Error('[RationalCore] 矩阵必须为非空方形/矩形二维数组');
      }
      return elements.map((row) => row.map(ratFrom));
    },
    rows(m) { return m.length; },
    cols(m) { return m[0].length; },
    isSquare(m) { return M.rows(m) === M.cols(m); },
    eq(a, b) {
      if (M.rows(a) !== M.rows(b) || M.cols(a) !== M.cols(b)) return false;
      for (let i = 0; i < a.length; i++) for (let j = 0; j < a[0].length; j++) if (!R.eq(a[i][j], b[i][j])) return false;
      return true;
    },
    mul(a, b) {
      const n = M.rows(a), k = M.cols(a), c = M.cols(b);
      if (k !== M.rows(b)) throw new Error('[RationalCore] 维度不匹配');
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push([]);
        for (let j = 0; j < c; j++) {
          let s = R.zero;
          for (let t = 0; t < k; t++) s = R.add(s, R.mul(a[i][t], b[t][j]));
          out[i].push(s);
        }
      }
      return out;
    },
    pow(a, p) {
      if (!M.isSquare(a)) throw new Error('[RationalCore] 幂运算要求方阵');
      if (!Number.isInteger(p) || p < 0) throw new Error('[RationalCore] 仅支持非负整数幂');
      let r = M.identity(M.rows(a));
      for (let i = 0; i < p; i++) r = M.mul(r, a);
      return r;
    },
    identity(n) {
      const out = [];
      for (let i = 0; i < n; i++) { const row = []; for (let j = 0; j < n; j++) row.push(i === j ? R.one : R.zero); out.push(row); }
      return out;
    },
    add(a, b) { return a.map((r, i) => r.map((x, j) => R.add(x, b[i][j]))); },
    sub(a, b) { return a.map((r, i) => r.map((x, j) => R.sub(x, b[i][j]))); },
    scale(a, k) { return a.map((r) => r.map((x) => R.mul(x, k))); },
    trace(m) { let s = R.zero; for (let i = 0; i < M.rows(m); i++) s = R.add(s, m[i][i]); return s; },

    /** 精确行列式（方阵，整数余子式展开 / 2×3 直接公式；通用走 Bareiss 分数自由消元） */
    det(m) {
      const n = M.rows(m);
      if (n !== M.cols(m)) throw new Error('[RationalCore] det 要求方阵');
      if (n === 1) return m[0][0];
      if (n === 2) return R.sub(R.mul(m[0][0], m[1][1]), R.mul(m[0][1], m[1][0]));
      // Bareiss 算法：全程整数，无分数膨胀
      let a = m.map((r) => r.map((x) => x.n)), d = m.map((r) => r.map((x) => x.d));
      let den = 1n; // 公分母（各行元素 d 的乘积）
      for (let i = 0; i < n; i++) { let rowDen = 1n; for (let j = 0; j < n; j++) rowDen = rowDen * d[i][j] / bigGcd(rowDen, d[i][j]); for (let j = 0; j < n; j++) { d[i][j] = rowDen / d[i][j]; } den *= rowDen; }
      const A = a.map((r, i) => r.map((x, j) => x * d[i][j]));
      let prev = 1n, sign = 1n;
      for (let k = 0; k < n - 1; k++) {
        if (A[k][k] === 0n) {
          let swap = -1;
          for (let i = k + 1; i < n; i++) if (A[i][k] !== 0n) { swap = i; break; }
          if (swap < 0) return R.zero;
          [A[k], A[swap]] = [A[swap], A[k]];
          sign = -sign;
        }
        for (let i = k + 1; i < n; i++) {
          for (let j = k + 1; j < n; j++) {
            A[i][j] = (A[i][j] * A[k][k] - A[i][k] * A[k][j]) / prev;
          }
          A[i][k] = 0n;
        }
        prev = A[k][k];
      }
      return rat(sign * A[n - 1][n - 1], den);
    },

    /** 精确 RREF（行简化阶梯）与主元列 */
    rref(m) {
      const rows = M.rows(m), cols = M.cols(m);
      const A = m.map((r) => r.slice());
      const pivots = [];
      let r = 0;
      for (let c = 0; c < cols && r < rows; c++) {
        let sel = -1;
        for (let i = r; i < rows; i++) if (!R.isZero(A[i][c])) { sel = i; break; }
        if (sel < 0) continue;
        [A[r], A[sel]] = [A[sel], A[r]];
        const pv = A[r][c];
        for (let j = 0; j < cols; j++) A[r][j] = R.div(A[r][j], pv);
        for (let i = 0; i < rows; i++) {
          if (i !== r && !R.isZero(A[i][c])) {
            const f = A[i][c];
            for (let j = 0; j < cols; j++) A[i][j] = R.sub(A[i][j], R.mul(f, A[r][j]));
          }
        }
        pivots.push(c);
        r++;
      }
      return { matrix: A, pivots };
    },

    rank(m) { return M.rref(m).pivots.length; },

    /** 精确逆（不存在返回 null） */
    inverse(m) {
      const n = M.rows(m);
      if (!M.isSquare(m)) return null;
      if (R.isZero(M.det(m))) return null;
      const aug = m.map((r, i) => r.concat(M.identity(n)[i]));
      const { matrix } = M.rref(aug);
      return matrix.map((r) => r.slice(n));
    },

    /** 精确零空间基（返回整数向量组，经 lcm 缩放去分母） */
    nullBasis(m) {
      const rows = M.rows(m), cols = M.cols(m);
      const { matrix, pivots } = M.rref(m);
      const free = [];
      for (let j = 0; j < cols; j++) if (!pivots.includes(j)) free.push(j);
      const basis = [];
      for (const f of free) {
        const v = new Array(cols).fill(R.zero);
        v[f] = R.one;
        for (let i = 0; i < pivots.length; i++) {
          v[pivots[i]] = R.neg(matrix[i][f]);
        }
        // lcm 去分母 → 整数向量（规范：首非零元为正）
        let l = 1n;
        for (const x of v) l = l * x.d / bigGcd(l, x.d);
        const iv = v.map((x) => (x.n * (l / x.d)));
        const firstNz = iv.find((x) => x !== 0n);
        if (firstNz && firstNz < 0n) for (let i = 0; i < iv.length; i++) iv[i] = -iv[i];
        basis.push(iv);
      }
      return basis;
    },

    /** 特征多项式系数（升幂 c0..cn，精确）：charpoly(λ)=det(λI−A)=Σ ck·λ^k（Faddeev–LeVerrier 递推） */
    charpoly(m) {
      const n = M.rows(m);
      if (!M.isSquare(m)) throw new Error('[RationalCore] charpoly 要求方阵');
      const coef = [];
      let Mprev = M.identity(n);
      coef[n] = R.one;
      for (let k = 1; k <= n; k++) {
        const Mk2 = M.mul(m, Mprev);
        const tr = M.trace(Mk2);
        const ck = R.div(R.neg(tr), R.from(k));
        coef[n - k] = ck;
        Mprev = M.add(Mk2, M.scale(M.identity(n), ck));
      }
      return coef; // coef[k] 为 λ^k 的系数
    },

    /**
     * 有理特征根（含重数，按数值序）。
     * 算法：先剥离 λ=0 的重数（= n−rank 精确），再对降次多项式**逐根精确消去**
     * （有理根定理找一根 → 合成除法除以 (λ−r) → 循环），直至无有理根。
     * 审计修复 2026-10-11：旧实现按"互异根"计数，diag(2,2)/单位阵等重根矩阵
     * 被误判 needs_symbolic、丢重数。
     */
    rationalEigenvalues(m) {
      const n = M.rows(m);
      const coef = M.charpoly(m); // λ^0 .. λ^n（升幂）
      const mult0 = n - M.rank(m); // λ=0 的精确重数
      const roots = [];
      for (let i = 0; i < mult0; i++) roots.push(R.zero);
      let work = coef.slice(mult0); // 降次：除以 λ^mult0
      while (work.length > 1) {
        const r = M.findOneRationalRoot(work);
        if (!r) break;
        roots.push(r);
        work = M.deflateByRoot(work, r); // 精确合成除法，保留重数
      }
      roots.sort((x, y) => R.cmp(x, y));
      return roots;
    },

    /** 在（整/有理系数）多项式中找**一个**有理根；找不到返回 null；位长超限抛守卫异常 */
    findOneRationalRoot(coef) {
      let L = 1n;
      for (const c of coef) L = L * c.d / bigGcd(L, c.d);
      const icoef = coef.map((c) => c.n * (L / c.d));
      const a0 = icoef[0], an = icoef[icoef.length - 1];
      const bitLen = (x) => bigAbs(x).toString(2).length;
      if (bitLen(a0) > 40 || bitLen(an) > 40) {
        throw new Error('RATIONAL_ROOT_SEARCH_TOO_LARGE（候选因子位长超限，转符号内核）');
      }
      const divisors = (num) => {
        num = bigAbs(num);
        const out = [];
        for (let i = 1n; i * i <= num; i++) if (num % i === 0n) { out.push(i, num / i); }
        return [...new Set(out)];
      };
      const ps = divisors(a0), qs = divisors(an);
      const deg = icoef.length - 1;
      const isRoot = (pn, qd) => {
        let num = 0n, denPow = 1n;
        for (let k = deg; k >= 0; k--) { num = num * pn + icoef[k] * denPow; denPow *= qd; }
        return num === 0n;
      };
      for (const p of ps) for (const q of qs) {
        if (q === 0n) continue;
        for (const sg of [1n, -1n]) {
          if (isRoot(sg * p, q)) return rat(sg * p, q);
        }
      }
      return null;
    },

    /** 精确合成除法：多项式（升幂）除以 (λ − r)，断言整除，返回商（升幂，次数 −1） */
    deflateByRoot(coef, r) {
      const d = coef.length - 1;
      const b = new Array(d); // b[k] 为商的 λ^k 系数（升幂）
      b[d - 1] = coef[d];
      for (let k = d - 1; k >= 1; k--) {
        // b_{k-1} = a_k + r·b_k
        b[k - 1] = R.add(coef[k], R.mul(r, b[k]));
      }
      const rem = R.add(coef[0], R.mul(r, b[0]));
      if (!R.isZero(rem)) throw new Error('[RationalCore] deflateByRoot 断言失败：非整除（内部缺陷）');
      return b.slice(); // 升幂商系数
    },

    /** 矩阵·向量（精确） */
    applyVec(m, v) {
      const col = v.map(ratFrom);
      if (col.length !== M.cols(m)) throw new Error('[RationalCore] 向量维度不匹配');
      return M.mul(m, col.map((x) => [x])).map((r) => r[0]);
    },

    toStrMatrix(m) { return m.map((r) => r.map(R.str)); },
    toApproxMatrix(m) { return m.map((r) => r.map(R.approx)); }
  };
  function c0Of(coef) { return coef[0]; }
  function cnOf(coef) { return coef[coef.length - 1]; }
  void cnOf; void c0Of; // 历史辅助（有理根定理改整系数枚举后不再使用，保留占位以待全量清理）

  // ---------- 2×2 / 3×3 统一分析 ----------
  /**
   * analyze(elements) —— 全精确分析（X4/X5/X6 契约）
   * 返回 {
   *   kernel: 'rational-core', version: 1,
   *   n, det: ratStr, detApprox, rank, nullity, isSingular, trace: ratStr,
   *   nullBasis: BigInt[][]（整数基向量）, inverse: string[][] | null,
   *   charpoly: string[]（升幂系数）, eigenvalues: {values: string[], kind: 'rational'|'irrational'|'needs_symbolic', note?},
   *   reproducible: { inputCanonical, ops: [...] }
   * }
   */
  function analyze(elements, opts = {}) {
    const m = M.from(elements);
    if (!M.isSquare(m)) throw new Error('[RationalCore] analyze 仅支持方阵（2×2/3×3）');
    const n = M.rows(m);
    const det = M.det(m);
    const rank = M.rank(m);
    const inv = M.inverse(m);
    const nullB = M.nullBasis(m);
    const trace = M.trace(m);
    const cp = M.charpoly(m);
    // 特征根：有理根定理
    let eigen = { values: [], kind: 'rational', note: null };
    try {
      const ratVals = M.rationalEigenvalues(m);
      if (ratVals.length === n) {
        eigen.values = ratVals.map(R.str);
      } else if (n === 2) {
        // λ² − tr·λ + det：判别式 Δ = tr² − 4det
        const tr2 = R.mul(trace, trace);
        const disc = R.sub(tr2, R.mul(R.from(4), det));
        const dn = R.mul(disc, rat(1n, 1n)); // 保持 rat
        const num = dn.n, den = dn.d; // Δ = num/den，den>0
        const sqNum = bigSqrt(bigAbs(num)), sqDen = bigSqrt(den);
        if (R.isZero(disc)) {
          eigen.values = [R.div(trace, R.from(2))].map(R.str);
        } else if (R.sign(disc) < 0) {
          eigen.kind = 'irrational';
          eigen.note = '判别式 Δ=' + R.str(disc) + ' < 0，特征值为共轭复数（实 2×2 旋转型），教学域标注为无实特征向量';
        } else if (sqNum && sqDen) {
          // Δ > 0 且为有理完全平方 → 两根均有理（此分支仅在有理根定理触发位长守卫时兜底；数值序）
          const sq = rat(sqNum, sqDen);
          const roots = [R.div(R.add(trace, sq), R.from(2)), R.div(R.sub(trace, sq), R.from(2))];
          roots.sort((x, y) => R.cmp(x, y));
          eigen.values = roots.map(R.str);
        } else {
          eigen.kind = 'irrational';
          eigen.note = '判别式 Δ=' + R.str(disc) + ' > 0 且非完全平方，根为无理数，需符号内核给出精确根式';
        }
      } else {
        eigen.kind = 'needs_symbolic';
        eigen.note = '3×3 特征根存在非有理根（' + ratVals.length + '/' + n + ' 个有理根已找到），完整根式解需符号内核（SymPy）';
        eigen.values = ratVals.map(R.str);
      }
    } catch (e) {
      eigen = { values: [], kind: 'needs_symbolic', note: '特征根求解异常：' + e.message };
    }
    return {
      kernel: 'rational-core',
      version: 1,
      n,
      det: R.str(det),
      detApprox: R.approx(det),
      isSingular: R.isZero(det),
      rank,
      nullity: n - rank,
      trace: R.str(trace),
      nullBasis: nullB.map((v) => v.map((x) => x.toString())),
      inverse: inv ? M.toStrMatrix(inv) : null,
      charpoly: cp.map(R.str),
      eigenvalues: eigen,
      reproducible: {
        inputCanonical: M.toStrMatrix(m),
        ops: ['det', 'rref->rank/nullBasis', 'inverse', 'charpoly(FaddeevLeVerrier)', 'rationalRootTheorem'],
        note: opts.note || '精确有理算术，无 eps，同输入必同输出'
      }
    };
  }

  return { R, M, analyze, VERSION: '1.0.0' };
});
