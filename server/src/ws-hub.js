/**
 * WsHub —— 宿主事件通道（P7-H3，零依赖 RFC6455 实现）
 *
 * 语义：浏览器以 `ws://127.0.0.1:<port>/events?token=<token>` 连接（浏览器无法在 WebSocket 上设请求头，
 *       故令牌经查询参数传递；非浏览器客户端亦可用 Authorization 头）。握手前执行 Origin 白名单与令牌校验，
 *       拒绝时返回 HTTP 401（不升级）。连接建立后，事件写入（审计/文件/存储）经广播以文本帧 JSON 下发。
 *
 * 帧支持：文本(0x1)/关闭(0x8)/Ping(0x9)/Pong(0xA)；长度 7 位/16 位/64 位；客户端帧必须掩码（否则 1002 关闭）。
 * 纪律：单个连接异常不拖垮宿主（帧解析错误只关闭该连接）；广播不阻塞（socket 拥塞时丢弃并计数）。
 */
const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(secWebSocketKey) {
  return crypto.createHash('sha1').update(String(secWebSocketKey) + WS_GUID).digest('base64');
}

/** 服务端→客户端帧（不掩码） */
function encodeFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f); // FIN + opcode
  return Buffer.concat([header, data]);
}

/** 客户端→服务端帧（必须掩码；用于测试与简单客户端） */
function encodeMaskedFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const mask = crypto.randomBytes(4);
  const len = data.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
  else if (len < 65536) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
  header[0] = 0x80 | (opcode & 0x0f);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 1) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/**
 * 增量帧解析器：返回 { frames, rest }；帧 = { opcode, payload(Buffer), fin }。
 * @param {object} [options] - { requireMask }：服务端解析客户端帧时必须要求掩码（RFC6455 §5.1）；
 *   客户端解析服务端下行帧不需要（服务端帧按规范不掩码）。
 */
function parseFrames(buffer, options = {}) {
  const requireMask = options.requireMask === true;
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let headerLen = 2;
    if (len === 126) {
      if (offset + 4 > buffer.length) break;
      len = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (len === 127) {
      if (offset + 10 > buffer.length) break;
      const big = buffer.readBigUInt64BE(offset + 2);
      if (big > 8n * 1024n * 1024n) { frames.push({ error: 'FRAME_TOO_LARGE' }); return { frames, rest: Buffer.alloc(0) }; }
      len = Number(big);
      headerLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (offset + headerLen + maskLen + len > buffer.length) break;
    let payload = buffer.subarray(offset + headerLen + maskLen, offset + headerLen + maskLen + len);
    if (masked) {
      const mask = buffer.subarray(offset + headerLen, offset + headerLen + 4);
      const unmasked = Buffer.alloc(len);
      for (let i = 0; i < len; i += 1) unmasked[i] = payload[i] ^ mask[i % 4];
      payload = unmasked;
    }
    if (requireMask && !masked) { frames.push({ error: 'UNMASKED_CLIENT_FRAME' }); return { frames, rest: Buffer.alloc(0) }; }
    frames.push({ fin, opcode, payload });
    offset += headerLen + maskLen + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

class WsHub {
  constructor(options = {}) {
    this.auth = options.auth || null;                 // { token, allowedOrigins }（复用 HTTP 鉴权会话）
    this.path = options.path || '/events';
    this.maxClients = options.maxClients || 16;
    this.heartbeatMs = options.heartbeatMs === undefined ? 30000 : options.heartbeatMs;
    this.clients = new Set();
    this.dropped = 0;
    this._heartbeat = null;
  }

  _reject(socket, status, code, message) {
    const body = JSON.stringify({ ok: false, code, message });
    socket.write(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Bad Request'}\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
    socket.destroy();
  }

  /** 校验握手（Origin 白名单 + 令牌），通过则升级连接 */
  handleUpgrade(req, socket) {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== this.path) return this._reject(socket, 400, 'WS_PATH_INVALID', 'unknown websocket path');
    const origin = req.headers.origin;
    if (this.auth) {
      if (origin && !this.auth.allowedOrigins.has(origin)) return this._reject(socket, 401, 'ORIGIN_FORBIDDEN', 'origin is not allowed');
      const tokenParam = url.searchParams.get('token') || '';
      const header = req.headers.authorization || '';
      const provided = tokenParam || (header.startsWith('Bearer ') ? header.slice(7) : '');
      if (provided !== this.auth.token) return this._reject(socket, 401, 'UNAUTHORIZED', 'missing or invalid token');
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) return this._reject(socket, 400, 'WS_KEY_MISSING', 'missing Sec-WebSocket-Key');
    if (this.clients.size >= this.maxClients) return this._reject(socket, 400, 'WS_TOO_MANY_CLIENTS', 'client limit reached');

    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      '\r\n'
    ].join('\r\n'));

    const client = { socket, buffer: Buffer.alloc(0), alive: true, closed: false };
    this.clients.add(client);
    const close = (code = 1000) => {
      if (client.closed) return;
      client.closed = true;
      const codeBuf = Buffer.from([(code >> 8) & 0xff, code & 0xff]);
      try { socket.write(encodeFrame(codeBuf, 0x8)); } catch (e) { /* 对端已断 */ }
      try { socket.end(); } catch (e) { /* 已结束 */ }
      this.clients.delete(client);
    };
    socket.on('data', (chunk) => {
      client.buffer = Buffer.concat([client.buffer, chunk]);
      const { frames, rest } = parseFrames(client.buffer, { requireMask: true });
      client.buffer = rest;
      for (const frame of frames) {
        if (frame.error) { close(1002); return; }
        if (frame.opcode === 0x8) { close(1000); return; }
        if (frame.opcode === 0x9) { try { socket.write(encodeFrame(frame.payload, 0xA)); } catch (e) { /* 忽略 */ } continue; }
        if (frame.opcode === 0xA) { client.alive = true; continue; }
        // 文本帧：本通道为服务端单向事件流，客户端消息仅记录计数（不解析业务指令）
        client.lastMessageAt = Date.now();
      }
    });
    socket.on('error', () => close(1000));
    socket.on('close', () => { client.closed = true; this.clients.delete(client); });
    return client;
  }

  attach(server) {
    server.on('upgrade', (req, socket) => this.handleUpgrade(req, socket));
    if (this.heartbeatMs > 0) {
      this._heartbeat = setInterval(() => {
        for (const client of Array.from(this.clients)) {
          if (client.socket.writableLength > 1024 * 1024) { this.dropped += 1; continue; } // 拥塞丢弃计数（不阻塞广播）
          try { client.socket.write(encodeFrame(Buffer.alloc(0), 0x9)); } catch (e) { /* 连接已断 */ }
        }
      }, this.heartbeatMs);
      if (this._heartbeat.unref) this._heartbeat.unref();
    }
    return this;
  }

  /** 广播事件（文本帧 JSON）；返回投递连接数 */
  broadcast(event) {
    const frame = encodeFrame(JSON.stringify(event));
    let delivered = 0;
    for (const client of Array.from(this.clients)) {
      if (client.closed) continue;
      if (client.socket.writableLength > 1024 * 1024) { this.dropped += 1; continue; }
      try { client.socket.write(frame); delivered += 1; } catch (e) { this.dropped += 1; }
    }
    return delivered;
  }

  close() {
    if (this._heartbeat) clearInterval(this._heartbeat);
    for (const client of Array.from(this.clients)) {
      try { client.socket.destroy(); } catch (e) { /* 已断 */ }
    }
    this.clients.clear();
  }
}

module.exports = { WsHub, encodeFrame, encodeMaskedFrame, parseFrames, acceptKey };
