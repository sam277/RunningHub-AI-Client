import { useEffect,useState } from 'react';
import { NodeInfo,PendingFilesMap } from '../../types';
import { fieldTokens } from '../../services/workbenchFields';
const ids=new WeakMap<Blob,number>();let serial=0;
export const fileRevision=(files:PendingFilesMap)=>Object.entries(files).map(([key,file])=>{if(file instanceof Blob){if(!ids.has(file))ids.set(file,++serial);return [key,ids.get(file)];}return [key,file];});
export function useFieldTokens(items:{id:string;nodes:NodeInfo[];files:PendingFilesMap}[]){
  const revision=JSON.stringify(items.map(item=>[item.id,item.nodes.map(n=>[n.nodeId,n.fieldName,n.fieldValue]),fileRevision(item.files)]));
  const [state,setState]=useState<{revision:string;tokens:Record<string,Record<string,string>>}>({revision:'',tokens:{}});
  useEffect(()=>{let active=true;void Promise.all(items.map(async item=>[item.id,await fieldTokens(item.nodes,item.files)])).then(pairs=>{if(active)setState({revision,tokens:Object.fromEntries(pairs)});}).catch(()=>{if(active)setState({revision:'',tokens:{}});});return()=>{active=false;};},[revision]);
  return {ready:state.revision===revision,tokens:state.tokens};
}
