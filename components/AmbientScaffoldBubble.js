/**
 * 问矩 · 环境感知启发微气泡 (AmbientScaffoldBubble)
 * 职责：
 * 1. 悬浮在空间画板右上角，充当手势操作向自然语言交互的主动中继器 (Proactive Grounding)
 * 2. 接收 SpatialTelemetryBus 发布的拓扑相变事件 (奇异降维、定向反转、核空间吸收等)
 * 3. 呈现玻璃拟态微气泡与启发式洞察，支持一键载入输入坞并向助教探讨
 */

class AmbientScaffoldBubble {
  /**
   * @param {object} options
   * @param {HTMLElement|string} options.container - 挂载父容器 (如 .canvas-viewport)
   * @param {object} [options.bus] - 绑定的 SpatialTelemetryBus 实例
   * @param {object} [options.dock] - 绑定的 PromptInputDock 实例 (或自动读取 window.promptInputDock)
   * @param {number} [options.autoDismissMs=12000] - 自动收起时长 (毫秒，0 表示不自动收起)
   */
  constructor({ container, bus = null, dock = null, autoDismissMs = 12000 } = {}) {
    this.container = typeof container === 'string' && typeof document !== 'undefined'
      ? document.querySelector(container)
      : container;
    this.bus = bus;
    this.dock = dock;
    this.autoDismissMs = autoDismissMs;

    this.currentEvent = null;
    this.dismissTimer = null;
    this.bubbleEl = null;
    this.unsubscribeBus = null;

    if (this.container && typeof document !== 'undefined') {
      this.initDOM();
    }
    if (this.bus) {
      this.bindBus(this.bus);
    }
  }

  initDOM() {
    if (!this.container) return;

    // 创建专属微气泡宿主 DOM
    this.bubbleEl = document.createElement('div');
    this.bubbleEl.className = 'ambient-scaffold-bubble hidden';
    this.bubbleEl.setAttribute('role', 'status');
    this.bubbleEl.setAttribute('aria-live', 'polite');

    this.bubbleEl.innerHTML = `
      <div class="bubble-inner-card">
        <div class="bubble-top-row">
          <div class="bubble-badge-group">
            <span class="bubble-icon" id="amb-bubble-icon">✨</span>
            <span class="bubble-tag" id="amb-bubble-tag">空间拓扑洞察</span>
          </div>
          <button type="button" class="btn-bubble-close" id="amb-bubble-close" title="收起此提示">✕</button>
        </div>
        <div class="bubble-desc-text" id="amb-bubble-desc">
          检测到空间变换特征...
        </div>
        <div class="bubble-action-bar">
          <button type="button" class="btn-bubble-ask" id="amb-bubble-ask">
            <span>向助教探讨此现象</span>
            <span class="btn-ask-arrow">→</span>
          </button>
        </div>
      </div>
    `;

    this.container.appendChild(this.bubbleEl);

    // 绑定事件
    const btnClose = this.bubbleEl.querySelector('#amb-bubble-close');
    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hide();
      });
    }

    const btnAsk = this.bubbleEl.querySelector('#amb-bubble-ask');
    if (btnAsk) {
      btnAsk.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleAskClick();
      });
    }

    // 悬停时暂停自动隐藏定时器
    this.bubbleEl.addEventListener('mouseenter', () => {
      if (this.dismissTimer) {
        clearTimeout(this.dismissTimer);
        this.dismissTimer = null;
      }
    });

    this.bubbleEl.addEventListener('mouseleave', () => {
      if (!this.bubbleEl.classList.contains('hidden') && this.autoDismissMs > 0) {
        this.dismissTimer = setTimeout(() => this.hide(), 4000);
      }
    });
  }

  /**
   * 绑定遥测总线事件监听
   * @param {object} bus
   */
  bindBus(bus) {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    this.bus = bus;
    if (bus && typeof bus.subscribe === 'function') {
      this.unsubscribeBus = bus.subscribe('*', (ev) => {
        this.show(ev);
      });
    }
  }

  /**
   * 呈现气泡并填入事件内容
   * @param {object} eventData
   */
  show(eventData) {
    if (!eventData) return;
    this.currentEvent = eventData;

    if (!this.bubbleEl) return;

    const iconEl = this.bubbleEl.querySelector('#amb-bubble-icon');
    const tagEl = this.bubbleEl.querySelector('#amb-bubble-tag');
    const descEl = this.bubbleEl.querySelector('#amb-bubble-desc');

    if (iconEl) iconEl.textContent = eventData.icon || '✦';
    if (tagEl) {
      tagEl.textContent = eventData.tag || eventData.title || '几何洞察';
      if (eventData.color) {
        tagEl.style.color = eventData.color;
      }
    }
    if (descEl) {
      descEl.textContent = eventData.description || '检测到基底发生显著代数拓扑形变。';
    }

    this.bubbleEl.classList.remove('hidden');
    this.bubbleEl.classList.add('visible');

    // 自动收起逻辑
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
    }
    if (this.autoDismissMs > 0) {
      this.dismissTimer = setTimeout(() => {
        this.hide();
      }, this.autoDismissMs);
    }
  }

  /**
   * 隐藏气泡
   */
  hide() {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.bubbleEl) {
      this.bubbleEl.classList.remove('visible');
      this.bubbleEl.classList.add('hidden');
    }
  }

  /**
   * 用户点击“向助教探讨此现象”
   */
  handleAskClick() {
    if (!this.currentEvent) return;
    const query = this.currentEvent.suggestedQuery;
    if (!query) return;

    const dock = this.dock || (typeof window !== 'undefined' ? window.promptInputDock : null);
    if (dock && typeof dock.setText === 'function') {
      dock.setText(query);
      if (dock.textarea && typeof dock.textarea.focus === 'function') {
        dock.textarea.focus();
      }
    }

    // 若当前未在 studio 页面，提示或切换
    if (typeof window !== 'undefined' && typeof window.switchModule === 'function') {
      const studioPage = document.getElementById('studio-page');
      if (studioPage && studioPage.classList.contains('hidden')) {
        window.switchModule('studio');
      }
    }

    this.hide();
  }

  destroy() {
    this.hide();
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = null;
    }
    if (this.bubbleEl && this.bubbleEl.parentElement) {
      this.bubbleEl.parentElement.removeChild(this.bubbleEl);
    }
    this.bubbleEl = null;
  }
}

if (typeof window !== 'undefined') {
  window.AmbientScaffoldBubble = AmbientScaffoldBubble;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AmbientScaffoldBubble };
}
