const http = require('http');
const { once } = require('events');
const os = require('os');
const path = require('path');
const { FileService, FileServiceError } = require('./file-service.js');
const { EventStore } = require('./event-store.js');
const { createAuthSession } = require('./auth.js');
const { ModelProxy, ModelProxyError } = require('./model-proxy.js');
const { SqliteKvStore, StorageServiceError } = require('./storage-service.js');
const { WsHub } = require('./ws-hub.js');
const { PolicyChain } = require('./policy-chain.js');
const { RenderJobs } = require('./render-jobs.js');
const { loadConfig, applyConfig } = require('./config.js');

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}
function readBody(req, maxBytes) {
  const hardCap = maxBytes * 8; // 排空上限：超过后断连（防无界上传）
  return new Promise((resolve, reject) => {
    let data = ''; let size = 0; let settled = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk, 'utf8');
      if (size > hardCap) {
        if (!settled) { settled = true; const error = new Error('request body exceeds hard cap'); error.code = 'PAYLOAD_TOO_LARGE'; reject(error); }
        req.destroy();
        return;
      }
      if (size > maxBytes) {
        if (!settled) { settled = true; const error = new Error('request body exceeds quota'); error.code = 'PAYLOAD_TOO_LARGE'; reject(error); }
        return; // 审计修复：超配额后继续排空（丢弃数据）直到 end，保证客户端收到 413 而非连接错误
      }
      data += chunk;
    });
    req.on('end', () => { if (!settled) { settled = true; try {
      const parsed = data ? JSON.parse(data) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { const error = new Error('request body must be a JSON object'); error.code = 'INVALID_PARAMS'; throw error; }
      resolve(parsed);
    } catch (error) { error.code ||= 'INVALID_JSON'; reject(error); } } });
    req.on('error', (error) => { if (!settled) { settled = true; reject(error); } });
  });
}

