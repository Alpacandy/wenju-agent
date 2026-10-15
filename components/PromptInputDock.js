/**
 * 问矩 · 工业级交互坞 (PromptInputDock v3.0)
 * 严格 1:1 对标 ZCode prompt-input.tsx, promptHistoryStorage.ts, SlashCommandPlugin 与 attachments.tsx
 * 
 * 布局拓扑：
 * ┌──────────────────────────────────────────────────────────────┐
 * │ [提示词与命令自动索引浮层 (键入 / 或 @ 激活)]                 │
 * │ [附件胶囊托盘 (存在草图附件时展开)]                            │
 * │ [多行自适应输入框 (支持上下键浏览历史提示词)]                  │
 * ├──────────────────────────────────────────────────────────────┤
 * │ [+] [空间联动 ▾]               [● 模型选择 ▾] [深度推导 ▾] [▲]│
 * └──────────────────────────────────────────────────────────────┘
 */

class PromptHistoryManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'teachagent-chat-prompt-history';
    this.maxSize = options.maxSize || 30;
    this.history = this.load();
    this.cursor = -1;
    this.draft = '';
  }

  load() {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  save() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.history));
    } catch (_) { if (typeof recordIssue === 'function') recordIssue('PromptInputDock', 'save', _); }
  }

  add(text) {
    if (!text || typeof text !== 'string') return;
    const trimmed = text.trim();
    if (!trimmed) return;
    this.history = [trimmed, ...this.history.filter(h => h !== trimmed)].slice(0, this.maxSize);
    this.save();
    this.resetCursor();
  }

  navigate(direction, currentInput = '') {
    if (this.history.length === 0) return currentInput;

    if (direction === 'up' || direction === -1) {
      if (this.cursor === -1) {
        this.draft = currentInput;
      }
      if (this.cursor < this.history.length - 1) {
        this.cursor++;
        return this.history[this.cursor];
      }
      return this.history[this.cursor];
    } else if (direction === 'down' || direction === 1) {
      if (this.cursor > 0) {
        this.cursor--;
        return this.history[this.cursor];
      } else if (this.cursor === 0) {
        this.cursor = -1;
        return this.draft;
      }
      return currentInput;
    }
    return currentInput;
  }

  resetCursor() {
    this.cursor = -1;
    this.draft = '';
  }

  getHistory() {
    return [...this.history];
  }
}

class TriggerSuggestionEngine {
  constructor() {
    this.slashCommands = [
      { name: '/plan', label: '/plan 探究规划', desc: '开启探究规划与形式化推导模式', tag: '模式' },
      { name: '/clear', label: '/clear 清空会话', desc: '清空当前消息会话流与思考链', tag: '操作' },
      { name: '/reset', label: '/reset 矩阵重置', desc: '重置左侧画板变换为单位阵 I', tag: '画板' },
      { name: '/matrix', label: '/matrix 设定方阵', desc: '输入自定义二维方阵 [a,b; c,d]', tag: '矩阵' },
      { name: '/probe', label: '/probe 核空间探测', desc: '探测零空间 (Kernel) 与像空间 (Image)', tag: '算子' },
      { name: '/history', label: '/history 任务历史', desc: '展开会话任务历史管理抽屉', tag: '会话' },
      { name: '/effort', label: '/effort 思考强度', desc: '调节模型推理思考深度 (High/Med/Low)', tag: '配置' },
      { name: '/compact', label: '/compact 上下文压缩', desc: '压缩当前对话上下文 Token 长度', tag: '系统' },
      { name: '/help', label: '/help 助手指南', desc: '查看代数几何探究全功能操作指南', tag: '帮助' }
    ];

    this.atMentions = [
      { name: '@canvas:matrix', label: '@canvas:matrix 当前矩阵', desc: '注入当前画板矩阵数值快照 [a,b; c,d]', tag: '变量' },
      { name: '@canvas:det', label: '@canvas:det 行列式值', desc: '注入当前变换行列式与面积缩放比', tag: '变量' },
      { name: '@canvas:e1', label: '@canvas:e1 基向量 e1', desc: '注入基向量 e1 坐标 [a, c]', tag: '变量' },
      { name: '@canvas:e2', label: '@canvas:e2 基向量 e2', desc: '注入基向量 e2 坐标 [b, d]', tag: '变量' },
      { name: '@nullspace', label: '@nullspace 零空间流形', desc: '注入当前矩阵零空间基向量几何流形', tag: '几何' },
      { name: '@eigen', label: '@eigen 特征值与特征向量', desc: '注入当前矩阵特征值与特征向量几何流形', tag: '几何' },
      { name: '@shear', label: '@shear 切变变换', desc: '注入二维水平/垂直切变变换探究模板', tag: '模板' },
      { name: '@rotation', label: '@rotation 旋转变换', desc: '注入二维正交旋转变换探究模板', tag: '模板' }
    ];
  }

  scoreFuzzyMatch(str, query) {
    if (!query) return 100;
    const s = str.toLowerCase();
    const q = query.toLowerCase();

    if (s === q) return 1000;
    if (s.startsWith(q)) return 500 - s.indexOf(q);
    const subIdx = s.indexOf(q);
    if (subIdx !== -1) return 300 - subIdx;

    let sIdx = 0;
    let qIdx = 0;
    let score = 0;
    let consecutive = 0;

    while (sIdx < s.length && qIdx < q.length) {
      if (s[sIdx] === q[qIdx]) {
        score += 10 + (consecutive * 5);
        consecutive++;
        qIdx++;
      } else {
        consecutive = 0;
      }
      sIdx++;
    }

    if (qIdx === q.length) {
      return score;
    }
    return -1;
  }

