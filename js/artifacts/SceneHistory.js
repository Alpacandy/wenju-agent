/** Bounded, per-preview history. Continuous edits coalesce until release. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SceneHistory=api.SceneHistory;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const clone=x=>JSON.parse(JSON.stringify(x));
  class SceneHistory{
    constructor(limit=50){this.limit=limit;this.clear();}
    clear(){this.past=[];this.future=[];this.group=null;}
    end(){this.group=null;}
    record(before,after,group){if(JSON.stringify(before)===JSON.stringify(after))return false;if(!group||this.group!==group)this.past.push(clone(before));if(this.past.length>this.limit)this.past.shift();this.future=[];this.group=group||null;return true;}
    undo(current){this.end();if(!this.past.length)return null;this.future.push(clone(current));return this.past.pop();}
    redo(current){this.end();if(!this.future.length)return null;this.past.push(clone(current));return this.future.pop();}
    state(){return {canUndo:this.past.length>0,canRedo:this.future.length>0,undoCount:this.past.length,redoCount:this.future.length};}
  }
  return {SceneHistory};
});
