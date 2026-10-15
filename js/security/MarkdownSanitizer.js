/**
 * MarkdownSanitizer —— 模型输出 HTML 净化器（P5 S2 · B2 XSS 注入面修复）
 *
 * 根因：marked.parse() 未配置 HTML 禁用；escapeHtml 不转义引号；URL 直入 href 无协议白名单。
 *
 * 三层防御：
 *   1. 危险标签移除：<script>/<iframe>/<object>/<embed>/<link>/<meta>/<base>
 *   2. 事件属性剥离：onclick/onload/onerror/on* 全族
 *   3. 协议白名单：href/src 仅允许 http:/https:/#/mailto:/data:image（后者限图片）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MarkdownSanitizer = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const DANGEROUS_TAGS = /<(script|iframe|object|embed|link|meta|base)\b[^>]*>[\s\S]*?<\/\1\s*>|<(script|iframe|object|embed|link|meta|base)\b[^>]*\/?>/gi;
  const EVENT_ATTRS = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
  const ALLOWED_PROTOCOLS = /^(https?:|mailto:|#|data:image\/)/i;
  const DANGEROUS_PROTOCOLS = /^(javascript:|vbscript:|file:|about:|chrome:|moz-extension:|chrome-extension:)/i;

  /** 净化 HTML：移除危险标签 + 剥离事件属性 + 校验链接协议 */
  function sanitize(html) {
    if (!html || typeof html !== 'string') return '';
    let out = html;
    // 1. 危险标签移除（含闭合块与自闭合）
    out = out.replace(DANGEROUS_TAGS, '');
    // 2. 事件属性剥离（on* 全族）
    out = out.replace(EVENT_ATTRS, '');
    // 3. 链接协议校验：href/src/action 的值如果含危险协议 → 替换为 #
    out = out.replace(/(\s(?:href|src|action)\s*=\s*)(["'])(.*?)\2/gi, (match, prefix, quote, url) => {
      const trimmed = url.trim();
      if (DANGEROUS_PROTOCOLS.test(trimmed) || (!ALLOWED_PROTOCOLS.test(trimmed) && trimmed !== '' && !trimmed.startsWith('/'))) {
        return prefix + quote + '#' + quote;
      }
      return match;
    });
    // 4. style 属性中的 expression() / url(javascript:) 移除
    out = out.replace(/style\s*=\s*(["'])((?:(?!\1).)*)\1/gi, (match, quote, css) => {
      if (/expression\s*\(|javascript:|vbscript:/i.test(css)) {
        return ''; // 整个 style 属性移除
      }
      return match;
    });
    return out;
  }

  /** 增强版 escapeHtml：补引号转义（旧版只转 <>& 不转 " 和 '） */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  /** 净化 marked 输出（入口：formatMarkdownToHtml 后处理） */
  function sanitizeMarkedOutput(html) {
    return sanitize(html);
  }

  return { sanitize, escapeHtml, sanitizeMarkedOutput };
});