function createApp(options = {}) {
  const workspaceRoot = options.workspaceRoot || process.env.TEACHAGENT_WORKSPACE_ROOT || path.join(os.tmpdir(), 'teachagent-workspace');
  const eventStore = options.eventStore || new EventStore({ file: options.eventFile });
  const auth = options.auth || createAuthSession({ allowedOrigins: options.allowedOrigins, token: options.token || process.env.TEACHAGENT_TOKEN, confirmToken: options.confirmToken || process.env.TEACHAGENT_CONFIRM_TOKEN });
  const modelProxy = options.modelProxy || new ModelProxy({ fetch: options.fetch });
  // P7-H1：会话 SQLite 存储（node:sqlite；TEACHAGENT_STORAGE_FILE 覆盖路径）
  const kvStore = options.kvStore || new SqliteKvStore({ file: options.storageFile || process.env.TEACHAGENT_STORAGE_FILE || path.join(process.cwd(), 'data', 'wenju.sqlite') });
  // P7-H4：六层权限链（默认全量模式 + 允许清单；readonly 经配置或运行时切换）
  const policy = options.policyChain || new PolicyChain(options.policy || {});
  const renderJobs=options.renderJobs||new RenderJobs({root:options.renderRoot||path.join(path.dirname(options.storageFile||path.join(process.cwd(),'data/wenju.sqlite')),'render-jobs')});
  const fileService = options.fileService || new FileService({ root: workspaceRoot, limits: options.limits, audit: (event) => eventStore.append({ scope: 'workspace', ...event }).catch((error) => process.stderr.write(JSON.stringify({ event: 'audit_append_failed', code: error.code, message: error.message }) + '\n')) });
  let initialized = false;
  const ensureInit = async () => { if (!initialized) { await fileService.initialize(); initialized = true; } };
  /** P7-H4：策略求值 + ask 确认头校验；返回 null 表示放行，否则返回 {status, payload} */
  const policyGate = (req, action, resourcePath) => {
    const confirmed = !!auth.confirmToken && req.headers['x-wenju-confirm'] === auth.confirmToken;
    const verdict = policy.evaluate({ action, path: resourcePath, headers: req.headers, confirmed });
    if (verdict.decision === 'allow') return null;
    if (verdict.decision === 'ask') {
      return { status: 428, payload: { ok: false, code: 'CONFIRMATION_REQUIRED', message: verdict.reason, details: { stage: verdict.stage, header: 'x-wenju-confirm' } } };
    }
    return { status: 403, payload: { ok: false, code: 'POLICY_DENIED', message: verdict.reason, details: { stage: verdict.stage, action } } };
  };
  const handler = async (req, res) => {
    const origin = req.headers.origin;
    if (origin && auth.allowedOrigins.has(origin)) res.setHeader('access-control-allow-origin', origin);
    res.setHeader('access-control-allow-headers', 'authorization,content-type,x-wenju-confirm');
    res.setHeader('vary', 'Origin');
    res.setHeader('access-control-allow-methods', 'GET,PUT,DELETE,POST,OPTIONS');
    if (req.method === 'OPTIONS') { if (origin && !auth.allowedOrigins.has(origin)) return json(res,403,{ok:false,code:'ORIGIN_FORBIDDEN',message:'origin is not allowed'}); res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === '/health' && req.method === 'GET') return json(res, 200, { ok: true, service: 'teachagent-local' });
      auth.authorize(req);
      if(url.pathname==='/v1/render/capabilities'&&req.method==='GET'){const gate=policyGate(req,'render:read',null);if(gate)return json(res,gate.status,gate.payload);return json(res,200,{ok:true,...renderJobs.capabilities()});}
      if(url.pathname==='/v1/render/jobs'&&req.method==='POST'){
        const gate=policyGate(req,'render:write',null);if(gate)return json(res,gate.status,gate.payload);
        const body=await readBody(req,16384);return json(res,202,{ok:true,job:renderJobs.create(body.spec,body.sessionId,body.operationId)});
      }
      if(url.pathname.startsWith('/v1/render/jobs/')){
        const parts=url.pathname.split('/').filter(Boolean),id=parts[3],sessionId=url.searchParams.get('sessionId');
        const gate=policyGate(req,req.method==='DELETE'?'render:write':'render:read',id);if(gate)return json(res,gate.status,gate.payload);
        if(req.method==='DELETE'&&parts.length===4)return json(res,200,{ok:true,job:renderJobs.cancel(id,sessionId)});
        if(req.method==='GET'&&parts.length===4)return json(res,200,{ok:true,job:renderJobs.public(renderJobs.get(id,sessionId))});
        if(req.method==='GET'&&parts.length===5&&parts[4]==='result'){const result=renderJobs.result(id,sessionId),stream=require('fs').createReadStream(result.file);stream.on('error',error=>{process.stderr.write(JSON.stringify({event:'render_result_read_failed',jobId:id,code:error.code,message:error.message})+'\n');res.destroy(error);});res.writeHead(200,{'content-type':'video/mp4','content-length':result.bytes,'cache-control':'no-store'});return stream.pipe(res);}
        return json(res,400,{ok:false,code:'RENDER_ROUTE_INVALID'});
      }
      if (url.pathname === '/v1/capabilities' && req.method === 'GET') {
        let workspace;
        try { await ensureInit(); workspace={available:true,root:fileService.root,limits:fileService.limits}; }
        catch(error){workspace={available:false,code:error.code||'WORKSPACE_UNAVAILABLE',message:error.message};}
        return json(res,200,{ok:true,service:'teachagent-local',version:1,workspace,storage:{available:true,backend:'sqlite'},policy:{mode:policy.getMode()},model:{available:true,providers:Object.entries(modelProxy.providers||{}).map(([id,config])=>({id,configured:!!(config.apiKey||(config.keyEnv&&process.env[config.keyEnv]))}))}});
      }
      if (url.pathname === '/v1/model/chat/completions' && req.method === 'POST') {
        const denied=policyGate(req,'model:chat',null);
        if(denied)return json(res,denied.status,denied.payload);
        const body = await readBody(req, modelProxy.maxBodyBytes);
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close',disconnected);
        const timeout = setTimeout(()=>controller.abort(new Error('MODEL_REQUEST_TIMEOUT')),options.modelTimeoutMs||180000);
        try {
          if (req.aborted || res.destroyed) { controller.abort(); return; }
          const result = await modelProxy.forward(body,{signal:controller.signal});
          const upstream = result.response;
          res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store', 'x-accel-buffering':'no' });
          if (!upstream.body) return res.end();
          for await (const chunk of upstream.body) {
            if (controller.signal.aborted || res.destroyed) break;
            if (!res.write(chunk)) await once(res,'drain',{signal:controller.signal});
          }
          if (!res.destroyed) res.end();
          return;
        } catch (error) {
          if (res.destroyed) return;
          if (controller.signal.aborted) { if (res.headersSent) res.destroy(); else json(res,504,{ok:false,code:'MODEL_REQUEST_TIMEOUT',message:'model request timed out'}); return; }
          throw error;
        } finally { clearTimeout(timeout); res.removeListener('close',disconnected); }
      }
      await ensureInit();
      // P7-H4：策略查询与模式切换（切换需二次确认）
      if (url.pathname === '/v1/policy' && req.method === 'GET') {
        return json(res, 200, { ok: true, mode: policy.getMode(), actions: policy.policy.allow, deny: policy.policy.deny.length, requireConfirm: policy.policy.requireConfirm.length });
      }
      if (url.pathname === '/v1/policy/mode' && req.method === 'PUT') {
        const gate = policyGate(req, 'policy:manage', 'policy/mode');
        if (gate) return json(res, gate.status, gate.payload);
        const body = await readBody(req, 4096);
        try {
          const out = policy.setMode(String(body.mode || ''));
          eventStore.append({ scope: 'policy', type: 'policy_mode_changed', mode: out.mode }).catch(error => process.stderr.write(JSON.stringify({ event: 'audit_append_failed', scope: 'policy', code: error.code, message: error.message }) + '\n'));
          return json(res, 200, { ok: true, mode: out.mode });
        } catch (error) {
          return json(res, 400, { ok: false, code: 'POLICY_MODE_INVALID', message: error.message });
        }
      }
      // P7-H1：会话 SQLite 存储路由（namespace/key 两段式；值以字符串无损往返）
      {
        const segs = url.pathname.split('/').filter(Boolean);
        if (segs[0] === 'v1' && segs[1] === 'storage' && segs.length <= 4) {
          const ns = segs.length >= 3 ? decodeURIComponent(segs[2]) : null;
          const key = segs.length >= 4 ? decodeURIComponent(segs[3]) : null;
          if (req.method === 'GET' && ns) { const gate = policyGate(req, 'storage:read', key ? `${ns}/${key}` : ns); if (gate) return json(res, gate.status, gate.payload); }
          if (req.method === 'GET' && ns && !key) return json(res, 200, { ok: true, namespace: ns, keys: kvStore.keys(ns) });
          if (req.method === 'GET' && ns && key) {
            const hit = kvStore.get(ns, key);
            if (!hit) return json(res, 404, { ok: false, code: 'STORAGE_MISS', message: `no value for ${ns}/${key}` });
            return json(res, 200, { ok: true, namespace: ns, key, value: hit.value, savedAt: hit.savedAt });
          }
          if (req.method === 'PUT' && ns && key) {
            const gate = policyGate(req, 'storage:write', `${ns}/${key}`);
            if (gate) return json(res, gate.status, gate.payload);
            const body = await readBody(req, kvStore.maxValueBytes + 4096);
            if (!Object.prototype.hasOwnProperty.call(body, 'value')) return json(res, 400, { ok: false, code: 'STORAGE_KEY_INVALID', message: 'body.value is required' });
            const written = kvStore.set(ns, key, body.value);
            eventStore.append({ scope: 'storage', type: 'storage_written', namespace: ns, key, bytes: Buffer.byteLength(JSON.stringify(body.value), 'utf8') }).catch(() => {});
            return json(res, 200, { ok: true, ...written });
          }
          if (req.method === 'DELETE' && ns && key) {
            const gate = policyGate(req, 'storage:write', `${ns}/${key}`);
            if (gate) return json(res, gate.status, gate.payload);
            const removed = kvStore.remove(ns, key);
            if (removed.removed) eventStore.append({ scope: 'storage', type: 'storage_removed', namespace: ns, key }).catch(() => {});
            return json(res, 200, { ok: true, ...removed });
          }
          return json(res, 400, { ok: false, code: 'STORAGE_KEY_INVALID', message: 'unsupported storage route or method' });
        }
      }
      if (url.pathname === '/v1/workspace' && req.method === 'GET') {
        const gate = policyGate(req, 'file:list', null); if (gate) return json(res, gate.status, gate.payload);
        return json(res, 200, await fileService.list());
      }
      if (url.pathname === '/v1/file' && req.method === 'GET') {
        const target = url.searchParams.get('path') || '', gate = policyGate(req, 'file:read', target); if (gate) return json(res, gate.status, gate.payload);
        return json(res, 200, await fileService.read(target));
      }
      if (url.pathname === '/v1/file' && req.method === 'PUT') {
        const body = await readBody(req, fileService.limits.fileMaxBytes + 1024);
        const gate = policyGate(req, 'file:write', body.path);
        if (gate) return json(res, gate.status, gate.payload);
        return json(res, 200, await fileService.write(body.path, body.content));
      }
      if (url.pathname === '/v1/file' && req.method === 'DELETE') {
        const target = url.searchParams.get('path') || '';
        const gate = policyGate(req, 'file:delete', target);
        if (gate) return json(res, gate.status, gate.payload);
        return json(res, 200, await fileService.remove(target));
      }
      return json(res, 404, { ok: false, code: 'NOT_FOUND', message: 'route not found' });
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) {
        process.stderr.write(JSON.stringify({event:'stream_response_failed',code:error.code||'UPSTREAM_STREAM_ERROR',message:error.message})+'\n');
        res.destroy(); return;
      }
      const status = error.status || (error.code === 'UNAUTHORIZED' || error.code === 'ORIGIN_FORBIDDEN' ? 401
        : error.code === 'PAYLOAD_TOO_LARGE' || error.code === 'STORAGE_QUOTA_EXCEEDED' ? 413
        : error.code === 'FILE_NOT_FOUND' || error.code === 'PATH_NOT_FOUND' ? 404
        : error.code === 'PATH_FORBIDDEN' ? 403
        : error.code === 'INVALID_JSON' || error.code === 'INVALID_PARAMS' || (typeof error.code === 'string' && error.code.endsWith('_INVALID')) ? 400
        : error.code === 'CONFIRMATION_REQUIRED' ? 428
        : error.code === 'POLICY_DENIED' ? 403
        : 500);
      return json(res, status, { ok: false, code: error.code || 'INTERNAL_ERROR', message: error.message, details: error.details || {} });
    }
  };
  return { handler, auth, fileService, eventStore, modelProxy, kvStore, policy,renderJobs };
}

