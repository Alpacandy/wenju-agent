/** Executable lesson specifications; grades are calculated from the given inputs. */
(function(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("../artifacts/MathExperiment.js") : root.MathExperiment);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CourseLibrary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function(math) {
  "use strict";
  const lessons = [
    {
      id: "basis",
      chapter: "矩阵运算",
      title: "从两列读出向量的像",
      nodes: ["basis", "transform"],
      goal: "用矩阵的列向量解释 Av，拖动基向量并观察单位圆的像。",
      practice: { spec: { type: "linear-map", A: [2, 1, 0, 1], v: [1, 2] }, question: "A = [[2,1],[0,1]]，v = (1,2)。计算 Av，按 x, y 输入。", check: "Av" },
      transfer: { spec: { type: "linear-map", A: [-1, 2, 1, 0], v: [2, -1] }, question: "A = [[-1,2],[1,0]]，v = (2,-1)。计算 Av，按 x, y 输入。", check: "Av" }
    },
    {
      id: "composition",
      chapter: "矩阵运算",
      title: "先旋转，还是先剪切",
      nodes: ["composition"],
      goal: "比较 AB 与 BA 的单位圆像；实验检验一个反例，不把单例当一般证明。",
      practice: { spec: { type: "composition", A: [1, 1, 0, 1], B: [0, -1, 1, 0] }, question: "A = [[1,1],[0,1]]，B = [[0,-1],[1,0]]。按行输入 AB 的四个元素。", check: "AB" },
      transfer: { spec: { type: "composition", A: [2, 0, 0, 1], B: [1, 1, 0, 1] }, question: "A = diag(2,1)，B = [[1,1],[0,1]]。按行输入 BA 的四个元素。", check: "BA" }
    },
    {
      id: "det",
      chapter: "矩阵运算",
      title: "面积消失的边界",
      nodes: ["det"],
      goal: "将一列拖到另一列方向，观察 det 与维数；区分几何观察与作答核验。",
      practice: { spec: { type: "linear-map", A: [2, 1, 1, 2] }, question: "A = [[2,1],[1,2]]。输入 det(A)。", check: "determinant" },
      transfer: { spec: { type: "linear-map", A: [2, 4, 1, 2] }, question: "A = [[2,4],[1,2]]。输入 det(A)。", check: "determinant" }
    },
    {
      id: "system",
      chapter: "线性方程组与秩",
      title: "交点、平行与重合",
      nodes: ["sys_linear_eq"],
      goal: "编辑方程右端 b，比较系数矩阵与增广矩阵的秩，判断解集。",
      practice: { spec: { type: "system", A: [1, 1, 2, 2], b: [3, 6] }, question: "x+y=3，2x+2y=6。输入 rank(A), rank([A|b])。", check: "ranks" },
      transfer: { spec: { type: "system", A: [1, 1, 2, 2], b: [3, 7] }, question: "x+y=3，2x+2y=7。输入 rank(A), rank([A|b])。", check: "ranks" }
    },
    {
      id: "independence",
      chapter: "线性相关性",
      title: "两列能否张成整个平面",
      nodes: ["linear_indep", "colspace"],
      goal: "拖动两列，比较秩与零度；核验 rank + nullity = 2。",
      practice: { spec: { type: "linear-map", A: [1, 2, 2, 4] }, question: "列向量 (1,2)、(2,4) 构成 A。输入 rank(A), nullity(A)。", check: "dimensions" },
      transfer: { spec: { type: "linear-map", A: [1, 1, 0, 1] }, question: "列向量 (1,0)、(1,1) 构成 A。输入 rank(A), nullity(A)。", check: "dimensions" }
    },
    {
      id: "nullspace",
      chapter: "线性相关性",
      title: "什么向量会被映到原点",
      nodes: ["nullspace"],
      goal: "输入一个非零核向量，用 Av 的回读检验；变式改变核方向。",
      practice: { spec: { type: "linear-map", A: [1, 2, 2, 4] }, question: "A = [[1,2],[2,4]]。输入任意非零核向量 x, y，使 Av = 0。", check: "kernel" },
      transfer: { spec: { type: "linear-map", A: [2, -1, 4, -2] }, question: "A = [[2,-1],[4,-2]]。输入任意非零核向量 x, y，使 Av = 0。", check: "kernel" }
    },
    {
      id: "eigen",
      chapter: "特征值与对角化",
      title: "寻找不改变方向的向量",
      nodes: ["eigen"],
      goal: "观察实特征方向，计算特征值；不把任意满秩矩阵误判为可对角化。",
      practice: { spec: { type: "eigen", A: [2, 1, 0, 1] }, question: "A = [[2,1],[0,1]]。输入两个实特征值，顺序不限。", check: "eigenvalues" },
      transfer: { spec: { type: "eigen", A: [3, 0, 1, -1] }, question: "A = [[3,0],[1,-1]]。输入两个实特征值，顺序不限。", check: "eigenvalues" }
    }
  ];
  function get(id) {
    return lessons.find((l) => l.id === id) || null;
  }
  function forNode(id) {
    return lessons.find((l) => l.nodes.includes(id)) || null;
  }
  function grade(id, phase, answer, { spec } = {}) {
    const lesson = get(id), problem = lesson && lesson[phase];
    if (!problem || !["practice", "transfer"].includes(phase)) return { ok: false, code: "COURSE_PROBLEM_UNKNOWN" };
    const raw = String(answer ?? "");
    const str = raw.trim().replace(/[，、；;]/g, ',').replace(/[（）()]/g, ' ');
    if (!str || raw.length > 256 || !/^[\d\s+.,eE\[\]\-]+$/.test(str)) return { ok: false, code: "ANSWER_FORMAT", message: "请输入逗号分隔的数值，如 1, -2。" };
    const values = str.replace(/[\[\]]/g, " ").split(/[,\s]+/).filter(Boolean).map(Number);
    if (!values.length || values.some((x) => !Number.isFinite(x) || Math.abs(x) > 1e6)) return { ok: false, code: "ANSWER_FORMAT", message: "答案必须由有限数值组成。" };
    const r = math.evaluate(spec || problem.spec);
    if(r.type!==problem.spec.type) return {ok:false,code:'EXPERIMENT_TYPE_MISMATCH',message:'当前实验类型与题目不匹配。'};
    let expected;
    if (problem.check === "kernel") {
      if (values.length !== 2) return { ok: false, code: "ANSWER_DIMENSION", message: "核向量需要两个分量。" };
      const residual = math.apply(r.A, values);
      const norm = Math.hypot(...values), matrixNorm = Math.max(1, ...r.A.map(Math.abs));
      const relativeResidual = norm ? Math.hypot(...residual) / (matrixNorm * norm) : Infinity;
      return { ok: true, passed: norm > 1e-9 && relativeResidual <= 1e-8, actual: values, expected: "任意非零向量 v，满足 Av = (0,0)", residual, relativeResidual: Number.isFinite(relativeResidual) ? relativeResidual : null, nodes: lesson.nodes, problemId: id + ":" + phase };
    }
    expected = problem.check === "ranks" ? [r.rank, r.rankAugmented] : problem.check === "dimensions" ? [r.rank, r.nullity] : problem.check === "determinant" ? [r.determinant] : r[problem.check];
    if (values.length !== expected.length) return { ok: false, code: "ANSWER_DIMENSION", message: "需要 " + expected.length + " 个数值。" };
    const actual = problem.check === "eigenvalues" ? values.slice().sort((a, b) => a - b) : values;
    const target = problem.check === "eigenvalues" ? expected.slice().sort((a, b) => a - b) : expected;
    return { ok: true, passed: actual.every((x, i) => Math.abs(x - target[i]) <= 1e-8), actual: values, expected, delta:actual.map((x,i)=>x-target[i]), nodes: lesson.nodes, problemId: id + ":" + phase };
  }
  function explain(id, phase, answer, {spec}={}) {
    const result=grade(id,phase,answer,{spec});
    if(!result.ok)return result;
    const problem=get(id)[phase],input=math.normalize(spec||problem.spec),r=math.evaluate(input),A=r.A;
    const fmt=n=>Number(n.toPrecision(10)).toString(),pair=v=>'('+v.map(fmt).join(', ')+')';
    const product=(a,b,c,d)=>`${fmt(a)} × ${fmt(b)} + ${fmt(c)} × ${fmt(d)} = ${fmt(a*b+c*d)}`;
    let evidence=[],label=problem.check;
    if(['Av','kernel'].includes(problem.check)) {
      const v=problem.check==='kernel'?result.actual:r.v;
      evidence=[`第一分量：${product(A[0],v[0],A[1],v[1])}`,`第二分量：${product(A[2],v[0],A[3],v[1])}`];
      if(problem.check==='kernel')evidence.push(`‖v‖ = ${fmt(Math.hypot(...v))}；相对残差 = ${result.relativeResidual===null?'不可计算':fmt(result.relativeResidual)}；要求 v 非零且相对残差 ≤ 1e-8。`);
      label=problem.check==='kernel'?'核向量 Av = 0':'Av';
    } else if(['AB','BA'].includes(problem.check)) {
      const L=problem.check==='AB'?A:r.B,R=problem.check==='AB'?r.B:A;
      for(let row=0;row<2;row++)for(let col=0;col<2;col++)evidence.push(`${problem.check}[${row+1},${col+1}]：${product(L[row*2],R[col],L[row*2+1],R[col+2])}`);
    } else if(['determinant','dimensions','ranks'].includes(problem.check)) {
      evidence=[`det(A) = ${fmt(A[0])} × ${fmt(A[3])} − ${fmt(A[1])} × ${fmt(A[2])} = ${fmt(r.determinant)}`];
      if(problem.check==='dimensions')evidence.push(`rank(A) = ${r.rank}；nullity(A) = 2 − rank(A) = ${r.nullity}`);
      if(problem.check==='ranks') {
        const minors=[A[0]*r.b[1]-A[2]*r.b[0],A[1]*r.b[1]-A[3]*r.b[0]];
        evidence.push(`增广矩阵另外两个二阶子式：${pair(minors)}；rank(A) = ${r.rank}，rank([A|b]) = ${r.rankAugmented}。`);
      }
      label={determinant:'det(A)',dimensions:'rank(A), nullity(A)',ranks:'rank(A), rank([A|b])'}[problem.check];
    } else if(problem.check==='eigenvalues') {
      label='实特征值';
      evidence=[`特征方程：λ² − (${fmt(r.trace)})λ + (${fmt(r.determinant)}) = 0`,`判别式 = ${fmt(r.discriminant)}；实特征值：${pair(r.eigenvalues)}`];
    }
    return {...result,input,label,evidence};
  }
  function retainAssessments(attempts) {
    const valid = attempts.filter((a) => a && typeof a.id === "string" && a.id.length <= 128 && typeof a.answer === "string" && grade(a.lessonId, a.phase, a.answer).ok);
    const checkpoints = /* @__PURE__ */ new Map();
    for (const a of valid) if (grade(a.lessonId, a.phase, a.answer).passed) checkpoints.set(a.lessonId + ":" + a.phase, a);
    const pinned = [...checkpoints.values()], ids = new Set(pinned.map((a) => a.id));
    for (const a of valid.filter((a2) => !ids.has(a2.id)).slice(-(200 - pinned.length))) ids.add(a.id);
    return valid.filter((a) => ids.has(a.id));
  }
  return { version: 1, lessons, get, forNode, grade, explain, retainAssessments };
});
