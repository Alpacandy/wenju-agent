/**
 * 问矩 · 技能抽象基类 (BaseSkill)
 * 遵循 DeepSeek Harness 的模块化插件规范：
 * 具备自省 Schema 导出、参数验证、独立执行生命周期与观测回报能力
 */

class BaseSkill {
  constructor(name, description) {
    this.name = name;
    this.description = description;
  }

  /**
   * 导出 OpenAI / Anthropic / MCP 兼容的 Tool Calling Schema
   * @returns {Object} 标准工具 Schema
   */
  getSchema() {
    throw new Error(`[Skill] ${this.name} 必须实现 getSchema()`);
  }

  /**
   * 技能具体执行逻辑
   * @param {Object} args 入参对象
   * @param {Object} context 包含 visualizer, mathEngine 等上下文资源
   * @returns {Promise<Object>} 技能产出载荷
   */
  async execute(args, context = {}) {
    throw new Error(`[Skill] ${this.name} 必须实现 execute(args, context)`);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { BaseSkill };
}
if (typeof window !== 'undefined') {
  window.BaseSkill = BaseSkill;
}
