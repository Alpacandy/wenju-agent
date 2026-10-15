/**
 * 问矩 · Manim 几何微课教学包视口组件 (ManimLessonDeck v1.0)
 * 职责：
 * 1. 承载 5 大线性代数核心几何命题精编短视频微课（离线自包含、无声、纯视觉几何变换）；
 * 2. 毫秒级高精度区间循环播放控制器（[start, end] 无缝闭环循环，支持 0.5x~1.25x 倍速细致观测）；
 * 3. 几何知识点解析胶囊（Concept Capsule），形式化阐释代数与几何本质；
 * 4. 一键【联动画板实操 ↗】通道，将微课讲授的算子参数直接装载至坐标画板闭环推演。
 */

(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof root !== 'undefined') {
    root.ManimLessonDeck = api.ManimLessonDeck;
    root.MANIM_LESSONS = api.MANIM_LESSONS;
  }
  if (typeof window !== 'undefined') {
    window.ManimLessonDeck = api.ManimLessonDeck;
    window.MANIM_LESSONS = api.MANIM_LESSONS;
  }
  if (typeof global !== 'undefined') {
    global.ManimLessonDeck = api.ManimLessonDeck;
    global.MANIM_LESSONS = api.MANIM_LESSONS;
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this), function () {
  'use strict';

  const DEFAULT_VIDEO_SRC = 'media/videos/matrix_transformation_film/720p30/MatrixTransformationFilm.mp4';
  const FALLBACK_VIDEO_SRC = 'media_archive/video/final_matrix_transformation_film.mp4';

  const MANIM_LESSONS = [
    {
      id: 'basis_vectors',
      title: '基向量与空间线性变换',
      subtitle: '标准正交基的像唯一决定全局平面映射',
      duration: '28s',
      start: 7.2,
      end: 35.0,
      matrix: { a: 2.0, b: 1.0, c: 1.0, d: 1.0 },
      preset: 'cubist',
      formula: 'A · [x, y]^T = x · A e₁ + y · A e₂',
      takeaway: '任意二维向量均由标准正交基线性表出；基向量经过矩阵 A 的变换结果构成矩阵的列向量，唯一确定整个平面的映射。',
      tag: '基底映射'
    },
    {
      id: 'geometric_operators',
      title: '几何算子与行列式缩放',
      subtitle: '剪切、旋转与单位面域缩放率 |det(A)|',
      duration: '34s',
      start: 36.0,
      end: 70.4,
      matrix: { a: 1.0, b: 1.5, c: 0.0, d: 1.0 },
      preset: 'shear',
      formula: 'det(A) = ad - bc',
      takeaway: '剪切、旋转与伸缩是基本线性几何算子；变换后网格单元的有向面积缩放因子严格对齐行列式绝对值 |det(A)|。',
      tag: '面积测度'
    },
    {
      id: 'multiplication_order',
      title: '乘法复合的非对称性',
      subtitle: '为什么矩阵乘法不满足交换律？',
      duration: '37s',
      start: 71.2,
      end: 108.3,
      matrix: { a: 0.0, b: -1.0, c: 1.0, d: 0.0 },
      preset: 'rotation90',
      formula: 'A · B ≠ B · A',
      takeaway: '矩阵乘法本质是几何映射的先后复合；先剪切后旋转与先旋转后剪切导致截然不同的空间网格构型，故乘法不具交换律。',
      tag: '映射复合'
    },
    {
      id: 'dimension_collapse',
      title: '不可逆降维与空间坍缩',
      subtitle: '行列式为零时的满秩破坏与信息丢失',
      duration: '36s',
      start: 109.1,
      end: 145.2,
      matrix: { a: 2.0, b: 1.0, c: 1.0, d: 0.5 },
      preset: 'singular',
      formula: 'det(A) = 0 ⟹ rank(A) < 2',
      takeaway: '对于 2×2 矩阵，det(A)=0 表示像空间维数小于 2。秩为 1 时像是一条由非零列向量张成的直线；秩为 0 时 A 是零矩阵，像只有原点。本例两列成比例，像为 Span{(2,1)}，逆矩阵不存在。',
      tag: '奇异坍缩'
    },
    {
      id: 'nullspace_zero_divisor',
      title: '零空间与非零零因子',
      subtitle: '两非零矩阵乘积为零矩阵的几何机理',
      duration: '44s',
      start: 146.0,
      end: 190.3,
      matrix: { a: 1.0, b: 0.0, c: 0.0, d: 0.0 },
      preset: 'projectionX',
      formula: 'A · B = O ⟺ Col(B) ⊆ Null(A)',
      takeaway: '非零矩阵相乘可得零矩阵 A·B = O；几何本质为 B 的像空间完全落入 A 的核空间 Col(B) ⊆ Null(A)，向量被彻底压缩进原点。',
      tag: '零空间机理'
    }
  ];

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  class ManimLessonDeck {
    constructor({ container, videoSrc = DEFAULT_VIDEO_SRC, onJumpToCanvas = null } = {}) {
      this.container = typeof container === 'string' ? document.getElementById(container) : container;
      this.videoSrc = videoSrc;
      this.onJumpToCanvas = onJumpToCanvas;
      this.lessons = MANIM_LESSONS;
      this.currentLesson = this.lessons[0];
      this.playbackRate = 1.0;
      this.isPlaying = false;
      this._loopTimer = null;
      this._timeupdateHandler = null;

      if (this.container) {
        this.initDOM();
      }
    }

    $(selector) {
      return this.container ? this.container.querySelector(selector) : null;
    }

    initDOM() {
      if (!this.container) return;
      this.container.innerHTML = `
        <div class="manim-deck-card" aria-label="Manim 几何微课播放台">
          <header class="manim-deck-header">
            <div class="manim-heading">
              <span class="manim-badge">MANIM 微课</span>
              <h2 class="manim-title-text" id="manim-title">${esc(this.currentLesson.title)}</h2>
            </div>
            <div class="manim-header-controls">
              <select id="manim-lesson-select" class="artifact-select" aria-label="选择微课知识点">
                ${this.lessons.map(l => `<option value="${l.id}">${esc(l.title)} (${esc(l.duration)})</option>`).join('')}
              </select>
            </div>
          </header>

          <div class="manim-stage-body">
            <!-- 视频视口区 -->
            <div class="manim-video-wrapper">
              <video id="manim-video-element" class="manim-video-el" playsinline muted autoplay preload="auto">
                <source src="${esc(this.videoSrc)}" type="video/mp4">
                <source src="${esc(FALLBACK_VIDEO_SRC)}" type="video/mp4">
                您的浏览器不支持视频播放。
              </video>
              <div class="manim-video-overlay-badge" id="manim-tag-badge">${esc(this.currentLesson.tag)}</div>
              <div class="manim-video-fallback hidden" id="manim-video-fallback" style="position:absolute;inset:0;background:rgba(15,23,42,0.92);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center;color:#cbd5e1;backdrop-filter:blur(8px);z-index:10;">
                <div style="font-size:28px;margin-bottom:8px;">📐</div>
                <div style="font-weight:700;font-size:15px;color:#f8fafc;margin-bottom:4px;">离线几何解析看板 (微课媒体离线)</div>
                <div style="font-size:13px;max-width:380px;line-height:1.6;color:#94a3b8;margin-bottom:14px;" id="manim-fallback-desc">已自动载入核心几何命题，可直接在坐标画板中交互验证。</div>
                <button type="button" class="btn-deck-action primary" id="btn-manim-fallback-jump">联动画板实操 ↗</button>
              </div>
            </div>

            <!-- 控制栏与进度条 -->
            <div class="manim-control-bar">
              <div class="manim-timeline-track">
                <div class="manim-timeline-fill" id="manim-timeline-progress" style="width: 0%;"></div>
              </div>

              <div class="manim-actions-row">
                <div class="manim-left-actions">
                  <button type="button" class="btn-deck-action primary" id="btn-manim-play-toggle">
                    <span id="manim-play-icon">▶</span>
                    <span id="manim-play-text">播放</span>
                  </button>
                  <button type="button" class="btn-deck-action" id="btn-manim-restart" title="从头播放当前片段">⟲ 重播</button>
                  <span class="manim-time-counter" id="manim-time-counter">0.0s / ${esc(this.currentLesson.duration)}</span>
                </div>

                <div class="manim-right-actions">
                  <div class="manim-speed-group" role="group" aria-label="播放倍速">
                    <button type="button" class="manim-speed-btn" data-speed="0.5">0.5x</button>
                    <button type="button" class="manim-speed-btn" data-speed="0.75">0.75x</button>
                    <button type="button" class="manim-speed-btn active" data-speed="1.0">1.0x</button>
                    <button type="button" class="manim-speed-btn" data-speed="1.25">1.25x</button>
                  </div>
                  <button type="button" class="btn-deck-action" id="btn-manim-jump-canvas" title="将本课矩阵载入坐标画板交互">
                    联动画板实操 ↗
                  </button>
                </div>
              </div>
            </div>

            <!-- 几何解析胶囊与结论卡片 -->
            <section class="manim-concept-capsule" id="manim-concept-capsule">
              <div class="capsule-header">
                <span class="capsule-formula-chip" id="manim-formula">${esc(this.currentLesson.formula)}</span>
                <span class="capsule-subtitle" id="manim-subtitle">${esc(this.currentLesson.subtitle)}</span>
              </div>
              <p class="capsule-takeaway" id="manim-takeaway">${esc(this.currentLesson.takeaway)}</p>
            </section>
          </div>
        </div>
      `;

      this.video = this.$('#manim-video-element');
      this.bindEvents();
    }

    bindEvents() {
      const select = this.$('#manim-lesson-select');
      if (select) {
        select.addEventListener('change', (e) => this.selectLesson(e.target.value));
      }

      const btnPlay = this.$('#btn-manim-play-toggle');
      if (btnPlay) {
        btnPlay.addEventListener('click', () => this.togglePlay());
      }

      const btnRestart = this.$('#btn-manim-restart');
      if (btnRestart) {
        btnRestart.addEventListener('click', () => this.restart());
      }

      const btnJump = this.$('#btn-manim-jump-canvas');
      if (btnJump) {
        btnJump.addEventListener('click', () => this.triggerJumpToCanvas());
      }

      const speedButtons = this.container.querySelectorAll('.manim-speed-btn');
      speedButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const rate = parseFloat(btn.getAttribute('data-speed'));
          this.setPlaybackRate(rate);
          speedButtons.forEach(b => b.classList.toggle('active', b === btn));
        });
      });

      if (this.video) {
        this.video.muted = true;
        this.video.volume = 0;
        this.video.currentTime = this.currentLesson.start;

        this._timeupdateHandler = () => this._handleTimeUpdate();
        this.video.addEventListener('timeupdate', this._timeupdateHandler);
        this.video.addEventListener('loadedmetadata', () => {
          if (this.video.currentTime < this.currentLesson.start || this.video.currentTime >= this.currentLesson.end) {
            this.video.currentTime = this.currentLesson.start;
          }
        });
        this.video.addEventListener('ended', () => this.restart());
        this.video.addEventListener('play', () => this._updatePlayState(true));
        this.video.addEventListener('pause', () => this._updatePlayState(false));

        // 视口被点击直接快捷切换播放/暂停
        this.video.addEventListener('click', () => this.togglePlay());

        const showFallback = () => this.showOfflineFallback();
        this.video.addEventListener('error', showFallback);
        const sources = this.video.querySelectorAll('source');
        sources.forEach(src => src.addEventListener('error', () => {
          if (this.video.networkState === 3 || this.video.error) showFallback();
        }));
      }

      const fallbackJump = this.$('#btn-manim-fallback-jump');
      if (fallbackJump) {
        fallbackJump.addEventListener('click', () => this.triggerJumpToCanvas());
      }
    }

    showOfflineFallback() {
      const fallbackEl = this.$('#manim-video-fallback');
      if (fallbackEl) fallbackEl.classList.remove('hidden');
      const playBtn = this.$('#btn-manim-play-toggle');
      if (playBtn) {
        playBtn.disabled = true;
        playBtn.title = '微课视频离线，已开启画板推演模式';
      }
    }

    _handleTimeUpdate() {
      if (!this.video || !this.currentLesson) return;
      const t = this.video.currentTime;
      const start = this.currentLesson.start;
      const end = this.currentLesson.end;
      const duration = Math.max(0.1, end - start);

      // 循环守卫：超过本片段结尾直接重置回开始位置
      if (t >= end - 0.06 || t < start - 0.5) {
        this.video.currentTime = start;
        return;
      }

      const elapsed = Math.max(0, Math.min(duration, t - start));
      const percent = (elapsed / duration) * 100;

      const progressEl = this.$('#manim-timeline-progress');
      if (progressEl) {
        progressEl.style.width = percent.toFixed(1) + '%';
      }

      const counterEl = this.$('#manim-time-counter');
      if (counterEl) {
        counterEl.textContent = `${elapsed.toFixed(1)}s / ${duration.toFixed(0)}s`;
      }
    }

    selectLesson(lessonId, autoPlay = true) {
      const target = this.lessons.find(l => l.id === lessonId);
      if (!target) return false;
      this.currentLesson = target;

      // 更新界面文本
      const titleEl = this.$('#manim-title');
      if (titleEl) titleEl.textContent = target.title;
      const subEl = this.$('#manim-subtitle');
      if (subEl) subEl.textContent = target.subtitle;
      const formulaEl = this.$('#manim-formula');
      if (formulaEl) formulaEl.textContent = target.formula;
      const takeawayEl = this.$('#manim-takeaway');
      if (takeawayEl) takeawayEl.textContent = target.takeaway;
      const tagEl = this.$('#manim-tag-badge');
      if (tagEl) tagEl.textContent = target.tag;

      const select = this.$('#manim-lesson-select');
      if (select && select.value !== target.id) {
        select.value = target.id;
      }

      if (this.video) {
        this.video.currentTime = target.start;
        if (autoPlay) {
          this.play();
        } else {
          this.pause();
        }
      }
      return true;
    }

    setPlaybackRate(rate) {
      if (!rate || isNaN(rate)) return;
      this.playbackRate = rate;
      if (this.video) {
        this.video.playbackRate = rate;
      }
    }

    play() {
      if (!this.video) return;
      if (this.video.currentTime < this.currentLesson.start || this.video.currentTime >= this.currentLesson.end) {
        this.video.currentTime = this.currentLesson.start;
      }
      this.video.muted = true;
      const p = this.video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => { /* 忽略自动播放受限策略 */ });
      }
    }

    pause() {
      if (this.video && !this.video.paused) {
        this.video.pause();
      }
    }

    togglePlay() {
      if (!this.video) return;
      if (this.video.paused) {
        this.play();
      } else {
        this.pause();
      }
    }

    restart() {
      if (!this.video || !this.currentLesson) return;
      this.video.currentTime = this.currentLesson.start;
      this.play();
    }

    _updatePlayState(isPlaying) {
      this.isPlaying = isPlaying;
      const icon = this.$('#manim-play-icon');
      const text = this.$('#manim-play-text');
      if (icon) icon.textContent = isPlaying ? '⏸' : '▶';
      if (text) text.textContent = isPlaying ? '暂停' : '播放';
    }

    triggerJumpToCanvas() {
      if (typeof this.onJumpToCanvas === 'function') {
        this.onJumpToCanvas({
          lesson: this.currentLesson,
          matrix: this.currentLesson.matrix,
          preset: this.currentLesson.preset,
          title: this.currentLesson.title
        });
      }
    }

    onActivate() {
      // 切换至本视口时自动唤醒静音播放
      this.play();
    }

    destroy() {
      this.pause();
      if (this.video && this._timeupdateHandler) {
        this.video.removeEventListener('timeupdate', this._timeupdateHandler);
      }
    }
  }

  return {
    ManimLessonDeck,
    MANIM_LESSONS
  };
});