function start(options = {}) {
  // P7-H5：config.yaml（gitignore；密钥收敛处）→ 与显式 options / 环境变量合并
  const configFile = options.configFile || process.env.TEACHAGENT_CONFIG || path.join(__dirname, '..', 'config.yaml');
  const loaded = loadConfig({ file: configFile });
  const merged = applyConfig(options, loaded.config);
  const app = createApp(merged);
  const host = '127.0.0.1';
  const port = Number(merged.port ?? process.env.TEACHAGENT_PORT ?? 0);
  const server = http.createServer(app.handler);
  // P7-H3：WS 事件通道（/events?token=...）；事件写入经 eventStore.onAppend 广播
  const hub = new WsHub({ auth: app.auth, path: merged.wsPath || '/events', maxClients: merged.maxClients, heartbeatMs: merged.heartbeatMs });
  hub.attach(server);
  app.eventStore.onAppend = (record) => hub.broadcast(record);
  app.hub = hub;
  server.listen(port, host, () => {
    const address = server.address();
    process.stdout.write(JSON.stringify({ event: 'teachagent_local_server_started', host, port: address.port, token: app.auth.token, confirmToken: app.auth.confirmToken, ws: `ws://${host}:${address.port}${hub.path}` }) + '\n');
  });
  server.on('close', () => hub.close());
  return { server, app, hub };
}

if (require.main === module) start();
module.exports = { createApp, start };
