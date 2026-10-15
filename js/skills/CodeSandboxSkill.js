/**
 * 通用代码沙箱执行技能 (CodeSandboxSkill v2.0 - 多语言双核增强版)
 * 深度对标 ZCode 核心代码执行与 REPL 环境能力
 * 支持在隔离安全环境中自适应执行 Python 与 JavaScript 算法脚本，捕获标准输出、计算耗时与返回值
 */

let BaseSkillSandbox;
if (typeof require !== 'undefined') {
  try { BaseSkillSandbox = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('CodeSandboxSkill', 'if', e); }
}
if (!BaseSkillSandbox && typeof window !== 'undefined') {
  BaseSkillSandbox = window.BaseSkill;
}
if (!BaseSkillSandbox) {
  BaseSkillSandbox = class { constructor(n, d) { this.name = n; this.description = d; } };
}

class CodeSandboxSkill extends BaseSkillSandbox {
  constructor() {
    super(
      'execute_code_sandbox',
      '在安全沙箱环境中执行 Python 或 JavaScript 代码与算法逻辑（自适应语言识别），即时捕获终端输出 (stdout)、计算结果与执行耗时。'
    );
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: false, // B 线契约 GATE-CONTRACT-01：本工具是否要求画布环境
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: '待执行的 Python 或 JavaScript 代码脚本'
          },
          language: {
            type: 'string',
            enum: ['auto', 'python', 'javascript'],
            description: '编程语言类型：auto (自动检测识别), python, javascript。默认 auto',
            default: 'auto'
          },
          timeout_ms: {
            type: 'number',
            description: '最大执行超时时间(毫秒)，默认 3000ms',
            default: 3000
          }
        },
        required: ['code']
      }
    };
  }

  /**
   * 智能语言类型探测器
   */
  detectLanguage(code, explicitLang) {
    if (explicitLang && explicitLang !== 'auto') {
      return explicitLang.toLowerCase();
    }
    const clean = code.trim();
    // Python 特征模式探测
    const isPy = (
      /^\s*def\s+\w+\s*\(.*?\)\s*:/m.test(clean) ||
      /for\s+\w+\s+in\s+range\s*\(/m.test(clean) ||
      /^\s*while\s+.*?:/m.test(clean) ||
      /^\s*if\s+.*?:/m.test(clean) ||
      /^\s*elif\s+.*?:/m.test(clean) ||
      /^\s*(import|from)\s+\w+/m.test(clean) ||
      /print\s*\(.*?\)/m.test(clean) ||
      /['"][^'"]*['"]\s*\*\s*[\w\(\)]+/.test(clean) ||
      /^\s*pass\b/m.test(clean) ||
      /^\s*#.*$/m.test(clean)
    );
    // JavaScript 特征模式探测
    const isJs = /(const\s+|let\s+|var\s+|function\s+|console\.log|=>|===|!==)/.test(clean);

    if (isPy && !isJs) return 'python';
    if (isPy && isJs) {
      if (/^\s*def\s+\w+/m.test(clean)) return 'python';
    }
    return isPy ? 'python' : 'javascript';
  }

  /**
   * 轻量级 Micro-Python 转译器 (将标准 Python 基础语法转译为纯 JS AST 闭包执行)
   */
  transpilePythonToJS(pyCode) {
    const lines = pyCode.split(/\r?\n/);
    const outputLines = [];
    const indentStack = [0];

    // 工具函数：转译行内表达式（字符串乘法、f-strings、逻辑运算符、Python 内置值）
    const transpileExpr = (expr) => {
      let res = expr;
      // 1. f-string: f"Hello {name}" -> `Hello ${name}`
      res = res.replace(/f(["'])(.*?)\1/g, (match, quote, content) => {
        return '`' + content.replace(/\{([^}]+)\}/g, '${$1}') + '`';
      });

      // 2. 字符串乘法: ' ' * (expr) 或 '*' * n
      res = res.replace(/(['"])(.*?)\1\s*\*\s*(\([^\)]+\)|[a-zA-Z0-9_\.]+)/g, (match, q, str, count) => {
        return `__py_mul(${q}${str}${q}, ${count})`;
      });
      res = res.replace(/(\([^\)]+\)|[a-zA-Z0-9_\.]+)\s*\*\s*(['"])(.*?)\2/g, (match, count, q, str) => {
        return `__py_mul(${q}${str}${q}, ${count})`;
      });

      // 3. 关键字替换
      res = res.replace(/\bTrue\b/g, 'true');
      res = res.replace(/\bFalse\b/g, 'false');
      res = res.replace(/\bNone\b/g, 'null');
      res = res.replace(/\band\b/g, '&&');
      res = res.replace(/\bor\b/g, '||');
      res = res.replace(/\bnot\s+/g, '!');
      return res;
    };

    const declaredVars = new Set();

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const trimmed = line.trim();

      // 空行或全注释行
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // 计算当前行的缩进空格数
      const indentMatch = line.match(/^(\s*)/);
      const curIndent = indentMatch ? indentMatch[1].length : 0;

      // 缩进回退：插入对应的闭合大括号
      while (indentStack.length > 1 && curIndent < indentStack[indentStack.length - 1]) {
        indentStack.pop();
        outputLines.push('}');
      }

      let codePart = trimmed;
      // 剥离行尾单行注释
      if (codePart.includes('#') && !codePart.includes('\'') && !codePart.includes('"')) {
        codePart = codePart.split('#')[0].trim();
      }

      if (codePart === 'pass') {
        outputLines.push('/* pass */ ;');
        continue;
      }
      if (codePart === 'break') {
        outputLines.push('break;');
        continue;
      }
      if (codePart === 'continue') {
        outputLines.push('continue;');
        continue;
      }

      // 结构 1: def func_name(args):
      const defMatch = codePart.match(/^def\s+([a-zA-Z_]\w*)\s*\((.*?)\)\s*:$/);
      if (defMatch) {
        indentStack.push(curIndent + 4);
        outputLines.push(`function ${defMatch[1]}(${defMatch[2]}) {`);
        continue;
      }

      // 结构 2: for var in range(...):
      const forRangeMatch = codePart.match(/^for\s+([a-zA-Z_]\w*)\s+in\s+range\s*\((.*?)\)\s*:$/);
      if (forRangeMatch) {
        indentStack.push(curIndent + 4);
        const args = transpileExpr(forRangeMatch[2]);
        outputLines.push(`for (let ${forRangeMatch[1]} of __py_range(${args})) { if (++__loop_watchdog > 500000) throw new Error("代码执行超时 (迭代次数超过安全上限)");`);
        continue;
      }

      // 结构 3: for var in iterable:
      const forInMatch = codePart.match(/^for\s+([a-zA-Z_]\w*)\s+in\s+(.*?)\s*:$/);
      if (forInMatch) {
        indentStack.push(curIndent + 4);
        const iter = transpileExpr(forInMatch[2]);
        outputLines.push(`for (let ${forInMatch[1]} of (${iter})) { if (++__loop_watchdog > 500000) throw new Error("代码执行超时 (迭代次数超过安全上限)");`);
        continue;
      }

      // 结构 4: while cond:
      const whileMatch = codePart.match(/^while\s+(.*?)\s*:$/);
      if (whileMatch) {
        indentStack.push(curIndent + 4);
        const cond = transpileExpr(whileMatch[1]);
        outputLines.push(`while (${cond}) { if (++__loop_watchdog > 500000) throw new Error("代码执行超时 (迭代次数超过安全上限)");`);
        continue;
      }

      // 结构 5: if cond:
      const ifMatch = codePart.match(/^if\s+(.*?)\s*:$/);
      if (ifMatch) {
        indentStack.push(curIndent + 4);
        const cond = transpileExpr(ifMatch[1]);
        outputLines.push(`if (${cond}) {`);
        continue;
      }

      // 结构 6: elif cond:
      const elifMatch = codePart.match(/^elif\s+(.*?)\s*:$/);
      if (elifMatch) {
        // 先闭合前一个 if 块
        outputLines.push('}');
        indentStack.pop();
        indentStack.push(curIndent + 4);
        const cond = transpileExpr(elifMatch[1]);
        outputLines.push(`else if (${cond}) {`);
        continue;
      }

      // 结构 7: else:
      if (codePart === 'else:') {
        outputLines.push('}');
        indentStack.pop();
        indentStack.push(curIndent + 4);
        outputLines.push('else {');
        continue;
      }

      // 普通语句 (赋值、函数调用、print)
      let translated = transpileExpr(codePart);
      // 声明局部变量关键字自动补全 (使用 var 避免重复声明报错，并跟踪已声明变量)
      const assignMatch = translated.match(/^([a-zA-Z_]\w*)\s*=[^=]/);
      if (assignMatch) {
        const varName = assignMatch[1];
        if (!declaredVars.has(varName)) {
          declaredVars.add(varName);
          translated = `var ${translated}`;
        }
      }
      outputLines.push(translated + ';');
    }

    // 闭合所有剩余的缩进代码块
    while (indentStack.length > 1) {
      indentStack.pop();
      outputLines.push('}');
    }

    return outputLines.join('\n');
  }

  async execute(args, context = {}) {
    const startTime = Date.now();
    const rawCode = (args.code || '').trim();
    const timeoutMs = args.timeout_ms || 3000;
    const requestedLang = args.language || 'auto';

    if (!rawCode) {
      return { status: 'error', error: '执行代码不能为空', durationMs: 0 };
    }

    const language = this.detectLanguage(rawCode, requestedLang);

    // ── P5 S1：Worker 沙箱（替代 new Function 参数遮蔽——后者可被嵌套 Function 构造器绕过）──
    // Worker 天然无 document/window/localStorage/process/require；
    // 主线程 terminate 为 CPU 看门狗二道保险（Worker 内 setTimeout 优先）。
    // 审计修复：移除 require('fs')（浏览器无此 API，旧实现 Worker 路径在浏览器必抛 ReferenceError）
    // → 改为直接 URL 加载（HTTP 服务已托管 js/sandbox/CodeSandboxWorker.js）
    if (typeof Worker !== 'undefined' && typeof document !== 'undefined') {
      try {
        const worker = new Worker('js/sandbox/CodeSandboxWorker.js');

        const result = await new Promise((resolve, reject) => {
          const killer = setTimeout(() => {
            worker.terminate();
            reject(new Error(`代码执行超时 (${timeoutMs}ms)——Worker 已终止`));
          }, timeoutMs + 500); // 主线程兜底（Worker 内看门狗优先）

          worker.onmessage = (ev) => {
            clearTimeout(killer);
            worker.terminate();
            resolve(ev.data);
          };
          worker.onerror = (ev) => {
            clearTimeout(killer);
            worker.terminate();
            reject(new Error(ev.message || 'Worker 脚本错误'));
          };
          worker.postMessage({ type: 'exec', code: rawCode, language, timeoutMs });
        });

        const durationMs = Date.now() - startTime;
        if (result.type === 'result') {
          return {
            status: 'success',
            result: result.result,
            stdout: result.logs.join('\n'),
            durationMs,
            language,
            sandbox: 'worker',
            truncated: result.truncated || false
          };
        } else if (result.type === 'timeout') {
          return { status: 'error', error: `代码执行超时 (${result.elapsedMs}ms)`, stdout: result.logs.join('\n'), durationMs, language, sandbox: 'worker' };
        } else {
          return { status: 'error', error: result.message, stdout: result.logs.join('\n'), durationMs, language, sandbox: 'worker' };
        }
      } catch (workerErr) {
        // Worker 创建/执行失败 → 显式报错，不静默降级到旧 Function 沙箱
        return { status: 'error', error: 'Worker 沙箱不可用：' + workerErr.message, durationMs: Date.now() - startTime, language };
      }
    }

    // Node 测试环境（无 Worker）：受限 Function 路径（仅用于单测，不用于浏览器生产）
    const logs = [];
    const customConsole = {
      log: (...vals) => logs.push(vals.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')),
      warn: (...vals) => logs.push('[WARN] ' + vals.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' ')),
      error: (...vals) => logs.push('[ERROR] ' + vals.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(' '))
    };
    // Python → JS（复用类内既有转译器 + Micro-Python 运行时前置）
    let executableJS;
    if (language === 'python') {
      const transpiled = this.transpilePythonToJS(rawCode);
      executableJS = `
        function print(...args) {
          const out = args.map(arg => {
            if (arg === null) return 'None';
            if (arg === true) return 'True';
            if (arg === false) return 'False';
            if (typeof arg === 'object') return JSON.stringify(arg);
            return String(arg);
          }).join(' ');
          console.log(out);
        }
        function* __py_range(start, stop, step) {
          if (stop === undefined) { stop = start; start = 0; step = 1; }
          else if (step === undefined) { step = 1; }
          if (step > 0) { for (let i = start; i < stop; i += step) yield i; }
          else if (step < 0) { for (let i = start; i > stop; i += step) yield i; }
        }
        const range = __py_range;
        const len = (x) => (x ? (x.length ?? Object.keys(x).length) : 0);
        const abs = Math.abs, min = Math.min, max = Math.max;
        const sum = (arr) => (arr || []).reduce((a, b) => a + b, 0);
        const str = (x) => String(x), int = (x) => parseInt(x, 10), float = (x) => parseFloat(x);
        function __py_mul(a, b) {
          if (typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, Math.floor(b)));
          if (typeof b === 'string' && typeof a === 'number') return b.repeat(Math.max(0, Math.floor(a)));
          return a * b;
        }
        let __loop_watchdog = 0;
        ${transpiled}
      `;
    } else {
      executableJS = rawCode.includes('return') ? rawCode : 'return (' + rawCode + ');';
    }
    const SANDBOX_SHADOWED_GLOBALS = [
      'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator', 'document', 'window',
      'localStorage', 'sessionStorage', 'indexedDB', 'postMessage', 'alert', 'confirm', 'prompt',
      'require', 'process', 'Buffer', 'module', 'exports', 'globalThis',
      'Function'
      // 注：eval 不能作为 strict-mode 参数名（SyntaxError）；strict-mode 已阻断直接 eval 的作用域逃逸
    ];
    try {
      const sandboxFn = new Function('console', 'Math', ...SANDBOX_SHADOWED_GLOBALS, `
        "use strict";
        ${executableJS}
      `);
      let timerId;
      const execPromise = Promise.resolve().then(() => sandboxFn(customConsole, Math, ...SANDBOX_SHADOWED_GLOBALS.map(() => undefined)));
      const timeoutPromise = new Promise((_, reject) => {
        timerId = setTimeout(() => reject(new Error(`代码执行超时 (${timeoutMs}ms)`)), timeoutMs);
      });
      const result = await Promise.race([execPromise, timeoutPromise]);
      clearTimeout(timerId);
      const durationMs = Date.now() - startTime;
      return {
        status: 'success',
        result: result !== undefined ? (typeof result === 'object' ? JSON.parse(JSON.stringify(result)) : result) : null,
        stdout: logs.join('\n'),
        durationMs,
        language,
        sandbox: 'node-function'
      };
    } catch (err) {
      return { status: 'error', error: err.message, stdout: logs.join('\n'), durationMs: Date.now() - startTime, language, sandbox: 'node-function' };
    }
  }
}

if (typeof window !== 'undefined') {
  window.CodeSandboxSkill = CodeSandboxSkill;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CodeSandboxSkill };
}
