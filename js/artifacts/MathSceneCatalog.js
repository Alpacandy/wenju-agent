/** Reviewed numerical starting points; opening an example grants no course credit. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MathSceneCatalog=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const examples=[
  {id:'shear',title:'剪切与面积',detail:'拖动基向量，观察面积',spec:{type:'linear-map',A:[1,1,0,1]}},
  {id:'kernel-image',title:'核与像',detail:'输入空间与输出空间分别查看',spec:{type:'linear-map',A:[1,2,0,0],v:[-2,1],step:'spaces'}},
  {id:'linearity',title:'线性组合',detail:'改变 u、v、α、β 验证两条路径',spec:{type:'linear-map',A:[2,1,0,1],step:'linearity'}},
  {id:'order',title:'AB 与 BA',detail:'比较同一向量的两种作用顺序',spec:{type:'composition',A:[1,1,0,1],B:[0,-1,1,0]}},
  {id:'system',title:'方程组与解',detail:'编辑 A、b，观察解的变化',spec:{type:'system',A:[1,1,1,-1],b:[2,0]}},
  {id:'eigen',title:'特征方向',detail:'查看变换中保持不变的方向',spec:{type:'eigen',A:[2,1,0,1]}},
  {id:'linear3d',title:'三维线性变换',detail:'编辑 3×3 矩阵与三维向量',spec:{type:'linear-map-3d',A:[1,1,0,0,1,0,0,0,1]}},
  {id:'cube',title:'正方体',detail:'旋转、缩放与选中面',solid:'cube'},
  {id:'sphere',title:'球体',detail:'旋转与球面位置回读',solid:'sphere'}
 ];
 return {examples,get:id=>examples.find(e=>e.id===id)||null};
});
