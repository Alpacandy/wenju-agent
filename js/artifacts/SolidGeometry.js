/** Parametric solids. Connectivity is derived from coordinates, never from model prose. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SolidGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function cube(side = 2) {
    if (!Number.isFinite(side) || side <= 0 || side > 100) throw new Error('INVALID_SIDE_LENGTH');
    const vertices = Array.from({length:8}, (_,i) => [0,1,2].map(axis => (i & (1 << axis) ? 1 : -1) * side / 2));
    const edges = [];
    for (let i=0;i<8;i++) for (let j=i+1;j<8;j++) {
      const delta = i ^ j;
      if ((delta & (delta-1)) === 0) edges.push([i,j]);
    }
    const faces = [];
    for (let axis=0;axis<3;axis++) for (let bit=0;bit<2;bit++) {
      const axes = [0,1,2].filter(a=>a!==axis);
      const indices = [[0,0],[1,0],[1,1],[0,1]].map(pair => (bit<<axis)|(pair[0]<<axes[0])|(pair[1]<<axes[1]));
      const normal = [0,0,0]; normal[axis] = bit ? 1 : -1;
      faces.push({indices,normal});
    }
    return {vertices,edges,faces,side,surfaceArea:6*side*side,volume:side**3};
  }
  function rotate(v, yaw, pitch) {
    const x = v[0]*Math.cos(yaw)+v[2]*Math.sin(yaw), z = -v[0]*Math.sin(yaw)+v[2]*Math.cos(yaw);
    return [x, v[1]*Math.cos(pitch)-z*Math.sin(pitch), v[1]*Math.sin(pitch)+z*Math.cos(pitch)];
  }
  function project(v, distance = 7) {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite) || distance <= v[2]) throw new Error('INVALID_PROJECTION');
    const scale = distance/(distance-v[2]);
    return [v[0]*scale,-v[1]*scale];
  }
  function create(kind) {
    if (!['cube','sphere'].includes(kind)) throw new Error('UNSUPPORTED_SOLID');
    const documentApi=typeof module==='object'&&module.exports?require('./NativeMathDocument.js'):globalThis.NativeMathDocument;
    if(!documentApi)throw new Error('NATIVE_MATH_DOCUMENT_UNAVAILABLE');
    return documentApi.create(kind,{}, {title:kind==='cube'?'正方体':'球体',meta:{solidKind:kind}});
  }
  return {cube,rotate,project,create};
});
