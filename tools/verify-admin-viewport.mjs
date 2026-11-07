import assert from 'node:assert/strict'
import {chromium} from 'playwright/test'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

// Layout verification only: real business writes are blocked; populated chat data is mocked.
const base=process.env.VIEWPORT_BASE||'http://127.0.0.1:5181'
const output=resolve(process.env.VIEWPORT_OUTPUT||'backups/admin-viewport-verification')
const compact=process.env.VIEWPORT_COMPACT==='1'
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true})
const results=[],errors=[],blocked=[]
const sizes=compact?[[2560,1440],[1366,768]]:[[2560,1440],[2048,1152],[1920,1080],[1536,864],[1366,768],[1280,720],[1024,768],[768,1024],[390,844]]
const menus=[['dashboard','工作台'],['appointments','预约管理'],['customers','客户档案'],['therapists','调理师管理'],['chats','客户沟通'],['stores','门店与时段'],['content','品牌与内容'],['assets','图片素材'],['users','用户管理'],['roles','角色与权限'],['notifications','消息中心'],['imports','资料导入'],['audit','操作日志'],['integrations','扩展与配置']]
async function measure(page,name,{chat=false,empty=false}={}){
  const result=await page.evaluate(name=>{
    const box=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,client:e.clientHeight,scroll:e.scrollHeight,top:e.scrollTop}}
    const scrollers=[...document.querySelectorAll('.operations *')].filter(e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight+2&&/auto|scroll/.test(getComputedStyle(e).overflowY)).map(e=>e.className)
    return {name,width:innerWidth,height:innerHeight,documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,main:box('.ops-main'),workspace:box('.chat-workspace'),list:box('.chat-list-scroll'),messages:box('.chat-messages'),reply:box('.chat-reply'),pager:box('.chat-pagination'),footer:box('.ops-footer'),scrollers}
  },name)
  results.push(result)
  assert(result.documentWidth<=result.width+1,`${name}: horizontal page overflow`)
  if(result.width>750){
    assert(result.documentHeight<=result.height+1,`${name}: document exceeds viewport`)
    assert(result.footer.y+result.footer.height<=result.height+1,`${name}: footer outside viewport`)
    if(chat){
      assert(result.main.scroll<=result.main.client+1,`${name}: chat causes main overflow`)
      assert(result.workspace.height>140,`${name}: conversation area collapsed`)
      assert(result.pager.y+result.pager.height<=result.main.y+result.main.height,`${name}: pagination outside work area`)
      assert(result.list.scroll<=result.list.client+1||!empty,`${name}: empty conversation list scrolls`)
      if(result.reply)assert(result.reply.y+result.reply.height<=result.main.y+result.main.height,`${name}: reply outside work area`)
    }
  }
  return result
}
async function navigate(page,id,label){
  await page.locator('.ops-sidebar').getByRole('button',{name:label,exact:true}).click()
  await page.locator(`.ops-main[data-page=${id}]`).waitFor()
  await page.waitForTimeout(160)
}
try{
  for(const username of ['bailemen','admin']){
    const context=await browser.newContext({viewport:{width:2560,height:1440}})
    const auth=await context.request.post(`${base}/api/admin/login`,{data:{username,password:process.env.VIEWPORT_PASSWORD||'Yht@9800dev'}})
    assert(auth.ok(),`Cannot sign in ${username}`)
    const {token}=await auth.json()
    await context.addInitScript(token=>sessionStorage.setItem('yht-admin-token',token),token)
    let mockChat=false
    const conversation=i=>({id:`layout-chat-${i}`,displayName:`布局验证客户 ${i}`,channel:'WECHAT',storeName:'布局验证门店',storeId:'bailemen',status:'OPEN',activeRoute:true,replyRemaining:5,replyDeadline:Math.floor(Date.now()/1000)+3600,lastSeq:100,lastPreview:'较长的会话摘要，用于验证内容增加时仅列表自身滚动。',updatedAt:new Date().toISOString(),unread:2})
    await context.route('**/api/**',async route=>{
      const request=route.request(),url=new URL(request.url())
      if(mockChat&&url.pathname==='/api/admin/chats')return route.fulfill({json:{items:Array.from({length:30},(_,i)=>conversation(i+1)),total:75,unreadTotal:60}})
      if(mockChat&&/^\/api\/admin\/chats\/layout-chat-\d+\/messages$/.test(url.pathname))return route.fulfill({json:{conversation:conversation(Number(url.pathname.split('/')[4].split('-').at(-1))),items:Array.from({length:100},(_,i)=>({id:`layout-message-${i}`,seq:i+1,direction:i%2?'OUT':'IN',content:`第 ${i+1} 条布局验证消息\n${'多行长消息内容，仅用于浏览器模拟验证。'.repeat(8)}`,senderName:'测试店长',deliveryStatus:i%2?'SENT':'RECEIVED',createdAt:new Date().toISOString(),kind:'text'}))}})
      if(mockChat&&/^\/api\/admin\/chats\/layout-chat-\d+\/read$/.test(url.pathname))return route.fulfill({json:{ok:true}})
      if(request.method()==='GET')return route.continue()
      blocked.push({method:request.method(),path:url.pathname});return route.abort()
    })
    const page=await context.newPage()
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto(`${base}/admin`)
    await page.locator('.stat-card').first().waitFor()
    const available=[]
    for(const menu of menus)if(await page.locator('.ops-sidebar').getByRole('button',{name:menu[1],exact:true}).count())available.push(menu)
    for(const [width,height] of sizes){
      await page.setViewportSize({width,height})
      for(const [id,label] of available){
        await navigate(page,id,label)
        await measure(page,`${username}-${width}x${height}-${id}`,{chat:id==='chats',empty:true})
        if(width===2560&&['chats','stores','content'].includes(id))await page.screenshot({path:resolve(output,`${username}-${id}-2k.png`)})
        if(id==='stores'&&username==='bailemen'){
          await page.locator('.settings-panel').waitFor()
          for(const [section,text] of [['rules','预约规则'],['overrides','临时安排'],['profile','门店资料']]){
            await page.locator('.settings-tabs').getByRole('button',{name:text,exact:true}).click()
            await page.locator(`.settings-panel[data-section=${section}]`).waitFor()
            await measure(page,`${username}-${width}x${height}-stores-${section}`)
          }
        }
        // The main scroller must return to the top after module navigation.
        if(width>750)await page.locator('.ops-main').evaluate(e=>{e.scrollTop=e.scrollHeight})
      }
    }
    // Verify that switching modules resets the independent main scroll area.
    await page.setViewportSize({width:1366,height:768})
    await navigate(page,'assets','图片素材')
    await page.locator('.ops-main').evaluate(e=>{e.scrollTop=e.scrollHeight})
    await navigate(page,'stores','门店与时段')
    assert.equal(await page.locator('.ops-main').evaluate(e=>e.scrollTop),0,'Module switch retained old scroll offset')
    if(username==='admin'){
      await page.getByRole('combobox',{name:'门店范围',exact:true}).selectOption({label:'百乐门店'})
      await page.locator('.settings-panel').waitFor()
      await measure(page,'admin-specific-store')
      await navigate(page,'content','品牌与内容')
      await page.getByRole('combobox',{name:'门店范围',exact:true}).selectOption('')
      await page.locator('.content-section-tabs').waitFor()
      for(const name of ['品牌信息','首页封面','区块排序','客服信息']){
        await page.locator('.content-section-tabs').getByRole('button',{name,exact:true}).click()
        await measure(page,`admin-content-${name}`)
      }
    }
    mockChat=true
    await navigate(page,'chats','客户沟通')
    await page.getByRole('button',{name:'刷新会话',exact:true}).click()
    await page.locator('.chat-list-item').first().waitFor()
    await page.locator('.chat-list-item').first().click()
    await page.locator('.chat-bubble').first().waitFor()
    for(const [width,height] of sizes.filter(([w])=>w>750)){
      await page.setViewportSize({width,height})
      await page.waitForTimeout(60)
      const m=await measure(page,`${username}-${width}x${height}-populated-chat`,{chat:true})
      assert(m.list.scroll>m.list.client,'Populated conversation list should scroll')
      assert(m.messages.scroll>m.messages.client,'Populated messages should scroll')
      await page.locator('.chat-messages').evaluate(e=>{e.scrollTop=0})
      assert.equal(await page.locator('.ops-main').evaluate(e=>e.scrollTop),0,'Message scrolling moved main work area')
      if(width===1366)await page.screenshot({path:resolve(output,`${username}-populated-chat-laptop.png`)})
    }
    await context.close()
  }
  assert.equal(errors.length,0,`Browser errors: ${errors.join('; ')}`)
  assert.equal(blocked.length,0,`Unexpected real write requests: ${JSON.stringify(blocked)}`)
  console.log(JSON.stringify({base,checks:results.length,browserErrors:errors.length,businessWrites:blocked.length,output}))
}finally{
  await writeFile(resolve(output,'results.json'),JSON.stringify({base,results,errors,blocked},null,2))
  await browser.close()
}
