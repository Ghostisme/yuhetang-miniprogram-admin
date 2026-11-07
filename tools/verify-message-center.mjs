import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'

// All APIs and desktop notifications are fixtures. This never sends real messages.
const origin='http://127.0.0.1:5181',output='backups/notifications'
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true})
const checks=[],errors=[],unknown=[],desktop=[]
const now=new Date().toISOString()
const templates=[
  {kind:'result',title:'预约处理提醒',templateId:'fixture-result-template',ready:true,issue:''},
  {kind:'reminder',title:'到店时间提醒',templateId:'fixture-reminder-template',ready:true,issue:''},
]
async function fixture({readonly=false,storeAccount=false}={}){
  const context=await browser.newContext({viewport:{width:2560,height:1440}})
  const state={rows:[{id:'notice-1',storeId:'fixture-store',appointmentId:'booking-fixture',eventLabel:'新预约申请',eventType:'appointment.created',createdAt:now,payload:{storeName:'上海中心店',serviceName:'养护项目',time:'2026-11-09 10:00'},isRead:false}],chatUnread:2,latestSeq:2,channels:{storeId:'fixture-store',revision:1,pcEnabled:true,wechatCustomerEnabled:true,wechatStaffEnabled:false,smsStaffEnabled:false,smsCustomerEnabled:false,smsPhone:'13900002001',smsPhoneMasked:'139****2001'},calls:[],checks:[],saves:[],bindings:[],failInbox:false}
  await context.exposeBinding('fixtureDesktop',(_,notice)=>desktop.push(notice))
  await context.addInitScript(()=>{
    sessionStorage.setItem('yht-admin-token','fixture-only')
    window.fixtureHidden=false
    Object.defineProperty(document,'hidden',{get:()=>window.fixtureHidden})
    class FixtureNotification{
      static permission='granted'
      static async requestPermission(){return 'granted'}
      constructor(title,options){void window.fixtureDesktop({title,...options})}
      close(){}
    }
    window.Notification=FixtureNotification
  })
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method()
    state.calls.push({path,method,query:url.search,body:method==='GET'?undefined:req.postDataJSON()})
    const json=data=>route.fulfill({json:data})
    if(method==='GET'){
      if(path==='/api/runtime')return json({developmentLogin:false})
      if(path==='/api/admin/me')return json({id:'fixture-admin',name:readonly?'测试前台':'测试管理员',hq:!storeAccount,storeId:storeAccount?'fixture-store':'',roleIds:[],permissions:['notifications:read','appointments:read','chat:read',...(!readonly?['notifications:write','users:read']:[])]})
      if(path==='/api/admin/stores')return json([{id:'fixture-store',name:'上海中心店',enabled:true},{id:'other-store',name:'余姚店',enabled:true}])
      if(path==='/api/site')return json({brandName:'裕和堂',theme:'sage',hero:{},contact:{},stores:[],services:[],products:[],sections:[],galleryGroups:[]})
      if(path==='/api/admin/appointments')return json({items:[],total:0,page:1,pageSize:20})
      if(path==='/api/admin/chats/unread')return json({unreadTotal:state.chatUnread,latestSeq:state.latestSeq})
      if(path==='/api/admin/inbox/summary'){
        if(state.failInbox)return route.fulfill({status:503,json:{message:'测试同步失败'}})
        const all=state.rows.filter(r=>!url.searchParams.get('storeId')||r.storeId===url.searchParams.get('storeId'))
        const items=all.filter(r=>url.searchParams.get('unreadOnly')!=='true'||!r.isRead)
        return json({items,total:items.length,unreadTotal:all.filter(r=>!r.isRead).length,page:1,asOf:now})
      }
      if(path==='/api/admin/notifications/readiness')return json({customer:{templates,credentialsConfigured:true},staff:{ready:false,issues:['待配置认证服务号 AppID / AppSecret。','待配置门店人员服务号模板 ID。']},sms:{configured:false,staffIssue:'腾讯云短信尚未配置',customerIssue:'腾讯云短信尚未配置'}})
      if(path==='/api/admin/notifications/config')return json({channels:{...state.channels,storeId:url.searchParams.get('storeId'),...(readonly?{smsPhone:''}:{})},recipient:{},serviceConfigured:false,serviceTemplateConfigured:false})
      if(path==='/api/admin/users')return json([{id:'manager-fixture',displayName:'上海中心店店长',username:'shanghai',enabled:true,storeId:'fixture-store'}])
      if(path==='/api/admin/notifications'){
        const customer=url.searchParams.get('audience')==='CUSTOMER'
        const row={id:customer?'customer-delivery':'staff-delivery',appointmentId:'booking-fixture',createdAt:now,channel:customer?'SUBSCRIBE':'INBOX',channelGroup:customer?'WECHAT':'PC',audience:customer?'预约客户':'后台账号',eventLabel:'预约处理',deliveryStatus:customer?'ACCEPTED':'AVAILABLE',attempts:customer?1:0,lastError:customer?'微信接口已受理；不代表用户已读。':'',providerMessageId:''}
        return json({items:[row],total:1})
      }
    }
    if(method==='POST'){
      const body=req.postDataJSON()
      if(path==='/api/admin/inbox/read'){for(const row of state.rows)if(body.ids.includes(row.id))row.isRead=true;return json({saved:true})}
      if(path==='/api/admin/inbox/read-all'){for(const row of state.rows)if((!body.storeId||row.storeId===body.storeId)&&row.createdAt<=body.asOf)row.isRead=true;return json({saved:true})}
      if(path==='/api/admin/notifications/wechat/check'){state.checks.push(body.audience);return json({credentialsVerified:true,templates,ready:true,message:'本次检查未发送客户或店长消息。'})}
    }
    if(method==='PUT'&&path==='/api/admin/notifications/config'){state.channels={...req.postDataJSON(),revision:state.channels.revision+1};state.saves.push({...state.channels});return json({channels:state.channels,recipient:{},serviceConfigured:false})}
    unknown.push(`${method} ${path}`);return route.fulfill({status:404,json:{message:'Unmocked API blocked'}})
  })
  async function page(){const page=await context.newPage();await page.clock.install();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/admin');await page.locator('.operations').waitFor();return page}
  return {context,state,page}
}
async function refresh(page){await page.evaluate(()=>window.dispatchEvent(new Event('yht-inbox-changed')));await page.waitForTimeout(150)}
async function selectStore(page){await page.getByRole('combobox',{name:'门店范围',exact:true}).click();await page.getByRole('option',{name:'上海中心店',exact:true}).click();await page.getByLabel('门店短信接收手机号',{exact:true}).waitFor()}
try{
  const {context,state,page:newPage}=await fixture(),page=await newPage()
  await page.getByRole('button',{name:'站内消息',exact:true}).click()
  await page.getByRole('dialog',{name:'后台未读消息'}).waitFor()
  assert.match(await page.locator('.inbox-popover').innerText(),/预约 1 条未读 · 咨询 2 条/)
  assert.equal(desktop.length,0,'Existing unread notifications must not spam on login')
  await page.getByRole('button',{name:'预约全部已读',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.inbox-popover header small')?.textContent?.includes('预约 0 条'))
  assert(state.rows.every(r=>r.isRead));assert.equal(state.chatUnread,2)
  checks.push('Bell combines counts; marking appointments read leaves consultation unread state intact')
  await page.getByRole('button',{name:'关闭消息',exact:true}).click()
  await page.locator('.ops-sidebar').getByRole('button',{name:'消息中心',exact:true}).click()
  for(const title of ['PC端消息通知','店长微信提醒','门店短信通知'])await page.getByRole('heading',{name:title,exact:true}).waitFor()
  await selectStore(page)
  await page.getByLabel('门店接收人微信提醒',{exact:true}).check()
  await page.getByRole('button',{name:'保存本店通知设置',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.notification-scope button')?.hasAttribute('disabled'))
  assert.equal(state.saves.at(-1).wechatStaffEnabled,true)
  assert.equal(await page.getByRole('button',{name:'生成微信绑定链接',exact:true}).isDisabled(),true)
  checks.push('Store settings save independently and missing service credentials keep binding disabled')
  await page.screenshot({path:output+'/staff-2560.png'})
  await page.setViewportSize({width:1366,height:768})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:output+'/staff-1366.png'})
  await page.getByRole('button',{name:'客户消息推送',exact:false}).click()
  await page.getByRole('heading',{name:'客户小程序订阅消息',exact:true}).waitFor()
  assert.equal(await page.getByRole('heading',{name:'本账号站内消息',exact:false}).count(),0)
  assert.match(await page.locator('.subscription-template-list').innerText(),/fixture-result-template/)
  assert.match(await page.locator('.subscription-template-list').innerText(),/fixture-reminder-template/)
  await page.getByRole('button',{name:'检查客户小程序配置',exact:true}).click()
  await page.getByRole('status').filter({hasText:'本次检查未发送客户或店长消息'}).waitFor()
  assert.deepEqual(state.checks,['CUSTOMER'])
  assert.match(await page.locator('.notification-records').innerText(),/小程序订阅消息/)
  checks.push('Customer view has separate templates, SMS settings, server validation and delivery history')
  await page.screenshot({path:output+'/customer-1366.png'})
  await page.setViewportSize({width:2560,height:1440});await page.screenshot({path:output+'/customer-2560.png'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  checks.push('Customer and staff views fit 1366 and 2560 widths without horizontal page overflow')

  // Two tabs share notification receipts; both poll the same new row.
  const other=await newPage();await other.waitForTimeout(200)
  const row={...state.rows[0],id:'notice-new',createdAt:new Date(Date.parse(now)+1000).toISOString(),isRead:false}
  state.rows.push(row)
  await Promise.all([refresh(page),refresh(other)])
  assert.equal(desktop.filter(r=>r.tag==='yht-inbox:notice-new').length,1)
  checks.push('New desktop reminder is shown once across two tabs with browser permission granted')
  await page.evaluate(()=>{window.fixtureHidden=true;document.dispatchEvent(new Event('visibilitychange'))})
  const count=state.calls.filter(c=>c.path==='/api/admin/chats/unread').length
  state.latestSeq=3;state.chatUnread=3
  await page.clock.fastForward(35000);await page.waitForTimeout(200)
  assert(state.calls.filter(c=>c.path==='/api/admin/chats/unread').length>count)
  assert.equal(desktop.filter(r=>r.tag==='yht-chat:3').length,1)
  checks.push('Notifications keep polling in a hidden tab and new consultation messages trigger desktop alerts')
  await page.evaluate(()=>{window.fixtureHidden=false;document.dispatchEvent(new Event('visibilitychange'))})
  await page.getByRole('button',{name:'站内消息',exact:true}).click()
  state.failInbox=true;await refresh(page)
  await page.getByRole('alert').filter({hasText:'消息同步暂时失败'}).waitFor()
  assert.match(await page.locator('.inbox-items').innerText(),/上海中心店/)
  state.failInbox=false;await refresh(page)
  checks.push('Temporary sync failure is visible and preserves already loaded notices')
  await page.locator('.inbox-items').getByRole('button',{name:'新预约申请 · 上海中心店',exact:false}).click()
  await page.getByPlaceholder('搜索称呼、手机号、预约编号').waitFor()
  assert.equal(await page.getByPlaceholder('搜索称呼、手机号、预约编号').inputValue(),'booking-fixture')
  checks.push('Opening a notice records a read receipt and opens appointments with that booking ID')
  await context.close()

  const reader=await fixture({readonly:true,storeAccount:true}),readPage=await reader.page()
  await readPage.locator('.ops-sidebar').getByRole('button',{name:'消息中心',exact:true}).click()
  await readPage.getByLabel('门店短信接收手机号',{exact:true}).waitFor()
  assert.equal(await readPage.getByLabel('门店短信接收手机号',{exact:true}).inputValue(),'139****2001')
  assert.equal(await readPage.getByLabel('门店短信接收手机号',{exact:true}).isDisabled(),true)
  assert.equal(await readPage.getByRole('button',{name:'保存本店通知设置',exact:true}).count(),0)
  assert.equal(await readPage.getByRole('button',{name:'检查店长服务号配置',exact:true}).count(),0)
  assert.equal(reader.state.calls.some(c=>c.path==='/api/admin/users'),false)
  checks.push('Read-only store users see masked contacts, personal messages, and no config mutations')
  await readPage.screenshot({path:output+'/readonly-2560.png'})
  await reader.context.close()
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  console.log(JSON.stringify({status:'passed',checks,liveApisUsed:false,realMessagesSent:false},null,2))
}finally{
  await writeFile(output+'/results.json',JSON.stringify({at:new Date().toISOString(),checks,errors,unknown,desktop},null,2))
  await browser.close()
}
