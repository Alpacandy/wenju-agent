/**
 * 问矩 · 画布矢量图元物理驱动技能 (CanvasGraphicsDriverSkill v1.0)
 * 对标 ZCode & DeepSeek Harness 生产力工作区交互
 * 职责：接收 Agent 派发的图形指令，在左侧 2D 画布真实光栅化渲染几何矢量图元 (菱形/多边形/圆/矩形/函数曲线)
 */

let BaseSkillGraphics;
if (typeof require !== 'undefined') {
  try { BaseSkillGraphics = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('CanvasGraphicsDriverSkill', 'if', e); }
}
if (!BaseSkillGraphics && typeof window !== 'undefined') {
  BaseSkillGraphics = window.BaseSkill;
}
if (!BaseSkillGraphics) {
  BaseSkillGraphics = class { constructor(n, d) { this.name = n; this.description = d; } };
}

class CanvasGraphicsDriverSkill extends BaseSkillGraphics {
  constructor() {
    super(
      'render_canvas_graphics',
      '仅在二维坐标画板绘制平面图元（菱形、多边形、圆、矩形、函数曲线）。正方体、可旋转三维物体和带滑块的完整演示使用 render_interactive_artifact；本工具不会创建 Artifact，也不能用两个正方形代替三维物体。新问题自动使用独立场景。'
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
          shapes: {
            type: 'array',
            description: '待绘制的矢量图元定义列表',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: ['diamond', 'polygon', 'circle', 'rectangle', 'function_curve'],
                  description: '图元类型：diamond(菱形), polygon(任意多边形), circle(圆), rectangle(矩形), function_curve(函数曲线)'
                },
                centerX: { type: 'number', description: '图形中心数学坐标 X (默认 0)' },
                centerY: { type: 'number', description: '图形中心数学坐标 Y (默认 0)' },
                width: { type: 'number', description: '图形水平跨度 (适用于 diamond, rectangle)' },
                height: { type: 'number', description: '图形垂直跨度 (适用于 diamond, rectangle)' },
                vertices: {
                  type: 'array',
                  description: '多边形顶点坐标列表 [[x0, y0], [x1, y1], ...]',
                  items: { type: 'array', items: { type: 'number' } }
                },
                radius: { type: 'number', description: '圆半径 (适用于 circle)' },
                expression: { type: 'string', description: '函数表达式 (适用于 function_curve，如 "Math.sin(x)" 或 "x*x - 1")' },
                domain: {
                  type: 'array',
                  description: '函数定义域区间 [minX, maxX] (适用于 function_curve，默认 [-4, 4])',
                  items: { type: 'number' }
                },
                fillColor: { type: 'string', description: '半透明填充颜色 (如 "rgba(56, 189, 248, 0.22)")' },
                strokeColor: { type: 'string', description: '边框描边颜色 (如 "#38bdf8")' },
                glowColor: { type: 'string', description: '外发光霓虹颜色 (如 "#38bdf8")' },
                label: { type: 'string', description: '几何标签文字标注 (如 "菱形 ABCD")' }
              },
              required: ['type']
            }
          },
          clear: {
            type: 'boolean',
            description: '是否替换本场景的几何图元（默认 true）。false 仅可追加到当前执行轮的同一 scene_id，跨问题追加会被拒绝。',
            default: true
          },
          title: {
            type: 'string',
            description: '本次绘图任务描述标题'
          },
          scene_id: {
            type: 'string',
            description: '可选场景标识。Agent 执行时由当前任务提供，不能引用其他问题的场景。'
          }
        },
        required: ['shapes']
      }
    };
  }

  async execute(args, context = {}) {
    if (context.signal?.aborted || (typeof context.isRunActive === 'function' && !context.isRunActive())) return { status: 'cancelled', code: 'RUN_ABORTED', error: 'RUN_ABORTED', renderedShapes: 0 };
    if (context.visualTask?.preferredSurface === 'artifact' || context.visualTask?.surface === 'artifact') return { status: 'error', code: 'VISUAL_SURFACE_MISMATCH', error: '当前任务使用 Artifact；二维画板保持不变。', renderedShapes: 0 };
    if (args.scene_id && context.sceneId && args.scene_id !== context.sceneId) return { status: 'error', code: 'SCENE_APPEND_MISMATCH', error: '场景标识不属于当前任务。', renderedShapes: 0 };
    const rawShapes = args.shapes || [];
    const shapeList = Array.isArray(rawShapes) ? rawShapes : [rawShapes];
    const shouldClear = args.clear !== false;
    const title = args.title || '自定义矢量图形';

    if (shapeList.length === 0) {
      return {
        status: 'error',
        error: '图元列表不能为空，请至少提供一个待绘制的图元对象。',
        renderedShapes: 0
      };
    }

    // 工业级参数边界前置断言 (Chaos Resilience L1 防护)
    for (let i = 0; i < shapeList.length; i++) {
      const sh = shapeList[i];
      if (!sh || typeof sh !== 'object') {
        return { status: 'error', error: `图元索引 [${i}] 不是有效对象`, renderedShapes: 0 };
      }
      const t = (sh.type || 'diamond').toLowerCase();
      if (t === 'diamond') {
        const w = Number(sh.width ?? 3.0);
        const h = Number(sh.height ?? 3.0);
        if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
          return { status: 'error', error: `菱形参数异常: 跨度宽与高必须大于0 (当前: width=${sh.width}, height=${sh.height})`, renderedShapes: 0 };
        }
      } else if (t === 'circle') {
        const r = Number(sh.radius ?? 1.5);
        if (isNaN(r) || r <= 0) {
          return { status: 'error', error: `圆形参数异常: 半径必须大于0 (当前: radius=${sh.radius})`, renderedShapes: 0 };
        }
      } else if (t === 'polygon') {
        if (!Array.isArray(sh.vertices) || sh.vertices.length < 3) {
          return { status: 'error', error: `多边形参数异常: 必须包含至少 3 个顶点坐标`, renderedShapes: 0 };
        }
      }
    }

    const visualizer = context.workspaceVisualizer || (typeof window !== 'undefined' ? window.workspaceVisualizer : null);
    if (visualizer && typeof visualizer.setCustomGraphics === 'function') {
      try {
        const res = visualizer.setCustomGraphics(shapeList, {
          clear: shouldClear, title, sceneId: context.sceneId || args.scene_id,
          signal: context.signal, isRunActive: context.isRunActive
        });
        if (context.visualTask) context.visualTask.surface = 'canvas';
        
        // 投递真实认知追踪物理事件
        if (context.cognitiveTracker && typeof context.cognitiveTracker.recordPhysicalEvent === 'function') {
          context.cognitiveTracker.recordPhysicalEvent('canvas_graphics_rendered', {
            title,
            count: res.renderedCount
          });
        }

        return {
          status: 'success',
          surface: 'canvas',
          sceneId: res.sceneId || context.sceneId || args.scene_id,
          renderedShapes: res.renderedCount,
          summary: `已在左侧交互画布成功绘制 ${res.renderedCount} 个物理矢量图元 (${title})`,
          details: res.shapes.map(s => ({
            type: s.type,
            label: s.label,
            verticesCount: s.vertices ? s.vertices.length : 0,
            fillColor: s.fillColor,
            strokeColor: s.strokeColor
          }))
        };
      } catch (err) {
        return {
          status: err.code === 'RUN_ABORTED' ? 'cancelled' : 'error',
          code: err.code || 'CANVAS_RENDER_FAILED',
          error: `画布图元光栅化执行失败: ${err.message}`,
          renderedShapes: 0
        };
      }
    }

    // 离线/环境降级：禁止假 success
    if (args && args.allowSimulated === true) {
      return {
        status: 'simulated',
        warning: 'Canvas 渲染环境离线',
        renderedShapes: 0,
        summary: `[simulated] 未真实渲染 ${shapeList.length} 个图元 (${title})`,
        uiVisible: true
      };
    }
    return {
      status: 'error',
      error: 'NO_VISUALIZER',
      renderedShapes: 0,
      summary: `[M1] Canvas 离线，拒绝假 success（${title}）`
    };
  }
}

if (typeof window !== 'undefined') {
  window.CanvasGraphicsDriverSkill = CanvasGraphicsDriverSkill;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CanvasGraphicsDriverSkill };
}
