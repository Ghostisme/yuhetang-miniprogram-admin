import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {Tour,type TourProps} from 'antd'
import {CircleHelp} from 'lucide-react'
import {ActionButton} from './components/AdminControls'
import type {Ctx} from './Admin'
import './admin-guide.css'

type GuideStep={title:string;description:string;targets?:string[];permission?:string;hq?:boolean}
type Guide={name:string;steps:GuideStep[]}
const guides:Record<string,Guide>={
  appointments:{name:'预约管理',steps:[
    {title:"先选择接待范围",description:"在这里选择全部门店或某一家门店。门店账号只查看已授权范围内的预约。",targets:[".scope-control"]},
    {title:"找到需要处理的预约",description:"输入客户称呼、手机号或预约编号，再结合状态和到店日期筛选。改约申请可按“改约待处理”查找。",targets:[".table-filters .search-input",".table-filters"]},
    {title:"切换列表与时段视图",description:"预约列表适合逐条处理；当日时段视图用于核对接待安排。大众点评订单在核对映射后转为预约。",targets:[".card-heading .segmented",".segmented"]},
    {title:"打开详情，核对后再接待",description:"从“查看处理”进入详情，核对项目、人数、联系方式和调理师意向。客户提交后，仍需门店人工确认。",targets:[".appointment-card button",".appointment-table tbody tr button",".calendar-booking",".data-empty"]},
    {title:"确认后继续核对通知",description:"处理结果保存在预约详情中。客户通知的发送情况可到“消息中心”查看；平台受理后还需核对客户是否收到。",targets:[".review-banner",".card-heading"]},
  ]},
  customers:{name:'客户档案',steps:[
    {title:"先核对客户所属范围",description:"选择要查看的门店。客户微信登录并授权手机号后，系统会关联客户档案。",targets:[".scope-control"]},
    {title:"按身份与来源查找",description:"输入客户称呼或手机号，结合会员状态与来源查找。同一客户可同时具有小程序和大众点评标识。",targets:[".customer-filters input",".customer-filters"]},
    {title:"区分会员与登录状态",description:"列表显示会员、来源与资料完整状态。微信已登录不代表已是会员；完整电话仅对有权限的账号开放。",targets:[".customer-directory tbody tr .ant-tag",".customer-directory tbody tr td strong",".customer-directory .data-empty"]},
    {title:"从这里维护客户资料",description:"每行操作可进入档案、余额或消费记录，入口按角色权限显示。尚未迁入的历史资料需与门店核对。",targets:[".customer-row-actions button",".customer-row-actions span",".customer-directory .data-empty"]},
    {title:"批量资料先预检",description:"批量维护请到“资料导入”下载模板和示例，先预检再确认。会员基础资料不包含储值余额与历史消费。",targets:[".customer-directory .card-heading .button-row"],permission:'imports:write',hq:true},
  ]},
  chats:{name:'客户沟通',steps:[
    {title:"先查看等待接待的客户",description:"用状态筛选“待接入”“接待中”或“已结束”，也可按客户称呼、手机号和消息内容搜索。",targets:[".chat-filters .admin-select",".chat-filters"]},
    {title:"选择一条客户会话",description:"点击会话查看消息、门店与接待人。手机可通过“会话列表”返回；没有会话时，等待客户从小程序发起咨询。",targets:[".chat-list-item",".chat-list-scroll .chat-blank",".chat-mobile-back button",".chat-inbox .card-heading h3"]},
    {title:"接入后才开始正式接待",description:"有权限时点击“接入会话”后回复。其他人正在接待或已结束的会话会限制操作，避免重复接待。",targets:[".chat-accept",".chat-session-note",".chat-list-item",".chat-inbox .card-heading h3"]},
    {title:"核对身份，发送回复",description:"接入后核对称呼和手机号。Enter 发送，Shift＋Enter 换行；图片和视频从附件入口发送。微信回复受窗口与额度限制。",targets:[".chat-customer-identity",".chat-reply-editor",".chat-filters input",".chat-inbox .card-heading h3"]},
    {title:"完成后结束并保留记录",description:"问题解决后点击“结束对话”。历史记录仍可查看，新消息会显示未读提示，也可开启本浏览器桌面提醒。",targets:[".chat-thread header .button-row",".chat-inbox .card-heading .button-row"]},
  ]},
  stores:{name:'门店与时段',steps:[
    {title:"选择要维护的门店",description:"从这里选择门店，或点击下方门店卡片的“管理”按钮。每家店的资料、品项和预约规则独立维护。",targets:[".scope-control",".store-overview-card button",".settings-tabs"]},
    {title:"从门店资料开始",description:"进入门店后，在“门店资料”维护名称、地址、电话、营业时间和封面。相册可逐张增加、删除，完成后记得保存。",targets:[".settings-tabs button",".store-overview-card button"]},
    {title:"核对可预约的规则",description:"进入门店后切换“预约规则”，设置营业起止时间、时段间隔、人数和提前预约限制。规则维护需要对应权限。",targets:[".settings-tabs button:nth-child(2)",".store-overview-card .tag-row",".store-overview-card h3"],permission:'rules:write'},
    {title:"临时停约与名额单独设置",description:"“临时安排”用于某天或某时段的停约、名额调整。修改前先核对已有预约，再检查客户可选时段。",targets:[".settings-tabs button:nth-child(3)",".store-overview-card button"],permission:'rules:write'},
    {title:"开放前检查本店项目",description:"核实本店品项、接待人员与规则后再开放在线申请。展示营业时间是公开文案，可预约时段以实际规则为准。",targets:[".settings-profile-media .toggle-field",".store-overview-card .tag-row",".store-overview-card h3",".scope-control"]},
  ]},
  content:{name:'品牌与内容',steps:[
    {title:"品牌内容与门店项目分别维护",description:"全部门店范围用于品牌内容；切到具体门店后维护该店独立品项，修改不会自动同步到其他门店。",targets:[".scope-control"]},
    {title:"先选择内容板块",description:"在这里切换首页、养护项目、品牌好物和空间相册。先选择板块，再定位具体要编辑的条目。",targets:[".content-toolbar .segmented",".catalog-navigation"]},
    {title:"定位文案与图片",description:"按分组或条目定位内容。相册图片和养护步骤可用加号、减号逐条维护，图片可从素材中选用。",targets:[".content-section-tabs",".catalog-navigation",".content-form .admin-field"]},
    {title:"先保存，再核对发布",description:"品牌内容先保存草稿，再由有权限的账号发布；门店项目按保存提示生效。发布前核对图片、时长与上下架状态。",targets:[".content-toolbar .button-row",".content-toolbar"]},
    {title:"到客户侧确认实际效果",description:"保存或发布后，在小程序核对对应门店、项目和相册。只有查看权限的账号可以预览，不能保存或发布。",targets:[".content-toolbar .segmented",".scope-control"]},
  ]},
  notifications:{name:'消息中心',steps:[
    {title:"先确认消息发给谁",description:"客户消息用于预约处理和到店提醒；管理后台消息用于店长接单、站内与桌面提醒，两条链路分别核对。",targets:[".notification-audiences button[aria-pressed='true']",".notification-audiences"]},
    {title:"在这里切换记录与设置",description:"“通知记录”查看发送结果；“推送设置”核对渠道和门店接收人。管理后台消息还提供本账号站内消息。",targets:[".notification-view-tabs"]},
    {title:"按渠道与结果筛选",description:"选择渠道、发送状态与门店查找通知。列表内容独立滚动，筛选、刷新和分页保持可见。",targets:[".notification-filters .admin-select",".notification-channel-tabs",".personal-inbox-toolbar",".notification-check button"]},
    {title:"按实际结果排查",description:"“未发送”先核对条件；“发送失败”按错误说明处理；“结果待核实”先确认是否收到，避免重复发送。",targets:[".notification-record-scroll tbody tr .status-tag",".notification-record-scroll .data-empty",".personal-inbox-list article",".notification-check"]},
    {title:"检查模板与店长绑定",description:"在“推送设置”中选定门店，检查微信配置并核对接收人。配置检查不发送消息，完整链路需使用新预约测试。",targets:[".notification-view-tabs button:last-child"],permission:'notifications:write'},
  ]},
}

