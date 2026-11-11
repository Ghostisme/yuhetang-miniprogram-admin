import ResponsiveTable from './components/ResponsiveTable'
import {ActionButton,TextInput,SelectInput,TextArea,DisabledFieldset} from './components/AdminControls'
import {useEffect,useRef,useState,type ReactNode} from 'react'
import {ChevronLeft,ChevronRight,RefreshCw,X} from 'lucide-react'
import {Modal,Pagination} from 'antd'
import {api,dateInput,displayTime} from './api'
import type {Ctx} from './Admin'
import type {Appointment,Page,Row,Slots} from './types'
import './dianping.css'

const labels:Row={CREATED:'待付款',PAID:'已付款',BOOKED:'已预约',REDEEMED:'已核销',CANCELLED:'已取消',REFUNDED:'已退款'}
const blankShop=()=>({externalShopId:'',externalShopName:'',storeId:'',revision:0})
const blankProduct=(shop='')=>({externalShopId:shop,externalProductId:'',externalProductName:'',serviceId:'',revision:0})
const put=(path:string,body:unknown)=>api<Row>('/api/admin/dianping/'+path,{method:'PUT',body:JSON.stringify(body)})
function Field({label,children}:{label:string;children:ReactNode}){return <label className="admin-field"><span>{label}</span>{children}</label>}

