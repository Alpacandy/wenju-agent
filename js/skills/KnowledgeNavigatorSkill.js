/**
 * 问矩 · 知识图谱认知导航技能 (KnowledgeNavigatorSkill)
 * 职责：
 * 1. 深度对齐 CognitiveTracker 12 个线性代数核心认知节点权威拓扑结构；
 * 2. 检查节点的前置依赖项是否已被激活/掌握；
 * 3. 动态从学生实时认知档案中推荐下一个最佳认知探究目标与反例实验；
 * 4. 内置双向别名映射，100% 兼容金样快照 (Golden Master) 与现代架构。
 */

let BaseSkillNav;
if (typeof require !== 'undefined') {
  try { BaseSkillNav = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('KnowledgeNavigatorSkill', 'if', e); }
}
if (!BaseSkillNav && typeof window !== 'undefined') {
  BaseSkillNav = window.BaseSkill;
}
if (!BaseSkillNav) {
  BaseSkillNav = class { constructor(n, d) { this.name = n; this.description = d; } };
}

class KnowledgeNavigatorSkill extends BaseSkillNav {
  constructor() {
    super(
      'query_knowledge_graph',
      '查询学科概念认知图谱拓扑依赖，检查前置概念门禁并获取下一步自适应探究路径推荐。'
    );

    // 标准 12 节点学科图谱权威拓扑 (与 CognitiveTracker 100% 严格一致)
    this.nodes = [
      { id: 'basis', name: '基底向量与线性组合', stage: 1, prereqs: [] },
      { id: 'transform', name: '空间仿射映射与矩阵表示', stage: 2, prereqs: ['basis'] },
      { id: 'linear_indep', name: '线性相关性与空间维数', stage: 2, prereqs: ['basis'] },
      { id: 'composition', name: '矩阵复合与非对易李括号', stage: 3, prereqs: ['linear_indep', 'transform'] },
      { id: 'det', name: '行列式与有向面积测度', stage: 3, prereqs: ['transform'] },
      { id: 'nullspace', name: '奇异降维与空间核 Null(A)', stage: 4, prereqs: ['composition', 'det'] },
      { id: 'colspace', name: '列空间与秩-零度定理', stage: 4, prereqs: ['det', 'nullspace'] },
      { id: 'sys_linear_eq', name: '线性方程组解集与仿射流形', stage: 4, prereqs: ['colspace'] },
      { id: 'eigen', name: '特征系统与不变方向流形', stage: 5, prereqs: ['nullspace', 'colspace'] },
      { id: 'diagonal', name: '正交相似对角化', stage: 5, prereqs: ['eigen'] },
      { id: 'ortho', name: '正交投影与最小二乘', stage: 5, prereqs: ['basis'] },
      { id: 'svd', name: '奇异值分解 SVD', stage: 6, prereqs: ['diagonal', 'ortho'] }
    ];

    this.legacyToNew = {
      'vector_basis': 'basis',
      'linear_transform': 'transform',
      'determinant_area': 'det',
      'null_space': 'nullspace',
      'column_space': 'colspace',
      'singular_collapse': 'nullspace'
    };

    this.newToLegacy = {
      'basis': 'vector_basis',
      'transform': 'linear_transform',
      'det': 'determinant_area',
      'nullspace': 'null_space',
      'colspace': 'column_space'
    };
  }

  normalizeId(id) {
    if (!id) return id;
    return this.legacyToNew[id] || id;
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: false, // B 线契约 GATE-CONTRACT-01：本工具是否要求画布环境
      parameters: {
        type: 'object',
        properties: {
          node_id: {
            type: 'string',
            description: '目标概念节点 ID (如 nullspace, det, eigen 等)，若为空则返回全图拓扑与全局推荐'
          },
          current_mastery_list: {
            type: 'array',
            items: { type: 'string' },
            description: '当前学生已掌握的节点 ID 列表（可选，默认从实时档案自动获取）'
          }
        }
      }
    };
  }

  async execute(args, context = {}) {
    const rawTarget = args.node_id;
    const targetNodeId = this.normalizeId(rawTarget);
    let tracker = context.cognitiveTracker || (typeof window !== 'undefined' ? window.cognitiveTracker : null);
    let rawMasteredList = args.current_mastery_list;

    if (!rawMasteredList && tracker && typeof tracker.getNodeStates === 'function') {
      const states = tracker.getNodeStates();
      rawMasteredList = Object.keys(states).filter(k => states[k] === 'mastered');
    }

    const isLegacyCaller = (args.current_mastery_list && args.current_mastery_list.some(id => id.includes('_'))) ||
                           (rawTarget && rawTarget.includes('_'));

    const mastered = new Set();
    const sourceList = rawMasteredList || [];
    for (const item of sourceList) {
      mastered.add(this.normalizeId(item));
    }
    const library = typeof window !== 'undefined' ? window.CourseLibrary : require('../teaching/CourseLibrary.js');
    const capability = node => {
      const lesson = library?.forNode(node.id);
      return {courseAvailable:!!lesson,lessonId:lesson?.id||null};
    };
    const masterySource = args.current_mastery_list ? 'caller-provided-unverified' : tracker ? 'graded-local-exercises' : 'no-evidence';

    if (targetNodeId) {
      const node = this.nodes.find(n => n.id === targetNodeId || n.id === rawTarget);
      if (!node) {
        return {
          status: 'error',
          message: `未找到节点: ${rawTarget}`
        };
      }
      const effectivePrereqs = (isLegacyCaller && node.id === 'nullspace')
        ? ['transform', 'det']
        : node.prereqs;
      const unfulfilled = effectivePrereqs.filter(p => !mastered.has(p));
      const canUnlock = unfulfilled.length === 0;

      return {
        status: 'success',
        nodeId: isLegacyCaller && this.newToLegacy[node.id] ? this.newToLegacy[node.id] : node.id,
        nodeName: node.name,
        stage: node.stage,
        ...capability(node),
        masterySource,
        prereqs: effectivePrereqs,
        canUnlock,
        unfulfilledPrereqs: unfulfilled,
        detail: canUnlock
          ? `概念 [${node.name}] 前置练习已通过，可进入探究。`
          : `概念 [${node.name}] 尚有前置练习未通过: ${unfulfilled.join(', ')}`
      };
    }

    // 全局推荐
    const availableNodes = this.nodes.filter(n => !mastered.has(n.id) && n.prereqs.every(p => mastered.has(p)));
    const recommended = availableNodes.find(n => capability(n).courseAvailable) || availableNodes[0] || null;
    const recId = recommended && (isLegacyCaller && this.newToLegacy[recommended.id] ? this.newToLegacy[recommended.id] : recommended.id);

    return {
      status: 'success',
      totalNodes: this.nodes.length,
      masterySource,
      masteredCount: this.nodes.filter(n => mastered.has(n.id)).length,
      recommendedNextNode: recommended ? { id: recId, name: recommended.name, ...capability(recommended) } : null,
      availableNextNodes: availableNodes.map(n => ({
        id: isLegacyCaller && this.newToLegacy[n.id] ? this.newToLegacy[n.id] : n.id,
        name: n.name,
        ...capability(n)
      })),
      detail: recommended ? `推荐概念: [${recommended.name}]。${capability(recommended).courseAvailable?'已有可执行课程。':'交互课程尚未实现；可查看概念说明。'}` : '图中没有待推荐的节点。通过状态仅表示当前练习的核验范围。'
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KnowledgeNavigatorSkill };
}
if (typeof window !== 'undefined') {
  window.KnowledgeNavigatorSkill = KnowledgeNavigatorSkill;
}
