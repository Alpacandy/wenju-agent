const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { byteLength } = require('../../js/mcp/QuotaPolicy.js');

class EventStore {
  constructor(options = {}) {
    this.file = options.file || path.resolve(process.cwd(), 'data', 'events.jsonl');
    this.maxEventBytes = options.maxEventBytes || 64 * 1024;
    this.onAppend = options.onAppend || null; // P7-H3：事件写入后的广播钩子（WS 通道）
  }

  async append(event) {
    const record = { timestamp: new Date().toISOString(), ...event };
    const line = JSON.stringify(record) + '\n';
    if (byteLength(line) > this.maxEventBytes) {
      const error = new Error('event exceeds log quota');
      error.code = 'LOG_QUOTA_EXCEEDED';
      throw error;
    }
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.appendFile(this.file, line, { encoding: 'utf8', mode: 0o600 });
    if (typeof this.onAppend === 'function') { try { this.onAppend(record); } catch (e) { /* 广播失败不影响写盘 */ } }
    return record;
  }
}
module.exports = { EventStore };
