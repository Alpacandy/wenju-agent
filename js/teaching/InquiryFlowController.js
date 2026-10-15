/**
 * InquiryFlowController —— 六步探究自然交互编排器（P2 加固 · 真实落地）
 *
 * 定位：此前 P2 的状态机/采集器/诊断/变式均为"测试脚手架可调、真实对话不通"的孤岛。
 * 本编排器把它们接到真实学生交互路径上（app.js submitQueryToAgent 前置路由）：
 *
 *   学生直述猜想（"我怀疑矩阵乘法可交换"）
 *     → 自动 startTask（PREDICT 激活，实验工具被引擎层锁死）
 *     → 系统追问"预测+理由"
 *   学生回答（自然语言即可）
 *     → PredictionCollector.submitPrediction（理由门槛校验，失败重问）
 *     → PERCEIVE：回显当前画布矩阵（解析确认），实验工具解锁
 *   实验工具产出事实（引擎自动回流）
 *     → 冲突：呈现冲突 + 关联误解登记（MisconceptionTracker candidate）+ 抛出区分性追问
 *     → 一致：直接进入边界猜想
 *   学生答区分性追问（选项/关键词）
 *     → BKT 更新 + 三态转移（追问中/待确认/回落）
 *   学生提出边界猜想（"对角矩阵成立"）
 *     → 呈现该误解的 boundaryPrompt + 推导模板 → DEDUCE
 *   学生提交推导尝试（含展开/推导标记）
 *     → 呈现恒等式结论模板 → TRANSFER + 自动发放无提示变式
 *   学生作答变式
 *     → VariantTaskBank 精确计分 → 反馈 + 任务闭环
 *
 * 全部状态经 PechdtStateStore 哈希链持久化；全部文本为确定性教学模板（无 LLM 伪装）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.InquiryFlowController = api.InquiryFlowController; root.inquiryFlow = api.getSharedFlow(); }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const TASK_KEY = 'wenju_inquiry_task_v1';

  // 猜想 → 任务路由：决定实验被解锁后哪个真实工具事实会与该预测对拍
  const CONJECTURE_ROUTES = [
    {
      re: /交换|可交换|commut/i,
      chapter: '矩阵运算',
      predictionKey: 'ab_equals_ba',
      title: '矩阵乘法交换性探究',
      relatedMisconceptions: ['MC-001', 'MC-002', 'MC-009', 'MC-010'],
      experimentHint: '让我算一算 AB 与 BA —— 可以直接说「构造一个非交换反例」或让 Agent 驱动实验台。',
      deductionTemplate: '展开 (A+B)² = A² + AB + BA + B²；与 A² + 2AB + B² 相差 (AB − BA)。',
      conclusion: '(A+B)² = A² + 2AB + B² 当且仅当 AB = BA（同阶方阵）。'
    },
    {
      re: /零空间|核空间|null\s*space|kernel/i,
      chapter: '线性方程组与秩',
      predictionKey: 'solve_matrix_kernel_sympy.isSingular',
      title: '零空间与奇异性探究',
      relatedMisconceptions: ['MC-007', 'MC-013', 'MC-014'],
      experimentHint: '现在可以让实验台求当前矩阵的核空间了（引擎工具已解锁）。',
      deductionTemplate: 'rank + nullity = n（秩-零化度定理）；有非零解 ⟺ det = 0。',
      conclusion: 'Ax=0 有非零解 当且仅当 det(A)=0（方阵）。'
    },
    {
      re: /行列式|det|determinant/i,
      chapter: '矩阵运算',
      predictionKey: 'det_additive',
      title: '行列式可加性探究',
      relatedMisconceptions: ['MC-004', 'MC-005'],
      experimentHint: '可以让 Agent 构造行列式非加性反例（det(A+B) ≠ det(A)+det(B)）来对照你的预测。',
      deductionTemplate: 'det(2I₂) = 4 ≠ 2·det(I₂)：det 是 n 次齐次而非线性函数。',
      conclusion: 'det(A+B) ≠ det(A)+det(B)（一般情形）；det(kA)=kⁿdet(A)。'
    }
  ];

  const CONJECTURE_RE = /(我怀疑|我觉得|我认为|我猜|猜想|是不是|会不会|难道|猜测).{0,40}(满足|成立|相等|可交换|等于|正确|一样|相同|分解|线性|只有|总有)|(矩阵.{0,12}(满足交换律|可交换))/i;

  class InquiryFlowController {
    constructor({ store, collector, getTracker, getLibrary, bank, getTimeline }) {
      this.store = store;
      this.collector = collector;
      this.getTracker = getTracker || (() => null);
      this.getLibrary = getLibrary || (() => null);
      this.bank = bank || null;
      this.getTimeline = getTimeline || (() => null);
      this.task = null;
      this.activeVariantId = null;
      this._load();
      // 冲突事实 → 诊断链（真实接线：collector 事件驱动 tracker）
      if (this.collector && this.collector.on) {
        this.collector.on('fact', (kind, rec) => this._onFact(kind, rec));
      }
    }

    _tl(type, payload) {
      const tl = this.getTimeline();
      if (tl && this.task) tl.append(type, payload, this.task.taskId);
    }

    _load() {
      try {
        if (typeof localStorage === 'undefined') return;
        const raw = localStorage.getItem(TASK_KEY);
        if (raw) {
          this.task = JSON.parse(raw);
          // 审计修复（R1）：刷新韧性——活动变式与待答追问随任务持久化（旧实现仅内存，刷新即丢：
          // 变式作答被 passthrough 吞掉不评分、区分性追问消失）
          this.activeVariantId = (this.task && this.task.activeVariantId) || null;
          this.pendingDiscrimination = (this.task && this.task.pendingDiscrimination) || null;
        }
      } catch (e) { this.task = null; }
    }

    _save() {
      try {
        if (typeof localStorage !== 'undefined' && this.task) {
          this.task.activeVariantId = this.activeVariantId || null;
          this.task.pendingDiscrimination = this.pendingDiscrimination || null;
          localStorage.setItem(TASK_KEY, JSON.stringify(this.task));
        }
      } catch (e) { /* 只读存储降级 */ }
    }

    // ---------- 猜想检测与任务开启 ----------
    static detectConjecture(text) { return CONJECTURE_RE.test(String(text || '')); }

    startInquiry(text) {
      const route = CONJECTURE_ROUTES.find((r) => r.re.test(text));
      // 审计修复（R2a）：未匹配实验路线的猜想不得错配 DEFAULT 事实键开任务
      //（旧实现静默落到零空间键——预测与实验事实语义无关，冲突对拍将无意义）
      if (!route) {
        const supported = CONJECTURE_ROUTES.map((r) => '「' + r.title + '」').join('、');
        return {
          action: 'unsupported_conjecture',
          reply: '💭 收到你的猜想：「' + text + '」\n\n当前实验台暂不支持这一猜想的自动对拍（预测 ↔ 精确实验事实）。' +
            '已支持的探究主题：' + supported + '。\n' +
            '你可以换个说法（例如「我怀疑矩阵乘法满足交换律」），或直接向 Agent 提问自由探索（不进入强制预测协议）。'
        };
      }
      const taskId = 'inquiry_' + Date.now();
      this.task = {
        taskId, title: route.title, chapter: route.chapter,
        predictionKey: route.predictionKey,
        relatedMisconceptions: route.relatedMisconceptions,
        experimentHint: route.experimentHint,
        deductionTemplate: route.deductionTemplate, conclusion: route.conclusion,
        conjectureText: text, startedAt: new Date().toISOString(), variantGraded: 0
      };
      this._save();
      this.store.startTask(taskId); // 六步第一站：PREDICT（引擎层门禁同步生效）
      this._tl('conjecture', { text, route: route.title, relatedMisconceptions: route.relatedMisconceptions });
      return {
        action: 'started', stage: 'PREDICT', task: this.task,
        reply: '🔮 已按你的猜想开启探究任务：**' + route.title + '**\n\n' +
          '在跑实验之前，先写下你的**预测与理由**（这不可绕过）：\n' +
          '请直接回复，例如：`我预测相等，因为数字乘法满足交换律`'
      };
    }
    // ---------- 自然语言预测解析 ----------
    _parsePrediction(text) {
      const t = String(text || '').trim();
      let value = t;
      if (/不相等|不等|不相同|不同|false|不成立/i.test(t)) value = false;
      else if (/相等|相同|成立|一样|true/i.test(t)) value = true;
      return { value, prediction: t };
    }

    // ---------- 路由入口（app.js 在真实提交路径调用） ----------
    /**
     * @returns {null | {action, reply?, continueToAgent?, stage?}}
     *   返回 null 表示无活动任务且非猜想 → 走常规 Agent 路径
     */
    route(text) {
      const t = String(text || '').trim();
      const stage = this.store.getState().stage;

      // 无活动任务：检测猜想直述
      if (!this.task || stage === 'IDLE') {
        if (InquiryFlowController.detectConjecture(t)) return this.startInquiry(t);
        return null;
      }

      switch (stage) {
        case 'PREDICT': {
          // 审计修复：PREDICT 态下的**提问/离题**消息不得登记为预测（旧实现把任意文本当预测入库）
          const questionLike = /[?？]/.test(t) || /^(什么|怎么|为什么|如何|哪个|多少|哪里)/.test(t);
          if (questionLike) {
            return {
              action: 'reprompt',
              reply: '🔒 现在是**预测环节**（还没跑实验）：我先不回答这个问题——请先写下你的预测与理由。\n' +
                '例如：「我预测 AB 与 BA 不相等，因为矩阵乘法可能不可交换」；提交后我会解锁实验台，并和你的预测对照。'
            };
          }
          // 理由门槛：预测与理由不能是同一句碎片；总长 ≥8 且含理由信号或足够展开
          if (t.length < 8) {
            return { action: 'reprompt', reply: '🔒 预测与理由还没写全。请再具体一点：**你预测的结果是什么？为什么这么想？**（至少 8 个字）' };
          }
          const { value, prediction } = this._parsePrediction(t);
          const res = this.collector.submitPrediction({
            taskId: this.task.taskId, key: this.task.predictionKey,
            value, prediction, rationale: t
          });
          if (!res.ok) return { action: 'reprompt', reply: '🔒 ' + res.message };
          this._tl('parse_confirm', { note: '画布矩阵与实验对象就位（预测登记后解锁实验）' });
          return {
            action: 'predicted', stage: 'PERCEIVE',
            reply: '✅ 预测已登记（不可绕过协议）。\n\n**解析确认**：当前画布矩阵与实验对象已在左侧就位。\n' +
              this.task.experimentHint + '\n\n如果你预测会被推翻——正好，这正是发现新规律的地方。'
          };
        }
        case 'PERCEIVE':
        case 'ENGAGE':
          // 已解锁：正常交给 Agent（模型可调用实验工具）
          return { action: 'passthrough', continueToAgent: true };

        case 'CONFLICT': {
          // 学生提出边界猜想 → 呈现该误解的引导语 + 推导模板
          const mcId = (this.task.relatedMisconceptions || [])[0];
          const lib = this.getLibrary();
          const entry = lib && lib.byId(mcId);
          this.store.setStage('HYPOTHESIZE', { source: 'inquiry:boundary', taskId: this.task.taskId });
          this._tl('hypothesis', { text: t, misconception: mcId || null });
          return {
            action: 'hypothesis', stage: 'HYPOTHESIZE',
            reply: '💡 你的边界猜想：' + t + '\n\n' +
              (entry ? '引导：' + entry.boundaryPrompt + '\n\n' : '') +
              '**注意**：举例子只能证明"存在"，不能证明"仅当"。请写下推导思路（例如展开 (A+B)²），我来与已审核的恒等式模板对照。'
          };
        }
        case 'HYPOTHESIZE': {
          // 推导尝试：要求含推导/展开标记（确定性校验，不伪装 LLM 判卷）
          if (!/展开|推导|恒等式|因为|所以|证明|移项|=/.test(t)) {
            return { action: 'reprompt', reply: '∑ 推导验证阶段：请写出你的推导或展开式（至少包含一步变换，例如"展开 (A+B)(A+B)"）。' };
          }
          this.store.setStage('DEDUCE', { source: 'inquiry:deduce', taskId: this.task.taskId });
          this._tl('deduction', { text: t, template: this.task.deductionTemplate, conclusion: this.task.conclusion });
          return {
            action: 'deduced', stage: 'DEDUCE', noticeKind: 'template',
            reply: '∑ 推导模板对照（教师审核版）：\n' + this.task.deductionTemplate + '\n\n结论：' + this.task.conclusion +
              '\n\n进入**无提示变式**——不看上面的提示，独立作答下一题。'
          };
        }
        case 'DEDUCE': {
          // 推导确认 → TRANSFER + 自动发放变式
          this.store.setStage('TRANSFER', { source: 'inquiry:transfer', taskId: this.task.taskId });
          return this.issueVariant('（承上一环节）');
        }
        case 'TRANSFER': {
          // 审计修复：元命令优先于计分（旧实现把「换一题」当答案提交计分）
          const metaSwap = /换一题|下一题|再来|跳过/.test(t);
          if (metaSwap) {
            if (this.task.closed) {
              return { action: 'closed', reply: '🏁 本次探究已闭环。若要继续练习，请提出**已支持对拍的猜想**（例如：「我怀疑矩阵乘法满足交换律」「我怀疑零空间只有零向量」「我怀疑行列式满足可加性」），或在演示包/回放中复盘本题。' };
            }
            // 放弃当前题（不计分、不写 history，避免假装计分），直接发放新题
            if (this.activeVariantId) this.activeVariantId = null;
            return this.issueVariant('（换题）');
          }
          if (this.activeVariantId) {
            const g = this.bank.grade(this.activeVariantId, t);
            const vId = this.activeVariantId;
            this.task.variantGraded += 1;
            this.task.variants = this.task.variants || [];
            this.task.variants.push({ id: vId, passed: g.passed === true, at: new Date().toISOString() });
            this._save();
            this.activeVariantId = null;
            this._tl('variant_grade', { variantId: vId, passed: g.passed === true, answer: String(t).slice(0, 120), expected: g.expected });

            // P3 自适应终点决策（MAST #5 清偿）
            let policy = { action: 'continue', reason: '' };
            try {
              let pol = null;
              pol = (typeof window !== 'undefined' && window.TerminationPolicy) || null;
              if (!pol) { try { pol = require('./TerminationPolicy.js'); } catch (e) { pol = (typeof TerminationPolicy !== 'undefined') ? TerminationPolicy : null; } }
              const tracker = this.getTracker();
              const mcId = (this.task.relatedMisconceptions || [])[0];
              const st = tracker && mcId ? tracker.getStatus(mcId) : null;
              const tl = this.getTimeline();
              const conflicts = tl ? (tl.countByType(this.task.taskId).conflict || 0) : 0;
              if (pol) policy = pol.decide({ trackerStatus: st, variantHistory: this.task.variants, conflictCount: conflicts });
            } catch (e) { /* 决策失败按 continue 处理，不阻断主流程 */ }
            this._tl('termination', policy);

            let followUp = '';
            if (policy.action === 'add_variant') {
              followUp = '\n\n' + policy.reason;
            } else if (policy.action === 'close_task') {
              followUp = '\n\n🏁 ' + policy.reason + (policy.remediation ? '\n建议复习路径：复习对应误解卡片的边界猜想引导，再回到实验台重做一次预测-对照。' : '');
              this.task.closed = true;
              this._save();
            } else if (policy.action === 'back_to_experiment') {
              followUp = '\n\n↩️ ' + policy.reason;
              this.store.setStage('ENGAGE', { source: 'inquiry:policy', taskId: this.task.taskId });
            }
            const fb = g.passed
              ? '✅ 变式作答正确（' + this.task.variantGraded + ' 题已过）。' + (g.expected ? ' 参考结论：' + g.expected : '')
              : '✗ 变式未通过。你的答案：' + String(g.actual).slice(0, 80) + '\n参考结论：' + g.expected;
            const resp = { action: 'variant_graded', passed: g.passed, policy, reply: fb + followUp };
            if (policy.action === 'add_variant') {
              const nxt = this.issueVariant('（加测）');
              resp.reply += '\n\n' + nxt.reply;
              resp.nextVariantId = nxt.variantId;
            }
            return resp;
          }
          // 其他输入：视作对该章变式的应答前陈述 → 交给 Agent 正常对话
          return { action: 'passthrough', continueToAgent: true };
        }
        default:
          return { action: 'passthrough', continueToAgent: true };
      }
    }

    issueVariant(prefix) {
      if (!this.bank) return { action: 'variant_unavailable', reply: '（变式题库未装载）' };
      const chapter = this.task ? this.task.chapter : null;
      const pool = chapter && this.bank.byChapter(chapter).length ? this.bank.byChapter(chapter) : this.bank.all();
      const pick = pool[this.task ? this.task.variantGraded % pool.length : 0];
      this.activeVariantId = pick.id;
      this._save(); // 审计修复（R1）：活动变式持久化（刷新后仍可评分）
      this._tl('variant_issue', { variantId: pick.id, chapter: pick.chapter, noHint: true });
      return {
        action: 'variant_issued', variantId: pick.id, stage: 'TRANSFER',
        reply: '🚀 **无提示变式（' + pick.chapter + '）**：' + pick.stem + '\n\n（本题不计提示，直接作答即可）'
      };
    }

    // ---------- 冲突事实 → 诊断链（真实事件驱动） ----------
    _onFact(kind, rec) {
      if (!rec || rec.conflict !== true || !this.task) return;
      const mcId = (this.task.relatedMisconceptions || [])[0];
      const tracker = this.getTracker();
      if (tracker && mcId) {
        tracker.registerCandidate(mcId, { taskId: rec.taskId, key: rec.key, fact: rec.fact, prediction: rec.value });
      }
      // 区分性追问登记不依赖 tracker（tracker 未装载时仍呈现追问，证据在 UI 侧记录）
      this.pendingDiscrimination = { mcId, factKey: rec.key };
      this._save();
    }

    /** 取区分性追问（冲突后第一次 passthrough 时呈现；无库则给通用三选项） */
    takeDiscriminatingPrompt() {
      if (!this.pendingDiscrimination) return null;
      const { mcId } = this.pendingDiscrimination;
      const lib = this.getLibrary();
      const d = lib && mcId ? lib.getDiscriminatingQuestion(mcId) : null;
      this.pendingDiscrimination = null;
      this._save(); // 审计修复（R1）：待答追问状态变更即持久化
      this._tl('discriminating_q', { misconception: mcId || null, stem: d ? d.stem : '（通用三选项）' });
      if (!d) {
        return {
          mcId, stem: '你的预测与精确结果不一致。这更接近哪种情况？',
          options: ['1. 我确实以为规律总是成立（概念）', '2. 我大概算错/看错了（计算）', '3. 我理解错了题目（读题）'],
          correctIndex: 0
        };
      }
      return {
        mcId, stem: d.stem,
        options: d.options.map((o, i) => (i + 1) + '. ' + o.text),
        correctKey: d.correctKey,
        rawOptions: d.options
      };
    }

    /** 学生作答区分性追问 → BKT 证据（option 1/2/3 或关键词） */
    answerDiscrimination(prompt, text) {
      const tracker = this.getTracker();
      if (!tracker || !prompt) return { action: 'none' };
      const t = String(text || '');
      let pickedKey = null;
      const m = t.match(/^\s*([123])/) || t.match(/(选项|选)\s*([123])/);
      const idx = m ? Number(m[1] || m[2]) - 1 : -1;
      if (idx >= 0 && prompt.rawOptions && prompt.rawOptions[idx]) pickedKey = prompt.rawOptions[idx].key;
      else if (/以为|规律|概念|误解/.test(t)) pickedKey = 'misconception';
      else if (/算错|计算|手滑|看错/.test(t)) pickedKey = 'calculation';
      else if (/读题|理解错|题意/.test(t)) pickedKey = 'misreading';
      if (!pickedKey) return { action: 'reprompt', reply: '请选择 1 / 2 / 3（或直接复述你的情况）。' };
      const correct = prompt.correctKey ? pickedKey === prompt.correctKey : pickedKey === 'misconception';
      // 审计修复：证据事件必须携带 taskId（否则时间线落入 __global__，按任务回放缺证据节点）
      const st = tracker.submitEvidence(prompt.mcId || 'MC-UNCLASSIFIED', { correct, detail: pickedKey, taskId: this.task ? this.task.taskId : null });
      let tail = '';
      if (st && st.status === 'pending_confirm') tail = '\n\n📌 诊断状态更新：**待确认**（两次同向证据）——已沉淀到你的学习档案，可经回放导出。';
      else if (st && st.status === 'candidate') tail = '\n\n📌 诊断状态更新：证据出现矛盾，回落为**候选**——记录已保留。';
      else if (st) tail = '\n\n📌 诊断状态更新：**追问中**（pL=' + st.pL.toFixed(3) + '，由 BKT 数值给出，非模型猜测）。';
      return { action: 'evidence_recorded', status: st, reply: '🩺 已记录你的回答（' + pickedKey + '）。' + tail };
    }

    getActiveTask() { return this.task; }
    reset() {
      this.task = null;
      this.activeVariantId = null;
      this.pendingDiscrimination = null;
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(TASK_KEY);
      } catch (e) { /* 只读降级 */ }
    }
  }

  let sharedFlow = null;
  function getSharedFlow() {
    if (sharedFlow) return sharedFlow;
    if (typeof window === 'undefined') return null;
    const store = window.pechdtStateStore;
    const collector = window.predictionCollector;
    if (!store || !collector) return null;
    sharedFlow = new InquiryFlowController({
      store, collector,
      getTracker: () => window.misconceptionTracker || null,
      getLibrary: () => window.misconceptionLibrary || null,
      bank: window.VariantTaskBank || null,
      getTimeline: () => window.teachingTimeline || null
    });
    window.inquiryFlow = sharedFlow;
    return sharedFlow;
  }

  return { InquiryFlowController, getSharedFlow, CONJECTURE_ROUTES };
});
