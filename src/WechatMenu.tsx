import {useEffect,useState} from 'react'
import {Alert,App,Select,Tag} from 'antd'
import {ArrowDown,ArrowUp,ChevronDown,ExternalLink,MessageCircle,Plus,RefreshCw,Save,Send,Smartphone,Trash2} from 'lucide-react'
import type {Ctx} from './Admin'
import {api,clone,displayTime} from './api'
import {ActionButton,DisabledFieldset,TextInput} from './components/AdminControls'
import './wechat-menu.css'

type Button={name:string;type?:string;url?:string;appid?:string;pagepath?:string;key?:string;media_id?:string;article_id?:string;sub_button?:Button[]}
type Menu={button:Button[]}
type Config={revision:number;draft:Menu;savedAt:string;publishedAt:string;backupAt:string;hasBackup:boolean;serviceAppId:string;miniAppId:string;credentialsConfigured:boolean;pages:{name:string;path:string}[]}
type Remote={menu:Menu;readAt:string;exists:boolean;conditionalCount:number}
type Selection={parent:number;child?:number}
const base='/api/admin/wechat-menu',fallback='https://www.yuhetangtcm.com'
const menuOptions={timeoutMs:60000,timeoutMessage:'菜单操作超时。若刚才执行发布，请先读取微信菜单核对结果，再决定是否重试。'}
const group=(button:Button)=>Array.isArray(button.sub_button)&&!button.type
const bytes=(value:string)=>new TextEncoder().encode(value).length
const actionName=(button:Button)=>group(button)?'展开子菜单':button.type==='miniprogram'?'打开小程序':button.type==='view'?'打开网页':button.type==='click'?'发送菜单事件':'保留原有微信动作'
const keyTypes=new Set(['click','scancode_push','scancode_waitmsg','pic_sysphoto','pic_photo_or_album','pic_weixin','location_select'])

