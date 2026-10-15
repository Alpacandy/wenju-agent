/** A bounded native math document path with live input readback. */
(function(root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("../artifacts/MathExperiment.js") : root.MathExperiment);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MathExperimentSkill = api.MathExperimentSkill;
})(typeof globalThis !== "undefined" ? globalThis : this, function(math) {
  class MathExperimentSkill {
    constructor() {
      this.name = "math_experiment";
    }
    getSchema() {
      return { name: this.name, description: "优先创建受控数学场景；Mafs 输入/输出双视图、基向量/变换/核与像/线性性四个分镜。seek/play/pause/next/previous/reset 控制分镜时间；compare 对照；verify 核验数值；inspect_layout 回读实际标注重叠。线性变换、AB/BA复合、方程组、特征方向只需数值参数，无须HTML。undo/redo 撤销或重做参数修改；fit_view 适应视图。线性组合支持 u、alpha、beta。update 复用当前工件并保留未修改的实时输入；read 回读学生最新输入并重新计算。", requiresCanvas: false, parameters: { type: "object", additionalProperties: false, properties: { action: { type: "string", enum: ["open", "update", "read", "seek", "play", "pause", "next", "previous", "reset", "compare", "verify", "inspect_layout", "undo", "redo", "fit_view"] }, experiment: { type: "string", enum: ["linear-map", "composition", "system", "eigen", "linear-map-3d"] }, A: { type: "array", items: { type: "number", minimum: -20, maximum: 20 }, minItems: 4, maxItems: 9 }, B: { type: "array", items: { type: "number", minimum: -20, maximum: 20 }, minItems: 4, maxItems: 9 }, v: { type: "array", items: { type: "number", minimum: -20, maximum: 20 }, minItems: 2, maxItems: 3 }, b: { type: "array", items: { type: "number", minimum: -20, maximum: 20 }, minItems: 2, maxItems: 3 }, u:{type:"array",items:{type:"number",minimum:-20,maximum:20},minItems:2,maxItems:2},alpha:{type:"number",minimum:-20,maximum:20},beta:{type:"number",minimum:-20,maximum:20},step:{type:"string",enum:["basis","transform","spaces","linearity"]},t:{type:"number",minimum:0,maximum:1},operation_id:{type:"string",maxLength:128},version_id:{type:"string",maxLength:128},artifact_id: { type: "string", maxLength: 128 } }, required: ["action"] } };
    }
    async execute(args, context = {}) {
      const active = () => !context.signal?.aborted && (!context.isRunActive || context.isRunActive());
      if (!active()) return { status: "aborted", error: "USER_ABORTED" };
      const deck = context.artifactStageDeck || (typeof window !== "undefined" ? window.artifactStageDeck : null);
      if (!deck) return { status: "error", error: "ARTIFACT_WORKSPACE_REQUIRED" };
      try {
        const snapshotApi=typeof module==='object'&&module.exports?require('../artifacts/SceneSnapshot'):globalThis.SceneSnapshot;
        if(args.version_id && args.version_id!==deck.currentArtifact?.versionId)return {status:'error',code:'SCENE_VERSION_CONFLICT',error:'SCENE_VERSION_CONFLICT'};
        if(!['open','update','read'].includes(args.action)){
          if(!deck.currentArtifact?.meta?.mathExperiment)return {status:'error',error:'NOT_MATH_EXPERIMENT'};
          if(args.artifact_id && args.artifact_id!==deck.currentArtifact.artifactId)return {status:'error',error:'ARTIFACT_NOT_ACTIVE'};
          if(!deck._sandboxRt?.requestScene)return {status:'error',error:'SCENE_RUNTIME_UNAVAILABLE'};
          const item=deck.currentArtifact,runtime=deck._sandboxRt;
          const result=await runtime.requestScene({action:args.action,step:args.step,t:args.t,operation_id:args.operation_id},{signal:context.signal});
          if(!active())return {status:'aborted',error:'USER_ABORTED'};
          snapshotApi.fence(deck,item,runtime,context);
          return {status:'success',artifactId:deck.currentArtifact.artifactId,versionId:deck.currentArtifact.versionId,action:args.action,result};
        }
        if (args.action === "read") {
          const current = deck.currentArtifact;
          if (!current?.meta?.mathExperiment) return { status: "error", error: "NOT_MATH_EXPERIMENT", detail: "当前工件没有数学实验输入契约。" };
          if (args.artifact_id && args.artifact_id !== current.artifactId) return { status: "error", error: "ARTIFACT_NOT_ACTIVE" };
          const snapshot=await snapshotApi.read(deck,context),spec=snapshot.scene?.spec||current.meta.mathExperiment;
          return {status:'success',artifactId:current.artifactId,versionId:current.versionId,source:snapshot.source,result:math.evaluate(spec),scene:snapshot.scene,detail:'scene.evaluation.current 是正在显示的帧；result 是目标矩阵结果。容差 1e-9，数值实例不构成一般命题证明。'};
        }
        let spec,artifactId;
        if (args.action === 'update') {
          const current=deck.currentArtifact;
          if (!current?.meta?.mathExperiment) return {status:'error',error:'NOT_MATH_EXPERIMENT'};
          if (current.meta.courseLesson) return {status:'error',error:'COURSE_INPUT_MANAGED',detail:'课程输入请在实验中操作；更新工具不替换课程题目。'};
          if (args.artifact_id && args.artifact_id!==current.artifactId) return {status:'error',error:'ARTIFACT_NOT_ACTIVE'};
          const snapshot=await snapshotApi.read(deck,context),live=snapshot.scene;
          if (!live?.spec) return {status:'error',error:'LIVE_INPUTS_UNAVAILABLE',detail:'请等待当前实验输入就绪后更新，避免覆盖尚未回读的修改。'};
          spec={...live.spec};
          if (args.experiment && args.experiment!==spec.type) return {status:'error',error:'EXPERIMENT_TYPE_MISMATCH'};
          for (const key of ['A','B','v','b','u','alpha','beta','step','t']) if (args[key]!==undefined) spec[key]=args[key];
          artifactId=current.artifactId;
        } else {
          if (args.action !== "open" || !args.experiment) return { status: "error", error: "EXPERIMENT_TYPE_REQUIRED" };
          spec={ type: args.experiment, A: args.A, B: args.B, v: args.v, b: args.b,step:args.step,t:args.t,u:args.u,alpha:args.alpha,beta:args.beta };
          artifactId=args.artifact_id || "math-" + args.experiment;
        }
        const data = math.create(spec, { artifactId });
        if (!active()) return { status: "aborted", error: "USER_ABORTED" };
        if (!deck.loadArtifact(data, { signal: context.signal, resetInteractionState:true })) return { status: "error", error: "ARTIFACT_PREVIEW_REJECTED" };
        const preview = await deck.waitForPreview({ artifactId: data.artifactId, versionId: deck.currentArtifact.versionId, signal: context.signal });
        if (!active()) return { status: "aborted", error: "USER_ABORTED" };
        if (!preview.ok) return { status: "error", error: preview.code, runtimeError: preview.runtimeError };
        const layout=deck._sandboxRt?.requestScene?await deck._sandboxRt.requestScene({action:'inspect_layout'},{signal:context.signal}):null;
        if(layout && (layout.overlaps.length || layout.clipped.length || layout.hiddenControls?.length))return {status:'error',error:'SCENE_LAYOUT_INVALID',layout,artifactId:deck.currentArtifact.artifactId};
        if (context.visualTask) context.visualTask.surface = "artifact";
        return { status: "success", artifactId: deck.currentArtifact.artifactId, versionId: deck.currentArtifact.versionId, title: data.title, previewVerified: preview.previewVerified,layoutVerified:!!layout,layout,result: math.evaluate(data.meta.mathExperiment), detail: "双视图数学实验已打开。分镜与时间轴可操作；先 read 回读学生输入，再 verify 核验当前数值。" };
      } catch (error) {
        if (typeof recordIssue === "function") recordIssue("MathExperimentSkill", "execute", error);
        return { status: "error", error: error.code || "EXPERIMENT_INVALID", detail: error.message };
      }
    }
  }
  return { MathExperimentSkill };
});
