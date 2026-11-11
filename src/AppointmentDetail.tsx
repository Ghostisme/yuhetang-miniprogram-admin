import {useEffect,useState} from 'react'
import {Modal,Tag} from 'antd'
import {RefreshCw} from 'lucide-react'
import type {Ctx} from './Admin'
import type {Appointment,Slots,Therapist} from './types'
import {api,claimLabels,dateInput,displayTime,statusLabels} from './api'
import {ActionButton,SelectInput,TextArea,TextInput} from './components/AdminControls'
import './appointment-detail.css'
import PaymentReservation from './PaymentReservation'

const sources:Record<string,string>={MINIPROGRAM:'小程序',PHONE:'电话',WECHAT:'微信',DIANPING:'大众点评',WALKIN:'到店'}
function Status({status}:{status:string}){return <Tag color={status==='CONFIRMED'?'success':status==='PENDING'?'warning':'default'}>{statusLabels[status]||status}</Tag>}

export default function AppointmentDetail({ctx,appointment:b,onClose,onUpdate}:{ctx:Ctx;appointment:Appointment;onClose:()=>void;onUpdate:(b:Appointment)=>void}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[phone,setPhone]=useState('')
  const [teacher,setTeacher]=useState(b.assignedTherapistId||''),[teachers,setTeachers]=useState<Therapist[]>([])
  const [date,setDate]=useState(b.bookingDate),[time,setTime]=useState(''),[slots,setSlots]=useState<Slots|null>(null)
  const request=b.rescheduleRequest,pending=request?.status==='PENDING'&&!!request.canReview
  const canAdjust=ctx.can('appointments:write')&&ctx.can('appointments:review')&&['PENDING','CONFIRMED'].includes(b.status)&&!pending
  useEffect(()=>{let live=true;setTeachers([]);if(ctx.can('therapists:read'))api<Therapist[]>(`/api/admin/therapists?storeId=${b.storeId}`).then(rows=>live&&setTeachers(rows.filter(t=>t.storeId===b.storeId))).catch(e=>live&&setError(e.message));return()=>{live=false}},[b.storeId])
  useEffect(()=>{setTeacher(b.assignedTherapistId||'');setDate(b.bookingDate);setTime('');setPhone('')},[b.id,b.version])
  useEffect(()=>{let live=true;setSlots(null);if(canAdjust)api<Slots>(`/api/admin/appointments/${encodeURIComponent(b.id)}/slots?date=${date}`).then(r=>live&&setSlots(r)).catch(e=>live&&setError(e.message));return()=>{live=false}},[date,b.id,b.version,canAdjust])
  async function refresh(){onUpdate(await api<Appointment>(`/api/admin/appointments/${encodeURIComponent(b.id)}`))}
  async function action(action:string){
    if(busy)return
    if(action==='reject_reschedule'&&!note.trim()){setError('请填写未通过原因，客户将继续保留原预约。');return}
    if(['cancel','reject'].includes(action)&&!window.confirm('确认取消 / 拒绝此预约？客户将看到处理原因。'))return
    setBusy(true);setError('')
    try{
      const next=await api<Appointment>(`/api/admin/appointments/${encodeURIComponent(b.id)}`,{method:'PATCH',body:JSON.stringify({action,version:b.version,note,assignedTherapistId:teacher,date,startTime:time})})
      onUpdate(next);setNote('');ctx.notify(action==='approve_reschedule'?'改约已确认，新时间已生效。':action==='reject_reschedule'?'已告知客户未通过原因，原预约保留。':'预约已更新，客户可查看最新状态。')
    }catch(e){setError((e as Error).message);try{await refresh()}catch{/* Keep the original failure visible. */}}
    finally{setBusy(false)}
  }
  return <Modal open centered title="预约详情与处理" onCancel={onClose} footer={null} width={1040} destroyOnHidden className="admin-modal appointment-detail">
    <div className="detail-status"><Status status={b.status}/><span>{b.id}</span><ActionButton aria-label="刷新预约详情" disabled={busy} onClick={()=>refresh().catch(e=>setError(e.message))}><RefreshCw size={15}/></ActionButton></div>
    <div className="appointment-mobile-summary"><h3>{b.customerName} · {b.serviceName}</h3><p>{b.storeName} · {b.bookingDate} {b.startTime} · {b.headcount} 人同行</p></div>
    <div className="detail-grid">
      <div className="appointment-facts"><h3>{b.customerName} · {b.serviceName}</h3><p className="appointment-current-time">{b.storeName}<br/>{b.bookingDate} {b.startTime} · {b.headcount} 人同行</p>
        <dl><dt>联系电话</dt><dd className="appointment-contact"><span>{phone||b.phone}</span>{ctx.can('appointments:phone')&&!phone&&<ActionButton className="a-link" onClick={()=>api(`/api/admin/appointments/${encodeURIComponent(b.id)}/phone`).then(r=>setPhone(r.phone)).catch(e=>setError(e.message))}>查看完整电话（留痕）</ActionButton>}</dd>
          <dt>意向调理师</dt><dd>{b.therapistIntentName} · 以门店安排为准</dd><dt>实际分配</dt><dd>{b.assignedTherapistName}</dd>
          <dt>会员核实</dt><dd>{b.membership?.memberVerified?<><Tag color='gold'>{b.membership.memberGrade||'会员'}</Tag>{b.membership.crossStore&&<Tag color='green'>会员跨店预约</Tag>}</>:b.membership?.status==='LEGACY_UNKNOWN'?'历史记录未核实':'非会员 / 尚未核实'}</dd>
          {b.membership?.memberVerified&&<><dt>会员归属门店</dt><dd>{b.membership.memberStoreName||'待总部确认'}</dd><dt>本次接待门店</dt><dd>{b.storeName}</dd></>}
          <dt>会员 / 到店自述</dt><dd>{claimLabels[b.memberClaim]} / {claimLabels[b.visitedClaim]}（本人自述）</dd><dt>客户备注</dt><dd>{b.remark||'未填写'}</dd><dt>预约来源</dt><dd>{sources[b.source]||b.source}</dd>
        </dl>
        {request&&<section className={`reschedule-review ${pending?'is-pending':''}`} aria-label="客户改约申请">
          <header><h4>客户改约申请</h4><Tag color={pending?'warning':'default'}>{request.statusLabel}</Tag></header>
          <div className="reschedule-comparison"><div><span>原预约</span><strong>{request.originalDate} {request.originalTime}</strong><small>{request.originalHeadcount} 人</small></div><div><span>申请调整至</span><strong>{request.requestedDate} {request.requestedTime}</strong><small>{request.requestedHeadcount} 人</small></div></div>
          {request.requestNote&&<p>客户说明：{request.requestNote}</p>}
          {pending?<><p>处理前保留原预约；新时段将在确认时重新核对名额。</p><p>处理期限：{displayTime(request.expiresAt)}</p></>:<p>{request.resolutionNote||'请以当前预约时间和状态为准。'}</p>}
        </section>}
        {ctx.can('payments:read')&&<PaymentReservation ctx={ctx} appointment={b}/>}
      </div>
      <div className="detail-actions"><h4>门店处理</h4><TextArea aria-label="处理说明" value={note} onChange={e=>setNote(e.target.value)} maxLength={500} placeholder={pending?'未通过改约时，请填写原因；原预约会保留':'处理说明 / 无法接待原因 / 本店跟进备注'}/>
        {pending&&ctx.can('appointments:review')&&<div className="reschedule-review-actions"><ActionButton disabled={busy} className="a-primary" onClick={()=>void action('approve_reschedule')}>确认改约并通知客户</ActionButton><ActionButton disabled={busy} className="a-secondary" onClick={()=>void action('reject_reschedule')}>改约未通过，保留原预约</ActionButton></div>}
        <div className="button-row">{b.status==='PENDING'&&!pending&&ctx.can('appointments:review')&&<><ActionButton disabled={busy} className="a-primary" onClick={()=>void action('confirm')}>确认接待</ActionButton><ActionButton disabled={busy} className="a-danger" onClick={()=>void action('reject')}>拒绝并说明原因</ActionButton></>}
          {b.status==='CONFIRMED'&&ctx.can('appointments:status')&&<><ActionButton disabled={busy} className="a-primary" onClick={()=>void action('arrive')}>标记已到店</ActionButton><ActionButton disabled={busy} className="a-secondary" onClick={()=>void action('noshow')}>标记未到店</ActionButton></>}
          {b.status==='ARRIVED'&&ctx.can('appointments:status')&&<ActionButton disabled={busy} className="a-primary" onClick={()=>void action('complete')}>完成服务</ActionButton>}
          {['PENDING','CONFIRMED','ARRIVED'].includes(b.status)&&ctx.can('appointments:write')&&<ActionButton disabled={busy} className="a-danger" onClick={()=>void action('cancel')}>取消预约</ActionButton>}
          {ctx.can('appointments:write')&&<ActionButton disabled={busy} className="a-secondary" onClick={()=>void action('note')}>添加内部跟进</ActionButton>}
        </div>
        {ctx.can('appointments:write')&&['PENDING','CONFIRMED','ARRIVED'].includes(b.status)&&<section className="appointment-action-section" aria-label="人员分配"><label className="admin-field"><span>分配实际接待调理师</span><SelectInput aria-label="实际调理师" value={teacher} onChange={e=>setTeacher(e.target.value)}><option value="">请选择</option>{teachers.filter(t=>t.enabled&&t.serviceIds.includes(b.serviceId)).map(t=><option value={t.id} key={t.id}>{t.name}{t.resting?'（休息）':''}</option>)}</SelectInput></label><p className="field-note">仅可分配{b.storeName}的调理师。</p><ActionButton className="a-secondary" disabled={busy||!teacher} onClick={()=>void action('assign')}>保存人员分配</ActionButton></section>}
        {canAdjust&&<section className="appointment-action-section" aria-label="门店直接调整并确认"><h4>门店直接调整并确认</h4><div className="form-columns appointment-reschedule-fields"><label className="admin-field"><span>调整日期</span><TextInput aria-label="后台改约日期" type="date" min={dateInput()} max={dateInput(slots?.rules.advanceDays||7)} value={date} onChange={e=>{setDate(e.target.value);setTime('')}}/></label><label className="admin-field"><span>调整时段</span><SelectInput aria-label="后台改约时段" value={time} onChange={e=>setTime(e.target.value)}><option value="">选择时段</option>{slots?.slots.filter(s=>s.available&&s.remaining>=b.headcount).map(s=><option key={s.time}>{s.time}</option>)}</SelectInput></label></div><p className="field-note">先与客户确认。保存时重新核对名额，新时间直接生效。</p><ActionButton disabled={busy||!time} className="a-secondary" onClick={()=>void action('reschedule')}>调整并确认新时间</ActionButton></section>}
      </div>
    </div>
    {error&&<div className="appointment-error" role="alert">{error}</div>}
    <h4 className="section-label">处理记录 · 内部留痕</h4><div className="history-list">{b.history?.map(h=><div key={h.id}><i/><div><strong>{h.operatorName} <Status status={h.status}/></strong><p>{h.note}</p><small>{displayTime(h.createdAt)}</small></div></div>)}</div>
  </Modal>
}
