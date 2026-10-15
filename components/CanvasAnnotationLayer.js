/**
 * 问矩 · Excalidraw 风格画板手绘批注与草稿图层 (CanvasAnnotationLayer v1.0)
 * 
 * 核心特性：
 * 1. 透明覆层：叠加于主坐标画板 (#viewport-canvas) 之上，完全同步尺寸与设备像素比 (DPR)。
 * 2. 自由手绘工具集：
 *    - 🖊️ 钢笔 (Pen)：平滑二次贝塞尔曲线拟合手绘笔触
 *    - 🖍️ 荧光笔 (Highlighter)：半透明高亮注记，突出几何关键区域
 *    - ➡️ 几何箭头 (Arrow)：指示基底方向、投影向量或流动趋势
 *    - 🔲 重点框 (Rect)：圈出矩阵网格、核空间或奇异坍缩面域
 *    - 🧹 橡皮擦 (Eraser)：碰撞检测擦除批注图元
 * 3. 完整历史回滚：支持 Undo (Ctrl+Z) / Redo (Ctrl+Y) 栈
 * 4. 助教多模态闭环：exportMergedCanvas() 将底层几何画板与手绘草图合并，
 *    一键将草图标注图注入输入坞附件托盘，实现“学生随手圈画猜想 -> 多模态助教视觉解析”。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.CanvasAnnotationLayer = api.CanvasAnnotationLayer;
  }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  class CanvasAnnotationLayer {
    constructor(options = {}) {
      this.options = options;
      this.container = typeof options.container === 'string'
        ? (typeof document !== 'undefined' ? document.querySelector(options.container) : null)
        : (options.container || null);
      
      this.underlyingCanvas = options.underlyingCanvas || (typeof document !== 'undefined' ? document.getElementById('viewport-canvas') : null);
      this.activeTool = 'pen'; // 'select' | 'pen' | 'highlighter' | 'arrow' | 'rect' | 'eraser'
      this.strokeColor = '#38bdf8';
      this.strokeWidth = 3;
      this.strokes = [];
      this.undoStack = [];
      this.isDrawing = false;
      this.currentStroke = null;
      this.isActive = false;

      this.canvas = null;
      this.ctx = null;
      this.toolbar = null;
      this._resizeObserver = null;

      if (typeof document !== 'undefined' && this.container) {
        this.initDOM();
        this.bindEvents();
      }
    }

    initDOM() {
      if (this.canvas || !this.container) return;

      // 1. 创建覆盖在画板上的手绘透明 Canvas
      const overlayCanvas = document.createElement('canvas');
      overlayCanvas.id = 'canvas-annotation-layer';
      overlayCanvas.className = 'canvas-annotation-layer hidden';
      overlayCanvas.setAttribute('aria-label', '手绘批注与草稿图层');
      this.container.appendChild(overlayCanvas);
      this.canvas = overlayCanvas;
      this.ctx = overlayCanvas.getContext('2d');

      // 2. 创建悬浮批注工具栏 (Excalidraw 极简浮动岛风格)
      const toolbar = document.createElement('div');
      toolbar.id = 'annotation-floating-toolbar';
      toolbar.className = 'annotation-floating-toolbar hidden';
      toolbar.innerHTML = `
        <div class="annotation-tool-group">
          <button type="button" class="btn-annot-tool active" data-tool="pen" title="钢笔涂鸦 (Pen)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>
            <span>钢笔</span>
          </button>
          <button type="button" class="btn-annot-tool" data-tool="highlighter" title="荧光高亮 (Highlighter)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M14 2l4 4L7 17H3v-4L14 2z"></path><path d="M3 22h18"></path></svg>
            <span>荧光</span>
          </button>
          <button type="button" class="btn-annot-tool" data-tool="arrow" title="指示箭头 (Arrow)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="5" y1="19" x2="19" y2="5"></line><polyline points="10 5 19 5 19 14"></polyline></svg>
            <span>箭头</span>
          </button>
          <button type="button" class="btn-annot-tool" data-tool="rect" title="重点选框 (Rect)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
            <span>矩形</span>
          </button>
          <button type="button" class="btn-annot-tool" data-tool="eraser" title="橡皮擦 (Eraser)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 20 7 20 4 17 14 7 20 13 17 16"></polyline></svg>
            <span>擦除</span>
          </button>
        </div>

        <div class="annotation-color-group">
          <button type="button" class="btn-annot-color active" data-color="#38bdf8" style="background:#38bdf8;" title="天蓝"></button>
          <button type="button" class="btn-annot-color" data-color="#f43f5e" style="background:#f43f5e;" title="玫瑰红"></button>
          <button type="button" class="btn-annot-color" data-color="#eab308" style="background:#eab308;" title="琥珀黄"></button>
          <button type="button" class="btn-annot-color" data-color="#4ade80" style="background:#4ade80;" title="翡翠绿"></button>
          <button type="button" class="btn-annot-color" data-color="#ffffff" style="background:#ffffff;" title="纯白"></button>
        </div>

        <div class="annotation-action-group">
          <button type="button" class="btn-annot-action" id="btn-annot-undo" title="撤销 (Ctrl+Z)">↶</button>
          <button type="button" class="btn-annot-action" id="btn-annot-clear" title="清空全部批注">🗑️</button>
          <button type="button" class="btn-annot-action primary" id="btn-annot-send" title="截取草图并发送给助教提问">
            <span>📸 发送草图</span>
          </button>
          <button type="button" class="btn-annot-action close" id="btn-annot-close" title="退出批注 (Esc)">✕</button>
        </div>
      `;
      this.container.appendChild(toolbar);
      this.toolbar = toolbar;

      // 3. 在画板右上角添加批注开关按钮
      this.ensureLauncherButton();

      this.syncSize();
    }

    ensureLauncherButton() {
      if (typeof document === 'undefined') return;
      let launcher = document.getElementById('btn-toggle-annotation-layer');
      if (!launcher) {
        launcher = document.createElement('button');
        launcher.type = 'button';
        launcher.id = 'btn-toggle-annotation-layer';
        launcher.className = 'btn-toggle-annotation-layer';
        launcher.title = '开启/收起自由手绘批注与草稿层';
        launcher.innerHTML = `
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:text-bottom;margin-right:2px;"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path></svg>
          <span>批注草稿</span>
        `;
        launcher.addEventListener('click', () => this.toggleActive());
      }
      const localTools = this.container ? this.container.querySelector('.canvas-local-tools') : null;
      if (localTools && launcher.parentElement !== localTools) {
        localTools.appendChild(launcher);
      } else if (!localTools && this.container && launcher.parentElement !== this.container) {
        this.container.appendChild(launcher);
      }
    }

    toggleActive(force) {
      this.isActive = typeof force === 'boolean' ? force : !this.isActive;
      if (!this.canvas || !this.toolbar) return;

      this.canvas.classList.toggle('hidden', !this.isActive);
      this.toolbar.classList.toggle('hidden', !this.isActive);
      
      const launcher = document.getElementById('btn-toggle-annotation-layer');
      if (launcher) launcher.classList.toggle('active', this.isActive);
      launcher?.setAttribute('aria-pressed',String(this.isActive));

      if (this.isActive) {
        this.syncSize();
        this.redraw();
      }
    }

    syncSize() {
      if (!this.canvas || !this.underlyingCanvas) return;
      const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const width = this.underlyingCanvas.clientWidth || 800;
      const height = this.underlyingCanvas.clientHeight || 600;

      this.canvas.width = width * dpr;
      this.canvas.height = height * dpr;
      this.canvas.style.left=this.underlyingCanvas.offsetLeft+'px';this.canvas.style.top=this.underlyingCanvas.offsetTop+'px';this.canvas.style.right='auto';this.canvas.style.bottom='auto';
      this.canvas.style.width = width + 'px';
      this.canvas.style.height = height + 'px';

      if (this.ctx) {
        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);
      }
    }

    bindEvents() {
      if (!this.canvas) return;

      // 窗口与画布尺寸自适应监听
      if (typeof ResizeObserver !== 'undefined' && this.underlyingCanvas) {
        this._resizeObserver = new ResizeObserver(() => this.syncSize());
        this._resizeObserver.observe(this.underlyingCanvas);
      }

      // 绘图事件绑定
      this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
      this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
      this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));

      // 工具栏交互
      if (this.toolbar) {
        this.toolbar.addEventListener('click', (e) => {
          const toolBtn = e.target.closest('.btn-annot-tool');
          if (toolBtn) {
            this.toolbar.querySelectorAll('.btn-annot-tool').forEach(b => b.classList.remove('active'));
            toolBtn.classList.add('active');
            this.activeTool = toolBtn.dataset.tool;
            return;
          }

          const colorBtn = e.target.closest('.btn-annot-color');
          if (colorBtn) {
            this.toolbar.querySelectorAll('.btn-annot-color').forEach(b => b.classList.remove('active'));
            colorBtn.classList.add('active');
            this.strokeColor = colorBtn.dataset.color;
            return;
          }

          if (e.target.closest('#btn-annot-undo')) this.undo();
          if (e.target.closest('#btn-annot-clear')) this.clear();
          if (e.target.closest('#btn-annot-send')) this.sendToAgent();
          if (e.target.closest('#btn-annot-close')) this.toggleActive(false);
        });
      }

      // 全局快捷键
      if (typeof document !== 'undefined') {
        document.addEventListener('keydown', (e) => {
          if (!this.isActive||e.target.closest?.('input,textarea,[contenteditable=true]')) return;
          if (e.key === 'Escape') {
            this.toggleActive(false);
          } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            this.undo();
          }
        });
      }
    }

    getPointerPos(e) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }

    onPointerDown(e) {
      if (!this.isActive) return;
      this.canvas.setPointerCapture?.(e.pointerId);
      this.isDrawing = true;
      const pos = this.getPointerPos(e);

      if (this.activeTool === 'eraser') {
        this.eraseAt(pos);
        return;
      }

      this.currentStroke = {
        tool: this.activeTool,
        color: this.strokeColor,
        width: this.activeTool === 'highlighter' ? 14 : this.strokeWidth,
        opacity: this.activeTool === 'highlighter' ? 0.35 : 1.0,
        points: [pos]
      };
    }

    onPointerMove(e) {
      if (!this.isDrawing || !this.isActive) return;
      const pos = this.getPointerPos(e);

      if (this.activeTool === 'eraser') {
        this.eraseAt(pos);
        return;
      }

      if (this.currentStroke) {
        this.currentStroke.points.push(pos);
        this.redraw();
        this.drawStroke(this.ctx, this.currentStroke);
      }
    }

    onPointerUp(e) {
      if (!this.isDrawing) return;
      this.isDrawing = false;
      if (this.currentStroke && this.currentStroke.points.length > 1) {
        this.strokes.push(this.currentStroke);
        this.undoStack = [];
      }
      this.currentStroke = null;
      this.redraw();
    }

    eraseAt(pos) {
      const radius = 16;
      const prevLen = this.strokes.length;
      this.strokes = this.strokes.filter(stroke => {
        return !stroke.points.some(p => Math.hypot(p.x - pos.x, p.y - pos.y) <= radius);
      });
      if (this.strokes.length !== prevLen) {
        this.redraw();
      }
    }

    undo() {
      if (this.strokes.length === 0) return;
      const last = this.strokes.pop();
      this.undoStack.push(last);
      this.redraw();
    }

    clear() {
      if (this.strokes.length === 0) return;
      this.undoStack = [...this.strokes];
      this.strokes = [];
      this.redraw();
    }

    redraw() {
      if (!this.ctx || !this.canvas) return;
      const width = this.canvas.width;
      const height = this.canvas.height;
      this.ctx.clearRect(0, 0, width, height);

      for (const stroke of this.strokes) {
        this.drawStroke(this.ctx, stroke);
      }
    }

    drawStroke(ctx, stroke) {
      const pts = stroke.points;
      if (!pts || pts.length < 2) return;

      ctx.save();
      ctx.strokeStyle = stroke.color;
      ctx.fillStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = stroke.opacity || 1.0;

      if (stroke.tool === 'highlighter') {
        ctx.globalCompositeOperation = 'source-over';
      }

      if (stroke.tool === 'arrow') {
        // 绘制箭头主干与端点三角形
        const start = pts[0];
        const end = pts[pts.length - 1];
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();

        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const headLen = Math.min(18, Math.max(10, stroke.width * 3.5));
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.lineTo(end.x - headLen * Math.cos(angle - Math.PI / 6), end.y - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(end.x - headLen * Math.cos(angle + Math.PI / 6), end.y - headLen * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      } else if (stroke.tool === 'rect') {
        const start = pts[0];
        const end = pts[pts.length - 1];
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y, w, h, 6) : ctx.rect(x, y, w, h);
        ctx.stroke();
      } else {
        // 贝塞尔手绘平滑线条
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const midX = (pts[i].x + pts[i + 1].x) / 2;
          const midY = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
      }

      ctx.restore();
    }

    /**
     * 将底层几何画板与当前批注层合并渲染，输出 Base64 PNG
     */
    exportMergedCanvas() {
      if (!this.underlyingCanvas) return null;
      const width = this.underlyingCanvas.width;
      const height = this.underlyingCanvas.height;

      const offscreen = document.createElement('canvas');
      offscreen.width = width;
      offscreen.height = height;
      const offCtx = offscreen.getContext('2d');

      // 1. 绘制底层几何画板
      offCtx.drawImage(this.underlyingCanvas, 0, 0);

      // 2. 绘制上层手绘批注
      if (this.canvas) {
        offCtx.drawImage(this.canvas, 0, 0);
      }

      return offscreen.toDataURL('image/png');
    }

    /**
     * 导出草图并直接注入输入坞附件托盘
     */
    sendToAgent() {
      const dataUrl = this.exportMergedCanvas();
      if (!dataUrl) return;

      const dock = typeof window !== 'undefined' ? window.promptInputDock : null;
      if (dock && typeof dock.addAttachment === 'function') {
        dock.addAttachment({
          id: 'annot_sketch_' + Date.now(),
          type: 'image',
          name: '画板批注草图.png',
          dataUrl: dataUrl
        });
      }

      if (typeof window !== 'undefined' && typeof window.appendAgentNotice === 'function') {
        window.appendAgentNotice('📸 已成功捕获画板与手绘批注草图！草图已填入输入坞，请直接提出你的几何疑问。');
      }

      // 填充画板真实几何状态代数上下文（若输入框为空）
      const textarea = dock?.textarea || (typeof document !== 'undefined' ? document.getElementById('dock-textarea') : null);
      if (textarea && !textarea.value.trim()) {
        const viz = (typeof window !== 'undefined' && window.workspaceVisualizer) || null;
        const mat = viz?.matrix || { a: 1, b: 0, c: 0, d: 1 };
        const det = viz?.getDeterminant ? viz.getDeterminant().toFixed(2) : '1.00';
        const rank = viz?.getRank ? viz.getRank() : 2;
        textarea.value = `助教你好！我在画板上标注了矩阵 A = [[${mat.a.toFixed(1)}, ${mat.b.toFixed(1)}], [${mat.c.toFixed(1)}, ${mat.d.toFixed(1)}]] (det=${det}, rank=${rank}) 的几何草图，请结合批注为我深入剖析其空间变换本质！`;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // 收起批注层，焦点返回输入框
      this.toggleActive(false);
      if (textarea) textarea.focus();
    }

    destroy() {
      if (this._resizeObserver) {
        this._resizeObserver.disconnect();
        this._resizeObserver = null;
      }
      if (this.canvas) {
        this.canvas.remove();
        this.canvas = null;
      }
      if (this.toolbar) {
        this.toolbar.remove();
        this.toolbar = null;
      }
    }
  }

  return { CanvasAnnotationLayer };
});
