import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'

const base=process.env.TEST_BASE_URL,apiBase=process.env.TEST_API_URL
assert(base&&apiBase,'Explicit TEST_BASE_URL and TEST_API_URL required; use an isolated local test database')
const runtime=await fetch(apiBase+'/api/runtime').then(r=>r.json())
assert.equal(runtime.developmentLogin,true,'This test writes fixtures and must only run in local mode')
const errors=[],checks=[],suffix=Date.now().toString().slice(-7),name='余姚专属养护联调'+suffix
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true})
await mkdir('docs/screenshots',{recursive:true})
const contexts=await Promise.all([390,1440,1440,1440].map(width=>browser.newContext({viewport:{width,height:width===390?844:1080},deviceScaleFactor:1})))
for(const ctx of contexts)ctx.on('page',p=>p.on('pageerror',e=>errors.push(e.message)))
const [customer,manager,other,hq]=await Promise.all(contexts.map(c=>c.newPage()))
const menu=(p,label)=>p.locator('.ops-sidebar').getByRole('button',{name:label,exact:false})
async function json(path,token,method='GET',body){const r=await fetch(apiBase+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert(r.ok,`${method} ${path}: ${r.status} ${JSON.stringify(data)}`);return data}
async function login(p,username){await p.goto(base+'/admin');await p.getByPlaceholder('请输入账号').fill(username);await p.getByPlaceholder('请输入密码').fill('Yht@9800dev');await p.getByRole('button',{name:'登录管理后台',exact:true}).click();await p.getByRole('heading',{name:'工作台',exact:true}).waitFor();return p.evaluate(()=>sessionStorage.getItem('yht-admin-token'))}
async function eventually(fn,message){const end=Date.now()+16000;while(Date.now()<end){if(await fn())return;await delay(250)}assert.fail(message)}
async function shot(p,n){await p.screenshot({path:`docs/screenshots/store-chat-${n}.png`,fullPage:true})}
async function sendCustomer(content){await customer.getByLabel('咨询内容',{exact:true}).fill(content);await customer.locator('.chat-compose').getByRole('button',{name:'发送',exact:true}).click();await customer.locator('.customer-message').getByText(content,{exact:true}).waitFor()}
let failure
try{
  const token=await login(manager,'yuyao')
  await menu(manager,'品牌与内容').click()
  assert.equal(await menu(manager,'本店养护项目').count(),0)
  await manager.getByRole('button',{name:'养护项目',exact:true}).click()
  await manager.getByRole('button',{name:'新增',exact:true}).click()
  let form=manager.locator('.catalog-editor').last()
  await form.getByLabel('名称',{exact:true}).fill(name)
  await form.getByLabel('简短说明',{exact:true}).fill('本店独立品项，其他门店不可见')
  await form.getByLabel('参考时长',{exact:true}).fill('55分钟')
  await form.getByLabel('详细介绍',{exact:true}).fill('门店独立项目的浏览器联调资料。')
  await form.locator('.step-list-editor').getByRole('button',{name:'多行粘贴',exact:true}).click()
  await form.getByLabel('养护步骤（一行一步）',{exact:true}).fill('到店沟通\n细致养护\n休息茶饮')
  await form.getByLabel('上架',{exact:true}).check()
  await manager.locator('.content-preview .service-card').filter({hasText:name}).waitFor()
  let saved=manager.waitForResponse(r=>r.url().endsWith('/api/admin/stores/yuyao/services')&&r.request().method()==='PUT')
  await manager.getByRole('button',{name:'保存到小程序',exact:true}).click()
  const created=await saved;assert.equal(created.status(),200);const service=(await created.json()).find(s=>s.name===name);assert(service)
  form=manager.locator('.catalog-editor').filter({hasText:name})
  await form.getByLabel('参考时长',{exact:true}).fill('65分钟')
  saved=manager.waitForResponse(r=>r.url().endsWith('/api/admin/stores/yuyao/services')&&r.request().method()==='PUT')
  await manager.getByRole('button',{name:'保存到小程序',exact:true}).click();assert.equal((await saved).status(),200)
  await manager.reload();await menu(manager,'品牌与内容').click()
  form=manager.locator('.catalog-editor').filter({hasText:name});await form.waitFor()
  assert.equal(await form.getByLabel('参考时长',{exact:true}).inputValue(),'65分钟')
  await manager.locator('.content-preview .service-card').filter({hasText:name}).waitFor()
  await shot(manager,'store-services')
  checks.push('原品牌与内容内联表单新增、编辑、实时预览本店项目，保存后刷新仍保留；无独立项目菜单')

  const otherToken=await login(other,'bailemen')
  await menu(other,'品牌与内容').click();await other.getByRole('button',{name:'新增',exact:true}).waitFor()
  assert.equal(await other.locator('.catalog-editor').filter({hasText:name}).count(),0)
  for(const method of ['GET','PUT']){const denied=await fetch(apiBase+'/api/admin/stores/yuyao/services'+(method==='PUT'?'/'+service.id:''),{method,headers:{Authorization:`Bearer ${otherToken}`,...(method==='PUT'?{'Content-Type':'application/json'}:{})},body:method==='PUT'?JSON.stringify(service):undefined});assert.equal(denied.status,404)}
  checks.push('百乐门账号独立项目列表，不显示余姚专属项目；跨店读写接口均404')

  await login(hq,'admin');await menu(hq,'品牌与内容').click()
  await hq.getByRole('button',{name:'保存草稿',exact:true}).waitFor()
  await hq.getByRole('button',{name:'发布到小程序',exact:true}).waitFor()
  await hq.getByLabel('门店范围',{exact:true}).selectOption('yuyao');await hq.locator('.catalog-editor').filter({hasText:name}).waitFor()
  await hq.getByLabel('门店范围',{exact:true}).selectOption('bai-le-men')
  await hq.getByRole('button',{name:'新增',exact:true}).waitFor()
  await eventually(async()=>!(await hq.locator('.catalog-editor').filter({hasText:name}).count()),'HQ branch switch leaked a service')
  checks.push('总部可按店维护品项，切换门店后项目正确隔离')

  await menu(manager,'调理师管理').click();await manager.locator('.therapist-card').first().getByRole('button',{name:'编辑资料'}).click()
  await manager.getByRole('dialog').getByText(name,{exact:true}).waitFor()
  await manager.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()
  checks.push('调理师编辑页可选择新增本店品项')

  await menu(manager,'预约管理').click();await manager.getByRole('button',{name:'前台代约',exact:true}).click()
  let dialog=manager.getByRole('dialog');await dialog.getByLabel('养护项目',{exact:false}).selectOption(service.id)
  await eventually(async()=>(await dialog.getByLabel('到店开始时间',{exact:false}).locator('option').count())>1,'Manual booking slots missing')
  await dialog.getByLabel('到店开始时间',{exact:false}).selectOption({index:1})
  await dialog.getByLabel('客户称呼',{exact:true}).fill('门店品项联调'+suffix)
  await dialog.getByLabel('联系电话',{exact:true}).fill('139'+suffix.padStart(8,'0'))
  const bookingSaved=manager.waitForResponse(r=>r.url().endsWith('/api/admin/appointments')&&r.request().method()==='POST')
  await dialog.getByRole('button',{name:'保存代约并确认',exact:true}).click();const bookingResponse=await bookingSaved
  assert.equal(bookingResponse.status(),200);const booking=await bookingResponse.json();assert.equal(booking.serviceName,name);assert.equal(booking.status,'CONFIRMED')
  checks.push('前台页面用本店新增项目真实代约，记录项目快照并确认')

  await customer.goto(base+'/');await customer.locator('.mini-tabs').getByRole('button',{name:'门店',exact:true}).click()
  await customer.locator('.store-card').filter({hasText:'余姚路'}).click()
  await customer.locator('.service-card').filter({hasText:name}).waitFor();await shot(customer,'client-store')
  await customer.locator('.service-card').filter({hasText:name}).click()
  await customer.getByRole('button',{name:'选择养护项目',exact:false}).click()
  const choice=customer.locator('.choice-service').filter({hasText:name});await choice.waitFor();assert.match(await choice.getAttribute('class'),/selected/)
  await choice.getByText('65分钟',{exact:true}).waitFor()
  checks.push('客户门店详情展示专属项目，进入预约后保留本店项目与修改后的时长')
  await customer.reload();await customer.locator('.mini-tabs').getByRole('button',{name:'门店',exact:true}).click();await customer.locator('.store-card').filter({hasText:'余姚路'}).click()
  await customer.locator('.service-bottom').getByRole('button',{name:'咨询',exact:true}).click()
  await eventually(async()=>(await customer.getByLabel('咨询门店',{exact:true}).inputValue())==='yuyao','Contact entry not routed to store')
  const question='余姚咨询联调'+suffix,answer='您好，余姚本店专属养护约65分钟，欢迎咨询 '+suffix
  await sendCustomer(question)
  // Manager remains on appointments: sidebar must notify outside the chat page.
  await manager.getByLabel('1条未读客户消息',{exact:true}).waitFor({timeout:16000})
  checks.push('客户从门店入口发送咨询；后台其他菜单显示未读消息徽标')
  await menu(manager,'客户沟通').click();await manager.locator('.chat-list-item').filter({hasText:question}).click()
  await manager.locator('.chat-bubble.incoming').getByText(question,{exact:true}).waitFor()
  await manager.getByRole('button',{name:'接入会话',exact:true}).click()
  await manager.getByLabel('回复消息',{exact:true}).fill(answer)
  await manager.locator('.chat-reply').getByRole('button',{name:'发送',exact:true}).click()
  await customer.locator('.customer-message').getByText(answer,{exact:true}).waitFor({timeout:12000})
  await shot(manager,'admin-conversation');await shot(customer,'client-conversation')
  checks.push('后台真实收到客户咨询并回复，客户在轮询周期内收到同一条回复')
  await manager.getByRole('button',{name:'结束对话',exact:true}).click()
  await manager.getByRole('button',{name:'确认结束',exact:true}).click()
  await eventually(async()=>(await json('/api/admin/chats?status=RESOLVED',token)).items.some(c=>c.lastPreview===answer),'Conversation status not saved')
  await customer.getByRole('button',{name:'发起新咨询',exact:true}).click()
  const again='新会话咨询'+suffix;await sendCustomer(again)
  await manager.locator('.chat-list-item').filter({hasText:again}).waitFor({timeout:12000})
  checks.push('已结束会话只读；客户明确发起新咨询后进入待接入队列')

  await customer.getByLabel('咨询门店',{exact:true}).selectOption('bai-le-men')
  await eventually(async()=>await customer.locator('.customer-chat').getByText('您好，请问有什么可以帮您？',{exact:true}).count()===1,'New branch conversation not opened')
  assert.equal(await customer.locator('.customer-message').getByText(question,{exact:true}).count(),0)
  const otherQuestion='百乐门咨询联调'+suffix;await sendCustomer(otherQuestion)
  await menu(other,'客户沟通').click();await other.locator('.chat-list-item').filter({hasText:otherQuestion}).click()
  await other.getByLabel('回复消息',{exact:true}).fill('百乐门客服已收到 '+suffix);await other.locator('.chat-reply').getByRole('button',{name:'发送',exact:true}).click()
  await customer.locator('.customer-message').getByText('百乐门客服已收到 '+suffix,{exact:true}).waitFor({timeout:12000})
  const mine=await json('/api/admin/chats?status=',token)
  assert(mine.items.every(c=>c.storeId==='yuyao'));assert(!mine.items.some(c=>c.lastPreview.includes('百乐门')))
  const customerToken=await customer.evaluate(()=>sessionStorage.getItem('yht-customer-token'))
  const branchConversation=await json('/api/me/chats',customerToken,'POST',{storeId:'bai-le-men'})
  const denied=await fetch(apiBase+`/api/admin/chats/${branchConversation.id}/messages`,{headers:{Authorization:`Bearer ${token}`}});assert.equal(denied.status,404)
  checks.push('客户切换门店不串历史；百乐门独立接待，余姚账号不能读取其会话')

  await menu(hq,'客户沟通').click();await hq.getByLabel('客服门店范围',{exact:true}).selectOption('')
  await hq.locator('.chat-list-item').filter({hasText:again}).waitFor();await hq.locator('.chat-list-item').filter({hasText:'百乐门客服已收到 '+suffix}).waitFor()
  await hq.getByLabel('客服门店范围',{exact:true}).selectOption('yuyao')
  await eventually(async()=>(await hq.locator('.chat-list-item').count())===1,'HQ chat filter did not apply')
  checks.push('总部可汇总及按店筛选会话')
  assert.deepEqual(errors,[],'Browser page errors')
}catch(e){failure=e;await Promise.allSettled([shot(manager,'failure-admin'),shot(customer,'failure-customer')])}
finally{
  await writeFile('docs/store-chat-result.json',JSON.stringify({result:failure?'FAIL':'PASS',checkedAt:new Date().toISOString(),base,apiBase,checks,pageErrors:errors,...(failure?{error:String(failure),stack:failure.stack}:{})},null,2)+'\n')
  await browser.close()
}
console.log(JSON.stringify({result:failure?'FAIL':'PASS',checks,pageErrors:errors},null,2))
if(failure)throw failure
