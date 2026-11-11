import { useEffect, useRef, useState } from 'react'
import { Alert, Drawer, Modal, Pagination, Tag } from 'antd'
import { Plus, RefreshCw } from 'lucide-react'
import { api, newId } from './api'
import type { Ctx } from './Admin'
import type { Row } from './types'
import { ActionButton, SelectInput, TextArea, TextInput } from './components/AdminControls'
import './customer-consumption.css'

type Record = { id:string;storeId:string;storeName:string;source:'WALLET'|'LEGACY'|'KU52';projectName:string;paidFen:number;businessAt:string;referenceNo:string;publicNote:string;accountLabel:string;balanceAfterFen:number|null;status:'RECORDED'|'REVERSED'|'VOIDED';version:number }
type Result = {items:Record[];total:number;pageSize:number}
const money=(fen:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(fen/100)
const consumptionTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})
const statusNames={RECORDED:'已登记',REVERSED:'已冲正',VOIDED:'已作废'}

export default function CustomerConsumption({ctx,customer,onClose}:{ctx:Ctx;customer:Row;onClose:()=>void}){
  const [data,setData]=useState<Result>({items:[],total:0,pageSize:20}),[page,setPage]=useState(1)
  const [store,setStore]=useState(ctx.store),[from,setFrom]=useState(''),[to,setTo]=useState('')
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[creating,setCreating]=useState(false),[voiding,setVoiding]=useState<Record|null>(null)
  const [busy,setBusy]=useState(false),[formError,setFormError]=useState(''),[locked,setLocked]=useState(false),[reason,setReason]=useState('')
  const [form,setForm]=useState({storeId:'',projectName:'',amount:'',businessAt:'',referenceNo:'',publicNote:''})
  const sequence=useRef(0),submission=useRef<{body:object}|null>(null),sending=useRef(false)
  async function load(){
    const seq=++sequence.current;setLoading(true)
    try{const result=await api<Result>(`/api/admin/customers/${customer.id}/consumption-records?`+new URLSearchParams({storeId:store,from,to,page:String(page)}));if(seq===sequence.current){setData(result);setError('')}}
    catch(cause){if(seq===sequence.current)setError((cause as Error).message)}finally{if(seq===sequence.current)setLoading(false)}
  }
  useEffect(()=>{setData({items:[],total:0,pageSize:20});void load();return()=>{sequence.current++}},[customer.id,store,from,to,page])
  function start(){submission.current=null;setLocked(false);setFormError('');setForm({storeId:ctx.me.hq?store||String(customer.storeId||''):ctx.me.storeId,projectName:'',amount:'',businessAt:'',referenceNo:'',publicNote:''});setCreating(true)}
  async function save(event:React.FormEvent){
    event.preventDefault();if(sending.current)return;sending.current=true;setBusy(true);setFormError('')
    try{
      if(!submission.current){
        if(!form.projectName.trim()||!form.referenceNo.trim()||!form.storeId||!form.businessAt)throw new Error('请核对门店、项目、原订单编号与消费时间。')
        submission.current={body:{...form,projectName:form.projectName.trim(),referenceNo:form.referenceNo.trim(),publicNote:form.publicNote.trim(),businessAt:new Date(form.businessAt+'+08:00').toISOString(),requestKey:newId()}}
      }
      setLocked(true)
      await api(`/api/admin/customers/${customer.id}/consumption-records`,{method:'POST',body:JSON.stringify(submission.current.body),timeoutMessage:'提交结果待核对，请先刷新消费记录；重试会沿用原提交标识。'})
      submission.current=null;setLocked(false);setCreating(false);if(page===1)await load();else setPage(1);ctx.notify('历史消费已补录，账户余额保持不变。')
    }catch(cause){setFormError((cause as Error).message)}finally{sending.current=false;setBusy(false)}
  }
  async function cancel(event:React.FormEvent){
    event.preventDefault();if(sending.current||!voiding)return;sending.current=true;setBusy(true);setFormError('')
    try{await api(`/api/admin/consumption-records/${voiding.id}/void`,{method:'POST',body:JSON.stringify({version:voiding.version,reason:reason.trim()})});setVoiding(null);await load();ctx.notify('历史记录已标记作废，原记录保留，余额保持不变。')}
    catch(cause){setFormError((cause as Error).message)}finally{sending.current=false;setBusy(false)}
  }
  const field=(key:keyof typeof form,value:string)=>setForm(previous=>({...previous,[key]:value}))
  return <Drawer open title={`${customer.name||'客户'} · 消费记录`} size={900} placement='right' rootClassName='customer-consumption-drawer' onClose={()=>{if(!busy)onClose()}} destroyOnHidden>
    <div className='consumption-admin-toolbar'><p>查看已登记的会员消费与已核对的原系统历史消费。</p><div className='button-row'><ActionButton type='button' className='a-secondary' disabled={loading} aria-label='刷新消费记录' onClick={()=>{void load()}}><RefreshCw size={15}/></ActionButton>{ctx.can('wallets:write')&&<ActionButton type='button' className='a-primary' onClick={start}><Plus size={15}/>补录历史消费</ActionButton>}</div></div>
    <Alert type='info' showIcon title='酷鼠历史明细分批迁移，当前列表不代表完整消费历史。补录历史消费不会扣减余额。新消费请在「会员余额 → 登记消费」中登记。'/>
    <div className='consumption-admin-filters'>{ctx.me.hq&&<label className='admin-field'><span>消费门店</span><SelectInput value={store} onChange={event=>{setStore(event.target.value);setPage(1)}}><option value=''>全部门店</option>{ctx.stores.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</SelectInput></label>}<label className='admin-field'><span>开始日期</span><TextInput type='date' value={from} max={to||undefined} onChange={event=>{setFrom(event.target.value);setPage(1)}}/></label><label className='admin-field'><span>结束日期</span><TextInput type='date' value={to} min={from||undefined} onChange={event=>{setTo(event.target.value);setPage(1)}}/></label></div>
    {error&&<Alert type='error' showIcon title={error}/>}
    {!loading&&!error&&!data.items.length&&<div className='data-empty'><h3>当前条件下暂无已登记的消费</h3><p>未显示不代表没有消费，请核对原系统明细是否已迁入。</p></div>}
    <div className='consumption-admin-records'>{data.items.map(item=><article key={item.id} className={`consumption-admin-record is-${item.status.toLowerCase()}`}><div className='consumption-admin-record-head'><div><Tag color={item.status==='RECORDED'?'success':'default'}>{statusNames[item.status]}</Tag><Tag>{item.source!=='WALLET'?'原系统消费':'会员储值消费'}</Tag></div><strong>{money(item.paidFen)}</strong></div><h3>{item.projectName||'会员消费（项目待核对）'}</h3><p>{item.storeName} · {consumptionTime(item.businessAt)}</p><p className='consumption-reference'>订单 / 凭证：{item.referenceNo}</p>{item.accountLabel&&<p>扣款账户：{item.accountLabel}{item.balanceAfterFen!==null&&` · 消费后余额 ${money(item.balanceAfterFen)}`}</p>}{item.publicNote&&<p>客户可见说明：{item.publicNote}</p>}{item.status==='REVERSED'&&<p>消费已冲正，原流水保留；当前余额请查看会员账户。</p>}{item.source==='LEGACY'&&item.status==='RECORDED'&&ctx.can('wallets:write')&&<ActionButton type='button' className='a-link' onClick={()=>{setReason('');setFormError('');setVoiding(item)}}>作废历史记录</ActionButton>}</article>)}</div>
    <Pagination current={page} total={data.total} pageSize={data.pageSize} showSizeChanger={false} onChange={setPage}/>
    <Modal open={creating} title='补录历史消费' centered footer={null} className='admin-modal' destroyOnHidden onCancel={()=>{if(!busy){setCreating(false);submission.current=null;setLocked(false);void load()}}}><form className='consumption-admin-form' onSubmit={save}>
      <Alert type='warning' showIcon title='仅补录已核对的原系统订单，不发起支付，不重复扣款。项目、金额、时间和说明将对客户展示。'/>
      <label className='admin-field'><span>消费所属门店</span><SelectInput required disabled={locked||!ctx.me.hq} value={form.storeId||(!ctx.me.hq?ctx.me.storeId:'')} onChange={event=>field('storeId',event.target.value)}><option value=''>请选择门店</option>{ctx.stores.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</SelectInput></label>
      <label className='admin-field'><span>消费项目（客户可见）</span><TextInput required maxLength={120} disabled={locked} value={form.projectName} onChange={event=>field('projectName',event.target.value)}/></label>
      <label className='admin-field'><span>历史消费金额（元）</span><TextInput required inputMode='decimal' maxLength={12} placeholder='0.00' disabled={locked} value={form.amount} onChange={event=>field('amount',event.target.value)}/></label>
      <label className='admin-field'><span>实际消费时间（北京时间）</span><TextInput type='datetime-local' required disabled={locked} value={form.businessAt} onChange={event=>field('businessAt',event.target.value)}/></label>
      <label className='admin-field'><span>原系统订单 / 凭证编号</span><TextInput required maxLength={100} disabled={locked} value={form.referenceNo} onChange={event=>field('referenceNo',event.target.value)}/></label>
      <label className='admin-field'><span>消费说明（客户可见，选填）</span><TextArea maxLength={300} disabled={locked} value={form.publicNote} onChange={event=>field('publicNote',event.target.value)}/></label>
      {formError&&<Alert type='error' showIcon title={formError}/>}<ActionButton className='a-primary' disabled={busy}>{busy?'正在保存…':locked?'使用原提交标识重试':'确认补录'}</ActionButton>
    </form></Modal>
    <Modal open={!!voiding} title='作废历史消费记录' centered footer={null} className='admin-modal' destroyOnHidden onCancel={()=>{if(!busy)setVoiding(null)}}><form className='consumption-admin-form' onSubmit={cancel}><Alert type='warning' showIcon title='原记录保留并向客户标注「已作废」，不会改变任何账户余额。'/><p>{voiding?.projectName} · {voiding&&money(voiding.paidFen)}</p><label className='admin-field'><span>作废原因（内部核对）</span><TextArea required maxLength={300} disabled={busy} value={reason} onChange={event=>setReason(event.target.value)}/></label>{formError&&<Alert type='error' showIcon title={formError}/>}<ActionButton className='a-danger' disabled={busy}>{busy?'正在保存…':'确认作废'}</ActionButton></form></Modal>
  </Drawer>
}
