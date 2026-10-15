/**
 * 问矩 · 入场页毕加索立体主义 3D 几何动态引擎 (Picasso Cubist Sculpture Engine)
 * 核心美学：
 * 1. 粗壮有力的立体主义轮廓骨架线 (Bold Contours: 4.5px ~ 5.5px)
 * 2. 鲜明立体的多面体几何色块撞色填充 (Cubist Color Blocking: 钴蓝、电光天青、赭石金、纯白)
 * 3. 经典版画斜线平行阴影 (Hand-drawn Hatching Texture)
 * 4. 纯净浅底软垫背景，60fps 优雅自转与 360° 全向鼠标拖拽
 */

class Landing3DVisualizer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');

    this.width = 0;
    this.height = 0;

    // 视角状态 (欧拉角与惯性)
    this.rotX = 0.42;
    this.rotY = 0.58;
    this.rotZ = 0.05;
    this.velX = 0.002;
    this.velY = 0.004;

    // 4D 空间持续旋转角 (用于 Tesseract 四维内外高维翻转)
    this.angle4D_XW = 0.15;
    this.angle4D_ZW = 0.08;

    // 缩放
    this.zoom = 1.0;
    this.targetZoom = 1.0;

    // 交互拖拽状态
    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.autoRotate = true;

    this.isRunning = false;

    this.initGeometries();
    this.initEvents();
    this.resize();
  }

  initGeometries() {
    // 1. 4D 超立方体 16 个顶点
    this.vertices4D = [];
    for (let x = -1; x <= 1; x += 2) {
      for (let y = -1; y <= 1; y += 2) {
        for (let z = -1; z <= 1; z += 2) {
          for (let w = -1; w <= 1; w += 2) {
            this.vertices4D.push([x * 0.9, y * 0.9, z * 0.9, w * 0.9]);
          }
        }
      }
    }

    // 2. 32 条 4D 骨架边
    this.edges4D = [];
    for (let i = 0; i < 16; i++) {
      for (let j = i + 1; j < 16; j++) {
        let diff = 0;
        for (let k = 0; k < 4; k++) {
          if (this.vertices4D[i][k] !== this.vertices4D[j][k]) diff++;
        }
        if (diff === 1) {
          this.edges4D.push([i, j]);
        }
      }
    }

    // 3. 24 个四边形面 (提取三维立方胞表面，用于毕加索几何色块填充)
    this.faces4D = [];
    for (let axis1 = 0; axis1 < 4; axis1++) {
      for (let axis2 = axis1 + 1; axis2 < 4; axis2++) {
        for (let vA of [-0.9, 0.9]) {
          for (let vB of [-0.9, 0.9]) {
            const remainingAxes = [0, 1, 2, 3].filter(a => a !== axis1 && a !== axis2);

            const findVertex = (val1, val2) => {
              return this.vertices4D.findIndex(v => 
                Math.abs(v[axis1] - val1) < 0.01 &&
                Math.abs(v[axis2] - val2) < 0.01 &&
                Math.abs(v[remainingAxes[0]] - vA) < 0.01 &&
                Math.abs(v[remainingAxes[1]] - vB) < 0.01
              );
            };

            const i0 = findVertex(-0.9, -0.9);
            const i1 = findVertex( 0.9, -0.9);
            const i2 = findVertex( 0.9,  0.9);
            const i3 = findVertex(-0.9,  0.9);

            if (i0 !== -1 && i1 !== -1 && i2 !== -1 && i3 !== -1) {
              this.faces4D.push([i0, i1, i2, i3]);
            }
          }
        }
      }
    }

    // 毕加索经典撞色色盘 (Palette: 钴蓝、天青、琥珀金、极简白、淡青灰)
    this.cubistPalette = [
      'rgba(37, 99, 235, 0.45)',  // 经典钴蓝
      'rgba(14, 165, 233, 0.38)', // 明快天青
      'rgba(245, 158, 11, 0.42)', // 暖调赭石金
      'rgba(255, 255, 255, 0.85)',// 纯净高光白
      'rgba(2, 132, 199, 0.32)',  // 深邃海蓝
      'rgba(217, 119, 6, 0.35)'   // 深琥珀
    ];
  }

  initEvents() {
    window.addEventListener('resize', () => this.resize());

    // 鼠标拖拽 3D 轨迹球控制
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.autoRotate = false;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.velY = dx * 0.007;
      this.velX = dy * 0.007;

      this.rotY += this.velY;
      this.rotX += this.velX;
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
        clearTimeout(this.autoRotateTimer);
        this.autoRotateTimer = setTimeout(() => {
          this.autoRotate = true;
        }, 3000);
      }
    });

    // 滚轮缩放
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.05 : 0.95;
      this.targetZoom = Math.min(Math.max(this.targetZoom * delta, 0.75), 1.35);
    }, { passive: false });
  }

  resize() {
    const parent = this.canvas.parentElement;
    const rect = parent ? parent.getBoundingClientRect() : null;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.width = (rect && rect.width > 50) ? rect.width : (this.canvas.clientWidth || 700);
    this.height = (rect && rect.height > 50) ? rect.height : (this.canvas.clientHeight || 700);
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    if (this.ctx) {
      if (typeof this.ctx.resetTransform === 'function') {
        this.ctx.resetTransform();
      } else if (typeof this.ctx.setTransform === 'function') {
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (typeof this.ctx.scale === 'function') {
        this.ctx.scale(dpr, dpr);
      }
    }
    this.canvas.style.cursor = 'grab';
    this.render();
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.resize();
    this.render();
    this.animate();
  }

  stop() {
    this.isRunning = false;
  }

  animate() {
    if (!this.isRunning) return;

    if (this.autoRotate) {
      this.rotY += 0.0018; // 舒缓优雅、沉静自转
      this.rotX = 0.42 + Math.sin(Date.now() * 0.0004) * 0.04;
    } else {
      this.rotY += this.velY;
      this.rotX += this.velX;
      this.velX *= 0.94;
      this.velY *= 0.94;
    }

    // 4D 持续高维旋转 (慢速优雅翻转)
    this.angle4D_XW += 0.0028;
    this.angle4D_ZW += 0.0018;

    this.zoom += (this.targetZoom - this.zoom) * 0.1;

    this.render();
    requestAnimationFrame(() => this.animate());
  }

  project4Dto3D(v4) {
    let [x, y, z, w] = v4;

    const cosXW = Math.cos(this.angle4D_XW);
    const sinXW = Math.sin(this.angle4D_XW);
    let x1 = x * cosXW - w * sinXW;
    let w1 = x * sinXW + w * cosXW;

    const cosZW = Math.cos(this.angle4D_ZW);
    const sinZW = Math.sin(this.angle4D_ZW);
    let z2 = z * cosZW - w1 * sinZW;
    let w2 = z * sinZW + w1 * cosZW;

    const distance4D = 2.6;
    const fov4D = distance4D / (distance4D + w2);

    return [x1 * fov4D, y * fov4D, z2 * fov4D];
  }

  project3Dto2D(p3, scale) {
    let [x, y, z] = p3;

    const cosY = Math.cos(this.rotY);
    const sinY = Math.sin(this.rotY);
    let x1 = x * cosY + z * sinY;
    let z1 = -x * sinY + z * cosY;

    const cosX = Math.cos(this.rotX);
    const sinX = Math.sin(this.rotX);
    let y2 = y * cosX - z1 * sinX;
    let z2 = y * sinX + z1 * cosX;

    const distance3D = 4.8;
    const fov3D = distance3D / (distance3D + z2);

    const projX = this.width / 2 + x1 * scale * this.zoom * fov3D;
    const projY = this.height / 2 + y2 * scale * this.zoom * fov3D;

    return {
      x: projX,
      y: projY,
      z: z2,
      depth: (z2 + 2.5) / 5
    };
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // 缩放比例适度收敛 (0.138)，留出优雅开阔的留白，绝不顶边
    const baseScale = Math.min(this.width, this.height) * 0.138;

    // 投影计算 16 个顶点
    const projected = this.vertices4D.map(v4 => {
      const v3 = this.project4Dto3D(v4);
      return this.project3Dto2D(v3, baseScale);
    });

    // 1. 绘制毕加索立体主义几何色块面片 (Cubist Color Planes)
    this.drawCubistFaces(projected);

    // 2. 绘制粗壮有力的毕加索粗黑轮廓骨架线条 (Bold Contours: 5.0px ~ 5.8px)
    this.drawBoldContours(projected);

    // 3. 绘制节点实心圆点
    this.drawNodes(projected);
  }

  drawCubistFaces(projected) {
    const ctx = this.ctx;

    // 深度排序 (从远到近)
    const sortedFaces = this.faces4D.map((face, index) => {
      const avgZ = face.reduce((sum, idx) => sum + projected[idx].z, 0) / face.length;
      return { face, avgZ, index };
    }).sort((a, b) => a.avgZ - b.avgZ);

    for (let k = 0; k < sortedFaces.length; k++) {
      const { face, avgZ, index } = sortedFaces[k];
      const p0 = projected[face[0]];
      const p1 = projected[face[1]];
      const p2 = projected[face[2]];
      const p3 = projected[face[3]];

      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();

      // 根据面序号分配毕加索撞色
      const colorIndex = index % this.cubistPalette.length;
      ctx.fillStyle = this.cubistPalette[colorIndex];
      ctx.fill();

      // 部分特征面添加经典几何斜线阴影 (Hatching)
      if (index % 3 === 0) {
        this.drawHatchingOnFace(p0, p1, p2, p3);
      }
    }
  }

  // 面片平行阴影纹理 (毕加索素描版画质感)
  drawHatchingOnFace(p0, p1, p2, p3) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.clip();

    ctx.strokeStyle = 'rgba(15, 23, 42, 0.18)';
    ctx.lineWidth = 2.0;
    const minX = Math.min(p0.x, p1.x, p2.x, p3.x) - 40;
    const maxX = Math.max(p0.x, p1.x, p2.x, p3.x) + 40;
    const minY = Math.min(p0.y, p1.y, p2.y, p3.y) - 40;
    const maxY = Math.max(p0.y, p1.y, p2.y, p3.y) + 40;

    for (let x = minX; x < maxX + (maxY - minY); x += 15) {
      ctx.beginPath();
      ctx.moveTo(x, minY);
      ctx.lineTo(x - (maxY - minY), maxY);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 粗壮有力的毕加索立体主义粗轮廓线 (Bold Cubist Ink Contours)
  drawBoldContours(projected) {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [i, j] of this.edges4D) {
      const p1 = projected[i];
      const p2 = projected[j];

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);

      // 主轮廓加粗至 5.0px ~ 5.8px，使用深纯黑墨线
      ctx.lineWidth = (i < 8 && j < 8) ? 5.8 : 5.0;
      ctx.strokeStyle = '#090d16'; // 表现主义粗墨线
      ctx.stroke();
    }
  }

  drawNodes(projected) {
    const ctx = this.ctx;

    for (let i = 0; i < projected.length; i++) {
      const p = projected[i];
      const radius = 4.2 + (p.z + 2) * 0.7;

      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(radius, 3.8), 0, Math.PI * 2);
      ctx.fillStyle = '#090d16';
      ctx.fill();
    }
  }
}

if (typeof window !== 'undefined') {
  window.Landing3DVisualizer = Landing3DVisualizer;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Landing3DVisualizer };
}
