(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.WorkspaceInspectSkill=api.WorkspaceInspectSkill;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  class WorkspaceInspectSkill {
    getSchema(){
      return {name:'inspect_workspace',description:'回读用户当前可见工作区、工件列表、实时输入及坐标画板。继续修改或解释已有实验前先调用；surface 标明用户实际看到的对象。只读，不返回源码、凭证或对话内容。',requiresCanvas:false,parameters:{type:'object',additionalProperties:false,properties:{},required:[]}};
    }
    async execute(_args,context={}){
      context.throwIfCancelled?.();
      const deck=context.artifactStageDeck||(typeof window!=='undefined'?window.artifactStageDeck:null);
      const viz=context.workspaceVisualizer;
      if(!deck&&!viz)return {status:'error',error:'WORKSPACE_UNAVAILABLE'};
      const item=deck?.currentArtifact,rt=deck?._sandboxRt;
      const captured=item&&deck?._interactionStates?.[item.versionId];
      const interaction=rt?.interactionState||captured;
      let snapshot=null,sceneError=null;
      if(item?.meta?.nativeMath&&deck.currentMode==='artifact'){
        try{snapshot=await (typeof module==='object'&&module.exports?require('../artifacts/SceneSnapshot'):globalThis.SceneSnapshot).read(deck,context);}
        catch(error){if(['USER_ABORTED','SCENE_VERSION_CONFLICT'].includes(error.code))return {status:'error',error:error.code};sceneError=error.code||error.message;}
      }
      context.throwIfCancelled?.();
      return {status:'success',surface:deck?.currentMode||'canvas',artifact:item?{
        artifactId:item.artifactId,versionId:item.versionId,title:item.title,type:item.type,
        previewReady:['ready','done'].includes(rt?.state),runtimeError:rt?.lastError||null,
        interactionSource:rt?.interactionState?'live-preview':captured?'captured-preview':'unavailable',
        interaction:interaction?JSON.parse(JSON.stringify(interaction)):null,
        scene:snapshot?.scene||null,sceneSource:snapshot?.source||null,sceneError
      }:null,artifacts:deck?.artifacts?Array.from(deck.artifacts.values()).slice(-50).map(a=>({artifactId:a.artifactId,versionId:a.versionId,title:a.title,type:a.type})):[],
      canvas:viz?{dimension:viz.dimensionMode||'2D',matrix:{...viz.matrix},probe:{...viz.probeVector},sceneId:viz.sceneId||null,shapeCount:viz.customGraphics?.length||0,view:{width:viz.width,height:viz.height,scale:viz.unitScale,originX:viz.originX,originY:viz.originY}}:null};
    }
  }
  return {WorkspaceInspectSkill};
});
