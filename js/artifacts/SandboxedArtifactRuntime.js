/**
 * SandboxedArtifactRuntime —— 受控 iframe 通用工件运行时（P4 T4.2 · W1/W2/W4）
 *
 * 架构（Open WebUI 280 行模式工程化，调研确认无一开源实现自带版本栈/看门狗）：
 *  - iframe `sandbox="allow-scripts"`（不开 allow-same-origin → 工件无法访问宿主 cookie/localStorage/parent DOM）；
 *  - srcdoc 前置 CSP `<meta>`（default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:）；
 *  - postMessage 协议：{channel:'wenju-artifact', v:1, type:'ready'|'error'|'resize'|'done'}——仅信任显式 channel 字段；
 *  - 看门狗：srcdoc 加载后 WATCHDOG_MS 内未收到 ready → iframe.remove() + 错误面板（W2 死循环终止）；
 *  - 流式更新（W4）：pushChunk(text) 缓冲 + DEBOUNCE_MS 防抖整块替换 srcdoc（无半渲染残块）。
 *
 * 工件内探针模板（用于测试与自证）：
 *   探针脚本注入工件源码后，在 iframe 内尝试读 localStorage / parent.__secret → 必须 throw / undefined（W1）。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SandboxedArtifactRuntime = api.SandboxedArtifactRuntime; }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const CHANNEL = 'wenju-artifact';
  const WATCHDOG_MS = 5000;
  const DEBOUNCE_MS = 200;

  function escAttr(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  /** 工件源码 → 完整 srcdoc（前置 CSP meta + 桥接脚本注入） */
  function buildSrcdoc(content, kind, initialState = null) {
    const bridge = `<script>
(function(){
  function send(type, data) {
    try { parent.postMessage({ channel: '${CHANNEL}', v: 1, type: type, data: data || {} }, '*'); } catch (e) { if (typeof recordIssue === 'function') recordIssue('SandboxedArtifactRuntime', 'send', e); }
  }
  var restored = ${JSON.stringify(initialState).replace(/</g, '\\u003c')};
  var stateReady = false;
  var restoring = false;
  function snapshotState() {
    if (!stateReady || restoring) return;
    try {
      var inputs = Array.from(document.querySelectorAll('input,select,textarea')).slice(0,100).filter(function(el){return el.type !== 'password' && el.type !== 'file';}).map(function(el,index){return {index:index,value:el.value,checked:el.checked};});
      send('state', { inputs: inputs, custom: window.artifactState || null });
    } catch(e) { report(e); }
  }
  window.addEventListener('input', snapshotState);
  window.addEventListener('change', snapshotState);
  window.addEventListener('pointerup', function(){setTimeout(snapshotState,0);});
  window.addEventListener('artifact-state-changed', snapshotState);
  window.addEventListener('message', async function(event) {
    var d=event.data;
    if(event.source!==parent || !d || d.channel!=='${CHANNEL}' || d.v!==1 || d.type!=='scene-command' || typeof d.id!=='string')return;
    try {
      if(!window.WenjuScene)throw new Error('SCENE_RUNTIME_UNAVAILABLE');
      var result=await window.WenjuScene.command(d.args);
      snapshotState();send('scene-result',{id:d.id,ok:true,result:result});
    }catch(error){send('scene-result',{id:d.id,ok:false,code:error.code||error.message,message:error.message});}
  });
  function emitReady() {
    if (stateReady) return;
    if (restored) {
      restoring = true;
      if (restored.custom) window.artifactState = restored.custom;
      var inputs = Array.from(document.querySelectorAll('input,select,textarea')).slice(0,100).filter(function(el){return el.type !== 'password' && el.type !== 'file';});
      (restored.inputs || []).forEach(function(value){var el=inputs[value.index];if(el){el.value=value.value;el.checked=!!value.checked;el.dispatchEvent(new Event('input',{bubbles:true}));}});
      window.dispatchEvent(new CustomEvent('artifact-state-restored', {detail:restored.custom}));
      restoring = false;
    }
    stateReady = true;
    snapshotState();
    send('ready', { kind: '${escAttr(kind)}', hasJXG: typeof JXG !== 'undefined' });
    send('done', {});
  }
  if (document.readyState === 'complete') {
    emitReady();
  } else {
    window.addEventListener('load', emitReady);
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() { if (!stateReady) emitReady(); }, 350);
    });
  }
  function report(error, event) { send('error', { name: String(error && error.name || 'Error').slice(0, 80), message: String(error && error.message || error || 'Unknown runtime error').slice(0, 2000), stack: String(error && error.stack || '').slice(0, 4000), filename: String(event && event.filename || '').slice(0, 240), line: Number(event && event.lineno || 0), column: Number(event && event.colno || 0) }); }
  window.addEventListener('error', function(e) { report(e.error || e.message, e); });
  window.addEventListener('unhandledrejection', function(e) { report(e.reason, null); });
  document.addEventListener('DOMContentLoaded', function() {
    try { send('resize', { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }); } catch (e) { if (typeof recordIssue === 'function') recordIssue('SandboxedArtifactRuntime', 'addEventListener', e); }
    // Presentation changes stay inside this sandbox and never alter saved source.
    var mode = null, timer = null, lastBox = '', body = document.body;
    var original = ['zoom', 'width'].map(function(key) { return [key, body.style.getPropertyValue(key), body.style.getPropertyPriority(key)]; });
    function box() { var r = body.getBoundingClientRect(); return [innerWidth, innerHeight, r.width.toFixed(1), r.height.toFixed(1)].join(':'); }
    function restore() { original.forEach(function(item) { if (item[1]) body.style.setProperty(item[0], item[1], item[2]); else body.style.removeProperty(item[0]); }); }
    function fit() {
      timer = null; if (mode === null || !innerWidth || !innerHeight) return;
      if (mutations) mutations.disconnect();
      restore();
      var rect = body.getBoundingClientRect(), doc = document.documentElement;
      var w = Math.max(innerWidth, doc.scrollWidth), h = Math.max(innerHeight, doc.scrollHeight);
      var scale = mode === 'fit' ? Math.max(.5, Math.min(1, innerWidth / w, innerHeight / h)) : mode;
      if (scale !== 1) { body.style.setProperty('width', rect.width + 'px', 'important'); body.style.setProperty('zoom', String(scale), 'important'); }
      lastBox = box();
      if (mutations) observeMutations();
      send('layout', { scale: scale, w: w, h: h, overflow: doc.scrollHeight > innerHeight + 2 || doc.scrollWidth > innerWidth + 2 });
    }
    function schedule() { if (mode !== null && !timer) timer = setTimeout(fit, 80); }
    window.addEventListener('message', function(e) {
      var d = e.data;
      if (e.source !== parent || !d || d.channel !== '${CHANNEL}' || d.v !== 1 || d.type !== 'presentation') return;
      if (d.scale !== 'fit' && (typeof d.scale !== 'number' || !Number.isFinite(d.scale) || d.scale < .5 || d.scale > 1)) return;
      mode = d.scale; window.scrollTo(0, 0); schedule();
    });
    window.addEventListener('resize', schedule);
    var observer = typeof ResizeObserver === 'function' ? new ResizeObserver(function() { if (box() !== lastBox) schedule(); }) : null;
    if (observer) observer.observe(body);
    var mutations = new MutationObserver(schedule);
    function observeMutations() { mutations.observe(body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'width', 'height'] }); }
    observeMutations();
    window.addEventListener('pagehide', function() { if (timer) clearTimeout(timer); if (observer) observer.disconnect(); mutations.disconnect(); });
  });
})();
</script>`;
    // svg 内容包裹为完整 HTML
    if (typeof window !== 'undefined' && window.NativeMathDocument && content.includes(window.NativeMathDocument.marker)) content = window.NativeMathDocument.expand(content, window.WenjuMathAsset);
    const body = kind === 'svg'
      ? `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;display:flex;align-items:center;justify-content:center;">${content}</body></html>`
      : content;
    // The trusted prefix always precedes every byte of user markup, even malformed documents.
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none';">`;
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">${csp}${bridge}</head><body>${body.replace(/<!doctype[^>]*>/ig, '')}</body></html>`;
  }

  class SandboxedArtifactRuntime {
    requestScene(args,{signal,timeoutMs=3000}={}) {
      if(signal?.aborted)return Promise.reject(Object.assign(new Error('RUN_ABORTED'),{code:'RUN_ABORTED'}));
      if(!this.iframe?.contentWindow)return Promise.reject(Object.assign(new Error('SCENE_RUNTIME_UNAVAILABLE'),{code:'SCENE_RUNTIME_UNAVAILABLE'}));
      this._sceneRequests ||= new Map();
      const id='scene-'+Date.now()+'-'+Math.random().toString(36).slice(2);
      return new Promise((resolve,reject)=>{
        const finish=data=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this._sceneRequests.delete(id);data.ok?resolve(data.result):reject(Object.assign(new Error(data.message||data.code),{code:data.code}));};
        const abort=()=>finish({ok:false,code:'RUN_ABORTED'}),timer=setTimeout(()=>finish({ok:false,code:'SCENE_COMMAND_TIMEOUT'}),timeoutMs);
        this._sceneRequests.set(id,{finish});signal?.addEventListener('abort',abort,{once:true});
        this.iframe.contentWindow.postMessage({channel:CHANNEL,v:1,type:'scene-command',id,args},'*');
      });
    }
    /**
     * @param {HTMLElement} container - 挂载容器（工件 iframe 注入于此）
     */
    constructor(container) {
      this.container = typeof container === 'string' ? document.getElementById(container) : container;
      if (!this.container) throw new Error('[SandboxedArtifactRuntime] 缺少容器');
      this.iframe = null;
      this._buffer = '';
      this._debounceTimer = null;
      this._watchdogTimer = null;
      this._messageHandler = null;
      this._lastVersion = null;
      this._errorPanel = null;
      this._sceneRequests = new Map();
      this.state = 'idle'; // idle | loading | ready | error | done
    }

    /** 完整加载工件（替换当前内容） */
    load(content, kind = 'html', options = {}) {
      this._teardown();
      this._buffer = content;
      this._kind = kind;
      this.state = 'loading';
      this._lastVersion = options.versionId || null;
      this._previewScale = options.previewScale ?? null;
      this.interactionState = options.initialState || null;
      this._createIframe(buildSrcdoc(content, kind, options.initialState || null), { ...options, kind });
      if (options.signal) {
        this._abortSignal = options.signal;
        this._abortHandler = () => { this.destroy(); this.state = 'aborted'; if (options.onAbort) options.onAbort(); };
        if (options.signal.aborted) this._abortHandler();
        else options.signal.addEventListener('abort', this._abortHandler, { once: true });
      }
      return this;
    }

    /** 流式推送（W4）：缓冲 + 防抖整块替换 */
    pushChunk(text) {
      this._buffer += text;
      if (this._debounceTimer) clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => {
        const content = this._buffer;
        this._teardown(false); // 不清缓冲标记
        this.state = 'loading';
        this._createIframe(buildSrcdoc(content, this._kind || 'html'), {});
      }, DEBOUNCE_MS);
      return this;
    }

    /** 流式完成（立即提交） */
    finalize(kind = 'html') {
      this._kind = kind;
      if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
      if (this._buffer) {
        const content = this._buffer;
        this._teardown(false);
        this._createIframe(buildSrcdoc(content, kind), {});
      }
      return this;
    }

    _createIframe(srcdoc, options) {
      this.state = 'loading';
      // 错误面板先清理
      if (this._errorPanel) { this._errorPanel.remove(); this._errorPanel = null; }
      this._kind = options.kind || this._kind || 'html';

      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts'); // W1 核心：无 allow-same-origin
      // P7-H7 实证：srcdoc 与 blob: 均属"本地 scheme"，同继承父页 CSP（CDP 探针：两者内联脚本
      // 在无 'unsafe-inline' 时皆被拦）。故工件沿用 D-06 既定 srcdoc 形态，隔离依赖 sandbox(无 allow-same-origin)
      // + 工件级 CSP 注入 + postMessage 通道校验；主文档 CSP 的 script-src 显式含 'unsafe-inline'（已登记残留）。
      iframe.setAttribute('srcdoc', srcdoc);
      iframe.style.width = '100%';
      iframe.style.border = 'none';
      iframe.style.minHeight = options.fitViewport ? '0' : options.height || '280px';
      if (options.fitViewport) iframe.style.height = '100%';
      iframe.className = 'sandboxed-artifact-iframe';
      this.container.appendChild(iframe);
      this.iframe = iframe;

      // postMessage 监听（仅信任显式 channel + source 匹配本 iframe）
      this._messageHandler = (ev) => {
        const d = ev.data;
        if (!d || d.channel !== CHANNEL || d.v !== 1) return;
        // 审计修复：多个 Runtime 实例共存时，仅本 iframe 的消息才更新本实例状态
        if (!this.iframe || ev.source !== this.iframe.contentWindow) return;
        if (d.type === 'state') {
          const serialized = JSON.stringify(d.data);
          const hasValidPayload = d.data && (Array.isArray(d.data.inputs) || (d.data.custom && typeof d.data.custom === 'object'));
          if (serialized.length <= 16384 && hasValidPayload) this.interactionState = JSON.parse(serialized);
        }
        else if(d.type==='scene-result' && typeof d.data?.id==='string') {
          const pending=this._sceneRequests?.get(d.data.id);
          if(pending){this._sceneRequests.delete(d.data.id);pending.finish(d.data);}
        }
        else if (d.type === 'ready') { this._clearWatchdog(); if (this.state !== 'error') { if (this.state !== 'done') this.state = 'ready'; if (options.onReady) options.onReady(d.data); if (this._previewScale !== null && this._previewScale !== undefined) this.setPreviewScale(this._previewScale); } }
        else if (d.type === 'error') {
          this.state = 'error'; this._clearWatchdog();
          const error = d.data || {};
          this.lastError = { name: String(error.name || 'Error').slice(0, 80), message: String(error.message || 'Unknown runtime error').slice(0, 2000), stack: String(error.stack || '').slice(0, 4000), filename: String(error.filename || '').slice(0, 240), line: Number.isFinite(error.line) ? error.line : 0, column: Number.isFinite(error.column) ? error.column : 0 };
          this._showErrorPanel('⚠️ 工件运行异常：' + this.lastError.name + ' - ' + this.lastError.message);
          if (options.onError) options.onError(this.lastError);
        }
        else if (d.type === 'resize') {
          if (!options.fitViewport && d.data && d.data.h && d.data.h > 40 && d.data.h < 2000) iframe.style.minHeight = Math.ceil(d.data.h + 16) + 'px';
        }
        else if (d.type === 'done' && this.state !== 'error') { this.state = 'done'; if (options.onDone) options.onDone(d.data); }
        else if (d.type === 'layout') {
          const layout = d.data;
          if (layout && Number.isFinite(layout.scale) && layout.scale >= .5 && layout.scale <= 1 && Number.isFinite(layout.w) && Number.isFinite(layout.h) && layout.w > 0 && layout.h > 0 && layout.w <= 100000 && layout.h <= 100000 && typeof layout.overflow === 'boolean') {
            this.layout = { scale: layout.scale, w: layout.w, h: layout.h, overflow: layout.overflow };
            if (options.onLayout) options.onLayout(this.layout);
          }
        }
      };
      window.addEventListener('message', this._messageHandler);

      // 看门狗（W2）：WATCHDOG_MS 内未 ready → 移除 + 错误面板
      const watchdogDuration = options.watchdogMs || options.timeoutMs || WATCHDOG_MS;
      this._watchdogTimer = setTimeout(() => {
        if (this.state === 'loading') {
          this._clearWatchdog();
          if (this._messageHandler) {
            window.removeEventListener('message', this._messageHandler);
            this._messageHandler = null;
          }
          for (const pending of this._sceneRequests?.values() || []) pending.finish({ ok: false, code: 'WATCHDOG_TIMEOUT' });
          this._sceneRequests?.clear();
          this._showErrorPanel('⏱ 工件执行超时（' + watchdogDuration + 'ms 无 ready 心跳）——看门狗已终止（防死循环）');
          if (this.iframe) { this.iframe.remove(); this.iframe = null; }
          
          this.state = 'error';
          this.lastError = { name: 'TimeoutError', message: 'WATCHDOG_TIMEOUT' };
          if (options.onError) options.onError({ message: 'WATCHDOG_TIMEOUT' });
        }
      }, watchdogDuration);
    }

    _clearWatchdog() { if (this._watchdogTimer) { clearTimeout(this._watchdogTimer); this._watchdogTimer = null; } }

    setPreviewScale(scale) {
      if (scale !== 'fit' && (typeof scale !== 'number' || !Number.isFinite(scale) || scale < .5 || scale > 1)) throw new RangeError('ARTIFACT_SCALE_INVALID');
      this._previewScale = scale;
      if (this.iframe?.contentWindow) this.iframe.contentWindow.postMessage({ channel: CHANNEL, v: 1, type: 'presentation', scale }, '*');
    }

    waitForStartup({ signal, timeoutMs = 6000, settleMs = 150 } = {}) {
      return new Promise(resolve => {
        const started = Date.now(); let readyAt = null, timer = null;
        const finish = result => { if (timer) clearTimeout(timer); if (signal) signal.removeEventListener('abort', cancelled); resolve(result); };
        const cancelled = () => finish({ ok: false, code: 'USER_ABORTED', previewVerified: false });
        const check = () => {
          if (signal?.aborted || this.state === 'aborted') return cancelled();
          if (this.state === 'error') return finish({ ok: false, code: 'ARTIFACT_RUNTIME_ERROR', runtimeError: this.lastError, previewVerified: false });
          if (!this.iframe) return finish({ ok: false, code: 'PREVIEW_DISPOSED', previewVerified: false });
          if (this.state === 'done' || this.state === 'ready') {
            if (readyAt === null) readyAt = Date.now();
            if (Date.now() - readyAt >= settleMs) return finish({ ok: true, code: 'STARTUP_READY', previewVerified: true, scope: 'startup-only' });
          }
          if (Date.now() - started >= timeoutMs) return finish({ ok: false, code: 'ARTIFACT_STARTUP_TIMEOUT', previewVerified: false });
          timer = setTimeout(check, 25);
        };
        if (signal) signal.addEventListener('abort', cancelled, { once: true });
        check();
      });
    }

    _showErrorPanel(msg) {
      if (this._errorPanel) { this._errorPanel.remove(); this._errorPanel = null; }
      const el = document.createElement('div');
      el.className = 'sandboxed-artifact-error';
      el.textContent = msg;
      this.container.appendChild(el);
      this._errorPanel = el;
    }

    _teardown(clearKind = true) {
      for(const pending of this._sceneRequests?.values()||[])pending.finish({ok:false,code:'PREVIEW_DISPOSED'});
      this._sceneRequests?.clear();
      this.layout = null;
      this.lastError = null;
      if (this._abortSignal && this._abortHandler) this._abortSignal.removeEventListener('abort', this._abortHandler);
      this._abortSignal = null; this._abortHandler = null;
      this._clearWatchdog();
      if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
      if (this._messageHandler) { window.removeEventListener('message', this._messageHandler); this._messageHandler = null; }
      if (this.iframe) { this.iframe.remove(); this.iframe = null; }
      if (this._errorPanel) { this._errorPanel.remove(); this._errorPanel = null; }
      if (clearKind) this._kind = null;
      this.state = 'idle';
    }

    destroy() { this._teardown(); }

    getStatus() { return { state: this.state, hasIframe: !!this.iframe, versionId: this._lastVersion, runtimeError: this.lastError || null }; }
  }

  // 探针源码（测试用：工件内尝试读宿主敏感面）
  SandboxedArtifactRuntime.PROBE_HTML = `<!DOCTYPE html><html><head></head><body>
<script>
var results = {};
try { results.localStorage = typeof localStorage !== 'undefined' ? 'ACCESSIBLE' : 'undefined'; } catch(e) { results.localStorage = 'THROWN:' + e.message; }
try { results.parentSecret = typeof parent.__wenjuSecret !== 'undefined' ? String(parent.__wenjuSecret) : 'undefined'; } catch(e) { results.parentSecret = 'THROWN:' + e.message; }
try { results.cookie = document.cookie || 'empty'; } catch(e) { results.cookie = 'THROWN:' + e.message; }
document.title = JSON.stringify(results);
parent.postMessage({ channel: '${CHANNEL}', v: 1, type: 'done', data: { probe: results } }, '*');
</script></body></html>`;

  // 死循环源码（测试用：看门狗计时）
  SandboxedArtifactRuntime.INFINITE_LOOP_HTML = `<!DOCTYPE html><html><head></head><body>
<script>while(true) { }</script></body></html>`;

  return { SandboxedArtifactRuntime, buildSrcdoc, CHANNEL, WATCHDOG_MS, DEBOUNCE_MS };
});
