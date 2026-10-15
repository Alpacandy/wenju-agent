/**
 * 问矩 · Manim 几何微课驱动技能 (ManimLessonSkill v1.0)
 * 职责：
 * 接收 Agent 派发的教学微课播放指令，自动将工作区视口切换至 Manim 微课舞台，
 * 调取并循环播放对应的线性代数核心几何命题解析短视频片段。
 */

let BaseSkillManim;
if (typeof require !== 'undefined') {
  try { BaseSkillManim = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('ManimLessonSkill', 'if', e); }
}
if (!BaseSkillManim && typeof window !== 'undefined') {
  BaseSkillManim = window.BaseSkill;
}
if (!BaseSkillManim) {
  BaseSkillManim = class { constructor(n, d) { this.name = n; this.description = d; } };
}

class ManimLessonSkill extends BaseSkillManim {
  videoGenerationEnabled(){
    const policy=typeof window!=='undefined'?window.TeachingProtocol:require('../teaching/TeachingProtocol.config.js');
    return policy?.config?.features?.videoGeneration===true;
  }
  constructor() {
    super(
      'play_manim_lesson',
      '播放已有 Manim 微课；capabilities 检查后端，status/cancel 查询或取消已有任务。当前配置关闭视频生成。'
    );
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: false,
      parameters: {
        type: 'object',
        properties: {
          action:{type:'string',enum:this.videoGenerationEnabled()?['play','render','status','cancel','capabilities']:['play','status','cancel','capabilities']},
          job_id:{type:'string',maxLength:128},operation_id:{type:'string',maxLength:128},
          spec:{type:'object',additionalProperties:false,properties:{type:{type:'string',enum:['linear-map']},A:{type:'array',items:{type:'number',minimum:-20,maximum:20},minItems:4,maxItems:4}},required:['type','A']},
          lesson_id: {
            type: 'string',
            enum: [
              'basis_vectors',
              'geometric_operators',
              'multiplication_order',
              'dimension_collapse',
              'nullspace_zero_divisor'
            ],
            description: '微课切片标识：basis_vectors(基向量与空间映射), geometric_operators(剪切/旋转与行列式), multiplication_order(乘法复合非对称性), dimension_collapse(奇异降维坍缩), nullspace_zero_divisor(零空间与非零零因子)'
          },
          playback_rate: {
            type: 'number',
            enum: [0.5, 0.75, 1.0, 1.25],
            description: '播放倍速 (默认 1.0，慢速 0.5/0.75 可用于学生细致观测空间网格形变细节)'
          }
        },
        required: []
      }
    };
  }

  async execute(args, context = {}) {
    if(args.action==='render'&&!this.videoGenerationEnabled())return {status:'error',code:'VIDEO_GENERATION_DISABLED',error:'VIDEO_GENERATION_DISABLED',detail:'视频生成已关闭，可操作数学实验或播放已有微课。'};
    if(args.action&&args.action!=='play'){
      const Client=typeof window!=='undefined'?window.ManimRenderClient:require('./ManimRenderClient').ManimRenderClient;
      const client=new Client();
      const sessionId=context.sessionId||(typeof window!=='undefined'?window.sessionHistoryManager?.getActiveSessionId():null);
      const operationId=context.traceId||('render-'+Date.now());
      const result=await client.execute(args,{sessionId,operationId,signal:context.signal});
      if(result.status==='success'&&args.action==='render'&&typeof window!=='undefined')window.toolCenter?.showRenderJob?.(result.job,client,sessionId);
      return result;
    }
    const lessonId = args && args.lesson_id;
    const playbackRate = (args && args.playback_rate) || 1.0;

    const validIds = ['basis_vectors', 'geometric_operators', 'multiplication_order', 'dimension_collapse', 'nullspace_zero_divisor'];
    if (!lessonId || !validIds.includes(lessonId)) {
      return {
        status: 'error',
        error: 'INVALID_LESSON_ID',
        detail: `微课标识无效：${lessonId}。有效值为: ${validIds.join(', ')}`,
        uiVisible: true
      };
    }

    const deck = (typeof window !== 'undefined' && window.artifactStageDeck) || null;
    let switched = false;
    let selected = false;

    if (deck) {
      if (typeof deck.setMode === 'function') {
        deck.setMode('manim');
        switched = true;
      }
      if (deck.manimDeck && typeof deck.manimDeck.selectLesson === 'function') {
        selected = deck.manimDeck.selectLesson(lessonId, true);
        if (playbackRate && typeof deck.manimDeck.setPlaybackRate === 'function') {
          deck.manimDeck.setPlaybackRate(playbackRate);
        }
      }
    }

    // 读取微课知识点元数据
    let lessonMeta = null;
    if (typeof window !== 'undefined' && window.MANIM_LESSONS) {
      lessonMeta = window.MANIM_LESSONS.find(l => l.id === lessonId);
    } else if (typeof require === 'function') {
      try {
        const { MANIM_LESSONS } = require('../manim/ManimLessonDeck.js');
        lessonMeta = MANIM_LESSONS.find(l => l.id === lessonId);
      } catch (e) { /* ignore */ }
    }

    return {
      status: 'success',
      lessonId,
      title: lessonMeta ? lessonMeta.title : lessonId,
      formula: lessonMeta ? lessonMeta.formula : '',
      takeaway: lessonMeta ? lessonMeta.takeaway : '',
      playbackRate,
      switchedToManimStage: switched,
      detail: `已载入 Manim 几何微课：【${lessonMeta ? lessonMeta.title : lessonId}】· 循环解析中`
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ManimLessonSkill };
}
if (typeof window !== 'undefined') {
  window.ManimLessonSkill = ManimLessonSkill;
}