export function DianpingIntegration({ctx}:{ctx:Ctx}){
  const [data,setData]=useState<Row|null>(null),[shop,setShop]=useState<Row>(blankShop),[product,setProduct]=useState<Row>(blankProduct),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const alive=useRef(true),canWrite=ctx.me.hq&&ctx.can('integrations:write')
  useEffect(()=>{alive.current=true;void refresh();return()=>{alive.current=false}},[])
  async function refresh(){try{const next=await api<Row>('/api/admin/dianping/config');if(alive.current){setData(next);setError('')}}catch(e){if(alive.current)setError((e as Error).message)}}
  async function save(type:'shops'|'products',e:React.FormEvent){
    e.preventDefault();setBusy(true);setError('')
    try{
      await put(type,type==='shops'?shop:product);if(!alive.current)return
      if(type==='shops'){setProduct(blankProduct(shop.externalShopId));setShop(blankShop())}else setProduct(blankProduct(product.externalShopId))
      await refresh();ctx.notify(type==='shops'?'点评门店映射已保存。':'点评品项映射已保存。')
    }catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setBusy(false)}
  }
  const selectedShop=data?.shops.find((s:Row)=>s.externalShopId===product.externalShopId),localStore=data?.stores.find((s:Row)=>s.id===selectedShop?.storeId)
  return <section className="ops-card dianping-integration">
    <div className="card-heading"><div><h3>大众点评数据接入</h3><p>将点评门店、团购品项对应到现有门店和本店养护项目。</p></div><ActionButton aria-label="刷新点评配置" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={16}/></ActionButton></div>
    <div className="connection-status"><i className="online"/>文件导入可用 · 自动同步待接入</div>
    <p className="field-note">在“资料导入”导入客户、订单 / 预约记录，在“预约管理 → 大众点评订单”处理到店预约。{data&&`当前 ${data.orderCount} 条订单，${data.customerLinkCount} 个点评客户关联。`}</p>
    {error&&<div className="admin-error" role="alert">{error}</div>}
    {data&&<>
      <div className="dianping-mappings">
        <div><h4>点评门店 → 本地门店</h4>
          <div className="table-scroll"><ResponsiveTable className="ops-table"><thead><tr><th>点评门店 / 编号</th><th>本地门店</th>{canWrite&&<th>操作</th>}</tr></thead><tbody>{data.shops.map((s:Row)=><tr key={s.externalShopId}><td>{s.externalShopName}<small>{s.externalShopId}</small></td><td>{data.stores.find((local:Row)=>local.id===s.storeId)?.name}</td>{canWrite&&<td><ActionButton className="a-link" disabled={busy} onClick={()=>setShop({...s})}>编辑映射</ActionButton></td>}</tr>)}</tbody></ResponsiveTable></div>
          {!data.shops.length&&<p className="data-empty">尚未配置点评门店映射</p>}
          {canWrite&&<form onSubmit={e=>void save('shops',e)}><DisabledFieldset disabled={busy}>
            <Field label="点评门店编号"><TextInput required maxLength={100} value={shop.externalShopId} readOnly={shop.revision>0} onChange={e=>setShop({...shop,externalShopId:e.target.value})}/></Field>
            <Field label="点评门店名称"><TextInput required maxLength={100} value={shop.externalShopName} onChange={e=>setShop({...shop,externalShopName:e.target.value})}/></Field>
            <Field label="对应本地门店"><SelectInput aria-label="对应本地门店" required value={shop.storeId} onChange={e=>setShop({...shop,storeId:e.target.value})}><option value="">选择门店</option>{data.stores.map((s:Row)=><option key={s.id} value={s.id}>{s.name}</option>)}</SelectInput></Field>
            <div className="button-row"><ActionButton className="a-primary">保存门店映射</ActionButton>{shop.revision>0&&<ActionButton type="button" className="a-secondary" onClick={()=>setShop(blankShop())}>新建映射</ActionButton>}</div>
          </DisabledFieldset></form>}
        </div>
        <div><h4>点评品项 → 本店养护项目</h4>
          <div className="table-scroll"><ResponsiveTable className="ops-table"><thead><tr><th>点评品项 / 门店</th><th>本店项目</th>{canWrite&&<th>操作</th>}</tr></thead><tbody>{data.products.map((p:Row)=>{const sid=data.shops.find((s:Row)=>s.externalShopId===p.externalShopId)?.storeId,store=data.stores.find((s:Row)=>s.id===sid);return <tr key={p.externalShopId+':'+p.externalProductId}><td>{p.externalProductName}<small>{p.externalProductId} · {p.externalShopId}</small></td><td>{store?.services.find((s:Row)=>s.id===p.serviceId)?.name||'项目已移除'}<small>{store?.name}</small></td>{canWrite&&<td><ActionButton className="a-link" disabled={busy} onClick={()=>setProduct({...p})}>编辑映射</ActionButton></td>}</tr>})}</tbody></ResponsiveTable></div>
          {!data.products.length&&<p className="data-empty">尚未配置点评品项映射</p>}
          {canWrite&&<form onSubmit={e=>void save('products',e)}><DisabledFieldset disabled={busy}>
            <Field label="品项所属点评门店"><SelectInput aria-label="品项所属点评门店" required value={product.externalShopId} disabled={product.revision>0} onChange={e=>setProduct(blankProduct(e.target.value))}><option value="">选择已映射门店</option>{data.shops.map((s:Row)=><option key={s.externalShopId} value={s.externalShopId}>{s.externalShopName} · {s.externalShopId}</option>)}</SelectInput></Field>
            <div className="form-columns"><Field label="点评品项编号"><TextInput required maxLength={100} value={product.externalProductId} readOnly={product.revision>0} onChange={e=>setProduct({...product,externalProductId:e.target.value})}/></Field><Field label="点评品项名称"><TextInput required maxLength={100} value={product.externalProductName} onChange={e=>setProduct({...product,externalProductName:e.target.value})}/></Field></div>
            <Field label="对应本店养护项目"><SelectInput aria-label="对应本店养护项目" required value={product.serviceId} onChange={e=>setProduct({...product,serviceId:e.target.value})}><option value="">先选择点评门店，再选择本店项目</option>{localStore?.services.map((s:Row)=><option key={s.id} value={s.id}>{s.name}{!s.enabled?'（已停用，可归档历史订单）':''}</option>)}</SelectInput></Field>
            <div className="button-row"><ActionButton className="a-primary" disabled={!selectedShop}>保存品项映射</ActionButton>{product.revision>0&&<ActionButton type="button" className="a-secondary" onClick={()=>setProduct(blankProduct(product.externalShopId))}>新建映射</ActionButton>}</div>
          </DisabledFieldset></form>}
        </div>
      </div>
      {!canWrite&&<p className="field-note">当前仅可查看映射；修改需授予“维护扩展与配置”权限。资料导入单独授权。</p>}
      {data.batches.length>0&&<><h4>最近导入记录</h4><div className="table-scroll"><ResponsiveTable className="ops-table"><thead><tr><th>导入时间 / 操作人</th><th>文件 / 类型</th><th>处理结果</th></tr></thead><tbody>{data.batches.map((b:Row)=><tr key={b.id}><td>{displayTime(b.createdAt)}<small>{b.actorName}</small></td><td>{b.sourceName}<small>{b.kind==='ORDERS'?'点评订单':'点评客户'}</small></td><td>新增 {b.createdCount} · 更新 {b.updatedCount} · 跳过 {b.skippedCount}</td></tr>)}</tbody></ResponsiveTable></div></>}
    </>}
  </section>
}

