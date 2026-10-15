/**
 * IssueLog —— 结构化问题记录器（P7-H8；接管白皮书 P1-4「空 catch 消除或至少记录结构化错误」）
 *
 * 纪律：
 *   - recordIssue 绝不抛错（内部全保护）：记录失败不得影响被记录的调用路径；
 *   - 记录结构至少含 ts / scope（模块）/ op（操作）/ code / message（AGENTS 第 13 条结构化观测）；
 *   - 环形缓冲上限固定（默认 500），防无界增长；
 *   - 浏览器导出 JSONL 单行到 console.debug（可选开关），并暴露 window.wenjuIssues 供诊断命令读取。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.IssueLog = api;
    root.recordIssue = api.recordIssue;
    root.getWenjuIssues = api.getIssues;
  }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const CAPACITY = 500;
  const issues = [];
  let seq = 0;
  let consoleJsonl = false;

  function _codeOf(error) {
    if (!error) return 'UNKNOWN';
    if (typeof error === 'string') return 'NOTICE';
    return String(error.code || error.status || error.name || 'ERROR');
  }

  /**
   * 记录一条结构化问题。
   * @param {string} scope 模块面（如 'PromptInputDock'）
   * @param {string} op    操作面（如 'persist_model_id'）
   * @param {*} [error]    异常对象 / 字符串 / null
   * @param {object} [extra] 附加上下文（必须可 JSON 序列化）
   */
  function recordIssue(scope, op, error, extra) {
    try {
      const entry = {
        seq: ++seq,
        ts: new Date().toISOString(),
        scope: String(scope || 'unknown'),
        op: String(op || 'unknown'),
        code: _codeOf(error),
        message: String((error && error.message) || error || '').slice(0, 400)
      };
      if (extra && typeof extra === 'object') {
        try { entry.extra = JSON.parse(JSON.stringify(extra)); } catch (e) { entry.extra = { unserializable: true }; }
      }
      issues.push(entry);
      if (issues.length > CAPACITY) issues.splice(0, issues.length - CAPACITY);
      if (consoleJsonl && typeof console !== 'undefined' && console.debug) {
        try { console.debug(JSON.stringify({ kind: 'wenju.issue', ...entry })); } catch (e) { /* 忽略 */ }
      }
      return entry;
    } catch (e) {
      return null; // 记录器自身绝不抛错
    }
  }

  function getIssues(filter) {
    if (!filter) return issues.slice();
    return issues.filter((it) => (!filter.scope || it.scope === filter.scope) && (!filter.code || it.code === filter.code));
  }

  function clear() { const n = issues.length; issues.length = 0; return n; }

  function setConsoleJsonl(enabled) { consoleJsonl = !!enabled; return consoleJsonl; }

  function size() { return issues.length; }

  return { recordIssue, getIssues, clear, setConsoleJsonl, size, CAPACITY };
});
