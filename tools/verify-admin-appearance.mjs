import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

// All APIs are fixtures. This check never logs in, modifies a database, or sends a message.
const base = process.env.APPEARANCE_BASE || 'http://127.0.0.1:5181'
const output = resolve(process.env.APPEARANCE_OUTPUT || 'backups/admin-appearance')
await mkdir(output, {recursive:true})
const source = (await Promise.all(['Admin','ChatInbox','Notifications','DataImports','Dianping'].map(n=>readFile(`src/${n}.tsx`,'utf8')))).join('\n')
const permissions = [...new Set([...source.matchAll(/['"]([a-z_]+:[a-z_]+)['"]/g)].map(m=>m[1]))]
const menus = [['dashboard','工作台'],['appointments','预约管理'],['customers','客户档案'],['therapists','调理师管理'],['chats','客户沟通'],['stores','门店与时段'],['content','品牌与内容'],['assets','图片素材'],['users','用户管理'],['roles','角色与权限'],['notifications','消息中心'],['imports','资料导入'],['audit','操作日志'],['integrations','扩展与配置']]
const time = '2026-11-07T10:00:00Z'
const services = [{id:'care-1',name:'经络调养',english:'WELLNESS CARE',subtitle:'舒缓疲劳，照顾日常',category:'东方养护',duration:'60分钟',image:'/media/ritual.webp',tag:'门店养护',enabled:true,description:'由专业调理师结合到店沟通，安排适合的养护服务。',steps:['到店沟通','细致养护','日常建议'],source:'STORE',version:1},{id:'care-2',name:'肩颈舒缓',english:'REST AND RESTORE',subtitle:'给身体留一点休息时间',category:'特色养护',duration:'45分钟',image:'/media/store-07.webp',tag:'特色项目',enabled:true,description:'温和、细致的肩颈养护体验。',steps:['到店沟通','肩颈养护'],source:'STORE',version:1}]
const stores = [{id:'bailemen',name:'百乐门店',district:'静安区',image:'/media/store-02.webp',address:'上海市静安区 · 示例门店地址',hours:'10:00—22:00',phone:'021-00000000',tag:'城市静养',description:'在城市里，留一段从容时光。',enabled:true,onlineBooking:true,gallery:['/media/store-02.webp','/media/store-07.webp'],services},{id:'yuyao',name:'余姚门店',district:'静安区',image:'/media/store-07.webp',address:'上海市静安区 · 示例门店地址',hours:'10:00—22:00',phone:'021-00000000',tag:'东方养护',description:'用心关照每一次到来。',enabled:true,onlineBooking:true,gallery:['/media/store-07.webp'],services}]
const site = {version:8,brandName:'裕和堂',brandEnglish:'YU HE TANG',tagline:'东方养护，自在有和。',theme:'sage',hero:{eyebrow:'A MOMENT FOR YOURSELF',title:'把时间\n留给自己。',subtitle:'在城市里，寻找一份身心的舒展。',image:'/media/store-07.webp',button:'预约一段时光'},brandStory:'以东方养护智慧，照顾每一份日常。\n在裕和堂，让身体与心绪慢慢放松。',contact:{phone:'021-00000000',wechat:'示例客服',message:'服务时间内，我们会及时回复您的咨询。'},sections:[{id:'services',name:'养护项目',enabled:true},{id:'stores',name:'门店空间',enabled:true},{id:'products',name:'品牌好物',enabled:true}],services,stores,products:[{id:'product-1',name:'草本茶饮',subtitle:'日常养护，从一杯温暖开始',image:'/media/herb-field.webp',category:'东方好物',description:'精选草本，舒心日常。',enabled:true}],galleryGroups:[{id:'space',name:'门店空间',images:['/media/store-07.webp','/media/store-02.webp']}],customerServiceEnabled:true}
const rules = {opens:'10:00',closes:'22:00',interval:30,capacity:4,advanceDays:7,minLeadMinutes:30,cancelHours:2,maxHeadcount:4,phoneOpenLimit:3,remindMinutes:15,closedDates:[]}
const bookings = Array.from({length:26},(_,i)=>({id:`APPOINTMENT-${i+1}`,customerName:`示例客户${i+1}`,phone:'138****0000',storeId:'bailemen',storeName:'百乐门店',serviceId:'care-1',serviceName:'经络调养',bookingDate:'2026-11-07',startTime:i%2?'14:30':'10:00',headcount:i%3+1,therapistIntentId:'therapist-1',therapistIntentName:'示例调理师',assignedTherapistId:'',assignedTherapistName:'待门店安排',memberClaim:'UNKNOWN',visitedClaim:'YES',remark:'请提前沟通到店安排。',status:i%3?'PENDING':'CONFIRMED',source:'MINIPROGRAM',version:1,createdAt:time,updatedAt:time,history:[]}))
const users = [{id:'store-user',username:'store-demo',displayName:'示例店长',storeId:'bailemen',enabled:true,roleIds:['manager']},{id:'hq-user',username:'headquarters-demo',displayName:'总部管理员',storeId:'',enabled:true,roleIds:['hq']}]
const roles = [{id:'hq',name:'总部管理员',dataScope:'GLOBAL',builtin:true,permissions},{id:'manager',name:'门店店长',dataScope:'STORE',builtin:false,permissions:permissions.filter(p=>!['imports','integrations'].some(prefix=>p.startsWith(prefix)))}]
const conversation = i=>({id:`chat-${i}`,displayName:`示例咨询客户${i}`,channel:'WECHAT',storeId:'bailemen',storeName:'百乐门店',status:'OPEN',activeRoute:true,replyRemaining:5,replyDeadline:Math.floor(Date.now()/1000)+3600,lastSeq:80,lastPreview:'您好，我想了解门店的养护项目和可预约时间。',updatedAt:time,unread:i===1?2:0})
const errors = [], results = [], unknown = []
const browser = await chromium.launch({channel:'msedge',headless:true})

async function mock(context, hq) {
  await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','appearance-fixture'))
  await context.route('**/api/**', async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname
    const json=data=>route.fulfill({json:data})
    if(path.match(/^\/api\/admin\/chats\/chat-\d+\/read$/)&&request.method()==='PATCH')return json({ok:true})
    if(request.method()!=='GET'){unknown.push(`${request.method()} ${path}`);return route.fulfill({status:405,json:{message:'Visual audit does not write business data'}})}
    if(path==='/api/runtime')return json({developmentLogin:false})
    if(path==='/api/admin/me')return json({id:hq?'hq-user':'store-user',name:hq?'总部管理员':'百乐门店长',hq,storeId:hq?'':'bailemen',roleIds:[hq?'hq':'manager'],permissions:hq?permissions:roles[1].permissions})
    if(path==='/api/admin/stores')return json(stores)
    if(path==='/api/site'||path==='/api/admin/content')return json(site)
    if(path==='/api/admin/dashboard')return json({counts:[{status:'PENDING',total:8},{status:'CONFIRMED',total:12},{status:'COMPLETED',total:36}],trend:Array.from({length:7},(_,i)=>({date:`2026-11-0${i+1}`,count:3+i*2})),sources:[{source:'MINIPROGRAM',total:40},{source:'PHONE',total:16}],recent:bookings.slice(0,4)})
    if(path==='/api/admin/appointments')return json({items:bookings,total:bookings.length,page:1})
    if(/^\/api\/admin\/appointments\/[^/]+\/slots$/.test(path)||/^\/api\/stores\/[^/]+\/slots$/.test(path))return json({date:'2026-11-07',storeId:'bailemen',rules,slots:[{time:'10:00',capacity:4,used:1,remaining:3,available:true},{time:'14:30',capacity:4,used:0,remaining:4,available:true}]})
    if(/^\/api\/admin\/appointments\/[^/]+$/.test(path))return json(bookings[0])
    if(/^\/api\/(?:admin\/)?stores\/[^/]+\/services$/.test(path))return json(services)
    if(/^\/api\/admin\/stores\/[^/]+\/rules$/.test(path))return json(rules)
    if(/^\/api\/admin\/stores\/[^/]+\/slots$/.test(path))return json([])
    if(path==='/api/admin/therapists')return json(Array.from({length:6},(_,i)=>({id:`therapist-${i}`,storeId:i%2?'yuyao':'bailemen',storeName:i%2?'余姚门店':'百乐门店',name:`示例调理师${i+1}`,grade:'资深调理师',specialty:'经络调养 · 肩颈舒缓',serviceIds:['care-1','care-2'],image:'/media/ritual.webp',enabled:true,resting:i===3,showOnClient:true})))
    if(path==='/api/admin/customers')return json({items:Array.from({length:12},(_,i)=>({id:`customer-${i}`,name:`示例客户${i+1}`,phone:'138****0000',storeId:'bailemen',memberVerified:i%2===0,memberGrade:'常客',privateNote:'已沟通预约时间，下次到店前联系确认。',source:'微信小程序',sharedNote:''})),total:12})
    if(path==='/api/admin/chats')return json({items:Array.from({length:30},(_,i)=>conversation(i+1)),total:30,page:1,pageSize:30,unreadTotal:2})
    if(/^\/api\/admin\/chats\/chat-\d+\/messages$/.test(path))return json({conversation:conversation(Number(path.split('/')[4].split('-')[1])),items:Number(url.searchParams.get('after'))>0?[]:Array.from({length:80},(_,i)=>({id:`message-${i}`,seq:i+1,direction:i%2?'OUT':'IN',kind:'text',content:i%2?'您好，可以在小程序查看本店养护项目，也可以告诉我们您的到店时间。':'您好，我想预约明天的经络调养，请问下午还有时间吗？',senderName:i%2?'示例店长':'示例客户',deliveryStatus:i%2?'SENT':'RECEIVED',createdAt:time}))})
    if(path==='/api/admin/inbox')return json([])
    if(path==='/api/admin/users')return json(users)
    if(path==='/api/admin/roles')return json(roles)
    if(path==='/api/admin/permissions')return json(permissions.map(code=>({code,name:code,module:code.split(':')[0],headquartersOnly:code.startsWith('imports:')})))
    if(path==='/api/admin/assets')return json(Array.from({length:10},(_,i)=>({id:`asset-${i}`,url:i%2?'/media/store-07.webp':'/media/store-02.webp',title:i%2?'门店茶席':'门店空间'})))
    if(path==='/api/admin/notifications/config')return json({channels:{pcEnabled:true,wechatStaffEnabled:true,wechatCustomerEnabled:true,smsStaffEnabled:false,smsCustomerEnabled:false,smsPhone:''},serviceConfigured:false,serviceTemplateConfigured:false,customerTemplateConfigured:true,customerReminderTemplateConfigured:true,smsConfigured:false,recipient:null})
    if(path==='/api/admin/notifications')return json({items:[],total:0})
    if(path==='/api/admin/audit')return json({items:Array.from({length:40},(_,i)=>({id:`audit-${i}`,createdAt:time,actorName:'示例店长',storeId:'bailemen',action:'APPOINTMENT_CONFIRM',targetId:`APPOINTMENT-${i+1}`,detail:'确认客户到店预约'})),total:40})
    if(path==='/api/admin/integrations')return json({pms:{enabled:false,port:8791,schemaVersion:1,pending:0,description:'业务事件接口待接入'}})
    if(path==='/api/admin/settings')return json({sharedLookupEnabled:'false',serviceTemplateMapping:'{}',customerTemplateMapping:'{"name1":"customerName","date2":"time","thing3":"serviceName","thing4":"storeName","phrase5":"status"}',customerReminderTemplateMapping:'{"thing31":"customerName","time2":"time","thing7":"serviceName","thing8":"storeName","phrase11":"status"}'})
    if(path==='/api/admin/dianping/config')return json({shops:[],products:[],batches:[],stores,orderCount:0,customerLinkCount:0})
    if(path==='/api/admin/dianping/orders')return json({items:[],total:0})
    unknown.push(`GET ${path}`);return route.fulfill({status:404,json:{message:`Missing fixture: ${path}`}})
  })
}

async function measure(page, name) {
  const result=await page.evaluate(name=>({name,width:innerWidth,height:innerHeight,docWidth:document.documentElement.scrollWidth,docHeight:document.documentElement.scrollHeight,mainScroll:document.querySelector('.ops-main')?.scrollTop,cards:[...document.querySelectorAll('.stat-card')].map(e=>({height:e.getBoundingClientRect().height,label:e.querySelector(':scope > span')?.getBoundingClientRect().bottom,value:e.querySelector('strong')?.getBoundingClientRect().top,footer:e.querySelector('p')?.getBoundingClientRect().bottom,bottom:e.getBoundingClientRect().bottom})),assets:[...document.querySelectorAll('.assets-grid > button')].map(e=>({height:e.getBoundingClientRect().height,scroll:e.scrollHeight,client:e.clientHeight})),buttons:[...document.querySelectorAll('.operations .ant-btn')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({text:e.textContent,height:e.getBoundingClientRect().height,scroll:e.scrollWidth,width:e.clientWidth}))}),name)
  assert(result.docWidth<=result.width+1,`${name}: horizontal page overflow`)
  if(result.width>750)assert(result.docHeight<=result.height+1,`${name}: outer page scroll`)
  for(const card of result.cards){assert(card.height>=138,`${name}: collapsed statistic card`);assert(card.value>=card.label,`${name}: statistic label and value overlap`);assert(card.footer<=card.bottom,`${name}: clipped statistic help text`)}
  for(const card of result.assets){assert(card.height>=(result.width<=750?150:220),`${name}: collapsed image card`);assert(card.scroll<=card.client+2,`${name}: clipped image card`)}
  for(const button of result.buttons)assert(button.height>=28,`${name}: collapsed action ${button.text}`)
  results.push(result)
  await page.screenshot({path:resolve(output,`${name}.png`),animations:'disabled'})
}

try {
  for(const hq of [true,false]){
    const context=await browser.newContext({viewport:{width:2560,height:1440}})
    await mock(context,hq)
    const page=await context.newPage()
    page.on('pageerror',e=>errors.push(e.message))
    await page.goto(base+'/admin')
    await page.locator('.stat-card').first().waitFor()
    for(const [width,height] of [[2560,1440],[1920,1080],[1366,768],[390,844]]){
      await page.setViewportSize({width,height})
      for(const [id,label] of menus){
        const menu=page.locator('.ops-sidebar').getByRole('button',{name:label,exact:true})
        if(!await menu.count())continue
        await menu.click()
        await page.locator(`.ops-main[data-page=${id}]`).waitFor()
        await page.waitForTimeout(120)
        await measure(page,`${hq?'hq':'store'}-${width}-${id}`)
      }
    }
    await page.setViewportSize({width:1366,height:768})
    await page.locator('.ops-sidebar').getByRole('button',{name:'工作台',exact:true}).click()
    if(hq){
      await page.getByRole('combobox',{name:'门店范围',exact:true}).click()
      const colors=await page.locator('.admin-select-popup .ant-select-item-option-selected').evaluate(e=>({background:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}))
      assert.equal(colors.background,'rgb(229, 237, 221)','Selected + active option must stay light sage')
      assert.equal(await page.locator('.scope-control .ant-select-content-has-value').evaluate(e=>getComputedStyle(e).opacity),'1','Opening the menu must not fade the selected store')
      const shadow=await page.locator('.admin-select-input').count().then(async n=>n?await page.locator('.admin-select-input').evaluate(e=>getComputedStyle(e).boxShadow):await page.locator('.ant-select-input').first().evaluate(e=>getComputedStyle(e).boxShadow))
      assert.equal(shadow,'none','Select input must not have a second focus shadow')
      await page.screenshot({path:resolve(output,'hq-1366-store-select.png'),animations:'disabled'})
      await page.getByRole('option',{name:'百乐门店',exact:true}).click()
    }
    await page.locator('.ops-sidebar').getByRole('button',{name:'门店与时段',exact:true}).click()
    for(const label of ['预约规则','临时安排','门店资料']){
      await page.locator('.settings-tabs').getByRole('button',{name:label,exact:true}).click()
      await measure(page,`${hq?'hq':'store'}-1366-store-${label}`)
    }
    await page.locator('.ops-sidebar').getByRole('button',{name:'预约管理',exact:true}).click()
    await page.getByRole('button',{name:'前台代约',exact:true}).click()
    await page.getByRole('dialog').waitFor()
    await page.screenshot({path:resolve(output,`${hq?'hq':'store'}-1366-booking-modal.png`),animations:'disabled'})
    const modal=await page.getByRole('dialog').boundingBox()
    assert(modal.y>=0&&modal.y+modal.height<=768, 'Booking form must stay inside the viewport')
    await page.locator('.ant-modal-close').click()
    await page.getByRole('button',{name:'当日时段视图',exact:true}).click()
    await page.locator('.calendar-booking').first().waitFor()
    assert((await page.locator('.calendar-booking').first().boundingBox()).height>=100,'Calendar bookings must retain their card layout')
    await measure(page,`${hq?'hq':'store'}-1366-calendar`)
    await page.locator('.ops-sidebar').getByRole('button',{name:'品牌与内容',exact:true}).click()
    for(const label of ['养护项目','品牌产品','空间相册']){
      const tab=page.locator('.content-toolbar').getByRole('button',{name:label,exact:true})
      if(!await tab.count())continue
      await tab.click();await measure(page,`${hq?'hq':'store'}-1366-content-${label}`)
    }
    if(hq){
      await page.route('**/api/admin/dashboard?*',route=>route.fulfill({json:{counts:[],trend:[],sources:[],recent:[]}}))
      await page.setViewportSize({width:2560,height:1440})
      await page.locator('.ops-sidebar').getByRole('button',{name:'工作台',exact:true}).click()
      await page.locator('.stat-card').first().waitFor()
      await measure(page,'hq-2560-empty-dashboard')
    }
    await context.close()
  }
  const loginContext=await browser.newContext()
  await loginContext.route('**/api/**',route=>route.fulfill({json:{developmentLogin:false}}))
  const loginPage=await loginContext.newPage()
  loginPage.on('pageerror',e=>errors.push(e.message))
  await loginPage.goto(base+'/admin')
  await loginPage.getByRole('button',{name:'登录管理后台',exact:true}).waitFor()
  for(const [width,height] of [[1366,768],[390,844]]){
    await loginPage.setViewportSize({width,height})
    await measure(loginPage,`login-${width}`)
  }
  await loginContext.close()
  assert.deepEqual(unknown,[],'Every API must be mocked')
  assert.deepEqual(errors,[],'No browser exceptions')
  console.log(JSON.stringify({status:'passed',screens:results.length,liveApisUsed:false,output},null,2))
} finally {
  await writeFile(resolve(output,'results.json'),JSON.stringify({results,errors,unknown},null,2))
  await browser.close()
}
