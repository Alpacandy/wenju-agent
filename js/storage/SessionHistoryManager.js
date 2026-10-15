/**
 * 问矩 · 多任务探究会话与历史管理系统 (SessionHistoryManager v1.0)
 * 对标 ZCode TaskList, TaskListItem 与 SessionStore 规范
 * 集中管理多任务会话生命周期、快照持久化、会话切换、置顶、重命名与全文检索
 */

const PORT_KEY = 'session_history_v1'; // P6-A2：端口（IndexedDB/SQLite）快照键

let PayloadMigrationsApi = null;
if (typeof require !== 'undefined') {
  try { PayloadMigrationsApi = require('./PayloadMigrations.js'); } catch (error) { PayloadMigrationsApi = null; }
}
if (!PayloadMigrationsApi && typeof window !== 'undefined') PayloadMigrationsApi = window.PayloadMigrations;

class SessionHistoryManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || 'teachagent_sessions';
    this.activeKey = options.activeKey || 'teachagent_active_session_id';
    this.maxSessions = options.maxSessions || 50;
    this.storageBackend = options.storageBackend || (typeof window !== 'undefined' && window.__TEACHAGENT_STORAGE_BACKEND__) || 'localStorage';
    this.ttlMs = options.ttlMs !== undefined
      ? Number(options.ttlMs)
      : (Number(typeof window !== 'undefined' && window.__TEACHAGENT_SESSION_TTL_MS__) || 8 * 60 * 1000); // 默认8分钟滑动即焚 (480,000ms)
    this.lastActiveAt = Date.now();
    this.port = null;          // P6-A2：存储端口（attachPort 挂载）
    this._revision = 0;
    this._mirrorTail = Promise.resolve();
    this._mirrorError = null;
    this._savedAt = null;      // 本地最近持久化时间（端口对比用）
    this._legacyShape = false; // 读到历史裸数组格式（下次保存自动迁移为信封）
    this.sessions = this._loadSessions();
    this.activeSessionId = this._loadActiveSessionId();
    this.listeners = new Set();

    // 确保至少存在一个初始会话
    if (this.sessions.length === 0) {
      const initialSession = this._createSessionRaw('新探究任务');
      this.sessions = [initialSession];
      this.activeSessionId = initialSession.id;
      this._saveSessions();
      this._saveActiveSessionId();
    } else if (!this.activeSessionId || !this.sessions.some(s => s.id === this.activeSessionId)) {
      this.activeSessionId = this.sessions[0].id;
      this._saveActiveSessionId();
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  _notify(event, data) {
    for (const fn of this.listeners) {
      try {
        fn(event, data);
      } catch (err) {
        console.error('[SessionHistoryManager] listener error:', err);
      }
    }
  }

  _getStorage() {
    if (this.storageBackend === 'sessionStorage' && typeof sessionStorage !== 'undefined') {
      return sessionStorage;
    }
    if (typeof localStorage !== 'undefined') return localStorage;
    if (typeof sessionStorage !== 'undefined') return sessionStorage;
    return null;
  }

  _loadSessions() {
    const s = this._getStorage();
    if (!s) return [];
    try {
      const raw = s.getItem(this.storageKey);
      this._hadLocalState = raw != null; // P6-A2：本地是否曾有会话状态（区分"新设备"与"用户删空"）
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      // TTL 过期判定：若超过设定 TTL（如 5 分钟），自动抹除历史会话并重置，保障即焚隐私与内存无残留
      if (this.ttlMs > 0 && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const savedAt = Number(parsed.savedAt || 0);
        if (savedAt > 0 && (Date.now() - savedAt > this.ttlMs)) {
          try {
            s.removeItem(this.storageKey);
            s.removeItem(this.activeKey);
          } catch (_) { if (typeof recordIssue === 'function') recordIssue('SessionHistoryManager', 'ttl_clear', _); }
          return [];
        }
      }
      // P7：统一版本迁移（zcode migration-runner 语义）——裸数组 v0 → 信封 v1；失败显式记录且不写半迁移态
      if (Array.isArray(parsed)) this._legacyShape = true;
      if (PayloadMigrationsApi && typeof PayloadMigrationsApi.runMigrations === 'function') {
        const mig = PayloadMigrationsApi.runMigrations(parsed, 'session_history');
        if (mig.ok) {
          this._savedAt = mig.payload.savedAt || null;
          this._migratedFrom = mig.fromVersion === mig.toVersion ? null : { from: mig.fromVersion, to: mig.toVersion, applied: mig.applied };
          return Array.isArray(mig.payload.sessions) ? mig.payload.sessions : [];
        }
        this._migrationError = { code: mig.code, at: mig.at || null, message: mig.message || null };
        if (typeof recordIssue === 'function') recordIssue('SessionHistoryManager', 'migrate_sessions', this._migrationError);
        return [];
      }
      // 迁移器不可用（极端降级）：保留形状判定
      if (parsed && Array.isArray(parsed.sessions)) {
        this._savedAt = parsed.savedAt || null;
        return parsed.sessions;
      }
      return [];
    } catch (error) {
      this._loadError = { code: 'SESSION_STORAGE_CORRUPT', message: String(error.message) };
      if (typeof recordIssue === 'function') recordIssue('SessionHistoryManager', 'load_sessions', this._loadError);
      return [];
    }
  }

  _saveSessions() {
    const s = this._getStorage();
    this._revision += 1;
    const payload = { schemaVersion: 1, sessions: this.sessions, activeSessionId: this.activeSessionId, savedAt: Math.max(Date.now(), (this._savedAt || 0) + 1) };
    if (s) {
      try {
        s.setItem(this.storageKey, JSON.stringify(payload));
      } catch (e) {
        console.warn('[SessionHistoryManager] 保存会话失败:', e);
        this._notify('storage_error', { code: 'SESSION_SAVE_FAILED', message: '会话保存失败，请导出记录或释放本机存储后重试。' });
        return false;
      }
    }
    this._savedAt = payload.savedAt;
    // P6-A2：端口镜像（IndexedDB / Host SQLite）——异步写，失败不影响主路径
    if (this.port) this._queueMirror(payload);
    return true;
  }

  _queueMirror(payload) {
    this._pendingMirror = { port: this.port, snapshot: JSON.parse(JSON.stringify(payload)) };
    if (this._mirrorRunning) return;
    this._mirrorRunning = true;
    this._mirrorTail = (async () => {
      try {
        while (this._pendingMirror) {
          const { port, snapshot } = this._pendingMirror; this._pendingMirror = null;
          try { await port.set(PORT_KEY, snapshot); this._mirrorError = null; }
          catch (error) {
            this._mirrorError = { code: 'SESSION_MIRROR_FAILED', message: '会话备份失败，本机保存仍保留。', error: String(error.message || error) };
            this._notify('storage_error', this._mirrorError);
          }
        }
      } finally { this._mirrorRunning = false; }
    })();
  }

  async flush({ timeoutMs = 5000 } = {}) {
    let timer;
    try {
      await Promise.race([this._mirrorTail, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('会话备份超时，请重试。'), { code: 'SESSION_MIRROR_TIMEOUT' })), timeoutMs); })]);
      return this._mirrorError ? { ok: false, ...this._mirrorError } : { ok: true };
    } catch (error) { return { ok: false, code: error.code || 'SESSION_MIRROR_FAILED', message: error.message }; }
    finally { clearTimeout(timer); }
  }

  _loadActiveSessionId() {
    const s = this._getStorage();
    if (!s) return null;
    try { return s.getItem(this.activeKey) || null; } catch (_) { return null; }
  }

  _saveActiveSessionId() {
    const s = this._getStorage();
    if (s) {
      try {
        if (this.activeSessionId) {
          s.setItem(this.activeKey, this.activeSessionId);
        } else {
          s.removeItem(this.activeKey);
        }
      } catch (_) { if (typeof recordIssue === 'function') recordIssue('SessionHistoryManager', 'if', _); }
    }
  }

  /** P6-A2：挂载存储端口（会话 SQLite 化就绪——IndexedDB 为浏览器终态，SQLite 归 Host） */
  attachPort(port) { this.port = port || null; return this; }

  /**
   * P6-A2：端口优先恢复。规则（区分"本地无历史状态"与"用户删空"，不销毁本地真实数据、不复活已删会话）：
   *   1) 本地无历史状态（首次运行/localStorage 被清或驱逐，当前仅占位空会话）→ 采用端口快照；
   *   2) 本地有真实数据：端口 savedAt 严格更新 → 采用端口；否则保留本地（source=local-newer），必要时回刷端口；
   *   3) 本地曾有状态但当前已空（用户删空）→ 保留本地，不复活端口旧会话。
   * 说明：端口为同源同 profile 的大容量后端（IndexedDB）；跨设备同步不在浏览器侧能力范围（Host 阶段）。
   * @returns {{ok:boolean, source:'port'|'local-kept'|'local-newer', sessions?:number, savedAt?:number, code?:string}}
   */
  async rehydrate() {
    if (!this.port) return { ok: false, code: 'NO_PORT' };
    const port = this.port, revision = this._revision;
    let remote = null;
    try { remote = await port.get(PORT_KEY); } catch (e) { return { ok: false, code: e.code || 'PORT_ERROR', message: String(e && e.message || e) }; }
    if (revision !== this._revision || port !== this.port) return { ok: true, source: 'local-changed', sessions: this.sessions.length };
    if (!remote || !Array.isArray(remote.sessions)) return { ok: false, code: 'PORT_EMPTY' };

    const localHasRealData = this._legacyShape === true || this.sessions.length > 1
      || this.sessions.some((s) => s.workspace || s.composerDraft || (Array.isArray(s.messages) && s.messages.length > 0) || (Array.isArray(s.turns) && s.turns.length > 0));
    const freshDevice = this._hadLocalState !== true && !localHasRealData;

    const adoptPort = () => {
      const previous = { sessions: this.sessions, activeSessionId: this.activeSessionId, savedAt: this._savedAt };
      this.sessions = remote.sessions;
      this.activeSessionId = (remote.activeSessionId && remote.sessions.some((s) => s.id === remote.activeSessionId))
        ? remote.activeSessionId : (remote.sessions[0] ? remote.sessions[0].id : null);
      this._savedAt = remote.savedAt || null;
      if (!this._saveSessions()) {
        this.sessions = previous.sessions; this.activeSessionId = previous.activeSessionId; this._savedAt = previous.savedAt;
        return { ok: false, code: 'SESSION_SAVE_FAILED' };
      }
      this._saveActiveSessionId();
      this._notify('sessions_rehydrated', { source: 'port', sessions: this.sessions.length });
      return { ok: true, source: 'port', sessions: this.sessions.length, savedAt: this._savedAt };
    };

    if (freshDevice && remote.sessions.length) return adoptPort();
    if (localHasRealData) {
      if (remote.savedAt && this._savedAt && remote.savedAt > this._savedAt) return adoptPort();
      if (remote.savedAt && this._savedAt && this._savedAt > remote.savedAt) this._saveSessions(); // 本地更新 → 回刷端口
      return { ok: true, source: 'local-newer', sessions: this.sessions.length, savedAt: this._savedAt };
    }
    // 本地曾有状态但当前已空（删空语义）→ 保留本地；本地更新时回刷端口，避免端口旧会话复活
    if (this._savedAt && remote.savedAt && this._savedAt > remote.savedAt) this._saveSessions();
    return { ok: true, source: 'local-kept', sessions: this.sessions.length, savedAt: this._savedAt };
  }

  /** P7-H1 竞态修复：端口挂接后补推当前状态（挂接前发生的写入在端口不可见） */
  syncToPort() { if (!this.port) return false; return this._saveSessions(); }

  _createSessionRaw(title = '新探究任务', matrixState = null) {
    const now = Date.now();
    const rand = Math.random().toString(36).substring(2, 7);
    return {
      id: `task_${now}_${rand}`,
      title: title.trim() || '新探究任务',
      createdAt: now,
      updatedAt: now,
      pinned: false,
      messages: [],
      turns: [],
      matrixState: matrixState || {
        e1: [1.0, 0.0],
        e2: [0.0, 1.0],
        det: 1.0,
        rank: 2
      },
      cognitiveStage: 'PERCEIVE'
    };
  }

  getAllSessions() {
    // 置顶项优先，其次按更新时间倒序
    return [...this.sessions].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }

  getActiveSessionId() {
    return this.activeSessionId;
  }

  getActiveSession() {
    return this.sessions.find(s => s.id === this.activeSessionId) || this.sessions[0] || null;
  }

  getSessionById(id) {
    const s = this.sessions.find(s => s.id === id) || null;
    if (s && !s.turns) s.turns = s.messages || [];
    return s;
  }

  getSession(id) {
    return this.getSessionById(id);
  }

  createSession(title = '', matrixState = null) {
    if (this.sessions.length >= this.maxSessions) {
      const error = new Error(`SESSION_LIMIT_REACHED：已达到 ${this.maxSessions} 条会话上限。请先导出并删除不再需要的任务；已有记录已保留。`);
      error.code = 'SESSION_LIMIT_REACHED';
      throw error;
    }
    const count = this.sessions.length + 1;
    const finalTitle = title.trim() || `几何探究任务 #${count}`;
    const newSession = this._createSessionRaw(finalTitle, matrixState);
    const previousId = this.activeSessionId;
    this.sessions.unshift(newSession);
    this.activeSessionId = newSession.id;
    if (!this._saveSessions()) { this.sessions.shift(); this.activeSessionId=previousId; throw new Error('SESSION_SAVE_FAILED：新会话未保存，当前任务已保留。'); }
    this._saveActiveSessionId();
    this._notify('session_created', newSession);
    return newSession;
  }

  setActiveSessionId(id) {
    if (!id || this.activeSessionId === id) return this.getSessionById(id);
    const exists = this.sessions.some(s => s.id === id);
    if (!exists) return null;
    const previous = this.activeSessionId;
    this.activeSessionId = id;
    if (!this._saveSessions()) { this.activeSessionId = previous; throw new Error('SESSION_SAVE_FAILED：切换未保存，当前任务已保留。'); }
    this._saveActiveSessionId();
    const session = this.getSessionById(id);
    this._notify('session_switched', session);
    return session;
  }

  setActiveSession(id) {
    return this.setActiveSessionId(id);
  }

  renameSession(id, newTitle) {
    const trimmed = (newTitle || '').trim();
    if (!trimmed) return null;
    const session = this.getSessionById(id);
    if (!session) return null;
    const previous = { title: session.title, updatedAt: session.updatedAt };
    session.title = trimmed;
    session.updatedAt = Date.now();
    if (!this._saveSessions()) { Object.assign(session, previous); throw new Error('SESSION_SAVE_FAILED：重命名未保存。'); }
    this._notify('session_renamed', session);
    return session;
  }

  togglePinSession(id) {
    const session = this.getSessionById(id);
    if (!session) return false;
    const previous = { pinned: session.pinned, updatedAt: session.updatedAt };
    session.pinned = !session.pinned;
    session.updatedAt = Date.now();
    if (!this._saveSessions()) { Object.assign(session, previous); throw new Error('SESSION_SAVE_FAILED：置顶未保存。'); }
    this._notify('session_pinned', session);
    return session.pinned;
  }

  deleteSession(id) {
    const idx = this.sessions.findIndex(s => s.id === id);
    if (idx === -1) return false;
    const previous = { sessions: [...this.sessions], activeSessionId: this.activeSessionId };
    const [deleted] = this.sessions.splice(idx, 1);
    
    // 如果删除了全部，补建一个默认任务
    if (this.sessions.length === 0) {
      const fresh = this._createSessionRaw('新探究任务');
      this.sessions = [fresh];
      this.activeSessionId = fresh.id;
    } else if (this.activeSessionId === id) {
      // 切换到列表第一个会话
      this.activeSessionId = this.sessions[0].id;
    }
    
    if (!this._saveSessions()) { this.sessions = previous.sessions; this.activeSessionId = previous.activeSessionId; throw new Error('SESSION_SAVE_FAILED：删除未保存，记录已保留。'); }
    this._saveActiveSessionId();

    // 级联清理该会话在 localStorage 中的关联工件存储，防止僵尸工件引发 QuotaExceededError
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('wenju_artifacts_v1:' + encodeURIComponent(id));
      }
    } catch (err) {
      if (typeof recordIssue === 'function') {
        recordIssue('SessionHistoryManager', 'cleanup_artifacts', err, { id });
      }
    }

    this._notify('session_deleted', deleted);
    return true;
  }

  saveWorkspace(sessionId, snapshot) {
    const session = this.getSessionById(sessionId);
    if (!session) return false;
    const previous = session.workspace;
    session.workspace = JSON.parse(JSON.stringify(snapshot));
    if (!this._saveSessions()) { if (previous === undefined) delete session.workspace; else session.workspace = previous; return false; }
    return true;
  }

  saveDraft(sessionId, text) {
    const session=this.getSessionById(sessionId);
    if(!session)return false;
    if(typeof text!=='string'||text.length>16000)throw new Error('DRAFT_LIMIT_REACHED：草稿最多 16000 个字符，请分段发送。');
    if(session.composerDraft===text)return true;
    const previous=session.composerDraft;
    session.composerDraft=text;
    if(!this._saveSessions()){session.composerDraft=previous;return false;}
    return true;
  }

  clearSession(sessionId) {
    const session=this.getSessionById(sessionId);
    if(!session)throw new Error('SESSION_NOT_FOUND');
    const previous={...session};
    Object.assign(session,{turns:[],messages:[],composerDraft:'',workspace:{...session.workspace,teaching:{}},cognitiveStage:'IDLE',updatedAt:Date.now()});
    if(!this._saveSessions()){Object.assign(session,previous);throw new Error('SESSION_SAVE_FAILED：清空未保存，原记录已保留。');}
    this._notify('session_cleared',session);
    return session;
  }

  importSessions(importedSessions) {
    if (!Array.isArray(importedSessions) || importedSessions.length === 0) {
      throw new Error('导入数据中未包含有效的会话列表');
    }
    let count = 0;
    const existingMap = new Map(this.sessions.map(s => [s.id, s]));
    for (const raw of importedSessions) {
      if (!raw || typeof raw !== 'object' || !raw.id) continue;
      const cleanSession = {
        id: String(raw.id),
        title: String(raw.title || '导入任务').trim(),
        createdAt: Number(raw.createdAt) || Date.now(),
        updatedAt: Number(raw.updatedAt) || Date.now(),
        pinned: Boolean(raw.pinned),
        messages: Array.isArray(raw.messages) ? raw.messages : (Array.isArray(raw.turns) ? raw.turns : []),
        turns: Array.isArray(raw.turns) ? raw.turns : (Array.isArray(raw.messages) ? raw.messages : []),
        matrixState: raw.matrixState || { e1: [1, 0], e2: [0, 1], det: 1, rank: 2 },
        cognitiveStage: raw.cognitiveStage || 'PERCEIVE',
        workspace: raw.workspace || null,
        composerDraft: typeof raw.composerDraft === 'string' ? raw.composerDraft : ''
      };
      existingMap.set(cleanSession.id, cleanSession);
      count++;
    }
    if (count === 0) {
      throw new Error('导入数据中未找到格式合规的会话对象');
    }
    this.sessions = Array.from(existingMap.values());
    if (this.sessions.length > this.maxSessions) {
      this.sessions = this.sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, this.maxSessions);
    }
    this._saveSessions();
    this._notify('sessions_imported', { count, total: this.sessions.length });
    return { ok: true, importedCount: count, total: this.sessions.length };
  }

  appendTurn(sessionId, turnData) {
    const sid = sessionId || this.activeSessionId;
    const session = this.getSessionById(sid);
    if (!session) return null;

    const userText = turnData.userText || turnData.userQuery || '';
    const answerText = turnData.answerText || turnData.assistantResponse || '';
    const thoughtText = turnData.thoughtText || turnData.thoughtChain || '';
    const now = Date.now();

    // 智能标题提升：如果是默认标题，根据用户首轮提问自动生成具体标题
    const isDefaultTitle = session.title.startsWith('新探究任务') || session.title.startsWith('几何探究任务 #');
    if (isDefaultTitle && userText.trim().length > 0) {
      let candidateTitle = userText.trim().replace(/^[\/|@][^\s]+\s*/, '');
      if (candidateTitle.length > 22) {
        candidateTitle = candidateTitle.slice(0, 22) + '...';
      }
      if (candidateTitle) {
        session.title = candidateTitle;
      }
    }

    const turnRecord = {
      turnId: `turn_${now}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: now,
      userText: userText,
      userQuery: userText,
      userImg: turnData.userImg || null,
      thoughtText: thoughtText,
      thoughtChain: thoughtText,
      steps: Array.isArray(turnData.steps) ? turnData.steps : [],
      answerText: answerText,
      assistantResponse: answerText,
      status: turnData.status || 'completed',
      mode: turnData.mode || 'cloud',
      elapsedSeconds: turnData.elapsedSeconds || 0,
      bannerText: turnData.bannerText || '',
      matrixState: turnData.matrixState || null,
      artifacts: turnData.artifacts || ''
    };

    if (!Array.isArray(session.turns)) session.turns = Array.isArray(session.messages) ? session.messages : [];
    session.turns.push(turnRecord);
    session.messages = session.turns;
    session.updatedAt = now;
    if (turnData.matrixState) {
      session.matrixState = turnData.matrixState;
    }
    if (turnData.cognitiveStage) {
      session.cognitiveStage = turnData.cognitiveStage;
    }

    this._saveSessions();
    this._notify('turn_appended', { session, turn: turnRecord });
    return turnRecord;
  }

  searchSessions(keyword) {
    const q = (keyword || '').trim().toLowerCase();
    if (!q) return this.getAllSessions();
    return this.getAllSessions().filter(s => {
      if (s.title.toLowerCase().includes(q)) return true;
      return s.messages.some(m => 
        (m.userText && m.userText.toLowerCase().includes(q)) ||
        (m.answerText && m.answerText.toLowerCase().includes(q)) ||
        (m.thoughtText && m.thoughtText.toLowerCase().includes(q))
      );
    });
  }

  /** 刷新用户最近交互时间戳 */
  touch() {
    this.lastActiveAt = Date.now();
  }

  /**
   * 检查闲置是否超期；若超过设定 TTL（默认 5 分钟），自动清空并归位初始状态
   * @returns {boolean} true 表示已触发超时重置
   */
  checkTtlExpired() {
    if (this.ttlMs > 0 && (Date.now() - this.lastActiveAt > this.ttlMs)) {
      this.resetToInitialSession('新探究任务 (已自动清理超时会话)');
      this._notify('session_expired', { reason: 'IDLE_TIMEOUT', ttlMs: this.ttlMs });
      return true;
    }
    return false;
  }

  /**
   * 抹除当前存储中全部历史会话，重置为单一干净的初始会话（阅后即焚）
   */
  resetToInitialSession(title = '新探究任务') {
    const s = this._getStorage();
    if (s) {
      try {
        s.removeItem(this.storageKey);
        s.removeItem(this.activeKey);
      } catch (_) { if (typeof recordIssue === 'function') recordIssue('SessionHistoryManager', 'reset_clear', _); }
    }
    const initialSession = this._createSessionRaw(title);
    this.sessions = [initialSession];
    this.activeSessionId = initialSession.id;
    this.lastActiveAt = Date.now();
    this._saveSessions();
    this._saveActiveSessionId();
    this._notify('sessions_reset', { activeSession: initialSession });
    return initialSession;
  }

  formatRelativeTime(timestamp) {
    if (!timestamp) return '刚刚';
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin}分钟前`;
    if (diffHour < 24) return `${diffHour}小时前`;
    if (diffDay === 1) return '昨天';
    if (diffDay < 7) return `${diffDay}天前`;
    const d = new Date(timestamp);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SessionHistoryManager };
}
if (typeof window !== 'undefined') {
  window.SessionHistoryManager = SessionHistoryManager;
}
