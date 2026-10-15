/** Keyboard-accessible prompt palette. The store remains usable without DOM. */
(function (root, factory) {
  const Store = typeof require !== 'undefined' ? require('../js/prompts/PromptStore.js').PromptStore : root && root.PromptStore;
  const api = factory(Store);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PromptPalette = api.PromptPalette;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (PromptStore) {
  'use strict';
  class PromptPalette {
    constructor(options = {}) {
      this.store = options.store || new PromptStore(options);
      if (this.store.list().length === 0 && Array.isArray(options.seedPrompts)) {
        options.seedPrompts.forEach((entry) => this.store.upsert(entry));
      }
      this.onInsert = typeof options.onInsert === 'function' ? options.onInsert : () => {};
      this.container = options.container || null;
      this.opened = false; this.results = [];
      this._keydown = (event) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); this.toggle(); } if (event.key === 'Escape' && this.opened) this.close(); };
      if (typeof document !== 'undefined') document.addEventListener('keydown', this._keydown);
    }
    mount(container) { this.container = container || this.container || (typeof document !== 'undefined' ? document.body : null); return this; }
    open() { this.opened = true; this.render(''); return this; }
    close() { this.opened = false; if (this.container && this.container.querySelector) { const node = this.container.querySelector('[data-prompt-palette]'); if (node) node.remove(); } }
    toggle() { return this.opened ? this.close() : this.open(); }
    search(query) { this.results = this.store.search(query); this.render(query); return this.results; }
    select(promptId) { const used = this.store.use(promptId); if (used.ok) this.onInsert(used.entry.content, used.entry); return used; }
    render(query) {
      if (!this.opened || !this.container || typeof document === 'undefined') return;
      const results = this.results.length ? this.results : this.store.search(query);
      const node = document.createElement('div'); node.dataset.promptPalette = 'true'; node.className = 'prompt-palette';
      node.innerHTML = `<div class="prompt-palette-dialog" role="dialog" aria-label="提示词搜索"><input class="prompt-palette-input" aria-label="搜索提示词" value="${String(query || '').replace(/[&<>"']/g, '')}" placeholder="搜索提示词…" /><div class="prompt-palette-results">${results.map((hit) => `<button type="button" data-prompt-id="${hit.entry.id.replace(/[^\w-]/g, '')}"><strong>${hit.entry.title.replace(/[&<>"']/g, '')}</strong><span>${hit.snippet.replace(/[&<>"']/g, '')}</span></button>`).join('') || '<span class="prompt-palette-empty">没有匹配项</span>'}</div></div>`;
      const old = this.container.querySelector('[data-prompt-palette]'); if (old) old.remove(); this.container.appendChild(node);
      const input = node.querySelector('.prompt-palette-input'); input.addEventListener('input', (event) => this.search(event.target.value)); input.focus();
      node.querySelectorAll('[data-prompt-id]').forEach((button) => button.addEventListener('click', () => { this.select(button.dataset.promptId); this.close(); }));
    }
  }
  return { PromptPalette };
});
