/**
 * 问矩 · 线性代数概念认知图谱引擎 (KnowledgeGraphDAG)
 * 职责：
 * 1. 维护覆盖大学线性代数四大支柱的 12 个学科核心节点与 16 条有向依赖边构成的严格 DAG
 * 2. 提供拓扑排序 (Kahn 算法) 与前置依赖单调性校验 (Zero Cycle)
 * 3. 从 CognitiveTracker 读取练习核验记录，观察事件不计入练习通过数
 * 4. 使用 SVG 显示依赖关系，提供键盘选择与课程入口
 * 5. 数学排版不可用时显示可读公式
 */

let CognitiveTrackerClass;
if (typeof require !== 'undefined') {
  try { CognitiveTrackerClass = require('./cognition/CognitiveTracker.js').CognitiveTracker; } catch (e) { if (typeof recordIssue === 'function') recordIssue('knowledgeGraph', 'if', e); }
}
if (!CognitiveTrackerClass && typeof window !== 'undefined') {
  CognitiveTrackerClass = window.CognitiveTracker;
}

class KnowledgeGraphDAG {
  constructor(containerId, options = {}) {
    this.container = (typeof document !== 'undefined' && containerId) ? document.getElementById(containerId) : null;
    this.options = options;

    // 挂载真实认知追踪器 (Single Source of Truth)
    if (options.cognitiveTracker) {
      this.cognitiveTracker = options.cognitiveTracker;
    } else if (typeof window !== 'undefined' && window.cognitiveTracker) {
      this.cognitiveTracker = window.cognitiveTracker;
    } else if (CognitiveTrackerClass) {
      this.cognitiveTracker = new CognitiveTrackerClass();
    } else {
      this.cognitiveTracker = null;
    }

    // 四大支柱 12 个学科核心节点体系 (坐标优化防遮挡：SVG 1120x420)
    this.nodes = [
      // 支柱一：基底与向量空间 (Bases & Vector Spaces)
      {
        id: 'basis',
        label: '基底向量与线性组合',
        tier: 1,
        pillar: '基底与向量空间',
        x: 80,
        y: 200,
        formula: 'v = c_1 e_1 + c_2 e_2',
        summary: '空间网格的离散骨架，任意二维几何向量由基底唯一线性表出。',
        misconception: '以为换了基底空间向量本身也会改变，混淆坐标表示与客观几何实体。',
        preset: 'identity'
      },
      {
        id: 'linear_indep',
        label: '线性相关性与空间维数',
        tier: 2,
        pillar: '基底与向量空间',
        x: 230,
        y: 100,
        formula: '\\{v_1,v_2\\} \\text{ 线性无关} \\iff (c_1v_1+c_2v_2=0 \\Rightarrow c_1=c_2=0)',
        summary: '向量共线即为线性相关并导致维度坍缩，极大线性无关组张成全空间。',
        misconception: '将零向量视作线性无关，忽视零向量与任意向量均线性相关。',
        preset: 'shear'
      },

      // 支柱二：仿射变换与行列式 (Affine Maps & Determinants)
      {
        id: 'transform',
        label: '线性映射与矩阵表示',
        tier: 2,
        pillar: '仿射变换与行列式',
        x: 230,
        y: 300,
        formula: 'T(x) = A x, \\quad A = \\begin{pmatrix} T(e_1) & T(e_2) \\end{pmatrix}',
        summary: '保持原点固定与网格平行的线性连续空间变形，矩阵列向量即为基底像。',
        misconception: '死记矩阵数字表格，割裂矩阵与平面几何拉伸剪切的动力学联系。',
        preset: 'shear'
      },
      {
        id: 'composition',
        label: '矩阵复合与非对易李括号',
        tier: 3,
        pillar: '仿射变换与行列式',
        x: 410,
        y: 80,
        formula: '(AB)x = A(Bx), \\quad AB-BA \\text{ 不一定为零}',
        summary: '连续空间几何操作的不可交换性，矩阵乘法在代数本质上是变换复合。',
        misconception: '直觉套用数乘交换律误以为 AB=BA，忽视旋转后剪切与先剪切后旋转的几何不对称。',
        preset: 'shear'
      },
      {
        id: 'det',
        label: '行列式与有向面积测度',
        tier: 3,
        pillar: '仿射变换与行列式',
        x: 410,
        y: 310,
        formula: '\\det(A) = ad - bc = \\lambda_1 \\lambda_2',
        summary: '二维单位正方形经仿射变换后的有向面积缩放因子，非零充要空间可逆。',
        misconception: '以为行列式具有加法线性性 det(A+B)=det(A)+det(B)，忽视其为多重交错张量。',
        preset: 'cubist'
      },

      // 支柱三：子空间结构与方程组 (Subspaces & Linear Systems)
      {
        id: 'nullspace',
        label: '奇异降维与空间核 Null(A)',
        tier: 4,
        pillar: '子空间结构与方程组',
        x: 590,
        y: 70,
        formula: 'A x = 0 \\iff x \\in \\operatorname{Null}(A)',
        summary: '零空间是所有被 A 映射为零的向量集合。二维奇异矩阵的像可能是一条直线，也可能只有原点。',
        misconception: '把数的零乘积规则用于矩阵，误认为 AB=0 必须有 A=0 或 B=0。',
        preset: 'singular'
      },
      {
        id: 'colspace',
        label: '列空间与秩-零度定理',
        tier: 4,
        pillar: '子空间结构与方程组',
        x: 590,
        y: 190,
        formula: '\\operatorname{rank}(A) + \\operatorname{nullity}(A) = 2',
        summary: '变换后所有输出构成的像空间，维数守恒基石定理。',
        misconception: '混淆矩阵的行空间与列空间几何方向，误以为奇异矩阵像空间为零维。',
        preset: 'singular'
      },
      {
        id: 'sys_linear_eq',
        label: '线性方程组解集与仿射流形',
        tier: 4,
        pillar: '子空间结构与方程组',
        x: 590,
        y: 320,
        formula: '\\text{若 }Ax_p=b,\\quad \\{x:Ax=b\\}=x_p+\\operatorname{Null}(A)',
        summary: '先判断方程组是否相容。有解时，解集是核空间沿任一特解的平移；无解时不存在特解。',
        misconception: '死记高斯消元初等行变换，无法将解集几何化为一条穿过特解并平行于核的直线。',
        preset: 'singular'
      },

      // 支柱四：谱理论与奇异值分解 (Spectral Theory & SVD)
      {
        id: 'eigen',
        label: '特征系统与不变方向流形',
        tier: 5,
        pillar: '谱理论与奇异值分解',
        x: 780,
        y: 80,
        formula: 'A v = \\lambda v, \\quad v \\ne 0',
        summary: '实特征向量经变换后仍落在自身张成的直线上；负特征值会反向，零特征值会将向量映到原点。',
        misconception: '以为所有矩阵都有实特征向量，忽视纯旋转变换将特征值推入复共轭域。',
        preset: 'shear'
      },
      {
        id: 'diagonal',
        label: '相似对角化',
        tier: 5,
        pillar: '谱理论与奇异值分解',
        x: 780,
        y: 190,
        formula: 'A = P D P^{-1}, \\quad D = \\operatorname{diag}(\\lambda_1, \\lambda_2)',
        summary: '具有足够多线性无关特征向量时，可以在特征向量基底下表示为对角矩阵。实对称矩阵可选正交基底。',
        misconception: '认为所有矩阵都可对角化，或认为相似变换的基底矩阵总是正交矩阵。',
        preset: 'identity'
      },
      {
        id: 'ortho',
        label: '正交投影与最小二乘',
        tier: 5,
        pillar: '谱理论与奇异值分解',
        x: 780,
        y: 310,
        formula: '\\text{若 }A\\text{ 列满秩： }P=A(A^TA)^{-1}A^T,\\quad P^2=P=P^T',
        summary: '几何投影算子与 Gram-Schmidt 正交化，将任意高维向量垂直到列空间。',
        misconception: '误将非正交投影当作正交投影，忽略投影算子的对称幂等几何性质。',
        preset: 'cubist'
      },
      {
        id: 'svd',
        label: '奇异值分解 (SVD)',
        tier: 6,
        pillar: '谱理论与奇异值分解',
        x: 970,
        y: 190,
        formula: 'A = U \\Sigma V^T, \\quad \\sigma_i = \\sqrt{\\lambda_i(A^T A)}',
        summary: '旋转-拉伸-旋转三阶段几何分解，正交主轴与奇异值空间几何最佳低秩逼近。',
        misconception: '混淆特征值与奇异值，将 SVD 局限在方阵而忽视其对任意非齐次长方矩阵的普适性。',
        preset: 'cubist'
      }
    ];

    // 16 条有向单调依赖边构成的严格 DAG
    this.edges = [
      { from: 'basis', to: 'linear_indep' },
      { from: 'basis', to: 'transform' },
      { from: 'linear_indep', to: 'composition' },
      { from: 'transform', to: 'composition' },
      { from: 'transform', to: 'det' },
      { from: 'composition', to: 'nullspace' },
      { from: 'det', to: 'nullspace' },
      { from: 'det', to: 'colspace' },
      { from: 'nullspace', to: 'colspace' },
      { from: 'colspace', to: 'sys_linear_eq' },
      { from: 'nullspace', to: 'eigen' },
      { from: 'colspace', to: 'eigen' },
      { from: 'eigen', to: 'diagonal' },
      { from: 'basis', to: 'ortho' },
      { from: 'diagonal', to: 'svd' },
      { from: 'ortho', to: 'svd' }
    ];

    this.selectedNodeId = 'basis';
    this.shortLabels = {basis:'基底与线性组合',linear_indep:'线性相关性',transform:'线性变换',composition:'矩阵复合',det:'行列式与面积',nullspace:'零空间',colspace:'列空间与秩',sys_linear_eq:'方程组解集',eigen:'特征值与方向',diagonal:'相似对角化',ortho:'正交投影',svd:'奇异值分解'};
    this.plainFormulas = {basis:'v = c₁e₁ + c₂e₂',linear_indep:'线性无关 ⇔ Σ cᵢvᵢ = 0 只有零系数解',transform:'T(x) = Ax；A = [T(e₁), T(e₂)]',composition:'(AB)x = A(Bx)；AB − BA 不一定为零',det:'det A = ad − bc = λ₁λ₂',nullspace:'Null(A) = {x : Ax = 0}',colspace:'rank A + nullity A = 2（两列矩阵）',sys_linear_eq:'若 Ax = b 有解：x = xₚ + xₕ，Axₕ = 0',eigen:'Av = λv，v ≠ 0',diagonal:'A = PDP⁻¹；P 的列为线性无关特征向量',ortho:'P = A(AᵀA)⁻¹Aᵀ（A 列满秩）',svd:'A = UΣVᵀ；σᵢ = √λᵢ(AᵀA)'};

    // 监听真实认知状态机变更
    if (this.cognitiveTracker) {
      this.cognitiveTracker.onChange(() => {
        this.syncNodeStates();
        this.updateMasteryBadge();
        if (this.container) {
          this.refreshNodeDOMStatus();
          this.renderDrawer();
        }
      });
    }

    this.syncNodeStates();

    if (this.container) {
      this.render();
      this.updateMasteryBadge();
    }
  }

