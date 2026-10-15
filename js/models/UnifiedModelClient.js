/**
 * 统一多模型物理客户端 (UnifiedModelClient v1.0)
 * 深度复用并对齐 ZCode Provider / Model Execution 规范与 DeepSeek Harness 通信契约
 * 
 * 核心特性：
 * 1. 原生适配 MiniMax 内置旗舰模型与外部自备 Provider (DeepSeek, OpenAI, Ollama / 任意第三方端点)
 * 2. 健壮的流式 (SSE) 解析微内核，精准双通道提取正文增量 (content) 与思考链增量 (reasoning_content)
 * 3. 10s 守护看门狗超时监控 (Watchdog Timer) 与 429 频控指数退避自愈重试
 * 4. 具备多模态能力扩展：代码生成、视觉 OCR 解析、文本翻译与 Kolors 文生图统一分发
 * 5. 跨环境适配 (Browser Fetch API / Node.js Runtime)
 */

let Catalog;
if (typeof require !== 'undefined') {
  try { Catalog = require('./ModelCatalog.js').ModelCatalog; } catch (e) { if (typeof recordIssue === 'function') recordIssue('UnifiedModelClient', 'if', e); }
}
let ModelTransportClass;
if (typeof require !== 'undefined') {
  try { ModelTransportClass = require('./ModelTransport.js').ModelTransport; } catch (e) { if (typeof recordIssue === 'function') recordIssue('UnifiedModelClient', 'if', e); }
}
if (!Catalog && typeof window !== 'undefined') {
  Catalog = window.ModelCatalog;
}
if (!ModelTransportClass && typeof window !== 'undefined') {
  ModelTransportClass = window.ModelTransport;
}

const STORAGE_KEY = 'wenju_model_client_config';

