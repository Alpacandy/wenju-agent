/**
 * DemoPackExporter —— 演示包导出（P3 T3.5 · Z2）
 *
 * 输入 taskId → 输出**单文件自包含 HTML**（无外部依赖，file:// 可开）：
 *   - 内嵌教学时间线 JSON（含每事件哈希与整链校验结果）；
 *   - 冲突六元组卡片（预测/理由/事实/内核/可复现引用）；
 *   - 变式计分与终点决策记录；
 *   - 待确认清单（误解三态推进到 pending_confirm 的条目，只读——D-03 无审核操作）；
 *   - 头部注释携带 {schemaVersion, taskId, exportedAt, chainHead, eventCount} 供机器校验。
 *
 * Node 与浏览器双通道：Node 返回 HTML 字符串（测试写盘）；浏览器经 Blob 下载。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DemoPackExporter = api;
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  /**
   * buildDemoPack({ timeline, collector, tracker, taskId })
   * 全部数据源须为真实运行实例（TeachingTimeline / PredictionCollector / MisconceptionTracker）。
   */
  function buildDemoPack({ timeline, collector, tracker, taskId }) {
    if (!timeline) throw new Error('[DemoPackExporter] 缺少 timeline');
    const events = timeline.list(taskId);
    const verify = timeline.verify(taskId);
    const records = (collector ? collector.getRecords() : []).filter((r) => r.taskId === taskId);
    const conflicts = records.filter((r) => r.conflict === true);
    const variants = events.filter((e) => e.type === 'variant_grade');
    const terminations = events.filter((e) => e.type === 'termination');
    let pendingConfirm = [];
    if (tracker) {
      try {
        const snap = JSON.parse(tracker.protectedSnapshot());
        pendingConfirm = Object.entries(snap.states || {})
          .filter(([, v]) => v.status === 'pending_confirm')
          .map(([id, v]) => ({ id, status: v.status, pL: v.pL, evidenceCount: (v.evidence || []).length }));
      } catch (e) { pendingConfirm = []; }
    }

    const headComment = '<!-- WENJU_DEMO_PACK ' + JSON.stringify({
      schemaVersion: SCHEMA_VERSION, taskId,
      exportedAt: new Date().toISOString(),
      eventCount: events.length,
      chainHead: verify.head || null,
      chainVerified: verify.ok === true
    }) + ' -->';

    const icon = { conjecture: '💭', prediction: '🔮', parse_confirm: '✅', experiment_fact: '🧪', conflict: '⚡', discriminating_q: '🩺', evidence: '📌', status_change: '🔀', hypothesis: '💡', deduction: '∑', variant_issue: '🚀', variant_grade: '🏁', hint_revealed: '👁️', termination: '🧭' };
    const rows = events.map((e) => {
      const detail = JSON.stringify(e.payload || {}).slice(0, 240);
      return '<div class="row ' + esc(e.type) + '"><span class="seq">#' + e.seq + '</span><span class="ico">' + (icon[e.type] || '•') + '</span><span class="ty">' + esc(e.type) + '</span><span class="de">' + esc(detail) + '</span><span class="hs">' + e.hash.slice(0, 8) + '</span></div>';
    }).join('\n');

    const conflictCards = conflicts.map((r) => (
      '<div class="card conflict"><div class="ct">⚡ 预测-事实冲突</div>' +
      '<div>学生预测：<b>' + esc(JSON.stringify(r.value)) + '</b>（原文：「' + esc(r.prediction) + '」）</div>' +
      '<div>理由：' + esc(r.rationale) + '</div>' +
      '<div>精确事实：<b>' + esc(JSON.stringify(r.fact)) + '</b></div>' +
      '<div class="meta">内核：' + esc(r.kernel || '-') + ' · 可复现引用：<code>' + esc(String(r.reproducibleRef || '-').slice(0, 120)) + '</code></div></div>'
    )).join('\n') || '<div class="card">（无冲突记录）</div>';

    const variantCards = variants.map((e) => (
      '<div class="card ' + (e.payload.passed ? 'pass' : 'fail') + '"><div class="ct">' + (e.payload.passed ? '🏁 变式通过' : '🏁 变式未过') + '</div>' +
      '<div>' + esc(e.payload.variantId) + ' · 学生作答：' + esc(e.payload.answer || '') + '</div>' +
      '<div class="meta">参考结论：' + esc(e.payload.expected || '') + '</div></div>'
    )).join('\n');

    const termCard = terminations.length
      ? '<div class="card"><div class="ct">🧭 终点决策（自适应）</div><div>' + esc(terminations[terminations.length - 1].payload.action) + '：' + esc(terminations[terminations.length - 1].payload.reason || '') + '</div></div>'
      : '';

    const pendingCard = pendingConfirm.length
      ? '<div class="card"><div class="ct">📌 待确认清单（只读 · 教师复核环于上线前接入）</div>' +
        pendingConfirm.map((p) => '<div>' + esc(p.id) + ' · 状态 ' + esc(p.status) + ' · pL=' + Number(p.pL).toFixed(3) + ' · 证据 ' + p.evidenceCount + ' 条</div>').join('') + '</div>'
      : '<div class="card">（无待确认条目）</div>';

    return headComment + '\n<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><title>问矩演示包 · ' + esc(taskId) + '</title><style>' +
      'body{font-family:system-ui,"PingFang SC",sans-serif;background:#0b1220;color:#e2e8f0;margin:24px auto;max-width:980px;padding:0 16px;line-height:1.6}' +
      'h1{font-size:20px}.badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;background:#052e16;color:#4ade80;margin-left:8px}' +
      '.badge.bad{background:#450a0a;color:#f87171}.card{background:#111b2e;border-radius:12px;padding:12px 14px;margin:10px 0;border:1px solid #1e293b}' +
      '.card.conflict{border-color:#7f1d1d}.card.pass{border-color:#14532d}.card.fail{border-color:#78350f}.ct{font-weight:700;margin-bottom:6px}.meta{color:#94a3b8;font-size:12.5px;margin-top:4px}' +
      '.row{display:grid;grid-template-columns:40px 22px 110px 1fr 70px;gap:6px;font-size:12.5px;padding:4px 2px;border-bottom:1px dashed #1e293b}.seq,.hs{color:#64748b;font-family:monospace}.ty{color:#93c5fd}.conflict-row,.row.conflict{background:rgba(248,113,113,.08)}' +
      '</style></head><body>' +
      '<h1>问矩 · 教学演示包 <span id="chain-badge" class="badge' + (verify.ok ? '' : ' bad') + '">' + (verify.ok ? '哈希链校验通过（' + verify.length + ' 事件）' : '⚠️ 链校验失败 @' + verify.brokenAt) + '</span></h1>' +
      '<p>任务：<code>' + esc(taskId) + '</code> · 导出时间：' + new Date().toISOString() + '</p>' +
      '<h2>冲突六元组</h2>' + conflictCards +
      '<h2>变式计分</h2>' + (variantCards || '<div class="card">（暂无变式记录）</div>') + termCard +
      '<h2>待确认清单</h2>' + pendingCard +
      '<h2>教学事件时间线（' + events.length + ' 事件）</h2>' + '<div id="timeline">' + rows + '</div>' +
      '<script type="application/json" id="wenju-pack-data">' + JSON.stringify({
        schemaVersion: SCHEMA_VERSION, taskId, eventCount: events.length,
        chainHead: verify.head || null, chainVerified: verify.ok === true, events
      }).replace(/</g, '\\u003c') + '</' + 'script>' +
      '</body></html>';
  }

  /** 浏览器下载 */
  function downloadDemoPack(html, taskId) {
    if (typeof document === 'undefined') return false;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wenju_demo_' + String(taskId).replace(/[^a-zA-Z0-9_-]/g, '') + '.html';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
    return true;
  }

  return { buildDemoPack, downloadDemoPack, SCHEMA_VERSION };
});