export default function WechatMenu({ctx}:{ctx:Ctx}){
  const {modal}=App.useApp()
  const [config,setConfig]=useState<Config|null>(null),[menu,setMenu]=useState<Menu>({button:[]}),[selected,setSelected]=useState<Selection>({parent:0})
  const [remote,setRemote]=useState<Remote|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('')
  const canWrite=ctx.can('wechat-menu:write'),canPublish=ctx.can('wechat-menu:publish')
  const dirty=!!config&&JSON.stringify(menu)!==JSON.stringify(config.draft)
  const parent=menu.button[selected.parent],current=selected.child===undefined?parent:parent?.sub_button?.[selected.child]
  const mini=(name='新菜单',path='pages/home/index'):Button=>({name,type:'miniprogram',appid:config?.miniAppId||'wxce054e18303efb8a',pagepath:path,url:fallback})
  const recommended=(appId:string):Menu=>({button:[['在线预约','pages/booking/index'],['门店查询','pages/stores/index'],['我的预约','pages/orders/index']].map(([name,pagepath])=>({name,type:'miniprogram',appid:appId,pagepath,url:fallback}))})
  function adopt(next:Config,initial=false){
    setConfig(next);setMenu(clone(initial&&canWrite&&!next.savedAt&&!next.draft.button.length?recommended(next.miniAppId):next.draft));setSelected({parent:0})
  }
  useEffect(()=>{let active=true;api<Config>(base).then(next=>{if(active)adopt(next,true)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[])
  useEffect(()=>{if(!dirty)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])

  async function run(name:string,task:()=>Promise<void>){
    setBusy(name);setError('');setMessage('')
    try{await task()}catch(e){setError((e as Error).message)}finally{setBusy('')}
  }
  function confirm(title:string,content:string,okText:string,task:()=>void|Promise<void>){modal.confirm({title,content,okText,cancelText:'取消',onOk:task})}
  function replace(next:Menu){setMenu(clone(next));setSelected({parent:0});setMessage('已载入编辑区，保存草稿后可发布到微信。');setError('')}
  function patch(change:Partial<Button>){setMenu(previous=>{
    const next=clone(previous),p=next.button[selected.parent]
    const target=selected.child===undefined?p:p?.sub_button?.[selected.child]
    if(target)Object.assign(target,change);return next
  });setMessage('')}
  function changeType(type:string){
    const apply=()=>setMenu(previous=>{
      const next=clone(previous),p=next.button[selected.parent]
      const value:Button=type==='submenu'?{name:current?.name||'',sub_button:[mini('子菜单')]}:type==='miniprogram'?mini(current?.name||''):type==='view'?{name:current?.name||'',type,url:fallback}:{name:current?.name||'',type,key:''}
      if(selected.child===undefined)next.button[selected.parent]=value;else if(p?.sub_button)p.sub_button[selected.child]=value
      return next
    })
    if(current&&group(current)&&current.sub_button?.length)confirm('切换菜单动作','当前子菜单将从草稿中移除，保存并发布后才会影响微信菜单。','切换动作',apply)
    else apply()
  }
  function add(parentIndex?:number){
    if(!canWrite||busy)return
    setMenu(previous=>{
      const next=clone(previous)
      if(parentIndex===undefined){if(next.button.length>=3)return previous;next.button.push(mini());setSelected({parent:next.button.length-1})}
      else{const children=next.button[parentIndex]?.sub_button;if(!children||children.length>=5)return previous;children.push(mini('子菜单'));setSelected({parent:parentIndex,child:children.length-1})}
      return next
    })
  }
  function remove(selection:Selection){
    const item=selection.child===undefined?menu.button[selection.parent]:menu.button[selection.parent]?.sub_button?.[selection.child]
    confirm('移除菜单',`将“${item?.name||'未命名菜单'}”从草稿中移除${item&&group(item)?'，包括它的全部子菜单':''}。`,'移除',()=>{
      setMenu(previous=>{const next=clone(previous);if(selection.child===undefined)next.button.splice(selection.parent,1);else next.button[selection.parent]?.sub_button?.splice(selection.child,1);return next});setSelected({parent:0})
    })
  }
  function move(selection:Selection,offset:number){
    const next=clone(menu),items=selection.child===undefined?next.button:next.button[selection.parent]?.sub_button,index=selection.child??selection.parent
    if(!items||index+offset<0||index+offset>=items.length)return
    ;[items[index],items[index+offset]]=[items[index+offset],items[index]]
    setMenu(next);setSelected(selection.child===undefined?{parent:index+offset}:{parent:selection.parent,child:index+offset})
  }
  async function save(){if(!config)return;await run('save',async()=>{
    const next=await api<Config>(base+'/draft',{method:'PUT',body:JSON.stringify({revision:config.revision,menu})});adopt(next);setMessage('草稿已保存，微信线上菜单尚未改变。')
  })}
  async function read(){await run('read',async()=>{setRemote(await api<Remote>(base+'/remote',menuOptions));setMessage('已读取微信当前菜单，可在下方核对。')})}
  function publish(){
    if(!config||dirty)return
    confirm('发布服务号菜单',`将已保存的 ${menu.button.length} 个一级菜单发布至服务号 ${config.serviceAppId}，替换它的默认菜单。发布前会自动备份当前菜单。`,'确认发布',()=>run('publish',async()=>{
      let next:Config&{accepted:boolean;conditionalCount:number}
      try{next=await api(base+'/publish',{...menuOptions,method:'POST',body:JSON.stringify({revision:config.revision})})}
      catch(failure){try{setConfig(await api<Config>(base))}catch{/* Keep the original publication error visible. */}throw failure}
      if(next.accepted!==true)throw new Error('微信发布结果尚未确认，请先读取微信菜单核对。')
      adopt(next);setRemote(null);setMessage('微信已接受菜单发布。请稍候重新进入服务号查看，客户端菜单通常按 5 分钟策略刷新。'+(next.conditionalCount?' 当前另有个性化菜单，部分用户可能看到不同内容。':''));ctx.notify('服务号菜单已提交微信。')
    }))
  }
  function restore(){if(!config)return;confirm('恢复发布前菜单到草稿','将上次发布前备份的默认菜单载入草稿，覆盖当前草稿。核对后仍需点击“发布到微信”才会生效。','恢复到草稿',()=>run('restore',async()=>{
    adopt(await api<Config>(base+'/restore-draft',{method:'POST',body:JSON.stringify({revision:config.revision})}));setMessage('发布前菜单已恢复到草稿，尚未发布到微信。')
  }))}

  function item(button:Button,selection:Selection){
    const child=selection.child!==undefined,index=selection.child??selection.parent,count=child?menu.button[selection.parent].sub_button!.length:menu.button.length
    const active=selected.parent===selection.parent&&selected.child===selection.child,label=button.name||'未命名菜单'
    return <div className={`wm-tree-row${active?' selected':''}${child?' child':''}`} key={`${selection.parent}-${selection.child??'parent'}`}>
      <ActionButton type="button" layout="card" className="wm-tree-select" aria-pressed={active} aria-label={`编辑${child?'二级':'一级'}菜单：${label}`} onClick={()=>setSelected(selection)}><span>{label}</span>{group(button)&&<ChevronDown size={14}/>}</ActionButton>
      {canWrite&&<div className="wm-tree-actions"><ActionButton type="button" aria-label={`上移${label}`} disabled={!!busy||index===0} onClick={()=>move(selection,-1)}><ArrowUp size={13}/></ActionButton><ActionButton type="button" aria-label={`下移${label}`} disabled={!!busy||index===count-1} onClick={()=>move(selection,1)}><ArrowDown size={13}/></ActionButton><ActionButton type="button" aria-label={`移除${label}`} disabled={!!busy} onClick={()=>remove(selection)}><Trash2 size={13}/></ActionButton></div>}
    </div>
  }
  const stamp=(value:string)=>value?displayTime(value):'尚无记录'
  return <div className="wechat-menu">
    {error&&<Alert type="error" showIcon title={error} closable onClose={()=>setError('')}/>}
    {!config&&!error&&<div className="ops-card">正在读取服务号菜单配置…</div>}
    {!config&&error&&<ActionButton type="button" className="a-secondary" onClick={()=>void run('reload',async()=>adopt(await api<Config>(base),true))}>重新加载</ActionButton>}
    {config&&<>
      <section className="ops-card wm-account">
        <div className="wm-account-title"><div className="wm-icon"><MessageCircle size={22}/></div><div><h3>裕和堂服务号</h3><p>{config.serviceAppId||'服务号尚未接入'} <Tag color={config.credentialsConfigured?'success':'warning'}>{config.credentialsConfigured?'已配置服务号凭据':'待配置服务号凭据'}</Tag></p></div></div>
        <div className="wm-timestamps"><span>草稿保存<strong>{stamp(config.savedAt)}</strong></span><span>微信接受发布<strong>{stamp(config.publishedAt)}</strong></span></div>
      </section>
      {!config.credentialsConfigured&&<Alert type="warning" showIcon title="服务号凭据尚未配置，暂时无法读取或发布微信菜单。仍可编辑并保存草稿，请联系管理员完成服务号接入。"/>}
      <div className="wm-toolbar"><div><Tag color={dirty?'gold':'default'}>{dirty?'有未保存修改':config.savedAt?'草稿已保存':'尚无草稿'}</Tag><span>一级菜单最多 3 个，每个一级菜单最多 5 个子菜单。</span></div><div className="wm-toolbar-actions">
        <ActionButton type="button" className="a-secondary" disabled={!!busy||!config.credentialsConfigured} onClick={()=>void read()}><RefreshCw size={15}/>{busy==='read'?'正在读取…':'读取微信菜单'}</ActionButton>
        {canWrite&&<ActionButton type="button" className="a-secondary" disabled={!!busy||!dirty} onClick={()=>void save()}><Save size={15}/>{busy==='save'?'正在保存…':'保存草稿'}</ActionButton>}
        {canPublish&&<ActionButton type="button" className="a-primary" disabled={!!busy||dirty||!config.credentialsConfigured||!menu.button.length} onClick={publish}><Send size={15}/>{busy==='publish'?'正在发布…':'发布到微信'}</ActionButton>}
      </div></div>
      {message&&<Alert type="success" showIcon title={message}/>}
      {dirty&&canPublish&&<p className="wm-save-hint">请先保存草稿，再发布到微信。</p>}
      <div className="wm-workspace">
        <section className="ops-card wm-editor">
          <div className="card-heading"><div><h3>编辑菜单</h3><p>点击左侧菜单，在右侧设置名称和打开的页面。</p></div>{canWrite&&<ActionButton type="button" className="a-link" disabled={!!busy} onClick={()=>confirm('使用推荐菜单','将草稿替换为“在线预约、门店查询、我的预约”，均打开当前小程序。','载入推荐菜单',()=>replace(recommended(config.miniAppId)))}>使用推荐菜单</ActionButton>}</div>
          <div className="wm-builder">
            <div className="wm-tree">
              {menu.button.map((button,index)=><div className="wm-tree-group" key={index}>{item(button,{parent:index})}{button.sub_button?.map((child,childIndex)=>item(child,{parent:index,child:childIndex}))}{group(button)&&canWrite&&<ActionButton type="button" className="a-link wm-add-child" disabled={!!busy||button.sub_button!.length>=5} onClick={()=>add(index)}><Plus size={13}/>添加子菜单</ActionButton>}</div>)}
              {canWrite&&<ActionButton type="button" className="a-secondary wm-add" disabled={!!busy||menu.button.length>=3} onClick={()=>add()}><Plus size={15}/>添加一级菜单</ActionButton>}
              {!menu.button.length&&<p className="field-note">还没有菜单，添加一个或使用推荐菜单。</p>}
            </div>
            {current?<DisabledFieldset disabled={!!busy||!canWrite} className="wm-form">
              <label className="admin-field" htmlFor="wm-name"><span>菜单名称</span><TextInput id="wm-name" value={current.name} onChange={e=>patch({name:e.target.value})} placeholder={selected.child===undefined?'建议不超过 4 个汉字':'建议不超过 8 个汉字'}/></label>
              <small className={bytes(current.name)>(selected.child===undefined?16:60)?'wm-invalid':'field-note'}>名称长度 {bytes(current.name)} / {selected.child===undefined?16:60} 字节；一级建议 4 个汉字，二级建议 8 个汉字。</small>
              <div className="admin-field"><label htmlFor="wm-action">点击动作</label><Select id="wm-action" aria-label="点击动作" virtual={false} value={group(current)?'submenu':current.type} onChange={changeType} options={[
                {value:'miniprogram',label:'打开小程序'},{value:'view',label:'打开网页'},{value:'click',label:'发送菜单事件'},
                ...(selected.child===undefined?[{value:'submenu',label:'展开子菜单'}]:[]),
                ...(!group(current)&&!['miniprogram','view','click'].includes(current.type||'')?[{value:current.type||'',label:'保留原有微信动作'}]:[]),
              ]}/></div>
              {group(current)?<div className="admin-note">此菜单点击后展开下方子菜单。请在左侧添加并设置子菜单的目标。</div>:current.type==='miniprogram'?<>
                <div className="admin-field"><label htmlFor="wm-page">打开的小程序页面</label><Select id="wm-page" aria-label="打开的小程序页面" virtual={false} value={config.pages.some(p=>p.path===current.pagepath)?current.pagepath:'custom'} onChange={value=>patch({pagepath:value==='custom'?'':value})} options={[...config.pages.map(p=>({value:p.path,label:p.name})),{value:'custom',label:'自定义页面路径'}]}/></div>
                <label className="admin-field" htmlFor="wm-path"><span>页面路径</span><TextInput id="wm-path" value={current.pagepath||''} onChange={e=>patch({pagepath:e.target.value})} placeholder="pages/home/index"/></label>
                <p className="field-note">目标页面需要存在于已发布的正式版小程序中。</p>
                <details className="wm-advanced"><summary>小程序与兼容网页设置</summary><div>
                  <label className="admin-field" htmlFor="wm-appid"><span>小程序 AppID</span><TextInput id="wm-appid" value={current.appid||''} onChange={e=>patch({appid:e.target.value})}/></label>
                  <label className="admin-field" htmlFor="wm-fallback"><span>兼容网页地址</span><TextInput id="wm-fallback" value={current.url||''} onChange={e=>patch({url:e.target.value})} placeholder={fallback}/></label>
                  <p className="field-note">微信要求填写兼容网页。不支持打开小程序的旧版微信会访问此地址，默认使用裕和堂官网。</p>
                </div></details>
              </>:current.type==='view'?<label className="admin-field" htmlFor="wm-url"><span>网页地址</span><TextInput id="wm-url" value={current.url||''} onChange={e=>patch({url:e.target.value})} placeholder="https://"/></label>:keyTypes.has(current.type||'')?<>
                <label className="admin-field" htmlFor="wm-key"><span>菜单事件标识</span><TextInput id="wm-key" value={current.key||''} onChange={e=>patch({key:e.target.value})}/></label>
                <p className="field-note">此动作需要已有消息接收服务处理对应事件。直接进入小程序请选择“打开小程序”。</p>
              </>:<label className="admin-field" htmlFor="wm-media"><span>{current.article_id!==undefined?'图文标识':'素材标识'}</span><TextInput id="wm-media" value={current.article_id??current.media_id??''} onChange={e=>patch(current.article_id!==undefined?{article_id:e.target.value}:{media_id:e.target.value})}/></label>}
            </DisabledFieldset>:<div className="wm-empty">选择一个菜单开始编辑</div>}
          </div>
        </section>
        <aside className="ops-card wm-preview-card"><h3><Smartphone size={17}/>菜单预览</h3><p className="field-note">预览菜单结构，实际跳转请在微信验证。</p><div className="wm-phone"><div className="wm-phone-header">裕和堂 <span>···</span></div><div className="wm-phone-chat"><div className="wm-avatar">裕</div><div className="wm-chat-bubble">欢迎来到裕和堂<br/>点击底部菜单，查看门店或预约服务。</div></div><div className="wm-phone-space"/>
          <div className="wm-preview-bar"><div className="wm-keyboard">☷</div>{menu.button.map((button,index)=><div className="wm-preview-cell" key={index}>{selected.parent===index&&group(button)&&<div className="wm-preview-sub">{button.sub_button?.map((child,childIndex)=><button type="button" key={childIndex} onClick={()=>setSelected({parent:index,child:childIndex})}>{child.name||'未命名'}</button>)}</div>}<button type="button" className={selected.parent===index?'active':''} onClick={()=>setSelected({parent:index})}>{group(button)&&<ChevronDown size={11}/>}<span>{button.name||'未命名'}</span></button></div>)}</div></div>
          {current&&!group(current)&&<div className="wm-target"><span>{actionName(current)}</span><strong>{current.type==='miniprogram'?config.pages.find(p=>p.path===current.pagepath)?.name||current.pagepath||'请选择页面':current.url||current.key||current.media_id||current.article_id||'请完善目标'}</strong></div>}
        </aside>
      </div>
      <section className="ops-card wm-online"><div className="card-heading"><div><h3>微信当前菜单</h3><p>{remote?`读取于 ${stamp(remote.readAt)}，展示微信接口本次返回的配置。`:'点击“读取微信菜单”，核对当前线上配置或载入编辑。'}</p></div>{remote&&canWrite&&<ActionButton type="button" className="a-secondary" disabled={!!busy} onClick={()=>confirm('载入微信菜单到编辑区','将替换编辑区的内容，保存草稿前不会影响线上菜单。','载入编辑',()=>replace(remote.menu))}>载入编辑</ActionButton>}</div>
        {remote?<>{remote.conditionalCount>0&&<Alert type="warning" showIcon title={`当前还存在 ${remote.conditionalCount} 份个性化菜单，部分用户可能看到不同的菜单。本页编辑默认菜单。`}/>}<div className="wm-online-items">{remote.menu.button.map((button,index)=><div key={index}><strong>{button.name}</strong>{group(button)?button.sub_button?.map((child,i)=><span key={i}>{child.name} · {actionName(child)}</span>):<span>{actionName(button)}<small>{button.pagepath||button.url||button.key}</small></span>}</div>)}{!remote.menu.button.length&&<p className="field-note">微信当前没有通过接口设置的默认菜单。</p>}</div></>:<div className="wm-online-empty"><ExternalLink size={18}/><span>尚未读取微信菜单</span></div>}
        {canWrite&&<div className="wm-restore"><span>{config.hasBackup?`最近发布前备份：${stamp(config.backupAt)}`:'首次发布前会自动备份微信当前菜单。'}</span><ActionButton type="button" className="a-link" disabled={!!busy||!config.hasBackup} onClick={restore}>恢复发布前菜单到草稿</ActionButton></div>}
      </section>
    </>}
  </div>
}
