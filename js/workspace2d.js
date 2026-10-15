/**
 * 问矩 · 线性代数实验式探究空间几何变换引擎 (Workspace2DVisualizer)
 * 严格对齐真实数学定义与企业级执行端标准：
 * 1. 真实双坐标网格系统：
 *    - 静态欧几里得笛卡尔参考背景网格 (Static Cartesian Reference Grid)
 *    - 矩阵 A 作用下的连续可变形斜角仿射网格 (Deformable Transformed Affine Grid)
 * 2. 真实像空间 / 列空间流形 Col(A)：
 *    - 满秩态 (rank=2)：平行四边形有向面域测度，面积严格等于 |det(A)|，带版画立体阴影与墨线骨架
 *    - 奇异降维态 (rank=1)：面域坍缩，动态渲染贯穿全屏的列空间高亮直线 Span{e1}
 *    - 零矩阵态 (rank=0)：完全坍缩至原点
 * 3. 真实零空间 / 核空间流形 Null(A)：
 *    - 奇异降维态下严格代数求解 A·x = 0 的特征核向量 n，渲染贯穿全画面的霓虹洋红高光核空间直线与基底
 * 4. 任意探针向量 x 与像向量 y = A·x 动态映射验证器：
 *    - 用户可自由拖拽探针向量 x，直观观察当 x 落在 Null(A) 上时其像 A·x 严格收缩至原点
 * 5. 真实双向交互闭环：
 *    - 鼠标拖拽基向量 e1, e2 端点与探针向量；支持画布平移与滚轮缩放
 *    - 暴露 animateTo 连续补间动画引擎，供 Agent MCP 工具 drive_canvas_affine_transform 真实调用
 */

class Workspace2DVisualizer {
  constructor(canvasId, matrixBubbleId) {
    this.canvas = (canvasId && typeof canvasId === 'object' && typeof canvasId.getContext === 'function') ? canvasId :
                  (typeof document !== 'undefined' && typeof canvasId === 'string' ? document.getElementById(canvasId) : null);
    this.matrixBubble = (matrixBubbleId && typeof matrixBubbleId === 'object') ? matrixBubbleId :
                        (typeof document !== 'undefined' && typeof matrixBubbleId === 'string' ? document.getElementById(matrixBubbleId) : null);
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;

    // 矩阵分量 A = [ [a, b], [c, d] ]
    // 初始状态采用标准笛卡尔欧氏空间单位基底 (det = 1.0, rank = 2)
    this.matrix = {
      a: 1.0, b: 0.0,
      c: 0.0, d: 1.0
    };

    // 探究探针测试向量 x = (px, py)
    this.probeVector = { x: 1.0, y: 1.0 };
    this.showProbe = true;
    this.onMatrixChange = null;

    // 坐标系视口参数
    this.width = 800;
    this.height = 600;
    this.originX = 0;
    this.originY = 0;
    this.unitScale = 85;

    // 鼠标交互状态
    this.draggingTarget = null; // 'e1' | 'e2' | 'probe' | 'pan' | null
    this.panStart = { x: 0, y: 0 };
    this.panStartOrigin = { x: 0, y: 0 };
    this.dragStartMatrix = null;
    this.mouseMathPos = { x: 0, y: 0 };

    this.currentAnimFrameId = null;
    this.stateManager = null;
    this.customGraphics = []; // Agent 动态派发的自定义物理矢量图元列表
    this.sceneId = null;
    this._sceneSequence = 0;
    this._animationEpoch = 0;
    this._labelRects = [];

    // 空间维度模式与三维超几何状态 (2D / 3D 毕加索空间)
    this.dimensionMode = '2D'; // '2D' | '3D'
    this.rotX = 0.52; // 3D 俯仰角 (Pitch)
    this.rotY = -0.68; // 3D 偏航角 (Yaw)
    this.matrix3D = {
      m00: 1.0, m01: 0.3, m02: 0.0,
      m10: 0.0, m11: 1.0, m12: 0.2,
      m20: 0.1, m21: 0.0, m22: 1.0
    };

    if (this.canvas) {
      this.initEvents();
      this.initStoryboardStepper();
      this.initAnnotationLayer();
      this.resize();
    }
  }

  initAnnotationLayer() {
    if (!this.canvas || typeof document === 'undefined') return;
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const AnnotClass = (typeof window !== 'undefined' && window.CanvasAnnotationLayer) ||
      (typeof global !== 'undefined' && global.CanvasAnnotationLayer);
    if (AnnotClass && !this.annotationLayer) {
      this.annotationLayer = new AnnotClass({
        container: parent,
        underlyingCanvas: this.canvas
      });
      if (typeof window !== 'undefined') {
        window.canvasAnnotationLayer = this.annotationLayer;
      }
    }
  }

  initStoryboardStepper() {
    // Teaching steps are rendered by the native math experiment.
    this.canvas?.parentElement?.querySelector?.('#canvas-storyboard-stepper')?.remove();
  }

  executeStoryboardStep(step) {
    if(typeof window!=='undefined'&&window.artifactStageDeck?.openModernDualView)return window.artifactStageDeck.openModernDualView(this.matrix,step==='dualview'?'transform':step);
    if (step === 'basis') {
      this.showBasisVectors = true;
      this.render();
      if (typeof this.updateHUD === 'function') this.updateHUD();
    } else if (step === 'transform') {
      const current = { ...this.matrix };
      const isIdentity = Math.abs(current.a - 1) < 0.01 && Math.abs(current.b) < 0.01 && Math.abs(current.c) < 0.01 && Math.abs(current.d - 1) < 0.01;
      const target = isIdentity ? { a: 1.0, b: 1.2, c: 0.0, d: 1.0 } : current;
      this.matrix = { a: 1.0, b: 0.0, c: 0.0, d: 1.0 };
      this.render();
      if (typeof this.animateTo === 'function') {
        this.animateTo(target, 700);
      }
    } else if (step === 'spaces') {
      this.render();
      const rank = this.getRank();
      if (typeof window !== 'undefined' && typeof window.appendAgentNotice === 'function') {
        if (rank === 2) {
          window.appendAgentNotice('📐 满秩空间：像空间 Col(A) 覆盖全平面 ℝ²，零空间 Null(A) 仅含平凡原点 {(0, 0)}。');
        } else if (rank === 1) {
          window.appendAgentNotice('📐 奇异降维：所有向量被压缩到像空间直线 Col(A) 上；粉色法线 Null(A) 上的所有向量全被压缩至原点！');
        } else {
          window.appendAgentNotice('📐 全平面坍缩：像空间仅为原点 {0}，零空间为整个二维平面 ℝ²。');
        }
      }
    } else if (step === 'dualview') {
      if (typeof window !== 'undefined' && window.artifactStageDeck) {
        if (typeof window.artifactStageDeck.openModernDualView === 'function') {
          window.artifactStageDeck.openModernDualView(this.matrix);
        } else {
          window.artifactStageDeck.setMode('artifact');
        }
      }
    }
  }

  toggleDimension() {
    const nextMode = (this.dimensionMode === '2D' ? '3D' : '2D');
    this.setDimensionMode(nextMode);
    return this.dimensionMode;
  }

  setDimensionMode(mode, targetMatrix = null) {
    if (mode === '2D' || mode === '3D') {
      const prevMode = this.dimensionMode;
      this.dimensionMode = mode;
      if (targetMatrix) {
        if (mode === '3D') {
          this.matrix3D = { ...targetMatrix };
        } else {
          this.setMatrix(targetMatrix);
        }
      } else if (prevMode !== mode) {
        if (mode === '3D') {
          // 2D -> 3D：自然嵌入为柱面仿射矩阵，使底面几何构型与面积 100% 保持一致，det(A_3x3) = det(A_2x2)
          this.matrix3D = {
            m00: this.matrix.a, m01: this.matrix.b, m02: 0.0,
            m10: this.matrix.c, m11: this.matrix.d, m12: 0.0,
            m20: 0.0,           m21: 0.0,           m22: 1.0
          };
        } else {
          // 3D -> 2D：将底面分量同步回写 2D 矩阵
          this.matrix.a = this.matrix3D.m00;
          this.matrix.b = this.matrix3D.m01;
          this.matrix.c = this.matrix3D.m10;
          this.matrix.d = this.matrix3D.m11;
        }
      }
      this.syncDimensionUI();
      this.render();
      this.updateHUD();
    }
  }

  syncDimensionUI() {
    if (typeof document === 'undefined') return;
    const stepper = document.getElementById('canvas-storyboard-stepper');
    if (stepper) {
      stepper.classList.toggle('hidden', this.dimensionMode === '3D');
    }
    const fitBtn = document.getElementById('btn-fit-canvas');
    if (fitBtn) {
      fitBtn.disabled = this.dimensionMode === '3D';
      fitBtn.style.opacity = this.dimensionMode === '3D' ? '0.35' : '1';
    }
    const rankBadge = document.getElementById('rank-badge');
    if (rankBadge) {
      if (this.dimensionMode === '3D') {
        const rank3 = this.getRank3D ? this.getRank3D() : 3;
        if (rank3 === 3) {
          rankBadge.className = 'symbol-rank-badge';
          rankBadge.textContent = '满秩保维 rank(A)=3';
        } else if (rank3 === 2) {
          rankBadge.className = 'symbol-rank-badge singular';
          rankBadge.textContent = '奇异降维 rank(A)=2';
        } else if (rank3 === 1) {
          rankBadge.className = 'symbol-rank-badge singular';
          rankBadge.textContent = '一维共线 rank(A)=1';
        } else {
          rankBadge.className = 'symbol-rank-badge singular';
          rankBadge.textContent = '零空间坍缩 rank(A)=0';
        }
      } else {
        const rank = this.getRank ? this.getRank() : 2;
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
    }
  }

  resize({ resetView = false } = {}) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect?.() || (this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : {width:800,height:600});
    if (rect.width <= 0 || rect.height <= 0) return;
    const previousWidth = this.width, previousHeight = this.height;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.width = rect.width || 800;
    this.height = rect.height || 600;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    if (this.ctx) {
      if (typeof this.ctx.resetTransform === 'function') {
        this.ctx.resetTransform();
      } else if (typeof this.ctx.setTransform === 'function') {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (typeof this.ctx.scale === 'function') {
        this.ctx.scale(dpr, dpr);
      }
    }

    if (!this._viewReady || resetView) {
      this.originX = this.width * 0.42;
      this.originY = this.height * 0.50;
      this.unitScale = Math.max(35, Math.min(this.width * 0.18, this.height * 0.24, 115));
    } else {
      this.originX += (this.width - previousWidth) / 2;
      this.originY += (this.height - previousHeight) / 2;
    }
    this._viewReady = true;

    this.render();
  }

  initEvents() {
    if (!this.canvas || typeof this.canvas.addEventListener !== 'function') return;
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.resize());
    }

    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    if (typeof window !== 'undefined') {
      window.addEventListener('mouseup', () => this.onMouseUp());
    }
    this.canvas.style.touchAction = 'none';
    this._activePointers = new Map();
    let initialPinchDist = null;
    let initialPinchScale = null;
    let initialPinchCenter = null;

