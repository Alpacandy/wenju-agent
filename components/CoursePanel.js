/** Executable local course shelf and compact assessment footer. */
class CoursePanel {
  constructor({ deck, library, progress }) {
    this.deck = deck;
    this.library = library;
    this.progress = progress;
    this.activeId = null;
    this.returnTarget = null;
    this.taskCollapsed = true;
    this.shelf = document.createElement("section");
    this.shelf.className = "course-shelf hidden";
    this.shelf.id = "stage-course-viewport";
    this.shelf.setAttribute("role", "tabpanel");
    this.shelf.setAttribute("aria-labelledby", "btn-course-shelf");
    this.shelf.setAttribute("aria-label", "课程实验");
    this.footer = document.createElement("section");
    this.footer.className = "course-task hidden";
    this.footer.setAttribute("aria-label", "课程作答");
    deck.container.append(this.shelf);
    deck.artifactViewport.append(this.footer);
    this._dismissDetails = (event) => {
      const actions=this.footer.querySelector('.course-actions');
      if(actions?.open && !actions.contains(event.target))actions.open=false;
    };
    this._detailsKeyDown = (event) => {
      if(event.key!=='Escape')return;
      const actions=this.footer.querySelector('.course-actions[open]');
      if(this.taskCollapsed && !actions)return;
      event.preventDefault();event.stopPropagation();
      if(actions){actions.open=false;actions.querySelector('summary').focus();}
      else this.setDetails(false,{focus:true});
    };
    document.addEventListener('pointerdown',this._dismissDetails);
    this.footer.addEventListener('keydown',this._detailsKeyDown);
    this.renderShelf();
  }
  static esc(text) {
    return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  show() {
    this.deck.setMode('courses');
  }
  showError(message, error) {
    if (this.deck.currentMode !== 'courses') this.show();
    const box = this.shelf.querySelector('#course-shelf-error');
    box.classList.remove('hidden'); box.querySelector('span').textContent = message;
    if (error && typeof recordIssue === 'function') recordIssue('CoursePanel','navigation',error);
    return false;
  }
  renderShelf() {
    const esc = CoursePanel.esc, chapters = [...new Set(this.library.lessons.map((l) => l.chapter))];
    this.shelf.innerHTML = `<header><div><small>COURSE / EXPERIMENTS</small><h2>用实验检验理解</h2></div><button type="button" id="course-close" aria-label="关闭课程实验">×</button></header><p class="course-intro">选择问题 → 记录预测 → 操作实验 → 核验作答 → 完成迁移。进度来自计算核验。</p>${chapters.map((chapter, i) => `<section><h3><span>0${i + 1}</span>${esc(chapter)}</h3>${this.library.lessons.filter((l) => l.chapter === chapter).map((l) => {
      const state = this.progress.state(l.id);
      return `<div class="course-lesson-row"><button type="button" class="course-lesson" data-lesson="${l.id}"><strong>${esc(l.title)}</strong><span>${state.passed.includes("transfer") ? "练习与迁移已通过" : state.phase === "prediction" ? "开始实验" : "继续" + (state.phase === "transfer" ? "迁移" : "练习")} ↗</span><p>${esc(l.goal)}</p></button>${state.attemptId||state.phase!=="prediction"?`<button type="button" class="course-restart-lesson" data-restart="${l.id}" title="从预测重新练习，保留历史作答">重新练习</button>`:""}</div>`;
    }).join("")}</section>`).join("")}<footer><button type="button" id="course-export">导出作答记录</button><span>本机保存 · 七个实验 · 四章</span></footer>`;
    const errorBox = document.createElement('div');
    errorBox.id = 'course-shelf-error'; errorBox.className = 'course-shelf-error hidden'; errorBox.setAttribute('role','alert');
    errorBox.innerHTML = '<span></span><br><button type="button">返回工件处理</button>';
    errorBox.querySelector('button').onclick = () => { this.deck.setMode('artifact'); this.deck.setView('source'); };
    this.shelf.querySelector('header').after(errorBox);
    this.shelf.querySelector("#course-close").onclick = () => this.deck.dismissCourses();
    this.shelf.querySelectorAll("[data-lesson]").forEach((b) => b.onclick = () => { try { this.start(b.dataset.lesson); } catch (error) { this.showError(error.message,error); } });
    this.shelf.querySelectorAll("[data-restart]").forEach(b=>b.onclick=()=>{try{this.start(b.dataset.restart,{fresh:true});}catch(error){this.showError(error.message,error);}});
    this.shelf.querySelector("#course-export").onclick = () => {
      const url = URL.createObjectURL(new Blob([this.progress.export()], { type: "application/json" })), a = document.createElement("a");
      a.href = url;
      a.download = "wenju-course-journal.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1e3);
    };
  }
  start(id,{fresh=false}={}) {
    if (!this.library.get(id)) throw new Error("COURSE_UNKNOWN");
    if (!this.deck._guardDraft()) return this.showError('当前工件有未保存的源码。请先返回工件保存或撤销修改，再开始练习。');
    this.captureDraft();
    if(fresh)this.progress.restart(id);
    const original = this.deck.currentArtifact;
    if (!original?.meta?.courseLesson) {
      this.returnTarget = {artifactId:original?.artifactId||null,versionId:original?.versionId||null,mode:this.deck.currentMode==='courses'?this.deck._courseReturnMode:this.deck.currentMode};
    }
    if (typeof window !== "undefined" && window.getAgentEngine) window.getAgentEngine().abort();
    this.footer.classList.add('hidden'); this._renderedPhase=null;
    this.activeId = id;
    this.taskCollapsed = true;
    this._liveResultExpanded = false;
    this.footer.classList.remove("hidden");
    this.openExperiment({resume:!fresh});
    return true;
  }
  openExperiment({resume=false}={}) {
    const state = this.progress.state(this.activeId), lesson = this.library.get(this.activeId), spec = lesson[state.phase === "transfer" ? "transfer" : "practice"].spec;
    const saved = this.deck.artifacts.get('course-'+lesson.id);
    const canResume = resume && saved && (saved.meta?.coursePhase === state.phase || (saved.meta?.courseLesson === lesson.id && state.phase === 'practice' && saved.meta?.mathExperiment));
    if (canResume) {
      if (saved.meta) saved.meta.coursePhase = state.phase;
      if (!this.deck.loadArtifact(saved,{persist:false})) throw new Error('COURSE_PREVIEW_REJECTED');
      this.renderTask(); return;
    }
    const data = window.MathExperiment.create(spec, { artifactId: "course-" + lesson.id });
    data.meta.courseLesson = lesson.id;
    data.meta.coursePhase = state.phase;
    if (!this.deck.loadArtifact(data,{resetInteractionState:true})) throw new Error("COURSE_PREVIEW_REJECTED");
    this.renderTask();
  }
  syncArtifact() {
    const id = this.deck.currentArtifact?.meta?.courseLesson;
    if (id && this.library.get(id)) {
      this.activeId = id;
      this.renderTask();
    } else { this.activeId=null; this.returnTarget=null; this.footer.classList.add("hidden"); }
  }
  captureDraft() {
    if (!this.activeId || this.footer.classList.contains('hidden')) return;
    const state = this.progress.state(this.activeId);
    if (state.phase!==this._renderedPhase) return;
    let changed = false;
    for (const [id,key] of [['course-answer','draft'],['course-prediction-value','predictionAnswerDraft'],['course-reflection',this._reflectionKind+'Draft']]) {
      const input = this.footer.querySelector('#'+id);
      if (input && state[key]!==input.value) { state[key]=input.value.slice(0,1000); changed=true; }
    }
    if (changed) {
      this.progress.data.lessons[this.activeId] = state;
      try { this.progress.save(); } catch (error) { this.feedback(error,'saveDraft'); }
    }
  }
  captureSession() { this.captureDraft(); return {returnTarget:this.returnTarget,taskCollapsed:this.taskCollapsed}; }
  restoreSession(snapshot={}) {
    const target=snapshot.returnTarget;
    this.returnTarget=target&&['canvas','artifact','manim','overlay'].includes(target.mode)?{artifactId:target.artifactId||null,versionId:target.versionId||null,mode:target.mode}:null;
    this.taskCollapsed=typeof snapshot.taskCollapsed==='boolean'?snapshot.taskCollapsed:true; this.activeId=null; this.footer.classList.add('hidden');
  }
  exit() {
    this.captureDraft();
    if (!this.deck._guardDraft()) { this.feedback(new Error('请先保存或撤销当前工件的源码修改，再退出练习。'),'exit'); return false; }
    try {
      const target=this.returnTarget||{mode:'canvas'},item=this.deck.artifacts.get(target.artifactId);
      if (item && !item.meta?.courseLesson) {
        const version=target.versionId && this.deck.getStore()?.checkout(target.versionId);
        if (target.versionId && !version?.ok) throw new Error('COURSE_RETURN_VERSION_UNAVAILABLE：原工件版本无法读取，可在工件列表中选择已保存的版本。');
        if (!this.deck.loadArtifact(version?.ok?{...item,versionId:version.version.versionId,title:version.version.title||item.title}:item,{persist:false})) throw new Error('COURSE_RETURN_PREVIEW_REJECTED：原工件未能打开，当前练习已保留。');
        this.deck.setMode(target.mode==='overlay'&&!['image','geometry'].includes(item.type)?'artifact':target.mode);
      } else if (target.artifactId) throw new Error('COURSE_RETURN_ARTIFACT_UNAVAILABLE：原工件不在当前对话中，当前练习已保留。');
      else this.deck.restoreSession({mode:target.mode,interactionStates:this.deck._interactionStates});
      this.activeId = null;
      this._renderedPhase = null;
      this.footer.classList.add('hidden');
      this.returnTarget = null;
      return true;
    } catch (error) { this.feedback(error,'exit'); return false; }
  }
  feedback(error,operation) {
    this.setDetails(true);
    const box=this.footer.querySelector('#course-feedback'); if(box){box.textContent=error.message;box.dataset.status='error';box.scrollIntoView?.({block:'nearest'});}
    if(typeof recordIssue==='function')recordIssue('CoursePanel',operation,error);
  }
  setDetails(open,{focus=false}={}) {
    this.taskCollapsed=!open;
    this.footer.classList.toggle('is-collapsed',!open);
    this.footer.querySelector('.course-task-body')?.classList.toggle('hidden',!open);
    for(const id of ['task-close','course-question-toggle']) {
      const button=this.footer.querySelector('#'+id);
      button?.setAttribute('aria-expanded',String(open));
      if(id==='task-close')button?.setAttribute('aria-label',`${open?'收起':'展开'}题目与检验结果`);
    }
    if(focus)this.footer.querySelector('#task-close')?.focus();
  }
  destroy() { this.captureDraft();document.removeEventListener('pointerdown',this._dismissDetails);this.footer.removeEventListener('keydown',this._detailsKeyDown);this.shelf.remove();this.footer.remove(); }
  values(value) {
    if(!Array.isArray(value))return String(value);
    const numbers=value.map(n=>Number(n.toPrecision(10)).toString());
    return numbers.length===4?`[[${numbers.slice(0,2).join(', ')}], [${numbers.slice(2).join(', ')}]]`:`(${numbers.join(', ')})`;
  }
  reportHTML(report) {
    const esc=CoursePanel.esc,values=value=>esc(this.values(value));
    const residual=report.residual;
    return `<div class="course-result-values"><span>我的数值<strong>${values(report.actual)}</strong></span><span>${esc(report.label)}<strong>${values(report.expected)}</strong></span><span>${residual?'Av 残差':report.label==='实特征值'?'差值（排序后）':'差值'}<strong>${values(residual||report.delta)}</strong></span></div><details class="course-calculation"><summary>查看计算依据</summary><ol>${report.evidence.map(line=>`<li>${esc(line)}</li>`).join('')}</ol><small>数值核验使用容差；文字理由不作为一般命题的证明。</small></details>`;
  }
  reflectionHelp(state,lesson) {
    if(!state.help)return '';
    const definitions={Av:'把 v 的两个分量作为系数，分别乘 A 的两列，再相加。',AB:'对积矩阵的每个元素，取左矩阵的一行与右矩阵的一列作内积。',BA:'先确认乘法顺序，再逐项计算行与列的内积。',determinant:'2×2 行列式为 ad−bc。改变一列的方向，比较是否变成共线；两列都为零时另作检查。',ranks:'先比较两行系数是否成比例，再比较右端常数是否也保持相同比例。',dimensions:'找出独立列的个数作为秩，再用 nullity=2−rank 检查。',kernel:'把两个分量代入 Av，要求两个分量都为零，并排除 v=0。',eigenvalues:'由 det(A−λI)=0 求根，再把候选值代回检查。'};
    const first=state.help.kind==='boundary'?'只改变一个输入，比较修改前后的数值；记录结果何时改变。':definitions[lesson.practice.check];
    const second=state.help.level>1?this.library.explain(lesson.id,'practice',state.lastResult?.actual.join(',')||state.predictionAnswer).evidence.join('；'):'';
    return `<aside id="course-help" role="status"><strong>提示 ${state.help.level}/2 · 尚未完成推导</strong><p>${CoursePanel.esc(first)}</p>${second?`<p>${CoursePanel.esc(second)}</p>`:''}<small>求助文字已保留；提示和文字尝试均不等于证明通过。</small></aside>`;
  }
  async runLiveCheck() {
    const id=this.activeId,current=this.deck.currentArtifact,version=current?.versionId,phase=this.progress.state(id).phase;
    this.captureDraft();
    const button=this.footer.querySelector('#course-check-live');
    if(button){button.disabled=true;button.textContent='正在检验…';}
    try {
      if(current?.meta?.courseLesson!==id || current.meta.coursePhase!==phase)throw new Error('COURSE_PHASE_MISMATCH：请从课程列表重新进入当前练习。');
      const preview=await this.deck.waitForPreview({artifactId:current.artifactId,versionId:version});
      if(!preview.ok)throw new Error('预览未就绪，当前画布尚未检验。');
      if(this.activeId!==id || this.deck.currentArtifact?.versionId!==version || this.progress.state(id).phase!==phase)throw new Error('COURSE_EXPERIMENT_CHANGED');
      const live=this.deck._sandboxRt?.interactionState?.custom;
      if(live?.schema!=='math-experiment/1')throw new Error('COURSE_LIVE_STATE_UNAVAILABLE：尚未读到当前画布输入，请稍后再试。');
      const state=this.progress.state(id),answer=state.draft||state.lastResult?.actual?.join(',')||state.predictionAnswer;
      if(!answer)throw new Error('先在下方填写要对照的数值，再检验当前画布。');
      this.progress.checkExperiment(id,answer,live.spec,{artifactId:current.artifactId,versionId:version});
      this._liveResultExpanded=true;
      this.taskCollapsed=false;
      this.renderTask();
    } catch(error) {
      if(this.activeId===id && this.deck.currentArtifact?.versionId===version)this.feedback(error,'checkExperiment');
      else if(typeof recordIssue==='function')recordIssue('CoursePanel','checkExperiment',error);
    } finally {
      if(button?.isConnected){button.disabled=false;button.textContent='检验当前画布';}
    }
  }
  renderTask() {
    const focused=this.footer.contains(document.activeElement)?document.activeElement:null;
    const focusId=focused?.id,selection=typeof focused?.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd]:null;
    const lesson = this.library.get(this.activeId);
    if (!lesson) return;
    const state = this.progress.state(lesson.id), predict = state.phase === "prediction", phase = state.phase === "transfer" ? "transfer" : "practice", esc = CoursePanel.esc;
    const reflection = phase === "practice" && state.passed.includes("practice") ? state.boundary ? "deduction" : "boundary" : null;
    this._renderedPhase=state.phase; this._reflectionKind=reflection;
    if (this.deck.view==='source') { this.footer.classList.add('hidden'); return; }
    const result = state.lastResult, complete = state.passed.includes("practice") && state.passed.includes("transfer");
    const step=predict?0:phase==='transfer'?5:reflection==='boundary'?3:reflection==='deduction'||state.deduction?4:result?2:1;
    const labels=['预测','实验','对照','边界','推导','迁移'];
    const next=predict?'先填写预测数值和理由，提交后立即对照计算。':complete?'本次练习与迁移均已核验，可退出或继续改变输入探索。':reflection==='boundary'?'原题核验通过。请记录哪些条件改变后结果会不同。':reflection==='deduction'?'边界猜想已保存。请写出计算或推导依据。':state.deduction&&phase==='practice'?'推导文字已保存。进入无提示变式检验迁移。':result?.passed?'迁移通过，可退出练习。':'在下方修正数值并检验原题；画布输入改变后，可单独检验当前画布。';
    const report=result&&this.library.explain(lesson.id,phase,result.actual.join(','));
    const prediction=state.predictionAnswer&&phase==='practice'?this.library.grade(lesson.id,'practice',state.predictionAnswer):null;
    const predictionHTML=phase==='practice'&&!predict?`<div id="course-prediction-result" class="course-prediction-note">${prediction?.ok?`初始预测 ${esc(this.values(prediction.actual))} → 计算 ${esc(this.values(prediction.expected))} · <b>${prediction.passed?'一致':'不一致'}</b>`:'文字预测已记录，未作自动判定；填写数值答案后检验。'}${state.prediction?`<details><summary>查看预测理由</summary><p>${esc(state.prediction)}</p></details>`:''}</div>`:'';
    const last=state.lastExperiment;
    const live=last?.phase===phase&&last.versionId===this.deck.currentArtifact?.versionId?this.library.explain(lesson.id,phase,last.answer,{spec:last.spec}):null;
    const liveHTML=live?.ok?`<details id="course-live-result" class="course-live-result" data-passed="${live.passed}"${this._liveResultExpanded?' open':''}><summary>最近一次画布检验 · ${live.passed?'一致':'不一致'}</summary><p>仅检验当时的输入，不计入原题通过。A = ${esc(this.values(live.input.A))}${live.input.type==='system'?`，b = ${esc(this.values(live.input.b))}`:live.input.type==='composition'?`，B = ${esc(this.values(live.input.B))}`:`，v = ${esc(this.values(live.input.v))}`}</p>${this.reportHTML(live)}</details>`:'';
    const form=predict?`<form id="course-answer-form" class="course-prediction-form"><input id="course-prediction-value" aria-label="预测数值" maxlength="256" value="${esc(state.predictionAnswerDraft||'')}" placeholder="预测数值" title="按题目顺序填写数值，用逗号分隔" required><input id="course-answer" aria-label="预测与理由" maxlength="1000" value="${esc(state.draft)}" placeholder="预测理由" required><button type="submit" title="提交预测并与原题计算对照">预测检验</button></form>`:`<form id="course-answer-form"><input id="course-answer" aria-label="原题数值答案" maxlength="256" value="${esc(state.draft)}" placeholder="数值答案，逗号分隔" required><button type="submit" title="检验题目给定输入的答案">检验</button></form>`;
    const feedback=predict?'预测数值会与原题计算对照，理由将保留。':result?`<strong>${result.passed?(phase==='transfer'?'迁移通过':'原题核验通过'):'原题核验未通过'}</strong>${predictionHTML}${report?.ok?this.reportHTML(report):''}`:predictionHTML;
    this.footer.classList.remove("hidden");
    this.footer.classList.toggle('is-collapsed',this.taskCollapsed);
    this.footer.classList.toggle('is-prediction',predict);
    const showLive=this._liveResultExpanded&&live?.ok,shownResult=showLive?live:result;
    const status=showLive?(live.passed?'画布一致':'画布不一致'):result?(result.passed?'已通过':'未通过'):'详情';
    this.footer.innerHTML = `<div class="course-task-bar" aria-label="当前课程作答"><button type="button" id="course-question-toggle" class="course-context" aria-controls="course-details-panel" aria-expanded="${!this.taskCollapsed}" title="${esc(lesson.title+' · '+lesson[phase].question)}"><span class="course-phase">课程 ${step+1} ${labels[step]}</span><span class="course-question-preview">${esc(lesson[phase].question)}</span></button>${form}<button type="button" id="task-close" class="course-details-toggle" data-status="${shownResult?(shownResult.passed?'pass':'fail'):'pending'}" aria-label="${this.taskCollapsed?'展开':'收起'}题目与检验结果" aria-controls="course-details-panel" aria-expanded="${!this.taskCollapsed}" title="题目、作答结果与计算依据">${status}<span aria-hidden="true">⌃</span></button><details class="course-actions"><summary aria-label="更多课程操作" title="更多课程操作">⋯</summary><div class="course-actions-list">${predict?'<button type="button" id="course-skip-predict" title="跳过预测，直接进入实验探索">直接进入实验探索</button>':''}${!predict?'<button type="button" id="course-check-live" title="对照当前画布输入，不计入原题通过">检验当前画布</button><button type="button" id="course-reopen">恢复原题输入</button>':''}<button type="button" id="course-restart">从头重做（保留记录）</button><button type="button" id="course-exit">退出练习</button></div></details></div><div id="course-details-panel" class="course-task-body${this.taskCollapsed?' hidden':''}" role="region" aria-labelledby="course-details-title"><header><strong id="course-details-title">${esc(lesson.title)}</strong><button type="button" id="course-details-dismiss" aria-label="关闭题目与检验结果">×</button></header><ol class="course-steps" aria-label="六步探究进度">${labels.map((label,index)=>`<li${index===step?' aria-current="step"':''}>${index+1} ${label}</li>`).join('')}</ol><p class="course-question">${esc(lesson[phase].question)}</p><p id="course-next-action" class="course-next-action">${esc(next)}</p>${liveHTML}<div id="course-feedback" role="status" aria-live="polite" data-status="${result?(result.passed?'pass':'fail'):'pending'}">${feedback}</div>${this.reflectionHelp(state,lesson)}<div class="course-task-inputs">${reflection && !state.deduction?`<form id="course-reflect-form"><input id="course-reflection" aria-label="${reflection==='boundary'?'边界猜想':'推导尝试'}" maxlength="1000" required placeholder="${reflection==='boundary'?'改变什么条件，结果会不同？写下边界猜想':'写出计算或推导依据；文字不自动判定为证明'}"><button type="submit">保存${reflection==='boundary'?'猜想':'尝试'}</button><button type="button" id="course-hint">${state.help?.level===1?'再给一点提示':'我需要提示'}</button></form>`:''}${state.deduction&&phase==='practice'?'<button type="button" id="course-next">进入无提示变式 →</button>':''}</div></div>`;
    this.footer.querySelector('#course-exit').onclick=()=>this.exit();
    this.footer.querySelector('#course-restart').onclick=()=>{try{this.start(lesson.id,{fresh:true});}catch(error){this.feedback(error,'restart');}};
    const skipPredict=this.footer.querySelector('#course-skip-predict');if(skipPredict)skipPredict.onclick=()=>{try{const initialGuess=lesson.practice.spec?.v?lesson.practice.spec.v.join(','):'0';this.progress.begin(lesson.id,'自由探索',initialGuess);this.taskCollapsed=false;this.openExperiment();}catch(error){this.feedback(error,'skipPredict');}};
    const hint=this.footer.querySelector('#course-hint');if(hint)hint.onclick=()=>{try{this.captureDraft();this.progress.requestHint(lesson.id,reflection);this.renderTask();}catch(error){this.feedback(error,'hint');}};
    const liveButton=this.footer.querySelector('#course-check-live');if(liveButton)liveButton.onclick=()=>this.runLiveCheck();
    for(const id of ['task-close','course-question-toggle'])this.footer.querySelector('#'+id).onclick=()=>this.setDetails(this.taskCollapsed);
    this.footer.querySelector('#course-details-dismiss').onclick=()=>this.setDetails(false,{focus:true});
    const input = this.footer.querySelector("#course-answer");
    input.oninput = () => this.captureDraft();
    const predictionInput=this.footer.querySelector('#course-prediction-value');if(predictionInput)predictionInput.oninput=()=>this.captureDraft();
    this.footer.querySelector("#course-answer-form").onsubmit = (e) => {
      e.preventDefault();
      try {
        if (predict) {
          if(!predictionInput.value.trim())throw new Error('请先填写预测数值，再提交检验。');
          this.progress.begin(lesson.id, input.value,predictionInput.value);
          this.taskCollapsed=false;
          this.openExperiment();
        } else {
          const grade = this.progress.submit(lesson.id, input.value);
          if (!grade.ok) throw new Error(grade.message || grade.code);
          this._liveResultExpanded=false;
          this.taskCollapsed=false;
          this.renderTask();
        }
      } catch (error) {
        this.feedback(error,'submit');
      }
    };
    const reflectForm = this.footer.querySelector("#course-reflect-form");
    if (reflectForm) { const field=this.footer.querySelector('#course-reflection'); field.value=state[reflection+'Draft']||''; field.oninput=()=>this.captureDraft(); }
    if (reflectForm) reflectForm.onsubmit = (e) => {
      e.preventDefault();
      try {
        this.progress.reflect(lesson.id, reflection, this.footer.querySelector("#course-reflection").value);
        this.renderTask();
      } catch (error) {
        this.feedback(error,'reflect');
      }
    };
    const reopen = this.footer.querySelector("#course-reopen");
    if (reopen) reopen.onclick = () => { try { this._liveResultExpanded=false;this.openExperiment(); } catch(error) { this.feedback(error,'resetExperiment'); } };
    const nextButton = this.footer.querySelector("#course-next");
    if (nextButton) nextButton.onclick = () => {
      try { this.progress.next(lesson.id); this.openExperiment(); }
      catch(error) { this.feedback(error,'next'); }
    };
    const restoreFocus=focusId&&this.footer.querySelector('#'+focusId);
    if(restoreFocus && restoreFocus.getBoundingClientRect().height>0){restoreFocus.focus({preventScroll:true});if(selection)restoreFocus.setSelectionRange?.(...selection);}
    if(state.help)this.footer.querySelector('#course-help')?.scrollIntoView({block:'nearest'});
  }
}
if (typeof window !== "undefined") window.CoursePanel = CoursePanel;
if (typeof module !== "undefined" && module.exports) module.exports = { CoursePanel };
