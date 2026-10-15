/**
 * 问矩 · 时空穿梭控制器组件 (TimeTravelScrubber v2.0)
 * 深度复用并超越 ZCode modelTrajectory.ts 时间线回放能力
 * 核心机制：
 * 1. 浮动式/嵌入式时空进度条，标明探究步数与关键代数事件
 * 2. 步进、步退与任意步点击瞬移回放
 * 3. 历史态只读安全防护与“一键返回最新现场 (Live)”
 */

class TimeTravelScrubber {
  constructor(options = {}) {
    this.container = options.container || null;
    this.recorder = options.recorder || null;
    this.onScrub = options.onScrub || (() => {});
    this.onResumeLive = options.onResumeLive || (() => {});
    this.isScrubbing = false;

    if (this.recorder) {
      this.recorder.subscribe((snapshot, currIdx, total) => {
        this.render(currIdx, total, snapshot);
      });
    }
  }

  mount(container) {
    this.container = container;
    const snap = this.recorder ? this.recorder.getCurrentSnapshot() : null;
    const curr = this.recorder ? this.recorder.currentIndex : -1;
    const total = this.recorder ? this.recorder.snapshots.length : 0;
    this.render(curr, total, snap);
  }

  render(currIdx, totalCount, currentSnapshot) {
    if (!this.container) return;

    if (totalCount <= 1) {
      this.container.innerHTML = `
        <div class="time-travel-bar" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; font-size: 11px; color: #94a3b8;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span>
            <span>时空记录仪已就绪 (步骤 1/1)</span>
          </div>
          <span style="color: #64748b;">实时同步中</span>
        </div>
      `;
      return;
    }

    const isLive = currIdx === totalCount - 1;
    const matrixStr = currentSnapshot?.matrixState?.elements 
      ? `A=[[${currentSnapshot.matrixState.elements[0].join(',')}],[${currentSnapshot.matrixState.elements[1].join(',')}]]`
      : '单位映射';
    const detVal = currentSnapshot?.matrixState?.det !== undefined 
      ? `det=${currentSnapshot.matrixState.det.toFixed(2)}`
      : '';

    this.container.innerHTML = `
      <div class="time-travel-bar" style="display: flex; align-items: center; justify-content: space-between; padding: 6px 14px; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(8px); border: 1px solid ${isLive ? 'rgba(56, 189, 248, 0.25)' : 'rgba(245, 158, 11, 0.4)'}; border-radius: 8px; font-size: 11px; color: #e2e8f0; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 8px; min-width: 150px;">
          <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${isLive ? '#10b981' : '#f59e0b'}; box-shadow: 0 0 8px ${isLive ? '#10b981' : '#f59e0b'};"></span>
          <span style="font-weight: 600; color: ${isLive ? '#38bdf8' : '#fbbf24'};">
            ${isLive ? '🔴 LIVE 实时演算' : `⏪ 时空穿梭 (第 ${currIdx + 1}/${totalCount} 步)`}
          </span>
        </div>

        <div style="flex: 1; display: flex; align-items: center; gap: 10px;">
          <button id="btn-tt-prev" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; color: #cbd5e1; cursor: pointer; padding: 2px 6px; font-size: 11px;" ${currIdx <= 0 ? 'disabled' : ''}>◀ 步退</button>
          
          <input id="range-tt-scrubber" type="range" min="0" max="${totalCount - 1}" value="${currIdx}" style="flex: 1; cursor: pointer; accent-color: ${isLive ? '#38bdf8' : '#f59e0b'}; height: 4px;" />
          
          <button id="btn-tt-next" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 4px; color: #cbd5e1; cursor: pointer; padding: 2px 6px; font-size: 11px;" ${currIdx >= totalCount - 1 ? 'disabled' : ''}>步进 ▶</button>
        </div>

        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="color: #94a3b8; font-family: monospace;">${matrixStr} (${detVal})</span>
          ${!isLive ? `
            <button id="btn-tt-live" style="background: #0284c7; hover: #0369a1; border: none; border-radius: 4px; color: white; cursor: pointer; padding: 2px 8px; font-weight: 600; font-size: 10px;">
              回到最新现场 ⚡
            </button>
          ` : ''}
        </div>
      </div>
    `;

    // 绑定事件
    const prevBtn = this.container.querySelector('#btn-tt-prev');
    const nextBtn = this.container.querySelector('#btn-tt-next');
    const slider = this.container.querySelector('#range-tt-scrubber');
    const liveBtn = this.container.querySelector('#btn-tt-live');

    if (prevBtn) {
      prevBtn.onclick = () => {
        if (this.recorder) {
          const snap = this.recorder.undo();
          if (snap) this.onScrub(snap);
        }
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (this.recorder) {
          const snap = this.recorder.redo();
          if (snap) this.onScrub(snap);
        }
      };
    }
    if (slider) {
      slider.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        if (this.recorder) {
          const snap = this.recorder.scrubTo(val);
          if (snap) this.onScrub(snap);
        }
      };
    }
    if (liveBtn) {
      liveBtn.onclick = () => {
        if (this.recorder) {
          const snap = this.recorder.resumeLatest();
          if (snap) {
            this.onScrub(snap);
            this.onResumeLive();
          }
        }
      };
    }
  }
}

if (typeof window !== 'undefined') {
  window.TimeTravelScrubber = TimeTravelScrubber;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TimeTravelScrubber };
}