export function DianpingOrders({ctx,onOpen}:{ctx:Ctx;onOpen:(booking:Appointment)=>void}){
  const [data,setData]=useState<Page<Row>>({items:[],total:0}),[status,setStatus]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[error,setError]=useState(''),[selected,setSelected]=useState<Row|null>(null),[busy,setBusy]=useState(false)
  const request=useRef(0),alive=useRef(true),store=ctx.me.hq?ctx.store:ctx.me.storeId
  useEffect(()=>{alive.current=true;return()=>{alive.current=false}},[])
  useEffect(()=>{
    let current=true,timer:ReturnType<typeof setTimeout>
    async function poll(){if(document.hidden){timer=setTimeout(()=>void poll(),30000+Math.random()*5000);return}const seq=++request.current;try{const next=await api<Page<Row>>(`/api/admin/dianping/orders?${new URLSearchParams({storeId:store,status,search,page:String(page)})}`);if(current&&seq===request.current){setData(next);setError('')}}catch(e){if(current&&seq===request.current)setError((e as Error).message)}if(current)timer=setTimeout(()=>void poll(),30000+Math.random()*5000)}
    setData({items:[],total:0});void poll();return()=>{current=false;request.current++;clearTimeout(timer)}
  },[store,status,search,page,revision])
  async function open(row:Row){try{const booking=await api<Appointment>('/api/admin/appointments/'+encodeURIComponent(row.appointmentId));if(alive.current)onOpen(booking)}catch(e){if(alive.current)setError((e as Error).message)}}
  async function reviewed(row:Row){setBusy(true);try{await api(`/api/admin/dianping/orders/${row.id}/reviewed`,{method:'POST',body:JSON.stringify({revision:row.revision})});if(alive.current){setRevision(v=>v+1);ctx.notify('已记录本次平台更新核对。')}}catch(e){if(alive.current)setError((e as Error).message)}finally{if(alive.current)setBusy(false)}}
  return <section className="ops-card">
    <div className="card-heading"><div><h3>大众点评订单</h3><p>平台订单与本地预约分别保留。确认到店时间后，生成来源为“大众点评”的本店预约。</p></div><ActionButton aria-label="刷新点评订单" onClick={()=>setRevision(v=>v+1)}><RefreshCw size={16}/></ActionButton></div>
    <div className="table-filters"><TextInput aria-label="搜索点评订单" value={search} maxLength={100} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="精确搜索点评订单或品项编号"/><SelectInput aria-label="点评订单状态" value={status} onChange={e=>{setStatus(e.target.value);setPage(1)}}><option value="">全部平台状态</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</SelectInput></div>
    {error&&<div className="admin-error" role="alert">{error}</div>}
    <div className="table-scroll"><ResponsiveTable className="ops-table"><thead><tr><th>点评订单 / 明细</th><th>门店 / 项目</th><th>客户 / 平台时间</th><th>平台状态 / 金额</th><th>本地预约</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id}>
      <td><strong>{row.externalOrderId}</strong><small>明细 {row.externalLineId}</small></td><td>{row.serviceName}<small>{row.storeName}</small></td><td>{row.customerName} · {row.phone||'未提供电话'}<small>{row.bookingDate?`${row.bookingDate} ${row.startTime}`:'平台未提供预约时间'} · {row.headcount}人</small></td><td>{labels[row.orderStatus]}<small>¥{(row.amountFen/100).toFixed(2)}</small></td>
      <td>{row.appointmentId?<><ActionButton className="a-link" onClick={()=>void open(row)}>查看关联预约</ActionButton><small>{row.appointmentId}</small></>:ctx.can('appointments:write')&&['PAID','BOOKED'].includes(row.orderStatus)?<ActionButton className="a-link" onClick={()=>setSelected(row)}>确认到店预约</ActionButton>:<span>尚未关联预约</span>}{row.needsReview&&<div className="dianping-review"><strong>平台资料已更新，待核对预约</strong>{ctx.can('appointments:write')&&<ActionButton disabled={busy} className="a-link" onClick={()=>void reviewed(row)}>已核对平台更新</ActionButton>}</div>}</td>
    </tr>)}</tbody></ResponsiveTable></div>
    {!data.items.length&&<div className="data-empty">暂无大众点评订单，请由总部在“资料导入”导入点评文件。</div>}
    <div className="pager"><Pagination current={page} pageSize={20} total={data.total} showSizeChanger={false} showTotal={total=>`共 ${total} 条记录`} onChange={setPage}/></div>
    {selected&&<ConvertOrder row={selected} onClose={()=>setSelected(null)} onSaved={booking=>{setSelected(null);ctx.notify('点评订单已关联本店预约。');onOpen(booking)}}/>}
  </section>
}

