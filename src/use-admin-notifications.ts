import {useEffect,useRef,useState} from 'react'
import {api} from './api'
import {startPolling} from './polling'
import {showDesktop} from './desktop-notifications'
import type {AdminIdentity,Row} from './types'

export type InboxSummary={items:Row[];total:number;unreadTotal:number;asOf:string}
const empty:InboxSummary={items:[],total:0,unreadTotal:0,asOf:''}
export const inboxChanged=()=>window.dispatchEvent(new Event('yht-inbox-changed'))

export function useAdminNotifications(me:AdminIdentity|null,activeTab:string,openMessage:(row:Row)=>void,openChats:()=>void){
  const [inbox,setInbox]=useState<InboxSummary>(empty),[chatUnread,setChatUnread]=useState(0),[error,setError]=useState(''),[checked,setChecked]=useState('')
  const latest=useRef({activeTab,openMessage,openChats});latest.current={activeTab,openMessage,openChats}
  useEffect(()=>{
    setInbox(empty);setChatUnread(0);setError('');setChecked('')
    if(!me)return
    let alive=true,first=true,seen=new Set<string>(),lastChatSeq:number|null=null,running=false,startedAt=0
    async function poll(){
      if(!me||running)return
      running=true
      try{
        const [messages,chat]=await Promise.all([
          me.permissions.includes('notifications:read')?api<InboxSummary>('/api/admin/inbox/summary?unreadOnly=true'):Promise.resolve(empty),
          me.permissions.includes('chat:read')?api<{unreadTotal:number;latestSeq:number}>('/api/admin/chats/unread'):Promise.resolve({unreadTotal:0,latestSeq:0}),
        ])
        if(!alive)return
        setInbox(messages);setChatUnread(chat.unreadTotal);setError('');setChecked(new Date().toISOString())
        if(first)startedAt=Date.parse(messages.asOf)||Date.now()
        if(!first)for(const row of messages.items){if(!seen.has(row.id)&&Date.parse(row.createdAt)>startedAt)void showDesktop(me.id,`inbox:${row.id}`,'裕和堂 · '+row.eventLabel,{body:`${row.payload.storeName} · ${row.payload.time}\n请进入后台查看预约。`},()=>latest.current.openMessage(row))}
        if(lastChatSeq!==null&&chat.latestSeq>lastChatSeq&&(document.hidden||latest.current.activeTab!=='chats'))void showDesktop(me.id,`chat:${chat.latestSeq}`,'裕和堂 · 新客户咨询',{body:'有新的客户消息，请进入客户沟通接待。'},()=>latest.current.openChats())
        first=false;seen=new Set(messages.items.map(row=>row.id));lastChatSeq=chat.latestSeq
      }catch(e){if(alive)setError((e as Error).message);throw e}
      finally{running=false}
    }
    if(!me.permissions.some(p=>['notifications:read','chat:read'].includes(p)))return
    const stop=startPolling(poll,15000,{background:true,hiddenInterval:30000})
    const changed=()=>{void poll().catch(()=>{})}
    window.addEventListener('yht-inbox-changed',changed)
    return()=>{alive=false;stop();window.removeEventListener('yht-inbox-changed',changed)}
  },[me?.id])
  async function read(row:Row){await api('/api/admin/inbox/read',{method:'POST',body:JSON.stringify({ids:[row.id]})});inboxChanged()}
  async function readAll(){if(!inbox.asOf)return;await api('/api/admin/inbox/read-all',{method:'POST',body:JSON.stringify({asOf:inbox.asOf})});inboxChanged()}
  return {inbox,chatUnread,error,checked,read,readAll,refresh:inboxChanged}
}
