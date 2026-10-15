/** ArtifactProjectionController: browser UI responsibility with injected application dependencies. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.ArtifactProjectionController = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createArtifactProjectionController({ window }) {
  // 全局提供将图片一键投射至左侧 Artifact 展台与数学工作台的物理桥接
  function projectImageToCanvas(imageUrl, title = '视觉生成画幅', options = {}) {
    if (!imageUrl) return;
    const mode = options.mode || 'artifact';
    const viz = window.workspaceVisualizer;

    // 1. 同步加载至 Artifact 舞台控制器 (解耦独立展台与叠图)
    if (window.artifactStageDeck && typeof window.artifactStageDeck.loadArtifact === 'function') {
      const loaded = window.artifactStageDeck.loadArtifact({
        type: 'image',
        url: imageUrl,
        title: title || '视觉生成画幅',
        prompt: title || '视觉概念生成图'
      }, { mode, autoSwitch: true });
      if (loaded === false) return { status: 'error', code: 'ARTIFACT_PREVIEW_REJECTED' };
    }

    // Without a deck, only explicit overlay requests may write to the canvas.
    if (mode === 'overlay' && !window.artifactStageDeck && viz && typeof viz.setCustomGraphics === 'function') {
      viz.setCustomGraphics([{
        type: 'image',
        centerX: 0,
        centerY: 0,
        width: 4.5,
        height: 4.5,
        url: imageUrl,
        label: title || '视觉生成画幅',
        opacity: window.artifactStageDeck ? window.artifactStageDeck.overlayOpacity : 0.65
      }], { clear: true });
    }

    if (typeof window.showToastNotification === 'function') {
      const msg = mode === 'overlay' ? '已将画幅以叠图形式映射至几何坐标系！' : '已在左侧 Artifact 展台呈现视觉生成物！';
      window.showToastNotification(msg);
    }
  };


  return { projectImageToCanvas };
});
