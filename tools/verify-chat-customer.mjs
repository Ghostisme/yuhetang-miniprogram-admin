import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'

// Integration QA for the independent Taro H5 build. Every API is a fixture; no real messages.
const origin='http://127.0.0.1:5182',apiOrigin='https://mp-admin.hetuonian.cn'
const dist=resolve(process.env.CHAT_CUSTOMER_DIST||'../yuhetang-miniprogram/dist/h5')
const output=resolve('backups/chat-customer-verification');await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true})
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
const now=new Date().toISOString(),checks=[],errors=[],unknown=[],sends=[]
const sessions={history:{id:'history',status:'RESOLVED',endedAt:now},current:{id:'current',status:'OPEN'}}
const history=[{id:'old-message',seq:1,direction:'IN',content:'上一次咨询的历史消息',senderName:'客户',createdAt:now}]
const current=[];let live='history',restarts=0,failFirst=true
await context.addInitScript(()=>{
  localStorage.setItem('yht-session-context',JSON.stringify({data:'https://mp-admin.hetuonian.cn|wechat'}))
  localStorage.setItem('yht-token',JSON.stringify({data:'fixture-customer-token'}))
  localStorage.setItem('yht-login-consent',JSON.stringify({data:JSON.stringify({version:'2026-11-08'})}))
})
await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url())
  if(url.pathname.startsWith('/api/')&&url.origin===apiOrigin){
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}
    const json=(data,status=200)=>route.fulfill({status,headers,json:data})
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers})
    if(url.pathname==='/api/site')return json({brandName:'裕和堂',brandEnglish:'YU Health',theme:'sage',hero:{},contact:{phone:'021-50000000'},stores:[{id:'fixture-store',name:'上海中心店',enabled:true}],services:[],sections:[],products:[],galleryGroups:[]})
    assert.equal(req.headers().authorization,'Bearer fixture-customer-token')
    if(url.pathname==='/api/me/chats'&&req.method()==='POST')return json(sessions[live])
    const thread=url.pathname.match(/^\/api\/me\/chats\/(history|current)\/messages$/)
    if(thread){
      const id=thread[1],items=id==='history'?history:current
      if(req.method()==='GET')return json({conversation:sessions[id],items:items.filter(m=>m.seq>Number(url.searchParams.get('after')||0))})
      assert.equal(id,'current','Ended history must never receive a new message');assert.notEqual(sessions[id].status,'RESOLVED')
      const body=req.postDataJSON();sends.push(body);const m={id:'new-'+sends.length,seq:sends.length+1,direction:'IN',content:body.content,senderName:'客户',createdAt:now};items.push(m);return json(m)
    }
    if(url.pathname==='/api/me/chats/history/restart'&&req.method()==='POST'){
      restarts++;if(failFirst){failFirst=false;return json({message:'测试：新咨询暂未建立，请重试。'},409)}
      live='current';return json(sessions.current)
    }
    unknown.push(`${req.method()} ${url.pathname}`);return json({message:'Unmocked request blocked'},404)
  }
  if(url.origin!==origin){unknown.push(req.url());return route.abort()}
  const path=resolve(dist,'.'+url.pathname);assert(path===dist||path.startsWith(dist+sep))
  const file=extname(path)?path:resolve(dist,'index.html')
  return route.fulfill({contentType:{'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png'}[extname(file)]||'application/octet-stream',body:await readFile(file)})
})
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
try{
  await page.goto(origin+'/#/pages/chat/index?storeId=fixture-store')
  await page.getByText('本次咨询已结束，聊天记录已保留。',{exact:true}).waitFor()
  await page.getByText('上一次咨询的历史消息',{exact:true}).waitFor()
  assert.equal(await page.locator('.chat-compose').count(),0)
  await page.screenshot({path:resolve(output,'customer-ended.png'),fullPage:true})
  checks.push('Ended session shows preserved history and a new-consultation action instead of a composer')
  await page.getByText('发起新咨询',{exact:true}).click()
  await page.getByText('测试：新咨询暂未建立，请重试。',{exact:false}).waitFor()
  assert.equal(await page.locator('.chat-compose').count(),0);assert.equal(live,'history')
  checks.push('Failed restart retains the ended state and does not send customer text')
  await page.getByText('发起新咨询',{exact:true}).click()
  const composer=page.locator('.chat-compose textarea');await composer.waitFor()
  await page.getByText('等待门店接入，您可以先留下问题。',{exact:true}).waitFor()
  assert.equal(await page.getByText('上一次咨询的历史消息',{exact:true}).count(),0)
  await composer.fill('这是一次新的咨询');await page.getByText('发送',{exact:true}).click()
  await page.getByText('这是一次新的咨询',{exact:true}).waitFor()
  assert.equal(sends.length,1);assert.equal(restarts,2);assert(sends[0].clientKey)
  checks.push('Explicit restart creates a fresh conversation; one send uses only its new ID')
  sessions.current={...sessions.current,status:'ACTIVE',assignedAdminName:'门店接待员'}
  await page.getByText('门店接待员正在为您接待',{exact:true}).waitFor({timeout:12000})
  sessions.current={...sessions.current,status:'RESOLVED',endedAt:now}
  await page.getByText('本次咨询已结束，聊天记录已保留。',{exact:true}).waitFor({timeout:12000})
  assert.equal(await page.locator('.chat-compose').count(),0)
  assert.equal(await page.getByText('这是一次新的咨询',{exact:true}).count(),1)
  checks.push('Polling updates the reception name and locks the composer when the agent ends the conversation')
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  await writeFile(resolve(output,'result.json'),JSON.stringify({status:'passed',checks,errors,liveApisUsed:false,realMessagesSent:false},null,2))
  console.log(JSON.stringify({status:'passed',cases:checks.length,output},null,2))
}catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});console.error(await page.locator('body').innerText());throw error}finally{await browser.close()}
