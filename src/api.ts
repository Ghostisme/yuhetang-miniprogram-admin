import {useEffect,useState} from 'react'
import type {Site} from './types'
export const newId=()=>globalThis.crypto?.randomUUID?.()||Array.from(globalThis.crypto.getRandomValues(new Uint8Array(20)),n=>n.toString(16).padStart(2,'0')).join('')
export async function api<T=any>(path:string,options:RequestInit={}):Promise<T>{
  const admin=path.startsWith('/api/admin/'),token=sessionStorage.getItem(admin?'yht-admin-token':'yht-customer-token'),headers=new Headers(options.headers)
  if(options.body&&!(options.body instanceof FormData))headers.set('Content-Type','application/json')
  if(token)headers.set('Authorization',`Bearer ${token}`)
  const r=await fetch(path,{...options,headers})
  if(!r.ok){const b=await r.json().catch(()=>({message:'服务暂不可用，请稍后重试。'}));if(r.status===401&&!admin)sessionStorage.removeItem('yht-customer-token');if(r.status===401&&admin&&!path.endsWith('/login')){sessionStorage.removeItem('yht-admin-token');window.dispatchEvent(new Event('yht-session-expired'))}throw new Error(b.message||`操作未完成（${r.status}）`)}
  return r.json()
}
export async function customerLogin(){if(sessionStorage.getItem('yht-customer-token'))return;const config=await api('/api/runtime');if(!config.developmentLogin)throw new Error('请在微信小程序中登录预约。此网页仅供页面预览。');let device=localStorage.getItem('yht-device');if(!device){device=newId();localStorage.setItem('yht-device',device)}const r=await api('/api/auth/dev-customer',{method:'POST',body:JSON.stringify({deviceId:device})});sessionStorage.setItem('yht-customer-token',r.token)}
export function useSite(){const [site,setSite]=useState<Site|null>(null),[error,setError]=useState('');async function refresh(){try{const s=await api<Site>('/api/site');setSite(s);setError('')}catch(e){setError((e as Error).message)}}useEffect(()=>{void refresh();const t=setInterval(refresh,10000);return()=>clearInterval(t)},[]);return {site,error,refresh}}
export const clone=<T,>(v:T):T=>structuredClone(v)
export const dateInput=(offset=0)=>{const date=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Shanghai'}));date.setDate(date.getDate()+offset);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
export const displayTime=(s:string)=>new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})
export const statusLabels:Record<string,string>={PENDING:'待门店确认',CONFIRMED:'门店已确认',ARRIVED:'已到店',COMPLETED:'已完成',CANCELLED:'已取消',NO_SHOW:'未到店'}
export const claimLabels:Record<string,string>={YES:'是',NO:'否',UNKNOWN:'不确定'}
