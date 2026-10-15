/**
 * ToolNeighborGuard —— 语义近邻工具守卫（P2 T2.7，Y7）
 *
 * 目标（BFCL V3 幻觉类目式负例的确定性落地）：
 * 诊断/探究流程中，近邻概念的查询必须路由到正确工具；无法判别时**显式拒答并追问**，
 * 绝不"就近挑一个"——工具越多误调用风险越高（arXiv:2504.00914）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ToolNeighborGuard = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  // 每条：判别关键词（必须至少命中其一才允许路由到该工具）+ 干扰近邻
  const ROUTES = [
    {
      tool: 'solve_matrix_kernel_sympy',
      keywords: ['零空间', '核空间', 'null space', 'kernel', 'nullspace'],
      neighbors: ['列空间', '行列式', '秩']
    },
    {
      tool: 'drive_canvas_affine_transform',
      keywords: ['拖', '画布变换', '补间', '降维', 'singular', '演示.{0,8}变换'],
      neighbors: ['渲染图元', '求解']
    },
    {
      tool: 'construct_counterexample_matrix',
      keywords: ['反例', 'counterexample', '构造.*矩阵', 'ab.*=.*o'],
      neighbors: ['验证', '求解']
    },
    {
      tool: 'solve_linear_system',
      keywords: ['方程组', '线性方程', '解.*ax *= *b', '增广'],
      neighbors: ['零空间', '特征']
    }
  ];

  /**
   * 分类查询 → {tool, matched, reason} | {tool:null, refused:true, reason}
   * 拒答语义：查询命中"近邻词但未命中判别词"→ 显式拒答并要求澄清（不允许猜测路由）。
   */
  function classify(query) {
    const q = String(query || '');
    const hits = [];
    for (const r of ROUTES) {
      if (r.keywords.some((k) => new RegExp(k, 'i').test(q))) hits.push(r.tool);
    }
    if (hits.length === 1) return { tool: hits[0], matched: true, reason: '判别词唯一命中' };
    if (hits.length > 1) {
      return { tool: null, refused: true, reason: '多工具同时命中判别词（' + hits.join(', ') + '）——歧义查询显式拒答，请澄清意图' };
    }
    // 无判别词命中：检查是否踩中任何近邻词（概念混淆征兆）
    const neighborHit = ROUTES.some((r) => r.neighbors.some((n) => q.includes(n)));
    if (neighborHit) {
      return { tool: null, refused: true, reason: '查询仅命中近邻概念词而无判别词——显式拒答并追问（防语义近邻误路由）' };
    }
    return { tool: null, refused: false, reason: '无工具命中（普通对话）' };
  }

  return { classify, ROUTES };
});
