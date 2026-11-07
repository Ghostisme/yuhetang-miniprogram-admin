import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'

const base=process.env.TEST_BASE_URL,apiBase=process.env.TEST_API_URL
assert(base&&apiBase&&process.env.TEST_ALLOW_RBAC_MUTATION==='1','Set explicit test URLs and TEST_ALLOW_RBAC_MUTATION=1 for the isolated RBAC fixture')
for(const value of [base,apiBase]){
  const url=new URL(value)
  assert(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='18891','RBAC mutations are restricted to the isolated local server on port 18891')
}
assert.equal((await fetch(apiBase+'/api/runtime').then(r=>r.json())).developmentLogin,true)
const checks=[],errors=[],unexpectedResponses=[],suffix=Date.now().toString().slice(-8)
await mkdir('docs/screenshots',{recursive:true})
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true})
const contexts=await Promise.all(Array.from({length:3},()=>browser.newContext({viewport:{width:1440,height:1080}})))
for(const context of contexts)context.on('page',p=>{
  p.on('pageerror',e=>errors.push(e.message))
  p.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400&&r.status()!==401)unexpectedResponses.push({url:r.url(),status:r.status()})})
})
const [hq,branch,custom]=await Promise.all(contexts.map(c=>c.newPage()))
const menu=(p,name)=>p.locator('.ops-sidebar').getByRole('button',{name,exact:false})
async function request(path,token,method='GET',input,status=200){
  const r=await fetch(apiBase+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined})
  const data=await r.json();assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(data)}`);return data
}
async function login(p,username){
  await p.goto(base+'/admin')
  await p.evaluate(()=>sessionStorage.removeItem('yht-admin-token'))
  await p.reload()
  await p.getByPlaceholder('请输入账号').fill(username)
  await p.getByPlaceholder('请输入密码').fill('Yht@9800dev')
  await p.getByRole('button',{name:'登录管理后台',exact:true}).click()
  await p.locator('.operations').waitFor()
  await p.locator('.ops-page-heading h1').waitFor()
  return p.evaluate(()=>sessionStorage.getItem('yht-admin-token'))
}
async function openRole(id){
  await hq.locator(`[data-role-id="${id}"]`).getByRole('button',{name:'配置权限',exact:true}).click()
  return hq.getByRole('dialog')
}
async function saveRole(dialog){
  const saved=hq.waitForResponse(r=>r.url().endsWith('/api/admin/roles')&&r.request().method()==='PUT')
  await dialog.getByRole('button',{name:'保存角色授权',exact:true}).click()
  assert.equal((await saved).status(),200)
  await dialog.waitFor({state:'hidden'})
}
async function shot(p,name){await p.screenshot({path:`docs/screenshots/rbac-${name}.png`,fullPage:true})}
async function createRoleUser(token,name,scope,permissions){
  const roleName=name+suffix
  await request('/api/admin/roles',token,'PUT',{id:'',name:roleName,dataScope:scope,permissions})
  const role=(await request('/api/admin/roles',token)).find(r=>r.name===roleName)
  const username=name+suffix
  await request('/api/admin/users',token,'PUT',{id:'',username,displayName:roleName,password:'Yht@9800dev',storeId:scope==='STORE'?'yuyao':'',enabled:true,roleIds:[role.id]})
  return username
}
let failure
try{
  const hqToken=await login(hq,'admin')
  await request('/api/admin/roles',hqToken,'PUT',{id:'frontdesk',name:'门店前台',dataScope:'STORE',permissions:[]})
  await menu(hq,'角色与权限').click()
  let dialog=await openRole('frontdesk')
  assert.equal(await dialog.getByLabel('编辑品牌草稿（总部）',{exact:true}).isDisabled(),true)
  assert.equal(await dialog.getByLabel('发布品牌内容（总部）',{exact:true}).isDisabled(),true)
  assert.equal(await dialog.getByLabel('数据范围',{exact:false}).isDisabled(),true)
  await dialog.getByLabel('维护本店养护项目',{exact:true}).check()
  assert.equal(await dialog.getByLabel('查看本店养护项目',{exact:true}).isChecked(),true)
  await dialog.getByLabel('查看本店养护项目',{exact:true}).uncheck()
  assert.equal(await dialog.getByLabel('维护本店养护项目',{exact:true}).isChecked(),false)
  await dialog.getByLabel('查看本店养护项目',{exact:true}).check()
  await dialog.getByRole('heading',{name:'品牌与内容',exact:true}).scrollIntoViewIfNeeded()
  await shot(hq,'headquarters-permissions')
  await saveRole(dialog)
  checks.push('总部可配置内置门店角色；总部专属项不可授予门店；操作和查看权限自动联动')

  let branchToken=await login(branch,'frontdesk')
  await branch.locator('.catalog-editor').first().waitFor()
  assert.equal(await menu(branch,'工作台').count(),0)
  assert.equal(await menu(branch,'品牌与内容').count(),1)
  assert.equal(await branch.getByRole('button',{name:'首页与品牌',exact:true}).count(),0)
  assert.equal(await branch.locator('.catalog-editor').first().getByLabel('名称',{exact:true}).isDisabled(),true)
  assert.equal(await branch.getByRole('button',{name:'保存到小程序',exact:true}).count(),0)
  await request('/api/admin/stores/yuyao/services',branchToken,'PUT',{items:[]},403)
  await request('/api/admin/stores/bai-le-men/services',branchToken,'GET',undefined,404)
  await shot(branch,'store-readonly')
  checks.push('仅查看本店项目：直接进入原品牌与内容页，字段只读、无保存按钮，接口拒绝写入和跨店读取')

  dialog=await openRole('frontdesk')
  await dialog.getByLabel('维护本店养护项目',{exact:true}).check()
  await saveRole(dialog)
  await request('/api/admin/me',branchToken,'GET',undefined,401)
  await branch.reload()
  await branch.getByRole('button',{name:'登录管理后台',exact:true}).waitFor()
  branchToken=await login(branch,'frontdesk')
  const item=branch.locator('.catalog-editor').first()
  await item.waitFor();assert.equal(await item.getByLabel('名称',{exact:true}).isDisabled(),false)
  const serviceName='RBAC 本店养护验证 '+suffix
  await item.getByLabel('名称',{exact:true}).fill(serviceName)
  const saved=branch.waitForResponse(r=>r.url().endsWith('/api/admin/stores/yuyao/services')&&r.request().method()==='PUT')
  await branch.getByRole('button',{name:'保存到小程序',exact:true}).click()
  assert.equal((await saved).status(),200)
  assert((await request('/api/stores/yuyao/services')).some(s=>s.name===serviceName))
  assert(!(await request('/api/stores/bai-le-men/services')).some(s=>s.name===serviceName))
  await shot(branch,'store-editable')
  checks.push('增加维护权限后旧登录失效；重新登录可在原表单编辑保存，公开本店目录同步且其他门店不受影响')

  dialog=await openRole('frontdesk')
  await dialog.getByLabel('查看本店养护项目',{exact:true}).uncheck()
  await dialog.getByLabel('预览品牌内容',{exact:true}).check()
  await saveRole(dialog)
  await login(branch,'frontdesk')
  await branch.getByLabel('品牌名称',{exact:true}).waitFor()
  assert.equal(await branch.getByLabel('品牌名称',{exact:true}).isDisabled(),true)
  assert.equal(await branch.getByRole('button',{name:'养护项目',exact:true}).count(),0)
  for(const tab of ['首页与品牌','品牌产品','空间相册'])assert.equal(await branch.getByRole('button',{name:tab,exact:true}).count(),1)
  await shot(branch,'brand-preview')
  checks.push('只授予品牌预览可正常查看原品牌、产品、相册页签，不请求未授权的门店项目管理接口')

  dialog=await openRole('frontdesk')
  await dialog.getByLabel('预览品牌内容',{exact:true}).uncheck()
  await saveRole(dialog)
  await login(branch,'frontdesk')
  await branch.getByText('当前账号尚未分配可用模块，请联系总部管理员配置角色权限。',{exact:true}).waitFor()
  assert.equal(await branch.locator('.ops-sidebar nav button').count(),0)
  await shot(branch,'no-permissions')
  checks.push('撤销全部模块权限后显示待授权提示，不再加载无权访问的工作台')

  const serviceOnly=await createRoleUser(hqToken,'svc','GLOBAL',['services:write'])
  await login(custom,serviceOnly)
  await custom.getByText('请选择上方的具体门店，查看或维护该门店的养护项目。',{exact:true}).waitFor()
  await custom.getByLabel('门店范围',{exact:true}).selectOption('yuyao')
  await custom.locator('.catalog-editor').first().waitFor()
  assert.equal(await custom.getByRole('button',{name:'保存草稿',exact:true}).count(),0)
  assert.equal(await custom.getByRole('button',{name:'保存到小程序',exact:true}).count(),1)
  checks.push('总部仅授权本店项目的自定义岗位先选门店再维护，不误请求品牌草稿接口')

  const rulesOnly=await createRoleUser(hqToken,'rules','STORE',['rules:write'])
  await login(custom,rulesOnly)
  await custom.getByRole('button',{name:'保存预约规则',exact:true}).waitFor()
  assert.equal(await custom.getByRole('button',{name:'保存门店资料',exact:true}).count(),0)
  assert.equal(await custom.getByLabel('门店名称',{exact:true}).isDisabled(),true)
  assert.equal(await custom.getByLabel('开始营业',{exact:true}).isDisabled(),false)
  checks.push('只授权预约规则时可进入门店与时段，公开资料只读且无资料保存按钮')

  const publishOnly=await createRoleUser(hqToken,'publish','GLOBAL',['content:publish'])
  await login(custom,publishOnly)
  await custom.getByLabel('品牌名称',{exact:true}).waitFor()
  assert.equal(await custom.getByLabel('品牌名称',{exact:true}).isDisabled(),true)
  assert.equal(await custom.getByRole('button',{name:'发布到小程序',exact:true}).count(),1)
  assert.equal(await custom.getByRole('button',{name:'保存草稿',exact:true}).count(),0)
  checks.push('总部发布岗位可预览和发布已保存草稿，不能在表单中编辑或保存草稿')

  assert.deepEqual(errors,[])
  assert.deepEqual(unexpectedResponses,[])
}catch(e){failure=e;await shot(hq,'failure-hq');await shot(branch,'failure-store')}
finally{
  await writeFile('docs/rbac-result.json',JSON.stringify({at:new Date().toISOString(),base,apiBase,isolated:true,checks,errors,unexpectedResponses,passed:!failure,failure:failure?.stack},null,2))
  await browser.close()
}
console.log(JSON.stringify({passed:!failure,checks,errors,unexpectedResponses},null,2))
if(failure)throw failure
