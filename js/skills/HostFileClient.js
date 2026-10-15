/**
 * HostFileClient —— 宿主文件工作区客户端（P7-H9；接管白皮书 P2-1「受控后端」路径）
 *
 * 语义：把 manage_workspace_file 的 write/read/list/delete 映射到本机宿主
 * （server/src/file-service.js：白名单根 + realpath 边界 + 配额 + trash 回滚 + 审计）。
 * 端点来源：显式 setEndpoint()，或 window.wenjuHostFileEndpoint（app.js 依宿主配置注入）。
 * 纪律：任何非 2xx 显式报错并透传宿主 code（POLICY_DENIED / CONFIRMATION_REQUIRED / PATH_FORBIDDEN…），
 *       绝不静默降级为虚拟工作区结果。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.HostFileClient = api.HostFileClient; root.getSharedHostFileClient = api.getSharedHostFileClient; }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  class HostFileClient {
    constructor(options = {}) {
      this.baseUrl = null;
      this.token = null;
      this.confirmToken = null;
      this.timeoutMs = options.timeoutMs || 10000;
      this.fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(typeof window !== 'undefined' ? window : globalThis) : null);
      if (options.baseUrl && options.token) this.setEndpoint({ baseUrl: options.baseUrl, token: options.token, confirmToken: options.confirmToken });
    }

    setEndpoint({ baseUrl, token, confirmToken } = {}) {
      if (!baseUrl || !token) throw new Error('HOST_FILE_ENDPOINT_REQUIRED');
      this.baseUrl = String(baseUrl).replace(/\/+$/, '');
      this.token = token;
      this.confirmToken = confirmToken || null;
      return this;
    }

    /** 端点解析：显式 > window.wenjuHostFileEndpoint（每调用一次解析，支持运行时热配置） */
    _endpoint() {
      if (this.baseUrl && this.token) return { baseUrl: this.baseUrl, token: this.token, confirmToken: this.confirmToken };
      if (typeof window !== 'undefined' && window.wenjuHostFileEndpoint) {
        const e = window.wenjuHostFileEndpoint;
        if (e.baseUrl && e.token) return { baseUrl: String(e.baseUrl).replace(/\/+$/, ''), token: e.token, confirmToken: e.confirmToken || this.confirmToken };
      }
      return null;
    }

    available() { return !!this._endpoint(); }

    async _call(method, path, { body, signal: callerSignal } = {}) {
      if (callerSignal?.aborted) return { status: 'error', code: 'ABORTED', error: '文件请求已取消' };
      const ep = this._endpoint();
      if (!ep) return { status: 'error', code: 'HOST_FILE_UNAVAILABLE', error: '宿主文件端点未配置' };
      if (!this.fetchImpl) return { status: 'error', code: 'HOST_FILE_UNAVAILABLE', error: 'fetch 不可用' };
      const headers = { authorization: `Bearer ${ep.token}`, 'content-type': 'application/json' };
      if (ep.confirmToken) headers['x-wenju-confirm'] = ep.confirmToken;
      const signal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(callerSignal ? [callerSignal] : [])]);
      try {
        const res = await this.fetchImpl(ep.baseUrl + path, { method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body) });
        let parsed;
        try { parsed = await res.json(); }
        catch (error) { if (signal.aborted) throw error; return { status: 'error', code: res.ok ? 'HOST_FILE_INVALID_RESPONSE' : 'HOST_FILE_HTTP_' + res.status, error: '文件服务返回了无法解析的响应' }; }
        signal.throwIfAborted();
        if (!res.ok || parsed?.ok === false) return { status: 'error', code: parsed?.code || 'HOST_FILE_HTTP_' + res.status, error: parsed?.message || ('HTTP ' + res.status) };
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'error', code: 'HOST_FILE_INVALID_RESPONSE', error: '文件服务响应必须是对象' };
        return { status: 'success', data: parsed };
      } catch (e) {
        if (callerSignal?.aborted) return { status: 'error', code: 'ABORTED', error: '文件请求已取消' };
        if (signal.aborted) return { status: 'error', code: 'HOST_FILE_TIMEOUT', error: '文件服务响应超时' };
        return { status: 'error', code: 'HOST_FILE_UNREACHABLE', error: String(e && e.message || e) };
      }
    }

    /** 与 WorkspaceFileSkill 虚拟分支同形的执行面 */
    async execute(args = {}, context = {}) {
      const action = String(args.action || 'list').toLowerCase();
      const filepath = String(args.filepath || '').trim();
      const content = args.content ?? '';
      if (action === 'list') {
        const r = await this._call('GET', '/v1/workspace', context);
        if (r.status !== 'success') return r;
        if (!Array.isArray(r.data.files) || r.data.files.some(f => typeof f?.path !== 'string' || !Number.isFinite(f.size))) return { status: 'error', code: 'HOST_FILE_INVALID_RESPONSE', error: '文件列表格式无效' };
        const files = Array.isArray(r.data.files) ? r.data.files.map((f) => ({ path: f.path, size: f.size })) : [];
        return { status: 'success', action: 'list', files, count: files.length };
      }
      if (action === 'read') {
        if (!filepath) return { status: 'error', code: 'INVALID_PARAMS', error: 'filepath is required' };
        const r = await this._call('GET', '/v1/file?path=' + encodeURIComponent(filepath), context);
        if (r.status !== 'success') return r;
        if (typeof r.data.content !== 'string') return { status: 'error', code: 'HOST_FILE_INVALID_RESPONSE', error: '读取响应缺少文件内容' };
        return { status: 'success', action: 'read', path: r.data.path || filepath, filepath: r.data.path || filepath, content: String(r.data.content ?? ''), size: r.data.size };
      }
      if (action === 'write') {
        if (!filepath) return { status: 'error', code: 'INVALID_PARAMS', error: 'filepath is required' };
        if (typeof content !== 'string') return { status: 'error', code: 'INVALID_PARAMS', error: 'content must be a string' };
        const r = await this._call('PUT', '/v1/file', { signal: context.signal, body: { path: filepath, content } });
        if (r.status !== 'success') return r;
        if (typeof r.data.path !== 'string' || !Number.isFinite(r.data.size)) return { status: 'error', code: 'HOST_FILE_INVALID_RESPONSE', error: '写入响应缺少文件路径或大小；请回读确认结果' };
        return { status: 'success', action: 'write', path: r.data.path || filepath, filepath: r.data.path || filepath, size: r.data.size, replaced: !!r.data.replaced };
      }
      if (action === 'delete') {
        if (!filepath) return { status: 'error', code: 'INVALID_PARAMS', error: 'filepath is required' };
        const r = await this._call('DELETE', '/v1/file?path=' + encodeURIComponent(filepath), context);
        if (r.status !== 'success') return r;
        if (typeof r.data.deleted !== 'boolean') return { status: 'error', code: 'HOST_FILE_INVALID_RESPONSE', error: '删除响应缺少执行结果' };
        return { status: 'success', action: 'delete', path: r.data.path || filepath, deleted: !!r.data.deleted };
      }
      return { status: 'error', code: 'INVALID_PARAMS', error: 'unknown action: ' + action };
    }
  }

  let shared = null;
  function getSharedHostFileClient() {
    if (shared) return shared;
    shared = new HostFileClient();
    return shared;
  }

  return { HostFileClient, getSharedHostFileClient };
});
