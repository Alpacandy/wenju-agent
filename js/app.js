/**
 * 问矩 · 页面调度与教学探究引导控制逻辑
 * 严格绑定设计概念图交互组件
 */

function appStructuredError(event, error, details = {}) {
  const payload = { event, error: String(error && error.message || error || 'unknown'), ...details };
  if (typeof window !== 'undefined' && window.StructuredLogger && typeof window.StructuredLogger.error === 'function') {
    window.StructuredLogger.error(event, payload);
  } else if (typeof console !== 'undefined' && console.error) {
    console.error(`[app] ${event}`, payload);
  }
}

function initTeachAgentStudio() {
  // 1. 初始化入场页 3D 几何投影
  const landingVisualizer = new Landing3DVisualizer('landing-canvas');
  landingVisualizer.start();

  // 1.1 入场页 3D 线性代数形态切换胶囊
  const modeButtons = document.querySelectorAll('.btn-mode');
  modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-mode');
      landingVisualizer.setMode(mode);
    });
  });

  // 1.5. 初始化真实认知状态机 (Single Source of Truth，彻底去 Mock)
  if (!window.cognitiveTracker && window.CognitiveTracker) {
    window.cognitiveTracker = new window.CognitiveTracker();
    window.cognitiveTracker.onChange(() => {
      const badge = document.getElementById('graph-mastery-badge');
      if (badge && window.cognitiveTracker) {
        const s = window.cognitiveTracker.getMasterySummary();
        badge.textContent = s.badgeText;
        badge.className = `subpage-badge ${s.masteredCount >= 4 ? 'success' : 'warning'}`;
      }
    });
  }

  // 2. 初始化工作台独立黑底坐标演示视窗
  let workspaceVisualizer = null;

  // 3. 全局页面路由与多模块调度控制器
  const landingPage = document.getElementById('landing-page');
  const studioPage = document.getElementById('studio-page');
  const libraryPage = document.getElementById('library-page');
  const graphPage = document.getElementById('graph-page');
  const btnEnter = document.getElementById('btn-enter-studio');
  const btnBackHome = document.getElementById('btn-back-home');
  const navBrandHome = document.getElementById('nav-brand-home');
  const navTabs = document.querySelectorAll('.nav-tab');

  const allPages = {
    landing: landingPage,
    studio: studioPage,
    library: libraryPage,
    graph: graphPage
  };

  const globalNavbar = document.getElementById('global-navbar');
  const btnGlobalBack = document.getElementById('btn-global-back');
  const bcCurrentPage = document.getElementById('bc-current-page');
  const studioQuickActions = document.getElementById('studio-quick-actions');

  const moduleTitles = {
    studio: '实验探究工作台',
    library: '概念误解与反例推演实验室',
    graph: '线性代数认知图谱'
  };

  const routeController = window.RouteController({
    window, document, allPages, navTabs, globalNavbar, bcCurrentPage,
    studioQuickActions, moduleTitles, landingVisualizer
  });

  function switchModule(targetModule, options = {}) {
    if (!routeController.navigate(targetModule, options)) return;

    // 7. 模块特定触发与子引擎就绪
    if (targetModule === 'studio') {
      requestAnimationFrame(() => {
          const workspaceNewlyCreated = !workspaceVisualizer;
          if (!workspaceVisualizer) {
          workspaceVisualizer = new Workspace2DVisualizer('viewport-canvas', 'viewport-matrix-bubble');
          window.workspaceVisualizer = workspaceVisualizer;
          if (agentEngine && typeof agentEngine.setWorkspaceVisualizer === 'function') {
            agentEngine.setWorkspaceVisualizer(workspaceVisualizer);
          }

          // 初始化 Claude 级 Artifact 舞台控制中心 (ArtifactStageDeck)
          if (!window.artifactStageDeck && window.ArtifactStageDeck) {
            const labCard = document.querySelector('.floating-lab-card');
            window.artifactStageDeck = new window.ArtifactStageDeck({
              container: labCard,
              canvasViewport: labCard ? labCard.querySelector('.canvas-viewport') : null,
              visualizer: workspaceVisualizer
            });
          }

          // 初始化空间遥测感知总线与环境启发微气泡 (SpatialTelemetryBus & AmbientScaffoldBubble)
          if (!window.spatialTelemetryBus && window.SpatialTelemetryBus) {
            window.spatialTelemetryBus = new window.SpatialTelemetryBus({
              visualizer: workspaceVisualizer,
              debounceMs: 250
            });
          }
          if (!window.ambientScaffoldBubble && window.AmbientScaffoldBubble) {
            const canvasViewport = document.querySelector('.floating-lab-card .canvas-viewport') || document.querySelector('.canvas-viewport');
            window.ambientScaffoldBubble = new window.AmbientScaffoldBubble({
              container: canvasViewport,
              bus: window.spatialTelemetryBus,
              dock: window.promptInputDock || null,
              autoDismissMs: 12000
            });
          }

          const canvasEl = document.getElementById('viewport-canvas');
          if (canvasEl) {
            canvasEl.addEventListener('mouseup', () => {
              if (canvasStateManager) {
                canvasStateManager.pushSnapshot('手动拖拽基向量');
              }
              recordTrajectorySnapshot('手动拖拽基向量');
            });
          }

          // 绑定 2D / 3D 空间维度切换 (严格保持画布极简与纯粹，不留多余占位符)
          const btnToggleDim = document.getElementById('btn-toggle-space-dimension');
          if (btnToggleDim) {
            btnToggleDim.addEventListener('click', () => {
              if (workspaceVisualizer) {
                const mode = workspaceVisualizer.toggleDimension();
                const label = document.getElementById('dim-label');
                if (label) {
                  label.textContent = mode === '3D' ? '3D 线性空间' : '2D 坐标平面';
                }
                btnToggleDim.style.color = mode === '3D' ? '#0284c7' : '#334155';
              }
            });
          }
        } else {
          workspaceVisualizer.resize();
        }
        initCanvasStateManager();
        if (workspaceNewlyCreated) window.workspaceSessions?.activate(window.sessionHistoryManager.getActiveSessionId(), { remount: true });
        initTrajectoryAndScrubber();
        initStudioMatrixWorkbench();
      });
    } else if (targetModule === 'graph') {
      initKnowledgeGraph();
    } else if (targetModule === 'library') {
      initCounterexampleWorkbench();
    }

    const activeEl = allPages[targetModule];
    if (activeEl && window.KaTeXRenderer) {
      requestAnimationFrame(() => window.KaTeXRenderer.renderElement(activeEl));
    }
  }

  // 全局返回上一页按钮
  if (btnGlobalBack) {
    btnGlobalBack.addEventListener('click', () => {
      switchModule(routeController.backTarget(), { isBack: true });
    });
  }

  // 导航栏标签点击事件
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-nav');
      switchModule(target);
    });
  });

  if (btnEnter) btnEnter.addEventListener('click', () => switchModule('studio'));
  if (btnBackHome) btnBackHome.addEventListener('click', () => switchModule('landing'));
  if (navBrandHome) navBrandHome.addEventListener('click', () => switchModule('landing'));

  // 监听浏览器 Hash
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '') || 'landing';
    if (allPages[hash] && hash !== routeController.getCurrentModule()) {
      switchModule(hash);
    }
  });

  // 页面初次载入时的路由分发 (杜绝刷新或直接访问子页面时导航栏丢失)
  const initialHash = (window.location.hash || '').replace('#', '') || 'landing';
  if (allPages[initialHash] && initialHash !== 'landing') {
    switchModule(initialHash);
  } else {
    switchModule('landing');
  }

  // ============================================================
  // 子页面 1: 概念认知图谱 DAG 初始化 (实时挂接 CognitiveTracker)
  // ============================================================
  let knowledgeGraph = null;
  function initKnowledgeGraph() {
    const container = document.getElementById('knowledge-graph-container');
    if (container && window.KnowledgeGraphDAG) {
      if (!knowledgeGraph) {
        knowledgeGraph = new window.KnowledgeGraphDAG('knowledge-graph-container', {
          cognitiveTracker: window.cognitiveTracker,
          onLaunchStudio: (preset, node) => {
            switchModule('studio');
            requestAnimationFrame(() => {
              const lesson = window.CourseLibrary?.forNode(node.id);
              if (lesson) { window.coursePanel?.start(lesson.id); return; }
              if (window.artifactStageDeck && typeof window.artifactStageDeck.setMode === 'function') {
                window.artifactStageDeck.setMode('canvas');
              }
              if (workspaceVisualizer && typeof workspaceVisualizer.setPreset === 'function') {
                workspaceVisualizer.setPreset(preset);
              }
            });
          },
          onStartCourse: (nodeId) => {
            const lesson = window.CourseLibrary?.forNode(nodeId);
            if (lesson) { switchModule('studio'); requestAnimationFrame(() => window.coursePanel?.start(lesson.id)); }
          },
          onAskAgent: (node) => {
            if (window.cognitiveTracker) {
              window.cognitiveTracker.recordPhysicalEvent('agent_concept_explored', { nodeId: node.id, label: node.label });
            }
            switchModule('studio');
            requestAnimationFrame(() => {
              const prompt = `助教你好！请针对认知图谱核心概念【${node.label}】（形式化定义为 ${node.formula}$）给出中文解释并打开可交互的数学实验，并重点辨析常见认知陷阱：“${node.misconception || ''}”。`;
              const dock = window.promptInputDock;
              const textarea = dock?.textarea || document.getElementById('dock-textarea');
              if (textarea) {
                textarea.value = prompt;
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
                textarea.focus();
              }
              const engine = window.getAgentEngine?.();
              if (engine && engine.hasValidApiKey()) {
                submitQueryToAgent(prompt);
              }
            });
          }
        });
      } else {
        knowledgeGraph.syncNodeStates();
        knowledgeGraph.updateMasteryBadge();
        knowledgeGraph.refreshNodeDOMStatus();
        knowledgeGraph.renderDrawer();
      }
    }
  }

  // ============================================================
  // 子页面 2: 实时反例推演工作台与分类过滤初始化
  // ============================================================
  let counterexampleWorkbenchInited = false;
  function initCounterexampleWorkbench() {
    if (counterexampleWorkbenchInited) return;
    counterexampleWorkbenchInited = true;

    // 分类过滤胶囊
    const filterTabs = document.querySelectorAll('.filter-tab'), cards = document.querySelectorAll('.misconception-card');
    filterTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        filterTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.getAttribute('data-filter');
        cards.forEach(card => { card.style.display = (filter === 'all' || card.getAttribute('data-category') === filter) ? 'flex' : 'none'; });
      });
    });

    // 调入画板验证按钮 (双向联动：跳转工作台 + 驱动画板补间 + 唤起助教反诘推演)
    document.querySelectorAll('.btn-load-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset') || 'singular';
        const cardTitle = btn.closest('.misconception-card')?.querySelector('.misc-card-name')?.textContent?.trim() || '经典代数反例';
        if (window.cognitiveTracker) {
          window.cognitiveTracker.recordPhysicalEvent('counterexample_constructed');
          window.cognitiveTracker.recordPhysicalEvent('counterexample_verified', { preset });
        }
        switchModule('studio');
        requestAnimationFrame(() => {
          if (workspaceVisualizer) workspaceVisualizer.setPreset(preset);
          const prompt = `助教你好！我正在验证反例库中的【${cardTitle}】（画板已切换至预设：${preset}）。请结合左侧画板的几何变换与零空间，为我推演这一反例的代数本质与充要条件！`;
          const textarea = window.promptInputDock?.textarea || document.getElementById('dock-textarea');
          if (textarea) { textarea.value = prompt; textarea.dispatchEvent(new Event('input', { bubbles: true })); textarea.focus(); }
          const engine = window.getAgentEngine?.();
          if (engine && engine.hasValidApiKey()) submitQueryToAgent(prompt);
        });
      });
    });

    // 快速预设与推演台联动
    const setMatInputs = (vals) => {
      ['mat-input-a', 'mat-input-b', 'mat-input-c', 'mat-input-d'].forEach((id, i) => { const el = document.getElementById(id); if (el) el.value = vals[i]; });
    };
    document.querySelectorAll('.btn-workbench-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        try {
          const vals = JSON.parse(chip.getAttribute('data-mat'));
          if (Array.isArray(vals) && vals.length === 4) setMatInputs(vals);
        } catch (e) { appStructuredError('workbench_matrix_preset_parse_failed', e); }
      });
    });

    // 陷阱卡片中“载入推演台计算”按钮
    document.querySelectorAll('.btn-load-workbench').forEach(btn => {
      btn.addEventListener('click', () => {
        try {
          const vals = JSON.parse(btn.getAttribute('data-mat')), act = btn.getAttribute('data-action') || 'AB_ZERO';
          if (Array.isArray(vals) && vals.length === 4) setMatInputs(vals);
          const wb = document.querySelector('.counterexample-interactive-workbench');
          if (wb) wb.scrollIntoView({ behavior: 'smooth' });
          executeWorkbenchCalculation(act);
        } catch (e) { appStructuredError('workbench_action_parse_failed', e); }
      });
    });

    function getMatInputs() {
      const a = parseFloat(document.getElementById('mat-input-a')?.value ?? 2);
      const b = parseFloat(document.getElementById('mat-input-b')?.value ?? 1);
      const c = parseFloat(document.getElementById('mat-input-c')?.value ?? 4);
      const d = parseFloat(document.getElementById('mat-input-d')?.value ?? 2);
      return [[a, b], [c, d]];
    }

    const resultBody = document.getElementById('workbench-result-body');

    async function executeWorkbenchCalculation(targetProperty, autoPerturb = false) {
      if (!resultBody) return;
      const matA = getMatInputs();
      const skill = window.CounterexampleSkill ? new window.CounterexampleSkill() : null;
      if (!skill) return;

      resultBody.innerHTML = '<div style="color: #64748b; font-size: 13px;">正在由本地符号计算引擎求解流形并构造反例...</div>';

      const res = await skill.execute({
        target_property: targetProperty,
        matrix_elements: matA,
        auto_perturb: autoPerturb
      });

      if (res.status === 'success') {
        const latex = res.latexExplanation || `\\mathbf{A}\\mathbf{B} = \\mathbf{O}`;
        const proof = res.proof || '充要条件证伪';
        const perturbNotice = res.isPerturbed ? `<div style="font-size: 12px; color: #f59e0b; margin-bottom: 6px;">⚡ 原矩阵满秩可逆无零因子，已自动应用最近奇异降维摄动算子完成反例构造。</div>` : '';

        resultBody.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div style="color: #0369a1; font-weight: 800; font-size: 14px;">✓ 代数反例与充要条件推导成功</div>
            <span style="font-size: 11px; color: #15803d; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 2px 8px; border-radius: 999px;">耗时 ${res.metadata?.duration_ms || 1}ms</span>
          </div>
          ${perturbNotice}
          <div class="result-math-card">
            <div class="dag-formula-latex">$$${latex}$$</div>
          </div>
          <div style="font-size: 12.5px; color: #475569; margin: 6px 0;"><strong>几何定理依据：</strong>${proof}</div>
          <div class="result-actions-bar">
            <button class="btn-result-debate" id="btn-debate-agent-action">
              <span>向助教发起反例推演辩论</span>
              <span>→</span>
            </button>
            <button class="btn-result-canvas" id="btn-load-canvas-action">
              调入画板观察几何状态
            </button>
          </div>
        `;

        if (window.KaTeXRenderer) window.KaTeXRenderer.renderElement(resultBody);

        // 绑定辩论按钮
        const btnDebate = resultBody.querySelector('#btn-debate-agent-action');
        if (btnDebate) {
          btnDebate.addEventListener('click', () => {
            switchModule('studio');
            requestAnimationFrame(() => {
              const query = `助教你好！我在反例推演台中设定了矩阵 A = [[${matA[0].join(', ')}], [${matA[1].join(', ')}]]，推演出性质【${targetProperty}】的反例与结论：${proof}。请展开苏格拉底式推理，深入阐明其背后的几何流形与空间核映射本质！`;
              submitQueryToAgent(query);
            });
          });
        }

        // 绑定调入画板
        // 绑定调入画板
        const btnCanvas = resultBody.querySelector('#btn-load-canvas-action');
        if (btnCanvas) {
          btnCanvas.addEventListener('click', () => {
            switchModule('studio');
            requestAnimationFrame(() => {
              if (window.artifactStageDeck && typeof window.artifactStageDeck.setMode === 'function') {
                window.artifactStageDeck.setMode('canvas');
              }
              if (workspaceVisualizer && typeof workspaceVisualizer.dispatchAgentTransform === 'function') {
                workspaceVisualizer.dispatchAgentTransform({
                  targetMatrix: { a: matA[0][0], b: matA[0][1], c: matA[1][0], d: matA[1][1] },
                  duration: 650
                });
              }
            });
          });
        }
      } else {
        // 报错或定理拒绝展示
        const err = res.error || {};
        const theoremLatex = err.theorem ? `$$${err.theorem}$$` : '';
        resultBody.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <div style="color: #b91c1c; font-weight: 800; font-size: 14px;">❖ 代数定理拒绝声明</div>
            <span style="font-size: 11px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; padding: 2px 8px; border-radius: 999px;">数学逻辑约束</span>
          </div>
          <div style="font-size: 13px; color: #334155; line-height: 1.6; margin-bottom: 8px;">${err.message || '当前输入无法构造反例'}</div>
          ${theoremLatex ? `<div class="result-math-card"><div class="dag-formula-latex">${theoremLatex}</div></div>` : ''}
          ${err.suggestedMatrixA ? `
            <div style="margin-top: 10px; display: flex; gap: 8px; align-items: center;">
              <span style="font-size: 12px; color: #64748b;">建议采用最近奇异降维矩阵：</span>
              <button class="btn-workbench-primary" style="padding: 4px 10px; font-size: 11.5px;" id="btn-apply-suggested-singular">采用摄动矩阵并重新求解</button>
            </div>
          ` : ''}
          <div class="result-actions-bar" style="margin-top: 12px;">
            <button class="btn-result-debate" id="btn-debate-agent-error">
              向助教请教此定理原因 →
            </button>
          </div>
        `;

        if (window.KaTeXRenderer) window.KaTeXRenderer.renderElement(resultBody);

        const btnApply = resultBody.querySelector('#btn-apply-suggested-singular');
        if (btnApply && err.suggestedMatrixA) {
          btnApply.addEventListener('click', () => {
            const sug = err.suggestedMatrixA;
            const elA = document.getElementById('mat-input-a');
            const elB = document.getElementById('mat-input-b');
            const elC = document.getElementById('mat-input-c');
            const elD = document.getElementById('mat-input-d');
            if (elA) elA.value = sug.a ?? sug[0][0];
            if (elB) elB.value = sug.b ?? sug[0][1];
            if (elC) elC.value = sug.c ?? sug[1][0];
            if (elD) elD.value = sug.d ?? sug[1][1];
            executeWorkbenchCalculation(targetProperty, true);
          });
        }

        const btnDebateErr = resultBody.querySelector('#btn-debate-agent-error');
        if (btnDebateErr) {
          btnDebateErr.addEventListener('click', () => {
            switchModule('studio');
            requestAnimationFrame(() => {
              const query = `助教你好！我在反例推演台中输入了矩阵 A = [[${matA[0].join(', ')}], [${matA[1].join(', ')}]]，系统提示无法构造 ${targetProperty} 的反例，给出的定理断言为：${err.theorem || err.message}。请为我详细解释为什么此时严格不存在反例！`;
              submitQueryToAgent(query);
            });
          });
        }
      }
    }

    const btnCalcZero = document.getElementById('btn-calc-zero-product');
    const btnCalcCommutator = document.getElementById('btn-calc-commutator');
    const btnCalcDet = document.getElementById('btn-calc-det-nonlinear');
    const btnCalcInv = document.getElementById('btn-calc-inverse-order');
    const btnCalcRank = document.getElementById('btn-calc-rank-inequality');

    if (btnCalcZero) btnCalcZero.addEventListener('click', () => executeWorkbenchCalculation('AB_ZERO'));
    if (btnCalcCommutator) btnCalcCommutator.addEventListener('click', () => executeWorkbenchCalculation('NON_COMMUTATIVE'));
    if (btnCalcDet) btnCalcDet.addEventListener('click', () => executeWorkbenchCalculation('DET_ADDITION_NONLINEAR'));
    if (btnCalcInv) btnCalcInv.addEventListener('click', () => executeWorkbenchCalculation('INVERSE_ORDER'));
    if (btnCalcRank) btnCalcRank.addEventListener('click', () => executeWorkbenchCalculation('RANK_INEQUALITY'));
  }

  // 4. 顶栏极简双态胶囊滑块 (.toggle-tab)
  const toggleTabs = document.querySelectorAll('.toggle-tab');
  toggleTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      toggleTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const mode = tab.getAttribute('data-mode');
      applyStudioMode(mode);
    });
  });

  function applyStudioMode(mode) {
    const title = document.querySelector('.poster-main-title');
    const lead = document.querySelector('.poster-lead');

    if (mode === 'sandbox') {
      if (title) title.textContent = `空间几何直观`;
      if (lead) lead.textContent = `拖拽基底向量 e₁ 与 e₂ 或调节变换矩阵，观察空间仿射连续形变与面积缩放。`;
      if (workspaceVisualizer) {
        workspaceVisualizer.setPreset('identity');
      }
    } else if (mode === 'conflict') {
      if (title) title.textContent = `仿射空间变换与代数分析`;
      if (lead) lead.textContent = `实时调节矩阵参数或选择空间算子，探索平面映射、子空间流形演化与代数定理。`;
      if (workspaceVisualizer) {
        workspaceVisualizer.setPreset('singular');
      }
    }
  }

  // 5. 重置视角与原点
  const btnReset = document.getElementById('btn-reset-workspace');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (workspaceVisualizer) {
        workspaceVisualizer.resize({resetView:true});
        workspaceVisualizer.rotX=0.52;workspaceVisualizer.rotY=-0.68;
        workspaceVisualizer.render();
      }
    });
  }

  // 6. 通用矩阵控制器 (Matrix Workbench) 双向数据流初始化
  let studioMatrixWorkbenchInited = false;
  function initStudioMatrixWorkbench() {
    if (!workspaceVisualizer || studioMatrixWorkbenchInited) return;
    studioMatrixWorkbenchInited = true;

    const inputA = document.getElementById('studio-mat-a');
    const inputB = document.getElementById('studio-mat-b');
    const inputC = document.getElementById('studio-mat-c');
    const inputD = document.getElementById('studio-mat-d');
    const detDisplay = document.getElementById('studio-det-display');
    const rankDisplay = document.getElementById('studio-rank-display');
    const nullityDisplay = document.getElementById('studio-nullity-display');
    const rankBadge = document.getElementById('rank-badge');
    const subspaceDesc = document.getElementById('nullspace-dynamic-expr');
    const presetChips = document.querySelectorAll('.preset-chip');

    // 画布矩阵变化时的反向数据绑定
    workspaceVisualizer.onMatrixChange = ({ matrix, det, absDet, rank, isSingular, nullity, nullBasis, colBasis }) => {
      if (inputA && document.activeElement !== inputA) inputA.value = matrix.a.toFixed(1);
      if (inputB && document.activeElement !== inputB) inputB.value = matrix.b.toFixed(1);
      if (inputC && document.activeElement !== inputC) inputC.value = matrix.c.toFixed(1);
      if (inputD && document.activeElement !== inputD) inputD.value = matrix.d.toFixed(1);

      if (detDisplay) detDisplay.textContent = det.toFixed(2);
      if (rankDisplay) rankDisplay.textContent = rank;
      if (nullityDisplay) nullityDisplay.textContent = nullity;

      if (rankBadge) {
        if (rank === 2) {
          rankBadge.className = 'symbol-rank-badge';
          rankBadge.textContent = '满秩保维 rank(A)=2';
        } else if (rank === 1) {
          rankBadge.className = 'symbol-rank-badge singular';
          rankBadge.textContent = '奇异降维 rank(A)=1';
        } else {
          rankBadge.className = 'symbol-rank-badge singular';
          rankBadge.textContent = '零空间坍缩 rank(A)=0';
        }
      }
    // M1: PECHDT 徽章不再由 rank 驱动，唯一状态源见 pechdtStateStore


      if (subspaceDesc) {
        if (rank === 2) {
          subspaceDesc.textContent = `核空间: Null(A) = {(0, 0)} (保维同构映射，仅原点映射至原点)`;
        } else if (rank === 1) {
          const nb = nullBasis[0] || [0, 0];
          subspaceDesc.innerHTML = `<span style="color:#ec4899; font-weight:700;">★ 发现一维零空间: Null(A) = Span{ [${nb[0].toFixed(2)}, ${nb[1].toFixed(2)}]ᵀ }</span> (该直线上所有非零向量映射至原点)`;
        } else {
          subspaceDesc.innerHTML = `<span style="color:#ec4899; font-weight:700;">★ 全平面坍缩: Null(A) = ℝ²</span> (所有平面向量全部映射至原点)`;
        }
      }
    };

    // 初始触发一次刷新
    if (workspaceVisualizer.updateHUD) {
      workspaceVisualizer.updateHUD();
    }

    // 矩阵输入框前向数据绑定 (严格校验有限数字，杜绝输入 '-' 或清空注入 NaN 导致画布黑屏)
    function onInputChange() {
      const a = parseFloat(inputA?.value);
      const b = parseFloat(inputB?.value);
      const c = parseFloat(inputC?.value);
      const d = parseFloat(inputD?.value);
      const cur = workspaceVisualizer.matrix;
      const target = {
        a: Number.isFinite(a) ? a : cur.a,
        b: Number.isFinite(b) ? b : cur.b,
        c: Number.isFinite(c) ? c : cur.c,
        d: Number.isFinite(d) ? d : cur.d
      };
      workspaceVisualizer.setMatrix(target);
      if (canvasStateManager && Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d)) {
        canvasStateManager.pushSnapshot(`手动编辑矩阵 [${target.a}, ${target.b}; ${target.c}, ${target.d}]`);
      }
    }

    [inputA, inputB, inputC, inputD].forEach(inp => {
      if (inp) {
        inp.addEventListener('input', onInputChange);
        inp.addEventListener('change', onInputChange);
      }
    });

    // 空间算子预设胶囊点击事件
    presetChips.forEach(chip => {
      chip.addEventListener('click', () => {
        presetChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const preset = chip.getAttribute('data-preset');
        if (preset && workspaceVisualizer.setPreset) {
          workspaceVisualizer.setPreset(preset);
        }
      });
    });
  }

  // 7. 初始化智能助教 Agent 调度引擎与状态事务管理器
  let agentEngine = null;
  let canvasStateManager = null;
  let promptInputDock = null;
  let activeAgentSubmission = null;
  let agentSubmissionSequence = 0;

  function initCanvasStateManager() {
    if (!canvasStateManager && workspaceVisualizer && window.CanvasStateManager) {
      canvasStateManager = new window.CanvasStateManager(workspaceVisualizer);
      workspaceVisualizer.stateManager = canvasStateManager;
      const btnUndo = document.getElementById('btn-undo-state');
      const btnRedo = document.getElementById('btn-redo-state');

      canvasStateManager.onChange = ({ canUndo, canRedo }) => {
        if (btnUndo) btnUndo.disabled = !canUndo;
        if (btnRedo) btnRedo.disabled = !canRedo;
      };

      if (btnUndo) {
        btnUndo.addEventListener('click', () => canvasStateManager.undo());
      }
      if (btnRedo) {
        btnRedo.addEventListener('click', () => canvasStateManager.redo());
      }

      // 监听 Ctrl+Z / Ctrl+Y 键盘快捷键
      window.addEventListener('keydown', (e) => {
        if (studioPage.classList.contains('hidden')) return;
        if (e.defaultPrevented || e.target.closest?.('input,textarea,select,[contenteditable="true"],[role="textbox"]')) return;
        if (!document.querySelector('.canvas-viewport')?.contains(e.target)) return;
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
          e.preventDefault();
          canvasStateManager.undo();
        } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
          e.preventDefault();
          canvasStateManager.redo();
        }
      });
    }
  }

  // 时空轨迹与时间旅行记录仪 (Time Travel Scrubber)
  let trajectoryRecorder = null;
  let timeTravelScrubber = null;

  function initTrajectoryAndScrubber() {
    if (!trajectoryRecorder && window.TrajectoryRecorder) {
      trajectoryRecorder = new window.TrajectoryRecorder({ storageKey: 'wenju_trajectory_archive' });
      if (workspaceVisualizer && trajectoryRecorder.snapshots.length === 0) {
        trajectoryRecorder.record({
          matrixState: {
            elements: [[workspaceVisualizer.matrix.a, workspaceVisualizer.matrix.b], [workspaceVisualizer.matrix.c, workspaceVisualizer.matrix.d]],
            det: workspaceVisualizer.getDeterminant(),
            rank: workspaceVisualizer.getRank(),
            isSingular: workspaceVisualizer.getRank() < 2
          },
          dialogueDelta: { role: 'assistant', content: '初始单位空间映射' }
        });
      }
      window.trajectoryRecorder = trajectoryRecorder;
    }

    const mountEl = document.getElementById('time-travel-scrubber-mount');
    if (!timeTravelScrubber && window.TimeTravelScrubber && mountEl && trajectoryRecorder) {
      timeTravelScrubber = new window.TimeTravelScrubber({
        container: mountEl,
        recorder: trajectoryRecorder,
        onScrub: (snapshot) => {
          if (snapshot && snapshot.matrixState && workspaceVisualizer) {
            const m = snapshot.matrixState.elements;
            if (m && m.length === 2) {
              workspaceVisualizer.setMatrix({ a: m[0][0], b: m[0][1], c: m[1][0], d: m[1][1] });
            }
          }
        },
        onResumeLive: () => {
          console.log('[TimeTravel] Resumed to live state');
        }
      });
      timeTravelScrubber.mount(mountEl);
    }
  }

  function recordTrajectorySnapshot(description = '', dialogue = null) {
    if (!trajectoryRecorder || !workspaceVisualizer) return;
    trajectoryRecorder.record({
      matrixState: {
        elements: [[workspaceVisualizer.matrix.a, workspaceVisualizer.matrix.b], [workspaceVisualizer.matrix.c, workspaceVisualizer.matrix.d]],
        det: workspaceVisualizer.getDeterminant(),
        rank: workspaceVisualizer.getRank(),
        isSingular: workspaceVisualizer.getRank() < 2,
        nullBasis: workspaceVisualizer.getNullBasis ? workspaceVisualizer.getNullBasis() : [],
        colBasis: workspaceVisualizer.getColBasis ? workspaceVisualizer.getColBasis() : []
      },
      dialogueDelta: dialogue || { role: 'user', content: description }
    });
  }

  function getAgentEngine() {
    if (!agentEngine && window.TeachAgentEngine) {
      agentEngine = new window.TeachAgentEngine(workspaceVisualizer);
    }
    if (agentEngine && workspaceVisualizer) {
      if (typeof agentEngine.setWorkspaceVisualizer === 'function') {
        agentEngine.setWorkspaceVisualizer(workspaceVisualizer);
      } else {
        agentEngine.workspaceVisualizer = workspaceVisualizer;
      }
    }
    if (agentEngine && agentEngine.modelClient) {
      window.modelClient = agentEngine.modelClient;
    }
    return agentEngine;
  }

  // 统一对外暴露全局句柄与模型客户端单例
  window.getAgentEngine = getAgentEngine;
  getAgentEngine();
  if (!window.modelClient && window.UnifiedModelClient) {
    window.modelClient = new window.UnifiedModelClient();
  }

  const agentSessionStream = document.getElementById('agent-session-stream');

  // 7.9 初始化多任务会话历史管理器与全文检索 (SessionHistoryManager)
  let sessionHistoryManager = null;
  if (typeof window !== 'undefined' && window.SessionHistoryManager) {
    sessionHistoryManager = new window.SessionHistoryManager();
    window.sessionHistoryManager = sessionHistoryManager;
  }

  // P2 教学内核单例：预测采集器 / 三态诊断（误解库种子异步装载）
  if (typeof window !== 'undefined') {
    if (!window.predictionCollector) {
      // UMD 加载时已创建共享单例（window.predictionCollector）；此分支仅为加载顺序兜底
      window.predictionCollector = (window.PredictionCollector && window.PredictionCollector.getSharedCollector)
        ? window.PredictionCollector.getSharedCollector()
        : null;
    }
    (async () => {
      try {
        const res = await fetch('js/cognition/misconceptions.json');
        const seed = await res.json();
        const LibClass = window.MisconceptionLibrary && window.MisconceptionLibrary.MisconceptionLibrary
          ? window.MisconceptionLibrary.MisconceptionLibrary : window.MisconceptionLibrary;
        window.misconceptionLibrary = new LibClass(seed);
        if (window.MisconceptionTracker) {
          // UMD 形状兼容：window.MisconceptionTracker 可能是 { MisconceptionTracker, bktStep } 对象而非类
          const TrkClass = (window.MisconceptionTracker.MisconceptionTracker) || window.MisconceptionTracker;
          window.misconceptionTracker = new TrkClass(window.misconceptionLibrary);
        }
      } catch (e) { console.warn('[P2] 误解库种子装载失败（诊断退化为默认参数）:', e && e.message); }
    })();
    // 六步探究编排器（真实交互路径入口；依赖 store+collector，误解库/变式库经惰性 getter）
    if (window.InquiryFlowController && !window.inquiryFlow) {
      const FlowClass = window.InquiryFlowController.InquiryFlowController || window.InquiryFlowController;
      window.inquiryFlow = new FlowClass({
        store: window.pechdtStateStore,
        collector: window.predictionCollector,
        getTracker: () => window.misconceptionTracker || null,
        getLibrary: () => window.misconceptionLibrary || null,
        bank: window.VariantTaskBank || null,
        getTimeline: () => window.teachingTimeline || null
      });
    }
    // P3 教学事件时间线：订阅 store/collector/tracker 真实事件源
    // 注意：TeachingTimeline UMD 在加载期已创建共享实例（无订阅）——此处必须"补挂"事件源，而非因已存在而跳过
    if (window.TeachingTimeline && !window.teachingTimeline) {
      const TLClass = window.TeachingTimeline.TeachingTimeline || window.TeachingTimeline;
      window.teachingTimeline = new TLClass({});
    }
    if (window.teachingTimeline) {
      if (!window.teachingTimeline.store && window.pechdtStateStore) {
        window.teachingTimeline.attachStore(window.pechdtStateStore);
      }
      if (!window.teachingTimeline.collector && window.predictionCollector) {
        window.teachingTimeline.attachCollector(window.predictionCollector);
      }
      const attachTrackerWhenReady = setInterval(() => {
        if (window.misconceptionTracker) {
          if (typeof window.teachingTimeline.attachTracker === 'function') window.teachingTimeline.attachTracker(window.misconceptionTracker);
          clearInterval(attachTrackerWhenReady);
        }
      }, 500);
    }

    // P6-A/P7-H1：存储端口（宿主 SQLite 优先 → IndexedDB）——时间线/会话端口镜像 + 端口优先恢复
    (async () => {
      let port = null;
      // P7-H1：宿主模式（localStorage.wenju_host_config = {baseUrl, token}）→ 会话 SQLite 化
      try {
        const hostRaw = (typeof localStorage !== 'undefined') ? localStorage.getItem('wenju_host_config') : null;
        if (hostRaw && typeof window.connectHostStorage === 'function') {
          const cfg = JSON.parse(hostRaw) || {};
          window.hostConnectionState = { status: 'checking' };
          const conn = await window.connectHostStorage({ baseUrl: cfg.baseUrl, token: cfg.token, confirmToken: cfg.confirmToken });
          if (conn && conn.ok) {
            window.hostConnectionState = { status: 'connected', baseUrl: cfg.baseUrl };
            port = conn.port;
            window.hostStoragePort = port;
            // P7-H9：宿主文件工作区端点（真磁盘白名单根；技能侧按 window.wenjuHostFileEndpoint 热解析）
            window.wenjuHostFileEndpoint = { baseUrl: cfg.baseUrl, token: cfg.token, confirmToken: cfg.confirmToken || null };
            if (console.debug) console.debug('[P7] 宿主 SQLite 存储端口已连接', { baseUrl: cfg.baseUrl, backend: port.getStatus().backend });
          } else if (console.warn) {
            window.hostConnectionState = { status: 'error', code: conn?.code || 'HOST_UNREACHABLE', message: conn?.message || '连接未通过检查' };
            console.warn('[P7] 宿主存储端口不可用，回退 IndexedDB:', conn && conn.code, conn && conn.message);
          }
        }
      } catch (e) { window.hostConnectionState = { status: 'error', code: e.code || 'HOST_CONFIG_INVALID', message: e.message }; recordIssue('app', 'connect_host', e); }
      if (!port && window.getSharedStoragePort) {
        try { port = window.getSharedStoragePort(); } catch (e) { port = null; }
      }
      if (!port) return;
      window.activeStoragePort = port;
      if (window.teachingTimeline && typeof window.teachingTimeline.attachPort === 'function') {
        try {
          window.teachingTimeline.attachPort(port);
          const r = await window.teachingTimeline.rehydrate();
          if (r && r.ok && r.source === 'port' && console.debug) {
            console.debug('[P6] 教学时间线已从存储端口恢复', { events: r.events, chainsOK: r.chainsOK, backend: port.getStatus().backend });
          }
          // P7-H1 竞态修复：挂接前发生的追加补推端口（否则端口缺首段历史）
          if ((r?.ok || r?.code === 'PORT_EMPTY') && typeof window.teachingTimeline.syncToPort === 'function') window.teachingTimeline.syncToPort();
        } catch (e) { /* 端口异常 → localStorage 主路径继续 */ }
      }
      // P6-A2：会话存储迁移（宿主 SQLite 模式即"会话 SQLite 化"）
      if (sessionHistoryManager && typeof sessionHistoryManager.attachPort === 'function') {
        try {
          sessionHistoryManager.attachPort(port);
          const r = await sessionHistoryManager.rehydrate();
          if (r && r.ok && r.source === 'port' && console.debug) {
            console.debug('[P6] 会话历史已从存储端口恢复', { sessions: r.sessions, backend: port.getStatus().backend });
          }
          if (r?.ok && r.source === 'port') { workspaceSessions.activate(sessionHistoryManager.getActiveSessionId(), { remount: true }); switchSession(sessionHistoryManager.getActiveSessionId()); }
          if (r && !r.ok && r.code !== 'PORT_EMPTY') { recordIssue('app', 'rehydrate_sessions', r); return; }
          // P7-H1 竞态修复：挂接前发生的会话写入补推端口
          if (typeof sessionHistoryManager.syncToPort === 'function') sessionHistoryManager.syncToPort();
        } catch (e) { /* 端口异常 → localStorage 主路径继续 */ }
      }
    })();
    // P6-B：AgentTracer（未创建时先建；引擎构造与 processQuery 均惰性拾取）
    if (window.getSharedAgentTracer && !window.agentTracer) {
      try { window.agentTracer = window.getSharedAgentTracer(); } catch (e) { /* 遥测不可用不影响主流程 */ }
    }

    // P4 T4.5（W7）：ArtifactStore → TeachingTimeline 联动——工件创建/版本事件写入教学哈希链
    if (window.ArtifactStore && !window.artifactStore) {
      const ASClass = window.ArtifactStore.ArtifactStore || window.ArtifactStore;
      window.artifactStore = new ASClass();
    }
    if (window.artifactStore && window.teachingTimeline) {
      window.artifactStore.on((evt) => {
        const task = window.inquiryFlow && window.inquiryFlow.getActiveTask ? window.inquiryFlow.getActiveTask() : null;
        window.teachingTimeline.append(evt.type, {
          artifactId: evt.artifactId, versionId: evt.versionId,
          kind: evt.kind, sourceHash: evt.sourceHash, seq: evt.seq
        }, task ? task.taskId : null);
      });
    }
    // P4 T4.4（W6）：画布后端路由器（JSXGraph 接线）
    if (window.CanvasBackendRouter && !window.canvasBackendRouter) {
      const CBClass = window.CanvasBackendRouter.CanvasBackendRouter || window.CanvasBackendRouter;
      window.canvasBackendRouter = new CBClass(window.workspaceVisualizer, 'jsxgraph-viewport');
    }


  function appendAgentNotice(noticeText, kind) {
    if (!agentSessionStream) return;
    const el = document.createElement('div');
    el.className = 'agent-notice' + (kind === 'template' ? ' template-note' : '');
    el.textContent = noticeText;
    agentSessionStream.appendChild(el);
    agentSessionStream.scrollTop = agentSessionStream.scrollHeight;
    return el;
  }

    // ── P3 无提示模式（真实 DOM 折叠 + 模板遮蔽 + 有痕恢复）──
    // fresh=true：新变式发布时重置"已揭示"状态（每个新题重新遮蔽，审计修复）
    function setNoHintMode(on, fresh) {
      if (!agentSessionStream) return;
      agentSessionStream.classList.toggle('no-hint-mode', !!on);
      if (on && fresh) {
        agentSessionStream.classList.remove('hint-revealed');
        const btn = document.getElementById('no-hint-reveal');
        if (btn) { btn.textContent = '临时查看提示（记录留痕）'; btn.disabled = false; }
      }
      let banner = document.getElementById('no-hint-banner');
    if (on) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'no-hint-banner';
        banner.className = 'agent-notice no-hint-banner';
        banner.innerHTML = '🚀 <strong>无提示模式</strong>：历史推导与已展示模板已遮蔽（教学承诺）。' +
          '<button type="button" id="no-hint-reveal" class="btn-artifact-action">临时查看提示（记录留痕）</button>';
        agentSessionStream.parentElement.insertBefore(banner, agentSessionStream);
        banner.querySelector('#no-hint-reveal').addEventListener('click', () => {
          agentSessionStream.classList.add('hint-revealed');
          document.getElementById('no-hint-reveal').textContent = '已揭示（本次作答不再遮蔽）';
          document.getElementById('no-hint-reveal').disabled = true;
          if (window.teachingTimeline && window.inquiryFlow && window.inquiryFlow.getActiveTask()) {
            window.teachingTimeline.append('hint_revealed', { at: new Date().toISOString() }, window.inquiryFlow.getActiveTask().taskId);
          }
        });
      }
      banner.style.display = '';
    } else if (banner) {
      banner.style.display = 'none';
    }
  }

  // ── P3 回放面板（真实渲染 TeachingTimeline 链，含哈希校验徽章）──
  function openReplayPanel(taskId) {
    const tl = window.teachingTimeline;
    let panel = document.getElementById('replay-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'replay-panel';
      panel.className = 'replay-panel';
      panel.innerHTML = '<div class="replay-head"><strong>🧭 教学回放</strong><span id="replay-verify-badge" class="replay-badge"></span><button type="button" id="replay-close" class="btn-artifact-action">关闭</button></div><div id="replay-body" class="replay-body"></div>';
      document.body.appendChild(panel);
      panel.querySelector('#replay-close').addEventListener('click', () => { panel.style.display = 'none'; });
    }
    const body = panel.querySelector('#replay-body');
    const badge = panel.querySelector('#replay-verify-badge');
    if (!tl) { body.textContent = '（时间线未装载）'; panel.style.display = ''; return; }
    const task = window.inquiryFlow && window.inquiryFlow.getActiveTask();
    const tid = taskId || (task && task.taskId) || (tl.tasks()[tl.tasks().length - 1]);
    if (!tid) { body.textContent = '（暂无教学事件）'; panel.style.display = ''; return; }
    const verify = tl.verify(tid);
    badge.textContent = verify.ok ? ('哈希链校验通过（' + verify.length + ' 事件）') : ('⚠️ 链校验失败 @事件 ' + verify.brokenAt + '（' + verify.reason + '）');
    badge.className = 'replay-badge ' + (verify.ok ? 'ok' : 'broken');
    const icons = { conjecture: '💭', prediction: '🔮', parse_confirm: '✅', experiment_fact: '🧪', conflict: '⚡', discriminating_q: '🩺', evidence: '📌', status_change: '🔀', hypothesis: '💡', deduction: '∑', variant_issue: '🚀', variant_grade: '🏁', hint_revealed: '👁️', termination: '🧭' };
    body.innerHTML = tl.list(tid).map((e) => {
      const t = e.ts.slice(11, 19);
      let detail = '';
      if (e.type === 'prediction') detail = '预测「' + (e.payload.prediction || '') + '」理由：' + String(e.payload.rationale || '').slice(0, 50);
      else if (e.type === 'conflict') detail = '预测 ' + JSON.stringify(e.payload.prediction) + ' vs 事实 ' + JSON.stringify(e.payload.fact) + '（' + (e.payload.kernel || '') + '）';
      else if (e.type === 'experiment_fact') detail = e.payload.key + ' = ' + JSON.stringify(e.payload.fact);
      else if (e.type === 'variant_issue') detail = e.payload.variantId + '（' + e.payload.chapter + '）';
      else if (e.type === 'variant_grade') detail = e.payload.variantId + ' → ' + (e.payload.passed ? '通过' : '未过');
      else if (e.type === 'status_change') detail = e.payload.stage + '（' + (e.payload.source || '') + '）';
      else if (e.type === 'evidence') detail = (e.payload.mcId || e.payload.id || '') + ' · ' + (e.payload.status || '') + ' · pL=' + (typeof e.payload.pL === 'number' ? e.payload.pL.toFixed(3) : '');
      else if (e.type === 'termination') detail = e.payload.action + '：' + (e.payload.reason || '').slice(0, 60);
      else detail = JSON.stringify(e.payload || {}).slice(0, 80);
      return '<div class="replay-row replay-' + e.type + '"><span class="replay-seq">#' + e.seq + '</span><span class="replay-time">' + t + '</span><span class="replay-icon">' + (icons[e.type] || '•') + '</span><span class="replay-type">' + e.type + '</span><span class="replay-detail">' + detail.replace(/[<>]/g, '') + '</span><span class="replay-hash" title="事件哈希">' + e.hash.slice(0, 6) + '</span></div>';
    }).join('');
    panel.style.display = '';
  }

  // ── P3 冲突事件统一渲染入口（app 内 onUpdate 与真机测试共用同一实现）──
  window.__renderTeachingEvent = function (evt) {
    if (!evt || evt.type !== 'conflict') { appendAgentNotice('（教学事件：' + (evt && evt.type) + '）'); return; }
    const r = evt.record || {};
    appendAgentNotice('⚡ 预测-事实冲突：你预测「' + String(r.predictionText || r.prediction) + '」（理由：' + String(r.rationale || '').slice(0, 60) + '），精确计算结果为 ' + String(r.fact) + '（内核 ' + String(r.kernel || 'rational-core') + '）。什么情况下你的猜想才成立？——进入边界猜想。');
    if (window.inquiryFlow && typeof window.inquiryFlow.takeDiscriminatingPrompt === 'function') {
      const dp = window.inquiryFlow.takeDiscriminatingPrompt();
      if (dp) {
        window.__pendingDiscPrompt = dp;
        appendAgentNotice('🩺 区分性追问：' + dp.stem + '\n' + dp.options.join('\n') + '\n（回复 1 / 2 / 3）');
      }
    }
    // 冲突后预测已被事实对照（pending 清零）→ 刷新未决横幅（审计修复）
    if (typeof window.__refreshPendingBanner === 'function') window.__refreshPendingBanner();
  };

  // ── P3 未决预测提示条（Z5：会话恢复时可见，点击直达回放时间线）──
  function refreshPendingPredictionBanner() {
    if (!window.predictionCollector || !window.inquiryFlow) return;
    const task = window.inquiryFlow.getActiveTask && window.inquiryFlow.getActiveTask();
    let banner = document.getElementById('pending-pred-banner');
    const pending = task ? window.predictionCollector.getPendingForTask(task.taskId) : [];
    if (!pending.length) { if (banner) banner.style.display = 'none'; return; }
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'pending-pred-banner';
      banner.className = 'agent-notice';
      banner.innerHTML = '🔮 <strong>你有 ' + pending.length + ' 个未决预测</strong>（尚未做实验对照）。' +
        '<button type="button" id="pending-pred-open" class="btn-artifact-action">查看回放时间线</button>';
      const host = document.getElementById('agent-session-stream');
      if (host && host.parentElement) host.parentElement.insertBefore(banner, host);
      banner.querySelector('#pending-pred-open').addEventListener('click', () => openReplayPanel());
    } else {
      banner.querySelector('strong').textContent = '你有 ' + pending.length + ' 个未决预测';
    }
    banner.style.display = '';
  }
  window.__refreshPendingBanner = refreshPendingPredictionBanner;
  window.__openReplayPanel = openReplayPanel;
  // 页面加载/会话恢复：容器就绪后刷新（前 12 秒轮询，覆盖误解库异步装载窗口）
  let pendingBannerTries = 0;
  const pendingBannerTimer = setInterval(() => {
    pendingBannerTries += 1;
    refreshPendingPredictionBanner();
    if (pendingBannerTries >= 24) clearInterval(pendingBannerTimer);
  }, 500);
  }

  const workspaceSessions = window.SessionWorkspaceController({
    window, manager: sessionHistoryManager, getVisualizer: () => workspaceVisualizer,
    stop: () => { getAgentEngine()?.abort?.(); if (activeAgentSubmission && !activeAgentSubmission.terminal) activeAgentSubmission.stop(); if (window.studioFSM && window.StudioEvents) window.studioFSM.transition(window.StudioEvents.RESET); }
  });
  window.workspaceSessions = workspaceSessions;
  window.addEventListener('pagehide', () => workspaceSessions.capture());
  const sessionController = window.SessionController({
    window, document, sessionHistoryManager, agentSessionStream, workspaceSessions,
    escapeHtml, formatMarkdownToHtml, renderInitialAgentGreeting, scrollStreamToBottom,
    getPromptTurnNavigator: () => promptTurnNavigator, getWorkspaceVisualizer: () => workspaceVisualizer,
    prompt: (...args) => window.prompt(...args), confirm: (...args) => window.confirm(...args),
    stop: () => { getAgentEngine()?.abort?.(); if (activeAgentSubmission && !activeAgentSubmission.terminal) activeAgentSubmission.stop(); if (window.studioFSM && window.StudioEvents) window.studioFSM.transition(window.StudioEvents.RESET); }
  });
  const { updateSessionHeaderUI, toggleSessionDrawer, renderSessionDrawerList,
    switchSession, bindSessionDrawerEvents } = sessionController;
  sessionHistoryManager.subscribe(event => {
    if (event === 'turn_appended') workspaceSessions.capture();
    if (event === 'session_expired') {
      try { workspaceSessions.clearCurrent(); switchSession(sessionHistoryManager.getActiveSessionId()); window.showToastNotification?.('检测到您已离开超过 8 分钟，为保护隐私已自动归位全新探究任务'); } catch (e) { if (typeof recordIssue === 'function') recordIssue('app', 'idle_timeout_clear', e); }
    }
  });
  setInterval(() => sessionHistoryManager?.checkTtlExpired?.(), 15000);
  window.addEventListener('pointerdown', () => sessionHistoryManager?.touch?.(), { passive: true });

  let currentSearchMatches = [];
  let currentSearchIndex = 0;

  function bindMessageSearchEvents() {
    const btnToggle = document.getElementById('btn-toggle-msg-search');
    const searchBar = document.getElementById('console-msg-search-bar');
    const input = document.getElementById('msg-search-input');
    const countEl = document.getElementById('msg-search-count');
    const prevBtn = document.getElementById('btn-msg-search-prev');
    const nextBtn = document.getElementById('btn-msg-search-next');
    const closeBtn = document.getElementById('btn-msg-search-close');

    if (!btnToggle || !searchBar || !input) return;

    function openSearch() {
      searchBar.classList.remove('hidden');
      input.focus();
      input.select();
      if (input.value) performSearch(input.value);
    }

    function closeSearch() {
      searchBar.classList.add('hidden');
      clearSearchHighlights();
    }

    btnToggle.addEventListener('click', () => {
      if (searchBar.classList.contains('hidden')) {
        openSearch();
      } else {
        closeSearch();
      }
    });

    if (closeBtn) closeBtn.addEventListener('click', closeSearch);

    function clearSearchHighlights() {
      if (!agentSessionStream) return;
      agentSessionStream.querySelectorAll('mark.search-highlight').forEach(m => {
        const parent = m.parentNode;
        parent.replaceChild(document.createTextNode(m.textContent), m);
        parent.normalize();
      });
      currentSearchMatches = [];
      currentSearchIndex = 0;
      if (countEl) countEl.textContent = '0/0';
    }

    function performSearch(query) {
      clearSearchHighlights();
      const q = (query || '').trim();
      if (!q || !agentSessionStream) return;

      const walker = document.createTreeWalker(
        agentSessionStream,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode: (node) => {
            if (!node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            if (node.parentNode && (node.parentNode.tagName === 'SCRIPT' || node.parentNode.tagName === 'STYLE')) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          }
        }
      );

      const textNodes = [];
      while (walker.nextNode()) {
        textNodes.push(walker.currentNode);
      }

      const qLower = q.toLowerCase();
      const markElements = [];

      for (const node of textNodes) {
        const val = node.nodeValue;
        const valLower = val.toLowerCase();
        let idx = valLower.indexOf(qLower);
        if (idx === -1) continue;

        const frag = document.createDocumentFragment();
        let lastIdx = 0;

        while (idx !== -1) {
          if (idx > lastIdx) {
            frag.appendChild(document.createTextNode(val.slice(lastIdx, idx)));
          }
          const mark = document.createElement('mark');
          mark.className = 'search-highlight';
          mark.textContent = val.slice(idx, idx + q.length);
          frag.appendChild(mark);
          markElements.push(mark);

          lastIdx = idx + q.length;
          idx = valLower.indexOf(qLower, lastIdx);
        }

        if (lastIdx < val.length) {
          frag.appendChild(document.createTextNode(val.slice(lastIdx)));
        }

        if (node.parentNode) {
          node.parentNode.replaceChild(frag, node);
        }
      }

      currentSearchMatches = markElements;
      if (currentSearchMatches.length > 0) {
        currentSearchIndex = 0;
        focusSearchMatch(0);
      } else {
        if (countEl) countEl.textContent = '0/0';
      }
    }

    function focusSearchMatch(idx) {
      if (currentSearchMatches.length === 0) return;
      currentSearchMatches.forEach(m => m.classList.remove('active-search-match'));
      currentSearchIndex = (idx + currentSearchMatches.length) % currentSearchMatches.length;
      const target = currentSearchMatches[currentSearchIndex];
      target.classList.add('active-search-match');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (countEl) {
        countEl.textContent = `${currentSearchIndex + 1}/${currentSearchMatches.length}`;
      }
    }

    input.addEventListener('input', () => {
      performSearch(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          focusSearchMatch(currentSearchIndex - 1);
        } else {
          focusSearchMatch(currentSearchIndex + 1);
        }
      } else if (e.key === 'Escape') {
        closeSearch();
      }
    });

    if (prevBtn) {
      prevBtn.addEventListener('click', () => focusSearchMatch(currentSearchIndex - 1));
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => focusSearchMatch(currentSearchIndex + 1));
    }

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        const consoleCard = document.querySelector('.floating-console-card');
        if (consoleCard && (consoleCard.contains(document.activeElement) || window.location.hash.includes('studio'))) {
          e.preventDefault();
          openSearch();
        }
      }
    });
  }

  window.sessionController = sessionController;
  bindSessionDrawerEvents();
  bindMessageSearchEvents();
  updateSessionHeaderUI();

  // 8. 初始化悬浮交互坞 (PromptInputDock)
  if (window.PromptInputDock && document.getElementById('dock-mount-point')) {
    promptInputDock = new window.PromptInputDock({
      containerId: 'dock-mount-point',
      onSubmit: ({ text, imageBase64 }) => {
        submitQueryToAgent(text, imageBase64);
      },
      onAbort: () => {
        try {
          const engine = getAgentEngine();
          if (engine && typeof engine.abort === 'function') engine.abort();
        } catch (e) {
          console.warn('[app.js] engine.abort warning:', e);
        }
        if (activeAgentSubmission && !activeAgentSubmission.terminal) activeAgentSubmission.stop();
        if (window.studioFSM && window.StudioEvents) window.studioFSM.transition(window.StudioEvents.RESET);
        return true;
      }
    });
    window.promptInputDock = promptInputDock;
    promptInputDock.textarea.addEventListener('input',()=>workspaceSessions.saveComposerDraft());
  }

  // 8.0 初始化猜想与预测引导卡片 (HypothesisScaffoldCard)
  if (window.HypothesisScaffoldCard && document.getElementById('dock-mount-point')) {
    const scaffoldMount = document.createElement('div');
    scaffoldMount.id = 'hypothesis-scaffold-mount';
    const dockMount = document.getElementById('dock-mount-point');
    dockMount.insertBefore(scaffoldMount, dockMount.firstChild);
    window.hypothesisScaffoldCard = new window.HypothesisScaffoldCard({
      container: scaffoldMount,
      store: window.pechdtStateStore,
      collector: window.predictionCollector,
      flow: window.inquiryFlow,
      getVisualizer: () => workspaceVisualizer,
      onSubmit: (text) => submitQueryToAgent(text)
    });
  }

  // Ctrl/Cmd+K：跨会话提示词快速搜索；命中项直接回填输入坞，不自动提交。
  if (window.PromptPalette && document.body) {
    window.promptPalette = new window.PromptPalette({
      container: document.body,
      seedPrompts: [
        { id: 'linear-algebra-guided-proof', title: '矩阵变换苏格拉底探究', tags: ['线性代数', '教学'], content: '请先读取当前画布矩阵，提出一个可由拖动基向量验证的观察问题，再用 Oracle 回读结果检查猜想。不要直接给出终解。' },
        { id: 'code-review-plan', title: '代码工程审阅计划', tags: ['工程', '审阅'], content: '请扫描工程结构、运行入口、测试和安全边界，给出可验证的风险清单、最小修复计划与回归命令。' },
        { id: 'artifact-build', title: '生成可回放 Artifact', tags: ['Artifact', '画布'], content: '请把当前推导整理为可回放 Artifact：输入、步骤、状态快照、可验证断言和失败分支必须可导出。' }
      ],
      onInsert: (content) => {
        const textarea = promptInputDock?.textarea || document.querySelector('#dock-textarea');
        if (!textarea) return;
        textarea.value = content;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
      }
    });
  }

  // 8.1 初始化会话提示词轮次时间线导航轨 (PromptTurnNavigator)
  let promptTurnNavigator = null;
  if (window.PromptTurnNavigator && document.getElementById('prompt-turn-rail')) {
    promptTurnNavigator = new window.PromptTurnNavigator({
      railContainer: 'prompt-turn-rail',
      streamContainer: 'agent-session-stream'
    });
    window.promptTurnNavigator = promptTurnNavigator;
  }

  // 9. 渲染初始默认启发式问候 (对标 ChatGPT / ZCode 极简居中空态)
  function renderInitialAgentGreeting() {
    if (!agentSessionStream) return;
    agentSessionStream.innerHTML = `
      <div class="chat-welcome-container">
        <div class="welcome-logo-wrap">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
        </div>
        <h2 class="welcome-title">在线代数推演助教</h2>
        <p class="welcome-desc">
          基于几何画板与符号代数内核，提供空间映射、奇异降维与零空间流形的交互式推演。
        </p>

        <div class="welcome-section-header" style="font-size:11.5px;font-weight:600;color:#64748b;margin:12px 0 6px;">✦ 探究课题（向助教提问）</div>
        <div class="welcome-chips-list">
          <button type="button" class="welcome-chip-item" data-query="探究矩阵乘积 A · B = 0 的几何充要条件与核空间映射"><span>探究矩阵乘积 A · B = 0 的几何充要条件</span><span class="welcome-chip-arrow">→</span></button>
          <button type="button" class="welcome-chip-item" data-query="观察基底剪切变换 (Shear) 对仿射空间与面积的影响"><span>观察基底剪切变换 (Shear) 对空间网格的影响</span><span class="welcome-chip-arrow">→</span></button>
          <button type="button" class="welcome-chip-item" data-query="分析奇异矩阵降维与核空间流形变化"><span>分析奇异矩阵降维与核空间流形变化</span><span class="welcome-chip-arrow">→</span></button>
        </div>
        <div class="welcome-section-header" style="font-size:11.5px;font-weight:600;color:#0284c7;margin:14px 0 6px;">✦ 离线免配置 · 即刻交互体验</div>
        <div class="welcome-chips-list offline-pack">
          <button type="button" class="welcome-chip-item action-chip" data-action="explore-canvas"><span>🎨 自由基底画板 · 拖拽 e₁/e₂ 向量</span><span class="welcome-chip-tag" style="font-size:10px;padding:1px 6px;border-radius:4px;background:#e0f2fe;color:#0284c7;font-weight:600;">无需 Key</span></button>
          <button type="button" class="welcome-chip-item action-chip" data-action="explore-dualview"><span>✨ 现代双视图 · 输入/输出空间对比</span><span class="welcome-chip-tag" style="font-size:10px;padding:1px 6px;border-radius:4px;background:#e0f2fe;color:#0284c7;font-weight:600;">无需 Key</span></button>
          <button type="button" class="welcome-chip-item action-chip" data-action="explore-manim"><span>🎬 5部视频微课 · 纯视觉几何变换</span><span class="welcome-chip-tag" style="font-size:10px;padding:1px 6px;border-radius:4px;background:#e0f2fe;color:#0284c7;font-weight:600;">无需 Key</span></button>
          <button type="button" class="welcome-chip-item action-chip" data-action="explore-courses"><span>📚 4大章节课程实验 · 闯关式核验</span><span class="welcome-chip-tag" style="font-size:10px;padding:1px 6px;border-radius:4px;background:#e0f2fe;color:#0284c7;font-weight:600;">无需 Key</span></button>
        </div>
      </div>
    `;

    // 绑定推荐引导卡片点击事件
    agentSessionStream.querySelectorAll('.welcome-chip-item:not(.action-chip)').forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-query');
        if (query) submitQueryToAgent(query);
      });
    });

    // 绑定离线免 Key 探索动作
    agentSessionStream.querySelectorAll('.welcome-chip-item.action-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const action = chip.getAttribute('data-action');
        if (action === 'explore-canvas') {
          if (window.artifactStageDeck) window.artifactStageDeck.setMode('canvas');
        } else if (action === 'explore-dualview') {
          if (window.artifactStageDeck) window.artifactStageDeck.openModernDualView();
        } else if (action === 'explore-manim') {
          if (window.artifactStageDeck) window.artifactStageDeck.setMode('manim');
        } else if (action === 'explore-courses') {
          if (window.artifactStageDeck) window.artifactStageDeck.setMode('courses');
        }
      });
    });
  }
  renderInitialAgentGreeting();

  // 绑定聊天流中的 CTA 事件委托 (如配置 API Key)
  if (agentSessionStream) {
    agentSessionStream.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-chat-open-settings, [data-action="open-settings"]');
      if (btn && typeof window.openApiModal === 'function') {
        window.openApiModal();
      }
    });
  }

  // 10. Agent 推理会话派遣与 ZCode 组件流式渲染 (状态机与骨架屏驱动)
  async function submitQueryToAgent(customText = null, customImg = null) {
    let text = customText !== null ? customText : '';
    const img = customImg || null;

    if (!text && !img) return;

    // 0. 支持即时快捷命令 (/clear, /reset, /history, /effort, /compact, /matrix, /probe, /predict, /replay, /review-export, /review-import, /metrics, /help)
    const trimmedCmd = text.trim();
    if (trimmedCmd === '/clear') {
      if (agentSessionStream) {
        agentSessionStream.innerHTML = '';
        renderInitialAgentGreeting();
      }
      if (promptTurnNavigator) {
        promptTurnNavigator.clear();
      }
      return;
    } else if (trimmedCmd === '/reset') {
      if (workspaceVisualizer && typeof workspaceVisualizer.resetMatrix === 'function') {
        workspaceVisualizer.resetMatrix();
      } else if (workspaceVisualizer && typeof workspaceVisualizer.setBasisVectors === 'function') {
        workspaceVisualizer.setBasisVectors([1, 0], [0, 1]);
      }
      return;
    } else if (trimmedCmd === '/history') {
      toggleSessionDrawer(true);
      return;
    } else if (trimmedCmd === '/replay' || trimmedCmd.startsWith('/replay ')) {
      openReplayPanel();
      return;
    } else if (trimmedCmd === '/backend' || trimmedCmd.startsWith('/backend ')) {
      const target = trimmedCmd.replace(/^\/backend\s*/i, '').trim() || 'toggle';
      const router = window.canvasBackendRouter;
      if (!router) { appendAgentNotice('⚠️ CanvasBackendRouter 未就绪'); return; }
      if (target === 'jsxgraph' || target === 'js') {
        const r = router.enableJsxGraph();
        appendAgentNotice(r.ok ? '📐 已切换到 JSXGraph 后端（' + (router.getStatus().hasBoard ? 'board 已创建' : 'board 未创建') + '）。用 /backend canvas2d 切回。' : '⚠️ ' + r.message);
      } else if (target === 'canvas2d' || target === 'toggle') {
        const current = router.getStatus().mode;
        if (current === 'jsxgraph') {
          router.disableJsxGraph();
          appendAgentNotice('📐 已切回 Canvas2D 后端（JSXGraph board 已释放）。');
        } else {
          const r = router.enableJsxGraph();
          appendAgentNotice(r.ok ? '📐 已切换到 JSXGraph 后端。用 /backend canvas2d 切回。' : '⚠️ ' + r.message);
        }
      } else {
        appendAgentNotice('📐 用法：/backend jsxgraph | /backend canvas2d（当前：' + router.getStatus().mode + '）');
      }
      return;
    } else if (trimmedCmd === '/effort') {
      const btn = document.getElementById('dock-reasoning-btn');
      if (btn) btn.click();
      return;
    } else if (trimmedCmd === '/matrix') {
      const btnToolbox = document.getElementById('btn-toggle-toolbox');
      if (btnToolbox) btnToolbox.click();
      return;
    } else if (trimmedCmd.startsWith('/predict') || trimmedCmd.startsWith('/预测')) {
      // P2 六步协议入口：/predict <预测> :: <理由>（理由 ≥8 字，预测不可绕过）
      const rest = trimmedCmd.replace(/^\/(predict|预测)\s*/i, '');
      const sepIdx = Math.max(rest.indexOf('::'), rest.indexOf('｜｜'), rest.indexOf('——'));
      const predText = (sepIdx >= 0 ? rest.slice(0, sepIdx) : rest).trim();
      const rationale = (sepIdx >= 0 ? rest.slice(sepIdx).replace(/^(::|｜｜|——)\s*/, '') : '').trim();
      const store = window.pechdtStateStore;
      const collector = window.predictionCollector;
      const flow = window.inquiryFlow;
      if (!collector) {
        appendAgentNotice('⚠️ 教学内核未就绪（PredictionCollector 缺失）');
        return;
      }
      const activeTask = flow && flow.getActiveTask ? flow.getActiveTask() : null;
      if (!activeTask) {
        appendAgentNotice('🔮 尚未开启探究任务。先陈述你的猜想即可开启（例如：「我怀疑矩阵乘法可交换」），或直接在该追问下回复预测与理由。');
        return;
      }
      // 结构化解析：相等类预测 → 布尔；其余按文本记录
      let value = predText;
      if (/不相等|不等|不同|false/i.test(predText)) value = false;
      else if(/相等|相同|true/i.test(predText) && !/不相等/.test(predText)) value = true;
      const res = collector.submitPrediction({
        taskId: activeTask.taskId,
        key: activeTask.predictionKey,
        value, prediction: predText, rationale
      });
      if (!res.ok) {
        appendAgentNotice('🔒 ' + res.message);
      } else {
        appendAgentNotice('🔮 预测已受理（预测不可绕过）：' + predText + ' —— 实验工具已解锁，试试让实验台算一算。');
      }
      return;
    } else if (trimmedCmd === '/probe') {
      const probeEngine = getAgentEngine();
      if (probeEngine && typeof probeEngine.executeSkill === 'function') {
        probeEngine.executeSkill('probe_null_space', {});
      }
      return;
    } else if (trimmedCmd === '/help') {
      if (agentSessionStream) {
        const helpEl = document.createElement('div');
        helpEl.className = 'agent-response-block';
        helpEl.innerHTML = `
          <div class="agent-mode-banner cloud" style="background:#f0f9ff;border-color:#38bdf8;color:#0284c7;line-height:1.6;">
            <strong>📚 问矩 · 代数几何探究助教指南</strong><br>
            • <code>/plan</code>：开启探究规划与形式化推导模式<br>
            • <code>/clear</code>：清空当前会话消息流与思考链<br>
            • <code>/reset</code>：重置几何画布为单位阵 I<br>
            • <code>/matrix</code>：展开矩阵与算子实验工具箱<br>
            • <code>/history</code>：查看与管理多任务历史课题<br>
            • <code>/review-export</code> / <code>/review-import</code>：导出待确认误解审核包 / 导入评审决策（上线前门禁，人工复核）<br>
            • <code>/metrics</code>：查看本会话运行指标（P95/P99 延迟 · 错误率 · Token 与成本估算）<br>
            • <code>@canvas:matrix</code> / <code>@canvas:det</code>：直接引用当前实时画板参数数值
          </div>
        `;
        agentSessionStream.appendChild(helpEl);
        scrollStreamToBottom();
      }
      return;
    } else if (trimmedCmd === '/metrics') {
      // P7-H6：运行指标（本会话 span 聚合：P95/P99 延迟、错误率、Token 与成本估算）
      const MA = window.MetricsAggregator;
      const tracer = window.agentTracer;
      if (!MA || !tracer || typeof tracer.spansOf !== 'function') {
        appendAgentNotice('⚠️ 指标聚合未就绪（MetricsAggregator / AgentTracer 缺失）');
        return;
      }
      let spans = [];
      for (const tid of tracer.traceIds()) spans = spans.concat(tracer.spansOf(tid) || []);
      appendAgentNotice(MA.formatReport(MA.aggregate(spans)));
      return;
    } else if (trimmedCmd === '/review-export') {
      // P6-E 审核环（上线前门禁，D-03）：导出 pending_confirm 审核包（人工评审用，自动入库一律不发生）
      const RP0 = window.ReviewPacket;
      if (!RP0 || !window.misconceptionTracker) {
        appendAgentNotice('⚠️ 审核环未就绪（ReviewPacket / MisconceptionTracker 缺失）');
        return;
      }
      const built = RP0.buildPacket({
        tracker: window.misconceptionTracker,
        library: window.misconceptionLibrary,
        timeline: window.teachingTimeline,
        exportedBy: 'local-operator'
      });
      if (!built.ok) { appendAgentNotice('⚠️ 审核包导出失败：' + built.code + ' ' + (built.message || '')); return; }
      if (!built.packet.entries.length) {
        appendAgentNotice('📋 当前没有 pending_confirm（待确认）条目。误解需经「两次独立同向证据 + BKT 阈值」才会进入待确认态，先完成区分性追问。');
        return;
      }
      try {
        const blob = new Blob([RP0.serializePacket(built.packet)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wenju_review_packet_${Date.now()}.json`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        appendAgentNotice('⚠️ 审核包写入下载失败：' + (e && e.message));
        return;
      }
      if (window.teachingTimeline && typeof window.teachingTimeline.append === 'function') {
        window.teachingTimeline.append('review_export', { entries: built.packet.entries.map((e) => e.id), packetHash: built.packet.packetHash, exportedAt: built.packet.exportedAt }, '__global__');
      }
      appendAgentNotice(`📋 已导出审核包：${built.packet.entries.length} 条待确认 · 封条 ${built.packet.packetHash} · 库快照 ${built.packet.library.snapshotHash}。离线评审在 decisions 字段填写 confirm/reject/revise 后，用 /review-import 导入。`);
      return;
    } else if (trimmedCmd === '/review-import') {
      // 导入评审后的决策文件：三重校验（封条/证据/决策）→ provenance 写回 + 哈希链审计
      const RP1 = window.ReviewPacket;
      if (!RP1) { appendAgentNotice('⚠️ 审核环未就绪（ReviewPacket 缺失）'); return; }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          const parsed = RP1.parsePacket(String(reader.result || ''));
          if (!parsed.ok) { appendAgentNotice('⚠️ 决策文件解析失败：' + parsed.message); return; }
          const auditLog = RP1.loadAudit();
          const res = RP1.applyDecisions({ packet: parsed.packet, library: window.misconceptionLibrary, auditLog, reviewerFallback: 'unattributed' });
          if (!res.ok) {
            appendAgentNotice(`⛔ 决策导入被拒绝（${res.code}）：${res.message || ''}。文件未被改动，库与审计零写回。`);
            return;
          }
          const port = (typeof window.getSharedStoragePort === 'function') ? (() => { try { return window.getSharedStoragePort(); } catch (e) { return null; } })() : null;
          RP1.saveAudit(res.audit, port);
          if (window.teachingTimeline && typeof window.teachingTimeline.append === 'function') {
            window.teachingTimeline.append('review_import', { reviewerId: res.applied[0] ? res.applied[0].reviewerId : null, applied: res.applied.map((r) => ({ id: r.id, decision: r.decision })), packetHash: parsed.packet.packetHash, auditHead: res.audit[res.audit.length - 1] ? res.audit[res.audit.length - 1].hash : null }, '__global__');
          }
          const chain = RP1.verifyAuditChain(res.audit);
          appendAgentNotice(`✅ 决策已导入：${res.applied.length} 条写回（confirm ${res.applied.filter((r) => r.decision === 'confirm').length} / reject ${res.applied.filter((r) => r.decision === 'reject').length} / revise ${res.applied.filter((r) => r.decision === 'revise').length}）· 审计链 ${chain.length} 条 · 链头 ${chain.head}`);
        };
        reader.onerror = () => appendAgentNotice('⚠️ 决策文件读取失败');
        reader.readAsText(file);
      });
      input.click();
      return;
    } else if (trimmedCmd.startsWith('/plan')) {
      const rest = trimmedCmd.slice(5).trim();
      text = rest ? `[探究规划模式] ${rest}` : '请启动代数几何探究规划模式，分步拆解并推导演算空间几何映射。';
    }

    // ── P2 六步探究自然交互路由（真实路径接线）──
    // 1) 若有未呈现的区分性追问：本条消息即为其作答
    if (window.__pendingDiscPrompt && window.inquiryFlow) {
      const dp = window.__pendingDiscPrompt;
      window.__pendingDiscPrompt = null;
      const r = window.inquiryFlow.answerDiscrimination(dp, trimmedCmd);
      appendAgentNotice(r.reply);
      if (typeof window.__refreshPendingBanner === 'function') window.__refreshPendingBanner();
      return;
    }
    // 2) 活动任务路由：猜想开启 / 预测登记 / 边界猜想 / 推导 / 变式作答；passthrough 才走 Agent
    if (window.inquiryFlow) {
      const routed = window.inquiryFlow.route(trimmedCmd);
      if (routed && routed.action !== 'passthrough') {
        appendAgentNotice(routed.reply, routed.noticeKind);
        if (typeof window.__refreshPendingBanner === 'function') window.__refreshPendingBanner();
        if (routed.action === 'variant_issued' || routed.nextVariantId) setNoHintMode(true, true);
        if (routed.action === 'variant_graded' && routed.policy &&
            (routed.policy.action === 'close_task' || routed.policy.action === 'back_to_experiment')) {
          setNoHintMode(false);
        }
        return;
      }
      // routed === null（无任务且非猜想）或 passthrough → 继续常规 Agent 路径
    }

    // 状态机前置守卫与迁入 DISPATCHING
    if (window.studioFSM && window.StudioEvents) {
      const curState = window.studioFSM.getState();
      if (curState === 'DISPATCHING' || curState === 'STREAMING') {
        console.warn('[app.js] 状态机处于 busy 状态，阻断重复并发请求');
        return;
      }
      window.studioFSM.transition(window.StudioEvents.SUBMIT_TRIGGERED, { text, attachments: img ? [img] : [] });
      window.studioFSM.transition(window.StudioEvents.VALIDATION_PASSED);
    }

    // 1. 渲染用户消息卡片
    const submission = { id: ++agentSubmissionSequence, terminal: false, answer: '', thought: '', steps: [] };
    activeAgentSubmission = submission;
    const submissionSessionId = sessionHistoryManager?.getActiveSessionId();
    let currentTurnRecord = null;
    let userMsgEl = null;
    if (agentSessionStream) {
      userMsgEl = document.createElement('div');
      userMsgEl.className = 'user-msg-bubble';
      userMsgEl.innerHTML = `
        ${img ? `<div class="user-msg-image-wrap"><img src="${img}" alt="用户上传草图"></div>` : ''}
        ${text ? `<div>${escapeHtml(text)}</div>` : ''}
      `;
      agentSessionStream.appendChild(userMsgEl);

      if (promptTurnNavigator) {
        currentTurnRecord = promptTurnNavigator.registerTurn({
          promptText: text || (img ? '[用户上传草图]' : ''),
          userEl: userMsgEl,
          status: 'running'
        });
      }
    }

    // 2. 渲染 Agent 响应容器并插入 1:1 镜像骨架屏 (CLS 零容忍)
    const responseBlock = document.createElement('div');
    responseBlock.className = 'agent-response-block';
    if (currentTurnRecord) {
      currentTurnRecord.responseEl = responseBlock;
      responseBlock.setAttribute('data-turn-id', String(currentTurnRecord.id));
    }
    
    const skeletonEl = document.createElement('div');
    skeletonEl.className = 'skeleton-agent-response';
    skeletonEl.innerHTML = `
      <div class="skeleton-shimmer-bar w-header"></div>
      <div class="skeleton-shimmer-bar w-full"></div>
      <div class="skeleton-shimmer-bar w-75"></div>
      <div class="skeleton-shimmer-bar w-50"></div>
    `;
    responseBlock.appendChild(skeletonEl);

    // 实例化 ReasoningBlock (长思维链折叠) 与 ToolCallStreamTree (工具树)
    const reasoningBlock = window.ReasoningBlock ? new window.ReasoningBlock({ container: responseBlock, defaultOpen: true }) : null;
    const toolCallTree = window.ToolCallStreamTree ? new window.ToolCallStreamTree({ container: responseBlock }) : null;

    const answerContentEl = document.createElement('div');
    answerContentEl.className = 'agent-final-answer';
    answerContentEl.style.display = 'none';
    responseBlock.appendChild(answerContentEl);

    if (agentSessionStream) {
      agentSessionStream.appendChild(responseBlock);
      scrollStreamToBottom();
    }

    // 骨架屏淡出守护函数
    let skeletonDismissed = false;
    const dismissSkeleton = () => {
      if (!skeletonDismissed && skeletonEl && skeletonEl.parentNode) {
        skeletonDismissed = true;
        skeletonEl.remove();
      }
    };
    submission.stop = () => {
      if (submission.terminal || activeAgentSubmission !== submission) return;
      submission.terminal = true;
      dismissSkeleton();
      if (reasoningBlock) reasoningBlock.stopStreaming('aborted');
      const stoppedSteps = submission.steps.map(step => ['running', 'loading', 'pending'].includes(step.status) ? { ...step, status: 'aborted', detail: '已停止，未继续执行' } : step);
      if (toolCallTree) toolCallTree.setNodes(stoppedSteps);
      answerContentEl.style.display = 'block';
      const note = document.createElement('div');
      note.className = 'agent-mode-banner aborted'; note.textContent = '■ 已停止 · 已输出内容保留';
      answerContentEl.appendChild(note);
      if (promptTurnNavigator && currentTurnRecord) promptTurnNavigator.completeTurn(currentTurnRecord.id, { status: 'aborted', summary: submission.answer || '已停止' });
      if (sessionHistoryManager && submissionSessionId) sessionHistoryManager.appendTurn(submissionSessionId, { userQuery: text, assistantResponse: submission.answer, thoughtChain: submission.thought, steps: stoppedSteps, status: 'aborted' });
      if (window.studioFSM && window.StudioEvents) window.studioFSM.transition(window.StudioEvents.RESET);
    };

    // 获取当前几何环境真实物理状态
    let detVal = 1.0;
    let e1Val = [1.0, 0.0];
    let e2Val = [0.0, 1.0];
    let rankVal = 2;
    let dimMode = '2D';
    let mat3D = null;
    let mat2D = { a: 1.0, b: 0.0, c: 0.0, d: 1.0 };

    if (workspaceVisualizer) {
      dimMode = workspaceVisualizer.dimensionMode || '2D';
      if (typeof workspaceVisualizer.getDet === 'function') {
        detVal = workspaceVisualizer.getDet();
      } else if (typeof workspaceVisualizer.getDeterminant === 'function') {
        detVal = workspaceVisualizer.getDeterminant();
      }
      if (typeof workspaceVisualizer.getRank === 'function') {
        rankVal = workspaceVisualizer.getRank();
      } else {
        rankVal = Math.abs(detVal) < 0.01 ? 1 : 2;
      }
      if (workspaceVisualizer.matrix) {
        mat2D = { ...workspaceVisualizer.matrix };
        e1Val = [workspaceVisualizer.matrix.a, workspaceVisualizer.matrix.c];
        e2Val = [workspaceVisualizer.matrix.b, workspaceVisualizer.matrix.d];
      } else if (workspaceVisualizer.e1 && workspaceVisualizer.e2) {
        e1Val = workspaceVisualizer.e1;
        e2Val = workspaceVisualizer.e2;
      }
      if (workspaceVisualizer.matrix3D) {
        mat3D = { ...workspaceVisualizer.matrix3D };
      }
    }
    const matrixState = {
      dimensionMode: dimMode,
      matrix: mat2D,
      matrix3D: mat3D,
      e1: e1Val,
      e2: e2Val,
      det: detVal,
      rank: rankVal
    };

    // 派遣给 Agent 引擎
    const engine = getAgentEngine();
    if (!engine) {
      dismissSkeleton();
      if (window.studioFSM && window.StudioEvents) {
        window.studioFSM.transition(window.StudioEvents.STREAM_ERROR, { error: 'Agent 引擎未就绪' });
      }
      return;
    }

    try {
      await engine.processQuery({
        text: text || '请结合所附草图推演当前空间几何映射与代数核定理',
        imageBase64: img,
        currentMatrixState: matrixState,
        reasoningEffort: promptInputDock?.getReasoningEffort() || 'medium',
        onUpdate: (update) => {
          if (activeAgentSubmission !== submission || submission.terminal) return;
          if (typeof update.answerText === 'string') submission.answer = update.answerText;
          if (typeof update.thoughtText === 'string') submission.thought = update.thoughtText;
          if (Array.isArray(update.steps)) submission.steps = update.steps;
          dismissSkeleton();

          if (update.type === 'generation_recovery') {
            if (reasoningBlock?.titleText) reasoningBlock.titleText.textContent = '正在降低推理深度，重新生成';
          } else if (update.type === 'thought_chunk') {
            if (window.studioFSM && window.StudioEvents) {
              window.studioFSM.transition(window.StudioEvents.STREAM_CHUNK);
            }
            if (reasoningBlock) {
              reasoningBlock.startStreaming();
              reasoningBlock.appendChunk(update.thoughtText);
            }
            scrollStreamToBottom();
          } else if (update.type === 'conflict') {
            // P3：冲突呈现统一走 __renderTeachingEvent（app 与真机测试共用同一实现）
            window.__renderTeachingEvent(update);
          } else if (update.type === 'steps_update') {
            if (window.studioFSM && window.StudioEvents) {
              window.studioFSM.transition(window.StudioEvents.STREAM_CHUNK);
            }
            if (toolCallTree) {
              toolCallTree.setNodes(update.steps);
            }
            if (promptTurnNavigator && currentTurnRecord && Array.isArray(update.steps)) {
              update.steps.forEach(st => {
                if (st.tool) promptTurnNavigator.recordToolCall(currentTurnRecord.id, { name: st.tool, title: st.title });
              });
            }
            scrollStreamToBottom();
          } else if (update.type === 'answer_chunk') {
            if (window.studioFSM && window.StudioEvents) {
              window.studioFSM.transition(window.StudioEvents.STREAM_CHUNK);
            }
            if (answerContentEl) {
              answerContentEl.style.display = 'block';
              answerContentEl.innerHTML = formatMarkdownToHtml(update.answerText, { isStreaming: true });
            }
            scrollStreamToBottom();
          } else if (update.type === 'done') {
            if (update.status === 'aborted') {
              submission.stop();
              scrollStreamToBottom();
              return;
            }
            submission.terminal = true;
            if (update.status === 'failed' && update.incomplete) {
              // B-R1-3: 云端流中途出错 —— 已渲染的正文不动，只在气泡底部追加一行未完成标记；不记为完成、不写轨迹快照
              if (reasoningBlock) {
                reasoningBlock.stopStreaming('failed');
              }
              if (toolCallTree && update.steps) {
                toolCallTree.setNodes(update.steps);
              }
              if (answerContentEl) {
                answerContentEl.style.display = 'block';
                const incompleteNote = document.createElement('div');
                incompleteNote.className = 'agent-mode-banner unavailable';
                incompleteNote.textContent = '本轮回答未完成 · ' + (update.errorCode || 'CLOUD_ERROR') + ' · 已保留部分内容，可发送“继续”接着回答';
                answerContentEl.appendChild(incompleteNote);
              }
              if (window.studioFSM && window.StudioEvents) {
                window.studioFSM.transition(window.StudioEvents.STREAM_ERROR, { error: update.errorCode || 'CLOUD_ERROR' });
              }
              if (sessionHistoryManager && submissionSessionId) sessionHistoryManager.appendTurn(submissionSessionId, {userQuery:text, assistantResponse:update.answerText || submission.answer, thoughtChain:submission.thought, steps:update.steps || [], status:'incomplete'});
              if (promptTurnNavigator && currentTurnRecord) promptTurnNavigator.completeTurn(currentTurnRecord.id, {status:'failed', summary:update.answerText || submission.answer});
              scrollStreamToBottom();
              return;
            }
            if (reasoningBlock) {
              reasoningBlock.finishStreaming(update.elapsedSeconds, update.answerText);
            }
            if (toolCallTree && update.steps) {
              toolCallTree.setNodes(update.steps);
            }
            if (answerContentEl) {
              answerContentEl.style.display = 'block';
              const escBanner = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
              // B-R1-2: 横幅文案由引擎 done.bannerText 给出，这里只负责显示；JS 不再给任何节点赋 .fallback
              const modeBadgeHtml = update.mode === 'unavailable'
                ? `<div class="agent-mode-banner unavailable">✖ Agent 不可用 · ${escBanner(update.errorCode || 'ERROR')}</div>`
                : (update.mode === 'cloud' && update.toolsDisabled)
                ? `<div class="agent-mode-banner notools">● ${escBanner(update.bannerText || '云端直连 · 纯推理：本轮未启用工具调用，本轮未驱动画板；本轮结论未经代数引擎核验')} · 耗时 ${update.elapsedSeconds}s</div>`
                : update.mode === 'cloud'
                ? `<div class="agent-mode-banner cloud">● ${escBanner(update.bannerText || '云端大模型直连推导')} · 耗时 ${update.elapsedSeconds}s</div>`
                : update.mode === 'geometry'
                ? '<div class="agent-mode-banner">参数化几何组件 · 顶点与连接关系由数学核生成</div>'
                : update.mode === 'pechdt_gate'
                ? `<div class="agent-mode-banner">🔒 PECHDT 门禁 · 直接答案已拦截，请先提交预测与理由</div>`
                : `<div class="agent-mode-banner">⚡ 离线符号推理（未配置云端 Key 时的本地推导） · 耗时 ${update.elapsedSeconds || '0.0'}s</div>`;

              // 生成数学工作台与代码沙箱的 Artifact 卡片 (对标 Claude/ZCode Artifacts)
              let artifactHtml = '';
              if (update.steps && update.steps.length > 0) {
                for (const step of update.steps) {
                  if (step.result?.status !== 'success' && step.status !== 'success') continue;
                  if (step.tool === 'render_canvas_graphics') {
                    const args = step.args || {};
                    const shapeType = (args.shapes && args.shapes[0]?.type) || '几何图元';
                    artifactHtml += `
                      <div class="math-artifact-card">
                        <div class="artifact-top-bar">
                          <span class="artifact-badge">⚡ 数学工作台渲染物 (Canvas Artifact)</span>
                          <span class="artifact-status-pill">● 物理画布动态呈现中</span>
                        </div>
                        <div class="artifact-title">📐 ${escapeHtml(args.title || (shapeType + ' 几何空间投影'))}</div>
                        <div class="artifact-desc">Agent 已驱动左侧物理工作台动态光栅化渲染 ${args.shapes?.length || 1} 个参数化矢量几何图元。</div>
                        <div class="artifact-actions">
                          <button type="button" class="btn-artifact-action" onclick="window.focusCanvasArtifact && window.focusCanvasArtifact()">🎯 画布视角对焦</button>
                          <button type="button" class="btn-artifact-action" onclick="window.clearCanvasArtifact && window.clearCanvasArtifact()">✕ 清除图元</button>
                        </div>
                      </div>
                    `;
                  } else if (step.tool === 'execute_code_sandbox') {
                    const code = step.args?.code || '';
                    const lang = step.args?.language || 'python';
                    artifactHtml += `
                      <div class="math-artifact-card">
                        <div class="artifact-top-bar">
                          <span class="artifact-badge">💻 沙箱代码运行物 (Sandbox Artifact)</span>
                          <span class="artifact-status-pill">● 执行完成</span>
                        </div>
                        <div class="artifact-title">运行数学验证脚本 [${escapeHtml(lang)}]</div>
                        <pre class="artifact-code-block"><code>${escapeHtml(code.slice(0, 160))}${code.length > 160 ? '...' : ''}</code></pre>
                      </div>
                    `;
                  } else if (step.tool === 'generate_visual_illustration') {
                    const args = step.args || {};
                    const res = step.result || {};
                    const prompt = args.prompt || res.prompt || '';
                    const imgUrl = res.imageUrl || '';
                    const model = res.model || 'Kwai-Kolors/Kolors';
                    const size = res.size || '1024x1024';
                    artifactHtml += `
                      <div class="math-artifact-card visual-illustration-artifact">
                        <div class="artifact-top-bar">
                          <span class="artifact-badge">🎨 视觉概念插画 (Kolors Visual Artifact)</span>
                          <span class="artifact-status-pill">● ${res.status === 'success' ? '光栅化渲染完成' : '绘制中'}</span>
                        </div>
                        <div class="artifact-title">画幅提示词: ${escapeHtml(prompt || '几何概念视觉插画')}</div>
                        <div class="artifact-desc">生成引擎: <strong>${escapeHtml(model)}</strong> · 分辨率: <strong>${escapeHtml(size)}</strong></div>
                        ${imgUrl ? `
                        <div class="artifact-actions">
                          <button type="button" class="btn-artifact-action primary" onclick="window.projectImageToCanvas && window.projectImageToCanvas(this.dataset.url, this.dataset.title, { mode: 'artifact' })" data-url="${escapeHtml(imgUrl)}" data-title="${escapeHtml(prompt)}" title="在左侧独立展台检视 Artifact (零网格遮挡)">🖼️ Artifact 独立展台</button>
                          <button type="button" class="btn-artifact-action" onclick="window.projectImageToCanvas && window.projectImageToCanvas(this.dataset.url, this.dataset.title, { mode: 'overlay' })" data-url="${escapeHtml(imgUrl)}" data-title="${escapeHtml(prompt)}" title="以底图形式叠图映射至几何坐标系">🔀 叠图映射</button>
                          <a href="${imgUrl.startsWith('data:') ? '#' : escapeHtml(imgUrl)}" ${imgUrl.startsWith('data:') ? `onclick="const w=window.open('');w.document.write('<img src=\\'${escapeHtml(imgUrl)}\\' style=\\'max-width:100%;display:block;margin:auto;\\'>');return false;"` : 'target="_blank" rel="noopener noreferrer"'} class="btn-artifact-action">🔍 查看原图</a>
                        </div>` : ''}
                      </div>
                    `;
                    // 若视觉生图成功，自动平滑投影至左侧 Artifact 展台
                    if (res.status === 'success' && imgUrl && typeof window.projectImageToCanvas === 'function') {
                      window.projectImageToCanvas(imgUrl, prompt || '视觉生成画幅', { mode: 'artifact' });
                    }
                  }
                }
              }

              answerContentEl.innerHTML = modeBadgeHtml + artifactHtml + formatMarkdownToHtml(update.answerText, { isStreaming: false });
              if (window.KaTeXRenderer) {
                window.KaTeXRenderer.renderElement(answerContentEl);
              }
            }
            if (promptTurnNavigator && currentTurnRecord) {
              promptTurnNavigator.completeTurn(currentTurnRecord.id, {
                status: update.status === 'failed' ? 'failed' : 'done',
                summary: update.answerText || ''
              });
            }
            // 在画板发生变换后压入历史快照
            if (canvasStateManager) {
              canvasStateManager.pushSnapshot(`助教推导演算完成`);
            }
            recordTrajectorySnapshot(`助教推导完成`, { role: 'assistant', content: update.answerText, thoughtChain: update.thoughtText });

            // 写入多任务课题会话历史 (对标 ZCode TaskList / SessionStore)
            if (sessionHistoryManager) {
              const activeId = submissionSessionId;
              sessionHistoryManager.appendTurn(activeId, {
                userQuery: text,
                assistantResponse: update.answerText,
                thoughtChain: update.thoughtText,
                steps: update.steps || [],
                matrixState: matrixState
              });

              // 若当前会话标题为默认名称，自动以首个猜想提炼作为标题
              const activeSession = sessionHistoryManager.getActiveSession();
              if (activeSession && (activeSession.title === '新探究任务' || activeSession.title.startsWith('新探究任务'))) {
                const autoTitle = text.slice(0, 20) + (text.length > 20 ? '...' : '');
                sessionHistoryManager.renameSession(activeId, autoTitle);
              }
              updateSessionHeaderUI();
              renderSessionDrawerList();
            }

            scrollStreamToBottom();

            // 状态机成功并结算归位 (严格对齐失败与成功互斥语义)
            const isFailed = update.status === 'failed' || update.mode === 'unavailable';
            if (window.studioFSM && window.StudioEvents) {
              if (isFailed) {
                window.studioFSM.transition(window.StudioEvents.STREAM_ERROR, {
                  error: update.errorCode || update.code || 'AGENT_UNAVAILABLE'
                });
              } else {
                window.studioFSM.transition(window.StudioEvents.STREAM_COMPLETED);
                setTimeout(() => {
                  if (activeAgentSubmission === submission) window.studioFSM.transition(window.StudioEvents.RESET);
                }, 50);
              }
            }
          }
        }
      });
    } catch (err) {
      if (activeAgentSubmission !== submission || submission.terminal) return;
      dismissSkeleton();
      if (err.name === 'AbortError' || err.message?.includes('USER_ABORTED')) {
        submission.stop();
        scrollStreamToBottom();
        return;
      }
      submission.terminal = true;
      if (reasoningBlock) reasoningBlock.stopStreaming('failed');
      if (window.StructuredLogger && typeof window.StructuredLogger.error === 'function') {
        window.StructuredLogger.error(err, {
          event: 'agent.submit.failed',
          source: 'submitQueryToAgent',
          statusCode: err && err.status
        });
      } else {
        console.error('[submitQueryToAgent] 推理过程发生异常:', err);
      }
      if (promptTurnNavigator && currentTurnRecord) {
        promptTurnNavigator.completeTurn(currentTurnRecord.id, {
          status: 'failed',
          summary: err.message || '推理失败'
        });
      }
      if (window.studioFSM && window.StudioEvents) {
        window.studioFSM.transition(window.StudioEvents.STREAM_ERROR, { error: err.message });
      }
      if (answerContentEl) {
        const errorBox = document.createElement('div');
        errorBox.style.cssText = 'background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px; padding: 12px 16px; color: #ef4444; font-size: 13.5px;';
        errorBox.innerHTML = `<strong>推导遇到异常：</strong> ${escapeHtml(err.message || '未知通信错误')}`;
        
        const retryWrap = document.createElement('div');
        retryWrap.style.marginTop = '8px';
        const retryBtn = document.createElement('button');
        retryBtn.textContent = '立即重试';
        retryBtn.style.cssText = 'background: #ef4444; color: #fff; border: none; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;';
        retryBtn.addEventListener('click', () => {
          retryBtn.disabled = true;
          retryBtn.textContent = '正在重新推导...';
          retryBtn.style.opacity = '0.6';
          if (typeof submitQueryToAgent === 'function') {
            submitQueryToAgent(text, img);
          } else if (typeof window !== 'undefined' && window.submitQueryToAgent) {
            window.submitQueryToAgent(text, img);
          }
        });
        retryWrap.appendChild(retryBtn);
        errorBox.appendChild(retryWrap);
        answerContentEl.innerHTML = '';
        answerContentEl.appendChild(errorBox);
      }
    }
  }

  window.submitQueryToAgent = submitQueryToAgent;

  // 用户滚动意图状态机 (防止流式输出强行中断用户手动查阅)
  let isUserInteractingWithScroll = false;

  function initStreamScrollListener() {
    const stream = document.getElementById('agent-session-stream');
    if (!stream || stream._scrollInitialized) return;
    stream._scrollInitialized = true;

    stream.addEventListener('wheel', (e) => {
      if (e.deltaY < 0) {
        // 用户滚轮向上回溯历史，暂停强行吸底
        isUserInteractingWithScroll = true;
      } else {
        const distFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
        if (distFromBottom <= 50) {
          isUserInteractingWithScroll = false;
        }
      }
    }, { passive: true });

    stream.addEventListener('scroll', () => {
      const distFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      if (distFromBottom <= 30) {
        isUserInteractingWithScroll = false;
      }
    }, { passive: true });
  }

  function scrollStreamToBottom(force = false) {
    const stream = document.getElementById('agent-session-stream');
    if (stream) {
      initStreamScrollListener();
      const distFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
      if (!force && isUserInteractingWithScroll && distFromBottom > 80) {
        return; // 用户正在向上查看历史，不打断用户查阅
      }
      stream.scrollTop = stream.scrollHeight;
    }
  }

  // P7 职责拆分：Markdown 渲染管线迁至 js/ui/MarkdownRenderer.js（本处保留同名函数声明，调用面不变）
  const MarkdownRendererModule = (function () {
    if (typeof window !== 'undefined' && window.WenjuMarkdownPipeline) return window.WenjuMarkdownPipeline;
    if (typeof require !== 'undefined') { try { return require('./ui/MarkdownRenderer.js'); } catch (error) { return null; } }
    return null;
  })();
  if (!MarkdownRendererModule) throw new Error('MARKDOWN_RENDERER_UNAVAILABLE');
  function escapeHtml(str) { return MarkdownRendererModule.escapeHtml(str); }
  function formatMarkdownToHtml(md, options) { return MarkdownRendererModule.formatMarkdownToHtml(md, options); }

  // DeepSeek 风格代码沙箱实时运行视窗 (Live Preview)
  let currentRunnerPayload = { code: '', lang: '' };

  function openLiveRunner(rawCode, lang = 'html') {
    const runnerModal = document.getElementById('live-runner-modal');
    const runnerFrame = document.getElementById('live-runner-frame');
    const langBadge = document.getElementById('live-runner-lang-badge');
    if (!runnerModal || !runnerFrame) return;

    currentRunnerPayload = { code: rawCode, lang };
    if (langBadge) langBadge.textContent = lang.toUpperCase();

    let docHtml = rawCode;
    const l = (lang || '').toLowerCase();
    if (l === 'svg' || (rawCode.trim().startsWith('<svg') && !rawCode.includes('<html'))) {
      docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Live SVG Preview</title><style>body{margin:0;padding:32px;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f8fafc;box-sizing:border-box;}svg{max-width:100%;max-height:85vh;filter:drop-shadow(0 10px 25px rgba(0,0,0,0.08));}</style></head><body>${rawCode}</body></html>`;
    } else if (l === 'javascript' || l === 'js') {
      docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Live JS Runner</title><style>body{margin:20px;font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;line-height:1.6;}#console-output{background:#1e293b;padding:16px;border-radius:10px;border:1px solid #334155;font-family:monospace;white-space:pre-wrap;word-break:break-all;}</style></head><body><h3 style="margin-top:0;color:#38bdf8;">JavaScript 执行输出:</h3><div id="console-output"></div><script>const out = document.getElementById('console-output');const originalLog = console.log;console.log = function(...args){ originalLog.apply(console, args); out.textContent += args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ') + '\\n'; };window.onerror = function(msg, url, line){ out.innerHTML += '<span style="color:#f87171;">错误: ' + msg + ' (行 ' + line + ')</span>\\n'; };try { ${rawCode} } catch(e){ out.innerHTML += '<span style="color:#f87171;">运行异常: ' + e.message + '</span>\\n'; }<\/script></body></html>`;
    } else if (!rawCode.includes('<html') && !rawCode.includes('<!DOCTYPE')) {
      docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Live HTML Preview</title><style>body{margin:0;padding:24px;font-family:system-ui,-apple-system,sans-serif;background:#ffffff;color:#1e293b;}</style></head><body>${rawCode}</body></html>`;
    }

    // P5 S3：Live Runner srcdoc 前置 CSP 注入（与工件沙箱同等级隔离）
    // 外层 CSP 必须在任何脚本之前（HTML 规范取第一个 CSP meta）
    const RUNNER_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data: https:;">';
    if (/<head[^>]*>/i.test(docHtml)) {
      docHtml = docHtml.replace(/<head([^>]*)>/i, `<head$1>${RUNNER_CSP}`);
    } else if (/<html[^>]*>/i.test(docHtml)) {
      docHtml = docHtml.replace(/<html([^>]*)>/i, `<html$1><head>${RUNNER_CSP}</head>`);
    } else {
      docHtml = `<!DOCTYPE html><html><head>${RUNNER_CSP}</head><body>${docHtml}</body></html>`;
    }

    runnerFrame.srcdoc = docHtml;
    runnerModal.classList.remove('hidden');
  }

  // 代码块操作代理监听 (复制 / 下载 / 运行)
  if (agentSessionStream) {
    agentSessionStream.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-code-action');
      if (!btn) return;
      const action = btn.classList.contains('btn-copy') ? 'copy' : btn.classList.contains('btn-download') ? 'download' : btn.classList.contains('btn-run') ? 'run' : null;
      const encoded = btn.getAttribute('data-code');
      if (!encoded) return;
      const rawCode = decodeURIComponent(encoded);
      const lang = btn.getAttribute('data-lang') || 'code';

      if (action === 'copy') {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(rawCode).then(() => {
            const oldText = btn.textContent;
            btn.textContent = '✓ 已复制';
            setTimeout(() => { btn.textContent = oldText; }, 1500);
          });
        }
      } else if (action === 'download') {
        const ext = lang === 'svg' ? 'svg' : (lang === 'javascript' || lang === 'js') ? 'js' : 'html';
        const blob = new Blob([rawCode], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wenju_artifact_${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (action === 'run') {
        openLiveRunner(rawCode, lang);
      }
    });
  }

  // 绑定实时沙箱控制按钮
  const btnCloseRunner = document.getElementById('btn-close-live-runner');
  const btnRefreshRunner = document.getElementById('btn-live-runner-refresh');
  const runnerModal = document.getElementById('live-runner-modal');

  if (btnCloseRunner && runnerModal) {
    btnCloseRunner.addEventListener('click', () => {
      runnerModal.classList.add('hidden');
      const frame = document.getElementById('live-runner-frame');
      if (frame) frame.srcdoc = 'about:blank';
    });
  }

  if (btnRefreshRunner) {
    btnRefreshRunner.addEventListener('click', () => {
      if (currentRunnerPayload.code) {
        openLiveRunner(currentRunnerPayload.code, currentRunnerPayload.lang);
      }
    });
  }

  if (runnerModal) {
    runnerModal.addEventListener('click', (e) => {
      if (e.target === runnerModal) {
        runnerModal.classList.add('hidden');
        const frame = document.getElementById('live-runner-frame');
        if (frame) frame.srcdoc = 'about:blank';
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && runnerModal && !runnerModal.classList.contains('hidden')) {
      runnerModal.classList.add('hidden');
      const frame = document.getElementById('live-runner-frame');
      if (frame) frame.srcdoc = 'about:blank';
    }
  });

  window.openLiveRunner = openLiveRunner;
  window.formatMarkdownToHtml = formatMarkdownToHtml;

  const btnSubmit = document.getElementById('btn-submit-query');
  const studentInput = document.getElementById('student-input');
  if (btnSubmit) btnSubmit.addEventListener('click', () => submitQueryToAgent());
  if (studentInput) {
    studentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitQueryToAgent();
    });
  }

  // 11. 快捷探针按钮直接触发 Agent 认知思考与画布联动
  const probeSingular = document.getElementById('probe-singular');
  const probeNullB = document.getElementById('probe-nullspace-b');

  if (probeSingular) {
    probeSingular.addEventListener('click', () => {
      if (probeNullB) probeNullB.classList.remove('active');
      probeSingular.classList.add('active');
      if (workspaceVisualizer) workspaceVisualizer.setPreset('singular');
      submitQueryToAgent('请解释矩阵处于奇异降维态时，为什么会产生整条零空间射线？');
    });
  }

  if (probeNullB) {
    probeNullB.addEventListener('click', () => {
      if (probeSingular) probeSingular.classList.remove('active');
      probeNullB.classList.add('active');
      if (workspaceVisualizer) workspaceVisualizer.setPreset('singular');
      submitQueryToAgent('如何构造一个非零矩阵 B，使得两个非零矩阵乘积 A·B=0 严格成立？');
    });
  }

  // 12. 清空会话并同步重置画板图元
  const btnClearChat = document.getElementById('btn-clear-chat');
  if (btnClearChat) {
    btnClearChat.addEventListener('click', () => {
      try {workspaceSessions.clearCurrent();switchSession(sessionHistoryManager.getActiveSessionId());window.showToastNotification?.('已清空当前对话，画板和工件已保留');}
      catch(error){promptInputDock?.showInputNotice(error.message);}
    });
    btnClearChat.title='清空当前对话与引导记录，保留画板和工件';
    btnClearChat.setAttribute('aria-label',btnClearChat.title);
  }

  // 12.1. 矩阵算子与实验工具箱抽屉控制器 (按需调出，默认收起)
  const btnToggleToolbox = document.getElementById('btn-toggle-toolbox');
  const btnCloseToolbox = document.getElementById('btn-close-toolbox');
  const toolboxDrawer = document.getElementById('studio-toolbox-drawer');
  const toolboxBackdrop = document.getElementById('studio-toolbox-backdrop');
  function openToolboxDrawer() { if (toolboxDrawer) toolboxDrawer.classList.add('open'); if (toolboxBackdrop) toolboxBackdrop.classList.add('active'); if (btnToggleToolbox) btnToggleToolbox.classList.add('active'); }
  function closeToolboxDrawer() { if (toolboxDrawer) toolboxDrawer.classList.remove('open'); if (toolboxBackdrop) toolboxBackdrop.classList.remove('active'); if (btnToggleToolbox) btnToggleToolbox.classList.remove('active'); }
  function toggleToolboxDrawer() { if (toolboxDrawer && toolboxDrawer.classList.contains('open')) closeToolboxDrawer(); else openToolboxDrawer(); }
  if (btnToggleToolbox) btnToggleToolbox.addEventListener('click', toggleToolboxDrawer);
  if (btnCloseToolbox) btnCloseToolbox.addEventListener('click', closeToolboxDrawer);
  if (toolboxBackdrop) toolboxBackdrop.addEventListener('click', closeToolboxDrawer);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && toolboxDrawer && toolboxDrawer.classList.contains('open')) closeToolboxDrawer(); });

  // 绑定抽屉内快捷实验包动作按钮
  const drawerActionBtns = document.querySelectorAll('.drawer-action-btn');
  drawerActionBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      if (preset && workspaceVisualizer && workspaceVisualizer.setPreset) {
        workspaceVisualizer.setPreset(preset);
        document.querySelectorAll('.preset-chip').forEach(c => c.classList.toggle('active', c.getAttribute('data-preset') === preset));
      }
    });
  });

  const settingsController = window.SettingsController({ window, document, localStorage, getAgentEngine, promptInputDock });
  if (window.ToolCenter) window.toolCenter = new window.ToolCenter({ getEngine: getAgentEngine });

  // 9. 首页深色面板鼠标跟随微探照灯 (Interactive Spotlight)
  const heroDarkPane = document.getElementById('hero-dark-pane');
  if (heroDarkPane) {
    let spotlightRaf = null, targetX = 50, targetY = 50, currentX = 50, currentY = 50;
    heroDarkPane.addEventListener('mousemove', (e) => {
      const rect = heroDarkPane.getBoundingClientRect();
      targetX = ((e.clientX - rect.left) / rect.width) * 100;
      targetY = ((e.clientY - rect.top) / rect.height) * 100;
      if (!spotlightRaf) spotlightRaf = requestAnimationFrame(updateSpotlight);
    });
    heroDarkPane.addEventListener('mouseleave', () => { targetX = 50; targetY = 50; });
    function updateSpotlight() {
      currentX += (targetX - currentX) * 0.12; currentY += (targetY - currentY) * 0.12;
      heroDarkPane.style.setProperty('--mouse-x', `${currentX.toFixed(2)}%`);
      heroDarkPane.style.setProperty('--mouse-y', `${currentY.toFixed(2)}%`);
      if (Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05) spotlightRaf = requestAnimationFrame(updateSpotlight);
      else spotlightRaf = null;
    }
  }

  switchSession(sessionHistoryManager.getActiveSessionId());
  // 挂载 Artifact 交互动作到全局 Window
  window.switchToArtifactStage = () => {
    if (window.artifactStageDeck && typeof window.artifactStageDeck.setMode === 'function') {
      window.artifactStageDeck.setMode('artifact');
    }
  };
  window.focusCanvasArtifact = () => {
    if (workspaceVisualizer) {
      workspaceVisualizer.resize();
    }
  };
  window.clearCanvasArtifact = () => {
    if (workspaceVisualizer) {
      workspaceVisualizer.clearCustomGraphics();
    }
  };
}

// 全局未捕获异常与 Promise 拒绝自愈守护 (P0-A 防僵死)
if (typeof window !== 'undefined' && !window._teachagent_global_error_registered) {
  window._teachagent_global_error_registered = true;
  const triggerFsmError = (msg) => {
    if (window.studioFSM && window.StudioEvents && ['DISPATCHING', 'STREAMING', 'VALIDATING'].includes(window.studioFSM.getState())) {
      window.studioFSM.transition(window.StudioEvents.STREAM_ERROR, { error: msg });
    }
  };
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[Wenju Global UnhandledRejection Caught]:', event.reason);
    triggerFsmError((event.reason && event.reason.message) || '后台异步任务异常');
    if (typeof window.showAgentModeNotice === 'function') window.showAgentModeNotice('发生未处理的异步异常，已自动保护界面交互状态。');
  });
  window.addEventListener('error', (event) => {
    console.error('[Wenju Global Window Error Caught]:', event.error || event.message);
    triggerFsmError(event.message || '运行时脚本异常');
  });
}

// 双态自适应启动器: 无论静态 DOMContentLoaded 还是异步微任务加载，确保 100% 触发初始化
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTeachAgentStudio);
  } else {
    initTeachAgentStudio();
  }
}

