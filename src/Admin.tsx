import {startPolling} from './polling'
import {useEffect,useLayoutEffect,useRef,useState,type ReactNode,type TextareaHTMLAttributes} from 'react'
import {Bell,CalendarDays,Check,ChevronLeft,ChevronRight,Download,ExternalLink,Image,LayoutDashboard,Leaf,LogOut,MapPin,MessageCircle,Palette,Plus,RefreshCw,Search,Settings,ShieldCheck,SlidersHorizontal,Users,UserRound,X} from 'lucide-react'
import {api,claimLabels,clone,dateInput,displayTime,newId,statusLabels} from './api'
import type {AdminIdentity,Appointment,Page,Row,Rules,Site,Slots,StoreItem,Therapist,ServiceItem} from './types'
import MiniProgram,{Brand} from './MiniProgram'
import ChatInbox from './ChatInbox'
import Notifications from './Notifications'
import Imports from './DataImports'
import {DianpingIntegration,DianpingOrders} from './Dianping'
import {desktopAllowed} from './desktop-notifications'
import './store-scope.css'
import {moduleAllowed,togglePermission,type Permission} from './rbac'

export type Ctx={me:AdminIdentity;stores:StoreItem[];store:string;setStore:(s:string)=>void;refreshStores:()=>Promise<void>;can:(p:string)=>boolean;notify:(s:string)=>void}
const sourceLabels:Row={MINIPROGRAM:'小程序',PHONE:'电话',WECHAT:'微信',DIANPING:'大众点评',WALKIN:'到店'}
const friendlyError=(e:unknown)=>(e as Error).message
const post=(path:string,body:unknown,method='PUT')=>api(path,{method,body:JSON.stringify(body)})
function Badge({status}:{status:string}){return <span className={`status-tag ${status}`}>{statusLabels[status]||status}</span>}
function Empty({text='暂无数据'}:{text?:string}){return <div className="data-empty"><Leaf size={30} strokeWidth={1.2}/><p>{text}</p></div>}
function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}){return <label className={`admin-field${wide?' field-wide':''}`}><span>{label}</span>{children}</label>}
function AutoTextarea(props:TextareaHTMLAttributes<HTMLTextAreaElement>){
  const ref=useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(()=>{
    const node=ref.current
    if(!node)return
    const resize=()=>{
      node.style.height='0px'
      const style=getComputedStyle(node)
      node.style.height=`${node.scrollHeight+parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth)}px`
    }
    resize()
    let width=node.clientWidth
    const observer=new ResizeObserver(()=>{if(node.clientWidth!==width){width=node.clientWidth;resize()}})
    observer.observe(node)
    return()=>observer.disconnect()
  },[props.value,props.rows])
  return <textarea {...props} rows={props.rows??2} ref={ref} className={`auto-textarea ${props.className||''}`}/>
}
function Toggle({label,value,onChange,disabled=false}:{label:string;value:boolean;onChange:(v:boolean)=>void;disabled?:boolean}){return <label className="toggle-field"><input type="checkbox" disabled={disabled} checked={!!value} onChange={e=>onChange(e.target.checked)}/><span>{label}</span></label>}
function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){return <div className="dialog-backdrop" onClick={onClose}><section className={`admin-dialog ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><header><div><span className="eyebrow">YU HE TANG · OPERATIONS</span><h2>{title}</h2></div><button aria-label="关闭" onClick={onClose}><X size={20}/></button></header>{children}</section></div>}
function Pager({page,total,size=20,onChange}:{page:number;total:number;size?:number;onChange:(p:number)=>void}){return <div className="pager"><span>共 {total} 条记录</span><button disabled={page<=1} onClick={()=>onChange(page-1)}><ChevronLeft size={15}/></button><span>{page} / {Math.max(1,Math.ceil(total/size))}</span><button disabled={page*size>=total} onClick={()=>onChange(page+1)}><ChevronRight size={15}/></button></div>}
function ErrorLine({error}:{error:string}){return error?<div className="admin-error" role="alert">{error}</div>:null}
function StoreSelect({ctx,value,onChange,all=false}:{ctx:Ctx;value:string;onChange:(s:string)=>void;all?:boolean}){return <select aria-label="门店范围" value={value} onChange={e=>onChange(e.target.value)}>{all&&ctx.me.hq&&<option value="">全部门店</option>}{ctx.stores.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select>}

const adminMenus=[['dashboard','工作台','dashboard:read',LayoutDashboard],['appointments','预约管理','appointments:read',CalendarDays],['customers','客户档案','customers:read',Users],['therapists','调理师管理','therapists:read',UserRound],['chats','客户沟通','chat:read',MessageCircle],['stores','门店与时段','stores:write',MapPin],['content','品牌与内容','content:read',Palette],['assets','图片素材','assets:read',Image],['users','用户管理','users:read',Users],['roles','角色与权限','roles:read',ShieldCheck],['notifications','消息中心','notifications:read',Bell],['imports','资料导入','imports:write',Download],['audit','操作日志','audit:read',SlidersHorizontal],['integrations','扩展与配置','integrations:read',Settings]] as const

export default function Admin(){
  const [me,setMe]=useState<AdminIdentity|null>(null),[stores,setStores]=useState<StoreItem[]>([]),[store,setStore]=useState(''),[tab,setTab]=useState('dashboard'),[error,setError]=useState(''),[toast,setToast]=useState(''),[loading,setLoading]=useState(true),[login,setLogin]=useState({username:'',password:''}),[busy,setBusy]=useState(false),[inbox,setInbox]=useState<Row[]>([]),[showInbox,setShowInbox]=useState(false)
  const [runtime,setRuntime]=useState<Row>({}),[chatUnread,setChatUnread]=useState(0)
  const workArea=useRef<HTMLElement>(null)
  const activeTab=useRef(tab);activeTab.current=tab
  useLayoutEffect(()=>{workArea.current?.scrollTo({top:0,left:0})},[tab,store])
  async function refreshStores(){setStores(await api<StoreItem[]>('/api/admin/stores'))}
  async function load(){if(!sessionStorage.getItem('yht-admin-token')){setLoading(false);return}try{const m=await api<AdminIdentity>('/api/admin/me');setMe(m);setStores(await api('/api/admin/stores'));setStore(m.hq?'':m.storeId);setTab(adminMenus.find(([id,,permission])=>moduleAllowed(id,permission,p=>m.permissions.includes(p)))?.[0]||'none')}catch(e){sessionStorage.removeItem('yht-admin-token');setMe(null)}finally{setLoading(false)}}
  useEffect(()=>{void load();api('/api/runtime').then(setRuntime).catch(()=>{});const f=()=>{setMe(null);setError('登录已失效，请重新登录。')};window.addEventListener('yht-session-expired',f);return()=>window.removeEventListener('yht-session-expired',f)},[])
  useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(t)},[toast])
  useEffect(()=>{
    setChatUnread(0)
    if(!me?.permissions.includes('chat:read'))return
    let alive=true,previous:number|null=null,timer:ReturnType<typeof setTimeout>
    async function poll(){
      if(document.hidden){timer=setTimeout(()=>void poll(),10000);return}
      try{
        const result=await api<{unreadTotal:number}>('/api/admin/chats')
        if(!alive)return
        setChatUnread(result.unreadTotal)
        if(previous!==null&&result.unreadTotal>previous&&activeTab.current!=='chats'&&desktopAllowed(me!.id)){
          const notice=new Notification('裕和堂 · 新客户咨询',{body:'有新的客户消息，请进入客户沟通接待。',tag:'yht-customer-chat',icon:'/favicon.svg'})
          notice.onclick=()=>{window.focus();setTab('chats')}
        }
        previous=result.unreadTotal
      }catch{/* 会话失效由 api 统一处理 */}
      if(alive)timer=setTimeout(poll,15000+Math.random()*3000)
    }
    void poll()
    return()=>{alive=false;clearTimeout(timer)}
  },[me?.id])
  useEffect(()=>{if(!me?.permissions.includes('notifications:read'))return;let current=true,first=true,seen=new Set<string>();async function poll(){try{const rows=await api<Row[]>('/api/admin/inbox');if(!current)return;setInbox(rows);if(!first)for(const row of rows){if(!seen.has(row.id)&&desktopAllowed(me!.id)){const n=new Notification('裕和堂 · 门店预约提醒',{body:`${row.payload.storeName} · ${row.payload.serviceName}\n${row.payload.time} · 请进入后台处理`,tag:row.id,icon:'/favicon.svg'});n.onclick=()=>{window.focus();setTab(me?.permissions.includes('appointments:read')?'appointments':'notifications')}}}first=false;seen=new Set(rows.map(r=>r.id))}catch{/* 会话失效由 api 统一处理 */}}const stop=startPolling(poll,15000);return()=>{current=false;stop()}},[me?.id])
  async function signIn(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await post('/api/admin/login',login,'POST');sessionStorage.setItem('yht-admin-token',r.token);await load()}catch(e){setError(friendlyError(e))}finally{setBusy(false)}}
  if(loading)return <div className="loading-screen">正在核对登录权限…</div>
  if(!me)return <div className="admin-login"><div className="login-art"><Brand/><div><span>CARE, WITH EVERY DETAIL.</span><h1>让每一次到来<br/>都被用心关照。</h1><p>裕和堂 · 品牌与门店管理中心</p></div><small>预约管理 / 内容配置 / 门店协同</small></div><form onSubmit={signIn}><span className="eyebrow">WELCOME BACK</span><h2>欢迎回来</h2><p>使用分配给您的账号，开启今日的接待工作。</p><Field label="管理账号"><input autoComplete="username" required value={login.username} onChange={e=>setLogin({...login,username:e.target.value})} placeholder="请输入账号"/></Field><Field label="登录密码"><input autoComplete="current-password" required type="password" value={login.password} onChange={e=>setLogin({...login,password:e.target.value})} placeholder="请输入密码"/></Field><ErrorLine error={error}/><button className="a-primary" disabled={busy}>{busy?'正在登录…':'登录管理后台'}</button><a href="/" target="_blank" rel="noreferrer">查看客户预约页面 <ExternalLink size={13}/></a>{runtime.developmentLogin&&<details className="dev-accounts"><summary>本地联调账号</summary><p>总部 admin / 余姚店 yuyao / 百乐门店 bailemen / 余姚前台 frontdesk<br/>统一密码 Yht@9800dev（仅本地环境）</p></details>}</form></div>
  const can=(p:string)=>me.permissions.includes(p),ctx:Ctx={me,stores,store,setStore,refreshStores,can,notify:setToast}

  const menus=adminMenus.filter(([id,,permission])=>moduleAllowed(id,permission,can))
  const viewTab=menus.some(m=>m[0]===tab)?tab:'none'
  const title=menus.find(x=>x[0]===viewTab)?.[1]||'管理中心'
  return <div className="operations"><aside className="ops-sidebar"><div className="ops-brand"><Brand small/><span>门店运营管理中心</span></div><nav>{menus.map(([id,label,,Icon])=><button className={viewTab===id?'active':''} aria-label={label} title={label} onClick={()=>setTab(id)} key={id}><Icon size={18}/><span>{label}</span>{id==='appointments'&&<i>预约</i>}{id==='chats'&&chatUnread>0&&<i className="chat-unread" aria-label={`${chatUnread}条未读客户消息`}>{chatUnread>99?'99+':chatUnread}</i>}</button>)}</nav><div className="ops-side-footer"><ShieldCheck size={16}/><div><strong>{me.hq?'总部管理空间':'本店管理空间'}</strong><span>{me.hq?'品牌全部门店':stores.find(s=>s.id===me.storeId)?.name}</span></div></div></aside><div className="ops-body"><header className="ops-topbar"><span>裕和堂 / {title}</span><div><a href="/" target="_blank" rel="noreferrer">客户小程序预览 <ExternalLink size={13}/></a><button className="bell-button" aria-label="站内消息" onClick={()=>setShowInbox(!showInbox)}><Bell size={19}/>{(inbox.length>0||chatUnread>0)&&<i/>}</button><span className="user-avatar">{me.name.slice(0,1)}</span><div className="current-user"><strong>{me.name}</strong><span>{me.hq?'总部管理员':'门店授权账号'}</span></div><button aria-label="退出登录" onClick={()=>{sessionStorage.removeItem('yht-admin-token');setMe(null);setInbox([])}}><LogOut size={17}/></button></div></header><main ref={workArea} className="ops-main" data-page={viewTab}><div className="ops-page-heading"><div><span className="eyebrow">YU HE TANG · STORE OPERATIONS</span><h1>{title}</h1><p>{viewTab==='dashboard'?'把每一份预约意向，变成被认真照顾的到店体验。':viewTab==='appointments'?'先确认，再到店。每一次处理都有记录可查。':'清晰管理每一处细节，让门店接待更从容。'}</p></div>{['dashboard','appointments','customers','therapists','notifications','stores','content'].includes(viewTab)&&<div className="scope-control"><MapPin size={15}/><StoreSelect ctx={ctx} value={store} all onChange={setStore}/></div>}</div>
  {viewTab==='none'&&<section className="ops-card"><Empty text="当前账号尚未分配可用模块，请联系总部管理员配置角色权限。"/></section>}
  {viewTab==='dashboard'&&<Dashboard key={me.id+':'+store} ctx={ctx} onAppointments={()=>can('appointments:read')?setTab('appointments'):setToast('当前账号没有预约管理权限，请联系总部管理员。')}/>}
  {viewTab==='appointments'&&<Appointments key={me.id+':'+store} ctx={ctx}/>}
  {viewTab==='customers'&&<Customers key={me.id+':'+store} ctx={ctx}/>}
  {viewTab==='therapists'&&<Therapists key={me.id+':'+store} ctx={ctx}/>}
  {viewTab==='chats'&&<ChatInbox ctx={ctx}/>}
  {viewTab==='stores'&&<StoreSettings ctx={ctx}/>}
  {viewTab==='content'&&<ContentEditor key={me.id+':'+store} ctx={ctx}/>}
  {viewTab==='users'&&<UsersEditor ctx={ctx}/>}
  {viewTab==='roles'&&<RolesEditor ctx={ctx}/>}
  {viewTab==='notifications'&&<Notifications key={me.id+':'+store} ctx={ctx}/>}
  {viewTab==='assets'&&<Assets ctx={ctx}/>}
  {viewTab==='imports'&&<Imports ctx={ctx}/>}
  {viewTab==='audit'&&<Audit ctx={ctx}/>}
  {viewTab==='integrations'&&<Integrations ctx={ctx}/>}
  </main><footer className="ops-footer"><span>裕和堂 · 用心关照每一次到来</span><span>预约服务管理系统 1.0</span></footer></div>{toast&&<div className="ops-toast" role="status"><Check size={17}/>{toast}</div>}{showInbox&&<div className="inbox-popover"><header><h3>门店消息</h3><button aria-label="关闭消息" onClick={()=>setShowInbox(false)}><X size={17}/></button></header>{chatUnread>0&&<button className="chat-inbox-link" onClick={()=>{setTab('chats');setShowInbox(false)}}><strong>客户咨询 · {chatUnread} 条未读消息</strong><p>进入客户沟通接待 →</p></button>}{inbox.length?inbox.map(row=><button key={row.id} onClick={()=>{setTab(can('appointments:read')?'appointments':'notifications');setShowInbox(false)}}><strong>{row.payload.storeName} · {row.payload.serviceName}</strong><p>{row.payload.time} · {row.payload.status}</p><small>{displayTime(row.createdAt)}</small></button>):chatUnread===0?<Empty text="暂无消息"/>:null}</div>}</div>
}

function Dashboard({ctx,onAppointments}:{ctx:Ctx;onAppointments:()=>void}){
  const [data,setData]=useState<Row|null>(null),[error,setError]=useState('')
  useEffect(()=>{let alive=true;setData(null);setError('');const refresh=()=>api(`/api/admin/dashboard?storeId=${ctx.store}`).then(d=>{if(alive){setData(d);setError('')}}).catch(e=>alive&&setError(e.message));const stop=startPolling(refresh,30000);return()=>{alive=false;stop()}},[ctx.store])
  if(!data)return <><ErrorLine error={error}/><Empty text="正在加载真实预约数据…"/></>
  const count=(s:string)=>data.counts.find((c:Row)=>c.status===s)?.total||0,total=data.counts.reduce((n:number,c:Row)=>n+c.total,0),max=Math.max(1,...data.trend.map((r:Row)=>r.count))
  return <><div className="dashboard-welcome"><div><span>GOOD CARE STARTS HERE</span><h2>让用心接待，有迹可循。</h2><p>今日门店安排，从待确认预约开始。</p><button onClick={onAppointments}>处理预约申请 <ChevronRight size={15}/></button></div><img src="/media/store-07.webp" alt="门店茶席"/><span className="welcome-seal">和</span></div><div className="stat-grid">{[['预约申请总数',total,'全部已收录预约'],['待人工确认',count('PENDING'),'请及时联系客户'],['已确认接待',count('CONFIRMED'),'留意到店与老师安排'],['服务已完成',count('COMPLETED'),'每一次关照都有记录']].map(([name,note,sub],i)=><button key={name} className={`stat-card stat-${i}`} onClick={onAppointments}><span>{name}</span><strong>{note}<small>笔</small></strong><p>{sub}</p><CalendarDays size={24}/></button>)}</div><div className="dashboard-columns"><section className="ops-card trend-card"><div className="card-heading"><div><h3>近 7 天预约申请</h3><p>按申请提交时间统计 · 真实业务数据</p></div><span>最近一周</span></div><div className="trend-bars">{data.trend.map((r:Row)=><div key={r.date}><b>{r.count}</b><i style={{height:`${Math.max(3,r.count/max*120)}px`}}/><span>{r.date.slice(5)}</span></div>)}</div></section><section className="ops-card source-card"><div className="card-heading"><div><h3>预约来源</h3><p>线上与前台代约统一记录</p></div></div>{data.sources.length?data.sources.map((r:Row)=><div className="source-row" key={r.source}><span>{sourceLabels[r.source]||r.source}</span><div><i style={{width:`${r.total/Math.max(total,1)*100}%`}}/></div><b>{r.total}</b></div>):<Empty text="预约产生后将显示来源分布"/>}</section></div><section className="ops-card"><div className="card-heading"><div><h3>最近预约申请</h3><p>客户刚刚提交的意向，在这里接住。</p></div><button className="a-link" onClick={onAppointments}>查看全部 <ChevronRight size={14}/></button></div><AppointmentTable rows={data.recent} onOpen={onAppointments}/></section></>
}
function AppointmentTable({rows,onOpen}:{rows:Appointment[];onOpen:(b:Appointment)=>void}){return rows.length?<div className="table-scroll"><table className="ops-table"><thead><tr><th>客户 / 联系方式</th><th>预约项目 / 门店</th><th>到店时间 / 人数</th><th>调理师意向</th><th>预约状态</th><th>操作</th></tr></thead><tbody>{rows.map(b=><tr key={b.id}><td><strong>{b.customerName}</strong><small>{b.phone}</small></td><td><strong>{b.serviceName}</strong><small>{b.storeName} · {sourceLabels[b.source]}</small></td><td><strong>{b.bookingDate}　{b.startTime}</strong><small>{b.headcount} 人同行</small></td><td><strong>{b.therapistIntentName}</strong><small>实际：{b.assignedTherapistName}</small></td><td><Badge status={b.status}/><small>会员自述：{claimLabels[b.memberClaim]}</small></td><td><button className="a-link" onClick={()=>onOpen(b)}>查看处理 <ChevronRight size={13}/></button></td></tr>)}</tbody></table></div>:<Empty text="当前筛选范围没有预约申请"/>}
function Appointments({ctx}:{ctx:Ctx}){
  const [page,setPage]=useState(1),[status,setStatus]=useState(''),[search,setSearch]=useState(''),[date,setDate]=useState(''),[calendar,setCalendar]=useState(false),[dianping,setDianping]=useState(false),[data,setData]=useState<Page<Appointment>>({items:[],total:0}),[error,setError]=useState(''),[selected,setSelected]=useState<Appointment|null>(null),[manual,setManual]=useState(false),[revision,setRevision]=useState(0)
  const requestVersion=useRef(0)
  async function refresh(){const request=++requestVersion.current;try{const next=await api<Page<Appointment>>(`/api/admin/appointments?${new URLSearchParams({storeId:ctx.store,status,search,from:date,to:date,page:String(page),pageSize:calendar?'100':'20'})}`);if(request===requestVersion.current){setData(next);setError('')}}catch(e){if(request===requestVersion.current)setError(friendlyError(e))}}
  useEffect(()=>{setData({items:[],total:0});setError('');const stop=startPolling(refresh,30000);return()=>{requestVersion.current++;stop()}},[ctx.store,status,search,date,page,revision,calendar])
  useEffect(()=>{setPage(1);setSelected(null);setManual(false)},[ctx.store])
  useEffect(()=>setPage(1),[status,search,date,calendar])
  if(dianping)return <><section className="ops-card"><div className="segmented"><button onClick={()=>{setDianping(false);setCalendar(false)}}>预约列表</button><button onClick={()=>{setDianping(false);setCalendar(true);setDate(date||dateInput())}}>当日时段视图</button><button className="active">大众点评订单</button></div></section><DianpingOrders key={ctx.store} ctx={ctx} onOpen={booking=>{setDianping(false);setCalendar(false);setSelected(booking);setRevision(v=>v+1)}}/></>
  return <><div className="review-banner"><ClockSymbol/><p><strong>小程序提交 = 待门店人工确认</strong><span>核对名额与接待安排后，再向客户确认。意向调理师与会员自述均需门店核实。</span></p></div><section className="ops-card"><div className="card-heading"><div className="segmented"><button className={!calendar?'active':''} onClick={()=>setCalendar(false)}>预约列表</button><button className={calendar?'active':''} onClick={()=>{setCalendar(true);setDate(date||dateInput())}}>当日时段视图</button><button onClick={()=>setDianping(true)}>大众点评订单</button></div><div className="button-row">{ctx.me.hq&&ctx.can('appointments:export')&&<button className="a-secondary" onClick={()=>download(`/api/admin/exports/appointments?${new URLSearchParams({storeId:ctx.store,status,search,from:date,to:date})}`,'预约记录.xlsx').catch(e=>setError(e.message))}><Download size={14}/>导出</button>}{ctx.can('appointments:write')&&<button className="a-primary" onClick={()=>setManual(true)}><Plus size={15}/>前台代约</button>}</div></div><div className="table-filters"><label className="search-input"><Search size={16}/><input aria-label="搜索预约" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索称呼、手机号、预约编号"/></label><select aria-label="预约状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(statusLabels).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select><input aria-label="到店日期" type="date" value={date} onChange={e=>setDate(e.target.value)}/><button title="刷新" onClick={()=>void refresh()}><RefreshCw size={16}/></button></div><ErrorLine error={error}/>{calendar?<div className="calendar-lanes">{Array.from(new Set(data.items.map(b=>b.startTime))).sort().map(time=><div key={time}><strong>{time}</strong><div>{data.items.filter(b=>b.startTime===time).map(b=><button className="calendar-booking" key={b.id} onClick={()=>setSelected(b)}><Badge status={b.status}/><h4>{b.customerName} · {b.headcount}人</h4><p>{b.serviceName} / {b.storeName}</p><small>{b.assignedTherapistName}</small></button>)}</div></div>)}{!data.items.length&&<Empty text="当天暂无预约"/>}</div>:<AppointmentTable rows={data.items} onOpen={setSelected}/>}<Pager page={page} total={data.total} size={calendar?100:20} onChange={setPage}/></section>{selected&&<AppointmentDetail ctx={ctx} appointment={selected} onClose={()=>setSelected(null)} onUpdate={b=>{setSelected(b);setRevision(revision+1)}}/>}{manual&&<ManualBooking ctx={ctx} onClose={()=>setManual(false)} onSaved={()=>{setManual(false);setRevision(revision+1);ctx.notify('前台代约已保存，并记录预约来源。')}}/>}</>
}
function ClockSymbol(){return <span className="clock-symbol">◷</span>}
function AppointmentDetail({ctx,appointment:b,onClose,onUpdate}:{ctx:Ctx;appointment:Appointment;onClose:()=>void;onUpdate:(b:Appointment)=>void}){
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[teacher,setTeacher]=useState(b.assignedTherapistId||''),[teachers,setTeachers]=useState<Therapist[]>([]),[date,setDate]=useState(b.bookingDate),[time,setTime]=useState(b.startTime),[phone,setPhone]=useState(''),[slots,setSlots]=useState<Slots|null>(null)
  useEffect(()=>{let current=true;setTeachers([]);if(ctx.can('therapists:read'))api<Therapist[]>(`/api/admin/therapists?storeId=${b.storeId}`).then(rows=>current&&setTeachers(rows.filter(t=>t.storeId===b.storeId))).catch(e=>current&&setError(e.message));return()=>{current=false}},[b.storeId])
  useEffect(()=>{setTeacher(b.assignedTherapistId||'');setDate(b.bookingDate);setTime('')},[b.id,b.version])
  useEffect(()=>{let current=true;setSlots(null);if(ctx.can('appointments:write')&&['PENDING','CONFIRMED'].includes(b.status))api<Slots>(`/api/admin/appointments/${b.id}/slots?date=${date}`).then(r=>current&&setSlots(r)).catch(e=>current&&setError(e.message));return()=>{current=false}},[date,b.id,b.version])
  async function action(action:string){if(['cancel','reject'].includes(action)&&!window.confirm('确认取消 / 拒绝此预约？客户将看到处理原因。'))return;setBusy(true);setError('');try{const next=await post(`/api/admin/appointments/${b.id}`,{action,version:b.version,note,assignedTherapistId:teacher,date,startTime:time},'PATCH');onUpdate(next);setNote('');ctx.notify('预约已更新，客户可查看最新状态。')}catch(e){setError(friendlyError(e))}finally{setBusy(false)}}
  return <Modal title="预约详情与处理" onClose={onClose} wide><div className="detail-status"><Badge status={b.status}/><span>{b.id} · 版本 {b.version}</span></div><div className="detail-grid"><div><h3>{b.customerName} · {b.serviceName}</h3><p>{b.storeName} / {b.bookingDate} {b.startTime} / {b.headcount}人</p><dl><dt>联系电话</dt><dd>{phone||b.phone} {ctx.can('appointments:phone')&&!phone&&<button className="a-link" onClick={()=>api(`/api/admin/appointments/${b.id}/phone`).then(r=>setPhone(r.phone)).catch(e=>setError(e.message))}>查看完整电话（留痕）</button>}</dd><dt>意向调理师</dt><dd>{b.therapistIntentName} · 仅为意向</dd><dt>实际分配</dt><dd>{b.assignedTherapistName}</dd><dt>会员自述 / 到店自述</dt><dd>{claimLabels[b.memberClaim]} / {claimLabels[b.visitedClaim]}（不等同已核实会员）</dd><dt>接待备注</dt><dd>{b.remark||'未填写'}</dd><dt>预约来源</dt><dd>{sourceLabels[b.source]}</dd></dl></div><div className="detail-actions"><h4>门店处理</h4><textarea aria-label="处理说明" value={note} onChange={e=>setNote(e.target.value)} maxLength={500} placeholder="处理说明 / 无法接待原因 / 本店跟进备注"/><div className="button-row">{b.status==='PENDING'&&ctx.can('appointments:review')&&<><button disabled={busy} className="a-primary" onClick={()=>void action('confirm')}>确认接待</button><button disabled={busy} className="a-danger" onClick={()=>void action('reject')}>拒绝并说明原因</button></>}{b.status==='CONFIRMED'&&ctx.can('appointments:status')&&<><button disabled={busy} className="a-primary" onClick={()=>void action('arrive')}>标记已到店</button><button disabled={busy} className="a-secondary" onClick={()=>void action('noshow')}>标记未到店</button></>}{b.status==='ARRIVED'&&ctx.can('appointments:status')&&<button disabled={busy} className="a-primary" onClick={()=>void action('complete')}>完成服务</button>}{['PENDING','CONFIRMED','ARRIVED'].includes(b.status)&&ctx.can('appointments:write')&&<button disabled={busy} className="a-danger" onClick={()=>void action('cancel')}>取消预约</button>}{ctx.can('appointments:write')&&<button disabled={busy} className="a-secondary" onClick={()=>void action('note')}>添加内部跟进</button>}</div>{ctx.can('appointments:write')&&['PENDING','CONFIRMED','ARRIVED'].includes(b.status)&&<><p className="field-note">仅可分配{b.storeName}的调理师。</p><Field label="分配实际接待调理师"><select aria-label="实际调理师" value={teacher} onChange={e=>setTeacher(e.target.value)}><option value="">请选择</option>{teachers.filter(t=>t.storeId===b.storeId&&t.enabled&&t.serviceIds.includes(b.serviceId)).map(t=><option value={t.id} key={t.id}>{t.name} · {t.storeName}{t.resting?'（资料标记休息）':''}</option>)}</select></Field><button className="a-secondary" disabled={busy||!teacher} onClick={()=>void action('assign')}>保存人员分配</button></>}{ctx.can('appointments:write')&&['PENDING','CONFIRMED'].includes(b.status)&&<><h4>调整开始时间</h4><div className="form-columns"><input aria-label="后台改约日期" type="date" min={dateInput()} max={dateInput(slots?.rules.advanceDays||7)} value={date} onChange={e=>{setDate(e.target.value);setTime('')}}/><select aria-label="后台改约时段" value={time} onChange={e=>setTime(e.target.value)}><option value="">选择时段</option>{slots?.slots.filter(s=>s.available&&s.remaining>=b.headcount).map(s=><option key={s.time}>{s.time}</option>)}</select></div><p className="field-note">改约会重新校验人数名额，成功后回到待人工确认状态。</p><button disabled={busy||!time} className="a-secondary" onClick={()=>void action('reschedule')}>保存改约</button></>}</div></div><ErrorLine error={error}/><h4 className="section-label">处理记录 · 内部留痕</h4><div className="history-list">{b.history?.map(h=><div key={h.id}><i/><div><strong>{h.operatorName} <Badge status={h.status}/></strong><p>{h.note}</p><small>{displayTime(h.createdAt)}</small></div></div>)}</div></Modal>
}
function ManualBooking({ctx,onClose,onSaved}:{ctx:Ctx;onClose:()=>void;onSaved:()=>void}){
  const [services,setServices]=useState<ServiceItem[]>([]),[servicesLoading,setServicesLoading]=useState(false),[b,setB]=useState<Row>({storeId:ctx.me.hq?ctx.store:ctx.me.storeId,serviceId:'',date:dateInput(1),startTime:'',headcount:1,name:'',phone:'',therapistIntentId:'',memberClaim:'UNKNOWN',visitedClaim:'UNKNOWN',remark:'',privacyConsent:true,source:'PHONE',overridePhoneLimit:false}),[slots,setSlots]=useState<Slots|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const key=useRef(newId()),patch=(p:Row)=>{setB(v=>({...v,...p}));key.current=newId();setError('')}
  useEffect(()=>{let current=true;setServices([]);setServicesLoading(!!b.storeId);if(b.storeId)api<ServiceItem[]>(`/api/stores/${b.storeId}/services`).then(r=>current&&setServices(r)).catch(e=>current&&setError(e.message)).finally(()=>current&&setServicesLoading(false));return()=>{current=false}},[b.storeId])
  useEffect(()=>{let current=true;setSlots(null);if(b.storeId)api<Slots>(`/api/stores/${b.storeId}/slots?date=${b.date}`).then(r=>current&&setSlots(r)).catch(e=>current&&setError(e.message));return()=>{current=false}},[b.storeId,b.date])
  async function submit(e:React.FormEvent){e.preventDefault();if(busy||servicesLoading||!services.some(s=>s.id===b.serviceId))return;setBusy(true);try{await api('/api/admin/appointments',{method:'POST',headers:{'Idempotency-Key':key.current},body:JSON.stringify(b)});onSaved()}catch(e){setError(friendlyError(e))}finally{setBusy(false)}}
  return <Modal title="前台代约" onClose={onClose}><form onSubmit={submit}><div className="form-columns"><Field label="接待门店"><select required aria-label="接待门店" value={b.storeId} onChange={e=>patch({storeId:e.target.value,serviceId:'',startTime:'',therapistIntentId:''})}><option value="">请选择接待门店</option>{ctx.stores.filter(s=>s.enabled&&s.onlineBooking).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><Field label="预约来源"><select value={b.source} onChange={e=>patch({source:e.target.value})}>{Object.entries(sourceLabels).filter(([k])=>k!=='MINIPROGRAM').map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field></div><Field label="养护项目"><select required disabled={!b.storeId||servicesLoading} value={b.serviceId} onChange={e=>patch({serviceId:e.target.value})}><option value="">请选择项目</option>{services.map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></Field><div className="form-columns"><Field label="到店日期"><input type="date" required min={dateInput()} max={dateInput(slots?.rules.advanceDays||7)} value={b.date} onChange={e=>patch({date:e.target.value,startTime:''})}/></Field><Field label="到店开始时间"><select required value={b.startTime} onChange={e=>patch({startTime:e.target.value})}><option value="">选择时段</option>{slots?.slots.filter(s=>s.available&&s.remaining>=b.headcount).map(s=><option key={s.time} value={s.time}>{s.time} · 余{s.remaining}位</option>)}</select></Field></div><div className="form-columns"><Field label="客户称呼"><input required value={b.name} maxLength={40} onChange={e=>patch({name:e.target.value})}/></Field><Field label="联系电话"><input required pattern="1[3-9][0-9]{9}" value={b.phone} onChange={e=>patch({phone:e.target.value})}/></Field></div><Field label="同行人数"><input required type="number" min="1" max={slots?.rules.maxHeadcount||4} value={b.headcount} onChange={e=>patch({headcount:Number(e.target.value),startTime:''})}/></Field><Field label="接待备注"><textarea value={b.remark} maxLength={500} onChange={e=>patch({remark:e.target.value})}/></Field><Toggle label="已核对客户意愿，允许超过本手机号的未完成预约笔数限制" value={b.overridePhoneLimit} onChange={v=>patch({overridePhoneLimit:v})}/><div className="admin-note">前台代约将直接记为“门店已确认”，请先与客户核对时间及接待安排；不会凭手机号关联微信身份或开放历史预约。</div><ErrorLine error={error}/><button className="a-primary" disabled={busy||!slots||servicesLoading||!services.some(s=>s.id===b.serviceId)}>{busy?'保存中…':'保存代约并确认'}</button></form></Modal>
}

function Therapists({ctx}:{ctx:Ctx}){
  const store=ctx.me.hq?ctx.store:ctx.me.storeId
  const [rows,setRows]=useState<Therapist[]>([]),[serviceOptions,setServiceOptions]=useState<ServiceItem[]>([]),[servicesLoading,setServicesLoading]=useState(false),[edit,setEdit]=useState<Row|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true)
  const currentStore=useRef(store);currentStore.current=store
  const requestVersion=useRef(0)
  const visibleStores=ctx.stores.filter(s=>!store||s.id===store)
  async function refresh(){
    const requestedStore=store,request=++requestVersion.current;setLoading(true)
    try{
      const data=await api<Therapist[]>(`/api/admin/therapists?${new URLSearchParams({storeId:requestedStore})}`)
      if(currentStore.current===requestedStore&&requestVersion.current===request){setRows(data.filter(t=>(!requestedStore||t.storeId===requestedStore)&&ctx.stores.some(s=>s.id===t.storeId)));setError('')}
    }catch(e){if(currentStore.current===requestedStore&&requestVersion.current===request)setError(friendlyError(e))}
    finally{if(currentStore.current===requestedStore&&requestVersion.current===request)setLoading(false)}
  }
  useEffect(()=>{setRows([]);setEdit(null);setError('');void refresh();return()=>{requestVersion.current++}},[store])
  useEffect(()=>{let current=true;setServiceOptions([]);setServicesLoading(!!edit?.storeId);if(edit?.storeId)api<ServiceItem[]>(`/api/stores/${edit.storeId}/services`).then(r=>current&&setServiceOptions(r)).catch(e=>current&&setError(friendlyError(e))).finally(()=>current&&setServicesLoading(false));return()=>{current=false}},[edit?.storeId])
  async function save(e:React.FormEvent){
    e.preventDefault();if(!edit||busy||servicesLoading)return;setBusy(true)
    try{
      const transferred=!!edit.id&&edit.originalStoreId!==edit.storeId,targetName=ctx.stores.find(s=>s.id===edit.storeId)?.name||edit.storeId
      await post('/api/admin/therapists',edit);setEdit(null);await refresh()
      ctx.notify(transferred?`调理师已转入${targetName}。${store?'查看范围保持不变，可切换至全部门店查看。':'总部仍显示全部门店。'}`:'调理师资料已保存。')
    }catch(e){setError(friendlyError(e))}finally{setBusy(false)}
  }
  return <section className="ops-card">
    <div className="card-heading"><div><h3>{store?ctx.stores.find(s=>s.id===store)?.name:'全部门店'} · 调理师资料</h3><p>{store?'当前查看本店调理师。':`总部汇总 ${ctx.stores.length} 家门店，按所属门店展示全部调理师。`}客户意向选择与前台分配仍限定预约门店。</p></div>
      {ctx.can('therapists:write')&&<button className="a-primary" onClick={()=>{setError('');setEdit({id:'',storeId:store,name:'',grade:'调理师',specialty:'',serviceIds:[],image:'/media/ritual.webp',enabled:true,showOnClient:true,resting:false})}}><Plus size={15}/>新增调理师</button>}
    </div>
    {ctx.me.hq&&<div className="store-scope-shortcuts" aria-label="调理师门店筛选"><button aria-pressed={!store} onClick={()=>ctx.setStore('')}>全部门店{!store&&!loading&&<span>{rows.length} 位</span>}</button>{ctx.stores.map(s=><button key={s.id} aria-pressed={store===s.id} onClick={()=>ctx.setStore(s.id)}>{s.name}{!store&&!loading&&<span>{rows.filter(t=>t.storeId===s.id).length} 位</span>}</button>)}</div>}
    <ErrorLine error={error}/>
    {loading?<Empty text="正在加载调理师资料…"/>:visibleStores.map(s=><section className="therapist-store-group" key={s.id} data-store-id={s.id} aria-label={`${s.name}调理师`}><div className="store-group-heading"><h4><MapPin size={15}/>{s.name}</h4><span>{rows.filter(t=>t.storeId===s.id).length} 位调理师</span></div><div className="therapist-grid">{rows.filter(t=>t.storeId===s.id).map(t=><article className="therapist-card" key={t.id} data-therapist-id={t.id}>
      <div className="therapist-avatar">{t.image?<img src={t.image} alt={t.name}/>:<UserRound size={24}/>}</div>
      <h3>{t.name}</h3><span>{t.grade}</span><div className="therapist-store"><MapPin size={13}/><span>所属门店：{t.storeName}</span></div>
      <p>{t.specialty||'门店贴心接待'}</p><div className="tag-row"><span>{t.enabled?'在岗':'停用'}</span><span>{t.resting?'休息中':'可安排'}</span><span>{t.showOnClient?'客户可选':'仅后台'}</span></div>
      {t.sample&&<small>本地示例资料 · 待替换</small>}{ctx.can('therapists:write')&&<button className="a-secondary" onClick={()=>{setError('');setEdit({...clone(t),originalStoreId:t.storeId})}}>编辑资料</button>}
    </article>)}</div>{!rows.some(t=>t.storeId===s.id)&&<Empty text="本店暂无调理师资料，可导入或新增"/>}</section>)}
    {edit&&<Modal title="调理师资料" onClose={()=>setEdit(null)}><form onSubmit={save}>
      <Field label="所属门店">{ctx.me.hq?<select aria-label="调理师所属门店" required disabled={busy} value={edit.storeId} onChange={e=>{setError('');setEdit({...edit,storeId:e.target.value,serviceIds:[]})}}><option value="" disabled>请选择调理师所属门店</option>{ctx.stores.map(s=><option key={s.id} value={s.id} disabled={!s.enabled&&s.id!==edit.originalStoreId&&s.id!==edit.storeId}>{s.name}{!s.enabled?'（已停用）':''}</option>)}</select>:<input aria-label="调理师所属门店" readOnly value={ctx.stores.find(s=>s.id===edit.storeId)?.name||edit.storeName||edit.storeId}/>}</Field>
      <p className="field-note">{ctx.me.hq?'总部可调整所属门店，客户选择与前台分配均以保存后的门店为准。':'所属门店由总部统一调整，门店账号可维护本店调理师资料。'}</p>
      {edit.id&&edit.originalStoreId!==edit.storeId&&<div className="admin-note">将从{ctx.stores.find(s=>s.id===edit.originalStoreId)?.name||edit.originalStoreId}调整至{ctx.stores.find(s=>s.id===edit.storeId)?.name||edit.storeId}。如有未结束预约已实际分配给该老师，请先重新分配。原预约保留在原门店；已有老师意向由原门店重新沟通安排。</div>}
      <Field label="姓名"><input required maxLength={60} value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value,sample:false})}/></Field>
      <Field label="等级 / 头衔"><input value={edit.grade} onChange={e=>setEdit({...edit,grade:e.target.value})}/></Field>
      <Field label="擅长介绍"><textarea value={edit.specialty} onChange={e=>setEdit({...edit,specialty:e.target.value})}/></Field>
      <Field label="照片路径（素材库）"><input value={edit.image||''} onChange={e=>setEdit({...edit,image:e.target.value})}/></Field>
      {servicesLoading&&<p className="field-note">正在加载本店项目…</p>}<div className="checkbox-grid">{serviceOptions.map(s=><Toggle key={s.id} label={s.name} value={edit.serviceIds?.includes(s.id)} onChange={v=>setEdit({...edit,serviceIds:v?[...edit.serviceIds,s.id]:edit.serviceIds.filter((id:string)=>id!==s.id)})}/>)}</div>{edit.serviceIds?.filter((id:string)=>!serviceOptions.some(s=>s.id===id)).map((id:string)=><Toggle key={id} label={`已下架项目（${id}）`} value onChange={()=>setEdit({...edit,serviceIds:edit.serviceIds.filter((v:string)=>v!==id)})}/>)}
      <Toggle label="账号资料启用" value={edit.enabled} onChange={v=>setEdit({...edit,enabled:v})}/>
      <Toggle label="在小程序展示，允许客户表达意向" value={edit.showOnClient} onChange={v=>setEdit({...edit,showOnClient:v})}/>
      <Toggle label="当前休息，暂不接受客户意向" value={edit.resting} onChange={v=>setEdit({...edit,resting:v})}/>
      <ErrorLine error={error}/><button className="a-primary" disabled={busy||servicesLoading}>{busy?'保存中…':'保存资料'}</button>
    </form></Modal>}
  </section>
}
function Customers({ctx}:{ctx:Ctx}){
  const [data,setData]=useState<Page<Row>>({items:[],total:0}),[page,setPage]=useState(1),[edit,setEdit]=useState<Row|null>(null),[error,setError]=useState(''),[phone,setPhone]=useState(''),[shared,setShared]=useState<Row|null>(null)
  const requestVersion=useRef(0)
  async function refresh(){const request=++requestVersion.current;try{const next=await api<Page<Row>>(`/api/admin/customers?storeId=${ctx.store}&page=${page}`);if(request===requestVersion.current){setData(next);setError('')}}catch(e){if(request===requestVersion.current)setError(friendlyError(e))}}useEffect(()=>{setData({items:[],total:0});void refresh();return()=>{requestVersion.current++}},[ctx.store,page])
  async function save(e:React.FormEvent){e.preventDefault();try{await post(`/api/admin/customers/${edit!.id}`,edit);setEdit(null);await refresh();ctx.notify('客户标签与本店跟进已保存。')}catch(e){setError(friendlyError(e))}}
  return <><section className="ops-card"><div className="card-heading"><div><h3>门店客户档案</h3><p>预约自动形成基础联系档案；自述会员与总部核实标签分别保存。</p></div>{ctx.me.hq&&ctx.can('customers:export')&&<button className="a-secondary" onClick={()=>download(`/api/admin/exports/customers?storeId=${ctx.store}`,'客户档案.xlsx').catch(e=>setError(e.message))}><Download size={14}/>导出</button>}</div><ErrorLine error={error}/>{data.items.length?<div className="table-scroll"><table className="ops-table"><thead><tr><th>客户称呼 / 电话</th><th>所属门店</th><th>核实会员标签</th><th>本店私有跟进</th><th>操作</th></tr></thead><tbody>{data.items.map(c=><tr key={c.id+c.storeId}><td><strong>{c.name}</strong><small>{c.phone}</small></td><td>{ctx.stores.find(s=>s.id===c.storeId)?.name}</td><td><span className={`status-tag ${c.memberVerified?'CONFIRMED':''}`}>{c.memberVerified?c.memberGrade||'已核实会员':'尚未核实为会员'}</span></td><td className="ellipsis-cell">{c.privateNote||'暂无跟进'}</td><td>{ctx.can('customers:write')&&<button className="a-link" onClick={()=>setEdit(clone(c))}>维护档案</button>}</td></tr>)}</tbody></table></div>:<Empty text="预约提交后，客户基础档案会自动显示在这里"/>}<Pager page={page} total={data.total} size={30} onChange={setPage}/></section>{ctx.can('customers:shared')&&<section className="ops-card shared-lookup"><h3>品牌基础档案 · 精确检索</h3><p>须由总部开启。只返回基础白名单字段，不提供其他门店私有跟进或历史预约。</p><div className="button-row"><input aria-label="基础档案精确手机号" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="输入完整 11 位手机号" maxLength={11}/><button className="a-secondary" onClick={()=>post('/api/admin/customers/shared-lookup',{phone},'POST').then(setShared).catch(e=>setError(e.message))}>精确查询（留痕）</button></div>{shared&&<pre>{JSON.stringify(shared,null,2)}</pre>}</section>}{edit&&<Modal title="客户档案与本店跟进" onClose={()=>setEdit(null)}><form onSubmit={save}><h3>{edit.name} · {edit.phone}</h3><Field label="本店私有跟进（仅本店及总部）"><textarea value={edit.privateNote||''} maxLength={1000} onChange={e=>setEdit({...edit,privateNote:e.target.value})}/></Field><Field label="客户来源"><input value={edit.source||''} onChange={e=>setEdit({...edit,source:e.target.value})}/></Field>{ctx.me.hq&&ctx.can('customers:master')&&<><Toggle label="总部已核实为会员" value={edit.memberVerified} onChange={v=>setEdit({...edit,memberVerified:v})}/><Field label="核实会员等级"><input value={edit.memberGrade||''} onChange={e=>setEdit({...edit,memberGrade:e.target.value})}/></Field><Field label="允许品牌共享的非敏感接待提示"><textarea value={edit.sharedNote||''} maxLength={300} onChange={e=>setEdit({...edit,sharedNote:e.target.value})}/></Field></>}<ErrorLine error={error}/><button className="a-primary">保存档案</button></form></Modal>}</>
}

function StoreSettings({ctx}:{ctx:Ctx}){
  const sid=ctx.me.hq?ctx.store:ctx.me.storeId
  if(!sid)return <section className="ops-card"><div className="card-heading"><div><h3>全部门店 · 门店与时段</h3><p>共 {ctx.stores.length} 家门店，选择需要维护的门店资料与预约时段。</p></div></div><div className="store-overview-grid">{ctx.stores.map(s=><article className="store-overview-card" key={s.id} data-store-id={s.id}><img src={s.image} alt={s.name}/><div><h3>{s.name}</h3><p>{s.address}</p><div className="tag-row"><span>{s.enabled?'门店启用':'门店停用'}</span><span>{s.onlineBooking?'在线预约':'电话联系'}</span></div><button className="a-secondary" onClick={()=>ctx.setStore(s.id)} aria-label={`管理${s.name}`}>管理本店 <ChevronRight size={14}/></button></div></article>)}</div></section>
  return <>{ctx.me.hq&&<div className="store-detail-navigation"><button className="a-secondary" onClick={()=>ctx.setStore('')}><ChevronLeft size={15}/>返回全部门店</button><span>当前管理：{ctx.stores.find(s=>s.id===sid)?.name}</span></div>}<StoreSettingsDetail key={sid} ctx={ctx} sid={sid}/></>
}
function StoreSettingsDetail({ctx,sid}:{ctx:Ctx;sid:string}){
  const [store,setStore]=useState<Row|null>(null),[rules,setRules]=useState<Rules|null>(null),[error,setError]=useState(''),[override,setOverride]=useState({date:dateInput(1),time:'*',capacity:4,closed:false}),[overrides,setOverrides]=useState<Row[]>([])
  const [section,setSection]=useState('profile')
  useEffect(()=>{let current=true;api<StoreItem[]>('/api/admin/stores').then(rows=>current&&setStore(rows.find(s=>s.id===sid)||null)).catch(e=>current&&setError(e.message));if(ctx.can('rules:write')){api<Rules>(`/api/admin/stores/${sid}/rules`).then(r=>current&&setRules(r)).catch(e=>current&&setError(e.message));api<Row[]>(`/api/admin/stores/${sid}/slots`).then(r=>current&&setOverrides(r)).catch(e=>current&&setError(e.message))}return()=>{current=false}},[sid])
  async function save(type:string){try{if(type==='profile'&&ctx.can('stores:write')){setStore(await post(`/api/admin/stores/${sid}`,store));await ctx.refreshStores()}if(type==='rules')setRules(await post(`/api/admin/stores/${sid}/rules`,rules));if(type==='slot'){await post(`/api/admin/stores/${sid}/slots`,override);setOverrides(await api(`/api/admin/stores/${sid}/slots`))}ctx.notify('门店配置已保存。');setError('')}catch(e){setError(friendlyError(e))}}
  if(!store)return <Empty text="正在读取门店配置…"/>
  return <>
    <ErrorLine error={error}/>
    <div className="settings-tabs segmented" aria-label="门店设置分组">
      {[['profile','门店资料'],...(rules?[['rules','预约规则'],['overrides','临时安排']]:[])].map(([id,label])=><button key={id} type="button" className={section===id?'active':''} aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</button>)}
    </div>
    <section className="ops-card settings-panel" data-section={section}>
      {section==='profile'&&<>
        <div className="card-heading"><div><h3>门店公开信息</h3><p>调整后同步到客户门店展示页。</p></div>{ctx.can('stores:write')&&<button className="a-primary" onClick={()=>void save('profile')}>保存门店资料</button>}</div>
        <fieldset disabled={!ctx.can('stores:write')} className="settings-profile">
          <aside className="settings-profile-media">
            <img className="settings-store-cover" src={store.image} alt={store.name}/>
            {ctx.me.hq&&<><Toggle label="门店启用" value={store.enabled} onChange={v=>setStore({...store,enabled:v})}/><Toggle label="开放在线申请（关闭后仅电话联系）" value={store.onlineBooking} onChange={v=>setStore({...store,onlineBooking:v})}/></>}
            <StoreProjects store={store} setStore={setStore}/>
          </aside>
          <div className="settings-profile-fields">
            {[['name','门店名称'],['district','区域'],['address','门店地址'],['phone','门店联系电话'],['hours','展示营业时间'],['image','门店封面路径']].map(([key,label])=><Field key={key} label={label}><input value={store[key]||''} onChange={e=>setStore({...store,[key]:e.target.value})}/></Field>)}
            <Field label="门店介绍" wide><AutoTextarea value={store.description||''} onChange={e=>setStore({...store,description:e.target.value})}/></Field>
            <Field label="纬度（地图导航）"><input type="number" step="any" value={store.latitude||''} onChange={e=>setStore({...store,latitude:Number(e.target.value)})}/></Field>
            <Field label="经度"><input type="number" step="any" value={store.longitude||''} onChange={e=>setStore({...store,longitude:Number(e.target.value)})}/></Field>
            <Field label="门店相册路径（一行一张）" wide><AutoTextarea value={(store.gallery||[]).join('\n')} onChange={e=>setStore({...store,gallery:e.target.value.split('\n').filter(Boolean)})}/></Field>
          </div>
        </fieldset>
      </>}
      {section==='rules'&&rules&&<>
        <div className="card-heading"><div><h3>预约时段与名额</h3><p>按开始时段及同行人数计数；不自动锁定老师、房间或床位。</p></div><button className="a-primary" onClick={()=>void save('rules')}>保存预约规则</button></div>
        <div className="settings-rule-fields">
          <Field label="开始营业"><input type="time" value={rules.opens} onChange={e=>setRules({...rules,opens:e.target.value})}/></Field>
          <Field label="结束营业"><input type="time" value={rules.closes} onChange={e=>setRules({...rules,closes:e.target.value})}/></Field>
          <Field label="开始时段间隔"><select value={rules.interval} onChange={e=>setRules({...rules,interval:Number(e.target.value)})}>{[15,30,60].map(v=><option key={v} value={v}>{v}分钟</option>)}</select></Field>
          {[['capacity','每时段人数名额'],['advanceDays','提前可约天数'],['minLeadMinutes','最短提前分钟'],['cancelHours','自助取消 / 改约提前小时'],['maxHeadcount','每笔最多同行人数'],['phoneOpenLimit','同电话最多未结束笔数'],['remindMinutes','到店前提醒分钟']].map(([key,label])=><Field key={key} label={label}><input type="number" min="0" value={Number(rules[key as keyof Rules])} onChange={e=>setRules({...rules,[key]:Number(e.target.value)})}/></Field>)}
          <Field label="休店日期（英文逗号分隔，YYYY-MM-DD）" wide><input value={rules.closedDates.join(',')} onChange={e=>setRules({...rules,closedDates:e.target.value.split(',').filter(Boolean)})}/></Field>
        </div>
        <div className="admin-note">已有申请占用的名额不能直接清零。待确认超时与迟到只提醒工作人员处理，不会自动取消。</div>
      </>}
      {section==='overrides'&&rules&&<>
        <div className="card-heading"><div><h3>临时停约 / 名额覆盖</h3><p>按日期或具体时段调整名额，已有安排可点选后编辑。</p></div><button className="a-primary" onClick={()=>void save('slot')}>保存临时安排</button></div>
        <div className="settings-rule-fields">
          <Field label="覆盖日期"><input type="date" min={dateInput()} value={override.date} onChange={e=>setOverride({...override,date:e.target.value})}/></Field>
          <Field label="开始时间（* 为全天）"><input value={override.time} onChange={e=>setOverride({...override,time:e.target.value})}/></Field>
          <Field label="覆盖名额"><input type="number" min="0" value={override.capacity} onChange={e=>setOverride({...override,capacity:Number(e.target.value)})}/></Field>
        </div>
        <Toggle label="暂停该日 / 该时段的新申请" value={override.closed} onChange={v=>setOverride({...override,closed:v})}/>
        <h4>已保存的临时安排</h4>
        {overrides.length?<div className="slot-overrides">{overrides.map(o=><button className="a-secondary" key={o.bookingDate+o.startTime} onClick={()=>setOverride({date:o.bookingDate,time:o.startTime,capacity:o.capacity,closed:o.closed})}>{o.bookingDate} · {o.startTime==='*'?'全天':o.startTime} · {o.closed?'暂停新申请':`${o.capacity}位`} · 编辑</button>)}</div>:<p className="field-note">暂无临时安排。全天暂停会同时限制当天所有时段。</p>}
      </>}
    </section>
  </>
}
function StoreProjects({store}:{store:Row;setStore:(s:Row)=>void}){return <div className="store-projects"><h4>本店开放项目</h4><p className="field-note">{store.name}的项目名称、时长、介绍和上下架，请在「品牌与内容 → 养护项目」中维护，保存后预约页面同步生效。</p></div>}

function ContentEditor({ctx}:{ctx:Ctx}){
  const storeId=ctx.me.hq?ctx.store:ctx.me.storeId,scoped=!!storeId
  const canBrand=ctx.can('content:read'),canServices=scoped&&ctx.can('services:read'),needsStore=!scoped&&!canBrand
  const contentTabs=[['home','首页与品牌'],['services','养护项目'],['products','品牌产品'],['gallery','空间相册']].filter(([id])=>id==='services'?(scoped?canServices:canBrand):canBrand)
  const storeName=ctx.stores.find(s=>s.id===storeId)?.name||'本店'
  const [site,setSite]=useState<Site|null>(null),[error,setError]=useState(''),[tab,setTab]=useState(scoped&&canServices?'services':'home'),[busy,setBusy]=useState(false)
  const [selectedItems,setSelectedItems]=useState({services:0,products:0,gallery:0}),[homeSection,setHomeSection]=useState('brand')
  const savedServices=useRef<ServiceItem[]>([]),active=useRef(true),saving=useRef(false)
  useEffect(()=>{
    let alive=true;active.current=true
    async function load(){
      try{
        const [content,services]=await Promise.all([
          api<Site>(scoped?'/api/site':'/api/admin/content'),
          canServices?api<ServiceItem[]>(`/api/admin/stores/${storeId}/services`):Promise.resolve(null)
        ])
        if(!alive)return
        savedServices.current=clone(services||[])
        setSite(services?{...content,services}:content)
      }catch(e){if(alive)setError(friendlyError(e))}
    }
    if(!needsStore)void load()
    return()=>{alive=false;active.current=false}
  },[])
  const patch=(p:Partial<Site>)=>setSite(s=>s?{...s,...p}:s)
  const editable=scoped?tab==='services'&&ctx.can('services:write'):ctx.can('content:write')
  async function save(publish:boolean){
    if(!site||saving.current)return
    if(scoped&&!ctx.can('services:write')||!scoped&&!ctx.can(publish?'content:publish':'content:write'))return
    saving.current=true;setBusy(true)
    try{
      if(scoped){
        const previous=new Map(savedServices.current.map(s=>[s.id,s]))
        const items=site.services.filter(s=>JSON.stringify(s)!==JSON.stringify(previous.get(s.id))).map(s=>({...s,id:previous.has(s.id)?s.id:''}))
        if(!items.length){setError('');ctx.notify('本店项目没有待保存的修改。');return}
        const services=await post(`/api/admin/stores/${storeId}/services`,{items}) as ServiceItem[]
        if(active.current){savedServices.current=clone(services);setSite(s=>s?{...s,services}:s)}
        ctx.notify(`${storeName}的养护项目已保存，本店展示和预约已同步。`)
      }else{
        const content=await post(`/api/admin/content/${publish?'publish':'draft'}`,site)
        if(active.current)setSite(content)
        ctx.notify(publish?'内容已发布，客户页面将读取新版本。':'草稿已保存，客户页面仍使用已发布内容。')
      }
      if(active.current)setError('')
    }catch(e){if(active.current)setError(friendlyError(e))}
    finally{saving.current=false;if(active.current)setBusy(false)}
  }
  if(needsStore)return <section className="ops-card"><Empty text="请选择上方的具体门店，查看或维护该门店的养护项目。"/></section>
  if(!site)return <><ErrorLine error={error}/><Empty text="正在读取品牌内容…"/></>
  const previewSite=scoped&&canServices?{...site,stores:site.stores.map(s=>s.id===storeId?{...s,services:site.services}:s)}:site
  const catalogTab=tab==='services'||tab==='products'?tab:null
  const selectableItems:Row[]=catalogTab?(site[catalogTab] as unknown as Row[]):tab==='gallery'?site.galleryGroups:[]
  const selectionKey=catalogTab||'gallery'
  const selectedIndex=Math.min(selectedItems[selectionKey],Math.max(0,selectableItems.length-1))
  const selectItem=(index:number)=>setSelectedItems(old=>({...old,[selectionKey]:index}))
  return <>
    <div className="content-toolbar">
      <div className="segmented">{contentTabs.map(([id,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}</div>
      <div className="button-row">{scoped?<>{tab==='services'&&ctx.can('services:write')&&<button className="a-primary" disabled={busy} onClick={()=>void save(true)}>{busy?'正在保存…':'保存到小程序'}</button>}</>:<><span>内容版本 v{site.version}</span>{ctx.can('content:write')&&<button className="a-secondary" disabled={busy} onClick={()=>void save(false)}>保存草稿</button>}{ctx.can('content:publish')&&<button className="a-primary" disabled={busy} onClick={()=>window.confirm('发布后将更新客户小程序展示内容，确认发布？')&&void save(true)}>发布到小程序</button>}</>}</div>
    </div>
    <ErrorLine error={error}/>
    {!scoped&&!ctx.can('content:write')&&<p className="field-note">{ctx.can('content:publish')?'当前岗位可审核并发布总部已保存的草稿；编辑草稿需要另行授权。':'当前岗位仅可预览品牌内容，编辑和发布需要总部授权。'}</p>}
    {scoped&&<p className="field-note">{tab==='services'?`${storeName}：${ctx.can('services:write')?'修改仅对本店生效，保存后同步本店展示和预约。':'当前为只读预览，维护本店项目需要总部授权。'}`:'品牌内容由总部统一维护，可在这里预览。'}</p>}
    <div className="content-workspace">
      <section className="ops-card content-form">
        {tab==='home'&&<div className="content-section-tabs segmented" aria-label="首页与品牌分组">{[['brand','品牌信息'],['cover','首页封面'],['sections','区块排序'],['contact','客服信息']].map(([id,label])=><button key={id} type="button" className={homeSection===id?'active':''} aria-pressed={homeSection===id} onClick={()=>setHomeSection(id)}>{label}</button>)}</div>}
        {tab!=='home'&&selectableItems.length>0&&<div className="catalog-navigation">
          <label><span>{catalogTab==='services'?'选择养护项目':catalogTab==='products'?'选择品牌产品':'选择空间相册'}</span><select value={selectedIndex} onChange={e=>selectItem(Number(e.target.value))}>{selectableItems.map((item,i)=><option key={item.id} value={i}>{i+1}. {item.name}{catalogTab?item.enabled?' · 已上架':' · 未上架':''}</option>)}</select></label>
          <div className="catalog-page"><button className="a-secondary" aria-label="上一项" disabled={selectedIndex===0} onClick={()=>selectItem(selectedIndex-1)}><ChevronLeft size={16}/></button><span>{selectedIndex+1} / {selectableItems.length}</span><button className="a-secondary" aria-label="下一项" disabled={selectedIndex+1===selectableItems.length} onClick={()=>selectItem(selectedIndex+1)}><ChevronRight size={16}/></button></div>
        </div>}
        <fieldset disabled={busy||!editable}>
          {tab==='home'&&<>
            {homeSection==='brand'&&<><h3>品牌信息</h3><div className="form-columns"><Field label="品牌名称"><input value={site.brandName} onChange={e=>patch({brandName:e.target.value})}/></Field><Field label="英文名称"><input value={site.brandEnglish} onChange={e=>patch({brandEnglish:e.target.value})}/></Field></div><Field label="品牌短句"><input value={site.tagline} onChange={e=>patch({tagline:e.target.value})}/></Field><Field label="品牌故事"><AutoTextarea rows={5} value={site.brandStory} onChange={e=>patch({brandStory:e.target.value})}/></Field><h3>预设风格</h3><div className="theme-choices">{[['sage','浅灰绿'],['sand','暖米白'],['ink','水墨灰']].map(([id,label])=><button type="button" key={id} className={`swatch ${id} ${site.theme===id?'active':''}`} onClick={()=>patch({theme:id as Site['theme']})}><i/>{label}{site.theme===id&&<Check size={14}/>}</button>)}</div></>}
            {homeSection==='cover'&&<><h3>首页封面</h3><div className="content-cover-fields">{[['eyebrow','封面英文短句'],['title','封面标题（可换行）'],['subtitle','封面副标题'],['image','封面图片路径'],['button','预约按钮文字']].map(([key,label])=><Field key={key} label={label} wide={key==='title'||key==='image'}><AutoTextarea rows={key==='title'?2:1} value={(site.hero as unknown as Row)[key]} onChange={e=>patch({hero:{...site.hero,[key]:e.target.value}})}/></Field>)}</div></>}
            {homeSection==='sections'&&<><h3>首页区块开关与排序</h3>{site.sections.map((s,i)=><div className="section-order" key={s.id}><Toggle label={s.name} value={s.enabled} onChange={v=>patch({sections:site.sections.map(x=>x.id===s.id?{...x,enabled:v}:x)})}/><button className="a-link" disabled={!i} onClick={()=>{const sections=[...site.sections];[sections[i-1],sections[i]]=[sections[i],sections[i-1]];patch({sections})}}>上移</button></div>)}</>}
            {homeSection==='contact'&&<><h3>客服联系信息</h3>{[['phone','品牌联系电话'],['wechat','展示微信号'],['message','咨询温馨说明']].map(([key,label])=><Field key={key} label={label}><input value={(site.contact as unknown as Row)[key]} onChange={e=>patch({contact:{...site.contact,[key]:e.target.value}})}/></Field>)}<div className="admin-note">客户可使用在线客服与后台沟通，也可在小程序内进入微信原生客服；原生消息需配置微信消息推送和客服接口。</div></>}
          </>}
          {catalogTab&&<>
            <div className="card-heading"><h3>{catalogTab==='services'?'养护项目':'品牌产品'} · 展示与上下架</h3><button type="button" className="a-secondary" onClick={()=>{
              const entry=catalogTab==='services'?{id:'service-'+newId().slice(0,8),name:'新养护项目',english:'WELLNESS RITUAL',subtitle:'一份细致关照',category:'特色养护',duration:'60分钟',image:'/media/ritual.webp',tag:'门店养护',enabled:false,description:'请补充项目介绍',steps:['到店沟通','细致养护']}:{id:'product-'+newId().slice(0,8),name:'品牌好物',subtitle:'自然关照',image:'/media/herb-field.webp',category:'东方好物',description:'请补充产品介绍',enabled:false}
              selectItem(site[catalogTab].length)
              patch({[catalogTab]:[...(site[catalogTab] as unknown as Row[]),entry]})
            }}><Plus size={14}/>新增</button></div>
            <div className="catalog-editors">{(site[catalogTab] as unknown as Row[]).map((item,i)=>i===selectedIndex&&<div className="catalog-editor" key={item.id}>
              <div className="catalog-editor-header"><img src={item.image} alt={item.name}/><div><strong>{item.name}</strong><small>编号 {item.id}</small></div><Toggle label="上架" disabled={scoped&&item.brandEnabled===false} value={item.enabled} onChange={v=>patch({[catalogTab]:(site[catalogTab] as unknown as Row[]).map((x,n)=>n===i?{...x,enabled:v}:x)})}/></div>
              {['name','subtitle','category','duration','english','tag','image','description'].filter(key=>catalogTab==='services'||!['duration','english','tag'].includes(key)).map(key=><Field key={key} wide={key==='image'||key==='description'} label={({name:'名称',subtitle:'简短说明',category:'分类',image:'素材图片路径',description:'详细介绍',duration:'参考时长',english:'英文标题',tag:'标签'} as Row)[key]}>{key==='description'?<AutoTextarea value={item[key]||''} onChange={e=>patch({[catalogTab]:(site[catalogTab] as unknown as Row[]).map((x,n)=>n===i?{...x,[key]:e.target.value}:x)})}/>:<input value={item[key]||''} onChange={e=>patch({[catalogTab]:(site[catalogTab] as unknown as Row[]).map((x,n)=>n===i?{...x,[key]:e.target.value}:x)})}/>}</Field>)}
              {catalogTab==='services'&&<Field label="养护步骤（一行一步）" wide><AutoTextarea value={(item.steps||[]).join('\n')} onChange={e=>patch({services:site.services.map((s,n)=>n===i?{...s,steps:e.target.value.split('\n').filter(Boolean)}:s)})}/></Field>}
            </div>)}</div>
          </>}
          {tab==='gallery'&&<>
            <div className="card-heading"><h3>空间相册</h3><button className="a-secondary" onClick={()=>{selectItem(site.galleryGroups.length);patch({galleryGroups:[...site.galleryGroups,{id:newId(),name:'新空间',images:[]}]})}}>新增相册</button></div>
            {site.galleryGroups.map((g,i)=>i===selectedIndex&&<div className="gallery-editor" key={g.id}><Field label="相册名称"><input value={g.name} onChange={e=>patch({galleryGroups:site.galleryGroups.map((x,n)=>n===i?{...x,name:e.target.value}:x)})}/></Field><Field label="图片路径（一行一张）"><AutoTextarea rows={3} value={g.images.join('\n')} onChange={e=>patch({galleryGroups:site.galleryGroups.map((x,n)=>n===i?{...x,images:e.target.value.split('\n').filter(Boolean)}:x)})}/></Field><div className="gallery-thumbs">{g.images.map((url,n)=><img key={n} src={url} alt={g.name}/>)}</div></div>)}
          </>}
        </fieldset>
      </section>
      <aside className="content-preview"><div><span>实时草稿预览</span><small>{scoped?'本店项目保存后同步小程序':'保存草稿后仍需发布'}</small></div><div className="preview-device"><MiniProgram key={tab==='services'?'services':tab==='products'?'products':'home'} site={previewSite} compact initialPage={tab==='services'?'services':tab==='products'?'products':tab==='gallery'?'spaces':'home'}/></div></aside>
    </div>
  </>
}

function UsersEditor({ctx}:{ctx:Ctx}){
  const [rows,setRows]=useState<Row[]>([]),[roles,setRoles]=useState<Row[]>([]),[edit,setEdit]=useState<Row|null>(null),[error,setError]=useState('')
  async function refresh(){setRows(await api('/api/admin/users'));if(ctx.can('roles:read'))setRoles(await api('/api/admin/roles'))}useEffect(()=>{refresh().catch(e=>setError(e.message))},[])
  async function save(e:React.FormEvent){e.preventDefault();try{await post('/api/admin/users',edit);setEdit(null);await refresh();ctx.notify('用户与角色已保存；该账号旧会话已失效。')}catch(e){setError(friendlyError(e))}}
  return <section className="ops-card"><div className="card-heading"><div><h3>后台用户</h3><p>用户关联角色；后端根据角色权限与门店范围校验每次请求。</p></div>{ctx.can('users:write')&&<button className="a-primary" onClick={()=>setEdit({id:'',username:'',displayName:'',password:'',storeId:ctx.me.hq?'':ctx.me.storeId,enabled:true,roleIds:ctx.me.hq?['hq']:['frontdesk']})}><Plus size={15}/>新建用户</button>}</div><ErrorLine error={error}/><div className="table-scroll"><table className="ops-table"><thead><tr><th>用户</th><th>账号</th><th>所属门店 / 范围</th><th>关联角色</th><th>状态</th><th>操作</th></tr></thead><tbody>{rows.map(u=><tr key={u.id}><td><strong>{u.displayName}</strong></td><td>{u.username}</td><td>{u.storeId?ctx.stores.find(s=>s.id===u.storeId)?.name:'总部 · 全部门店'}</td><td>{u.roleIds.map((id:string)=>roles.find(r=>r.id===id)?.name||id).join('、')}</td><td><span className={`status-tag ${u.enabled?'CONFIRMED':'CANCELLED'}`}>{u.enabled?'启用':'停用'}</span></td><td>{ctx.can('users:write')&&(ctx.me.hq||(u.id!==ctx.me.id&&u.roleIds.length>0&&u.roleIds.every((r:string)=>r==='frontdesk')))&&<button className="a-link" onClick={()=>{setError('');setEdit({...clone(u),password:''})}}>配置用户</button>}</td></tr>)}</tbody></table></div>{edit&&<Modal title="用户与角色配置" onClose={()=>setEdit(null)}><form onSubmit={save}><Field label="登录账号"><input required pattern="[A-Za-z0-9_.-]{3,40}" value={edit.username} onChange={e=>setEdit({...edit,username:e.target.value})}/></Field><Field label="显示名称"><input required value={edit.displayName} onChange={e=>setEdit({...edit,displayName:e.target.value})}/></Field><Field label={edit.id?'重置密码（留空不修改，至少10位）':'初始密码（至少10位）'}><input type="password" minLength={10} autoComplete="new-password" required={!edit.id} value={edit.password} onChange={e=>setEdit({...edit,password:e.target.value})}/></Field><Field label="数据归属门店"><select value={edit.storeId||''} onChange={e=>setEdit({...edit,storeId:e.target.value})}>{ctx.me.hq&&<option value="">总部账号（角色必须为全局范围）</option>}{ctx.stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field><h4>关联角色</h4><div className="checkbox-grid">{roles.filter(r=>ctx.me.hq||r.id==='frontdesk').map(r=><Toggle key={r.id} label={`${r.name} · ${r.dataScope==='GLOBAL'?'总部范围':'门店范围'}`} value={edit.roleIds.includes(r.id)} onChange={v=>setEdit({...edit,roleIds:v?[...edit.roleIds,r.id]:edit.roleIds.filter((id:string)=>id!==r.id)})}/>)}</div><Toggle label="账号启用" value={edit.enabled} onChange={v=>setEdit({...edit,enabled:v})}/><div className="admin-note">门店店长仅可管理本店前台账号；角色和权限变更后，原登录凭证立即失效。</div><ErrorLine error={error}/><button className="a-primary">保存用户配置</button></form></Modal>}</section>
}
function RolesEditor({ctx}:{ctx:Ctx}){
  const [rows,setRows]=useState<Row[]>([]),[permissions,setPermissions]=useState<(Row&Permission)[]>([]),[edit,setEdit]=useState<Row|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const canConfigure=(role:Row)=>ctx.me.hq&&ctx.can('roles:write')&&!(role.builtin&&role.dataScope==='GLOBAL')
  async function refresh(){setRows(await api('/api/admin/roles'));setPermissions(await api('/api/admin/permissions'))}
  useEffect(()=>{refresh().catch(e=>setError(e.message))},[])
  async function save(e:React.FormEvent){
    e.preventDefault();if(!edit||!canConfigure(edit)||busy)return
    setBusy(true);setError('')
    try{await post('/api/admin/roles',edit);setEdit(null);await refresh();ctx.notify('角色授权已保存，所有关联账号需重新登录后使用新权限。')}
    catch(e){setError(friendlyError(e))}finally{setBusy(false)}
  }
  return <section className="ops-card">
    <div className="card-heading"><div><h3>角色与模块授权</h3><p>由总部配置岗位权限，再在用户管理中分配角色。菜单、操作按钮和接口使用同一套授权。</p></div>{ctx.me.hq&&ctx.can('roles:write')&&<button className="a-primary" onClick={()=>{setError('');setEdit({id:'',name:'',dataScope:'STORE',permissions:['appointments:read'],builtin:false})}}><Plus size={15}/>新建角色</button>}</div>
    <div className="admin-note">“品牌与内容”包含品牌预览和本店养护项目权限。门店可独立维护本店项目；总部品牌草稿与发布按总部岗位授权。修改共享角色会影响所有关联账号；需要单独授权某家门店时，请新建门店角色并在用户管理中分配。</div>
    <ErrorLine error={error}/>
    <div className="roles-grid">{rows.map(r=><article className="role-card" key={r.id} data-role-id={r.id}><ShieldCheck size={24}/><h3>{r.name}</h3><p>{r.dataScope==='GLOBAL'?'总部全部门店范围':'仅账号所属门店范围'}</p><div><strong>{r.permissions.length}</strong> 个权限点 <span>{r.builtin?'系统内置':'自定义'}</span></div><button className="a-secondary" onClick={()=>{setError('');setEdit(clone(r))}}>{canConfigure(r)?'配置权限':'查看权限明细'}</button></article>)}</div>
    {edit&&<Modal title={canConfigure(edit)?'角色与权限点配置':'角色权限明细'} onClose={()=>{if(!busy)setEdit(null)}} wide><form onSubmit={save}>
      {edit.builtin&&edit.dataScope==='GLOBAL'&&<div className="admin-note">系统总部管理员保留完整管理权限。其他总部岗位可新建角色，分别授权品牌编辑、审核发布等操作。</div>}
      <fieldset disabled={!canConfigure(edit)||busy}>
        <div className="form-columns"><Field label="角色名称"><input required value={edit.name} onChange={e=>setEdit({...edit,name:e.target.value})}/></Field><Field label="数据范围"><select disabled={edit.builtin} value={edit.dataScope} onChange={e=>setEdit({...edit,dataScope:e.target.value,permissions:edit.permissions.filter((code:string)=>e.target.value==='GLOBAL'||!permissions.find(p=>p.code===code)?.headquartersOnly)})}><option value="STORE">仅账号所属门店</option><option value="GLOBAL">总部全部门店</option></select></Field></div>
        <p className="field-note">勾选操作权限会同时勾选必要的查看权限；取消查看权限会同时取消相关操作。门店角色始终只能访问账号所属门店。</p>
        {Array.from(new Set(permissions.map(p=>p.module))).map(module=><div className="permission-module" key={module}><h4>{module}</h4><div className="checkbox-grid">{permissions.filter(p=>p.module===module).map(p=><Toggle key={p.code} label={p.name} disabled={edit.dataScope==='STORE'&&p.headquartersOnly} value={edit.permissions.includes(p.code)} onChange={v=>setEdit({...edit,permissions:togglePermission(edit.permissions,p.code,v,permissions)})}/>)}</div></div>)}
      </fieldset>
      <ErrorLine error={error}/>{canConfigure(edit)&&<button disabled={busy} className="a-primary">{busy?'正在保存…':'保存角色授权'}</button>}
    </form></Modal>}
  </section>
}

async function download(path:string,filename:string){const r=await fetch(path,{headers:{Authorization:`Bearer ${sessionStorage.getItem('yht-admin-token')||''}`}});if(!r.ok)throw new Error((await r.json()).message||'下载失败');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url)}
function Assets({ctx}:{ctx:Ctx}){const [rows,setRows]=useState<Row[]>([]),[error,setError]=useState('');async function refresh(){try{setRows(await api('/api/admin/assets'))}catch(e){setError(friendlyError(e))}}useEffect(()=>{void refresh()},[]);return <section className="ops-card"><div className="card-heading"><div><h3>品牌与门店图片素材</h3><p>选择图片路径，复制到内容或门店配置。上传支持 JPG / PNG / WebP，单张不超过 5MB。</p></div>{ctx.can('assets:write')&&<label className="a-primary upload-label"><Plus size={14}/>上传图片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;const form=new FormData();form.append('file',file);if(ctx.store)form.append('storeId',ctx.store);try{await api('/api/admin/assets',{method:'POST',body:form});await refresh();ctx.notify('图片已上传。')}catch(e){setError(friendlyError(e))}e.target.value=''}}/></label>}</div><ErrorLine error={error}/><div className="assets-grid">{rows.map(r=><button key={r.id} onClick={()=>navigator.clipboard.writeText(r.url).then(()=>ctx.notify('图片路径已复制，可粘贴到内容配置。'))}><img src={r.url} alt={r.title} loading="lazy"/><div><strong>{r.title}</strong><small>{r.url}</small><span>复制路径</span></div></button>)}</div></section>}

function Audit({ctx}:{ctx:Ctx}){const [data,setData]=useState<Page<Row>>({items:[],total:0}),[page,setPage]=useState(1),[error,setError]=useState('');useEffect(()=>{api(`/api/admin/audit?page=${page}`).then(setData).catch(e=>setError(e.message))},[page]);return <section className="ops-card"><div className="card-heading"><div><h3>操作审计记录</h3><p>账号授权、预约处理、完整电话查看、精确查询、导入导出均留痕。</p></div><ShieldCheck size={22}/></div><ErrorLine error={error}/><div className="table-scroll"><table className="ops-table"><thead><tr><th>操作时间</th><th>操作人</th><th>门店</th><th>动作 / 对象</th><th>说明</th></tr></thead><tbody>{data.items.map(r=><tr key={r.id}><td>{displayTime(r.createdAt)}</td><td>{r.actorName}</td><td>{ctx.stores.find(s=>s.id===r.storeId)?.name||'总部'}</td><td>{r.action}<small>{r.targetId}</small></td><td>{r.detail}</td></tr>)}</tbody></table></div>{!data.items.length&&<Empty/>}<Pager page={page} total={data.total} size={30} onChange={setPage}/></section>}
function Integrations({ctx}:{ctx:Ctx}){
  const [data,setData]=useState<Row|null>(null),[settings,setSettings]=useState<Row>({}),[serviceMap,setServiceMap]=useState(''),[customerMap,setCustomerMap]=useState(''),[reminderMap,setReminderMap]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    api('/api/admin/integrations').then(setData).catch(e=>setError(e.message));
    api('/api/admin/settings').then(s=>{setSettings(s);setServiceMap(s.serviceTemplateMapping||'{}');setCustomerMap(s.customerTemplateMapping||'{}');setReminderMap(s.customerReminderTemplateMapping||'{}')}).catch(e=>setError(e.message))
  },[]);
  function save(){try{
    const mappings={serviceTemplateMapping:JSON.parse(serviceMap),customerTemplateMapping:JSON.parse(customerMap),customerReminderTemplateMapping:JSON.parse(reminderMap)};
    if(Object.values(mappings).some(v=>!v||typeof v!=='object'||Array.isArray(v)))throw new Error();
    post('/api/admin/settings',{sharedLookupEnabled:settings.sharedLookupEnabled==='true',...mappings}).then(()=>{setError('');ctx.notify('配置已保存。')}).catch(e=>setError(e.message))
  }catch{setError('模板映射必须是有效 JSON 对象。')}}
  return <><ErrorLine error={error}/><div className="settings-columns"><section className="ops-card"><div className="card-heading"><div><h3>PMS 大系统扩展接口</h3><p>独立版本协议与事件待接入，不影响当前门店预约。</p></div><Settings size={24}/></div>{data&&<><div className="connection-status"><i className={data.pms.enabled?'online':''}/>{data.pms.enabled?'扩展口已启用':'扩展口默认关闭'}</div><dl className="integration-details"><dt>适配边界</dt><dd>{data.pms.port} / schema v{data.pms.schemaVersion}</dd><dt>待接入事件</dt><dd>{data.pms.pending} 条</dd><dt>拉取端点</dt><dd><code>/api/integrations/pms/v1/events</code></dd><dt>确认端点</dt><dd><code>/api/integrations/pms/v1/ack</code></dd></dl><div className="admin-note">{data.pms.description}。事件仅含预约状态和业务编号，不包含电话、备注或健康信息；PMS 端按事件 ID 去重后确认消费。</div></>}</section><section className="ops-card"><h3>品牌基础档案共享开关</h3><p className="field-note">默认关闭。开启后仍需为角色单独授予“跨店基础精确检索”权限。</p><Toggle label="允许已授权角色按完整手机号精确查询白名单字段" value={settings.sharedLookupEnabled==='true'} onChange={v=>setSettings({...settings,sharedLookupEnabled:String(v)})}/><h3>微信模板字段映射</h3><p className="field-note">按微信后台“我的模板”中的字段键分别配置。客户姓名 customerName、预约项目 serviceName、预约时间 time、门店 storeName、预约结果/状态 status；也支持 appointmentId、event。</p><Field label="服务号模板字段 JSON"><textarea rows={3} value={serviceMap} onChange={e=>setServiceMap(e.target.value)}/></Field><Field label="客户预约处理提醒字段 JSON"><textarea rows={4} value={customerMap} onChange={e=>setCustomerMap(e.target.value)} placeholder={'{"thing1":"customerName","time2":"time"}'}/></Field><Field label="客户到店前预约提醒字段 JSON"><textarea rows={4} value={reminderMap} onChange={e=>setReminderMap(e.target.value)}/></Field><p className="field-note">两个客户模板分别授权、分别扣减次数。到店提醒使用独立模板时必须单独填写映射；拒绝订阅不影响预约。</p>{ctx.can('roles:write')&&<button className="a-primary" onClick={save}>保存品牌配置</button>}</section></div><DianpingIntegration ctx={ctx}/></>
}
