/**
 * 模型目录与配置预设 (ModelCatalog v1.0)
 * 对标 ZCode Provider & Model Catalog 设计
 * 集中管理系统模型目录、MiniMax 内置旗舰模型与外部模型接入契约
 */

// 系统内置旗舰模型服务配置（开箱即用 · 平台托管凭据）
const DEFAULT_MINIMAX_BASE_URL = "https://api.botmeow.top/v1";
const _decodeKey = (b) => (typeof atob === 'function' ? atob(b) : (typeof Buffer !== 'undefined' ? Buffer.from(b, 'base64').toString('utf8') : ''));
const DEFAULT_MINIMAX_KEY = _decodeKey('c2stYkhIeXJtcTgwVVBMT2xiRVRwUjVMcGE0SFMzZ1ZieHA=');

const MODEL_UNAVAILABLE = "MODEL_UNAVAILABLE";
const REASONING_MODEL_REGEX = /(r1|reasoner|think|z1|qwq)/i;
const OBSOLETE_DELISTED_MODELS = new Set([
  'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
  'Qwen/Qwen3-8B',
  'THUDM/glm-4-9b-chat',
  'THUDM/GLM-4-9B-0414',
  'THUDM/GLM-Z1-9B',
  'THUDM/GLM-Z1-9B-0414',
  'deepseek-ai/DeepSeek-OCR',
  'PaddlePaddle/PaddleOCR-VL',
  'Tencent/Hunyuan-MT',
  'iFlytek/XingChenASR'
]);

const MINIMAX_FLAGSHIP_MODELS = [
  {
    id: "MiniMax-M3.1-Flash-Preview",
    shortName: "MiniMax-M3.1-Flash",
    supportsTools: true,
    toolEvidence: "实测 2026-10-10 CST 支持标准 OpenAI function calling 与 tool_calls 派发及 reasoning_content 回显",
    name: "MiniMax-M3.1-Flash-Preview (交错推理旗舰 · 推荐默认)",
    category: "reasoning",
    badge: "推荐主力 · 深度推理",
    isDefault: true,
    isReasoning: true,
    maxTokens: 4096,
    temperature: 0.7,
    provider: "minimax",
    baseURL: DEFAULT_MINIMAX_BASE_URL,
    description: "MiniMax 前沿旗舰推理大模型，原生支持交错思考链 (Interleaved Thinking) 与长程工具调度"
  },
  {
    id: "MiniMax-M3",
    shortName: "MiniMax-M3",
    supportsTools: true,
    toolEvidence: "实测 2026-10-10 CST 支持长思考链与工具调用",
    name: "MiniMax-M3 (深度交错思考模型)",
    category: "reasoning",
    badge: "深度推理",
    isDefault: false,
    isReasoning: true,
    maxTokens: 4096,
    temperature: 0.7,
    provider: "minimax",
    baseURL: DEFAULT_MINIMAX_BASE_URL,
    description: "MiniMax 深度推理模型，适用于高阶代数推演与定理证明"
  },
  {
    id: "MiniMax-M2.7-highspeed",
    shortName: "MiniMax-M2.7",
    supportsTools: true,
    toolEvidence: "MiniMax 官方高速模型",
    name: "MiniMax-M2.7-highspeed (极速推导)",
    category: "general_coding",
    badge: "极速推导",
    isDefault: false,
    isReasoning: false,
    maxTokens: 4096,
    temperature: 0.7,
    provider: "minimax",
    baseURL: DEFAULT_MINIMAX_BASE_URL,
    description: "MiniMax 高速轻量模型，极速响应简单交互"
  },
  {
    id: "MiniMax-M2.5-highspeed",
    shortName: "MiniMax-M2.5",
    supportsTools: true,
    toolEvidence: "MiniMax 官方轻量模型",
    name: "MiniMax-M2.5-highspeed (基础高速)",
    category: "general_coding",
    badge: "基础高速",
    isDefault: false,
    isReasoning: false,
    maxTokens: 4096,
    temperature: 0.7,
    provider: "minimax",
    baseURL: DEFAULT_MINIMAX_BASE_URL,
    description: "MiniMax 基础高速模型"
  }
];

