/**
 * 问矩 · CQRS & Event Sourcing 时空轨迹与事件记录仪 (TrajectoryRecorder v3.0)
 * 深度融合 CQRS (Command Query Responsibility Segregation) 与 Event Sourcing
 * 
 * 核心架构：
 * 1. 写侧 (Command Side): Append-Only 不可变事件流存储 (EventStore)
 *    - 严格单调递增版本号 (version 0, 1, 2, ...)
 *    - 领域事件规范 DomainEvent: { aggregate_id, event_type, version, timestamp, payload }
 *    - 严禁就地修改聚合根，所有状态变更由事件产生并不可变存储
 * 2. 读侧 (Query Side): EventProjector 异步投影物化视图 (Read Projections)
 *    - MatrixHUDView (a, b, c, d, det, rank, isSingular, nullBasis, colBasis)
 *    - CanvasGraphicsView (zoom, pan, activeVectors, customShapes)
 *    - CognitiveMasteryView (stageId, scaffoldLevel, tokenQuota, masteredNodes)
 *    - SessionAuditListView (全链路会话审计流)
 * 3. 聚合重放引擎 (Replay Engine):
 *    - 从 Version 0 无损顺序重放，支持时间旅行至任意历史时刻 rebuildStateAtVersion(targetVersion)
 * 4. 向后兼容原有时空快照 (record, scrubTo, undo, redo) 与会话审计 (recordSession, exportToJSONL)
 */

class EventProjector {
  constructor() {
    this.reset();
  }

  reset() {
    this.matrixHUD = {
      elements: [[1, 0], [0, 1]],
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      det: 1.0,
      rank: 2,
      isSingular: false,
      nullBasis: [],
      colBasis: [[1, 0], [0, 1]]
    };
    this.canvasGraphics = {
      zoom: 1.0,
      pan: [0, 0],
      activeVectors: [],
      customShapes: []
    };
    this.cognitiveMastery = {
      stageId: 'PERCEIVE',
      scaffoldLevel: 1,
      tokenQuota: 450,
      masteredNodes: []
    };
    this.sessionAuditList = [];
    this.lastProjectedVersion = -1;
  }

  /**
   * 纯函数式投影单个领域事件至读侧物化视图
   * @param {Object} event 领域事件
   */
  project(event) {
    if (!event || typeof event !== 'object') return;
    const { event_type, payload } = event;

    switch (event_type) {
      case 'MATRIX_TRANSFORMED':
      case 'BASIS_DRAGGED': {
        if (payload) {
          const m = payload.matrixState || payload;
          const elements = m.elements || [[m.a ?? 1, m.b ?? 0], [m.c ?? 0, m.d ?? 1]];
          const a = elements[0]?.[0] ?? 1;
          const b = elements[0]?.[1] ?? 0;
          const c = elements[1]?.[0] ?? 0;
          const d = elements[1]?.[1] ?? 1;
          const det = typeof m.det === 'number' ? m.det : (a * d - b * c);
          const isSingular = Math.abs(det) < 1e-6;
          const rank = typeof m.rank === 'number' ? m.rank : (isSingular ? (a === 0 && b === 0 && c === 0 && d === 0 ? 0 : 1) : 2);
          
          this.matrixHUD = {
            elements,
            a, b, c, d,
            det,
            rank,
            isSingular,
            nullBasis: m.nullBasis || (isSingular && rank === 1 ? [[-b, a]] : []),
            colBasis: m.colBasis || [[a, c], [b, d]]
          };
        }
        break;
      }

      case 'CANVAS_VIEWPORT_CHANGED': {
        if (payload) {
          const cv = payload.canvasView || payload;
          this.canvasGraphics = {
            zoom: cv.zoom ?? this.canvasGraphics.zoom,
            pan: cv.pan ? [...cv.pan] : this.canvasGraphics.pan,
            activeVectors: cv.activeVectors ? JSON.parse(JSON.stringify(cv.activeVectors)) : this.canvasGraphics.activeVectors,
            customShapes: cv.customShapes ? JSON.parse(JSON.stringify(cv.customShapes)) : this.canvasGraphics.customShapes
          };
        }
        break;
      }

      case 'COGNITIVE_STAGE_ADVANCED': {
        if (payload) {
          const sc = payload.scaffoldingState || payload;
          this.cognitiveMastery = {
            stageId: sc.stageId || this.cognitiveMastery.stageId,
            scaffoldLevel: sc.scaffoldLevel ?? this.cognitiveMastery.scaffoldLevel,
            tokenQuota: sc.tokenQuota ?? this.cognitiveMastery.tokenQuota,
            masteredNodes: sc.masteredNodes ? [...sc.masteredNodes] : this.cognitiveMastery.masteredNodes
          };
        }
        break;
      }

      case 'SESSION_RECORDED': {
        if (payload) {
          this.sessionAuditList.unshift(JSON.parse(JSON.stringify(payload)));
        }
        break;
      }

      case 'SNAPSHOT_RECORDED': {
        // 综合快照复合事件，同时投影矩阵、画布与认知状态
        if (payload) {
          if (payload.matrixState) {
            this.project({ event_type: 'MATRIX_TRANSFORMED', payload: payload.matrixState });
          }
          if (payload.canvasView) {
            this.project({ event_type: 'CANVAS_VIEWPORT_CHANGED', payload: payload.canvasView });
          }
          if (payload.scaffoldingState) {
            this.project({ event_type: 'COGNITIVE_STAGE_ADVANCED', payload: payload.scaffoldingState });
          }
        }
        break;
      }

      default:
        // 允许未知事件扩展，不阻断
        break;
    }

    if (typeof event.version === 'number') {
      this.lastProjectedVersion = Math.max(this.lastProjectedVersion, event.version);
    }
  }

