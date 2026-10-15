/**
 * PolicyChain —— 宿主权限门禁（P7-H4，Claude Agent SDK 六层语义）
 *
 * 求值顺序（首个非 allow 决策即终止，返回 {decision, stage, reason}）：
 *   1. hooks       预挂钩：外部注入的检查函数（可否决/标注）——本工程用于审计与扩展点
 *   2. deny        硬拒绝清单：按 action / 路径前缀匹配
 *   3. ask         需确认动作：必须携带 x-wenju-confirm 头（值为宿主 confirmToken）才放行
 *   4. mode        readonly 模式：拦截一切写类动作
 *   5. allow       允许清单：action 不在清单内一律拒绝（默认关闭）
 *   6. canUseTool  最终谓词：细粒度自定义判定（可选）
 *
 * 语义纪律：任一层的否决都必须在响应里显式给出 stage 与 reason（不静默降级为 500）；
 *          allow 清单默认不含未知动作，杜绝"未定义即放行"。
 */

const DEFAULT_ACTIONS = Object.freeze(['file:list', 'file:read', 'file:write', 'file:delete', 'model:chat', 'storage:read', 'storage:write', 'policy:manage', 'render:write', 'render:read']);
const WRITE_ACTIONS = Object.freeze(['file:write', 'file:delete', 'storage:write','render:write']);

function createDefaultPolicy(overrides = {}) {
  return {
    hooks: [],
    deny: [],
    requireConfirm: [],
    mode: 'full',
    allow: DEFAULT_ACTIONS.slice(),
    canUseTool: null,
    ...overrides
  };
}

class PolicyChain {
  constructor(policy = {}) {
    const base = createDefaultPolicy();
    this.policy = { ...base, ...policy };
    if (!Array.isArray(this.policy.hooks)) this.policy.hooks = [];
    if (!Array.isArray(this.policy.deny)) this.policy.deny = [];
    if (!Array.isArray(this.policy.requireConfirm)) this.policy.requireConfirm = [];
    if (!Array.isArray(this.policy.allow)) this.policy.allow = DEFAULT_ACTIONS.slice();
    if (!['readonly', 'full'].includes(this.policy.mode)) throw new Error('POLICY_MODE_INVALID: ' + this.policy.mode);
  }

  setMode(mode) {
    if (!['readonly', 'full'].includes(mode)) {
      const error = new Error('POLICY_MODE_INVALID: ' + mode);
      error.code = 'POLICY_MODE_INVALID';
      throw error;
    }
    this.policy.mode = mode;
    return { mode };
  }

  getMode() { return this.policy.mode; }

  /** @returns {{decision:'allow'|'deny'|'ask', stage:string, reason:string}} */
  evaluate(ctx = {}) {
    const action = String(ctx.action || '');
    if (!action) return { decision: 'deny', stage: 'validate', reason: 'action 缺失' };
    const path = ctx.path === undefined ? null : String(ctx.path);

    // 1. hooks（可否决/标注；钩子抛错视为否决——快速失败，不静默放行）
    for (const hook of this.policy.hooks) {
      if (!hook || typeof hook.fn !== 'function') continue;
      let verdict = null;
      try { verdict = hook.fn({ ...ctx, action }); } catch (e) {
        return { decision: 'deny', stage: 'hooks', reason: `hook ${hook.id || 'anonymous'} 抛错：${e && e.message}` };
      }
      if (verdict && verdict.decision && verdict.decision !== 'allow' && !(verdict.decision === 'ask' && ctx.confirmed === true)) {
        return { decision: verdict.decision, stage: 'hooks', reason: verdict.reason || `hook ${hook.id || 'anonymous'} 否决` };
      }
    }

    // 2. deny（硬拒绝）
    for (const rule of this.policy.deny) {
      if (rule && rule.action === action && (!rule.pathPrefix || (path && path.startsWith(rule.pathPrefix)))) {
        return { decision: 'deny', stage: 'deny', reason: rule.reason || `deny 清单命中：${action}${rule.pathPrefix ? ' ' + rule.pathPrefix : ''}` };
      }
    }

    // 3. ask（需确认）
    if (action === 'policy:manage' && ctx.confirmed !== true) {
      return { decision: 'ask', stage: 'ask', reason: '权限模式切换需二次确认（x-wenju-confirm）' };
    }
    for (const rule of this.policy.requireConfirm) {
      if (rule && rule.action === action && ctx.confirmed !== true) {
        return { decision: 'ask', stage: 'ask', reason: rule.reason || `${action} 需二次确认（x-wenju-confirm）` };
      }
    }

    // 4. mode（只读模式拦截写类动作）
    if (this.policy.mode === 'readonly' && WRITE_ACTIONS.includes(action)) {
      return { decision: 'deny', stage: 'mode', reason: `readonly 模式禁止 ${action}（切换：PUT /v1/policy/mode）` };
    }

    // 5. allow（默认关闭：未列入即拒绝）
    if (!this.policy.allow.includes(action)) {
      return { decision: 'deny', stage: 'allow', reason: `动作 ${action} 不在允许清单内` };
    }

    // 6. canUseTool（最终谓词）
    if (typeof this.policy.canUseTool === 'function') {
      const verdict = this.policy.canUseTool({ ...ctx, action });
      if (verdict === false) return { decision: 'deny', stage: 'canUseTool', reason: `canUseTool 否决 ${action}` };
      if (verdict && verdict.decision && verdict.decision !== 'allow' && !(verdict.decision === 'ask' && ctx.confirmed === true)) {
        return { decision: verdict.decision, stage: 'canUseTool', reason: verdict.reason || `canUseTool 否决 ${action}` };
      }
    }

    return { decision: 'allow', stage: 'canUseTool', reason: 'ok' };
  }
}

module.exports = { PolicyChain, createDefaultPolicy, DEFAULT_ACTIONS, WRITE_ACTIONS };
