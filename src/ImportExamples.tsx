import {useEffect,useState} from 'react'
import {Alert} from 'antd'
import {BookOpen,Copy,Download,RefreshCw} from 'lucide-react'
import {api} from './api'
import {ActionButton} from './components/AdminControls'
import type {Ctx} from './Admin'
import './import-examples.css'

type Field={key:string;label:string;required:boolean;example:string;description:string}
type Guide={kind:string;title:string;fields:Field[];rows:Record<string,string>[];notes:string[]}

export default function ImportExamples({ctx,kind}:{ctx:Ctx;kind:string}){
  const [guide,setGuide]=useState<Guide|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[downloading,setDownloading]=useState(false)
  useEffect(()=>{let active=true;setGuide(null);setError('');api<Guide>(`/api/admin/import-guides/${kind}`).then(value=>{if(active)setGuide(value)}).catch(cause=>{if(active)setError(cause.message)});return()=>{active=false}},[kind,refresh])
  async function download(){
    if(downloading)return
    setDownloading(true);setError('')
    try{
      const response=await fetch(`/api/admin/import-guides/${kind}/example`,{headers:{Authorization:'Bearer '+sessionStorage.getItem('yht-admin-token')}})
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message||'填写示例下载失败，请重试。')}
      const url=URL.createObjectURL(await response.blob()),link=document.createElement('a')
      link.href=url;link.download=`裕和堂-${guide?.title||kind}-填写示例.xlsx`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(cause){setError((cause as Error).message)}finally{setDownloading(false)}
  }
  async function copy(id:string){try{await navigator.clipboard.writeText(id);ctx.notify('门店编号已复制。')}catch{ctx.notify('复制未成功，请选中门店编号手动复制。')}}
  return <section className="import-examples" aria-label="导入填写示例与字段说明">
    <header><div><h4><BookOpen size={18}/>填写示例与字段说明</h4><p>选择上方资料类型，查看对应列名、填写规则和虚构示例。</p></div><ActionButton type="button" className="a-secondary" disabled={!guide||downloading} onClick={()=>void download()}><Download size={14}/>{downloading?'下载中…':'下载填写示例 Excel'}</ActionButton></header>
    {error&&<Alert type="error" showIcon title={error} action={<ActionButton type="button" className="a-link" onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={14}/>重新加载示例</ActionButton>}/>}
    {!guide&&!error&&<p role="status">正在读取当前模板的填写规则…</p>}
    {guide&&<>
      <ul className="import-example-notes">{guide.notes.map(note=><li key={note}>{note}</li>)}</ul>
      <details className="import-store-reference"><summary>查看当前系统门店编号（{ctx.stores.length} 家）</summary><p>storeId 填下方编号。点评的 externalShopId 则使用已经配置映射的点评门店编号。</p><div>{ctx.stores.map(store=><article key={store.id}><strong>{store.name}</strong><code>{store.id}</code><ActionButton type="button" className="a-link" aria-label={`复制${store.name}编号`} onClick={()=>void copy(store.id)}><Copy size={13}/>复制</ActionButton></article>)}</div></details>
      <div className="import-field-table" role="region" aria-label={`${guide.title}字段说明`} tabIndex={0}>
        <table><thead><tr><th>原始列名 / 含义</th><th>填写要求</th><th>虚构示例</th></tr></thead><tbody>{guide.fields.map(field=><tr key={field.key}><td><code>{field.key}</code><span>{field.label}</span><small className={field.required?'required':''}>{field.required?'必填':'可留空'}</small></td><td>{field.description}</td><td><code>{field.example||'（留空）'}</code></td></tr>)}</tbody></table>
      </div>
      <p className="field-note">示例文件第一个工作表是可编辑资料，第二个是填写说明。下载不会写入数据；请替换虚构数据后，使用“预检文件”核对。</p>
    </>}
  </section>
}
