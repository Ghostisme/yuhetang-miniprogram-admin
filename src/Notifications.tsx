import ResponsiveTable from './components/ResponsiveTable'
import {ActionButton,TextInput,SelectInput,TextArea,DisabledFieldset} from './components/AdminControls'
import {Pagination} from 'antd'
import {useEffect,useRef,useState} from 'react'
import {Bell,ChevronLeft,ChevronRight,MessageCircle,RefreshCw,Smartphone} from 'lucide-react'
import {api,displayTime} from './api'
import type {Ctx} from './Admin'
import type {Page,Row} from './types'
import {desktopEnabled,setDesktopEnabled} from './desktop-notifications'
import InboxMessages from './InboxMessages'
import './notifications.css'

const channelNames:Row={PC:'PC端消息',WECHAT:'微信个人消息',SMS:'短信'}
const delivery:Row={AVAILABLE:'已进入后台消息',CANCELLED:'已停止发送',PENDING:'待发送',RETRY:'等待重试',SENDING:'发送中',ACCEPTED:'接口已受理',BLOCKED:'未发送 / 条件未满足',FAILED:'发送失败',UNKNOWN:'发送结果待核实'}

export default function Notifications({ctx}:{ctx:Ctx}){
  const store=ctx.me.hq?ctx.store:ctx.me.storeId,canWrite=ctx.can('notifications:write')
  const [audience,setAudience]=useState('STAFF'),[readiness,setReadiness]=useState<Row|null>(null),[checking,setChecking]=useState(false),[connection,setConnection]=useState<Row|null>(null)
  const [data,setData]=useState<Page<Row>>({items:[],total:0}),[page,setPage]=useState(1),[channel,setChannel]=useState(''),[status,setStatus]=useState(''),[refresh,setRefresh]=useState(0)
  const [config,setConfig]=useState<Row|null>(null),[draft,setDraft]=useState<Row>({}),[users,setUsers]=useState<Row[]>([]),[user,setUser]=useState(''),[binding,setBinding]=useState('')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false)
  const [browser,setBrowser]=useState('Notification'in window?Notification.permission:'unsupported'),[desktop,setDesktop]=useState(desktopEnabled(ctx.me.id))
  const alive=useRef(true),request=useRef(0)
  useEffect(()=>{alive.current=true;api<Row>('/api/admin/notifications/readiness').then(r=>{if(alive.current)setReadiness(r)}).catch(e=>{if(alive.current)setError(e.message)});return()=>{alive.current=false}},[])
  function applyConfig(next:Row){setConfig(next);setDraft(next.channels);setUser(next.recipient?.adminUserId||'');setDirty(false)}
  useEffect(()=>{
    let current=true
    setConfig(null);setBinding('');setDirty(false)
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
        const q=new URLSearchParams({storeId:store,page:String(page),channel,status,audience})
        const next=await api<Page<Row>>(`/api/admin/notifications?${q}`)
        if(current&&seq===request.current)setData(next)
      }catch(e){if(current&&seq===request.current)setError((e as Error).message)}
      if(current)timer=setTimeout(()=>void poll(),30000+Math.random()*5000)
    }
    setData({items:[],total:0});void poll()
    return()=>{current=false;request.current++;clearTimeout(timer)}
  },[store,page,channel,status,audience,refresh])
  function edit(key:string,value:unknown){setDraft(v=>({...v,[key]:value}));setDirty(true)}
  async function save(){
    setBusy(true);setError('')
    try{
      const next=await api<Row>('/api/admin/notifications/config',{method:'PUT',body:JSON.stringify(draft)})
      if(alive.current){applyConfig(next);setRefresh(v=>v+1);ctx.notify('本店客户与后台通知设置已保存。')}
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
  async function checkWechat(){
    setChecking(true);setError('');setConnection(null)
    try{const result=await api<Row>('/api/admin/notifications/wechat/check',{method:'POST',body:JSON.stringify({audience})});if(alive.current)setConnection(result)}
    catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setChecking(false)}
  }
  async function refreshBinding(){
    if(!store||busy)return
    setBusy(true);setError('')
    try{
      const next=await api<Row>(`/api/admin/notifications/config?storeId=${encodeURIComponent(store)}`)
      if(alive.current){setConfig(next);ctx.notify(next.recipient?.bound?'本店微信接收人已确认绑定。':'本店微信接收人尚未完成确认绑定。')}
    }catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setBusy(false)}
  }
  const disabled=!store||!canWrite||!config||busy
  function toggle(label:string,key:string){return <label className="toggle-field"><TextInput type="checkbox" checked={!!draft[key]} disabled={disabled} onChange={e=>edit(key,e.target.checked)}/><span>{label}</span></label>}
  const storeName=ctx.stores.find(s=>s.id===store)?.name
  const customerTemplates:Row[]=readiness?.customer.templates||[]
  const staffIssues:string[]=readiness?.staff.issues||[]
  const audienceName=audience==='CUSTOMER'?'客户':'管理后台'
  return <>
    <div className="notification-audiences" role="group" aria-label="消息接收对象">
      {[['CUSTOMER','客户消息推送','预约处理 · 到店提醒'],['STAFF','管理后台消息推送','站内消息 · 桌面提醒 · 门店人员']].map(([value,label,note])=><ActionButton layout="card" disabled={checking} aria-pressed={audience===value} className={audience===value?'active':''} key={value} onClick={()=>{setAudience(value);setConnection(null);setError('');setPage(1);setChannel('');setStatus('')}}><strong>{label}</strong><small>{note}</small></ActionButton>)}
    </div>
    <div className="notification-scope"><p>{store?`${storeName} · 本店${audienceName}通知设置`:'当前显示全部门店记录；请在右上角选择门店，设置各渠道开关。'}</p>{store&&canWrite&&<ActionButton className="a-primary" disabled={disabled||!dirty} onClick={()=>void save()}>{busy?'正在保存…':'保存本店通知设置'}</ActionButton>}{store&&!canWrite&&<span className="field-note">当前为查看权限，通知配置由总部授权。</span>}</div>
    <div className="notification-check"><div><strong>微信配置检查</strong><p>连接微信核对当前账号的模板与字段，不发送真实消息。</p></div>{canWrite&&<ActionButton className="a-secondary" disabled={checking} onClick={()=>void checkWechat()}>{checking?'正在检查微信…':`检查${audience==='CUSTOMER'?'客户小程序':'店长服务号'}配置`}</ActionButton>}{!canWrite&&<small>由有通知配置权限的账号执行检查。</small>}</div>
    {connection&&<div className="notification-check-result" role="status"><strong>{connection.ready?'微信凭证与模板检查通过':'微信凭证可用，部分模板仍需配置'}</strong>{connection.templates.map((t:Row)=><p key={t.title}>{t.title}：{t.ready?'模板及字段匹配':t.issue}</p>)}<small>{connection.message}</small></div>}
    {audience==='CUSTOMER'?<div className="notification-channel-grid customer-channels">
      <section className="ops-card notification-channel" aria-label="客户小程序订阅消息">
        <div className="card-heading"><div><h3>客户小程序订阅消息</h3><p>通过微信小程序发送给预约客户</p></div><MessageCircle size={22}/></div>
        {toggle('预约客户微信订阅提醒','wechatCustomerEnabled')}
        <div className="subscription-template-list">{customerTemplates.map(t=><div className="subscription-template" key={t.kind}><div><strong>{t.title}</strong><span className={`readiness-tag ${t.ready?'ready':''}`}>{t.ready?'发送配置已就绪':'待配置'}</span></div><p>{t.kind==='result'?'门店确认、驳回、取消或改期后发送。':'门店确认后，按门店“到店前提醒分钟”发送。'}</p><code>{t.templateId||'尚未设置模板 ID'}</code>{t.issue&&<p className="configuration-issue">{t.issue}</p>}</div>)}</div>
        {!readiness&&<p className="field-note">正在读取服务器模板配置…</p>}
        <p className="field-note">客户点击提交预约或改约时，将触发微信原生订阅授权；“我的预约”不再提供独立订阅按钮。两个一次性模板分别授权，拒绝订阅不影响预约。</p>
        <div className="admin-note">发送结果在管理后台的客户消息记录中查看。接口受理后仍以客户微信实际收到为准。</div>
      </section>
      <section className="ops-card notification-channel" aria-label="客户短信提醒">
        <div className="card-heading"><div><h3>客户短信提醒</h3><p>发送至本次预约填写的手机号</p></div><Smartphone size={22}/></div>
        {toggle('预约客户短信提醒','smsCustomerEnabled')}
        <div className="connection-status"><i className={readiness?.sms.configured&&!readiness.sms.customerIssue?'online':''}/>{readiness?.sms.configured&&!readiness.sms.customerIssue?'短信发送配置已就绪':'短信渠道待配置'}</div>
        {readiness?.sms.customerIssue&&<p className="field-note">{readiness.sms.customerIssue}</p>}
        <p className="field-note">用于确认、驳回、取消、改期和到店提醒。短信与微信按门店开关分别发送；默认关闭短信。</p>
      </section>
    </div>:<>
      <InboxMessages ctx={ctx}/>
      <div className="notification-channel-grid">
        <section className="ops-card notification-channel" aria-label="PC端消息通知">
          <div className="card-heading"><div><h3>PC端消息通知</h3><p>后台铃铛 + 本账号站内消息 + 桌面提醒</p></div><Bell size={22}/></div>
          {toggle('本店预约生成 PC 消息','pcEnabled')}
          <p className="field-note">新预约、状态变化和待确认超时进入后台；点击通知可查看对应预约。客户新咨询单独显示未读数量。</p>
          <div className="connection-status"><i className={browser==='granted'&&desktop?'online':''}/>{browser==='unsupported'?'此浏览器不支持桌面提醒':browser==='denied'?'浏览器已拒绝，请在网站设置中授权':browser==='granted'?(desktop?'本账号桌面提醒已开启':'本账号桌面提醒已关闭'):'浏览器尚未授权'}</div>
          <label className="toggle-field"><TextInput type="checkbox" disabled={browser==='unsupported'} checked={desktop} onChange={e=>{setDesktop(e.target.checked);setDesktopEnabled(ctx.me.id,e.target.checked)}}/><span>本账号在此浏览器显示桌面提醒</span></label>
          <ActionButton className="a-secondary" disabled={browser==='unsupported'} onClick={()=>void enableDesktop()}>开启 / 测试桌面提醒</ActionButton>
          <p className="field-note">切换标签页后继续检查新消息。请保持后台、浏览器和电脑开启；电脑休眠或浏览器关闭后，通过店长微信或短信接收提醒。</p>
        </section>
        <section className="ops-card notification-channel" aria-label="店长微信提醒">
          <div className="card-heading"><div><h3>店长微信提醒</h3><p>认证服务号模板消息 · 每店一位接收人</p></div><MessageCircle size={22}/></div>
          {toggle('门店接收人微信提醒','wechatStaffEnabled')}
          <div className="connection-status"><i className={readiness?.staff.ready&&config?.recipient?.bound?'online':''}/>{readiness?.staff.ready?(config?.recipient?.bound?'本店微信接收人已绑定':'请选择门店并绑定接收人'):'服务号发送配置待完成'}</div>
          {staffIssues.map(issue=><p className="field-note" key={issue}>{issue}</p>)}
          {store&&config?<>
            <ActionButton className="a-link" disabled={busy} onClick={()=>void refreshBinding()}><RefreshCw size={14}/>刷新绑定状态</ActionButton>
            {canWrite&&<><label className="admin-field"><span>本店微信接收账号</span><SelectInput aria-label="门店消息接收账号" value={user} disabled={busy} onChange={e=>setUser(e.target.value)}><option value="">请选择本门店账号</option>{users.filter(u=>u.enabled&&u.storeId===store).map(u=><option value={u.id} key={u.id}>{u.displayName}（{u.username}）</option>)}</SelectInput></label><div className="button-row"><ActionButton className="a-secondary" disabled={busy||!user||!config.serviceConfigured} onClick={()=>void bind()}>生成微信绑定链接</ActionButton><ActionButton className="a-link" disabled={busy||!config.recipient?.adminUserId} onClick={()=>void bind(true)}>解绑接收人</ActionButton></div></>}
            {binding&&<div className="binding-link"><p>请本人 15 分钟内在微信打开、关注服务号并确认绑定。</p><TextArea aria-label="微信绑定链接" readOnly value={binding}/><ActionButton className="a-link" onClick={()=>navigator.clipboard.writeText(binding).then(()=>ctx.notify('绑定链接已复制。')).catch(e=>setError(e.message))}>复制绑定链接</ActionButton></div>}
          </>:<p className="field-note">选择门店后查看绑定状态与接收账号。</p>}
          <p className="field-note">当前“待接单提醒”用于新预约和待确认超时。已处理的预约停止旧待接单提醒；其余状态变化保留在 PC 消息。更换接收人后，待发消息不会转给新人员。</p>
        </section>
        <section className="ops-card notification-channel" aria-label="门店短信通知">
          <div className="card-heading"><div><h3>门店短信通知</h3><p>腾讯云短信 · 按门店单独启用</p></div><Smartphone size={22}/></div>
          {toggle('门店接收人短信提醒','smsStaffEnabled')}
          <label className="admin-field"><span>门店短信接收手机号</span><TextInput aria-label="门店短信接收手机号" type="tel" inputMode="numeric" maxLength={11} value={canWrite?(draft.smsPhone||''):(draft.smsPhoneMasked||'')} disabled={disabled} placeholder="填写本店接收人手机号" onChange={e=>edit('smsPhone',e.target.value)}/></label>
          <div className="connection-status"><i className={readiness?.sms.configured&&!readiness.sms.staffIssue?'online':''}/>{readiness?.sms.configured&&!readiness.sms.staffIssue?'短信发送配置已就绪':'短信渠道待配置'}</div>
          {readiness?.sms.staffIssue&&<p className="field-note">{readiness.sms.staffIssue}</p>}
          <p className="field-note">后台关闭后，已启用的门店微信和短信仍由服务器发送。修改本店通知设置后，旧的待发短信会停止发送。</p>
        </section>
      </div>
    </>}
    {error&&<div className="admin-error" role="alert">{error}</div>}
    <section className="ops-card notification-records">
      <div className="card-heading"><div><h3>{audienceName}通知记录</h3><p>每 30 秒更新；“已受理”表示平台接受请求，“结果待核实”暂停自动重发。</p></div><ActionButton className="a-link" onClick={()=>setRefresh(v=>v+1)}><RefreshCw size={14}/>刷新记录</ActionButton></div>
      <div className="notification-filters"><div className="notification-channel-tabs" role="group" aria-label="通知渠道筛选">{[['','全部通知'],...(audience==='STAFF'?[['PC','PC端消息']]:[]),['WECHAT','微信消息'],['SMS','短信']].map(([value,label])=><ActionButton className={channel===value?'active':''} aria-pressed={channel===value} key={value} onClick={()=>{setChannel(value);setPage(1)}}>{label}</ActionButton>)}</div><SelectInput aria-label="通知发送状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">全部发送状态</option>{Object.entries(delivery).map(([value,label])=><option key={value} value={value}>{String(label)}</option>)}</SelectInput></div>
      {data.items.length?<div className="table-scroll"><ResponsiveTable className="ops-table"><thead><tr><th>时间 / 预约号</th><th>渠道 / 接收对象</th><th>事件</th><th>结果</th><th>说明</th></tr></thead><tbody>{data.items.map(r=><tr key={r.id}><td>{displayTime(r.createdAt)}<small>{r.appointmentId}</small></td><td><span className={`notification-channel-tag ${r.channelGroup}`}>{r.channel==='SUBSCRIBE'?'小程序订阅消息':r.channel==='SERVICE'?'服务号模板消息':channelNames[r.channelGroup]||r.channel}</span><small>{r.audience}</small></td><td>{r.eventLabel}</td><td><span className={`status-tag ${['AVAILABLE','ACCEPTED'].includes(r.deliveryStatus)?'CONFIRMED':'PENDING'}`}>{delivery[r.deliveryStatus]||r.deliveryStatus}</span></td><td className="wrap-cell">{r.lastError||'—'}<small>尝试 {r.attempts} 次{r.providerMessageId?` · 平台流水 ${r.providerMessageId}`:''}</small></td></tr>)}</tbody></ResponsiveTable></div>:<div className="data-empty"><Bell size={28}/><p>暂无符合条件的{audienceName}通知记录</p></div>}
      <div className="pager"><Pagination current={page} pageSize={30} total={data.total} showSizeChanger={false} showTotal={total=>`共 ${total} 条记录`} onChange={setPage}/></div>
    </section>
  </>
}
