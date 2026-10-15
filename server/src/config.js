/**
 * 宿主配置装载（P7-H5：密钥仅存 config.yaml，gitignore 生效）
 *
 * 支持的最小 YAML 子集（够用且可判定，避免引入解析依赖）：
 *   - 注释（# 起）与空行
 *   - 缩进嵌套映射（2 空格一层）
 *   - 标量：字符串（可带引号）/数字/布尔
 *   - 行内数组：[a, b, c]
 * 纪律：文件存在但行格式非法 → 显式 CONFIG_INVALID（不静默忽略，避免密钥字段被静默丢弃）。
 *       文件不存在 → 返回 {}（调用方回退环境变量，保持既有部署兼容）。
 */
const fs = require('fs');
const path = require('path');

class ConfigError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}

function parseScalar(raw) {
  const text = String(raw).trim();
  if (text === '') return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null' || text === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((x) => parseScalar(x));
  }
  return text;
}

function parseYaml(text, { file = '(inline)' } = {}) {
  const root = {};
  const stack = [{ indent: -1, node: root }];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const stripped = line.replace(/#.*$/, '');
    if (!stripped.trim()) continue;
    const indent = stripped.match(/^ */)[0].length;
    const body = stripped.trim();
    const colon = body.indexOf(':');
    if (colon <= 0) throw new ConfigError('CONFIG_INVALID', `${file}:${i + 1} 非法行（缺少 key:）: ${body}`);
    const key = body.slice(0, colon).trim();
    const rest = body.slice(colon + 1).trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    if (rest === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      parent[key] = parseScalar(rest);
    }
  }
  return root;
}

function loadConfig(options = {}) {
  const file = options.file;
  if (!file) throw new ConfigError('CONFIG_PATH_REQUIRED', 'config file path is required');
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) return { config: {}, file: resolved, found: false };
  const text = fs.readFileSync(resolved, 'utf8');
  return { config: parseYaml(text, { file: resolved }), file: resolved, found: true };
}

/** 把配置合并进宿主启动选项（配置 < 显式 options < 环境变量） */
function applyConfig(options = {}, config = {}) {
  const out = { ...options };
  if (config.server) {
    if (out.port === undefined && config.server.port !== undefined) out.port = Number(config.server.port);
    if (out.workspaceRoot === undefined && config.server.workspace_root) out.workspaceRoot = String(config.server.workspace_root);
    if (out.storageFile === undefined && config.server.storage_file) out.storageFile = String(config.server.storage_file);
    if (out.eventFile === undefined && config.server.event_file) out.eventFile = String(config.server.event_file);
    if (out.allowedOrigins === undefined && Array.isArray(config.server.allowed_origins)) out.allowedOrigins = config.server.allowed_origins.map(String);
  }
  if (config.policy && out.policy === undefined) {
    out.policy = {
      mode: config.policy.mode ? String(config.policy.mode) : 'full',
      allow: Array.isArray(config.policy.allow) ? config.policy.allow.map(String) : undefined,
      deny: Array.isArray(config.policy.deny) ? config.policy.deny : undefined,
      requireConfirm: Array.isArray(config.policy.require_confirm) ? config.policy.require_confirm : undefined
    };
  }
  if (config.providers && out.providers === undefined) {
    const providers = {};
    for (const [name, def] of Object.entries(config.providers)) {
      if (!def || typeof def !== 'object') continue;
      providers[name] = {
        baseUrl: def.base_url ? String(def.base_url) : undefined,
        apiKey: def.api_key ? String(def.api_key) : undefined,
        keyEnv: def.key_env ? String(def.key_env) : undefined
      };
    }
    out.providers = providers;
  }
  return out;
}

module.exports = { loadConfig, parseYaml, applyConfig, ConfigError };