/** 错误消息去敏：去掉 Key、Bearer 头内容（服务端回显时也不外传） */
function _umcRedactSecrets(s, apiKey) {
  let out = String(s == null ? '' : s);
  if (apiKey && String(apiKey).length >= 6) out = out.split(String(apiKey)).join('[REDACTED_KEY]');
  return out.replace(/Bearer\s+[^\s"',}]+/gi, '[REDACTED_AUTH]').replace(/sk-[A-Za-z0-9._-]{4,}/g, '[REDACTED_KEY]');
}

class UnifiedModelClient {
  constructor(customConfig = {}) {
    this.defaultConfig = Catalog ? Catalog.getDefaultConfig() : {
      providerId: 'minimax',
      baseURL: 'https://api.botmeow.top/v1',
      apiKey: (Catalog && typeof Catalog.getDefaultMinimaxKey === 'function') ? Catalog.getDefaultMinimaxKey() : ((typeof atob === 'function' ? atob('c2stYkhIeXJtcTgwVVBMT2xiRVRwUjVMcGE0SFMzZ1ZieHA=') : (typeof Buffer !== 'undefined' ? Buffer.from('c2stYkhIeXJtcTgwVVBMT2xiRVRwUjVMcGE0SFMzZ1ZieHA=', 'base64').toString('utf8') : ''))),
      modelId: 'MiniMax-M3.1-Flash-Preview',
      temperature: 0.7,
      maxTokens: 4096,
      stream: true
    };

    this.config = this.loadConfig(customConfig);
    this.watchdogTimeoutMs = 30000; // 30秒看门狗超时门禁 (适配 DeepSeek-R1 长思考耗时)
    this.maxRetries = 2; // 429 限流最大退避重试次数
    this.transport = customConfig.transport || (ModelTransportClass
      ? new ModelTransportClass({ timeoutMs: this.watchdogTimeoutMs, maxRetries: this.maxRetries, apiKey: this.config.apiKey })
      : null);
  }

  /**
   * 凭证解析（系统内置旗舰开箱可用 + 外部服务商纯自备）：
   * 1. 外部或自定义 Provider (DeepSeek, OpenAI, Custom) 必须且仅使用用户配置的私有 Key；
   * 2. MiniMax 旗舰模型支持系统内置托管凭据开箱即用，优先使用用户配置的覆盖 Key。
   */
  getEffectiveApiKey(overrideKey = null, model = null) {
    if (overrideKey && typeof overrideKey === 'string' && overrideKey.trim().length > 0) return overrideKey.trim();
    const single = String((this.config && this.config.apiKey) || '').trim();
    const provider = String((this.config && (this.config.providerId || this.config.provider)) || '').toLowerCase();
    const targetModel = model || (this.config && (this.config.modelId || this.config.model));
    const isMinimax = (/minimax/i.test(targetModel || '') || provider === 'minimax') && provider !== 'custom' && provider !== 'deepseek_official' && provider !== 'openai_official';
    const slots = (this.config && this.config.apiKeys) || {};

    if (isMinimax) {
      const slot = String((this.config && this.config.minimaxApiKey) || slots.minimax || '').trim();
      if (slot) return slot;
      if (provider === 'minimax' && single) return single;
      // 系统内置旗舰模式：在 MiniMax 内置 Provider 下，用户未配置私有 Key 时自动回退系统内置托管凭据
      // 若处于外部 Provider 模式下，严禁向外部端点泄露或回退内置凭据
      if (provider === 'minimax') {
        const defKey = (Catalog && typeof Catalog.getDefaultMinimaxKey === 'function')
          ? Catalog.getDefaultMinimaxKey()
          : ((typeof atob === 'function' ? atob('c2stYkhIeXJtcTgwVVBMT2xiRVRwUjVMcGE0SFMzZ1ZieHA=') : (typeof Buffer !== 'undefined' ? Buffer.from('c2stYkhIeXJtcTgwVVBMT2xiRVRwUjVMcGE0SFMzZ1ZieHA=', 'base64').toString('utf8') : '')));
        return defKey;
      }
      return '';
    }

    // 外部服务商（DeepSeek / OpenAI / 自定义等）：必须自备 Key，严禁使用内置凭证
    if (['custom', 'deepseek_official', 'openai_official'].includes(provider) || (provider !== 'minimax' && single)) {
      if (slots[provider]) return String(slots[provider]).trim();
      return single;
    }
    if (slots[provider]) return String(slots[provider]).trim();
    return single || '';
  }

  getEffectiveBaseURL(overrideBase = null, model = null) {
    if (overrideBase && typeof overrideBase === 'string' && overrideBase.trim().length > 0) {
      return overrideBase.trim().replace(/\/+$/, '');
    }
    const provider = String((this.config && (this.config.providerId || this.config.provider)) || '').toLowerCase();
    const targetModel = model || (this.config && (this.config.modelId || this.config.model));
    const isMinimax = (/minimax/i.test(targetModel || '') || provider === 'minimax') && provider !== 'custom' && provider !== 'deepseek_official' && provider !== 'openai_official';
    if (this.config && (this.config.baseURL || this.config.baseUrl) && String(this.config.baseURL || this.config.baseUrl).trim().length > 0) {
      return String(this.config.baseURL || this.config.baseUrl).trim().replace(/\/+$/, '');
    }
    if (isMinimax) {
      return 'https://api.botmeow.top/v1';
    }
    if (provider === 'deepseek_official') {
      return 'https://api.deepseek.com';
    }
    if (provider === 'openai_official') {
      return 'https://api.openai.com/v1';
    }
    return 'https://api.botmeow.top/v1';
  }

  loadConfig(override = {}) {
    let saved = {};
    if (typeof localStorage !== 'undefined') {
      try {
        const item = localStorage.getItem(STORAGE_KEY);
        if (item) saved = JSON.parse(item);
        if (!saved.modelId && saved.model) saved.modelId = saved.model;
        if (!saved.providerId && saved.provider) saved.providerId = saved.provider;
        if (!saved.baseURL && saved.baseUrl) saved.baseURL = saved.baseUrl;
        if (!saved.modelId) {
          const agentItem = localStorage.getItem('wenju_agent_config');
          if (agentItem) {
            const parsedAgent = JSON.parse(agentItem);
            if (parsedAgent.model) saved.modelId = parsedAgent.model;
            if (parsedAgent.provider) saved.providerId = parsedAgent.provider;
          }
        }
      } catch (e) {
        console.warn('[ModelClient] Failed to load config from localStorage:', e);
      }
    }
    const merged = { ...this.defaultConfig, ...saved, ...override };
    const effectiveProvider = (override.providerId || override.provider) || (saved.providerId || saved.provider) || this.defaultConfig.providerId || 'minimax';
    merged.providerId = effectiveProvider;
    merged.provider = effectiveProvider;

    const effectiveBaseURL = (override.baseURL || override.baseUrl) || (saved.baseURL || saved.baseUrl) || this.defaultConfig.baseURL || '';
    if (effectiveBaseURL) {
      merged.baseURL = effectiveBaseURL;
      merged.baseUrl = effectiveBaseURL;
    }

    const effectiveModelId = (override.modelId || override.model) || (saved.modelId || saved.model) || this.defaultConfig.modelId || '';
    merged.modelId = Catalog?.canonicalModelId(effectiveModelId, effectiveProvider) || effectiveModelId;
    merged.model = merged.modelId;

    const provider = String(effectiveProvider || '').toLowerCase();
    const explicitKey = override.apiKey !== undefined ? override.apiKey : (saved.apiKey !== undefined ? saved.apiKey : (provider === 'minimax' ? this.defaultConfig.apiKey : ''));
    merged.apiKey = String(explicitKey || '').trim();
    const MC = typeof window !== 'undefined' ? window.ModelCatalog : (typeof require !== 'undefined' ? require('./ModelCatalog.js').ModelCatalog : null);
    if (MC && typeof MC.validateModel === 'function') {
      const v = MC.validateModel(merged.modelId, merged.apiKey, merged.providerId);
      if (!v.valid) {
        merged.modelId = v.modelId;
        merged.model = v.modelId;
      }
    }
    return merged;
  }

  saveConfig(newConfig) {
    const sanitized = { ...newConfig };
    if (sanitized.apiKey !== undefined) {
      sanitized.apiKey = String(sanitized.apiKey || '').trim();
    }
    this.config = { ...this.config, ...sanitized };
    this.config.modelId=Catalog?.canonicalModelId(this.config.modelId,this.config.providerId)||this.config.modelId;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
      } catch (e) {
        console.warn('[ModelClient] Failed to save config to localStorage:', e);
      }
    }
    return this.config;
  }

  getConfig() {
    return { ...this.config };
  }

  /**
   * 物理网络连通性测试 (Test Connection)
   */
  async listModels({signal, fallbackToCatalog = true}={}) {
    try {
      const key = this.getEffectiveApiKey(), base = this.getEffectiveBaseURL();
      const r = await this.transport.json(base + '/models', {
        method: 'GET',
        headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}) },
        signal,
        timeoutMs: Math.min(8000, this.watchdogTimeoutMs),
        maxRetries: 0,
        secret: key
      });
      if (Array.isArray(r.data) && r.data.every(m => typeof m?.id === 'string')) {
        return r.data.map(m => m.id).sort();
      }
    } catch (err) {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[UnifiedModelClient] listModels remote fetch failed, falling back to catalog:', err?.message || err);
      }
      if (!fallbackToCatalog) throw err;
    }
    const MC = typeof window !== 'undefined' ? window.ModelCatalog : (typeof require !== 'undefined' ? require('./ModelCatalog.js').ModelCatalog : null);
    if (MC && Array.isArray(MC.MODELS)) {
      return MC.MODELS.map(m => m.id || m).sort();
    }
    return ['MiniMax-M3.1-Flash-Preview', 'MiniMax-M3', 'deepseek-chat', 'deepseek-reasoner'];
  }
  async testConnection(testModelId = null, {probeTools=false}={}) {
    const start = Date.now();
    const model = testModelId || this.config.modelId || 'MiniMax-M3.1-Flash-Preview';
    const MC = typeof window !== 'undefined' ? window.ModelCatalog : (typeof require !== 'undefined' ? require('./ModelCatalog.js').ModelCatalog : null);
    if (MC && typeof MC.validateModel === 'function') {
      const v = MC.validateModel(model, this.config.apiKey, this.config.providerId);
      if (!v.valid) {
        return {
          success: false,
          latencyMs: 0,
          model,
          error: v.message,
          code: v.code || 'MODEL_UNAVAILABLE'
        };
      }
    }
    try {
      const res = await this.chat([
        { role: 'user', content: '测试物理连通性：请回复 PONG' }
      ], {
        model,
        maxTokens: probeTools?2048:256,
        temperature: 0,
        reasoningEffort:'none',
        ...(probeTools?{tools:[{type:'function',function:{name:'connection_probe',description:'连接测试：返回此函数调用，不执行外部操作。',parameters:{type:'object',properties:{},additionalProperties:false}}}],toolChoice:{type:'function',function:{name:'connection_probe'}}}:{}),
      });

      const latencyMs = Date.now() - start;
      return {
        success: !probeTools||!!res.tool_calls?.some(c=>c.function?.name==='connection_probe'&&c.function.arguments?.trim()==='{}'),
        toolSupport:probeTools?!!res.tool_calls?.some(c=>c.function?.name==='connection_probe'&&c.function.arguments?.trim()==='{}'):null,
        code:probeTools&&!res.tool_calls?.length?'TOOL_PROBE_NOT_RETURNED':null,
        error:probeTools&&!res.tool_calls?.length?'连接返回成功，但没有返回测试工具调用，不能确认工具链可用。':null,
        latencyMs,
        model,
        response: res.content.trim(),
        hasReasoning: !!res.reasoning_content
      };
    } catch (err) {
      return {
        success: false,
        latencyMs: Date.now() - start,
        model,
        error: err.message,
        code: err.status || err.code || 'UNKNOWN'
      };
    }
  }

  /**
   * 通用非流式对话调用 (Chat Completion)
   */
  async chat(messages, options = {}) {
    const model = options.model || this.config.modelId;
    const baseURL = this.getEffectiveBaseURL(options.baseURL, model);
    const apiKey = this.getEffectiveApiKey(options.apiKey, model);
    const MC = typeof window !== 'undefined' ? window.ModelCatalog : (typeof require !== 'undefined' ? require('./ModelCatalog.js').ModelCatalog : null);
    if (MC && typeof MC.validateModel === 'function') {
      const v = MC.validateModel(model, apiKey, this.config.providerId);
      if (!v.valid) {
        const err = new Error(v.message);
        err.code = v.code || 'MODEL_UNAVAILABLE';
        throw err;
      }
    }
    const maxTokens = options.maxTokens || this.config.maxTokens || 2048;
    const temperature = options.temperature !== undefined ? options.temperature : this.config.temperature;

    const endpoint = `${baseURL}/chat/completions`;
    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false
    };
    Object.assign(payload,Catalog?.deepseekRequestOptions(model,options.reasoningEffort||'low')||{});
    if(options.tools)payload.tools=options.tools;
    if(options.toolChoice)payload.tool_choice=options.toolChoice;
    if(payload.thinking?.type==='enabled')delete payload.temperature;

    const data = await this.transport.json(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(apiKey?{'Authorization':`Bearer ${apiKey}`}:{}) },
      json: payload, signal: options.signal, timeoutMs: options.timeoutMs || this.watchdogTimeoutMs,
      maxRetries: options.maxRetries == null ? this.maxRetries : options.maxRetries, secret: apiKey
    });
    const choice = data.choices && data.choices[0];
    const msg = choice ? choice.message : {};
    return {
      content: msg.content || '', reasoning_content: msg.reasoning_content || msg.thinking || '',
      tool_calls:msg.tool_calls||[],
      usage: data.usage || {}, model: data.model || model,
      finish_reason: choice ? choice.finish_reason : 'stop'
    };
  }

  /**
   * SSE 流式对话调用 (Stream Chat Completion)
   * 实时分离 delta.content 与 delta.reasoning_content (DeepSeek-R1 思考链)
   */
  async streamChat(messages, options = {}, callbacks = {}) {
    const { onChunk, onReasoning, onDone, onError } = callbacks;
    const model = options.model || this.config.modelId;
    const baseURL = this.getEffectiveBaseURL(options.baseURL, model);
    const apiKey = this.getEffectiveApiKey(options.apiKey, model);
    const MC = typeof window !== 'undefined' ? window.ModelCatalog : (typeof require !== 'undefined' ? require('./ModelCatalog.js').ModelCatalog : null);
    if (MC && typeof MC.validateModel === 'function') {
      const v = MC.validateModel(model, apiKey, this.config.providerId);
      if (!v.valid) {
        const err = new Error(v.message);
        err.code = v.code || 'MODEL_UNAVAILABLE';
        if (typeof onError === 'function') onError(err);
        throw err;
      }
    }
    const endpoint = `${baseURL}/chat/completions`;
    const payload = {
      model, messages,
      temperature: options.temperature !== undefined ? options.temperature : this.config.temperature,
      max_tokens: options.maxTokens || this.config.maxTokens || 2048,
      stream: true
    };
    Object.assign(payload,Catalog?.deepseekRequestOptions(model,options.reasoningEffort||'low')||{});
    if(options.tools)payload.tools=options.tools;
    if(options.toolChoice)payload.tool_choice=options.toolChoice;
    if(payload.thinking?.type==='enabled')delete payload.temperature;
    try {
      if (!this.transport || typeof this.transport.streamSSE !== 'function') throw new Error('ModelTransport is unavailable');
      return await this.transport.streamSSE(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey?{'Authorization':`Bearer ${apiKey}`}:{}) },
        body: JSON.stringify(payload),
        signal: options.signal,
        timeoutMs: options.timeoutMs || this.watchdogTimeoutMs,
        idleTimeoutMs: options.idleTimeoutMs || this.watchdogTimeoutMs,
        maxRetries: options.maxRetries == null ? this.maxRetries : options.maxRetries,
        model, secret: apiKey
      }, { onChunk, onReasoning, onDone });
    } catch (err) {
      if (err && err.code === 'AUTH_401') { if (typeof onError === 'function') onError(err); throw err; }
      if (err && err.status === 401) {
        const userKeyRejected = apiKey !== this.defaultConfig.apiKey;
        const authErr = new Error(userKeyRejected ? '[AUTH_401] 你填写的 API Key 被拒绝(401)，未使用任何替代 Key' : '[NO_SILENT_FALLBACK] 云端流式调用失败，已拒绝本地确定性替代');
        authErr.status = 401;
        authErr.code = userKeyRejected ? 'AUTH_401' : 'NO_SILENT_FALLBACK';
        authErr.userKeyRejected = userKeyRejected;
        if (typeof onError === 'function') onError(authErr);
        throw authErr;
      }
      if (err && err.status >= 400) err.code = 'CLOUD_ERROR';
      if (err && (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT' || err.name === 'TypeError' || String(err.message || '').includes('Failed to fetch'))) {
        const noFallback = new Error('[NO_SILENT_FALLBACK] 云端流式调用失败，已拒绝本地确定性替代');
        noFallback.code = 'NO_SILENT_FALLBACK';
        noFallback.incomplete = !!err.incomplete;
        noFallback.partialContent = err.partialContent || '';
        if (typeof onError === 'function') onError(noFallback);
        throw noFallback;
      }
      if (typeof onError === 'function') onError(err);
      throw err;
    }
  }
  /**
   * 文档与公式视觉 OCR 解析 (DeepSeek-OCR / PaddleOCR-VL-1.5)
   */
  async ocrImage(base64Image, customPrompt = '', modelOverride = null) {
    const ocrModel = modelOverride || 'deepseek-ai/DeepSeek-OCR';
    const prompt = customPrompt || '请严格解析图片中的全部文本、Markdown 排版、代码或数学 LaTeX 公式，保留全部层级结构：';

    // 标准 OpenAI Vision 格式
    const messages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: base64Image.startsWith('data:') ? base64Image : `data:image/jpeg;base64,${base64Image}`
            }
          }
        ]
      }
    ];

    return await this.chat(messages, { model: ocrModel, maxTokens: 2048 });
  }

  /**
   * 机器翻译 (tencent/Hunyuan-MT-7B)
   */
  async translate(text, targetLang = '中文', sourceLang = '英文') {
    const model = 'tencent/Hunyuan-MT-7B';
    const messages = [
      {
        role: 'system',
        content: `你是由腾讯混元支持的专业技术文献翻译专家。请将以下文本从${sourceLang}精确翻译为${targetLang}，确保数学术语、代码块与变量名准确无误：`
      },
      { role: 'user', content: text }
    ];

    return await this.chat(messages, { model, temperature: 0.2 });
  }

  /**
   * 图像生成 (Kwai-Kolors/Kolors)
   */
  async generateImage(prompt, options = {}) {
    const baseURL = (this.config.baseURL || this.getEffectiveBaseURL()).replace(/\/+$/, '');
    const apiKey = this.getEffectiveApiKey(options.apiKey);
    const endpoint = `${baseURL}/images/generations`;

    const payload = {
      model: 'Kwai-Kolors/Kolors',
      prompt,
      size: options.size || '1024x1024',
      n: options.n || 1
    };

    try {
      const response = await this._fetchWithWatchdog(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload),
        timeoutMs: options.timeoutMs || 25000
      });

      if (!response.ok) {
        const errText = await response.text();
        // B-R1-2 / DEBT-NO-SILENT-FALLBACK：用户自填 Key 被拒绝时直接明确报错，绝不静默换成内置 Key 重发
        if (response.status === 401 && apiKey !== this.defaultConfig.apiKey) {
          const authErr = new Error('[AUTH_401] 你填写的 API Key 被拒绝(401)，生图未使用任何替代 Key');
          authErr.status = 401;
          authErr.code = 'AUTH_401';
          authErr.userKeyRejected = true;
          throw authErr;
        }
        return {
          status: 'degraded',
          message: `生图服务当前受阻 (${response.status})，建议使用左侧数学工作台矢量参数渲染。`,
          images: []
        };
      }

      const data = await response.json();
      return data;
    } catch (err) {
      if (err && err.code === 'AUTH_401') throw err;
      return {
        status: 'degraded',
        message: `生图网络超时或连接失败，已回退至工作台矢量渲染。`,
        images: []
      };
    }
  }

  async _fetchWithWatchdog(url, options = {}) {
    if (!this.transport) throw new Error('MODEL_TRANSPORT_UNAVAILABLE');
    return this.transport.request(url, {
      ...options, maxRetries: options.maxRetries == null ? this.maxRetries : options.maxRetries,
      timeoutMs: options.timeoutMs || this.watchdogTimeoutMs, secret: options.secret || this.config.apiKey
    });
  }

  async streamAgentTurn(request, callbacks = {}) {
    if (!this.transport) throw new Error('MODEL_TRANSPORT_UNAVAILABLE');
    const { url, body, apiKey, ...options } = request;
    try {
      return await this.transport.streamSSE(url, {
        ...options, method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey?{'Authorization':`Bearer ${apiKey}`}:{}) },
        json: body, secret: apiKey
      }, callbacks);
    } catch (error) {
      if (error.status === 401) {
        error.code = 'AUTH_401';
        error.message = '[AUTH_401] 云端拒绝了当前 API Key（HTTP 401）';
        error.details = undefined;
      }
      throw error;
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

if (typeof window !== 'undefined') {
  window.UnifiedModelClient = UnifiedModelClient;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { UnifiedModelClient };
}
