/**
 * 问矩 · 浏览器内置 Model Context Protocol (MCP) 标准运行时 (v2.0)
 * 遵循官方 Anthropic MCP / JSON-RPC 2.0 规范，对齐 DeepSeek Harness (dsh) 插件体系：
 * 1. 提供 tools/list 接口，向大模型透传严格的 JSON-Schema 工具定义；
 * 2. 提供 tools/call 接口，接收标准参数并通过 ToolRegistry 中间件分发至 Builtin Skills；
 * 3. 提供 resources/list 与 resources/read 接口，导出当前物理画板与代数状态上下文；
 * 4. 内置指标收集、耗时追踪与错误状态断言；
 * 5. 跨环境适配 (Browser Window / Node.js CommonJS)。
 */

let ToolRegistryRef;
if (typeof require !== 'undefined') {
  try { ToolRegistryRef = require('./ToolRegistry.js').ToolRegistry; } catch (e) { if (typeof recordIssue === 'function') recordIssue('InBrowserMCPServer', 'if', e); }
}
if (!ToolRegistryRef && typeof window !== 'undefined') {
  ToolRegistryRef = window.ToolRegistry;
}
if (!ToolRegistryRef) {
  // 简易 Fallback ToolRegistry
  ToolRegistryRef = class {
    constructor() { this.tools = new Map(); this.middlewares = []; this.metrics = new Map(); }
    use(mw) { this.middlewares.push(mw); }
    register(schema, handler) { this.tools.set(schema.name, { schema, handler }); }
    getSchemas() { return Array.from(this.tools.values()).map(t => t.schema); }
    async invoke(name, args, ctx) {
      const t = this.tools.get(name);
      if (!t) return { success: false, code: -32601, message: `Tool not found: ${name}` };
      const d = await t.handler(args, ctx);
      return { success: true, data: d };
    }
    getMetrics() { return {}; }
  };
}

class InBrowserMCPServer {
  constructor(context = {}) {
    this.registry = new ToolRegistryRef();
    this.externalRegistry = new ToolRegistryRef({ quotaPolicy: this.registry.quota });
    this.resources = new Map();
    this.context = context;
    // P6-D：外部工具 Provider 端口（MCP 外接）——providers: id→provider；externalTools: 工具名→声明
    this.providers = new Map();
    this.externalTools = new Map();

    // 挂载默认日志中间件
    this.registry.use(async (name, args, next) => {
      const t0 = Date.now();
      try {
        const res = await next(args);
        return res;
      } catch (err) {
        throw err;
      }
    });
  }

  /**
   * 设置全局依赖上下文 (mathEngine, workspaceVisualizer 等)
   */
  setContext(context) {
    this.context = Object.assign(this.context, context);
  }

  /**
   * 注册标准 MCP 工具
   * @param {Object} schema 符合 OpenAI / Anthropic Function Calling 的 Schema
   * @param {Function} handler 工具实际执行函数
   * @param {Object} metadata 附加元数据
   */
  registerTool(schema, handler, metadata = {}) {
    this.registry.register(schema, handler, metadata);
  }

  /**
   * 注册上下文资源
   */
  registerResource(uri, name, readHandler) {
    this.resources.set(uri, { uri, name, readHandler });
  }

  /**
   * 直接调用工具 (内部快捷方法)
   */
  async callTool(name, args = {}) {
    return await this.registry.invoke(name, args, this.context);
  }

  /**
   * P6-D：挂载外部工具 Provider（MCP 外接端口）。
   * Provider 契约：{ id, listTools(): Array<{name, description?, parameters?}>, callTool(name, args): Promise<any> }
   * 语义：全量校验后原子提交——任一校验失败则整个挂载拒绝，不产生半挂载状态（无静默部分注册）。
   * 工具声明可选策略字段：readOnly: true（只读，可在只读模式调用）、requiresPrediction: true（PREDICT 阶段锁定）。
   * @returns {{ok:true,id:string,tools:string[]}|{ok:false,code:string,message:string}}
   */
  mountProvider(provider) {
    const fail = (code, message) => ({ ok: false, code, message });
    if (!provider || typeof provider !== 'object') return fail('PROVIDER_INVALID', 'Provider 必须是对象');
    const id = provider.id;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{2,32}$/.test(id)) return fail('PROVIDER_INVALID', 'Provider.id 必须匹配 /^[a-zA-Z0-9_-]{2,32}$/');
    if (typeof provider.listTools !== 'function' || typeof provider.callTool !== 'function') {
      return fail('PROVIDER_INVALID', `Provider ${id} 必须实现 listTools() 与 callTool()`);
    }
    if (this.providers.has(id)) return fail('PROVIDER_ID_CONFLICT', `Provider ${id} 已挂载，重复挂载显式拒绝`);

