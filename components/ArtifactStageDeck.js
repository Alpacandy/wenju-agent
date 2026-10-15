/** Artifact workspace with one active renderer and immutable saved versions. */
class ArtifactStageDeck {
  constructor({ container, canvasViewport, visualizer = null } = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.canvasViewport = typeof canvasViewport === 'string' ? document.getElementById(canvasViewport) : canvasViewport;
    this.visualizer = visualizer;
    this.currentMode = 'canvas'; this.currentArtifact = null; this.view = 'preview';
    this._courseReturnMode = 'canvas';
    this.overlayOpacity = 0.65; this.showBasisInOverlay = true;
    this.artifacts = new Map(); this._interactionStates = {}; this._sequence = 0; this._dirty = false;
    this.initDOM();
    this.mountCanvasTools();
    this._hydrate();
    if (typeof window !== 'undefined') {
      window.artifactStageDeck = this;
      window.switchToArtifactStage = () => this.setMode('artifact');
      window.switchToManimStage = () => this.setMode('manim');
    }
  }
  getVisualizer() { return this.visualizer || (typeof window !== 'undefined' && window.workspaceVisualizer) || null; }
  mountCanvasTools() {
    if(!this.canvasViewport || typeof document.getElementById!=='function')return;
    let tools=this.canvasViewport.querySelector('.canvas-local-tools');
    if(!tools){tools=document.createElement('div');tools.className='canvas-local-tools';tools.setAttribute('aria-label','坐标画板工具');this.canvasViewport.appendChild(tools);}
    for(const id of ['btn-undo-state','btn-redo-state','btn-reset-workspace','btn-toggle-space-dimension','btn-toggle-toolbox']){const button=document.getElementById(id);if(button&&button.parentElement!==tools)tools.appendChild(button);}
    let fit=tools.querySelector('#btn-fit-canvas');if(!fit){fit=document.createElement('button');fit.type='button';fit.id='btn-fit-canvas';fit.className='btn-deck-action';fit.textContent='适应内容';fit.title='缩放并居中显示二维图元';fit.onclick=()=>this.getVisualizer()?.fitToContent();tools.appendChild(fit);}
    let dual=tools.querySelector('#btn-open-dual-view');if(!dual){dual=document.createElement('button');dual.type='button';dual.id='btn-open-dual-view';dual.className='btn-deck-action';tools.appendChild(dual);}dual.textContent='分析当前矩阵';dual.title='以当前维度和参数打开数学实验';dual.onclick=()=>this.openModernDualView();
    this.canvasViewport.querySelector('#canvas-storyboard-stepper')?.remove();
    const launcher=this.canvasViewport.querySelector('#btn-toggle-annotation-layer');if(launcher)tools.appendChild(launcher);
    this.getVisualizer()?.annotationLayer?.ensureLauncherButton();
    const dimension=document.getElementById('btn-toggle-space-dimension');if(dimension&&!dimension._dimDeckBound){dimension._dimDeckBound=true;dimension.addEventListener('click',()=>queueMicrotask(()=>{fit.disabled=this.getVisualizer()?.dimensionMode==='3D';}));}
    if(typeof ResizeObserver!=='undefined'){this._canvasObserver?.disconnect();this._canvasObserver=new ResizeObserver(()=>{this.getVisualizer()?.resize();this.getVisualizer()?.annotationLayer?.syncSize();});const canvas=this.canvasViewport.querySelector('#viewport-canvas');if(canvas)this._canvasObserver.observe(canvas);}
  }
  getStore() { return (typeof window !== 'undefined' && window.artifactStore) || null; }
  $(id) { return this.container && this.container.querySelector('#' + id); }
  _text(id, text) { const el = this.$(id); if (el) el.textContent = text; }
  _show(id, visible) { const el = this.$(id); if (el) el.classList.toggle('hidden', !visible); }
  _on(id, event, fn) { const el = this.$(id); if (el) el.addEventListener(event, fn); }
  static escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  initDOM() {
    if (!this.container) return;
    this.container.classList.add('artifact-workspace');
    this.canvasViewport = this.canvasViewport || this.container.querySelector('.canvas-viewport');
    this.deckHeader = document.createElement('div');
    this.deckHeader.className = 'artifact-stage-control-deck';
    this.deckHeader.innerHTML = `
      <div class="deck-tabs-group" role="tablist" aria-label="工作区视图">
        <button type="button" class="deck-tab active" data-mode="canvas" role="tab" aria-selected="true">坐标画板</button>
        <button type="button" class="deck-tab" data-mode="artifact" id="btn-tab-artifact" role="tab" aria-selected="false">Artifacts <span class="deck-tab-badge hidden" id="deck-artifact-badge">0</span></button>
        <button type="button" class="deck-tab" data-mode="courses" id="btn-course-shelf" role="tab" aria-selected="false" aria-controls="stage-course-viewport">课程实验</button>
        <button type="button" class="deck-tab" data-mode="manim" id="btn-tab-manim" role="tab" aria-selected="false">视频微课 <span class="deck-tab-badge" id="deck-manim-badge">5</span></button>
      </div>
      <div class="artifact-command-bar hidden" id="artifact-command-bar">
        <div class="artifact-view-tabs" role="tablist" aria-label="工件视图"><button type="button" id="artifact-tab-preview" class="active" role="tab" aria-selected="true">预览</button><button type="button" id="artifact-tab-source" role="tab" aria-selected="false">源码</button></div>
        <div id="artifact-version-bar" class="artifact-version-controls"><select id="artifact-version-select" class="artifact-select" aria-label="版本历史"></select><button type="button" class="btn-deck-action hidden" id="artifact-restore-version">恢复</button></div>
        <button type="button" class="btn-deck-action" id="btn-stage-download" title="导出当前实验，包含已捕获的交互输入">导出</button>
      </div>
      <div class="deck-actions-group"><button type="button" class="btn-deck-action" id="artifact-new-experiment" aria-expanded="false" aria-controls="artifact-example-menu">新建实验</button>
        <button type="button" class="btn-deck-action" id="btn-stage-restore-canvas" title="清空附加图元并重置矩阵">重置画板</button>
        <button type="button" class="btn-deck-action deck-expand" id="btn-stage-expand" title="展开工作区" aria-label="展开工作区" aria-pressed="false">↗</button>
      </div>`;
    this.container.insertBefore(this.deckHeader, this.container.firstChild);
    this.artifactViewport = document.createElement('div');
    this.artifactViewport.id = 'stage-artifact-viewport';
    this.artifactViewport.className = 'stage-artifact-viewport hidden';
    this.artifactViewport.innerHTML = `
      <div class="artifact-empty-placeholder" id="artifact-empty-state"><div class="artifact-empty-mark" aria-hidden="true">◇</div><h2>把想法放到画布上</h2><p>在对话中创建数学图形、交互演示或网页。<br>在这里预览、修改源码，并保留每次修订。</p><button type="button" class="btn-deck-action artifact-demo-button" id="artifact-open-demo">打开线性变换示例 ↗</button><div id="artifact-saved-picker" class="artifact-saved-picker hidden"><select id="artifact-saved-select" class="artifact-select" aria-label="已保存的工件"></select><button type="button" class="btn-deck-action" id="artifact-open-saved">打开已保存工件</button></div></div>
      <section class="artifact-display-container hidden" id="artifact-display-card" aria-label="Artifact 编辑器">
        <header class="artifact-display-header"><div class="artifact-heading" id="artifact-heading"><span class="artifact-type-chip hidden" id="stage-artifact-chip">ARTIFACT</span><h2 id="stage-artifact-title" class="artifact-title-text"></h2></div><select id="artifact-document-select" class="artifact-select" aria-label="切换工件"></select><button type="button" class="btn-deck-action hidden" id="artifact-ask-agent" title="引用当前画面的实时参数到输入框">问助教</button><select id="artifact-preview-scale" class="artifact-select hidden" aria-label="预览缩放" title="适应可视区域，或按原尺寸滚动查看"><option value="fit">适应</option><option value="1">100%</option><option value="0.85">85%</option><option value="0.7">70%</option><option value="0.55">55%</option></select></header>
        <div id="artifact-preview-panel" class="artifact-preview-panel" role="tabpanel" aria-labelledby="artifact-tab-preview">
          <div id="stage-artifact-img-frame" class="artifact-img-frame hidden"><img id="stage-artifact-img" alt="工件图像" class="stage-img-preview"></div>
          <div id="stage-artifact-proof-frame" class="artifact-proof-frame hidden"></div>
          <div id="stage-artifact-vector-frame" class="artifact-vector-frame hidden"></div>
          <div id="stage-artifact-sandbox" class="artifact-sandbox-frame hidden"></div>
        </div>
        <div id="artifact-source-panel" class="artifact-source-panel hidden" role="tabpanel" aria-labelledby="artifact-tab-source">
          <div class="artifact-editor-toolbar"><span id="artifact-source-language">源码</span><div><button type="button" class="btn-deck-action" id="artifact-copy-source">复制</button><button type="button" class="btn-deck-action" id="artifact-discard-edit">撤销修改</button><button type="button" class="btn-deck-action primary" id="artifact-apply-edit">保存并预览</button></div></div>
          <textarea id="artifact-source-editor" aria-label="工件源码" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
        </div>
        <footer class="artifact-display-footer"><span id="artifact-status" role="status" aria-live="polite">就绪</span><button type="button" class="btn-deck-action hidden" id="btn-sync-to-canvas" title="将当前双视图矩阵同步并返回自由画板">📐 同步并返回画板 ↗</button><button type="button" class="btn-deck-action" id="btn-stage-switch-overlay">在坐标系中查看 ↗</button></footer>
      </section>`;
    this.container.appendChild(this.artifactViewport);
    const gallery=document.createElement('div');gallery.className='artifact-example-grid';
    for(const [kind,label,detail] of [['composition','复合变换','比较 AB 与 BA'],['cube','正方体','旋转与棱面结构'],['sphere','球体','旋转与球面网格']]){
      const button=document.createElement('button');button.type='button';button.className='artifact-example';button.setAttribute('data-example',kind);
      const name=document.createElement('strong');name.textContent=label;const hint=document.createElement('span');hint.textContent=detail;button.appendChild(name);button.appendChild(hint);button.onclick=()=>this.openExample(kind);gallery.appendChild(button);
    }
    this.$('artifact-empty-state')?.appendChild(gallery);
    const menu=document.createElement('div');menu.id='artifact-example-menu';menu.className='artifact-example-menu hidden';menu.setAttribute('aria-label','新建数学实验');
    const catalog = (typeof window !== "undefined" ? window.MathSceneCatalog : (typeof global !== "undefined" ? global.MathSceneCatalog : null)); for(const item of catalog?.examples||[]){const button=document.createElement('button');button.type='button';button.dataset.sceneExample=item.id;const title=document.createElement('strong'),detail=document.createElement('span');title.textContent=item.title;detail.textContent=item.detail;button.append(title,detail);button.onclick=()=>{this.openExample(item.id);this.toggleExamples(false);};menu.appendChild(button);}
    this.container.appendChild(menu);
    this.manimViewport = document.createElement('div');
    this.manimViewport.id = 'stage-manim-viewport';
    this.manimViewport.className = 'stage-manim-viewport hidden';
    this.container.appendChild(this.manimViewport);
    this.overlayControls = document.createElement('div');
    this.overlayControls.id = 'deck-overlay-controls'; this.overlayControls.className = 'deck-overlay-controls hidden';
    this.overlayControls.innerHTML = `<span>叠图</span><button type="button" class="btn-deck-action" id="btn-toggle-stage-basis">隐藏基底</button><label>透明度 <input aria-label="叠图透明度" type="range" min="10" max="100" value="65" id="stage-opacity-slider"></label><span id="stage-opacity-val">65%</span><button type="button" class="btn-deck-action" id="btn-overlay-back">返回工件</button>`;
    this.container.appendChild(this.overlayControls);
    this.bindEvents();
    this._ensureManimDeck();
    if (typeof window !== 'undefined' && window.CoursePanel && window.CourseLibrary) {
      window.courseProgress ||= new window.CourseProgress({tracker:window.cognitiveTracker});
      this.coursePanel = new window.CoursePanel({deck:this,library:window.CourseLibrary,progress:window.courseProgress});
      window.coursePanel = this.coursePanel;
    }
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => {
        if (this.currentMode === 'artifact' && this.view === 'preview' && this.currentArtifact?.type === 'geometry') this._renderGeometry();
      });
      this._resizeObserver.observe(this.$('stage-artifact-vector-frame'));
    }
  }
  _ensureManimDeck() {
    if (this.manimDeck) return this.manimDeck;
    if (!this.manimViewport) return null;
    let ManimClass = (typeof window !== 'undefined' && window.ManimLessonDeck) ||
      (typeof global !== 'undefined' && global.ManimLessonDeck) || null;
    if (!ManimClass && typeof require === 'function') {
      try { ManimClass = require('../js/manim/ManimLessonDeck.js').ManimLessonDeck; } catch (e) { if (typeof recordIssue === 'function') recordIssue('ArtifactStageDeck', 'resolveManimModule', e); }
      if (!ManimClass) { try { ManimClass = require('./js/manim/ManimLessonDeck.js').ManimLessonDeck; } catch (e) { if (typeof recordIssue === 'function') recordIssue('ArtifactStageDeck', 'resolveManimModule', e); } }
      if (!ManimClass) { try { ManimClass = require('./ManimLessonDeck.js').ManimLessonDeck; } catch (e) { if (typeof recordIssue === 'function') recordIssue('ArtifactStageDeck', 'resolveManimModule', e); } }
    }
    if (ManimClass) {
      this.manimDeck = new ManimClass({
        container: this.manimViewport,
        onJumpToCanvas: (payload) => this.jumpFromManimToCanvas(payload)
      });
      return this.manimDeck;
    }
    return null;
  }
  jumpFromManimToCanvas(payload) {
    this.setMode('canvas');
    const viz = this.getVisualizer();
    if (viz && payload?.matrix) {
      if (typeof viz.animateTo === 'function') {
        viz.animateTo(payload.matrix, 650);
      } else {
        viz.matrix = { ...payload.matrix };
        if (typeof viz.render === 'function') viz.render();
      }
    }
  }
  bindEvents() {
    this.deckHeader.querySelectorAll('.deck-tab').forEach(tab => tab.addEventListener('click', () => this.setMode(tab.getAttribute('data-mode'))));
    this._on('btn-stage-restore-canvas', 'click', () => this.restoreCanvas());
    this._on('btn-stage-expand', 'click', () => this.setExpanded(!this.expanded));
    this._on('btn-sync-to-canvas', 'click', () => this.syncToCanvas());
    this._on('btn-stage-switch-overlay', 'click', () => this.setMode('overlay'));
    this._on('btn-overlay-back', 'click', () => this.setMode('artifact'));
    this._on('artifact-new-experiment','click',()=>this.toggleExamples());
    this._on('artifact-ask-agent','click',()=>this.askAboutScene());
    this._on('btn-stage-download', 'click', () => this.downloadCurrentArtifact());
    this._on('artifact-open-demo', 'click', () => {
      this.openExample('linear-map');
    });
    this._on('artifact-open-saved', 'click', () => {
      const saved = this.artifacts.get(this.$('artifact-saved-select').value);
      if (saved) this.loadArtifact(saved, { persist: false });
    });
    this._on('artifact-tab-preview', 'click', () => this.setView('preview'));
    this._on('artifact-tab-source', 'click', () => this.setView('source'));
    this._on('artifact-preview-scale', 'change', e => { this._previewScale = e.target.value === 'fit' ? 'fit' : Number(e.target.value); if (this._sandboxRt) this._sandboxRt.setPreviewScale(this._previewScale); });
    this._on('artifact-apply-edit', 'click', () => this.applySource());
    this._on('artifact-discard-edit', 'click', () => { this._resetEditor(); this._status('已撤销未保存修改'); });
    this._on('artifact-copy-source', 'click', () => this.copySource());
    const sourceExport=document.createElement('button');sourceExport.type='button';sourceExport.className='btn-deck-action';sourceExport.id='artifact-export-source';sourceExport.textContent='导出源码版本';
    sourceExport.onclick=()=>this.downloadCurrentArtifact({sourceOnly:true});
    this.$('artifact-copy-source')?.parentElement?.appendChild(sourceExport);
    this._on('artifact-source-editor', 'input', () => { this._dirty = this.$('artifact-source-editor').value !== this._source(this.currentArtifact); this._status(this._dirty ? '未保存的修改' : '与当前版本一致'); });
    this._on('artifact-version-select', 'change', e => this.selectVersion(e.target.value));
    this._on('artifact-restore-version', 'click', () => this.restoreVersion());
    this._on('artifact-document-select', 'change', e => {
      if (!this._guardDraft()) { e.target.value = this.currentArtifact.artifactId; return; }
      const item = this.artifacts.get(e.target.value); if (item) this.loadArtifact(item, { persist: false });
    });
    this._on('stage-opacity-slider', 'input', e => this.setOverlayOpacity(Number(e.target.value) / 100));
    this._on('btn-toggle-stage-basis', 'click', () => {
      this.showBasisInOverlay = !this.showBasisInOverlay;
      this._text('btn-toggle-stage-basis', this.showBasisInOverlay ? '隐藏基底' : '显示基底');
      const viz = this.getVisualizer(); if (viz) { viz.showBasisVectors = this.showBasisInOverlay; viz.render(); }
    });
    this._on('stage-artifact-vector-frame', 'click', e => {
      const item = e.target.closest('[data-shape-index]');
      if (!item || this.currentArtifact?.type !== 'geometry') return;
      const index = Number(item.getAttribute('data-shape-index'));
      this._selectedShape = this._selectedShape === index ? null : index; this._renderGeometry();
    });
    this._keyHandler = e => { if (e.key !== 'Escape') return; if(this._examplesOpen){this.toggleExamples(false);this.$('artifact-new-experiment')?.focus();return;} if (this.currentMode === 'courses') this.dismissCourses(); else if (this.expanded) this.setExpanded(false); };
    if (typeof document.addEventListener === 'function'){document.addEventListener('keydown', this._keyHandler);document.addEventListener('pointerdown',e=>{if(this._examplesOpen&&!e.target.closest?.('#artifact-example-menu,#artifact-new-experiment'))this.toggleExamples(false);});}
    this._unloadHandler = e => { if (this._dirty) { e.preventDefault(); e.returnValue = ''; } };
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('beforeunload', this._unloadHandler);
  }
  toggleExamples(force){
    this._examplesOpen=force===undefined?!this._examplesOpen:force;
    this._show('artifact-example-menu',this._examplesOpen);this.$('artifact-new-experiment')?.setAttribute('aria-expanded',String(this._examplesOpen));
    if(this._examplesOpen)this.$('artifact-example-menu')?.querySelector('button')?.focus();
  }
  openExample(kind) {
    if(!this._guardDraft())return false;
    try {
      const example=window.MathSceneCatalog?.get(kind==='linear-map'?'shear':kind==='composition'?'order':kind);
      const artifact=example?.solid?window.SolidGeometry.create(example.solid):window.MathExperiment.create(example?.spec||{type:kind});
      window.getAgentEngine?.()?.abort?.();
      artifact.artifactId='native-example-'+kind+'-'+Date.now()+'-'+(++this._sequence);
      return this.loadArtifact(artifact,{resetInteractionState:true});
    } catch(error){return this._fail(error);}
  }
  async askAboutScene(){
    if(!this._guardDraft())return false;
    const item=this.currentArtifact,rt=this._sandboxRt,session=window.sessionHistoryManager?.getActiveSessionId();
    const button=this.$('artifact-ask-agent');
    if(this.currentMode!=='artifact'||this.view!=='preview'||!rt?.requestScene)return this._fail(Error('请打开数学实验预览后引用画面。'));
    button.disabled=true;
    try{
      let scene=await rt.requestScene({action:'read'});
      if(scene.playing)scene=await rt.requestScene({action:'pause'});
      if(scene.inputsValid===false)throw Error('请补全标红的参数，再引用画面。');
      if(this.currentArtifact!==item||this._sandboxRt!==rt||session!==window.sessionHistoryManager?.getActiveSessionId())throw Error('画面已切换，请在目标实验重新引用。');
      const textarea=window.promptInputDock?.textarea||document.getElementById('dock-textarea');if(!textarea)throw Error('对话输入框不可用');
      textarea.value+=(textarea.value?'\n':'')+window.SceneQuestion.create(item.title,scene);
      textarea.dispatchEvent(new Event('input',{bubbles:true}));textarea.focus();this._status('已引用当前画面，可编辑后发送。');return true;
    }catch(error){return this._fail(error);}finally{button.disabled=false;}
  }
  _hydrate() {
    const store = this.getStore(); if (!store || typeof store.artifacts !== 'function') return;
    const select = this.$('artifact-saved-select');
    for (const id of store.artifacts()) {
      try {
        const saved = store.checkout(store.head(id));
        if (!saved.ok) throw new Error(saved.message);
        const v = saved.version;
        const data = { ...this._decode(v.kind, v.content), type: v.kind === 'vector_graphics' ? 'geometry' : v.kind, artifactId: id, versionId: v.versionId, title: v.title || '未命名工件', meta: v.meta };
        this._validate(data); this.artifacts.set(id, data);
        if (select) { const option = document.createElement('option'); option.value = id; option.textContent = data.title; select.appendChild(option); }
      } catch (error) { this._fail(error); }
    }
    this._show('artifact-saved-picker', this.artifacts.size > 0);
    this._text('deck-artifact-badge', String(this.artifacts.size)); this._show('deck-artifact-badge', this.artifacts.size > 0);
  }
  restoreSession(snapshot = {}) {
    this._disposePreview(); this._renderSignal = null; this._dirty = false;
    this._interactionStates = snapshot.interactionStates || {};
    this.coursePanel?.restoreSession(snapshot.course || {});
    this.currentArtifact = null; this.artifacts.clear(); this.view = 'preview';
    for (const id of ['artifact-saved-select', 'artifact-document-select', 'artifact-version-select']) {
      const el = this.$(id); if (el) el.innerHTML = '';
    }
    this._show('artifact-display-card', false); this._show('artifact-empty-state', true);
    this._hydrate();
    const item = snapshot.artifactId && this.artifacts.get(snapshot.artifactId);
    if (item) {
      const store = this.getStore();
      const saved = snapshot.versionId && store?.checkout ? store.checkout(snapshot.versionId) : null;
      this.loadArtifact(saved?.ok ? { ...item, ...this._decode(saved.version.kind, saved.version.content), versionId: saved.version.versionId } : item, { persist: false });
      if (snapshot.draft != null) { this.$('artifact-source-editor').value = snapshot.draft; this._dirty = true; this.setView('source'); }
    }
    this.coursePanel?.syncArtifact();
    const mode = ['canvas','artifact','manim','courses'].includes(snapshot.mode) ? snapshot.mode : 'canvas';
    this.setMode(mode);
    this._courseReturnMode = ['canvas','artifact','manim','overlay'].includes(snapshot.courseReturnMode) ? snapshot.courseReturnMode : (item ? 'artifact' : 'canvas');
  }
  captureSession() {
    if (this._sandboxRt?.interactionState && this.currentArtifact?.versionId) this._interactionStates[this.currentArtifact.versionId] = this._sandboxRt.interactionState;
    return { interactionStates: this._interactionStates, artifactId: this.currentArtifact?.artifactId || null, versionId: this.currentArtifact?.versionId || null, mode: this.currentMode,
      courseReturnMode: this._courseReturnMode, course: this.coursePanel?.captureSession(),
      draft: this._dirty ? this.$('artifact-source-editor').value : null };
  }
  _status(message, error = false) { this._text('artifact-status', message); const el = this.$('artifact-status'); if (el) el.classList.toggle('is-error', error); }
  _fail(error) {
    const message = String(error.message || error); this._status(message, true);
    if (typeof window !== 'undefined' && window.StructuredLogger) window.StructuredLogger.error('artifact_workspace_error', { code: error.code || 'ARTIFACT_ERROR', message });
    return false;
  }
  _guardDraft() { if (!this._dirty) return true; this._status('请先保存或撤销源码修改，再切换工件或版本。', true); return false; }
  _source(artifact) {
    if (!artifact) return '';
    if (['html', 'svg', 'interactive'].includes(artifact.type)) return artifact.content || '';
    if (artifact.type === 'geometry') return JSON.stringify({ shapes: artifact.shapes || [] }, null, 2);
    if (artifact.type === 'image') return JSON.stringify({ url: artifact.url, prompt: artifact.prompt || '' }, null, 2);
    return JSON.stringify({ latex: artifact.latex, subtitle: artifact.subtitle, signature: artifact.signature, category: artifact.category }, null, 2);
  }
  _decode(kind, content) {
    if (['html', 'svg', 'interactive'].includes(kind)) return { content };
    const decoded = JSON.parse(content);
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('工件源码须为 JSON 对象');
    const fields = kind === 'geometry' || kind === 'vector_graphics' ? ['shapes'] : kind === 'image' ? ['url', 'prompt'] : ['latex', 'subtitle', 'signature', 'category'];
    if (Object.keys(decoded).some(key => !fields.includes(key))) throw new Error('源码包含不支持的字段；类型、工件标识与版本由编辑器管理');
    return decoded;
  }
  _validate(data) {
    if (!['image', 'geometry', 'academic_proof', 'html', 'svg', 'interactive'].includes(data.type)) throw new Error('不支持的工件类型');
    if (data.type === 'geometry') {
      if (!Array.isArray(data.shapes) || !data.shapes.length) throw new Error('图元列表不能为空');
      const renderer = typeof window !== 'undefined' && window.GeometryArtifactRenderer;
      if (renderer) {
        const result = renderer.render(data.shapes, { title: data.title });
        const invalid = result.diagnostics.find(d => ['INVALID_SHAPE', 'INVALID_CURVE', 'SHAPE_LIMIT_EXCEEDED'].includes(d.code));
        if (invalid) throw new Error(invalid.message);
      }
    } else if (data.type === 'image') {
      if (!/^(https?:\/\/|blob:|data:image\/(?:png|jpeg|webp|gif);base64,|\.?\.?\/)/i.test(String(data.url || ''))) throw new Error('图像地址协议不受支持');
    } else if (['html', 'svg', 'interactive'].includes(data.type) && !String(data.content || '').trim()) throw new Error('工件源码不能为空');
  }
  loadArtifact(artifactData, options = {}) {
    if (!artifactData || !this.artifactViewport) return false;
    if (this._dirty && !options.discardDraft) return this._guardDraft();
    this.coursePanel?.captureDraft();
    try {
      const data = JSON.parse(JSON.stringify(artifactData));
      data.type = data.type === 'vector_graphics' ? 'geometry' : data.type || 'image'; data.title = data.title || '未命名工件';
      this._validate(data);
      data.artifactId = data.artifactId || `local-artifact-${Date.now()}-${++this._sequence}`;
      const store = this.getStore();
      if (store && data.versionId) {
        const saved = store.checkout(data.versionId);
        if (!saved.ok || saved.version.artifactId !== data.artifactId || (saved.version.kind === 'vector_graphics' ? 'geometry' : saved.version.kind) !== data.type) throw new Error('工件版本与内容类型不匹配');
        Object.assign(data, this._decode(saved.version.kind, saved.version.content), {meta:saved.version.meta});
        this._validate(data);
      }
      if (store && options.persist !== false && !data.versionId) {
        const result = store.commit({ artifactId: data.artifactId, kind: data.type, content: this._source(data), title: data.title, meta: data.meta });
        if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
        data.versionId = result.version.versionId;
      }
      this._disposePreview();
      if(options.resetInteractionState && data.versionId) delete this._interactionStates[data.versionId];
      this.currentArtifact = data; this.artifacts.set(data.artifactId, data);
      this._renderSignal = options.signal || null;
      this._editorHead = store?.head(data.artifactId) ?? null;
      this._selectedShape = null; this._dirty = false;
      this._text('stage-artifact-title', data.title);
      this._text('stage-artifact-chip', ({ geometry: '数学图形', image: '图像', academic_proof: '数学笔记', html: 'HTML', svg: 'SVG', interactive: '交互演示' })[data.type]);
      this._text('deck-artifact-badge', String(this.artifacts.size)); this._show('deck-artifact-badge', true);
      this._show('artifact-empty-state', false); this._show('artifact-display-card', true);
      this._show('btn-stage-switch-overlay', ['image', 'geometry'].includes(data.type));
      this._show('btn-sync-to-canvas', !!data.meta?.mathExperiment);
      this._show('artifact-ask-agent',!!data.meta?.nativeMath);
      this._populateDocuments(); this._populateVersions(); this._resetEditor(); this.view = 'preview';
      this._syncView();
      this._show('artifact-command-bar', this.currentMode === 'artifact');
      if (options.autoSwitch !== false) this.setMode(options.mode || 'artifact');
      else if (this.currentMode === 'artifact') this._renderPreview();
      this.coursePanel?.syncArtifact();
      return true;
    } catch (error) { return this._fail(error); }
  }
  _populateDocuments() {
    const select = this.$('artifact-document-select'); if (!select) return;
    select.innerHTML = '';
    this.artifacts.forEach(item => { const option = document.createElement('option'); option.value = item.artifactId; option.textContent = item.title; option.selected = item.artifactId === this.currentArtifact.artifactId; select.appendChild(option); });
    select.classList.toggle('hidden', this.artifacts.size < 2);
    this._show('artifact-heading', this.artifacts.size < 2);
  }
  _populateVersions() {
    const select = this.$('artifact-version-select'); if (!select) return;
    select.innerHTML = '';
    const store = this.getStore(), artifact = this.currentArtifact;
    const history = store ? store.history(artifact.artifactId) : [];
    history.forEach(item => { const option = document.createElement('option'); option.value = item.versionId; option.textContent = `v${item.seq}${store.head(artifact.artifactId) === item.versionId ? ' · 最新' : ''}`; option.selected = item.versionId === artifact.versionId; select.appendChild(option); });
    this._show('artifact-version-bar', history.length > 0);
    this._show('artifact-restore-version', !!store && !!artifact.versionId && store.head(artifact.artifactId) !== artifact.versionId);
  }
  selectVersion(versionId) {
    if (!this._guardDraft()) { this.$('artifact-version-select').value = this.currentArtifact.versionId; return false; }
    const store = this.getStore(), result = store && store.checkout(versionId);
    if (!result?.ok || result.version.artifactId !== this.currentArtifact.artifactId) return this._fail(new Error(result?.message || '版本不可用'));
    try { return this.loadArtifact({ ...this.currentArtifact, ...this._decode(result.version.kind, result.version.content), type: result.version.kind, versionId, meta:result.version.meta }, { persist: false }); }
    catch (error) { return this._fail(error); }
  }
  restoreVersion() { return this._guardDraft() && this._commitSource(this._source(this.currentArtifact)); }
  _resetEditor() {
    const editor = this.$('artifact-source-editor'); if (editor) editor.value = this._source(this.currentArtifact);
    this._dirty = false; this._text('artifact-source-language', ['html', 'svg', 'interactive'].includes(this.currentArtifact?.type) ? this.currentArtifact.type.toUpperCase() : 'JSON');
  }
  applySource() { const source = this.$('artifact-source-editor').value; this._dirty = source !== this._source(this.currentArtifact); return this._commitSource(source); }
  _commitSource(content) {
    try {
      const artifact = this.currentArtifact, data = { ...artifact, ...this._decode(artifact.type, content) };
      this._validate(data);
      const store = this.getStore(); if (!store) throw new Error('版本存储不可用，修改尚未保存');
      const result = store.commit({ artifactId: artifact.artifactId, kind: artifact.type, content: this._source(data), parentVersionId: this._editorHead, title: artifact.title, meta:data.meta });
      if (!result.ok) throw Object.assign(new Error(result.message), { code: result.code });
      this._dirty = false; return this.loadArtifact({ ...data, versionId: result.version.versionId }, { persist: false });
    } catch (error) { return this._fail(error); }
  }
  _syncView() {
    this._show('artifact-preview-panel', this.view === 'preview'); this._show('artifact-source-panel', this.view === 'source');
    this._show('artifact-preview-scale', this.view === 'preview' && ['html', 'svg', 'interactive'].includes(this.currentArtifact?.type));
    ['preview', 'source'].forEach(name => { const tab = this.$('artifact-tab-' + name); if (tab) { tab.classList.toggle('active', name === this.view); tab.setAttribute('aria-selected', String(name === this.view)); } });
  }
  setView(view) {
    if (!['preview', 'source'].includes(view)) return;
    this.coursePanel?.captureDraft();
    this.view = view; this._syncView(); this._disposePreview();
    this.coursePanel?.syncArtifact();
    if (view === 'preview' && this.currentArtifact) this._renderPreview();
    if (this._dirty) this._status('未保存的修改 · 预览仍使用已保存版本');
  }
  _disposePreview() {
    if (this._sandboxRt) { if (this._sandboxRt.interactionState && this.currentArtifact?.versionId) this._interactionStates[this.currentArtifact.versionId] = this._sandboxRt.interactionState; this._sandboxRt.destroy(); this._sandboxRt = null; }
    ['img', 'proof', 'vector'].forEach(kind => this._show('stage-artifact-' + kind + '-frame', false)); this._show('stage-artifact-sandbox', false);
    const mount = this.$('stage-artifact-sandbox'); if (mount) mount.innerHTML = '';
    const img = this.$('stage-artifact-img'); if (img && typeof img.removeAttribute === 'function') img.removeAttribute('src');
  }
  _renderPreview() {
    this._disposePreview();
    const artifact = this.currentArtifact;
    this._status(artifact.versionId ? '已保存 · 修改会生成新版本' : '当前预览未持久化');
    if (artifact.type === 'geometry') this._renderGeometry();
    else if (artifact.type === 'image') {
      this._show('stage-artifact-img-frame', true); const img = this.$('stage-artifact-img');
      if (img) { img.src = artifact.url; img.alt = artifact.title; img.onerror = () => this._status('图像无法加载，请检查地址或使用本地图像。', true); }
    } else if (artifact.type === 'academic_proof') {
      this._show('stage-artifact-proof-frame', true);
      const frame = this.$('stage-artifact-proof-frame'), esc = ArtifactStageDeck.escape;
      if (frame) {
        frame.innerHTML = `<article class="artifact-proof-note"><p class="artifact-note-eyebrow">${esc(artifact.category || '线性代数')}</p><h3>${esc(artifact.title)}</h3><div class="proof-card-latex">$$${esc(artifact.latex || '')}$$</div><p>${esc(artifact.subtitle || '')}</p><small>${esc(artifact.signature || '')}</small></article>`;
        if (typeof window !== 'undefined' && window.KaTeXRenderer) window.KaTeXRenderer.renderElement(frame);
      }
    } else {
      this._show('stage-artifact-sandbox', true); const mount = this.$('stage-artifact-sandbox'); if (!mount) return;
      if (typeof window === 'undefined' || !window.SandboxedArtifactRuntime) { this._status('预览运行时不可用，可查看源码。', true); return; }
      this._status('正在加载预览…');
      this._sandboxRt = new window.SandboxedArtifactRuntime(mount);
      this._sandboxRt.load(artifact.content, artifact.type, { versionId: artifact.versionId, initialState: this._interactionStates[artifact.versionId] || null, height: '100%', fitViewport: true, previewScale: this._previewScale || 'fit', signal: this._renderSignal?.aborted ? null : this._renderSignal,
        onAbort: () => this._status('演示已停止 · 点击预览可重新运行'),
        onReady: () => this._status('交互预览已就绪 · 网络访问受限'),
        onLayout: layout => { if (this._sandboxRt?.state !== 'error') this._status(`预览 ${Math.round(layout.scale * 100)}%${layout.overflow ? ' · 内容较长，可滚动查看' : ' · 已适应可视区域'}`); },
        onError: error => this._status('预览错误：' + String(error.message || '未知错误'), true) });
    }
  }
  async waitForPreview({ artifactId, versionId, signal } = {}) {
    artifactId ||= this.currentArtifact?.artifactId; versionId ||= this.currentArtifact?.versionId;
    const runtime = this._sandboxRt;
    if (!runtime || this.currentArtifact?.artifactId !== artifactId || this.currentArtifact?.versionId !== versionId) return { ok: false, code: 'PREVIEW_UNAVAILABLE', previewVerified: false };
    const result = await runtime.waitForStartup({ signal });
    if (this._sandboxRt !== runtime || this.currentArtifact?.versionId !== versionId) return { ok: false, code: 'PREVIEW_SUPERSEDED', previewVerified: false };
    return result;
  }
  _renderGeometry() {
    const frame = this.$('stage-artifact-vector-frame'); if (!frame) return;
    this._show('stage-artifact-vector-frame', true);
    const renderer = typeof window !== 'undefined' && window.GeometryArtifactRenderer;
    if (!renderer) { frame.textContent = '几何渲染器未加载'; return; }
    const legendHeight = Math.min(112, Math.ceil(this.currentArtifact.shapes.length / 2) * 48);
    const rendered = renderer.render(this.currentArtifact.shapes, { title: this.currentArtifact.title, selectedIndex: this._selectedShape,
      width: Math.max(200, (frame.clientWidth || 848) - 24), height: Math.max(120, (frame.clientHeight || 720) - legendHeight - 28) });
    frame.innerHTML = rendered.html;
    if (rendered.diagnostics?.length) this._status(rendered.diagnostics.map(d => typeof d === 'string' ? d : d.message || d.code).join('；'), true);
  }
  _renderVectorStageHtml(shapes, title) { const renderer = typeof window !== 'undefined' && window.GeometryArtifactRenderer; return renderer ? renderer.render(shapes, { title }).html : ''; }
  setMode(mode) {
    if (!['canvas', 'artifact', 'overlay', 'manim', 'courses'].includes(mode)) return;
    if (mode === 'courses' && !this.coursePanel) return;
    if (mode === 'overlay' && !['image', 'geometry'].includes(this.currentArtifact?.type)) { this._status('此工件请在独立预览中使用。', true); return; }
    this.coursePanel?.captureDraft();
    if (mode === 'courses' && this.currentMode !== 'courses') this._courseReturnMode = this.currentMode;
    this.currentMode = mode;if(mode!=='canvas'&&mode!=='overlay')this.getVisualizer()?.annotationLayer?.toggleActive(false);
    if(mode==='canvas'){const fit=this.canvasViewport?.querySelector('#btn-fit-canvas');if(fit)fit.disabled=this.getVisualizer()?.dimensionMode==='3D';}
    if (this.coursePanel) { this.coursePanel.shelf.classList.toggle('hidden', mode !== 'courses'); if (mode === 'courses') this.coursePanel.renderShelf(); }
    this.deckHeader.querySelectorAll('.deck-tab').forEach(tab => { const active = tab.getAttribute('data-mode') === (mode === 'overlay' ? 'canvas' : mode); tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); });
    if (this.canvasViewport) this.canvasViewport.classList.toggle('hidden', mode !== 'canvas' && mode !== 'overlay');
    if (this.artifactViewport) this.artifactViewport.classList.toggle('hidden', mode !== 'artifact');
    if (this.manimViewport) this.manimViewport.classList.toggle('hidden', mode !== 'manim');
    this._show('deck-overlay-controls', mode === 'overlay'); this._show('btn-stage-restore-canvas', mode === 'canvas' || mode === 'overlay');
    this._show('artifact-command-bar', mode === 'artifact' && !!this.currentArtifact);
    this._disposePreview();
    if (mode === 'manim') {
      this._ensureManimDeck();
      if (this.manimDeck && typeof this.manimDeck.onActivate === 'function') {
        this.manimDeck.onActivate();
      }
    } else {
      if (this.manimDeck && typeof this.manimDeck.pause === 'function') {
        this.manimDeck.pause();
      }
    }
    const viz = this.getVisualizer();
    const syncBtn = this.$('btn-sync-to-canvas');
    if (mode === 'artifact') {
      if (this.view === 'preview' && this.currentArtifact) this._renderPreview();
      if (syncBtn) syncBtn.classList.toggle('hidden',!this.currentArtifact?.meta?.mathExperiment||this.view!=='preview');
    } else if (syncBtn) {
      syncBtn.classList.add('hidden');
    }
    if (mode === 'canvas' || mode === 'overlay') {
      if (viz) {
        viz.showBasisVectors = mode === 'canvas' || this.showBasisInOverlay;
        if (mode === 'overlay') {
          const shapes = this.currentArtifact.type === 'geometry' ? this.currentArtifact.shapes : [{ type: 'image', centerX: 0, centerY: 0, width: 4.5, height: 4.5, url: this.currentArtifact.url, label: this.currentArtifact.title, opacity: this.overlayOpacity }];
          const sameImage = this.currentArtifact.type === 'image' && viz.customGraphics?.length === 1 && viz.customGraphics[0].type === 'image' && viz.customGraphics[0].url === this.currentArtifact.url;
          if (!sameImage && typeof viz.setCustomGraphics === 'function') viz.setCustomGraphics(shapes, { clear: true });
          if (this.currentArtifact.type === 'image') this.setOverlayOpacity(this.overlayOpacity);
        } else this._toggleVizImageGraphic(false);
        if (typeof viz.resize === 'function') viz.resize();
      }
    }
  }
  dismissCourses() {
    if (this.currentMode !== 'courses') return;
    const target = this._courseReturnMode === 'overlay' && !['image','geometry'].includes(this.currentArtifact?.type) ? 'canvas' : this._courseReturnMode;
    this.setMode(target || 'canvas');
    this.deckHeader.querySelector('.deck-tab[aria-selected="true"]')?.focus?.();
  }
  openModernDualView(matrix,step='transform') {
    if(!this._guardDraft())return false;
    const viz=this.getVisualizer(),mat=matrix||viz?.getMatrix?.();
    if(!mat)return this._fail(Error('CANVAS_MATRIX_UNAVAILABLE'));
    const linear3d=viz?.dimensionMode==='3D';
    const A=linear3d?['m00','m01','m02','m10','m11','m12','m20','m21','m22'].map(k=>viz.matrix3D[k]):[mat.a,mat.b,mat.c,mat.d];
    try{
      const artifact=window.MathExperiment.create({type:linear3d?'linear-map-3d':'linear-map',A,step,v:linear3d?[1,1,1]:[viz?.probeVector?.x??1,viz?.probeVector?.y??1]});
      artifact.artifactId='canvas-math-'+Date.now()+'-'+(++this._sequence);window.getAgentEngine?.()?.abort?.();
      return this.loadArtifact(artifact,{resetInteractionState:true});
    }catch(error){return this._fail(error);}
  }
  async syncToCanvas() {
    if(!this._guardDraft()||this.view!=='preview'||!this.currentArtifact?.meta?.mathExperiment)return false;
    const item=this.currentArtifact,rt=this._sandboxRt,button=this.$('btn-sync-to-canvas');if(button)button.disabled=true;
    try{
      const snapshot=await window.SceneSnapshot.read(this),spec=snapshot.scene?.spec;
      if(!spec||this.currentArtifact!==item||this._sandboxRt!==rt)throw Error('SCENE_VERSION_CONFLICT');
      const viz=this.getVisualizer();if(!viz)throw Error('CANVAS_UNAVAILABLE');
      if(spec.type==='linear-map-3d'){
        const m3d = Object.fromEntries(['m00','m01','m02','m10','m11','m12','m20','m21','m22'].map((key,i)=>[key,spec.A[i]]));
        viz.setDimensionMode('3D', m3d);
        viz.matrix3D = m3d;
        viz.render();
        if (typeof viz.updateHUD === 'function') viz.updateHUD();
      }else{viz.setDimensionMode('2D');viz.setMatrix({a:spec.A[0],b:spec.A[1],c:spec.A[2],d:spec.A[3]});viz.probeVector={x:spec.v[0],y:spec.v[1]};}
      viz.annotationLayer?.toggleActive(false);this.setMode('canvas');viz.stateManager?.pushSnapshot('同步数学实验参数');return true;
    }catch(error){return this._fail(error);}finally{if(button)button.disabled=false;}
  }
  restoreCanvas() {
    const viz = this.getVisualizer();
    if (viz) {
      if (typeof viz.clearCustomGraphics === 'function') viz.clearCustomGraphics();
      viz.matrix = { a: 1, b: 0, c: 0, d: 1 };
      viz.matrix3D = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0, m20: 0, m21: 0, m22: 1 };
      viz.showBasisVectors = true;
      viz.showProbe = true;
      viz.render();
      if (typeof viz.updateHUD === 'function') viz.updateHUD();
    }
    this._cachedImageGraphic = null; this.setMode('canvas');
    viz?.stateManager?.pushSnapshot('重置画板');
  }
  _toggleVizImageGraphic(visible) {
    const viz = this.getVisualizer(); if (!viz?.customGraphics) return;
    if (!visible) { viz.customGraphics = viz.customGraphics.filter(g => g.type !== 'image'); viz.render(); }
    else if (this.currentArtifact?.type === 'image') this.setMode('overlay');
  }
  setOverlayOpacity(opacity) {
    this.overlayOpacity = Math.max(0.1, Math.min(1, Number(opacity) || 0.65)); this._text('stage-opacity-val', Math.round(this.overlayOpacity * 100) + '%');
    const viz = this.getVisualizer(); if (viz?.customGraphics) { viz.customGraphics.forEach(g => { if (g.type === 'image') g.opacity = this.overlayOpacity; }); viz.render(); }
  }
  setExpanded(expanded) {
    this.expanded = !!expanded; this.container.classList.toggle('artifact-workspace-expanded', this.expanded);
    const button = this.$('btn-stage-expand'); if (button) { button.textContent = this.expanded ? '↙' : '↗'; button.setAttribute('title', this.expanded ? '收起工作区' : '展开工作区'); button.setAttribute('aria-label', this.expanded ? '收起工作区' : '展开工作区'); button.setAttribute('aria-pressed', String(this.expanded)); }
    const viz = this.getVisualizer(); if (viz?.resize) viz.resize();
  }
  async copySource() { try { await navigator.clipboard.writeText(this.$('artifact-source-editor').value); this._status('源码已复制'); } catch (error) { this._fail(new Error('复制失败，请在源码中全选复制：' + error.message)); } }
  getExport({sourceOnly=false}={}) {
    const artifact = this.currentArtifact; if (!artifact) return null;
    if (artifact.type === 'image') return { url: artifact.url, extension: /(?:data:image\/|\.)(jpeg|jpg|webp|gif)(?:[;?#]|$)/i.exec(artifact.url)?.[1] || 'png' };
    if (artifact.type === 'geometry') { const renderer = typeof window !== 'undefined' && window.GeometryArtifactRenderer; if (!renderer) throw new Error('几何渲染器未加载'); return { content: renderer.render(artifact.shapes, { title: artifact.title }).svg, extension: 'svg', mime: 'image/svg+xml' }; }
    let content=this._source(artifact);
    if(typeof window!=='undefined' && window.NativeMathDocument && content.includes(window.NativeMathDocument.marker))content=window.NativeMathDocument.expand(content,window.WenjuMathAsset);
    if(!sourceOnly && ['html','interactive'].includes(artifact.type)){
      const state=this._sandboxRt?.interactionState || this._interactionStates[artifact.versionId];
      if(!state && artifact.type==='interactive')throw new Error('EXPORT_STATE_UNAVAILABLE：请等待预览就绪；也可在源码页导出源码版本。');
      if(state){
        if(state.custom && !content.includes('artifact-state-restored'))throw new Error('EXPORT_STATE_UNSUPPORTED：该工件未实现自定义状态恢复。请在源码页导出源码版本。');
        const encoded=JSON.stringify(state).replace(/</g,'\\u003c');
        const replay=`<script>window.addEventListener('load',function(){var s=${encoded};var inputs=Array.from(document.querySelectorAll('input,select,textarea')).slice(0,100).filter(function(e){return e.type!=='password'&&e.type!=='file';});(s.inputs||[]).forEach(function(v){var e=inputs[v.index];if(e){e.value=v.value;e.checked=!!v.checked;e.dispatchEvent(new Event('input',{bubbles:true}));}});if(s.custom)window.artifactState=s.custom;window.dispatchEvent(new CustomEvent('artifact-state-restored',{detail:s.custom}));});<\/script>`;
          content=/<\/body>/i.test(content)?content.replace(/<\/body>(?![\s\S]*<\/body>)/i,()=>replay+'</body>'):content+replay;
      }
    }
    return { content, extension: artifact.type === 'svg' ? 'svg' : ['html', 'interactive'].includes(artifact.type) ? 'html' : 'json', mime: artifact.type === 'svg' ? 'image/svg+xml' : ['html', 'interactive'].includes(artifact.type) ? 'text/html' : 'application/json' };
  }
  downloadCurrentArtifact(options={}) {
    try {
      const exported = this.getExport(options); if (!exported) return;
      const url = exported.url || URL.createObjectURL(new Blob([exported.content], { type: exported.mime + ';charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = (this.currentArtifact.title || 'artifact').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80) + '.' + exported.extension;
      document.body.appendChild(a); a.click(); a.remove(); if (!exported.url) setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { this._fail(error); }
  }
  destroy() {
    if (this._resizeObserver) this._resizeObserver.disconnect();this._canvasObserver?.disconnect();
    this._disposePreview(); if (typeof document.removeEventListener === 'function') document.removeEventListener('keydown', this._keyHandler);
    if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('beforeunload', this._unloadHandler);
    this.coursePanel?.destroy(); this.manimDeck?.pause?.(); this.manimViewport?.remove();
    this.deckHeader?.remove(); this.artifactViewport?.remove(); this.overlayControls?.remove(); this.container?.classList.remove('artifact-workspace-expanded');
  }
}
if (typeof window !== 'undefined') window.ArtifactStageDeck = ArtifactStageDeck;
if (typeof module !== 'undefined' && module.exports) module.exports = { ArtifactStageDeck };