  getMatrixHUD() {
    return JSON.parse(JSON.stringify(this.matrixHUD));
  }

  getCanvasGraphics() {
    return JSON.parse(JSON.stringify(this.canvasGraphics));
  }

  getCognitiveMastery() {
    return JSON.parse(JSON.stringify(this.cognitiveMastery));
  }

  getSessionAuditList() {
    return JSON.parse(JSON.stringify(this.sessionAuditList));
  }
}

class TrajectoryRecorder {
  /**
   * 构造自适应 TrajectoryRecorder
   * 兼容选项对象 { storageKey, maxSnapshots, maxRecords } 或 Phase 1 双形参 (storageKey, maxRecords)
   */
  constructor(optionsOrKey = {}, maybeMaxRecords = 50) {
    let options = {};
    if (typeof optionsOrKey === 'string') {
      options = { storageKey: optionsOrKey, maxRecords: maybeMaxRecords, maxSnapshots: maybeMaxRecords };
    } else if (typeof optionsOrKey === 'object' && optionsOrKey !== null) {
      options = optionsOrKey;
    }

    this.storageKey = options.storageKey || 'wenju_trajectory_archive';
    this.sessionStorageKey = options.sessionStorageKey || 'wenju_trajectories';
    this.maxSnapshots = options.maxSnapshots || options.maxRecords || 100;
    this.maxRecords = options.maxRecords || options.maxSnapshots || 50;

    // CQRS 写侧: 不可变事件存储
    this.eventStore = [];

    // CQRS 读侧: 异步/物化视图投影器
    this.projector = new EventProjector();

    // 时空快照栈 (用于时间旅行与 UI 快速回放)
    this.snapshots = [];
    this.currentIndex = -1;

    // Phase 1 会话列表内存缓存
    this.inMemorySessions = [];

    // 观察者监听器
    this.listeners = new Set();

    this.loadFromStorage();
  }

  // ==========================================
  // 一、 CQRS 写侧 (Command Side): Append-Only Event Store
  // ==========================================

  /**
   * 追加不可变领域事件
   * @param {Object} command 领域事件命令
   * @returns {Object} 冻结的不可变领域事件
   */
  appendEvent(command = {}) {
    const aggregate_id = command.aggregate_id || 'workspace_matrix_2d';
    const event_type = command.event_type || 'MATRIX_TRANSFORMED';
    const timestamp = command.timestamp || Date.now();
    const version = this.eventStore.length;
    
    // 深度克隆以确保隔离
    const clonedPayload = command.payload ? JSON.parse(JSON.stringify(command.payload)) : {};

    const domainEvent = Object.freeze({
      aggregate_id,
      event_type,
      version,
      timestamp,
      payload: Object.freeze(clonedPayload)
    });

    this.eventStore.push(domainEvent);

    // 读侧实时投影物化视图
    this.projector.project(domainEvent);

    this.saveToStorage();
    this.notify();
    return domainEvent;
  }

  /**
   * 读取写侧不可变事件流切片 (只读防篡改)
   * @param {number} fromVersion 起始版本号
   * @returns {Array} 不可变事件流
   */
  getEvents(fromVersion = 0) {
    return this.eventStore.slice(fromVersion).map(e => JSON.parse(JSON.stringify(e)));
  }

  // ==========================================
  // 二、 CQRS 读侧 (Query Side): 物化视图查询
  // ==========================================

  getMatrixHUD() {
    return this.projector.getMatrixHUD();
  }

  getCanvasGraphics() {
    return this.projector.getCanvasGraphics();
  }

  getCognitiveMastery() {
    return this.projector.getCognitiveMastery();
  }

  // ==========================================
  // 三、 聚合重放引擎 (Replay Engine) 与时间旅行
  // ==========================================

