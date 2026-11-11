import {useEffect,useState} from 'react'
import {Alert,Modal,Switch,Tag} from 'antd'
import {Construction,RefreshCw} from 'lucide-react'
import {api,displayTime} from './api'
import type {Ctx} from './Admin'
import {ActionButton,TextArea,TextInput} from './components/AdminControls'
import './launch-mode.css'

type Language='zh'|'en'|'ja'
type Config={enabled:boolean;revision:number;updatedAt:string;title:Record<Language,string>;message:Record<Language,string>}
const languages: [Language,string][]=[['zh','中文'],['en','English'],['ja','日本語']]

export default function LaunchModeSettings({ctx}:{ctx:Ctx}){
  const [saved,setSaved]=useState<Config|null>(null),[draft,setDraft]=useState<Config|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const editable=ctx.me.hq&&ctx.can('integrations:write')
  async function load(){
    setBusy(true);setError('')
    try{const value=await api<Config>('/api/admin/launch-mode');setSaved(value);setDraft(structuredClone(value))}
    catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  useEffect(()=>{void load()},[])
  async function save(){
    if(!draft||!editable)return
    setBusy(true);setError('')
    try{const value=await api<Config>('/api/admin/launch-mode',{method:'PUT',body:JSON.stringify(draft)});setSaved(value);setDraft(structuredClone(value));ctx.notify(value.enabled?'建设中模式已开启，顾客仅可浏览。':'建设中模式已关闭，顾客可正常使用。')}
    catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  function confirmSave(){
    if(!draft)return
    Modal.confirm({title:draft.enabled?'开启小程序建设中模式？':'恢复小程序正常使用？',content:draft.enabled?'保存后立即拦截顾客登录、预约、改约、取消、资料提交和新发起的客服对话。已有数据继续保留，管理后台可正常使用。':'保存后恢复顾客操作。此开关不会自动向顾客群发上线通知，请另行安排官方通知。',okText:'确认保存',cancelText:'暂不保存',onOk:save})
  }
  function edit(locale:Language,field:'title'|'message',value:string){if(draft)setDraft({...draft,[field]:{...draft[field],[locale]:value}})}
  const dirty=!!draft&&JSON.stringify(saved)!==JSON.stringify(draft)
  const valid=!!draft&&languages.every(([locale])=>draft.title[locale].trim()&&draft.message[locale].trim())
  return <section className="ops-card launch-mode-settings" aria-label="小程序上线控制">
    <div className="card-heading"><div><h3><Construction size={19}/>小程序上线控制</h3><p>建设期间统一向顾客展示温馨提示，开关和文案保存后通过接口生效，无需重新发布小程序。</p></div><Tag color={saved?.enabled?'warning':'success'}>{saved?saved.enabled?'当前：建设中 · 仅供浏览':'当前：正常使用':'正在读取状态'}</Tag></div>
    {error&&<Alert type="error" showIcon title={error}/>}
    {draft&&<>
      <label className="launch-mode-toggle"><Switch aria-label="启用建设中模式" checked={draft.enabled} disabled={!editable||busy} onChange={enabled=>setDraft({...draft,enabled})}/><span><strong>启用建设中模式</strong><small>开启后暂停顾客提交，不会生成测试预约、扣款或新增咨询。</small></span></label>
      <Alert type="info" showIcon title="已上线的小程序需要先更新一次以显示提示；后端提交拦截也对旧客户端生效。" description="顾客仍可浏览门店、项目及已有记录。后台处理、会员同步与微信回调继续运行；上线通知由官方渠道另行安排。"/>
      <div className="launch-mode-languages">{languages.map(([locale,name])=><div className="launch-mode-language" key={locale}><h4>{name}</h4><label className="admin-field"><span>提示标题 · {name}</span><TextInput aria-label={`提示标题 ${name}`} maxLength={40} disabled={!editable||busy} value={draft.title[locale]} onChange={e=>edit(locale,'title',e.target.value)}/></label><label className="admin-field"><span>提示内容 · {name}</span><TextArea aria-label={`提示内容 ${name}`} rows={5} maxLength={360} disabled={!editable||busy} value={draft.message[locale]} onChange={e=>edit(locale,'message',e.target.value)}/></label></div>)}</div>
      <div className="launch-mode-footer"><p>{dirty?'存在未保存的更改；顾客端仍按当前已保存状态运行。':saved?.updatedAt?`最近保存：${displayTime(saved.updatedAt)}`:'尚未启用建设中提示。'}{!editable&&'当前账号仅可查看，请由总部管理员保存。'}</p><div className="button-row"><ActionButton disabled={busy} onClick={()=>void load()}><RefreshCw size={15}/>重新加载</ActionButton>{editable&&<ActionButton className="a-primary" disabled={busy||!dirty||!valid} onClick={confirmSave}>{busy?'正在保存…':'保存上线控制'}</ActionButton>}</div></div>
    </>}
  </section>
}