    this.canvas.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.canvas.setPointerCapture?.(e.pointerId);

      if (this._activePointers.size === 1) {
        this.onMouseDown(e);
      } else if (this._activePointers.size === 2) {
        // 双指按下：取消单指拖拽，初始化双指捏合基准距离与视口锚点
        this.draggingTarget = null;
        const pts = Array.from(this._activePointers.values());
        initialPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        initialPinchScale = this.unitScale;
        initialPinchCenter = {
          x: (pts[0].x + pts[1].x) / 2,
          y: (pts[0].y + pts[1].y) / 2
        };
      }
    });

    this.canvas.addEventListener('pointermove', e => {
      if (!this._activePointers.has(e.pointerId)) return;
      e.preventDefault();
      this._activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._activePointers.size === 1) {
        this.onMouseMove(e);
      } else if (this._activePointers.size === 2 && initialPinchDist > 5) {
        const pts = Array.from(this._activePointers.values());
        const currentDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const ratio = currentDist / initialPinchDist;
        const newScale = Math.min(Math.max(initialPinchScale * ratio, 12), 240);

        if (this.dimensionMode === '3D') {
          this.unitScale = newScale;
        } else {
          const rect = this.canvas.getBoundingClientRect();
          const cx = (initialPinchCenter?.x || e.clientX) - rect.left;
          const cy = (initialPinchCenter?.y || e.clientY) - rect.top;
          const mathBefore = this.screenToMath(cx, cy);
          this.originX = cx - mathBefore.x * newScale;
          this.originY = cy + mathBefore.y * newScale;
          this.unitScale = newScale;
        }
        this.render();
      }
    });

    const endTouch = e => {
      if (this._activePointers.has(e.pointerId)) {
        this._activePointers.delete(e.pointerId);
        if (this._activePointers.size === 0) {
          initialPinchDist = null;
          this.onMouseUp();
        } else if (this._activePointers.size === 1) {
          initialPinchDist = null;
        }
      }
    };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.canvas.addEventListener(type, endTouch);

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoom = e.deltaY < 0 ? 1.08 : 0.92;
      const newScale = Math.min(Math.max(this.unitScale * zoom, 12), 240);

      if (this.dimensionMode === '3D') {
        // 3D 模式下纯调节视口缩放比例，严禁污染 2D 坐标原点 originX/originY
        this.unitScale = newScale;
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const mathBefore = this.screenToMath(mouseX, mouseY);
        // 以鼠标所在位置为中心缩放
        this.originX = mouseX - mathBefore.x * newScale;
        this.originY = mouseY + mathBefore.y * newScale;
        this.unitScale = newScale;
      }

      this.render();
    }, { passive: false });
  }

  screenToMath(sx, sy, out = null) {
    const x = (sx - this.originX) / this.unitScale;
    const y = -(sy - this.originY) / this.unitScale;
    if (out) { out.x = x; out.y = y; return out; }
    return { x, y };
  }

  fitToContent() {
    const m = this.matrix, p = this.probeVector;
    const points = [[0,0],[m.a,m.c],[m.b,m.d],[m.a+m.b,m.c+m.d]];
    if (this.showProbe) points.push([p.x,p.y],[m.a*p.x+m.b*p.y,m.c*p.x+m.d*p.y]);
    for (const shape of this.customGraphics || []) {
      if (Array.isArray(shape.vertices)) points.push(...shape.vertices);
      if (shape.type === 'circle') points.push([shape.centerX-shape.radius,shape.centerY-shape.radius],[shape.centerX+shape.radius,shape.centerY+shape.radius]);
    }
    const finite = points.filter(q=>Array.isArray(q)&&q.length>=2&&q.slice(0,2).every(Number.isFinite));
    const xs=finite.map(q=>q[0]),ys=finite.map(q=>q[1]);
    const minX=Math.min(-.5,...xs),maxX=Math.max(.5,...xs),minY=Math.min(-.5,...ys),maxY=Math.max(.5,...ys);
    const margin=Math.min(64,Math.min(this.width,this.height)*.15);
    this.unitScale=Math.max(0.05,Math.min(240,(this.width-2*margin)/(maxX-minX),(this.height-2*margin)/(maxY-minY)));
    this.originX=this.width/2-(minX+maxX)/2*this.unitScale;
    this.originY=this.height/2+(minY+maxY)/2*this.unitScale;
    this._viewReady=true; this.render();
    return { scale:this.unitScale, bounds:{minX,maxX,minY,maxY} };
  }

  mathToScreen(mx, my, out = null) {
    const x = this.originX + mx * this.unitScale;
    const y = this.originY - my * this.unitScale;
    if (out) { out.x = x; out.y = y; return out; }
    return { x, y };
  }

  onMouseDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const m = this.screenToMath(sx, sy);
    this.mouseMathPos = m;

    if (this.dimensionMode === '3D') {
      this.draggingTarget = 'pan';
      this.dragStartMatrix = null;
      this.panStart = { x: sx, y: sy };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    const hitThreshold = 22 / this.unitScale;
    const distE1 = Math.hypot(m.x - this.matrix.a, m.y - this.matrix.c);
    const distE2 = Math.hypot(m.x - this.matrix.b, m.y - this.matrix.d);
    const distProbe = Math.hypot(m.x - this.probeVector.x, m.y - this.probeVector.y);

    if (distE1 < hitThreshold) {
      this.draggingTarget = 'e1';
      this.dragStartMatrix = { ...this.matrix };
    } else if (distE2 < hitThreshold) {
      this.draggingTarget = 'e2';
      this.dragStartMatrix = { ...this.matrix };
    } else if (this.showProbe && distProbe < hitThreshold) {
      this.draggingTarget = 'probe';
    } else {
      // 拖拽空白处平移画布
      this.draggingTarget = 'pan';
      this.panStart = { x: sx, y: sy };
      this.panStartOrigin = { x: this.originX, y: this.originY };
      this.canvas.style.cursor = 'move';
    }
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const m = this.screenToMath(sx, sy);
    if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    this.mouseMathPos = m;

    if (this.draggingTarget) {
      const clampCoord = (val, min = -50, max = 50) => Math.max(min, Math.min(max, val));
      const clampedX = clampCoord(m.x);
      const clampedY = clampCoord(m.y);

      if (this.draggingTarget === 'e1') {
        let snapX = Math.round(clampedX * 2) / 2;
        let snapY = Math.round(clampedY * 2) / 2;
        this.matrix.a = Math.abs(clampedX - snapX) < 0.1 ? snapX : clampedX;
        this.matrix.c = Math.abs(clampedY - snapY) < 0.1 ? snapY : clampedY;
        this.canvas.style.cursor = 'grabbing';
      } else if (this.draggingTarget === 'e2') {
        let snapX = Math.round(clampedX * 2) / 2;
        let snapY = Math.round(clampedY * 2) / 2;
        this.matrix.b = Math.abs(clampedX - snapX) < 0.1 ? snapX : clampedX;
        this.matrix.d = Math.abs(clampedY - snapY) < 0.1 ? snapY : clampedY;
        this.canvas.style.cursor = 'grabbing';
      } else if (this.draggingTarget === 'probe') {
        this.probeVector = { x: clampedX, y: clampedY };
        this.canvas.style.cursor = 'grabbing';
      } else if (this.draggingTarget === 'pan') {
        const dx = sx - this.panStart.x;
        const dy = sy - this.panStart.y;
        if (this.dimensionMode === '3D') {
          // 3D 模式下鼠标拖拽驱动欧拉角平滑旋转
          this.rotY += dx * 0.007;
          this.rotX += dy * 0.007;
          this.panStart = { x: sx, y: sy };
        } else {
          this.originX = this.panStartOrigin.x + dx;
          this.originY = this.panStartOrigin.y + dy;
        }
      }
      this.render();
      this.updateHUD();
      return;
    }

    // 悬停抓手检测
    if (this.dimensionMode === '3D') { this.canvas.style.cursor = 'grab'; return; }
    const hitThreshold = 22 / this.unitScale;
    const distE1 = Math.hypot(m.x - this.matrix.a, m.y - this.matrix.c);
    const distE2 = Math.hypot(m.x - this.matrix.b, m.y - this.matrix.d);
    const distProbe = Math.hypot(m.x - this.probeVector.x, m.y - this.probeVector.y);

    if (distE1 < hitThreshold || distE2 < hitThreshold || distProbe < hitThreshold) {
      this.canvas.style.cursor = 'grab';
    } else {
      this.canvas.style.cursor = 'crosshair';
    }
  }

  onMouseUp() {
    if (this.draggingTarget) {
      const target = this.draggingTarget;
      this.draggingTarget = null;
      if (this.canvas) this.canvas.style.cursor = 'crosshair';

      if (this.dragStartMatrix && this.stateManager && typeof this.stateManager.pushSnapshot === 'function') {
        const moved = Math.hypot(
          this.matrix.a - this.dragStartMatrix.a,
          this.matrix.c - this.dragStartMatrix.c,
          this.matrix.b - this.dragStartMatrix.b,
          this.matrix.d - this.dragStartMatrix.d
        ) > 0.02;
        if (moved) {
          this.stateManager.pushSnapshot(`手动调整基向量【${target}】`);
        }
      }
      this.dragStartMatrix = null;
    }
  }

  assertRunActive(context = {}) {
    if (context.signal?.aborted || (typeof context.isRunActive === 'function' && !context.isRunActive())) {
      const error = new Error('RUN_ABORTED');
      error.code = 'RUN_ABORTED';
      throw error;
    }
  }

  /** Start a scene only when a tool is about to write. Repeated calls in one run are idempotent. */
  prepareScene(sceneId, options = {}) {
    this.assertRunActive(options);
    const mode = options.mode || 'replace';
    if (!['replace', 'append'].includes(mode)) throw Object.assign(new Error('INVALID_SCENE_MODE'), { code: 'INVALID_SCENE_MODE' });
    if (sceneId !== undefined && (typeof sceneId !== 'string' || !sceneId.trim() || sceneId.length > 160)) {
      throw Object.assign(new Error('INVALID_SCENE_ID'), { code: 'INVALID_SCENE_ID' });
    }
    if (mode === 'append' && (!sceneId || this.sceneId !== sceneId)) {
      throw Object.assign(new Error('SCENE_APPEND_MISMATCH'), { code: 'SCENE_APPEND_MISMATCH' });
    }
    const next = sceneId || `canvas-local-${++this._sceneSequence}`;
    if (next === this.sceneId) return { sceneId: next, replaced: false };
    this.cancelAnimation('SCENE_REPLACED');
    this.sceneId = next;
    this.customGraphics = [];
    this.oracleMatrixB = null;
    this.oracleNullspace = null;
    this.activeFocusMode = null;
    this.activeSubspaceHighlight = null;
    this._labelRects = [];
    this.showProbe = false;
    this.draggingTarget = null;
    this.dragStartMatrix = null;
    if (options.resetMatrix === true) this.matrix = { a: 1, b: 0, c: 0, d: 1 };
    if (typeof document !== 'undefined') {
      const oracle = document.getElementById('studio-oracle-matrix-b');
      if (oracle) { oracle.textContent = ''; oracle.style.display = 'none'; if (oracle.dataset) delete oracle.dataset.bJson; }
    }
    if (options.render === true) { this.render(); this.updateHUD(); }
    return { sceneId: next, replaced: true };
  }

  cancelAnimation(reason = 'RUN_ABORTED') {
    this._animationEpoch++;
    if (this.currentAnimFrameId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.currentAnimFrameId);
    this.currentAnimFrameId = null;
    const finish = this._animationFinish;
    this._animationFinish = null;
    if (finish) finish({ status: 'cancelled', code: reason, error: reason });
  }

  animateTo(target, duration = 600, onComplete = null, context = {}) {
    this.assertRunActive(context);
    this.cancelAnimation('ANIMATION_REPLACED');
    const epoch = this._animationEpoch;
    const signal = context.signal;
    let settled = false;
    const abort = () => this.cancelAnimation('RUN_ABORTED');
    const finish = (result) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      this._animationFinish = null;
      if (typeof onComplete === 'function') onComplete(result);
    };
    this._animationFinish = finish;
    signal?.addEventListener('abort', abort, { once: true });

    const start = { ...this.matrix };
    const startTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    const step = (time) => {
      if (epoch !== this._animationEpoch || settled) return;
      if (signal?.aborted || (typeof context.isRunActive === 'function' && !context.isRunActive())) { abort(); return; }
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out expo / cubic
      const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);

      this.matrix.a = start.a + (target.a - start.a) * ease;
      this.matrix.b = start.b + (target.b - start.b) * ease;
      this.matrix.c = start.c + (target.c - start.c) * ease;
      this.matrix.d = start.d + (target.d - start.d) * ease;

      if (this.matrix3D) {
        this.matrix3D.m00 = this.matrix.a;
        this.matrix3D.m01 = this.matrix.b;
        this.matrix3D.m10 = this.matrix.c;
        this.matrix3D.m11 = this.matrix.d;
      }

      this.render();
      this.updateHUD();

      if (progress < 1) {
        this.currentAnimFrameId = requestAnimationFrame(step);
      } else {
        this.currentAnimFrameId = null;
        finish({ status: 'success' });
      }
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      this.currentAnimFrameId = requestAnimationFrame(step);
    } else {
      // Node.js 或降级环境
      this.matrix = { ...target };
      if (this.matrix3D) {
        this.matrix3D.m00 = this.matrix.a;
        this.matrix3D.m01 = this.matrix.b;
        this.matrix3D.m10 = this.matrix.c;
        this.matrix3D.m11 = this.matrix.d;
      }
      finish({ status: 'success' });
    }
  }

  /**
   * 响应 Agent Tool Call 派发的目标矩阵变换
   */
  dispatchAgentTransform(arg0, ...rest) {
    if (typeof arg0 === 'number' && typeof rest[0] === 'number') {
      const a = arg0, b = rest[0], c = rest[1], d = rest[2];
      const dur = typeof rest[3] === 'number' ? rest[3] : 600;
      return this.dispatchAgentTransform({ targetMatrix: { a, b, c, d }, duration: dur });
    }
    const { targetMatrix, preset, duration = 600, highlight = 'kernel', ...context } = (arg0 && typeof arg0 === 'object') ? arg0 : {};
    return new Promise((resolve) => {
      let target = targetMatrix;
      if (preset) {
        if (preset === 'singular') target = { a: 2.0, b: 1.0, c: 1.0, d: 0.5 };
        else if (preset === 'shear') target = { a: 1.0, b: 1.5, c: 0.0, d: 1.0 };
        else if (preset === 'cubist') target = { a: 1.0, b: 2.6, c: 2.5, d: 0.9 };
        else if (preset === 'identity') target = { a: 1.0, b: 0.0, c: 0.0, d: 1.0 };
        else if (preset === 'rotation90') target = { a: 0.0, b: -1.0, c: 1.0, d: 0.0 };
        else if (preset === 'projectionX') target = { a: 1.0, b: 0.0, c: 0.0, d: 0.0 };
        else if (preset === 'reflection') target = { a: 0.0, b: 1.0, c: 1.0, d: 0.0 };
      }
      if (!target) target = { a: 2.0, b: 1.0, c: 1.0, d: 0.5 };

      // S5 清偿（B 线）：显式目标矩阵必须为 4 个有限数字；残缺/NaN/非数值目标拒绝执行且不触碰画布状态
      if (targetMatrix !== undefined && targetMatrix !== null) {
        const vals = [targetMatrix && targetMatrix.a, targetMatrix && targetMatrix.b, targetMatrix && targetMatrix.c, targetMatrix && targetMatrix.d];
        const valid = targetMatrix && typeof targetMatrix === 'object' &&
          vals.every((x) => typeof x === 'number' && Number.isFinite(x));
        if (!valid) {
          resolve({
            status: 'error',
            error: 'INVALID_TARGET_MATRIX',
            detail: '[S5] targetMatrix 必须是 {a,b,c,d} 四个有限数字（收到: ' + JSON.stringify(targetMatrix) + '），已拒绝执行以保护画布状态。'
          });
          return;
        }
      }

      this.assertRunActive(context);
      this.prepareScene(context.sceneId, context);
      this.animateTo(target, duration, (animation) => {
        if (animation?.status === 'cancelled') { resolve(animation); return; }
        const det = this.getDeterminant();
        // S2 清偿（B 线）：请求的子空间高亮真实落到画布状态
        if (highlight && highlight !== 'none') {
          this.activeSubspaceHighlight = highlight;
        }
        resolve({
          status: "success",
          finalMatrix: { ...this.matrix },
          det,
          rank: this.getRank(),
          highlight: this.activeSubspaceHighlight || null
        });
      }, context);
    });
  }

  setPreset(type) {
    if (this.dimensionMode === '3D') {
      this.setDimensionMode('2D');
    }
    if (this.stateManager && typeof this.stateManager.pushSnapshot === 'function') {
      this.stateManager.pushSnapshot(`预设变换至【${type}】`);
    }
    switch (type) {
      case 'cubist':
        this.animateTo({ a: 1.0, b: 2.6, c: 2.5, d: 0.9 });
        break;
      case 'singular':
        this.animateTo({ a: 2.0, b: 1.0, c: 1.0, d: 0.5 });
        break;
      case 'identity':
        this.animateTo({ a: 1.0, b: 0.0, c: 0.0, d: 1.0 });
        break;
      case 'shear':
        this.animateTo({ a: 1.0, b: 1.5, c: 0.0, d: 1.0 });
        break;
      case 'rotation90':
        this.animateTo({ a: 0.0, b: -1.0, c: 1.0, d: 0.0 });
        break;
      case 'projectionX':
        this.animateTo({ a: 1.0, b: 0.0, c: 0.0, d: 0.0 });
        break;
      case 'reflection':
        this.animateTo({ a: 0.0, b: 1.0, c: 1.0, d: 0.0 });
        break;
    }
  }

  getDeterminant() {
    return this.matrix.a * this.matrix.d - this.matrix.b * this.matrix.c;
  }

  getDet() {
    return this.getDeterminant();
  }

  getRank() {
    if (this.dimensionMode === '3D') {
      return this.getRank3D();
    }
    const a = Number.isFinite(this.matrix.a) ? this.matrix.a : 0;
    const b = Number.isFinite(this.matrix.b) ? this.matrix.b : 0;
    const c = Number.isFinite(this.matrix.c) ? this.matrix.c : 0;
    const d = Number.isFinite(this.matrix.d) ? this.matrix.d : 0;
    const det = a * d - b * c;
    if (Math.abs(det) >= 0.05) return 2;
    const isZero = (
      Math.abs(a) < 0.001 &&
      Math.abs(b) < 0.001 &&
      Math.abs(c) < 0.001 &&
      Math.abs(d) < 0.001
    );
    return isZero ? 0 : 1;
  }

  getNullBasis() {
    const rank = this.getRank();
    if (rank === 2) return [];
    if (rank === 0) return [[1, 0], [0, 1]];

    // rank = 1 时求解 A·x = 0
    let kx = -this.matrix.b;
    let ky = this.matrix.a;
    if (Math.hypot(kx, ky) < 0.001) {
      kx = -this.matrix.d;
      ky = this.matrix.c;
    }
    const len = Math.hypot(kx, ky);
    if (len > 1e-6) {
      return [[kx / len, ky / len]];
    }
    return [[1, 0]];
  }

  getColBasis() {
    const rank = this.getRank();
    if (rank === 0) return [];
    if (rank === 2) return [[this.matrix.a, this.matrix.c], [this.matrix.b, this.matrix.d]];
    if (Math.hypot(this.matrix.a, this.matrix.c) > 0.01) {
      return [[this.matrix.a, this.matrix.c]];
    }
    return [[this.matrix.b, this.matrix.d]];
  }

  getMatrix() {
    return { ...this.matrix };
  }

  setMatrix(mat) {
    if (!mat) return;
    this.matrix.a = Number.isFinite(mat.a) ? mat.a : this.matrix.a;
    this.matrix.b = Number.isFinite(mat.b) ? mat.b : this.matrix.b;
    this.matrix.c = Number.isFinite(mat.c) ? mat.c : this.matrix.c;
    this.matrix.d = Number.isFinite(mat.d) ? mat.d : this.matrix.d;
    if (this.matrix3D) {
      this.matrix3D.m00 = this.matrix.a;
      this.matrix3D.m01 = this.matrix.b;
      this.matrix3D.m10 = this.matrix.c;
      this.matrix3D.m11 = this.matrix.d;
    }
    this.render();
    this.updateHUD();
  }

  get e1() {
    return [this.matrix.a, this.matrix.c];
  }

  get e2() {
    return [this.matrix.b, this.matrix.d];
  }

  updateHUD() {
    if(typeof document!=='undefined'){
      const label=document.getElementById('dim-label');if(label)label.textContent=this.dimensionMode==='3D'?'3D 线性空间':'2D 坐标平面';
      const fit=document.getElementById('btn-fit-canvas');if(fit)fit.disabled=this.dimensionMode==='3D';
    }
    const hudDetVal = typeof document !== 'undefined' ? document.getElementById('hud-det-val') : null;
    const hudMatrixTable = typeof document !== 'undefined' ? document.getElementById('hud-matrix-table') : null;

    if (this.dimensionMode === '3D') {
      const det3D = Math.abs(this.getDeterminant3D());
      const rank3D = this.getRank3D ? this.getRank3D() : 3;
      const isSingular = rank3D < 3;
      if (hudDetVal) {
        hudDetVal.textContent = det3D.toFixed(2);
        hudDetVal.style.color = isSingular ? '#ec4899' : '#38bdf8';
      }
      if (hudMatrixTable) {
        const m = this.matrix3D;
        hudMatrixTable.innerHTML = `
          <tr><td>${m.m00.toFixed(1)}</td><td>${m.m01.toFixed(1)}</td><td>${m.m02.toFixed(1)}</td></tr>
          <tr><td>${m.m10.toFixed(1)}</td><td>${m.m11.toFixed(1)}</td><td>${m.m12.toFixed(1)}</td></tr>
          <tr><td>${m.m20.toFixed(1)}</td><td>${m.m21.toFixed(1)}</td><td>${m.m22.toFixed(1)}</td></tr>
        `;
      }
      this.syncDimensionUI();
      return;
    }

    const det = this.getDeterminant();
    const absDet = Math.abs(det);
    const rank = this.getRank();
    const isSingular = rank < 2;

    if (hudDetVal) {
      hudDetVal.textContent = absDet.toFixed(2);
      hudDetVal.style.color = isSingular ? '#ec4899' : '#38bdf8';
    }

    if (hudMatrixTable) {
      hudMatrixTable.innerHTML = `
        <tr>
          <td>${this.matrix.a.toFixed(1)}</td>
          <td>${this.matrix.b.toFixed(1)}</td>
        </tr>
        <tr>
          <td>${this.matrix.c.toFixed(1)}</td>
          <td>${this.matrix.d.toFixed(1)}</td>
        </tr>
      `;
    }

    const rankBadge = typeof document !== 'undefined' ? document.getElementById('rank-badge') : null;
    const nullspaceDesc = typeof document !== 'undefined' ? document.getElementById('nullspace-dynamic-expr') : null;

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

    if (nullspaceDesc) {
      if (rank === 1) {
        const nb = this.getNullBasis()[0] || [0, 0];
        nullspaceDesc.innerHTML = `<span style="color:#ec4899; font-weight:700;">★ 发现一维零空间: Null(A) = Span{ [${nb[0].toFixed(2)}, ${nb[1].toFixed(2)}]ᵀ }</span> (该直线上所有非零向量映射至原点)`;
      } else if (rank === 0) {
        nullspaceDesc.innerHTML = `<span style="color:#ec4899; font-weight:700;">★ 全平面坍缩: Null(A) = ℝ²</span> (所有向量全部映射至原点)`;
      } else {
        nullspaceDesc.textContent = '核空间: Null(A) = { (0, 0) } (保维同构映射，仅原点映射至原点)';
      }
    }

    // 触发外部双向数据绑定监听器
    if (typeof this.onMatrixChange === 'function') {
      this.onMatrixChange({
        matrix: { ...this.matrix },
        det,
        absDet,
        rank,
        isSingular,
        nullity: 2 - rank,
        nullBasis: this.getNullBasis(),
        colBasis: this.getColBasis()
      });
    }

    // 物理证据总线：向真实认知状态机投递学生画板探究物理证据 (反 Mock)
    if (typeof window !== 'undefined' && window.cognitiveTracker) {
      if (isSingular) {
        window.cognitiveTracker.recordPhysicalEvent('matrix_singular_detected');
        const nb = this.getNullBasis();
        if (nb && nb.length > 0 && (Math.abs(nb[0][0]) > 0.001 || Math.abs(nb[0][1]) > 0.001)) {
          window.cognitiveTracker.recordPhysicalEvent('kernel_vector_verified', {
            x: nb[0][0].toFixed(2),
            y: nb[0][1].toFixed(2)
          });
        }
      }
    }
  }

  render() {
    if (!this.ctx || typeof this.ctx.setLineDash !== 'function') return;
    this._labelRects = [];
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    if (this.dimensionMode === '3D') {
      this.render3DSpace();
      this.updateHUD();
      return;
    }

    // 1. 静态背景参考坐标网格 (Static Cartesian Reference Grid)
    this.drawStaticCartesianGrid();

    // 2. 矩阵 A 驱动的连续仿射变形网格 (Deformable Affine Grid)
    this.drawDeformableAffineGrid();

    // 3. 列空间 / 像空间 Col(A) 几何体 (有向平行四边形面域或降维直线)
    this.drawColumnSpaceManifold();

    // 4. 零空间 / 核空间 Null(A) 激光几何流形
    this.drawNullSpaceManifold();

    // 5. 探针测试向量 x 与像 y = A·x 验证线
    if (this.showProbe) {
      this.drawProbeMapping();
    }

    // 6. 绘制 Agent 动态派发的自定义物理矢量图元层 (菱形、多边形、函数曲线、视觉图像等)
    this.drawCustomGraphics();

    // 7. 基向量 e1(金) 与 e2(青) 及拖拽手柄 (保持置顶层，支持在叠图模式下按需收折)
    if (this.showBasisVectors !== false) {
      this.drawBasisVector({ x: 0, y: 0 }, { x: this.matrix.a, y: this.matrix.c }, '#f59e0b', 'e₁');
      this.drawBasisVector({ x: 0, y: 0 }, { x: this.matrix.b, y: this.matrix.d }, '#06b6d4', 'e₂');
    }

    // 8. 坐标轴主线与地平线辉光
    this.drawHorizonAndAxes();

    this.updateHUD();
  }

  project3D(x, y, z) {
    const { m00, m01, m02, m10, m11, m12, m20, m21, m22 } = this.matrix3D;
    // 1. 三维仿射变换
    const tx = m00 * x + m01 * y + m02 * z;
    const ty = m10 * x + m11 * y + m12 * z;
    const tz = m20 * x + m21 * y + m22 * z;

    // 2. 空间欧拉角旋转 (围绕 Y 偏航，围绕 X 俯仰)
    const cosY = Math.cos(this.rotY);
    const sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX);
    const sinX = Math.sin(this.rotX);

    const x1 = tx * cosY + tz * sinY;
    const z1 = -tx * sinY + tz * cosY;

    const y2 = ty * cosX - z1 * sinX;
    const z2 = ty * sinX + z1 * cosX;

    // 3. 仿人眼透视深度畸变 (加入近截面硬裁剪保护，防止除以零或倒置穿模)
    const camDist = 5.5;
    const denom = Math.max(0.12, camDist + z2 * 0.32);
    const fov = camDist / denom;

    const cx = this.width * 0.48;
    const cy = this.height * 0.52;
    const scale = this.unitScale * 0.95;

    const projX = cx + x1 * scale * fov;
    const projY = cy - y2 * scale * fov;

    return {
      x: Number.isFinite(projX) ? projX : cx,
      y: Number.isFinite(projY) ? projY : cy,
      z: z2,
      fov
    };
  }

  /**
   * 纯相机透视投影（欧氏绝对世界坐标，不施加 matrix3D 仿射变换）
   * 用于绘制静态参考网格与世界绝对坐标轴
   */
  projectCamera(x, y, z) {
    const cosY = Math.cos(this.rotY);
    const sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX);
    const sinX = Math.sin(this.rotX);

    const x1 = x * cosY + z * sinY;
    const z1 = -x * sinY + z * cosY;

    const y2 = y * cosX - z1 * sinX;
    const z2 = y * sinX + z1 * cosX;

    const camDist = 5.5;
    const denom = Math.max(0.12, camDist + z2 * 0.32);
    const fov = camDist / denom;

    const cx = this.width * 0.48;
    const cy = this.height * 0.52;
    const scale = this.unitScale * 0.95;

    const projX = cx + x1 * scale * fov;
    const projY = cy - y2 * scale * fov;

    return {
      x: Number.isFinite(projX) ? projX : cx,
      y: Number.isFinite(projY) ? projY : cy,
      z: z2,
      fov
    };
  }

  getDeterminant3D() {
    const m = this.matrix3D;
    return m.m00 * (m.m11 * m.m22 - m.m12 * m.m21) -
           m.m01 * (m.m10 * m.m22 - m.m12 * m.m20) +
           m.m02 * (m.m10 * m.m21 - m.m11 * m.m20);
  }

  getRank3D() {
    const m = this.matrix3D;
    const det = this.getDeterminant3D();
    if (Math.abs(det) >= 1e-5) {
      return 3;
    }

    const c0 = [m.m00, m.m10, m.m20];
    const c1 = [m.m01, m.m11, m.m21];
    const c2 = [m.m02, m.m12, m.m22];

    const cross = (u, v) => [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ];
    const normSq = (v) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];

    const c01 = cross(c0, c1);
    const c12 = cross(c1, c2);
    const c20 = cross(c2, c0);

    if (normSq(c01) > 1e-8 || normSq(c12) > 1e-8 || normSq(c20) > 1e-8) {
      return 2;
    }

    if (normSq(c0) > 1e-8 || normSq(c1) > 1e-8 || normSq(c2) > 1e-8) {
      return 1;
    }

    return 0;
  }

  render3DSpace() {
    const ctx = this.ctx;

    // 1. 绘制地面参考网格 (静态 XZ 平面，采用绝对欧式坐标)
    ctx.save();
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    const gSize = 4;
    for (let i = -gSize; i <= gSize; i++) {
      const p1 = this.projectCamera(i, 0, -gSize);
      const p2 = this.projectCamera(i, 0, gSize);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      const q1 = this.projectCamera(-gSize, 0, i);
      const q2 = this.projectCamera(gSize, 0, i);
      ctx.beginPath();
      ctx.moveTo(q1.x, q1.y);
      ctx.lineTo(q2.x, q2.y);
      ctx.stroke();
    }
    ctx.restore();

    // 2. 绘制三维世界绝对坐标轴 X (红), Y (绿), Z (蓝) —— 作为未变换前的绝对参考基准
    const axLen = 2.8;
    this.draw3DAxisLine(0, 0, 0, axLen, 0, 0, '#ef4444', 'X');
    this.draw3DAxisLine(0, 0, 0, 0, axLen, 0, '#10b981', 'Y');
    this.draw3DAxisLine(0, 0, 0, 0, 0, axLen, '#38bdf8', 'Z');

    // 3. 绘制三维平行六面体超体积 (Parallelepiped Vol = |det(A)|)
    this.draw3DParallelepiped();

    // 4. 绘制三维变换后的基向量 e1, e2, e3 (经过 3x3 矩阵仿射映射)
    const o = this.project3D(0, 0, 0);
    const e1 = this.project3D(1, 0, 0);
    const e2 = this.project3D(0, 1, 0);
    const e3 = this.project3D(0, 0, 1);

    this.draw3DVector(o, e1, '#f59e0b', 'e₁(X)');
    this.draw3DVector(o, e2, '#06b6d4', 'e₂(Y)');
    this.draw3DVector(o, e3, '#a855f7', 'e₃(Z)');

    // 5. 渲染自定义图元在三维空间中的投影
    this.drawCustomGraphics3D();
  }

  draw3DAxisLine(x1, y1, z1, x2, y2, z2, color, label) {
    const ctx = this.ctx;
    const p1 = this.projectCamera(x1, y1, z1);
    const p2 = this.projectCamera(x2, y2, z2);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = '700 11px "JetBrains Mono", sans-serif';
    ctx.fillText(label, p2.x + 6, p2.y);
    ctx.restore();
  }

  draw3DVector(from, to, color, label) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    // 绘制几何指示立体箭头
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len > 8) {
      const angle = Math.atan2(dy, dx);
      const arrowLen = 11;
      const arrowAngle = Math.PI / 6; // 30度张角
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - arrowLen * Math.cos(angle - arrowAngle), to.y - arrowLen * Math.sin(angle - arrowAngle));
      ctx.lineTo(to.x - arrowLen * 0.7 * Math.cos(angle), to.y - arrowLen * 0.7 * Math.sin(angle));
      ctx.lineTo(to.x - arrowLen * Math.cos(angle + arrowAngle), to.y - arrowLen * Math.sin(angle + arrowAngle));
      ctx.closePath();
      ctx.fill();
    }

    // 绘制端点小球与发光
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 12px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(label, to.x + 8, to.y + 4);
    ctx.restore();
  }

  draw3DParallelepiped() {
    const ctx = this.ctx;
    // 8 个顶点：由单位超立方体 [0,1]^3 在矩阵作用下生成
    const pts = [
      this.project3D(0, 0, 0), // 0
      this.project3D(1, 0, 0), // 1
      this.project3D(1, 1, 0), // 2
      this.project3D(0, 1, 0), // 3
      this.project3D(0, 0, 1), // 4
      this.project3D(1, 0, 1), // 5
      this.project3D(1, 1, 1), // 6
      this.project3D(0, 1, 1)  // 7
    ];

    // 6 个面
    const faces = [
      [0, 1, 2, 3], // 底
      [4, 5, 6, 7], // 顶
      [0, 1, 5, 4], // 前
      [2, 3, 7, 6], // 后
      [0, 3, 7, 4], // 左
      [1, 2, 6, 5]  // 右
    ];

    ctx.save();
    for (const f of faces) {
      ctx.beginPath();
      ctx.moveTo(pts[f[0]].x, pts[f[0]].y);
      ctx.lineTo(pts[f[1]].x, pts[f[1]].y);
      ctx.lineTo(pts[f[2]].x, pts[f[2]].y);
      ctx.lineTo(pts[f[3]].x, pts[f[3]].y);
      ctx.closePath();

      ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.fill();

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCustomGraphics3D() {
    if (!this.ctx || !this.customGraphics || this.customGraphics.length === 0) return;
    const ctx = this.ctx;

    for (const shape of this.customGraphics) {
      if (shape.vertices && shape.vertices.length >= 3) {
        ctx.save();
        ctx.beginPath();
        const p0 = this.project3D(shape.vertices[0][0], shape.vertices[0][1], 0);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < shape.vertices.length; i++) {
          const pt = this.project3D(shape.vertices[i][0], shape.vertices[i][1], 0);
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();
        ctx.fillStyle = shape.fillColor || 'rgba(16, 185, 129, 0.25)';
        ctx.fill();
        ctx.strokeStyle = shape.strokeColor || '#10b981';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /**
   * 1. 绘制静态欧几里得笛卡尔参考背景网格
   */
  drawStaticCartesianGrid() {
    const ctx = this.ctx;
    const range = 16;

    ctx.save();
    ctx.setLineDash([3, 4]);

    for (let i = -range; i <= range; i++) {
      if (i === 0) continue;
      const isMajor = i % 5 === 0;
      ctx.strokeStyle = isMajor ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = isMajor ? 1.2 : 0.8;

      // 垂直线 x = i
      const p1 = this.mathToScreen(i, -range);
      const p2 = this.mathToScreen(i, range);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // 水平线 y = i
      const q1 = this.mathToScreen(-range, i);
      const q2 = this.mathToScreen(range, i);
      ctx.beginPath();
      ctx.moveTo(q1.x, q1.y);
      ctx.lineTo(q2.x, q2.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 2. 绘制矩阵 A 驱动的可变形仿射网格 (Affine Grid)
   * 任意原网格线在 A 作用后成为平行四边形斜网格族
   */
  drawDeformableAffineGrid() {
    const ctx = this.ctx;
    const { a, b, c, d } = this.matrix;
    const range = 12;
    const tSpan = 16;

    ctx.save();
    ctx.setLineDash([]);

    // 线族 1: y = k (常数)，变换后点为 t*e1 + k*e2
    for (let k = -range; k <= range; k++) {
      const isMajor = k % 5 === 0;
      ctx.strokeStyle = isMajor ? 'rgba(56, 189, 248, 0.42)' : 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = isMajor ? 1.6 : 0.9;

      const pStart = this.mathToScreen(-tSpan * a + k * b, -tSpan * c + k * d);
      const pEnd = this.mathToScreen(tSpan * a + k * b, tSpan * c + k * d);
      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.stroke();
    }

    // 线族 2: x = k (常数)，变换后点为 k*e1 + t*e2
    for (let k = -range; k <= range; k++) {
      const isMajor = k % 5 === 0;
      ctx.strokeStyle = isMajor ? 'rgba(56, 189, 248, 0.42)' : 'rgba(56, 189, 248, 0.22)';
      ctx.lineWidth = isMajor ? 1.6 : 0.9;

      const pStart = this.mathToScreen(k * a - tSpan * b, k * c - tSpan * d);
      const pEnd = this.mathToScreen(k * a + tSpan * b, k * c + tSpan * d);
      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 3. 绘制列空间 Col(A) 面域或降维直线
   */
  drawColumnSpaceManifold() {
    const ctx = this.ctx;
    const { a, b, c, d } = this.matrix;
    const det = this.getDeterminant();
    const rank = this.getRank();

    const s0 = this.mathToScreen(0, 0);
    const sE1 = this.mathToScreen(a, c);
    const sE2 = this.mathToScreen(b, d);
    const sSum = this.mathToScreen(a + b, c + d);

    if (rank === 2) {
      // 满秩态：绘制平行四边形像空间面域与立体晶体多面微光
      ctx.save();
      const grad = ctx.createLinearGradient(s0.x, s0.y, sSum.x, sSum.y);
      grad.addColorStop(0, 'rgba(30, 64, 175, 0.45)');
      grad.addColorStop(0.5, 'rgba(14, 165, 233, 0.35)');
      grad.addColorStop(1, 'rgba(245, 158, 11, 0.30)');

      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(sE1.x, sE1.y);
      ctx.lineTo(sSum.x, sSum.y);
      ctx.lineTo(sE2.x, sE2.y);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // 3B1B 经典几何空间取向翻转与有向面积标注
      if (det < -0.001) {
        ctx.save();
        const centerX = (s0.x + sSum.x) / 2;
        const centerY = (s0.y + sSum.y) / 2;
        ctx.fillStyle = '#fef08a';
        ctx.font = '700 11px "Inter", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText('↻ 空间翻转 det < 0', centerX, centerY);
        ctx.restore();
      }

      // 版画斜线阴影 (Hatching)
      ctx.clip();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1.2;
      const rawMinX = Math.min(s0.x, sE1.x, sSum.x, sE2.x) - 50;
      const rawMaxX = Math.max(s0.x, sE1.x, sSum.x, sE2.x) + 50;
      const rawMinY = Math.min(s0.y, sE1.y, sSum.y, sE2.y) - 50;
      const rawMaxY = Math.max(s0.y, sE1.y, sSum.y, sE2.y) + 50;

      if (Number.isFinite(rawMinX) && Number.isFinite(rawMaxX) && Number.isFinite(rawMinY) && Number.isFinite(rawMaxY)) {
        // 限制在画布视口有效区域，避免在屏幕外空画几万次
        const clipMinX = Math.max(-100, rawMinX);
        const clipMaxX = Math.min(this.width + 100, rawMaxX);
        const clipMinY = Math.max(-100, rawMinY);
        const clipMaxY = Math.min(this.height + 100, rawMaxY);
        const deltaH = clipMaxY - clipMinY;

        let strokeCount = 0;
        const maxStrokes = 150; // 硬性安全熔断守卫
        for (let x = clipMinX - deltaH; x < clipMaxX + deltaH && strokeCount < maxStrokes; x += 14) {
          ctx.beginPath();
          ctx.moveTo(x, clipMinY);
          ctx.lineTo(x + deltaH, clipMaxY);
          ctx.stroke();
          strokeCount++;
        }
      }
      ctx.restore();

      // 墨黑艺术外框
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(sE1.x, sE1.y);
      ctx.lineTo(sSum.x, sSum.y);
      ctx.lineTo(sE2.x, sE2.y);
      ctx.closePath();
      ctx.strokeStyle = '#050912';
      ctx.lineWidth = 3.2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    } else if (rank === 1) {
      // 奇异降维态：面域坍缩为直线，渲染贯穿全画面的 Col(A) 发光列空间基线
      ctx.save();
      let dirX = a, dirY = c;
      if (Math.hypot(dirX, dirY) < 0.01) {
        dirX = b; dirY = d;
      }
      const dirLen = Math.hypot(dirX, dirY) || 1;
      const nx = dirX / dirLen;
      const ny = dirY / dirLen;

      const L = 16;
      const p1 = this.mathToScreen(-L * nx, -L * ny);
      const p2 = this.mathToScreen(L * nx, L * ny);

      // 发光金青色双层光芒
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
      ctx.lineWidth = 3.6;
      ctx.shadowColor = 'rgba(6, 182, 212, 0.35)';
      ctx.shadowBlur = 6;
      ctx.stroke();

      // 粗墨线核
      ctx.strokeStyle = '#050912';
      ctx.lineWidth = 1.4;
      ctx.shadowBlur = 0;
      ctx.stroke();
      ctx.restore();

      // 绘制列空间语义微标
      const sBadgeCol = this.mathToScreen(3.2 * nx, 3.2 * ny);
      this.drawBadgePill(sBadgeCol.x, sBadgeCol.y, '列空间 Col(A) · 像空间直线 (面域坍缩为一维)', {
        strokeColor: '#06b6d4',
        dotColor: '#06b6d4',
        textColor: '#ecfeff'
      });
    }
  }

  /**
   * 4. 绘制零空间 / 核空间 Null(A) 流形
   */
  drawNullSpaceManifold() {
    const rank = this.getRank();
    if (rank === 2) {
      // 满秩态：仅原点显示平凡核空间点
      const s0 = this.mathToScreen(0, 0);
      const ctx = this.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.arc(s0.x, s0.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(236, 72, 153, 0.4)';
      ctx.fill();
      ctx.restore();
      return;
    }

    // 奇异态 (rank = 1 或 0): 渲染高光霓虹洋红核空间激光
    const ctx = this.ctx;
    const nullBasis = this.getNullBasis();
    if (!nullBasis || nullBasis.length === 0) return;

    ctx.save();
    nullBasis.forEach((basis) => {
      const [nx, ny] = basis;
      const L = 18;
      const pStart = this.mathToScreen(-L * nx, -L * ny);
      const pEnd = this.mathToScreen(L * nx, L * ny);

      // 洋红霓虹激光发光外晕
      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = 3.6;
      ctx.shadowColor = 'rgba(236, 72, 153, 0.35)';
      ctx.shadowBlur = 6;
      ctx.stroke();

      // 激光内芯白亮细线
      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.lineTo(pEnd.x, pEnd.y);
      ctx.strokeStyle = '#fdf2f8';
      ctx.lineWidth = 1.2;
      ctx.shadowBlur = 0;
      ctx.stroke();

      // 标出零空间基向量 v_ker
      const sKer = this.mathToScreen(nx, ny);
      const s0 = this.mathToScreen(0, 0);
      this.drawArrow(s0, sKer, '#ec4899', 3.0);

      // 绘制零空间语义微标
      const sBadgeKer = this.mathToScreen(-2.8 * nx, -2.8 * ny);
      this.drawBadgePill(sBadgeKer.x, sBadgeKer.y, '零空间 Null(A) · 凡落在此线上的向量经 A 映射皆为 0', {
        strokeColor: '#ec4899',
        dotColor: '#ec4899',
        textColor: '#fdf2f8'
      });
    });
    ctx.restore();
  }

  /**
   * 5. 探针测试向量 x 与像 y = A·x 动态映射验证器
   */
  drawProbeMapping() {
    if (!this.showProbe) return;
    // 聚焦反例或核空间时自动折叠无关探针，保证画面清爽
    if (this.oracleMatrixB || this.activeFocusMode === 'counterexample') return;

    const ctx = this.ctx;
    const { a, b, c, d } = this.matrix;
    const px = this.probeVector.x;
    const py = this.probeVector.y;

    // 像向量 y = A·x
    const imgX = a * px + b * py;
    const imgY = c * px + d * py;

    const s0 = this.mathToScreen(0, 0);
    const sProbe = this.mathToScreen(px, py);
    const sImage = this.mathToScreen(imgX, imgY);

    ctx.save();
    // 探针向量 x 箭头 (高雅紫白)
    this.drawArrow(s0, sProbe, '#c084fc', 2.2, [4, 3]);

    // 像向量 y = A·x 箭头 (高光翡翠绿)
    this.drawArrow(s0, sImage, '#10b981', 2.6);

    // 映射连线: 从 x 到 A·x 虚线弧
    ctx.beginPath();
    ctx.moveTo(sProbe.x, sProbe.y);
    ctx.lineTo(sImage.x, sImage.y);
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 4]);
    ctx.stroke();

    // 探针点交互光圈
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(sProbe.x, sProbe.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#c084fc';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 像点光圈
    ctx.beginPath();
    ctx.arc(sImage.x, sImage.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#10b981';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 纯几何表征：彻底清除探针与像点所有重叠文本公式与状态文字
    ctx.restore();
  }

  /**
   * 6. 绘制带手柄的基向量
   */
  drawBasisVector(fromMath, toMath, color, label) {
    const ctx = this.ctx;
    const from = this.mathToScreen(fromMath.x, fromMath.y);
    const to = this.mathToScreen(toMath.x, toMath.y);

    ctx.save();
    // 向量实体主线
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.6;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 向量箭头
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowLen = 14;
    const arrowAngle = Math.PI / 6;

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - arrowLen * Math.cos(angle - arrowAngle), to.y - arrowLen * Math.sin(angle - arrowAngle));
    ctx.lineTo(to.x - arrowLen * Math.cos(angle + arrowAngle), to.y - arrowLen * Math.sin(angle + arrowAngle));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    ctx.strokeStyle = '#050912';
    ctx.lineWidth = 2.0;
    ctx.stroke();

    // 拖拽手柄圆环
    ctx.beginPath();
    ctx.arc(to.x, to.y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 2.8;
    ctx.strokeStyle = color;
    ctx.stroke();

    // 标签文本
    ctx.fillStyle = color;
    ctx.font = '800 16px "Plus Jakarta Sans", sans-serif';
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    this.drawBadgePill(to.x,to.y,label,{strokeColor:color});
    ctx.restore();
  }

  drawBadgePill(x, y, text, options = {}) {
    if (!this.ctx || !text) return;
    this._sceneLabels ||= [];
    const detail = String(text);
    let short = detail.replace(/ ·.*$/, '').replace(/\s+[AB]\s*=.*$/, '').trim();
    if (/e[₁1]/.test(short)) short = 'e₁';
    else if (/e[₂2]/.test(short)) short = 'e₂';
    else if (/Col|列空间|像/.test(short)) short = 'Col(A)';
    else if (/Null|零空间|核/.test(short)) short = 'ker(A)';
    else if (/^A\s*v/i.test(short)) short = 'Av';
    else if (/^v_ker/i.test(short)) short = 'v_ker';
    else if (short.length > 8) short = short.slice(0, 8);
    this._sceneLabels.push({
      id: 'label-' + this._sceneLabels.length,
      x,
      y,
      text: short,
      detail,
      color: options.dotColor || options.strokeColor || '#c4d7e5',
      priority: /e[₁₂]/.test(short) ? 100 : /Col|Null|ker/.test(short) ? 80 : 20
    });
  }

  _flushSceneLabels() {
    const api=typeof MathScene!=='undefined'?MathScene:typeof require==='function'?require('./artifacts/MathScene.js'):null;
    if(!api)return;
    const labels=(this._sceneLabels||[]).slice().sort((a,b)=>b.priority-a.priority),ctx=this.ctx;
    ctx.save();ctx.font='12px "Microsoft YaHei",sans-serif';
    const items=labels.map(item=>({...item,width:Math.ceil(ctx.measureText(item.text).width)+12,height:22}));
    const blocked=[{x:Math.max(0,this.width-430),y:0,width:430,height:62}];
    const layout=api.placeLabels(items,{width:this.width,height:this.height,blocked});this._labelRects=layout.placed;
    for(const item of layout.placed){
      ctx.beginPath();
      if(ctx.roundRect)ctx.roundRect(item.x,item.y,item.width,item.height,4);
      else ctx.rect(item.x,item.y,item.width,item.height);
      ctx.shadowBlur=0;
      ctx.fillStyle='rgba(15,23,42,0.92)';
      ctx.fill();
      ctx.strokeStyle='rgba(255,255,255,0.12)';
      ctx.lineWidth=1;
      ctx.stroke();
      ctx.fillStyle=item.color;
      ctx.textAlign='left';
      ctx.textBaseline='middle';
      ctx.fillText(item.text,item.x+6,item.y+10);
    }
    ctx.restore();
    if(typeof document==='undefined'||!this.canvas?.parentElement)return;
    const key=labels.map(x=>x.detail).join('|');
    if(this._legendKey===key)return;this._legendKey=key;
    if(!this._sceneLegend){const el=document.createElement('details');el.className='canvas-scene-legend';el.setAttribute('aria-label','画板对象图例');this.canvas.parentElement.appendChild(el);this._sceneLegend=el;}
    const summary=document.createElement('summary');summary.textContent='图例 · '+labels.length+' 个标注';const list=document.createElement('ul');
    for(const item of labels){const li=document.createElement('li');li.textContent=item.detail;li.style.borderLeftColor=item.color;list.appendChild(li);}
    this._sceneLegend.replaceChildren(summary,list);this._sceneLegend.hidden=labels.length===0;
  }

  isVectorInNullSpace(x, y) {
    if (Math.hypot(x, y) < 1e-6) return true;
    const { a, b, c, d } = this.matrix;
    const imgX = a * x + b * y;
    const imgY = c * x + d * y;
    return Math.hypot(imgX, imgY) < 1e-4;
  }

  drawArrow(from, to, color, width = 2.0, dash = []) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    if (dash.length > 0) ctx.setLineDash(dash);

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.setLineDash([]);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const arrowLen = 10;
    const arrowAngle = Math.PI / 6;

    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - arrowLen * Math.cos(angle - arrowAngle), to.y - arrowLen * Math.sin(angle - arrowAngle));
    ctx.lineTo(to.x - arrowLen * Math.cos(angle + arrowAngle), to.y - arrowLen * Math.sin(angle + arrowAngle));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  drawHorizonAndAxes() {
    const ctx = this.ctx;
    const ox = this.originX;
    const oy = this.originY;

    ctx.save();
    // 地平线电光青发光辉光带
    const glowLen = this.width * 0.76;
    const grad = ctx.createLinearGradient(ox - 60, oy, ox + glowLen, oy);
    grad.addColorStop(0, 'rgba(6, 182, 212, 0.15)');
    grad.addColorStop(0.3, 'rgba(6, 182, 212, 0.75)');
    grad.addColorStop(0.8, 'rgba(34, 211, 238, 0.35)');
    grad.addColorStop(1, 'rgba(6, 182, 212, 0)');

    ctx.beginPath();
    ctx.moveTo(ox - 60, oy + 3);
    ctx.lineTo(ox + glowLen, oy + 3);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3.2;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 10;
    ctx.stroke();

    // 黑色墨线 X 轴
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(ox - 60, oy);
    ctx.lineTo(ox + glowLen, oy);
    ctx.strokeStyle = '#050912';
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // 黑色墨线 Y 轴
    const axisYTop = this.height * 0.08;
    ctx.beginPath();
    ctx.moveTo(ox, oy + 50);
    ctx.lineTo(ox, axisYTop);
    ctx.strokeStyle = '#050912';
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 工业级颜色透明度防护 (Color Alpha Guard)
   * 严禁任何完全不透明纯色填充 (如 red, #ff0000) 遮盖底图网格与坐标系
   * 强制将填充色 Alpha 钳位至 safeMaxAlpha (默认 <= 0.22)
   */
  static sanitizeAlphaColor(inputColor, defaultRgba = 'rgba(56, 189, 248, 0.22)', maxAlpha = 0.22) {
    if (!inputColor || typeof inputColor !== 'string') return defaultRgba;
    const col = inputColor.trim();
    if (col.startsWith('#')) {
      let hex = col.slice(1);
      if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('');
      }
      if (hex.length >= 6) {
        const r = parseInt(hex.substring(0, 2), 16) || 0;
        const g = parseInt(hex.substring(2, 4), 16) || 0;
        const b = parseInt(hex.substring(4, 6), 16) || 0;
        return `rgba(${r}, ${g}, ${b}, ${maxAlpha})`;
      }
    }
    const rgbMatch = col.match(/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d\.]+))?\s*\)$/i);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1], 10);
      const g = parseInt(rgbMatch[2], 10);
      const b = parseInt(rgbMatch[3], 10);
      const rawA = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1.0;
      const safeA = Math.min(rawA, maxAlpha);
      return `rgba(${r}, ${g}, ${b}, ${safeA})`;
    }
    const namedColors = {
      red: [239, 68, 68],
      crimson: [220, 38, 38],
      blue: [59, 130, 246],
      sky: [56, 189, 248],
      cyan: [6, 182, 212],
      green: [34, 197, 94],
      emerald: [16, 185, 129],
      yellow: [234, 179, 8],
      amber: [245, 158, 11],
      orange: [249, 115, 22],
      purple: [168, 85, 247],
      violet: [139, 92, 246],
      pink: [236, 72, 153],
      rose: [244, 63, 94],
      white: [255, 255, 255],
      black: [15, 23, 42],
      gray: [100, 116, 139]
    };
    const lower = col.toLowerCase();
    if (namedColors[lower]) {
      const [r, g, b] = namedColors[lower];
      return `rgba(${r}, ${g}, ${b}, ${maxAlpha})`;
    }
    return defaultRgba;
  }

  /**
   * 工业级数学跨度数值钳位 (Spatial Clamping)
   * 若输入值 > 15，自动按大模型误传屏幕像素进行 /50 比例换算
   * 确保几何图元在数学平面跨度严守 [min, max] (默认 0.5 到 5.5)
   */
  static clampDimension(val, defaultVal = 3.0, min = 0.5, max = 5.5) {
    let num = Number(val ?? defaultVal);
    if (isNaN(num) || num <= 0) return defaultVal;
    if (num > 15) {
      num = num / 50.0;
    }
    return Math.max(min, Math.min(max, num));
  }

  static clampCoord(val, defaultVal = 0, min = -6.0, max = 6.0) {
    let num = Number(val ?? defaultVal);
    if (isNaN(num)) return defaultVal;
    if (Math.abs(num) > 15) {
      num = num / 50.0;
    }
    return Math.max(min, Math.min(max, num));
  }

  static validateCurveDomain(domain) {
    if (!Array.isArray(domain) || domain.length !== 2 || domain.some(x => typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1e6) || domain[0] >= domain[1]) {
      const error = new RangeError('函数定义域必须是有限数值 [minX, maxX]，minX < maxX 且绝对值不超过 1000000');
      error.code = 'INVALID_CURVE_DOMAIN';
      throw error;
    }
    return domain;
  }

  _getCurveEvaluator(expression) {
    if (!this._curveEvaluators) this._curveEvaluators = new Map();
    if (this._curveEvaluators.has(expression)) return this._curveEvaluators.get(expression);
    let Renderer = typeof window !== 'undefined' ? window.GeometryArtifactRenderer : null;
    if (!Renderer && typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      Renderer = require('./artifacts/GeometryArtifactRenderer.js').GeometryArtifactRenderer;
    }
    if (!Renderer || typeof Renderer.compileExpression !== 'function') {
      const error = new Error('安全数学表达式解析器尚未加载');
      error.code = 'SAFE_EXPRESSION_PARSER_UNAVAILABLE';
      throw error;
    }
    let evaluate;
    try { evaluate = Renderer.compileExpression(expression); }
    catch (error) { error.code = 'INVALID_CURVE_EXPRESSION'; throw error; }
    if (this._curveEvaluators.size >= 64) this._curveEvaluators.clear();
    this._curveEvaluators.set(expression, evaluate);
    return evaluate;
  }

  /**
   * 8. 设置/注入 Agent 动态派发的自定义物理矢量图元 (对标 ZCode / DeepSeek Harness 工作区交互)
   */
  setCustomGraphics(shapes, options = {}) {
    this.assertRunActive(options);
    const list = Array.isArray(shapes) ? shapes : [shapes];
    const shouldClear = options.clear !== false;

    const normalized = [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const type = (raw.type || 'diamond').toLowerCase();

      if (type === 'diamond') {
        const cx = Workspace2DVisualizer.clampCoord(raw.centerX ?? 0);
        const cy = Workspace2DVisualizer.clampCoord(raw.centerY ?? 0);
        const w = Workspace2DVisualizer.clampDimension(raw.width ?? 3.0, 3.0, 0.5, 5.5);
        const h = Workspace2DVisualizer.clampDimension(raw.height ?? 3.0, 3.0, 0.5, 5.5);
        const safeFill = Workspace2DVisualizer.sanitizeAlphaColor(raw.fillColor, 'rgba(56, 189, 248, 0.22)', 0.22);
        const safeStroke = raw.strokeColor || (raw.fillColor && String(raw.fillColor).includes('red') ? '#ef4444' : '#38bdf8');
        normalized.push({
          type: 'diamond',
          centerX: cx,
          centerY: cy,
          width: w,
          height: h,
          vertices: [
            [cx, cy + h / 2],
            [cx + w / 2, cy],
            [cx, cy - h / 2],
            [cx - w / 2, cy]
          ],
          fillColor: safeFill,
          strokeColor: safeStroke,
          glowColor: raw.glowColor || safeStroke,
          lineWidth: raw.lineWidth || 2.5,
          label: raw.label || '菱形 (Rhombus)'
        });
      } else if (type === 'vector' || type === 'arrow') {
        const rawVerts = Array.isArray(raw.vertices) ? raw.vertices : [raw.from || [0, 0], raw.to || [raw.x || 0, raw.y || 0]];
        const v0 = [
          Workspace2DVisualizer.clampCoord(rawVerts[0]?.[0] ?? 0, 0, -8.0, 8.0),
          Workspace2DVisualizer.clampCoord(rawVerts[0]?.[1] ?? 0, 0, -8.0, 8.0)
        ];
        const v1 = [
          Workspace2DVisualizer.clampCoord(rawVerts[1]?.[0] ?? (raw.x || 0), 0, -8.0, 8.0),
          Workspace2DVisualizer.clampCoord(rawVerts[1]?.[1] ?? (raw.y || 0), 0, -8.0, 8.0)
        ];
        const safeStroke = raw.strokeColor || '#0ea5e9';
        normalized.push({
          type: 'vector',
          vertices: [v0, v1],
          from: v0,
          to: v1,
          strokeColor: safeStroke,
          glowColor: raw.glowColor || safeStroke,
          lineWidth: raw.lineWidth || 3.0,
          label: raw.label || '向量 (Vector)'
        });
      } else if (type === 'polygon') {
        const rawVerts = Array.isArray(raw.vertices) ? raw.vertices : [];
        if (rawVerts.length === 2) {
          // 容错：将 2 点退化多边形自动升级为高清晰矢量箭头
          const v0 = [
            Workspace2DVisualizer.clampCoord(rawVerts[0][0], 0, -8.0, 8.0),
            Workspace2DVisualizer.clampCoord(rawVerts[0][1], 0, -8.0, 8.0)
          ];
          const v1 = [
            Workspace2DVisualizer.clampCoord(rawVerts[1][0], 0, -8.0, 8.0),
            Workspace2DVisualizer.clampCoord(rawVerts[1][1], 0, -8.0, 8.0)
          ];
          const safeStroke = raw.strokeColor || '#0ea5e9';
          normalized.push({
            type: 'vector',
            vertices: [v0, v1],
            from: v0,
            to: v1,
            strokeColor: safeStroke,
            glowColor: raw.glowColor || safeStroke,
            lineWidth: raw.lineWidth || 3.0,
            label: raw.label || '向量 (Vector)'
          });
          continue;
        }
        if (rawVerts.length < 3) {
          throw new Error('多边形至少需要 3 个有效顶点坐标');
        }
        const vertices = rawVerts.map(pt => [
          Workspace2DVisualizer.clampCoord(pt[0], 0, -6.0, 6.0),
          Workspace2DVisualizer.clampCoord(pt[1], 0, -6.0, 6.0)
        ]);
        const safeFill = Workspace2DVisualizer.sanitizeAlphaColor(raw.fillColor, 'rgba(129, 140, 248, 0.22)', 0.22);
        const safeStroke = raw.strokeColor || '#818cf8';
        normalized.push({
          type: 'polygon',
          vertices,
          fillColor: safeFill,
          strokeColor: safeStroke,
          glowColor: raw.glowColor || safeStroke,
          lineWidth: raw.lineWidth || 2.5,
          label: raw.label || '多边形 (Polygon)'
        });
      } else if (type === 'circle') {
        const cx = Workspace2DVisualizer.clampCoord(raw.centerX ?? 0);
        const cy = Workspace2DVisualizer.clampCoord(raw.centerY ?? 0);
        const r = Workspace2DVisualizer.clampDimension(raw.radius ?? 1.5, 1.5, 0.3, 3.2);
        const safeFill = Workspace2DVisualizer.sanitizeAlphaColor(raw.fillColor, 'rgba(236, 72, 153, 0.22)', 0.22);
        const safeStroke = raw.strokeColor || '#ec4899';
        normalized.push({
          type: 'circle',
          centerX: cx,
          centerY: cy,
          radius: r,
          fillColor: safeFill,
          strokeColor: safeStroke,
          glowColor: raw.glowColor || safeStroke,
          lineWidth: raw.lineWidth || 2.5,
          label: raw.label || '圆形 (Circle)'
        });
      } else if (type === 'rectangle') {
        const cx = Workspace2DVisualizer.clampCoord(raw.centerX ?? 0);
        const cy = Workspace2DVisualizer.clampCoord(raw.centerY ?? 0);
        const w = Workspace2DVisualizer.clampDimension(raw.width ?? 3.0, 3.0, 0.5, 5.5);
        const h = Workspace2DVisualizer.clampDimension(raw.height ?? 2.0, 2.0, 0.5, 5.5);
        const safeFill = Workspace2DVisualizer.sanitizeAlphaColor(raw.fillColor, 'rgba(16, 185, 129, 0.22)', 0.22);
        const safeStroke = raw.strokeColor || '#10b981';
        normalized.push({
          type: 'rectangle',
          centerX: cx,
          centerY: cy,
          width: w,
          height: h,
          vertices: [
            [cx - w / 2, cy + h / 2],
            [cx + w / 2, cy + h / 2],
            [cx + w / 2, cy - h / 2],
            [cx - w / 2, cy - h / 2]
          ],
          fillColor: safeFill,
          strokeColor: safeStroke,
          glowColor: raw.glowColor || safeStroke,
          lineWidth: raw.lineWidth || 2.5,
          label: raw.label || '矩形 (Rectangle)'
        });
      } else if (type === 'image') {
        const cx = Workspace2DVisualizer.clampCoord(raw.centerX ?? 0);
        const cy = Workspace2DVisualizer.clampCoord(raw.centerY ?? 0);
        const w = Workspace2DVisualizer.clampDimension(raw.width ?? 4.0, 4.0, 1.0, 6.0);
        const h = Workspace2DVisualizer.clampDimension(raw.height ?? 4.0, 4.0, 1.0, 6.0);
        const url = raw.url || raw.src || raw.imageUrl || '';
        normalized.push({
          type: 'image',
          centerX: cx,
          centerY: cy,
          width: w,
          height: h,
          url,
          opacity: Number.isFinite(raw.opacity) ? Math.max(0.05, Math.min(1, raw.opacity)) : 1,
          label: raw.label || '视觉生成画幅',
          strokeColor: raw.strokeColor || '#38bdf8'
        });
      } else if (type === 'function_curve') {
        const expr = raw.expression ?? 'Math.sin(x)';
        const domain = Workspace2DVisualizer.validateCurveDomain(raw.domain === undefined ? [-4, 4] : raw.domain);
        this._getCurveEvaluator(expr);
        normalized.push({
          type: 'function_curve',
          expression: expr,
          domain: domain.slice(),
          strokeColor: raw.strokeColor || '#a855f7',
          glowColor: raw.glowColor || '#a855f7',
          lineWidth: raw.lineWidth || 2.5,
          label: raw.label || `函数 y = ${expr}`
        });
      }
    }

    this.assertRunActive(options);
    const scene = this.prepareScene(options.sceneId, { ...options, mode: shouldClear ? 'replace' : 'append' });
    const layer = options.layer || 'graphics';
    normalized.forEach(shape => { shape.sceneId = scene.sceneId; shape.layer = layer; });
    if (shouldClear) {
      this.customGraphics = this.customGraphics.filter(shape => shape.layer !== layer).concat(normalized);
      // 空间物理解耦：当用户或助教派发全新几何图元 (如矩形、菱形、多边形、圆、画幅) 时，
      // 若此前留有奇异降维矩阵或探针激光，自动恢复为标准笛卡尔欧几里得正交空间 (I)，
      // 彻底根除奇异矩阵粉红零空间激光与变形基向量把几何画板搅成一坨乱麻
      if (options.preserveMatrix !== true && (scene.replaced || options.preserveMatrix === false)) {
        this.matrix = { a: 1.0, b: 0.0, c: 0.0, d: 1.0 };
        this.showProbe = false;
      }
    } else {
      this.customGraphics.push(...normalized);
    }

    this.render();
    return {
      status: 'success',
      sceneId: this.sceneId,
      renderedCount: this.customGraphics.length,
      shapes: this.customGraphics
    };
  }

  clearCustomGraphics() {
    this.customGraphics = [];
    this.render();
    return { status: 'success', cleared: true };
  }

  /**
   * 9. 真实光栅化渲染 Agent 派发的自定义物理图元
   */
  drawCustomGraphics() {
    if (!this.ctx || !this.customGraphics || this.customGraphics.length === 0) return;
    const ctx = this.ctx;

    for (const shape of this.customGraphics) {
      // Validate replayed snapshots before saving drawing state or executing a curve.
      const curveEvaluator = shape.type === 'function_curve' ? this._getCurveEvaluator(shape.expression) : null;
      if (curveEvaluator) Workspace2DVisualizer.validateCurveDomain(shape.domain);
      ctx.save();
      ctx.shadowColor = shape.glowColor || shape.strokeColor;
      // 1. 支持高清晰发光矢量箭头 (vector / arrow / 2-point segment / B columns)
      if (shape.type === 'vector' || shape.type === 'arrow' || (shape.vertices && shape.vertices.length === 2)) {
        const v0 = shape.vertices ? shape.vertices[0] : (shape.from || [0, 0]);
        const v1 = shape.vertices ? shape.vertices[1] : (shape.to || [shape.x || 0, shape.y || 0]);
        const s0 = this.mathToScreen(v0[0], v0[1]);
        const s1 = this.mathToScreen(v1[0], v1[1]);
        const color = shape.strokeColor || '#0ea5e9';

        this.drawArrow(s0, s1, color, shape.lineWidth || 3.2);

        // 端点晶体光斑
        ctx.beginPath();
        ctx.arc(s1.x, s1.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();

        if (shape.label) {
          const isKer = this.isVectorInNullSpace ? this.isVectorInNullSpace(v1[0], v1[1]) : false;
          const labelText = isKer ? `${shape.label} · 落在 Null(A) 上 (A·v=0)` : shape.label;
          const badgeY = s1.y > s0.y ? s1.y + 18 : s1.y - 18;
          this.drawBadgePill(s1.x, badgeY, labelText, {
            strokeColor: color,
            dotColor: isKer ? '#ec4899' : color,
            textColor: '#ffffff'
          });
        }
        ctx.restore();
        continue;
      }

      if (shape.type === 'diamond' || shape.type === 'polygon' || shape.type === 'rectangle') {
        if (!shape.vertices || shape.vertices.length < 3) {
          ctx.restore();
          continue;
        }

        ctx.beginPath();
        const startScreen = this.mathToScreen(shape.vertices[0][0], shape.vertices[0][1]);
        ctx.moveTo(startScreen.x, startScreen.y);

        for (let i = 1; i < shape.vertices.length; i++) {
          const pt = this.mathToScreen(shape.vertices[i][0], shape.vertices[i][1]);
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.closePath();

        ctx.fillStyle = shape.fillColor;
        ctx.fill();

        ctx.strokeStyle = shape.strokeColor;
        ctx.lineWidth = shape.lineWidth || 2.5;
        ctx.stroke();

        ctx.shadowBlur = 0;
        for (let i = 0; i < shape.vertices.length; i++) {
          const [vx, vy] = shape.vertices[i];
          const sPt = this.mathToScreen(vx, vy);

          ctx.beginPath();
          ctx.arc(sPt.x, sPt.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = shape.strokeColor;
          ctx.fill();
          ctx.strokeStyle = '#0f172a';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          if (shape.showVertexCoordinates) {
            ctx.font = '600 11px "JetBrains Mono", Consolas, monospace';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            if(this.showCoordinateLabels===true) this.drawBadgePill(sPt.x,sPt.y,`(${vx.toFixed(1)}, ${vy.toFixed(1)})`,{strokeColor:shape.strokeColor});
          }
        }

        if (shape.label) {
          // 优化标签排版：避免居中与原点坐标轴死锁重叠，采用晶体徽章胶囊置顶呈现
          let topMathY = (shape.centerY ?? 0) + (shape.height ?? 3.0) / 2;
          if (shape.type === 'polygon' && shape.vertices && shape.vertices.length > 0) {
            topMathY = Math.max(...shape.vertices.map(v => v[1]));
          }
          const mathX = shape.centerX ?? (shape.vertices ? shape.vertices.reduce((s, v) => s + v[0], 0) / shape.vertices.length : 0);
          const sTop = this.mathToScreen(mathX, topMathY);
          this.drawBadgePill(sTop.x, sTop.y - 18, shape.label, {
            strokeColor: shape.strokeColor,
            dotColor: shape.strokeColor,
            textColor: '#ffffff',
            fontSize: 11
          });
        }
      } else if (shape.type === 'circle') {
        const centerScreen = this.mathToScreen(shape.centerX, shape.centerY);
        const radiusScreen = shape.radius * this.unitScale;

        ctx.beginPath();
        ctx.arc(centerScreen.x, centerScreen.y, radiusScreen, 0, Math.PI * 2);
        ctx.fillStyle = shape.fillColor;
        ctx.fill();

        ctx.strokeStyle = shape.strokeColor;
        ctx.lineWidth = shape.lineWidth || 2.5;
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(centerScreen.x, centerScreen.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = shape.strokeColor;
        ctx.fill();

        if (shape.label) {
          this.drawBadgePill(centerScreen.x, centerScreen.y - radiusScreen - 18, `${shape.label} (r=${shape.radius.toFixed(1)})`, {
            strokeColor: shape.strokeColor,
            dotColor: shape.strokeColor,
            textColor: '#ffffff',
            fontSize: 11
          });
        }
      } else if (shape.type === 'function_curve') {
        const [minX, maxX] = shape.domain;
        const steps = 120;
        const dx = (maxX - minX) / steps;

        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= steps; i++) {
          const x = minX + i * dx;
          const y = curveEvaluator(x);
          if (!Number.isFinite(y)) { started = false; continue; }

          const sPt = this.mathToScreen(x, y);
          if (!started) {
            ctx.moveTo(sPt.x, sPt.y);
            started = true;
          } else {
            ctx.lineTo(sPt.x, sPt.y);
          }
        }

        ctx.strokeStyle = shape.strokeColor;
        ctx.lineWidth = shape.lineWidth || 2.5;
        ctx.stroke();

        if (shape.label) {
          const midX = (minX + maxX) / 2;
          const midY = curveEvaluator(midX);
          if (Number.isFinite(midY)) {
            const sMid = this.mathToScreen(midX, midY);
            ctx.shadowBlur = 0;
            ctx.font = '600 12px "JetBrains Mono", Consolas, monospace';
            ctx.fillStyle = shape.strokeColor;
            this.drawBadgePill(sMid.x,sMid.y,shape.label,{strokeColor:shape.strokeColor});
          }
        }
      } else if (shape.type === 'image' && shape.url) {
        if (!this._imageCache) this._imageCache = new Map();
        let img = this._imageCache.get(shape.url);
        if (!img && typeof Image !== 'undefined') {
          img = new Image();
          img.crossOrigin = 'anonymous';
          img.src = shape.url;
          img.onload = () => { this.render(); };
          this._imageCache.set(shape.url, img);
        }
        const centerScreen = this.mathToScreen(shape.centerX ?? 0, shape.centerY ?? 0);
        const wPx = (shape.width ?? 4.0) * this.unitScale;
        const hPx = (shape.height ?? 4.0) * this.unitScale;
        const left = centerScreen.x - wPx / 2;
        const top = centerScreen.y - hPx / 2;

        ctx.save();
        ctx.globalAlpha = shape.opacity !== undefined ? Math.max(0.05, Math.min(1.0, shape.opacity)) : 1.0;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(left, top, wPx, hPx, 10);
        } else {
          ctx.rect(left, top, wPx, hPx);
        }
        ctx.strokeStyle = shape.strokeColor || '#38bdf8';
        ctx.lineWidth = 2.0;
        ctx.stroke();

        ctx.clip();
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, left, top, wPx, hPx);
        } else {
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.fill();
        }
        ctx.restore();

        if (shape.label) {
          ctx.font = '700 12px Inter, sans-serif';
          ctx.fillStyle = shape.strokeColor || '#38bdf8';
          ctx.textAlign = 'center';
          this.drawBadgePill(centerScreen.x,top,shape.label,{strokeColor:shape.strokeColor});
          ctx.textAlign = 'start';
        }
      }

      ctx.restore();
    }
  }
}

if (typeof window !== 'undefined') {
  window.Workspace2DVisualizer = Workspace2DVisualizer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Workspace2DVisualizer };
}
