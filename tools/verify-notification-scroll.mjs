import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {serveAdmin,mockAdmin,unknown} from './admin-responsive-fixtures.mjs'

// Exercise the built UI with enough records to scroll. All APIs are local fixtures;
// neither WeChat messages nor real read receipts or configuration writes are sent.
const output=resolve('backups/notification-scroll')
await mkdir(output,{recursive:true})
const server=await serveAdmin(),browser=await chromium.launch({channel:'msedge',headless:true})
const results=[],errors=[],requests=[]
const builtIndexSha256=createHash('sha256').update(await readFile('dist/index.html')).digest('hex')
let passed=false,failNext=false,activePage
const sizes=[[320,568],[360,780],[390,844],[768,1024],[1024,768],[1366,768],[1920,1080]]
const geometry=page=>page.evaluate(()=>{
  const box=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}}
  const list=document.querySelector('.notification-record-scroll,.personal-inbox-list,.notification-settings-scroll')
  return {width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,
    mainScroll:document.querySelector('.ops-main').scrollTop,windowScroll:scrollY,listScroll:list.scrollTop,listHeight:list.clientHeight,listContent:list.scrollHeight,
    list:box('.notification-record-scroll,.personal-inbox-list,.notification-settings-scroll'),
    heading:box('.ops-page-heading'),tabs:box('.notification-view-tabs'),
    footer:box('.ops-footer'),pager:document.querySelector('.notifications-workspace .pager')?box('.notifications-workspace .pager'):null,
    filters:document.querySelector('.notification-filters')?box('.notification-filters'):null,
    refresh:document.querySelector('.notification-records .card-heading button')?box('.notification-records .card-heading button'):null}
})
async function settled(page){await page.waitForTimeout(150)}
async function assertFrame(page,name){
  const value=await geometry(page)
  if(value.listHeight<95){
    await page.screenshot({path:resolve(output,`${name}-failure.png`),animations:'disabled'})
  }
  assert(value.documentWidth<=value.width+1,`${name}: horizontal page overflow`)
  assert(value.documentHeight<=value.height+1,`${name}: document scrolls`)
  assert.equal(value.mainScroll,0,`${name}: outer work area scrolls`)
  assert.equal(value.windowScroll,0,`${name}: browser page scrolls`)
  assert(value.listHeight>=95,`${name}: list collapsed: ${JSON.stringify(value)}`)
  assert(value.list.bottom<=value.footer.top+1,`${name}: list crosses footer`)
  if(value.pager){assert(value.pager.bottom<=value.footer.top+1,`${name}: pagination is offscreen`);assert(value.pager.top>=value.list.bottom-1,`${name}: pagination overlaps list`)}
  return value
}
async function assertScroll(page,selector,name){
  const before=await assertFrame(page,name),list=page.locator(selector)
  assert(before.listContent>before.listHeight+100,`${name}: fixture must overflow`)
  await list.hover();await page.mouse.wheel(0,650);await settled(page)
  const after=await assertFrame(page,name)
  assert(after.listScroll>0,`${name}: mouse wheel did not scroll content`)
  for(const key of ['heading','tabs','pager','filters','refresh'])if(before[key])assert.deepEqual(after[key],before[key],`${name}: ${key} moved with content`)
  await list.evaluate(e=>{e.scrollTop=e.scrollHeight})
  await page.mouse.wheel(0,600);await settled(page)
  await assertFrame(page,`${name}-end`)
  await list.evaluate(e=>{e.scrollTop=0});await list.focus();await page.keyboard.press('PageDown');await settled(page)
  assert((await geometry(page)).listScroll>0,`${name}: keyboard cannot scroll focused list`)
  return after
}
try{
  for(const [width,height] of sizes){
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<1024})
    await mockAdmin(context)
    await context.route('**/api/admin/notifications?**',async route=>{
      const params=new URL(route.request().url()).searchParams
      requests.push(Object.fromEntries(params))
      if(failNext){failNext=false;return route.fulfill({status:503,json:{message:'测试连接暂时不可用'}})}
      const page=Number(params.get('page'))||1,customer=params.get('audience')==='CUSTOMER'
      const items=params.get('status')==='FAILED'?[]:Array.from({length:30},(_,i)=>({
        id:`${customer?'customer':'staff'}-${page}-${i}`,appointmentId:`YHT-TEST-${page}-${i}`,createdAt:'2026-11-10T18:30:00+08:00',
        channelGroup:params.get('channel')||'WECHAT',channel:customer?'SUBSCRIBE':'SERVICE',audience:customer?'预约客户':'门店接收人',
        eventLabel:`${params.get('storeId')||'全部门店'} · 新预约申请 ${page}-${i}`,deliveryStatus:'ACCEPTED',attempts:1,
        lastError:'平台已接受请求；接收人是否已读以实际情况为准。较长说明需要完整换行，不影响其他字段和列表滚动。'
      }))
      return route.fulfill({json:{items,total:items.length?90:0,page,pageSize:30}})
    })
    await context.route('**/api/admin/inbox/summary?**',route=>route.fulfill({json:{
      items:Array.from({length:20},(_,i)=>({id:`inbox-${i}`,appointmentId:`TEST-${i}`,storeId:'bailemen',eventLabel:'新预约申请',createdAt:'2026-11-10T18:30:00+08:00',isRead:false,payload:{storeName:'百乐门店',serviceName:'经络调养',time:'2026-11-11 10:30'}})),
      total:60,unreadTotal:60,asOf:'2026-11-10T18:30:00+08:00'
    }}))
    const page=await context.newPage()
    activePage=page
    page.on('pageerror',error=>errors.push(error.message))
    await page.clock.install()
    await page.goto(server.base+'/admin')
    await page.locator('.ops-topbar').waitFor()
    if(width<1024){
      await page.getByRole('button',{name:'打开管理导航',exact:true}).click()
      await page.locator('.ops-mobile-navigation').getByRole('button',{name:'消息中心',exact:true}).click()
      await page.clock.runFor(400)
    }else await page.locator('.ops-sidebar').getByRole('button',{name:'消息中心',exact:true}).click()
    await page.locator('.notification-record-scroll tbody tr').first().waitFor()
    await settled(page)
    const before=await assertScroll(page,'.notification-record-scroll',`${width}-records`)
    if(width<768){
      const cdp=await context.newCDPSession(page),area=before.list
      await page.locator('.notification-record-scroll').evaluate(e=>{e.scrollTop=0})
      const x=Math.round((area.left+area.right)/2),y=Math.round(area.bottom-8),distance=Math.min(160,area.height-16)
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
      for(let step=1;step<=8;step++){
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-distance*step/8}]})
        await page.clock.runFor(20)
      }
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      await page.clock.runFor(300)
      // A tap stops inertial scrolling before checking refresh position separately.
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]})
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
      await page.clock.runFor(400)
      await settled(page)
      assert((await geometry(page)).listScroll>0,`${width}: touch gesture cannot scroll records`)
      await assertFrame(page,`${width}-touch`)
      await cdp.detach()
    }
    const position=(await geometry(page)).listScroll
    const count=requests.length
    await page.getByRole('button',{name:'刷新记录',exact:true}).click()
    await page.waitForFunction(()=>document.querySelectorAll('.notification-record-scroll tbody tr').length===30)
    await settled(page)
    assert(requests.length>count,`${width}: refresh did not request records`)
    assert.equal((await geometry(page)).listScroll,position,`${width}: refresh lost reading position`)
    await page.clock.fastForward(36000);await settled(page)
    assert.equal((await geometry(page)).listScroll,position,`${width}: automatic refresh lost reading position`)
    await page.locator('.notification-records .ant-pagination-next').click()
    await page.getByText('YHT-TEST-2-0',{exact:true}).waitFor()
    assert.equal((await geometry(page)).listScroll,0,`${width}: new page must start at the top`)
    if(width<768){await page.getByRole('combobox',{name:'通知渠道',exact:true}).click();await page.clock.runFor(250);await page.getByRole('option',{name:'微信消息',exact:true}).click();await page.clock.runFor(350)}
    else await page.getByRole('button',{name:'微信消息',exact:true}).click()
    await settled(page)
    assert(requests.at(-1).channel==='WECHAT'&&requests.at(-1).page==='1')
    await page.getByRole('combobox',{name:'通知发送状态',exact:true}).click()
    await page.clock.runFor(250) // Let the popup's entrance animation finish under the controlled clock.
    await page.getByRole('option',{name:'发送失败',exact:true}).click();await page.clock.runFor(350)
    await page.getByText('暂无符合条件的管理后台通知记录',{exact:true}).waitFor()
    await assertFrame(page,`${width}-empty`)
    await page.getByRole('combobox',{name:'通知发送状态',exact:true}).click()
    await page.clock.runFor(250)
    await page.getByRole('option',{name:'全部发送状态',exact:true}).click();await page.clock.runFor(350)
    await page.locator('.notification-record-scroll tbody tr').first().waitFor()
    failNext=true;await page.getByRole('button',{name:'刷新记录',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'测试连接暂时不可用'}).waitFor()
    assert.equal(await page.locator('.notification-record-scroll tbody tr').count(),30,'Failure preserves loaded records')
    await assertFrame(page,`${width}-retry`)
    await page.getByRole('button',{name:'刷新记录',exact:true}).click()
    await page.getByRole('alert').filter({hasText:'测试连接暂时不可用'}).waitFor({state:'hidden'})
    await page.getByRole('combobox',{name:'门店范围',exact:true}).click()
    await page.clock.runFor(250)
    await page.getByRole('option',{name:'百乐门店',exact:true}).click();await page.clock.runFor(350)
    await page.getByText('bailemen · 新预约申请 1-0',{exact:true}).waitFor()
    assert.equal((await geometry(page)).listScroll,0)
    await page.getByRole('button',{name:'客户消息推送',exact:false}).click()
    await page.getByText('小程序订阅消息',{exact:true}).first().waitFor()
    assert.equal(await page.getByRole('button',{name:'本账号站内消息',exact:true}).count(),0)
    await assertScroll(page,'.notification-record-scroll',`${width}-customer`)
    await page.screenshot({path:resolve(output,`${width}-customer-records.png`),animations:'disabled'})
    await page.getByRole('button',{name:'管理后台消息推送',exact:false}).click()
    await page.locator('.notification-record-scroll tbody tr').first().waitFor()
    await page.screenshot({path:resolve(output,`${width}-staff-records.png`),animations:'disabled'})
    await page.getByRole('button',{name:'本账号站内消息',exact:true}).click()
    await page.locator('.personal-message').first().waitFor()
    await assertScroll(page,'.personal-inbox-list',`${width}-inbox`)
    await page.screenshot({path:resolve(output,`${width}-inbox.png`),animations:'disabled'})
    await page.getByRole('button',{name:'推送设置',exact:true}).click()
    await page.getByRole('heading',{name:'店长微信提醒',exact:true}).waitFor()
    const settings=await assertFrame(page,`${width}-settings`)
    if(settings.listContent>settings.listHeight+100)await assertScroll(page,'.notification-settings-scroll',`${width}-settings`)
    await page.screenshot({path:resolve(output,`${width}-settings.png`),animations:'disabled'})
    await page.getByRole('button',{name:'通知记录',exact:true}).click()
    await page.locator('.notification-record-scroll tbody tr').first().waitFor()
    await assertFrame(page,`${width}-return`)
    results.push({width,height,recordsHeight:before.listHeight,recordsContent:before.listContent,checks:['records and inbox scroll internally','outer header, filters and pagination stay in place','no scroll chaining','keyboard scrolling','manual and automatic refresh preserve position','pagination and filters reset position','empty and error recovery','store scope and audience separation','settings independently accessible']})
    await context.close()
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  passed=true
}catch(error){
  if(activePage&&!activePage.isClosed()){
    await activePage.screenshot({path:resolve(output,'failure.png'),animations:'disabled'})
    await writeFile(resolve(output,'failure.json'),JSON.stringify({error:String(error),requests:requests.slice(-20),state:await activePage.evaluate(()=>({hidden:document.hidden,text:document.body.innerText,selects:[...document.querySelectorAll('.ant-select-selection-item')].map(e=>e.textContent)}))},null,2))
  }
  throw error
}finally{
  const report={status:passed?'passed':'failed',at:new Date().toISOString(),builtIndexSha256,liveApisUsed:false,realMessagesSent:false,results,errors,unknown}
  await writeFile(resolve(output,'result.json'),JSON.stringify(report,null,2))
  await browser.close();await server.close()
  console.log(JSON.stringify(report,null,2))
}
