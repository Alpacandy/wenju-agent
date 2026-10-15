/**
 * 问矩 · 苏格拉底教学脚手架与防剧透门禁技能 (PechdtScaffoldSkill v2.0)
 * 核心机制：
 * 1. 按预置规则选择阶段提示与建议篇幅，不进行在线排产优化
 * 2. 硬性反剧透门禁 (Anti-Spoiler Guardrail):
 *    - 阻断学生索取直接答案 (拦截放弃自主思考、索求现成终极结论的各类变异提问)
 *    - 将剧透请求转化为苏格拉底几何探针与反诘追问
 * 3. 严格定理泄露审查器 (checkAnswerLeakage): 在探究达到 DECONSTRUCT 阶段前，禁止直接泄露 Col(B) ⊆ Null(A)
 */

let BaseSkillScaffold;
if (typeof require !== 'undefined') {
  try { BaseSkillScaffold = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('PechdtScaffoldSkill', 'if', e); }
}
if (!BaseSkillScaffold && typeof window !== 'undefined') {
  BaseSkillScaffold = window.BaseSkill;
}
if (!BaseSkillScaffold) {
  BaseSkillScaffold = class { constructor(n, d) { this.name = n; this.description = d; } };
}


let getPechdtStoreRef = null;
(function loadPechdtStore() {
  if (typeof require !== "undefined") {
    try { getPechdtStoreRef = require("../pechdtStateStore.js").getSharedStore; } catch (e) { if (typeof recordIssue === 'function') recordIssue('PechdtScaffoldSkill', 'if', e); }
  }
  if (!getPechdtStoreRef && typeof window !== "undefined" && window.pechdtStateStore) {
    getPechdtStoreRef = function () { return window.pechdtStateStore; };
  }
})();

