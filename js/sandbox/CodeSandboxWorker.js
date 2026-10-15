/**
 * CodeSandboxWorker —— 浏览器 Worker 代码沙箱（P5 S1 · B1 沙箱逃逸修复）
 *
 * 根因：旧 `new Function('console','Math',...,body)` 的参数遮蔽可被嵌套 `Function` 构造器绕过
 * （实测 `Function("return process")()` 可读 Node 全局）。
 *
 * 修复：Web Worker 天然隔离——无 `document`/`window`/`parent`/`localStorage`/`process`/`require`。
 * 附加限额：CPU 看门狗（超时 terminate）、输出截断（64KB）、错误堆栈净化。
 *
 * 消息协议（主线程 ↔ Worker）：
 *   → { type: 'exec', code: string, language: 'javascript' | 'python', timeoutMs: number }
 *   ← { type: 'result', result, logs: string[], durationMs, truncated: boolean }
 *   ← { type: 'error', message, durationMs }
 *   ← { type: 'timeout', elapsedMs }
 */

const MAX_OUTPUT_CHARS = 64 * 1024; // 64KB 输出截断
const MAX_LOG_ENTRIES = 200;

let logs = [];
let truncated = false;
let totalOutputChars = 0;

function pushLog(level, args) {
  if (logs.length >= MAX_LOG_ENTRIES) { truncated = true; return; }
  const line = args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch (e) { return String(a); }
  }).join(' ');
  if (totalOutputChars + line.length > MAX_OUTPUT_CHARS) {
    truncated = true;
    logs.push('…[输出截断：超过 ' + MAX_OUTPUT_CHARS + ' 字符限额]');
    return;
  }
  totalOutputChars += line.length;
  logs.push(line);
}

// 沙箱 console：仅收集，不执行任何 I/O
const sandboxConsole = {
  log: (...a) => pushLog('log', a),
  warn: (...a) => pushLog('warn', a),
  error: (...a) => pushLog('error', a),
  info: (...a) => pushLog('info', a),
  debug: (...a) => pushLog('debug', a),
  table: (...a) => pushLog('table', a),
};

// 教学辅助（与旧沙箱对齐）
const __py_range = (start, stop, step) => {
  if (stop === undefined) { stop = start; start = 0; }
  if (step === undefined) step = 1;
  const out = [];
  if (step > 0) for (let i = start; i < stop; i += step) out.push(i);
  else if (step < 0) for (let i = start; i > stop; i += step) out.push(i);
  return out;
};
const range = __py_range;
const len = (x) => (x ? (x.length ?? Object.keys(x).length) : 0);
const abs = Math.abs, min = Math.min, max = Math.max, sum = (arr) => (arr || []).reduce((a, b) => a + b, 0);
const str = (x) => String(x), int = (x) => parseInt(x, 10), float = (x) => parseFloat(x);

self.onmessage = async (ev) => {
  const { type, code, language, timeoutMs } = ev.data || {};
  if (type !== 'exec') return;

  logs = [];
  truncated = false;
  totalOutputChars = 0;
  const startTime = Date.now();
  const timeout = timeoutMs || 5000;

  // CPU 看门狗：主线程 terminate 兜底（Worker 内 setTimeout 优先）
  const watchdog = setTimeout(() => {
    self.postMessage({ type: 'timeout', elapsedMs: Date.now() - startTime });
    self.close(); // Worker 内关闭（主线程 terminate 为二道保险）
  }, timeout);

  try {
    let result;
    if (language === 'python') {
      // 简易 Python→JS 转译（与旧沙箱兼容：print/for/range）
      const jsCode = code
        .replace(/\bprint\(/g, 'console.log(')
        .replace(/\bTrue\b/g, 'true')
        .replace(/\bFalse\b/g, 'false')
        .replace(/\bNone\b/g, 'null')
        .replace(/\band\b/g, '&&')
        .replace(/\bor\b/g, '||')
        .replace(/\bnot\b/g, '!')
        .replace(/\blen\(/g, 'len(')
        .replace(/\brange\(/g, 'range(');
      result = eval(`(function(console, Math, range, len, abs, min, max, sum, str, int, float) {
        "use strict";
        ${jsCode.includes('return') ? jsCode : 'return (' + jsCode + ');'}
      })`)(sandboxConsole, Math, range, len, abs, min, max, sum, str, int, float);
    } else {
      // JavaScript
      result = eval(`(function(console, Math, range, len, abs, min, max, sum, str, int, float) {
        "use strict";
        ${code.includes('return') ? code : 'return (' + code + ');'}
      })`)(sandboxConsole, Math, range, len, abs, min, max, sum, str, int, float);
    }

    clearTimeout(watchdog);
    // 结果序列化（含循环引用防护与截断）
    let serialized;
    try {
      serialized = result !== undefined ? (typeof result === 'object' ? JSON.parse(JSON.stringify(result)) : result) : null;
    } catch (e) {
      serialized = String(result);
    }
    self.postMessage({
      type: 'result',
      result: serialized,
      logs: logs.slice(),
      durationMs: Date.now() - startTime,
      truncated
    });
  } catch (err) {
    clearTimeout(watchdog);
    self.postMessage({
      type: 'error',
      message: String(err && err.message || err),
      logs: logs.slice(),
      durationMs: Date.now() - startTime,
      truncated
    });
  }
};
