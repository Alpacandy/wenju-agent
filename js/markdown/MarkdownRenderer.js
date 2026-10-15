/**
 * Reusable Markdown rendering facade.
 *
 * Applications may provide `options.legacyRenderer` while migrating an
 * existing renderer.  Standalone use falls back to marked (when available)
 * and a small escaped renderer suitable for status/error messages.
 */
(function initMarkdownRenderer(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api.MarkdownRenderer;
    module.exports.MarkdownRenderer = api.MarkdownRenderer;
    module.exports.createMarkdownRenderer = api.createMarkdownRenderer;
    module.exports.renderMarkdown = api.renderMarkdown;
  } else {
    root.MarkdownRenderer = root.MarkdownRenderer || api.createMarkdownRenderer();
    root.MarkdownRendererClass = root.MarkdownRendererClass || api.MarkdownRenderer;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function markdownRendererFactory(root) {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderFallback(source) {
    const lines = String(source).split(/\r?\n/);
    const output = [];
    let listType = null;
    const closeList = () => {
      if (listType) output.push(`</${listType}>`);
      listType = null;
    };
    lines.forEach((line) => {
      const trimmed = line.trim();
      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      const list = /^([-*]|\d+\.)\s+(.+)$/.exec(trimmed);
      if (heading) {
        closeList();
        const level = heading[1].length;
        output.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      } else if (list) {
        const nextType = /^\d+\./.test(list[1]) ? 'ol' : 'ul';
        if (listType !== nextType) {
          closeList();
          output.push(`<${nextType}>`);
          listType = nextType;
        }
        output.push(`<li>${escapeHtml(list[2])}</li>`);
      } else if (trimmed === '') {
        closeList();
      } else {
        closeList();
        output.push(`<p>${escapeHtml(trimmed)}</p>`);
      }
    });
    closeList();
    return output.join('');
  }

  class MarkdownRenderer {
    constructor(options = {}) {
      this.marked = options.marked || null;
      this.defaultOptions = Object.assign({}, options.defaultOptions);
    }

    resolveMarked(options) {
      return options.marked || this.marked ||
        (root && root.marked) ||
        (typeof globalThis !== 'undefined' && globalThis.marked) || null;
    }

    render(markdown, options = {}) {
      const source = String(markdown == null ? '' : markdown);
      if (!source) return '';
      if (typeof options.legacyRenderer === 'function' && !options.__skipLegacyRenderer) {
        const delegatedOptions = Object.assign({}, this.defaultOptions, options, {
          __skipLegacyRenderer: true,
          __skipReusableRenderer: true
        });
        delete delegatedOptions.legacyRenderer;
        return options.legacyRenderer(source, delegatedOptions);
      }
      const parser = this.resolveMarked(options);
      if (parser && typeof parser.parse === 'function') {
        if (typeof parser.setOptions === 'function') parser.setOptions({ gfm: true, breaks: true });
        return parser.parse(source);
      }
      return renderFallback(source);
    }

    static render(markdown, options) {
      return new MarkdownRenderer().render(markdown, options);
    }
  }

  function createMarkdownRenderer(options) {
    return new MarkdownRenderer(options);
  }

  function renderMarkdown(markdown, options) {
    return new MarkdownRenderer(options).render(markdown, options);
  }

  return { MarkdownRenderer, createMarkdownRenderer, renderMarkdown };
});