  /**
   * 从版本 0 顺序重放事件流至指定版本，构建确定性状态
   * @param {number} targetVersion 目标版本号 (0-based)
   * @returns {Object} 目标版本物化状态
   */
  rebuildStateAtVersion(targetVersion) {
    if (typeof targetVersion !== 'number' || targetVersion < 0) {
      targetVersion = 0;
    }
    const safeTarget = Math.min(targetVersion, this.eventStore.length - 1);
    const replayProjector = new EventProjector();

    for (let v = 0; v <= safeTarget; v++) {
      const event = this.eventStore[v];
      if (event) {
        replayProjector.project(event);
      }
    }

    return {
      version: safeTarget,
      matrixHUD: replayProjector.getMatrixHUD(),
      canvasGraphics: replayProjector.getCanvasGraphics(),
      cognitiveMastery: replayProjector.getCognitiveMastery()
    };
  }

  /**
   * 独立重放任意外部领域事件流
   * @param {Array} events 领域事件流
   * @returns {EventProjector} 投影结果
   */
  replay(events = []) {
    const replayProjector = new EventProjector();
    if (Array.isArray(events)) {
      for (const ev of events) {
        replayProjector.project(ev);
      }
    }
    return replayProjector;
  }

  // ==========================================
  // 四、 时空快照记录与历史回溯 (Snapshot & Scrubbing)
  // ==========================================

