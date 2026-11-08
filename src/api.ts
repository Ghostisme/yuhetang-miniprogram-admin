import {useEffect,useState} from 'react'
import type {Site} from './types'
import {startPolling} from './polling'
export const newId=()=>globalThis.crypto?.randomUUID?.()||Array.from(globalThis.crypto.getRandomValues(new Uint8Array(20)),n=>n.toString(16).padStart(2,'0')).join('')
const pending=new Map<string,Promise<unknown>>()
const cooldown=new Map<string,number>()
type ApiOptions=RequestInit&{timeoutMs?:number;timeoutMessage?:string}
export function api<T=any>(path:string,input:ApiOptions={}):Promise<T>{
  const {timeoutMs=20000,timeoutMessage='请求超时，请检查预约列表后使用原提交标识重试。',...options}=input
  const admin=path.startsWith('/api/admin/'),token=sessionStorage.getItem(admin?'yht-admin-token':'yht-customer-token')||'',headers=new Headers(options.headers)
  const read=!options.method||options.method==='GET',key=token+'|'+path
  if(read&&!options.signal&&pending.has(key))return pending.get(key) as Promise<T>
  if((cooldown.get(path)||0)>Date.now())return Promise.reject(new Error('当前访问较多，请稍后重试。'))
  const task=(async()=>{
    if(options.body&&!(options.body instanceof FormData))headers.set('Content-Type','application/json')
    if(token)headers.set('Authorization',`Bearer ${token}`)
    const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,timeoutMs)
    options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted)controller.abort()
    try{
      const r=await fetch(path,{...options,headers,signal:controller.signal})
      if(!r.ok){
        if(r.status===429||r.status===503){if(cooldown.size>200)cooldown.clear();cooldown.set(path,Date.now()+Math.min(60000,Math.max(2,Number(r.headers.get('Retry-After'))||3))*1000)}
        const b=await r.json().catch(()=>({message:'服务暂不可用，请稍后重试。'}))
        if(r.status===401&&!admin)sessionStorage.removeItem('yht-customer-token')
        if(r.status===401&&admin&&!path.endsWith('/login')){sessionStorage.removeItem('yht-admin-token');window.dispatchEvent(new Event('yht-session-expired'))}
        throw new Error(b.message||`操作未完成（${r.status}）`)
      }
      return await r.json() as T
    }catch(e){if((e as Error).name==='AbortError')throw new Error(timeoutMessage);throw e}
    finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort)}
  })()
  if(read&&!options.signal){pending.set(key,task);void task.finally(()=>{if(pending.get(key)===task)pending.delete(key)}).catch(()=>{})}
  return task
}
export async function customerLogin(){if(sessionStorage.getItem('yht-customer-token'))return;const config=await api('/api/runtime');if(!config.developmentLogin)throw new Error('请在微信小程序中登录预约。此网页仅供页面预览。');let device=localStorage.getItem('yht-device');if(!device){device=newId();localStorage.setItem('yht-device',device)}const r=await api('/api/auth/dev-customer',{method:'POST',body:JSON.stringify({deviceId:device})});sessionStorage.setItem('yht-customer-token',r.token)}
let currentSite:Site|null=null
const siteListeners=new Set<(site:Site)=>void>()
let sitePolling:(()=>void)|undefined
async function refreshSite(){const site=await api<Site>('/api/site');currentSite=site;for(const listener of siteListeners)listener(site)}
export function useSite(){
  const [site,setSite]=useState<Site|null>(currentSite),[error,setError]=useState('')
  async function refresh(){try{await refreshSite();setError('')}catch(e){setError((e as Error).message)}}
  useEffect(()=>{
    const listener=(next:Site)=>{setSite(next);setError('')};siteListeners.add(listener)
    if(!sitePolling)sitePolling=startPolling(refresh,60000)
    return()=>{siteListeners.delete(listener);if(!siteListeners.size){sitePolling?.();sitePolling=undefined}}
  },[])
  return {site,error,refresh}
}
export const clone=<T,>(v:T):T=>structuredClone(v)
export const dateInput=(offset=0)=>{const date=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Shanghai'}));date.setDate(date.getDate()+offset);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
export const displayTime=(s:string)=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})
export const statusLabels:Record<string,string>={PENDING:'待门店确认',CONFIRMED:'门店已确认',ARRIVED:'已到店',COMPLETED:'已完成',CANCELLED:'已取消',NO_SHOW:'未到店'}
export const claimLabels:Record<string,string>={YES:'是',NO:'否',UNKNOWN:'不确定'}
