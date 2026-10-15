/**
 * M1 刀①：Observation → 画布/同屏 Oracle 回流
 * 真能力：状态可变 ∧ Observation/UI 同一终态
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    const api = factory();
    root.applyObservationToCanvas = api.applyObservationToCanvas;
    root.normalizeMatrix2x2 = api.normalizeMatrix2x2;
    root.readOracleMatrixB = api.readOracleMatrixB;
  }
})(typeof window !== 'undefined' ? window : global, function () {
  function normalizeMatrix2x2(input) {
    if (!input) return null;
    if (Array.isArray(input) && Array.isArray(input[0])) {
      const a = Number(input[0][0]);
      const b = Number(input[0][1]);
      const c = Number(input[1][0]);
      const d = Number(input[1][1]);
      if ([a, b, c, d].some((x) => Number.isNaN(x))) return null;
      return { a, b, c, d, elements: [[a, b], [c, d]] };
    }
    if (typeof input === 'object') {
      const a = Number(input.a);
      const b = Number(input.b);
      const c = Number(input.c);
      const d = Number(input.d);
      if ([a, b, c, d].some((x) => Number.isNaN(x))) return null;
      return { a, b, c, d, elements: [[a, b], [c, d]] };
    }
    return null;
  }

  function matricesEqual(m1, m2) {
    // P1/S9：set→get 为同一浮点恒等回读，精确相等（无 eps）
    return m1.a === m2.a && m1.b === m2.b && m1.c === m2.c && m1.d === m2.d;
  }

  function detOf(m) {
    return m.a * m.d - m.b * m.c;
  }

  function rankOf(m) {
    // P1/S9 清偿：精确秩（RationalCore，无 1e-6 eps）——det 精确非零 → 2；全元精确为零 → 0；否则 1
    let RC0 = null;
    try { RC0 = require('./math/RationalCore.js'); } catch (e) { if (typeof RationalCore !== 'undefined') RC0 = RationalCore; }
    if (RC0) {
      return RC0.M.rank(RC0.M.from([[m.a, m.b], [m.c, m.d]]));
    }
    // 兜底（RationalCore 不可达时不应发生；保留显式失败而非 eps 伪装）
    throw new Error('[observationCanvasSync] RationalCore 未加载，精确 rank 不可用');
  }

  function writeOracleDom(payload) {
    if (typeof document === 'undefined') return { wrote: false };
    let el = document.getElementById('studio-oracle-matrix-b');
    if (!el) {
      const host = document.getElementById('nullspace-dynamic-expr');
      if (host && host.parentElement) {
        el = document.createElement('div');
        el.id = 'studio-oracle-matrix-b';
        el.className = 'studio-oracle-matrix-b subspace-live-banner';
        host.parentElement.insertBefore(el, host.nextSibling);
      }
    }
    if (!el) return { wrote: false };
    if (payload && payload.matrixB) {
      const B = payload.matrixB;
      el.style.display = '';
      el.innerHTML =
        '<span style="font-weight:700;color:#0ea5e9;">同屏 Oracle · 反例 B</span> = [[' +
        B.a.toFixed(3) +
        ', ' +
        B.b.toFixed(3) +
        '], [' +
        B.c.toFixed(3) +
        ', ' +
        B.d.toFixed(3) +
        ']]' +
        (payload.proof ? ' · ' + payload.proof : '');
      return { wrote: true, text: el.textContent };
    }
    if (payload && payload.kind === 'nullspace') {
      el.style.display = '';
      const nb = payload.nullBasis && payload.nullBasis[0];
      el.innerHTML =
        '<span style="font-weight:700;color:#ec4899;">同屏 Oracle · 核空间</span> rank=' +
        payload.rank +
        ' det=' +
        Number(payload.det).toFixed(3) +
        (nb
          ? ' Null≈Span{[' + Number(nb[0]).toFixed(3) + ', ' + Number(nb[1]).toFixed(3) + ']}'
          : '');
      return { wrote: true, text: el.textContent };
    }
    return { wrote: false };
  }

  function readOracleMatrixB(visualizer) {
    if (visualizer && visualizer.oracleMatrixB) {
      return normalizeMatrix2x2(visualizer.oracleMatrixB);
    }
    if (typeof document !== 'undefined') {
      const el = document.getElementById('studio-oracle-matrix-b');
      if (el && el.dataset && el.dataset.bJson) {
        try {
          return normalizeMatrix2x2(JSON.parse(el.dataset.bJson));
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  }

  /**
   * @param {object|null} visualizer Workspace2DVisualizer-like
   * @param {object} observation
   * @returns {object} canvasSync report
   */
  function applyObservationToCanvas(visualizer, observation, context = {}) {
    const obs = observation || {};
    const kind = obs.kind || 'generic';

    if (!visualizer) {
      return {
        applied: false,
        reason: 'no_visualizer',
        oracleBReadable: false,
        finalMatrix: null
      };
    }

    const matrixA = normalizeMatrix2x2(obs.matrixA || obs.finalMatrix || obs.matrix);
    const matrixB = normalizeMatrix2x2(obs.matrixB);

    if (context.signal?.aborted || (typeof context.isRunActive === 'function' && !context.isRunActive())) return { applied: false, code: 'RUN_ABORTED', reason: 'run_aborted', oracleBReadable: false };
    if (context.visualTask?.preferredSurface === 'artifact' || context.visualTask?.surface === 'artifact') return { applied: false, code: 'VISUAL_SURFACE_MISMATCH', reason: 'artifact_surface', oracleBReadable: false };
    if ((kind === 'counterexample' || matrixB) && !matrixB) return { applied: false, reason: 'missing_matrix_b', oracleBReadable: false };
    const scene = typeof visualizer.prepareScene === 'function' ? visualizer.prepareScene(context.sceneId, context) : { sceneId: context.sceneId };

    if (matrixA && typeof visualizer.setMatrix === 'function') {
      visualizer.setMatrix({ a: matrixA.a, b: matrixA.b, c: matrixA.c, d: matrixA.d });
    } else if (matrixA && visualizer.matrix) {
      visualizer.matrix.a = matrixA.a;
      visualizer.matrix.b = matrixA.b;
      visualizer.matrix.c = matrixA.c;
      visualizer.matrix.d = matrixA.d;
      if (typeof visualizer.render === 'function') visualizer.render();
      if (typeof visualizer.updateHUD === 'function') visualizer.updateHUD();
    }

    if (kind === 'nullspace' || obs.highlight === 'kernel') {
      visualizer.activeSubspaceHighlight = 'kernel';
    }

    let oracleBReadable = false;
    let nsDomWritten = false;
    if (kind === 'counterexample' || matrixB) {
      if (!matrixB) {
        return {
          applied: false,
          reason: 'missing_matrix_b',
          oracleBReadable: false,
          finalMatrix: typeof visualizer.getMatrix === 'function' ? visualizer.getMatrix() : visualizer.matrix || null
        };
      }
      visualizer.oracleMatrixB = { a: matrixB.a, b: matrixB.b, c: matrixB.c, d: matrixB.d };
      visualizer.activeFocusMode = 'counterexample';
      visualizer.activeSubspaceHighlight = 'kernel';
      visualizer.showProbe = false;
      // 画布侧：用 probe 或 custom graphics 标出 B 的列（可读几何线索）
      if (typeof visualizer.setCustomGraphics === 'function') {
        visualizer.setCustomGraphics(
          [
            {
              type: 'vector',
              label: 'B 的第 1 列 b₁',
              vertices: [
                [0, 0],
                [matrixB.a, matrixB.c]
              ],
              strokeColor: '#0ea5e9',
              fillColor: 'rgba(14,165,233,0.15)'
            },
            {
              type: 'vector',
              label: 'B 的第 2 列 b₂',
              vertices: [
                [0, 0],
                [matrixB.b, matrixB.d]
              ],
              strokeColor: '#38bdf8',
              fillColor: 'rgba(56,189,248,0.12)'
            }
          ],
          { clear: true, preserveMatrix: true, layer: 'oracle-b', sceneId: scene.sceneId, signal: context.signal, isRunActive: context.isRunActive, title: 'Counterexample B columns' }
        );
      }
      const dom = writeOracleDom({ matrixB, proof: obs.proof, kind: 'counterexample' });
      if (typeof document !== 'undefined') {
        const el = document.getElementById('studio-oracle-matrix-b');
        if (el) {
          el.dataset.bJson = JSON.stringify([[matrixB.a, matrixB.b], [matrixB.c, matrixB.d]]);
        }
      }
      oracleBReadable = !!(visualizer.oracleMatrixB && dom.wrote);
    }

    if (kind === 'nullspace') {
      const nsDom = writeOracleDom({
        kind: 'nullspace',
        det: obs.det != null ? obs.det : matrixA ? detOf(matrixA) : null,
        rank: obs.rank != null ? obs.rank : matrixA ? rankOf(matrixA) : null,
        nullBasis: obs.nullBasis || []
      });
      nsDomWritten = !!nsDom.wrote;
      visualizer.oracleNullspace = {
        det: obs.det,
        rank: obs.rank,
        nullBasis: obs.nullBasis || []
      };
    }

    const finalMatrix =
      typeof visualizer.getMatrix === 'function' ? visualizer.getMatrix() : visualizer.matrix ? { ...visualizer.matrix } : null;

    let matched = true;
    if (matrixA && finalMatrix) {
      matched = matricesEqual(matrixA, finalMatrix);
    }

    if (typeof visualizer.render === 'function') visualizer.render();
    if (typeof visualizer.updateHUD === 'function') visualizer.updateHUD();
    if (context.visualTask) context.visualTask.surface = 'canvas';

    // N1 清偿（B 线）：oracleBReadable 必须为真实证据链——
    // 反例分支 = oracleMatrixB 已写入 && DOM 已写入；核空间分支 = 同屏横幅已写入；
    // 其余 kind 无 Oracle 落屏证据一律 false；且 matrixA 给定但未真正生效（matched=false）时不得宣称可读。
    const truthfulReadable =
      (matched !== false) &&
      (kind === 'counterexample' || matrixB
        ? oracleBReadable
        : kind === 'nullspace'
          ? nsDomWritten
          : false);

    return {
      applied: true,
      sceneId: scene.sceneId,
      kind,
      finalMatrix,
      matrixA: matrixA,
      matrixB: matrixB,
      oracleBReadable: truthfulReadable,
      matched,
      det: finalMatrix ? detOf(finalMatrix) : null,
      rank: finalMatrix ? rankOf(finalMatrix) : null,
      highlight: visualizer.activeSubspaceHighlight || null
    };
  }

  return {
    applyObservationToCanvas,
    normalizeMatrix2x2,
    readOracleMatrixB,
    matricesEqual,
    detOf,
    rankOf
  };
});