  /**
   * 注册快照变更监听器
   */
  subscribe(listener) {
    if (typeof listener === 'function') {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
    return () => {};
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.getCurrentSnapshot(), this.currentIndex, this.snapshots.length);
      } catch (e) {
        console.error('[TrajectoryRecorder] Listener error:', e);
      }
    }
  }

  /**
   * 创建并压入新时空快照 (与 CQRS 事件源同步)
   * @param {Object} payload 包含 matrixState, canvasView, dialogueDelta, scaffoldingState 等
   * @returns {Object} 生成的 Snapshot
   */
  record(payload = {}) {
    // 若当前处于历史回溯态，新动作截断后续未来分支 (Git-like Branching)
    if (this.currentIndex >= 0 && this.currentIndex < this.snapshots.length - 1) {
      this.snapshots = this.snapshots.slice(0, this.currentIndex + 1);
    }

    const stepIndex = this.snapshots.length;
    const snapshot = {
      snapshotId: 'snap_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: Date.now(),
      stepIndex,
      matrixState: payload.matrixState ? JSON.parse(JSON.stringify(payload.matrixState)) : {
        elements: [[1, 0], [0, 1]],
        det: 1.0,
        rank: 2,
        isSingular: false,
        nullBasis: [],
        colBasis: [[1, 0], [0, 1]]
      },
      canvasView: payload.canvasView ? JSON.parse(JSON.stringify(payload.canvasView)) : {
        zoom: 1.0,
        pan: [0, 0],
        activeVectors: []
      },
      dialogueDelta: payload.dialogueDelta ? JSON.parse(JSON.stringify(payload.dialogueDelta)) : {
        role: 'user',
        content: '',
        thoughtChain: ''
      },
      scaffoldingState: payload.scaffoldingState ? JSON.parse(JSON.stringify(payload.scaffoldingState)) : {
        stageId: 'PERCEIVE',
        actionType: 'CanvasTween',
        scaffoldLevel: 1,
        tokenQuota: 450
      }
    };

    this.snapshots.push(snapshot);
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
    this.currentIndex = this.snapshots.length - 1;

    // 同步写侧领域事件流
    this.appendEvent({
      aggregate_id: 'workspace_matrix_2d',
      event_type: 'SNAPSHOT_RECORDED',
      payload: snapshot
    });

    this.saveToStorage();
    this.notify();
    return snapshot;
  }

  /**
   * 时空穿梭至指定历史步 (Scrub to Step)
   * @param {number} targetIndex 0-based index
   * @returns {Object|null} 目标历史快照
   */
  scrubTo(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.snapshots.length) {
      return null;
    }
    this.currentIndex = targetIndex;
    const snapshot = this.snapshots[this.currentIndex];

    // 同步读侧投影物化视图
    if (snapshot && snapshot.matrixState) {
      this.projector.project({
        event_type: 'SNAPSHOT_RECORDED',
        payload: snapshot
      });
    }

    this.notify();
    return snapshot;
  }

  /**
   * 恢复至最新探究现场 (Live State)
   */
  resumeLatest() {
    if (this.snapshots.length === 0) return null;
    return this.scrubTo(this.snapshots.length - 1);
  }

  canUndo() {
    return this.currentIndex > 0;
  }

  canRedo() {
    return this.currentIndex < this.snapshots.length - 1;
  }

  undo() {
    if (this.canUndo()) {
      return this.scrubTo(this.currentIndex - 1);
    }
    return null;
  }

  redo() {
    if (this.canRedo()) {
      return this.scrubTo(this.currentIndex + 1);
    }
    return null;
  }

  getCurrentSnapshot() {
    if (this.currentIndex >= 0 && this.currentIndex < this.snapshots.length) {
      return this.snapshots[this.currentIndex];
    }
    return null;
  }

  getHistory() {
    return this.snapshots.map((s, idx) => ({
      index: idx,
      snapshotId: s.snapshotId,
      timestamp: s.timestamp,
      summary: s.dialogueDelta?.content?.slice(0, 30) || `Matrix [${s.matrixState?.elements?.[0]?.join(',')} / ${s.matrixState?.elements?.[1]?.join(',')}]`,
      det: s.matrixState?.det,
      rank: s.matrixState?.rank,
      isSingular: s.matrixState?.isSingular
    }));
  }

  // ==========================================
  // 五、 会话审计与 Phase 1 兼容接口
  // ==========================================

  /**
   * 记录完整的单次探究会话轨迹 (Phase 1 兼容)
   * @param {Object} trajectory 会话轨迹对象
   */
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

    const list = this.getAllRecords();
    list.unshift(record);
    if (list.length > this.maxRecords) {
      list.pop();
    }
    this.saveSessionStorage(list);

    // 同步到事件流与读侧投影
    this.appendEvent({
      aggregate_id: record.trace_id,
      event_type: 'SESSION_RECORDED',
      payload: record
    });

    return record;
  }

  getAllRecords() {
    return this.getSessionStorage();
  }

  getRecordById(traceId) {
    return this.getAllRecords().find(r => r.trace_id === traceId) || null;
  }

  /**
   * 导出为标准 JSON-Lines (JSONL) 字符串格式
   */
  exportToJSONL() {
    const list = this.getAllRecords();
    return list.map(item => JSON.stringify(item)).join('\n');
  }

  exportJSON() {
    return JSON.stringify({
      version: '3.0.0',
      exportedAt: Date.now(),
      currentIndex: this.currentIndex,
      snapshots: this.snapshots,
      eventStore: this.eventStore
    }, null, 2);
  }

  importJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (Array.isArray(data.snapshots)) {
        this.snapshots = data.snapshots;
        this.currentIndex = Math.min(data.currentIndex ?? this.snapshots.length - 1, this.snapshots.length - 1);
        if (Array.isArray(data.eventStore)) {
          this.eventStore = data.eventStore;
          this.projector.reset();
          for (const ev of this.eventStore) {
            this.projector.project(ev);
          }
        }
        this.saveToStorage();
        this.notify();
        return true;
      }
    } catch (e) {
      console.error('[TrajectoryRecorder] Failed to import trajectory JSON:', e);
    }
    return false;
  }

  clear() {
    this.snapshots = [];
    this.currentIndex = -1;
    this.eventStore = [];
    this.projector.reset();
    this.saveToStorage();
    this.clearSessionStorage();
    this.notify();
  }

  // ==========================================
  // 六、 本地存储序列化
  // ==========================================

  saveToStorage() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify({
          currentIndex: this.currentIndex,
          snapshots: this.snapshots.slice(-30),
          eventStore: this.eventStore.slice(-50)
        }));
      } catch (e) { if (typeof recordIssue === 'function') recordIssue('TrajectoryRecorder', 'if', e); }
    }
  }

  loadFromStorage() {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.snapshots)) {
            this.snapshots = parsed.snapshots;
            this.currentIndex = parsed.currentIndex ?? this.snapshots.length - 1;
          }
          if (Array.isArray(parsed.eventStore)) {
            this.eventStore = parsed.eventStore;
            this.projector.reset();
            for (const ev of this.eventStore) {
              this.projector.project(ev);
            }
          }
        }
      } catch (e) { if (typeof recordIssue === 'function') recordIssue('TrajectoryRecorder', 'for', e); }
    }
  }

  getSessionStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const data = localStorage.getItem(this.sessionStorageKey);
        if (data) return JSON.parse(data);
      }
    } catch (e) {
      console.warn('Failed to load trajectories from localStorage', e);
    }
    return this.inMemorySessions || [];
  }

  saveSessionStorage(list) {
    this.inMemorySessions = list;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.sessionStorageKey, JSON.stringify(list));
      }
    } catch (e) {
      console.warn('Failed to save trajectories', e);
    }
  }

  clearSessionStorage() {
    this.inMemorySessions = [];
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(this.sessionStorageKey);
      }
    } catch (e) { if (typeof recordIssue === 'function') recordIssue('TrajectoryRecorder', 'if', e); }
  }
}

// 挂载投影器作为静态属性
TrajectoryRecorder.EventProjector = EventProjector;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TrajectoryRecorder, EventProjector };
}
if (typeof window !== 'undefined') {
  window.TrajectoryRecorder = TrajectoryRecorder;
  window.EventProjector = EventProjector;
}