  query(triggerChar, rawQuery = '') {
    const isSlash = triggerChar === '/';
    const list = isSlash ? this.slashCommands : this.atMentions;
    const cleanQ = rawQuery.startsWith('/') || rawQuery.startsWith('@') ? rawQuery.slice(1) : rawQuery;

    if (!cleanQ) {
      return list.map(item => ({ item, score: 100 }));
    }

    const results = [];
    for (const item of list) {
      const nameClean = item.name.slice(1);
      const nameScore = this.scoreFuzzyMatch(nameClean, cleanQ);
      const labelScore = this.scoreFuzzyMatch(item.label, cleanQ);
      const descScore = this.scoreFuzzyMatch(item.desc, cleanQ);

      const maxScore = Math.max(nameScore, labelScore > 0 ? labelScore - 50 : -1, descScore > 0 ? descScore - 100 : -1);
      if (maxScore > 0) {
        results.push({ item, score: maxScore });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }
}

class PromptInputDock {
  constructor({ containerId, container, onSubmit, onAttachmentChange, onAbort, fsm = null } = {}) {
    this.container = (container && typeof container === 'object') ? container :
                     (containerId && typeof containerId === 'object') ? containerId :
                     (typeof document !== 'undefined' && containerId ? document.getElementById(containerId) : null);
    this.onSubmit = onSubmit;
    this.onAttachmentChange = onAttachmentChange;
    this.onAbort = onAbort;
    this.fsm = fsm || (typeof window !== 'undefined' && window.studioFSM ? window.studioFSM : null);
    this.attachments = [];
    this.isComposing = false;
    this.currentModelId = null;

    // ZCode 级历史记录与自动提示词索引引擎
    this.promptHistory = new PromptHistoryManager();
    this.triggerEngine = new TriggerSuggestionEngine();
    this.triggerActiveIndex = 0;
    this.currentTriggerMatches = [];
    this.currentTriggerInfo = null;
    this.reasoningEffort = 'medium';

    if (this.container) {
      this.initDOM();
      this.bindEvents();
      this.bindFSM();
    }
  }

  initDOM() {
    this.container.innerHTML = `
      <div class="zcode-prompt-card">
        <!-- 附件胶囊预览托盘 (ZCode Attachments Container) -->
        <div class="attachment-tray hidden" id="dock-attachment-tray"></div>

        <!-- 提示词与命令自动索引浮层 (对标 ZCode SlashCommandPlugin & Mentions) -->
        <div class="dock-trigger-popover hidden" id="dock-trigger-popover">
          <div class="trigger-popover-header">
            <span id="trigger-header-title">提示词与命令索引</span>
            <span class="trigger-popover-count" id="trigger-header-count">0 项</span>
          </div>
          <div class="trigger-popover-list" id="dock-trigger-list"></div>
          <div class="trigger-popover-footer">
            <span>↑↓ 导航选择</span>
            <span>Enter / Tab 补全</span>
            <span>Esc 关闭</span>
          </div>
        </div>
        
        <!-- 1. 顶部纯文本/草图输入核心区 -->
        <div class="dock-input-area">
          <textarea 
            id="dock-textarea" 
            class="zcode-textarea" 
            rows="1" 
            maxlength="16000" placeholder="输入代数猜想，/ 查看命令，@ 引用变量…"
          ></textarea>
        </div>

        <!-- 2. 底部功能控制条 (对标 ZCode 架构) -->
        <div class="dock-bottom-toolbar">
          <!-- 左侧：附件添加与空间环境联动 -->
          <div class="toolbar-left-group">
            <button type="button" class="dock-tool-btn dock-btn-plus" id="dock-btn-clip" disabled aria-label="图片识别暂不可用，请使用文字提问" title="图片识别暂不可用，请使用文字提问">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            </button>
            <input type="file" id="dock-file-input" accept="image/*" class="hidden" style="display:none;">

            <div class="dock-pill-badge" id="dock-env-badge" title="切换 Agent 环境与沙箱执行权限">
              <span class="dock-badge-shield" id="dock-access-icon">🛡️</span>
              <span class="dock-badge-text" id="dock-access-label">完全访问</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>
          </div>

          <!-- 右侧：当前模型微标、思考强度与黑色发送/停止按钮 (对标 ZCode 图2) -->
          <div class="toolbar-right-group">
            <div class="dock-model-pill" id="dock-model-selector" title="点击展开模型切换菜单">
              <span class="dock-model-dot"></span>
              <span id="dock-current-model-text">Qwen2.5-7B</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>

            <div class="dock-reasoning-pill" id="dock-reasoning-btn" title="推理强度配置">
              <span class="reasoning-spark-icon">🧠</span>
              <span id="dock-reasoning-label">中等</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </div>

            <button type="button" class="dock-btn-send-square" id="dock-btn-send" title="发送代数推导指令 (Enter)">
              <svg class="send-arrow-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>
        </div>

        <!-- 真实环境访问级别选择浮层 (Access Level Popover) -->
        <div class="zcode-access-popover hidden" id="dock-access-popover">
          <div class="popover-group-label">执行权限与工作台安全控制</div>
          <div class="popover-access-list">
            <div class="popover-access-row selected" data-level="full">
              <div class="popover-access-left">
                <span class="row-access-icon">🛡️</span>
                <div>
                  <div class="row-access-name">完全访问 (Full Access)</div>
                  <div class="row-access-desc">允许 Agent 自主驱动画板变换与执行代码沙箱</div>
                </div>
              </div>
              <span class="row-check">✓</span>
            </div>
            <div class="popover-access-row" data-level="ask">
              <div class="popover-access-left">
                <span class="row-access-icon">⚠️</span>
                <div>
                  <div class="row-access-name">确认后执行 (Ask Before Run)</div>
                  <div class="row-access-desc">驱动几何画板或沙箱写操作前先提示确认</div>
                </div>
              </div>
              <span class="row-check hidden">✓</span>
            </div>
            <div class="popover-access-row" data-level="readonly">
              <div class="popover-access-left">
                <span class="row-access-icon">👁️</span>
                <div>
                  <div class="row-access-name">只读观察 (Read Only)</div>
                  <div class="row-access-desc">仅输出文字推导，禁止任何画板或沙箱写操作</div>
                </div>
              </div>
              <span class="row-check hidden">✓</span>
            </div>
          </div>
        </div>

        <!-- 推理深度选择浮层 (Reasoning Effort Popover) -->
        <div class="dock-reasoning-popover hidden" id="dock-reasoning-popover">
          <div class="popover-group-label">模型推理深度与思考链配置</div>
          <div class="popover-reasoning-list">
            <div class="popover-reasoning-row" data-effort="high">
              <div class="popover-model-left">
                <span class="effort-icon">🧠</span>
                <div class="effort-info">
                  <div class="effort-name">最高 (High)</div>
                  <div class="effort-desc">完整深入推演与多步反思纠错</div>
                </div>
              </div>
              <span class="row-check">✓</span>
            </div>
            <div class="popover-reasoning-row" data-effort="medium">
              <div class="popover-model-left">
                <span class="effort-icon">⚡</span>
                <div class="effort-info">
                  <div class="effort-name">适中 (Medium)</div>
                  <div class="effort-desc">标准思维链推演，平衡速度与深度</div>
                </div>
              </div>
              <span class="row-check hidden">✓</span>
            </div>
            <div class="popover-reasoning-row" data-effort="low">
              <div class="popover-model-left">
                <span class="effort-icon">🌱</span>
                <div class="effort-info">
                  <div class="effort-name">精简 (Low)</div>
                  <div class="effort-desc">紧凑推导，低延迟快速响应</div>
                </div>
              </div>
              <span class="row-check hidden">✓</span>
            </div>
            <div class="popover-reasoning-row" data-effort="none">
              <div class="popover-model-left">
                <span class="effort-icon">🚀</span>
                <div class="effort-info">
                  <div class="effort-name">关闭 (None)</div>
                  <div class="effort-desc">不使用思维链，直接给出最终结果</div>
                </div>
              </div>
              <span class="row-check hidden">✓</span>
            </div>
          </div>
        </div>

        <!-- 模型切换浮层菜单 -->
        <div class="zcode-model-popover hidden" id="dock-model-popover">
          <div class="popover-model-list" id="dock-popover-model-list"></div>
          <div class="popover-divider"></div>
          <button type="button" class="popover-item-manage" id="dock-popover-btn-manage">
            <span class="manage-text">⚙️ 管理模型与自定义 Key...</span>
          </button>
        </div>
      </div>
    `;

    this.textarea = this.container.querySelector('#dock-textarea');
    this.tray = this.container.querySelector('#dock-attachment-tray');
    this.btnClip = this.container.querySelector('#dock-btn-clip');
    this.fileInput = this.container.querySelector('#dock-file-input');
    this.btnSend = this.container.querySelector('#dock-btn-send');
    this.modelSelector = this.container.querySelector('#dock-model-selector');
    this.modelText = this.container.querySelector('#dock-current-model-text');
    this.popover = this.container.querySelector('#dock-model-popover');
    this.popoverModelList = this.container.querySelector('#dock-popover-model-list');
    this.btnManageModels = this.container.querySelector('#dock-popover-btn-manage');

    // 提示词与命令自动索引浮层元素
    this.triggerPopover = this.container.querySelector('#dock-trigger-popover');
    this.triggerList = this.container.querySelector('#dock-trigger-list');
    this.triggerHeaderTitle = this.container.querySelector('#trigger-header-title');
    this.triggerHeaderCount = this.container.querySelector('#trigger-header-count');

    // 推理深度选择元素与初始配置
    this.reasoningBtn = this.container.querySelector('#dock-reasoning-btn');
    this.reasoningLabel = this.container.querySelector('#dock-reasoning-label');
    this.reasoningPopover = this.container.querySelector('#dock-reasoning-popover');

    let savedEffort = 'medium';
    try {
      savedEffort = localStorage.getItem('teachagent_reasoning_effort') || 'medium';
    } catch (_) { if (typeof recordIssue === 'function') recordIssue('PromptInputDock', 'initDOM', _); }
    this.setReasoningEffort(savedEffort, false);

    // 权限浮层相关元素与初始权限 (持久化与全局同步)
    this.btnAccess = this.container.querySelector('#dock-env-badge');
    this.accessIcon = this.container.querySelector('#dock-access-icon');
    this.accessLabel = this.container.querySelector('#dock-access-label');
    this.accessPopover = this.container.querySelector('#dock-access-popover');
    
    let savedAccess = 'full';
    try {
      savedAccess = localStorage.getItem('prompt_dock_access_level') || (window.currentAccessLevel || 'full');
    } catch (e) {
      savedAccess = window.currentAccessLevel || 'full';
    }
    this.currentAccessLevel = savedAccess;

    // 渲染模型列表并同步当前模型及权限状态
    this.renderPopoverModels();
    this.syncCurrentModelLabel();
    this.bindAccessEvents();
    this.bindReasoningEvents();
    this.setAccessLevel(this.currentAccessLevel, false);
  }

  bindAccessEvents() {
    if (!this.btnAccess || !this.accessPopover) return;

    // 点击安全微标切换浮层展开/收起
    this.btnAccess.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.popover) this.popover.classList.add('hidden');
      this.accessPopover.classList.toggle('hidden');
    });

