import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'

// Taro H5 is the same message component as weapp. Every API/media request is a fixture.
const origin='http://127.0.0.1:5182',api='https://mp-admin.hetuonian.cn'
const mini=resolve('../yuhetang-miniprogram'),dist=resolve(mini,'dist/h5'),output=resolve('backups/chat-client-attachments')
await mkdir(output,{recursive:true})
const jpeg=await readFile(resolve(mini,'src/assets/login/reception.jpg')),mp4=await readFile(resolve('backups/chat-attachments/store.mp4'))
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[],unknown=[]
let passed=false
try{
  for(const [width,height] of [[390,844],[360,640]]){
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true})
    await context.addInitScript(()=>{
      localStorage.setItem('yht-session-context',JSON.stringify({data:'https://mp-admin.hetuonian.cn|wechat'}))
      localStorage.setItem('yht-token',JSON.stringify({data:'chat-attachment-fixture'}))
      localStorage.setItem('yht-login-consent',JSON.stringify({data:JSON.stringify({version:'2026-11-08'})}))
    })
    const now=new Date().toISOString(),messages=[
      {id:'picture',seq:1,direction:'OUT',kind:'image',content:'[图片] 门店介绍.jpg',senderName:'门店客服',createdAt:now,attachment:{kind:'image',name:'门店介绍.jpg',size:jpeg.length,url:'/api/chat-media/picture/file?ticket=fixture'}},
      {id:'video',seq:2,direction:'OUT',kind:'video',content:'[视频] 门店介绍.mp4',senderName:'门店客服',createdAt:now,attachment:{kind:'video',name:'门店介绍.mp4',size:mp4.length,url:'/api/chat-media/video/file?ticket=fixture',thumbnailUrl:'/api/chat-media/picture/thumbnail?ticket=fixture'}}
    ]
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url()),path=url.pathname
      const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'}
      if(url.origin===api){
        if(req.method()==='OPTIONS')return route.fulfill({status:204,headers})
        if(path.startsWith('/api/chat-media/'))return route.fulfill({headers,contentType:path.includes('/video/')?'video/mp4':'image/jpeg',body:path.includes('/video/')?mp4:jpeg})
        const json=data=>route.fulfill({headers,json:data})
        if(path==='/api/site')return json({brandName:'裕和堂',brandEnglish:'YU Health',theme:'sage',hero:{},contact:{phone:'021-50000000'},stores:[{id:'fixture-store',name:'上海中心店',enabled:true}],services:[],sections:[],products:[],galleryGroups:[]})
        assert.equal(req.headers().authorization,'Bearer chat-attachment-fixture')
        if(path==='/api/me/profile')return json({name:'附件测试客户',phone:'13900000001',phoneVerified:true,complete:true,memberVerified:false,sources:['MINIPROGRAM']})
        if(path==='/api/me/chats'&&req.method()==='POST')return json({id:'fixture',status:'ACTIVE',assignedAdminName:'门店客服'})
        if(path==='/api/me/chats/fixture/messages'&&req.method()==='GET')return json({conversation:{id:'fixture',status:'ACTIVE',assignedAdminName:'门店客服'},items:messages.filter(item=>item.seq>Number(url.searchParams.get('after')||0))})
        unknown.push(req.method()+' '+path);return route.fulfill({status:404,headers,json:{message:'Unmocked request blocked'}})
      }
      if(url.origin!==origin){unknown.push(url.origin+path);return route.abort()}
      const file=resolve(dist,'.'+path);assert(file===dist||file.startsWith(dist+sep))
      const target=extname(file)?file:resolve(dist,'index.html')
      return route.fulfill({contentType:{'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml'}[extname(target)]||'application/octet-stream',body:await readFile(target)})
    })
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(origin+'/#/pages/chat/index?storeId=fixture-store')
    await page.locator('.chat-attachment-image').waitFor()
    const picture=page.locator('.chat-attachment-image img')
    await picture.evaluate(image=>image.decode())
    assert((await picture.getAttribute('src')).startsWith(api+'/api/chat-media/'))
    const routeBefore=page.url();await page.locator('.chat-attachment-image').click();await page.locator('.preview-image').waitFor()
    await page.locator('.preview-image').click({position:{x:8,y:8}});await page.locator('.preview-image').waitFor({state:'detached'})
    assert.equal(page.url(),routeBefore,'Closing an image preview keeps the chat page')
    const video=page.locator('.chat-attachment-video video');await video.waitFor()
    assert(await video.evaluate(async element=>{await element.play();await new Promise(resolve=>setTimeout(resolve,100));const playing=!element.paused&&element.readyState>=2;element.pause();return playing}),'The actual MP4 plays inside the conversation')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:resolve(output,`${width}-client-media.png`),animations:'disabled'})
    checks.push(`${width}x${height}: image decoded, full screen preview returns to chat, MP4 plays, no horizontal overflow`)
    await context.close()
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);passed=true
  console.log(JSON.stringify({status:'passed',checks,liveApisUsed:false,realMessagesSent:false,output},null,2))
}finally{
  await writeFile(resolve(output,'result.json'),JSON.stringify({status:passed?'passed':'failed',checks,errors,unknown,liveApisUsed:false,realMessagesSent:false},null,2))
  await browser.close()
}
