/**
 * InteractiveArtifactSkill —— 通用交互工件渲染工具（P4 T4.6）
 *
 * 职责：Agent 调用此工具提交 HTML/SVG 交互演示工件 →
 *   1. ArtifactStore 版本栈提交（不可变快照 + 冲突拒绝）；
 *   2. ArtifactStageDeck 双轨路由（html/svg/interactive → SandboxedArtifactRuntime；
 *      geometry/proof/vector → 自研画布，W5 不降级）；
 *   3. TeachingTimeline 写入 artifact_created / artifact_version 事件（W7）。
 *
 * 合同（T4.6）：
 *   - requiresCanvas: false（不依赖画布环境）；
 *   - 内容不得引用外部网络资源（ArtifactStore 静态校验 + CSP 双保险）；
 *   - kind ∈ 'html' | 'svg' | 'interactive'（语义化工件走既有工具，不在此路由）。
 */

let BaseSkillArtifact;
if (typeof require !== 'undefined') {
  try { BaseSkillArtifact = require('./BaseSkill.js').BaseSkill; } catch (e) { if (typeof recordIssue === 'function') recordIssue('InteractiveArtifactSkill', 'if', e); }
}
if (!BaseSkillArtifact && typeof window !== 'undefined') {
  BaseSkillArtifact = window.BaseSkill;
}
if (!BaseSkillArtifact) {
  BaseSkillArtifact = class { constructor(n, d) { this.name = n; this.description = d; } };
}

class InteractiveArtifactSkill extends BaseSkillArtifact {
  constructor() {
    super(
      'render_interactive_artifact',
      '渲染一个交互式 HTML/SVG 数学演示工件（受控沙箱内运行，支持版本回溯）。适用于：动态几何演示、交互式公式探索、可视化动画。'
    );
  }

  getSchema() {
    return {
      name: this.name,
      description: this.description,
      requiresCanvas: false,
      parameters: {
        type: 'object',
        properties: {
          solid_type: { type: 'string', enum: ['cube', 'sphere'], description: '标准三维实体使用经测试的参数化组件，禁止自由编造拓扑' },
          content: {
            type: 'string',
            description: '工件全文：完整 HTML 文档或 SVG 源码（自包含，不得引用外部网络资源；data: URI 允许）'
          },
          kind: {
            type: 'string',
            enum: ['html', 'svg', 'interactive'],
            description: '工件类型：html(完整网页) | svg(矢量图) | interactive(含 JS 交互脚本)'
          },
          artifact_id: {
            type: 'string',
            description: '工件标识（Agent 修订同 id 工件时传同值 → 产生新版本；缺省按内容生成）'
          },
          title: {
            type: 'string',
            description: '工件标题（展示用）'
          },
          reproducible_ref: {
            type: 'string',
            description: '可复现计算记录引用（JSON；教学语义绑定用，可选）'
          }
        },
        anyOf: [{required:['content','kind']},{required:['solid_type']}]
      }
    };
  }