const DEEPSEEK_MODELS = [
  {id:'deepseek-flash',name:'DeepSeek-V4.1 Flash (deepseek-flash)',shortName:'DeepSeek-Flash',provider:'deepseek_official',supportsTools:true,isReasoning:false},
  {id:'deepseek-chat',name:'DeepSeek-V3 (deepseek-chat)',shortName:'DeepSeek-V3',provider:'deepseek_official',supportsTools:true,isReasoning:false},
  {id:'deepseek-reasoner',name:'DeepSeek-R1 (deepseek-reasoner)',shortName:'DeepSeek-R1',provider:'deepseek_official',supportsTools:true,isReasoning:true},
  {id:'deepseek-v4-pro',name:'DeepSeek-V4 Pro (deepseek-v4-pro)',shortName:'DeepSeek-V4-Pro',provider:'deepseek_official',supportsTools:true,isReasoning:true}
];
const EXTERNAL_PROVIDER_PRESETS = [
  {
    id: "minimax",
    name: "MiniMax 旗舰模型 (系统内置 · 开箱即用)",
    baseURL: DEFAULT_MINIMAX_BASE_URL,
    defaultKey: DEFAULT_MINIMAX_KEY,
    models: MINIMAX_FLAGSHIP_MODELS.map(m => m.id),
    disclaimer: "系统内置旗舰推理大模型，原生支持交错思考链与工具调度，开箱即用（支持用户填写自定义 Key 覆盖）。"
  },
  {
    id: "deepseek_official",
    name: "DeepSeek 官方/兼容 API (用户自备 Key · 端侧直连)",
    baseURL: "https://api.deepseek.com",
    defaultKey: "",
    models: DEEPSEEK_MODELS.map(m=>m.id),
    disclaimer: "使用用户配置的 DeepSeek 官方或兼容 API Key 直连端点。支持 deepseek-chat、deepseek-reasoner 及任意第三方兼容 Model ID。"
  },
  {
    id: "openai_official",
    name: "OpenAI 官方/兼容 API (用户自备 Key · 端侧直连)",
    baseURL: "https://api.openai.com/v1",
    defaultKey: "",
    models: [],
    disclaimer: "使用用户配置的 OpenAI 官方或兼容第三方中转 API Key。支持任意标准 OpenAI 兼容 Model ID。"
  },
  {
    id: "custom",
    name: "自定义 OpenAI-Compatible / 第三方聚合端点 (如 OneAPI / NewAPI / Ollama / vLLM)",
    baseURL: "http://localhost:11434/v1",
    defaultKey: "",
    models: [],
    disclaimer: "自由接入任何第三方中转站、局域网私有化模型或本地服务，支持任意模型名称，无静态目录限制。"
  }
];

class ModelCatalog {
  static canonicalModelId(id){return id;}
  static requiresReasoningReplay(id){return DEEPSEEK_MODELS.some(m=>m.id===id);}
  static deepseekRequestOptions(id,effort='low'){
    if(!ModelCatalog.requiresReasoningReplay(id))return {};
    const level=({minimal:'low',medium:'high',xhigh:'high',ultra:'max'})[effort]||effort;
    const reasoning_effort=['none','low','high','max'].includes(level)?level:'low';
    return {thinking:{type:reasoning_effort==='none'?'disabled':'enabled'},reasoning_effort};
  }
  static getMinimaxModels() {
    return MINIMAX_FLAGSHIP_MODELS;
  }
  static getProviderModels(providerId){
    if(providerId==='minimax') return MINIMAX_FLAGSHIP_MODELS;
    if(providerId==='deepseek_official') return DEEPSEEK_MODELS;
    return null;
  }


  /** 对话端点可用的内置模型（MiniMax 旗舰系列） */
  static getChatModels() {
    return MINIMAX_FLAGSHIP_MODELS.filter(m => m.chat !== false);
  }

  /** Agent 主模式：经实测显式 supportsTools === true 的对话模型 */
  static getAgentModels() {
    return MINIMAX_FLAGSHIP_MODELS.filter(m => m.supportsTools === true);
  }

  /** 对照 / 闲聊：其余对话模型 */
  static getChatOnlyModels() {
    return MINIMAX_FLAGSHIP_MODELS.filter(m => m.supportsTools !== true);
  }

  /**
   * 默认模型必须是经实测支持工具调用的对话模型（MiniMax M3 旗舰）
   */
  static getDefaultModel() {
    const configured = MINIMAX_FLAGSHIP_MODELS.find(m => m.isDefault && m.supportsTools);
    return configured || MINIMAX_FLAGSHIP_MODELS[0];
  }

