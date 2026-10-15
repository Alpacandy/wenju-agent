/**
 * 问矩 · 工作区代码文件管理技能 (WorkspaceFileSkill v1.0)
 * 深度对标 ZCode / DeepSeek Harness 代码文件生成与工作台管理
 * 职责：赋予 Agent 在工作区创建、编辑、读取与枚举代码文件的能力，支持多语言脚本持久化
 */

(function () {
let BaseSkillFile;
let QuotaPolicyFile;
let LocalWorkspaceFile;
if (typeof require !== 'undefined') {
  try { BaseSkillFile = require('./BaseSkill.js').BaseSkill; } catch (error) {
    if (typeof console !== 'undefined' && console.debug) console.debug('[WorkspaceFileSkill] BaseSkill unavailable', { error: String(error && error.message || error) });
  }
  try { QuotaPolicyFile = require('../mcp/QuotaPolicy.js').QuotaPolicy; } catch (error) {
    if (typeof console !== 'undefined' && console.debug) console.debug('[WorkspaceFileSkill] QuotaPolicy unavailable', { error: String(error && error.message || error) });
  }
  try { LocalWorkspaceFile = require('./LocalWorkspace.js').LocalWorkspace; }
  catch (error) { if (typeof console !== 'undefined' && console.error) console.error('[WorkspaceFileSkill] LocalWorkspace unavailable:', error.message); }
}
if (!BaseSkillFile && typeof window !== 'undefined') {
  BaseSkillFile = window.BaseSkill;
}
if (!BaseSkillFile) {
  BaseSkillFile = class { constructor(n, d) { this.name = n; this.description = d; } };
}
let HostFileClientFile;
if (typeof require !== 'undefined') {
  try { HostFileClientFile = require('./HostFileClient.js').getSharedHostFileClient(); }
  catch (error) { if (typeof console !== 'undefined' && console.debug) console.debug('[WorkspaceFileSkill] HostFileClient unavailable', { error: String(error && error.message || error) }); }
}
if (!HostFileClientFile && typeof window !== 'undefined' && window.getSharedHostFileClient) {
  try { HostFileClientFile = window.getSharedHostFileClient(); } catch (error) { HostFileClientFile = null; }
}
if (!QuotaPolicyFile && typeof window !== 'undefined') QuotaPolicyFile = window.QuotaPolicy;
if (!LocalWorkspaceFile && typeof window !== 'undefined') LocalWorkspaceFile = window.LocalWorkspace;

class WorkspaceFileSkill extends BaseSkillFile {
  constructor(options = {}) {
    super(
      'manage_workspace_file',
      '管理工作区文件：用户选择并授权本地目录后读写真实文件；未授权时使用浏览器虚拟文件。每次结果返回 mode，支持 write/read/list/delete。'
    );
    this.storageKey = 'wenju_workspace_files';
    this.quota = new (QuotaPolicyFile || class {
      assertFile() {}
      assertWorkspaceTotal() {}
      assertStorageEntry() {}
      path(value) { return value; }
      size(value) { return typeof value === 'string' ? value.length : JSON.stringify(value).length; }
    })();
    this.memoryFiles = new Map();
    this.localWorkspace = options.localWorkspace || (LocalWorkspaceFile ? new LocalWorkspaceFile(options.localOptions) : null);
    // P7-H9：宿主受控后端（真磁盘工作区）；未配置时 available()=false → 保持虚拟/本地模式零变化
    this.hostFileClient = options.hostFileClient || HostFileClientFile || null;
    this.listeners = new Set();
    this.localWorkspace?.subscribe((event) => this._notify({ type: 'audit', event }));
    this.initDefaultFiles();
  }

  getMode() {
    if (this.localWorkspace?.isAuthorized()) return 'local';
    if (this.hostFileClient && this.hostFileClient.available && this.hostFileClient.available()) return 'host';
    return 'virtual';
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch (error) { console.error('Workspace observer failed', error); }
    }
  }

  async authorizeLocal(options = {}) {
    if (!this.localWorkspace) throw new Error('LocalWorkspace module is not loaded');
    const result = await this.localWorkspace.authorize(options);
    this._notify({ type: 'mode', mode: this.getMode() });
    return result;
  }

  revokeLocal() {
    const result = this.localWorkspace?.revoke() || { ok: true, revoked: false };
    this._notify({ type: 'mode', mode: this.getMode() });
    return result;
  }

  initDefaultFiles() {
    // 默认内置参考脚本
    const defaultFiles = {
      'diamond.py': `def print_diamond(size=5):
    """绘制字符几何菱形"""
    for i in range(size):
        print(' ' * (size - i - 1) + '*' * (2 * i + 1))
    for i in range(size - 2, -1, -1):
        print(' ' * (size - i - 1) + '*' * (2 * i + 1))

print_diamond(5)
`,
      'linear_kernel.js': `// 矩阵零空间求解快速脚本
function solveKernel(a, b, c, d) {
  const det = a * d - b * c;
  console.log('行列式 det = ' + det);
  if (Math.abs(det) < 1e-4) {
    console.log('矩阵奇异降维，存在非平凡一维核空间 Null(A)');
    return [-b, a];
  }
  return [0, 0];
}
console.log('特征核向量: ', solveKernel(2, 1, 1, 0.5));
`
    };

    try {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(this.storageKey);
        if (!saved) {
        const serialized = JSON.stringify(defaultFiles);
        this.quota.assertStorageEntry(serialized);
        localStorage.setItem(this.storageKey, serialized);
          for (const [k, v] of Object.entries(defaultFiles)) this.memoryFiles.set(k, v);
        } else {
          const parsed = JSON.parse(saved);
          for (const [k, v] of Object.entries(parsed)) this.memoryFiles.set(k, v);
        }
      } else {
        for (const [k, v] of Object.entries(defaultFiles)) this.memoryFiles.set(k, v);
      }
    } catch (e) {
      for (const [k, v] of Object.entries(defaultFiles)) this.memoryFiles.set(k, v);
    }
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: false, // B 线契约 GATE-CONTRACT-01：本工具是否要求画布环境
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['authorize', 'revoke', 'write', 'read', 'list', 'delete'],
            description: '操作类型：authorize(选择本地目录), revoke(撤销授权), write(新建/保存文件), read(读取文件内容), list(枚举文件), delete(删除文件)'
          },
          filepath: {
            type: 'string',
            description: '相对文件路径，例如 "diamond.py" 或 "algorithms/matrix.js"'
          },
          content: {
            type: 'string',
            description: '待写入的代码文件文本内容 (action 为 write 时必填)'
          }
        },
        required: ['action']
      }
    };
  }

  _persist() {
    try {
      if (typeof localStorage !== 'undefined') {
        const obj = {};
        for (const [k, v] of this.memoryFiles.entries()) obj[k] = v;
        const serialized = JSON.stringify(obj);
        this.quota.assertStorageEntry(serialized);
        localStorage.setItem(this.storageKey, serialized);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, code: e.code || 'LOCAL_STORAGE_QUOTA_EXCEEDED', message: e.message, details: e.details || {} };
    }
  }

  async execute(args = {}, context = {}) {
    const mode = this.getMode();
    let result;
    try {
      context.throwIfCancelled?.();
      if (context.signal?.aborted) throw Object.assign(new Error('文件请求已取消'), { code: 'ABORTED' });
      if (args.action === 'authorize') {
        const authorized = await this.authorizeLocal(args);
        result = { status: 'success', action: 'authorize', ...authorized };
      } else if (args.action === 'revoke') {
        result = { status: 'success', action: 'revoke', ...this.revokeLocal() };
      } else if (mode === 'local') {
        if (args.action === 'write') {
          if (typeof args.content !== 'string') throw Object.assign(new TypeError('content must be a string'), { code: 'INVALID_PARAMS' });
          this.quota.assertFile(args.content);
        }
        result = await this.localWorkspace.execute(args);
        if (result.path) result.filepath = result.path;
      } else if (mode === 'host') {
        if (args.action === 'write') {
          if (typeof args.content !== 'string') throw Object.assign(new TypeError('content must be a string'), { code: 'INVALID_PARAMS' });
          this.quota.assertFile(args.content);
        }
        result = await this.hostFileClient.execute(args, context);
      } else result = await this._executeVirtual(args, context);
    } catch (error) {
      result = { status: 'error', code: error.code || 'WORKSPACE_OPERATION_FAILED', error: error.message };
    }
    result = { ...result, mode: this.getMode(), previousMode: mode };
    this._notify({ type: 'result', result });
    return result;
  }

  async _executeVirtual(args, context = {}) {
    const action = (args.action || 'list').toLowerCase();
    let filepath = (args.filepath || '').trim();
    const content = args.content ?? '';

    if (action === 'list') {
      const files = Array.from(this.memoryFiles.entries()).map(([path, text]) => ({
        path,
        size: text.length,
        lines: text.split(/\r?\n/).length,
        ext: path.split('.').pop() || 'txt'
      }));
      return {
        status: 'success',
        action: 'list',
        totalFiles: files.length,
        files
      };
    }

    if (action === 'write') {
      if (!filepath) {
        return { status: 'error', code: 'INVALID_PARAMS', error: '写入文件时 filepath 不能为空' };
      }
      try {
        filepath = this.quota.path(filepath);
        this.quota.assertFile(content);
        const existed = this.memoryFiles.has(filepath);
        const oldContent = this.memoryFiles.get(filepath) || '';
        const currentBytes = Array.from(this.memoryFiles.values()).reduce((sum, text) => sum + this.quota.size(text), 0);
        this.quota.assertWorkspaceTotal(currentBytes, this.quota.size(content), this.quota.size(oldContent));
        this.memoryFiles.set(filepath, content);
        const persisted = this._persist();
        if (!persisted.ok) {
          if (existed) this.memoryFiles.set(filepath, oldContent); else this.memoryFiles.delete(filepath);
          return { status: 'error', code: persisted.code, error: persisted.message, details: persisted.details };
        }
      } catch (e) {
        return { status: 'error', code: e.code || 'FILE_QUOTA_EXCEEDED', error: e.message, details: e.details || {} };
      }
      const lines = content.split(/\r?\n/).length;
      return {
        status: 'success',
        action: 'write',
        filepath,
        size: content.length,
        lines,
        summary: `已成功在工作区创建/更新文件: ${filepath} (${lines} 行, ${content.length} 字节)`
      };
    }

    if (action === 'read') {
      if (!filepath) {
        return { status: 'error', code: 'INVALID_PARAMS', error: '读取文件时 filepath 不能为空' };
      }
      try { filepath = this.quota.path(filepath); } catch (e) { return { status: 'error', code: e.code, error: e.message, details: e.details || {} }; }
      if (!this.memoryFiles.has(filepath)) {
        return {
          status: 'error',
          error: `工作区文件不存在: ${filepath}`,
          availableFiles: Array.from(this.memoryFiles.keys())
        };
      }
      const text = this.memoryFiles.get(filepath);
      return {
        status: 'success',
        action: 'read',
        filepath,
        content: text,
        size: text.length,
        lines: text.split(/\r?\n/).length
      };
    }

    if (action === 'delete') {
      if (!filepath) {
        return { status: 'error', code: 'INVALID_PARAMS', error: '删除文件时 filepath 不能为空' };
      }
      try { filepath = this.quota.path(filepath); } catch (e) { return { status: 'error', code: e.code, error: e.message, details: e.details || {} }; }
      const previous = this.memoryFiles.get(filepath);
      const existed = this.memoryFiles.delete(filepath);
      const persisted = this._persist();
      if (!persisted.ok) {
        if (existed) this.memoryFiles.set(filepath, previous);
        return { status: 'error', code: persisted.code, error: persisted.message, details: persisted.details };
      }
      return {
        status: 'success',
        action: 'delete',
        filepath,
        deleted: existed
      };
    }

    return { status: 'error', error: `未知的文件操作指令: ${action}` };
  }
}

if (typeof window !== 'undefined') {
  window.WorkspaceFileSkill = WorkspaceFileSkill;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WorkspaceFileSkill };
}
})();
