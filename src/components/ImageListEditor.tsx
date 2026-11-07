import {useId,useLayoutEffect,useRef,useState} from 'react'
import {Alert,Image,Modal,Spin} from 'antd'
import {ArrowDown,ArrowUp,Check,Image as ImageIcon,Images,Minus,Plus} from 'lucide-react'
import {api} from '../api'
import type {Asset} from '../types'
import {ActionButton,TextInput,TextArea} from './AdminControls'
import './image-list-editor.css'

export const imagePaths=(values:string[])=>[...new Set(values.map(value=>value.trim()).filter(Boolean))]

/** New rows and blank pasted lines are draft data; clean them only when saving. */
export default function ImageListEditor({label,value,onChange,canBrowse=false,disabled=false}:{label:string;value:string[];onChange:(value:string[])=>void;canBrowse?:boolean;disabled?:boolean}){
  const inputId=useId(),images=imagePaths(value)
  const editor=useRef<HTMLDivElement>(null),focusRow=useRef<number|null>(null)
  const [open,setOpen]=useState(false),[batch,setBatch]=useState(false),[loading,setLoading]=useState(false),[assets,setAssets]=useState<Asset[]>([]),[selected,setSelected]=useState<string[]>([]),[error,setError]=useState('')
  useLayoutEffect(()=>{if(focusRow.current!==null){editor.current?.querySelector<HTMLInputElement>(`[data-image-row="${focusRow.current}"] input`)?.focus();focusRow.current=null}},[value])
  async function browse(){
    setOpen(true);setSelected([]);setError('');setLoading(true)
    try{const rows=await api<Asset[]>('/api/admin/assets');setAssets([...new Map(rows.filter(row=>row.url).map(row=>[row.url,row])).values()])}
    catch(e){setError((e as Error).message)}
    finally{setLoading(false)}
  }
  function addRow(index=value.length){const next=[...value];next.splice(index,0,'');focusRow.current=index;onChange(next)}
  function move(index:number,direction:number){const next=[...value];[next[index],next[index+direction]]=[next[index+direction],next[index]];onChange(next)}
  return <div ref={editor} className="image-list-editor field-wide" role="group" aria-labelledby={`${inputId}-heading`}>
    <div className="image-list-heading"><span id={`${inputId}-heading`}>{label}</span><small>{images.length} 张图片</small><div className="image-list-tools">
      <ActionButton type="button" className="a-secondary" disabled={disabled} onClick={()=>addRow()}><Plus size={16}/>添加图片</ActionButton>
      {canBrowse&&<ActionButton type="button" className="a-secondary" disabled={disabled} onClick={()=>void browse()}><Images size={16}/>从素材库添加</ActionButton>}
      <ActionButton type="button" className="a-link" disabled={disabled} aria-expanded={batch} onClick={()=>setBatch(!batch)}>{batch?'收起多行编辑':'多行粘贴'}</ActionButton>
    </div></div>
    <Image.PreviewGroup><div className="image-path-rows">{value.map((url,index)=><div className="image-path-row" data-image-row={index} key={index}>
      <div className="image-row-preview">{url.trim()?<Image src={url.trim()} alt={`${label}第 ${index+1} 张`} width="100%"/>:<ImageIcon size={24}/>}</div>
      <label className="image-row-path"><span>第 {index+1} 张图片</span><TextInput aria-label={`${label}第 ${index+1} 张图片路径`} disabled={disabled} value={url} placeholder="填写图片路径，或从素材库添加" onChange={event=>onChange(value.map((old,i)=>i===index?event.target.value:old))} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();addRow(index+1)}}}/></label>
      <div className="image-row-actions">
        <ActionButton type="button" className="a-secondary" aria-label={`上移第 ${index+1} 张图片`} title="上移" disabled={disabled||index===0} onClick={()=>move(index,-1)}><ArrowUp size={15}/></ActionButton>
        <ActionButton type="button" className="a-secondary" aria-label={`下移第 ${index+1} 张图片`} title="下移" disabled={disabled||index===value.length-1} onClick={()=>move(index,1)}><ArrowDown size={15}/></ActionButton>
        <ActionButton type="button" className="a-secondary" aria-label={`在第 ${index+1} 张图片后添加`} title="在此后添加图片" disabled={disabled} onClick={()=>addRow(index+1)}><Plus size={15}/></ActionButton>
        <ActionButton type="button" className="a-danger" aria-label={`移除第 ${index+1} 张图片`} title="移除图片" disabled={disabled} onClick={()=>onChange(value.filter((_,i)=>i!==index))}><Minus size={15}/></ActionButton>
      </div>
    </div>)}</div></Image.PreviewGroup>
    {!value.length&&<p className="image-list-empty">暂无相册图片，点击「＋ 添加图片」逐张添加。</p>}
    {batch&&<TextArea id={inputId} aria-label={label} rows={3} disabled={disabled} value={value.join('\n')} placeholder="每行填写一张图片路径，可直接回车换行或粘贴多行" onChange={event=>onChange(event.target.value.split(/\r?\n/))}/>}
    <p className="image-list-hint">点击 ＋ 添加、− 移除，或按回车添加下一行；修改后请保存。保存时自动去除空行和重复图片。</p>
    <Modal open={open} centered title="从素材库添加图片" width={880} className="admin-modal image-library-modal" onCancel={()=>setOpen(false)} footer={<div className="image-library-footer"><span>已选 {selected.length} 张，添加后点击页面保存按钮生效。</span><ActionButton type="button" className="a-secondary" onClick={()=>setOpen(false)}>取消</ActionButton><ActionButton type="button" className="a-primary" disabled={disabled||!selected.length} onClick={()=>{onChange(imagePaths([...value,...selected]));setOpen(false)}}>添加所选图片（{selected.length}）</ActionButton></div>}>
      {error&&<Alert type="error" showIcon title={error}/>}
      {loading?<div className="image-library-loading"><Spin/></div>:<>
        <p className="image-list-hint">可一次选择多张；新图片请先在「图片素材」中上传。</p>
        <div className="image-library-grid">{assets.map(asset=>{
          const added=images.includes(asset.url),checked=selected.includes(asset.url)
          return <ActionButton layout="card" type="button" role="checkbox" aria-checked={added||checked} aria-label={asset.title||asset.url} disabled={disabled||added} className={`image-library-item${added||checked?' selected':''}`} key={asset.url} onClick={()=>setSelected(old=>checked?old.filter(url=>url!==asset.url):[...old,asset.url])}>
            <img src={asset.url} alt="" loading="lazy"/><span title={asset.title||asset.url}>{asset.title||asset.url}</span><small>{added?'已在相册中':checked?'已选择':'点击选择'}{(added||checked)&&<Check size={14}/>}</small>
          </ActionButton>
        })}</div>
        {!assets.length&&!error&&<p className="image-list-empty">暂无可用素材，请先到「图片素材」上传图片。</p>}
      </>}
    </Modal>
  </div>
}