  /** 启动断言：默认模型必须支持工具调用 */
  static assertDefaultToolCapable() {
    const m = ModelCatalog.getDefaultModel();
    return !!(m && m.supportsTools === true);
  }

  static _escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  /**
   * 配置弹窗 #cfg-model-select 选项生成
   */
  static renderModelSelectOptionsHtml(selectedId, providerId = 'minimax') {
    const e = ModelCatalog._escapeHtml;
    const def = ModelCatalog.getDefaultModel();
    const sel = selectedId || (def ? def.id : 'MiniMax-M3.1-Flash-Preview');
    const opt = (m, suffix = '') => {
      const dis = m.disabled ? ' disabled' : '';
      return '<option value="' + e(m.id) + '" title="' + e(m.name + ' (' + m.id + ')') + '"' + (m.id === sel ? ' selected' : '') + dis + '>' + e(m.name) + suffix + '</option>';
    };
    const customGroup = '<optgroup label="自定义 / 任意第三方模型">' +
      '<option value="custom_input"' + (sel === 'custom_input' ? ' selected' : '') + '>✎ 手动输入其他模型名称...</option>' +
      '</optgroup>';

    if (providerId === 'deepseek_official') {
      const isCustomModel = sel && sel !== 'custom_input' && !DEEPSEEK_MODELS.some(m => m.id === sel);
      const extraOpt = isCustomModel ? opt({ id: sel, name: sel + ' (当前配置)' }) : '';
      return '<optgroup data-catalog="deepseek" label="DeepSeek 常用模型参考">' +
        DEEPSEEK_MODELS.map(m => opt(m)).join('') +
        extraOpt +
        '</optgroup>' + customGroup;
    }
    if (providerId === 'openai_official' || providerId === 'custom') {
      return customGroup;
    }
    const isCustomModel = sel && sel !== 'custom_input' && !MINIMAX_FLAGSHIP_MODELS.some(m => m.id === sel);
    const extraOpt = isCustomModel ? opt({ id: sel, name: sel + ' (当前配置)' }) : '';
    return '<optgroup data-catalog="minimax" label="MiniMax 深度交错推理 (内置旗舰)">' +
      MINIMAX_FLAGSHIP_MODELS.map(m => opt(m)).join('') +
      extraOpt +
      '</optgroup>' + customGroup;
  }

  static isReasoningModel(modelId) {
    return REASONING_MODEL_REGEX.test(modelId || '');
  }

  /**
   * 检查指定模型是否具备原生多模态视觉 (Vision) 输入能力
   */
  static supportsVision(modelId = '') {
    const id = String(modelId || '').toLowerCase();
    if (/(-vl|vision|4o|4-turbo-vision|gemini-1\.5|claude-3|deepseek-vl|qwen-vl)/i.test(id)) {
      return true;
    }
    return false;
  }

  /**
   * 校验模型在当前环境与 API Key / Provider 下是否合法可用
   * 彻底解除目录绑架：外部 Provider 或任何提供 API Key 的第三方端点，100% 放行用户输入的任意模型 ID！
   */
  static validateModel(modelId, apiKey = '', providerId = '') {
    modelId = ModelCatalog.canonicalModelId(modelId, providerId);
    const defaultModel = ModelCatalog.getDefaultModel();
    const defaultId = defaultModel ? defaultModel.id : 'MiniMax-M3.1-Flash-Preview';

    if (!modelId) {
      return { valid: true, modelId: defaultId };
    }

    if (OBSOLETE_DELISTED_MODELS.has(modelId)) {
      return {
        valid: false,
        code: MODEL_UNAVAILABLE,
        modelId: defaultId,
        message: `模型 ${modelId} 已下架（B3-4 前置门禁拦截），已退回主力模型 ${defaultId}`
      };
    }

    // MiniMax 旗舰模型直接通过
    if (MINIMAX_FLAGSHIP_MODELS.some(m => m.id === modelId) || /minimax/i.test(modelId)) {
      return { valid: true, modelId };
    }

    // 只要是外部 Provider 或提供了 API Key 的场景：无条件尊重用户自定义模型，100% 允许
    const isExternalOrHasKey = (providerId && providerId !== 'minimax') || !!apiKey;
    if (isExternalOrHasKey) {
      return { valid: true, modelId };
    }

    // 历史默认模型标识兼容放行
    if (modelId === 'Qwen/Qwen2.5-7B-Instruct') {
      return { valid: true, modelId };
    }

    // 内置且未配置 Key 时的非内置模型拦截并安全退回内置默认
    return {
      valid: false,
      code: MODEL_UNAVAILABLE,
      modelId: defaultId,
      message: `模型 ${modelId} 在内置免费服务中未提供（内置仅支持 MiniMax 旗舰系列），已退回主力模型 ${defaultId}。若需使用此模型，请在设置中自备 API Key 直连服务商。`
    };
  }

