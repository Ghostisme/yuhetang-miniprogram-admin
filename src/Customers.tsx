import { useEffect, useRef, useState } from 'react'
import { Alert, Modal, Pagination, Switch, Tag } from 'antd'
import { Download, RefreshCw, Search, UserRound } from 'lucide-react'
import { api, displayTime } from './api'
import type { Ctx } from './Admin'
import type { Page, Row } from './types'
import { ActionButton, SelectInput, TextArea, TextInput } from './components/AdminControls'
import './customers.css'

const labels: Record<string,string> = { MINIPROGRAM:'小程序', DIANPING:'大众点评', WECHAT:'微信', PHONE:'电话', WALKIN:'到店', IMPORT:'资料导入' }
export default function Customers({ ctx, onExport }: { ctx: Ctx; onExport: () => Promise<void> }) {
  const [data,setData]=useState<Page<Row>>({items:[],total:0}),[page,setPage]=useState(1)
  const [filters,setFilters]=useState({search:'',member:'',source:''}),[search,setSearch]=useState('')
  const [edit,setEdit]=useState<Row|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const [phone,setPhone]=useState(''),[shared,setShared]=useState<Row|null>(null),[revealed,setRevealed]=useState<Record<string,string>>({})
  const version=useRef(0)
  async function refresh(){
    const current=++version.current
    try { const next=await api<Page<Row>>('/api/admin/customers?'+new URLSearchParams({...filters,storeId:ctx.store,page:String(page)}));if(current===version.current){setData(next);setError('')} }
    catch(cause){if(current===version.current)setError((cause as Error).message)}
  }
  useEffect(()=>{setData({items:[],total:0});setRevealed({});setEdit(null);void refresh();return()=>{version.current++}},[ctx.store,page,filters])
  const canMaster=ctx.me.hq&&ctx.can('customers:master')
  async function save(event:React.FormEvent){
    event.preventDefault();if(!edit||busy)return;setBusy(true)
    try { await api('/api/admin/customers/'+edit.id,{method:'PUT',body:JSON.stringify({storeId:edit.storeId||'',privateNote:edit.privateNote||'',...(canMaster?{name:edit.name,memberVerified:!!edit.memberVerified,memberGrade:edit.memberGrade||'',sharedNote:edit.sharedNote||''}:{})})});setEdit(null);await refresh();ctx.notify('客户资料与会员标识已保存。') }
    catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  async function reveal(customer:Row){
    try { const result=await api<{phone:string}>(`/api/admin/customers/${customer.id}/phone`);setRevealed(previous=>({...previous,[customer.id]:result.phone})) }
    catch(cause){setError((cause as Error).message)}
  }
  const updateFilter=(key:'member'|'source',value:string)=>{setPage(1);setFilters(previous=>({...previous,[key]:value}))}
  return <>
    <section className='ops-card customer-directory'>
      <div className='card-heading'><div><h3>客户档案</h3><p>微信登录自动登记；授权手机号后关联客户资料。会员由总部维护，来源可同时包含小程序与大众点评。</p></div><div className='button-row'><ActionButton type='button' className='a-secondary' aria-label='刷新客户档案' onClick={()=>{void refresh()}}><RefreshCw size={14}/></ActionButton>{ctx.me.hq&&ctx.can('customers:export')&&<ActionButton className='a-secondary' onClick={()=>{void onExport().catch(cause=>setError(cause.message))}}><Download size={14}/>导出</ActionButton>}</div></div>
      {error&&<Alert type='error' title={error} showIcon closable onClose={()=>setError('')}/>}
      <form className='customer-filters' onSubmit={event=>{event.preventDefault();setPage(1);setFilters(previous=>({...previous,search:search.trim()}))}}>
        <TextInput aria-label='搜索客户' value={search} onChange={event=>setSearch(event.target.value)} placeholder='姓名 / 小程序称呼 / 手机号' maxLength={80}/>
        <SelectInput aria-label='会员状态' value={filters.member} onChange={event=>updateFilter('member',event.target.value)}><option value=''>全部会员状态</option><option value='MEMBER'>会员</option><option value='NON_MEMBER'>非会员</option></SelectInput>
        <SelectInput aria-label='客户来源' value={filters.source} onChange={event=>updateFilter('source',event.target.value)}><option value=''>全部客户来源</option>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</SelectInput>
        <ActionButton className='a-secondary'><Search size={14}/>搜索</ActionButton><span className='customer-count'>共 {data.total} 条档案</span>
      </form>
      {data.items.length?<div className='table-scroll'><table className='ops-table'><thead><tr><th>姓名 / 联系电话</th><th>所属门店</th><th>会员状态</th><th>客户来源</th><th>登录与资料状态</th><th>操作</th></tr></thead><tbody>{data.items.map(customer=><tr key={customer.id+(customer.storeId||'')}>
        <td><strong>{customer.name||'待完善称呼'}</strong>{customer.registeredName&&customer.registeredName!==customer.name&&<small>小程序称呼：{customer.registeredName}</small>}<small>{revealed[customer.id]||customer.phone||'尚未授权手机号'}</small>{!customer.registrationOnly&&ctx.can('appointments:phone')&&!revealed[customer.id]&&<ActionButton type='button' className='a-link' onClick={()=>{void reveal(customer)}}>查看完整电话</ActionButton>}</td>
        <td>{ctx.stores.find(store=>store.id===customer.storeId)?.name||'暂未关联门店'}{customer.privateNote&&<small className='customer-note'>{customer.privateNote}</small>}</td>
        <td><Tag color={customer.memberVerified?'gold':'default'}>{customer.memberVerified?'会员':'非会员'}</Tag>{customer.memberVerified&&customer.memberGrade&&<small>{customer.memberGrade}</small>}</td>
        <td>{(customer.sources||[customer.source]).filter(Boolean).map((source:string)=><Tag key={source} color={source==='DIANPING'?'orange':source==='MINIPROGRAM'?'green':'default'}>{labels[source]||source}</Tag>)}</td>
        <td>{customer.firstLoginAt?<><Tag color={customer.phoneVerified?'success':'default'}>{customer.phoneVerified?'微信手机号已授权':'待完善手机号'}</Tag><small>首次 {displayTime(customer.firstLoginAt)}</small><small>最近 {displayTime(customer.lastLoginAt)}</small></>:<small>尚未关联微信登录</small>}</td>
        <td>{!customer.registrationOnly&&ctx.can('customers:write')&&(customer.storeId||canMaster)?<ActionButton type='button' className='a-link' onClick={()=>{setError('');setEdit({...customer})}}>维护档案</ActionButton>:<span className='customer-muted'>{customer.registrationOnly?'等待客户完善资料':'只读'}</span>}</td>
      </tr>)}</tbody></table></div>:<div className='data-empty'><UserRound size={30} strokeWidth={1.2}/><p>当前条件下暂无客户档案</p></div>}
      <Pagination current={page} total={data.total} pageSize={30} showSizeChanger={false} onChange={setPage}/>
    </section>
    {ctx.can('customers:shared')&&<section className='ops-card shared-lookup'><h3>品牌基础档案 · 精确检索</h3><p>须由总部开启，仅返回基础白名单字段。</p><div className='button-row'><TextInput aria-label='基础档案精确手机号' value={phone} onChange={event=>setPhone(event.target.value)} placeholder='完整 11 位手机号' maxLength={11}/><ActionButton className='a-secondary' onClick={()=>{void api('/api/admin/customers/shared-lookup',{method:'POST',body:JSON.stringify({phone})}).then(setShared).catch(cause=>setError(cause.message))}}>精确查询（留痕）</ActionButton></div>{shared&&<pre>{JSON.stringify(shared,null,2)}</pre>}</section>}
    <Modal title='客户资料与会员标识' open={!!edit} centered width={600} className='admin-modal' onCancel={()=>{if(!busy)setEdit(null)}} footer={null} destroyOnHidden>
      {edit&&<form className='customer-edit' onSubmit={save}>
        <p>{edit.name} · {edit.phone} · {ctx.stores.find(store=>store.id===edit.storeId)?.name||'暂未关联门店'}</p>
        {canMaster&&<><label className='admin-field'><span>客户姓名 / 称呼</span><TextInput required maxLength={40} value={edit.name} onChange={event=>setEdit({...edit,name:event.target.value})}/></label><label className='toggle-field'><Switch aria-label='会员标识' checked={!!edit.memberVerified} onChange={value=>setEdit({...edit,memberVerified:value})}/><span>{edit.memberVerified?'会员':'非会员'}</span></label>{edit.memberVerified&&<label className='admin-field'><span>会员等级</span><TextInput maxLength={60} value={edit.memberGrade||''} onChange={event=>setEdit({...edit,memberGrade:event.target.value})}/></label>}<label className='admin-field'><span>品牌共享接待提示</span><TextArea maxLength={300} value={edit.sharedNote||''} onChange={event=>setEdit({...edit,sharedNote:event.target.value})}/></label></>}
        {edit.storeId&&<label className='admin-field'><span>本店私有跟进</span><TextArea value={edit.privateNote||''} maxLength={1000} onChange={event=>setEdit({...edit,privateNote:event.target.value})}/></label>}
        <p className='customer-muted'>来源由登录、预约及导入记录自动累积。</p>{error&&<Alert type='error' title={error} showIcon/>}<ActionButton className='a-primary' disabled={busy}>{busy?'正在保存…':'保存档案'}</ActionButton>
      </form>}
    </Modal>
  </>
}
