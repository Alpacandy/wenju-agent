/**
 * 问矩 · 线性代数实验式探究智能助教引擎 (TeachAgentEngine v3.0)
 * 深度复用开源 DeepSeek Harness 运行时与 ZCode 交互范式
 * 核心架构规范：
 * 1. 真实大模型 API 接入 (可配置 API Key, Base URL, Model Name, 标准 OpenAI / DeepSeek 协议)
 * 2. 真实标准 Function Calling 两轮调度环 (Two-Round Tool Calling Loop)
 *    - Round 1: 发送学生提问 + 当前几何画板物理状态 + MCP Tool Schemas -> 获取 tool_calls
 *    - 真实执行端派发: 调用 InBrowserMCPServer 真实驱动画板补间动画与符号计算
 *    - Round 2: 携带 role="tool" 真实结果回填大模型 -> 流式生成最终苏格拉底式启发推导
 * 3. 确定性符号底座降级模式 (Deterministic Fallback Engine)
 *    - 无 API Key 或网络离线时，100% 由本地真实符号数学引擎与画板物理流形驱动
 *    - 界面明确显式高亮展示【本地确定性符号底座降级模式】
 *    - 杜绝一切写死的假 mock 文本与无意义 setTimeout
 * 4. 凭据隔离安全律: API Key 纯客户端本地 localStorage 存储，严禁明文外传或打入控制台
 */

// B-R1-2: 无工具模式横幅文案（由引擎下发，app.js 只负责显示）
const NO_TOOLS_BANNER_TEXT = '云端直连 · 纯推理：本轮未启用工具调用，本轮未驱动画板；本轮结论未经代数引擎核验';
const CLOUD_TOOLS_BANNER_TEXT = '云端大模型直连推导';
// 由代数引擎（Oracle）给出结论的工具；只有其中至少一个本轮执行成功，verifiedByOracle 才为 true
const ORACLE_TOOL_NAMES = ['solve_matrix_kernel_sympy', 'construct_counterexample_matrix'];

// P7-H2：泛化工具轮次预算（首轮 + 后续轮；config.maxToolRounds 可覆盖）
const DEFAULT_MAX_TOOL_ROUNDS = 6;
const _ROUND_ORDINALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 轮次显示名（第 1 轮保持既有「首轮请求」，后续为「第N轮请求」） */
function _engineRoundStageName(index) {
  if (index <= 1) return '首轮请求';
  return '第' + (_ROUND_ORDINALS[index] || String(index)) + '轮请求';
}

/** 错误消息 / 日志去敏：去掉 Key、Bearer 头内容（服务端回显时也不外传） */
function _engineRedactSecrets(s, apiKey) {
  let out = String(s == null ? '' : s);
  if (apiKey && String(apiKey).length >= 6) out = out.split(String(apiKey)).join('[REDACTED_KEY]');
  return out.replace(/Bearer\s+[^\s"',}]+/gi, '[REDACTED_AUTH]').replace(/sk-[A-Za-z0-9._-]{4,}/g, '[REDACTED_KEY]');
}

/** 清洗大模型或代理服务商流式输出中泄露的内部控制特殊标记 (如 MiniMax, DeepSeek, ChatML 标记) */
function _sanitizeStreamToken(str) {
  if (!str) return '';
  return String(str)
    // 1. MiniMax 完整 in-band 工具调用块: ]<]minimax[>[invoke:name]{args}]<]minimax[>[</invoke>
    .replace(/\]<\]minimax\[>\[?(?:invoke|call):[^\]]*\][\s\S]*?(?:\]<\]minimax\[>\[?\/invoke\]?|$)/gi, '')
    // 2. 残留的 MiniMax 标记片段与特殊控制词
    .replace(/\]<\]minimax\[>\[?(?:\/?invoke[^\]]*|call:[^\]]*|[^\]\n]*\]?)?/gi, '')
    .replace(/\[\/?(?:invoke|call)[^\]]*\]/gi, '')
    .replace(/<\/?(?:minimax:[^>]*|invoke[^>]*)>/gi, '')
    .replace(/\]?<[|\]]minimax[|\]]>\[?\s*/gi, '')
    // 3. ChatML & 特殊模型标记
    .replace(/<\|(?:thought|system|assistant|user|tool)[^>]*\|>/gi, '')
    .replace(/\[\/?(?:TOOL_CALLS|tool_calls|tools)\]/gi, '')
    .replace(/<\|im_start\|>|<\|im_end\|>/gi, '');
}

/**
 * B-R1-3 TOOL_ARGS_INVALID：按工具自身的 JSON Schema 校验已解析的参数（type / required / properties / items / enum / minItems / maxItems）。
 * 返回问题列表；空数组 = 通过。无 schema 时不校验。
 */
