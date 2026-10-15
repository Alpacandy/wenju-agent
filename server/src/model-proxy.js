const DEFAULT_PROVIDERS = {
  minimax: { baseUrl: 'https://api.minimax.io/v1', keyEnv: 'TEACHAGENT_MINIMAX_KEY' },
  deepseek_official: { baseUrl: 'https://api.deepseek.com', keyEnv: 'TEACHAGENT_DEEPSEEK_KEY' },
  openai_official: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'TEACHAGENT_OPENAI_KEY' }
};

class ModelProxyError extends Error {
  constructor(code, message, status = 400, details = {}) { super(message); this.code = code; this.status = status; this.details = details; }
}

class ModelProxy {
  constructor(options = {}) {
    this.providers = options.providers || DEFAULT_PROVIDERS;
    this.fetch = options.fetch || globalThis.fetch;
    this.maxBodyBytes = options.maxBodyBytes || 2 * 1024 * 1024;
    if (typeof this.fetch !== 'function') throw new TypeError('ModelProxy requires fetch');
  }
  resolveProvider(body) {
    const provider = String(body.provider || '').toLowerCase();
    if (provider && !this.providers[provider]) throw new ModelProxyError('PROVIDER_NOT_ALLOWED', 'provider is not allowed', 403);
    if (provider && this.providers[provider]) return [provider, this.providers[provider]];
    const model = String(body.model || '').toLowerCase();
    let guessed = model.includes('minimax') ? 'minimax' : (this.providers.minimax ? 'minimax' : Object.keys(this.providers)[0]);
    if (!this.providers[guessed]) guessed = Object.keys(this.providers)[0] || 'minimax';
    return [guessed, this.providers[guessed]];
  }
  async forward(body, { signal } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.model !== 'string' || !body.model.trim() || !Array.isArray(body.messages)) throw new ModelProxyError('INVALID_PARAMS', 'model and messages are required');
    const [provider, config] = this.resolveProvider(body);
    if (!config || !config.baseUrl || (!config.keyEnv && !config.apiKey)) throw new ModelProxyError('PROVIDER_NOT_ALLOWED', 'provider is not allowed', 403);
    // P7-H5：密钥收敛——config.yaml（经 providers）优先，环境变量兜底（部署兼容）
    const apiKey = config.apiKey || (config.keyEnv ? process.env[config.keyEnv] : null);
    if (!apiKey) throw new ModelProxyError('NO_API_KEY', `server credential ${config.keyEnv} is not configured`, 503);
    const payload = { ...body }; delete payload.provider;
    let response;
    try {
      response = await this.fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload), signal
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ModelProxyError('UPSTREAM_UNAVAILABLE', 'model provider could not be reached', 502);
    }
    return { provider, response };
  }
}

module.exports = { ModelProxy, ModelProxyError, DEFAULT_PROVIDERS };