  /**
   * 动态同步真实掌握度状态（告别写死 status）
   */
  syncNodeStates() {
    if (this.cognitiveTracker) {
      const liveStates = this.cognitiveTracker.getNodeStates();
      for (const n of this.nodes) {
        n.status = liveStates[n.id] || 'locked';
      }
    } else {
      // 降级兜底
      for (const n of this.nodes) {
        n.status = 'locked';
      }
    }
  }

  /**
   * 更新宿主顶栏掌握度徽章
   */
  updateMasteryBadge() {
    if (typeof document === 'undefined') return;
    const badge = document.getElementById('graph-mastery-badge');
    if (!badge) return;

    if (this.cognitiveTracker) {
      const summary = this.cognitiveTracker.getMasterySummary();
      badge.textContent = summary.badgeText;
      badge.className = `subpage-badge ${summary.masteredCount >= 4 ? 'success' : 'warning'}`;
    }
  }

  /**
   * 拓扑排序校验 (Kahn 算法)，严格断言 DAG 无环
   */
  getTopologicalOrder() {
    const inDegree = new Map();
    const adj = new Map();

    this.nodes.forEach(n => {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    });

    this.edges.forEach(e => {
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
      adj.get(e.from).push(e.to);
    });

    const queue = [];
    inDegree.forEach((deg, id) => {
      if (deg === 0) queue.push(id);
    });

    const order = [];
    while (queue.length > 0) {
      const u = queue.shift();
      order.push(u);
      adj.get(u).forEach(v => {
        const d = inDegree.get(v) - 1;
        inDegree.set(v, d);
        if (d === 0) queue.push(v);
      });
    }

    if (order.length !== this.nodes.length) {
      throw new Error(`[KnowledgeGraphDAG] 发现图谱循环依赖，已排序 ${order.length}/${this.nodes.length} 节点，DAG 不成立！`);
    }
    return order;
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="dag-viewport-wrap">
        <div class="dag-map-caption"><strong>概念之间的联系</strong><span>○ 待练习 · ◇ 可探索 · ✓ 练习与迁移通过</span></div>
        <div class="dag-svg-canvas-box">
          <svg class="dag-svg" viewBox="0 0 1100 420" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="edgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45"/>
                <stop offset="100%" stop-color="#818cf8" stop-opacity="0.75"/>
              </linearGradient>
              <marker id="arrow" viewBox="0 0 10 10" refX="25" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 2 L 7 5 L 0 8 z" fill="#6366f1" opacity="0.8" />
              </marker>
            </defs>
            <g class="dag-edges-layer"></g>
            <g class="dag-nodes-layer"></g>
          </svg>
        </div>

        <div class="dag-node-drawer" id="dag-detail-drawer">
          <!-- 动态渲染选中节点详情 -->
        </div>
      </div>
    `;

    const svgEdges = this.container.querySelector('.dag-edges-layer');
    const svgNodes = this.container.querySelector('.dag-nodes-layer');

    // 1. 绘制贝塞尔曲线连线
    this.edges.forEach(e => {
      const fromNode = this.nodes.find(n => n.id === e.from);
      const toNode = this.nodes.find(n => n.id === e.to);
      if (!fromNode || !toNode) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dx = (toNode.x - fromNode.x) * 0.5;
      const d = `M ${fromNode.x} ${fromNode.y} C ${fromNode.x + dx} ${fromNode.y}, ${toNode.x - dx} ${toNode.y}, ${toNode.x} ${toNode.y}`;
      path.setAttribute('d', d);
      path.setAttribute('class', `dag-edge edge-${e.from}-${e.to}`);
      path.setAttribute('marker-end', 'url(#arrow)');
      svgEdges.appendChild(path);
    });

    // 2. 绘制 12 个节点
    this.nodes.forEach(n => {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', `dag-node-group status-${n.status} ${this.selectedNodeId === n.id ? 'is-selected' : ''}`);
      g.setAttribute('transform', `translate(${n.x}, ${n.y})`);
      g.setAttribute('data-node-id', n.id);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', n.label);

      // 外光环背景圆
      const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      halo.setAttribute('r', '24');
      halo.setAttribute('class', 'dag-node-halo');

      // 主圆球
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('r', '19');
      circle.setAttribute('class', 'dag-node-circle');

      // 状态图标
      const statusIcon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      statusIcon.setAttribute('class', 'dag-node-icon');
      statusIcon.setAttribute('text-anchor', 'middle');
      statusIcon.setAttribute('dy', '5');
      statusIcon.textContent = n.status === 'mastered' ? '✓' : (n.status === 'learning' ? '◇' : '○');

      // 节点文字 (带 SVG 描边背景以防贝塞尔曲线穿字)
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('class', 'dag-node-label');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('y', '36');
      text.textContent = this.shortLabels[n.id];

      g.appendChild(halo);
      g.appendChild(circle);
      g.appendChild(statusIcon);
      g.appendChild(text);

      g.addEventListener('click', () => {
        this.selectNode(n.id);
      });
      g.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.selectNode(n.id); }
      });

      svgNodes.appendChild(g);
    });

    this.renderDrawer();
  }

  /**
   * 刷新节点在 DOM 中的状态 class，无需重构整棵 DOM 树
   */
  refreshNodeDOMStatus() {
    if (!this.container) return;
    this.nodes.forEach(n => {
      const g = this.container.querySelector(`.dag-node-group[data-node-id="${n.id}"]`);
      if (g) {
        g.className.baseVal = `dag-node-group status-${n.status} ${this.selectedNodeId === n.id ? 'is-selected' : ''}`;
        const icon = g.querySelector('.dag-node-icon');
        if (icon) {
          icon.textContent = n.status === 'mastered' ? '✓' : (n.status === 'learning' ? '◇' : '○');
        }
      }
    });
  }

  selectNode(id) {
    this.selectedNodeId = id;
    const allGroups = this.container.querySelectorAll('.dag-node-group');
    allGroups.forEach(g => {
      if (g.getAttribute('data-node-id') === id) {
        g.classList.add('is-selected');
      } else {
        g.classList.remove('is-selected');
      }
    });
    this.renderDrawer();
  }

  renderDrawer() {
    const drawer = this.container?.querySelector('#dag-detail-drawer');
    if (!drawer) return;

    const node = this.nodes.find(n => n.id === this.selectedNodeId) || this.nodes[5];
    const statusText = node.status === 'mastered' ? '练习与迁移已通过' : (node.status === 'learning' ? '可进入探究 · 尚无通过证据' : '尚无作答证据');
    const statusClass = node.status === 'mastered' ? 'success' : (node.status === 'learning' ? 'warning' : 'locked');

    // 查找前置依赖与后继节点
    const prereqs = this.edges.filter(e => e.to === node.id).map(e => this.nodes.find(n => n.id === e.from)?.label).filter(Boolean);
    const successors = this.edges.filter(e => e.from === node.id).map(e => this.nodes.find(n => n.id === e.to)?.label).filter(Boolean);

    const lesson = typeof window !== 'undefined' && window.CourseLibrary?.forNode(node.id);
    const evidence = (this.cognitiveTracker?.profile.evidenceChain || []).filter(e => e.nodeId === node.id).slice(0,5);
    drawer.innerHTML = `
      <div class="dag-drawer-header">
        <div class="dag-drawer-badge-row">
          <span class="dag-drawer-badge ${statusClass}">${statusText}</span>
          <span class="dag-drawer-pillar-tag">${node.pillar}</span>
        </div>
        <h3 class="dag-drawer-title">${node.label}</h3>
      </div>
      <div class="dag-drawer-body">
        <div class="dag-drawer-formula-wrap">
          <div class="dag-formula-latex"></div>
        </div>

        <div class="dag-drawer-desc-block">
          <div class="dag-drawer-label">概念说明</div>
          <p class="dag-drawer-summary">${node.summary}</p>
        </div>

        <div class="dag-drawer-desc-block dag-misconception-block">
          <div class="dag-drawer-label">经典认知陷阱</div>
          <p class="dag-drawer-misconception">${node.misconception || '暂无认知陷阱'}</p>
        </div>

        <div class="dag-drawer-section">
          <div class="dag-drawer-label">前置认知前驱</div>
          <div class="dag-drawer-tags-wrap">
            ${prereqs.length > 0 ? prereqs.map(p => `<span class="dag-drawer-tag">${p}</span>`).join('') : '<span class="dag-drawer-tag-none">公理基底与起步</span>'}
          </div>
        </div>

        <div class="dag-drawer-section">
          <div class="dag-drawer-label">引申后续进阶</div>
          <div class="dag-drawer-tags-wrap">
            ${successors.length > 0 ? successors.map(s => `<span class="dag-drawer-tag advance">${s}</span>`).join('') : '<span class="dag-drawer-tag-none">终极宏观分解</span>'}
          </div>
        </div>

        <div class="dag-drawer-actions-row">
          <button class="dag-btn-launch" id="btn-dag-launch-studio" data-preset="${node.preset}" ${lesson ? '' : 'disabled'}>
            ${lesson ? '打开交互实验 →' : '此概念的交互实验尚未实现'}
          </button>
          <button class="dag-btn-ask-agent" id="btn-dag-ask-agent" data-node-id="${node.id}">
            向助教提问此概念 ✦
          </button>
        </div>

        <section class="dag-drawer-section"><div class="dag-drawer-label">作答与观察记录</div>${evidence.length ? evidence.map(e => '<p class="dag-evidence">' + String(e.detail).replace(/[&<>"']/g,'') + '</p>').join('') : '<p class="dag-evidence">尚无记录。浏览节点与运行演示不代表练习通过。</p>'}</section>
        <div class="dag-tracker-controls-row">
          <button class="dag-btn-mark-master" id="btn-dag-mark-master">
            ${(typeof window !== 'undefined' && window.CourseLibrary?.forNode(node.id)) ? '开始可核验练习 →' : '本节点尚无可核验课程'}
          </button>
          <button class="dag-btn-reset-profile" id="btn-dag-reset-profile" title="清空并重置学生学习档案">
            重置进度
          </button>
        </div>
      </div>
    `;

    const formula = drawer.querySelector('.dag-formula-latex');
    formula.textContent = this.plainFormulas[node.id];
    if (typeof window !== 'undefined' && typeof window.katex?.render === 'function') {
      try { window.katex.render(node.formula, formula, {throwOnError:true,displayMode:true}); }
      catch (error) { formula.textContent = this.plainFormulas[node.id]; if (typeof recordIssue === 'function') recordIssue('KnowledgeGraph','formula',error); }
    }

    // 绑定调入画板
    const launchBtn = drawer.querySelector('#btn-dag-launch-studio');
    if (launchBtn) {
      launchBtn.addEventListener('click', () => {
        if (typeof this.options.onLaunchStudio === 'function') {
          this.options.onLaunchStudio(node.preset, node);
        }
      });
    }

    // 绑定向助教提问
    const askBtn = drawer.querySelector('#btn-dag-ask-agent');
    if (askBtn) {
      askBtn.addEventListener('click', () => {
        if (this.cognitiveTracker) {
          this.cognitiveTracker.recordPhysicalEvent('agent_concept_explored', { nodeId: node.id, label: node.label });
        }
        if (typeof this.options.onAskAgent === 'function') {
          this.options.onAskAgent(node);
        }
      });
    }

    // 绑定物理掌握确权
    const markBtn = drawer.querySelector('#btn-dag-mark-master');
    if (markBtn) {
      markBtn.disabled = !lesson;
      markBtn.addEventListener('click', () => {
        if (this.cognitiveTracker) {
          if (typeof this.options.onStartCourse === 'function') this.options.onStartCourse(node.id);
        }
      });
    }

    // 绑定重置学习档案
    const resetBtn = drawer.querySelector('#btn-dag-reset-profile');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (confirm('确认重置当前认知图谱档案为初始起点吗？')) {
          if (window.courseProgress) window.courseProgress.reset();
          else if (this.cognitiveTracker) this.cognitiveTracker.resetProfile();
        }
      });
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { KnowledgeGraphDAG };
}
if (typeof window !== 'undefined') {
  window.KnowledgeGraphDAG = KnowledgeGraphDAG;
}
