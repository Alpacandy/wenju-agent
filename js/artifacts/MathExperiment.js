/** Shared 2×2 numerical kernel and offline interactive document factory. */
(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MathExperiment = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";
  function kernel() {
    const types = ["linear-map", "composition", "system", "eigen"];
    function vector(v, length) {
      if (!Array.isArray(v) || v.length !== length || v.some((x) => typeof x !== "number" || !Number.isFinite(x) || Math.abs(x) > 20)) throw new Error("EXPERIMENT_INPUT_INVALID: 输入须为 [-20,20] 内有限数值");
      return v.slice();
    }
    function normalize(spec) {
      if(spec?.type==='linear-map-3d')return (typeof module==='object'&&module.exports?require('./MathScene3D.js'):globalThis.MathScene3D).normalize(spec);
      if (!spec || !types.includes(spec.type)) throw new Error("EXPERIMENT_TYPE_UNSUPPORTED");
      return { type: spec.type, A: vector(spec.A || [1, 1, 0, 1], 4), B: vector(spec.B || [0, -1, 1, 0], 4), v: vector(spec.v || [1, 1], 2), b: vector(spec.b || [2, 2], 2) };
    }
    const apply = (A, v) => [A[0] * v[0] + A[1] * v[1], A[2] * v[0] + A[3] * v[1]];
    const multiply = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3]];
    const det = (A) => A[0] * A[3] - A[1] * A[2];
    const rank = (A) => Math.abs(det(A)) > 1e-9 * Math.max(1, ...A.map(Math.abs)) ** 2 ? 2 : A.some((x) => Math.abs(x) > 1e-9) ? 1 : 0;
    function evaluate(raw) {
      if(raw?.type==='linear-map-3d')return (typeof module==='object'&&module.exports?require('./MathScene3D.js'):globalThis.MathScene3D).evaluate(raw);
      const s = normalize(raw), A = s.A, determinant = det(A), r = rank(A), Av = apply(A, s.v);
      const out = { ...s, determinant, rank: r, nullity: 2 - r, Av, residual: Av.map((x, i) => x - s.b[i]), tolerance: 1e-9 };
      if (s.type === "composition") {
        out.AB = multiply(A, s.B);
        out.BA = multiply(s.B, A);
        out.commutator = out.AB.map((x, i) => x - out.BA[i]);
        out.commutes = out.commutator.every((x) => Math.abs(x) <= 1e-9);
      }
      if (s.type === "system") {
        const augmented = [A[0] * s.b[1] - A[2] * s.b[0], A[1] * s.b[1] - A[3] * s.b[0]];
        out.rankAugmented = r === 2 ? 2 : augmented.some((x) => Math.abs(x) > 1e-9) ? 2 : r === 0 && s.b.some((x) => Math.abs(x) > 1e-9) ? 1 : r;
        out.solutionType = r < out.rankAugmented ? "none" : r === 2 ? "unique" : "infinite";
        out.solution = out.solutionType === "unique" ? [(s.b[0] * A[3] - A[1] * s.b[1]) / determinant, (A[0] * s.b[1] - s.b[0] * A[2]) / determinant] : null;
      }
      if (s.type === "eigen") {
        out.trace = A[0] + A[3];
        out.discriminant = out.trace ** 2 - 4 * determinant;
        out.eigenvalues = out.discriminant < -1e-9 ? [] : [(out.trace + Math.sqrt(Math.max(0, out.discriminant))) / 2, (out.trace - Math.sqrt(Math.max(0, out.discriminant))) / 2];
        out.eigenvectors = out.eigenvalues.map((l, i) => {
          let v = Math.abs(A[1]) > 1e-9 ? [A[1], l - A[0]] : Math.abs(A[2]) > 1e-9 ? [l - A[3], A[2]] : Math.abs(A[0] - l) < 1e-9 ? [1, 0] : [0, 1];
          if (out.discriminant === 0 && A[1] === 0 && A[2] === 0) v = i ? [0, 1] : [1, 0];
          const n = Math.hypot(...v);
          return v.map((x) => x / n);
        });
      }
      return out;
    }
    return { normalize, evaluate, apply, multiply, det, rank };
  }
  const math = kernel();
  const titles = { "linear-map": "线性变换 · 把矩阵变成动作", composition: "矩阵复合 · 顺序改变了什么", system: "方程组 · 两条直线的交点", eigen: "特征方向 · 变换中的不变轴" };
  function create(raw, options = {}) {
    const base=math.normalize(raw),sceneApi=typeof module==='object'&&module.exports?require('./MathScene.js'):globalThis.MathScene;
    const spec=base.type==='linear-map-3d'?base:sceneApi.normalize(raw),title=titles[spec.type];
    const documentApi = typeof module === 'object' && module.exports ? require('./NativeMathDocument.js') : globalThis.NativeMathDocument;
    if (!documentApi) throw new Error('NATIVE_MATH_DOCUMENT_UNAVAILABLE');
    return documentApi.create(spec.type==='linear-map-3d'?'linear3d':'math', spec, {artifactId:options.artifactId || 'math-'+spec.type,title:spec.type==='linear-map-3d'?'三维线性变换 · 单位立方体':title,meta:{mathExperiment:spec}});
  }
  return { ...math, create, titles };
});
