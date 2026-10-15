/**
 * VariantTaskBank —— 无提示变式任务库（P2 T2.6，TRANSFER 态）
 *
 * 每任务附精确判定器（RationalCore，无浮点容差）；计分只走 exact 比较。
 * 四章 × ≥2 变式；relatedMisconceptions 关联 MisconceptionLibrary 条目（诊断联动）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VariantTaskBank = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  let RC = null;
  try { RC = require('../math/RationalCore.js'); } catch (e) { if (typeof RationalCore !== 'undefined') RC = RationalCore; }

  const st = (m) => RC.M.toStrMatrix(m);

  const TASKS = [
    // —— 第一章 矩阵运算 ——
    {
      id: 'VT-101', chapter: '矩阵运算', noHint: true,
      stem: 'A=[[1,2],[0,1]]，B=[[2,0],[1,1]]。无提示变式：A²−B² 与 (A−B)(A+B) 相等吗？给出你的判定与理由。',
      relatedMisconceptions: ['MC-010', 'MC-001'],
      check(answer) {
        const A = RC.M.from([[1, 2], [0, 1]]), B = RC.M.from([[2, 0], [1, 1]]);
        const lhs = RC.M.sub(RC.M.pow(A, 2), RC.M.pow(B, 2));
        const rhs = RC.M.mul(RC.M.sub(A, B), RC.M.add(A, B));
        const equal = RC.M.eq(lhs, rhs);
        const expected = equal ? '相等' : '不相等';
        // 无提示计分：答"不相等/false"当且仅当精确判定确实不等。
        // 契约（审计修复）：actual 恒为学生答案文本；机器细节入 detail（旧实现返回对象，致反馈显示 [object Object]）
        const passed = equal ? !/不相等|false/i.test(answer) : /不相等|false/i.test(answer);
        return { passed: passed && String(answer).trim() !== '', expected, actual: String(answer).trim(), detail: { lhs: st(lhs), rhs: st(rhs), equal } };
      }
    },
    {
      id: 'VT-102', chapter: '矩阵运算', noHint: true,
      stem: 'A=[[2,0],[0,3]]。无提示变式：det(5A) 等于多少？写出精确值。',
      relatedMisconceptions: ['MC-005'],
      check(answer) {
        const detA = RC.M.det(RC.M.from([[2, 0], [0, 3]])); // 6
        const det5A = RC.M.det(RC.M.from([[10, 0], [0, 15]])); // 150
        const expected = RC.R.str(det5A);
        const passed = String(answer).trim() === expected || String(answer).trim() === '150';
        return { passed, expected, actual: String(answer).trim() };
      }
    },
    {
      id: 'VT-103', chapter: '矩阵运算', noHint: true,
      stem: '无提示变式：存在 2×2 实矩阵 A,B 满足 AB≠BA 但 (AB)²=A²B² 吗？给出矩阵或说明不存在。',
      relatedMisconceptions: ['MC-009', 'MC-001'],
      check(answer) {
        const A = RC.M.from([[1, 0], [0, 0]]), B = RC.M.from([[0, 1], [0, 0]]);
        const ok = !RC.M.eq(RC.M.mul(A, B), RC.M.mul(B, A)) && RC.M.eq(RC.M.pow(RC.M.mul(A, B), 2), RC.M.mul(RC.M.pow(A, 2), RC.M.pow(B, 2)));
        const said = /存在/.test(answer) && !/不存在/.test(answer);
        return { passed: ok && said, expected: '存在（例：A=[[1,0],[0,0]], B=[[0,1],[0,0]]，AB≠BA 而 (AB)²=A²B²=O）', actual: String(answer).trim(), verifiedByExample: ok };
      }
    },
    // —— 第二章 线性方程组与秩 ——
    {
      id: 'VT-201', chapter: '线性方程组与秩', noHint: true,
      stem: 'A=[[1,2],[2,4]]，b=[3,7]。无提示变式：Ax=b 有唯一解、无解还是无穷多解？说明秩判定依据。',
      relatedMisconceptions: ['MC-013', 'MC-014'],
      check(answer) {
        const rA = RC.M.rank(RC.M.from([[1, 2], [2, 4]])); // 1
        const rAb = RC.M.rank(RC.M.from([[1, 2, 3], [2, 4, 7]])); // 2
        const expected = rA === rAb ? (rA < 2 ? '无穷多解' : '唯一解') : '无解';
        const passed = String(answer).includes(expected);
        return { passed, expected, actual: String(answer).trim(), ranks: { rA, rAb } };
      }
    },
    {
      id: 'VT-202', chapter: '线性方程组与秩', noHint: true,
      stem: 'A=[[1,2],[2,4]]，b=[3,6]。无提示变式：Ax=b 的解集维数是多少？',
      relatedMisconceptions: ['MC-014'],
      check(answer) {
        // 精确计算解集分类（审计修复：原实现硬编码秩——无提示计分必须真算）
        const rA = RC.M.rank(RC.M.from([[1, 2], [2, 4]]));
        const rAb = RC.M.rank(RC.M.from([[1, 2, 3], [2, 4, 6]]));
        const consistent = rA === rAb;
        const expected = !consistent ? '无解' : (rA < 2 ? '无穷多解（1 个自由变量，解集维数 1）' : '唯一解');
        const passed = consistent && rA < 2 && /无穷多|1\s*个自由/.test(answer);
        return { passed, expected, actual: String(answer).trim(), ranks: { rA, rAb } };
      }
    },
    // —— 第三章 线性相关性 ——
    {
      id: 'VT-301', chapter: '线性相关性', noHint: true,
      stem: 'v₁=(1,0)，v₂=(0,1)，v₃=(1,1)。无提示变式：{v₁,v₂,v₃} 线性相关还是无关？',
      relatedMisconceptions: ['MC-018', 'MC-020'],
      check(answer) {
        // 以 vᵢ 为列的 2×3 矩阵秩 < 3 ⟹ 相关
        const rank = RC.M.rank(RC.M.from([[1, 0, 1], [0, 1, 1]])); // 2 < 3
        const expected = '线性相关';
        const passed = /相关/.test(answer) && !/无关/.test(answer);
        return { passed, expected, actual: String(answer).trim(), rank };
      }
    },
    {
      id: 'VT-302', chapter: '线性相关性', noHint: true,
      stem: '无提示变式：ℝ² 中任何 3 个向量一定线性相关吗？给出理由（一两句）。',
      relatedMisconceptions: ['MC-020'],
      check(answer) {
        const expected = '是：向量个数 3 > 维数 2，秩 ≤ 2 < 3';
        const passed = /一定|必|是/.test(answer) && /相关/.test(answer) && !/不一定|无关/.test(answer);
        return { passed, expected, actual: String(answer).trim() };
      }
    },
    // —— 第四章 特征值与对角化 ——
    {
      id: 'VT-401', chapter: '特征值与对角化', noHint: true,
      stem: 'A=[[2,0],[0,3]]。无提示变式：写出全部特征值（精确值）。',
      relatedMisconceptions: ['MC-024'],
      check(answer) {
        const r = RC.analyze([[2, 0], [0, 3]]);
        const expected = r.eigenvalues.values.join(','); // '2,3'
        const nums = String(answer).match(/-?\d+(?:\/\d+)?/g) || [];
        const passed = r.eigenvalues.values.every((v) => nums.includes(v)) && nums.length >= 2;
        return { passed, expected, actual: String(answer).trim() };
      }
    },
    {
      id: 'VT-402', chapter: '特征值与对角化', noHint: true,
      stem: 'A=[[2,1],[0,2]]。无提示变式：A 可对角化吗？依据是什么？',
      relatedMisconceptions: ['MC-032', 'MC-023'],
      check(answer) {
        // A−2I=[[0,1],[0,0]] 秩 1 → 几何重数 1 < 2 → 不可对角化
        const geo = 2 - RC.M.rank(RC.M.from([[0, 1], [0, 0]])); // 1
        const expected = '不可对角化（特征值 2 二重，几何重数 1 < 代数重数 2）';
        const a = String(answer).trim();
        const passed = (/不可对角化|不能对角化/.test(a)) && !/^(可以|可对角化)/.test(a);
        return { passed, expected, actual: a, geometricMultiplicity: geo };
      }
    }
  ];

  return {
    all() { return TASKS.map(({ check, ...t }) => ({ ...t })); },
    byId(id) { const t = TASKS.find((x) => x.id === id); return t || null; },
    byChapter(ch) { return TASKS.filter((t) => t.chapter === ch).map(({ check, ...t }) => ({ ...t })); },
    size() { return TASKS.length; },
    chapters() { return [...new Set(TASKS.map((t) => t.chapter))]; },
    /** 无提示计分：精确判定，无部分分 */
    grade(id, answer) {
      const t = this.byId(id);
      if (!t) return { passed: false, error: 'UNKNOWN_TASK' };
      return t.check(answer);
    }
  };
});
