/**
 * ReviewPacket —— 审核环（P6-E，上线前门禁 / D-03）
 *
 * 语义：把误解诊断推进到 pending_confirm 的条目导出为"审核包"（不含任何自动入库），
 * 由人工（教研/教师）在包内 decisions 字段逐条给出 confirm | reject | revise 决策后重新导入；
 * 导入时执行三重校验（封条哈希 → 逐条证据哈希 → 决策合法性），通过后才写回库条目 provenance
 * （eediMisconceptionId 填充 / statement 修订 / review 审核记录），并追加哈希链审计日志。
 *
 * 纪律：
 *   - 任何校验失败 → 整体拒绝，不产生部分写回（无静默降级）。
 *   - 哈希口径与 TeachingTimeline.djb2 同源（djb2 + '|' 拼接），审计链与教学时间线可对拍。
 *   - 本模块纯逻辑（无 DOM / 无文件 IO）；文件下载与读取由宿主 (app.js) 负责。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReviewPacket = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const PACKET_SCHEMA = 'wenju.review.packet.v1';
  const AUDIT_KEY = 'wenju_review_audit_v1';
  const DECISIONS = ['confirm', 'reject', 'revise'];

  /** 与 TeachingTimeline.djb2 同算法（同源哈希口径；一致性由 test_review_packet 断言锁定） */
  function djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    return h.toString(16).padStart(8, '0');
  }

  /** 稳定序列化：对象键排序递归（与 JSON.stringify 插入序无关，保证跨机器哈希一致） */
  function canonical(v) {
    if (v === null || v === undefined) return JSON.stringify(v === undefined ? null : v);
    if (typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    const keys = Object.keys(v).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }

  function hashOf(v) { return djb2(typeof v === 'string' ? v : canonical(v)); }

  /** 库快照哈希：对条目瘦身投影（id/章节/来源/溯源/陈述）取哈希 */
  function librarySnapshotHash(library) {
    if (!library || !library.data || !Array.isArray(library.data.entries)) return null;
    const slim = library.data.entries.map((e) => ({
      id: e.id, chapter: e.chapter, source: e.source,
      eediMisconceptionId: e.eediMisconceptionId === undefined ? null : e.eediMisconceptionId,
      statement: e.statement
    }));
    return hashOf(slim);
  }

  /** 封条材料：评审填写 decisions 不改动封条，改动条目内容/库快照/导出时间必破封 */
  function sealMaterial(packet) {
    return {
      schema: packet.schema,
      exportedAt: packet.exportedAt,
      library: packet.library,
      entries: (packet.entries || []).map((e) => ({
        id: e.id, evidenceHash: e.evidenceHash, pL: e.pL, statement: e.statement, source: e.source
      }))
    };
  }

  /**
   * 构建审核包：pending_confirm 条目 + 证据（含逐条证据哈希）+ 库快照哈希 + 时间线链锚点。
   * @returns {{ok:true,packet:Object}|{ok:false,code:string,message:string}}
   */
  function buildPacket({ tracker, library, timeline, exportedBy } = {}) {
    if (!tracker || typeof tracker.all !== 'function' || !tracker.states) {
      return { ok: false, code: 'TRACKER_REQUIRED', message: 'MisconceptionTracker 缺失或形状不符' };
    }
    const pending = tracker.all().filter((s) => s && s.status === 'pending_confirm');
    const entries = pending.map((s) => {
      const libEntry = (library && typeof library.byId === 'function') ? library.byId(s.id) : null;
      const ev = (tracker.states[s.id] && tracker.states[s.id].evidence) || [];
      return {
        id: s.id,
        chapter: libEntry ? libEntry.chapter : null,
        statement: libEntry ? libEntry.statement : null,
        source: libEntry ? libEntry.source : null,
        eediMisconceptionId: libEntry && libEntry.eediMisconceptionId !== undefined ? libEntry.eediMisconceptionId : null,
        pL: s.pL,
        evidenceCount: s.evidenceCount,
        updatedAt: s.updatedAt || null,
        evidenceHash: hashOf(ev),
        evidence: ev
      };
    }).sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));

    // 证据链锚点：各任务时间线链头（供评审核对证据来自完好链）
    let timelineAnchors = null;
    if (timeline && typeof timeline.tasks === 'function' && typeof timeline.verify === 'function') {
      try {
        timelineAnchors = {};
        for (const tid of timeline.tasks()) {
          const v = timeline.verify(tid);
          timelineAnchors[tid] = v && v.ok ? v.head : null;
        }
      } catch (e) { timelineAnchors = null; }
    }

    const packet = {
      schema: PACKET_SCHEMA,
      exportedAt: new Date().toISOString(),
      exportedBy: exportedBy || 'local-operator',
      library: {
        size: (library && typeof library.size === 'function') ? library.size() : null,
        snapshotHash: librarySnapshotHash(library)
      },
      entries,
      timelineAnchors,
      decisions: entries.map((e) => ({ id: e.id, decision: null, reviewerId: null, reviewedAt: null, note: '', eediMisconceptionId: null }))
    };
    packet.packetHash = hashOf(sealMaterial(packet));
    return { ok: true, packet };
  }

  /** 审核包三重校验之一/二：封条哈希 + 逐条证据哈希 */
  function verifyPacket(packet) {
    if (!packet || typeof packet !== 'object') return { ok: false, code: 'PACKET_INVALID', message: '审核包不是对象' };
    if (packet.schema !== PACKET_SCHEMA) return { ok: false, code: 'PACKET_SCHEMA_INVALID', message: 'schema 不匹配（期望 ' + PACKET_SCHEMA + '，实得 ' + packet.schema + '）' };
    if (!Array.isArray(packet.entries)) return { ok: false, code: 'PACKET_INVALID', message: '缺少 entries 数组' };
    const expect = hashOf(sealMaterial(packet));
    if (expect !== packet.packetHash) {
      return { ok: false, code: 'PACKET_HASH_MISMATCH', message: '封条哈希不一致——文件内容被改动或非本机导出', expect, actual: packet.packetHash };
    }
    for (const e of packet.entries) {
      if (!e || typeof e.id !== 'string') return { ok: false, code: 'PACKET_INVALID', message: '条目缺少 id' };
      if (hashOf(e.evidence || []) !== e.evidenceHash) {
        return { ok: false, code: 'EVIDENCE_HASH_MISMATCH', message: '条目 ' + e.id + ' 的证据被改动', entryId: e.id };
      }
    }
    return { ok: true };
  }

  /** 审计链记录哈希（与时间线同口径：prevHash 参与链式绑定） */
  function auditRecordHash(rec) {
    return djb2([rec.prevHash, rec.action, rec.entryId, rec.decision, rec.reviewerId, rec.at, rec.packetHash, rec.evidenceHash].join('|'));
  }

  function appendAudit(audit, rec) {
    const prevHash = audit.length ? audit[audit.length - 1].hash : 'GENESIS';
    const body = Object.assign({ seq: audit.length + 1, prevHash }, rec);
    body.hash = auditRecordHash(body);
    audit.push(body);
    return body;
  }

  /** 审计链复验（篡改/截断检测；与 TeachingTimeline.verify 同容忍策略：信任首条基点） */
  function verifyAuditChain(audit) {
    if (!Array.isArray(audit) || !audit.length) return { ok: true, length: 0, head: null };
    let prev = audit[0].prevHash;
    for (const r of audit) {
      if (r.prevHash !== prev) return { ok: false, brokenAt: r.seq, reason: 'PREV_HASH_MISMATCH' };
      if (auditRecordHash(r) !== r.hash) return { ok: false, brokenAt: r.seq, reason: 'RECORD_HASH_MISMATCH' };
      prev = r.hash;
    }
    return { ok: true, length: audit.length, head: prev };
  }

  /**
   * 导入决策并写回（三重校验全过才提交；校验失败 → 整体拒绝，零写回）。
   * @param {Object} p
   * @param {Object} p.packet  审核包（decisions 已由评审填写）
   * @param {Object} p.library MisconceptionLibrary（写回 review / eediMisconceptionId / statement）
   * @param {Array}  [p.auditLog] 既有审计日志（哈希链续写）
   * @param {string} [p.reviewerFallback] decisions 缺 reviewerId 时的兜底署名
   * @returns {{ok:true,applied:Array,rejected:Array,audit:Array,librarySnapshotBefore:string|null,librarySnapshotAfter:string|null}|{ok:false,code,message,...}}
   */
  function applyDecisions({ packet, library, auditLog, reviewerFallback } = {}) {
    const ver = verifyPacket(packet);
    if (!ver.ok) return ver;
    const decs = Array.isArray(packet.decisions) ? packet.decisions : [];
    const byId = new Map(packet.entries.map((e) => [e.id, e]));

    // 先全量校验决策（合法性/条目归属），任一非法 → 整体拒绝（无部分写回）
    const staged = [];
    for (const d of decs) {
      if (!d || typeof d.id !== 'string' || !d.id) {
        return { ok: false, code: 'DECISION_INVALID', message: '决策缺少 id：' + JSON.stringify(d) };
      }
      if (!byId.has(d.id)) return { ok: false, code: 'DECISION_UNKNOWN_ENTRY', message: '决策指向包外条目：' + d.id };
      if (!DECISIONS.includes(d.decision)) {
        return { ok: false, code: 'DECISION_INVALID', message: '条目 ' + d.id + ' 决策值非法（' + d.decision + '），允许 confirm|reject|revise' };
      }
      if (d.decision === 'confirm' && d.eediMisconceptionId !== undefined && d.eediMisconceptionId !== null && typeof d.eediMisconceptionId !== 'string') {
        return { ok: false, code: 'DECISION_INVALID', message: '条目 ' + d.id + ' 的 eediMisconceptionId 必须为字符串或 null' };
      }
      staged.push(d);
    }

    const audit = Array.isArray(auditLog) ? auditLog.slice() : [];
    const before = librarySnapshotHash(library);
    const applied = [];
    for (const d of staged) {
      const entry = byId.get(d.id);
      const rec = {
        id: d.id,
        decision: d.decision,
        reviewerId: d.reviewerId || reviewerFallback || 'unattributed',
        reviewedAt: d.reviewedAt || new Date().toISOString(),
        note: typeof d.note === 'string' ? d.note : '',
        evidenceHash: entry.evidenceHash
      };
      // 写回库条目 provenance（内存态；库种子文件不可变——持久化由审计日志与决策文件承担）
      if (library && typeof library.byId === 'function') {
        const libEntry = library.byId(d.id);
        if (libEntry) {
          libEntry.review = {
            decision: rec.decision, reviewerId: rec.reviewerId, reviewedAt: rec.reviewedAt,
            note: rec.note, evidenceHash: rec.evidenceHash, packetHash: packet.packetHash
          };
          if (rec.decision === 'confirm' && d.eediMisconceptionId) {
            libEntry.eediMisconceptionId = d.eediMisconceptionId; // EEDI 溯源填充（Kaggle 数据获取后的写回路径）
            libEntry.source = 'eedi-taxonomy';
          }
          if (rec.decision === 'revise' && typeof d.revisedStatement === 'string' && d.revisedStatement.trim()) {
            libEntry.statement = d.revisedStatement.trim();
          }
        }
      }
      appendAudit(audit, {
        at: rec.reviewedAt, action: 'review_import', packetHash: packet.packetHash,
        reviewerId: rec.reviewerId, entryId: rec.id, decision: rec.decision,
        evidenceHash: rec.evidenceHash, note: rec.note
      });
      applied.push(rec);
    }
    return { ok: true, applied, rejected: [], audit, librarySnapshotBefore: before, librarySnapshotAfter: librarySnapshotHash(library) };
  }

  /** 决策文件（含 decisions 的审核包）序列化：稳定缩进便于人工评审 */
  function serializePacket(packet) { return JSON.stringify(packet, null, 2); }

  /** 文件文本 → 审核包对象（解析失败显式报错） */
  function parsePacket(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, code: 'PACKET_PARSE_ERROR', message: 'JSON 解析失败：' + (e && e.message) }; }
    return { ok: true, packet: obj };
  }

  // ---------- 审计日志持久化（localStorage 主路径 + 存储端口镜像，与 P6-A 口径一致） ----------
  function saveAudit(audit, port) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(AUDIT_KEY, JSON.stringify({ audit, savedAt: Date.now() }));
    } catch (e) { /* 只读降级 */ }
    if (port) { try { port.set(AUDIT_KEY, { audit, savedAt: Date.now() }).catch(() => {}); } catch (e) { /* 端口异常忽略 */ } }
  }

  function loadAudit() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(AUDIT_KEY);
      if (!raw) return [];
      const d = JSON.parse(raw);
      return Array.isArray(d && d.audit) ? d.audit : [];
    } catch (e) { return []; }
  }

  return { PACKET_SCHEMA, AUDIT_KEY, buildPacket, verifyPacket, applyDecisions, serializePacket, parsePacket, librarySnapshotHash, verifyAuditChain, saveAudit, loadAudit, djb2, canonical };
});
