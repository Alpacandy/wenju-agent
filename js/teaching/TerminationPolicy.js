/**
 * TerminationPolicy —— 自适应终点决策表（P3 T3.4 · 清偿 MAST #5 遗留）
 *
 * 纯函数决策（无随机、无 LLM）：输入教学状态 → 输出终点动作。
 * 规则表（与 P3 计划 T3.4 一致）：
 *   1) pending_confirm 且变式全过        → close_task（误解倾向已确认且迁移达标，档案沉淀）
 *   2) probing 或 证据矛盾回落 candidate  → back_to_experiment（补一个区分性实验）
 *   3) candidate 且变式首题未过          → add_variant（加测一题，上限 maxVariants=3）
 *   4) 变式已达上限且有未过              → close_task（附"建议复习路径"标记）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TerminationPolicy = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  function decide({ trackerStatus, variantHistory = [], conflictCount = 0 }, options = {}) {
    const maxVariants = options.maxVariants || 3;
    const total = variantHistory.length;
    const allPassed = total > 0 && variantHistory.every((v) => v.passed === true);
    const anyFailed = variantHistory.some((v) => v.passed === false);
    const status = trackerStatus && trackerStatus.status;

    if (status === 'pending_confirm' && allPassed) {
      return { action: 'close_task', reason: '误解倾向已确认（待确认态）且全部变式通过——迁移达标，档案沉淀' };
    }
    if (status === 'probing' || (trackerStatus && trackerStatus.lastTransition === 'fallback')) {
      return { action: 'back_to_experiment', reason: '诊断仍在追问中/证据矛盾回落——回实验台补一个区分性实验再判断' };
    }
    if (anyFailed && total < maxVariants) {
      return { action: 'add_variant', reason: `变式第 ${total} 题未过（上限 ${maxVariants}）——加测一题（仍无提示）` };
    }
    if (anyFailed && total >= maxVariants) {
      return { action: 'close_task', reason: '变式已达上限且有未过——关闭任务并写入建议复习路径', remediation: true };
    }
    if (allPassed && total >= 1 && !status) {
      return { action: 'close_task', reason: '变式全过且无活跃诊断——正常闭环' };
    }
    // 冲突计数兜底：多次冲突仍未进入诊断追问 → 回到实验
    if (conflictCount >= 2) {
      return { action: 'back_to_experiment', reason: '累计冲突 ≥2 次——回到实验台用更小反例定位分歧点' };
    }
    return { action: 'continue', reason: '状态未触发任何终点条件——继续当前环节' };
  }

  return { decide };
});
