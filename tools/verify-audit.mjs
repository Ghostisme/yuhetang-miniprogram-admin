import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8790'
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true})
const pages=await Promise.all([
  browser.newPage({viewport:{width:390,height:844}}),
  browser.newPage({viewport:{width:1440,height:1080}}),
  browser.newPage({viewport:{width:1440,height:1080}})
])
const [customer,admin,manager]=pages,errors=[],checks=[],cleanup=[]
for(const page of pages){page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))}
await mkdir('docs/screenshots',{recursive:true})
let adminToken='',managerToken='',appointment,originalStore,storeDirty=false,report
const unique='核查客户'+Date.now().toString().slice(-7)
const phone='139'+Date.now().toString().slice(-8)
const dateAt=offset=>new Date(Date.now()+8*3600000+offset*86400000).toISOString().slice(0,10)
async function json(path,token='',method='GET',body){
  const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)})
  const data=await r.json();assert.equal(r.ok,true,`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);return data
}
async function login(page,username){
  await page.goto(base+'/admin');await page.getByPlaceholder('请输入账号').fill(username)
  await page.getByPlaceholder('请输入密码').fill('Yht@9800dev')
  await page.getByRole('button',{name:'登录管理后台',exact:true}).click()
  await page.getByRole('heading',{name:'工作台',exact:true,level:1}).waitFor()
  return page.evaluate(()=>sessionStorage.getItem('yht-admin-token'))
}
async function tab(page,name){await page.locator('.ops-sidebar').getByRole('button',{name,exact:name!=='预约管理'}).click();await page.getByRole('heading',{name,exact:true,level:1}).waitFor()}
async function rendered(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))}
async function patchAdmin(page,id,button){
  const [r]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/admin/appointments/'+id)&&r.request().method()==='PATCH'),page.getByRole('dialog').getByRole('button',{name:button,exact:true}).click()])
  const data=await r.json();assert.equal(r.status(),200,JSON.stringify(data));return data
}
async function ownRecord(){return json('/api/admin/appointments/'+appointment.id,adminToken)}
async function cancelOwnRecord(){
  if(!appointment||!adminToken)return
  const current=await ownRecord()
  if(['PENDING','CONFIRMED','ARRIVED'].includes(current.status))await json('/api/admin/appointments/'+current.id,adminToken,'PATCH',{action:'cancel',version:current.version,note:'本轮自动核查结束，取消专用测试预约并释放名额'})
  const cancelled=await ownRecord();assert.equal(cancelled.status,'CANCELLED')
  cleanup.push('测试预约 '+appointment.id+' 已取消并释放名额，保留正常操作记录')
}
try{
  const site=await json('/api/site'),store=site.stores.find(s=>s.id==='yuyao')
  const day=dateAt(1),nextDay=dateAt(2),slots=await json('/api/stores/yuyao/slots?date='+day)
  const slot=slots.slots.find(s=>s.available&&s.used===0&&s.remaining<=slots.rules.maxHeadcount&&s.remaining>=1)
  assert(slot,'Need an empty tomorrow slot that can be fully occupied by one test booking')
  const count=slot.remaining,service=site.services.find(s=>s.enabled&&!store.disabledServiceIds?.includes(s.id))
  assert(service)
  adminToken=await login(admin,'admin');managerToken=await login(manager,'yuyao')

  await tab(admin,'预约管理');await admin.getByRole('button',{name:'前台代约',exact:true}).click()
  assert.equal(await admin.getByLabel('接待门店',{exact:true}).inputValue(),'')
  assert.equal(await admin.getByRole('dialog').getByLabel('养护项目',{exact:false}).isDisabled(),true)
  assert(!(await admin.getByLabel('接待门店',{exact:true}).locator('option').evaluateAll(rows=>rows.map(r=>r.value))).includes('meihua'))
  await admin.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()
  checks.push('总部全部门店下前台代约必须主动选择接待门店，不默认上海，电话预约门店不出现在在线代约列表')

  await customer.goto(base)
  await customer.locator('.hero-copy button').click()
  await customer.locator('.choice-store').filter({hasText:store.name}).click()
  await customer.getByRole('button',{name:'选择养护项目',exact:false}).click()
  await customer.locator('.choice-service').filter({hasText:service.name}).click()
  await customer.getByRole('button',{name:'选择日期与时间',exact:false}).click()
  await customer.locator('.date-chips button').filter({hasText:'明天'}).click()
  await customer.getByLabel('同行人数',{exact:true}).selectOption(String(count))
  await customer.locator('.slot-grid button').filter({hasText:slot.time}).click()
  await customer.getByRole('button',{name:'填写联系信息',exact:false}).click()
  await customer.getByPlaceholder('怎么称呼您').fill(unique)
  await customer.getByPlaceholder('请输入11位手机号码').fill(phone)
  const teachers=await json('/api/stores/yuyao/therapists')
  const teacher=teachers.find(t=>t.enabled&&!t.resting&&t.serviceIds.includes(service.id));assert(teacher)
  await customer.getByLabel('意向调理师',{exact:false}).selectOption(teacher.id)
  await customer.getByLabel('是否已有会员',{exact:false}).selectOption('YES')
  await customer.getByLabel('是否来过门店',{exact:false}).selectOption('NO')
  await customer.locator('.consent-row input').last().check()
  const [response]=await Promise.all([customer.waitForResponse(r=>r.url().endsWith('/api/appointments')&&r.request().method()==='POST'),customer.getByRole('button',{name:'提交预约申请',exact:false}).click()])
  appointment=await response.json();assert.equal(response.status(),200,JSON.stringify(appointment))
  assert.equal(appointment.status,'PENDING');assert.equal(appointment.memberClaim,'YES');assert.equal(appointment.headcount,count)
  await customer.getByText('温馨提示：当前尚未预约成功',{exact:true}).waitFor()
  await customer.screenshot({path:'docs/screenshots/audit-customer-pending.png',fullPage:true})
  const occupied=await json('/api/stores/yuyao/slots?date='+day)
  assert.equal(occupied.slots.find(s=>s.time===slot.time).remaining,0)
  checks.push('客户真实提交门店、项目、人数、意向老师与会员自述；回执明确尚未预约成功，真实占用名额')

  for(const page of [admin,manager]){
    await tab(page,'预约管理');await page.getByLabel('搜索预约',{exact:true}).fill(appointment.id)
    await page.locator('.ops-table tbody tr').filter({hasText:unique}).waitFor()
  }
  const row=manager.locator('.ops-table tbody tr').filter({hasText:unique})
  await row.getByRole('button',{name:'查看处理',exact:false}).click()
  await manager.getByLabel('实际调理师',{exact:true}).selectOption(teacher.id)
  await patchAdmin(manager,appointment.id,'保存人员分配')
  await patchAdmin(manager,appointment.id,'确认接待')
  await manager.getByRole('dialog').getByText('门店已确认',{exact:true}).first().waitFor()
  await customer.getByRole('button',{name:'查看我的预约申请',exact:false}).click()
  const card=customer.locator('.order-card').filter({hasText:appointment.id})
  await card.getByText('门店已确认接待，请按约定时间到店。',{exact:true}).waitFor()
  assert((await card.locator('.order-therapist').innerText()).includes(teacher.name))
  checks.push('总部和本店页面均查到新申请；门店实际分配老师并确认后，客户页面显示确认及老师安排')

  await card.getByRole('button',{name:'申请改约',exact:true}).click()
  await customer.getByLabel('改约时间',{exact:true}).locator('option').filter({hasText:slot.time}).waitFor({state:'attached'})
  await customer.getByLabel('改约时间',{exact:true}).selectOption(slot.time)
  assert.equal(await customer.getByRole('button',{name:'提交改约申请',exact:true}).isDisabled(),false)
  await customer.getByLabel('改约日期',{exact:true}).fill(nextDay)
  assert.equal(await customer.getByLabel('改约时间',{exact:true}).inputValue(),'')
  assert.equal(await customer.getByRole('button',{name:'提交改约申请',exact:true}).isDisabled(),true)
  const nextSlots=await json('/api/stores/yuyao/slots?date='+nextDay)
  const nextSlot=nextSlots.slots.find(s=>s.available&&s.remaining>=count);assert(nextSlot)
  await customer.getByLabel('改约时间',{exact:true}).locator('option').filter({hasText:nextSlot.time}).waitFor({state:'attached'})
  await customer.getByLabel('改约时间',{exact:true}).selectOption(nextSlot.time)
  const [changedResponse]=await Promise.all([customer.waitForResponse(r=>r.url().endsWith('/api/me/appointments/'+appointment.id)&&r.request().method()==='PATCH'),customer.getByRole('button',{name:'提交改约申请',exact:true}).click()])
  assert.equal(changedResponse.status(),200,await changedResponse.text())
  await card.getByText('申请已收到，等待人工审核确认。当前尚未预约成功。',{exact:true}).waitFor()
  const changed=await ownRecord();assert.equal(changed.status,'PENDING');assert.equal(changed.bookingDate,nextDay);assert(!changed.assignedTherapistId)
  assert.equal((await json('/api/stores/yuyao/slots?date='+day)).slots.find(s=>s.time===slot.time).remaining,slot.remaining)
  checks.push('原时段被自己的预约占满仍可选择；改日期清空旧时段；改约释放原名额、清空实际分配并回到待人工确认')
  await manager.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()
  await tab(manager,'工作台');await tab(manager,'预约管理')
  await manager.getByLabel('搜索预约',{exact:true}).fill(appointment.id)
  await manager.locator('.ops-table tbody tr').filter({hasText:unique}).getByRole('button',{name:'查看处理',exact:false}).click()
  await manager.getByRole('dialog').getByText('待门店确认',{exact:true}).first().waitFor()
  assert.equal(await manager.getByLabel('实际调理师',{exact:true}).inputValue(),'')
  assert.equal(await manager.getByLabel('后台改约日期',{exact:true}).inputValue(),nextDay)
  await manager.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()

  const other=(await json('/api/admin/login','','POST',{username:'bailemen',password:'Yht@9800dev'})).token
  for(const path of ['/api/admin/appointments/'+appointment.id,'/api/admin/appointments?storeId=yuyao','/api/admin/appointments/'+appointment.id+'/slots?date='+day]){
    const r=await fetch(base+path,{headers:{Authorization:'Bearer '+other}});assert.equal(r.status,404)
  }
  checks.push('百乐门账号无法读取余姚预约、列表及改约名额接口；均返回404')

  // Hold the old branch response until the next branch has already rendered.
  await admin.getByLabel('搜索预约',{exact:true}).fill('')
  let releaseOld,oldReceived,held=false
  const oldReady=new Promise(resolve=>oldReceived=resolve)
  const gate=new Promise(resolve=>releaseOld=resolve)
  const pattern='**/api/admin/appointments?*'
  const handler=async route=>{
    if(new URL(route.request().url()).searchParams.get('storeId')==='yuyao'&&!held){held=true;const response=await route.fetch();oldReceived();await gate;await route.fulfill({response})}else await route.continue()
  }
  await admin.route(pattern,handler)
  try{
    await admin.getByLabel('门店范围',{exact:true}).selectOption('yuyao');await oldReady
    const nextResponse=admin.waitForResponse(r=>r.url().includes('/api/admin/appointments?')&&new URL(r.url()).searchParams.get('storeId')==='bai-le-men')
    await admin.getByLabel('门店范围',{exact:true}).selectOption('bai-le-men');assert.equal((await nextResponse).status(),200)
    const delayedResponse=admin.waitForResponse(r=>r.url().includes('/api/admin/appointments?')&&new URL(r.url()).searchParams.get('storeId')==='yuyao')
    releaseOld();await delayedResponse;await rendered(admin)
    assert.equal(await admin.getByLabel('门店范围',{exact:true}).inputValue(),'bai-le-men')
    assert(!(await admin.locator('.ops-main').innerText()).includes(unique))
    assert(!(await admin.locator('.ops-table tbody').allTextContents()).join('').includes('余姚路'))
  }finally{releaseOld();await admin.unroute(pattern,handler)}
  checks.push('真实延迟余姚门店请求，再切百乐门；旧响应返回后仍保持百乐门范围及数据，不串店')

  await admin.getByLabel('门店范围',{exact:true}).selectOption('')
  await tab(admin,'消息中心')
  await admin.getByText('当前查看全部门店的消息记录。请先在右上角选择具体门店，再配置该店的消息接收人。',{exact:true}).waitFor()
  assert.equal(await admin.getByLabel('门店消息接收账号',{exact:true}).count(),0)
  await admin.getByLabel('门店范围',{exact:true}).selectOption('yuyao')
  const picker=admin.getByLabel('门店消息接收账号',{exact:true})
  await picker.locator('option[value="yuyao-manager"]').waitFor({state:'attached'});await picker.selectOption('yuyao-manager')
  await admin.getByLabel('门店范围',{exact:true}).selectOption('bai-le-men')
  await picker.locator('option[value="bai-manager"]').waitFor({state:'attached'})
  assert(!(await picker.locator('option').evaluateAll(rows=>rows.map(r=>r.value))).includes('yuyao-manager'))
  assert.notEqual(await picker.inputValue(),'yuyao-manager')
  await admin.getByLabel('门店范围',{exact:true}).selectOption('')
  await admin.screenshot({path:'docs/screenshots/audit-headquarters-notifications.png',fullPage:false})
  checks.push('消息中心全部门店只汇总记录，不默认上海配置；选店后接收账号仅为本店，换店清除原选择')

  await tab(admin,'门店与时段')
  originalStore=(await json('/api/admin/stores',adminToken)).find(s=>s.id==='bai-le-men')
  assert(originalStore)
  await admin.getByRole('button',{name:'管理'+originalStore.name,exact:true}).click()
  const changedName=originalStore.name+'·核查'
  await admin.getByLabel('门店名称',{exact:true}).fill(changedName);storeDirty=true
  const [saved]=await Promise.all([admin.waitForResponse(r=>r.url().endsWith('/api/admin/stores/bai-le-men')&&r.request().method()==='PUT'),admin.getByRole('button',{name:'保存门店资料',exact:true}).click()])
  assert.equal(saved.status(),200,await saved.text())
  await admin.getByLabel('门店范围',{exact:true}).locator('option[value="bai-le-men"]').filter({hasText:changedName}).waitFor({state:'attached'})
  await admin.getByRole('button',{name:'返回全部门店',exact:true}).click()
  await admin.locator('.store-overview-card[data-store-id="bai-le-men"]').getByRole('heading',{name:changedName,exact:true}).waitFor()
  assert.equal((await json('/api/site')).stores.find(s=>s.id==='bai-le-men').name,changedName)
  await json('/api/admin/stores/bai-le-men',adminToken,'PUT',originalStore);storeDirty=false
  cleanup.push('门店资料实际修改验证后已还原原始完整资料')
  checks.push('门店名称保存后门店范围下拉、总部总览和客户接口立即一致，保持全部门店入口正常')

  await tab(manager,'用户管理')
  const managerRow=manager.locator('.ops-table tbody tr').filter({hasText:'yuyao'})
  await managerRow.waitFor();assert.equal(await managerRow.getByRole('button',{name:'配置用户',exact:true}).count(),0)
  await manager.locator('.ops-table tbody tr').filter({hasText:'frontdesk'}).getByRole('button',{name:'配置用户',exact:true}).waitFor()
  await tab(manager,'角色与权限')
  await manager.locator('.role-card').first().getByRole('button').click()
  assert.equal(await manager.getByRole('dialog').getByLabel('角色名称',{exact:true}).isDisabled(),true)
  assert.equal(await manager.getByRole('button',{name:'保存角色授权',exact:true}).count(),0)
  await manager.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()
  const forbidden=await fetch(base+'/api/admin/roles',{method:'PUT',headers:{Authorization:'Bearer '+managerToken,'Content-Type':'application/json'},body:JSON.stringify({id:'hq',permissions:[]})})
  assert.equal(forbidden.status,403)
  checks.push('店长只能配置前台账号，不显示修改自身的无效入口；角色明细只读，伪造角色修改请求返回403')

  const moduleRequests=[
    ['工作台','/api/admin/dashboard'],['预约管理','/api/admin/appointments'],['客户档案','/api/admin/customers'],
    ['调理师管理','/api/admin/therapists'],['品牌与内容','/api/admin/content'],['图片素材','/api/admin/assets'],
    ['用户管理','/api/admin/users'],['角色与权限','/api/admin/roles'],['消息中心','/api/admin/notifications'],
    ['初始资料导入',null],['操作日志','/api/admin/audit'],['扩展与配置','/api/admin/integrations']
  ]
  for(const [name,path] of moduleRequests){
    const response=path?admin.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='GET'):null
    await tab(admin,name)
    if(response)assert.equal((await response).status(),200,name)
    await rendered(admin)
    assert.equal(await admin.locator('[role="alert"]').count(),0,name+' shows an error')
  }
  checks.push('总部工作台、预约、客户、调理师、内容、素材、用户、角色、消息、导入、日志、PMS扩展页面逐项加载无接口错误')

  customer.once('dialog',dialog=>dialog.accept())
  const [cancelledResponse]=await Promise.all([customer.waitForResponse(r=>r.url().endsWith('/api/me/appointments/'+appointment.id)&&r.request().method()==='PATCH'),card.getByRole('button',{name:'取消申请',exact:true}).click()])
  assert.equal(cancelledResponse.status(),200,await cancelledResponse.text())
  await card.getByText('已取消',{exact:true}).waitFor()
  assert.equal((await ownRecord()).status,'CANCELLED')
  assert.equal((await json('/api/stores/yuyao/slots?date='+nextDay)).slots.find(s=>s.time===nextSlot.time).remaining,nextSlot.remaining)
  checks.push('客户实际取消改约后的申请，后台同步已取消，新时段名额完全释放')
  assert.deepEqual(errors,[],'Browser JavaScript errors')
  report={result:'PASS',base,checkedAt:new Date().toISOString(),checks,appointmentId:appointment.id,browserErrors:errors,cleanup,wechatDeviceVerification:'NOT_RUN: requires actual WeChat credentials and developer tools',pmsExternalVerification:'NOT_RUN: extension is reserved and disabled by default'}
}catch(e){
  await Promise.allSettled(pages.map((page,i)=>page.screenshot({path:`docs/screenshots/failure-audit-${i}.png`,fullPage:true})))
  console.error(e);console.error('Completed before failure:',JSON.stringify(checks));process.exitCode=1
}finally{
  try{if(storeDirty&&originalStore&&adminToken){await json('/api/admin/stores/'+originalStore.id,adminToken,'PUT',originalStore);cleanup.push('异常退出后已还原门店资料')}}catch(e){console.error('STORE RESTORE FAILED',e);process.exitCode=1}
  try{await cancelOwnRecord()}catch(e){console.error('APPOINTMENT CLEANUP FAILED',e);process.exitCode=1}
  if(report){await writeFile('docs/audit-result.json',JSON.stringify(report,null,2),'utf8');console.log(JSON.stringify(report,null,2))}
  await browser.close()
}