    // 绑定选项点击事件
    const rows = this.accessPopover.querySelectorAll('.popover-access-row');
    rows.forEach(row => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const level = row.getAttribute('data-level');
        this.setAccessLevel(level, true);
        this.accessPopover.classList.add('hidden');
      });
    });

    // 点击页面任意外部区域收起权限浮层
    document.addEventListener('click', (e) => {
      if (this.accessPopover && !this.accessPopover.classList.contains('hidden')) {
        if (!this.accessPopover.contains(e.target) && !this.btnAccess.contains(e.target)) {
          this.accessPopover.classList.add('hidden');
        }
      }
    });
  }

  setAccessLevel(level, notifyEngine = true) {
    const validLevels = ['full', 'ask', 'readonly'];
    if (!validLevels.includes(level)) level = 'full';
    this.currentAccessLevel = level;

    // 1. 持久化到 localStorage 与 window
    try {
      localStorage.setItem('prompt_dock_access_level', level);
    } catch (e) { if (typeof recordIssue === 'function') recordIssue('PromptInputDock', 'setAccessLevel', e); }
    if (typeof window !== 'undefined') {
      window.currentAccessLevel = level;
    }

    // 2. 更新输入坞左下角徽标文本与图标
    const accessMeta = {
      full: { icon: '🛡️', label: '完全访问', tip: '完全访问：允许 Agent 自主驱动画板与执行代码沙箱' },
      ask: { icon: '⚠️', label: '确认执行', tip: '确认执行：驱动几何画板或代码沙箱前需确认' },
      readonly: { icon: '👁️', label: '只读观察', tip: '只读观察：仅允许文字推导，安全拦截所有画板与代码写操作' }
    };

    const cur = accessMeta[level] || accessMeta.full;
    if (this.accessIcon) this.accessIcon.textContent = cur.icon;
    if (this.accessLabel) this.accessLabel.textContent = cur.label;
    if (this.btnAccess) this.btnAccess.title = cur.tip;

    // 3. 更新浮层列表中的选中状态与对勾
    if (this.accessPopover) {
      const rows = this.accessPopover.querySelectorAll('.popover-access-row');
      rows.forEach(row => {
        const rowLevel = row.getAttribute('data-level');
        const isCur = (rowLevel === level);
        row.classList.toggle('selected', isCur);
        const checkEl = row.querySelector('.row-check');
        if (checkEl) {
          checkEl.classList.toggle('hidden', !isCur);
        }
      });
    }

    // 4. 同步至 AgentEngine 底座 (真机生效拦截)
    if (notifyEngine && typeof window !== 'undefined' && typeof window.getAgentEngine === 'function') {
      const engine = window.getAgentEngine();
      if (engine && typeof engine.setAccessLevel === 'function') {
        engine.setAccessLevel(level);
      }
    }
  }

  getPresetModels() {
    // 模型清单以 ModelCatalog 内置 MiniMax 为主，并动态融合当前外部 Provider 预设
    const MC = (typeof window !== 'undefined' && window.ModelCatalog) || null;
    if (!MC || typeof MC.getMinimaxModels !== 'function') return [];
    const minimax = MC.getMinimaxModels() || [];
    const provider = (typeof window !== 'undefined' && window.getAgentEngine?.()?.config?.provider) || '';
    const providerModels = (MC.getProviderModels && MC.getProviderModels(provider)) || [];
    const combined = [...minimax];
    for (const pm of providerModels) {
      if (!combined.some(x => x.id === pm.id)) combined.push(pm);
    }
    return combined.map((m) => ({
      id: m.id,
      name: m.shortName || m.name,
      fullName: m.name,
      agent: m.supportsTools === true,
      isDefault: !!m.isDefault,
      disabled: !!m.disabled,
      disabledReason: m.disabledReason
    }));
  }

  _catalogDefaultModelId() {
    const MC = (typeof window !== 'undefined' && window.ModelCatalog) || null;
    const d = MC && typeof MC.getDefaultModel === 'function' ? MC.getDefaultModel() : null;
    return d ? d.id : 'MiniMax-M3.1-Flash-Preview';
  }

  _sanitizeModelId(id) {
    const MC = (typeof window !== 'undefined' && window.ModelCatalog) || null;
    let apiKey = '';
    let providerId = '';
    if (typeof window !== 'undefined') {
      if (window.getAgentEngine && typeof window.getAgentEngine === 'function') {
        const eng = window.getAgentEngine();
        if (eng && eng.config) {
          apiKey = eng.config.apiKey || '';
          providerId = eng.config.provider || '';
        }
      }
      if (!apiKey && window.modelClient && window.modelClient.config) {
        apiKey = window.modelClient.config.apiKey || '';
        providerId = window.modelClient.config.providerId || providerId;
      }
    }
    if (MC && typeof MC.validateModel === 'function') {
      const v = MC.validateModel(id, apiKey, providerId);
      if (v && v.modelId) {
        return v.modelId;
      }
    }
    return id || this._catalogDefaultModelId();
  }

  renderPopoverModels() {
    if (!this.popoverModelList) return;
    const currentModel = this.getCurrentModelId();
    const models = this.getPresetModels();

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const rowHtml = (m) => {
      const isSelected = m.id === currentModel;
      const isDisabled = !!m.disabled;
      const tag = m.agent
        ? (m.isDefault ? '<span class="row-model-tag">内置推荐</span>' : '')
        : (isDisabled
            ? '<span class="row-model-tag" style="background:#fee2e2;color:#ef4444;font-weight:500;">B3-4前暂不可选</span>'
            : '<span class="row-model-tag" style="background:#f1f5f9;color:#64748b;font-weight:500;">不驱动画板</span>');
      return `
        <div class="popover-model-row ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}" data-model-id="${esc(m.id)}" ${isDisabled ? 'data-disabled="true"' : ''} style="${isDisabled ? 'opacity: 0.55; cursor: not-allowed;' : ''}" title="${esc((m.fullName || m.name) + ' (' + m.id + ')' + (isDisabled ? ' · 暂不可选' : ''))}">
          <div class="popover-model-left" style="min-width:0;">
            <span class="row-model-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(m.name)}</span>
            ${tag}
          </div>
          <div class="popover-model-right">
            ${isSelected ? '<span class="row-check">✓</span>' : ''}
          </div>
        </div>
      `;
    };
    const groupLabel = (t) => `<div class="popover-model-group-label" style="padding:6px 10px 2px;font-size:10.5px;font-weight:600;color:#94a3b8;">${t}</div>`;
    const minimaxModels = models.filter((m) => /minimax/i.test(m.id));
    const agentModels = models.filter((m) => m.agent && !/minimax/i.test(m.id));
    const chatOnlyModels = models.filter((m) => !m.agent && !/minimax/i.test(m.id));

    const isCustomModelActive = !models.some(m => m.id === currentModel);
    let customModelRowHtml = '';
    if (isCustomModelActive && currentModel) {
      customModelRowHtml = groupLabel('当前自定义模型') + `
        <div class="popover-model-row selected" data-model-id="${esc(currentModel)}" title="${esc(currentModel)}">
          <div class="popover-model-left" style="min-width:0;">
            <span class="row-model-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#0284c7;">${esc(currentModel)}</span>
            <span class="row-model-tag" style="background:#e0f2fe;color:#0284c7;font-weight:500;">自定义端点</span>
          </div>
          <div class="popover-model-right">
            <span class="row-check">✓</span>
          </div>
        </div>
      `;
    }

    const otherPresetModels = models.filter((m) => !/minimax/i.test(m.id));

    this.popoverModelList.innerHTML =
      customModelRowHtml +
      (minimaxModels.length ? groupLabel('MiniMax 深度推理 (系统内置 · 开箱即用)') + minimaxModels.map(rowHtml).join('') : '') +
      (otherPresetModels.length ? groupLabel('外部服务商预设 (用户自备 Key)') + otherPresetModels.map(rowHtml).join('') : '') +
      `<div class="popover-model-settings-link" style="padding:8px 12px;margin-top:4px;border-top:1px solid #e2e8f0;font-size:11.5px;color:#0284c7;cursor:pointer;display:flex;align-items:center;justify-content:space-between;">
        <span>⚙ 配置服务商 Key / 外部端点...</span>
        <span>→</span>
      </div>`;

    this.popoverModelList.querySelectorAll('.popover-model-row').forEach(row => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (row.getAttribute('data-disabled') === 'true' || row.classList.contains('disabled')) {
          console.warn('[PromptInputDock] 该模型暂不可选，已保留推荐主力模型');
          return;
        }
        const modelId = row.getAttribute('data-model-id');
        this.selectModel(modelId);
      });
    });

    const settingsLink = (typeof this.popoverModelList.querySelector === 'function')
      ? this.popoverModelList.querySelector('.popover-model-settings-link')
      : null;
    if (settingsLink) {
      settingsLink.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideModelPopover();
        if (typeof window !== 'undefined' && typeof window.openApiModal === 'function') {
          window.openApiModal();
        }
      });
    }
  }

  getCurrentModelId() {
    if (this.currentModelId) {
      this.currentModelId = this._sanitizeModelId(this.currentModelId);
      return this.currentModelId;
    }
    if (typeof window !== 'undefined' && window.modelClient && typeof window.modelClient.getConfig === 'function') {
      const id = window.modelClient.getConfig().modelId;
      if (id) {
        this.currentModelId = this._sanitizeModelId(id);
        return this.currentModelId;
      }
    }
    if (typeof window !== 'undefined' && typeof window.getAgentEngine === 'function') {
      const engine = window.getAgentEngine();
      if (engine && typeof engine.getConfig === 'function') {
        const id = engine.getConfig().model;
        if (id) {
          this.currentModelId = this._sanitizeModelId(id);
          return this.currentModelId;
        }
      }
    }
    try {
      if (typeof localStorage !== 'undefined') {
        const savedAgent = localStorage.getItem('wenju_agent_config');
        if (savedAgent) {
          const parsed = JSON.parse(savedAgent);
          if (parsed && parsed.model) {
            this.currentModelId = this._sanitizeModelId(parsed.model);
            return this.currentModelId;
          }
        }
        const savedClient = localStorage.getItem('wenju_model_client_config');
        if (savedClient) {
          const parsed = JSON.parse(savedClient);
          if (parsed && parsed.modelId) {
            this.currentModelId = this._sanitizeModelId(parsed.modelId);
            return this.currentModelId;
          }
        }
      }
    } catch (e) { if (typeof recordIssue === 'function') recordIssue('PromptInputDock', 'if', e); }
    this.currentModelId = this._catalogDefaultModelId();
    return this.currentModelId;
  }

  selectModel(modelId) {
    if (!modelId) return;
    const sanitizedId = this._sanitizeModelId(modelId);
    this.currentModelId = sanitizedId;
    const isMinimax = /minimax/i.test(sanitizedId);

    // 保护已有自定义或官方端点（如 deepseek_official, custom, openai_official）
    let currentProvider = '';
    let currentBaseUrl = '';
    let currentApiKey = '';
    if (typeof window !== 'undefined') {
      const activeClientCfg = (window.modelClient && typeof window.modelClient.getConfig === 'function') ? window.modelClient.getConfig() : {};
      const activeEngineCfg = (window.getAgentEngine && window.getAgentEngine()?.config) || {};
      currentProvider = activeClientCfg.providerId || activeEngineCfg.provider || '';
      currentBaseUrl = activeClientCfg.baseURL || activeEngineCfg.baseURL || '';
      currentApiKey = activeClientCfg.apiKey || activeEngineCfg.apiKey || '';
    }
    const isCustomOrExternal = ['custom', 'deepseek_official', 'openai_official'].includes(currentProvider);
    const targetProvider = isCustomOrExternal && !isMinimax ? currentProvider : 'minimax';
    const targetBaseUrl = (isCustomOrExternal && currentBaseUrl && !isMinimax) ? currentBaseUrl : 'https://api.botmeow.top/v1';

    let targetApiKey = (currentApiKey && targetProvider === currentProvider) ? currentApiKey : '';
    try {
      if (typeof localStorage !== 'undefined') {
        const provConfigs = JSON.parse(localStorage.getItem('teachagent_provider_configs') || '{}');
        if (provConfigs[targetProvider]?.apiKey) {
          targetApiKey = provConfigs[targetProvider].apiKey;
        } else {
          const savedAgent = JSON.parse(localStorage.getItem('wenju_agent_config') || '{}');
          if (savedAgent.provider === targetProvider && savedAgent.apiKey) {
            targetApiKey = savedAgent.apiKey;
          } else {
            const savedClient = JSON.parse(localStorage.getItem('wenju_model_client_config') || '{}');
            if (savedClient.providerId === targetProvider && savedClient.apiKey) {
              targetApiKey = savedClient.apiKey;
            }
          }
        }
      }
    } catch (err) {
      if (typeof recordIssue === 'function') {
        recordIssue('PromptInputDock', 'loadSavedApiKey', err);
      }
    }

    if (typeof window !== 'undefined' && window.modelClient && typeof window.modelClient.saveConfig === 'function') {
      window.modelClient.saveConfig({
        modelId: sanitizedId,
        baseURL: targetBaseUrl,
        apiKey: targetApiKey,
        providerId: targetProvider
      });
    }
    if (typeof window !== 'undefined' && typeof window.getAgentEngine === 'function') {
      const engine = window.getAgentEngine();
      if (engine && typeof engine.saveConfig === 'function') {
        engine.saveConfig({
          model: sanitizedId,
          baseUrl: targetBaseUrl,
          apiKey: targetApiKey,
          provider: targetProvider
        });
      }
      if (engine && engine.modelClient && typeof engine.modelClient.saveConfig === 'function') {
        engine.modelClient.saveConfig({
          modelId: sanitizedId,
          baseURL: targetBaseUrl,
          apiKey: targetApiKey,
          providerId: targetProvider
        });
      }
    }

    try {
      if (typeof localStorage !== 'undefined') {
        let agentCfg = {
          provider: targetProvider,
          model: sanitizedId,
          apiKey: targetApiKey,
          baseUrl: targetBaseUrl,
          temperature: 0.7
        };
        const savedAgent = localStorage.getItem('wenju_agent_config');
        if (savedAgent) {
          try {
            const parsed = JSON.parse(savedAgent);
            if (isMinimax) {
              agentCfg.provider = 'minimax';
              if (!agentCfg.baseUrl) agentCfg.baseUrl = 'https://api.botmeow.top/v1';
            } else if (isCustomOrExternal) {
              agentCfg.provider = currentProvider;
              if (currentBaseUrl) agentCfg.baseUrl = currentBaseUrl;
            } else {
              agentCfg.provider = 'custom';
            }
          } catch (e) { if (typeof recordIssue === 'function') recordIssue('PromptInputDock', 'if', e); }
        }
        localStorage.setItem('wenju_agent_config', JSON.stringify(agentCfg));

        let clientCfg = {
          providerId: targetProvider,
          baseURL: targetBaseUrl,
          apiKey: targetApiKey,
          modelId: sanitizedId,
          temperature: 0.7,
          maxTokens: 2048,
          stream: true
        };
        const savedClient = localStorage.getItem('wenju_model_client_config');
        if (savedClient) {
          try {
            const parsed = JSON.parse(savedClient);
            clientCfg = { ...clientCfg, ...parsed, modelId: sanitizedId };
            if (isMinimax) {
              clientCfg.providerId = 'minimax';
              if (!clientCfg.baseURL) clientCfg.baseURL = 'https://api.botmeow.top/v1';
            } else if (isCustomOrExternal) {
              clientCfg.providerId = currentProvider;
              if (currentBaseUrl) clientCfg.baseURL = currentBaseUrl;
            } else {
              clientCfg.providerId = 'custom';
            }
          } catch (e) { if (typeof recordIssue === 'function') recordIssue('PromptInputDock', 'if', e); }
        }
        localStorage.setItem('wenju_model_client_config', JSON.stringify(clientCfg));
      }
    } catch (e) {
      console.warn('[PromptInputDock] Failed to persist modelId:', e);
    }

    if (typeof document !== 'undefined') {
      const cfgModelSelect = document.getElementById('cfg-model-select');
      const cfgModel = document.getElementById('cfg-model');
      if (cfgModelSelect) {
        let matched = false;
        for (let opt of cfgModelSelect.options) {
          if (opt.value === modelId) {
            cfgModelSelect.value = modelId;
            matched = true;
            break;
          }
        }
        if (!matched) {
          cfgModelSelect.value = 'custom_input';
        }
      }
      if (cfgModel) {
        cfgModel.value = modelId;
      }
    }

    this.syncCurrentModelLabel();
    this.renderPopoverModels();
    if (this.popover) this.popover.classList.add('hidden');
    if (typeof window !== 'undefined' && typeof window.updateAgentModeUI === 'function') {
      window.updateAgentModeUI();
    }
  }

  syncCurrentModelLabel() {
    if (!this.modelText) return;
    const currentId = this.getCurrentModelId();
    const hit = this.getPresetModels().find(m => m.id === currentId);
    this.modelText.title = hit ? (hit.fullName || hit.name) + ' (' + hit.id + ')' : currentId;
    if (hit) {
      this.modelText.textContent = hit.name;
    } else {
      const short = currentId.split('/').pop();
      this.modelText.textContent = short;
    }
    this.syncImageCapability();
  }

  canAcceptVision() {
    const modelId = this.getCurrentModelId();
    let MC = null;
    if (typeof window !== 'undefined' && window.ModelCatalog) {
      MC = window.ModelCatalog;
    } else if (typeof require !== 'undefined') {
      try {
        MC = require('../js/models/ModelCatalog.js').ModelCatalog;
      } catch (err) {
        MC = null;
      }
    }
    if (MC && typeof MC.supportsVision === 'function') {
      return MC.supportsVision(modelId);
    }
    return false;
  }

  syncImageCapability(isBusy = false) {
    const canVision = this.canAcceptVision();
    if (this.btnClip) {
      this.btnClip.disabled = isBusy || !canVision;
      const label = canVision ? '添加图片附件或粘贴草图' : '图片识别暂不可用，请使用文字提问';
      if (typeof this.btnClip.setAttribute === 'function') {
        this.btnClip.setAttribute('aria-label', label);
        this.btnClip.setAttribute('title', label);
      } else {
        this.btnClip.title = label;
      }
    }
    if (this.textarea) {
      this.textarea.placeholder = canVision
        ? '输入代数猜想，/ 查看命令，支持粘贴草图或批注…'
        : '输入代数猜想，/ 查看命令，@ 引用变量…';
    }
  }

  bindFSM() {
    if (!this.fsm || typeof this.fsm.subscribe !== 'function') return;
    this.fsm.subscribe((state) => {
      const isBusy = (state === 'DISPATCHING' || state === 'STREAMING');
      if (this.btnSend) {
        if (isBusy) {
          this.btnSend.classList.add('is-busy');
          this.btnSend.title = '推理流生成中 (点击终止)';
          this.btnSend.innerHTML = `
            <span class="dock-square-stop"></span>
          `;
        } else {
          this.btnSend.classList.remove('is-busy');
          this.btnSend.title = '发送代数推导指令 (Enter)';
          this.btnSend.innerHTML = `
            <svg class="send-arrow-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"></line>
              <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
          `;
        }
      }
      if (this.btnClip) {
        this.syncImageCapability(isBusy);
      }
    });
  }

  bindEvents() {
    // 1. 剪贴板图片直接粘贴 (Ctrl+V)
    if (this.textarea) {
      this.textarea.addEventListener('paste', (e) => this.handlePaste(e));
    }

    // 全局工作台范围内的图片粘贴守卫
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('paste', (e) => {
        if (this.textarea && document.activeElement !== this.textarea && this.container && this.container.offsetParent !== null) {
          const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
          let hasImage = false;
          if (items) {
            for (const item of items) {
              if (item.type.indexOf('image') !== -1) {
                hasImage = true;
                break;
              }
            }
          }
          if (hasImage) {
            this.handlePaste(e);
          }
        }
      });
    }

    // 2. 文件选择按钮与拖拽装载 (Drag & Drop)
    if (this.btnClip && this.fileInput) {
      this.btnClip.addEventListener('click', () => {
        if (!this.btnClip.disabled) this.fileInput.click();
      });
      this.fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
    }

    if (this.container && typeof this.container.addEventListener === 'function') {
      const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        this.container.classList.add('dock-drag-over');
      };
      const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.container.classList.remove('dock-drag-over');
      };
      const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.container.classList.remove('dock-drag-over');
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          for (const file of files) {
            this.addFileAttachment(file);
          }
        }
      };

      this.container.addEventListener('dragenter', handleDragOver);
      this.container.addEventListener('dragover', handleDragOver);
      this.container.addEventListener('dragleave', handleDragLeave);
      this.container.addEventListener('drop', handleDrop);
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types?.includes?.('Files')) e.preventDefault();
      }, false);
      window.addEventListener('drop', (e) => {
        if (e.dataTransfer?.types?.includes?.('Files') && !this.container?.contains?.(e.target)) {
          e.preventDefault();
        }
      }, false);
    }

    // 3. 点击模型选择胶囊，弹出/收起 ZCode 模型浮层菜单 (图2)
    if (this.modelSelector && this.popover) {
      this.modelSelector.addEventListener('click', (e) => {
        e.stopPropagation();
        this.renderPopoverModels();
        this.popover.classList.toggle('hidden');
      });
    }

    // 点击管理模型按钮，打开完整的 API Key 与 Provider 设置弹窗 (真实对接 api-settings-modal)
    if (this.btnManageModels) {
      this.btnManageModels.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.popover) this.popover.classList.add('hidden');
        if (typeof window.openApiModal === 'function') {
          window.openApiModal();
        } else {
          const modal = document.getElementById('api-settings-modal');
          if (modal) modal.classList.remove('hidden');
        }
      });
    }

    // 点击任意非浮层区域自动收起菜单
    document.addEventListener('click', (e) => {
      if (this.popover && !this.popover.classList.contains('hidden')) {
        if (!this.popover.contains(e.target) && !this.modelSelector.contains(e.target)) {
          this.popover.classList.add('hidden');
        }
      }
    });

    // 4. 键盘事件与触发词索引绑定
    this.bindTriggerEvents();

    if (this.textarea) {
      // 5. 输入高度自适应与状态机通知
      this.textarea.addEventListener('input', () => {
        this.textarea.style.height = 'auto';
        const newHeight = Math.min(Math.max(this.textarea.scrollHeight, 36), 140);
        this.textarea.style.height = newHeight + 'px';

        if (this.fsm && window.StudioEvents) {
          this.fsm.transition(window.StudioEvents.INPUT_CHANGED, {
            text: this.textarea.value,
            attachments: this.attachments
          });
        }
      });
    }

    // 6. 点击发送 / 中止 (忙碌态切换为中止)
    if (this.btnSend) {
      this.btnSend.addEventListener('click', () => {
        const isBusy = (this.fsm && (this.fsm.getState() === 'DISPATCHING' || this.fsm.getState() === 'STREAMING')) 
          || this.btnSend.classList.contains('is-busy');
        if (isBusy) {
          this.abort();
        } else {
          this.submit();
        }
      });
    }

    // 7. 移动端软键盘弹起自适应视口偏移 (防止键盘遮挡输入坞)
    if (typeof window !== 'undefined' && window.visualViewport && this.container) {
      const handleViewportResize = () => {
        const vv = window.visualViewport;
        const offsetBottom = Math.max(0, window.innerHeight - (vv.height + (vv.offsetTop || 0)));
        if (offsetBottom > 60) {
          this.container.style.transform = `translateY(-${offsetBottom}px)`;
        } else {
          this.container.style.transform = '';
        }
      };
      window.visualViewport.addEventListener('resize', handleViewportResize);
      window.visualViewport.addEventListener('scroll', handleViewportResize);
    }
  }

  bindReasoningEvents() {
    if (!this.reasoningBtn || !this.reasoningPopover) return;

    this.reasoningBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.popover) this.popover.classList.add('hidden');
      if (this.accessPopover) this.accessPopover.classList.add('hidden');
      if (this.triggerPopover) this.triggerPopover.classList.add('hidden');
      this.reasoningPopover.classList.toggle('hidden');
    });

    const rows = this.reasoningPopover.querySelectorAll('.popover-reasoning-row');
    rows.forEach(row => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const effort = row.getAttribute('data-effort');
        this.setReasoningEffort(effort, true);
        this.reasoningPopover.classList.add('hidden');
      });
    });

    document.addEventListener('click', (e) => {
      if (this.reasoningPopover && !this.reasoningPopover.classList.contains('hidden')) {
        if (!this.reasoningPopover.contains(e.target) && !this.reasoningBtn.contains(e.target)) {
          this.reasoningPopover.classList.add('hidden');
        }
      }
      if (this.triggerPopover && !this.triggerPopover.classList.contains('hidden')) {
        if (!this.triggerPopover.contains(e.target) && !this.textarea.contains(e.target)) {
          this.hideTriggerPopover();
        }
      }
    });
  }

  setReasoningEffort(effort, persist = true) {
    const valid = ['high', 'medium', 'low', 'none'];
    if (!valid.includes(effort)) effort = 'high';
    this.reasoningEffort = effort;

    const labels = {
      high: '最高',
      medium: '适中',
      low: '精简',
      none: '关闭'
    };

    if (this.reasoningLabel) {
      this.reasoningLabel.textContent = labels[effort] || '最高';
    }

    if (this.reasoningPopover) {
      const rows = this.reasoningPopover.querySelectorAll('.popover-reasoning-row');
      rows.forEach(r => {
        const isCur = r.getAttribute('data-effort') === effort;
        r.classList.toggle('selected', isCur);
        const chk = r.querySelector('.row-check');
        if (chk) chk.classList.toggle('hidden', !isCur);
      });
    }

    if (persist) {
      try {
        localStorage.setItem('teachagent_reasoning_effort', effort);
      } catch (_) { if (typeof recordIssue === 'function') recordIssue('PromptInputDock', 'if', _); }
    }
    if (typeof window !== 'undefined') {
      window.currentReasoningEffort = effort;
    }
  }

  getReasoningEffort() {
    return this.reasoningEffort || 'high';
  }

  bindTriggerEvents() {
    if (!this.textarea) return;

    this.textarea.addEventListener('compositionstart', () => {
      this.isComposing = true;
    });
    this.textarea.addEventListener('compositionend', () => {
      this.isComposing = false;
      this.detectTrigger();
    });

    this.textarea.addEventListener('click', () => {
      this.detectTrigger();
    });

    this.textarea.addEventListener('keydown', (e) => {
      const isImeComposing = e.isComposing === true || this.isComposing || e.keyCode === 229;
      const isTriggerOpen = this.triggerPopover && !this.triggerPopover.classList.contains('hidden');

      if (isTriggerOpen) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.navigateTrigger(-1);
          return;
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.navigateTrigger(1);
          return;
        } else if ((e.key === 'Enter' || e.key === 'Tab') && !isImeComposing) {
          e.preventDefault();
          this.applyTriggerSuggestion(this.triggerActiveIndex);
          return;
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.hideTriggerPopover();
          return;
        }
      }

      // 未弹出触发词浮层时的按键处理
      if (e.key === 'ArrowUp' && !e.shiftKey) {
        // 当光标在首行或首字符时，向上调取历史提示词 (对标 ZCode promptHistory)
        const selStart = this.textarea.selectionStart || 0;
        const textBefore = this.textarea.value.slice(0, selStart);
        if (selStart === 0 || !textBefore.includes('\n')) {
          const prev = this.promptHistory.navigate('up', this.textarea.value);
          if (prev !== undefined && prev !== this.textarea.value) {
            e.preventDefault();
            this.textarea.value = prev;
            this.textarea.dispatchEvent(new Event('input'));
            this.textarea.selectionStart = this.textarea.selectionEnd = prev.length;
          }
        }
      } else if (e.key === 'ArrowDown' && !e.shiftKey) {
        // 当光标在末行或末字符时，向下调取历史提示词 (对标 ZCode promptHistory)
        const selEnd = this.textarea.selectionEnd || 0;
        const textAfter = this.textarea.value.slice(selEnd);
        if (selEnd === this.textarea.value.length || !textAfter.includes('\n')) {
          if (this.promptHistory.cursor >= 0) {
            const next = this.promptHistory.navigate('down', this.textarea.value);
            if (next !== undefined) {
              e.preventDefault();
              this.textarea.value = next;
              this.textarea.dispatchEvent(new Event('input'));
              this.textarea.selectionStart = this.textarea.selectionEnd = next.length;
            }
          }
        }
      } else if (e.key === 'Enter' && !e.shiftKey) {
        const isImeComposing = e.isComposing === true || this.isComposing || e.keyCode === 229;
        if (!isImeComposing) {
          e.preventDefault();
          this.submit();
        }
      }
    });
  }

  detectTrigger() {
    if (!this.textarea || !this.triggerPopover) return;
    const text = this.textarea.value;
    const selStart = this.textarea.selectionStart || 0;
    const textBefore = text.slice(0, selStart);

    // 匹配光标前最近的 / 或 @ 开头的词元 (允许开头或空格后)
    const match = /(?:^|\s)([\/@])([a-zA-Z0-9_\-:]*)$/.exec(textBefore);
    if (!match) {
      this.hideTriggerPopover();
      return;
    }

    const triggerChar = match[1];
    const triggerQuery = match[2];
    const matchOffset = Math.max(0, match[0].search(/[\/@]/));
    const startPos = match.index + matchOffset;
    const endPos = selStart;

    this.currentTriggerInfo = {
      char: triggerChar,
      query: triggerQuery,
      startPos: startPos,
      endPos: endPos
    };

    const results = this.triggerEngine.query(triggerChar, triggerQuery);
    if (results.length === 0) {
      this.hideTriggerPopover();
      return;
    }

    this.renderTriggerSuggestions(results);
  }

  renderTriggerSuggestions(results) {
    if (!this.triggerPopover || !this.triggerList) return;
    this.currentTriggerMatches = results;
    this.triggerActiveIndex = 0;

    const isSlash = this.currentTriggerInfo && this.currentTriggerInfo.char === '/';
    if (this.triggerHeaderTitle) {
      this.triggerHeaderTitle.textContent = isSlash ? '⚡ 斜杠指令 (Slash Commands)' : '❖ 上下文变量与几何模板 (Mentions)';
    }
    if (this.triggerHeaderCount) {
      this.triggerHeaderCount.textContent = `${results.length} 项`;
    }

    this.triggerList.innerHTML = results.map((res, idx) => {
      const it = res.item;
      const isSelected = idx === 0;
      return `
        <div class="trigger-item ${isSelected ? 'selected' : ''}" data-index="${idx}">
          <div class="trigger-item-left">
            <span class="trigger-item-badge">${this.escapeHTML(it.name)}</span>
            <div class="trigger-item-info">
              <span class="trigger-item-name">${this.escapeHTML(it.label)}</span>
              <span class="trigger-item-desc">${this.escapeHTML(it.desc)}</span>
            </div>
          </div>
          <span class="trigger-item-tag">${this.escapeHTML(it.tag || '')}</span>
        </div>
      `;
    }).join('');

    this.triggerList.querySelectorAll('.trigger-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(el.getAttribute('data-index'), 10);
        this.applyTriggerSuggestion(idx);
      });
    });

    this.triggerPopover.classList.remove('hidden');
  }

  navigateTrigger(direction) {
    if (!this.currentTriggerMatches || this.currentTriggerMatches.length === 0) return;
    const total = this.currentTriggerMatches.length;
    this.triggerActiveIndex = (this.triggerActiveIndex + direction + total) % total;

    const items = this.triggerList.querySelectorAll('.trigger-item');
    items.forEach((it, idx) => {
      const active = idx === this.triggerActiveIndex;
      it.classList.toggle('selected', active);
      if (active) {
        it.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  applyTriggerSuggestion(index) {
    if (!this.currentTriggerMatches || !this.currentTriggerMatches[index]) return;
    const selected = this.currentTriggerMatches[index].item;
    if (!this.currentTriggerInfo || !this.textarea) return;

    const text = this.textarea.value;
    const before = text.slice(0, this.currentTriggerInfo.startPos);
    const after = text.slice(this.currentTriggerInfo.endPos);
    const replacement = selected.name + ' ';

    this.textarea.value = before + replacement + after;
    const newPos = before.length + replacement.length;
    this.textarea.selectionStart = this.textarea.selectionEnd = newPos;

    this.hideTriggerPopover();
    this.textarea.dispatchEvent(new Event('input'));
    this.textarea.focus();
  }

  hideTriggerPopover() {
    if (this.triggerPopover) {
      this.triggerPopover.classList.add('hidden');
    }
    this.currentTriggerInfo = null;
    this.currentTriggerMatches = [];
  }

  handlePaste(e) {
    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) this.addFileAttachment(file);
      }
    }
  }

  handleFileSelect(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of files) {
      this.addFileAttachment(file);
    }
    this.fileInput.value = '';
  }

  addFileAttachment(file) {
    if (!this.canAcceptVision()) {
      this.showInputNotice('图片识别暂不可用，图片未添加。请描述图中的矩阵或问题后发送文字。');
      return false;
    }
    if (!file) return false;
    if (!/^image\/(png|jpeg|jpg|webp|gif|svg\+xml)$/i.test(file.type)) {
      this.showInputNotice('仅支持上传常见图片文件 (PNG, JPG, WEBP, GIF, SVG)');
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.showInputNotice('图片大小超过 10MB 限制');
      return false;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      this.addAttachment({
        id: 'att_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
        name: file.name || '粘贴的图像',
        dataUrl: e.target.result,
        file
      });
    };
    reader.onerror = () => {
      this.showInputNotice('读取图片文件失败，请重试');
    };
    reader.readAsDataURL(file);
    return true;
  }

  showInputNotice(message, {removeAttachments=false}={}) {
    let box=this.container.querySelector('#dock-input-notice');
    if(!box){box=document.createElement('div');box.id='dock-input-notice';box.className='dock-input-notice';box.setAttribute('role','alert');this.container.prepend(box);}
    box.replaceChildren();box.textContent=message;
    box.classList.remove('hidden');
    if(removeAttachments){const button=document.createElement('button');button.type='button';button.textContent='移除附件，保留文字';button.onclick=()=>{this.attachments=[];this.renderTray();this.hideInputNotice();this.textarea.focus();};box.append(button);}
  }
  hideInputNotice() { this.container.querySelector('#dock-input-notice')?.classList.add('hidden'); }

  addAttachment(att) {
    if (!att || !att.dataUrl) return false;
    this.hideInputNotice();
    if (!this.attachments) this.attachments = [];
    const existingIdx = this.attachments.findIndex(a => a.id === att.id);
    if (existingIdx >= 0) {
      this.attachments[existingIdx] = att;
    } else {
      this.attachments.push(att);
    }
    this.renderTray();
    if (typeof this.onAttachmentChange === 'function') {
      this.onAttachmentChange(this.attachments);
    }
    if (this.fsm && window.StudioEvents) {
      this.fsm.transition(window.StudioEvents.INPUT_CHANGED, {
        text: this.textarea?.value || '',
        attachments: this.attachments
      });
    }
    return true;
  }

  removeAttachment(id) {
    this.attachments = this.attachments.filter(a => a.id !== id);
    this.renderTray();
    if (typeof this.onAttachmentChange === 'function') {
      this.onAttachmentChange(this.attachments);
    }
    if (this.fsm && window.StudioEvents) {
      this.fsm.transition(window.StudioEvents.INPUT_CHANGED, {
        text: this.textarea.value,
        attachments: this.attachments
      });
    }
  }

  renderTray() {
    if (!this.tray) return;
    if (this.attachments.length === 0) {
      this.tray.classList.add('hidden');
      this.tray.innerHTML = '';
      return;
    }

    this.tray.classList.remove('hidden');
    this.tray.innerHTML = this.attachments.map(att => `
      <div class="attachment-capsule" data-id="${att.id}">
        <img class="capsule-thumb" src="${att.dataUrl}" alt="预览" />
        <span class="capsule-name">${this.escapeHTML(att.name)}</span>
        <button type="button" class="capsule-remove-btn" title="移除草图">✕</button>
      </div>
    `).join('');

    this.tray.querySelectorAll('.capsule-remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const capsule = e.target.closest('.attachment-capsule');
        const id = capsule.getAttribute('data-id');
        this.removeAttachment(id);
      });
    });
  }

  abort() {
    try {
      if (typeof this.onAbort === 'function') {
        try {
          if (this.onAbort() === false) return;
        } catch (err) {
          console.error('[PromptInputDock] onAbort callback error:', err);
        }
      }
    } finally {
      const activeFsm = this.fsm || (typeof window !== 'undefined' && window.studioFSM ? window.studioFSM : null);
      if (activeFsm) {
        const resetEvt = (typeof window !== 'undefined' && window.StudioEvents?.RESET) || 'RESET';
        activeFsm.transition(resetEvt);
      }
      // 刚性 UI 重置保底：确保点击中止瞬间按钮 100% 恢复发送箭头
      if (this.btnSend) {
        this.btnSend.classList.remove('is-busy');
        this.btnSend.title = '发送代数推导指令 (Enter)';
        this.btnSend.innerHTML = `
          <svg class="send-arrow-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="19" x2="12" y2="5"></line>
            <polyline points="5 12 12 5 19 12"></polyline>
          </svg>
        `;
      }
      if (this.btnClip) {
        this.syncImageCapability(false);
      }
    }
  }

  submit() {
    const text = (this.textarea.value || '').trim();
    const hasAttachments = this.attachments.length > 0;

    if (!text && !hasAttachments) return;

    if (hasAttachments && !this.canAcceptVision()) {
      this.showInputNotice('未发送：当前模型未接入图片识别。移除附件后可发送原有文字。', { removeAttachments: true });
      return;
    }

    // 状态机忙碌守卫：检查是否处于处理中
    if (this.fsm) {
      const currentState = this.fsm.getState();
      if (currentState === 'DISPATCHING' || currentState === 'STREAMING') {
        console.warn('[PromptInputDock] 阻断提交：系统处于 ' + currentState + ' 态');
        return;
      }
    }

    // 记录到提示词历史中 (对标 ZCode promptHistoryStorage)
    if (text) {
      this.promptHistory.add(text);
      this.promptHistory.resetCursor();
    }
    this.hideTriggerPopover();

    const firstImage = (this.attachments.find(a => a.dataUrl)?.dataUrl) || null;
    const payload = {
      text: text,
      imageBase64: firstImage,
      attachments: [...this.attachments],
      reasoningEffort: this.getReasoningEffort()
    };

    // 清空输入与预览
    this.textarea.value = '';
    this.textarea.style.height = 'auto';
    this.attachments = [];
    this.renderTray();
    this.textarea.dispatchEvent(new Event('input',{bubbles:true}));
    this.hideInputNotice();

    if (typeof this.onSubmit === 'function') {
      this.onSubmit(payload);
    }
  }

  setText(text) {
    if (this.textarea) {
      this.textarea.value = text;
      this.textarea.dispatchEvent(new Event('input'));
    }
  }

  escapeHTML(str) {
    return (str || '').replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
}

if (typeof window !== 'undefined') {
  window.PromptInputDock = PromptInputDock;
  window.PromptHistoryManager = PromptHistoryManager;
  window.TriggerSuggestionEngine = TriggerSuggestionEngine;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PromptInputDock, PromptHistoryManager, TriggerSuggestionEngine };
}
