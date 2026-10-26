import React from 'react';
import { NodeInfo } from '../../types';
import { getSwitchFieldConfig,parseListOptions } from '../../utils/nodeUtils';

export default function FieldInput({node,label,disabled,onChange}:{node:NodeInfo;label:string;disabled?:boolean;onChange:(value:string)=>void}){
  const toggle=getSwitchFieldConfig(node),options=toggle?[]:parseListOptions(node);
  if(toggle)return <button type="button" role="switch" aria-label={label} aria-checked={toggle.checked} disabled={disabled} className="compact-switch" onClick={()=>onChange(toggle.checked?toggle.uncheckedValue:toggle.checkedValue)}>{toggle.checked?toggle.checkedLabel:toggle.uncheckedLabel}</button>;
  if(options.length)return <select aria-label={label} value={node.fieldValue} disabled={disabled} onChange={e=>onChange(e.target.value)}>{!options.some(o=>o.index===node.fieldValue)&&<option value={node.fieldValue}>{node.fieldValue||'请选择'}</option>}{options.map(o=><option key={o.index} value={o.index}>{o.name}</option>)}</select>;
  return <input aria-label={label} type={['INT','FLOAT'].includes(node.fieldType)?'number':'text'} step={node.fieldType==='INT'?1:'any'} value={node.fieldValue} disabled={disabled} onChange={e=>onChange(e.target.value)}/>;
}
