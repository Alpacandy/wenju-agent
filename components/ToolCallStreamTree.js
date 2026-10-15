/**
 * 问矩 · 工具调用流展开树 (ToolCallStreamTree)
 * 深度复用 ZCode ToolCallBlocks.tsx 状态机与视觉设计
 * 核心特性：
 * 1. 树状执行流指示线 (Vertical Spine & Tree Nodes)
 * 2. 三态指示器 (Loading 旋转光圈 / Success 成功打勾 / Error 异常感叹号)
 * 3. 参数面板与 Observation 返回值折叠卡片
 * 4. 实时动态追加节点与状态更新
 */

const TOOL_NAME_MAP = {
  'generate_visual_illustration': '🎨 视觉概念画幅生成',
  'drive_canvas_affine_transform': '📐 空间仿射矩阵驱动',
  'render_canvas_graphics': '⚡ 几何图元画布渲染',
  'probe_null_space': '🔍 零空间与核流形探测',
  'solve_linear_system': '⚡ 线性方程组符号求解',
  'query_misconception_cases': '❖ 误解与反例库检索',
  'execute_code_sandbox': '▶ 网页沙箱实时运行',
  'run_code_sandbox': '▶ 网页沙箱实时运行',
  'sample_workspace_state': '📊 空间矩阵状态采样',
  'modify_workspace_file': '📝 教学工作区文件编辑'
};

class ToolCallStreamTree {
  static formatTitle(rawTitle) {
    if (!rawTitle) return '工具执行';
    const match = rawTitle.match(/(?:Executing|Executed):\s*([a-zA-Z0-9_]+)/i);
    if (match && match[1]) {
      const fnName = match[1];
      const localized = TOOL_NAME_MAP[fnName] || fnName;
      if (/^Executing/i.test(rawTitle)) {
        return `⏳ 正在调用: ${localized}`;
      }
      return localized;
    }
    return rawTitle;
  }

