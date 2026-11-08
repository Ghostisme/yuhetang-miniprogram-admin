import {useId,useLayoutEffect,useRef,useState} from 'react'
import {ArrowDown,ArrowUp,Minus,Plus} from 'lucide-react'
import {ActionButton,TextArea,TextInput} from './AdminControls'
import './entry-list-editor.css'

/** Keep partial entries and empty rows until an explicit save. */
export const nonemptyEntries=(values:string[])=>values.map(value=>value.trim()).filter(Boolean)
export const uniqueEntries=(values:string[])=>[...new Set(nonemptyEntries(values))]

export default function EntryListEditor({label,unit,addLabel,batchLabel,value,onChange,disabled=false,type='text',reorder=true,className='',placeholder,hint,separator=/\r\n|\r|\n/}:{label:string;unit:string;addLabel:string;batchLabel:string;value:string[];onChange:(value:string[])=>void;disabled?:boolean;type?:'text'|'date';reorder?:boolean;className?:string;placeholder?:string;hint:string;separator?:RegExp}){
  const id=useId(),editor=useRef<HTMLDivElement>(null),focusRow=useRef<number|null>(null)
  const [batch,setBatch]=useState(false)
  useLayoutEffect(()=>{
    if(focusRow.current===null)return
    editor.current?.querySelector<HTMLInputElement>(`[data-entry-row="${focusRow.current}"] input`)?.focus()
    focusRow.current=null
  },[value])
  function add(index=value.length){const next=[...value];next.splice(index,0,'');focusRow.current=index;onChange(next)}
  function remove(index:number){focusRow.current=value.length>1?Math.min(index,value.length-2):null;onChange(value.filter((_,i)=>i!==index))}
  function move(index:number,direction:number){const next=[...value];[next[index],next[index+direction]]=[next[index+direction],next[index]];focusRow.current=index+direction;onChange(next)}
  return <div ref={editor} className={`entry-list-editor field-wide ${className}`} role="group" aria-labelledby={`${id}-heading`}>
    <div className="entry-list-heading">
      <span id={`${id}-heading`}>{label}</span><small>{nonemptyEntries(value).length} {unit}</small>
      <div className="entry-list-tools">
        <ActionButton type="button" className="a-secondary" disabled={disabled} onClick={()=>add()}><Plus size={16}/>{addLabel}</ActionButton>
        <ActionButton type="button" className="a-link" disabled={disabled} aria-expanded={batch} aria-controls={`${id}-batch`} onClick={()=>setBatch(!batch)}>{batch?'收起多行编辑':'多行粘贴'}</ActionButton>
      </div>
    </div>
    <div className="entry-list-rows">{value.map((entry,index)=><div className="entry-list-row" data-entry-row={index} key={index}>
      <span className="entry-row-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span>
      <TextInput type={type} aria-label={`${label}第 ${index+1} ${unit}`} disabled={disabled} value={entry} placeholder={placeholder} onChange={event=>onChange(value.map((old,i)=>i===index?event.target.value:old))} onKeyDown={event=>{
        if(event.key==='Enter'&&!event.nativeEvent.isComposing&&event.keyCode!==229){event.preventDefault();add(index+1)}
      }} onPaste={event=>{
        if(type!=='text')return
        const text=event.clipboardData.getData('text/plain'),lines=text.split(separator)
        if(lines.length<2)return
        event.preventDefault()
        const input=event.currentTarget
        lines[0]=entry.slice(0,input.selectionStart??0)+lines[0]
        lines[lines.length-1]+=entry.slice(input.selectionEnd??entry.length)
        const next=[...value];next.splice(index,1,...lines);focusRow.current=index+lines.length-1;onChange(next)
      }}/>
      <div className="entry-row-actions">
        {reorder&&<><ActionButton type="button" className="a-secondary" aria-label={`上移第 ${index+1} ${unit}`} title="上移" disabled={disabled||index===0} onClick={()=>move(index,-1)}><ArrowUp size={15}/></ActionButton>
        <ActionButton type="button" className="a-secondary" aria-label={`下移第 ${index+1} ${unit}`} title="下移" disabled={disabled||index===value.length-1} onClick={()=>move(index,1)}><ArrowDown size={15}/></ActionButton></>}
        <ActionButton type="button" className="a-secondary" aria-label={`在第 ${index+1} ${unit}后添加`} title="在此后添加" disabled={disabled} onClick={()=>add(index+1)}><Plus size={15}/></ActionButton>
        <ActionButton type="button" className="a-danger" aria-label={`删除第 ${index+1} ${unit}`} title="删除" disabled={disabled} onClick={()=>remove(index)}><Minus size={15}/></ActionButton>
      </div>
    </div>)}</div>
    {!value.length&&<p className="entry-list-empty">暂无{label}，点击「＋ {addLabel}」开始编辑。</p>}
    {batch&&<TextArea id={`${id}-batch`} aria-label={batchLabel} rows={4} disabled={disabled} value={value.join('\n')} placeholder={type==='date'?'每行一个 YYYY-MM-DD 日期，也可用中英文逗号分隔':'每行填写一条内容，可回车换行或一次粘贴多条'} onChange={event=>onChange(event.target.value.split(separator))}/>}
    <p className="entry-list-hint">{hint}</p>
  </div>
}
