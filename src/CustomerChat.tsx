import {useEffect,useRef,useState,type FormEvent} from 'react'
import {ArrowLeft,MessageCircle,Send,X} from 'lucide-react'
import {api,customerLogin,displayTime,newId} from './api'
import type {Row,StoreItem} from './types'
import './service-chat.css'

const merge=(old:Row[],incoming:Row[])=>Array.from(new Map([...old,...incoming].map(m=>[m.id,m])).values()).sort((a,b)=>a.seq-b.seq)

export default function CustomerChat({stores,initialStore,onClose}:{stores:StoreItem[];initialStore?:string;onClose:()=>void}){
  const [store,setStore]=useState(initialStore||''),[conversation,setConversation]=useState<Row|null>(null),[messages,setMessages]=useState<Row[]>([]),[draft,setDraft]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[hasOlder,setHasOlder]=useState(false),[olderBusy,setOlderBusy]=useState(false)
  const bottom=useRef<HTMLDivElement>(null),sendKey=useRef(newId()),generation=useRef(0),cursor=useRef(0)
  useEffect(()=>{
    const version=++generation.current;let timer:ReturnType<typeof setTimeout>
    setConversation(null);setMessages([]);setError('');setHasOlder(false);setOlderBusy(false);setBusy(false);cursor.current=0
    async function poll(id:string){
      if(document.hidden){timer=setTimeout(()=>void poll(id),10000);return}
      try{const r=await api(`/api/me/chats/${id}/messages?after=${cursor.current}`);if(generation.current!==version)return;if(cursor.current===0)setHasOlder(r.items.length===100);setMessages(old=>merge(old,r.items));const last=r.items.at(-1);if(last)cursor.current=Math.max(cursor.current,last.seq)}
      catch(e){if(generation.current===version)setError((e as Error).message)}
      finally{if(generation.current===version)timer=setTimeout(()=>void poll(id),5000+Math.random()*1000)}
    }
    async function open(){try{await customerLogin();const c=await api('/api/me/chats',{method:'POST',body:JSON.stringify({storeId:store})});if(generation.current===version){setConversation(c);void poll(c.id)}}catch(e){if(generation.current===version)setError((e as Error).message)}}
    void open();return()=>{generation.current++;clearTimeout(timer)}
  },[store])
  useEffect(()=>{if(!olderBusy)bottom.current?.scrollIntoView({block:'nearest'})},[messages.at(-1)?.id])
  async function older(){if(!conversation||olderBusy)return;const version=generation.current;setOlderBusy(true);try{const r=await api(`/api/me/chats/${conversation.id}/messages?before=${messages[0].seq}`);if(generation.current===version){setMessages(old=>merge(old,r.items));setHasOlder(r.items.length===100)}}catch(e){if(generation.current===version)setError((e as Error).message)}finally{if(generation.current===version)setOlderBusy(false)}}
  async function send(e:FormEvent){e.preventDefault();if(!conversation||busy||!draft.trim())return;const version=generation.current;setBusy(true);setError('');try{await api(`/api/me/chats/${conversation.id}/messages`,{method:'POST',body:JSON.stringify({content:draft,clientKey:sendKey.current})});if(generation.current!==version)return;setDraft('');sendKey.current=newId();const r=await api(`/api/me/chats/${conversation.id}/messages?after=${cursor.current}`);if(generation.current===version){setMessages(old=>merge(old,r.items));const last=r.items.at(-1);if(last)cursor.current=Math.max(cursor.current,last.seq)}}catch(e){if(generation.current===version)setError((e as Error).message)}finally{if(generation.current===version)setBusy(false)}}
  return <div className="contact-backdrop"><section className="customer-chat" role="dialog" aria-modal="true" aria-label="联系门店客服"><header><button aria-label="关闭客服" onClick={onClose}><ArrowLeft size={18}/></button><div><strong>裕和堂 · 贴心客服</strong><small>人工回复，请稍候</small></div><button aria-label="关闭" onClick={onClose}><X size={18}/></button></header><label className="customer-chat-store">咨询门店<select aria-label="咨询门店" disabled={busy} value={store} onChange={e=>{setStore(e.target.value);setDraft('');sendKey.current=newId()}}><option value="">品牌客服 · 总部接待</option>{stores.filter(s=>s.enabled).map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></label><div className="customer-chat-note"><MessageCircle size={16}/><span>欢迎咨询养护和到店安排，客服回复会显示在这里。</span></div><div className="customer-chat-messages" aria-live="polite">{hasOlder&&<button className="text-link chat-history" disabled={olderBusy} onClick={()=>void older()}>查看更早消息</button>}{conversation&&!messages.length&&<p className="chat-empty">您好，请问有什么可以帮您？</p>}{!conversation&&!error&&<p className="chat-empty">正在连接门店客服…</p>}{messages.map(m=><div key={m.id} className={`customer-message ${m.direction==='IN'?'mine':''}`}><small>{m.direction==='IN'?'我':m.senderName} · {displayTime(m.createdAt)}</small><p>{m.content}</p></div>)}<div ref={bottom}/></div>{error&&<p className="form-error" role="alert">{error}</p>}<form className="chat-compose" onSubmit={send}><textarea aria-label="咨询内容" disabled={busy} value={draft} maxLength={2000} onChange={e=>{setDraft(e.target.value);sendKey.current=newId()}} placeholder="请填写您想咨询的内容…"/><button className="primary" disabled={busy||!conversation||!draft.trim()}><Send size={17}/>{busy?'发送中':'发送'}</button></form>{stores.find(s=>s.id===store)?.phone&&<a className="customer-chat-phone" href={`tel:${stores.find(s=>s.id===store)?.phone}`}>急需联系？拨打门店电话</a>}</section></div>
}
