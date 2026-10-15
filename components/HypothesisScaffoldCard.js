/**
 * 问矩 · 猜想与预测引导卡片 (HypothesisScaffoldCard)
 * 
 * 作用：
 * 在 Pechdt 六步探究闭环的 PREDICT 阶段，为学生提供智能上下文关联的猜想支架：
 * 1. 结构化猜想预设（满秩保维 / 奇异降维 / 零空间非平凡 / 乘法不可逆），一键装填；
 * 2. 实时理由字数门槛检测（≥8 字断言），清晰反馈为什么需要理由并消除黑盒阻断感；
 * 3. 一键提交预测（直接驱动 PredictionCollector 并解锁画板实验工具，推进至 PERCEIVE）；
 * 4. 深度响应画板当前矩阵 A，实时计算 det 与 rank 生成对偶猜想选项。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.HypothesisScaffoldCard = api.HypothesisScaffoldCard;
  }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  class HypothesisScaffoldCard {
    constructor(options = {}) {
      this.options = options;
      this.container = typeof options.container === 'string'
        ? (typeof document !== 'undefined' ? document.querySelector(options.container) : null)
        : (options.container || null);
      
      this.store = options.store || (typeof window !== 'undefined' ? window.pechdtStateStore : null);
      this.collector = options.collector || (typeof window !== 'undefined' ? window.predictionCollector : null);
      this.flow = options.flow || (typeof window !== 'undefined' ? window.inquiryFlow : null);
      this.getVisualizer = options.getVisualizer || (() => (typeof window !== 'undefined' ? window.workspaceVisualizer : null));
      this.onSubmit = options.onSubmit || null;

      this.isCollapsed = true;
      this.currentStage = 'IDLE';
      this.unsubscribeStore = null;
      this.element = null;

      if (typeof document !== 'undefined' && this.container) {
        this.initDOM();
        this.bindEvents();
        this.subscribe();
      }
    }

    initDOM() {
      if (this.element || !this.container) return;

      const card = document.createElement('div');
      card.id = 'hypothesis-scaffold-card';
      card.className = 'hypothesis-scaffold-card is-collapsed';card.hidden=true;
      card.setAttribute('role', 'region');
      card.setAttribute('aria-label', '数学猜想与预测引导');

      card.innerHTML = `
        <header class="scaffold-card-header" id="scaffold-header-toggle">
          <div class="scaffold-title-group">
            <span class="scaffold-badge" id="scaffold-stage-badge">🔮 猜想支架</span>
            <span class="scaffold-title" id="scaffold-task-title">提出你的几何猜想与预测</span>
          </div>
          <div class="scaffold-actions">
            <button type="button" class="btn-scaffold-toggle" id="btn-scaffold-collapse" title="折叠/展开猜想卡片" aria-label="折叠猜想卡片">▼</button>
          </div>
        </header>

        <div class="scaffold-card-body" id="scaffold-card-body">
          <p class="scaffold-guide-text">
            先记录这个探究任务的<strong>预测与理由</strong>（至少 8 字），再对照实验事实。普通对话和课程实验使用各自的操作流程。
          </p>

          <!-- 智能选项阵列 -->
          <div class="scaffold-chips-grid" id="scaffold-chips-grid"></div>

          <!-- 自定义填写区与门槛计数器 -->
          <div class="scaffold-input-group">
            <textarea
              id="scaffold-rationale-input"
              class="scaffold-rationale-input"
              placeholder="点击上方预设自动填入，或直接写下你的预测与理由（例如：我预测行列式非零，因为两向量不共线）..."
              rows="2"
            ></textarea>
            
            <div class="scaffold-footer-row">
              <span id="scaffold-threshold-badge" class="scaffold-threshold-badge invalid">
                写下预测，并说明依据（至少 8 字）
              </span>
              <button type="button" id="btn-scaffold-submit" class="btn-scaffold-submit" disabled>
                记录预测
              </button>
            </div>
          </div>
        </div>
      `;

      this.container.appendChild(card);
      this.element = card;
      this.refreshSuggestions();
    }

    bindEvents() {
      if (!this.element) return;

      const toggleBtn = this.element.querySelector('#btn-scaffold-collapse');
      const header = this.element.querySelector('#scaffold-header-toggle');
      const input = this.element.querySelector('#scaffold-rationale-input');
      const submitBtn = this.element.querySelector('#btn-scaffold-submit');

      const toggleCollapse = (e) => {
        if (e) e.stopPropagation();
        this.setCollapsed(!this.isCollapsed);
      };

      if (toggleBtn) toggleBtn.addEventListener('click', toggleCollapse);
      if (header) header.addEventListener('click', toggleCollapse);

      if (input) {
        input.addEventListener('input', () => {this._submitError=null;this.updateValidation();});
        input.addEventListener('keydown', (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            this.submit();
          }
        });
      }

      if (submitBtn) {
        submitBtn.addEventListener('click', () => this.submit());
      }
    }

    setCollapsed(collapsed) {
      this.isCollapsed = !!collapsed;
      if (!this.element) return;
      this.element.classList.toggle('is-collapsed', this.isCollapsed);
      const toggleBtn = this.element.querySelector('#btn-scaffold-collapse');
      if (toggleBtn) {
        toggleBtn.textContent = this.isCollapsed ? '▲' : '▼';
        if (typeof toggleBtn.setAttribute === 'function') {
          toggleBtn.setAttribute('title', this.isCollapsed ? '展开预测输入' : '收起预测输入');
          toggleBtn.setAttribute('aria-label', this.isCollapsed ? '展开预测输入' : '收起预测输入');
          toggleBtn.setAttribute('aria-expanded', String(!this.isCollapsed));
        }
      }
    }

    subscribe() {
      const store = this.store || (typeof window !== 'undefined' ? window.pechdtStateStore : null);
      if (!store || typeof store.subscribe !== 'function') return;

      this.unsubscribeStore = store.subscribe((state) => {
        this.onStageChange(state?.stage || 'IDLE');
      });
    }

    onStageChange(stage) {
      this.currentStage = stage;
      if (!this.element) return;

      const task=this.flow?.getActiveTask?.()||this.flow?.task;
      const isPredict=stage==='PREDICT'&&!!task;
      this.element.hidden=!isPredict;
      this.element.classList.toggle('is-predict-active',isPredict);
      const badge=this.element.querySelector('#scaffold-stage-badge');if(badge)badge.textContent='01 预测';
      const title=this.element.querySelector('#scaffold-task-title');if(title)title.textContent=task?.title||'记录预测与理由';
      if(isPredict){this.refreshSuggestions();this.updateValidation();}else this.setCollapsed(true);
    }

    /**
     * 根据画板当前矩阵与活跃课题，生成候选猜想
     */
    getSuggestions() {
      // Prompts solicit a hypothesis; they do not prefill an answer from the matrix.
      return [
        {label:'满秩或奇异降维',summary:'你预测图形会保留几维？',text:'我预测变换后图形的维数为___，我的理由是___。'},
        {label:'零空间猜想',summary:'是否有非零向量映到原点？',text:'我预测映到原点的向量___，我的理由是___。'},
        {label:'面积变化猜想',summary:'面积会如何变化？',text:'我预测面积的变化为___，我的理由是___。'},
        {label:'乘法顺序猜想',summary:'两种顺序会得到相同结果吗？',text:'我预测两种作用顺序的结果___，我的理由是___。'}
      ];
    }

    refreshSuggestions() {
      if (!this.element) return;
      const grid = this.element.querySelector('#scaffold-chips-grid');
      if (!grid) return;

      const suggestions = this.getSuggestions();
      grid.innerHTML = '';

      for (const item of suggestions) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'scaffold-conjecture-chip';
        chip.innerHTML = `
          <span class="chip-label">✦ ${this.escapeHTML(item.label)}</span>
          <span class="chip-rationale">${this.escapeHTML(item.summary)}</span>
        `;
        chip.addEventListener('click', () => {
          this.applySuggestion(item.text);
        });
        grid.appendChild(chip);
      }
    }

    applySuggestion(text) {
      if (!this.element) return;
      const input = this.element.querySelector('#scaffold-rationale-input');
      if (input) {
        input.value = text;
        input.focus();
        this.updateValidation();
      }
    }

    updateValidation() {
      if (!this.element) return;
      const input = this.element.querySelector('#scaffold-rationale-input');
      const badge = this.element.querySelector('#scaffold-threshold-badge');
      const submitBtn = this.element.querySelector('#btn-scaffold-submit');

      const text = (input?.value || '').trim();
      const len = text.length;
      const isValid = len >= 8&&!text.includes('___');

      if (badge) {
        badge.className = 'scaffold-threshold-badge ' + (isValid ? 'valid' : 'invalid');
        if (isValid) {
          badge.textContent = '预测与理由可提交';
        } else {
          badge.textContent = text.includes('___')?'请补全空缺处，写出自己的判断':`还需 ${Math.max(0,8-len)} 字，请说明依据`;
        }
      }

      if (submitBtn) {
        submitBtn.disabled = !isValid;
      }
      if(badge&&this._submitError)badge.textContent=this._submitError;

      return isValid;
    }

    async submit() {
      if(!this.element||!this.updateValidation()||this._submitting)return false;
      const input=this.element.querySelector('#scaffold-rationale-input'),text=input.value.trim(),task=this.flow?.getActiveTask?.()||this.flow?.task;
      const badge=this.element.querySelector('#scaffold-threshold-badge');
      if(this.store?.getState?.().stage!=='PREDICT'||!task){if(badge)badge.textContent='当前没有等待预测的探究任务';return false;}
      this._submitting=true;const button=this.element.querySelector('#btn-scaffold-submit');button.disabled=true;
      try{
        if(typeof this.onSubmit==='function')await this.onSubmit(text);
        else{
          let value = text;
          const predKey = String(task.predictionKey || '');
          if (/isSingular/i.test(predKey)) {
            if (/有非零|非零|奇异|降维|塌陷|非平凡|存在非零/i.test(text)) {
              value = true;
            } else if (/只有零|仅有零|无非零|满秩|非奇异|不奇异|平凡|可逆/i.test(text)) {
              value = false;
            }
          } else {
            if (/不相等|不等|不相同|不同|false|不成立|不可加|不满足/i.test(text)) {
              value = false;
            } else if (/相等|相同|成立|一样|true|可加|满足/i.test(text)) {
              value = true;
            }
          }
          const result=this.collector?.submitPrediction({taskId:task.taskId,key:task.predictionKey,value,prediction:text,rationale:text});
          if(!result?.ok)throw Error(result?.code||'PREDICTION_SUBMIT_FAILED');
        }
        if((this.flow?.getActiveTask?.()||this.flow?.task)?.taskId!==task.taskId)return false;
        if(this.store.getState().stage==='PREDICT')throw Error('预测尚未被受理，请检查理由与当前题目');
        input.value='';this.setCollapsed(true);this.onStageChange(this.store.getState().stage);return true;
      }catch(error){this._submitError=error.message;if(badge)badge.textContent=error.message;if(typeof recordIssue==='function')recordIssue('HypothesisScaffoldCard','submit',error);return false;}
      finally{this._submitting=false;this.updateValidation();}
    }

    escapeHTML(str) {
      return (str || '').replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
      );
    }

    destroy() {
      if (this.unsubscribeStore) {
        this.unsubscribeStore();
        this.unsubscribeStore = null;
      }
      if (this.element) {
        this.element.remove();
        this.element = null;
      }
    }
  }

  return { HypothesisScaffoldCard };
});
