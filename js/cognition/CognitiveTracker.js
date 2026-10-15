/**
 * 问矩 · 线性代数真实认知状态追踪引擎 (CognitiveTracker)
 * 职责：
 * 1. 维护覆盖大学线性代数 12 个核心概念节点的单调拓扑认知状态 (mastered / learning / locked)
 * 2. 观察事件只记录探索；两个不同练习通过后记录练习完成
 * 3. 记录物理证据链 (Evidence Chain) 并持久化至客户端 localStorage
 * 4. 已通过状态仅表示当前课程练习的核验范围
 */

class CognitiveTracker {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'wenju_cognitive_profile_v2';
    this.listeners = [];

    // 12 个学科核心认知节点权威拓扑定义
    this.nodeDefinitions = [
      // 支柱一：基底与向量空间
      { id: 'basis', label: '基底向量与线性组合', tier: 1, prereqs: [] },
      { id: 'linear_indep', label: '线性相关性与空间维数', tier: 2, prereqs: ['basis'] },

      // 支柱二：仿射变换与行列式
      { id: 'transform', label: '空间仿射映射与矩阵表示', tier: 2, prereqs: ['basis'] },
      { id: 'composition', label: '矩阵复合与非对易李括号', tier: 3, prereqs: ['linear_indep', 'transform'] },
      { id: 'det', label: '行列式与有向面积测度', tier: 3, prereqs: ['transform'] },

      // 支柱三：子空间结构与方程组
      { id: 'nullspace', label: '奇异降维与空间核 Null(A)', tier: 4, prereqs: ['composition', 'det'] },
      { id: 'colspace', label: '列空间与秩-零度定理', tier: 4, prereqs: ['det', 'nullspace'] },
      { id: 'sys_linear_eq', label: '线性方程组解集与仿射流形', tier: 4, prereqs: ['colspace'] },

      // 支柱四：谱理论与奇异值分解
      { id: 'eigen', label: '特征系统与不变方向流形', tier: 5, prereqs: ['nullspace', 'colspace'] },
      { id: 'diagonal', label: '正交相似对角化', tier: 5, prereqs: ['eigen'] },
      { id: 'ortho', label: '正交投影与最小二乘', tier: 5, prereqs: ['basis'] },
      { id: 'svd', label: '奇异值分解 (SVD)', tier: 6, prereqs: ['diagonal', 'ortho'] }
    ];

