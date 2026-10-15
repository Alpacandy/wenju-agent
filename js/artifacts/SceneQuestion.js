(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SceneQuestion=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const fmt=n=>Number(n.toFixed(4)).toString(),vector=v=>'('+v.map(fmt).join(', ')+')';
  const matrix=A=>{const n=A.length===9?3:2;return '['+Array.from({length:n},(_,i)=>'['+A.slice(i*n,(i+1)*n).map(fmt).join(', ')+']').join(', ')+']';};
  function create(title,scene){
    const s=scene.spec,e=scene.evaluation,c=e?.current,parts=[];
    if(s&&(!Array.isArray(s.A)||!Array.isArray(s.type==='system'?s.b:s.v)))throw Object.assign(new Error('SCENE_SNAPSHOT_INVALID'),{code:'SCENE_SNAPSHOT_INVALID'});
    if(s){parts.push('A = '+matrix(s.A));if(s.type==='composition')parts.push('B = '+matrix(s.B));parts.push((s.type==='system'?'b':'v')+' = '+vector(s.type==='system'?s.b:s.v));
      if(s.step==='linearity')parts.push('u = '+vector(s.u)+'，α = '+fmt(s.alpha)+'，β = '+fmt(s.beta));
      if(s.type==='composition')parts.push('当前 t = '+fmt(s.t)+'，左侧矩阵 '+matrix(c.AB)+'，右侧矩阵 '+matrix(c.BA));
      else if(c)parts.push('当前显示矩阵 '+matrix(c.matrix)+'，行列式 '+fmt(c.determinant)+'，秩 '+c.rank);
      else if(e)parts.push('行列式 '+fmt(e.determinant)+'，秩 '+e.rank+'，Av = '+vector(e.Av));
      if(s.step==='linearity')parts.push('两条路径的结果均为 '+vector(e.linearity.lhs));
    }else if(scene.camera)parts.push('尺寸 '+fmt(scene.camera.size)+'，偏航 '+fmt(scene.camera.yaw)+'°，俯仰 '+fmt(scene.camera.pitch)+'°');
    return '请解释我当前看到的“'+title+'”：'+parts.join('；')+'。请结合当前画面说明现象，并给我一个可以尝试的问题。';
  }
  return {create};
});
