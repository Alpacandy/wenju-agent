/**
 * MarkdownRenderer —— Markdown 渲染管线（P7 职责拆分，自 js/app.js 抽取）
 *
 * 面：escapeHtml（HTML 转义）/ formatMarkdownToHtml（Marked→净化→KaTeX→表格/列表/图片/代码块动作装配）。
 * 抽取为独立模块的收益：app.js 仅保留编排职责；渲染管线可被单测直接加载（含既有源码级抽取测试）。
 * 依赖：运行期经 window 解析 marked / katex / MarkdownSanitizer（与抽取前一致，无新增耦合）；
 *      ArtifactProjectionController 由本模块自持实例并暴露 window.projectImageToCanvas（同抽取前副作用）。
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WenjuMarkdownPipeline = api;
})(typeof window !== 'undefined' ? window : global, function (root) {
  'use strict';
  // 注意：全局名使用 WenjuMarkdownPipeline —— 仓库另有 js/markdown/MarkdownRenderer.js 占位
  // window.MarkdownRenderer（可复用渲染器实例，本管线在 formatMarkdownToHtml 内委托它）。
  // 若此处占用同名全局，将静默禁用可复用渲染器（T-DC 门禁锁定不得回退）。

  function escapeHtml(str) {
    // P5 S2：补引号转义（旧版只转 <>& 不转 " 和 '——属性注入面）
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  }

  // 工件投影：浏览器内接管 window.projectImageToCanvas（Node 隔离单测无 DOM，显式降级为空实现）
  const artifactProjectionController = (typeof window !== 'undefined' && typeof window.ArtifactProjectionController === 'function')
    ? window.ArtifactProjectionController({ window })
    : { projectImageToCanvas: null };
  if (typeof window !== 'undefined' && typeof artifactProjectionController.projectImageToCanvas === 'function') {
    window.projectImageToCanvas = artifactProjectionController.projectImageToCanvas;
  }

  /** 兜底解析器输出守卫：净化器可用则全量净化；否则最小删除可执行 HTML（script/iframe/object/embed/事件属性/javascript: 协议） */
  function formatMarkdownToHtml(md, options = {}) {
    const renderer = typeof window !== 'undefined' ? window.MarkdownRenderer : null;
    if (renderer && typeof renderer.render === 'function' && !options.__skipReusableRenderer && !options.__skipLegacyRenderer) {
      return renderer.render(md, Object.assign({}, options, {
        legacyRenderer: (source, delegatedOptions) => formatMarkdownToHtml(source, delegatedOptions)
      }));
    }
    if (!md) return '';
    const isStreaming = options.isStreaming === true;

    // 自包含高健壮性兜底 Markdown 解析器 (保证在无 window.marked 的 Node 隔离单测沙箱中 100% 具备表格、列表与排版解析力)
    // P5/P7：净化器解析与兜底输出守卫（内联于函数内：源码抽取式单测在隔离沙箱执行本函数体，
    // 不得依赖模块级变量；查找全部带 typeof 守卫，缺失时不抛错）
    function resolveSanitizer() {
      if (typeof MarkdownSanitizerModule !== 'undefined' && MarkdownSanitizerModule && typeof MarkdownSanitizerModule.sanitize === 'function') return MarkdownSanitizerModule;
      if (typeof window !== 'undefined' && window.MarkdownSanitizer && typeof window.MarkdownSanitizer.sanitize === 'function') return window.MarkdownSanitizer;
      if (typeof MarkdownSanitizer !== 'undefined' && MarkdownSanitizer && typeof MarkdownSanitizer.sanitize === 'function') return MarkdownSanitizer;
      if (typeof require !== 'undefined') { try { const m = require('../security/MarkdownSanitizer.js'); if (m && typeof m.sanitize === 'function') return m; } catch (error) { /* 隔离沙箱无该依赖 */ } }
      return null;
    }
    function guardFallbackHtml(sourceHtml) {
      const sanitizer = resolveSanitizer();
      if (sanitizer) return sanitizer.sanitize(String(sourceHtml));
      return String(sourceHtml)
        .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, '')
        .replace(/<\s*(iframe|object|embed|form|base|meta|link)[\s\S]*?>/gi, '')
        .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/javascript:/gi, 'blocked:');
    }
    function parseFallbackMarkdown(source) {
      const lines = source.split('\n');
      const result = [];
      let inTable = false;
      let tableRows = [];
      let inList = false;
      let listType = null;
      let inBlockquote = false;
      let blockquoteLines = [];

      function flushTable() {
        if (!inTable || tableRows.length === 0) return;
        let tableHtml = '<div class="markdown-table-wrapper"><table class="markdown-table">';
        let headerParsed = false;
        for (let r = 0; r < tableRows.length; r++) {
          const row = tableRows[r].trim();
          if (/^\|?(\s*:?-+:?\s*\|?)+$/.test(row)) {
            headerParsed = true;
            continue;
          }
          const cells = row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
          if (!headerParsed && r === 0) {
            tableHtml += '<thead><tr>' + cells.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr></thead><tbody>';
          } else {
            tableHtml += '<tr>' + cells.map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>';
          }
        }
        tableHtml += '</tbody></table></div>';
        result.push(tableHtml);
        inTable = false;
        tableRows = [];
      }

      function flushList() {
        if (!inList) return;
        result.push(`</${listType}>`);
        inList = false;
        listType = null;
      }

      function flushBlockquote() {
        if (!inBlockquote || blockquoteLines.length === 0) return;
        result.push(`<blockquote class="markdown-blockquote">${blockquoteLines.join('<br>')}</blockquote>`);
        inBlockquote = false;
        blockquoteLines = [];
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // GFM 表格识别
        if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.length > 2) {
          flushList();
          flushBlockquote();
          inTable = true;
          tableRows.push(trimmed);
          continue;
        } else if (inTable) {
          flushTable();
        }

        // 水平分割线
        if (/^(?:---|\*\*\*|___)$/.test(trimmed)) {
          flushList();
          flushBlockquote();
          result.push('<hr class="markdown-divider">');
          continue;
        }

        // 各级标题
        if (/^### (.*$)/.test(line)) {
          flushList();
          flushBlockquote();
          result.push(`<h3>${line.replace(/^### /, '')}</h3>`);
          continue;
        }
        if (/^## (.*$)/.test(line)) {
          flushList();
          flushBlockquote();
          result.push(`<h2>${line.replace(/^## /, '')}</h2>`);
          continue;
        }
        if (/^# (.*$)/.test(line)) {
          flushList();
          flushBlockquote();
          result.push(`<h1>${line.replace(/^# /, '')}</h1>`);
          continue;
        }

        // 引用块
        if (/^>\s?(.*)/.test(line)) {
          flushList();
          inBlockquote = true;
          blockquoteLines.push(line.replace(/^>\s?/, ''));
          continue;
        } else if (inBlockquote) {
          flushBlockquote();
        }

        // 无序列表
        if (/^[\*\-]\s+(.*)/.test(trimmed)) {
          const content = trimmed.replace(/^[\*\-]\s+/, '');
          if (!inList || listType !== 'ul') {
            flushList();
            result.push('<ul>');
            inList = true;
            listType = 'ul';
          }
          result.push(`<li>${content}</li>`);
          continue;
        }

        // 有序列表
        if (/^\d+\.\s+(.*)/.test(trimmed)) {
          const content = trimmed.replace(/^\d+\.\s+/, '');
          if (!inList || listType !== 'ol') {
            flushList();
            result.push('<ol>');
            inList = true;
            listType = 'ol';
          }
          result.push(`<li>${content}</li>`);
          continue;
        }

        flushList();
        if (trimmed === '') {
          result.push('<br>');
        } else {
          result.push(line);
        }
      }

      flushTable();
      flushList();
      flushBlockquote();

      let rendered = result.join('\n');
      rendered = rendered
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/~~(.*?)~~/g, '<del>$1</del>');
      return rendered;
    }

    const codeBlocks = [];
    let text = md.replace(/```([a-zA-Z0-9_\-\.]*)\s*\n([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push({ lang: (lang || 'code').trim().toLowerCase(), code: code });
      return `@@@CODE_BLOCK_${idx}@@@`;
    });

    const inlineCodes = [];
    text = text.replace(/`([^`\n]+)`/g, (match, code) => {
      const idx = inlineCodes.length;
      inlineCodes.push(escapeHtml(code));
      return `@@@INLINE_CODE_${idx}@@@`;
    });

    // 核心数学公式保护：提取并保护 LaTeX 独立公式块与行内公式
    const mathBlocks = [];
    text = text.replace(/(?:\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\])/g, (match, expr1, expr2) => {
      const raw = (expr1 !== undefined ? expr1 : expr2) || '';
      const clean = raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();
      const idx = mathBlocks.length;
      mathBlocks.push({ expr: clean, display: true });
      return `@@@MATH_BLOCK_${idx}@@@`;
    });

    if (isStreaming) {
      const unclosedBlockRegex = /\$\$([^$]*)$/;
      text = text.replace(unclosedBlockRegex, (match, expr) => {
        const clean = (expr || '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&nbsp;/g, ' ')
          .trim();
        const idx = mathBlocks.length;
        mathBlocks.push({ expr: clean, display: true, isStreaming: true });
        return `@@@MATH_BLOCK_${idx}@@@`;
      });
    }

    const mathInlines = [];
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (match, expr) => {
      const clean = (expr || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();
      const idx = mathInlines.length;
      mathInlines.push({ expr: clean, display: false });
      return `@@@MATH_INLINE_${idx}@@@`;
    });

    text = text.replace(/(?<![a-zA-Z0-9\\])\$([^\$\n]+?)(?<!\\)\$(?![a-zA-Z0-9])/g, (match, expr) => {
      const trimmed = (expr || '').trim();
      if (!trimmed) return match;
      if (/^\s|\s$/.test(expr)) return match;
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) return match;
      if (/[\u4e00-\u9fa5]/.test(trimmed) && !/\\text\s*\{/.test(trimmed)) return match;
      if (/^\d/.test(trimmed) && !/[a-zA-Z\+\-\*\/=_\^\\\{\}\(\)]/.test(trimmed)) return match;

      const clean = (expr || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();
      const idx = mathInlines.length;
      mathInlines.push({ expr: clean, display: false });
      return `@@@MATH_INLINE_${idx}@@@`;
    });

    // 匹配所有已闭合的 Markdown 图片语法
    const imageCards = [];
    const closedImgRegex = /!\s*\[([^\]]*?)\]\s*\(\s*(https?:\/\/[^)]+|data:image\/[a-zA-Z\+]+;base64,[^)]+)\s*\)/gi;
    text = text.replace(closedImgRegex, (match, alt, rawUrl) => {
      const cleanUrl = rawUrl.replace(/\s+/g, '').trim();
      if (!cleanUrl || cleanUrl === '#' || cleanUrl === 'about:blank') return '';
      const idx = imageCards.length;
      imageCards.push({ alt: alt.trim() || '视觉概念生成图', url: cleanUrl, isStreaming: false });
      return `@@@IMAGE_CARD_${idx}@@@`;
    });

    if (isStreaming) {
      const inFlightStreamingImgRegex = /!\s*\[([^\]]*?)\](?:\s*\([^)]*)?$/i;
      text = text.replace(inFlightStreamingImgRegex, (match, alt) => {
        const idx = imageCards.length;
        imageCards.push({ alt: alt.trim() || '视觉画幅渲染中', url: '', isStreaming: true });
        return `@@@IMAGE_CARD_${idx}@@@`;
      });

      const inFlightUnclosedBracketRegex = /!\s*\[[^\]]*$/i;
      text = text.replace(inFlightUnclosedBracketRegex, () => {
        const idx = imageCards.length;
        imageCards.push({ alt: '视觉画幅渲染中', url: '', isStreaming: true });
        return `@@@IMAGE_CARD_${idx}@@@`;
      });

      const inFlightS3UrlRegex = /(?:\(|^|\s)(https?:\/\/[a-zA-Z0-9.-]+\/temporary\/[^)]*)$/i;
      text = text.replace(inFlightS3UrlRegex, () => {
        const idx = imageCards.length;
        imageCards.push({ alt: '视觉画幅渲染中', url: '', isStreaming: true });
        return `\n@@@IMAGE_CARD_${idx}@@@`;
      });

      const inFlightBase64Regex = /(?:\(|^|\s)(data:image\/[a-zA-Z\+]+;base64,[A-Za-z0-9+/=]*)$/i;
      text = text.replace(inFlightBase64Regex, () => {
        const idx = imageCards.length;
        imageCards.push({ alt: '视觉画幅光栅化中', url: '', isStreaming: true });
        return `\n@@@IMAGE_CARD_${idx}@@@`;
      });
    } else {
      const unclosedAtEndRegex = /!\s*\[([^\]]*?)\]\s*\(\s*(https?:\/\/[^\s\)]+|data:image\/[a-zA-Z\+]+;base64,[A-Za-z0-9+/=]+)$/i;
      text = text.replace(unclosedAtEndRegex, (match, alt, rawUrl) => {
        const cleanUrl = rawUrl.replace(/\s+/g, '').trim();
        if (!cleanUrl || cleanUrl === '#' || cleanUrl === 'about:blank') return '';
        const idx = imageCards.length;
        imageCards.push({ alt: alt.trim() || '视觉概念生成图', url: cleanUrl, isStreaming: false });
        return `@@@IMAGE_CARD_${idx}@@@`;
      });
    }

    const standaloneImgRegex = /(?:^|\n|\s)\(?\s*(data:image\/[a-zA-Z\+]+;base64,[A-Za-z0-9+/=]+|https?:\/\/[^\s\)]+\.(?:png|jpg|jpeg|webp|gif)(?:\?[^\s\)]*)?|https?:\/\/[a-zA-Z0-9.-]+\/temporary\/[^\s\)]+)\s*\)?/gi;
    text = text.replace(standaloneImgRegex, (match, url) => {
      const idx = imageCards.length;
      imageCards.push({ alt: '生成的视觉插画', url: url.trim(), isStreaming: false });
      return `\n@@@IMAGE_CARD_${idx}@@@\n`;
    });

    const linkCards = [];
    text = text.replace(/\[([^\]]+)\]\s*\(\s*([^\s\)]+)\s*\)/gi, (match, linkText, url) => {
      const cleanLink = url.trim();
      if (!cleanLink || cleanLink === '#') return linkText;
      const idx = linkCards.length;
      linkCards.push({ text: linkText.trim(), url: cleanLink });
      return `@@@LINK_CARD_${idx}@@@`;
    });

    // 工业级 Markdown 渲染器：优先选用权威 marked 解析并增强 ZCode 表格容器，无环境时由自包含兜底器保障
    let html = '';
    let activeMarked = null;
    if (typeof marked !== 'undefined' && marked && typeof marked.parse === 'function') {
      activeMarked = marked;
    } else if (typeof window !== 'undefined' && window.marked && typeof window.marked.parse === 'function') {
      activeMarked = window.marked;
    } else if (typeof global !== 'undefined' && global.marked && typeof global.marked.parse === 'function') {
      activeMarked = global.marked;
    }

    if (activeMarked) {
      try {
        if (typeof activeMarked.setOptions === 'function') {
          activeMarked.setOptions({ gfm: true, breaks: true });
        }
        html = activeMarked.parse(text);
        // P5 S2：marked 输出后净化（危险标签/事件属性/协议白名单）
        const markedSanitizer = resolveSanitizer();
        if (markedSanitizer) html = markedSanitizer.sanitize(html);
        html = html.replace(/<table>([\s\S]*?)<\/table>/gi, '<div class="markdown-table-wrapper"><table class="markdown-table">$1</table></div>');
      } catch (err) {
        html = parseFallbackMarkdown(text);
        html = guardFallbackHtml(html);
      }
    } else {
      html = parseFallbackMarkdown(text);
      html = guardFallbackHtml(html);
    }

    // 块级元素占位符安全替换（解开外层被 markdown 解析器包裹的多余 <p> 标签，防止 <p><div> 产生非法 DOM 嵌套）
    function replaceBlockToken(sourceHtml, token, blockHtml) {
      const pWrappedRegex = new RegExp('<p>\\s*' + token + '\\s*<\\/p>', 'g');
      if (pWrappedRegex.test(sourceHtml)) {
        return sourceHtml.replace(pWrappedRegex, blockHtml);
      }
      return sourceHtml.replace(new RegExp(token, 'g'), blockHtml);
    }

    // 回填并渲染数学公式块 (无任何 <br> 污染)
    mathBlocks.forEach((mb, i) => {
      let mathHtml = '';
      if (typeof window !== 'undefined' && window.katex && typeof window.katex.renderToString === 'function') {
        try {
          mathHtml = window.katex.renderToString(mb.expr, {
            displayMode: true,
            throwOnError: false
          });
        } catch (e) {
          mathHtml = `<div class="katex-display-fallback">${escapeHtml(mb.expr)}</div>`;
        }
      } else {
        mathHtml = `<div class="math-fallback-block">$$${escapeHtml(mb.expr)}$$</div>`;
      }
      html = replaceBlockToken(html, `@@@MATH_BLOCK_${i}@@@`, `<div class="math-block-container" style="margin: 8px 0; overflow-x: auto;">${mathHtml}</div>`);
    });

    // 回填并渲染行内数学公式
    mathInlines.forEach((mi, i) => {
      let mathHtml = '';
      if (typeof window !== 'undefined' && window.katex && typeof window.katex.renderToString === 'function') {
        try {
          mathHtml = window.katex.renderToString(mi.expr, {
            displayMode: false,
            throwOnError: false
          });
        } catch (e) {
          mathHtml = `<code class="katex-inline-fallback">${escapeHtml(mi.expr)}</code>`;
        }
      } else {
        mathHtml = `<code class="math-fallback-inline">$${escapeHtml(mi.expr)}$</code>`;
      }
      html = html.replace(new RegExp(`@@@MATH_INLINE_${i}@@@`, 'g'), mathHtml);
    });

    if (typeof window !== 'undefined' && window.KaTeXRenderer) {
      html = window.KaTeXRenderer.renderFormulaHtml(html);
    }

    inlineCodes.forEach((ic, i) => {
      html = html.replace(new RegExp(`@@@INLINE_CODE_${i}@@@`, 'g'), `<code class="inline-code">${ic}</code>`);
    });

    linkCards.forEach((lc, i) => {
      html = html.replace(new RegExp(`@@@LINK_CARD_${i}@@@`, 'g'), `<a class="chat-external-link" href="${escapeHtml(lc.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(lc.text)} <span class="link-arrow">↗</span></a>`);
    });

    imageCards.forEach((ic, i) => {
      let imgHtml;
      if (ic.isStreaming) {
        imgHtml = `
          <div class="chat-rendered-image-container streaming-skeleton">
            <div class="chat-image-card image-shimmer-card">
              <div class="chat-image-header">
                <div class="chat-image-title-group">
                  <span class="generating-spinner"></span>
                  <span class="chat-image-caption">正在生成视觉画幅 [${escapeHtml(ic.alt)} ...]</span>
                </div>
                <span class="chat-generating-pill">🎨 绘图合成中</span>
              </div>
              <div class="chat-image-preview-wrap streaming-wrap">
                <div class="image-stream-skeleton-content">
                  <div class="art-palette-animation">🎨</div>
                  <div class="art-loading-title">可图文生图大模型画幅渲染中</div>
                  <div class="art-loading-desc">正在根据语义提示词光栅化高精度几何与构图细节...</div>
                </div>
              </div>
            </div>
          </div>
        `;
      } else {
        const safeUrl = ic.url;
        const safeAlt = escapeHtml(ic.alt);
        const isDataUrl = safeUrl.startsWith('data:');
        imgHtml = `
          <div class="chat-rendered-image-container">
            <div class="chat-image-card">
              <div class="chat-image-header">
                <div class="chat-image-title-group">
                  <span class="chat-image-badge-dot">●</span>
                  <span class="chat-image-caption">${safeAlt}</span>
                </div>
                <div class="chat-image-actions">
                  <button type="button" class="chat-image-project-btn primary" onclick="window.projectImageToCanvas && window.projectImageToCanvas(this.dataset.url, this.dataset.title, { mode: 'artifact' })" data-url="${escapeHtml(safeUrl)}" data-title="${safeAlt}" title="投至左侧独立 Artifact 展台 (零网格遮挡，可随时一键恢复原画板)">
                    <span>📌 投至画板 (展台)</span>
                  </button>
                  <button type="button" class="chat-image-project-btn" onclick="window.projectImageToCanvas && window.projectImageToCanvas(this.dataset.url, this.dataset.title, { mode: 'overlay' })" data-url="${escapeHtml(safeUrl)}" data-title="${safeAlt}" title="以底图形式叠加至空间几何坐标系">
                    <span>🔀 叠图映射</span>
                  </button>
                  <a class="chat-image-open-btn" href="${isDataUrl ? '#' : escapeHtml(safeUrl)}" ${isDataUrl ? `onclick="const w=window.open('');if(w){const img=w.document.createElement('img');img.src=this.dataset.url;img.style.cssText='max-width:100%;display:block;margin:auto;';w.document.body.appendChild(img);}return false;" data-url="${escapeHtml(safeUrl)}"` : 'target="_blank" rel="noopener noreferrer"'} title="查看原图">
                    <span>查看原图</span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                </div>
              </div>
              <div class="chat-image-preview-wrap">
                <img class="chat-image-preview" src="${escapeHtml(safeUrl)}" alt="${safeAlt}" loading="lazy" onclick="window.projectImageToCanvas && window.projectImageToCanvas(this.src, this.alt)" title="点击可快速投影至左侧画板" />
              </div>
            </div>
          </div>
        `;
      }
      html = replaceBlockToken(html, `@@@IMAGE_CARD_${i}@@@`, imgHtml);
    });

    codeBlocks.forEach((cb, i) => {
      const lang = cb.lang || 'code';
      const rawCode = cb.code;
      const isRunnable = ['html', 'svg', 'xml', 'javascript', 'js'].includes(lang) || rawCode.includes('<html') || rawCode.includes('<svg') || rawCode.includes('<canvas');
      const escaped = escapeHtml(rawCode);
      const encoded = encodeURIComponent(rawCode);

      const blockHtml = `
        <div class="code-block-container" data-lang="${escapeHtml(lang)}">
          <div class="code-block-header">
            <span class="code-block-lang">${escapeHtml(lang)}</span>
            <div class="code-block-actions">
              <button type="button" class="btn-code-action btn-copy" data-code="${encoded}">⎘ 复制</button>
              <button type="button" class="btn-code-action btn-download" data-lang="${escapeHtml(lang)}" data-code="${encoded}">⤓ 下载</button>
              ${isRunnable ? `<button type="button" class="btn-code-action btn-run" data-lang="${escapeHtml(lang)}" data-code="${encoded}">▶ 运行</button>` : ''}
            </div>
          </div>
          <pre class="code-block-pre"><code>${escaped}</code></pre>
        </div>
      `;
      html = replaceBlockToken(html, `@@@CODE_BLOCK_${i}@@@`, blockHtml);
    });

    return html;
  }

  return { escapeHtml, formatMarkdownToHtml };
});
