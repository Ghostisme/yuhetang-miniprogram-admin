import {readFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {resolve,extname,sep} from 'node:path'

const source = (await Promise.all(['Admin','AppointmentDetail','ChatInbox','Notifications','DataImports','Dianping','PaymentReservation','WechatMenu','Customers'].map(n=>readFile(`src/${n}.tsx`,'utf8')))).join('\n')
const permissions = [...new Set([...source.matchAll(/['"]([a-z_-]+:[a-z_]+)['"]/g)].map(m=>m[1]))]
export const unknown=[],writes=[]
export const menus=[['dashboard','工作台'],['appointments','预约管理'],['customers','客户档案'],['therapists','调理师管理'],['chats','客户沟通'],['stores','门店与时段'],['content','品牌与内容'],['assets','图片素材'],['wechat-menu','服务号菜单'],['users','用户管理'],['roles','角色与权限'],['notifications','消息中心'],['imports','资料导入'],['audit','操作日志'],['integrations','扩展与配置']]
export async function serveAdmin(){
  const root=resolve('dist'),types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}
  const server=createServer(async(req,res)=>{
    let path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname)
    if(!path.startsWith(root+sep))path=resolve(root,'index.html')
    try{const data=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream'});res.end(data)}
    catch{res.writeHead(200,{'Content-Type':'text/html'});res.end(await readFile(resolve(root,'index.html')))}
  })
  await new Promise(done=>server.listen(0,'127.0.0.1',done))
  return {base:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(done=>server.close(done))}
}
const time = '2026-11-07T10:00:00Z'
const services = [{id:'care-1',name:'经络调养',english:'WELLNESS CARE',subtitle:'舒缓疲劳，照顾日常',category:'东方养护',duration:'60分钟',image:'/media/ritual.webp',tag:'门店养护',enabled:true,description:'由专业调理师结合到店沟通，安排适合的养护服务。',steps:['到店沟通','细致养护','日常建议'],source:'STORE',version:1},{id:'care-2',name:'肩颈舒缓',english:'REST AND RESTORE',subtitle:'给身体留一点休息时间',category:'特色养护',duration:'45分钟',image:'/media/store-07.webp',tag:'特色项目',enabled:true,description:'温和、细致的肩颈养护体验。',steps:['到店沟通','肩颈养护'],source:'STORE',version:1}]
const stores = [{id:'bailemen',name:'百乐门店',district:'静安区',image:'/media/store-02.webp',address:'上海市静安区 · 示例门店地址',hours:'10:00—22:00',phone:'021-00000000',tag:'城市静养',description:'在城市里，留一段从容时光。',enabled:true,onlineBooking:true,gallery:['/media/store-02.webp','/media/store-07.webp'],services},{id:'yuyao',name:'余姚门店',district:'静安区',image:'/media/store-07.webp',address:'上海市静安区 · 示例门店地址',hours:'10:00—22:00',phone:'021-00000000',tag:'东方养护',description:'用心关照每一次到来。',enabled:true,onlineBooking:true,gallery:['/media/store-07.webp'],services}]
const site = {version:8,brandName:'裕和堂',brandEnglish:'YU Health',tagline:'东方养护，自在有和。',theme:'sage',hero:{eyebrow:'A MOMENT FOR YOURSELF',title:'把时间\n留给自己。',subtitle:'在城市里，寻找一份身心的舒展。',image:'/media/store-07.webp',button:'预约一段时光'},brandStory:'以东方养护智慧，照顾每一份日常。\n在裕和堂，让身体与心绪慢慢放松。',contact:{phone:'021-00000000',wechat:'示例客服',message:'服务时间内，我们会及时回复您的咨询。'},sections:[{id:'services',name:'养护项目',enabled:true},{id:'stores',name:'门店空间',enabled:true},{id:'products',name:'品牌好物',enabled:true}],services,stores,products:[{id:'product-1',name:'草本茶饮',subtitle:'日常养护，从一杯温暖开始',image:'/media/herb-field.webp',category:'东方好物',description:'精选草本，舒心日常。',enabled:true}],galleryGroups:[{id:'space',name:'门店空间',images:['/media/store-07.webp','/media/store-02.webp']}],customerServiceEnabled:true}
const rules = {opens:'10:00',closes:'22:00',interval:30,capacity:4,advanceDays:7,minLeadMinutes:30,cancelHours:2,maxHeadcount:4,phoneOpenLimit:3,remindMinutes:15,closedDates:[]}
const bookings = Array.from({length:26},(_,i)=>({id:`YHT-APPOINTMENT-${i+1}`,customerName:`示例客户${i+1}`,phone:'138****0000',storeId:'bailemen',storeName:'百乐门店',serviceId:'care-1',serviceName:'经络调养',bookingDate:'2026-11-07',startTime:i%2?'14:30':'10:00',headcount:i%3+1,therapistIntentId:'therapist-1',therapistIntentName:'示例调理师',assignedTherapistId:'',assignedTherapistName:'待门店安排',membership:{memberVerified:true,memberStoreId:'yuyao',memberStoreName:'余姚门店',crossStore:true,memberGrade:'银卡会员'},memberClaim:'UNKNOWN',visitedClaim:'YES',remark:'请提前沟通到店安排。客户备注较长时应完整换行显示，不遮挡操作按钮。',status:i%3?'PENDING':'CONFIRMED',source:'MINIPROGRAM',version:1,createdAt:time,updatedAt:time,history:[]}))
const users = [{id:'store-user',username:'store-demo',displayName:'示例店长',storeId:'bailemen',enabled:true,roleIds:['manager']},{id:'hq-user',username:'headquarters-demo',displayName:'总部管理员',storeId:'',enabled:true,roleIds:['hq']}]
const roles = [{id:'hq',name:'总部管理员',dataScope:'GLOBAL',builtin:true,permissions},{id:'manager',name:'门店店长',dataScope:'STORE',builtin:false,permissions:permissions.filter(p=>!['imports','integrations'].some(prefix=>p.startsWith(prefix)))}]
const conversation = i=>({id:`chat-${i}`,displayName:`示例咨询客户${i}`,channel:'WECHAT',storeId:'bailemen',storeName:'百乐门店',status:'ACTIVE',canReply:true,canEnd:true,canAccept:false,canRelease:true,assignedAdminId:'hq-user',assignedAdminName:'总部管理员',activeRoute:true,replyRemaining:5,replyDeadline:Math.floor(Date.now()/1000)+3600,lastSeq:80,lastPreview:'您好，我想了解门店的养护项目和可预约时间。',updatedAt:time,unread:i===1?2:0})
export async function mockAdmin(context, hq = true) {
  const currentBookings=structuredClone(bookings)
  const chatState={incoming:[],reads:[]}
  await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','appearance-fixture'))
  await context.route('**/*',route=>{
    if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue()
    unknown.push(`External request: ${new URL(route.request().url()).origin}`)
    return route.abort()
  })
  await context.route('**/api/**', async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname
    const json=data=>route.fulfill({json:data})
    if(path.match(/^\/api\/admin\/chats\/chat-\d+\/read$/)&&request.method()==='PATCH'){
      chatState.reads.push({path,...request.postDataJSON()})
      return json({ok:true})
    }
    if(path.match(/^\/api\/admin\/appointments\/[^/]+$/)&&request.method()==='PATCH'){
      const booking=currentBookings.find(b=>b.id===path.split('/').at(-1)),body=request.postDataJSON()
      writes.push({path,body})
      if(body.action==='confirm')booking.status='CONFIRMED'
      booking.version++
      return json(booking)
    }
    if(path.match(/^\/api\/admin\/chats\/chat-\d+\/messages$/)&&request.method()==='POST'){
      writes.push({path,body:request.postDataJSON()})
      return json({id:'sent-fixture',seq:81,direction:'OUT',kind:'text',content:request.postDataJSON().content,senderName:'总部管理员',deliveryStatus:'SENT',createdAt:time})
    }
    if(path==='/api/admin/inbox/read'&&request.method()==='POST')return json({ok:true})
    if(request.method()!=='GET'){unknown.push(`${request.method()} ${path}`);return route.fulfill({status:405,json:{message:'Visual audit does not write business data'}})}
    if(path==='/api/admin/wechat-menu')return json({revision:1,draft:{button:[{name:'门店预约',type:'view',url:'https://www.yuhetangtcm.com'}]},savedAt:time,credentialsConfigured:true,pages:[{name:'预约',path:'pages/booking/index'}]})
    if(path==='/api/admin/inbox/summary')return json({items:[{id:'notice-1',appointmentId:currentBookings[0].id,storeId:'bailemen',eventLabel:'新预约申请',payload:{storeName:'百乐门店',serviceName:'经络调养',time:'2026-11-09 10:00'},createdAt:time}],unreadTotal:1,total:1,asOf:time})
    if(path==='/api/admin/chats/unread')return json({unreadTotal:2,latestSeq:80})
    if(path==='/api/admin/notifications/readiness')return json({sms:{configured:false},customer:{templates:[]},staff:{templates:[]}})
    if(path.endsWith('/payment'))return json({id:'payment-1',status:'UNPRICED',channel:'UNSELECTED',amountFen:null,currency:'CNY',memberStoreName:'余姚门店',serviceStoreName:'百乐门店',wechatPayEnabled:false,balancePayEnabled:false,version:1})
    if(path==='/api/runtime')return json({developmentLogin:false})
    if(path==='/api/admin/me')return json({id:hq?'hq-user':'store-user',name:hq?'总部管理员':'百乐门店长',hq,storeId:hq?'':'bailemen',roleIds:[hq?'hq':'manager'],permissions:hq?permissions:roles[1].permissions})
    if(path==='/api/admin/stores')return json(stores)
    if(path==='/api/site'||path==='/api/admin/content')return json(site)
    if(path==='/api/admin/dashboard')return json({counts:[{status:'PENDING',total:8},{status:'CONFIRMED',total:12},{status:'COMPLETED',total:36}],trend:Array.from({length:7},(_,i)=>({date:`2026-11-0${i+1}`,count:3+i*2})),sources:[{source:'MINIPROGRAM',total:40},{source:'PHONE',total:16}],recent:bookings.slice(0,4)})
    if(path==='/api/admin/appointments')return json({items:currentBookings,total:currentBookings.length,page:1})
    if(/^\/api\/admin\/appointments\/[^/]+\/slots$/.test(path)||/^\/api\/stores\/[^/]+\/slots$/.test(path))return json({date:'2026-11-07',storeId:'bailemen',rules,slots:[{time:'10:00',capacity:4,used:1,remaining:3,available:true},{time:'14:30',capacity:4,used:0,remaining:4,available:true}]})
    if(/^\/api\/admin\/appointments\/[^/]+$/.test(path))return json(currentBookings.find(b=>b.id===path.split('/').at(-1))||currentBookings[0])
    if(/^\/api\/(?:admin\/)?stores\/[^/]+\/services$/.test(path))return json(services)
    if(/^\/api\/admin\/stores\/[^/]+\/rules$/.test(path))return json(rules)
    if(/^\/api\/admin\/stores\/[^/]+\/slots$/.test(path))return json([])
    if(path==='/api/admin/therapists')return json(Array.from({length:6},(_,i)=>({id:`therapist-${i}`,storeId:i%2?'yuyao':'bailemen',storeName:i%2?'余姚门店':'百乐门店',name:`示例调理师${i+1}`,grade:'资深调理师',specialty:'经络调养 · 肩颈舒缓',serviceIds:['care-1','care-2'],image:'/media/ritual.webp',enabled:true,resting:i===3,showOnClient:true})))
    if(path==='/api/admin/customers')return json({items:Array.from({length:12},(_,i)=>({id:`customer-${i}`,name:`示例客户${i+1}`,phone:'138****0000',storeId:'bailemen',memberVerified:i%2===0,memberGrade:'常客',privateNote:'已沟通预约时间，下次到店前联系确认。',source:'微信小程序',sharedNote:''})),total:12})
    if(path==='/api/admin/chats')return json({items:Array.from({length:30},(_,i)=>conversation(i+1)),total:30,page:1,pageSize:30,unreadTotal:2})
    if(/^\/api\/admin\/chats\/chat-\d+\/messages$/.test(path)){
      const after=Number(url.searchParams.get('after'))||0
      const initial=after>0?[]:Array.from({length:80},(_,i)=>({id:`message-${i}`,seq:i+1,direction:i%2?'OUT':'IN',kind:'text',content:i%2?'您好，可以在小程序查看本店养护项目，也可以告诉我们您的到店时间。':'您好，我想预约明天的经络调养，请问下午还有时间吗？',senderName:i%2?'示例店长':'示例客户',deliveryStatus:i%2?'SENT':'RECEIVED',createdAt:time}))
      return json({conversation:conversation(Number(path.split('/')[4].split('-')[1])),items:[...initial,...chatState.incoming.filter(m=>path.includes('/chat-1/')&&m.seq>after)]})
    }
    if(path==='/api/admin/inbox')return json([])
    if(path==='/api/admin/users')return json(users)
    if(path==='/api/admin/roles')return json(roles)
    if(path==='/api/admin/permissions')return json(permissions.map(code=>({code,name:code,module:code.split(':')[0],headquartersOnly:code.startsWith('imports:')})))
    if(path==='/api/admin/assets')return json(Array.from({length:10},(_,i)=>({id:`asset-${i}`,url:i%2?'/media/store-07.webp':'/media/store-02.webp',title:i%2?'门店茶席':'门店空间'})))
    if(path==='/api/admin/notifications/config')return json({channels:{pcEnabled:true,wechatStaffEnabled:true,wechatCustomerEnabled:true,smsStaffEnabled:false,smsCustomerEnabled:false,smsPhone:''},serviceConfigured:false,serviceTemplateConfigured:false,customerTemplateConfigured:true,customerReminderTemplateConfigured:true,smsConfigured:false,recipient:null})
    if(path==='/api/admin/notifications')return json({items:[{id:'delivery-1',appointmentId:currentBookings[0].id,createdAt:time,channelGroup:'WECHAT',channel:'SERVICE',audience:'门店接收人',eventLabel:'新预约申请',deliveryStatus:'ACCEPTED',attempts:1,lastError:''}],total:1})
    if(path==='/api/admin/audit')return json({items:Array.from({length:40},(_,i)=>({id:`audit-${i}`,createdAt:time,actorName:'示例店长',storeId:'bailemen',action:'APPOINTMENT_CONFIRM',targetId:`APPOINTMENT-${i+1}`,detail:'确认客户到店预约'})),total:40})
    if(path==='/api/admin/integrations')return json({pms:{enabled:false,port:8791,schemaVersion:1,pending:0,description:'业务事件接口待接入'}})
    if(path==='/api/admin/settings')return json({sharedLookupEnabled:'false',serviceTemplateMapping:'{}',customerTemplateMapping:'{"name1":"customerName","date2":"time","thing3":"serviceName","thing4":"storeName","phrase5":"status"}',customerReminderTemplateMapping:'{"thing31":"customerName","time2":"time","thing7":"serviceName","thing8":"storeName","phrase11":"status"}'})
    if(path==='/api/admin/dianping/config')return json({shops:[],products:[],batches:[],stores,orderCount:0,customerLinkCount:0})
    if(path==='/api/admin/dianping/orders')return json({items:[],total:0})
    unknown.push(`GET ${path}`);return route.fulfill({status:404,json:{message:`Missing fixture: ${path}`}})
  })
  return chatState
}
