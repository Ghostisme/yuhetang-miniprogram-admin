import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {Pagination} from 'antd'
import {Bell,CheckCheck} from 'lucide-react'
import {api,displayTime} from './api'
import {startPolling} from './polling'
import {inboxChanged,type InboxSummary} from './use-admin-notifications'
import {ActionButton} from './components/AdminControls'
import type {Ctx} from './Admin'
import type {Row} from './types'

export default function InboxMessages({ctx,compact=false}:{ctx:Ctx;compact?:boolean}){
  const [data,setData]=useState<InboxSummary>({items:[],total:0,unreadTotal:0,asOf:''}),[page,setPage]=useState(1),[unread,setUnread]=useState(false),[revision,setRevision]=useState(0),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const list=useRef<HTMLDivElement>(null)
  useLayoutEffect(()=>{list.current?.scrollTo({top:0,left:0})},[page,unread,ctx.store])
  useEffect(()=>{
    let alive=true
    const stop=startPolling(async()=>{
      try{const next=await api<InboxSummary>(`/api/admin/inbox/summary?${new URLSearchParams({storeId:ctx.store,page:String(page),unreadOnly:String(unread)})}`);if(alive){setData(next);setError('')}}
      catch(e){if(alive)setError((e as Error).message);throw e}
    },30000)
    return()=>{alive=false;stop()}
  },[ctx.store,page,unread,revision])
  async function read(row?:Row){
    setBusy(true)
    try{
      await api(`/api/admin/inbox/${row?'read':'read-all'}`,{method:'POST',body:JSON.stringify(row?{ids:[row.id]}:{storeId:ctx.store,asOf:data.asOf})})
      inboxChanged();setRevision(v=>v+1);if(row)ctx.openNotification?.(row)
    }catch(e){setError((e as Error).message)}finally{setBusy(false)}
  }
  return <section className="ops-card personal-inbox" aria-label="本账号站内消息">
    <div className="card-heading"><div><h3>{compact?'站内消息':'本账号站内消息'} <span className="inbox-count">{data.unreadTotal} 未读</span></h3><p>已读状态按账号保存，不影响其他同事；客户咨询在“客户沟通”中接待。</p></div><ActionButton className="a-secondary" aria-label="当前门店范围全部已读" disabled={busy||!data.unreadTotal||!data.asOf} onClick={()=>void read()}><CheckCheck size={15}/>{compact?'全部已读':'当前门店范围全部已读'}</ActionButton></div>
    <div className="segmented"><ActionButton className={!unread?'active':''} onClick={()=>{setUnread(false);setPage(1)}}>全部站内消息</ActionButton><ActionButton className={unread?'active':''} onClick={()=>{setUnread(true);setPage(1)}}>只看未读</ActionButton></div>
    {error&&<p className="admin-error" role="alert">{error}</p>}
    <div ref={list} className="personal-inbox-list" role="region" aria-label="本账号站内消息列表" tabIndex={0}>{data.items.map(row=><div className={`personal-message ${row.isRead?'read':'unread'}`} key={row.id}><Bell size={17}/><div><strong>{row.eventLabel} · {row.payload.storeName}</strong><p>{row.payload.serviceName} · {row.payload.time}</p><small>{displayTime(row.createdAt)} · {row.isRead?'已读':'未读'}</small></div><ActionButton className="a-link" disabled={busy} onClick={()=>void read(row)}>{ctx.can('appointments:read')?'查看预约':'标记已读'}</ActionButton></div>)}
      {!data.items.length&&<div className="inbox-empty">{unread?'当前范围没有未读站内消息。':'暂无站内通知，新预约和状态变化后会生成记录。'}</div>}
    </div>
    <div className="pager"><Pagination current={page} pageSize={20} total={data.total} size="small" simple={compact?{readOnly:true}:false} showLessItems showSizeChanger={false} onChange={setPage}/></div>
  </section>
}
