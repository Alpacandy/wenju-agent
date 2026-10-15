import React, {useState,useEffect,useLayoutEffect,useRef} from 'react';
import {Mafs,Coordinates,Vector,Point,Polygon,Polyline,Line,MovablePoint,useTransformContext,vec} from 'mafs';
import Scene from '../MathScene.js';
import Math2 from '../MathExperiment.js';
import register from './register.jsx';
import History from '../SceneHistory.js';
import NumberInput from './NumberInput.jsx';
const colors=['#4c9cdb','#e4ae5b','#63c6a5','#bd9bdc'],names={basis:'基向量',transform:'空间变换',spaces:'核与像',linearity:'线性性'};
const fmt=n=>Number(n.toFixed(3)).toString(),copy=x=>JSON.parse(JSON.stringify(x));
function Labels({items}){
  const {viewTransform}=useTransformContext(),ref=useRef(null),previous=useRef({}),[layout,setLayout]=useState({placed:[],hidden:[]}),[tick,setTick]=useState(0);
  useEffect(()=>{const o=new ResizeObserver(()=>setTick(x=>x+1));o.observe(ref.current.ownerSVGElement);return()=>o.disconnect();},[]);
  useLayoutEffect(()=>{
    const svg=ref.current.ownerSVGElement,w=svg.clientWidth,h=svg.clientHeight;
    const ctx=document.createElement('canvas').getContext('2d');ctx.font='12px "Cambria Math","Microsoft YaHei",serif';
    const measured=items.map(item=>{const p=vec.transform(item.point,viewTransform);return {...item,x:p[0]+w/2,y:p[1]+h/2,width:Math.max(18,Math.ceil(ctx.measureText(item.text).width)+10),height:20};});
    const next=Scene.placeLabels(measured,{width:w,height:h,previous:previous.current,blocked:measured.map(i=>({x:i.x-8,y:i.y-8,width:16,height:16}))});
    previous.current=Object.fromEntries(next.placed.map(i=>[i.id,{x:i.x,y:i.y}]));setLayout({...next,offset:{x:svg.viewBox.baseVal.x,y:svg.viewBox.baseVal.y}});
  },[JSON.stringify(items),JSON.stringify(viewTransform),tick]);
  return <g ref={ref} className="scene-labels">{layout.placed.map(i=><g key={i.id} transform={`translate(${i.x+(layout.offset?.x||0)},${i.y+(layout.offset?.y||0)})`} data-label={i.id}>
    <rect width={i.width} height="20" rx="4" fill="#142333" opacity=".94"/><text x="5" y="14" fill={i.color} fontSize="12">{i.text}</text>
  </g>)}</g>;
}
function UnitImage({A,color,fill=.08}){
  const points=Array.from({length:97},(_,i)=>Math2.apply(A,[Math.cos(i*Math.PI/48),Math.sin(i*Math.PI/48)]));
  return <Polygon points={points} color={color} fillOpacity={fill} weight={1.6}/>;
}
function Panel({title,subtitle,A= [1,0,0,1],vectors=[],space,grid=true,unit=true,height,range,onBasis,onVector,step,showSquare=false,eigen=[]}){
  const labels=vectors.map((v,i)=>({id:v.id,text:v.label,point:v.point,color:v.color||colors[i]}));
  return <section className="scene-panel"><header><strong>{title}</strong><span>{subtitle}</span></header>
    <Mafs height={Math.max(110,height)} pan={false} zoom={false} viewBox={{x:[-range,range],y:[-range,range],padding:.6}}>
      {grid&&<Coordinates.Cartesian subdivisions={1} xAxis={{labels:false}} yAxis={{labels:false}}/>}
      {unit&&<UnitImage A={[1,0,0,1]} color="#526779" fill={0}/>}
      {showSquare&&<Polygon points={[[0,0],[1,0],[1,1],[0,1]].map(v=>Math2.apply(A,v))} color={colors[0]} fillOpacity={.15}/>}
      {step==='transform'&&grid&&Array.from({length:9},(_,i)=>i-4).flatMap(k=>[
        <Line.Segment key={'x'+k} point1={Math2.apply(A,[k,-4])} point2={Math2.apply(A,[k,4])} color="#46758b" opacity={.3} weight={1}/>,
        <Line.Segment key={'y'+k} point1={Math2.apply(A,[-4,k])} point2={Math2.apply(A,[4,k])} color="#46758b" opacity={.3} weight={1}/>
      ])}
      {space?.rank===1&&<Line.ThroughPoints point1={space.basis.map(x=>-x)} point2={space.basis} color={colors[3]} weight={2} style="dashed"/>}
      {space?.rank===2&&<Polygon points={[[-range,-range],[range,-range],[range,range],[-range,range]]} color={colors[3]} fillOpacity={.06} strokeOpacity={0}/>}
      {space?.rank===0&&<Point x={0} y={0} color={colors[3]}/>}
      {eigen.map((v,i)=><Line.ThroughPoints key={'eigen'+i} point1={v.map(x=>-x)} point2={v} color={colors[i]} style="dashed" opacity={.65}/>)}
      {unit&&!space&&<UnitImage A={A} color={colors[0]}/>}
      {vectors.map((v,i)=><React.Fragment key={v.id}>
        {Math.hypot(...v.point)>1e-10&&<Vector tip={v.point} color={v.color||colors[i]} weight={2}/>}
        {v.handle?<g data-handle={v.handle}><MovablePoint point={v.point} color={v.color||colors[i]} onMove={p=>v.handle==='v'?onVector?.(p):onBasis?.(v.handle,p)}/></g>:<Point x={v.point[0]} y={v.point[1]} color={v.color||colors[i]}/>}
      </React.Fragment>)}
      <Labels items={labels}/>
    </Mafs>
    <div className="panel-legend">{vectors.map((v,i)=><span key={v.id}><i style={{background:v.color||colors[i]}}/>{v.label} <b>({v.point.map(fmt).join(', ')})</b></span>)}{space&&<span><i style={{background:colors[3]}}/>{space.label}</span>}</div>
  </section>;
}
function MatrixInputs({spec,setSpec}){
  const keys=['A',...(spec.type==='composition'?['B']:[]),...(spec.type==='system'?['b']:['v']),...(spec.step==='linearity'&&!['composition','system'].includes(spec.type)?['u']:[])];
  return <div id="parameters">{keys.map(key=><fieldset key={key}><legend>{key}</legend><div className={'matrix-cells '+(spec[key].length===4?'matrix-2':'vector-2')}>
    {spec[key].map((n,i)=><NumberInput key={i} id={key+i} aria-label={key+' '+(i+1)} value={n} onValue={value=>setSpec(s=>({...s,[key]:s[key].map((x,j)=>i===j?value:x)}),'input:'+key+i)}/>)}</div></fieldset>)}
    {keys.includes('u')&&<fieldset className="coefficients"><legend>组合系数</legend>{['alpha','beta'].map((key,i)=><label key={key}>{i?'β':'α'}<NumberInput id={key} aria-label={i?'β':'α'} value={spec[key]} onValue={value=>setSpec(s=>({...s,[key]:value}),'input:'+key)}/></label>)}</fieldset>}
  </div>;
}
function MathApp({initial}){
  const [spec,setSpec]=useState(()=>Scene.normalize(initial)),[grid,setGrid]=useState(true),[unit,setUnit]=useState(true),[playing,setPlaying]=useState(false),[zoom,setZoom]=useState(1),[activePanel,setActivePanel]=useState(0),[size,setSize]=useState({width:900,height:400});
  const plot=useRef(null),scene=Scene.evaluate(spec),live=useRef(null),playingRef=useRef(false),history=useRef(new History.SceneHistory(50)),[historyTick,setHistoryTick]=useState(0);
  live.current={spec,grid,unit,zoom,activePanel,playing};playingRef.current=playing;
  const change=(fn,group)=>{const before=live.current.spec,next=Scene.normalize(typeof fn==='function'?fn(before):fn);history.current.record(before,next,group);live.current.spec=next;setPlaying(false);setSpec(next);setHistoryTick(x=>x+1);};
  const travel=direction=>{const next=history.current[direction](live.current.spec);if(next){live.current.spec=next;setPlaying(false);setSpec(next);setHistoryTick(x=>x+1);}};
  useEffect(()=>{const end=()=>history.current.end(),keys=e=>{if(e.target.closest?.('input,textarea,[contenteditable=true]'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();travel(e.shiftKey?'redo':'undo');}};document.addEventListener('pointerup',end);document.addEventListener('focusout',end);document.addEventListener('keydown',keys);return()=>{document.removeEventListener('pointerup',end);document.removeEventListener('focusout',end);document.removeEventListener('keydown',keys);};},[]);
  useLayoutEffect(()=>{const observer=new ResizeObserver(([e])=>setSize({width:e.contentRect.width,height:e.contentRect.height}));observer.observe(plot.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    const state={schema:'math-experiment/1',sceneSchema:'math-scene/1',spec:copy(spec),grid,unit,zoom,activePanel,playing,renderer:'mafs'};
    window.artifactState=state;window.dispatchEvent(new Event('artifact-state-changed'));
  },[spec,grid,unit,zoom,activePanel,playing]);
  useEffect(()=>{
    const changeInput=e=>{const id=e.target.id;if(!/^(?:[ABvbu][0-3]|alpha|beta)$/.test(id))return;const value=e.target.valueAsNumber;if(!Number.isFinite(value)||Math.abs(value)>20||e.target.value==='')return;const key=id.length===2?id[0]:id,i=+id[1];if(Array.isArray(live.current.spec[key])){if(i<live.current.spec[key].length)change(s=>({...s,[key]:s[key].map((x,j)=>j===i?value:x)}),'input:'+id);}else change(s=>({...s,[key]:value}),'input:'+id);};
    document.addEventListener('change',changeInput);return()=>document.removeEventListener('change',changeInput);
  },[]);
  useEffect(()=>{
    const restore=e=>{if(e.detail?.schema!=='math-experiment/1')return;try{const saved={...e.detail.spec};if(Number.isFinite(saved.t)&&(saved.t<0||saved.t>1)){console.warn(JSON.stringify({event:'scene_time_migrated',from:saved.t}));saved.t=Math.max(0,Math.min(1,saved.t));}history.current.clear();setHistoryTick(x=>x+1);setSpec(Scene.normalize(saved));setGrid(e.detail.grid!==false);setUnit(e.detail.unit!==false);setZoom(Math.max(.4,Math.min(3,e.detail.zoom||1)));setActivePanel(e.detail.activePanel===1?1:0);setPlaying(false);}catch(error){window.dispatchEvent(new ErrorEvent('error',{error,message:error.message}));}};
    window.addEventListener('artifact-state-restored',restore);return()=>window.removeEventListener('artifact-state-restored',restore);
  },[]);
  useEffect(()=>{
    if(!playing)return;let frame,last=performance.now();
    const tick=now=>{if(!playingRef.current)return;const dt=Math.max(0,Math.min(80,now-last))/1800;last=now;setSpec(s=>({...s,t:Math.min(1,s.t+dt)}));if(live.current.spec.t>=1){setPlaying(false);return;}frame=requestAnimationFrame(tick);};
    frame=requestAnimationFrame(tick);const hide=()=>setPlaying(false);window.addEventListener('pagehide',hide);return()=>{cancelAnimationFrame(frame);window.removeEventListener('pagehide',hide);};
  },[playing]);
  useEffect(()=>{
    const inspect=()=>{
      const boxes=Array.from(document.querySelectorAll('[data-label]')).map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.label,x:r.x,y:r.y,width:r.width,height:r.height};});
      const overlaps=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y)overlaps.push([a.id,b.id]);}
      const controls=Array.from(document.querySelectorAll('[data-handle]')).filter(el=>el.getBoundingClientRect().width>0).map(el=>{const p=el.querySelector('circle')||el,r=p.getBoundingClientRect(),s=el.closest('svg').getBoundingClientRect();return {id:el.dataset.handle,x:r.x+r.width/2,y:r.y+r.height/2,visible:r.x+r.width/2>=s.x&&r.x+r.width/2<=s.right&&r.y+r.height/2>=s.y&&r.y+r.height/2<=s.bottom};});
      return {labelCount:boxes.length,overlaps,clipped:boxes.filter(r=>r.x<0||r.y<0||r.x+r.width>innerWidth||r.y+r.height>innerHeight),controls,hiddenControls:controls.filter(c=>!c.visible),viewport:{width:innerWidth,height:innerHeight},renderer:'mafs'};
    };
    const read=()=>({...copy(live.current),inputsValid:!document.querySelector('[aria-invalid="true"]'),history:history.current.state(),evaluation:Scene.evaluate(live.current.spec)});
    window.WenjuScene={read,inspect,command:async args=>{
      if(args.action==='read')return read();
      if(args.action==='inspect_layout')return inspect();if(args.action==='verify')return Scene.verify(live.current.spec);
      if(args.expectedRevision!==undefined&&args.expectedRevision!==JSON.stringify(live.current.spec))throw Error('SCENE_REVISION_CONFLICT');
      if(args.action==='play'){if(live.current.spec.type==='system')throw Error('SCENE_ANIMATION_UNSUPPORTED');change(s=>({...s,step:'transform',t:s.t>=1||s.step!=='transform'?0:s.t}));setPlaying(true);}
      else if(args.action==='pause')setPlaying(false);
      else if(args.action==='seek'){if(['system','composition'].includes(live.current.spec.type)&&args.step&&args.step!=='transform')throw Error('SCENE_STEP_UNSUPPORTED');if(live.current.spec.type==='system'&&args.t!==undefined)throw Error('SCENE_ANIMATION_UNSUPPORTED');change({...live.current.spec,...(args.step?{step:args.step}:{}),...(args.t!==undefined?{t:args.t}:{})});}
      else if(args.action==='next'||args.action==='previous'){if(['system','composition'].includes(live.current.spec.type))throw Error('SCENE_STEP_UNSUPPORTED');change(s=>({...s,step:Scene.steps[Math.max(0,Math.min(3,Scene.steps.indexOf(s.step)+(args.action==='next'?1:-1)))],t:1}));}
      else if(args.action==='reset'){change(Scene.normalize(initial));setZoom(1);}
      else if(args.action==='compare'){if(['system','composition'].includes(live.current.spec.type))throw Error('SCENE_STEP_UNSUPPORTED');change(s=>({...s,step:'spaces',t:1}));}
      else if(args.action==='undo'||args.action==='redo')travel(args.action);
      else if(args.action==='fit_view')setZoom(1);
      else throw Error('SCENE_ACTION_INVALID');
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return read();
    }};return()=>{delete window.WenjuScene;};
  },[]);
  const output=spec.step==='basis'||spec.step==='spaces'?spec.A:scene.current.matrix;
  const basis=(handle,p)=>change(s=>({...s,t:1,A:s.A.map((x,i)=>i===(handle==='e1'?0:1)?Math.max(-20,Math.min(20,p[0])):i===(handle==='e1'?2:3)?Math.max(-20,Math.min(20,p[1])):x)}),'drag:'+handle);
  const vector=p=>change(s=>({...s,v:p.map(x=>Math.max(-20,Math.min(20,x)))}),'drag:v');
  let panels=[];
  if(spec.type==='composition')panels=[{title:'B → A',subtitle:'先 B 后 A · AB',A:scene.current.AB,vectors:[{id:'ABv',label:spec.t===1?'ABv':'左侧输出',point:Math2.apply(scene.current.AB,spec.v)}]},{title:'A → B',subtitle:'先 A 后 B · BA',A:scene.current.BA,vectors:[{id:'BAv',label:spec.t===1?'BAv':'右侧输出',point:Math2.apply(scene.current.BA,spec.v),color:colors[1]}]}];
  else if(spec.type==='system')panels=[{title:'方程与解',subtitle:'输入空间',vectors:scene.result.solution?[{id:'x',label:'x',point:scene.result.solution}]:[],system:true},{title:'输出与目标',subtitle:'列空间中的 b',A:spec.A,vectors:[{id:'b',label:'b',point:spec.b,color:colors[1]}],space:{rank:scene.spaces.rank,basis:scene.spaces.imageBasis[0],label:'Col(A)'}}];
  else if(spec.step==='spaces')panels=[{title:'输入空间',subtitle:'ker(A) 位于这里',vectors:[{id:'v',label:'v',point:spec.v,handle:'v'}],space:{rank:2-scene.spaces.rank,basis:scene.spaces.nullBasis[0],label:scene.spaces.rank===2?'ker(A) = {0}':scene.spaces.rank===0?'ker(A) = ℝ²':'ker(A) = span('+scene.spaces.nullBasis[0].map(fmt).join(', ')+')'}},{title:'输出空间',subtitle:'Col(A) 位于这里',A:spec.A,vectors:[{id:'Av',label:'Av',point:scene.result.Av}],space:{rank:scene.spaces.rank,basis:scene.spaces.imageBasis[0],label:scene.spaces.rank===2?'Col(A) = ℝ²':scene.spaces.rank===0?'Col(A) = {0}':'Col(A) = span('+scene.spaces.imageBasis[0].map(fmt).join(', ')+')'}}];
  else if(spec.step==='linearity')panels=[{title:'A(αu + βv)',subtitle:'先组合，再变换',A:spec.A,vectors:[{id:'lhs',label:'A(αu+βv)',point:scene.linearity.lhs}]},{title:'αAu + βAv',subtitle:'先变换，再组合',A:spec.A,vectors:[{id:'rhs',label:'αAu+βAv',point:scene.linearity.rhs,color:colors[2]}]}];
  else panels=[{title:spec.step==='basis'?'标准基':'变换之前',subtitle:'输入空间',vectors:spec.step==='basis'?[{id:'e1',label:'e₁',point:[1,0]},{id:'e2',label:'e₂',point:[0,1],color:colors[1]}]:[{id:'v',label:'v',point:spec.v,handle:'v'}],A:[1,0,0,1],showSquare:true},{title:spec.step==='basis'?'基向量的像':'变换之后',subtitle:spec.step==='basis'?'两列决定变换':'输出空间 · 当前 t 的结果',A:output,vectors:[{id:'e1',label:'Ae₁',point:[output[0],output[2]],handle:'e1'},{id:'e2',label:'Ae₂',point:[output[1],output[3]],color:colors[1],handle:'e2'},{id:'Av',label:'Av',point:Math2.apply(output,spec.v),color:colors[2]}],showSquare:true}];
  const finiteVectors=panels.flatMap(p=>p.vectors.map(v=>v.point)).filter(v=>v.every(Number.isFinite)),bound=Math.max(2,...panels.flatMap(p=>p.A?[Math.hypot(p.A[0],p.A[1]),Math.hypot(p.A[2],p.A[3])]:[1]),...finiteVectors.flat().map(Math.abs));
  const range=bound*1.18/zoom;
  const readout=spec.type==='composition'?`当前 t=${spec.t.toFixed(2)} · 左侧 [${scene.current.AB.map(fmt).join(', ')}] · 右侧 [${scene.current.BA.map(fmt).join(', ')}]`:spec.type==='system'?`rank A = ${scene.result.rank}   rank [A|b] = ${scene.result.rankAugmented} · ${{none:'无解',unique:'唯一解',infinite:'无穷多解'}[scene.result.solutionType]}`:spec.step==='linearity'?`A(αu+βv) = (${scene.linearity.lhs.map(fmt).join(', ')}) · αAu+βAv = (${scene.linearity.rhs.map(fmt).join(', ')}) · 残差 ${Math.hypot(...scene.linearity.residual).toExponential(1)}`:`${spec.step==='transform'&&spec.t!==1?'当前 T(t)':'A'} · det = ${fmt(scene.current.determinant)}   rank = ${scene.current.rank}   ${spec.step==='transform'&&spec.t!==1?'T(t)v':'Av'} = (${scene.current.Av.map(fmt).join(', ')})`+(spec.type==='eigen'?` · ${scene.current.eigenvalues.length?'λ = '+scene.current.eigenvalues.map(fmt).join(', '):'无实特征方向'}`:'');
  const canAnimate=spec.type!=='system'&&(spec.type==='composition'||spec.step==='transform'),historyState=history.current.state();
  return <main className={"math-scene "+(parent!==window?"is-embedded":"")}><header className="scene-heading"><div><small>问矩 / LINEAR ALGEBRA</small><h1>{parent!==window?'参数与视图':Math2.titles[spec.type]}</h1></div><div className="scene-actions"><button id="scene-undo" disabled={!historyState.canUndo} onClick={()=>travel('undo')} title="撤销 Ctrl+Z">撤销</button><button id="scene-redo" disabled={!historyState.canRedo} onClick={()=>travel('redo')} title="重做 Ctrl+Shift+Z">重做</button><button id="scene-fit" onClick={()=>setZoom(1)}>适应视图</button></div></header>
    {!['system','composition'].includes(spec.type)?<nav className="scene-story" aria-label="实验分镜">{Scene.steps.map((s,i)=><button key={s} aria-pressed={spec.step===s} onClick={()=>change(x=>({...x,step:s,t:1}))}>{String(i+1).padStart(2,'0')} {names[s]}</button>)}</nav>:<div className="scene-context">{spec.type==='system'?'编辑 A、b，对照方程交点与列空间中的目标':'左：I → B → AB　右：I → A → BA；拖动时间轴逐段比较'}</div>}
    <div className="mobile-views">{panels.map((p,i)=><button key={i} aria-pressed={activePanel===i} onClick={()=>setActivePanel(i)}>{p.title}</button>)}</div>
    <div id="plot" ref={plot} className={'scene-plots '+(size.width<520?'single-panel':'')} onWheel={e=>{e.preventDefault();setZoom(z=>Math.max(.4,Math.min(3,z*(e.deltaY<0?1.1:.9))));}}>
      {panels.map((p,i)=><div className={'panel-slot '+(activePanel===i?'active':'')} key={i}>
        <Panel {...p} eigen={spec.type==='eigen'&&i===1?scene.result.eigenvectors:[]} height={size.height-(innerHeight<440?53:66)} range={range} grid={grid} unit={unit} onBasis={basis} onVector={vector} step={spec.step}/>
        {p.system&&<SystemLines spec={spec} height={size.height-66} range={range}/>}
      </div>)}
    </div>
    <section className="scene-controls"><MatrixInputs spec={spec} setSpec={change}/>{canAnimate&&<div className="scene-timeline"><button id="scene-play" aria-label={playing?'暂停动画':'播放动画'} onClick={()=>{if(!playing&&spec.t>=1)change(s=>({...s,t:0}));setPlaying(!playing);}}>{playing?'Ⅱ':'▶'}</button><label>t<input id="scene-time" type="range" min="0" max="1" step=".01" value={spec.t} onChange={e=>change(s=>({...s,t:+e.target.value}),'input:time')}/><output>{spec.t.toFixed(2)}</output></label><button id="reset" onClick={()=>{change(Scene.normalize(initial));setZoom(1);}}>复位</button></div>}{!canAnimate&&<button id="reset" onClick={()=>change(Scene.normalize(initial))}>复位参数</button>}</section>
    <footer className="scene-footer"><div id="readout" aria-live="polite">{readout}</div><div className="scene-options"><label><input id="grid" type="checkbox" checked={grid} onChange={e=>setGrid(e.target.checked)}/>网格</label><label><input id="unit" type="checkbox" checked={unit} onChange={e=>setUnit(e.target.checked)}/>单位圆</label><span id="notice">拖动圆点 · 输入与输出分别显示</span><details><summary>计算与说明</summary><div className="scene-explanation"><p>目标 A = [{spec.A.map(fmt).join(', ')}]，det A={fmt(scene.result.determinant)}，rank A={scene.result.rank}。{spec.type==='composition'&&`终态 AB=[${scene.result.AB.map(fmt).join(', ')}]，BA=[${scene.result.BA.map(fmt).join(', ')}]；${scene.result.commutes?'本例可交换':'本例不可交换'}`} 当前帧数值显示在状态行。</p><p>核的维数 {2-scene.spaces.rank}，像的维数 {scene.spaces.rank}。两个视图保留各自原点。</p><p>数值容差 1e-9；实例检验不替代一般命题证明。</p></div></details></div></footer>
  </main>;
}
function SystemLines({spec,height,range}){
  return <div className="system-overlay"><Mafs height={Math.max(110,height)} pan={false} viewBox={{x:[-range,range],y:[-range,range],padding:.6}}>{[0,1].map(i=>{
    const a=spec.A[i*2],b=spec.A[i*2+1],c=spec.b[i];if(Math.abs(a)+Math.abs(b)<1e-9)return null;
    const point1=Math.abs(b)>1e-9?[-range,(c+a*range)/b]:[c/a,-range],point2=Math.abs(b)>1e-9?[range,(c-a*range)/b]:[c/a,range];return <Line.ThroughPoints key={i} point1={point1} point2={point2} color={colors[i]} style={i?'dashed':'solid'}/>;
  })}</Mafs></div>;
}
register(({spec})=><MathApp initial={spec}/>);
