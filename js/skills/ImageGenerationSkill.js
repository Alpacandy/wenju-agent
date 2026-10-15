/**
 * 视觉概念图解与图像生成技能 (ImageGenerationSkill v1.0)
 * 对标 ZCode 视觉资产生成与概念配图能力
 * Kwai-Kolors/Kolors 快手可图大模型
 */

let BaseSkillImg;
if (typeof require !== 'undefined') {
  try { BaseSkillImg = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('ImageGenerationSkill', 'if', e); }
}
if (!BaseSkillImg && typeof window !== 'undefined') {
  BaseSkillImg = window.BaseSkill;
}
if (!BaseSkillImg) {
  BaseSkillImg = class { constructor(n, d) { this.name = n; this.description = d; } };
}

let ClientImg;
if (typeof require !== 'undefined') {
  try { ClientImg = require('../models/UnifiedModelClient.js').UnifiedModelClient; } catch (e) { if (typeof recordIssue === 'function') recordIssue('ImageGenerationSkill', 'if', e); }
}
if (!ClientImg && typeof window !== 'undefined') {
  ClientImg = window.UnifiedModelClient;
}

class ImageGenerationSkill extends BaseSkillImg {
  constructor() {
    super(
      'generate_visual_illustration',
      '利用快手可图文生图大模型 (Kwai-Kolors/Kolors)，根据自然语言提示词生成高精度概念示意图、算法插画或几何物理示意图。'
    );
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: false, // B 线契约 GATE-CONTRACT-01：本工具是否要求画布环境
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '图像生成提示词，建议包含主体、构图风格与细节要求'
          },
          image_size: {
            type: 'string',
            enum: ['1024x1024', '768x1024', '1024x768'],
            default: '1024x1024',
            description: '生成画幅分辨率规格'
          }
        },
        required: ['prompt']
      }
    };
  }

  async execute(args, context = {}) {
    const startTime = Date.now();
    const prompt = (args.prompt || '').trim();
    const size = args.image_size || '1024x1024';

    if (!prompt) {
      return {
        status: 'error',
        error: '提示词 prompt 不能为空',
        durationMs: 0
      };
    }

    const client = context.modelClient || (ClientImg ? new ClientImg() : null);
    if (!client) {
      return {
        status: 'error',
        error: 'UnifiedModelClient 实例未挂载',
        durationMs: 0
      };
    }

    try {
      const res = await client.generateImage(prompt, { size, timeoutMs: 25000 });
      const imageList = res.images || res.data || [];
      const firstImg = imageList[0] || {};
      const imageUrl = firstImg.url || (firstImg.b64_json ? `data:image/png;base64,${firstImg.b64_json}` : null);

      if (!imageUrl || res.status === 'degraded') {
        return {
          status: 'degraded',
          model: 'Kwai-Kolors/Kolors',
          prompt,
          error: res.message || '生图服务暂无图像返回或排队超时',
          detail: '云端生图服务当前负载较高，已为您平滑降级至左侧高精度数学矢量工作台绘制',
          durationMs: Date.now() - startTime
        };
      }

      return {
        status: 'success',
        model: 'Kwai-Kolors/Kolors',
        prompt,
        size,
        imageUrl,
        detail: `已生成视觉插画: "${prompt}" [${size}]`,
        durationMs: Date.now() - startTime
      };
    } catch (err) {
      return {
        status: 'error',
        error: err.message,
        durationMs: Date.now() - startTime
      };
    }
  }
}

if (typeof window !== 'undefined') {
  window.ImageGenerationSkill = ImageGenerationSkill;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ImageGenerationSkill };
}
