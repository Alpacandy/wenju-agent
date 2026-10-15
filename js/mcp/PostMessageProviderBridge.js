/**
 * PostMessageProviderBridge —— 跨域外部工具 Provider 桥（P6-D 形态 A / P7 F6 清偿）
 *
 * 语义：把受控 iframe（或 Worker）内的工具运行时接成 MCP Provider（契约见 mountProvider）。
 * 安全纪律（设计文档 §2 约束逐条落地）：
 *   1. targetOrigin 必须显式给出，且**不得为 '*'**（构造时断言）；opaque origin（sandbox iframe/Worker）
 *      以 'null' 显式声明（发送侧按规范用 '*'，入站 origin/source 双校验不放松）；
 *   2. 收到的消息必须同时满足：event.origin === targetOrigin 且 event.source === targetWindow，
 *      否则丢弃并计入 rejectedMessages（伪造源/伪造 id 不得驱动任何行为）；
 *   3. 每次调用带唯一 id + 超时（默认 8s）→ 超时抛 PROVIDER_TIMEOUT（由 mountProvider 路由转为 JSON-RPC -32000）；
 *   4. dispose() 后不再接受任何消息（防止挂载撤销后残留响应）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PostMessageProviderBridge = api.PostMessageProviderBridge;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const CHANNEL = 'wenju-mcp-provider';
  const PROTOCOL_V = 1;
  const DEFAULT_TIMEOUT = 8000;

  class PostMessageProviderBridge {
    /**
     * @param {object} options { targetWindow, targetOrigin, providerId, timeoutMs, getNow }
     */
    constructor(options = {}) {
      const { targetWindow, targetOrigin, providerId } = options;
      if (!targetWindow || typeof targetWindow.postMessage !== 'function') throw new Error('BRIDGE_TARGET_WINDOW_REQUIRED');
      if (!targetOrigin || targetOrigin === '*') throw new Error("BRIDGE_TARGET_ORIGIN_REQUIRED: 显式 origin 必填且不得为 '*'");
      if (!providerId || typeof providerId !== 'string') throw new Error('BRIDGE_PROVIDER_ID_REQUIRED');
      this.targetWindow = targetWindow;
      this.targetOrigin = targetOrigin;
      // 规范限制：postMessage 的 targetOrigin 不接受 'null'（opaque origin 无法命名）——
      // sandbox 化 iframe/Worker 场景必须显式声明 targetOrigin='null'，发送侧以 '*' 投递，
      // 但**入站校验仍要求 event.origin==='null' 且 event.source===targetWindow**（双校验不放松）。
      this.opaqueTarget = targetOrigin === 'null';
      this._postOrigin = this.opaqueTarget ? '*' : targetOrigin;
      this.id = providerId;
      this.timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT;
      this.pending = new Map();   // rpcId -> { resolve, reject, timer }
      this.declaredTools = [];
      this.state = 'idle';        // idle | ready | disposed
      this.rejectedMessages = 0;  // 伪造/非法消息计数（可观测证据）
      this._seq = 0;
      this._listener = (ev) => this._onMessage(ev);
      if (typeof window !== 'undefined') window.addEventListener('message', this._listener);
    }

    /** 消息过滤：origin + source 双匹配；任何不匹配只计数不动作 */
    _onMessage(event) {
      if (this.state === 'disposed') return;
      if (event.origin !== this.targetOrigin) { this.rejectedMessages += 1; return; }
      if (event.source !== this.targetWindow) { this.rejectedMessages += 1; return; }
      const d = event.data;
      if (!d || d.channel !== CHANNEL || d.v !== PROTOCOL_V) { this.rejectedMessages += 1; return; }
      if (d.type === 'ready') {
        this.declaredTools = Array.isArray(d.tools) ? d.tools : [];
        this.state = 'ready';
        if (this._readyResolve) { this._readyResolve({ ok: true, tools: this.declaredTools }); this._readyResolve = null; }
        return;
      }
      if (d.type === 'result') {
        const p = this.pending.get(d.id);
        if (!p) { this.rejectedMessages += 1; return; } // 伪造 id / 重复响应
        this.pending.delete(d.id);
        clearTimeout(p.timer);
        if (d.error) { const err = new Error(String(d.error.message || 'provider error')); err.code = d.error.code || 'PROVIDER_ERROR'; p.reject(err); }
        else p.resolve(d.result);
        return;
      }
      this.rejectedMessages += 1;
    }

    _post(payload) { this.targetWindow.postMessage({ channel: CHANNEL, v: PROTOCOL_V, ...payload }, this._postOrigin); }

    /** 握手：发送 hello 并等待 ready（超时 → PROVIDER_HANDSHAKE_TIMEOUT） */
    connect() {
      if (this.state === 'ready') return Promise.resolve({ ok: true, tools: this.declaredTools });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this._readyResolve = null;
          const err = new Error('provider handshake timeout');
          err.code = 'PROVIDER_HANDSHAKE_TIMEOUT';
          reject(err);
        }, this.timeoutMs);
        this._readyResolve = (res) => { clearTimeout(timer); resolve(res); };
        this._post({ type: 'hello', providerId: this.id });
      });
    }

    /** Provider 契约：listTools() */
    listTools() { return this.declaredTools.slice(); }

    /** Provider 契约：callTool(name, args) —— 唯一 id + 超时 */
    callTool(name, args) {
      if (this.state !== 'ready') { const err = new Error('provider not ready'); err.code = 'PROVIDER_NOT_READY'; return Promise.reject(err); }
      const rpcId = this.id + '#' + (++this._seq);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending.delete(rpcId);
          const err = new Error('provider call timeout: ' + name);
          err.code = 'PROVIDER_TIMEOUT';
          reject(err);
        }, this.timeoutMs);
        this.pending.set(rpcId, { resolve, reject, timer });
        this._post({ type: 'call', id: rpcId, name, args: args || {} });
      });
    }

    dispose() {
      this.state = 'disposed';
      if (typeof window !== 'undefined') window.removeEventListener('message', this._listener);
      for (const [, p] of this.pending) { clearTimeout(p.timer); const err = new Error('provider disposed'); err.code = 'PROVIDER_DISPOSED'; p.reject(err); }
      this.pending.clear();
    }

    getStatus() { return { id: this.id, state: this.state, tools: this.declaredTools.length, pending: this.pending.size, rejectedMessages: this.rejectedMessages, targetOrigin: this.targetOrigin, opaqueTarget: this.opaqueTarget }; }
  }

  return { PostMessageProviderBridge, CHANNEL, PROTOCOL_V };
});
