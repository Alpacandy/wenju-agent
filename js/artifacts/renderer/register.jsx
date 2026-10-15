import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
export default function register(render){window.WenjuMath={mount({kind,spec}){
  const root=createRoot(document.getElementById('math-root'));flushSync(()=>root.render(render({kind,spec}))); 
  const dispatch=window.WenjuScene?.command,operations=new Map();
  if(dispatch)window.WenjuScene.command=async args=>{
    const id=args.operation_id;if(!id||['read','verify','inspect_layout'].includes(args.action))return dispatch(args);
    if(typeof id!=='string'||id.length>128)throw Error('SCENE_OPERATION_INVALID');
    const signature=JSON.stringify([args.action,args.step,args.t,args.expectedRevision]);
    const previous=operations.get(id);if(previous){if(previous.signature!==signature)throw Error('SCENE_OPERATION_CONFLICT');return previous.promise;}
    if(operations.size>=64)throw Error('SCENE_OPERATION_QUOTA_EXCEEDED');
    const promise=dispatch(args);operations.set(id,{signature,promise});try{return await promise;}catch(error){operations.delete(id);throw error;}
  };
  window.addEventListener('pagehide',()=>root.unmount(),{once:true});
}};
}