    let declared;
    try { declared = provider.listTools(); } catch (e) {
      return fail('PROVIDER_LIST_FAILED', `Provider ${id} 的 listTools() 抛错：${e && e.message || e}`);
    }
    if (!Array.isArray(declared)) return fail('PROVIDER_INVALID', `Provider ${id} 的 listTools() 必须返回数组`);

    const builtinNames = new Set(this.registry.getSchemas().map((s) => s && s.name).filter(Boolean));
    const staged = [];
    const seen = new Set();
    for (const d of declared) {
      if (!d || typeof d.name !== 'string' || !d.name.trim()) return fail('PROVIDER_INVALID', `Provider ${id} 存在缺少 name 的工具声明`);
      const name = d.name.trim();
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) return fail('PROVIDER_INVALID', `Provider ${id} 工具名 ${name} 不满足 ^[a-zA-Z0-9_-]{1,64}$`);
      if (builtinNames.has(name) || this.externalTools.has(name) || seen.has(name)) {
        return fail('TOOL_NAME_CONFLICT', `Provider ${id} 工具名冲突：${name}（内置技能或其他 Provider 已占用，拒绝覆盖）`);
      }
      seen.add(name);
      staged.push({
        name,
        readOnly: d.readOnly === true,
        requiresPrediction: d.requiresPrediction === true,
        schema: Object.assign({}, d, {
          name,
          description: d.description || `[外部 Provider ${id}] ${name}`,
          parameters: d.parameters ?? d.inputSchema ?? d.input_schema ?? { type: 'object', properties: {} }
        })
      });
    }

    // Compile every declaration before publishing any tool from this provider.
    const stagedRegistry = new ToolRegistryRef({ quotaPolicy: this.registry.quota });
    try {
      for (const s of staged) stagedRegistry.register(s.schema, (args, context) => provider.callTool(s.name, args, context), {strictSchema:true});
    } catch (error) { return fail('PROVIDER_SCHEMA_INVALID', String(error.message)); }
    for (const s of staged) this.externalRegistry.register(s.schema, (args, context) => provider.callTool(s.name, args, context), { providerId: id,strictSchema:true });
    this.providers.set(id, provider);
    for (const s of staged) this.externalTools.set(s.name, { providerId: id, schema: s.schema, readOnly: s.readOnly, requiresPrediction: s.requiresPrediction });
    return { ok: true, id, tools: staged.map((s) => s.name) };
  }

  /**
   * P6-D：卸载 Provider 及其全部工具（插件停用语义）；返回被移除的工具名列表。
   */
  unmountProvider(id) {
    if (!this.providers.has(id)) return { ok: false, code: 'PROVIDER_NOT_MOUNTED', message: `Provider ${id} 未挂载` };
    const removed = [];
    for (const [name, meta] of Array.from(this.externalTools.entries())) {
      if (meta.providerId === id) { this.externalTools.delete(name); this.externalRegistry.tools.delete(name); this.externalRegistry.metrics.delete(name); removed.push(name); }
    }
    this.providers.delete(id);
    return { ok: true, id, removed };
  }

  /** P6-D：外部工具策略查询；内置工具返回 null（内置门禁由引擎既有列表定义，语义不混写）。 */
  getToolPolicy(name) {
    const ext = this.externalTools.get(name);
    if (!ext) return null;
    return { external: true, providerId: ext.providerId, readOnly: ext.readOnly, requiresPrediction: ext.requiresPrediction };
  }

  /** P6-D：外部工具清单（含策略与 schema），供审计与 UI 呈现。 */
  listExternalTools() {
    return Array.from(this.externalTools.entries()).map(([name, m]) => ({
      name, providerId: m.providerId, readOnly: m.readOnly, requiresPrediction: m.requiresPrediction, schema: m.schema
    }));
  }

  /** 内置 + 外部工具的完整 Schema 列表（tools/list 与 listTools 的唯一数据源）。 */
  _listAllSchemas() {
    return this.registry.getSchemas().concat(Array.from(this.externalTools.values()).map((m) => m.schema));
  }

  /**
   * 获取所有注册工具描述列表
   */
  listTools() {
    return this._listAllSchemas();
  }

  /**
   * 获取工具调用度量报告
   */
  getMetrics() {
    return { ...this.registry.getMetrics(), ...this.externalRegistry.getMetrics() };
  }

  /**
   * 处理标准 JSON-RPC 2.0 MCP 请求
   * @param {Object} request { jsonrpc: "2.0", id: string|number, method: string, params: Object }
   * @returns {Promise<Object>} 标准 JSON-RPC 2.0 响应
   */
  async handleRequest(request, contextOverride = null) {
    if (!request || request.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: request?.id || null,
        error: { code: -32600, message: 'Invalid Request: jsonrpc must be "2.0"' }
      };
    }

    const { id, method, params } = request;
    // Per-call context is captured before any await; it must never mutate the next run's context.
    const invocationContext = contextOverride ? { ...this.context, ...contextOverride } : this.context;

    try {
      switch (method) {
        case 'tools/list': {
          const toolList = this._listAllSchemas();
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: toolList
            }
          };
        }

        case 'tools/call': {
          if (!params || !params.name) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: 'Invalid params: tool name is required' }
            };
          }

          // P6-D：外部 Provider 工具路由（Provider 抛错 → JSON-RPC error，绝不伪装 success）
          const extMeta = this.externalTools.get(params.name);
          if (extMeta) {
            const provider = this.providers.get(extMeta.providerId);
            if (!provider) {
              return {
                jsonrpc: '2.0',
                id,
                error: { code: -32603, message: `[PROVIDER_ERROR] Provider ${extMeta.providerId} 已失效（工具 ${params.name} 无归属运行时）` }
              };
            }
            const invoked = await this.externalRegistry.invoke(params.name, params.arguments ?? {}, invocationContext);
            if (!invoked.success) return { jsonrpc: '2.0', id, error: { code: invoked.code, message: `[PROVIDER_ERROR] ${extMeta.providerId}/${params.name}: ${invoked.message}`, data: { rejectionCode: invoked.rejectionCode, details: invoked.details, traceId: invoked.traceId } } };
            const rawOutput = invoked.data;
            const extTextPayload = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput);
            return {
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: extTextPayload }],
                isError: !!(rawOutput && (rawOutput.status === 'error' || rawOutput.isError === true)),
                structuredData: rawOutput,
                meta: { ...invoked.meta, traceId: invoked.traceId, providerId: extMeta.providerId, external: true }
              }
            };
          }

          const invokeRes = await this.registry.invoke(params.name, params.arguments ?? {}, invocationContext);
          if (!invokeRes.success) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: invokeRes.code || -32000, message: invokeRes.message, data: { rejectionCode: invokeRes.rejectionCode, details: invokeRes.details, traceId: invokeRes.traceId } }
            };
          }

          const rawOutput = invokeRes.data;
          const textPayload = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput);

          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: textPayload
                }
              ],
              isError: Boolean(
                rawOutput?.status === 'error' ||
                rawOutput?.ok === false ||
                rawOutput?.success === false ||
                rawOutput?.isError === true ||
                rawOutput?.error != null
              ),
              structuredData: rawOutput,
              meta: invokeRes.meta
            }
          };
        }

        case 'resources/list': {
          const resList = Array.from(this.resources.values()).map(r => ({
            uri: r.uri,
            name: r.name
          }));
          return {
            jsonrpc: '2.0',
            id,
            result: { resources: resList }
          };
        }

        case 'resources/read': {
          const res = this.resources.get(params?.uri);
          if (!res) {
            return {
              jsonrpc: '2.0',
              id,
              error: { code: -32602, message: `Resource not found: ${params?.uri}` }
            };
          }
          const content = await res.readHandler();
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri: res.uri,
                  mimeType: 'application/json',
                  text: typeof content === 'string' ? content : JSON.stringify(content)
                }
              ]
            }
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` }
          };
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: err.message || 'Internal MCP Execution Error' }
      };
    }
  }
}

// 导出至浏览器环境与 Node.js 测试环境
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { InBrowserMCPServer };
}
if (typeof window !== 'undefined') {
  window.InBrowserMCPServer = InBrowserMCPServer;
}
