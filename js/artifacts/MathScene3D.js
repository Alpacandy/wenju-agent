(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MathScene3D=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';const I=[1,0,0,0,1,0,0,0,1];
  function normalize(raw){const A=raw.A||I,v=raw.v||[1,1,1];for(const [a,n] of [[A,9],[v,3]])if(!Array.isArray(a)||a.length!==n||!a.every(x=>Number.isFinite(x)&&Math.abs(x)<=20))throw Object.assign(new Error('SCENE_3D_INPUT_INVALID'),{code:'SCENE_3D_INPUT_INVALID'});return {type:'linear-map-3d',A:A.slice(),v:v.slice()};}
  const apply=(A,v)=>[0,1,2].map(i=>A[i*3]*v[0]+A[i*3+1]*v[1]+A[i*3+2]*v[2]);
  function evaluate(raw){
    const spec=normalize(raw),A=spec.A,r=[A.slice(0,3),A.slice(3,6),A.slice(6)],pivots=[];let row=0;const tol=1e-9*Math.max(1,...A.map(Math.abs));
    for(let col=0;col<3&&row<3;col++){let pivot=row;for(let k=row+1;k<3;k++)if(Math.abs(r[k][col])>Math.abs(r[pivot][col]))pivot=k;if(Math.abs(r[pivot][col])<=tol)continue;[r[row],r[pivot]]=[r[pivot],r[row]];const d=r[row][col];r[row]=r[row].map(x=>x/d);for(let k=0;k<3;k++)if(k!==row){const m=r[k][col];r[k]=r[k].map((x,j)=>x-m*r[row][j]);}pivots.push(col);row++;}
    const free=[0,1,2].filter(i=>!pivots.includes(i)),nullBasis=free.map(i=>{const v=[0,0,0];v[i]=1;pivots.forEach((p,j)=>v[p]=-r[j][i]);return v;});
    const rawDet=A[0]*(A[4]*A[8]-A[5]*A[7])-A[1]*(A[3]*A[8]-A[5]*A[6])+A[2]*(A[3]*A[7]-A[4]*A[6]),determinant=Object.is(rawDet,-0)?0:rawDet;
    return {...spec,Av:apply(A,spec.v),rank:row,nullity:3-row,determinant,nullBasis,imageBasis:pivots.map(c=>[A[c],A[c+3],A[c+6]]),tolerance:tol};
  }
  return {normalize,evaluate,apply,I};
});
