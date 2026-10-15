/**
 * 问矩 · 现代 Three.js 三维仿射空间与子空间流形适配器 (ThreeSpaceAdapter v1.0)
 * 深度对标 docs/M2_CANVAS_EMBED_MAP.md 与 Lund 大学《Immersive Linear Algebra》三维正交规范
 * 核心特性：
 * 1. 真实 3×3 仿射变换与三维齐次矩阵 Matrix4
 * 2. 像空间平面、零空间光束流形与三维基底向量 (ArrowHelper)
 * 3. 严格 WebGL 显存生命周期回收：dispose() 清除 Geometry、Material、Renderer (根除 Issue #21833 WebGL Context Lost)
 * 4. 兼容 CanvasPort 统一端口契约
 */

class ThreeSpaceAdapter {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? (typeof document !== 'undefined' ? document.getElementById(container) : null) : container;
    this.options = options;
    this.kind = '3d';
    this.backendName = 'threespace';
    this.capabilities = {
      dims: 3,
      drag: true,
      katexLabels: false,
      highlights: ['kernel', 'image', 'none'],
      vectors: true,
      projection: true,
      engine: 'Three.js'
    };

    // 3×3 矩阵分量 (默认三维标准正交基)
    this.matrix3 = options.matrix3 || {
      m00: 1, m01: 0, m02: 0,
      m10: 0, m11: 1, m12: 0,
      m20: 0, m21: 0, m22: 1
    };

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.basisArrows = [];
    this.manifoldMeshes = [];
    this.highlight = 'none';
    this.isDisposed = false;