  static sanitizeString(str) {
    if (typeof str !== 'string') return str;
    // 拦截并在途折叠长 Base64
    if (str.startsWith('data:image/') && str.length > 80) {
      return `[Base64 图像数据 · ${(str.length / 1024).toFixed(1)} KB]`;
    }
    // 拦截并截断 S3 预签名长 URL 中的 AWS 签名与凭证串
    if (str.includes('X-Amz-') || (str.includes('s3.') && str.includes('?'))) {
      return str.replace(/(https?:\/\/[^\s\?]+)\?[^\s\)]+/g, '$1 [安全凭证签名已隐藏]');
    }
    return str;
  }

  static sanitizePayload(obj, seen = new WeakSet()) {
    if (!obj || typeof obj !== 'object') return ToolCallStreamTree.sanitizeString(obj);
    if (seen.has(obj)) return '[Circular Reference]';
    seen.add(obj);

    if (Array.isArray(obj)) {
      return obj.map(item => ToolCallStreamTree.sanitizePayload(item, seen));
    }
    const clean = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        clean[k] = ToolCallStreamTree.sanitizeString(v);
      } else if (typeof v === 'object' && v !== null) {
        clean[k] = ToolCallStreamTree.sanitizePayload(v, seen);
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }

  static formatSummary(detail, args, result) {
    // 严禁将未经清洗的 JSON 字符串直接暴露给用户
    if (typeof detail === 'string' && (detail.startsWith('{') || detail.startsWith('['))) {
      try {
        const parsed = JSON.parse(detail);
        if (parsed.prompt || args?.prompt) {
          const p = parsed.prompt || args?.prompt;
          return `已生成视觉画幅: "${p}" [${parsed.size || args?.image_size || '1024x1024'}]`;
        }
        if (parsed.detail && typeof parsed.detail === 'string' && !parsed.detail.startsWith('{')) {
          return ToolCallStreamTree.sanitizeString(parsed.detail);
        }
        if (parsed.status === 'success') {
          return '工具调用已成功闭环';
        }
      } catch (e) { if (typeof recordIssue === 'function') recordIssue('ToolCallStreamTree', 'if', e); }
    }
    if (result && result.prompt) {
      return `已生成视觉画幅: "${result.prompt}" [${result.size || '1024x1024'}]`;
    }
    if (typeof detail === 'string') {
      return ToolCallStreamTree.sanitizeString(detail);
    }
    return '已完成物理计算与环境响应';
  }

  static safeStringify(obj, indent = 2) {
    if (obj === undefined) return '';
    try {
      const seen = new WeakSet();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return '[Circular Reference]';
          seen.add(value);
        }
        return value;
      }, indent);
    } catch (e) {
      return String(obj);
    }
  }

  constructor({ container }) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.nodes = [];
    this.initDOM();
  }

  initDOM() {
    this.el = document.createElement('div');
    this.el.className = 'wenju-tool-stream-tree';
    if (this.container) {
      this.container.appendChild(this.el);
    }
  }

  /**
   * 追加或更新工具调用节点
   * @param {Object} node { id, icon, title, detail, status: 'loading' | 'success' | 'error', args, result }
   */
  upsertNode({ id, icon = 'tool', title, detail, status = 'success', args = null, result = null }) {
    let existing = this.nodes.find(n => n.id === id);
    if (existing) {
      existing.title = title || existing.title;
      existing.detail = detail || existing.detail;
      existing.status = status || existing.status;
      existing.args = args !== null ? args : existing.args;
      existing.result = result !== null ? result : existing.result;
    } else {
      existing = { id, icon, title, detail, status, args, result, isOpen: false };
      this.nodes.push(existing);
    }
    this.render();
  }

  setNodes(nodesList) {
    this.nodes = nodesList.map(n => ({
      id: n.id,
      tool: n.tool || (n.title ? (n.title.match(/(?:Executing|Executed):\s*([a-zA-Z0-9_]+)/i)?.[1] || null) : null),
      icon: n.icon || 'tool',
      title: n.title,
      detail: n.detail,
      status: n.status || 'success',
      args: n.args || null,
      result: n.result || null,
      isOpen: false
    }));
    this.render();
  }

  clear() {
    this.nodes = [];
    this.render();
  }

  render() {
    if (this.nodes.length === 0) {
      this.el.innerHTML = '';
      this.el.style.display = 'none';
      return;
    }

    this.el.style.display = 'block';
    this.el.innerHTML = `
      <div class="tool-tree-spine"></div>
      <div class="tool-tree-nodes-list">
        ${this.nodes.map(node => this.renderNodeHTML(node)).join('')}
      </div>
    `;

    // 绑定展开/折叠详细信息事件
    this.el.querySelectorAll('.tool-node-header').forEach(header => {
      header.addEventListener('click', () => {
        const nodeId = header.getAttribute('data-id');
        const node = this.nodes.find(n => n.id === nodeId);
        if (node && (node.args || node.result)) {
          node.isOpen = !node.isOpen;
          this.render();
        }
      });
    });
  }

  renderNodeHTML(node) {
    const isExpandable = !!(node.args || node.result);
    const isOpen = !!node.isOpen;

    const displayTitle = ToolCallStreamTree.formatTitle(node.title);
    const displaySummary = ToolCallStreamTree.formatSummary(node.detail, node.args, node.result);
    const cleanArgs = node.args ? ToolCallStreamTree.sanitizePayload(node.args) : null;
    const cleanResult = node.result ? ToolCallStreamTree.sanitizePayload(node.result) : null;
    const extractedTool = node.tool || (node.title ? (node.title.match(/(?:Executing|Executed):\s*([a-zA-Z0-9_]+)/i)?.[1] || node.title) : 'tool');

    let statusIconHtml = '';
    if (node.status === 'loading' || node.status === 'running') {
      statusIconHtml = `<div class="node-spinner"></div>`;
    } else if (node.status === 'simulated') {
      statusIconHtml = `
        <div class="node-badge error" title="simulated - UI visible, not success">
          <span style="font-size:10px;font-weight:700;">SIM</span>
        </div>`;
    } else if (node.status === 'error') {
      statusIconHtml = `
        <div class="node-badge error">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>`;
    } else if (node.status === 'success' || node.status === 'completed') {
      statusIconHtml = `
        <div class="node-badge success">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        </div>`;
    } else {
      statusIconHtml = `<div class="node-badge" title="${node.status === 'aborted' ? '已停止' : '未完成'}">${node.status === 'aborted' ? '■' : '·'}</div>`;
    }

    return `
      <div class="tool-tree-node ${node.status}" data-id="${node.id}" data-tool-name="${this.escapeHTML(extractedTool)}">
        <div class="tool-node-header ${isExpandable ? 'is-expandable' : ''}" data-id="${node.id}">
          <div class="node-status-col">
            ${statusIconHtml}
          </div>
          <div class="node-content-col">
            <div class="node-title-row">
              <span class="node-title">${this.escapeHTML(displayTitle)}</span>
              ${isExpandable ? `<span class="node-chevron ${isOpen ? 'open' : ''}">▸</span>` : ''}
            </div>
            <div class="node-detail">${this.escapeHTML(displaySummary)}</div>
          </div>
        </div>

        ${isOpen && isExpandable ? `
          <div class="tool-node-drawer">
            ${cleanArgs ? `
              <div class="drawer-section">
                <span class="drawer-label">调用参数 (Parameters)</span>
                <pre class="drawer-code">${this.escapeHTML(ToolCallStreamTree.safeStringify(cleanArgs, 2))}</pre>
              </div>
            ` : ''}
            ${cleanResult ? `
              <div class="drawer-section">
                <span class="drawer-label">执行观察 (Observation)</span>
                <pre class="drawer-code">${this.escapeHTML(ToolCallStreamTree.safeStringify(cleanResult, 2))}</pre>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  escapeHTML(val) {
    return String(val == null ? '' : val).replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  destroy() {
    if (this.el && this.el.parentElement) {
      this.el.parentElement.removeChild(this.el);
    }
  }
}

if (typeof window !== 'undefined') {
  window.ToolCallStreamTree = ToolCallStreamTree;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ToolCallStreamTree };
}
