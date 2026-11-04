import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'

const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8790'
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'msedge',headless:true})
const client=await browser.newPage({viewport:{width:390,height:844}})
const admin=await browser.newPage({viewport:{width:1440,height:1080}})
const checks=[],errors=[]
let authToken='',teacherRestored=false
const originals=new Map(),dirtyTeachers=new Set()
for(const page of [client,admin])page.on('pageerror',e=>errors.push(e.message))
await mkdir('docs/screenshots',{recursive:true})
const site=await (await fetch(base+'/api/site')).json()
const storeName=id=>site.stores.find(s=>s.id===id).name
const picker=client.getByLabel('意向调理师',{exact:false})
async function adminApi(path,method='GET',body){
  const response=await fetch(base+'/api/admin/'+path,{method,headers:{Authorization:'Bearer '+authToken,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
  const data=await response.json();assert.equal(response.ok,true,JSON.stringify(data));return data
}
async function restoreTeacher(id){
  const original=originals.get(id);assert(original,'Restore requires a snapshot')
  const current=(await adminApi('therapists')).find(t=>t.id===id);assert(current,'Fixture must remain accessible')
  await adminApi('therapists','PUT',{...original,originalStoreId:current.storeId})
  const restored=(await adminApi('therapists')).find(t=>t.id===id)
  assert.deepEqual(restored,original,'The original teacher profile and ownership must be restored')
  dirtyTeachers.delete(id);teacherRestored=dirtyTeachers.size===0
}
async function assertAllStores(storeIds){
  assert.equal(await admin.getByLabel('门店范围',{exact:true}).inputValue(),'','HQ scope must remain all stores')
  const teachers=await adminApi('therapists?storeId=')
  await admin.waitForFunction(({storeIds,teacherIds})=>{
    const groups=[...document.querySelectorAll('.therapist-store-group')].map(e=>e.dataset.storeId).sort()
    const cards=[...document.querySelectorAll('.therapist-card')].map(e=>e.dataset.therapistId).sort()
    return JSON.stringify(groups)===JSON.stringify(storeIds.sort())&&JSON.stringify(cards)===JSON.stringify(teacherIds.sort())
  },{storeIds:[...storeIds],teacherIds:teachers.map(t=>t.id)})
  assert.equal(await admin.locator('.therapist-store-group[data-store-id="bai-le-men"]').count(),1)
  assert.equal(await admin.getByLabel('调理师门店筛选').getByRole('button',{name:storeName('bai-le-men'),exact:false}).count(),1)
  for(const teacher of teachers){
    const card=admin.locator(`.therapist-card[data-therapist-id="${teacher.id}"]`)
    assert.equal(await card.locator('..').locator('..').getAttribute('data-store-id'),teacher.storeId)
  }
  return teachers
}
async function saveDialog(){
  const [saved]=await Promise.all([
    admin.waitForResponse(r=>r.url().endsWith('/api/admin/therapists')&&r.request().method()==='PUT'),
    admin.getByRole('dialog').getByRole('button',{name:'保存资料',exact:true}).click()
  ])
  assert.equal(saved.status(),200,await saved.text())
  await admin.getByRole('dialog').waitFor({state:'hidden'})
}
async function enterContactForm(){
  await client.getByRole('button',{name:'选择养护项目',exact:false}).click()
  await client.locator('.choice-service').first().click()
  await client.getByRole('button',{name:'选择日期与时间',exact:false}).click()
  await client.locator('.slot-grid button:enabled').first().click()
  await client.getByRole('button',{name:'填写联系信息',exact:false}).click()
}
async function assertOnlyStore(id){
  await client.waitForFunction(({id,name})=>{
    const options=[...document.querySelectorAll('.flow-field select option')].filter(o=>o.value.startsWith(id+'-t'))
    return options.length>0&&options.every(o=>o.textContent.includes(name))
  },{id,name:storeName(id)})
  const values=await picker.locator('option').evaluateAll(options=>options.map(o=>o.value))
  assert(values.length>1);assert(values.every(v=>!v||v.startsWith(id+'-t')),JSON.stringify(values))
}
try{
  await client.goto(base)
  await client.locator('.hero-copy button').click()
  await client.locator('.choice-store').filter({hasText:storeName('yuyao')}).click()
  await enterContactForm();await assertOnlyStore('yuyao')
  await picker.selectOption('yuyao-t1')
  checks.push('客户意向选择仅列出本店调理师，选项带所属门店名称')

  // Hold an old store's request until the new store has loaded and the customer opens its form.
  let releaseOld,receivedOld
  const intercepted=new Promise(resolve=>receivedOld=resolve)
  await client.route('**/api/stores/shanghai/therapists',async route=>{
    receivedOld()
    await new Promise(resolve=>releaseOld=resolve)
    await route.continue()
  })
  await client.locator('.flow-steps button').first().click()
  await client.locator('.choice-store').filter({hasText:storeName('shanghai')}).click()
  await intercepted
  await client.locator('.choice-store').filter({hasText:storeName('changde')}).click()
  await enterContactForm();await assertOnlyStore('changde')
  assert.equal(await picker.inputValue(),'','Changing store clears the old therapist intention')
  const oldResponse=client.waitForResponse(r=>r.url().endsWith('/api/stores/shanghai/therapists'))
  releaseOld();await oldResponse
  await assertOnlyStore('changde')
  await picker.selectOption('changde-t1')
  await client.screenshot({path:'docs/screenshots/client-therapist-store.png',fullPage:true})
  checks.push('余姚路切至上海再切常德路，清空原老师；上海旧请求晚到仍保留常德路老师')

  await admin.goto(base+'/admin')
  await admin.getByPlaceholder('请输入账号').fill('admin')
  await admin.getByPlaceholder('请输入密码').fill('Yht@9800dev')
  await admin.getByRole('button',{name:'登录管理后台',exact:true}).click()
  await admin.locator('.ops-sidebar').getByRole('button',{name:'调理师管理',exact:true}).click()
  authToken=await admin.evaluate(()=>sessionStorage.getItem('yht-admin-token'))
  const stores=await adminApi('stores'),storeIds=stores.map(s=>s.id)
  assert.equal(storeIds.length,9)
  const allBefore=await assertAllStores(storeIds)
  const beforeIds=allBefore.map(t=>t.id).sort()
  checks.push('总部默认全部门店：九家门店均分组展示，包含上海中心店、百乐门店，老师列表与全量接口一致')

  // Reproduce the reported bug: edit a Shanghai teacher while headquarters is viewing every store.
  const shanghaiTeacher=allBefore.find(t=>t.storeId==='shanghai');assert(shanghaiTeacher)
  originals.set(shanghaiTeacher.id,structuredClone(shanghaiTeacher))
  await admin.locator(`.therapist-card[data-therapist-id="${shanghaiTeacher.id}"]`).getByRole('button',{name:'编辑资料',exact:true}).click()
  await admin.getByLabel('等级 / 头衔',{exact:true}).fill('总部全店视图验证')
  dirtyTeachers.add(shanghaiTeacher.id)
  await saveDialog()
  const afterEdit=await assertAllStores(storeIds)
  assert.deepEqual(afterEdit.map(t=>t.id).sort(),beforeIds)
  assert.equal(afterEdit.find(t=>t.id===shanghaiTeacher.id).grade,'总部全店视图验证')
  assert.deepEqual((await adminApi('stores')).map(s=>s.id).sort(),[...storeIds].sort())
  assert.equal((await adminApi('me')).hq,true)
  await admin.screenshot({path:'docs/screenshots/admin-headquarters-after-shanghai-edit.png',fullPage:false})
  checks.push('实际保存上海店老师资料后，总部仍为全部门店；百乐门店和其他门店继续显示，账号范围未变')
  await restoreTeacher(shanghaiTeacher.id)

  await admin.getByRole('button',{name:'新增调理师',exact:true}).click()
  assert.equal(await admin.getByLabel('调理师所属门店',{exact:true}).inputValue(),'','All-store creation must explicitly select the owning store')
  await admin.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()

  for(const id of ['shanghai','changde']){
    await admin.getByLabel('门店范围',{exact:true}).selectOption(id)
    await admin.locator('.therapist-card').first().waitFor()
    await admin.waitForFunction(name=>{
      const labels=[...document.querySelectorAll('.therapist-store')]
      return labels.length>0&&labels.every(e=>e.textContent.includes(name))
    },storeName(id))
    assert((await admin.locator('.therapist-store').allTextContents()).every(t=>t.includes(storeName(id))))
  }
  await admin.screenshot({path:'docs/screenshots/admin-therapist-stores.png',fullPage:false})
  await admin.getByLabel('调理师门店筛选').getByRole('button',{name:'全部门店',exact:true}).click()
  await assertAllStores(storeIds)
  const originalTeacher=(await adminApi('therapists?storeId=changde')).find(t=>t.id==='changde-t3')
  assert(originalTeacher,'Use a known local sample for the reversible transfer check')
  originals.set(originalTeacher.id,structuredClone(originalTeacher))
  await admin.locator(`.therapist-card[data-therapist-id="${originalTeacher.id}"]`).getByRole('button',{name:'编辑资料',exact:true}).click()
  const home=admin.getByLabel('调理师所属门店',{exact:true})
  assert.equal(await home.inputValue(),'changde');assert.equal(await home.evaluate(e=>e.tagName),'SELECT')
  await home.selectOption('shanghai')
  assert((await admin.getByRole('dialog').innerText()).includes('原预约保留在原门店'))
  await admin.screenshot({path:'docs/screenshots/admin-therapist-store-edit.png',fullPage:false})
  dirtyTeachers.add(originalTeacher.id)
  await saveDialog()
  const afterTransfer=await assertAllStores(storeIds)
  assert.deepEqual(afterTransfer.map(t=>t.id).sort(),beforeIds)
  assert.equal(afterTransfer.find(t=>t.id===originalTeacher.id).storeId,'shanghai')
  assert(!(await adminApi('therapists?storeId=changde')).some(t=>t.id===originalTeacher.id))
  assert((await adminApi('therapists?storeId=shanghai')).some(t=>t.id===originalTeacher.id&&t.storeName===storeName('shanghai')))
  assert(!(await (await fetch(base+'/api/stores/changde/therapists')).json()).some(t=>t.id===originalTeacher.id))
  assert((await (await fetch(base+'/api/stores/shanghai/therapists')).json()).some(t=>t.id===originalTeacher.id))
  await admin.getByLabel('门店范围',{exact:true}).selectOption('shanghai')
  const destinationTeachers=await adminApi('therapists?storeId=shanghai')
  await admin.waitForFunction(({count,name})=>{
    const cards=[...document.querySelectorAll('.therapist-card')]
    return cards.length===count&&cards.every(c=>c.querySelector('.therapist-store')?.textContent.includes(name))
  },{count:destinationTeachers.length,name:storeName('shanghai')})
  assert.equal(await admin.locator('.therapist-card').filter({hasText:originalTeacher.name}).count(),destinationTeachers.filter(t=>t.name===originalTeacher.name).length)
  checks.push('总部全部门店下实际转店，仅移动该老师；九店和全体人员仍可见，客户接口同步更新本店名单')
  await restoreTeacher(originalTeacher.id)
  await admin.getByLabel('门店范围',{exact:true}).selectOption('')
  await assertAllStores(storeIds)
  await admin.getByRole('status').waitFor({state:'hidden'})
  await admin.screenshot({path:'docs/screenshots/admin-headquarters-all-stores.png',fullPage:false})

  await admin.locator('.ops-sidebar').getByRole('button',{name:'门店与时段',exact:true}).click()
  await admin.locator('.store-overview-card').last().waitFor()
  assert.deepEqual((await admin.locator('.store-overview-card').evaluateAll(cards=>cards.map(c=>c.dataset.storeId))).sort(),[...storeIds].sort())
  await admin.screenshot({path:'docs/screenshots/admin-headquarters-store-overview.png',fullPage:true})
  await admin.getByRole('button',{name:`管理${storeName('shanghai')}`,exact:true}).click()
  assert.equal(await admin.getByLabel('门店范围',{exact:true}).inputValue(),'shanghai')
  await admin.getByRole('button',{name:'返回全部门店',exact:true}).click()
  assert.equal(await admin.getByLabel('门店范围',{exact:true}).inputValue(),'')
  assert.equal(await admin.locator('.store-overview-card').count(),storeIds.length)
  checks.push('总部门店与时段默认展示九店总览，可进入上海店维护并返回全部门店，不再默认第一家店')

  const branch=await browser.newPage({viewport:{width:1440,height:1080}})
  branch.on('pageerror',e=>errors.push(e.message))
  await branch.goto(base+'/admin')
  await branch.getByPlaceholder('请输入账号').fill('yuyao')
  await branch.getByPlaceholder('请输入密码').fill('Yht@9800dev')
  await branch.getByRole('button',{name:'登录管理后台',exact:true}).click()
  await branch.locator('.ops-sidebar').getByRole('button',{name:'调理师管理',exact:true}).click()
  await branch.locator('.therapist-card').first().waitFor()
  assert.equal(await branch.locator('.therapist-store-group').count(),1)
  assert.equal(await branch.locator('.therapist-store-group').getAttribute('data-store-id'),'yuyao')
  assert.equal(await branch.getByLabel('门店范围',{exact:true}).locator('option').count(),1)
  await branch.getByRole('button',{name:'编辑资料',exact:true}).first().click()
  const branchHome=branch.getByLabel('调理师所属门店',{exact:true})
  assert.equal(await branchHome.inputValue(),storeName('yuyao'));assert.equal(await branchHome.getAttribute('readonly'),'')
  await branch.screenshot({path:'docs/screenshots/admin-therapist-store-branch.png',fullPage:false})
  checks.push('门店店长可维护本店资料，所属门店字段只读，不能自行跨店调人')
  assert.deepEqual(errors,[])
  const report={result:'PASS',base,checks,storeCount:stores.length,therapistCount:allBefore.length,browserErrors:errors,appointmentWrites:0,therapistTransferRestored:teacherRestored,teacherProfilesRestored:dirtyTeachers.size===0}
  await writeFile('docs/therapist-store-result.json',JSON.stringify(report,null,2),'utf8')
  console.log(JSON.stringify(report,null,2))
}catch(e){
  await Promise.allSettled([
    client.screenshot({path:'docs/screenshots/failure-therapist-client.png',fullPage:true}),
    admin.screenshot({path:'docs/screenshots/failure-therapist-admin.png',fullPage:true})
  ])
  console.error(e);process.exitCode=1
}finally{
  try{for(const id of [...dirtyTeachers])await restoreTeacher(id)}catch(e){console.error('Restore failed:',e);process.exitCode=1}
  await browser.close()
}
