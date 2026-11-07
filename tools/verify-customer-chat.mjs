import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

// Every API request is answered in-browser. No business database or WeChat API is contacted.
const base=process.env.CHAT_VERIFY_BASE||'http://127.0.0.1:5181'
const output=resolve('backups/customer-chat-verification')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true})
const checks=[],errors=[],requests=[]
const now=new Date().toISOString()
const conversation=i=>({id:`fixture-${i}`,displayName:`测试客户${i}`,channel:'WECHAT',storeId:'bailemen',storeName:'百乐门店',status:i===1?'RESOLVED':'OPEN',activeRoute:true,replyRemaining:5,replyDeadline:Math.floor(Date.now()/1000)+172800,lastSeq:100,lastPreview:`客户咨询内容${i}`,updatedAt:now,unread:i===1?2:0})
const message=i=>({id:`message-${i}`,seq:i,direction:i%2?'IN':'OUT',kind:'text',content:`测试聊天内容${i}`,senderName:'测试店长',deliveryStatus:i%2?'RECEIVED':'SENT',createdAt:now})
const context=await browser.newContext({viewport:{width:2560,height:1440}})
await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','fixture-browser-token'))
let failList=false,sendCount=0
await context.route('**/api/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method()
  requests.push({path,search:url.search,method})
  const json=data=>route.fulfill({json:data})
  if(path==='/api/runtime')return json({developmentLogin:false})
  if(path==='/api/admin/me')return json({id:'fixture-admin',name:'测试总部',hq:true,storeId:'',permissions:['dashboard:read','chat:read','chat:reply','chat:route']})
  if(path==='/api/admin/stores')return json([{id:'yuyao',name:'余姚门店',enabled:true},{id:'bailemen',name:'百乐门店',enabled:true}])
  if(path==='/api/admin/dashboard')return json({counts:[],trend:[],sources:[],recent:[]})
  if(path==='/api/admin/chats'){
    if(failList&&url.search)return route.fulfill({status:502,json:{message:'测试：会话服务暂不可用'}})
    let items=Array.from({length:35},(_,i)=>conversation(i+1))
    if(url.searchParams.get('storeId'))items=items.filter(c=>c.storeId===url.searchParams.get('storeId'))
    if(url.searchParams.get('status'))items=items.filter(c=>c.status===url.searchParams.get('status'))
    const q=url.searchParams.get('q');if(q)items=items.filter(c=>c.displayName.includes(q))
    const total=items.length,page=Math.max(1,Math.min(Number(url.searchParams.get('page'))||1,Math.ceil(total/30)||1))
    return json({items:items.slice((page-1)*30,page*30),page,total,pageSize:30,unreadTotal:items.reduce((n,c)=>n+c.unread,0)})
  }
  if(/^\/api\/admin\/chats\/fixture-\d+\/messages$/.test(path)){
    if(method==='POST'){
      sendCount++
      return json({...message(101),id:'failed-send',direction:'OUT',content:request.postDataJSON().content,deliveryStatus:'FAILED',errorMessage:'消息尚未提交微信：微信错误码 40164：服务器出口 IP 不在微信 IP 白名单。'})
    }
    return json({conversation:conversation(Number(path.split('/')[4].split('-')[1])),items:Number(url.searchParams.get('after'))?[]:Array.from({length:100},(_,i)=>message(i+1))})
  }
  if(/^\/api\/admin\/chats\/fixture-\d+\/read$/.test(path)&&method==='PATCH')return json({ok:true})
  errors.push(`Unexpected mocked request: ${method} ${path}`)
  return route.fulfill({status:500,json:{message:'Unexpected fixture route'}})
})
const page=await context.newPage()
page.on('pageerror',error=>errors.push(error.message))
async function option(label,text){await page.getByLabel(label,{exact:true}).click();await page.getByRole('option',{name:text,exact:true}).click()}
async function openChats(){await page.locator('.ops-sidebar').getByRole('button',{name:'客户沟通',exact:true}).click();await page.locator('.chat-list-item').first().waitFor()}
async function layout(width,height){
  await page.setViewportSize({width,height})
  await page.locator('.chat-thread header').waitFor()
  const result=await page.evaluate(()=>{
    const box=selector=>{const el=document.querySelector(selector),rect=el.getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,scroll:el.scrollHeight,client:el.clientHeight}}
    return {width:innerWidth,height:innerHeight,documentHeight:document.documentElement.scrollHeight,documentWidth:document.documentElement.scrollWidth,main:box('.ops-main'),list:box('.chat-list-scroll'),first:box('.chat-list-item'),messages:box('.chat-messages'),reply:box('.chat-reply'),pager:box('.chat-pagination')}
  })
  assert(result.documentHeight<=height+1&&result.documentWidth<=width+1,`Page overflows ${width}x${height}`)
  assert(result.main.scroll<=result.main.client+1,'Chat page must not add an outer scrollbar')
  assert(result.first.height>65&&result.first.top<result.list.bottom,'Conversation rows must be visible')
  assert(result.reply.bottom<=height&&result.pager.bottom<=height,'Reply and pagination must stay on screen')
  assert(result.list.scroll>result.list.client&&result.messages.scroll>result.messages.client,'Long lists and history must scroll within their panes')
  checks.push({case:'responsive populated chat',...result})
  await page.screenshot({path:resolve(output,`chat-${width}x${height}.png`),fullPage:true})
}
try{
  await page.goto(`${base}/admin`)
  await page.locator('.stat-card').first().waitFor()
  await option('门店范围','余姚门店')
  await openChats()
  assert.match(await page.locator('.chat-list-item').first().innerText(),/测试客户1/)
  await page.locator('.chat-thread header').getByText('测试客户1 · 百乐门店',{exact:true}).waitFor()
  assert.match(await page.locator('.chat-filters').innerText(),/全部状态/)
  assert.match(await page.locator('.chat-filters').innerText(),/全部门店/)
  checks.push({case:'HQ entry clears unrelated store filter; resolved unread conversation opens automatically'})
  await layout(2560,1440);await layout(1366,768)

  await page.getByLabel('回复消息',{exact:true}).fill('验证明确的微信凭证失败')
  await page.locator('.chat-reply').getByRole('button',{name:'发送',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'40164'}).waitFor()
  assert.match(await page.locator('.chat-bubble').last().innerText(),/40164/)
  assert.equal(sendCount,1,'A failed send must not be retried automatically')
  checks.push({case:'Failed send remains in history with actionable provider code; no automatic resend'})

  await page.getByRole('button',{name:'下一页',exact:true}).click()
  await page.locator('.chat-list-item').first().filter({hasText:'测试客户31'}).waitFor()
  await page.getByLabel('搜索客户会话',{exact:true}).fill('测试客户35')
  await page.getByLabel('搜索客户会话',{exact:true}).press('Enter')
  await page.locator('.chat-list-item').first().filter({hasText:'测试客户35'}).waitFor()
  assert.match(await page.locator('.chat-pagination').innerText(),/1\s*\/\s*1/)
  checks.push({case:'Filtering from a later page returns visible results and correct pagination'})

  await option('客服门店范围','余姚门店')
  await page.getByText('当前筛选范围内暂无会话，可切换门店或清除筛选。',{exact:true}).waitFor()
  await page.getByLabel('站内消息',{exact:true}).click()
  await page.locator('.chat-inbox-link').click()
  await page.locator('.chat-list-item').first().filter({hasText:'测试客户1'}).waitFor()
  assert.equal(await page.getByLabel('搜索客户会话',{exact:true}).inputValue(),'')
  checks.push({case:'Unread notification clears stale search, status and store filters'})

  failList=true
  await page.getByLabel('刷新会话',{exact:true}).click()
  await page.getByRole('alert').filter({hasText:'会话列表加载失败'}).waitFor()
  assert(await page.locator('.chat-list-item').count()>0,'Keep already-loaded conversations when refresh fails')
  failList=false
  await page.getByRole('button',{name:'重新加载会话',exact:true}).click()
  await page.locator('.chat-list-error').waitFor({state:'hidden'})
  checks.push({case:'List failures are explicit, preserve loaded rows, and recover on retry'})

  failList=true
  await page.reload()
  await page.locator('.stat-card').first().waitFor()
  await page.locator('.ops-sidebar').getByRole('button',{name:'客户沟通',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'会话列表加载失败'}).waitFor()
  assert.equal(await page.locator('.chat-list-item').count(),0)
  await page.getByText('暂时无法读取会话，请重新加载。',{exact:true}).waitFor()
  failList=false
  await page.getByRole('button',{name:'重新加载会话',exact:true}).click()
  await page.locator('.chat-list-item').first().waitFor()
  checks.push({case:'First-load failures show an error alongside the badge and recover without relogin'})
  assert.deepEqual(errors,[])
  await writeFile(resolve(output,'result.json'),JSON.stringify({status:'passed',liveApisUsed:false,sendCount,checks,errors,requestCount:requests.length},null,2))
  console.log(JSON.stringify({status:'passed',cases:checks.length,sendCount,output},null,2))
}finally{await browser.close()}
