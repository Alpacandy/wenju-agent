/**
 * 问矩 · 对话上下文自适应压缩折叠器 (ConversationCompactor v1.0)
 * 深度复用 DeepSeek Harness (dsh) packages/compaction 核心理念与剪枝算法
 * 核心机制：
 * 1. 窗口式滑动保留：保留最近 N 轮 (默认 6 轮) 完整多模态工具交互
 * 2. 历史工具结果剪枝 (Tool Result Pruning)：对早于窗口的冗余工具输出折叠为单行代数状态摘要
 * 3. 结构化检查点注入 (Checkpointing)：将早期多轮问答折叠为单条全局状态摘要
 * 4. Token 预算计量器 (Token Meter)：估算上下文长度，防止超出模型窗口或造成高昂延迟
 */

class ConversationCompactor {
  constructor(options = {}) {
    this.maxRetentionRounds = options.maxRetentionRounds || 6; // 默认保留最近 6 轮完整交互
    this.tokenBudget = options.tokenBudget || 6000;            // 上下文 Token 预警阈值
    this.prunedToolCount = 0;
    this.checkpointCount = 0;
  }

  /**
   * 估算消息列表的大致 Token 数量
   * 粗估经验系数：中文约 1.5 字符/Token，英文/代码约 3.8 字符/Token
   */
  estimateTokens(messages = []) {
    let charCount = 0;
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        charCount += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') charCount += (part.text || '').length;
        }
      }
      if (msg.tool_calls) {
        charCount += JSON.stringify(msg.tool_calls).length;
      }
    }
    // 综合加权折合
    return Math.ceil(charCount / 2.5);
  }

  /**
   * 对消息列表执行自适应压缩与工具结果剪枝
   * @param {Array} messages OpenAI 格式消息队列
   * @returns {Array} 压缩后的消息队列
   */
  compact(messages = []) {
    if (!Array.isArray(messages) || messages.length <= this.maxRetentionRounds * 2 + 1) {
      return messages;
    }

    const compacted = [];
    const systemMessage = messages.find(m => m.role === 'system');
    if (systemMessage) {
      compacted.push(systemMessage);
    }

    // 过滤出除 system 之外的交互消息
    const nonSystemMessages = messages.filter(m => m.role !== 'system');
    
    // 计算需要被剪枝的历史分界点
    // 每轮交互通常包含 user -> assistant(with tool_calls) -> tool -> assistant(final)
    // 一个 round 平均 3~4 条 message
    const retainCount = this.maxRetentionRounds * 3;
    const pruneEndIndex = Math.max(0, nonSystemMessages.length - retainCount);

    if (pruneEndIndex <= 0) {
      return messages;
    }

    // 提炼早期历史为检查点摘要
    const historicalSlice = nonSystemMessages.slice(0, pruneEndIndex);
    const recentSlice = nonSystemMessages.slice(pruneEndIndex);

    const summaries = [];
    for (let i = 0; i < historicalSlice.length; i++) {
      const msg = historicalSlice[i];
      if (msg.role === 'user') {
        const text = typeof msg.content === 'string' ? msg.content : (msg.content?.[0]?.text || '');
        summaries.push(`• 学生探讨: "${text.slice(0, 35)}${text.length > 35 ? '...' : ''}"`);
      } else if (msg.role === 'tool') {
        this.prunedToolCount++;
        try {
          const parsed = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
          const detail = parsed?.detail || parsed?.proof || parsed?.status || '执行完成';
          summaries.push(`  └─ 工具结果剪枝 [Tool: ${msg.name || 'mcp'}]: ${detail}`);
        } catch (e) {
          summaries.push(`  └─ 工具结果剪枝: [已压缩历史状态]`);
        }
      }
    }

    // 插入精简检查点 (Checkpoint Message)
    if (summaries.length > 0) {
      this.checkpointCount++;
      compacted.push({
        role: 'system',
        name: 'dsh_context_checkpoint',
        content: `[DSH 上下文压缩检查点 #${this.checkpointCount}]\n以下为更早前 ${summaries.length} 步探索的核心代数状态摘要（历史冗余细节已由 Compactor 安全剪枝）：\n${summaries.join('\n')}`
      });
    }

    // 保留最近的高保真交互
    for (const msg of recentSlice) {
      compacted.push(msg);
    }

    return compacted;
  }

  /**
   * P2（T2.5）：不可压缩区协议（arXiv:2605.23296 教训——压缩抹除关键状态是静默故障）。
   * 教学结构化状态（误解三态/未决追问/PECHDT 态）作为受保护块传入：
   *   - 压缩只作用于 messages（可压缩块），受保护块以引用隔离，永不被改写；
   *   - 返回前后快照哈希与完整性断言，任何实现回归（意外触碰保护块）即刻暴露。
   */
  compactWithProtection(messages, protectedBlocks) {
    const snapBefore = JSON.stringify(protectedBlocks || null);
    const compacted = this.compact(messages);
    const snapAfter = JSON.stringify(protectedBlocks || null);
    let h1 = 5381, h2 = 5381;
    for (let i = 0; i < snapBefore.length; i++) { h1 = ((h1 << 5) + h1 + snapBefore.charCodeAt(i)) >>> 0; }
    for (let i = 0; i < snapAfter.length; i++) { h2 = ((h2 << 5) + h2 + snapAfter.charCodeAt(i)) >>> 0; }
    return {
      messages: compacted,
      protectedIntegrity: snapBefore === snapAfter,
      protectedHashBefore: h1.toString(16),
      protectedHashAfter: h2.toString(16)
    };
  }

  /**
   * 获取当前压缩器运行时指标
   */
  getMetrics() {
    return {
      prunedToolCount: this.prunedToolCount,
      checkpointCount: this.checkpointCount,
      maxRetentionRounds: this.maxRetentionRounds
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ConversationCompactor };
}
if (typeof window !== 'undefined') {
  window.ConversationCompactor = ConversationCompactor;
}
