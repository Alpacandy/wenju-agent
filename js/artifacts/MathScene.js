/** Mathematical state is independent of layout, pixels and rendering libraries. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./MathExperiment.js'):root.MathExperiment);if(typeof module==='object'&&module.exports)module.exports=api;else root.MathScene=api;})(typeof globalThis!=='undefined'?globalThis:this,function(math){
  'use strict';
  const steps=['basis','transform','spaces','linearity'];
  const error=code=>Object.assign(new Error(code),{code});
  function normalize(raw={}){
    const spec=math.normalize(raw);
    const step=raw.step||'transform';if(!steps.includes(step))throw error('SCENE_STEP_INVALID');
    const t=raw.t===undefined?1:raw.t;if(typeof t!=='number'||!Number.isFinite(t)||t<0||t>1)throw error('SCENE_TIME_INVALID');
    const u=raw.u===undefined?[1,-1]:raw.u;if(!Array.isArray(u)||u.length!==2||!u.every(x=>Number.isFinite(x)&&Math.abs(x)<=20))throw error('SCENE_VECTOR_INVALID');
    const alpha=raw.alpha===undefined?1:raw.alpha,beta=raw.beta===undefined?1:raw.beta;
    if(![alpha,beta].every(x=>Number.isFinite(x)&&Math.abs(x)<=20))throw error('SCENE_COEFFICIENT_INVALID');
    return {...spec,step,t,u:u.slice(),alpha,beta};
  }
  const blend=(A,t)=>A.map((x,i)=>(i%3===0?1:0)*(1-t)+t*x);
  function spaces(A){
    const rank=math.rank(A),unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
    if(rank===0)return {rank,nullBasis:[[1,0],[0,1]],imageBasis:[]};
    if(rank===2)return {rank,nullBasis:[],imageBasis:[[1,0],[0,1]]};
    const row=Math.hypot(A[0],A[1])>=Math.hypot(A[2],A[3])?[A[0],A[1]]:[A[2],A[3]];
    const col=Math.hypot(A[0],A[2])>=Math.hypot(A[1],A[3])?[A[0],A[2]]:[A[1],A[3]];
    return {rank,nullBasis:[unit([-row[1],row[0]])],imageBasis:[unit(col)]};
  }
  function evaluate(raw){
    const spec=normalize(raw),result=math.evaluate(spec),matrix=spec.type==='system'||spec.step!=='transform'?spec.A.slice():blend(spec.A,spec.t),current=math.evaluate({...spec,A:matrix});
    const sum=spec.u.map((x,i)=>spec.alpha*x+spec.beta*spec.v[i]),lhs=math.apply(spec.A,sum),Au=math.apply(spec.A,spec.u),Av=result.Av,rhs=Au.map((x,i)=>spec.alpha*x+spec.beta*Av[i]);
    const first=(A,B,t)=>t<.5?blend(B,t*2):math.multiply(blend(A,t*2-1),B);
    return {schema:'math-scene/1',spec,result,current:{matrix,determinant:current.determinant,rank:current.rank,Av:current.Av,eigenvalues:current.eigenvalues,AB:first(spec.A,spec.B,spec.t),BA:first(spec.B,spec.A,spec.t)},spaces:spaces(spec.A),linearity:{sum,lhs,rhs,residual:lhs.map((x,i)=>x-rhs[i])}};
  }
  function placeLabels(items,{width,height,blocked=[],previous={}}){
    const occupied=blocked.slice(),placed=[],hidden=[];const overlaps=r=>occupied.some(b=>r.x<b.x+b.width+6&&r.x+r.width+6>b.x&&r.y<b.y+b.height+6&&r.y+r.height+6>b.y);
    for(const item of items){
      if(placed.length>=4){hidden.push(item.id);continue;}
      const w=item.width,h=item.height,candidates=[];
      if(previous[item.id] && Math.hypot(previous[item.id].x-item.x,previous[item.id].y-item.y)<65)candidates.push(previous[item.id]);
      for(const [dx,dy] of [[12,-24],[12,8],[-w-12,-24],[-w-12,8],[12,-48],[-w-12,-48],[24,28],[-w-24,28]])candidates.push({x:item.x+dx,y:item.y+dy});
      const p=candidates.map(c=>({...c,width:w,height:h})).find(r=>r.x>=8&&r.y>=8&&r.x+w<=width-8&&r.y+h<=height-8&&!overlaps(r));
      if(p){occupied.push(p);placed.push({...item,...p});}else hidden.push(item.id);
    }
    return {placed,hidden};
  }
  function verify(raw){const state=evaluate(raw),{A}=state.spec,nullResiduals=state.spaces.nullBasis.map(v=>math.apply(A,v));return {ok:state.linearity.residual.every(x=>Math.abs(x)<1e-9)&&nullResiduals.every(v=>v.every(x=>Math.abs(x)<1e-9))&&state.spaces.nullBasis.length+state.spaces.rank===2,tolerance:1e-9,nullResiduals,imageRank:state.spaces.rank,result:state.result,scope:'current-input-numerical-check'};}
  return {normalize,evaluate,spaces,blend,placeLabels,verify,steps};
});
