/**
 * 问矩 · 工作台交互有限状态机 (StudioInteractionFSM)
 * 形式化编排交互生命周期，杜绝布尔标志组合爆炸 (Boolean Explosion)
 * 
 * 互斥状态全集 (State Enum):
 * - IDLE: 空闲就绪态 (无输入/初始态，允许配置与输入)
 * - COMPOSING: 内容编辑态 (输入框有文本或暂存附件)
 * - VALIDATING: 前置守卫校验中 (校验提示词与附件体积/类型)
 * - DISPATCHING: 请求分发与通道建立中 (按钮禁用，阻断重复连击)
 * - STREAMING: 推理流式接收中 (正在接收 Thought / Tool / Answer 增量)
 * - SUCCESS: 推导成功完成 (完成状态同步，自动结算归位)
 * - ERROR: 异常失败态 (网络断开或报错，提供明确重试分支)
 */

const StudioStates = Object.freeze({
  IDLE: 'IDLE',
  COMPOSING: 'COMPOSING',
  VALIDATING: 'VALIDATING',
  DISPATCHING: 'DISPATCHING',
  STREAMING: 'STREAMING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR'
});

const StudioEvents = Object.freeze({
  INPUT_CHANGED: 'INPUT_CHANGED',
  SUBMIT_TRIGGERED: 'SUBMIT_TRIGGERED',
  VALIDATION_PASSED: 'VALIDATION_PASSED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  STREAM_START: 'STREAM_START',
  STREAM_CHUNK: 'STREAM_CHUNK',
  STREAM_COMPLETED: 'STREAM_COMPLETED',
  STREAM_ERROR: 'STREAM_ERROR',
  RETRY_TRIGGERED: 'RETRY_TRIGGERED',
  RESET: 'RESET'
});

class StudioInteractionFSM {
  constructor() {
    this.currentState = StudioStates.IDLE;
    this.context = {
      text: '',
      attachments: [],
      error: null,
      lastPayload: null,
      tokensReceived: 0,
      startedAt: null,
      finishedAt: null
    };
    this.listeners = new Set();
  }

  /**
   * 获取当前确定性互斥状态
   */
  getState() {
    return this.currentState;
  }

  getContext() {
    return { ...this.context };
  }

  /**
   * 订阅状态变更事件
   */
  subscribe(listener) {
    if (typeof listener === 'function') {
      this.listeners.add(listener);
      // 立即触发一次当前状态同步
      listener(this.currentState, this.getContext());
    }
    return () => this.listeners.delete(listener);
  }

  notify(prev, event) {
    for (const listener of this.listeners) {
      try {
        listener(this.currentState, this.getContext(), { prev, event });
      } catch (err) {
        console.error('[StudioInteractionFSM] Listener callback error:', err);
      }
    }
  }

