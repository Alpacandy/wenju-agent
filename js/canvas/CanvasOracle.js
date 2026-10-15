/**
 * Exact, backend-independent canvas oracle. Rendering adapters may use floats
 * for pixels; this module is the single source for matrix truth and readback.
 */
(function (root, factory) {
  const rational = typeof require !== 'undefined' ? require('../math/RationalCore.js') : (root && root.RationalCore);
  const api = factory(rational);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CanvasOracle = api.CanvasOracle;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null), function (rational) {
  'use strict';
  const M = rational && rational.M;
  if (!M) throw new Error('CanvasOracle requires RationalCore.M');

  function asArray(input, dimension) {
    if (Array.isArray(input)) return input;
    if (input && Array.isArray(input.elements)) return input.elements;
    if (!dimension && input && typeof input === 'object') {
      if (['a', 'b', 'c', 'd'].every((key) => Object.hasOwn(input, key))) dimension = 2;
      else if (Object.hasOwn(input, 'm00')) dimension = 3;
    }
    if (dimension === 2 && input && typeof input === 'object') return [[input.a ?? 1, input.b ?? 0], [input.c ?? 0, input.d ?? 1]];
    if (dimension === 3 && input && typeof input === 'object') return [
      [input.m00 ?? 1, input.m01 ?? 0, input.m02 ?? 0],
      [input.m10 ?? 0, input.m11 ?? 1, input.m12 ?? 0],
      [input.m20 ?? 0, input.m21 ?? 0, input.m22 ?? 1]
    ];
    throw new TypeError('matrix must be an array or dimension-specific matrix object');
  }

  function matrixDimension(matrix) {
    if (!Array.isArray(matrix) || matrix.length === 0 || !matrix.every((row) => Array.isArray(row) && row.length === matrix.length)) throw new TypeError('matrix must be a non-empty square array');
    if (![2, 3].includes(matrix.length)) throw new RangeError('CanvasOracle supports only 2x2 and 3x3 matrices');
    return matrix.length;
  }

  function snapshot(input, options = {}) {
    const matrix = asArray(input, options.dimension || (Array.isArray(input) ? input.length : undefined));
    const n = matrixDimension(matrix);
    const exact = M.from(matrix);
    const det = M.det(exact);
    const rank = M.rank(exact);
    const result = {
      schema: 'teachagent.canvas.oracle.v1',
      kind: options.kind || (n === 3 ? '3d' : '2d'),
      dimension: n,
      matrix: M.toStrMatrix(exact),
      det: rational.R.str(det),
      detApprox: rational.R.approx(det),
      rank,
      nullity: n - rank,
      isSingular: rational.R.isZero(det),
      nullBasis: M.nullBasis(exact).map((vector) => vector.map(String)),
      inputCanonical: M.toStrMatrix(exact),
      kernelVersion: rational.VERSION,
      reproducible: { operation: options.operation || 'snapshot', input: M.toStrMatrix(exact) }
    };
    if (options.vector !== undefined) {
      const applied = M.applyVec(exact, options.vector);
      result.vector = options.vector.map((value) => rational.R.str(rational.R.from(value)));
      result.vectorImage = applied.map((value) => rational.R.str(value));
    }
    return result;
  }

  function compare(left, right) {
    const a = snapshot(left, { dimension: Array.isArray(left) ? left.length : undefined });
    const b = snapshot(right, { dimension: Array.isArray(right) ? right.length : undefined });
    return { equal: JSON.stringify(a.matrix) === JSON.stringify(b.matrix) && a.det === b.det && a.rank === b.rank, left: a, right: b };
  }

  const CanvasOracle = Object.freeze({ snapshot, compare });
  return { CanvasOracle, asArray, snapshot, compare };
});
