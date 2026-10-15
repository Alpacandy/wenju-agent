/**
 * 问矩 · KaTeX 工业级数学公式排版适配器 (KaTeXRenderer)
 * 特性：
 * 1. 自动解析行内公式 ($...$) 与独立公式块 ($$...$$)
 * 2. 具有环境自愈与离线优雅降级能力 (若 CDN 未加载，降级为优雅代码样式)
 * 3. 异步批量 DOM 渲染与防闪烁
 */

class KaTeXRenderer {
  static isAvailable() {
    return typeof window !== 'undefined' && typeof window.katex !== 'undefined';
  }

  /**
   * 清洗公式表达式，彻底剔除 <br>、HTML 实体及多余空行，还原纯净 LaTeX 语法
   */
  static cleanMathExpr(expr) {
    if (!expr) return '';
    return expr
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  /**
   * 将含有 LaTeX 语法 ($...$ 或 $$...$$, \[...\], \(...\)) 的 HTML 字符串中的公式实时编译替换为 KaTeX 节点
   */
  static renderFormulaHtml(text) {
    if (!text) return '';
    const cleanExpr = this.cleanMathExpr;

    if (!this.isAvailable()) {
      // 降级兜底：格式化为等宽数学标签，确保去除 <br>
      return text
        .replace(/(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])/g, (m, e1, e2) => `<div class="math-fallback-block">${cleanExpr(e1 !== undefined ? e1 : e2)}</div>`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (m, e) => `<code class="math-fallback-inline">${cleanExpr(e)}</code>`)
        .replace(/(?<![a-zA-Z0-9\\])\$([^\$\n]+?)(?<!\\)\$(?![a-zA-Z0-9])/g, (m, e) => {
          const trimmed = (e || '').trim();
          if (!trimmed || /^\s|\s$/.test(e) || /^\d+(?:\.\d+)?$/.test(trimmed)) return m;
          if (/[\u4e00-\u9fa5]/.test(trimmed) && !/\\text\s*\{/.test(trimmed)) return m;
          if (/^\d/.test(trimmed) && !/[a-zA-Z\+\-\*\/=_\^\\\{\}\(\)]/.test(trimmed)) return m;
          return `<code class="math-fallback-inline">${cleanExpr(e)}</code>`;
        });
    }

    try {
      // 1. 处理块级公式 $$...$$ 与 \[...\]
      let processed = text.replace(/(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])/g, (match, expr1, expr2) => {
        const raw = (expr1 !== undefined ? expr1 : expr2) || '';
        const expr = cleanExpr(raw);
        try {
          return window.katex.renderToString(expr, {
            displayMode: true,
            throwOnError: false
          });
        } catch (e) {
          return match;
        }
      });

      // 2. 处理行内公式 \(...\)
      processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, (match, expr) => {
        try {
          return window.katex.renderToString(cleanExpr(expr), {
            displayMode: false,
            throwOnError: false
          });
        } catch (e) {
          return match;
        }
      });

      // 3. 处理行内公式 $...$ (具备货币符号与自然语言穿透防御)
      processed = processed.replace(/(?<![a-zA-Z0-9\\])\$([^\$\n]+?)(?<!\\)\$(?![a-zA-Z0-9])/g, (match, expr) => {
        const trimmed = (expr || '').trim();
        if (!trimmed) return match;
        if (/^\s|\s$/.test(expr)) return match;
        if (/^\d+(?:\.\d+)?$/.test(trimmed)) return match;
        if (/[\u4e00-\u9fa5]/.test(trimmed) && !/\\text\s*\{/.test(trimmed)) return match;
        if (/^\d/.test(trimmed) && !/[a-zA-Z\+\-\*\/=_\^\\\{\}\(\)]/.test(trimmed)) return match;
        try {
          return window.katex.renderToString(cleanExpr(expr), {
            displayMode: false,
            throwOnError: false
          });
        } catch (e) {
          return match;
        }
      });

      return processed;
    } catch (e) {
      console.warn('KaTeX render error:', e);
      return text;
    }
  }

  /**
   * 直接渲染到指定 DOM 元素
   */
  static renderElement(element) {
    if (!element) return;
    if (this.isAvailable() && typeof window.renderMathInElement === 'function') {
      window.renderMathInElement(element, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false }
        ],
        throwOnError: false
      });
    } else if (this.isAvailable()) {
      // Replace formula text nodes only. Reassigning a page's innerHTML detaches
      // live canvas/editor nodes and discards every event listener on that page.
      const doc = element.ownerDocument || document;
      const walker = doc.createTreeWalker(element, 4);
      const nodes = [];
      let node;
      while ((node = walker.nextNode())) {
        if (!node.parentElement?.closest('script,style,textarea,pre,code,.katex') && /\$|\\\(|\\\[/.test(node.nodeValue)) nodes.push(node);
      }
      for (const textNode of nodes) {
        const escaped = textNode.nodeValue.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const rendered = this.renderFormulaHtml(escaped);
        if (rendered !== escaped) {
          const span = doc.createElement('span');
          span.innerHTML = rendered;
          textNode.replaceWith(span);
        }
      }
    }
  }
}

window.KaTeXRenderer = KaTeXRenderer;
