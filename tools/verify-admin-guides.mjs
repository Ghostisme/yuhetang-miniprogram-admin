import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {serveAdmin,mockAdmin,unknown,writes} from './admin-responsive-fixtures.mjs'

// Real built UI with isolated API fixtures. Excel downloads come from the
// backend's ImportGuidesIntegrationTest; no production data or messages are used.
const output=resolve('backups/admin-guides')
await mkdir(output,{recursive:true})
const server=await serveAdmin(),browser=await chromium.launch({channel:'msedge',headless:true})
const checks=[],errors=[],mutations=[]
const modules=[['appointments','预约管理'],['customers','客户档案'],['chats','客户沟通'],['stores','门店与时段'],['content','品牌与内容'],['notifications','消息中心']]
const sizes=[[320,568],[360,780],[768,1024],[1366,768]]
const builtIndexSha256=createHash('sha256').update(await readFile('dist/index.html')).digest('hex')
let passed=false,activePage
async function navigate(page,id,label){
  if(await page.getByRole('button',{name:'打开管理导航',exact:true}).isVisible()){
    await page.getByRole('button',{name:'打开管理导航',exact:true}).click()
    await page.locator('.ops-mobile-navigation').getByRole('button',{name:label,exact:true}).click()
    await page.locator('.ops-mobile-navigation').waitFor({state:'hidden'})
  }else await page.locator('.ops-sidebar').getByRole('button',{name:label,exact:true}).click()
  await page.locator(`.ops-main[data-page="${id}"]`).waitFor()
  await page.waitForTimeout(180)
}
async function fits(page,label){
  await page.waitForTimeout(180)
  const layout=await page.locator('.ant-tour.admin-guide-tour').evaluate(e=>{
    const r=e.getBoundingClientRect(),hole=document.querySelector('.ant-tour-mask mask rect[fill="black"]'),target=hole?{left:+hole.getAttribute('x'),top:+hole.getAttribute('y'),width:+hole.getAttribute('width'),height:+hole.getAttribute('height')}:null,buttons=[...e.querySelectorAll('button')].map(b=>{const x=b.getBoundingClientRect();return {text:b.textContent,left:x.left,right:x.right,top:x.top,bottom:x.bottom}})
    return {target,left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,buttons}
  })
  assert(layout.left>=-1&&layout.right<=layout.width+1,`${label}: tour horizontal overflow ${JSON.stringify(layout)}`)
  assert(layout.top>=-1&&layout.bottom<=layout.height+1,`${label}: tour vertical overflow ${JSON.stringify(layout)}`)
  assert(layout.documentWidth<=layout.width+1,`${label}: page horizontal overflow`)
  for(const button of layout.buttons)assert(button.left>=0&&button.right<=layout.width+1&&button.top>=0&&button.bottom<=layout.height+1,`${label}: button clipped ${JSON.stringify(button)}`)
  assert(layout.target&&layout.target.width>12&&layout.target.height>12,`${label}: missing real spotlight`)
  const target=layout.target
  assert(layout.right<=target.left+1||layout.left>=target.left+target.width-1||layout.bottom<=target.top+1||layout.top>=target.top+target.height-1,`${label}: tour covers highlighted control ${JSON.stringify(layout)}`)
  return layout
}
async function finishTour(page,id,label,total,screenshot,automatic=false){
  const button=page.getByRole('button',{name:label+'操作引导',exact:true})
  if(!automatic)await button.click()
  const tour=page.locator('.ant-tour.admin-guide-tour')
  for(let step=1;step<=total;step++){
    await tour.locator('.admin-guide-progress').getByText(`${step} / ${total}`,{exact:true}).waitFor()
    await fits(page,`${id}-${step}`)
    if(step===2){await tour.getByRole('button',{name:'上一步',exact:true}).click();await tour.locator('.admin-guide-progress').getByText(`1 / ${total}`,{exact:true}).waitFor();await tour.getByRole('button',{name:'下一步',exact:true}).click()}
    if(step===1&&screenshot)await page.screenshot({path:resolve(output,screenshot),animations:'disabled'})
    await tour.getByRole('button',{name:step===total?'完成引导':'下一步',exact:true}).click()
  }
  await tour.waitFor({state:'hidden'})
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),`yht-admin-guide:v2:hq-user:${id}`),'done')
  await button.click();await tour.locator('.admin-guide-progress').getByText(`1 / ${total}`,{exact:true}).waitFor()
  await tour.getByRole('button',{name:'跳过',exact:true}).click();await tour.waitFor({state:'hidden'})
  assert(await button.evaluate(e=>e===document.activeElement),'Closing restores focus to the trigger')
}
try{
  for(const [width,height] of sizes){
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<768,acceptDownloads:true})
    await mockAdmin(context,true,{guidesSeen:false})
    context.on('request',request=>{if(!['GET','HEAD'].includes(request.method())&&!/\/chats\/[^/]+\/read$/.test(new URL(request.url()).pathname))mutations.push(request.method()+' '+new URL(request.url()).pathname)})
    const page=await context.newPage();activePage=page;page.on('pageerror',error=>errors.push(error.message))
    await page.goto(server.base+'/admin');await page.locator('.ops-topbar').waitFor()
    for(const [id,label] of modules){
      await navigate(page,id,label)
      await page.locator('.ant-tour.admin-guide-tour').waitFor()
      await finishTour(page,id,label,5,`${width}-${id}.png`,true)
      checks.push({scenario:'first-visit-auto-anchored-complete-previous-skip-replay',width,module:id,steps:5})
    }
    // Reload preserves completion without automatically interrupting work.
    await page.reload();await page.locator('.ops-topbar').waitFor()
    await navigate(page,'appointments','预约管理');await page.waitForTimeout(650)
    assert.equal(await page.locator('.ant-tour.admin-guide-tour').count(),0)
    checks.push({scenario:'completion-persists-after-reload-and-module-revisit',width})
    await navigate(page,'imports','资料导入')
    await page.locator('.import-field-table tbody tr').first().waitFor()
    const kinds=[['members','会员基础资料',6],['therapists','调理师资料',9],['stores','门店资料',7],['services','养护品项资料',8],['dianping-customers','大众点评客户',4],['dianping-orders','大众点评订单 / 预约记录',13]]
    for(const [kind,label,fields] of kinds){
      if(kind!=='members'){
        await page.getByRole('combobox',{name:'导入资料类型',exact:true}).click()
        await page.getByRole('option',{name:label,exact:true}).click()
      }
      const expected=JSON.parse(await readFile(resolve('../yuhetang-miniprogram-backend/target-api/import-guide-fixtures',kind+'.json'),'utf8'))
      await page.getByRole('region',{name:expected.title+'字段说明',exact:true}).waitFor()
      assert.equal(await page.locator('.import-field-table tbody tr').count(),fields)
      assert.deepEqual(await page.locator('.import-field-table td:first-child code').allTextContents(),expected.fields.map(field=>field.key))
      await page.getByRole('button',{name:'下载填写示例 Excel',exact:true}).scrollIntoViewIfNeeded()
      const downloadPromise=page.waitForEvent('download')
      await page.getByRole('button',{name:'下载填写示例 Excel',exact:true}).click()
      const download=await downloadPromise
      assert(download.suggestedFilename().endsWith('-填写示例.xlsx'))
      assert.deepEqual(await readFile(await download.path()),await readFile(resolve('../yuhetang-miniprogram-backend/target-api/import-guide-fixtures',kind+'.xlsx')))
      assert(await page.getByRole('button',{name:'预检文件',exact:true}).isDisabled())
      assert.equal(await page.getByRole('button',{name:'确认导入',exact:true}).count(),0)
      const measure=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}))
      assert(measure.documentWidth<=measure.width+1,`${kind}: import page horizontal overflow`)
      if(kind==='members'||kind==='dianping-orders')await page.screenshot({path:resolve(output,`${width}-imports-${kind}.png`),animations:'disabled'})
      checks.push({scenario:'exact-fields-and-actual-xlsx-download',width,kind,fields})
    }
    await context.close()
  }
  // A new installation can have no bookings, customers or conversations. Keep
  // every step usable without manufacturing a record or opening a real chat.
  {
    const context=await browser.newContext({viewport:{width:360,height:780}})
    await mockAdmin(context,true,{guidesSeen:false})
    for(const path of ['appointments','customers','chats'])await context.route(`**/api/admin/${path}?*`,route=>route.fulfill({json:{items:[],total:0,page:1,unreadTotal:0}}))
    await context.route('**/api/admin/chats',route=>route.fulfill({json:{items:[],total:0,page:1,unreadTotal:0}}))
    const page=await context.newPage();activePage=page;page.on('pageerror',error=>errors.push(error.message))
    await page.goto(server.base+'/admin');await page.locator('.ops-topbar').waitFor()
    for(const [id,label] of modules.slice(0,3)){
      await navigate(page,id,label)
      await finishTour(page,id,label,5,null,true)
      checks.push({scenario:'empty-records-keep-all-steps-usable',module:id})
    }
    await navigate(page,'notifications','消息中心')
    await page.locator('.ant-tour.admin-guide-tour').waitFor()
    await fits(page,'before-resize')
    await page.setViewportSize({width:1366,height:768});await fits(page,'phone-to-desktop-resize')
    await page.setViewportSize({width:320,height:568});await fits(page,'desktop-to-small-phone-resize')
    await page.locator('.ant-tour-close').click();await page.locator('.ant-tour.admin-guide-tour').waitFor({state:'hidden'})
    assert.equal(await page.evaluate(()=>localStorage.getItem('yht-admin-guide:v2:hq-user:notifications')),'skipped')
    checks.push({scenario:'open-guide-resizes-and-close-persists'})
    await context.close()
  }
  // Missing import, rule and notification configuration rights shorten the
  // guides. The existing store module requires profile or rule edit access.
  const context=await browser.newContext({viewport:{width:390,height:844}});await mockAdmin(context)
  await context.route('**/api/admin/me',route=>route.fulfill({json:{id:'limited-guide-user',name:'受限总部',hq:true,storeId:'',roleIds:['limited-guide'],permissions:['appointments:read','customers:read','chat:read','stores:write','content:read','notifications:read']}}))
  const page=await context.newPage();activePage=page;page.on('pageerror',error=>errors.push(error.message));await page.goto(server.base+'/admin');await page.locator('.ops-topbar').waitFor()
  for(const [id,label,total] of [['customers','客户档案',4],['stores','门店与时段',3],['notifications','消息中心',4]]){
    await navigate(page,id,label);await page.locator('.ant-tour.admin-guide-tour').waitFor()
    const tour=page.locator('.ant-tour.admin-guide-tour');await tour.locator('.admin-guide-progress').getByText(`1 / ${total}`,{exact:true}).waitFor()
    await page.keyboard.press('Escape');await tour.waitFor({state:'hidden'})
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),`yht-admin-guide:v2:limited-guide-user:${id}`),'skipped')
    checks.push({scenario:'limited-permission-and-escape',module:id,steps:total})
  }
  await context.close()
  assert.deepEqual(writes,[],'Tours and example downloads never write business data')
  assert.deepEqual(mutations,[],'No business mutation requests while using guides')
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  passed=true;console.log(JSON.stringify({status:'passed',checks:checks.length,liveApisUsed:false,output},null,2))
}catch(error){if(activePage&&!activePage.isClosed())await activePage.screenshot({path:resolve(output,'failure.png'),animations:'disabled'});errors.push(error.message);throw error}
finally{await writeFile(resolve(output,'result.json'),JSON.stringify({status:passed?'passed':'failed',builtIndexSha256,liveApisUsed:false,checks,errors,unknown,writes,mutations},null,2));await browser.close();await server.close()}
