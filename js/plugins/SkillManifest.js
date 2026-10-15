/**
 * SkillManifest —— 技能清单（P6-C · 插件化注册）
 *
 * 对齐 zcode plugin.json 清单语义（CONTEXT.md：commands/skills/hooks/mcpServers/userConfig），
 * 按本工程体量裁剪为：{ id, version, skills[], disabled[], mcpServers[], meta }
 *
 * 语义：
 *   - skills[]：本插件声明的技能类名全集（默认清单 = 全部 11 个内置技能，零行为变化）；
 *   - disabled[]：显式停用（不注册进 ToolRegistry——模型不可见；技能类代码保留可被内部逻辑引用）；
 *   - 未知类名（清单引用了不存在的技能）→ **显式错误**（SKILL_MANIFEST_UNKNOWN），绝不静默忽略；
 *   - 清单优先来源：引擎注入 > window.__WENJU_SKILL_MANIFEST__ > 默认清单。
 *
 * 效果范围声明（边界诚实）：清单控制"工具是否注册给模型可见/可调用"；
 * 引擎内部行为（如 PECHDT 门禁的脚手架实例）不受 disabled 影响——门禁是安全行为不是工具暴露。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SkillManifest = api.SkillManifest; root.SkillManifestDefault = api.DEFAULT_MANIFEST; }
})(typeof window !== 'undefined' ? window : global, function () {
  'use strict';

  // 全部内置技能类名（与 agentEngine.resolveSkillClasses 的已知集合一致——此为"存在性事实"全集）
  const ALL_SKILL_CLASS_NAMES = [
    'NullSpaceProbeSkill', 'CounterexampleSkill', 'CanvasTweenDriverSkill', 'PechdtScaffoldSkill',
    'LinearSystemSolverSkill', 'KnowledgeNavigatorSkill', 'CodeSandboxSkill',
    'ImageGenerationSkill', 'CanvasGraphicsDriverSkill', 'WorkspaceFileSkill',
    'InteractiveArtifactSkill', 'ManimLessonSkill', 'MathExperimentSkill', 'WorkspaceInspectSkill'
  ];

  const DEFAULT_MANIFEST = {
    id: 'wenju.core',
    version: '1.0.0',
    skills: ALL_SKILL_CLASS_NAMES.slice(),
    disabled: [],
    mcpServers: [],
    meta: { description: '问矩核心技能插件（默认全量启用）' }
  };

  /**
   * 校验清单并解析出激活列表。
   * @returns {{ ok:boolean, active:string[], disabled:string[], unknown:string[], errors:Array<{code,skill,name?}> }}
   */
  function resolveManifest(manifest, knownNames) {
    const known = knownNames || ALL_SKILL_CLASS_NAMES;
    const m = manifest || DEFAULT_MANIFEST;
    const errors = [];
    if (!m || typeof m !== 'object' || !Array.isArray(m.skills)) {
      return { ok: false, active: [], disabled: [], unknown: [], errors: [{ code: 'SKILL_MANIFEST_INVALID', name: String(m && m.id || '(anonymous)') }] };
    }
    const declared = m.skills.filter((s) => typeof s === 'string');
    const disabledList = Array.isArray(m.disabled) ? m.disabled.filter((s) => typeof s === 'string') : [];
    const unknown = declared.filter((s) => !known.includes(s));
    for (const u of unknown) errors.push({ code: 'SKILL_MANIFEST_UNKNOWN', skill: u });
    const active = declared.filter((s) => known.includes(s) && !disabledList.includes(s));
    const disabled = declared.filter((s) => known.includes(s) && disabledList.includes(s));
    return { ok: unknown.length === 0, active, disabled, unknown, errors };
  }

  /** 选择当前生效清单（注入 > window 全局 > 默认） */
  function pickManifest(injected) {
    if (injected && typeof injected === 'object') return injected;
    if (typeof window !== 'undefined' && window.__WENJU_SKILL_MANIFEST__ && typeof window.__WENJU_SKILL_MANIFEST__ === 'object') {
      return window.__WENJU_SKILL_MANIFEST__;
    }
    return DEFAULT_MANIFEST;
  }

  const SkillManifest = {
    ALL_SKILL_CLASS_NAMES: ALL_SKILL_CLASS_NAMES.slice(),
    DEFAULT_MANIFEST: JSON.parse(JSON.stringify(DEFAULT_MANIFEST)),
    resolveManifest,
    pickManifest
  };

  return { SkillManifest, DEFAULT_MANIFEST, ALL_SKILL_CLASS_NAMES, resolveManifest, pickManifest };
});
