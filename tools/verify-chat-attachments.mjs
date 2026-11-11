import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {chromium} from 'playwright'
import {serveAdmin,mockAdmin,unknown} from './admin-responsive-fixtures.mjs'

// All API calls and media files are local fixtures; no WeChat/customer message is sent.
const output=resolve('backups/chat-attachments');await mkdir(output,{recursive:true})
const builtIndexSha256=createHash('sha256').update(await readFile('dist/index.html')).digest('hex')
const server=await serveAdmin(),browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[]
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')
let passed=false
try{
  for(const [width,height] of [[1366,768],[768,1024],[390,844],[360,560],[390,500]]){
    const context=await browser.newContext({viewport:{width,height}});await mockAdmin(context)
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    const messages=[{id:'text-1',seq:1,direction:'IN',kind:'text',content:'请发一下门店图片和介绍视频。',senderName:'示例客户',deliveryStatus:'RECEIVED',createdAt:new Date().toISOString()}]
    let uploads=0,fail=false,video=Buffer.alloc(0)
    await context.route('**/api/chat-media/**',route=>route.fulfill({contentType:route.request().url().includes('/video/')?'video/mp4':'image/png',body:route.request().url().includes('/video/')?video:png}))
    await context.route('**/api/admin/chats/*/messages*',async route=>{
      const url=new URL(route.request().url()),id=url.pathname.split('/')[4]
      assert.equal(route.request().method(),'GET')
      return route.fulfill({json:{conversation:{id,channel:'WECHAT',displayName:'示例客户',storeName:'百乐门店',status:'ACTIVE',assignedAdminId:'hq-user',assignedAdminName:'总部管理员',canReply:true,canEnd:true,canRelease:true,activeRoute:true,replyRemaining:5,replyDeadline:Math.floor(Date.now()/1000)+3600},items:messages.filter(message=>message.seq>Number(url.searchParams.get('after')||0))}})
    })
    await context.route('**/api/admin/chats/*/attachments',async route=>{
      uploads++;assert.equal(route.request().method(),'POST')
      const body=route.request().postDataBuffer();assert(body.includes(Buffer.from('name="clientKey"')));assert(body.includes(Buffer.from('name="file"')))
      if(fail)return route.fulfill({status:422,json:{message:'测试：上传失败，请重试。'}})
      const isVideo=body.includes(Buffer.from('filename="store.mp4"')),id=isVideo?'video':'picture'
      if(isVideo)assert(body.includes(Buffer.from('name="thumbnail"')),'A readable video supplies its generated JPEG cover')
      const message={id,seq:messages.length+1,direction:'OUT',kind:isVideo?'video':'image',content:isVideo?'[视频] store.mp4':'[图片] store.png',deliveryStatus:'SENT',senderName:'总部管理员',createdAt:new Date().toISOString(),attachment:{name:isVideo?'store.mp4':'store.png',size:isVideo?video.length:png.length,url:`/api/chat-media/${id}/file?ticket=fixture`,...(isVideo?{thumbnailUrl:'/api/chat-media/picture/thumbnail?ticket=fixture'}:{})}}
      messages.push(message);return route.fulfill({json:message})
    })
    await page.goto(server.base+'/admin')
    await page.locator('.ops-topbar').waitFor()
    if(await page.getByRole('button',{name:'打开管理导航',exact:true}).isVisible()){await page.getByRole('button',{name:'打开管理导航',exact:true}).click();await page.locator('.ops-mobile-navigation').getByRole('button',{name:'客户沟通',exact:true}).click();await page.locator('.ops-mobile-navigation').waitFor({state:'hidden'})}
    else await page.locator('.ops-sidebar').getByRole('button',{name:'客户沟通',exact:true}).click()
    await page.locator('.chat-list-item').first().click();await page.getByRole('textbox',{name:'回复消息',exact:true}).waitFor()
    await page.getByLabel('选择图片附件',{exact:true}).setInputFiles({name:'store.png',mimeType:'image/png',buffer:png})
    const draft=page.getByRole('group',{name:'待发送附件',exact:true});await draft.waitFor()
    assert.equal(uploads,0,'Selecting an attachment does not send before confirmation')
    await page.getByRole('button',{name:'移除附件',exact:true}).click();assert.equal(await draft.count(),0)
    await page.getByLabel('选择图片附件',{exact:true}).setInputFiles({name:'store.png',mimeType:'image/png',buffer:png})
    fail=true;await page.getByRole('button',{name:'发送',exact:true}).click();await page.getByText('测试：上传失败，请重试。',{exact:true}).waitFor()
    assert(await draft.isVisible(),'Failed uploads keep the selection for retry')
    fail=false;await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.chat-message-media.image').waitFor()
    assert.equal(await draft.count(),0);assert.equal(uploads,2)
    await page.locator('.chat-message-media.image img').click();await page.locator('.ant-image-preview').waitFor();await page.keyboard.press('Escape')
    await page.locator('.ant-image-preview').waitFor({state:'hidden'})
    if(width===1366){
      video=Buffer.from(await page.evaluate(async()=>{
        const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180
        const ctx=canvas.getContext('2d');ctx.fillStyle='#435e4b';ctx.fillRect(0,0,320,180)
        const stream=canvas.captureStream(10),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/mp4'})
        const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=async()=>resolve([...new Uint8Array(await new Blob(chunks).arrayBuffer())])})
        recorder.start();const draw=setInterval(()=>{ctx.fillStyle='#435e4b';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.fillText(String(Date.now()),24,90)},40)
        await new Promise(resolve=>setTimeout(resolve,800));clearInterval(draw);recorder.stop();const bytes=await done;stream.getTracks().forEach(track=>track.stop());return bytes
      }))
      assert(video.length>0,'The browser recorded an actual playable MP4 fixture');await writeFile(resolve(output,'store.mp4'),video)
      await page.getByLabel('选择视频附件',{exact:true}).setInputFiles({name:'store.mp4',mimeType:'video/mp4',buffer:video})
      await draft.waitFor();await page.getByRole('button',{name:'发送',exact:true}).click();await page.locator('.chat-message-media.video video').waitFor()
      assert.equal(await page.locator('.chat-message-media.video video').getAttribute('controls'),'')
      checks.push('MP4 selection generates a JPEG cover and sends an attachment without unsupported native video claims')
    }
    const before=uploads
    await page.getByLabel('选择视频附件',{exact:true}).setInputFiles({name:'large.mp4',mimeType:'video/mp4',buffer:Buffer.alloc(10*1024*1024+1)})
    await page.getByText('视频不能超过10MB，请压缩后发送。',{exact:true}).waitFor();assert.equal(uploads,before)
    const bounds=await page.getByRole('button',{name:'发送',exact:true}).boundingBox(),thread=await page.locator('.chat-thread').boundingBox()
    await page.screenshot({path:resolve(output,`${width}-${height}-layout.png`),animations:'disabled'})
    if(bounds.y+bounds.height>Math.min(height,thread.y+thread.height)+1)console.log(JSON.stringify(await page.locator('.chat-thread').evaluate(element=>({height:element.getBoundingClientRect().height,children:[...element.children].map(child=>({class:child.className,height:child.getBoundingClientRect().height,flex:getComputedStyle(child).flex,min:getComputedStyle(child).minHeight}))}))))
    assert(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=Math.min(height,thread.y+thread.height)+1,'Attachment actions stay within the phone/desktop viewport')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    await page.screenshot({path:resolve(output,`${width}-chat-attachments.png`),animations:'disabled'})
    checks.push(`${width}x${height}: preview/remove/retry/image zoom/file limits/visible send action`)
    await context.close()
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[]);passed=true
  console.log(JSON.stringify({status:'passed',checks,liveApisUsed:false,output},null,2))
}finally{
  await writeFile(resolve(output,'result.json'),JSON.stringify({status:passed?'passed':'failed',builtIndexSha256,checks,errors,liveApisUsed:false},null,2))
  await browser.close();await server.close()
}