function findAnchor(moduleId:string,selectors:string[]=[]):HTMLElement|null{
  const root=document.querySelector(`.ops-main[data-page="${moduleId}"]`)
  for(const selector of selectors){
    for(const element of root?.querySelectorAll<HTMLElement>(selector)||[]){
      const rect=element.getBoundingClientRect()
      if(element.getClientRects().length&&rect.width>8&&rect.height>8&&getComputedStyle(element).visibility!=='hidden')return element
    }
  }
  return null
}

const keyFor=(userId:string,moduleId:string)=>`yht-admin-guide:v2:${userId}:${moduleId}`
function readSeen(key:string){try{return localStorage.getItem(key)||''}catch{return ''}}

export default function AdminGuide({ctx,moduleId}:{ctx:Ctx;moduleId:string}){
  const guide=guides[moduleId]
  const storageKey=keyFor(ctx.me.id,moduleId)
  const [seen,setSeen]=useState(()=>readSeen(storageKey))
  const [open,setOpen]=useState(false),[current,setCurrent]=useState(0)
  const [anchor,setAnchor]=useState<HTMLElement|null>(null)
  const trigger=useRef<HTMLSpanElement>(null),autoOpened=useRef(false)
  const available=guide?.steps.filter(step=>(!step.permission||ctx.can(step.permission))&&(!step.hq||ctx.me.hq))||[]
  const selectors=available[current]?.targets

  // Wait for the module and navigation drawer to settle. Do not interrupt an
  // appointment opened directly from a notification, or another active dialog.
  useEffect(()=>{
    if(!guide||seen||autoOpened.current||open)return
    let timer:ReturnType<typeof setTimeout>
    const tryOpen=()=>{
      clearTimeout(timer)
      timer=setTimeout(()=>{
        if([...document.querySelectorAll<HTMLElement>('[role="dialog"]')].some(element=>element.getClientRects().length&&!element.closest('.ant-drawer:not(.ant-drawer-open)')))return
        if(!findAnchor(moduleId,guide.steps[0].targets))return
        autoOpened.current=true;setCurrent(0);setOpen(true)
      },450)
    }
    const observer=new MutationObserver(tryOpen)
    observer.observe(document.body,{childList:true,subtree:true})
    tryOpen()
    return()=>{clearTimeout(timer);observer.disconnect()}
  },[moduleId,guide,seen,open])

  useLayoutEffect(()=>{
    if(!open||!selectors){setAnchor(null);return}
    const root=document.querySelector(`.ops-main[data-page="${moduleId}"]`)
    let frame=0
    const refresh=()=>{
      cancelAnimationFrame(frame)
      frame=requestAnimationFrame(()=>{
        const next=findAnchor(moduleId,selectors)||trigger.current
        if(next){
          const rect=next.getBoundingClientRect(),parent=root?.getBoundingClientRect()
          if(rect.top<Math.max(12,parent?.top||0)+8||rect.bottom>Math.min(innerHeight-12,parent?.bottom||innerHeight)-8)next.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})
          // Centering an off-screen control can leave too little room on either
          // side of it on a short phone. Reserve room for the actual Tour card.
          const visible=next.getBoundingClientRect()
          const cardHeight=document.querySelector('.admin-guide-tour .ant-tour-section')?.getBoundingClientRect().height||280
          if(visible.top-cardHeight<28&&visible.bottom+cardHeight>innerHeight-28)next.scrollIntoView({block:'start',inline:'nearest',behavior:'instant'})
        }
        setAnchor(next)
        // Ant Design listens on window; nested workspaces scroll independently.
        window.dispatchEvent(new Event('scroll'))
      })
    }
    const observer=new MutationObserver(refresh)
    if(root)observer.observe(root,{childList:true,subtree:true})
    const nestedScroll=(event:Event)=>{if(event.target!==window&&event.target!==document)refresh()}
    window.addEventListener('resize',refresh)
    document.addEventListener('scroll',nestedScroll,true)
    refresh()
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',refresh);document.removeEventListener('scroll',nestedScroll,true)}
  },[open,moduleId,selectors])

  // Re-align after the target's position has committed, including when its
  // dimensions are unchanged and only an inner scroll container moved it.
  useLayoutEffect(()=>{
    if(!open||!anchor)return
    const frame=requestAnimationFrame(()=>window.dispatchEvent(new Event('scroll')))
    return()=>cancelAnimationFrame(frame)
  },[open,anchor,current])

  if(!guide)return null
  function close(result:'done'|'skipped'='skipped'){
    // Keep a completed guide completed when replaying it, even if replay is closed.
    const value=seen==='done'?'done':result
    try{localStorage.setItem(storageKey,value)}catch{/* Still usable when browser storage is unavailable. */}
    setSeen(value);setOpen(false)
    requestAnimationFrame(()=>trigger.current?.querySelector('button')?.focus())
  }
  const steps:TourProps['steps']=available.map((step,index)=>({
    title:step.title,
    description:<div className="admin-guide-description"><span className="admin-guide-module">{guide.name} · 漫游式引导</span><p>{step.description}</p></div>,
    target:()=>findAnchor(moduleId,step.targets)||trigger.current!,
    nextButtonProps:{children:index===available.length-1?'完成引导':'下一步'},
    prevButtonProps:{children:'上一步'},
    scrollIntoViewOptions:{block:'nearest',inline:'nearest',behavior:'instant'},
  }))
  return <>
    <span ref={trigger} className="admin-guide-entry"><ActionButton type="button" className="admin-guide-trigger" aria-label={`${guide.name}操作引导`} title={seen?'重新查看漫游引导':'查看漫游引导'} onClick={()=>{autoOpened.current=true;setCurrent(0);setOpen(true)}}><CircleHelp size={16}/><span>操作引导</span></ActionButton></span>
    <Tour open={open&&!!anchor} current={current} steps={steps} onChange={setCurrent} onClose={()=>close()} onFinish={()=>close('done')}
      disabledInteraction keyboard rootClassName="admin-guide-tour" placement="bottom" zIndex={1300}
      gap={{offset:6,radius:8}} mask={{color:'rgba(19, 35, 26, 0.54)'}}
      styles={{section:{width:'min(380px, calc(100vw - 32px))'}}}
      indicatorsRender={(index,total)=><span className="admin-guide-progress" aria-live="polite">{index+1} / {total}</span>}
      actionsRender={actions=><><ActionButton type="button" className="admin-guide-skip" onClick={()=>close()}>跳过</ActionButton>{actions}</>}/>
  </>
}
