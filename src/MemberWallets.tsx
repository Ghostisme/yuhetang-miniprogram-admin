import { useEffect, useRef, useState } from 'react'
import { Alert, Drawer, Modal, Pagination, Tag } from 'antd'
import { Plus, RefreshCw, Wallet } from 'lucide-react'
import { api, displayTime, newId } from './api'
import type { Ctx } from './Admin'
import type { Row } from './types'
import { ActionButton, SelectInput, TextArea, TextInput } from './components/AdminControls'
import './member-wallets.css'

type Account = { id:string;storeId:string;storeName:string;externalAccount:string;label:string;balanceFen:number;version:number;openingAsOf:string;updatedAt:string;source?:'KU52';cardNumber?:string;memberNumber?:string;validity?:string }
type Entry = { id:string;kind:string;deltaFen:number;balanceAfterFen:number;businessAt:string;referenceNo:string;note:string;operatorName:string;reversed:boolean;reversalOf:string|null;projectName?:string;publicNote?:string }
type Operation = { kind:'OPENING'|'RECHARGE'|'CONSUME'|'REVERSAL';account?:Account;entry?:Entry }
type WalletLookup = {accounts:Account[];lookupStatus?:'MEMBERSHIP_PENDING'|'MIGRATION_PENDING'|'AVAILABLE';memberVerified?:boolean;balanceKnown?:boolean;totalFen?:number|null;balanceScope?:'MIGRATED_ACCOUNTS_ONLY'|'LOCAL_AND_SOURCE_CARDS';sourceSync?:{enabled:boolean;state:string;lastSuccess?:string;stale?:boolean}}
const names:Record<string,string>={OPENING:'期初余额',RECHARGE:'充值登记',CONSUME:'消费登记',REVERSAL:'冲正'}
const money=(fen:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(fen/100)

export default function MemberWallets({ctx,customer,onClose}:{ctx:Ctx;customer:Row;onClose:()=>void}){
  const [accounts,setAccounts]=useState<Account[]>([]),[selected,setSelected]=useState(''),[entries,setEntries]=useState<Entry[]>([])
  const [lookup,setLookup]=useState<WalletLookup|null>(null)
  const [page,setPage]=useState(1),[total,setTotal]=useState(0),[error,setError]=useState(''),[loading,setLoading]=useState(false)
  const [op,setOp]=useState<Operation|null>(null),[busy,setBusy]=useState(false),[opError,setOpError]=useState('')
  const [form,setForm]=useState({storeId:ctx.store||'',externalAccount:'',label:'储值账户',amount:'',asOf:'',referenceNo:'',note:'',projectName:'',publicNote:''})
  const sequence=useRef(0),entrySequence=useRef(0),submission=useRef<{path:string;body:object}|null>(null)
  const [locked,setLocked]=useState(false)
  async function refresh(){
    const request=++sequence.current;setLoading(true)
    try{const data=await api<WalletLookup>(`/api/admin/customers/${customer.id}/wallets?`+new URLSearchParams({storeId:ctx.store}));if(sequence.current===request){setAccounts(data.accounts);setLookup(data);setSelected(previous=>data.accounts.some(a=>a.id===previous)?previous:data.accounts[0]?.id||'');setError('')}}
    catch(cause){if(sequence.current===request){setAccounts([]);setLookup(null);setSelected('');setEntries([]);setError((cause as Error).message)}}finally{if(sequence.current===request)setLoading(false)}
  }
  async function loadEntries(){
    const request=++entrySequence.current;if(!selected){setEntries([]);setTotal(0);return}
    try{const result=await api<{items:Entry[];total:number}>(`/api/admin/wallets/${selected}/entries?page=${page}`);if(request===entrySequence.current){setEntries(result.items);setTotal(result.total)}}catch(cause){if(request===entrySequence.current)setError((cause as Error).message)}
  }
  const account=accounts.find(a=>a.id===selected)
  const memberVerified=lookup?.memberVerified??customer.memberVerified===true
  useEffect(()=>{void refresh();return()=>{sequence.current++;entrySequence.current++}},[customer.id,ctx.store])
  useEffect(()=>{setEntries([]);void loadEntries();return()=>{entrySequence.current++}},[selected,page,account?.version])
  function start(operation:Operation){if(operation.account?.source==='KU52')return;submission.current=null;setLocked(false);setOpError('');setForm({storeId:operation.account?.storeId||ctx.store||'',externalAccount:'',label:'储值账户',amount:'',asOf:'',referenceNo:'',note:'',projectName:'',publicNote:''});setOp(operation)}
  async function save(event:React.FormEvent){
    event.preventDefault();if(busy||!op)return;setBusy(true);setOpError('')
    try{
      if(!submission.current){
        const referenceNo=form.referenceNo.trim(),note=form.note.trim()
        if(!referenceNo||!note)throw new Error('请填写原始凭证编号和核对说明。')
        if(op.kind==='OPENING'&&!form.asOf)throw new Error('请选择余额核对时间。')
        if(op.kind==='CONSUME'&&!form.projectName.trim())throw new Error('请填写客户可见的消费项目。')
        const requestKey=newId()
        const {projectName,publicNote,...openingForm}=form
        submission.current=op.kind==='OPENING'?{path:`/api/admin/customers/${customer.id}/wallets`,body:{...openingForm,asOf:new Date(form.asOf).toISOString(),referenceNo,note,requestKey}}:{path:`/api/admin/wallets/${op.account!.id}/entries`,body:{kind:op.kind,version:op.account!.version,...(op.kind==='REVERSAL'?{reversalOf:op.entry!.id}:{amount:form.amount}),...(op.kind==='CONSUME'?{projectName:projectName.trim(),publicNote:publicNote.trim()}:{}),referenceNo,note,requestKey}}
      }
      setLocked(true)
      const result=await api<{account:Account}>(submission.current.path,{method:'POST',body:JSON.stringify(submission.current.body),timeoutMessage:'提交结果待核对，请先查看流水；重试会沿用原提交标识。'})
      submission.current=null;setLocked(false);setOp(null);await refresh();setSelected(result.account.id);setPage(1);await loadEntries();ctx.notify('余额登记成功，已保留不可覆盖的流水。')
    }catch(cause){setOpError((cause as Error).message)}finally{setBusy(false)}
  }
  function field(key:keyof typeof form,value:string){setForm(previous=>({...previous,[key]:value}))}
  return <Drawer open title={`${customer.name||'客户'} · 会员余额`} placement='right' size={960} rootClassName='member-wallet-drawer' onClose={()=>{if(!busy)onClose()}} destroyOnHidden>
    <div className='member-wallet-toolbar'><p>账户按门店与原账户编号独立保存。期初金额须以旧系统核对后的实际余额为准。</p><div className='button-row'><ActionButton className='a-secondary' disabled={loading} aria-label='刷新会员余额' onClick={()=>{void refresh();void loadEntries()}}><RefreshCw size={15}/></ActionButton>{ctx.me.hq&&ctx.can('wallets:opening')&&<ActionButton className='a-primary' disabled={loading||!!error||!memberVerified} onClick={()=>start({kind:'OPENING'})}><Plus size={15}/>录入期初账户</ActionButton>}</div></div>
    {error&&<Alert type='error' showIcon title={error}/>}
    {lookup?.sourceSync?.enabled&&<Alert type={lookup.sourceSync.stale?'warning':'info'} showIcon title={lookup.sourceSync.lastSuccess?`原系统最近同步：${displayTime(lookup.sourceSync.lastSuccess)} · 状态 ${lookup.sourceSync.state}`:'原系统会员卡与消费记录正在等待后台同步。'} description='原系统卡只读；原卡完整迁入后请按相同门店和卡号录入期初账户，本地账户优先显示，不重复累计。'/>}
    {!loading&&!error&&<div className='member-wallet-migration'><Tag color={accounts.length?'success':'warning'}>{accounts.length?'已有可查询账户':memberVerified?'余额待迁移核对':'会员资料待核实'}</Tag>{!!accounts.length&&<p>{lookup?.balanceScope==='LOCAL_AND_SOURCE_CARDS'?'显示当前门店范围内已迁入账户与原系统同步卡，同一卡号不重复累计。':'仅显示当前门店范围内已迁入并核对的账户，未迁入的其他账户不计入余额。'}</p>}</div>}
    {!loading&&!accounts.length&&!error&&<div className='data-empty'><Wallet size={30}/><h3>{memberVerified?'余额账户尚未迁入':'请先核实会员资料'}</h3><p>{memberVerified?'会员身份已确认。请由总部核对酷鼠原账户、所属门店与截止时间后，录入期初余额。':'会员资料正在分批迁移，当前未核实不代表非会员。请先在客户档案核对并确认会员身份，再录入原账户余额。'}</p><p>未录入不代表余额为 0。客户可先绑定服务号，账户迁入后即可查询，无需重新绑定。</p></div>}
    <div className='member-wallet-accounts'>{accounts.map(item=><button type='button' className={`member-wallet-card ${selected===item.id?'is-selected':''}`} key={item.id} onClick={()=>{setSelected(item.id);setPage(1)}}><span>{item.storeName} · {item.label}</span><strong>{money(item.balanceFen)}</strong><small>{item.source==='KU52'?'原系统卡号':'原账户'}：{item.cardNumber||item.externalAccount}</small>{item.source==='KU52'&&<Tag>原系统同步 · 只读</Tag>}{item.validity&&<small>有效期：{item.validity}</small>}<small>更新 {displayTime(item.updatedAt)}</small></button>)}</div>
    {account&&<section className='member-wallet-ledger'><div className='member-wallet-toolbar'><div><h3>{account.storeName} · {account.label}</h3><p>余额核对起点：{displayTime(account.openingAsOf)}</p></div>{account.source!=='KU52'&&ctx.can('wallets:write')&&<div className='button-row'><ActionButton className='a-secondary' onClick={()=>start({kind:'RECHARGE',account})}>登记充值</ActionButton><ActionButton className='a-primary' onClick={()=>start({kind:'CONSUME',account})}>登记消费</ActionButton></div>}</div><Alert type='info' showIcon title={account.source==='KU52'?'原系统卡只读，消费详情请在客户档案的消费记录中查看。':'此处登记已核实的线下收付款，不发起微信支付，也不随预约自动扣款。'}/>
      <div className='member-wallet-entries'>{entries.map(entry=><article key={entry.id}><div className='member-wallet-entry-head'><div><Tag>{names[entry.kind]||entry.kind}</Tag><time>{displayTime(entry.businessAt)}</time></div><strong className={entry.deltaFen<0?'debit':'credit'}>{entry.deltaFen>0?'+':''}{money(entry.deltaFen)}</strong></div><p>余额 {money(entry.balanceAfterFen)} · 操作人 {entry.operatorName}</p><p>凭证 {entry.referenceNo}</p>{entry.projectName&&<p>消费项目：{entry.projectName}</p>}{entry.publicNote&&<p>客户可见说明：{entry.publicNote}</p>}<p>{entry.note}</p>{entry.reversed?<Tag>已冲正</Tag>:['RECHARGE','CONSUME'].includes(entry.kind)&&ctx.me.hq&&ctx.can('wallets:opening')&&<ActionButton className='a-link' onClick={()=>start({kind:'REVERSAL',account,entry})}>登记反向冲正</ActionButton>}</article>)}</div><Pagination current={page} total={total} pageSize={20} showSizeChanger={false} onChange={setPage}/></section>}
    <Modal open={!!op} title={op?names[op.kind]:''} centered footer={null} className='admin-modal' destroyOnHidden onCancel={()=>{if(!busy){setOp(null);submission.current=null;setLocked(false);void refresh();void loadEntries()}}}>
      {op&&<form className='member-wallet-form' onSubmit={save}>
        {op.kind==='OPENING'?<><label className='admin-field'><span>账户所属门店</span><SelectInput required disabled={locked} value={form.storeId} onChange={e=>field('storeId',e.target.value)}><option value=''>请选择门店</option>{ctx.stores.map(store=><option key={store.id} value={store.id}>{store.name}</option>)}</SelectInput></label><label className='admin-field'><span>原系统会员 / 卡账户唯一编号</span><TextInput required maxLength={100} disabled={locked} value={form.externalAccount} onChange={e=>field('externalAccount',e.target.value)}/></label><label className='admin-field'><span>客户看到的账户名称</span><TextInput required maxLength={80} disabled={locked} value={form.label} onChange={e=>field('label',e.target.value)}/></label><label className='admin-field'><span>余额核对时间</span><TextInput type='datetime-local' required disabled={locked} value={form.asOf} onChange={e=>field('asOf',e.target.value)}/></label></>:<p>{op.account?.storeName} · {op.account?.label} · 当前 {money(op.account!.balanceFen)}</p>}
        {op.kind==='REVERSAL'?<Alert type='warning' showIcon title={`将反向冲正 ${names[op.entry!.kind]} ${money(Math.abs(op.entry!.deltaFen))}，原流水继续保留。`}/>:<label className='admin-field'><span>{op.kind==='OPENING'?'已核对期初余额':'登记金额'}（元）</span><TextInput required inputMode='decimal' placeholder='0.00' maxLength={12} disabled={locked} value={form.amount} onChange={e=>field('amount',e.target.value)}/></label>}
        {op.kind==='CONSUME'&&<><label className='admin-field'><span>消费项目（客户可见）</span><TextInput required maxLength={120} placeholder='例如：中医推拿 60 分钟' disabled={locked} value={form.projectName} onChange={e=>field('projectName',e.target.value)}/></label><label className='admin-field'><span>消费说明（客户可见，选填）</span><TextArea maxLength={300} disabled={locked} value={form.publicNote} onChange={e=>field('publicNote',e.target.value)}/></label></>}
        <label className='admin-field'><span>原始凭证 / 订单编号</span><TextInput required maxLength={100} disabled={locked} value={form.referenceNo} onChange={e=>field('referenceNo',e.target.value)}/></label><label className='admin-field'><span>核对说明（仅后台可见）</span><TextArea required maxLength={300} disabled={locked} value={form.note} onChange={e=>field('note',e.target.value)}/></label>
        {opError&&<Alert type='error' showIcon title={opError}/>}<ActionButton className='a-primary' disabled={busy}>{busy?'正在登记…':locked?'使用原提交标识重试':'确认登记'}</ActionButton>{locked&&!busy&&<p>为避免重复入账，重试保留原凭证与金额。需要修改时请关闭弹窗，先刷新并核对流水。</p>}
      </form>}
    </Modal>
  </Drawer>
}
