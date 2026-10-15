/** Versioned teaching policy shared by browser and headless engine. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TeachingProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  const config = Object.freeze({
    features: Object.freeze({ videoGeneration: false }),
    generation: Object.freeze({ defaultEffort: 'medium', miniMaxMaxTokens: 16384, maxRecoveryAttempts: 1 }),
    version: '1.0.0', language: 'zh-CN', maxOutputTokens: 8192,
    steps: [
      { id: 'PREDICT', name: '预测', instruction: '先询问学生的判断与理由，保留预测；不得替学生编造回答。' },
      { id: 'ENGAGE', name: '实验', instruction: '先解析并确认矩阵、维度、输入范围，再调用精确数学工具；事实由工具产生。' },
      { id: 'CONFLICT', name: '冲突', instruction: '将学生预测与工具事实逐项对照；预测一致时说明一致，不制造冲突。' },
      { id: 'HYPOTHESIZE', name: '边界猜想', instruction: '追问什么条件下成立，提出边界与反例检验，等待学生猜想。' },
      { id: 'DEDUCE', name: '推导验证', instruction: '分步提示；区分实例、反例与一般证明；先让学生尝试推导再反馈。' },
      { id: 'TRANSFER', name: '无提示变式', instruction: '给一道改变条件的迁移题，不附提示或答案，等待学生作答。' }
    ]
  });
  function prompt(stage = 'PREDICT') {
    const current = ({ IDLE:'PREDICT', UNKNOWN:'PREDICT', PERCEIVE:'ENGAGE', CHALLENGE:'CONFLICT', DECONSTRUCT:'DEDUCE' })[stage] || stage;
    return '\n[六步探究学习协议 v' + config.version + ']\n' + config.steps.map((s,i) => (i+1) + '. ' + s.name + '：' + s.instruction).join('\n') +
      '\n当前环节：' + current + '。这是跨轮探究协议，不是一次性泄露六步答案。回复以“第 N 步 · 环节名”标记当前环节，给出本步观察、依据与一个可回答的问题；未完成步骤标为待进行，不谎称学生已作答。解析确认位于预测与实验之间，不算第七步。\n' +
      '线代教学图优先使用 math_experiment，无须编造HTML或用render_canvas_graphics手工猜测核与像。先read现状，再open或update参数，用seek分步显示；展示后inspect_layout检查裁切与标注，verify核验当前数值。长解释放在对话，图内保留短标注；核属于输入空间，像属于输出空间，不平移数学对象来避让。教学回复使用中文，公式用 LaTeX。只输出整理后的解释与下一步问题，不输出内部推演、自言自语或英文草稿。纯绘图指令直接交付可交互图形，不强制学生先猜。交互工件将旋转角、选中项等可恢复数据存入 window.artifactState；监听 artifact-state-restored 并依据 event.detail 重绘，修改后派发 artifact-state-changed。几何工件只能作为演示，不能代替精确数学核的事实验证。';
  }
  return { config, prompt };
});
