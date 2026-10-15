/**
 * 问矩 · 会话提示词轮次导航轨组件 (PromptTurnNavigator)
 * 深度复用与对标 ZCode ModelTrajectoryTimeline & Turn Minimap 设计
 * 
 * 核心能力：
 * 1. 会话流左侧垂直微缩刻度轨 (Turn Minimap Rail)，可视化指示每一轮探究提示词；
 * 2. 悬浮展开卡片 (Turn Popover Card)，展示轮次编号、提问原文、工具调用标签与推演结论摘要；
 * 3. 点击一键平滑滚动锚定至目标轮次，并触发视窗光晕高亮聚焦 (.turn-focused-highlight)；
 * 4. 监听会话流滚动事件，基于视口可见性动态计算并高亮当前活跃轮次 (.active)；
 * 5. 状态机联动：支持 running (流式运算中脉冲动效) -> done (完成) -> error (异常) 状态流转。
 */

(function(global) {
  'use strict';

  class PromptTurnNavigator {
    /**
     * @param {Object} options
     * @param {HTMLElement|string} options.railContainer - 导航轨容器元素或 ID
     * @param {HTMLElement|string} options.streamContainer - 会话消息流容器元素或 ID
     * @param {Function} [options.onTurnClick] - 轮次点击回调
     */
    constructor(options = {}) {
      this.railContainer = typeof options.railContainer === 'string'
        ? document.getElementById(options.railContainer)
        : options.railContainer;

      this.streamContainer = typeof options.streamContainer === 'string'
        ? document.getElementById(options.streamContainer)
        : options.streamContainer;

      this.onTurnClick = options.onTurnClick || null;
      this.turns = []; // Array of TurnRecord
      this.activeTurnId = null;
      this.scrollThrottleTimer = null;

      this._init();
    }

    _init() {
      if (!this.railContainer) {
        console.warn('[PromptTurnNavigator] railContainer 未提供，跳过 DOM 挂载');
        return;
      }

      this.railContainer.classList.add('prompt-turn-rail-host');
      this.railContainer.innerHTML = '';

      // 创建导航轨主轨道
      this.trackEl = document.createElement('div');
      this.trackEl.className = 'turn-rail-track';
      this.railContainer.appendChild(this.trackEl);

      // 创建空态指示 (无提问时显示极简微标)
      this.emptyEl = document.createElement('div');
      this.emptyEl.className = 'turn-rail-empty';
      this.emptyEl.title = '探究轮次时间线';
      this.emptyEl.innerHTML = `<span class="turn-rail-empty-dot"></span>`;
      this.railContainer.appendChild(this.emptyEl);

      // 绑定滚动监听，实现视口感知的高亮联动
      if (this.streamContainer && typeof this.streamContainer.addEventListener === 'function') {
        this.streamContainer.addEventListener('scroll', () => {
          this._handleStreamScroll();
        }, { passive: true });
      }

      this.updateVisibility();
    }

    /**
     * 注册新的一轮提问
     * @param {Object} param
     * @param {number|string} param.turnId - 轮次序号或唯一标识
     * @param {string} param.promptText - 提问纯文本
     * @param {Date|number} [param.timestamp] - 发起时间戳
     * @param {HTMLElement} [param.userEl] - 用户提问 DOM 元素
     * @param {HTMLElement} [param.responseEl] - Agent 回答 DOM 元素
     * @param {string} [param.status] - 初始状态: 'running' | 'done' | 'failed'
     * @returns {Object} TurnRecord
     */
    registerTurn({ turnId, promptText, timestamp, userEl, responseEl, status = 'running' }) {
      const id = turnId != null ? turnId : this.turns.length + 1;
      const turnRecord = {
        id,
        promptText: String(promptText || '').trim(),
        timestamp: timestamp instanceof Date ? timestamp : new Date(timestamp || Date.now()),
        userEl: userEl || null,
        responseEl: responseEl || null,
        status, // 'running' | 'done' | 'failed'
        toolCalls: [], // 收集本轮执行的工具 [{ name, title }]
        summary: '',
        tickEl: null,
        popoverEl: null
      };

      // 为 DOM 元素打上数据标签方便反查
      if (turnRecord.userEl) {
        turnRecord.userEl.setAttribute('data-turn-id', String(id));
      }
      if (turnRecord.responseEl) {
        turnRecord.responseEl.setAttribute('data-turn-id', String(id));
      }

      this.turns.push(turnRecord);
      this._renderTick(turnRecord);
      this.setActiveTurn(id);
      this.updateVisibility();

      return turnRecord;
    }

    /**
     * 记录某一轮调用的工具
     */
    recordToolCall(turnId, { name, title }) {
      const turn = this.getTurn(turnId);
      if (!turn) return;

      if (!turn.toolCalls.some(t => t.name === name)) {
        turn.toolCalls.push({ name, title: title || name });
        if (turn.tickEl) {
          turn.tickEl.classList.add('has-tools');
        }
        this._updatePopoverContent(turn);
      }
    }

    /**
     * 更新轮次完成状态与最终推演结论摘要
     */
    completeTurn(turnId, { status = 'done', summary = '' } = {}) {
      const turn = this.getTurn(turnId);
      if (!turn) return;

      turn.status = status;
      if (summary) {
        turn.summary = String(summary).trim();
      }

      if (turn.tickEl) {
        turn.tickEl.classList.remove('running');
        if (status === 'done') {
          turn.tickEl.classList.add('done');
        } else if (status === 'failed') {
          turn.tickEl.classList.add('failed');
        } else if (status === 'aborted') {
          turn.tickEl.classList.add('aborted');
        }
      }

      this._updatePopoverContent(turn);
    }

    getTurn(turnId) {
      return this.turns.find(t => String(t.id) === String(turnId)) || null;
    }

    /**
     * 渲染单根轮次横向指示刻度 (Tick Bar) 与悬浮卡片 (Popover)
     */
    _renderTick(turn) {
      if (!this.trackEl) return;

      const tickEl = document.createElement('div');
      tickEl.className = `turn-rail-tick ${turn.status}`;
      tickEl.setAttribute('data-turn-tick', String(turn.id));
      tickEl.setAttribute('role', 'button');
      tickEl.setAttribute('tabindex', '0');
      tickEl.setAttribute('aria-label', `第 ${turn.id} 轮探究: ${turn.promptText.slice(0, 30)}`);

      // 创建悬浮 Popover 预览卡片 (复用 ZCode 现代毛玻璃阴影设计)
      const popoverEl = document.createElement('div');
      popoverEl.className = 'turn-rail-popover';
      tickEl.appendChild(popoverEl);

      turn.tickEl = tickEl;
      turn.popoverEl = popoverEl;
      this._updatePopoverContent(turn);

      // 绑定点击事件：平滑滚动到提问位置并聚焦
      if (typeof tickEl.addEventListener === 'function') {
        tickEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.scrollToTurn(turn.id);
          if (typeof this.onTurnClick === 'function') {
            this.onTurnClick(turn);
          }
        });

        // 键盘无障碍支持 (Enter / Space)
        tickEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.scrollToTurn(turn.id);
          }
        });
      }

      this.trackEl.appendChild(tickEl);
    }

    /**
     * 刷新 Popover 预览卡片 HTML 内容
     */
    _updatePopoverContent(turn) {
      if (!turn.popoverEl) return;

      const timeStr = turn.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const statusBadge = turn.status === 'running'
        ? '<span class="turn-popover-status running">⚡ 推演中</span>'
        : (turn.status === 'failed'
          ? '<span class="turn-popover-status failed">✕ 失败</span>'
          : turn.status === 'aborted' ? '<span class="turn-popover-status aborted">■ 已停止</span>' : '<span class="turn-popover-status done">✓ 已完成</span>');

      const toolsHtml = turn.toolCalls.length > 0
        ? `<div class="turn-popover-tools">
            ${turn.toolCalls.map(t => `<span class="tool-chip" title="${t.name}">⚙ ${this._formatToolName(t.name)}</span>`).join('')}
          </div>`
        : '';

      const summaryHtml = turn.summary
        ? `<div class="turn-popover-summary">${this._escapeHtml(this._truncate(turn.summary, 120))}</div>`
        : '';

      turn.popoverEl.innerHTML = `
        <div class="turn-popover-header">
          <div class="turn-popover-badge">轮次 #${turn.id}</div>
          <div class="turn-popover-meta">
            ${statusBadge}
            <span class="turn-popover-time">${timeStr}</span>
          </div>
        </div>
        <div class="turn-popover-prompt">
          <span class="prompt-quote-mark">“</span>${this._escapeHtml(this._truncate(turn.promptText, 90))}<span class="prompt-quote-mark">”</span>
        </div>
        ${toolsHtml}
        ${summaryHtml}
        <div class="turn-popover-footer">
          <span>点击平滑跳转至本轮 ↑</span>
        </div>
      `;
    }

    _formatToolName(name) {
      const map = {
        'drive_canvas_affine_transform': '画布仿射补间',
        'solve_matrix_kernel_sympy': '核空间精确求解',
        'construct_counterexample_matrix': '数学反例构造',
        'probe_null_space': '零空间激光探针',
        'evaluate_pedagogical_scaffold': '认知脚手架评估',
        'code_sandbox_run': '沙箱代码执行',
        'manage_workspace_file': '工作区文件调度'
      };
      return map[name] || name;
    }

    _truncate(str, maxLen = 80) {
      if (!str) return '';
      return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
    }

    _escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    }

    /**
     * 平滑滚动到指定轮次所在位置，并添加呼吸光晕高亮 (完全隔离在 streamContainer 内部)
     */
    scrollToTurn(turnId) {
      const turn = this.getTurn(turnId);
      if (!turn) return;

      const targetEl = turn.userEl || turn.responseEl;
      if (!targetEl || !this.streamContainer) return;

      this.setActiveTurn(turnId);

      // 激活平滑滚动保护锁，避免滚动动画派发的高频 scroll 事件抢断高亮
      this.isProgrammaticScrolling = true;
      if (this.programmaticScrollTimer) {
        clearTimeout(this.programmaticScrollTimer);
      }
      this.programmaticScrollTimer = setTimeout(() => {
        this.isProgrammaticScrolling = false;
      }, 450);

      // 精确计算相对于流容器的内部滚动距离，坚决避免原生 scrollIntoView 导致整页纵向位移与布局错乱
      const containerRect = typeof this.streamContainer.getBoundingClientRect === 'function'
        ? this.streamContainer.getBoundingClientRect()
        : { top: 0 };
      const targetRect = typeof targetEl.getBoundingClientRect === 'function'
        ? targetEl.getBoundingClientRect()
        : { top: targetEl.offsetTop || 0 };

      const currentScrollTop = this.streamContainer.scrollTop || 0;
      const relativeTop = (targetRect.top - containerRect.top) + currentScrollTop;
      const finalScrollTop = Math.max(0, relativeTop - 20);

      if (typeof this.streamContainer.scrollTo === 'function') {
        this.streamContainer.scrollTo({ top: finalScrollTop, behavior: 'smooth' });
      } else {
        this.streamContainer.scrollTop = finalScrollTop;
      }

      // 添加视觉聚焦光晕动画，1.8秒后自动移除
      const bubbleEl = turn.userEl || targetEl;
      if (bubbleEl && bubbleEl.classList) {
        bubbleEl.classList.remove('turn-focused-highlight');
        void bubbleEl.offsetWidth;
        bubbleEl.classList.add('turn-focused-highlight');
        setTimeout(() => {
          bubbleEl.classList.remove('turn-focused-highlight');
        }, 1800);
      }
    }

    /**
     * 设置当前活跃轮次
     */
    setActiveTurn(turnId) {
      this.activeTurnId = turnId;
      this.turns.forEach(t => {
        if (t.tickEl) {
          if (String(t.id) === String(turnId)) {
            t.tickEl.classList.add('active');
          } else {
            t.tickEl.classList.remove('active');
          }
        }
      });
    }

    /**
     * 监听流式滚动：基于单调分段阶梯算法 (Monotonic Step Partitioning) 精确稳定高亮当前阅读轮次
     */
    _handleStreamScroll() {
      if (this.isProgrammaticScrolling) return;
      if (this.scrollThrottleTimer) return;
      this.scrollThrottleTimer = setTimeout(() => {
        this.scrollThrottleTimer = null;
        if (this.isProgrammaticScrolling) return;
        if (!this.streamContainer || this.turns.length === 0) return;

        const currentScrollTop = this.streamContainer.scrollTop || 0;
        const clientHeight = this.streamContainer.clientHeight || 0;
        const scrollHeight = this.streamContainer.scrollHeight || 0;

        // 1. 视口吸顶守卫：在容器最顶部区域时严格锁定第 1 轮
        if (currentScrollTop <= 16) {
          if (this.activeTurnId !== this.turns[0].id) {
            this.setActiveTurn(this.turns[0].id);
          }
          return;
        }

        // 2. 视口吸底守卫：在容器滚动到底部最新回答区域时严格锁定最后一轮
        if (scrollHeight > 0 && currentScrollTop + clientHeight >= scrollHeight - 20) {
          const lastTurn = this.turns[this.turns.length - 1];
          if (this.activeTurnId !== lastTurn.id) {
            this.setActiveTurn(lastTurn.id);
          }
          return;
        }

        // 3. 计算视口感知基准线 (Probe Line)
        const streamRect = typeof this.streamContainer.getBoundingClientRect === 'function'
          ? this.streamContainer.getBoundingClientRect()
          : { top: 0, bottom: 600, height: 600 };
        const probeY = streamRect.top + Math.min(120, (streamRect.height || 600) * 0.25);

        // 4. 收集各轮次在视口坐标系中的起始位置
        const turnPositions = [];
        for (let i = 0; i < this.turns.length; i++) {
          const turn = this.turns[i];
          const topEl = turn.userEl || turn.responseEl;
          if (topEl && typeof topEl.getBoundingClientRect === 'function') {
            const rect = topEl.getBoundingClientRect();
            turnPositions.push({ index: i, turn, top: rect.top });
          }
        }

        if (turnPositions.length === 0) return;

        // 5. 单调分段阶梯判定 (Monotonic Step Partitioning)：
        // 只要 probeY >= 当前轮次顶部且尚未到达下一轮顶部，严格锁定当前轮次，消除真空隙缝跳动
        let targetTurn = turnPositions[0].turn;
        for (let i = 0; i < turnPositions.length; i++) {
          const cur = turnPositions[i];
          const next = turnPositions[i + 1];

          if (probeY >= cur.top) {
            if (!next || probeY < next.top) {
              targetTurn = cur.turn;
              break;
            }
          }
        }

        if (targetTurn && targetTurn.id !== this.activeTurnId) {
          this.setActiveTurn(targetTurn.id);
        }
      }, 50);
    }

    /**
     * 从 DOM 容器中重新反向解析所有已渲染的轮次 (包含工具调用与状态深度还原)
     */
    rebuildFromDOM() {
      this.clear();
      if (!this.streamContainer) return [];

      let userBubbles = [];
      if (typeof this.streamContainer.querySelectorAll === 'function') {
        try {
          const res = this.streamContainer.querySelectorAll('.user-msg-bubble, .user-message, [data-turn-user]');
          userBubbles = Array.from(res || []);
        } catch (e) {
          userBubbles = [];
        }
        if (userBubbles.length === 0) {
          const resA = this.streamContainer.querySelectorAll('.user-msg-bubble');
          userBubbles = Array.from(resA || []);
        }
      }

      userBubbles.forEach((uEl, idx) => {
        const customId = uEl.getAttribute && (uEl.getAttribute('data-turn-id') || uEl.getAttribute('data-id'));
        const turnId = customId || (idx + 1);
        const text = (uEl.textContent || '').trim();

        // 优先匹配紧随其后的响应块，或向后穿透跨过非用户气泡元素，或同 turn-id 匹配
        let rEl = null;
        let sibling = uEl.nextElementSibling;
        while (sibling && !sibling.classList?.contains('user-msg-bubble') && !sibling.classList?.contains('user-message')) {
          if (sibling.classList?.contains('agent-response-block') || sibling.classList?.contains('agent-response')) {
            rEl = sibling;
            break;
          }
          sibling = sibling.nextElementSibling;
        }

        if (!rEl && customId && this.streamContainer.querySelector) {
          rEl = this.streamContainer.querySelector(`.agent-response-block[data-turn-id="${customId}"], .agent-response[data-turn-id="${customId}"]`);
        }

        let status = 'done';
        const toolCalls = [];

        if (rEl && rEl.querySelectorAll) {
          // 深度反查恢复工具调用节点
          const toolNodes = rEl.querySelectorAll('.tool-tree-node, [data-tool-name], .tool-call-card');
          toolNodes.forEach(tNode => {
            const rawName = tNode.getAttribute && (tNode.getAttribute('data-tool-name') || tNode.getAttribute('data-tool') || tNode.getAttribute('data-id'));
            const titleEl = tNode.querySelector ? tNode.querySelector('.node-title, .tool-title') : null;
            const title = titleEl ? titleEl.textContent : (rawName || 'tool');
            let name = rawName || 'tool';
            if (/^step_\d+$/i.test(name) || /^call_[a-zA-Z0-9]+$/i.test(name)) {
              const matched = title.match(/(?:调用|执行|Executing|Executed):\s*([a-zA-Z0-9_]+)/i);
              if (matched && matched[1]) {
                name = matched[1];
              }
            }
            if (!toolCalls.some(t => t.name === name)) {
              toolCalls.push({ name, title });
            }
          });

          // 反查状态
          if ((rEl.querySelector && rEl.querySelector('.agent-error-card')) || rEl.classList.contains('failed')) {
            status = 'failed';
          } else if (rEl.classList.contains('aborted')) {
            status = 'aborted';
          }
        }

        this.registerTurn({
          turnId,
          promptText: text,
          userEl: uEl,
          responseEl: rEl,
          status
        });

        if (toolCalls.length > 0) {
          toolCalls.forEach(t => this.recordToolCall(turnId, t));
        }
      });

      // 重建完成后主动探测视口，校准当前实际可见的活跃轮次
      if (this.turns.length > 0) {
        this._handleStreamScroll();
      }

      return this.turns;
    }

    /**
     * 清空当前所有轮次
     */
    clear() {
      this.turns = [];
      this.activeTurnId = null;
      if (this.trackEl) {
        this.trackEl.innerHTML = '';
      }
      this.updateVisibility();
    }

    /**
     * 动态控制轨道可见性：无轮次时展示空态，有轮次时展开刻度轨
     */
    updateVisibility() {
      const hasTurns = this.turns.length > 0;
      if (this.emptyEl) {
        this.emptyEl.style.display = hasTurns ? 'none' : 'flex';
      }
      if (this.trackEl) {
        this.trackEl.style.display = hasTurns ? 'flex' : 'none';
      }
      if (this.railContainer) {
        this.railContainer.setAttribute('data-turns-count', String(this.turns.length));
      }
    }

    /**
     * 获取当前所有轮次快照数据
     */
    getSummary() {
      return {
        totalTurns: this.turns.length,
        activeTurnId: this.activeTurnId,
        turns: this.turns.map(t => ({
          id: t.id,
          promptText: t.promptText,
          status: t.status,
          toolCount: t.toolCalls.length,
          hasSummary: Boolean(t.summary)
        }))
      };
    }
  }

  // 挂载至全局与模块导出
  global.PromptTurnNavigator = PromptTurnNavigator;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { PromptTurnNavigator };
  }
})(typeof window !== 'undefined' ? window : global);
