import React from 'react'
import {createRoot} from 'react-dom/client'
import {ArrowUpRight,Leaf} from 'lucide-react'
import MiniProgram from './MiniProgram'
import Admin from './Admin'
import {useSite} from './api'
import './brand.css'
import './app.css'

function App(){
  const {site,error}=useSite()
  if(location.pathname.startsWith('/admin'))return <Admin/>
  if(!site)return <div className="loading-screen"><Leaf size={36}/><h2>裕和堂</h2><p>{error||'为您准备一段从容时光…'}</p></div>
  return <div className="client-stage"><aside className="client-intro"><span>YU HE TANG / WELLNESS & CARE</span><h1>把时间<br/>留给自己。</h1><p>东方养护，自在有和。<br/>从一次预约，走向更轻松的日常。</p><div className="intro-rule"/><small>在线申请 · 门店确认 · 安心到店</small><a href="/admin" target="_blank" rel="noreferrer">进入门店管理后台 <ArrowUpRight size={16}/></a></aside><main className="client-device"><MiniProgram site={site}/></main><aside className="client-footnote"><span>01 — 一段身心的留白</span><p>轻量预约，无需在线支付。<br/>所有接待安排均由门店人工确认。</p><span>微信小程序界面 · 本地 H5 联调预览</span></aside></div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
