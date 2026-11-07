import {chromium,expect} from 'playwright/test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'

const base=process.env.TEST_BASE_URL
assert(base&&process.env.TEST_ALLOW_DIANPING_MUTATION==='1','Set TEST_BASE_URL and TEST_ALLOW_DIANPING_MUTATION=1 for an isolated Dianping fixture')
const target=new URL(base)
assert(['127.0.0.1','localhost'].includes(target.hostname)&&target.port==='18891','Dianping test writes require the isolated local server on port 18891')
assert.equal((await fetch(base+'/api/runtime').then(r=>r.json())).developmentLogin,true)
const checks=[],errors=[],responses=[],suffix=Date.now().toString().slice(-8)
const fixture=await mkdtemp(join(tmpdir(),'yht-dianping-'))
await mkdir('docs/screenshots',{recursive:true})
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true})
const contexts=await Promise.all(Array.from({length:3},()=>browser.newContext({viewport:{width:1680,height:1080}})))
const [hq,branch,other]=await Promise.all(contexts.map(c=>c.newPage()))
for(const page of [hq,branch,other]){
  page.on('pageerror',e=>errors.push(e.message))
  page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400&&r.status()!==401)responses.push({url:r.url(),status:r.status()})})
}
const menu=(page,name)=>page.locator('.ops-sidebar').getByRole('button',{name,exact:false})
async function request(path,token,method='GET',input,status=200){
  const response=await fetch(base+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined})
  const data=await response.json();assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(data)}`);return data
}
async function login(page,username){
  await page.goto(base+'/admin')
  await page.getByPlaceholder('请输入账号').fill(username);await page.getByPlaceholder('请输入密码').fill('Yht@9800dev')
  await page.getByRole('button',{name:'登录管理后台',exact:true}).click();await page.locator('.operations').waitFor()
  return page.evaluate(()=>sessionStorage.getItem('yht-admin-token'))
}
async function saveMapping(button,endpoint){
  const loaded=hq.waitForResponse(r=>r.url().endsWith('/api/admin/dianping/'+endpoint)&&r.request().method()==='PUT')
  await hq.getByRole('button',{name:button,exact:true}).click();assert.equal((await loaded).status(),200)
}
async function template(kind){
  await hq.getByLabel('导入资料类型',{exact:true}).selectOption('dianping-'+kind)
  const download=hq.waitForEvent('download');await hq.getByRole('button',{name:'下载模板',exact:true}).click()
  const file=join(fixture,kind+'-template.xlsx');await (await download).saveAs(file);return file
}
function workbook(template,rows,name){
  const file=join(fixture,name+'.xlsx')
  execFileSync('python',['-c','import json,sys,openpyxl; w=openpyxl.load_workbook(sys.argv[1]); s=w.active; headers=[c.value for c in s[1]]; rows=json.loads(sys.argv[3]); [s.append([r.get(k,"") for k in headers]) for r in rows]; w.save(sys.argv[2])',template,file,JSON.stringify(rows)],{encoding:'utf8'})
  return file
}
async function importUI(kind,file,expected){
  await hq.getByLabel('导入资料类型',{exact:true}).selectOption('dianping-'+kind)
  await hq.getByLabel('导入文件',{exact:true}).setInputFiles(file)
  const preview=hq.waitForResponse(r=>r.url().includes('/api/admin/dianping/imports/'+kind+'?commit=false'))
  await hq.getByRole('button',{name:'预检文件',exact:true}).click()
  const result=await (await preview).json();assert.equal(result.valid,true);assert.equal(result.total,expected.total)
  await hq.getByRole('heading',{name:'资料预检通过',exact:true}).waitFor()
  assert(!await hq.locator('.import-result').innerText().then(text=>text.includes('13900003101')))
  await hq.screenshot({path:`docs/screenshots/dianping-${kind}-preview.png`,fullPage:true})
  const config=await request('/api/admin/dianping/config',hqToken)
  if(expected.beforeOrders!==undefined)assert.equal(config.orderCount,expected.beforeOrders)
  hq.once('dialog',dialog=>dialog.accept())
  const commit=hq.waitForResponse(r=>r.url().includes('/api/admin/dianping/imports/'+kind+'?commit=true'))
  await hq.getByRole('button',{name:'确认执行导入',exact:true}).click()
  const committed=await (await commit).json();assert.equal(committed.valid,true)
  for(const key of ['created','updated','skipped'])if(expected[key]!==undefined)assert.equal(committed[key],expected[key],key)
  await hq.getByRole('heading',{name:'资料导入完成',exact:true}).waitFor()
  assert.equal(await hq.getByRole('button',{name:'确认执行导入',exact:true}).count(),0)
  return committed
}
async function orders(page){
  await menu(page,'预约管理').click();await page.getByRole('button',{name:'大众点评订单',exact:true}).click()
  await page.getByRole('heading',{name:'大众点评订单',exact:true}).waitFor()
}
let failure,hqToken
try{
  hqToken=await login(hq,'admin')
  const before=(await request('/api/admin/appointments?pageSize=100',hqToken)).total
  const grants=await request('/api/admin/roles',hqToken)
  const shop='browser-yuyao-'+suffix,second='browser-bailemen-'+suffix,product='moxa-'+suffix
  await menu(hq,'扩展与配置').click();await hq.getByRole('heading',{name:'大众点评数据接入',exact:true}).waitFor()
  for(const [external,name,store] of [[shop,'点评余姚验证店','yuyao'],[second,'点评百乐门验证店','bai-le-men']]){
    await hq.getByLabel('点评门店编号',{exact:true}).fill(external);await hq.getByLabel('点评门店名称',{exact:true}).fill(name)
    await hq.getByLabel('对应本地门店',{exact:true}).selectOption(store);await saveMapping('保存门店映射','shops')
    await expect(hq.getByLabel('点评门店编号',{exact:true})).toHaveValue('')
    await hq.getByLabel('品项所属点评门店',{exact:true}).selectOption(external)
    await hq.getByLabel('点评品项编号',{exact:true}).fill(product);await hq.getByLabel('点评品项名称',{exact:true}).fill('艾灸养护验证')
    await hq.getByLabel('对应本店养护项目',{exact:true}).selectOption('moxa');await saveMapping('保存品项映射','products')
    await expect(hq.getByLabel('点评品项编号',{exact:true})).toHaveValue('')
  }
  await hq.screenshot({path:'docs/screenshots/dianping-mappings.png',fullPage:true})
  checks.push('总部在现有扩展与配置维护两家点评门店及各店品项映射，保存后可继续新建')
  await menu(hq,'资料导入').click()
  const customerTemplate=await template('customers'),orderTemplate=await template('orders')
  const customerRows=[{externalShopId:shop,externalCustomerId:'customer-'+suffix,name:'点评客户验证'+suffix,phone:'13900003101'}]
  const customerFile=workbook(customerTemplate,customerRows,'customers')
  await importUI('customers',customerFile,{total:1,created:1,skipped:0})
  const branchToken=await login(branch,'yuyao'),otherToken=await login(other,'bailemen')
  await menu(branch,'客户档案').click();await branch.getByText(customerRows[0].name,{exact:true}).waitFor()
  assert((await request('/api/admin/customers?storeId=yuyao',branchToken)).items.some(c=>c.name===customerRows[0].name))
  assert(!(await request('/api/admin/customers?storeId=bai-le-men',otherToken)).items.some(c=>c.name===customerRows[0].name))
  checks.push('下载真实 XLSX 模板，预检和确认导入客户；客户在现有客户档案显示且只属于对应门店')
  const orderRows=[shop,second].map((externalShopId,i)=>({externalShopId,externalOrderId:`DP-${suffix}-${i}`,externalLineId:'1',externalProductId:product,name:'点评订单验证'+i,phone:i?'13900003102':'139****3101',status:'已付款',amountYuan:'88.50',headcount:1,bookingDate:'',startTime:'',createdAt:'2026-01-01 10:00:00',updatedAt:'2026-01-01 10:00:00'}))
  const orderFile=workbook(orderTemplate,orderRows,'orders')
  await importUI('orders',orderFile,{total:2,created:2,skipped:0,beforeOrders:0})
  assert.equal((await request('/api/admin/appointments?pageSize=100',hqToken)).total,before)
  await orders(hq);await hq.getByText(orderRows[0].externalOrderId,{exact:true}).waitFor();await hq.getByText(orderRows[1].externalOrderId,{exact:true}).waitFor()
  await hq.screenshot({path:'docs/screenshots/dianping-hq-orders.png',fullPage:true})
  const all=(await request('/api/admin/dianping/orders',hqToken)).items
  const local=all.find(r=>r.externalShopId===shop),foreign=all.find(r=>r.externalShopId===second)
  assert.equal(local.amountFen,8850);assert.equal(local.phone,'139****3101')
  assert.equal((await request('/api/admin/dianping/orders',branchToken)).total,1)
  await request('/api/admin/dianping/config',branchToken,'GET',undefined,403)
  await request('/api/admin/dianping/orders?storeId=bai-le-men',branchToken,'GET',undefined,404)
  await request(`/api/admin/dianping/orders/${foreign.id}/slots?date=2026-01-01`,branchToken,'GET',undefined,404)
  checks.push('点评订单先独立归档、金额精确到分、电话脱敏；导入不创建预约，门店查询和操作均隔离')
  await orders(branch);await branch.getByText(orderRows[0].externalOrderId,{exact:true}).waitFor()
  assert.equal(await branch.getByText(orderRows[1].externalOrderId,{exact:true}).count(),0)
  await branch.getByRole('button',{name:'确认到店预约',exact:true}).click()
  const dialog=branch.getByRole('dialog',{name:'确认点评到店预约'})
  await dialog.getByLabel('核实联系电话',{exact:true}).fill('13900003101')
  await expect(dialog.getByLabel('点评到店时段',{exact:true})).toBeEnabled()
  const option=await dialog.getByLabel('点评到店时段',{exact:true}).locator('option').evaluateAll(items=>items.find(item=>item.value)?.value)
  assert(option,'Fixture must have an available slot');await dialog.getByLabel('点评到店时段',{exact:true}).selectOption(option)
  await branch.screenshot({path:'docs/screenshots/dianping-confirm-appointment.png',fullPage:true})
  const converted=branch.waitForResponse(r=>r.url().endsWith(`/api/admin/dianping/orders/${local.id}/appointment`)&&r.request().method()==='POST')
  await dialog.getByRole('button',{name:'确认并生成预约',exact:true}).click()
  const booking=await (await converted).json();assert.equal(booking.source,'DIANPING');assert.equal(booking.status,'CONFIRMED');assert.equal(booking.storeId,'yuyao')
  await dialog.waitFor({state:'hidden'});await branch.getByRole('heading',{name:'预约详情与处理',exact:true}).waitFor()
  assert.equal((await request('/api/admin/appointments?pageSize=100',hqToken)).total,before+1)
  checks.push('门店页面核实脱敏电话、选择本店可用时段后生成已确认的点评来源预约，并打开原预约详情')
  await menu(hq,'资料导入').click();await importUI('orders',orderFile,{total:2,created:0,updated:0,skipped:2,beforeOrders:2})
  assert.equal((await request('/api/admin/appointments?pageSize=100',hqToken)).total,before+1)
  checks.push('重复导入跳过相同明细，已有预约和时段名额不重复增加')
  const updateFile=workbook(orderTemplate,[{...orderRows[0],status:'已退款',updatedAt:'2026-01-02 10:00:00'}],'orders-refund')
  await importUI('orders',updateFile,{total:1,created:0,updated:1,skipped:0,beforeOrders:2})
  await orders(hq);await hq.getByText('平台资料已更新，待核对预约',{exact:true}).waitFor()
  assert.equal((await request('/api/admin/appointments/'+booking.id,hqToken)).status,'CONFIRMED')
  await hq.screenshot({path:'docs/screenshots/dianping-platform-update.png',fullPage:true})
  const reviewed=hq.waitForResponse(r=>r.url().endsWith('/reviewed')&&r.request().method()==='POST')
  await hq.getByRole('button',{name:'已核对平台更新',exact:true}).click();assert.equal((await reviewed).status(),200)
  await expect(hq.getByText('平台资料已更新，待核对预约',{exact:true})).toHaveCount(0)
  checks.push('平台退款更新提示门店核对，保留关联预约状态，核对操作留痕')
  for(const width of [1680,1024]){
    await hq.setViewportSize({width,height:1000})
    assert.equal(await hq.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
    await hq.screenshot({path:`docs/screenshots/dianping-orders-${width}.png`,fullPage:true})
    await menu(hq,'扩展与配置').click();await hq.getByRole('heading',{name:'大众点评数据接入',exact:true}).waitFor()
    assert.equal(await hq.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false)
    await orders(hq)
  }
  assert.deepEqual(await request('/api/admin/roles',hqToken),grants)
  await menu(hq,'品牌与内容').click();await hq.getByRole('button',{name:'养护项目',exact:true}).waitFor()
  assert.equal(await menu(hq,'养护项目').count(),0)
  checks.push('升级保留角色授权及原品牌与内容入口；1680、1024 宽度无整页横向溢出')
  assert.deepEqual(errors,[]);assert.deepEqual(responses,[])
}catch(e){failure=e;await hq.screenshot({path:'docs/screenshots/dianping-failure.png',fullPage:true}).catch(()=>{})}
finally{
  await browser.close();await rm(fixture,{recursive:true,force:true})
  await writeFile('docs/dianping-browser-result.json',JSON.stringify({at:new Date().toISOString(),base,checks,errors,responses,failure:failure?.message},null,2))
}
if(failure)throw failure
console.log(JSON.stringify({checks,errors,responses},null,2))