class PechdtScaffoldSkill extends BaseSkillScaffold {
  constructor() {
    super(
      'evaluate_pedagogical_scaffold',
      '按预置规则提供当前教学环节的引导与防剧透检查；不估计学生掌握度，不代表模型实际 Token 配额。'
    );

    // 阶段提示与 CONFLICT 兼容别名
    this.stages = ['PERCEIVE', 'ENGAGE', 'CHALLENGE', 'CONFLICT', 'DECONSTRUCT'];
    this.currentStage = 'PERCEIVE';

    // 预置提示策略；tokenQuota 字段保留旧契约，仅表示建议篇幅
    this.orScheduleTable = {
      'PERCEIVE': {
        stageName: '概念感知 (Perceive)',
        chosenAction: 'Counterexample',
        scaffoldLevel: 1, // 低介入度
        tokenQuota: 450,
        cognitiveLoad: null,
        masteryGain: null,
        socraticTemplate: '观察当前的矩阵变换：当 det(A) 不为 0 时，平面上网格发生了怎样的拉伸或旋转？基向量是否有任何一个被压缩成了零？'
      },
      'ENGAGE': {
        stageName: '空间映射 (Engage)',
        chosenAction: 'Counterexample',
        scaffoldLevel: 1,
        tokenQuota: 450,
        cognitiveLoad: null,
        masteryGain: null,
        socraticTemplate: '试着在左侧画板中把矩阵调节为奇异矩阵（如 a=2, b=1, c=1, d=0.5）：整张平面被压成了什么几何图形？原先的二维面积发生了什么变化？'
      },
      'CHALLENGE': {
        stageName: '零空间破局 (Challenge)',
        chosenAction: 'Counterexample',
        scaffoldLevel: 1,
        tokenQuota: 450,
        cognitiveLoad: null,
        masteryGain: null,
        socraticTemplate: '注意画布上贯穿原点的粉红色直线（零空间 Null(A)）！既然线上所有非零向量经 A 作用后都变成了零向量，你能否挑选两个不全为零的向量，作为矩阵 B 的列？'
      },
      'DECONSTRUCT': {
        stageName: '定理升华 (Deconstruct)',
        chosenAction: 'SymbolicProof',
        scaffoldLevel: 1,
        tokenQuota: 450,
        cognitiveLoad: null,
        masteryGain: null,
        socraticTemplate: '此时 A · B = 0 的充要条件已呼之欲出：矩阵 B 的每一列向量，必须全部落在矩阵 A 的什么子空间里？请写出集合包含关系的表达式。'
      }
    };
    this.orScheduleTable['CONFLICT'] = this.orScheduleTable['CHALLENGE'];
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: false, // B 线契约 GATE-CONTRACT-01：本工具是否要求画布环境
      parameters: {
        type: 'object',
        properties: {
          student_query: { type: 'string', description: '学生当前提问或陈述' },
          target_stage: { 
            type: 'string', 
            enum: ['PERCEIVE', 'ENGAGE', 'CHALLENGE', 'DECONSTRUCT'],
            description: '期望引导迁移的认知阶段'
          },
          check_spoiler: {
            type: 'boolean',
            description: '是否检测并拦截学生索要直接答案的意图'
          }
        },
        required: ['student_query']
      }
    };
  }

  /**
   * 判定学生提问是否具有“直接索取答案/剧透”意图
   */
  isDirectAnswerRequested(query = '') {
    const q = (query || '').trim();
    if (!q) return false;
    const patterns = [
      /直接.*(答案|结论|结果)/i,
      /(答案|结论|结果).*直接/i,
      /把.*(答案|结论|结果).*(告诉|发|给|贴|报)/i,
      /(答案|结论|结果).*(发我|给我|告诉我|贴出来|交出来|报出来)/i,
      /(告诉|发|给|贴|报|说).*我.*(答案|结论|结果)/i,
      /(告诉我|说出|公布|透露|快说).*(答案|结论|结果)/i,
      /别.*(卖关子|绕弯子|启发|引导|问我|拐弯抹角)/i,
      /求求.*(直接|答案|结论)/i,
      /(不用|不要|别|不需要).*(引导|提示|启发|推导|分析|步骤)/i,
      /直接.*(说|讲|给|发|公布|输出|报|剧透)/i,
      /(给|发|报|贴|输出).*答案/i,
      /(答案|结论|结果).*到底.*(是什么|是啥|为啥|多少)/i,
      /到底.*(等不等于|是不是|为不为)/i,
      /(充要条件|最终定理|终极证明).*是什么/i,
      /(直接|快点|赶紧|立刻).*剧透/i,
      /跳过.*(步骤|推导|过程)/i,
      /懒得.*(答案|结果|结论)/i,
      // B-R1-2 临时补丁（架构师签字）：关键词永远列不全，长期改为按 PechdtStateStore 阶段判定（债，排在 A 之后）
      /直接.*(告诉|写出|算出|求出|列出|报出|甩)/i,
      /直接.*(核|零空间|秩|逆|解|基向量|特征值|行列式)/i,
      /(别|不要|不用).*(引导|启发|绕).*(直接|答案|结果)/i
    ];
    return patterns.some(p => p.test(q));
  }

  /**
   * 检查文本是否包含了被早期禁用的直接答案关键词 (定理防泄露门禁)
   */
  checkAnswerLeakage(text = '') {
    if (this.currentStage === 'DECONSTRUCT') {
      return false; // 严密证明阶段允许给出完整定理
    }
    const leakedPhrases = [
      '列空间属于零空间',
      'Col(B) ⊆ Null(A)',
      'Col(B)包含于Null(A)',
      '这就是充要条件: Col(B)',
      'B的每一列属于A的核'
    ];
    return leakedPhrases.some(p => text.includes(p));
  }

  /**
   * 生成防剧透的苏格拉底反诘追问
   */
  interceptSpoiler(stage) {
    const s = stage || this.currentStage;
    switch (s) {
      case 'PERCEIVE':
      case 'ENGAGE':
        return '【苏格拉底追问】在直接给出代数结论前，先看左侧画板：如果矩阵 A 是满秩保维的（det ≠ 0），除了零向量自身，还有任何向量能被压缩到原点吗？如果一个非零向量都不能变零，A·B 怎么可能乘出全零？';
      case 'CHALLENGE':
      default:
        return '【苏格拉底追问】结论其实就藏在你的左侧画板里！请看粉红色的零空间射线 Null(A)：矩阵乘法 A · B 实际上是 A 依次作用在 B 的每一列上 (A · [b₁, b₂] = [A b₁, A b₂])。要想结果等于 [0, 0]，b₁ 和 b₂ 必须落在哪里？';
    }
  }

  async execute(args, context = {}) {
    const query = args.student_query || '';
    if (args.target_stage && this.stages.includes(args.target_stage)) {
      this.currentStage = args.target_stage;
    }

    const currentSchedule = this.orScheduleTable[this.currentStage] || this.orScheduleTable['CHALLENGE'];
    const isSpoilerAttempt = this.isDirectAnswerRequested(query);

    let guidance = currentSchedule.socraticTemplate;
    let antiSpoilerTriggered = false;

    if (isSpoilerAttempt && this.currentStage !== 'DECONSTRUCT') {
      antiSpoilerTriggered = true;
      guidance = this.interceptSpoiler(this.currentStage);
    }

    // M1_PECHDT_STORE_WRITE
    try {
      const store = (getPechdtStoreRef && getPechdtStoreRef()) || (typeof window !== "undefined" ? window.pechdtStateStore : null);
      if (store && typeof store.setStage === "function") {
        store.setStage(this.currentStage, { antiSpoilerTriggered, source: "PechdtScaffoldSkill" });
      }
    } catch (e) { if (typeof recordIssue === 'function') recordIssue('PechdtScaffoldSkill', 'if', e); }

    return {
      status: 'success',
      currentStage: this.currentStage,
      stageName: currentSchedule.stageName,
      chosenAction: currentSchedule.chosenAction,
      scaffoldLevel: currentSchedule.scaffoldLevel,
      tokenQuota: currentSchedule.tokenQuota,
      antiSpoilerTriggered,
      guidance,
      detail: antiSpoilerTriggered 
        ? `[防剧透拦截] 学生尝试直接索取答案，已触发苏格拉底反诘引导 (阶段: ${this.currentStage})`
        : `[预置教学规则] 阶段: ${currentSchedule.stageName}, 推荐动作: ${currentSchedule.chosenAction}, 建议回复篇幅: ${currentSchedule.tokenQuota} tokens（未作为API硬限制）`
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PechdtScaffoldSkill };
}
if (typeof window !== 'undefined') {
  window.PechdtScaffoldSkill = PechdtScaffoldSkill;
}
