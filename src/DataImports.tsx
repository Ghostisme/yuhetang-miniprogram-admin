import ResponsiveTable from './components/ResponsiveTable'
import {ActionButton,TextInput,SelectInput,TextArea,DisabledFieldset} from './components/AdminControls'
import {useState} from 'react'
import {Download} from 'lucide-react'
import {api} from './api'
import type {Ctx} from './Admin'
import type {Row} from './types'

const kinds:Row={members:'会员基础资料',therapists:'调理师资料',stores:'门店资料',services:'养护品项资料','dianping-customers':'大众点评客户','dianping-orders':'大众点评订单 / 预约记录'}
const endpoint=(kind:string)=>kind.startsWith('dianping-')?'/api/admin/dianping/imports/'+kind.slice(9):'/api/admin/imports/'+kind

async function downloadTemplate(kind:string){
  const response=await fetch(endpoint(kind)+'/template',{headers:{Authorization:'Bearer '+sessionStorage.getItem('yht-admin-token')}})
  if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||'模板下载失败。')}
  const url=URL.createObjectURL(await response.blob()),link=document.createElement('a')
  link.href=url;link.download=`裕和堂-${kinds[kind]}-模板.xlsx`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}

export default function DataImports({ctx}:{ctx:Ctx}){
  const [kind,setKind]=useState('members'),[preview,setPreview]=useState<Row|null>(null),[error,setError]=useState(''),[file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false)
  const dianping=kind.startsWith('dianping-')
  async function upload(commit:boolean){
    if(!file||busy)return
    setBusy(true);setError('')
    try{
      const form=new FormData();form.append('file',file)
      const result=await api<Row>(`${endpoint(kind)}?commit=${commit}`,{method:'POST',body:form})
      setPreview({...result,committed:commit})
      if(commit){if(kind==='stores')await ctx.refreshStores();ctx.notify(dianping?`点评资料导入完成：新增 ${result.created}、更新 ${result.updated}、跳过 ${result.skipped} 条。`:`导入完成，共处理 ${result.imported} 条。`)}
    }catch(e){setError((e as Error).message);setPreview(null)}finally{setBusy(false)}
  }
  return <section className="ops-card">
    <div className="card-heading"><div><h3>资料导入</h3><p>下载模板、填表预检，再确认写入。大众点评数据与现有门店、客户及预约流程衔接。</p></div></div>
    <div className="admin-note">{dianping?'先在“扩展与配置 → 大众点评数据接入”完成门店与品项映射。客户按完整手机号建立本店档案；已有会员资料和私有跟进保留。订单导入后到“预约管理 → 大众点评订单”查看，确认预约时再占用时段。':'仅总部可导入。会员基础资料按手机号更新，调理师按资料编号匹配；养护品项保存为品牌草稿，发布后生效。'}</div>
    {!dianping&&<p className="field-note">首次使用建议先导入门店，再导入养护品项并在“品牌与内容”发布，之后导入调理师与会员。门店按 id 新增或更新；新门店默认关闭在线预约，请在“门店与时段”核对资料和规则后启用。</p>}
    <div className="button-row">
      <SelectInput aria-label="导入资料类型" disabled={busy} value={kind} onChange={e=>{setKind(e.target.value);setPreview(null);setFile(null);setError('')}}>{Object.entries(kinds).map(([key,name])=><option key={key} value={key}>{name}</option>)}</SelectInput>
      <ActionButton className="a-secondary" disabled={busy} onClick={()=>downloadTemplate(kind).catch(e=>setError(e.message))}><Download size={14}/>下载模板</ActionButton>
      <TextInput key={kind} aria-label="导入文件" type="file" accept=".xlsx" disabled={busy} onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);setError('')}}/>
      <ActionButton className="a-secondary" disabled={!file||busy} onClick={()=>void upload(false)}>{busy?'处理中…':'预检文件'}</ActionButton>
    </div>
    {kind==='dianping-orders'&&<p className="field-note">每行对应一个订单明细，externalLineId 留空按 main 处理。金额单位为元，支持两位小数；createdAt、updatedAt 填 yyyy-MM-dd HH:mm:ss（北京时间）。状态可填待付款、已付款、已预约、已核销、已取消、已退款。没有预约时间时，bookingDate、startTime 同时留空。</p>}
    {kind==='dianping-customers'&&<p className="field-note">externalShopId 填点评门店编号，externalCustomerId 可留空，name 为客户称呼，phone 须为完整手机号。导入不会绑定客户微信身份。</p>}
    {error&&<div className="admin-error" role="alert">{error}</div>}
    {preview&&<div className="import-result">
      <h3>{preview.committed?'资料导入完成':preview.valid?'资料预检通过':'存在问题，请修改后重试'}</h3>
      <p>读取 {preview.total} 条 · 已导入 {preview.imported||0} 条{dianping&&` · 新增 ${preview.created} · 更新 ${preview.updated} · 跳过 ${preview.skipped}`}</p>
      {preview.batchId&&<p className="field-note">导入批次：{preview.batchId}</p>}
      {preview.errors?.map((message:string,i:number)=><p className="admin-error" key={i}>{message}</p>)}
      {preview.rows?.length>0&&<div className="table-scroll"><ResponsiveTable className="ops-table"><thead><tr>{Object.keys(preview.rows[0]).map(key=><th key={key}>{key}</th>)}</tr></thead><tbody>{preview.rows.map((row:Row,i:number)=><tr key={i}>{Object.values(row).map((value,n)=><td key={n}>{String(value)}</td>)}</tr>)}</tbody></ResponsiveTable></div>}
      {preview.valid&&!preview.committed&&<ActionButton className="a-primary" disabled={busy} onClick={()=>window.confirm(`确认导入这份${kinds[kind]}文件？系统会重新校验整份文件后写入。`)&&void upload(true)}>确认执行导入</ActionButton>}
    </div>}
  </section>
}
