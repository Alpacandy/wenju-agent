/**
 * 多模态文档与图像 OCR 解析技能 (MultimodalOcrSkill v1.0)
 * 对标 ZCode 视觉图片问答与文档结构化提取能力
 * DeepSeek-OCR 与 PaddleOCR-VL-1.5
 */

let BaseSkillOcr;
if (typeof require !== 'undefined') {
  try { BaseSkillOcr = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('MultimodalOcrSkill', 'if', e); }
}
if (!BaseSkillOcr && typeof window !== 'undefined') {
  BaseSkillOcr = window.BaseSkill;
}
if (!BaseSkillOcr) {
  BaseSkillOcr = class { constructor(n, d) { this.name = n; this.description = d; } };
}

let ClientOcr;
if (typeof require !== 'undefined') {
  try { ClientOcr = require('../models/UnifiedModelClient.js').UnifiedModelClient; } catch (e) { if (typeof recordIssue === 'function') recordIssue('MultimodalOcrSkill', 'if', e); }
}
if (!ClientOcr && typeof window !== 'undefined') {
  ClientOcr = window.UnifiedModelClient;
}

class MultimodalOcrSkill extends BaseSkillOcr {
  constructor() {
    super(
      'multimodal_ocr_document_parser',
      '利用多模态视觉模型 (DeepSeek-OCR / PaddleOCR-VL-1.5) 深度解析图片、手写几何草图或教材截图中的文字、公式与图表结构。'
    );
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          image_data: {
            type: 'string',
            description: '待识别图片的 Base64 编码字符串或 Data URL'
          },
          target_engine: {
            type: 'string',
            enum: ['deepseek-ai/DeepSeek-OCR', 'PaddlePaddle/PaddleOCR-VL-1.5'],
            default: 'deepseek-ai/DeepSeek-OCR',
            description: '指定调用的视觉大模型引擎'
          },
          extraction_focus: {
            type: 'string',
            description: '结构化提取侧重点 (如: "公式与矩阵", "手绘坐标系几何参数", "完整Markdown表格")',
            default: '全部文字、公式与Markdown'
          }
        },
        required: ['image_data']
      }
    };
  }

  async execute(args, context = {}) {
    const startTime = Date.now();
    const imageData = args.image_data;
    const model = args.target_engine || 'deepseek-ai/DeepSeek-OCR';
    const focus = args.extraction_focus || '全部文字与公式';

    if (!imageData) {
      return {
        status: 'error',
        error: '未提供图片数据 (image_data 必填)',
        durationMs: 0
      };
    }

    const client = context.modelClient || (ClientOcr ? new ClientOcr() : null);
    if (!client) {
      return {
        status: 'error',
        error: 'UnifiedModelClient 实例未挂载',
        durationMs: 0
      };
    }

    try {
      const prompt = `请作为专业文档解析与视觉识别专家，分析此图片并精确提取其内容。重点关注：${focus}。要求：数学公式使用 LaTeX 格式输出，排版结构使用标准 Markdown 输出。`;
      const res = await client.ocrImage(imageData, prompt, model);

      return {
        status: 'success',
        modelUsed: model,
        extractedText: res.content,
        durationMs: Date.now() - startTime,
        tokenUsage: res.usage || {}
      };
    } catch (err) {
      return {
        status: 'error',
        modelUsed: model,
        error: err.message,
        durationMs: Date.now() - startTime
      };
    }
  }
}

if (typeof window !== 'undefined') {
  window.MultimodalOcrSkill = MultimodalOcrSkill;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MultimodalOcrSkill };
}
