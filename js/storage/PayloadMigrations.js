/**
 * PayloadMigrations —— 持久化载荷版本迁移器（zcode migration-runner 语义移植）
 *
 * 对齐 zcode `adapters/src/storage/session-store/migration-runner.ts` 的设计要点：
 *   - 迁移是有序链（每项 { id, to, migrate }），只允许前进（to > from）；
 *   - 幂等：对同一目标版本重复执行结果一致；
 *   - 原子：任一步失败即整体失败，**返回原始载荷**（调用方不得写入半迁移态）；
 *   - 未知更高版本显式 VERSION_FUTURE（不猜测、不降级）；
 *   - 每步迁移前做形状断言，防静默吞掉结构损坏。
 *
 * 本工程已注册的真实迁移（原先散落在各管理器的 ad-hoc 兼容代码，现收敛到此处单点）：
 *   session_history:  v0（裸数组）      → v1（{ sessions, activeSessionId, savedAt } 信封）
 *   teaching_timeline:v0（无 savedAt）  → v1（补 savedAt/规范 seqByTask）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PayloadMigrations = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const REGISTRY = {
    session_history: [
      {
        id: 'session_history_v0_to_v1',
        to: 1,
        migrate(payload) {
          if (!Array.isArray(payload)) return { ok: false, code: 'MIGRATION_SHAPE_INVALID', message: 'v0 载荷必须为裸数组' };
          const sessions = payload.filter((s) => s && typeof s === 'object' && typeof s.id === 'string');
          const active = sessions.length ? sessions[0].id : null;
          return { ok: true, payload: { schemaVersion: 1, sessions, activeSessionId: active, savedAt: null } };
        }
      }
    ],
    teaching_timeline: [
      {
        id: 'teaching_timeline_v0_to_v1',
        to: 1,
        migrate(payload) {
          if (!payload || typeof payload !== 'object' || !Array.isArray(payload.events)) {
            return { ok: false, code: 'MIGRATION_SHAPE_INVALID', message: 'v0 载荷必须含 events 数组' };
          }
          const seqByTask = payload.seqByTask && typeof payload.seqByTask === 'object' ? payload.seqByTask : {};
          return {
            ok: true,
            payload: {
              schemaVersion: 1,
              events: payload.events,
              chainHead: payload.chainHead && typeof payload.chainHead === 'object' ? payload.chainHead : {},
              seqByTask,
              savedAt: typeof payload.savedAt === 'number' ? payload.savedAt : null
            }
          };
        }
      }
    ]
  };

  /**
   * 版本识别（kind 感知，形状容错）：
   *   - 带 schemaVersion → 用之；
   *   - 裸数组 → v0（触发迁移链）；
   *   - **无版本戳的老信封**（含 sessions/events 数组）→ 视为 v1（防把存量合法数据误判为损坏而丢弃）。
   */
  function versionOf(payload, kind) {
    if (payload && typeof payload === 'object' && Number.isInteger(payload.schemaVersion)) return payload.schemaVersion;
    if (Array.isArray(payload)) return 0;
    if (payload && typeof payload === 'object') {
      if (kind === 'session_history' && Array.isArray(payload.sessions)) return 1;
      if (kind === 'teaching_timeline' && Array.isArray(payload.events)) return 1;
    }
    return 0;
  }

  /**
   * 顺序执行迁移链。
   * @param {*} payload 已解析的持久化载荷
   * @param {string} kind 载荷类型（session_history / teaching_timeline）
   * @param {object} [options] { migrations, targetVersion }
   * @returns {{ok:true, payload, fromVersion, toVersion, applied:string[]}|{ok:false, code, at?, message?, payload}}
   */
  function runMigrations(payload, kind, options = {}) {
    const migrations = options.migrations || REGISTRY[kind];
    if (!Array.isArray(migrations)) return { ok: false, code: 'MIGRATION_KIND_UNKNOWN', message: 'unknown payload kind: ' + kind, payload };
    const from = versionOf(payload, kind);
    const maxTo = migrations.reduce((m, x) => Math.max(m, x.to), 0);
    const target = Number.isInteger(options.targetVersion) ? options.targetVersion : maxTo;

    if (from > target) {
      return { ok: false, code: 'VERSION_FUTURE', message: `payload version ${from} > target ${target}`, payload };
    }
    if (from === target) {
      return { ok: true, payload, fromVersion: from, toVersion: from, applied: [] };
    }

    let current = payload;
    let version = from;
    const applied = [];
    while (version < target) {
      const step = migrations.find((m) => m.to === version + 1);
      if (!step) return { ok: false, code: 'MIGRATION_STEP_MISSING', at: version + 1, message: 'no migration to version ' + (version + 1), payload };
      let result;
      try { result = step.migrate(current); }
      catch (e) { return { ok: false, code: 'MIGRATION_FAILED', at: step.to, message: String(e && e.message || e), payload }; }
      if (!result || result.ok !== true) {
        return { ok: false, code: (result && result.code) || 'MIGRATION_FAILED', at: step.to, message: (result && result.message) || 'migration step failed', payload };
      }
      current = result.payload;
      version = step.to;
      applied.push(step.id);
    }
    return { ok: true, payload: current, fromVersion: from, toVersion: version, applied };
  }

  /** 幂等性辅助：已迁移载荷再跑一次必须 no-op */
  function isAtVersion(payload, version, kind) { return versionOf(payload, kind) === version; }

  return { runMigrations, versionOf, isAtVersion, REGISTRY };
});