function ConvertOrder({row,onClose,onSaved}:{row:Row;onClose:()=>void;onSaved:(booking:Appointment)=>void}){
  const [date,setDate]=useState(row.bookingDate>=dateInput()?row.bookingDate:dateInput(1)),[time,setTime]=useState(''),[phone,setPhone]=useState(''),[people,setPeople]=useState(row.headcount),[slots,setSlots]=useState<Slots|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>{let current=true;setSlots(null);setTime('');api<Slots>(`/api/admin/dianping/orders/${row.id}/slots?date=${date}`).then(next=>{if(current){setSlots(next);setError('')}}).catch(e=>{if(current)setError(e.message)});return()=>{current=false}},[row.id,date])
  async function submit(e:React.FormEvent){e.preventDefault();if(busy)return;setBusy(true);setError('');try{const booking=await api<Appointment>(`/api/admin/dianping/orders/${row.id}/appointment`,{method:'POST',body:JSON.stringify({revision:row.revision,date,startTime:time,headcount:people,phone})});onSaved(booking)}catch(e){setError((e as Error).message)}finally{setBusy(false)}}
  return <Modal open centered title="确认点评到店预约" onCancel={onClose} closable={!busy} maskClosable={!busy} keyboard={!busy} footer={null} destroyOnHidden className="admin-modal">
    <form onSubmit={e=>void submit(e)}><p>{row.storeName} · {row.serviceName}<br/>{row.customerName} · {row.phone||'平台未提供电话'}</p>
      <div className="form-columns"><Field label="点评到店日期"><TextInput required type="date" min={dateInput()} max={dateInput(slots?.rules.advanceDays||7)} value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></Field><Field label="点评到店时段"><SelectInput aria-label="点评到店时段" required value={time} disabled={busy||!slots} onChange={e=>setTime(e.target.value)}><option value="">核对后选择时段</option>{slots?.slots.filter(s=>s.available&&s.remaining>=people).map(s=><option key={s.time} value={s.time}>{s.time} · 余{s.remaining}位</option>)}</SelectInput></Field></div>
      <Field label="点评预约人数"><TextInput required type="number" min={1} max={slots?.rules.maxHeadcount||4} value={people} disabled={busy} onChange={e=>{setPeople(Number(e.target.value));setTime('')}}/></Field>
      <Field label="核实联系电话"><TextInput type="tel" pattern="1[3-9][0-9]{9}" maxLength={11} value={phone} disabled={busy} onChange={e=>setPhone(e.target.value)} placeholder="平台号码脱敏或缺失时，请补全11位手机号"/></Field>
      <p className="field-note">留空时使用导入文件中的完整号码；脱敏或缺失号码必须补全。保存后预约为“门店已确认”，并按门店设置生成消息通知。</p>
      {error&&<div className="admin-error" role="alert">{error}</div>}<ActionButton className="a-primary" disabled={busy||!slots||!time}>{busy?'保存中…':'确认并生成预约'}</ActionButton>
    </form>
  </Modal>
}
