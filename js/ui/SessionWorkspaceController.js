/** Owns the visible workspace and fences state at conversation boundaries. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.SessionWorkspaceController = factory;
})(typeof globalThis !== 'undefined' ? globalThis : this, function({ window, manager, getVisualizer, stop }) {
  let visibleSessionId = null;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const fields = ['matrix', 'matrix3D', 'probeVector', 'showProbe', 'showBasisVectors', 'dimensionMode', 'rotX', 'rotY', 'originX', 'originY', 'unitScale', 'customGraphics', 'oracleMatrixB', 'oracleNullspace', 'activeFocusMode', 'activeSubspaceHighlight'];
  let defaults = null;
  let defaultViewport = null;
  let restoringComposer = false;
  function saveComposerDraft() {
    if(restoringComposer || !visibleSessionId)return true;
    const dock=window.promptInputDock;
    if(!dock?.textarea)return true;
    try { const saved = manager.saveDraft(visibleSessionId,dock.textarea.value); if(saved===false)dock.showInputNotice?.('SESSION_SAVE_FAILED：草稿未保存，请释放存储后重试。'); return saved !== false; }
    catch(error){dock.showInputNotice?.(error.message);return false;}
  }
  function capture() {
    if (!visibleSessionId || !manager.getSessionById(visibleSessionId)) return true;
    const viz = getVisualizer(), flow = window.inquiryFlow, store = window.pechdtStateStore;
    if (!saveComposerDraft()) return false;
    if (!viz) return true;
    return manager.saveWorkspace(visibleSessionId, {
      viewport: { width: viz.width, height: viz.height },
      undo: viz.stateManager ? clone({ history: viz.stateManager.history, cursor: viz.stateManager.cursor }) : null,
      canvas: clone(Object.fromEntries(fields.map(key => [key, viz?.[key]]).filter(([,v]) => v !== undefined))),
      annotation:viz.annotationLayer?clone({strokes:viz.annotationLayer.strokes}):null,
      artifact: window.artifactStageDeck?.captureSession(),
      teaching: { state: clone(store?.state), chain: clone(store?.chain), task: clone(flow?.task), activeVariantId: flow?.activeVariantId || null, pendingDiscrimination: clone(flow?.pendingDiscrimination), records: clone(window.predictionCollector?.records || []) }
    }) !== false;
  }
  function activate(sessionId, { remount = false } = {}) {
    if (sessionId === visibleSessionId && !remount) return;
    if (!manager.getSessionById(sessionId)) throw new Error('SESSION_NOT_FOUND');
    if (!remount) prepareLeave();
    manager.setActiveSessionId?.(sessionId);
    const session = manager.getSessionById(sessionId);
    const snapshot = session.workspace || {};
    const viz = getVisualizer();
    if (viz) {
      if (!defaults) { defaults = clone(Object.fromEntries(fields.map(key => [key, viz[key]]).filter(([,v]) => v !== undefined))); defaultViewport = { width: viz.width, height: viz.height }; }
      viz.prepareScene('session:' + sessionId + ':' + Date.now(), { resetMatrix: true });
      Object.assign(viz, clone(defaults), clone(snapshot.canvas || {}));
      if(viz.annotationLayer){viz.annotationLayer.toggleActive(false);viz.annotationLayer.strokes=clone(snapshot.annotation?.strokes||[]);viz.annotationLayer.undoStack=[];viz.annotationLayer.redraw();}
      viz.render(); viz.updateHUD(); viz.syncDimensionUI?.();
    }
    window.artifactStore?.setSession(sessionId);
    if (!session.workspace) {
      const references = (session.turns || []).flatMap(turn => (turn.steps || []).map(step => step.result).filter(result => result?.artifactId));
      window.artifactStore?.importLegacyReferences(references);
      const last = references.at(-1);
      if (last) snapshot.artifact = { artifactId: last.artifactId, versionId: last.versionId, mode: 'artifact' };
      if (session.matrixState?.e1 && session.matrixState?.e2 && viz) {
        viz.matrix = { a: session.matrixState.e1[0], c: session.matrixState.e1[1], b: session.matrixState.e2[0], d: session.matrixState.e2[1] };
      }
    }
    window.courseProgress?.setSession(sessionId);
    window.artifactStageDeck?.restoreSession(snapshot.artifact || {});
    if (viz) {
      if (snapshot.canvas) Object.assign(viz, clone(snapshot.canvas));
      else { viz.originX = defaults.originX; viz.originY = defaults.originY; }
      const viewport = snapshot.canvas ? snapshot.viewport : defaultViewport;
      if (Number.isFinite(viewport?.width) && viewport.width > 0 && Number.isFinite(viz.width)) viz.originX += (viz.width - viewport.width) / 2;
      if (Number.isFinite(viewport?.height) && viewport.height > 0 && Number.isFinite(viz.height)) viz.originY += (viz.height - viewport.height) / 2;
      viz.render(); viz.updateHUD(); viz.syncDimensionUI?.();
    }
    if (viz?.stateManager) {
      viz.stateManager.history = clone(snapshot.undo?.history || []);
      viz.stateManager.cursor = snapshot.undo?.cursor ?? -1;
      if (!viz.stateManager.history.length) viz.stateManager.pushSnapshot('会话初始状态');
      viz.stateManager.notifyChange();
    }
    const teaching = snapshot.teaching || {}, flow = window.inquiryFlow, store = window.pechdtStateStore;
    if (flow) { flow.task = clone(teaching.task || null); flow.activeVariantId = teaching.activeVariantId || null; flow.pendingDiscrimination = clone(teaching.pendingDiscrimination || null); }
    if (store) {
      store.state = clone(teaching.state || { stage: 'IDLE', antiSpoilerTriggered: false, updatedAt: null, source: 'session' });
      store.chain = clone(teaching.chain || { taskId: null, seq: 0, prevHash: '00000000' });
      store._persist();
      store.notify(); store.syncBadgeDom();
    }
    if (window.predictionCollector) window.predictionCollector.records = clone(teaching.records || []);
    visibleSessionId = sessionId;
    restoringComposer=true;
    try { const dock=window.promptInputDock;if(dock){dock.attachments=[];dock.renderTray();dock.setText(session.composerDraft||'');dock.hideInputNotice?.();} }
    finally {restoringComposer=false;}
  }
  function clearCurrent() {
    stop();
    const sessionId=visibleSessionId;
    if (!capture()) throw new Error('SESSION_SAVE_FAILED：未清空，当前记录已保留。');
    manager.clearSession(sessionId);
    activate(sessionId,{remount:true});
  }
  function prepareLeave() {
    stop();
    if (!capture()) throw new Error('SESSION_SAVE_FAILED：未切换，当前会话画板最新改动未能保存。');
  }
  return { activate, capture, prepareLeave, clearCurrent, saveComposerDraft, getSessionId: () => visibleSessionId };
});
