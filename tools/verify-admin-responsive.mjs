import assert from 'node:assert/strict'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {serveAdmin, mockAdmin, menus, unknown, writes} from './admin-responsive-fixtures.mjs'

// Render the actual production build. Every API (including writes) stays in this fixture context.
const output=resolve('backups/admin-responsive')
await mkdir(output,{recursive:true})
const server=await serveAdmin(),browser=await chromium.launch({channel:'msedge',headless:true})
const errors=[],results=[]
let passed=false
const buildSha256=createHash('sha256').update(await readFile('dist/index.html')).digest('hex')
const sizes=[[360,780],[390,844],[430,932],[768,1024],[1024,768],[1366,768],[1920,1080],[2560,1440]]

async function navigate(page,id,label){
  await page.locator('.operations .ops-topbar').waitFor()
  if(await page.getByRole('button',{name:'打开管理导航',exact:true}).isVisible()){
    await page.getByRole('button',{name:'打开管理导航',exact:true}).click()
    await page.locator('.ops-mobile-navigation').getByRole('button',{name:label,exact:true}).click()
    await page.locator('.ops-mobile-navigation').waitFor({state:'hidden'})
  }else await page.locator('.ops-sidebar').getByRole('button',{name:label,exact:true}).click()
  await page.locator(`.ops-main[data-page=${id}]`).waitFor()
  await page.waitForTimeout(160)
  assert.equal(await page.locator('.ops-main').evaluate(e=>e.scrollTop),0,'Module navigation resets the work area scroll')
}
async function inspect(page,name){
  const result=await page.evaluate(()=>({
    width:innerWidth,height:innerHeight,docWidth:document.documentElement.scrollWidth,docHeight:document.documentElement.scrollHeight,
    overflow:[...document.querySelectorAll('.ops-main button,.ops-main input,.ops-main textarea,.ops-main .admin-select,.ops-main .ops-card')].filter(e=>{
      const r=e.getBoundingClientRect()
      if(!r.width||!r.height||e.closest('.preview-device,.mini-program,.select-validation'))return false
      const table=e.closest('.table-scroll')
      if(innerWidth>=768&&table&&table.scrollWidth>table.clientWidth)return false
      return r.left<-.5||r.right>innerWidth+.5
    }).map(e=>({tag:e.tagName,text:e.getAttribute('aria-label')||e.textContent.slice(0,60),width:e.getBoundingClientRect().width}))
  }))
  results.push({name,...result})
  await page.screenshot({path:resolve(output,name+'.png'),animations:'disabled'})
  assert(result.docWidth<=result.width+1,`${name}: document horizontal overflow`)
  assert(result.docHeight<=result.height+1,`${name}: shell scrolls outside its work area`)
  assert.deepEqual(result.overflow,[],`${name}: offscreen controls`)
  const cards=await page.locator('.stat-card').evaluateAll(rows=>rows.map(e=>({
    height:e.getBoundingClientRect().height,
    label:e.querySelector(':scope > span').getBoundingClientRect().bottom,
    value:e.querySelector('strong').getBoundingClientRect().top,
    footer:e.querySelector('p').getBoundingClientRect().bottom,
    bottom:e.getBoundingClientRect().bottom
  })))
  for(const card of cards){
    assert(card.height>=138,`${name}: statistic card collapsed`)
    assert(card.value>=card.label,`${name}: statistic label overlaps value`)
    assert(card.footer<=card.bottom,`${name}: statistic help text is clipped`)
  }
  for(const card of await page.locator('.assets-grid > button').evaluateAll(rows=>rows.map(e=>({height:e.clientHeight,scroll:e.scrollHeight})))){
    assert(card.height>=(result.width<768?150:220)&&card.scroll<=card.height+2,`${name}: image card is clipped`)
  }
  for(const height of await page.locator('.ops-main .ant-btn').evaluateAll(rows=>rows.map(e=>e.getBoundingClientRect().height).filter(Boolean)))assert(height>=(result.width<768?44:28),`${name}: action is too small`)
  if(result.width>=768)for(const height of await page.locator('.ops-main:is([data-page=appointments],[data-page=customers],[data-page=users],[data-page=audit]) > .ops-card > .table-scroll').evaluateAll(rows=>rows.map(e=>e.clientHeight)))assert(height>=200,`${name}: table scroller collapsed`)
}
async function modalFits(page){
  await page.waitForTimeout(300) // Measure the settled dialog, after Ant Design's entrance animation.
  const dialog=page.getByRole('dialog').last(),box=await dialog.boundingBox(),viewport=page.viewportSize()
  assert(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1,'Dialog must fit screen')
  const overflow=await dialog.evaluate(e=>e.scrollWidth>e.clientWidth+1)
  assert(!overflow,'Dialog content must fit its own width')
  if(viewport.width<768)for(const button of await dialog.locator('.ant-modal-body .ant-btn').evaluateAll(rows=>rows.map(e=>({height:e.getBoundingClientRect().height,fontSize:parseFloat(getComputedStyle(e).fontSize)})).filter(e=>e.height))){
    assert(button.height>=44,'Phone dialog actions must be touch sized')
    assert(button.fontSize>=14,'Phone dialog actions must remain legible')
  }
}
try{
  for(let offset=0;offset<sizes.length;offset+=3){
    await Promise.all(sizes.slice(offset,offset+3).map(async([width,height])=>{
    const context=await browser.newContext({viewport:{width,height},hasTouch:width<1024})
    await mockAdmin(context)
    const page=await context.newPage()
    page.on('pageerror',e=>errors.push(e.message))
    await page.goto(server.base+'/admin')
    await page.locator('.stat-card').first().waitFor()
    for(const [id,label] of menus){
      await navigate(page,id,label)
      await inspect(page,`${width}-${id}`)
    }
    await navigate(page,'appointments','预约管理')
    const first=width<768?page.locator('.appointment-card').nth(1):page.locator('.appointment-table tbody tr').nth(1)
    await first.getByRole('button',{name:'查看处理',exact:true}).click()
    await modalFits(page)
    if(width<768){
      await page.locator('.appointment-mobile-summary').waitFor()
      const button=page.getByRole('button',{name:'确认接待',exact:true})
      await button.scrollIntoViewIfNeeded()
      assert((await button.boundingBox()).height>=44,'Phone review action must be touch sized')
      await button.click()
      await page.locator('.appointment-detail .detail-status').getByText('已确认').waitFor()
      const body=page.locator('.appointment-detail .ant-modal-body')
      await body.evaluate(e=>e.scrollTop=e.scrollHeight)
      assert(await body.evaluate(e=>e.scrollTop>0),'Long appointment details must remain scrollable')
      await body.evaluate(e=>e.scrollTop=0)
    }
    await page.screenshot({path:resolve(output,`${width}-appointment-detail.png`),animations:'disabled'})
    await page.locator('.ant-modal-close').click()
    await page.getByRole('button',{name:'前台代约',exact:true}).click()
    await modalFits(page)
    await page.screenshot({path:resolve(output,`${width}-manual-booking.png`),animations:'disabled'})
    await page.locator('.ant-modal-close').click()
    await page.getByRole('button',{name:'当日时段视图',exact:true}).click()
    await page.locator('.calendar-booking').first().waitFor()
    await inspect(page,`${width}-calendar`)
    await navigate(page,'chats','客户沟通')
    await page.locator('.chat-list-item').first().click()
    await page.locator('.chat-bubble').first().waitFor()
    const input=page.getByRole('textbox',{name:'回复消息',exact:true})
    await input.fill(Array.from({length:12},(_,i)=>`长回复第${i+1}行，请保持消息区和发送操作可见。`).join('\n'))
    await page.waitForTimeout(200)
    const replyBounds=await page.locator('.chat-reply').boundingBox(),workspaceBounds=await page.locator('.chat-workspace').boundingBox(),sendBounds=await page.getByRole('button',{name:'发送',exact:true}).boundingBox()
    assert(replyBounds.y+replyBounds.height<=workspaceBounds.y+workspaceBounds.height+1,'Long replies stay inside the conversation pane')
    assert(sendBounds.y>=replyBounds.y&&sendBounds.y+sendBounds.height<=replyBounds.y+replyBounds.height,'Send remains inside the reply area')
    assert((await page.locator('.chat-messages').boundingBox()).height>=90,'Long drafts preserve readable chat history')
    assert(await input.evaluate(e=>e.scrollHeight>e.clientHeight),'Long drafts scroll inside their input')
    await input.fill('多端客服发送测试')
    if(width<768){
      const composer=await input.boundingBox()
      assert(composer.y>=0&&composer.y+composer.height<=height,'Phone composer stays on screen')
      await page.getByRole('button',{name:'返回会话列表',exact:true}).click()
      await page.locator('.chat-list-item').first().click()
      assert.equal(await input.inputValue(),'多端客服发送测试','Returning to same conversation preserves draft')
    }
    await input.press('Enter')
    await page.locator('.chat-bubble').getByText('多端客服发送测试',{exact:true}).waitFor()
    await inspect(page,`${width}-chat-thread`)
    await context.close()
    console.log(`PASS ${width}x${height}: all ${menus.length} modules, booking dialogs, calendar and chat`)
    }))
  }
  // Open the editors hidden behind tabs and selectors, plus long forms in portals.
  for(const width of [390,768,1366]){
    const context=await browser.newContext({viewport:{width,height:844}})
    await mockAdmin(context)
    const page=await context.newPage()
    page.on('pageerror',e=>errors.push(e.message))
    await page.goto(server.base+'/admin')
    await page.getByRole('combobox',{name:'门店范围',exact:true}).click()
    const selected=page.locator('.admin-select-popup .ant-select-item-option-selected')
    assert.equal(await selected.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(229, 237, 221)')
    assert.equal(await page.locator('.scope-control .ant-select-content-has-value').evaluate(e=>getComputedStyle(e).opacity),'1','Selected store remains legible when the menu opens')
    assert.equal(await page.getByRole('combobox',{name:'门店范围',exact:true}).evaluate(e=>getComputedStyle(e).boxShadow),'none','Store control must not have a double focus ring')
    await page.getByRole('option',{name:'百乐门店',exact:true}).click()
    await navigate(page,'stores','门店与时段')
    for(const label of ['门店资料','预约规则','临时安排']){
      await page.locator('.settings-tabs').getByRole('button',{name:label,exact:true}).click()
      await inspect(page,`${width}-store-${label}`)
    }
    await page.getByRole('combobox',{name:'门店范围',exact:true}).click()
    await page.getByRole('option',{name:'全部门店',exact:true}).click()
    await navigate(page,'content','品牌与内容')
    for(const label of ['首页与品牌','养护项目','品牌产品','空间相册']){
      await page.locator('.content-toolbar').getByRole('button',{name:label,exact:true}).click()
      await inspect(page,`${width}-content-${label}`)
    }
    for(const [id,module,button] of [['customers','客户档案','维护档案'],['therapists','调理师管理','新增调理师'],['users','用户管理','新建用户'],['roles','角色与权限','新建角色']]){
      await navigate(page,id,module)
      await page.getByRole('button',{name:button,exact:true}).first().click()
      await modalFits(page)
      const dialog=page.getByRole('dialog').last()
      assert.equal(await dialog.locator('input,textarea,.admin-select').evaluateAll(rows=>rows.filter(e=>{
        const r=e.getBoundingClientRect(),d=e.closest('.ant-modal-body').getBoundingClientRect()
        return r.width&&r.height&&(r.left<d.left-1||r.right>d.right+1)
      }).length),0,'Editor fields must fit inside the dialog')
      await page.screenshot({path:resolve(output,`${width}-edit-${id}.png`),animations:'disabled'})
      await page.locator('.ant-modal-close').click()
    }
    await navigate(page,'notifications','消息中心')
    await page.getByRole('button',{name:/客户消息推送/}).click()
    await inspect(page,`${width}-customer-notifications`)
    await context.close()
    console.log(`PASS ${width}: store/content tabs, customer/therapist/user/role editors and customer notifications`)
  }
  // Branch users retain their own navigation and store scope on phones and desktop.
  for(const width of [390,1366]){
    const context=await browser.newContext({viewport:{width,height:844}})
    await mockAdmin(context,false)
    const page=await context.newPage()
    page.on('pageerror',e=>errors.push(e.message))
    await page.goto(server.base+'/admin')
    await page.locator('.stat-card').first().waitFor()
    assert.equal(await page.locator('.ops-sidebar').getByRole('button',{name:'服务号菜单',exact:true}).count(),0)
    for(const [id,label] of menus){
      if(!await page.locator('.ops-sidebar').getByRole('button',{name:label,exact:true}).count())continue
      await navigate(page,id,label)
      await inspect(page,`${width}-branch-${id}`)
    }
    await context.close()
  }
  // Login uses natural scrolling on short screens, with every field still reachable.
  const loginContext=await browser.newContext()
  await loginContext.route('**/api/**',route=>route.fulfill({json:{developmentLogin:false}}))
  const loginPage=await loginContext.newPage()
  loginPage.on('pageerror',e=>errors.push(e.message))
  for(const [width,height] of [[360,640],[768,1024],[1366,768]]){
    await loginPage.setViewportSize({width,height})
    await loginPage.goto(server.base+'/admin')
    await loginPage.getByRole('button',{name:'登录管理后台',exact:true}).scrollIntoViewIfNeeded()
    assert(await loginPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await loginPage.screenshot({path:resolve(output,`${width}-login.png`),animations:'disabled'})
  }
  await loginContext.close()
  // New text arriving while the phone shows the list stays unread until reopened.
  const chatContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true})
  const chatState=await mockAdmin(chatContext)
  const chatPage=await chatContext.newPage()
  chatPage.on('pageerror',e=>errors.push(e.message))
  await chatPage.clock.install()
  await chatPage.goto(server.base+'/admin')
  await navigate(chatPage,'chats','客户沟通')
  const initialRead=chatPage.waitForResponse(r=>r.url().endsWith('/chat-1/read')&&r.request().postDataJSON()?.throughSeq===80)
  await chatPage.locator('.chat-list-item').first().click()
  await initialRead
  await chatPage.getByRole('button',{name:'返回会话列表',exact:true}).click()
  chatState.incoming.push({id:'new-unread-message',seq:81,direction:'IN',kind:'text',content:'隐藏聊天中的新消息',deliveryStatus:'RECEIVED',createdAt:new Date().toISOString()})
  await chatPage.clock.runFor(6500)
  await chatPage.getByText('隐藏聊天中的新消息',{exact:true}).waitFor({state:'attached'})
  assert.equal(chatState.reads.some(r=>r.throughSeq===81),false,'Hidden phone conversation must not consume unread messages')
  const reopenedRead=chatPage.waitForResponse(r=>r.url().endsWith('/chat-1/read')&&r.request().postDataJSON()?.throughSeq===81)
  await chatPage.locator('.chat-list-item').first().click()
  await reopenedRead
  for(const height of [640,500]){
    await chatPage.setViewportSize({width:390,height})
    await chatPage.waitForTimeout(350) // Settle media-query and Ant Design autoSize changes.
    const composer=await chatPage.locator('.chat-reply').boundingBox()
    assert(composer.y>=0&&composer.y+composer.height<=height,'Reply stays reachable as the phone viewport shrinks')
    assert((await chatPage.locator('.chat-messages').boundingBox()).height>=90,'Chat keeps a usable message area on short screens')
    assert(await chatPage.locator('.chat-messages').evaluate(e=>e.scrollHeight>e.clientHeight),'Long messages scroll independently')
    await inspect(chatPage,`390-chat-height-${height}`)
  }
  await chatPage.getByRole('button',{name:'结束对话',exact:true}).click()
  const endReply=await chatPage.locator('.chat-reply').boundingBox()
  assert(endReply.y+endReply.height<=500,'End-session confirmation keeps the reply area within a short phone viewport')
  await chatPage.getByRole('button',{name:'暂不结束',exact:true}).click()
  await chatPage.setViewportSize({width:390,height:844})
  await chatPage.getByRole('button',{name:'返回会话列表',exact:true}).click()
  const nextConversationRead=chatPage.waitForResponse(r=>r.url().endsWith('/chat-2/read')&&r.request().postDataJSON()?.throughSeq===80)
  await chatPage.locator('.chat-list-item').nth(1).click()
  await nextConversationRead
  assert.equal(chatState.reads.some(r=>r.path.endsWith('/chat-2/read')&&r.throughSeq===81),false,'Switching customers must not reuse the previous conversation cursor')
  await chatContext.close()
  // Store manager opening the exact appointment from a WeChat notification.
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true})
  await mockAdmin(context,false)
  const page=await context.newPage()
  await page.goto(server.base+'/admin?appointment=YHT-APPOINTMENT-2')
  await page.getByRole('dialog').waitFor()
  await modalFits(page)
  await page.getByRole('button',{name:'确认接待',exact:true}).click()
  await page.locator('.appointment-detail .detail-status').getByText('已确认').waitFor()
  await page.screenshot({path:resolve(output,'390-manager-wechat-deeplink.png'),animations:'disabled'})
  await context.close()
  assert.equal(writes.filter(w=>w.body.action==='confirm').length,4,'Phone reviews plus manager deep link each confirm once')
  assert.equal(writes.filter(w=>w.body.content).length,sizes.length,'Each composer submits exactly one message')
  assert.deepEqual(unknown,[],'Every API is a fixture')
  assert.deepEqual(errors,[],'No browser exceptions')
  passed=true
  console.log(JSON.stringify({status:'passed',viewports:sizes,screens:results.length,liveApisUsed:false,output},null,2))
}finally{
  await writeFile(resolve(output,'results.json'),JSON.stringify({status:passed?'passed':'failed',builtIndexSha256:buildSha256,viewports:sizes,results,errors,unknown,writes},null,2))
  await browser.close()
  await server.close()
}
