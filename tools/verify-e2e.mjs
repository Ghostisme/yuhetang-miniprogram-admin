import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5180'
const apiBase=process.env.TEST_API_URL||'http://127.0.0.1:8790'
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true})
const errors=[],checks=[]
await mkdir('docs/screenshots',{recursive:true})
const customerContext=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1})
const adminContext=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1})
const storeContext=await browser.newContext({viewport:{width:1440,height:1080},deviceScaleFactor:1})
for(const ctx of [customerContext,adminContext,storeContext])ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
const customer=await customerContext.newPage(),admin=await adminContext.newPage(),storeAdmin=await storeContext.newPage()
async function json(path,token,method='GET',body){const r=await fetch(apiBase+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert(r.ok,`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);return data}
async function login(page,username){await page.goto(base+'/admin');await page.getByPlaceholder('请输入账号').fill(username);await page.getByPlaceholder('请输入密码').fill('Yht@9800dev');await page.getByRole('button',{name:'登录管理后台',exact:true}).click();await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();return page.evaluate(()=>sessionStorage.getItem('yht-admin-token'))}
async function screen(page,name,fullPage=true){await page.screenshot({path:`docs/screenshots/${name}.png`,fullPage})}
let appointment,adminToken,originalContent,originalPublished,contentTouched=false
try{
  const site=await json('/api/site'),store=site.stores.find(s=>s.id==='yuyao'),service=site.services.find(s=>s.id==='moxa')
  const day=new Date(Date.now()+8*3600000+86400000).toISOString().slice(0,10)
  const slots=await json(`/api/stores/yuyao/slots?date=${day}`)
  const slot=slots.slots.find(s=>s.available&&s.remaining>=2)
  assert(slot,'Need two available places tomorrow for this test')
  await customer.goto(base+'/');await customer.getByRole('button',{name:'我的预约申请',exact:false}).first().waitFor()
  await screen(customer,'client-home-mobile',false)
  await customer.locator('.hero-copy button').click()
  await customer.locator('.choice-store').filter({hasText:store.name}).click()
  await customer.getByRole('button',{name:'选择养护项目',exact:false}).click()
  await customer.locator('.choice-service').filter({hasText:service.name}).click()
  await customer.getByRole('button',{name:'选择日期与时间',exact:false}).click()
  await customer.getByLabel('同行人数').selectOption('2')
  await customer.locator('.slot-grid button').filter({hasText:slot.time}).click()
  await customer.getByRole('button',{name:'填写联系信息',exact:false}).click()
  const name='联调客户'+Date.now().toString().slice(-5),phone='139'+String(Date.now()).slice(-8)
  await customer.getByPlaceholder('怎么称呼您').fill(name)
  await customer.getByPlaceholder('请输入11位手机号码').fill(phone)
  await customer.getByLabel('意向调理师',{exact:false}).selectOption('yuyao-t1')
  await customer.getByLabel('是否已有会员').selectOption('YES')
  await customer.getByLabel('是否来过门店').selectOption('NO')
  await customer.locator('.consent-row input').last().check()
  await screen(customer,'client-booking-form',true)
  const submitted=customer.waitForResponse(r=>r.url().endsWith('/api/appointments')&&r.request().method()==='POST')
  await customer.getByRole('button',{name:'提交预约申请',exact:false}).click()
  const response=await submitted;appointment=await response.json()
  assert.equal(response.status(),200,JSON.stringify(appointment))
  assert.equal(appointment.status,'PENDING');assert.equal(appointment.memberClaim,'YES');assert.equal(appointment.headcount,2)
  await customer.getByText('温馨提示：当前尚未预约成功',{exact:true}).waitFor()
  await screen(customer,'client-pending-receipt',false)
  checks.push('客户页面真实提交：项目、时段、两人、意向调理师、会员自述，状态为PENDING')
  const updatedSlots=await json(`/api/stores/yuyao/slots?date=${day}`)
  assert.equal(updatedSlots.slots.find(s=>s.time===slot.time).used,slot.used+2)
  checks.push('客户提交后真实占用两个人数名额')

  adminToken=await login(admin,'admin')
  const managerToken=await login(storeAdmin,'yuyao')
  await storeAdmin.locator('.ops-sidebar').getByRole('button',{name:'预约管理',exact:false}).click()
  await storeAdmin.getByLabel('搜索预约').fill(appointment.id)
  const row=storeAdmin.locator('.ops-table tbody tr').filter({hasText:name});await row.waitFor()
  await row.getByRole('button',{name:'查看处理',exact:false}).click()
  await storeAdmin.getByRole('dialog').getByText('待门店确认',{exact:true}).first().waitFor()
  await screen(storeAdmin,'admin-reservation-review',false)
  await storeAdmin.getByLabel('实际调理师',{exact:true}).selectOption('yuyao-t1')
  const assigned=storeAdmin.waitForResponse(r=>r.url().endsWith('/'+appointment.id)&&r.request().method()==='PATCH')
  await storeAdmin.getByRole('button',{name:'保存人员分配',exact:true}).click();assert.equal((await assigned).status(),200)
  const confirmed=storeAdmin.waitForResponse(r=>r.url().endsWith('/'+appointment.id)&&r.request().method()==='PATCH')
  await storeAdmin.getByRole('button',{name:'确认接待',exact:true}).click();assert.equal((await confirmed).status(),200)
  await storeAdmin.getByRole('dialog').getByText('门店已确认',{exact:true}).first().waitFor()
  checks.push('本店管理员页面查到真实申请，分配调理师并人工确认接待')
  await customer.getByRole('button',{name:'查看我的预约申请',exact:false}).click()
  await customer.getByText('门店已确认接待，请按约定时间到店。',{exact:true}).waitFor()
  const card=customer.locator('.order-card').filter({hasText:appointment.id})
  await card.getByText('林老师（示例）',{exact:false}).first().waitFor()
  await screen(customer,'client-confirmed-order',false)
  checks.push('客户预约记录真实回显门店确认结果和实际分配的调理师')

  // Another branch can log in, but cannot query this branch or read the appointment by ID.
  const other=(await json('/api/admin/login',null,'POST',{username:'bailemen',password:'Yht@9800dev'})).token
  for(const path of [`/api/admin/appointments/${appointment.id}`,'/api/admin/appointments?storeId=yuyao']){
    const denied=await fetch(apiBase+path,{headers:{Authorization:`Bearer ${other}`}});assert.equal(denied.status,404)
  }
  assert.equal((await fetch(apiBase+'/api/admin/roles',{method:'PUT',headers:{Authorization:`Bearer ${managerToken}`,'Content-Type':'application/json'},body:JSON.stringify({id:'hq',permissionCodes:[]})})).status,403)
  checks.push('另一门店对本单和本店查询均返回404；店长修改总部角色返回403')

  await admin.locator('.ops-sidebar').getByRole('button',{name:'品牌与内容',exact:true}).click()
  originalContent=await json('/api/admin/content',adminToken)
  originalPublished=await json('/api/site')
  const changedTitle='用心关照每一次到来 · '+Date.now().toString().slice(-6)
  await admin.getByLabel('品牌短句',{exact:true}).fill(changedTitle)
  await admin.getByRole('button',{name:'保存草稿',exact:true}).click()
  await admin.getByText('草稿已保存，客户页面仍使用已发布内容。',{exact:false}).waitFor()
  contentTouched=true
  assert.notEqual((await json('/api/site')).tagline,changedTitle)
  admin.once('dialog',d=>d.accept())
  await admin.getByRole('button',{name:'发布到小程序',exact:true}).click()
  await admin.getByText('内容已发布，客户页面将读取新版本。',{exact:false}).waitFor()
  assert.equal((await json('/api/site')).tagline,changedTitle)
  await screen(admin,'admin-content-configuration',false)
  checks.push('后台内容保存草稿不影响客户；发布后客户接口立即读取新内容')

  for(const title of ['客户档案','调理师管理','门店与时段','图片素材','用户管理','角色与权限','消息中心','初始资料导入','操作日志','扩展与配置']){
    await admin.locator('.ops-sidebar').getByRole('button',{name:title,exact:true}).click()
    await admin.getByRole('heading',{name:title,exact:true,level:1}).waitFor()
    // Wait for the module-specific request rather than just the synchronous menu title.
    await admin.waitForTimeout(350)
    assert.equal(await admin.locator('[role="alert"]').count(),0,`${title} shows an API error`)
    if(title==='角色与权限')await screen(admin,'admin-rbac-roles',false)
    if(title==='用户管理')await screen(admin,'admin-rbac-users',false)
  }
  await admin.locator('.ops-sidebar').getByRole('button',{name:'工作台',exact:true}).click()
  await admin.getByText(name,{exact:true}).first().waitFor()
  await screen(admin,'admin-dashboard',false)
  checks.push('总部各管理模块加载成功，角色/用户分开管理，工作台统计来自真实预约')
  assert.deepEqual(errors,[],'Browser JavaScript errors')
  const report={result:'PASS',base,apiBase,appointmentId:appointment.id,date:day,time:slot.time,checks,browserErrors:errors,retainedDemoRecord:'这笔本地测试预约保留为已确认，便于继续演示；未操作其他项目或数据库。',wechatDeviceCompilation:'未执行，需客户AppID及开发者工具。'}
  await writeFile('docs/e2e-result.json',JSON.stringify(report,null,2),'utf8')
  console.log(JSON.stringify(report,null,2))
}catch(e){
  await Promise.allSettled([screen(customer,'failure-customer',true),screen(admin,'failure-admin',true),screen(storeAdmin,'failure-store',true)])
  console.error(e);process.exitCode=1
}finally{
  if(contentTouched&&originalContent&&adminToken){try{const latest=await json('/api/admin/content',adminToken);const restored=await json('/api/admin/content/publish',adminToken,'PUT',{...originalPublished,version:latest.version});await json('/api/admin/content/draft',adminToken,'PUT',{...originalContent,version:restored.version})}catch(e){console.error('Content restore failed:',e.message);process.exitCode=1}}
  await browser.close()
}
