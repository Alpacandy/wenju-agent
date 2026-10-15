/**
 * 技术文献与代码翻译技能 (TranslationSkill v1.0)
 * 对标 ZCode 多语言本地化与国际化技术文档互译能力
 * tencent/Hunyuan-MT-7B 专业翻译大模型
 */

let BaseSkillTrans;
if (typeof require !== 'undefined') {
  try { BaseSkillTrans = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('TranslationSkill', 'if', e); }
}
if (!BaseSkillTrans && typeof window !== 'undefined') {
  BaseSkillTrans = window.BaseSkill;
}
if (!BaseSkillTrans) {
  BaseSkillTrans = class { constructor(n, d) { this.name = n; this.description = d; } };
}

let ClientTrans;
if (typeof require !== 'undefined') {
  try { ClientTrans = require('../models/UnifiedModelClient.js').UnifiedModelClient; } catch (e) { if (typeof recordIssue === 'function') recordIssue('TranslationSkill', 'if', e); }
}
if (!ClientTrans && typeof window !== 'undefined') {
  ClientTrans = window.UnifiedModelClient;
}

class TranslationSkill extends BaseSkillTrans {
  constructor() {
    super(
      'translate_technical_text',
      '利用腾讯混元机器翻译大模型 (Hunyuan-MT-7B)，对技术文档、代码注释、数学论文或用户提问进行术语级高精度双语互译。'
    );
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: '待翻译的源文本内容'
          },
          target_language: {
            type: 'string',
            description: '目标语言，如 "中文", "英文", "日语", "德语"',
            default: '中文'
          },
          source_language: {
            type: 'string',
            description: '源语言，如 "英文", "中文"',
            default: '英文'
          }
        },
        required: ['text']
      }
    };
  }

  async execute(args, context = {}) {
    const startTime = Date.now();
    const text = (args.text || '').trim();
    const targetLang = args.target_language || '中文';
    const sourceLang = args.source_language || '英文';

    if (!text) {
      return {
        status: 'error',
        error: '待翻译文本不能为空',
        durationMs: 0
      };
    }

    const client = context.modelClient || (ClientTrans ? new ClientTrans() : null);
    if (!client) {
      return {
        status: 'error',
        error: 'UnifiedModelClient 实例未挂载',
        durationMs: 0
      };
    }

    try {
      const res = await client.translate(text, targetLang, sourceLang);
      return {
        status: 'success',
        model: 'tencent/Hunyuan-MT-7B',
        sourceText: text,
        translatedText: res.content.trim(),
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
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
  window.TranslationSkill = TranslationSkill;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TranslationSkill };
}
