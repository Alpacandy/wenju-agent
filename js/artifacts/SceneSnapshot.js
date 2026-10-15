/** Capture a current preview without attributing a response to a replaced scene. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SceneSnapshot=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const fail=code=>Object.assign(new Error(code),{code});
  function fence(deck,item,runtime,context){
    if(context.signal?.aborted||context.isRunActive&&!context.isRunActive())throw fail('USER_ABORTED');
    if(deck.currentArtifact!==item||deck._sandboxRt!==runtime)throw fail('SCENE_VERSION_CONFLICT');
  }
  async function read(deck,context={}){
    const item=deck.currentArtifact,runtime=deck._sandboxRt;
    if(!item)throw fail('ARTIFACT_NOT_ACTIVE');
    fence(deck,item,runtime,context);
    if(item.meta?.nativeMath&&runtime?.requestScene){
      const scene=await runtime.requestScene({action:'read'},{signal:context.signal});fence(deck,item,runtime,context);
      if(scene.inputsValid===false)throw fail('SCENE_INPUT_INCOMPLETE');
      return {scene,source:'live-inputs'};
    }
    const custom=runtime?.interactionState?.custom||deck._interactionStates?.[item.versionId]?.custom;
    return {scene:custom?JSON.parse(JSON.stringify(custom)):null,source:runtime?.interactionState?.custom?'live-inputs':custom?'captured-inputs':'saved-inputs'};
  }
  return {read,fence};
});
