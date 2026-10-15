/**
 * 问矩 · 全链路认知轨迹记录器 (components/TrajectoryRecorder.js)
 * 向前兼容代理与统一架构桥接器
 * 核心实现已全量收拢至 js/storage/TrajectoryRecorder.js
 */

let ImplTrajectoryRecorder;

if (typeof require !== 'undefined') {
  try {
    const storageModule = require('../js/storage/TrajectoryRecorder.js');
    ImplTrajectoryRecorder = storageModule.TrajectoryRecorder;
  } catch (e) {
    // 忽略加载异常
  }
}

if (!ImplTrajectoryRecorder && typeof window !== 'undefined' && window.TrajectoryRecorder) {
  ImplTrajectoryRecorder = window.TrajectoryRecorder;
}

if (!ImplTrajectoryRecorder) {
  // 单独载入保底实现
  ImplTrajectoryRecorder = class LegacyTrajectoryRecorder {
    constructor(storageKey = 'wenju_trajectories', maxRecords = 50) {
      this.storageKey = storageKey;
      this.maxRecords = maxRecords;
      this.inMemoryStorage = [];
    }

    getStorage() {
      try {
        if (typeof localStorage !== 'undefined') {
          const data = localStorage.getItem(this.storageKey);
          if (data) return JSON.parse(data);
          return [];
        }
      } catch (e) { if (typeof recordIssue === 'function') recordIssue('TrajectoryRecorder', 'if', e); }
      return this.inMemoryStorage || [];
    }

    saveStorage(list) {
      this.inMemoryStorage = list;
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(this.storageKey, JSON.stringify(list));
        }
      } catch (e) { if (typeof recordIssue === 'function') recordIssue('TrajectoryRecorder', 'if', e); }
    }

    recordSession({
      traceId,
      timestamp = new Date().toISOString(),
      query,
      hasImage = false,
      initialMatrix,
      finalMatrix,
      thoughtText,
      durationSeconds,
      steps = [],
      answerText,
      modelName = "deepseek-reasoner",
      pechdtStage = "CONFLICT"
    }) {
      const record = {
        trace_id: traceId || 'trace_' + Math.random().toString(36).substring(2, 9),
        timestamp,
        query,
        has_image: hasImage,
        initial_matrix: initialMatrix,
        final_matrix: finalMatrix,
        thought_text: thoughtText,
        duration_seconds: parseFloat(durationSeconds || 0),
        steps_count: steps.length,
        steps: steps.map((s, idx) => ({
          span_id: s.id || `span_${idx}`,
          title: s.title,
          detail: s.detail,
          status: s.status || 'success',
          args: s.args,
          result: s.result
        })),
        answer_text: answerText,
        model_name: modelName,
        pechdt_stage: pechdtStage
      };

      const list = this.getStorage();
      list.unshift(record);
      if (list.length > this.maxRecords) {
        list.pop();
      }
      this.saveStorage(list);
      return record;
    }

    getAllRecords() {
      return this.getStorage();
    }

    getRecordById(traceId) {
      return this.getStorage().find(r => r.trace_id === traceId) || null;
    }

    exportToJSONL() {
      const list = this.getStorage();
      return list.map(item => JSON.stringify(item)).join('\n');
    }

    clear() {
      this.inMemoryStorage = [];
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(this.storageKey);
        }
      } catch (e) { if (typeof recordIssue === 'function') recordIssue('TrajectoryRecorder', 'if', e); }
    }
  };
}

if (typeof window !== 'undefined' && !window.TrajectoryRecorder) {
  window.TrajectoryRecorder = ImplTrajectoryRecorder;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TrajectoryRecorder: ImplTrajectoryRecorder };
}
