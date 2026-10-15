/** Local assessment journal. Viewing or editing an experiment does not award progress. */
(function(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./CourseLibrary.js") : root.CourseLibrary);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CourseProgress = api.CourseProgress;
})(typeof globalThis !== "undefined" ? globalThis : this, function(library) {
  class CourseProgress {
    constructor({ storage = typeof localStorage !== "undefined" ? localStorage : null, tracker = null } = {}) {
      this.storage = storage;
      this.tracker = tracker;
      this.key = "wenju_course_progress_v1";
      this.data = { version: 1, lessons: {}, attempts: [], sessions: {}, activeSessionId:null };
      try {
        const raw = storage?.getItem(this.key);
        if (!raw) return;
        if (raw.length > 262144) throw new Error("COURSE_QUOTA_EXCEEDED");
        const d = JSON.parse(raw);
        if (d.version !== 1 || !d.lessons || Array.isArray(d.lessons) || !Array.isArray(d.attempts)) throw new Error("COURSE_STATE_INVALID");
        const attempts = library.retainAssessments(d.attempts);
        const normalizeStates = source => {
        const states={};
        for (const lesson of library.lessons) {
          const old = source[lesson.id];
          if (!old) continue;
          if (!["prediction", "practice", "transfer"].includes(old.phase)) throw new Error("COURSE_STATE_INVALID");
          const currentAttempts=attempts.filter(a=>a.lessonId===lesson.id && (!old.attemptId || a.attemptId===old.attemptId));
          const passed = [...new Set(currentAttempts.filter(a=>library.grade(a.lessonId,a.phase,a.answer).passed).map(a=>a.phase))];
          states[lesson.id] = { phase: old.phase, passed, attemptId:typeof old.attemptId==='string'?old.attemptId:null };
          for (const key of ["prediction", "predictionAnswer", "predictionAnswerDraft", "draft", "boundary", "deduction", "boundaryDraft", "deductionDraft"]) states[lesson.id][key] = typeof old[key] === "string" ? old[key].slice(0, key.startsWith('predictionAnswer')?256:1e3) : "";
          const check=old.lastExperiment;
          if(check?.spec && check.phase===old.phase && typeof check.answer==='string' && check.answer.length<=256 && typeof check.artifactId==='string' && check.artifactId.length<=128 && typeof check.versionId==='string' && check.versionId.length<=128) {
            try { const report=library.explain(lesson.id,check.phase,check.answer,{spec:check.spec});if(report.ok)states[lesson.id].lastExperiment={phase:check.phase,answer:check.answer,spec:report.input,artifactId:check.artifactId,versionId:check.versionId,at:typeof check.at==='string'?check.at.slice(0,32):null}; }
            catch(error) { if(typeof recordIssue==='function')recordIssue('CourseProgress','loadExperimentCheck',error); }
          }
          if(old.help && ['boundary','deduction'].includes(old.help.kind))states[lesson.id].help={kind:old.help.kind,level:Math.max(1,Math.min(2,Number(old.help.level)||1))};
          if (old.lastResult && currentAttempts.some(a=>a.phase===old.phase)) states[lesson.id].lastResult = library.grade(lesson.id, old.phase, currentAttempts.filter(a=>a.phase===old.phase).at(-1).answer);
        }
        return states;
        };
        const sessions={};
        for(const [id,states] of Object.entries(d.sessions||{})) {
          if(id.length>128 || !states || typeof states!=='object'||Array.isArray(states))throw new Error('COURSE_SESSION_INVALID');
          sessions[id]=normalizeStates(states);
        }
        this.data = { version: 1, lessons: normalizeStates(d.lessons), attempts, sessions,activeSessionId:typeof d.activeSessionId==='string'?d.activeSessionId:null };
      } catch (error) {
        if (typeof recordIssue === "function") recordIssue("CourseProgress", "load", error);
      }
    }
    save() {
      const next=this.data.activeSessionId?{...this.data,sessions:{...this.data.sessions,[this.data.activeSessionId]:this.data.lessons}}:this.data;
      const raw = JSON.stringify(next);
      if (raw.length > 262144) throw new Error("COURSE_QUOTA_EXCEEDED");
      this.storage?.setItem(this.key, raw);
      this.data=next;
    }
    setSession(id) {
      if(typeof id!=='string'||!id||id.length>128)throw new Error('COURSE_SESSION_INVALID');
      if(this.data.activeSessionId===id)return;
      const sessions={...this.data.sessions};
      if(this.data.activeSessionId)sessions[this.data.activeSessionId]=this.data.lessons;
      const legacy=this.data.activeSessionId==null && Object.keys(sessions).length===0;
      this._persist({...this.data,sessions,activeSessionId:id,lessons:sessions[id]||(legacy?this.data.lessons:{})});
    }
    state(id) {
      return this.data.lessons[id] || { phase: "prediction", passed: [], prediction: "", draft: "" };
    }
    _persist(next) {
      const previous=this.data;this.data=next;
      try {this.save();}catch(error){this.data=previous;throw error;}
    }
    restart(id) {
      if(!library.get(id))throw new Error('COURSE_UNKNOWN');
      const attemptId=globalThis.crypto?.randomUUID?.()||'practice-'+Date.now()+'-'+Math.random();
      const state={attemptId,phase:'prediction',passed:[],prediction:'',draft:''};
      this._persist({...this.data,lessons:{...this.data.lessons,[id]:state}});
      return state;
    }
    begin(id, prediction, predictionAnswer='') {
      if (!library.get(id)) throw new Error("COURSE_UNKNOWN");
      if (typeof prediction !== "string" || prediction.trim().length < 2 || prediction.length > 1e3) throw new Error("PREDICTION_REQUIRED");
      const old = this.state(id);
      const answer=String(predictionAnswer).trim();
      const next={ ...old, attemptId:old.attemptId||globalThis.crypto?.randomUUID?.()||'practice-'+Date.now()+'-'+Math.random(),prediction: prediction.trim(),predictionAnswer:answer,predictionAnswerDraft:'', draft:'',phase:old.phase==='prediction'?'practice':old.phase };
      if(answer) {
        if(old.phase!=='prediction')throw new Error('COURSE_ALREADY_BEGUN');
        const result=library.grade(id,'practice',answer);
        if(!result.ok)throw new Error(result.message||result.code);
        return this._recordAssessment(id,next,answer,result,'prediction');
      }
      this._persist({...this.data,lessons:{...this.data.lessons,[id]:next}});
      return {ok:true,checked:false};
    }
    submit(id, answer) {
      const state = this.state(id), phase = state.phase;
      if (!["practice", "transfer"].includes(phase)) return { ok: false, code: "COURSE_NOT_READY" };
      const result = library.grade(id, phase, answer);
      if (!result.ok) return result;
      return this._recordAssessment(id,state,answer,result,'answer');
    }
    _recordAssessment(id,state,answer,result,source) {
      const phase=state.phase;
      const attempt = { id: globalThis.crypto?.randomUUID?.() || "attempt-" + Date.now() + "-" + Math.random(), attemptId:state.attemptId,lessonId: id, phase, answer: String(answer).slice(0, 256), passed: result.passed,source, at: new Date().toISOString(), problemId: result.problemId };
      const passed=[...new Set([...state.passed,...(result.passed?[phase]:[])])];
      this._persist({...this.data,attempts:library.retainAssessments([...this.data.attempts,attempt]),lessons:{...this.data.lessons,[id]:{...state,passed,lastResult:result,draft:''}}});
      if (this.tracker?.recordAssessment) this.tracker.recordAssessment(attempt);
      return result;
    }
    checkExperiment(id,answer,spec,{artifactId,versionId}={}) {
      const state=this.state(id);
      if(!['practice','transfer'].includes(state.phase))throw new Error('COURSE_NOT_READY');
      if(!spec || typeof spec!=='object')throw new Error('COURSE_LIVE_STATE_UNAVAILABLE');
      if(typeof artifactId!=='string'||artifactId.length>128||typeof versionId!=='string'||versionId.length>128)throw new Error('COURSE_EXPERIMENT_REFERENCE_REQUIRED');
      const report=library.explain(id,state.phase,answer,{spec});
      if(!report.ok)throw new Error(report.message||report.code);
      const check={phase:state.phase,answer:String(answer).slice(0,256),spec:report.input,artifactId,versionId,at:new Date().toISOString()};
      this._persist({...this.data,lessons:{...this.data.lessons,[id]:{...state,lastExperiment:check}}});
      return report;
    }
    reflect(id, kind, text) {
      const state = this.state(id);
      if (!state.passed.includes("practice")) throw new Error("PRACTICE_REQUIRED");
      if (!["boundary", "deduction"].includes(kind) || typeof text !== "string" || text.trim().length < 4 || text.length > 1e3) throw new Error("REFLECTION_REQUIRED");
      if (kind === "deduction" && !state.boundary) throw new Error("BOUNDARY_REQUIRED");
      if(/不知道|不会|不懂|没有思路|没思路|不确定|帮帮|提示|help|don.?t know|no idea/i.test(text)) {
        this._persist({...this.data,lessons:{...this.data.lessons,[id]:{...state,[kind+'Draft']:text.trim(),help:{kind,level:1}}}});
        return {needsHelp:true};
      }
      const next={...state,[kind]:text.trim(),[kind+'Draft']:'',help:null};
      this._persist({...this.data,lessons:{...this.data.lessons,[id]:next}});
      return {recorded:true,proofVerified:false};
    }
    requestHint(id,kind) {
      const state=this.state(id);
      if(!['boundary','deduction'].includes(kind))throw new Error('REFLECTION_KIND_INVALID');
      const help={kind,level:Math.min(2,(state.help?.level||0)+1)};
      this._persist({...this.data,lessons:{...this.data.lessons,[id]:{...state,help}}});
      return help;
    }
    next(id) {
      const state = this.state(id);
      if (state.phase !== "practice" || !state.passed.includes("practice")) throw new Error("PRACTICE_REQUIRED");
      if (!state.boundary || !state.deduction || state.help) throw new Error("REFLECTION_REQUIRED");
      this._persist({...this.data,lessons:{...this.data.lessons,[id]:{...state,phase:'transfer',draft:'',lastResult:null}}});
    }
    export() {
      return JSON.stringify({ schema: "wenju-course-journal/1", libraryVersion: library.version, ...this.data }, null, 2);
    }
    reset() {
      this.data = { version: 1, lessons: {}, attempts: [],sessions:{},activeSessionId:this.data.activeSessionId||null };
      this.save();
      this.tracker?.resetProfile();
    }
  }
  return { CourseProgress };
});
