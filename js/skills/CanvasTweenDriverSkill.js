/**
 * 问矩 · 画布仿射补间驱动技能 (CanvasTweenDriverSkill)
 * 职责：挂载 1200ms 超时看门狗，向几何画板派发 600ms 三次缓动补间指令，更新物理基底并高亮目标子空间
 */

let BaseSkillCanvas;
if (typeof require !== 'undefined') {
  try { BaseSkillCanvas = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('CanvasTweenDriverSkill', 'if', e); }
}
if (!BaseSkillCanvas && typeof window !== 'undefined') {
  BaseSkillCanvas = window.BaseSkill;
}
if (!BaseSkillCanvas) {
  BaseSkillCanvas = class { constructor(n, d) { this.name = n; this.description = d; } };
}

class CanvasTweenDriverSkill extends BaseSkillCanvas {
  constructor() {
    super(
      'drive_canvas_affine_transform',
      '驱动几何实验画板执行连续仿射变换补间动画，更新基向量并高亮目标流形或子空间。'
    );
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: true, // B 线契约 GATE-CONTRACT-01：本工具是否要求画布环境
      parameters: {
        type: 'object',
        properties: {
          preset: {
            type: 'string',
            enum: ['singular', 'shear', 'cubist', 'identity'],
            description: '几何形态预设: singular(奇异降维临界态), shear(剪切态), cubist(毕加索晶体姿态), identity(单位标准基)'
          },
          target_basis: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
              c: { type: 'number' },
              d: { type: 'number' }
            },
            description: '自定义目标矩阵分量 [ [a, b], [c, d] ]'
          },
          highlight_subspace: {
            type: 'string',
            enum: ['kernel', 'column', 'none'],
            description: '高亮目标子空间: kernel(荧光洋红零空间射线), column(列空间投影线), none(无)'
          },
          duration_ms: {
            type: 'number',
            description: '补间动画时长 (毫秒)，默认 600ms'
          }
        }
      }
    };
  }

  async execute(args, context = {}) {
    if (context.signal?.aborted || (typeof context.isRunActive === 'function' && !context.isRunActive())) return { status: 'cancelled', code: 'RUN_ABORTED', error: 'RUN_ABORTED' };
    if (context.visualTask?.preferredSurface === 'artifact' || context.visualTask?.surface === 'artifact') return { status: 'error', code: 'VISUAL_SURFACE_MISMATCH', error: '当前任务使用 Artifact；二维画板保持不变。' };
    const visualizer = context.workspaceVisualizer || (typeof window !== 'undefined' ? window.workspaceVisualizer : null);
    if (!visualizer) {
      if (args && args.allowSimulated === true) {
        return {
          status: 'simulated',
          preset: args.preset || 'singular',
          detail: `[模拟调度-显式允许] 画板环境离线，已标记 simulated（非 success）: ${args.preset || 'singular'}`,
          uiVisible: true
        };
      }
      return {
        status: 'error',
        error: 'NO_VISUALIZER',
        preset: args.preset || 'singular',
        detail: '[M1] 无 workspaceVisualizer，拒绝假 success。画板离线时不得宣称变换完成。'
      };
    }

    const duration = args.duration_ms || 600;
    const highlight = args.highlight_subspace || 'kernel';

    // S5 清偿（B 线）：目标矩阵必须为 4 个有限数字；残缺/NaN/字符串目标一律拒绝，绝不把画布写坏
    if (args.target_basis !== undefined && args.target_basis !== null) {
      const t = args.target_basis;
      const vals = [t && t.a, t && t.b, t && t.c, t && t.d];
      const valid = t && typeof t === 'object' && vals.every((x) => typeof x === 'number' && Number.isFinite(x));
      if (!valid) {
        return {
          status: 'error',
          error: 'INVALID_TARGET_MATRIX',
          detail: '[S5] target_basis 必须是 {a,b,c,d} 四个有限数字（收到: ' + JSON.stringify(t) + '）。拒绝以残缺/非数值目标写坏画布。',
          uiVisible: true
        };
      }
    }

    // 1200ms 看门狗超时守卫，防止动画帧卡死死锁 Agent
    return new Promise((resolve) => {
      let isDone = false;
      const finish = (result) => {
        if (isDone) return;
        isDone = true;
        clearTimeout(watchdog);
        context.signal?.removeEventListener('abort', abort);
        resolve(result);
      };
      const abort = () => {
        if (isDone) return;
        if (typeof visualizer.cancelAnimation === 'function') visualizer.cancelAnimation('RUN_ABORTED');
        finish({ status: 'cancelled', code: 'RUN_ABORTED', error: 'RUN_ABORTED' });
      };
      const watchdog = setTimeout(() => {
        if (!isDone) {
          finish({
            status: 'error',
            error: 'TWEEN_WATCHDOG_TIMEOUT',
            watchdogTriggered: true,
            finalMatrix: visualizer.matrix || null,
            detail: '[M1] 补间看门狗超时，不得记为 success'
          });
          if (typeof visualizer.cancelAnimation === 'function') visualizer.cancelAnimation('TWEEN_WATCHDOG_TIMEOUT');
        }
      }, 1200);
      context.signal?.addEventListener('abort', abort, { once: true });

      try {
        if (typeof visualizer.dispatchAgentTransform === 'function') {
          if (typeof visualizer.prepareScene === 'function') visualizer.prepareScene(context.sceneId, context);
          if (context.visualTask) context.visualTask.surface = 'canvas';
          visualizer.dispatchAgentTransform({
            preset: args.preset,
            targetMatrix: args.target_basis,
            duration,
            highlight,
            sceneId: visualizer.sceneId || context.sceneId,
            signal: context.signal,
            isRunActive: context.isRunActive
          }).then((res) => {
            if (!isDone) {
              if (context.signal?.aborted || (typeof context.isRunActive === 'function' && !context.isRunActive())) { abort(); return; }
              if (res?.status === 'cancelled' || res?.status === 'error') { finish(res); return; }
              // S2 清偿（B 线）：请求的高亮必须真实落到画布状态上（dispatch 内部未消费时由技能侧兜底写入）
              if (highlight && highlight !== 'none') {
                visualizer.activeSubspaceHighlight = highlight;
              }
              finish({
                status: 'success',
                ...res,
                detail: `画板成功完成平滑补间形变 (目标: ${args.preset || '自定义基底'}, 耗时: ${duration}ms)`
              });
            }
          }).catch((err) => {
            finish({ status: err.code === 'RUN_ABORTED' ? 'cancelled' : 'error', code: err.code, error: err.message });
          });
        } else {
          finish({ status: 'error', error: 'NO_DISPATCH_AGENT_TRANSFORM', detail: '[M1] 画板缺少 dispatchAgentTransform，拒绝虚拟 success' });
        }
      } catch (e) {
        finish({ status: e.code === 'RUN_ABORTED' ? 'cancelled' : 'error', code: e.code, error: e.message });
      }
    });
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CanvasTweenDriverSkill };
}
if (typeof window !== 'undefined') {
  window.CanvasTweenDriverSkill = CanvasTweenDriverSkill;
}
