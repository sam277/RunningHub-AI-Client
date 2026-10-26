import React, { useEffect, useRef, useState } from 'react';
import { settingsStorage } from '../../services/localPersistence';

const defaults={left:218,right:330,leftOpen:true,rightOpen:true};
export default function ResizableWorkbench({children,revealHistory}:{children:React.ReactNode;revealHistory:number}){
  const [layout,setLayout]=useState(()=>{try{const value=JSON.parse(settingsStorage.getItem('rh_workbench_layout_v2')||'{}');return {...defaults,...value,left:Math.min(400,Math.max(160,Number(value.left)||defaults.left)),right:Math.min(650,Math.max(260,Number(value.right)||defaults.right))};}catch{return defaults;}});
  const saved=useRef(layout),drag=useRef<{side:'left'|'right';x:number;width:number}|null>(null);
  const parts=React.Children.toArray(children);
  useEffect(()=>{settingsStorage.setItem('rh_workbench_layout_v2',JSON.stringify(layout));},[layout]);
  useEffect(()=>{if(revealHistory)setLayout(previous=>({...previous,rightOpen:true}));},[revealHistory]);
  const resize=(side:'left'|'right')=><div role="separator" aria-orientation="vertical" aria-label={side==='left'?'调整左侧栏宽度':'调整右侧栏宽度'} tabIndex={0} className="workbench-resizer" onDoubleClick={()=>setLayout(previous=>({...previous,[side]:defaults[side]}))} onKeyDown={event=>{if(['ArrowLeft','ArrowRight','Home'].includes(event.key)){event.preventDefault();const delta=(event.key==='ArrowRight'?20:-20)*(side==='left'?1:-1);setLayout(previous=>({...previous,[side]:event.key==='Home'?defaults[side]:Math.min(side==='left'?400:650,Math.max(side==='left'?160:260,previous[side]+delta))}));}}} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);drag.current={side,x:event.clientX,width:layout[side]};}} onPointerMove={event=>{const start=drag.current;if(!start||start.side!==side)return;const next=start.width+(event.clientX-start.x)*(side==='left'?1:-1);setLayout(previous=>({...previous,[side]:Math.min(side==='left'?400:650,Math.max(side==='left'?160:260,next))}));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/>;
  return <div className="resizable-workbench" data-left-open={layout.leftOpen} data-right-open={layout.rightOpen}>
    <div className="workbench-layout-controls"><button aria-pressed={layout.leftOpen} onClick={()=>setLayout(previous=>({...previous,leftOpen:!previous.leftOpen}))}>{layout.leftOpen?'收起导航':'展开导航'}</button><button aria-pressed={layout.rightOpen} onClick={()=>setLayout(previous=>({...previous,rightOpen:!previous.rightOpen}))}>{layout.rightOpen?'收起记录与日志':'展开记录与日志'}</button><button onClick={()=>{if(layout.leftOpen||layout.rightOpen){saved.current=layout;setLayout(previous=>({...previous,leftOpen:false,rightOpen:false}));}else setLayout(saved.current.leftOpen||saved.current.rightOpen?saved.current:{...saved.current,leftOpen:true,rightOpen:true});}}>{!layout.leftOpen&&!layout.rightOpen?'退出专注':'专注编辑'}</button><button onClick={()=>setLayout(defaults)}>恢复默认布局</button><span>拖动分隔线调宽 · 双击复位</span></div>
    <div className="resizable-layout" style={{'--nav-width':layout.leftOpen?layout.left+'px':'24px','--record-width':layout.rightOpen?layout.right+'px':'24px'} as React.CSSProperties}>
      <div className="workbench-nav-slot">{!layout.leftOpen&&<button className="pane-rail" aria-label="展开左侧导航" onClick={()=>setLayout(previous=>({...previous,leftOpen:true}))}>›</button>}<div className={layout.leftOpen?'pane-content':'pane-content hidden'}>{parts[0]}</div></div>
      {resize('left')}<div className="workbench-center-slot">{parts[1]}</div>{resize('right')}
      <div className="workbench-record-slot">{!layout.rightOpen&&<button className="pane-rail" aria-label="展开右侧记录" onClick={()=>setLayout(previous=>({...previous,rightOpen:true}))}>‹</button>}<div className={layout.rightOpen?'pane-content':'pane-content hidden'}>{parts[2]}</div></div>
    </div>
  </div>;
}