    this.profile = this.loadProfile();
  }

  getDefaultProfile() {
    return {version:3,lastUpdated:Date.now(),mastered:[],learning:[],assessments:[],evidenceChain:[]};
  }
  _library() { return typeof window !== 'undefined' ? window.CourseLibrary : require('../teaching/CourseLibrary.js'); }
  _derive() {
    const passed={};
    for(const attempt of this.profile.assessments || []) {
      const grade=this._library()?.grade(attempt.lessonId,attempt.phase,attempt.answer);
      if(!grade?.ok||!grade.passed)continue;
      passed[attempt.lessonId] ||= new Set();passed[attempt.lessonId].add(attempt.phase);
    }
    this.profile.mastered=[...new Set(Object.entries(passed).filter(([,phases])=>phases.has('practice')&&phases.has('transfer')).flatMap(([id])=>this._library().get(id).nodes))];
  }
  loadProfile() {
    const fresh=this.getDefaultProfile();
    try {
      const raw=typeof localStorage!=='undefined'?localStorage.getItem(this.storageKey):null;
      if(!raw)return fresh;
      const parsed=JSON.parse(raw);
      if(parsed.version!==3) {
        // Keep legacy observations separately; seeded or manually asserted mastery is unverified.
        fresh.learning=[...new Set([...(Array.isArray(parsed.learning)?parsed.learning:[]),...(Array.isArray(parsed.mastered)?parsed.mastered:[])])].filter(id=>this.nodeDefinitions.some(n=>n.id===id));
        fresh.legacyEvidence=(Array.isArray(parsed.evidenceChain)?parsed.evidenceChain:[]).slice(0,50);
        fresh.migratedFrom=parsed.version||2;return fresh;
      }
      if(!Array.isArray(parsed.assessments)||!Array.isArray(parsed.evidenceChain)||!Array.isArray(parsed.learning))throw new Error('COGNITIVE_PROFILE_INVALID');
      this.profile={...fresh,learning:parsed.learning.filter(id=>this.nodeDefinitions.some(n=>n.id===id)),assessments:this._library().retainAssessments(parsed.assessments),evidenceChain:parsed.evidenceChain.filter(e=>e&&this.nodeDefinitions.some(n=>n.id===e.nodeId)&&typeof e.detail==='string').slice(0,100)};this._derive();return this.profile;
    } catch(error) { if(typeof recordIssue==='function')recordIssue('CognitiveTracker','load',error);return fresh; }
  }
  saveProfile() {
    this.profile.lastUpdated=Date.now();
    try {if(typeof localStorage!=='undefined')localStorage.setItem(this.storageKey,JSON.stringify(this.profile));}
    catch(error) {if(typeof recordIssue==='function')recordIssue('CognitiveTracker','save',error);throw error;}
    this.emitChange();
  }
  onChange(fn) {if(typeof fn==='function')this.listeners.push(fn);return()=>{this.listeners=this.listeners.filter(x=>x!==fn);};}
  emitChange() {for(const fn of this.listeners){try{fn({profile:this.profile,summary:this.getMasterySummary(),states:this.getNodeStates()});}catch(error){if(typeof recordIssue==='function')recordIssue('CognitiveTracker','listener',error);}}}
  getNodeStates() {
    return Object.fromEntries(this.nodeDefinitions.map(node=>[node.id,this.profile.mastered.includes(node.id)?'mastered':this.profile.learning.includes(node.id)||node.prereqs.every(id=>this.profile.mastered.includes(id))?'learning':'locked']));
  }
  getMasterySummary() {
    const masteredCount=this.profile.mastered.length,totalNodes=this.nodeDefinitions.length,percentage=Math.round(masteredCount/totalNodes*100);
    return {masteredCount,totalNodes,percentage,stageLabel:masteredCount?'已有练习证据':'尚无练习证据',badgeText:`练习已通过：${masteredCount}/${totalNodes} · ${percentage}%`};
  }
  recordPhysicalEvent(eventType,payload={}) {
    const map={matrix_singular_detected:'det',kernel_vector_verified:'nullspace',counterexample_constructed:'composition',rank_nullity_verified:'colspace'};
    const nodeId=eventType==='agent_concept_explored'?payload.nodeId:map[eventType];
    if(!nodeId||!this.nodeDefinitions.some(n=>n.id===nodeId))return false;
    if(!this.profile.learning.includes(nodeId))this.profile.learning.push(nodeId);
    if(!this.profile.evidenceChain.some(e=>e.nodeId===nodeId&&e.type===eventType))this.recordEvidence(nodeId,eventType,'已观察或探索此概念；尚未通过练习与迁移核验。');
    this.saveProfile();return true;
  }
  recordAssessment(attempt) {
    const library=this._library(),grade=library?.grade(attempt?.lessonId,attempt?.phase,attempt?.answer);
    if(!grade?.ok||!attempt.id)return {ok:false,code:'ASSESSMENT_INVALID'};
    if(this.profile.assessments.some(x=>x.id===attempt.id))return {ok:true,duplicate:true};
    this.profile.assessments.push({id:attempt.id,lessonId:attempt.lessonId,phase:attempt.phase,answer:String(attempt.answer).slice(0,256),passed:grade.passed,at:attempt.at});
    this.profile.assessments=library.retainAssessments(this.profile.assessments);
    for(const nodeId of library.get(attempt.lessonId).nodes){if(!this.profile.learning.includes(nodeId))this.profile.learning.push(nodeId);this.recordEvidence(nodeId,'assessment',`${library.get(attempt.lessonId).title} · ${attempt.phase==='transfer'?'迁移':'练习'}：${grade.passed?'通过':'未通过'}`);}
    this._derive();this.saveProfile();return {ok:true,passed:grade.passed};
  }
  recordEvidence(nodeId,type,detail) {this.profile.evidenceChain.unshift({timestamp:Date.now(),nodeId,type,detail});this.profile.evidenceChain=this.profile.evidenceChain.slice(0,100);}
  resetProfile() {this.profile=this.getDefaultProfile();this.saveProfile();return this.profile;}
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CognitiveTracker };
}
if (typeof window !== 'undefined') {
  window.CognitiveTracker = CognitiveTracker;
}
