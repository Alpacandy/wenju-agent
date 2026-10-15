/**
 * 问矩 · 画布状态事务管理器 (CanvasStateManager)
 * 职责：
 * 1. 维护 20 层轻量物理状态快照栈 (Snapshot Stack)
 * 2. 提供原子级 undo() / redo() 事务回滚能力
 * 3. 关联 Workspace2DVisualizer 的矩阵形变与子空间高亮流形
 */

class CanvasStateManager {
  constructor(visualizer, maxHistory = 20) {
    this.visualizer = visualizer;
    this.maxHistory = maxHistory;
    this.history = [];
    this.cursor = -1;

    // 初始快照
    if (this.visualizer && this.visualizer.matrix) {
      this.pushSnapshot("初始几何状态");
    }
  }

  /**
   * 记录当前画板的物理状态快照
   * @param {string} description 动作描述 (如: "拖拽基底 e1", "调入奇异态预设")
   */
  pushSnapshot(description = "Manual Transform") {
    if (!this.visualizer || !this.visualizer.matrix) return;

    // 截断游标之后的重做历史，保证历史线单向一致
    if (this.cursor < this.history.length - 1) {
      this.history = this.history.slice(0, this.cursor + 1);
    }

    const snapshot = {
      matrix: {
        a: this.visualizer.matrix.a,
        b: this.visualizer.matrix.b,
        c: this.visualizer.matrix.c,
        d: this.visualizer.matrix.d
      },
      dimensionMode: this.visualizer.dimensionMode || '2D',
      matrix3D: this.visualizer.matrix3D ? { ...this.visualizer.matrix3D } : null,
      det: typeof this.visualizer.getDeterminant === 'function' ? this.visualizer.getDeterminant() : 0,
      activeSubspace: this.visualizer.activeSubspaceHighlight || 'none',
      timestamp: Date.now(),
      description
    };

    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.cursor = this.history.length - 1;
    this.notifyChange();
  }

  /**
   * 撤销至上一物理状态
   */
  undo() {
    if (this.canUndo()) {
      this.cursor--;
      this.applySnapshot(this.history[this.cursor]);
      this.notifyChange();
      return true;
    }
    return false;
  }

  /**
   * 重做至下一物理状态
   */
  redo() {
    if (this.canRedo()) {
      this.cursor++;
      this.applySnapshot(this.history[this.cursor]);
      this.notifyChange();
      return true;
    }
    return false;
  }

  canUndo() {
    return this.cursor > 0;
  }

  canRedo() {
    return this.cursor < this.history.length - 1;
  }

  getCurrentSnapshot() {
    return this.cursor >= 0 ? this.history[this.cursor] : null;
  }

  /**
   * 将快照数据回填并驱动画板执行平滑补间恢复
   */
  applySnapshot(snapshot) {
    if (!snapshot || !this.visualizer) return;
    if (snapshot.dimensionMode && typeof this.visualizer.setDimensionMode === 'function' && this.visualizer.dimensionMode !== snapshot.dimensionMode) {
      this.visualizer.setDimensionMode(snapshot.dimensionMode, snapshot.dimensionMode === '3D' ? snapshot.matrix3D : snapshot.matrix);
    }
    if (snapshot.dimensionMode === '3D' && snapshot.matrix3D) {
      this.visualizer.matrix3D = { ...snapshot.matrix3D };
      this.visualizer.render();
      if (typeof this.visualizer.updateHUD === 'function') {
        this.visualizer.updateHUD();
      }
    } else if (typeof this.visualizer.animateTo === 'function') {
      this.visualizer.animateTo(snapshot.matrix, 300, () => {
        if (snapshot.activeSubspace) {
          this.visualizer.activeSubspaceHighlight = snapshot.activeSubspace;
          this.visualizer.render();
        }
      });
    } else {
      this.visualizer.matrix = { ...snapshot.matrix };
      this.visualizer.render();
      if (typeof this.visualizer.updateHUD === 'function') {
        this.visualizer.updateHUD();
      }
    }
  }

  notifyChange() {
    if (typeof this.onChange === 'function') {
      this.onChange({
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
        current: this.getCurrentSnapshot()
      });
    }
  }
}

if (typeof window !== 'undefined') {
  window.CanvasStateManager = CanvasStateManager;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CanvasStateManager };
}
