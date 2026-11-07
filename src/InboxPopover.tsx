import {useState} from 'react'
import {CheckCheck,RefreshCw,X} from 'lucide-react'
import {ActionButton} from './components/AdminControls'
import {displayTime} from './api'
import type {Row} from './types'
import type {InboxSummary} from './use-admin-notifications'

export default function InboxPopover({inbox,chatUnread,error,checked,onReadAll,onRefresh,onOpen,onChats,onAll,onClose,onError}:{inbox:InboxSummary;chatUnread:number;error:string;checked:string;onReadAll:()=>Promise<void>;onRefresh:()=>void;onOpen:(row:Row)=>void;onChats:()=>void;onAll:()=>void;onClose:()=>void;onError:(error:string)=>void}){
  const [busy,setBusy]=useState(false)
  async function readAll(){setBusy(true);try{await onReadAll()}catch(e){onError((e as Error).message)}finally{setBusy(false)}}
  return <div className="inbox-popover" role="dialog" aria-label="后台未读消息">
    <header><div><h3>后台消息</h3><small>预约 {inbox.unreadTotal} 条未读 · 咨询 {chatUnread} 条</small></div><ActionButton aria-label="关闭消息" onClick={onClose}><X size={17}/></ActionButton></header>
    <div className="inbox-tools"><ActionButton className="a-link" disabled={busy||!inbox.unreadTotal} onClick={()=>void readAll()}><CheckCheck size={14}/>预约全部已读</ActionButton><ActionButton className="a-link" aria-label="刷新后台消息" onClick={onRefresh}><RefreshCw size={14}/>刷新</ActionButton></div>
    {error&&<p className="inbox-error" role="alert">消息同步暂时失败，正在重试；已显示的消息仍可查看。</p>}
    <div className="inbox-items">
      {chatUnread>0&&<ActionButton layout="card" className="chat-inbox-link" onClick={onChats}><strong>客户咨询 · {chatUnread} 条未读消息</strong><p>进入客户沟通接待 →</p></ActionButton>}
      {inbox.items.map(row=><ActionButton layout="card" key={row.id} onClick={()=>onOpen(row)}><strong>{row.eventLabel} · {row.payload.storeName}</strong><p>{row.payload.serviceName} · {row.payload.time}</p><small>{displayTime(row.createdAt)}</small></ActionButton>)}
      {!inbox.unreadTotal&&!chatUnread&&<p className="inbox-empty">消息都已查看，新的提醒会出现在这里。</p>}
    </div>
    <footer><small>{checked?`最近同步 ${displayTime(checked)}`:'正在同步消息…'}</small><ActionButton className="a-link" onClick={onAll}>查看消息中心 →</ActionButton></footer>
  </div>
}