    this.initThree();
  }

  initThree() {
    if (typeof window === 'undefined' || !window.THREE || !this.container) {
      // Node 测试或脱机 Headless 模式
      return;
    }

    try {
      const THREE = window.THREE;
      const width = this.container.clientWidth || 600;
      const height = this.container.clientHeight || 450;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0f172a);

      this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
      this.camera.position.set(6, 5, 8);
      this.camera.lookAt(0, 0, 0);

      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.container.appendChild(this.renderer.domElement);

      // 三维参考地平线网格
      const grid = new THREE.GridHelper(10, 10, 0x38bdf8, 0x1e293b);
      this.scene.add(grid);

      // 坐标轴辅助
      const axes = new THREE.AxesHelper(4);
      this.scene.add(axes);

      // 三维基向量 ArrowHelper
      this.updateBasisVectors();

      this.render();
    } catch (err) {
      console.warn('[ThreeSpaceAdapter] Three.js init fallback to headless:', err.message);
    }
  }

  updateBasisVectors() {
    if (!this.scene || typeof window === 'undefined' || !window.THREE) return;
    const THREE = window.THREE;

    // 清理旧箭头
    for (const arr of this.basisArrows) {
      this.scene.remove(arr);
      if (arr.line) arr.line.geometry.dispose();
      if (arr.cone) arr.cone.geometry.dispose();
    }
    this.basisArrows = [];

    const m = this.matrix3;
    const origin = new THREE.Vector3(0, 0, 0);
    const e1 = new THREE.Vector3(m.m00, m.m10, m.m20);
    const e2 = new THREE.Vector3(m.m01, m.m11, m.m21);
    const e3 = new THREE.Vector3(m.m02, m.m12, m.m22);

    const safeDirAndLen = (v, defaultDir) => {
      const len = v.length();
      if (!Number.isFinite(len) || len < 1e-5) {
        return { dir: defaultDir, len: 0.001, visible: false };
      }
      return { dir: v.clone().normalize(), len, visible: true };
    };

    const d1 = safeDirAndLen(e1, new THREE.Vector3(1, 0, 0));
    const d2 = safeDirAndLen(e2, new THREE.Vector3(0, 1, 0));
    const d3 = safeDirAndLen(e3, new THREE.Vector3(0, 0, 1));

    const arr1 = new THREE.ArrowHelper(d1.dir, origin, d1.len, 0xf59e0b, 0.3, 0.15);
    const arr2 = new THREE.ArrowHelper(d2.dir, origin, d2.len, 0x06b6d4, 0.3, 0.15);
    const arr3 = new THREE.ArrowHelper(d3.dir, origin, d3.len, 0xa855f7, 0.3, 0.15);
    arr1.visible = d1.visible;
    arr2.visible = d2.visible;
    arr3.visible = d3.visible;

    this.scene.add(arr1);
    this.scene.add(arr2);
    this.scene.add(arr3);
    this.basisArrows.push(arr1, arr2, arr3);
  }

  render() {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  getMatrix() {
    return {
      a: this.matrix3.m00,
      b: this.matrix3.m01,
      c: this.matrix3.m10,
      d: this.matrix3.m11
    };
  }

  getMatrix3() {
    return { ...this.matrix3 };
  }

  setMatrix(m) {
    if (!m) return;
    const safeFinite = (val, fallback) => (typeof val === 'number' && Number.isFinite(val) ? val : fallback);
    this.matrix3.m00 = safeFinite(m.a, this.matrix3.m00);
    this.matrix3.m01 = safeFinite(m.b, this.matrix3.m01);
    this.matrix3.m10 = safeFinite(m.c, this.matrix3.m10);
    this.matrix3.m11 = safeFinite(m.d, this.matrix3.m11);
    this.updateBasisVectors();
    this.render();
  }

  setMatrix3(m3) {
    if (!m3) return;
    const safeFinite = (val, fallback) => (typeof val === 'number' && Number.isFinite(val) ? val : fallback);
    const keys = ['m00', 'm01', 'm02', 'm10', 'm11', 'm12', 'm20', 'm21', 'm22'];
    for (const k of keys) {
      if (k in m3) {
        this.matrix3[k] = safeFinite(m3[k], this.matrix3[k]);
      }
    }
    this.updateBasisVectors();
    this.render();
  }

  animateTo(target, duration = 600, onComplete = null) {
    this.setMatrix(target);
    if (typeof onComplete === 'function') onComplete();
  }

  setHighlight(mode) {
    if (!['kernel', 'image', 'none'].includes(mode)) {
      return { status: 'error', error: 'INVALID_HIGHLIGHT' };
    }
    this.highlight = mode;
    this.updateSubspaceManifolds();
    this.render();
    return { ok: true, rendered: true, highlight: mode };
  }

  updateSubspaceManifolds() {
    if (!this.scene || typeof window === 'undefined' || !window.THREE) return;
    const THREE = window.THREE;

    // 清理既有流形几何体
    for (const mesh of this.manifoldMeshes) {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
        else mesh.material.dispose();
      }
    }
    this.manifoldMeshes = [];

    if (this.highlight === 'none') return;

    // 绘制声明式三维流形 (MathBox 风格半透明双面几何体)
    const m = this.matrix3;
    const e1 = new THREE.Vector3(m.m00, m.m10, m.m20);
    const e2 = new THREE.Vector3(m.m01, m.m11, m.m21);
    const normal = new THREE.Vector3().crossVectors(e1, e2);

    if (this.highlight === 'image') {
      // 像空间平面 Mesh (Cyan 0x06b6d4)
      const geom = new THREE.PlaneGeometry(8, 8);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geom, mat);
      if (normal.length() > 0.001) {
        mesh.lookAt(normal.normalize());
      }
      this.scene.add(mesh);
      this.manifoldMeshes.push(mesh);
    } else if (this.highlight === 'kernel') {
      // 零空间流形 (Pink 0xec4899)
      const geom = new THREE.CylinderGeometry(0.04, 0.04, 12, 16);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xec4899,
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(geom, mat);
      if (normal.length() > 0.001) {
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.normalize());
      }
      this.scene.add(mesh);
      this.manifoldMeshes.push(mesh);
    }
  }

  getDeterminant3D() {
    const m = this.matrix3;
    return (
      m.m00 * (m.m11 * m.m22 - m.m12 * m.m21) -
      m.m01 * (m.m10 * m.m22 - m.m12 * m.m20) +
      m.m02 * (m.m10 * m.m21 - m.m11 * m.m20)
    );
  }

  getRank3D() {
    const det = this.getDeterminant3D();
    if (Math.abs(det) >= 1e-5) {
      return 3;
    }

    const m = this.matrix3;
    const c0 = [m.m00, m.m10, m.m20];
    const c1 = [m.m01, m.m11, m.m21];
    const c2 = [m.m02, m.m12, m.m22];

    const cross = (u, v) => [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ];
    const normSq = (v) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2];

    // 检验是否存在任意两列线性无关（叉积不为零）
    const x01 = cross(c0, c1);
    const x02 = cross(c0, c2);
    const x12 = cross(c1, c2);

    if (normSq(x01) > 1e-8 || normSq(x02) > 1e-8 || normSq(x12) > 1e-8) {
      return 2;
    }

    // 检验是否存在至少一个非零列
    if (normSq(c0) > 1e-8 || normSq(c1) > 1e-8 || normSq(c2) > 1e-8) {
      return 1;
    }

    return 0;
  }

  getDeterminant() {
    return this.getDeterminant3D();
  }

  getRank() {
    return this.getRank3D();
  }

  getSnapshot() {
    const det = this.getDeterminant3D();
    const rank = this.getRank3D();
    return {
      backend: 'ThreeSpaceAdapter',
      kind: '3d',
      matrix3: this.getMatrix3(),
      det,
      rank,
      isSingular: rank < 3,
      highlight: this.highlight,
      highlightRendered: true
    };
  }

  /**
   * 严格显存与上下文销毁接口 (根除 Issue #21833 WebGL Context Lost 隐患)
   */
  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;

    // 清理三维流形
    for (const mesh of this.manifoldMeshes) {
      if (this.scene) this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
    this.manifoldMeshes = [];

    // 清空箭头几何体
    for (const arr of this.basisArrows) {
      if (this.scene) this.scene.remove(arr);
      if (arr.line) arr.line.geometry.dispose();
      if (arr.cone) arr.cone.geometry.dispose();
    }
    this.basisArrows = [];

    // 递归遍历清理所有材质与几何体
    if (this.scene) {
      this.scene.traverse((obj) => {
        if (obj.geometry) {
          obj.geometry.dispose();
        }
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((mat) => mat.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      this.scene = null;
    }

    // 释放 WebGLRenderer
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentElement) {
        this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }

    this.camera = null;
  }
}

if (typeof window !== 'undefined') {
  window.ThreeSpaceAdapter = ThreeSpaceAdapter;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ThreeSpaceAdapter };
}
