import {useEffect,useRef,useState} from 'react'
import {Bell,ChevronLeft,ChevronRight,MessageCircle,RefreshCw,Smartphone} from 'lucide-react'
import {api,displayTime} from './api'
import type {Ctx} from './Admin'
import type {Page,Row} from './types'
import {desktopEnabled,setDesktopEnabled} from './desktop-notifications'
import './notifications.css'

const channelNames:Row={PC:'PC端消息',WECHAT:'微信个人消息',SMS:'短信'}
const delivery:Row={AVAILABLE:'已进入后台消息',CANCELLED:'已停止发送',PENDING:'待发送',RETRY:'等待重试',SENDING:'发送中',ACCEPTED:'接口已受理',BLOCKED:'未发送 / 条件未满足',FAILED:'发送失败',UNKNOWN:'发送结果待核实'}

export default function Notifications({ctx}:{ctx:Ctx}){
  const store=ctx.me.hq?ctx.store:ctx.me.storeId,canWrite=ctx.can('notifications:write')
  const [data,setData]=useState<Page<Row>>({items:[],total:0}),[page,setPage]=useState(1),[channel,setChannel]=useState(''),[status,setStatus]=useState(''),[refresh,setRefresh]=useState(0)
  const [config,setConfig]=useState<Row|null>(null),[draft,setDraft]=useState<Row>({}),[users,setUsers]=useState<Row[]>([]),[user,setUser]=useState(''),[binding,setBinding]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false)
  const [browser,setBrowser]=useState('Notification'in window?Notification.permission:'unsupported'),[desktop,setDesktop]=useState(desktopEnabled(ctx.me.id))
  const alive=useRef(true),request=useRef(0)
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  function applyConfig(next:Row){setConfig(next);setDraft(next.channels);setUser(next.recipient?.adminUserId||'');setDirty(false)}
  useEffect(()=>{
    let current=true
    if(!store)return
    api<Row>(`/api/admin/notifications/config?storeId=${encodeURIComponent(store)}`).then(r=>{if(current)applyConfig(r)}).catch(e=>{if(current)setError(e.message)})
    return()=>{current=false}
  },[store])
  useEffect(()=>{
    let current=true
    if(store&&canWrite){
      if(ctx.can('users:read'))api<Row[]>('/api/admin/users').then(r=>{if(current)setUsers(r)}).catch(e=>{if(current)setError(e.message)})
      else setUsers([{id:ctx.me.id,displayName:ctx.me.name,username:'本人',enabled:true,storeId:ctx.me.storeId}])
    }
    return()=>{current=false}
  },[store,canWrite])
  useEffect(()=>{
    let current=true,timer:ReturnType<typeof setTimeout>
    async function poll(){
      if(document.hidden){timer=setTimeout(()=>void poll(),15000);return}
      const seq=++request.current
      try{
        const q=new URLSearchParams({storeId:store,page:String(page),channel,status})
        const next=await api<Page<Row>>(`/api/admin/notifications?${q}`)
        if(current&&seq===request.current)setData(next)
      }catch(e){if(current&&seq===request.current)setError((e as Error).message)}
      if(current)timer=setTimeout(()=>void poll(),30000+Math.random()*5000)
    }
    setData({items:[],total:0});void poll()
    return()=>{current=false;request.current++;clearTimeout(timer)}
  },[store,page,channel,status,refresh])
  function edit(key:string,value:unknown){setDraft(v=>({...v,[key]:value}));setDirty(true)}
  async function save(){
    setBusy(true);setError('')
    try{
      const next=await api<Row>('/api/admin/notifications/config',{method:'PUT',body:JSON.stringify(draft)})
      if(alive.current){applyConfig(next);setRefresh(v=>v+1);ctx.notify('本店三类通知设置已保存。')}
    }catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setBusy(false)}
  }
  async function bind(remove=false){
    setBusy(true);setError('')
    try{
      const result=await api<Row>(remove?`/api/admin/notifications/binding/${store}`:'/api/admin/notifications/binding',{method:remove?'DELETE':'POST',...(!remove?{body:JSON.stringify({storeId:store,adminUserId:user})}:{})})
      if(!alive.current)return
      setBinding(remove?'':result.url)
      const next=await api<Row>(`/api/admin/notifications/config?storeId=${store}`)
      if(alive.current){setConfig(next);if(remove)ctx.notify('原微信接收人已解绑。')}
    }catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setBusy(false)}
  }
  async function enableDesktop(){
    try{
      if(!('Notification'in window))return
      const permission=await Notification.requestPermission();setBrowser(permission)
      if(permission==='granted'){
        setDesktopEnabled(ctx.me.id,true);setDesktop(true)
        new Notification('裕和堂 · PC端通知测试',{body:'后台开启时，将按本账号权限提醒新预约和客户消息。',tag:'yht-notification-test'})
      }
    }catch(e){setError((e as Error).message)}
  }
  const disabled=!store||!canWrite||!config||busy
  function toggle(label:string,key:string){return <label className="toggle-field"><input type="checkbox" checked={!!draft[key]} disabled={disabled} onChange={e=>edit(key,e.target.checked)}/><span>{label}</span></label>}
  const storeName=ctx.stores.find(s=>s.id===store)?.name
  return <>
    <div className="notification-scope"><p>{store?`${storeName} · 本店通知设置`:'当前显示全部门店记录，请在右上角选择门店配置渠道。'}</p>{store&&canWrite&&<button className="a-primary" disabled={disabled||!dirty} onClick={()=>void save()}>{busy?'正在保存…':'保存本店通知设置'}</button>}{store&&!canWrite&&<span className="field-note">当前为查看权限，通知配置由总部授权。</span>}</div>
    <div className="notification-channel-grid">
      <section className="ops-card notification-channel" aria-label="PC端消息通知">
        <div className="card-heading"><div><h3>PC端消息通知</h3><p>后台消息中心 + 电脑桌面提醒</p></div><Bell size={22}/></div>
        <fieldset>{toggle('本店预约生成 PC 消息','pcEnabled')}</fieldset>
        <p className="field-note">新预约、状态变化及待确认超时进入后台消息；客户咨询在“客户沟通”中接待。</p>
        <div className="connection-status"><i className={browser==='granted'&&desktop?'online':''}/>{browser==='unsupported'?'此浏览器不支持桌面提醒':browser==='denied'?'浏览器已拒绝，请在网站设置中授权':browser==='granted'?(desktop?'本账号桌面提醒已开启':'本账号桌面提醒已关闭'):'浏览器尚未授权'}</div>
        <label className="toggle-field"><input type="checkbox" disabled={browser==='unsupported'} checked={desktop} onChange={e=>{setDesktop(e.target.checked);setDesktopEnabled(ctx.me.id,e.target.checked)}}/><span>本账号在此浏览器显示桌面提醒</span></label>
        <button className="a-secondary" disabled={browser==='unsupported'} onClick={()=>void enableDesktop()}>开启 / 测试桌面提醒</button>
        <p className="field-note">请保持后台、浏览器和电脑开启。桌面开关仅保存在当前浏览器；正式站点使用 HTTPS。</p>
      </section>
      <section className="ops-card notification-channel" aria-label="微信个人消息通知">
        <div className="card-heading"><div><h3>微信个人消息通知</h3><p>门店人员提醒 + 客户订阅提醒</p></div><MessageCircle size={22}/></div>
        <fieldset>{toggle('门店接收人微信提醒','wechatStaffEnabled')}{toggle('预约客户微信订阅提醒','wechatCustomerEnabled')}</fieldset>
        {store&&config?<>
          <div className="tag-row"><span>{config.serviceConfigured?'服务号凭证已配置':'待配置服务号凭证'}</span><span>{config.serviceTemplateConfigured?'门店模板已配置':'待配置门店模板'}</span><span>{config.customerTemplateConfigured?'客户处理模板已配置':'待配置客户处理模板'}</span><span>{config.customerReminderTemplateConfigured?'到店提醒模板已配置':'待配置到店提醒模板'}</span><span>{config.recipient?.bound?'接收人已绑定':'接收人未绑定'}</span></div>
          {canWrite&&<><label className="admin-field"><span>本店微信接收账号（每店一位）</span><select aria-label="门店消息接收账号" value={user} disabled={busy} onChange={e=>setUser(e.target.value)}><option value="">请选择本门店账号</option>{users.filter(u=>u.enabled&&u.storeId===store).map(u=><option value={u.id} key={u.id}>{u.displayName}（{u.username}）</option>)}</select></label><div className="button-row"><button className="a-secondary" disabled={busy||!user||!config.serviceConfigured} onClick={()=>void bind()}>生成微信绑定链接</button><button className="a-link" disabled={busy||!config.recipient?.adminUserId} onClick={()=>void bind(true)}>解绑接收人</button></div></>}
          {binding&&<div className="binding-link"><p>请本人 15 分钟内在微信打开并确认绑定。</p><textarea aria-label="微信绑定链接" readOnly value={binding}/><button className="a-link" onClick={()=>navigator.clipboard.writeText(binding).then(()=>ctx.notify('绑定链接已复制。')).catch(e=>setError(e.message))}>复制绑定链接</button></div>}
        </>:<p className="field-note">{store?'正在加载微信接收设置…':'选择门店后查看绑定与模板状态。'}</p>}
        <p className="field-note">门店人员通过关注的认证服务号接收；客户需在小程序同意订阅。小程序原生客服对话仍在“客户沟通”接待。</p>
      </section>
      <section className="ops-card notification-channel" aria-label="短信通知">
        <div className="card-heading"><div><h3>短信通知</h3><p>腾讯云短信 · 按门店单独启用</p></div><Smartphone size={22}/></div>
        <fieldset>{toggle('门店接收人短信提醒','smsStaffEnabled')}{toggle('预约客户短信提醒','smsCustomerEnabled')}
          <label className="admin-field"><span>门店短信接收手机号</span><input aria-label="门店短信接收手机号" type="tel" inputMode="numeric" maxLength={11} value={canWrite?(draft.smsPhone||''):(draft.smsPhoneMasked||'')} disabled={disabled} placeholder="填写本店接收人手机号" onChange={e=>edit('smsPhone',e.target.value)}/></label>
        </fieldset>
        {store&&config&&<><div className="tag-row"><span>{config.smsConfigured?'短信凭证已配置':'待配置短信凭证'}</span><span>{!config.smsStaffIssue?'门店模板可用':'门店模板待就绪'}</span><span>{!config.smsCustomerIssue?'客户模板可用':'客户模板待就绪'}</span></div>{config.smsStaffIssue&&<p className="field-note">门店：{config.smsStaffIssue}</p>}{config.smsCustomerIssue&&<p className="field-note">客户：{config.smsCustomerIssue}</p>}</>}
        <p className="field-note">门店短信接收预约处理提醒；客户短信发送至预约填写的手机号，用于确认、驳回、取消、改期和到店提醒。默认关闭。</p>
        <p className="field-note">“接口已受理”表示平台接单，实际送达以短信平台回执为准。修改本店通知设置后，原待发短信会停止发送。</p>
      </section>
    </div>
    {error&&<div className="admin-error" role="alert">{error}</div>}
    <section className="ops-card notification-records">
      <div className="card-heading"><div><h3>消息通知记录</h3><p>三类渠道统一查询，每 15 秒更新发送状态。</p></div><button className="a-link" onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={14}/>刷新记录</button></div>
      <div className="notification-filters"><div className="notification-channel-tabs" role="group" aria-label="通知渠道筛选">{[['','全部通知'],['PC','PC端消息'],['WECHAT','微信个人消息'],['SMS','短信']].map(([value,label])=><button className={channel===value?'active':''} aria-pressed={channel===value} key={value} onClick={()=>{setChannel(value);setPage(1)}}>{label}</button>)}</div><select aria-label="通知发送状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">全部发送状态</option>{Object.entries(delivery).map(([value,label])=><option key={value} value={value}>{String(label)}</option>)}</select></div>
      {data.items.length?<div className="table-scroll"><table className="ops-table"><thead><tr><th>时间 / 预约号</th><th>渠道 / 接收对象</th><th>事件</th><th>结果</th><th>说明</th></tr></thead><tbody>{data.items.map(r=><tr key={r.id}><td>{displayTime(r.createdAt)}<small>{r.appointmentId}</small></td><td><span className={`notification-channel-tag ${r.channelGroup}`}>{channelNames[r.channelGroup]||r.channel}</span><small>{r.audience}</small></td><td>{r.eventLabel}</td><td><span className={`status-tag ${['AVAILABLE','ACCEPTED'].includes(r.deliveryStatus)?'CONFIRMED':'PENDING'}`}>{delivery[r.deliveryStatus]||r.deliveryStatus}</span></td><td className="wrap-cell">{r.lastError||'—'}<small>尝试 {r.attempts} 次{r.providerMessageId?` · 平台流水 ${r.providerMessageId}`:''}</small></td></tr>)}</tbody></table></div>:<div className="data-empty"><Bell size={28}/><p>暂无符合条件的通知记录</p></div>}
      <div className="pager"><span>共 {data.total} 条记录</span><button aria-label="上一页通知" disabled={page<=1} onClick={()=>setPage(v=>v-1)}><ChevronLeft size={15}/></button><span>{page} / {Math.max(1,Math.ceil(data.total/30))}</span><button aria-label="下一页通知" disabled={page*30>=data.total} onClick={()=>setPage(v=>v+1)}><ChevronRight size={15}/></button></div>
    </section>
  </>
}