  async execute(args, context = {}) {
    const active = () => !context.signal?.aborted && (!context.isRunActive || context.isRunActive());
    if (!active()) return { status: 'aborted', error: 'USER_ABORTED', previewVerified: false };
    const startTime = Date.now();
    const solidKind = args?.solid_type || context.visualTask?.solidKind;
    const library = typeof window !== 'undefined' ? window.SolidGeometry : require('../artifacts/SolidGeometry.js');
    const solid = solidKind && library ? library.create(solidKind) : null;
    const content = solid ? solid.content : args && args.content;
    const kind = solid ? 'interactive' : (args && args.kind) || 'html';
    const artifactId = (args && args.artifact_id) || ('artifact_' + Date.now());
    const title = solid ? solid.title : (args && args.title) || '';
    const reproducibleRef = (args && args.reproducible_ref) || null;

    if (!content || typeof content !== 'string') {
      return { status: 'error', error: 'INVALID_ARTIFACT_CONTENT', detail: 'content 必须为非空字符串', uiVisible: true };
    }
    if (!['html', 'svg', 'interactive'].includes(kind)) {
      return { status: 'error', error: 'INVALID_ARTIFACT_KIND', detail: 'kind 须为 html/svg/interactive（语义化工件请用既有画布工具）', uiVisible: true };
    }
    // 获取 ArtifactStore（浏览器 / Node 双通道）
    let store = (typeof window !== 'undefined' && window.artifactStore) || null;
    if (!store) {
      try { store = require('../artifacts/ArtifactStore.js').getSharedStore(); } catch (e) { if (typeof recordIssue === 'function') recordIssue('InteractiveArtifactSkill', 'if', e); }
    }

    const commitResult = store
      ? store.commit({ artifactId, kind, content, title, meta: reproducibleRef ? { reproducibleRef } : null })
      : { ok: false, code: 'STORE_UNAVAILABLE', message: 'ArtifactStore 未加载' };

    if (!commitResult.ok) {
      return {
        status: 'error',
        error: commitResult.code,
        detail: '[P4] 工件提交失败：' + commitResult.message,
        uiVisible: true
      };
    }

    // StageDeck 双轨路由（W5：通用工件 → 沙箱；语义化工件不在此路径）
    let renderedVia = 'store-only';
    let preview = { ok: true, previewVerified: false, scope: 'saved-only' };
    const deck = typeof window !== 'undefined' && window.artifactStageDeck;
    if (typeof window !== 'undefined' && window.artifactStageDeck && typeof window.artifactStageDeck.loadArtifact === 'function') {
      try {
        if (!active()) return { status: 'aborted', error: 'USER_ABORTED', artifactId, previewVerified: false };
        const mounted = window.artifactStageDeck.loadArtifact({
          type: kind,
          content,
          title,
          versionId: commitResult.version.versionId,
          artifactId
        }, { source: 'tool:render_interactive_artifact', signal: context.signal });
        renderedVia = mounted === false ? 'store-only（编辑器有未保存修改或预览被拒绝）' : 'sandboxed-iframe';
        if (mounted === false) preview = { ok: false, code: 'ARTIFACT_PREVIEW_REJECTED', previewVerified: false };
        else if (typeof deck.waitForPreview === 'function') preview = await deck.waitForPreview({ artifactId, versionId: commitResult.version.versionId, signal: context.signal });
      } catch (e) {
        renderedVia = 'store-only（StageDeck 渲染失败：' + e.message + '）';
        preview = { ok: false, code: 'ARTIFACT_RUNTIME_ERROR', previewVerified: false, runtimeError: { message: String(e.message).slice(0, 2000) } };
      }
    }

    if (!active()) return { status: 'aborted', error: 'USER_ABORTED', artifactId, versionId: commitResult.version.versionId, previewVerified: false };
    if (!preview.ok) return { status: 'error', error: preview.code, artifactId, versionId: commitResult.version.versionId, sourceHash: commitResult.version.sourceHash, previewVerified: false, runtimeError: preview.runtimeError || null, detail: `工件已保存，但预览未通过：${preview.runtimeError?.message || preview.code}。请修订同一 artifact_id 后重试；不得声明演示成功。` };
    if (context.visualTask && renderedVia === 'sandboxed-iframe') {
      const viz = context.workspaceVisualizer || window.workspaceVisualizer;
      // A later, working artifact supersedes provisional canvas output from this run only.
      if (context.visualTask.surface === 'canvas' && viz?.sceneId === context.sceneId && viz?.prepareScene) viz.prepareScene(context.sceneId + ':artifact', { mode: 'replace', signal: context.signal, isRunActive: context.isRunActive, render: true });
      context.visualTask.surface = 'artifact';
    }

    // TeachingTimeline 联动（W7：事件已在 ArtifactStore.on 中挂接，此处仅确保 store→timeline 桥在 app 初始化时建立）
    const version = commitResult.version;
    return {
      status: 'success',
      artifactId,
      kind,
      versionId: version.versionId,
      sourceHash: version.sourceHash,
      parentVersionId: version.parentVersionId,
      isNewVersion: commitResult.created,
      renderedVia,
      previewVerified: preview.previewVerified,
      verificationScope: preview.scope,
      title,
      durationMs: Date.now() - startTime,
      detail: `工件已保存${commitResult.created ? '（新版本 v' + version.seq + '）' : '（已有版本）'}：${title || artifactId} · ${preview.previewVerified ? '启动检查通过；未验证全部用户交互' : '仅保存，尚未验证预览'} · 版本哈希 ${version.sourceHash.slice(0, 8)}`
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { InteractiveArtifactSkill };
}
if (typeof window !== 'undefined') {
  window.InteractiveArtifactSkill = InteractiveArtifactSkill;
}
