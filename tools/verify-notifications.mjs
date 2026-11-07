import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'

const base=process.env.TEST_BASE_URL
assert(base&&process.env.TEST_ALLOW_NOTIFICATION_MUTATION==='1','Set TEST_BASE_URL and TEST_ALLOW_NOTIFICATION_MUTATION=1 for the isolated notification fixture')
const url=new URL(base)
assert(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='18891','Notification mutations are restricted to the isolated local server on port 18891')
assert.equal((await fetch(base+'/api/runtime').then(r=>r.json())).developmentLogin,true)
const checks=[],errors=[],responses=[]
await mkdir('docs/screenshots',{recursive:true})
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true})
const contexts=await Promise.all(Array.from({length:3},()=>browser.newContext({viewport:{width:1680,height:1080}})))
const [hq,branch,reader]=await Promise.all(contexts.map(c=>c.newPage()))
for(const page of [hq,branch,reader]){
  page.on('pageerror',e=>errors.push(e.message))
  page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400&&r.status()!==401)responses.push({url:r.url(),status:r.status()})})
}
async function request(path,token,method='GET',input,extra={}){
  const r=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(input?{'Content-Type':'application/json'}:{}),...extra},body:input?JSON.stringify(input):undefined})
  const data=await r.json();assert.equal(r.status,200,`${method} ${path}: ${JSON.stringify(data)}`);return data
}
async function login(page,username){
  await page.goto(base+'/admin')
  await page.getByPlaceholder('请输入账号').fill(username);await page.getByPlaceholder('请输入密码').fill('Yht@9800dev')
  await page.getByRole('button',{name:'登录管理后台',exact:true}).click();await page.locator('.operations').waitFor()
  await page.locator('.ops-sidebar').getByRole('button',{name:'消息中心',exact:true}).click()
  return page.evaluate(()=>sessionStorage.getItem('yht-admin-token'))
}
async function channelsVisible(page){for(const name of ['PC端消息通知','微信个人消息通知','短信通知'])await page.getByRole('heading',{name,exact:true}).waitFor()}
async function save(page){
  const response=page.waitForResponse(r=>r.url().includes('/api/admin/notifications/config')&&r.request().method()==='PUT')
  await page.getByRole('button',{name:'保存本店通知设置',exact:true}).click();assert.equal((await response).status(),200)
  await page.getByRole('button',{name:'保存本店通知设置',exact:true}).waitFor()
}
let failure
try{
  const setup=await request('/api/admin/login',null,'POST',{username:'admin',password:'Yht@9800dev'})
  const defaults=(await request('/api/admin/notifications/config?storeId=yuyao',setup.token)).channels
  await request('/api/admin/notifications/config',setup.token,'PUT',{...defaults,smsStaffEnabled:false,smsCustomerEnabled:false,smsPhone:''})
  const hqToken=await login(hq,'admin');await channelsVisible(hq)
  assert.equal(await hq.getByLabel('门店短信接收手机号',{exact:true}).isDisabled(),true)
  await hq.getByLabel('门店范围',{exact:true}).selectOption('yuyao')
  await hq.getByRole('button',{name:'保存本店通知设置',exact:true}).waitFor()
  await hq.getByLabel('门店接收人短信提醒',{exact:true}).check()
  await hq.getByLabel('预约客户短信提醒',{exact:true}).check()
  await hq.getByLabel('门店短信接收手机号',{exact:true}).fill('13900002001');await save(hq)
  assert.equal((await request('/api/admin/notifications/config?storeId=yuyao',hqToken)).channels.smsStaffEnabled,true)
  checks.push('总部选择门店后可分别配置 PC、微信个人消息、短信；未选择门店时禁止修改')

  const branchToken=await login(branch,'yuyao');await channelsVisible(branch)
  assert.equal(await branch.getByLabel('门店范围',{exact:true}).inputValue(),'yuyao')
  await branch.getByLabel('门店接收人短信提醒',{exact:true}).uncheck();await save(branch)
  await branch.getByLabel('门店接收人短信提醒',{exact:true}).check();await save(branch)
  checks.push('门店可保存本店三类通知开关与短信接收人')

  const frontdeskToken=await login(reader,'frontdesk');await channelsVisible(reader)
  await reader.getByLabel('门店短信接收手机号',{exact:true}).waitFor()
  assert.equal(await reader.getByLabel('门店短信接收手机号',{exact:true}).inputValue(),'139****2001')
  assert.equal(await reader.getByLabel('门店短信接收手机号',{exact:true}).isDisabled(),true)
  assert.equal(await reader.getByRole('button',{name:'保存本店通知设置',exact:true}).count(),0)
  assert.equal((await request('/api/admin/notifications/config?storeId=yuyao',frontdeskToken)).channels.smsPhone,'')
  checks.push('仅查看通知的岗位显示三类渠道状态、隐藏配置按钮并脱敏接收手机号')

  const session=await request('/api/auth/dev-customer',null,'POST',{deviceId:'notification-browser-fixture'})
  const day=new Date();day.setDate(day.getDate()+1)
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(day)
  const booking=await request('/api/appointments',session.token,'POST',{storeId:'yuyao',serviceId:'moxa',date,startTime:'10:00',headcount:1,name:'通知界面验证',phone:'13900002002',memberClaim:'NO',visitedClaim:'NO',privacyConsent:true},{'Idempotency-Key':crypto.randomUUID()})
  await request('/api/admin/appointments/'+booking.id,branchToken,'PATCH',{action:'confirm',version:booking.version})
  await hq.getByRole('button',{name:'刷新记录',exact:true}).click()
  for(const [channel,label] of [['PC','PC端消息'],['WECHAT','微信个人消息'],['SMS','短信']]){
    const loaded=hq.waitForResponse(r=>r.url().includes('/api/admin/notifications?')&&new URL(r.url()).searchParams.get('channel')===channel)
    await hq.getByRole('group',{name:'通知渠道筛选'}).getByRole('button',{name:label,exact:true}).click()
    assert.equal((await loaded).status(),200)
    await hq.locator('.notification-records tbody tr').first().waitFor()
    const items=await request('/api/admin/notifications?storeId=yuyao&channel='+channel,hqToken)
    assert(items.items.length>0);assert(items.items.every(r=>r.channelGroup===channel))
  }
  checks.push('预约创建及确认生成三类渠道记录；界面筛选与 API 的记录一致')
  await hq.getByRole('group',{name:'通知渠道筛选'}).getByRole('button',{name:'全部通知',exact:true}).click()
  await hq.screenshot({path:'docs/screenshots/notifications-headquarters.png',fullPage:true})
  await reader.screenshot({path:'docs/screenshots/notifications-readonly.png',fullPage:true})
  assert.equal(await hq.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
  await hq.setViewportSize({width:1024,height:900});assert.equal(await hq.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
  await hq.screenshot({path:'docs/screenshots/notifications-1024.png',fullPage:true})
  assert.deepEqual(errors,[]);assert.deepEqual(responses,[])
  checks.push('页面无 JavaScript 或接口错误；1680 和 1024 宽度无横向溢出')
}catch(e){failure=e;await hq.screenshot({path:'docs/screenshots/notifications-failure.png',fullPage:true}).catch(()=>{})}
finally{await browser.close();await writeFile('docs/notification-browser-result.json',JSON.stringify({at:new Date().toISOString(),base,checks,errors,responses,failure:failure?.message},null,2))}
if(failure)throw failure
console.log(JSON.stringify({checks,errors,responses},null,2))
