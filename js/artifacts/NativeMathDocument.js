/** Small persisted documents; the audited renderer asset is injected only when previewing/exporting. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.NativeMathDocument=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const marker='data-wenju-native="math-v1"';
  function create(kind,spec,{title,artifactId,meta={}}={}){
    const seed=JSON.stringify({kind,spec}).replace(/</g,'\\u003c');
    const safe=String(title||'数学实验').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
    return {type:'interactive',artifactId,title,meta:{...meta,nativeMath:'math-v1'},content:`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe}</title></head><body ${marker}><div id="math-root"></div><script>if(!window.WenjuMath)throw new Error('NATIVE_MATH_RUNTIME_UNAVAILABLE');window.WenjuMath.mount(${seed});/* artifact-state-restored */<\/script></body></html>`};
  }
  function expand(content,asset){
    if(!content.includes(marker))return content;
    if(!asset?.js||!asset?.css)throw Object.assign(new Error('NATIVE_MATH_RUNTIME_UNAVAILABLE'),{code:'NATIVE_MATH_RUNTIME_UNAVAILABLE'});
    const seed=content.match(/WenjuMath\.mount\((\{[^\n]*?)\);\/\* artifact-state-restored \*\//);
    const kind=seed?JSON.parse(seed[1]).kind:'math';
    const js=kind==='math'?asset.js:asset.variants?.solid||asset.js;
    const prefix=`<!-- Third-party licenses\n${(asset.notices||'').replace(/-->/g,'-- >')}\n--><style>${asset.css.replace(/<\/style/ig,'<\\/style')}</style><script>${js.replace(/<\/script/ig,'<\\/script')}<\/script>`;
    return content.replace(/<\/head>/i,()=>prefix+'</head>');
  }
  return {create,expand,marker};
});
