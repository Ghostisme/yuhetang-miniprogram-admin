import {ActionButton,TextInput,SelectInput,TextArea,DisabledFieldset} from './components/AdminControls'
import {useEffect,useRef,useState,type FormEvent,type KeyboardEvent} from 'react'
import {MessageCircle,RefreshCw,Send} from 'lucide-react'
import {api,displayTime,newId} from './api'
import type {Ctx} from './Admin'
import type {Row} from './types'
import './service-chat.css'
import {desktopAllowed,setDesktopEnabled} from './desktop-notifications'

const merge=(old:Row[],incoming:Row[])=>Array.from(new Map([...old,...incoming].map(m=>[m.id,m])).values()).sort((a,b)=>a.seq-b.seq)
const stateLabel=(status:string)=>({OPEN:'待接入',ACTIVE:'接待中',RESOLVED:'已结束'}[status]||status)

export default function ChatInbox({ctx}:{ctx:Ctx}){
  const [rows,setRows]=useState<Row[]>([]),[total,setTotal]=useState(0),[unread,setUnread]=useState(0)
  const [selectedId,setSelectedId]=useState(''),[selected,setSelected]=useState<Row|null>(null),[messages,setMessages]=useState<Row[]>([])
  const [status,setStatus]=useState(''),[page,setPage]=useState(1),[query,setQuery]=useState(''),[search,setSearch]=useState('')
  const [listLoading,setListLoading]=useState(true),[listError,setListError]=useState('')
  const [draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[olderBusy,setOlderBusy]=useState(false),[hasOlder,setHasOlder]=useState(false),[revision,setRevision]=useState(0)
  const bottom=useRef<HTMLDivElement>(null),key=useRef(newId()),currentId=useRef(selectedId),cursor=useRef(0),pending=useRef(false),seen=useRef(new Map<string,number>()),firstList=useRef(true)
  const replyFlight=useRef(''),composing=useRef(false)
  const [actionBusy,setActionBusy]=useState(false),[endConfirm,setEndConfirm]=useState(false)
  const actionFlight=useRef(false),threadEpoch=useRef(0)
  currentId.current=selectedId
  useEffect(()=>{setRows([]);setSelectedId('');setPage(1);setListLoading(true);setListError('');seen.current.clear();firstList.current=true},[ctx.store,status,search])
  useEffect(()=>{
    let alive=true,timer:ReturnType<typeof setTimeout>
    async function poll(){
      if(document.hidden){timer=setTimeout(()=>void poll(),10000);return}
      try{
        setListLoading(true)
        const q=new URLSearchParams({storeId:ctx.store,status,q:search,page:String(page)})
        const r=await api(`/api/admin/chats?${q}`)
        if(!alive)return
        setRows(r.items);setTotal(r.total);setUnread(r.unreadTotal);setListError('')
        if(r.page&&r.page!==page)setPage(r.page)
        setSelectedId(id=>id||r.items[0]?.id||'')
        if(!firstList.current&&desktopAllowed(ctx.me.id))for(const c of r.items){
          const previous=seen.current.get(c.id)||0
          if(c.lastSeq>previous&&c.unread>0&&currentId.current!==c.id){
            const notification=new Notification(`裕和堂 · ${c.storeName||'总部客服'}`,{body:`${c.displayName}：${c.lastPreview}`,tag:`chat-${c.id}`})
            notification.onclick=()=>{window.focus();setSelectedId(c.id)}
          }
        }
        for(const c of r.items)seen.current.set(c.id,c.lastSeq)
        firstList.current=false
      }catch(e){if(alive)setListError((e as Error).message)}
      finally{if(alive){setListLoading(false);timer=setTimeout(()=>void poll(),5000+Math.random()*1000)}}
    }
    void poll();return()=>{alive=false;clearTimeout(timer)}
  },[ctx.store,status,search,page,revision])
  useEffect(()=>{
    let alive=true,timer:ReturnType<typeof setTimeout>
    threadEpoch.current++;setActionBusy(false);setEndConfirm(false);actionFlight.current=false
    setSelected(null);setMessages([]);setDraft('');setBusy(false);setError('');setHasOlder(false);setOlderBusy(false);key.current=newId();cursor.current=0;pending.current=false;replyFlight.current='';composing.current=false
    if(!selectedId)return
    async function poll(){
      if(document.hidden){timer=setTimeout(()=>void poll(),10000);return}
      try{
        const after=pending.current?0:cursor.current
        const epoch=threadEpoch.current,r=await api(`/api/admin/chats/${selectedId}/messages?after=${after}`)
        if(!alive||epoch!==threadEpoch.current)return
        setSelected(r.conversation);setMessages(old=>merge(old,r.items));pending.current=r.items.some((m:Row)=>m.deliveryStatus==='SENDING')
        if(cursor.current===0)setHasOlder(r.items.length===100)
        const last=r.items.at(-1)
        if(last){cursor.current=Math.max(cursor.current,last.seq);await api(`/api/admin/chats/${selectedId}/read`,{method:'PATCH',body:JSON.stringify({throughSeq:last.seq})})}
      }catch(e){if(alive)setError((e as Error).message)}
      finally{if(alive)timer=setTimeout(()=>void poll(),5000+Math.random()*1000)}
    }
    void poll();return()=>{alive=false;clearTimeout(timer)}
  },[selectedId])
  useEffect(()=>{if(!olderBusy)bottom.current?.scrollIntoView({block:'nearest'})},[messages.at(-1)?.id])
  async function older(){
    if(olderBusy||!messages.length)return
    const id=selectedId;setOlderBusy(true)
    try{const r=await api(`/api/admin/chats/${id}/messages?before=${messages[0].seq}`);if(currentId.current===id){setMessages(old=>merge(old,r.items));setHasOlder(r.items.length===100)}}
    catch(e){if(currentId.current===id)setError((e as Error).message)}finally{if(currentId.current===id)setOlderBusy(false)}
  }
  function replyKeyDown(e:KeyboardEvent<HTMLTextAreaElement>){
    if(e.key!=='Enter'||e.shiftKey||composing.current||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return
    e.preventDefault()
    if(!e.repeat)e.currentTarget.form?.requestSubmit()
  }
  async function reply(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(!canReply||actionFlight.current||busy||replyFlight.current||!draft.trim()||composing.current)return
    const id=selectedId,clientKey=key.current,form=e.currentTarget;replyFlight.current=clientKey;setBusy(true);setError('')
    try{
      const result=await api<Row>(`/api/admin/chats/${id}/messages`,{method:'POST',body:JSON.stringify({content:draft,clientKey})})
      if(currentId.current!==id)return
      setMessages(old=>merge(old,[result]));setDraft('');key.current=newId();setRevision(v=>v+1)
      if(result.deliveryStatus==='FAILED'||result.deliveryStatus==='UNKNOWN')setError(result.errorMessage||'微信暂未确认发送结果，请核实后再继续。')
    }catch(e){if(currentId.current===id)setError((e as Error).message)}finally{
      if(replyFlight.current===clientKey){
        replyFlight.current=''
        if(currentId.current===id){
          setBusy(false)
          if(form.isConnected&&(document.activeElement===document.body||form.contains(document.activeElement)))form.querySelector('textarea')?.focus()
        }
      }
    }
  }
  async function reception(action:'accept'|'end'|'release'){
    if(!selected||busy||actionFlight.current)return
    const id=selectedId,epoch=++threadEpoch.current;actionFlight.current=true;setActionBusy(true);setError('')
    try{
      const c=await api<Row>(`/api/admin/chats/${id}/${action}`,{method:'POST'})
      if(currentId.current===id&&threadEpoch.current===epoch){setSelected(c);setDraft('');setEndConfirm(false);key.current=newId();setRevision(v=>v+1)}
    }catch(e){
      if(currentId.current===id&&threadEpoch.current===epoch){
        setError((e as Error).message)
        try{const r=await api(`/api/admin/chats/${id}/messages?after=${cursor.current}`);if(currentId.current===id&&threadEpoch.current===epoch)setSelected(r.conversation)}catch{/* Keep the actionable error. */}
      }
    }finally{if(currentId.current===id&&threadEpoch.current===epoch){actionFlight.current=false;setActionBusy(false)}}
  }
  async function route(storeId:string){
    if(!storeId)return
    try{await api(`/api/admin/chats/${selectedId}/route`,{method:'PATCH',body:JSON.stringify({storeId})});setSelectedId('');setRevision(v=>v+1)}catch(e){setError((e as Error).message)}
  }
  async function downloadImage(m:Row){
    try{
      const response=await fetch(`/api/admin/chats/${selectedId}/messages/${m.id}/image`,{headers:{Authorization:`Bearer ${sessionStorage.getItem('yht-admin-token')}`}})
      if(!response.ok)throw new Error('图片暂时无法下载，微信临时素材可能已过期。')
      const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=`客户图片-${m.id}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)
    }catch(e){setError((e as Error).message)}
  }
  const canReply=ctx.can('chat:reply')&&!!selected&&selected.status==='ACTIVE'&&selected.assignedAdminId===ctx.me.id&&selected.canReply===true&&!actionBusy
  const sessionNote=!selected?'':selected.status==='RESOLVED'?`本次会话已结束${selected.endedAt?' · '+displayTime(selected.endedAt):''}，仅保留历史记录。客户再次咨询时需接入新会话。`:selected.status==='ACTIVE'?`当前接待：${selected.assignedAdminName||'门店客服'}${selected.assignedAdminId===ctx.me.id?'（我）':'。其他同事可查看记录，由接待人回复。'}`:'等待客服接入，接入后才可回复。'
  return <section className="ops-card chat-inbox">
    <div className="card-heading"><div><h3>门店客户会话</h3><p>自动同步在线咨询与微信原生客服消息，按接待门店处理。</p></div><div className="button-row">{'Notification'in window&&Notification.permission==='default'&&<ActionButton className="a-secondary" onClick={()=>{setDesktopEnabled(ctx.me.id,true);void Notification.requestPermission()}}>开启桌面新消息提醒</ActionButton>}<ActionButton className="a-secondary" onClick={()=>setRevision(v=>v+1)} aria-label="刷新会话"><RefreshCw size={15}/></ActionButton></div></div>
    <div className="chat-filters"><SelectInput aria-label="会话状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="OPEN">待接入</option><option value="ACTIVE">接待中</option><option value="RESOLVED">已结束</option><option value="">全部状态</option></SelectInput>{ctx.me.hq&&<SelectInput aria-label="客服门店范围" value={ctx.store} onChange={e=>ctx.setStore(e.target.value)}><option value="">全部门店</option>{ctx.stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput>}<form onSubmit={e=>{e.preventDefault();setSearch(query.trim())}}><TextInput aria-label="搜索客户会话" value={query} onChange={e=>setQuery(e.target.value)} placeholder="客户称呼 / 消息内容"/><ActionButton className="a-secondary">搜索</ActionButton></form><span>{unread} 条未读 · 共 {total} 个会话</span></div>
    {listError&&<div className="chat-list-error" role="alert"><span>会话列表加载失败：{listError}</span><ActionButton className="a-secondary" onClick={()=>setRevision(v=>v+1)}>重新加载会话</ActionButton></div>}
    <div className="chat-workspace"><aside className="chat-list"><div className="chat-list-scroll" aria-label="客户会话列表" aria-busy={listLoading}>{rows.map(r=><ActionButton layout="card" key={r.id} className={`chat-list-item ${selectedId===r.id?'active':''}`} onClick={()=>setSelectedId(r.id)}><span className="chat-list-title"><strong>{r.displayName||'微信客户'}</strong>{r.unread>0&&<i>{r.unread}</i>}</span><small>{stateLabel(r.status)} · {r.assignedAdminName||'未分配接待人'} · {r.channel==='WECHAT'?'微信客服':'在线客服'} · {r.storeName||'总部待分配'}</small><span>{r.lastPreview||'客户已进入咨询，等待发送消息'}</span><small>{displayTime(r.updatedAt)}</small></ActionButton>)}{!rows.length&&<p className="chat-blank">{listLoading?'正在同步客户会话…':listError?'暂时无法读取会话，请重新加载。':total===0&&(search||status||ctx.store)?'当前筛选范围内暂无会话，可切换门店或清除筛选。':'暂无会话。客户发来咨询后，会显示在这里。'}</p>}</div><div className="chat-pagination"><ActionButton className="a-secondary" disabled={page<=1} onClick={()=>setPage(v=>v-1)}>上一页</ActionButton><span>{page} / {Math.max(1,Math.ceil(total/30))}</span><ActionButton className="a-secondary" disabled={page*30>=total} onClick={()=>setPage(v=>v+1)}>下一页</ActionButton></div></aside>
      <section className="chat-thread">{selected?<><header><div><strong>{selected.displayName} · {selected.storeName}</strong><small>{selected.channel==='WECHAT'?'微信小程序客服':'小程序在线客服'} · {stateLabel(selected.status)}</small></div><div className="button-row">{ctx.can('chat:reply')&&selected.canAccept&&<ActionButton className="a-primary" disabled={busy||actionBusy} onClick={()=>void reception('accept')}>{actionBusy?'正在接入…':'接入会话'}</ActionButton>}{selected.canEnd&&<ActionButton className="a-secondary" disabled={busy||actionBusy} onClick={()=>setEndConfirm(true)}>结束对话</ActionButton>}{selected.canRelease&&<ActionButton className="a-secondary" disabled={busy||actionBusy} onClick={()=>void reception('release')}>退回待接入</ActionButton>}{ctx.me.hq&&ctx.can('chat:route')&&!selected.storeId&&selected.status==='OPEN'&&<SelectInput aria-label="转交门店" value="" onChange={e=>void route(e.target.value)}><option value="">转交门店</option>{ctx.stores.filter(s=>s.enabled).map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</SelectInput>}</div></header>
      <p className={`chat-session-note ${selected.status.toLowerCase()}`} role="status">{sessionNote}</p>{endConfirm&&<div className="chat-end-confirm" role="group" aria-label="确认结束会话"><span>结束后将停止接待，保留本次聊天记录。</span><ActionButton className="a-secondary" disabled={actionBusy} onClick={()=>setEndConfirm(false)}>暂不结束</ActionButton><ActionButton className="a-primary" disabled={actionBusy||busy} onClick={()=>void reception('end')}>确认结束</ActionButton></div>}
      {selected.channel==='WECHAT'&&selected.status!=='RESOLVED'&&<p className="chat-window-note">{!selected.activeRoute?'客户已切换咨询门店，请由当前接待门店回复。':selected.replyDeadline>Date.now()/1000?`微信可回复 ${selected.replyRemaining} 条，窗口截止 ${displayTime(new Date(selected.replyDeadline*1000).toISOString())}。`:'微信回复窗口已关闭，请等待客户再次发消息。'}</p>}
      <div className="chat-messages" aria-live="polite">{hasOlder&&<ActionButton className="a-link chat-history" disabled={olderBusy} onClick={()=>void older()}>{olderBusy?'正在加载…':'查看更早消息'}</ActionButton>}{messages.map(m=><article className={`chat-bubble ${m.direction==='IN'?'incoming':''}`} key={m.id}><small>{m.direction==='IN'?selected.displayName:m.senderName} · {displayTime(m.createdAt)}</small><p>{m.content}</p>{m.kind==='image'&&<ActionButton className="a-link" onClick={()=>void downloadImage(m)}>下载客户图片</ActionButton>}{m.deliveryStatus!=='SENT'&&m.deliveryStatus!=='RECEIVED'&&<em>{m.deliveryStatus==='SENDING'?'发送中':m.errorMessage||(m.deliveryStatus==='UNKNOWN'?'发送结果待核实，请先确认客户是否收到。':'发送失败')}</em>}</article>)}<div ref={bottom}/></div>
      <form className="chat-reply" onSubmit={reply}><div className="chat-reply-editor"><TextArea aria-label="回复消息" aria-describedby="chat-reply-hint" maxLength={2000} disabled={!canReply} readOnly={busy} value={draft} onKeyDown={replyKeyDown} onCompositionStart={()=>{composing.current=true}} onCompositionEnd={()=>{composing.current=false}} onChange={e=>{setDraft(e.target.value);key.current=newId()}} placeholder={canReply?'输入回复内容…':ctx.can('chat:reply')?selected.status==='RESOLVED'?'会话已结束，仅可查看历史记录。':selected.status==='OPEN'?'请先点击“接入会话”。':selected.assignedAdminId!==ctx.me.id?'该会话由其他客服接待。':'微信回复窗口不可用，请等待客户再次发消息。':'当前账号可查看会话，请联系有回复权限的同事处理。'}/><small id="chat-reply-hint" className="chat-reply-hint">Enter 发送，Shift+Enter 换行</small></div><ActionButton className="a-primary" disabled={busy||!draft.trim()||!canReply}><Send size={16}/>{busy?'发送中…':'发送'}</ActionButton></form></>:<div className="chat-blank"><MessageCircle size={30}/><p>{selectedId?(error?'会话内容加载失败，请稍后重试。':'正在加载会话…'):'选择左侧会话查看和回复客户。'}</p></div>}</section>
    </div>{error&&<p className="admin-error" role="alert">{error}</p>}
  </section>
}