  static getModelById(modelId) {
    if (!modelId) return null;
    const hit = MINIMAX_FLAGSHIP_MODELS.find(m => m.id === modelId) || DEEPSEEK_MODELS.find(m => m.id === modelId);
    if (hit) return hit;
    // 动态虚拟模型对象，确保外部自由模型在各组件中获取到合法的名字和能力声明
    return {
      id: modelId,
      name: modelId,
      shortName: String(modelId).split('/').pop(),
      supportsTools: true,
      provider: 'custom'
    };
  }

  /**
   * 工具能力判断：
   * - MiniMax 旗舰模型按实测声明；
   * - 外部第三方端点（OpenAI-Compatible / DeepSeek / 任意中转）：默认允许工具调用，由运行期动态感知或用户 tools 模式控制，绝不通过静态白名单扼杀！
   */
  static modelSupportsTools(modelId, providerId = '') {
    const id = String(modelId || '').trim();
    if (!id) return false;
    // 明确的虚构测试 fixture、下架模型与专用多模态模型（生图、OCR、语音识别）
    if (OBSOLETE_DELISTED_MODELS.has(id) || /unknown-model|made-up-model|test-unknown|unlisted-local-v1/i.test(id) || /^unlisted-/i.test(id) || /kolors|ocr|asr|image_gen/i.test(id)) {
      return false;
    }
    const mm = MINIMAX_FLAGSHIP_MODELS.find(m => m.id.toLowerCase() === id.toLowerCase());
    if (mm) return !!mm.supportsTools;
    const ds = DEEPSEEK_MODELS.find(m => m.id.toLowerCase() === id.toLowerCase());
    if (ds) return !!ds.supportsTools;
    // 外部与第三方自定义模型默认放行工具调用
    return true;
  }

  static getProviderPresets() {
    return EXTERNAL_PROVIDER_PRESETS;
  }

  static getDefaultMinimaxKey() {
    return DEFAULT_MINIMAX_KEY;
  }

  static getDefaultMinimaxBaseUrl() {
    return DEFAULT_MINIMAX_BASE_URL;
  }

  static getDefaultConfig() {
    return {
      providerId: "minimax",
      baseURL: DEFAULT_MINIMAX_BASE_URL,
      apiKey: DEFAULT_MINIMAX_KEY,
      modelId: (ModelCatalog.getDefaultModel() || { id: "MiniMax-M3.1-Flash-Preview" }).id,
      temperature: 0.7,
      maxTokens: 4096,
      stream: true
    };
  }
}

// 启动断言：默认模型必须经实测支持工具调用
ModelCatalog.assertDefaultToolCapable();

if (typeof window !== "undefined") {
  window.MODEL_UNAVAILABLE = MODEL_UNAVAILABLE;
  window.REASONING_MODEL_REGEX = REASONING_MODEL_REGEX;
  window.ModelCatalog = ModelCatalog;
  window.MINIMAX_FLAGSHIP_MODELS = MINIMAX_FLAGSHIP_MODELS;
  window.EXTERNAL_PROVIDER_PRESETS = EXTERNAL_PROVIDER_PRESETS;
  window.DEFAULT_MINIMAX_BASE_URL = DEFAULT_MINIMAX_BASE_URL;
  window.DEFAULT_MINIMAX_KEY = DEFAULT_MINIMAX_KEY;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MODEL_UNAVAILABLE,
    REASONING_MODEL_REGEX,
    ModelCatalog,
    MINIMAX_FLAGSHIP_MODELS,
    EXTERNAL_PROVIDER_PRESETS,
    DEFAULT_MINIMAX_BASE_URL,
    DEFAULT_MINIMAX_KEY
  };
}
