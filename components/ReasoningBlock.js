/**
 * 问矩 · 深度推导思维链折叠器 (ReasoningBlock v2.0)
 * 深度复用并超越 ZCode packages/ui/src/components/ai-elements/reasoning.tsx
 * 核心特性：
 * 1. 呼吸脉冲指示灯 (Shimmer Pulse) 与高科技微渐变发光
 * 2. 毫秒级动态流式秒表 (0.1s 步进实时递增)
 * 3. Token 估算徽标 (~N tokens) 与一键复制思考链路 (Copy to Clipboard)
 * 4. 思维链段落语义分词：自动识别 [物理感知]、[符号判定]、[反例检验] 等并渲染为精美胶囊标签
 * 5. 丝滑平滑高度折叠微动效与 KaTeX 数学公式矢量编译
 */

class ReasoningBlock {
  constructor({ container, defaultOpen = true }) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.isOpen = defaultOpen;
    this.isStreaming = false;
    this.startTime = null;
    this.durationSeconds = 0;
    this.timerInterval = null;
    this.thoughtContent = "";

    this.initDOM();
  }

  initDOM() {
    this.el = document.createElement('div');
    this.el.className = 'wenju-reasoning-block' + (this.isOpen ? ' is-open' : '');
    this.el.style.display = 'none'; // 仅当捕获到思维链时才激活渲染，彻底杜绝空白与 0 tokens
    this.el.innerHTML = `
      <div class="reasoning-header" role="button" tabindex="0">
        <div class="reasoning-indicator">
          <span class="reasoning-pulse-dot"></span>
          <svg class="reasoning-brain-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
            <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
          </svg>
          <span class="reasoning-title-text">正在展开代数空间推导演算...</span>
        </div>
        <div class="reasoning-meta-right">
          <span class="reasoning-token-badge">0 tokens</span>
          <button class="reasoning-copy-btn" title="复制思考链" type="button">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span class="copy-tip">复制</span>
          </button>
          <div class="reasoning-chevron">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
      </div>
      <div class="reasoning-content-wrapper">
        <div class="reasoning-content-body"></div>
      </div>
    `;

    this.header = this.el.querySelector('.reasoning-header');
    this.titleText = this.el.querySelector('.reasoning-title-text');
    this.contentBody = this.el.querySelector('.reasoning-content-body');
    this.pulseDot = this.el.querySelector('.reasoning-pulse-dot');
    this.tokenBadge = this.el.querySelector('.reasoning-token-badge');
    this.copyBtn = this.el.querySelector('.reasoning-copy-btn');

    this.header.addEventListener('click', (e) => {
      if (e.target.closest('.reasoning-copy-btn')) return;
      this.toggle();
    });

    this.header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      }
    });

    if (this.copyBtn) {
      this.copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.copyThought();
      });
    }

    if (this.container) {
      this.container.appendChild(this.el);
    }
  }

  copyThought() {
    if (!this.thoughtContent) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(this.thoughtContent).then(() => {
        const tip = this.copyBtn.querySelector('.copy-tip');
        if (tip) tip.textContent = '已复制!';
        setTimeout(() => { if (tip) tip.textContent = '复制'; }, 1500);
      }).catch(() => {});
    }
  }

  startStreaming() {
    if (this.isStreaming) return;
    this.isStreaming = true;
    this.startTime = Date.now();
    this.el.classList.add('is-streaming');
    this.titleText.textContent = '正在展开代数空间推导演算...';
    this.setOpen(true);

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
      this.titleText.textContent = `空间几何深度推导中 (${elapsed}s)...`;
    }, 100);
  }

  hasContent() {
    return Boolean(this.thoughtContent && this.thoughtContent.trim().length > 0);
  }

  stopStreaming(status = 'aborted') {
    this.isStreaming = false;
    this.el.classList.remove('is-streaming');
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (!this.hasContent()) { this.el.style.display = 'none'; return; }
    this.titleText.textContent = status === 'aborted' ? '推理已停止' : '推理未完成';
  }

  appendChunk(chunkText) {
    this.thoughtContent = chunkText;
    if (this.el.style.display === 'none') {
      this.el.style.display = '';
    }
    this.renderThoughtContent();
  }

  finishStreaming(durationSec, fallbackAnswer = '') {
    this.isStreaming = false;
    this.el.classList.remove('is-streaming');
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    if (!this.hasContent()) {
      // 若该模型无显式思维链 (如纯输出模型)，优雅隐藏思考卡片，绝不展示刺眼的 0 tokens 空壳
      this.el.style.display = 'none';
      return;
    }

    const finalSec = durationSec || ((Date.now() - (this.startTime || Date.now())) / 1000).toFixed(1);
    this.titleText.textContent = `代数空间推导演算完成 (耗时 ${finalSec}s)`;

    // 字符数估算，非服务商计费用量
    const tokens = Math.max(1, Math.round(this.thoughtContent.length / 1.8));
    if (this.tokenBadge) {
      this.tokenBadge.textContent = `≈ ${tokens} tokens（估算）`;
    }

    // 推理完成后自动平滑收起思考折叠卡片，保持学术推演流简约清爽 (对标 ZCode 规范)
    this.setOpen(false);
  }

  renderThoughtContent() {
    // 动态估算 Token 并更新徽标
    const tokens = Math.max(1, Math.round((this.thoughtContent || '').length / 1.8));
    if (this.tokenBadge) {
      this.tokenBadge.textContent = `≈ ${tokens} tokens（估算）`;
    }

    // 将内容分行排版并高亮阶段标签
    const lines = this.thoughtContent.split('\n');
    let html = lines.map(line => {
      let trimmed = line.trim();
      if (!trimmed) return '';

      // 提取语义标签，例如 [物理环境感知], [精确符号判定], [秩-零度定理检验], [定理推演]
      trimmed = trimmed.replace(/^•?\s*\[(.*?)\]/, (match, tag) => {
        let pillClass = 'stage-default';
        if (/物理|环境|感知/i.test(tag)) pillClass = 'stage-perceive';
        else if (/符号|判定|行列式/i.test(tag)) pillClass = 'stage-engage';
        else if (/秩|定理|检验|守恒/i.test(tag)) pillClass = 'stage-challenge';
        else if (/推演|证明|充要/i.test(tag)) pillClass = 'stage-deconstruct';

        return `<span class="thought-stage-pill ${pillClass}">✦ ${this.escapeHTML(tag)}</span>`;
      });

      if (trimmed.startsWith('•') || trimmed.startsWith('-')) {
        trimmed = trimmed.replace(/^[•\-]\s*/, '');
      }

      return `<div class="thought-line">${trimmed}</div>`;
    }).join('');

    this.contentBody.innerHTML = html;

    // 若全局具备 KaTeX 渲染器，执行数学公式编译
    if (window.KaTeXRenderer && typeof window.KaTeXRenderer.renderElement === 'function') {
      window.KaTeXRenderer.renderElement(this.contentBody);
    }
  }

  toggle() {
    this.setOpen(!this.isOpen);
  }

  setOpen(open) {
    this.isOpen = open;
    if (this.isOpen) {
      this.el.classList.add('is-open');
    } else {
      this.el.classList.remove('is-open');
    }
  }

  escapeHTML(str) {
    return (str || '').replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  destroy() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.el && this.el.parentElement) {
      this.el.parentElement.removeChild(this.el);
    }
  }
}

if (typeof window !== 'undefined') {
  window.ReasoningBlock = ReasoningBlock;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ReasoningBlock };
}
