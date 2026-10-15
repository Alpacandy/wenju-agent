import React,{useState,useEffect,useRef} from 'react';

/** Preserve incomplete edits without allowing them into the numerical scene. */
export default function NumberInput({value,onValue,min=-20,max=20,...props}){
  const [draft,setDraft]=useState(String(value)),[invalid,setInvalid]=useState(false),focused=useRef(false);
  useEffect(()=>{if(!focused.current){setDraft(String(value));setInvalid(false);}},[value]);
  const accept=raw=>raw.trim()!==''&&Number.isFinite(Number(raw))&&Number(raw)>=min&&Number(raw)<=max;
  return <input {...props} type="number" min={min} max={max} step="any" value={draft} aria-invalid={invalid} title={invalid?`请输入 ${min} 到 ${max} 的数值；离开输入框恢复上次有效值`:props.title}
    onFocus={()=>{focused.current=true;}}
    onChange={e=>{const raw=e.target.value,valid=accept(raw);setDraft(raw);setInvalid(!valid);if(valid)onValue(Number(raw));}}
    onBlur={()=>{focused.current=false;setDraft(String(value));setInvalid(false);}}
    onKeyDown={e=>{if(e.key==='Escape'){setDraft(String(value));setInvalid(false);e.currentTarget.blur();}if(e.key==='Enter')e.currentTarget.blur();}}/>;
}