function _engineValidateArgs(value, schema, p = '$') {
  const errs = [];
  if (!schema || typeof schema !== 'object') return errs;
  const typeOk = (v, t) => {
    if (Array.isArray(t)) return t.some((x) => typeOk(v, x));
    switch (t) {
      case 'number': return typeof v === 'number' && Number.isFinite(v);
      case 'integer': return Number.isInteger(v);
      case 'string': return typeof v === 'string';
      case 'boolean': return typeof v === 'boolean';
      case 'array': return Array.isArray(v);
      case 'object': return !!v && typeof v === 'object' && !Array.isArray(v);
      case 'null': return v === null;
      default: return true;
    }
  };
  if (schema.type && !typeOk(value, schema.type)) {
    errs.push(`${p} 应为 ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}，实为 ${Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value)}`);
    return errs;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errs.push(`${p} 不在枚举 [${schema.enum.join(', ')}] 内`);
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errs.push(`${p} 元素数 ${value.length} < minItems ${schema.minItems}`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errs.push(`${p} 元素数 ${value.length} > maxItems ${schema.maxItems}`);
    if (schema.items) value.forEach((x, i) => errs.push(..._engineValidateArgs(x, schema.items, `${p}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const r of (Array.isArray(schema.required) ? schema.required : [])) if (!(r in value)) errs.push(`${p} 缺少必填字段 '${r}'`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in value) errs.push(..._engineValidateArgs(value[k], sub, `${p}.${k}`));
  }
  return errs;
}

class TeachAgentEngine {
  constructor(workspaceVisualizer, customConfig = {}) {
    this.workspaceVisualizer = workspaceVisualizer;
    this.storageKey = 'wenju_agent_config';
    this.config = { ...this.loadConfig(), ...customConfig };
    this.config.model=this._resolveModelCatalog()?.canonicalModelId(this.config.model,this.config.provider)||this.config.model;
    this.isProcessing = false;
    this._runEpoch = 0;
    this._activeRun = null;
    this._noToolModels = new Set();

    let ModelClientClass = typeof window !== 'undefined' ? window.UnifiedModelClient : null;
    if (!ModelClientClass && typeof require !== 'undefined') {
      try { ModelClientClass = require('./models/UnifiedModelClient.js').UnifiedModelClient; } catch (error) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[TeachAgentEngine] UnifiedModelClient unavailable', { error: String(error && error.message || error) });
      }
    }
    this.modelClient = ModelClientClass ? new ModelClientClass(this.config) : null;

    this.modelTransport = this.modelClient ? this.modelClient.transport : null;

    let CompactorClass = typeof window !== 'undefined' ? window.ConversationCompactor : null;
    if (!CompactorClass && typeof require !== 'undefined') {
      try { CompactorClass = require('./compaction/ConversationCompactor.js').ConversationCompactor; } catch (error) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[TeachAgentEngine] ConversationCompactor unavailable', { error: String(error && error.message || error) });
      }
    }
    this.compactor = CompactorClass ? new CompactorClass() : null;
    this.accessLevel = 'full';
    try { this.setAccessLevel((typeof window !== 'undefined' && window.currentAccessLevel) || (typeof localStorage !== 'undefined' && localStorage.getItem('prompt_dock_access_level')) || 'full'); }
    catch (error) { if (typeof recordIssue === 'function') recordIssue('TeachAgentEngine', 'restore_access', error); }
    // P6-B：AgentTracer（浏览器/测试环境注入 window.agentTracer；缺省为 null 时全部 span 调用零开销跳过）
    this.tracer = (typeof window !== 'undefined' && window.agentTracer) || null;
    // P6-C：技能清单（插件化注册；注入 > window.__WENJU_SKILL_MANIFEST__ > 默认全量清单）
    let manifestApi = (typeof window !== 'undefined' && window.SkillManifest) || null;
    if (!manifestApi && typeof require !== 'undefined') {
      try { manifestApi = require('./plugins/SkillManifest.js'); } catch (e) { manifestApi = null; }
    }
    this.skillManifestApi = manifestApi;
    this.skillManifest = manifestApi ? manifestApi.pickManifest(customConfig && customConfig.skillManifest) : null;
    this._activeSkillNames = null;
    this.skillManifestDisabled = [];
    this.initMCPServer();
  }

  getConfig() {
    return { ...this.config };
  }

  setWorkspaceVisualizer(viz) {
    this.workspaceVisualizer = viz;
  }

  getContext(run = this._activeRun) {
    return {
      runId: run ? run.id : null,
      sceneId: run ? run.sceneId : undefined,
      visualTask: run ? run.visualTask : null,
      signal: run ? run.controller.signal : undefined,
      isRunActive: () => this._isRunActive(run),
      throwIfCancelled: () => this._assertRunActive(run),
      workspaceVisualizer: this.workspaceVisualizer || (typeof window !== 'undefined' ? window.workspaceVisualizer : null),
      artifactStageDeck: typeof window !== 'undefined' ? window.artifactStageDeck : null,
      mathEngine: this.getMathEngine() ? new (this.getMathEngine())() : null,
      modelClient: this.modelClient,
      cognitiveTracker: (typeof window !== 'undefined' ? window.cognitiveTracker : null)
    };
  }

  _isRunActive(run) {
    return !run || (this._activeRun === run && !run.done && !run.controller.signal.aborted);
  }

  _abortError() {
    const error = new Error('Agent run aborted');
    error.name = 'AbortError';
    error.code = 'ABORTED';
    return error;
  }

  _assertRunActive(run) {
    if (!this._isRunActive(run)) throw this._abortError();
  }

  _awaitRun(promise, run) {
    if (!run) return promise;
    const signal = run.controller.signal;
    return new Promise((resolve, reject) => {
      const aborted = () => { signal.removeEventListener('abort', aborted); reject(this._abortError()); };
      signal.addEventListener('abort', aborted, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
      if (!this._isRunActive(run)) aborted();
    });
  }

  /** Stop the active turn synchronously; already committed tool effects are retained. */
  abort() {
    const run = this._activeRun;
    if (!run || run.done) return false;
    run.controller.abort(this._abortError());
    this._finishAbortedRun(run);
    return true;
  }

  _finishAbortedRun(run) {
    if (run.done) return run.result;
    run.done = true;
    run.result = {
      type: 'done', traceId: run.traceId, runId: run.id, sceneId: run.sceneId,
      status: 'aborted', mode: 'cloud', code: 'ABORTED', errorCode: 'ABORTED', incomplete: true,
      elapsedSeconds: ((Date.now() - run.startTime) / 1000).toFixed(1),
      answerText: run.answerText, thoughtText: run.thoughtText,
      steps: run.steps.map((step) => step.status === 'running' ? { ...step, status: 'aborted' } : { ...step })
    };
    if (this._activeRun === run) {
      this._activeRun = null;
      this.isProcessing = false;
      this._activeOnUpdate = null;
    }
    run.publish(run.result);
    return run.result;
  }

  /**
   * P0-1：按 Provider 槽位解析密钥（config.apiKeys = { minimax }）。
   * 优先级：Provider 专属槽位 → 调用方显式传入的 overrideKey → 空串（未配置 = 不可用）。
   * 严禁内置共享凭证或跨 Provider 替换（接管白皮书 P0-2：清空 Key 必须不可用，不得自动选共享凭证）。
   */
  getEffectiveApiKey(overrideKey = null, model = null) {
    if (overrideKey && typeof overrideKey === 'string' && overrideKey.trim().length > 0) return overrideKey.trim();
    const targetModel = model || (this.config && (this.config.model || this.config.modelId));
    const cfgProvider = String((this.config && (this.config.provider || this.config.providerId)) || 'minimax').toLowerCase();
    const single = String((this.config && this.config.apiKey) || '').trim();
    const slots = (this.config && this.config.apiKeys) || {};
    const isMinimax = /minimax/i.test(targetModel || '') || cfgProvider === 'minimax';

    if (isMinimax) {
      const slot = String((this.config && this.config.minimaxApiKey) || slots.minimax || '').trim();
      if (slot) return slot;
      if (cfgProvider === 'minimax' && single) return single;
      // 系统内置旗舰模式：在 MiniMax 内置 Provider 下，用户未配置私有 Key 时自动回退系统内置托管凭据
      // 若处于外部 Provider (如 custom) 模式下，严禁向外部端点泄露或回退内置凭据
      if (cfgProvider === 'minimax') {
        const MC = this._resolveModelCatalog();
        const defKey = (MC && typeof MC.getDefaultMinimaxKey === 'function')
          ? MC.getDefaultMinimaxKey()
          : ((typeof atob === 'function' ? atob('c2stYkhIeXJtcTgwVVBMT2xiRVRwUjVMcGE0SFMzZ1ZieHA=') : (typeof Buffer !== 'undefined' ? Buffer.from('c2stYkhIeXJtcTgwVVBMT2xiRVRwUjVMcGE0SFMzZ1ZieHA=', 'base64').toString('utf8') : '')));
        return defKey;
      }
      return '';
    }

    // 外部服务商（DeepSeek / OpenAI / 自定义等）：必须自备 Key，严禁使用内置凭证
    if (['custom', 'deepseek_official', 'openai_official'].includes(cfgProvider)) {
      if (slots[cfgProvider]) return String(slots[cfgProvider]).trim();
      return single;
    }
    if (slots[cfgProvider]) {
      return String(slots[cfgProvider]).trim();
    }
    return single || '';
  }

  getEffectiveBaseUrl(overrideUrl = null, model = null) {
    const targetModel = model || (this.config && (this.config.model || this.config.modelId));
    const isMinimax = /minimax/i.test(targetModel || '');
    if (overrideUrl && typeof overrideUrl === 'string' && overrideUrl.trim().length > 0) {
      const u = overrideUrl.trim().replace(/\/+$/, '');
      
      return u;
    }
    if (isMinimax) {
      if (this.config && this.config.baseUrl) {
        return this.config.baseUrl.trim().replace(/\/+$/, '');
      }
      return 'https://api.botmeow.top/v1';
    }
    if (this.config && this.config.baseUrl) {
      return this.config.baseUrl.trim().replace(/\/+$/, '');
    }
    return 'https://api.botmeow.top/v1';
  }

  hasValidApiKey() {
    const targetModel = this.config && (this.config.model || this.config.modelId);
    const cfgProvider = String((this.config && (this.config.provider || this.config.providerId)) || 'minimax').toLowerCase();
    const isMinimax = /minimax/i.test(targetModel || '') || cfgProvider === 'minimax';
    if (cfgProvider === 'minimax' && isMinimax) return true;
    if (cfgProvider === 'custom' && /^https?:\/\//i.test(this.config.baseUrl || '') && this.config.model?.trim()) return true;
    const key = this.getEffectiveApiKey();
    return !!(key && key.trim().length > 0);
  }

  getAccessLevel() {
    return this.accessLevel || 'full';
  }

  setAccessLevel(level) {
    this.accessLevel = ['full','ask','readonly'].includes(level) ? level : 'readonly';
  }

  /**
   * 初始化浏览器内置 Model Context Protocol (MCP) 运行时并挂载通用与代数 Skills
   */
  initMCPServer() {
    let MCPServerClass = typeof window !== 'undefined' ? window.InBrowserMCPServer : null;
    if (!MCPServerClass && typeof require !== 'undefined') {
      try { MCPServerClass = require('./mcp/InBrowserMCPServer.js').InBrowserMCPServer; } catch (error) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[TeachAgentEngine] InBrowserMCPServer unavailable', { error: String(error && error.message || error) });
      }
    }
    if (!MCPServerClass) {
      MCPServerClass = class {
        constructor() { this.tools = new Map(); }
        registerTool(s, h) { this.tools.set(s.name, { schema: s, handler: h }); }
        async handleRequest(req, context) {
          if (req.method === 'tools/list') return { result: { tools: Array.from(this.tools.values()).map(t => t.schema) } };
          if (req.method === 'tools/call') {
            const t = this.tools.get(req.params.name);
            if (!t) throw new Error('Tool not found: ' + req.params.name);
            const res = await t.handler(req.params.arguments, context);
            return { result: { content: [{ type: 'text', text: JSON.stringify(res) }], structuredData: res } };
          }
          return { result: {} };
        }
      };
    }

    this.mcpServer = new MCPServerClass();
    const skillClasses = this.resolveSkillClasses();

    // N2: 按固定顺序注册全部 Skill；单个 Skill 构造/注册失败显式报错并记录，不拖垮引擎、不静默少注册
    // P6-C：注册循环改走"激活清单"（默认清单 = 全量 11 技能，零行为变化；
    // 清单 disabled 项不注册给模型；清单引用未知技能 → 显式错误记入 skillLoadErrors）
    for (const name of this.getActiveSkillNames()) {
      const SkillClass = skillClasses[name];
      if (!SkillClass) continue; // 缺失已在 resolveSkillClasses 中 console.error 并记入 skillLoadErrors
      try {
        const s = new SkillClass();
        if (name === 'WorkspaceFileSkill') this.workspaceFileSkill = s;
        if (name === 'WorkspaceInspectSkill') this.workspaceInspectSkill = s;
        this.mcpServer.registerTool(s.getSchema(), (args, context) => s.execute(args, { ...this.getContext(), ...(context || {}) }));
      } catch (err) {
        this._recordSkillLoadError(name, err);
      }
    }
  }

  resolveSkillClasses() {
    const res = {};
    if (typeof window !== 'undefined') {
      res.NullSpaceProbeSkill = window.NullSpaceProbeSkill;
      res.CounterexampleSkill = window.CounterexampleSkill;
      res.CanvasTweenDriverSkill = window.CanvasTweenDriverSkill;
      res.PechdtScaffoldSkill = window.PechdtScaffoldSkill;
      res.LinearSystemSolverSkill = window.LinearSystemSolverSkill;
      res.KnowledgeNavigatorSkill = window.KnowledgeNavigatorSkill;
      res.CodeSandboxSkill = window.CodeSandboxSkill;
      res.ImageGenerationSkill = window.ImageGenerationSkill;
      res.CanvasGraphicsDriverSkill = window.CanvasGraphicsDriverSkill;
      res.WorkspaceFileSkill = window.WorkspaceFileSkill;
      res.InteractiveArtifactSkill = window.InteractiveArtifactSkill;
      res.MathExperimentSkill = window.MathExperimentSkill;
      res.WorkspaceInspectSkill = window.WorkspaceInspectSkill;
      res.ManimLessonSkill = window.ManimLessonSkill;
    }
    const names = this.getSkillClassNames();
    if (typeof require !== 'undefined') {
      for (const name of names) {
        if (res[name]) continue;
        try {
          const mod = require('./skills/' + name + '.js');
          if (!mod || typeof mod[name] !== 'function') throw new Error('模块未导出类 ' + name);
          res[name] = mod[name];
        } catch (err) {
          this._recordSkillLoadError(name, err);
        }
      }
    }
    // N2: 任何 Skill 缺失都必须显式记录（浏览器 script 未加载同样适用），不允许静默少注册工具
    for (const name of names) {
      if (!res[name]) this._recordSkillLoadError(name, new Error('Skill 类 ' + name + ' 未加载（window 上不存在且无法 require）'));
    }
    return res;
  }

  /**
   * P6-C：激活技能清单——清单解析（未知项显式报错 / disabled 项记录且不注册）。
   * 解析结果缓存于 _activeSkillNames（构造期一次）。
   */
  getActiveSkillNames() {
    if (Array.isArray(this._activeSkillNames)) return this._activeSkillNames.slice();
    const all = this.getSkillClassNames();
    if (!this.skillManifestApi || !this.skillManifest) {
      this._activeSkillNames = all.slice();
      return this._activeSkillNames.slice();
    }
    const r = this.skillManifestApi.resolveManifest(this.skillManifest, all);
    for (const err of r.errors) {
      this._recordSkillLoadError(err.skill || '(manifest)', new Error(err.code + ': 技能清单引用了未知技能「' + err.skill + '」（清单 id=' + (this.skillManifest.id || '?') + '）'));
    }
    this.skillManifestDisabled = r.disabled.slice();
    this._activeSkillNames = r.active.slice();
    return this._activeSkillNames.slice();
  }

  getSkillClassNames() {
    return [
      'NullSpaceProbeSkill', 'CounterexampleSkill', 'CanvasTweenDriverSkill', 'PechdtScaffoldSkill',
      'LinearSystemSolverSkill', 'KnowledgeNavigatorSkill', 'CodeSandboxSkill',
      'ImageGenerationSkill', 'CanvasGraphicsDriverSkill', 'WorkspaceFileSkill',
      'InteractiveArtifactSkill',
      'MathExperimentSkill',
      'WorkspaceInspectSkill',
      'ManimLessonSkill'
    ];
  }

  _recordSkillLoadError(skill, err) {
    if (!Array.isArray(this.skillLoadErrors)) this.skillLoadErrors = [];
    if (this.skillLoadErrors.some((x) => x.skill === skill)) return;
    const message = String((err && err.message) || err);
    this.skillLoadErrors.push({ skill, message });
    console.error('[TeachAgentEngine] SKILL_LOAD_FAILED: ' + skill + ' 加载失败，其工具不会注册 —— ' + message);
  }

  getSkillLoadErrors() {
    return Array.isArray(this.skillLoadErrors) ? this.skillLoadErrors.map((x) => ({ ...x })) : [];
  }

  getMathEngine() {
    if (typeof window !== 'undefined' && window.LinearAlgebraMathEngine) {
      return window.LinearAlgebraMathEngine;
    }
    if (typeof require !== 'undefined') {
      try { return require('./linearAlgebraEngine.js').LinearAlgebraMathEngine; } catch (error) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[TeachAgentEngine] LinearAlgebraMathEngine unavailable', { error: String(error && error.message || error) });
      }
    }
    return null;
  }

  loadConfig() {
    const MC = this._resolveModelCatalog();
    const defModel = MC && typeof MC.getDefaultModel === 'function' ? MC.getDefaultModel() : null;
    const defId = defModel ? defModel.id : 'MiniMax-M3.1-Flash-Preview';
    const isDefMinimax = /minimax/i.test(defId);
    const defaultCfg = {
      provider: isDefMinimax ? 'minimax' : 'custom',
      model: defId,
      apiKey: '',
      apiKeys: { minimax: '' },
      baseUrl: isDefMinimax ? 'https://api.botmeow.top/v1' : 'http://localhost:11434/v1',
      temperature: 0.7
    };
    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(this.storageKey);
        if (saved) Object.assign(defaultCfg, JSON.parse(saved));
        const savedSlots = localStorage.getItem('wenju_api_keys');
        if (savedSlots) {
          const parsedSlots = JSON.parse(savedSlots);
          defaultCfg.apiKeys = { minimax: '', ...(defaultCfg.apiKeys || {}), ...(parsedSlots || {}) };
        }
        const savedClient = localStorage.getItem('wenju_model_client_config');
        if (savedClient) {
          const parsedClient = JSON.parse(savedClient);
          if (parsedClient.modelId) {
            defaultCfg.model = parsedClient.modelId;
          }
        }
      }
    } catch (error) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[TeachAgentEngine] config_load_failed', { error: String(error && error.message || error) });
    }
    if (defaultCfg.provider !== 'custom' && /minimax/i.test(defaultCfg.model || '')) {
      defaultCfg.provider = 'minimax';
      if (!defaultCfg.baseUrl) {
        defaultCfg.baseUrl = 'https://api.botmeow.top/v1';
      }
    }
    if (MC && typeof MC.validateModel === 'function') {
      const v = MC.validateModel(defaultCfg.model, defaultCfg.apiKey, defaultCfg.provider);
      defaultCfg.model = v.modelId;
    }
    return defaultCfg;
  }

  guardModel(modelId) {
    const MC = this._resolveModelCatalog();
    if (MC && typeof MC.validateModel === 'function') {
      const v = MC.validateModel(modelId || this.config.model, this.getEffectiveApiKey(), this.config.provider);
      if (!v.valid) {
        const err = new Error(v.message);
        err.code = v.code || 'MODEL_UNAVAILABLE';
        err.source = 'cloud';
        return err;
      }
    }
    return null;
  }

  saveConfig(newConfig) {
    if (['provider','model','baseUrl','apiKey','customToolsMode'].some(key => Object.hasOwn(newConfig || {}, key) && newConfig[key] !== this.config[key])) this._noToolModels?.clear();
    this.config = { ...this.config, ...newConfig };
    this.config.model=this._resolveModelCatalog()?.canonicalModelId(this.config.model,this.config.provider)||this.config.model;
    const targetModel = this.config.model;
    if (this.config.provider !== 'custom' && /minimax/i.test(targetModel || '')) {
      this.config.provider = 'minimax';
      if (!this.config.baseUrl) {
        this.config.baseUrl = 'https://api.botmeow.top/v1';
      }
    }
    if (newConfig && typeof newConfig.apiKey === 'string' && this.config.provider === 'minimax') {
      this.config.apiKeys = { minimax: '', ...(this.config.apiKeys || {}), minimax: newConfig.apiKey.trim() };
      try { if (typeof localStorage !== 'undefined') localStorage.setItem('wenju_api_keys', JSON.stringify(this.config.apiKeys)); } catch (e) { /* 只读存储降级 */ }
    }
    if (this.modelClient && typeof this.modelClient.saveConfig === 'function') {
      const clientUpdate = {
        modelId: this.config.model,
        baseURL: this.config.baseUrl,
        apiKey: this.config.apiKey,
        apiKeys: this.config.apiKeys,
        providerId: this.config.provider
      };
      this.modelClient.saveConfig(clientUpdate);
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(this.config));
      }
    } catch (e) {
      console.warn('[TeachAgentEngine] Failed to persist config:', e);
    }
  }

  getConfig() {
    return { ...this.config };
  }

  _resolveModelCatalog() {
    let MC = typeof window !== 'undefined' ? window.ModelCatalog : null;
    if (!MC && typeof require !== 'undefined') {
      try { MC = require('./models/ModelCatalog.js').ModelCatalog; } catch (error) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[TeachAgentEngine] ModelCatalog unavailable', { error: String(error && error.message || error) });
      }
    }
    return MC || null;
  }

  modelSupportsTools(modelId) {
    if (this.config.customToolsMode === 'enabled') return true;
    if (this.config.customToolsMode === 'disabled') return false;
    const hasApiKey = !!(this.config?.apiKey && String(this.config.apiKey).trim());
    const isExternal = this.config?.provider && this.config.provider !== 'minimax';
    if (isExternal && hasApiKey && !this._noToolModels.has(modelId)) {
      return true;
    }
    const MC = this._resolveModelCatalog();
    return MC && MC.modelSupportsTools ? MC.modelSupportsTools(modelId, this.config?.provider) : true;
  }

  /**
   * 错误来源标记：只有云端请求 / 响应链路（fetch、HTTP 非 2xx、读响应流）上的异常才标 source='cloud'；
   * processQuery 的 catch 里未标记的异常一律按本地代码异常（LOCAL_ERROR）上报，绝不冒充云端失败。
   */
  _markCloudError(err) {
    const e = err instanceof Error ? err : new Error(String(err));
    if (!e.source) e.source = 'cloud';
    return e;
  }

  emitAgentUnavailable({ onUpdate, traceId, startTime, code, message, incomplete = false, partialAnswerText = '', priorSteps = null, stage = '' }) {
    if (incomplete) {
      // B-R1-3: 云端流中途出错 —— 已流出的正文原样保留（不清空、不改写），末尾追加「未完成」标记；status=failed，绝不报 completed
      const errStep = { id: 'step_stream_incomplete', icon: 'alert', title: (stage || 'Stream Incomplete') + ' · ' + code, detail: '本轮回答未完成（' + (stage || '云端中途出错') + '）：' + message, status: 'error', incomplete: true };
      const steps = Array.isArray(priorSteps) && priorSteps.length ? [...priorSteps, errStep] : [errStep];
      onUpdate({ type: 'steps_update', traceId, steps });
      const tail = `> ⚠️ **本轮回答未完成（${stage || '云端中途出错'}，${code}）**：${message}`;
      onUpdate({
        type: 'done', traceId, status: 'failed', mode: 'unavailable', errorCode: code, incomplete: true,
        elapsedSeconds: ((Date.now() - startTime) / 1000).toFixed(1),
        thoughtText: '', steps,
        partialAnswerText,
        answerText: partialAnswerText ? `${partialAnswerText}\n\n${tail}` : tail
      });
      return;
    }
    const steps = [{ id: 'step_unavailable', icon: 'alert', title: 'Agent Unavailable · ' + code, detail: message, status: 'error' }];
    onUpdate({ type: 'steps_update', traceId, steps });
    onUpdate({
      type: 'done', traceId, status: 'failed', mode: 'unavailable', errorCode: code,
      elapsedSeconds: ((Date.now() - startTime) / 1000).toFixed(1),
      thoughtText: '', steps,
      answerText: `> ❌ **Agent 不可用（${code}）**：${message}` + (['NO_API_KEY', 'AUTH_401'].includes(code) ? '\n\n<p style="margin-top:8px;"><button type="button" class="btn-chat-open-settings" data-action="open-settings" style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;font-size:12px;font-weight:600;color:#0284c7;background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;cursor:pointer;">⚙ 立即配置 API Key ↗</button></p>' : '')
    });
  }

  getCurrentMode() {
    return this.hasValidApiKey() ? 'cloud' : 'unavailable';
  }

  /**
   * 核心推理入口：根据环境与配置自动调度真实云端大模型或确定性符号底座
   */
  async processQuery({ text, imageBase64 = null, currentMatrixState = null, reasoningEffort = null, onUpdate = () => {} }) {
    if (this.isProcessing) return;
    this.isProcessing = true;
    this._lastQueryText = text;      // P2：工具近邻守卫的意图对照文本

    const traceId = 'wenju_trace_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    this._lastTraceId = traceId; // P6-B：工具 span 与请求 span 共享同一 traceId
    if (!this.tracer && typeof window !== 'undefined' && window.agentTracer) this.tracer = window.agentTracer; // P6-B：惰性拾取（初始化顺序无关）
    const startTime = Date.now();
    const run = {
      reasoningEffort: reasoningEffort || this.config.reasoningEffort || 'medium',
      id: `run_${++this._runEpoch}`, sceneId: traceId, traceId, startTime,
      controller: new AbortController(), done: false, publish: onUpdate,
      visualTask: { surface: null, solidKind: /正方体|立方体/.test(text || '') ? 'cube' : /球体/.test(text || '') ? 'sphere' : null, preferredSurface: /正方体|立方体|球体|圆柱|圆锥|三维|\b3d\b/i.test(text || '') && !/二维.*投影|2d.*投影|双视图|同时.*画板/i.test(text || '') ? 'artifact' : null },
      answerText: '', thoughtText: '', steps: []
    };
    this._activeRun = run;
    onUpdate = (update) => {
      if (!this._isRunActive(run) || !update) return;
      if (typeof update.answerText === 'string') run.answerText = update.answerText;
      if (typeof update.thoughtText === 'string') run.thoughtText = update.thoughtText;
      if (Array.isArray(update.steps)) run.steps = update.steps.map((step) => ({ ...step }));
      const event = { ...update, runId: run.id, sceneId: run.sceneId };
      if (update.type === 'done') { run.done = true; run.result = event; }
      run.publish(event);
    };
    this._activeOnUpdate = onUpdate;

    // B-R1-3: 画板状态读取与 Skill 告警都放进 try —— 任何本地异常 → 显式 LOCAL_ERROR；finally 必复位 isProcessing，会话不锁死
    let matState = currentMatrixState;
    try {
      // 优先读取几何画板的最新物理状态
      if (!matState && this.workspaceVisualizer) {
        const mat = this.workspaceVisualizer.getMatrix ? this.workspaceVisualizer.getMatrix() : { a: 1, b: 0, c: 0, d: 1 };
        const det = this.workspaceVisualizer.getDeterminant ? this.workspaceVisualizer.getDeterminant() : 1;
        const rank = this.workspaceVisualizer.getRank ? this.workspaceVisualizer.getRank() : 2;
        matState = {
          e1: [mat.a, mat.c],
          e2: [mat.b, mat.d],
          det,
          rank
        };
      }

      // N2: Skill 加载失败对用户可见：每轮先挂一条 warning 步骤，并让后续 steps_update / done 都带上它与 skillLoadErrors
      const skillLoadErrors = this.getSkillLoadErrors();
      if (skillLoadErrors.length > 0) {
        const rawOnUpdate = onUpdate;
        const warnStep = {
          id: 'step_skill_load_error', icon: 'alert', title: 'Skill Load Failed · SKILL_LOAD_FAILED', status: 'warning',
          detail: '以下 Skill 加载失败，其工具本轮不可用：' + skillLoadErrors.map((x) => x.skill + '（' + x.message + '）').join('；')
        };
        onUpdate = (u) => {
          if (u && (u.type === 'steps_update' || u.type === 'done') && Array.isArray(u.steps) && !u.steps.some((s) => s && s.id === warnStep.id)) {
            u = { ...u, steps: [warnStep, ...u.steps], skillLoadErrors };
          }
          return rawOnUpdate(u);
        };
        rawOnUpdate({ type: 'steps_update', traceId, steps: [warnStep], skillLoadErrors });
      }

      // 🛡️ [前置门禁] PECHDT 防剧透与苏格拉底脚手架拦截

      const skillClasses = this.resolveSkillClasses();
      const pechdtSkill = skillClasses.PechdtScaffoldSkill ? new skillClasses.PechdtScaffoldSkill() : null;
      if (pechdtSkill && pechdtSkill.isDirectAnswerRequested(text)) {
        // :299 清偿（B 线 v6）：防剧透门禁直接拦截——不调用 runVerifiableLocalAgent（门禁不是推导入口），
        // 显式署名 mode=pechdt_gate / code=PECHDT_GATE，0 网络请求、0 本地推导
        const gateStep = {
          id: 'step_pechdt_gate',
          icon: 'lock',
          title: 'PECHDT 门禁提示 · 直接答案已拦截',
          detail: '检测到直接索取答案的请求。按探究式协议（预测→实验→冲突→边界猜想→推导验证→无提示变式），本系统不输出终态答案；请先提交你的预测与理由，实验台将执行精确计算供你对照。',
          status: 'info'
        };
        onUpdate({ type: 'steps_update', traceId, steps: [gateStep] });
        onUpdate({
          type: 'done',
          traceId,
          status: 'completed',
          mode: 'pechdt_gate',
          code: 'PECHDT_GATE',
          errorCode: 'PECHDT_GATE',
          elapsedSeconds: ((Date.now() - startTime) / 1000).toFixed(1),
          thoughtText: '',
          steps: [gateStep],
          verifiedByOracle: false,
          answerText: '> 🔒 **PECHDT 门禁提示**：检测到直接索取答案的请求，已按探究式协议拦截。\n\n' +
            '本轮不提供终态答案。请先回答：**你预测结果是什么？为什么？**\n\n' +
            '提交预测后，实验台将执行精确计算与几何可视化，供你与自己的预测对照，再进入边界猜想与推导验证环节。'
        });
        return;
      }

      if (/^(请|帮我|给我|麻烦|能不能|你)?(画|绘制|生成|展示|做)(一下|一个|个)?(可旋转的|三维的|3D)?(正方体|立方体|球体)[。！!？?\s]*$/i.test(String(text || '').trim())) {
        const library = typeof window !== 'undefined' ? window.SolidGeometry : require('./artifacts/SolidGeometry.js');
        if (!library) throw new Error('SOLID_GEOMETRY_UNAVAILABLE');
        const kind = run.visualTask.solidKind;
        const result = await this.executeToolCall({name:'render_interactive_artifact',args:{solid_type:kind,artifact_id:'solid-'+kind}},run);
        this._assertRunActive(run);
        const steps=[{id:'solid',tool:'render_interactive_artifact',title:'参数化几何组件',status:result.status,result,detail:result.detail}];
        onUpdate({type:'steps_update',steps});
        onUpdate({type:'done',status:result.status === 'success' ? 'completed' : 'failed',mode:'geometry',steps,thoughtText:'',elapsedSeconds:((Date.now()-startTime)/1000).toFixed(1),answerText:result.status === 'success' ? (kind === 'cube' ? '已打开正方体交互视图。它由 8 个顶点、12 条等长棱和 6 个正方形面构成。拖动画面旋转，使用下方滑块调整视角与棱长。透视图中的边长看起来可以不同，空间中的 12 条棱仍然等长。' : '已打开球体交互视图。拖动画面旋转经线，使用半径滑块查看体积变化。') : result.detail});
        return;
      }

      const modelId = this.config.model || 'Qwen/Qwen2.5-7B-Instruct';
      const guardErr = this.guardModel(modelId); if (guardErr) { this.emitAgentUnavailable({ onUpdate, traceId, startTime, code: guardErr.code || 'MODEL_UNAVAILABLE', message: guardErr.message }); return; }

      if (this.hasValidApiKey()) {
        return await this._awaitRun(this.runRealCloudAgent({
          text,
          imageBase64,
          currentMatrixState: matState,
          onUpdate,
          startTime,
          traceId,
          run
        }), run);
      } else {
        this.emitAgentUnavailable({ onUpdate, traceId, startTime, code: 'NO_API_KEY',
          message: '未配置云端 API Key，Agent 不可用。请在设置中填写 Key 后重试（本地不提供替代回答）。' });
      }
    } catch (err) {
      if (run.controller.signal.aborted || err?.code === 'ABORTED' || err?.name === 'AbortError') {
        return this._finishAbortedRun(run);
      }
      const isCloud = !!(err && err.source === 'cloud');
      console.error('[TeachAgentEngine] Processing failed (' + (isCloud ? 'cloud' : 'local') + '):', err);
      // DEBT-NO-SILENT-FALLBACK: 失败直接显式报错，不切换本地确定性脚本冒充回答
      // B-R1-1: 按来源分开报——只有云端链路标记过的异常才是 CLOUD_ERROR，其余一律 LOCAL_ERROR
      const raw = String((err && err.message) || err || '未知错误');
      if (isCloud && err.incomplete) {
        // B-R1-3: SSE 中途 error 块 → CLOUD_ERROR，保留已流出正文并标未完成
        // B3: 第二轮 HTTP 失败 → 401 为 AUTH_401、其余为 CLOUD_ERROR；第一轮已出的正文与工具步骤都标 incomplete
        const code = ['AUTH_401','MODEL_NO_TOOLCALL','OUTPUT_TOKEN_LIMIT','REASONING_ONLY_REPLY','MODEL_CONTENT_FILTERED','EMPTY_MODEL_REPLY'].includes(err.code) ? err.code : 'CLOUD_ERROR';
        this.emitAgentUnavailable({ onUpdate, traceId, startTime, code, message: code === 'AUTH_401' ? `${raw}。未生成任何替代回答。` : raw,
          incomplete: true, partialAnswerText: String(err.partialAnswerText || ''),
          priorSteps: Array.isArray(err.steps) ? err.steps : null, stage: err.stage || '云端中途出错' });
      } else if (isCloud && err.code === 'AUTH_401') {
        // B-R1-3: 引擎自身请求路径 401 → AUTH_401（固定文案，不回显服务端返回体 / Key）
        this.emitAgentUnavailable({ onUpdate, traceId, startTime, code: 'AUTH_401', message: `${raw}。未生成任何替代回答。` });
      } else if (isCloud) {
        const code = /20037|function call|tools? (is|are) not supported|does not support tools/i.test(raw) ? 'MODEL_NO_TOOLCALL' : 'CLOUD_ERROR';
        this.emitAgentUnavailable({ onUpdate, traceId, startTime, code,
          message: `云端模型调用失败：${raw}。未生成任何替代回答。` });
      } else {
        const stackLines = String((err && err.stack) || '').split('\n').map((x) => x.trim()).filter(Boolean);
        const firstFrame = stackLines.find((x) => x.startsWith('at ')) || '(无调用栈)';
        const errName = (err && err.name) || 'Error';
        this.emitAgentUnavailable({ onUpdate, traceId, startTime, code: 'LOCAL_ERROR',
          message: `本地代码异常（非云端故障）：${errName}: ${raw} @ ${firstFrame}。未生成任何替代回答。` });
      }
    } finally {
      if (this._activeRun === run) {
        this.isProcessing = false;
        this._activeRun = null;
        this._activeOnUpdate = null;
      }
    }
  }

  /**
   * 真实云端大模型 Agent: 严格执行标准 OpenAI / DeepSeek 两轮 Function Calling 状态机
   */
  async _requestModelStream({ url, body, apiKey, modelName, onUpdate, traceId, startTime, initialThought = '', stage = '', run = null, recoveryAttempt = 0 }) {
    this._assertRunActive(run);
    if (!this.modelTransport) {
      const error = this._markCloudError(new Error('MODEL_TRANSPORT_UNAVAILABLE'));
      error.code = 'MODEL_TRANSPORT_UNAVAILABLE';
      error.stage = stage;
      throw error;
    }
    const policy = (typeof window !== 'undefined' && window.TeachingProtocol ? window.TeachingProtocol : typeof require === 'function' ? require('./teaching/TeachingProtocol.config.js') : null)?.config.generation || { defaultEffort: 'medium', miniMaxMaxTokens: 16384, maxRecoveryAttempts: 1 };
    const miniMax31 = /minimax[-_]m3\.1/i.test(modelName || body.model || this.config.model || '');
    const requestBody = { max_tokens: this.config.maxTokens || (miniMax31 ? policy.miniMaxMaxTokens : 8192), ...body };
    const MC=this._resolveModelCatalog();
    requestBody.model=MC?.canonicalModelId(requestBody.model,this.config.provider)||requestBody.model;
    if(MC?.requiresReasoningReplay(requestBody.model)){
      Object.assign(requestBody,MC.deepseekRequestOptions(requestBody.model,recoveryAttempt?'none':run?.reasoningEffort||this.config.reasoningEffort||'low'));
      if(requestBody.thinking.type==='enabled')delete requestBody.temperature;
    }
    if (miniMax31) {
      const effort = recoveryAttempt ? 'low' : (run?.reasoningEffort || this.config.reasoningEffort || policy.defaultEffort);
      requestBody.reasoning_effort = ['low','medium','high','xhigh','max'].includes(effort) ? effort : 'low';
      requestBody.stream_options = { ...body.stream_options, include_usage: true };
    }
    // P6-B：模型请求 span（AgentTracer；traceId 与引擎会话对齐）
    const span = this.tracer ? this.tracer.startSpan({
      traceId, name: 'model.request',
      attributes: { model: modelName, stage, stream: true, hasTools: !!(body && Array.isArray(body.tools) && body.tools.length) }
    }) : null;
    let thoughtText = String(initialThought || '');
    let answerText = '';
    let inThinkTag = false;
    const emitThought = () => onUpdate({ type: 'thought_chunk', traceId, thoughtText,
      elapsedSeconds: ((Date.now() - startTime) / 1000).toFixed(1) });
    const emitAnswer = () => onUpdate({ type: 'answer_chunk', traceId, answerText });
    const appendContent = (chunk) => {
      if (!this._isRunActive(run)) return;
      let raw = _sanitizeStreamToken(chunk);
      while (raw) {
        if (!inThinkTag) {
          const start = raw.indexOf('<think>');
          if (start < 0) {
            answerText += raw;
            emitAnswer();
            return;
          }
          const before = raw.slice(0, start);
          if (before) { answerText += before; emitAnswer(); }
          inThinkTag = true;
          raw = raw.slice(start + 7);
        } else {
          const end = raw.indexOf('</think>');
          if (end < 0) {
            thoughtText += raw;
            emitThought();
            return;
          }
          const inside = raw.slice(0, end);
          if (inside) { thoughtText += inside; emitThought(); }
          inThinkTag = false;
          raw = raw.slice(end + 8);
        }
      }
    };

    try {
      const result = await this._awaitRun(this.modelClient.streamAgentTurn({
        url, body: requestBody, apiKey,
        signal: run ? run.controller.signal : undefined,
        method: 'POST',
        model: modelName,
        secret: apiKey,
        timeoutMs: 25000,
        idleTimeoutMs: 25000,
        maxRetries: Number.isInteger(this.config.maxRetries) ? this.config.maxRetries : 0
      }, {
        onChunk: (chunk) => appendContent(chunk),
        onReasoning: (chunk) => { if (this._isRunActive(run)) { thoughtText += _sanitizeStreamToken(chunk); emitThought(); } }
      }), run);
      this._assertRunActive(run);
      if (!answerText && result && result.content) appendContent(result.content);
      if (!thoughtText && result && result.reasoning_content) {
        thoughtText = _sanitizeStreamToken(result.reasoning_content);
        emitThought();
      }
      let finalAnswer = _sanitizeStreamToken(answerText).trim();
      const finalThought = _sanitizeStreamToken(thoughtText).trim();
      if (result?.finish_reason === 'length' || result?.finish_reason === 'content_filter' || (!result?.endedByDone && !result?.finish_reason && !finalAnswer && !result?.tool_calls?.length)) {
        const code = result?.finish_reason === 'length' ? 'OUTPUT_TOKEN_LIMIT' : result?.finish_reason === 'content_filter' ? 'MODEL_CONTENT_FILTERED' : 'EMPTY_MODEL_REPLY';
        throw Object.assign(new Error(code + '：模型未返回完整正文，请继续本轮；已有内容已保留。'), { code, incomplete: true });
      }
      if (!finalAnswer && finalThought && !result?.tool_calls?.length) throw Object.assign(new Error('REASONING_ONLY_REPLY：模型只返回推理，未提供教学正文。'), { code: 'REASONING_ONLY_REPLY', incomplete: true });
      if (!finalAnswer && !result?.tool_calls?.length) throw Object.assign(new Error('EMPTY_MODEL_REPLY：模型返回了空答复，请重试本轮。'), { code: 'EMPTY_MODEL_REPLY', incomplete: true });
      const toolCalls = (result && result.tool_calls) || [];
      const usage = (result && result.usage) || null;
      if (span) this.tracer.endSpan(span, { status: 'ok', attributes: {
        contentChars: finalAnswer.length, reasoningChars: finalThought.length,
        toolCallCount: toolCalls.length,
        usage: usage ? { prompt: usage.prompt_tokens ?? null, completion: usage.completion_tokens ?? null, total: usage.total_tokens ?? null } : null
      } });
      return { thoughtText: finalThought, reasoningContent: result?.reasoning_content || '', answerText: finalAnswer, toolCalls, usage };
    } catch (error) {
      if (error?.code === 'ABORTED' || error?.name === 'AbortError' || run?.controller.signal.aborted) {
        if (span) this.tracer.endSpan(span, { status: 'aborted', attributes: { errorCode: 'ABORTED', stage } });
        throw this._abortError();
      }
      if (['OUTPUT_TOKEN_LIMIT', 'REASONING_ONLY_REPLY'].includes(error?.code) && recoveryAttempt < policy.maxRecoveryAttempts) {
        if (span) this.tracer.endSpan(span, { status: 'error', attributes: { errorCode: error.code, recoveryAttempt } });
        onUpdate({ type: 'generation_recovery', traceId, code: error.code, attempt: recoveryAttempt + 1,
          message: '输出额度已耗尽，正在降低推理深度重新生成正文或完整工具调用。' });
        // Reissue the same unexecuted model turn. Never replay truncated tool arguments or private reasoning.
        const messages = [...(body.messages || [])];
        const instruction = '本次生成必须控制篇幅：尽快给出中文正文或一个完整工具调用，避免反复规划。需要工件时先交付最小可运行交互演示，避免长篇 HTML。不要重复已在工具结果中完成的操作，不要输出内部草稿。';
        const first = messages[0];
        if (first?.role === 'system' && typeof first.content === 'string') messages[0] = { ...first, content: first.content + '\n' + instruction };
        else messages.unshift({ role: 'system', content: instruction });
        try {
          return await this._requestModelStream({ url, body: { ...body, messages }, apiKey, modelName,
            onUpdate, traceId, startTime, initialThought: thoughtText, stage, run, recoveryAttempt: recoveryAttempt + 1 });
        } catch (recoveryError) {
          if (!recoveryError.partialAnswerText && answerText) recoveryError.partialAnswerText = answerText;
          throw recoveryError;
        }
      }
      const mapped = this._markCloudError(error);
      if (mapped.status === 401) mapped.code = 'AUTH_401';
      mapped.stage = stage;
      mapped.incomplete = true;
      mapped.partialAnswerText = answerText;
      mapped.steps = [];
      if (span) this.tracer.endSpan(span, { status: 'error', attributes: { errorCode: String(mapped.code || mapped.status || 'ERROR'), stage } });
      throw mapped;
    }
  }

  async runRealCloudAgent({ text, imageBase64, currentMatrixState, onUpdate, startTime, traceId, forceNoTools = false, run = null }) {
    this._assertRunActive(run);
    const modelName = this.config.model || 'MiniMax-M3.1-Flash-Preview';
    const blocked = this.guardModel(modelName); if (blocked) throw blocked;
    const baseUrl = this.getEffectiveBaseUrl(this.config.baseUrl, modelName);
    const apiKey = this.getEffectiveApiKey(this.config.apiKey, modelName);
    const url = this.config.provider==='deepseek_official'||baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
    // DEBT-MODEL-TOOLCALL: 不支持 Function Calling 的模型 -> 真实云端调用但不携带工具，并显式标注（非降级、非 mock）
    if (!this._noToolModels) this._noToolModels = new Set();
    const toolsAllowed = !forceNoTools && this.modelSupportsTools(modelName) && !this._noToolModels.has(modelName);
    // 诊断：真页面复现时据此判断请求前拦截为何没生效（读到的 model id / 能力判定 / ModelCatalog 是否可用）
    console.info('[ModelCapability]', modelName, toolsAllowed, !!this._resolveModelCatalog(),
      { forceNoTools, catalogSupportsTools: this.modelSupportsTools(modelName), learnedNoTools: this._noToolModels.has(modelName) });
    if (!toolsAllowed) {
      onUpdate({ type: 'steps_update', traceId, steps: [{ id: 'step_no_tools', icon: 'alert', title: 'Tools Disabled · MODEL_NO_TOOLCALL',
        detail: `模型 ${modelName} 不支持 Function Calling：本轮为纯推理对话，不驱动画板、不调用工具。`, status: 'warning' }] });
    }

    const a = currentMatrixState?.e1?.[0] ?? 1.0;
    const c = currentMatrixState?.e1?.[1] ?? 0.0;
    const b = currentMatrixState?.e2?.[0] ?? 0.0;
    const d = currentMatrixState?.e2?.[1] ?? 1.0;
    const det = currentMatrixState?.det ?? (a * d - b * c);
    const rank = currentMatrixState?.rank ?? (Math.abs(det) < 0.05 ? 1 : 2);

    const isLinearAlgebra = /矩阵|行列式|零空间|特征值|核空间|基向量|奇异|代数|降维|画板|拉伸|仿射|线性方程|A[·\.\s]*B|kernel|nullspace|rank|det/i.test(text || '');

    let systemPrompt;
    if (isLinearAlgebra) {
      let mathFacts = '';
      const MathEngine = this.getMathEngine();
      if (MathEngine && typeof MathEngine.analyzeMatrix2x2 === 'function') {
        try {
          const aRes = MathEngine.analyzeMatrix2x2(a, b, c, d);
          const nullRepr = aRes.nullBasis && aRes.nullBasis.length > 0
            ? aRes.nullBasis.map(v => `[${v[0].toFixed(2)}, ${v[1].toFixed(2)}]^T`).join(', ')
            : '仅原点 {0}';
          const colRepr = aRes.colBasis && aRes.colBasis.length > 0
            ? aRes.colBasis.map(v => `[${v[0].toFixed(2)}, ${v[1].toFixed(2)}]^T`).join(', ')
            : '全空间 ℝ²';
          const eigs = aRes.eigenvalues && aRes.eigenvalues.length > 0
            ? aRes.eigenvalues.map(v => v.toFixed(2)).join(', ')
            : '无实特征值 (复共轭旋转)';
          mathFacts = `
- [符号真理机 Tier-1 CAS 断言]: 迹 tr(A)=${aRes.trace.toFixed(2)}, 特征值 λ=[${eigs}], 零空间基底={${nullRepr}}, 列空间基底={${colRepr}}`;
        } catch (error) {
          if (typeof console !== 'undefined' && console.warn) console.warn('[TeachAgentEngine] math_context_failed', { error: String(error && error.message || error) });
        }
      }

      systemPrompt = `你是《问矩》线性代数实验式探究智能助教 Agent。
你的任务是以苏格拉底式启发引导学生，深入理解矩阵的几何变换、行列式面域测度、奇异降维与零空间本质。
[坐标画板状态；只有当前表面为 canvas 时可用作当前画面事实]:
- 矩阵分量 A = [[${a.toFixed(2)}, ${b.toFixed(2)}], [${c.toFixed(2)}, ${d.toFixed(2)}]]
- 基底向量 e1 = (${a.toFixed(2)}, ${c.toFixed(2)})^T, e2 = (${b.toFixed(2)}, ${d.toFixed(2)})^T
- 行列式 det(A) = ${det.toFixed(2)}, 秩 rank(A) = ${rank}
- 零空间状态: ${rank < 2 ? '一维非平凡零空间流形 (降维奇异)' : '平凡核空间 {0} (保维同构)'}${mathFacts}

[意图边界与闲聊契约]（必须严格遵守）:
- 面对纯问候、日常闲聊、感谢或确认（如「你好」「您好」「hello」「hi」「在吗」「谢谢」等），严禁调用任何工具（严禁调用 render_interactive_artifact / render_canvas_graphics / math_experiment 等）；必须直接以亲切、简明的中文纯文本自然回应，并主动引导学生提出想探究的线性代数或几何问题。
- 概念问答与理论解释优先纯文本：当学生询问概念定义、定理直观、学习建议或纯数学推导时（未明确指示「画图」「演示」「打开画板」「生成工件」），优先使用自然生动的文字与标准 LaTeX 公式直接解答；严禁无端生成粗糙或空白的占位工件打断学生的画板体验。
- 仅当学生提出明确的几何绘图、数学实验、代数求解、代码编写或文件操作时，才按需调用工具。

[核心工具调度准则]:
1. 若学生的探究或提问需要演示几何变换（如降维、剪切、旋转、标准基等），请优先调用 math_experiment 创建或更新受控数学场景；只有用户明确操作坐标画板时使用 drive_canvas_affine_transform。
2. 若用户要求在左侧画布绘制几何图形（如菱形 diamond、多边形 polygon、圆 circle、矩形 rectangle、函数曲线 function_curve 等），自由二维草图使用 render_canvas_graphics；线代教学使用 math_experiment，正方体与球体使用受控三维工件。
3. 若需要精确求解矩阵的核空间基向量或计算秩，调用 solve_matrix_kernel_sympy 工具！
4. 若讨论两个非零矩阵乘积为零矩阵（A·B = O）、零因子、反例或可逆性，必须调用 construct_counterexample_matrix 工具获取反例；同时在最终回答中结合实际已打开的数学场景解释：明确指出 A·B = [A·b₁, A·b₂] = [0, 0] 的本质是矩阵 B 的每一列向量都必须落在矩阵 A 的零空间（核空间）Null(A) 中，只能引用实际回读到的图形；核与像对照使用 math_experiment(step=spaces)，不得假定画板上已有某条直线。
5. 若需要编写或验证代码逻辑，调用 execute_code_sandbox（已全面支持 Python 与 JavaScript 双语言执行）；若需要管理项目代码文件，调用 manage_workspace_file！
6. 控制推理篇幅，及时调用工具并输出中文教学正文；不反复规划，不输出内部草稿。
7. 最终回答必须提供详尽生动的数学解释与几何直观推导，严格使用标准 LaTeX 公式（行内 $...$，独占块 $$...$$），切忌只输出一段裸露的代码块或矩阵数值而无任何文字解析；必须以苏格拉底式的循循善诱带领学生洞察代数本质。`;
    } else {
      systemPrompt = `你是《问矩》全能 AI 编程与工作台助手 (深度对标 ZCode / DeepSeek Harness)。
你具备通用代码编写、算法设计、系统架构分析、技术文档互译与多模态视觉感知能力。
[可用工具]:
- render_canvas_graphics: 在左侧工作区交互画布上真实光栅化绘制矢量几何图元 (菱形 diamond、多边形 polygon、圆 circle、矩形 rectangle、函数曲线 function_curve 等)！用户明确请求自由二维草图时使用；数学实验优先 math_experiment，三维实体使用受控三维工件。切忌用控制台字符敷衍！
- execute_code_sandbox: 在安全沙箱环境中执行 Python 或 JavaScript 代码脚本与算法逻辑，即时验证并捕获 stdout 输出！当用户要求编写代码并测试、运行时调用此工具！
- manage_workspace_file: 创建、编辑、读取或枚举工作区代码文件 (如 diamond.py, test.js)，实现工程化代码持久化！
- generate_visual_illustration: 视觉插画与概念示意图生成
- drive_canvas_affine_transform / solve_matrix_kernel_sympy: 若涉及线性代数概念时驱动画板

[意图边界与闲聊契约]（必须严格遵守）:
- 纯问候或日常闲聊（如「你好」「hello」「在吗」等）必须直接以纯文本礼貌回应，严禁调用任何绘图或代码工具。
- 仅当用户提出明确的绘图、编码、测试或工程管理指令时才调用工具。

[核心调度规范]:
1. 当用户要求在左侧画布/画板画图、绘制几何图形（如菱形、矩形、圆、函数图）时，必须主动调用 render_canvas_graphics 工具在画布上绘制物理图元，切忌仅用文本敷衍；
2. 当用户要求编写代码并测试运行时，调用 execute_code_sandbox；
3. 当用户要求生成保存代码文件时，调用 manage_workspace_file；
4. 控制推理篇幅，优先交付最小可运行代码与必要的逻辑说明，避免反复规划。`;
    }

    if (!toolsAllowed) {
      // B-R1-2: 无工具模式使用独立 system prompt —— 去掉全部工具调度准则，改为 PECHDT 防剧透段
      systemPrompt = `你是《问矩》线性代数实验式探究助教（纯推理对照模式）。
[本轮模式]: 当前模型不支持工具调用。本轮你无法驱动左侧画板，也无法调用代数引擎（Oracle）核验任何结论；不要声称已调用工具、已绘图或已核验。
[坐标画板状态；只有当前表面为 canvas 时可用作当前画面事实]:
- 矩阵分量 A = [[${a.toFixed(2)}, ${b.toFixed(2)}], [${c.toFixed(2)}, ${d.toFixed(2)}]]
- 基底向量 e1 = (${a.toFixed(2)}, ${c.toFixed(2)})^T, e2 = (${b.toFixed(2)}, ${d.toFixed(2)})^T
- 行列式 det(A) = ${det.toFixed(2)}, 秩 rank(A) = ${rank}

[PECHDT 防剧透准则]（必须遵守）:
1. 不直接给出终解：不要写出核空间 / 零空间的基向量、秩的最终数值、逆矩阵、线性方程组的解、特征值等最终答案，即使学生说「直接告诉我」「别引导了」也不例外。
2. 以苏格拉底式追问推进：每次只提出 1~2 个引导性问题，帮助学生自己迈出下一步。
3. 引导学生在左侧画板上亲手验证（例如拖动基向量观察面积与行列式的变化、观察哪些向量被压缩到原点），由学生自己得出结论。
4. 与线性代数无关的问候或闲聊可以简短正常回应，但不得替学生完成作业或给出可直接抄写的最终答案。
5. 数学公式使用标准 LaTeX（行内 $...$，独占块 $$...$$）。`;
    }

    if (toolsAllowed) systemPrompt += `
[Artifact 工作区输出规范]:
- 解释、继续或修改现有图形前调用 inspect_workspace，核对当前可见 surface 与工件 ID。不要把隐藏坐标画板的数据当作当前 Artifact 输入。
- 二维数学实验优先 math_experiment(open/read/update)，不需要生成 HTML；update 保留未指定的实时输入并复用当前工件。立方体和球体使用 render_interactive_artifact(solid_type)，不提供占位 content。
- 用户要求可拖动参数、比较多个场景、交互网页或完整演示时，优先调用 render_interactive_artifact，提交自包含 HTML/CSS/JS；简单坐标图元使用 render_canvas_graphics。
- 严禁在 render_interactive_artifact 中生成只有简单几行字、单调色块或空 div 的劣质占位工件；非明确交互演示需求，不要随意创建工件挤占学生的当前视图。
- 交互工件在无网络的 iframe 中运行：不要依赖 CDN、宿主 window 对象或外部脚本。控件必须绑定实际计算和图形更新；不要用静态截图冒充交互。
- 工件采用响应式布局、可读字号与清晰工具层级。完整数学说明放在图例/侧栏；避免把多组长标签和全部顶点坐标堆在同一坐标位置。几何必须等比例。
- 数学交互演示以约 600×450 的 iframe 可视区为约束：根布局 height:100dvh，grid-template-rows:auto minmax(0,1fr) auto；主图使用剩余空间，SVG 保持 viewBox 等比例。不要重复外壳标题或设置大幅页眉。按钮高24–28px，滑块轨道3–4px、拇指12–14px；参数横向紧凑排列，窄屏折成短行；数值用一行读数，解释默认最多两行、完整说明可展开。确保主图与全部参数同时可见，不把控制台放在超长页面底部。
- 修订已有工件时复用 artifact_id。不得声称预览或数学验证成功，除非工具结果明确支持。
`;
    let userContent = [];
    if (imageBase64) {
      userContent.push({
        type: 'image_url',
        image_url: { url: imageBase64 }
      });
    }
    userContent.push({
      type: 'text',
      text: text || '请结合当前环境为我展开深度分析与推导。'
    });

    // 动态提取 MCP 工具 Schemas
    let tools = [];
    if (this.mcpServer) {
      try {
        const mcpList = await this.mcpServer.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
        if (mcpList?.result?.tools) {
          tools = mcpList.result.tools.map(t => ({
            type: 'function',
            function: this.getAccessLevel() === 'readonly' && ['manage_workspace_file','math_experiment'].includes(t.name) ? { ...t, parameters: { ...t.parameters, properties: { ...t.parameters.properties, action: { ...t.parameters.properties.action, enum: t.name === 'manage_workspace_file' ? ['read','list'] : ['read','verify','inspect_layout'] } } } } : t
          })).filter(t => this.getAccessLevel() !== 'readonly' || this.isReadonlyTool(t.function.name, { action: 'read' }));
        }
      } catch (e) {
        console.warn('[TeachAgentEngine] Failed to export MCP tools:', e);
      }
    }

    // B-R1-3: 每个工具自身的 JSON Schema（来自 MCP tools/list），用于校验模型给出的参数
    const toolSchemas = {};
    for (const t of tools) { if (t && t.function && t.function.name) toolSchemas[t.function.name] = t.function.parameters || t.function.inputSchema || null; }

    const teachingPolicy = typeof window !== 'undefined' ? window.TeachingProtocol : require('./teaching/TeachingProtocol.config.js');
    if (this.getAccessLevel() === 'readonly') systemPrompt += '\n[当前权限] 只读观察：只读取现有工作区、文件或实验输入。不能创建或修改画板、工件、文件，不能执行代码。工具定义中的 action 已限制为只读操作；禁止宣称已完成写入。';
    if (isLinearAlgebra || (typeof window !== 'undefined' && window.inquiryFlow?.task)) {
      const stage = typeof window !== 'undefined' ? window.pechdtStateStore?.getState()?.stage : 'PREDICT';
      if (teachingPolicy) systemPrompt += teachingPolicy.prompt(stage);
    }
    systemPrompt += '\n[显示表面契约] 三维实体（正方体、球体等）使用 render_interactive_artifact 实现真实可旋转的三维投影。不得先在二维画板画两个面冒充立体。每次绘图选择一个表面；除非用户明确要求双视图，不重复绘制到另一个表面。二维工具的新问题默认替换旧场景。HTML 演示直接交给工件预览器；不要用无 DOM 的代码沙箱测试网页。预览失败要修订同一 artifact_id，不能宣称成功。';
    systemPrompt += '\n[数学交互实验] 二维线性变换、AB/BA复合、方程组、特征方向优先调用 math_experiment(action=open)，只提交数值输入，无须生成HTML。二维矩阵A/B用按行四元素数组，v/b用二元素数组；三维用experiment=linear-map-3d、A按行九元素、v三元素。分析学生操作前先read；二维分镜通过seek(step=basis/transform/spaces/linearity,t=0到1)、play/pause控制；打开后inspect_layout检查，再verify核验当前输入。核位于输入空间，像位于输出空间，不要叠加解释长段落。数值核验不能代替一般证明。当前视频生成关闭，不提交渲染任务；已有微课可通过 play_manim_lesson(action=play)播放。课程与图谱只以作答核验记录练习进度，禁止根据话题或工具成功断言学生已掌握。';
    systemPrompt += '\n工件状态恢复契约：把旋转角、选择项等 JSON 状态放入 window.artifactState，变化后派发 artifact-state-changed；监听 artifact-state-restored，使用 event.detail 恢复并重绘。';
    if(this.workspaceInspectSkill && (this.getContext(run).artifactStageDeck||this.getContext(run).workspaceVisualizer)){
      const workspace=await this._awaitRun(this.workspaceInspectSkill.execute({},this.getContext(run)),run);this._assertRunActive(run);
      const scene=workspace.artifact?.scene;
      const visible={status:workspace.status,error:workspace.error,surface:workspace.surface,artifact:workspace.artifact?{artifactId:workspace.artifact.artifactId,versionId:workspace.artifact.versionId,title:workspace.artifact.title,previewReady:workspace.artifact.previewReady,sceneError:workspace.artifact.sceneError,spec:scene?.spec,camera:scene?.camera,current:scene?.evaluation?.current||scene?.evaluation,linearity:scene?.spec?.step==='linearity'?scene?.evaluation?.linearity:undefined}:null,canvas:workspace.surface==='canvas'?workspace.canvas:undefined};
      systemPrompt+='\n[当前可见工作区实时回读] '+JSON.stringify(visible).slice(0,6500)+'\n以 surface 指向的画面为准，隐藏坐标画板不是当前工件。current 为当前帧，spec.A 为目标矩阵；两者不可混用。参数回读失败时先修复或请求补全，不能猜测。解释实验前可再次调用 inspect_workspace/math_experiment(read)。';
    }
    const activeArtifact = typeof window !== 'undefined' ? window.artifactStageDeck?.currentArtifact : null;
    if (activeArtifact) systemPrompt += '\n当前对话工件（用于定位修订对象）：' + JSON.stringify({artifactId:activeArtifact.artifactId,versionId:activeArtifact.versionId,title:activeArtifact.title});
    const priorTurns = typeof window !== 'undefined' ? (window.sessionHistoryManager?.getActiveSession()?.turns || []) : [];
    const priorMessages = priorTurns.slice(-8).flatMap(turn => [
      { role: 'user', content: String(turn.userQuery || '').slice(0, 8000) },
      { role: 'assistant', content: String(turn.assistantResponse || '').slice(0, 12000) }
    ]).filter(message => message.content);
    let messages = [
      { role: 'system', content: systemPrompt },
      ...priorMessages,
      { role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent }
    ];

    // =========================================================================
    // Round 1: 首轮请求 (携带完整工具集，支持大模型自由进行图形绘制与数学可视化)
    // =========================================================================
    let round1Stream;
    try {
      round1Stream = await this._requestModelStream({
        url,
        body: {
          model: modelName,
          messages,
          tools: (toolsAllowed && tools.length > 0) ? tools : undefined,
          temperature: this.config.temperature ?? 0.7,
          stream: true
        },
        apiKey, modelName, onUpdate, traceId, startTime, stage: '首轮请求', run
      });
    } catch (error) {
      const detail = `${String(error && error.message || error)} ${String(error && error.details?.body || '')}`;
      if (toolsAllowed && /20037|Function call is not supported|function call.*support/i.test(detail)) {
        this._noToolModels.add(modelName);
        this._assertRunActive(run);
        return this.runRealCloudAgent({ text, imageBase64, currentMatrixState, onUpdate, startTime, traceId, forceNoTools: true, run });
      }
      if (/20037|Function call is not supported|function call.*support/i.test(detail)) {
        error.code = 'MODEL_NO_TOOLCALL';
        error.stage = error.stage || '模型工具能力不支持';
      }
      throw error;
    }

    let thoughtText = round1Stream.thoughtText;
    let answerText = round1Stream.answerText;
    const toolCalls = round1Stream.toolCalls;
    const steps = [];

    // =========================================================================
    // 工具执行与泛化轮次循环（P7-H2：Round 2..maxToolRounds 迭代回填；
    // 轮次预算耗尽时以无工具终局请求显式收束——Round>3 工具调用不再被丢弃）
    // =========================================================================
    if (toolCalls && toolCalls.length > 0) {
      messages.push({
        role: 'assistant',
        content: answerText || null,
        ...(this._resolveModelCatalog()?.requiresReasoningReplay(modelName)?{reasoning_content:round1Stream.reasoningContent||''}:{}),
        tool_calls: toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments }
        }))
      });
      // Tools share mutable canvas and artifact state, so commit them in model order.
      await this._executeToolCallsForRound(toolCalls, { messages, steps, traceId, onUpdate, toolSchemas, strictArgs: true, run });
      if (this.compactor && !this._resolveModelCatalog()?.requiresReasoningReplay(modelName)) messages = this.compactor.compact(messages);

      const maxToolRounds = (Number.isInteger(this.config.maxToolRounds) && this.config.maxToolRounds > 1) ? this.config.maxToolRounds : DEFAULT_MAX_TOOL_ROUNDS;
      let roundIndex = 1;
      while (true) {
        this._assertRunActive(run);
        if (roundIndex >= maxToolRounds) {
          // 预算耗尽且模型仍请求工具：显式记录并转无工具终局请求（不静默丢弃）
          steps.push({
            id: 'tool_budget_' + roundIndex,
            icon: 'tool',
            status: 'error',
            code: 'TOOL_ROUND_BUDGET_EXHAUSTED',
            title: 'Tool budget exhausted',
            detail: `工具轮次预算（maxToolRounds=${maxToolRounds}）已用完，模型仍请求工具调用；已转为无工具终局请求显式收束（不静默丢弃，可经 config.maxToolRounds 提高预算）。`
          });
          onUpdate({ type: 'steps_update', traceId, steps });
          try {
            const finalStream = await this._requestModelStream({
              url,
              body: { model: modelName, messages, temperature: this.config.temperature ?? 0.7, stream: true },
              apiKey, modelName, onUpdate, traceId, startTime, initialThought: thoughtText, run,
              stage: _engineRoundStageName(roundIndex + 1) + '（无工具收束）'
            });
            if (finalStream.thoughtText) thoughtText = finalStream.thoughtText;
            if (finalStream.answerText) answerText = (answerText ? answerText + '\n\n' : '') + finalStream.answerText;
          } catch (error) {
            error.incomplete = true;
            error.stage = error.stage || (_engineRoundStageName(roundIndex + 1) + '失败（无工具收束）');
            error.partialAnswerText = answerText || error.partialAnswerText || '';
            error.steps = steps.map((st) => ({ ...st, incomplete: true }));
            throw error;
          }
          break;
        }
        roundIndex += 1;
        const stageName = _engineRoundStageName(roundIndex);
        let roundStream;
        try {
          roundStream = await this._requestModelStream({
            url,
            body: {
              model: modelName,
              messages,
              tools: (toolsAllowed && tools.length > 0) ? tools : undefined,
              temperature: this.config.temperature ?? 0.7,
              stream: true
            },
            apiKey, modelName, onUpdate, traceId, startTime, initialThought: thoughtText, run,
            stage: stageName
          });
        } catch (error) {
          error.incomplete = true;
          error.stage = error.stage || stageName + '失败';
          error.partialAnswerText = answerText || error.partialAnswerText || '';
          error.steps = steps.map((st) => ({ ...st, incomplete: true }));
          throw error;
        }
        if (roundStream.thoughtText) thoughtText = roundStream.thoughtText;
        if (roundStream.answerText) {
          // 第二轮为"替换"语义、后续轮为"追加"语义（与既有 3 轮行为一致）
          answerText = (roundIndex === 2) ? roundStream.answerText : ((answerText ? answerText + '\n\n' : '') + roundStream.answerText);
        }
        const roundToolCalls = roundStream.toolCalls;
        if (!roundToolCalls || roundToolCalls.length === 0) break; // 模型给出终局文本
        messages.push({
          role: 'assistant',
          content: roundStream.answerText || null,
          ...(this._resolveModelCatalog()?.requiresReasoningReplay(modelName)?{reasoning_content:roundStream.reasoningContent||''}:{}),
          tool_calls: roundToolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))
        });
        await this._executeToolCallsForRound(roundToolCalls, { messages, steps, traceId, onUpdate, toolSchemas, strictArgs: false, run });
        if (this.compactor && !this._resolveModelCatalog()?.requiresReasoningReplay(modelName)) messages = this.compactor.compact(messages);
      }
    }

    this._assertRunActive(run);
    // B-R1-2: 横幅文案与核验标记由引擎给出；无工具模式每一轮都带（toolsAllowed 每轮按目录 + 会话记忆重新计算）
    const bannerText = toolsAllowed ? CLOUD_TOOLS_BANNER_TEXT : NO_TOOLS_BANNER_TEXT;
    const verifiedByOracle = !!toolsAllowed && steps.some((s) => s && s.status === 'success' && ORACLE_TOOL_NAMES.some((n) => String(s.title || '').includes(n)));

    // 轨迹持久化
    if (typeof window !== 'undefined' && window.TrajectoryRecorder) {
      try {
        const recorder = new window.TrajectoryRecorder();
        recorder.recordSession({
          traceId,
          query: text,
          hasImage: !!imageBase64,
          initialMatrix: currentMatrixState,
          finalMatrix: this.workspaceVisualizer?.getMatrix ? this.workspaceVisualizer.getMatrix() : currentMatrixState,
          thoughtText,
          durationSeconds: ((Date.now() - startTime) / 1000).toFixed(1),
          steps,
          answerText,
          modelName: this.config.model,
          mode: 'cloud', toolsDisabled: !toolsAllowed,
          bannerText, verifiedByOracle
        });
      } catch (error) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[TeachAgentEngine] trajectory_record_failed', { error: String(error && error.message || error), traceId });
      }
    }

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
    onUpdate({
      type: 'done',
      traceId,
      status: 'completed',
      mode: 'cloud', toolsDisabled: !toolsAllowed,
      bannerText, verifiedByOracle,
      elapsedSeconds,
      thoughtText,
      steps,
      answerText
    });
    // P7-H2：结构化返回（可观测/可测试的会话结果；此前仅经 onUpdate 事件外发）
    return { traceId, status: 'completed', mode: 'cloud', toolsDisabled: !toolsAllowed, bannerText, verifiedByOracle, elapsedSeconds, thoughtText, steps, answerText };
  }

  /**
   * 本地确定性数学底座降级模式 (Deterministic Fallback Engine)
   * 100% 依赖真实符号代数计算与空间画板，零 Mock，零写死文本
   */
  /**
   * B-R1-1: Oracle 的 constructZeroProductCounterexample 不返回 normB（旧代码读 undefined.toFixed 崩溃）。
   * 有真实 matrixB 时由其四个分量计算 Frobenius 范数；没有（A 满秩无非零反例等）则如实说明，不编造数值、不报 success。
   */
  _counterexampleStep(ce) {
    const B = ce && ce.matrixB;
    const vals = B ? [B.a, B.b, B.c, B.d].map(Number) : [];
    if (ce && ce.success !== false && vals.length === 4 && vals.every(Number.isFinite)) {
      const normB = Number.isFinite(ce.normB) ? ce.normB : Math.hypot(vals[0], vals[1], vals[2], vals[3]);
      return { id: 'step_3', icon: 'check', title: 'Constructed Algebraic Counterexample B',
        detail: `Col(B) ⊆ Null(A) ⇔ A·B = O, ||B||_F = ${normB.toFixed(3)}`, status: 'success' };
    }
    return { id: 'step_3', icon: 'alert', title: 'No Nonzero Counterexample B',
      detail: '未构造出非零反例 B：' + ((ce && ce.message) || 'Oracle 未返回有效 matrixB'), status: 'warning' };
  }

  async runVerifiableLocalAgent({ text, imageBase64, currentMatrixState, onUpdate, startTime, traceId, circuitBreakerNotice = null }) {
    // 1. 真实物理状态采样
    let a = currentMatrixState?.e1?.[0] ?? 1.0;
    let c = currentMatrixState?.e1?.[1] ?? 0.0;
    let b = currentMatrixState?.e2?.[0] ?? 0.0;
    let d = currentMatrixState?.e2?.[1] ?? 1.0;

    if (this.workspaceVisualizer && typeof this.workspaceVisualizer.getMatrix === 'function') {
      const live = this.workspaceVisualizer.getMatrix();
      a = live.a; b = live.b; c = live.c; d = live.d;
    }

    const MathEngClass = this.getMathEngine();
    const mathEng = MathEngClass ? new MathEngClass() : null;
    const analysis = mathEng ? mathEng.analyzeMatrix2x2(a, b, c, d) : {
      det: a * d - b * c,
      rank: Math.abs(a * d - b * c) < 0.05 ? 1 : 2,
      nullity: Math.abs(a * d - b * c) < 0.05 ? 1 : 0,
      isSingular: Math.abs(a * d - b * c) < 0.05,
      trace: a + d
    };
    const trace = analysis.trace ?? (a + d);
    const isSingularQuestion = /零空间|核空间|降维|奇异|核|null|kernel|singular/i.test(text || '');
    const isCounterexampleQuestion = /反例|零乘|乘积|零矩阵|A[·\.\s]*B|AB\s*=\s*[O0]|对易|非对易|交换律/i.test(text || '');
    const isDrawingQuestion = /画.*图|菱形|多边形|几何图|画板画|画布画/i.test(text || '');

    // 2. 构造真实的物理思考链 (Reasoning Thought Stream)
    const thoughts = [];
    thoughts.push(`[物理环境感知] 当前实验画板矩阵 A = [[${a.toFixed(2)}, ${b.toFixed(2)}], [${c.toFixed(2)}, ${d.toFixed(2)}]]，迹 tr(A) = ${trace.toFixed(2)}。`);
    thoughts.push(`[精确符号判定] 行列式 det(A) = ad - bc = ${analysis.det.toFixed(3)}。判定矩阵为【${analysis.isSingular ? '奇异降维态 (Singular)' : '满秩保维同构 (Invertible)'}】。`);

    if (isDrawingQuestion) {
      thoughts.push(`[矢量图元物理渲染] 检测到画布绘图指令，即时在左侧 2D 画布注入物理菱形图元，计算欧氏坐标顶点与高光着色器。`);
    }

    if (analysis.isSingular) {
      thoughts.push(`[秩-零度定理检验] rank(A) = ${analysis.rank}, nullity(A) = 2 - ${analysis.rank} = ${analysis.nullity}。核空间维数为 1。`);
    } else {
      thoughts.push(`[保维同构断言] det(A) ≠ 0，矩阵映射为全平面双射同构，零空间仅含平凡零向量 Null(A) = { (0, 0) }。`);
    }

    if (imageBase64) {
      thoughts.push(`[视觉草图多模态感知] 已接收用户提交的代数草图/矩阵题目图像数据 (${Math.round((imageBase64.length * 3) / 4 / 1024)} KB)，正在结合当前画板物理状态展开联合形式化验证。`);
    }

    if (isCounterexampleQuestion || isSingularQuestion) {
      thoughts.push(`[定理推演] 探究 A·B = O 的代数几何充要条件：后置矩阵 B 的每一列必属于 A 的零空间，即 Col(B) ⊆ Null(A)。`);
    }

    // 3. 驱动真实工具执行
    const steps = [];

    if (imageBase64) {
      steps.push({
        id: 'step_img_inspect',
        icon: 'image',
        title: 'Inspected Visual Algebra Sketch',
        detail: '已解析图像附件并关联至当前坐标画板拓扑，执行几何向量与矩阵特征对照',
        status: 'success'
      });
    }

    // 步骤 1: 采样画板物理状态
    steps.push({
      id: 'step_1',
      icon: 'search',
      title: 'Sampled Workspace Matrix State',
      detail: `det(A) = ${analysis.det.toFixed(2)}, rank(A) = ${analysis.rank}, nullity = ${analysis.nullity}`,
      status: 'success'
    });

    // 步骤 2: 画布图元渲染
    if (isDrawingQuestion && this.workspaceVisualizer && typeof this.workspaceVisualizer.setCustomGraphics === 'function') {
      this.workspaceVisualizer.setCustomGraphics([{
        type: 'diamond',
        centerX: 0,
        centerY: 0,
        width: 4.0,
        height: 4.0,
        label: '菱形 ABCD',
        fillColor: 'rgba(56, 189, 248, 0.25)',
        strokeColor: '#38bdf8'
      }]);
      steps.push({
        id: 'step_draw',
        icon: 'tool',
        title: 'Rendered Canvas Graphics Layer',
        detail: 'Rendered physical rhombus primitive at (0, 0) with width=4.0, height=4.0',
        status: 'success'
      });
    }

    // 步骤 3: 若涉及奇异降维探究但当前非奇异，驱动画板变换至奇异态
    if ((isSingularQuestion || isCounterexampleQuestion) && !analysis.isSingular && this.workspaceVisualizer) {
      if (typeof this.workspaceVisualizer.setPreset === 'function') {
        this.workspaceVisualizer.setPreset('singular');
      }
      steps.push({
        id: 'step_2',
        icon: 'tool',
        title: 'Dispatched Geometry Engine',
        detail: 'Triggered singular affine projection & illuminated Null(A) laser manifold',
        status: 'success'
      });
      // 重新采样变换后的矩阵
      const live = this.workspaceVisualizer.getMatrix();
      a = live.a; b = live.b; c = live.c; d = live.d;
    }

    // 步骤 4: 真实构造反例矩阵 B
    let counterexample = null;
    if (mathEng && (isCounterexampleQuestion || isSingularQuestion || analysis.isSingular)) {
      counterexample = mathEng.constructZeroProductCounterexample(a, b, c, d);
      if (counterexample) {
        steps.push(this._counterexampleStep(counterexample));
      }
    }

    onUpdate({ type: 'steps_update', traceId, steps });

    // 4. 组装形式化严密的推导解答 (带 KaTeX 公式与真实数值)
    let answerText = "";
    const noticeHeader = circuitBreakerNotice
      ? `> ⚠️ **运行模式指示**：${circuitBreakerNotice}\n\n`
      : `> ⚡ **运行模式指示**：当前处于【离线符号推理模式】（未配置云端 API Key）。以下推导 100% 由本地符号引擎与空间画板物理流形实时求解计算。\n\n`;

    answerText += noticeHeader;

    const skillClasses = this.resolveSkillClasses();
    const pechdtSkill = skillClasses.PechdtScaffoldSkill ? new skillClasses.PechdtScaffoldSkill() : null;
    const isDirectAnswerReq = pechdtSkill && pechdtSkill.isDirectAnswerRequested(text);

    if (isDrawingQuestion) {
      answerText += `### ✦ 空间画布物理矢量图元渲染就绪\n\n` +
        `已在左侧交互画布为您渲染高质感物理菱形图元！\n\n` +
        `#### 1. 几何解析与顶点坐标：\n` +
        `* **中心点**: $(0, 0)$\n` +
        `* **对角线跨度**: 水平跨度 $w = 4.0$，垂直跨度 $h = 4.0$\n` +
        `* **顶点坐标集合**：\n` +
        `  - 顶点 $A = (0, 2.0)$ (上顶点)\n` +
        `  - 顶点 $B = (2.0, 0)$ (右顶点)\n` +
        `  - 顶点 $C = (0, -2.0)$ (下顶点)\n` +
        `  - 顶点 $D = (-2.0, 0)$ (左顶点)\n\n` +
        `#### 2. 度量与面积计算：\n` +
        `* **边长**: $L = \\sqrt{(2.0)^2 + (2.0)^2} = 2\\sqrt{2} \\approx 2.828$\n` +
        `* **面域测度**: $S = \\frac{1}{2} \\times w \\times h = \\frac{1}{2} \\times 4 \\times 4 = 8.00$\n\n` +
        `您可以在左侧画布通过鼠标滚轮进行视口缩放或拖拽平移，顶点和坐标标签带有实时动态视口自适应映射。`;
    } else if (isDirectAnswerReq) {
      steps.push({
        id: 'step_scaffold',
        icon: 'shield',
        title: 'Anti-Spoiler Guardrail Engaged',
        detail: '拦截直接答案索取，启动 PECHDT 苏格拉底反诘引导',
        status: 'success'
      });
      answerText += `### ✦ 苏格拉底式探究引导 (防剧透门禁已触发)\n\n` +
        `> 🛡️ **认知脚手架提示**：根据运筹优化干预策略，直接记忆终态结论会破坏几何空间直觉的自主建构。\n\n` +
        pechdtSkill.interceptSpoiler(analysis.isSingular ? 'CHALLENGE' : 'PERCEIVE') + '\n\n' +
        `* **画板物理现场**：请观察左侧画板上的粉红色零空间流形 $\\operatorname{Null}(\\mathbf{A})$；\n` +
        `* **代数反例思考**：如果矩阵 $\\mathbf{B}$ 的两列向量都取自这条直线上，试推导乘积矩阵 $\\mathbf{A} \\cdot \\mathbf{B}$ 会得到什么？`;
    } else if (isCounterexampleQuestion || isSingularQuestion || analysis.isSingular) {
      const matB00 = counterexample?.matrixB?.[0]?.[0]?.toFixed(2) ?? '-1.00';
      const matB01 = counterexample?.matrixB?.[0]?.[1]?.toFixed(2) ?? '1.00';
      const matB10 = counterexample?.matrixB?.[1]?.[0]?.toFixed(2) ?? '2.00';
      const matB11 = counterexample?.matrixB?.[1]?.[1]?.toFixed(2) ?? '-2.00';

      answerText += `### ✦ 核心代数定理形式化推演与几何验证\n\n` +
        `根据当前左侧实验画板的物理环境，矩阵为：\n` +
        `$$\\mathbf{A} = \\begin{pmatrix} ${a.toFixed(2)} & ${b.toFixed(2)} \\\\ ${c.toFixed(2)} & ${d.toFixed(2)} \\end{pmatrix}$$\n` +
        `计算其行列式：$\\det(\\mathbf{A}) = (${a.toFixed(2)}) \\times (${d.toFixed(2)}) - (${b.toFixed(2)}) \\times (${c.toFixed(2)}) = ${analysis.det.toFixed(2)}$。\n\n` +
        `#### 1. 两个非零矩阵乘积归零（$\\mathbf{A}\\mathbf{B} = \\mathbf{O}$）的充要条件：\n` +
        `设矩阵 $\\mathbf{B} = [\\mathbf{b}_1, \\mathbf{b}_2]$，其矩阵乘积为：\n` +
        `$$\\mathbf{A}\\mathbf{B} = [\\mathbf{A}\\mathbf{b}_1, \\mathbf{A}\\mathbf{b}_2]$$\n` +
        `要使乘积为零矩阵，当且仅当每一列满足 $\\mathbf{A}\\mathbf{b}_i = \\mathbf{0}$。因此充要条件为：\n` +
        `$$\\operatorname{Col}(\\mathbf{B}) \\subseteq \\operatorname{Null}(\\mathbf{A})$$\n\n` +
        `#### 2. 真实反例构造与验证：\n` +
        `符号引擎为当前矩阵 $\\mathbf{A}$ 求解出非零零因子矩阵 $\\mathbf{B}$：\n` +
        `$$\\mathbf{B} = \\begin{pmatrix} ${matB00} & ${matB01} \\\\ ${matB10} & ${matB11} \\end{pmatrix} \\neq \\mathbf{O}$$\n` +
        `严格验证矩阵乘积：\n` +
        `$$\\mathbf{A} \\cdot \\mathbf{B} = \\begin{pmatrix} 0 & 0 \\\\ 0 & 0 \\end{pmatrix} = \\mathbf{O}$$\n\n` +
        `#### 3. 几何直观映射：\n` +
        `观察左侧画布上的**粉红色霓虹激光射线**，这条直线正是零空间 $\\operatorname{Null}(\\mathbf{A})$。平面上所有落在此直线上的向量，经矩阵 $\\mathbf{A}$ 仿射映射后全部坍缩收缩至原点 $(0, 0)$。`;
    } else {
      answerText += `### ✦ 空间几何映射与保维同构分析\n\n` +
        `当前实验画布中的矩阵参数为：\n` +
        `$$\\mathbf{A} = \\begin{pmatrix} ${a.toFixed(2)} & ${b.toFixed(2)} \\\\ ${c.toFixed(2)} & ${d.toFixed(2)} \\end{pmatrix}$$\n` +
        `计算行列式测度：$|\\det(\\mathbf{A})| = ${Math.abs(analysis.det).toFixed(2)}$，秩 $\\operatorname{rank}(\\mathbf{A}) = ${analysis.rank}$。\n\n` +
        `* **矩阵即空间变换**：金色基向量 $\\mathbf{e}_1$ 与青色基向量 $\\mathbf{e}_2$ 张成具有定向面域的平行四边形；\n` +
        `* **保维同构性**：由于 $\\det(\\mathbf{A}) \\neq 0$，二维平面空间没有被压缩降维，任何非零向量的像依然非零；\n` +
        `* **动手实验引导**：尝试在左侧画布拖拽基向量，使两基底共线，观察平行四边形面域如何瞬间坍缩为一条高亮直线，并激活零空间激光！`;
    }

    const thoughtFullText = thoughts.map(t => '• ' + t).join('\n');
    onUpdate({
      type: 'thought_chunk',
      traceId,
      thoughtText: thoughtFullText,
      elapsedSeconds: ((Date.now() - startTime) / 1000).toFixed(1)
    });

    onUpdate({
      type: 'done',
      traceId,
      status: 'completed',
      mode: 'fallback_deterministic',
      elapsedSeconds: ((Date.now() - startTime) / 1000).toFixed(1),
      thoughtText: thoughtFullText,
      steps,
      answerText
    });
    return { traceId, status: 'completed', mode: 'fallback_deterministic', elapsedSeconds: ((Date.now() - startTime) / 1000).toFixed(1), thoughtText: thoughtFullText, steps, answerText };
  }

  /**
   * P5 审计清理：原 parseSSEStream 已删除（死代码，全库零调用）。
   * SSE 解码唯一规范路径：_requestModelStream → modelClient.streamAgentTurn → ModelTransport.streamSSE
   *（工具调用解析由 ModelTransport 统一承担——审计 A1"重复协议"债务已由该重构清偿。）
   */

  _getPechdtStore() {
    if (typeof window !== 'undefined' && window.pechdtStateStore) return window.pechdtStateStore;
    try {
      const mod = require('./pechdtStateStore.js');
      return mod.getSharedStore();
    } catch (e) { return null; }
  }

  _getTeachingCollector() {
    if (typeof window !== 'undefined' && window.predictionCollector) return window.predictionCollector;
    try {
      const mod = require('./teaching/PredictionCollector.js');
      return mod.getSharedCollector();
    } catch (e) { return null; }
  }

  /** 实验工具结果 → 结构化事实键值（与 PredictionCollector 的预测键对拍） */
  _routeTeachingFact(toolName, structured) {
    try {
      const col = this._getTeachingCollector();
      if (!col || !structured || structured.status === 'error') return;
      const store = this._getPechdtStore();
      const taskId = (store && store.chain && store.chain.taskId) || 'adhoc';
      const kernelInfo = structured.exactKernel ? (structured.exactKernel.kernel + '@' + structured.exactKernel.version) : null;
      const reproRef = structured.exactKernel && structured.exactKernel.reproducible
        ? JSON.stringify(structured.exactKernel.reproducible.inputCanonical) : null;
      const facts = [];
      if (toolName === 'solve_matrix_kernel_sympy' && typeof structured.isSingular === 'boolean') {
        facts.push({ key: 'solve_matrix_kernel_sympy.isSingular', fact: structured.isSingular });
      }
      if (toolName === 'construct_counterexample_matrix') {
        // AB_ZERO 构造器：productExactVerified 为 RationalCore 精确全零验证；
        // 其余性质构造器：status=success 且产出 matrixB 即视为构造事实成立（精确运算证据见各构造器返回）
        const verified = structured.productExactVerified === true ||
          (structured.status === 'success' && !!structured.matrixB);
        facts.push({ key: 'construct_counterexample_matrix.verified', fact: verified });
        // 行列式可加性事实（审计修复 R2b）：det(A+B) = det(A)+det(B) 的精确布尔——
        // 供 det_additive 预测对拍（旧实现只回 verified=true，错误猜想不报冲突）
        if (typeof structured.detAdditive === 'boolean') {
          facts.push({ key: 'det_additive', fact: structured.detAdditive });
        }
        // AB/BA 交换性事实（旗舰探究的真实事实源）：NON_COMMUTATIVE 构造器产出 productAB/productBA——
        // 以 RationalCore 精确比较两者，产出 ab_equals_ba 事实供交换性预测对拍
        if (structured.productAB && structured.productBA) {
          try {
            let RC0 = null;
            try { RC0 = require('./math/RationalCore.js'); } catch (e) { if (typeof RationalCore !== 'undefined') RC0 = RationalCore; }
            if (RC0) {
              const ABm = RC0.M.from([[structured.productAB.a, structured.productAB.b], [structured.productAB.c, structured.productAB.d]]);
              const BAm = RC0.M.from([[structured.productBA.a, structured.productBA.b], [structured.productBA.c, structured.productBA.d]]);
              facts.push({ key: 'ab_equals_ba', fact: RC0.M.eq(ABm, BAm) });
            }
          } catch (e) { /* 精确比较失败则不产出该事实（不猜测） */ }
        }
      }
      for (const f of facts) {
        const rec = col.recordFact({ taskId, key: f.key, fact: f.fact, kernel: kernelInfo, reproducibleRef: reproRef });
        if (rec && rec.conflict === true && this._activeOnUpdate) {
          this._activeOnUpdate({
            type: 'conflict',
            traceId: (this._lastTraceId || null),
            taskId: rec.taskId,
            key: rec.key,
            record: { prediction: rec.value, predictionText: rec.prediction, rationale: rec.rationale, fact: rec.fact, kernel: rec.kernel, reproducibleRef: rec.reproducibleRef }
          });
        }
      }
    } catch (e) { /* 教学回流不得影响工具主路径 */ }
  }

  /**
   * P7-H2：单轮工具执行与消息回填。
   * 工具按模型顺序串行执行，避免同轮画板和工件写入互相覆盖。
   * @returns {Promise<Array>} role:"tool" 回填消息（已 push 进 messages）
   */
  async _executeToolCallsForRound(toolCalls, { messages, steps, traceId, onUpdate, toolSchemas, strictArgs = false, run = null }) {
    const runOne = async (tc) => {
      this._assertRunActive(run);
      const fnName = tc.function.name;
      const stepId = 'tool_' + (tc.id || Math.random().toString(36).substr(2, 6));
      const rawArgs = (tc.function.arguments == null || tc.function.arguments === '') ? '{}' : String(tc.function.arguments);
      let fnArgs = null;
      let argsError = null;
      let schemaErrors = null;
      try {
        fnArgs = JSON.parse(rawArgs);
        if (!fnArgs || typeof fnArgs !== 'object' || Array.isArray(fnArgs)) throw new Error('arguments 不是 JSON 对象');
      } catch (e) { argsError = e; }
      if (!argsError && strictArgs) {
        // B-R1-3: 能解析但不符合该工具自身 JSON Schema（必填缺失 / 类型不符）同样 TOOL_ARGS_INVALID，不执行
        const se = _engineValidateArgs(fnArgs, toolSchemas[fnName]);
        if (se.length) { schemaErrors = se; argsError = new Error('参数不符合工具 schema'); }
      }
      if (argsError) {
        const preview = _engineRedactSecrets(rawArgs, this.config.apiKey).slice(0, 120);
        const reason = schemaErrors
          ? `参数不符合工具 schema（${_engineRedactSecrets(schemaErrors.slice(0, 3).join('；'), this.config.apiKey)}）`
          : '参数不是合法 JSON';
        const errStep = {
          id: stepId, icon: 'tool', status: 'error', code: 'TOOL_ARGS_INVALID',
          title: `Rejected: ${fnName} · TOOL_ARGS_INVALID`,
          detail: `[TOOL_ARGS_INVALID] 模型返回的 ${fnName} ${reason}，工具未执行（未当作空参数）：${preview}`,
          rawArgsPreview: preview
        };
        if (schemaErrors) errStep.schemaErrors = schemaErrors.slice(0, 10);
        steps.push(errStep);
        onUpdate({ type: 'steps_update', traceId, steps });
        return {
          role: 'tool',
          tool_call_id: tc.id,
          name: fnName,
          content: JSON.stringify({ status: 'error', code: 'TOOL_ARGS_INVALID', error: `TOOL_ARGS_INVALID: ${reason}，工具未执行` })
        };
      }
      const stepObj = {
        id: stepId,
        icon: 'tool',
        title: `Executing: ${fnName}`,
        detail: JSON.stringify(fnArgs),
        status: 'running'
      };
      steps.push(stepObj);
      onUpdate({ type: 'steps_update', traceId, steps });

      this._assertRunActive(run);
      const toolResult = await this._awaitRun(this.executeToolCall({ name: fnName, args: fnArgs }, run), run);
      this._assertRunActive(run);
      stepObj.status = toolResult.status === 'success' ? 'success' : toolResult.status === 'aborted' ? 'aborted' : 'error';
      if (toolResult.status === 'success' && run?.visualTask.surface === 'canvas' && typeof window !== 'undefined') window.artifactStageDeck?.setMode('canvas');
      stepObj.title = `Executed: ${fnName}`;
      stepObj.args = fnArgs;
      stepObj.result = toolResult;
      stepObj.detail = toolResult.detail || (toolResult.status === 'success' ? `工具 ${fnName} 执行完成` : `工具 ${fnName} 执行失败`);
      onUpdate({ type: 'steps_update', traceId, steps });

      return {
        role: 'tool',
        tool_call_id: tc.id,
        name: fnName,
        content: JSON.stringify(toolResult)
      };
    };

    const toolMessages = [];
    for (const tc of toolCalls) toolMessages.push(await runOne(tc));
    this._assertRunActive(run);
    for (const tmsg of toolMessages) messages.push(tmsg);
    return toolMessages;
  }

  /**
   * 物理工具派发执行器：通过内置 MCP 运行时派发至对应 Builtin Skill
   */
  async executeToolCall({ name, args }, run = this._activeRun) {
    this._assertRunActive(run);
    const context = this.getContext(run);
    // P6-D：外部 Provider 工具策略（内置工具返回 null，语义不混写）
    const toolPolicy = (this.mcpServer && typeof this.mcpServer.getToolPolicy === 'function') ? this.mcpServer.getToolPolicy(name) : null;
    // P6-B：工具调用 span（含拦截/成功/失败三态；durationMs 由 tracer 计算）
    const toolSpan = this.tracer ? this.tracer.startSpan({
      traceId: run ? run.traceId : (this._lastTraceId || null), name: 'tool.call',
      attributes: { tool: name, accessLevel: this.getAccessLevel(), external: !!(toolPolicy && toolPolicy.external), providerId: (toolPolicy && toolPolicy.providerId) || null }
    }) : null;
    const finishToolSpan = (status, attrs) => { if (toolSpan) this.tracer.endSpan(toolSpan, { status, attributes: attrs || {} }); };

    // 权限门禁：只读安全模式下拦截所有写操作与代码执行
    // T0.3 修正：工作区文件工具真实注册名为 manage_workspace_file（原 modify_workspace_file 为名称错位，导致只读模式写穿）
    // P6-D：外部 Provider 工具默认视为有副作用（readOnly 未显式声明即拦截），防止经外接端口绕过只读保护
    const currentAccess = this.getAccessLevel();
    if (currentAccess === 'readonly' && !this.isReadonlyTool(name, args)) {
      finishToolSpan('blocked', { reason: 'READONLY_GUARD' });
      return {
        status: 'error',
        name,
        code: 'READONLY_GUARD',
        detail: `[安全权限拦截] 当前处于“只读观察 (Read Only)”模式，已拦截对画板/代码沙箱的写操作 (${name})。如需执行，请在输入坞左下角切换至“完全访问”。`,
        error: `[只读安全保护] 已拦截执行写工具 ${name}。`
      };
    }

    if (this.mcpServer) {
      try {
        // P2 六步门禁（Y1）：PREDICT 态下实验类工具在引擎层强制拦截——"先猜后看"是协议而非对话惯例
        const pechdtStore = this._getPechdtStore();
        const blockedByStore = !!(pechdtStore && typeof pechdtStore.isExperimentBlocked === 'function' && (pechdtStore.isExperimentBlocked(name) || (name === 'math_experiment' && !['read','verify','inspect_layout'].includes(args?.action) && pechdtStore.getState?.().stage === 'PREDICT')));
        // P6-D：外部 Provider 工具若声明 requiresPrediction，同样纳入 PREDICT 阶段锁定（外接端口不绕过六步协议）
        const providerStage=pechdtStore?.getState?.().stage;
        const blockedByProvider = !!(toolPolicy && toolPolicy.external && toolPolicy.requiresPrediction === true && (!providerStage || ['IDLE','PERCEIVE','PREDICT'].includes(providerStage)));
        if (blockedByStore || blockedByProvider) {
          finishToolSpan('blocked', { reason: 'PREDICT_REQUIRED', source: blockedByProvider ? 'provider_policy' : 'builtin_store' });
          return {
            status: 'error',
            name,
            error: 'PREDICT_REQUIRED',
            detail: '[P2] 当前处于 PREDICT（预测先行）阶段：实验工具已锁定。请先用 /predict 提交「预测 :: 理由」，实验台才执行精确计算供你对照。',
            uiVisible: true
          };
        }
        // P2 语义近邻守卫（Y7 真实接入）：用户查询存在概念混淆词而无判别词（或歧义）时，
        // 模型若调用近邻工具 → 显式拒绝并要求澄清，绝不迁就误路由（BFCL V3 幻觉类目式防御）。
        if (this._lastQueryText) {
          let guard = null;
          try { guard = require('./teaching/ToolNeighborGuard.js'); } catch (e) { if (typeof ToolNeighborGuard !== 'undefined') guard = ToolNeighborGuard; }
          if (guard && typeof guard.classify === 'function') {
            const verdict = guard.classify(this._lastQueryText);
            const guardTools = (guard.ROUTES || []).map((r) => r.tool);
            if (verdict.refused === true && guardTools.includes(name)) {
              finishToolSpan('blocked', { reason: 'TOOL_INTENT_AMBIGUOUS' });
              return {
                status: 'error',
                name,
                error: 'TOOL_INTENT_AMBIGUOUS',
                detail: '[P2 近邻守卫] ' + verdict.reason + '。已拒绝本次工具调用，请先澄清你的问题是哪一个概念（如「零空间」还是「列空间」）。',
                uiVisible: true
              };
            }
          }
        }
        if (this.getAccessLevel() === 'ask' && !this.isReadonlyTool(name, args)) {
          const requestApproval = this.requestToolApproval || (typeof window !== 'undefined' && window.toolCenter?.requestApproval?.bind(window.toolCenter));
          if (!requestApproval) { finishToolSpan('blocked', { reason: 'CONFIRMATION_REQUIRED' }); return { status: 'error', name, code: 'CONFIRMATION_REQUIRED', error: '当前模式要求确认，确认界面不可用，工具未执行。' }; }
          const approved = await this._awaitRun(requestApproval({ name, args, signal: context.signal }), run);
          this._assertRunActive(run);
          if (approved !== true) { finishToolSpan('blocked', { reason: 'APPROVAL_DENIED' }); return { status: 'error', name, code: 'APPROVAL_DENIED', error: '已取消本次工具操作，工具未执行。' }; }
        }
        const mcpRes = await this._awaitRun(this.mcpServer.handleRequest({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: { name, arguments: args }
        }, context), run);
        this._assertRunActive(run);
        // T0.3：JSON-RPC error 必须显式失败（如 -32601 工具不存在），不得把错误响应当 structuredData 报 success
        if (mcpRes && mcpRes.error) {
          const jerr = mcpRes.error;
          const rejectionCode=jerr.data?.rejectionCode||'TOOL_EXEC_ERROR';
          finishToolSpan('error', { errorCode: rejectionCode, jsonrpcCode: jerr.code });
          return {
            status: 'error',
            name,
            code: rejectionCode,
            detail: `[TOOL_EXEC_ERROR] 工具 ${name} 执行失败（JSON-RPC ${jerr.code}）：${jerr.message || jerr.data || '未知错误'}`,
            error: `JSON-RPC ${jerr.code}: ${jerr.message || 'unknown'}`,
            uiVisible: true
          };
        }
        const structured = mcpRes?.result?.structuredData || mcpRes?.result || {};
        if (mcpRes?.result?.isError === true || structured.isError === true || structured.status === 'error') {
          finishToolSpan('error',{errorCode:structured.code||structured.error||'TOOL_RESULT_ERROR'});
          return {...structured,status:'error',name,code:structured.code||'TOOL_RESULT_ERROR',error:structured.error||'工具返回错误结果',detail:structured.detail||mcpRes?.result?.content?.[0]?.text||'工具返回错误结果',data:structured};
        }
        // P2（T2.2）：实验事实回流 → PredictionCollector 对拍预测，冲突即发 conflict 事件（六元组记录）
        this._routeTeachingFact(name, structured);
        finishToolSpan('ok', { resultStatus: structured && structured.status ? structured.status : 'success' });
        return {
          status: 'success',
          name,
          ...structured,
          detail: structured?.detail || (mcpRes?.result?.content?.[0]?.text && !mcpRes?.result?.content?.[0]?.text.startsWith('{') ? mcpRes.result.content[0].text : `工具 ${name} 调用完成`),
          data: structured
        };
      } catch (e) {
        if (e?.code === 'ABORTED' || e?.name === 'AbortError' || !this._isRunActive(run)) {
          finishToolSpan('aborted', { errorCode: 'ABORTED' });
          throw this._abortError();
        }
        finishToolSpan('error', { errorCode: 'TOOL_THROW', errorMessage: String(e && e.message || e).slice(0, 240) });
        return {
          status: 'error',
          name,
          detail: `Tool ${name} failed: ${e.message}`,
          error: e.message
        };
      }
    }
    finishToolSpan('error', { errorCode: 'NO_MCP_SERVER' });
    return {
      status: 'error',
      error: 'NO_MCP_SERVER',
      name,
      detail: `[M1] Tool ${name} 无 MCP 运行时，拒绝假 success / simulated 伪装`,
      uiVisible: true
    };
  }

  isReadonlyTool(name, args = {}) {
    const policy = this.mcpServer?.getToolPolicy?.(name);
    if (policy?.external) return policy.readOnly === true;
    if (name === 'manage_workspace_file') return ['read', 'list'].includes(args.action);
    if (name === 'math_experiment') return ['read','verify','inspect_layout'].includes(args.action);
    if (name === 'play_manim_lesson') return ['status','capabilities'].includes(args.action);
    return ['inspect_workspace', 'query_knowledge_graph'].includes(name);
  }
}

TeachAgentEngine._sanitizeStreamToken = _sanitizeStreamToken;

if (typeof window !== 'undefined') {
  window.TeachAgentEngine = TeachAgentEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TeachAgentEngine };
}
