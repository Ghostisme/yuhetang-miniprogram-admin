import {useEffect,useRef,useState} from 'react'
import {Tag} from 'antd'
import type {Ctx} from './Admin'
import type {Appointment,ReservationPayment} from './types'
import {api,newId} from './api'
import {ActionButton,SelectInput,TextInput} from './components/AdminControls'
import './payment-reservation.css'

const labels:Record<string,string>={UNPRICED:'待门店核价',RESERVED:'已登记结算意向',CLOSED:'结算预留已关闭'}
const yuan=(fen:number|null)=>fen==null?'':(fen/100).toFixed(2)
export default function PaymentReservation({ctx,appointment:b}:{ctx:Ctx;appointment:Appointment}){
  const [payment,setPayment]=useState<ReservationPayment|null>(null),[amount,setAmount]=useState(''),[channel,setChannel]=useState('UNSELECTED')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true)
  const submission=useRef({body:'',key:''}),inflight=useRef(false)
  const writable=ctx.can('payments:write')&&payment?.status!=='CLOSED'&&!['CANCELLED','NO_SHOW'].includes(b.status)
  const balanceAvailable=!!b.membership?.memberVerified&&!!b.membership.memberStoreId
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setPayment(null);setError('');submission.current={body:'',key:''}
    api<ReservationPayment>(`/api/admin/appointments/${encodeURIComponent(b.id)}/payment`,{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted){setPayment(value);setAmount(yuan(value.amountFen));setChannel(value.channel)}})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message)})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>controller.abort()
  },[b.id,b.version,revision])
  async function save(){
    if(inflight.current||!payment||!writable)return
    const text=amount.trim();let amountFen:number|null=null
    if(text){
      if(!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)){setError('金额请填写元，最多两位小数。');return}
      const [whole,fraction='']=text.split('.');amountFen=Number(whole)*100+Number(fraction.padEnd(2,'0'))
      if(amountFen<1||amountFen>999999999){setError('金额范围为 0.01 至 9999999.99 元。');return}
    }
    const body=JSON.stringify({amountFen,channel,version:payment.version,appointmentVersion:b.version})
    if(submission.current.body!==body)submission.current={body,key:newId()}
    inflight.current=true;setBusy(true);setError('')
    try{
      const value=await api<ReservationPayment>(`/api/admin/appointments/${encodeURIComponent(b.id)}/payment`,{method:'PUT',headers:{'Idempotency-Key':submission.current.key},body})
      setPayment(value);setAmount(yuan(value.amountFen));setChannel(value.channel);submission.current={body:'',key:''}
      ctx.notify('结算意向已登记，未发起支付或扣减储值。')
    }catch(cause){setError((cause as Error).message)}finally{inflight.current=false;setBusy(false)}
  }
  return <section className='payment-reservation' aria-label='结算预留'>
    <header><h4>结算预留</h4><Tag color='default'>未开通支付</Tag></header>
    <p>本次按{b.storeName}的项目核价。当前只登记金额和结算方式，不扣储值、不发起微信支付。</p>
    {loading?<p>正在读取结算预留…</p>:payment&&<>
      <Tag>{labels[payment.status]||payment.status}</Tag>
      <div className='payment-reservation-fields'>
        <label className='admin-field'><span>门店确认总金额（元）</span><TextInput aria-label='门店确认总金额' inputMode='decimal' placeholder='待核价，可暂留空' maxLength={10} value={amount} disabled={!writable||busy} onChange={event=>setAmount(event.target.value)}/></label>
        <label className='admin-field'><span>后续结算方式</span><SelectInput aria-label='后续结算方式' value={channel} disabled={!writable||busy} onChange={event=>setChannel(event.target.value)}><option value='UNSELECTED'>待确认</option><option value='MEMBER_BALANCE' disabled={!balanceAvailable}>会员储值（预留）</option><option value='WECHAT_PAY'>微信支付（预留）</option></SelectInput></label>
      </div>
      {channel==='MEMBER_BALANCE'&&b.membership?.crossStore&&<p className='payment-reservation-note'>会员归属：{b.membership.memberStoreName}；接待：{b.storeName}。跨店储值分摊与划账规则待配置。</p>}
      {!balanceAvailable&&<p>核实会员身份及归属门店后，才可登记会员储值结算。</p>}
      {writable&&<ActionButton className='a-secondary' disabled={busy} onClick={()=>void save()}>{busy?'正在保存…':'保存结算意向'}</ActionButton>}
    </>}
    {error&&<div role='alert' className='appointment-error'>{error}<ActionButton className='a-link' disabled={busy} onClick={()=>setRevision(value=>value+1)}>重新读取结算资料</ActionButton></div>}
  </section>
}