  /**
   * 事件驱动的状态迁移核心分发器 (带守卫函数契约)
   * @param {string} eventName 触发事件
   * @param {object} payload 携带载荷
   */
  transition(eventName, payload = {}) {
    const prev = this.currentState;
    let next = prev;

    // 万能抢占重置契约 (Preemptive Reset Invariant)
    // 无论当前处于何种状态，RESET 事件均拥有最高优先级，强制清空上下文并归位至 IDLE
    if (eventName === StudioEvents.RESET) {
      this.resetContext();
      if (payload.text || (payload.attachments && payload.attachments.length > 0)) {
        this.context.text = payload.text || '';
        this.context.attachments = payload.attachments || [];
        next = StudioStates.COMPOSING;
      } else {
        next = StudioStates.IDLE;
      }
      this.currentState = next;
      this.notify(prev, eventName);
      return;
    }

    switch (this.currentState) {
      case StudioStates.IDLE:
        if (eventName === StudioEvents.INPUT_CHANGED) {
          const hasContent = Boolean((payload.text && payload.text.trim()) || (payload.attachments && payload.attachments.length > 0));
          if (hasContent) {
            this.context.text = payload.text || '';
            this.context.attachments = payload.attachments || [];
            next = StudioStates.COMPOSING;
          }
        } else if (eventName === StudioEvents.SUBMIT_TRIGGERED) {
          // 守卫契约：有内容才允许进入校验
          if (this.guardCanSubmit(payload)) {
            this.context.lastPayload = payload;
            next = StudioStates.VALIDATING;
          }
        }
        break;

      case StudioStates.COMPOSING:
        if (eventName === StudioEvents.INPUT_CHANGED) {
          this.context.text = payload.text || '';
          this.context.attachments = payload.attachments || [];
          const hasContent = Boolean(this.context.text.trim() || this.context.attachments.length > 0);
          if (!hasContent) {
            next = StudioStates.IDLE;
          }
        } else if (eventName === StudioEvents.SUBMIT_TRIGGERED) {
          if (this.guardCanSubmit(payload)) {
            this.context.lastPayload = payload;
            next = StudioStates.VALIDATING;
          }
        }
        break;

      case StudioStates.VALIDATING:
        if (eventName === StudioEvents.VALIDATION_PASSED) {
          this.context.startedAt = Date.now();
          this.context.tokensReceived = 0;
          this.context.error = null;
          next = StudioStates.DISPATCHING;
        } else if (eventName === StudioEvents.VALIDATION_FAILED) {
          this.context.error = payload.error || '校验未通过';
          next = StudioStates.COMPOSING;
        } else if (eventName === StudioEvents.STREAM_ERROR) {
          this.context.error = payload.error || '校验异常中断';
          next = StudioStates.ERROR;
        }
        break;

      case StudioStates.DISPATCHING:
        // 关键防连击守卫：在 DISPATCHING 态下，重复的 SUBMIT_TRIGGERED 被静默丢弃
        if (eventName === StudioEvents.SUBMIT_TRIGGERED) {
          console.warn('[StudioInteractionFSM] 忽略重复提交：当前已在请求分发中');
          return;
        } else if (eventName === StudioEvents.STREAM_START || eventName === StudioEvents.STREAM_CHUNK) {
          this.context.tokensReceived++;
          next = StudioStates.STREAMING;
        } else if (eventName === StudioEvents.STREAM_COMPLETED) {
          // 非流式或直接快速返回场景：直接迁移至 SUCCESS 态
          this.context.finishedAt = Date.now();
          next = StudioStates.SUCCESS;
        } else if (eventName === StudioEvents.STREAM_ERROR) {
          this.context.error = payload.error || '通信建立失败';
          next = StudioStates.ERROR;
        }
        break;

      case StudioStates.STREAMING:
        // 关键防连击守卫：流式响应中忽略任何提交
        if (eventName === StudioEvents.SUBMIT_TRIGGERED) {
          console.warn('[StudioInteractionFSM] 忽略重复提交：推理流生成中');
          return;
        } else if (eventName === StudioEvents.STREAM_CHUNK) {
          this.context.tokensReceived++;
          // 维持在 STREAMING
        } else if (eventName === StudioEvents.STREAM_COMPLETED) {
          this.context.finishedAt = Date.now();
          next = StudioStates.SUCCESS;
        } else if (eventName === StudioEvents.STREAM_ERROR) {
          this.context.error = payload.error || '流式推理中断';
          next = StudioStates.ERROR;
        }
        break;

      case StudioStates.SUCCESS:
        // 成功后自动结算归位，准备下一轮
        if (eventName === StudioEvents.INPUT_CHANGED) {
          this.resetContext();
          if (payload.text || (payload.attachments && payload.attachments.length > 0)) {
            this.context.text = payload.text || '';
            this.context.attachments = payload.attachments || [];
            next = StudioStates.COMPOSING;
          } else {
            next = StudioStates.IDLE;
          }
        } else if (eventName === StudioEvents.SUBMIT_TRIGGERED) {
          if (this.guardCanSubmit(payload)) {
            this.context.lastPayload = payload;
            next = StudioStates.VALIDATING;
          }
        }
        break;

      case StudioStates.ERROR:
        if (eventName === StudioEvents.RETRY_TRIGGERED) {
          // 重新回到校验并尝试分发
          next = StudioStates.VALIDATING;
        } else if (eventName === StudioEvents.SUBMIT_TRIGGERED) {
          // 消除 ERROR 态重试死锁：允许在报错后直接点击发送重新发起校验与分发
          if (this.guardCanSubmit(payload)) {
            this.context.error = null;
            this.context.lastPayload = payload;
            next = StudioStates.VALIDATING;
          }
        } else if (eventName === StudioEvents.INPUT_CHANGED) {
          this.context.error = null;
          next = StudioStates.IDLE;
        }
        break;
    }

    if (next !== prev) {
      this.currentState = next;
      this.notify(prev, eventName);
    }
  }

  /**
   * 提交守卫函数
   */
  guardCanSubmit(payload) {
    const text = (payload.text !== undefined ? payload.text : this.context.text) || '';
    const atts = payload.attachments !== undefined ? payload.attachments : this.context.attachments;
    const hasText = text.trim().length > 0;
    const hasAttachments = atts && atts.length > 0;
    return hasText || hasAttachments;
  }

  resetContext() {
    this.context.text = '';
    this.context.attachments = [];
    this.context.error = null;
    this.context.tokensReceived = 0;
    this.context.startedAt = null;
    this.context.finishedAt = null;
  }

  forceReset() {
    this.transition(StudioEvents.RESET);
  }
}

// 导出全局单例与模块接口
if (typeof window !== 'undefined') {
  window.StudioStates = StudioStates;
  window.StudioEvents = StudioEvents;
  window.StudioInteractionFSM = StudioInteractionFSM;
  window.studioFSM = new StudioInteractionFSM();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { StudioStates, StudioEvents, StudioInteractionFSM };
}
