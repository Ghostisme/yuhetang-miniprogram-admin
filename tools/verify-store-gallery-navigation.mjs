import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'

// Both applications use fixture HTTP responses only. No cloud data is written.
const adminOrigin=process.env.GALLERY_ADMIN_ORIGIN||'http://127.0.0.1:5181'
const miniOrigin=process.env.GALLERY_MINI_ORIGIN||'http://127.0.0.1:5183'
const output='backups/store-gallery-navigation'
await mkdir(output,{recursive:true})
const checks=[],errors=[],unknown=[],saves=[]
const image=await readFile('public/media/store-02.webp')
const services=[{id:'care-1',name:'经络调养',category:'东方养护',duration:'60分钟',image:'/media/ritual.webp',enabled:true,subtitle:'舒缓疲劳，照顾日常',description:'根据到店沟通安排适合的养护服务。',steps:['到店沟通','细致养护']}]
const stores=[{id:'shanghai',name:'上海中心店',district:'浦东新区',image:'/media/store-02.webp',address:'浦东新区花园石桥路158号',hours:'9:00—23:00',phone:'021-50181919',description:'在城市里留一段从容时光。',tag:'东方养护',enabled:true,onlineBooking:true,gallery:['/media/store-02.webp'],services},
  {id:'bailemen',name:'百乐门店',district:'静安区',image:'/media/store-07.webp',address:'上海市静安区',hours:'10:00—22:00',phone:'021-00000000',description:'用心关照每一次到来。',tag:'东方养护',enabled:true,onlineBooking:false,gallery:['/media/store-07.webp'],services:[]}]
const site={version:1,brandName:'裕和堂',brandEnglish:'YU Health',theme:'sage',tagline:'自在有和',hero:{image:'/media/store-02.webp',title:'从容时光',button:'了解门店'},brandStory:'东方养护',contact:{phone:'021-00000000',message:'欢迎咨询'},stores,services,products:[],sections:[],galleryGroups:[{id:'space',name:'门店空间',images:['/media/store-02.webp']}],customerServiceEnabled:true}
const assets=[{id:'one',title:'门店茶室',url:'/media/store-02.webp'},{id:'two',title:'门店环境',url:'/media/store-07.webp'},{id:'three',title:'养护空间',url:'/media/ritual.webp'}]
const browser=await chromium.launch({channel:'msedge',headless:true})
async function fixture(context,{readonly=false}={}){
  await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','fixture-only'))
  await context.route(/\/(?:media|uploads)\//,route=>route.fulfill({contentType:'image/webp',body:image}))
  await context.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),json=data=>route.fulfill({json:data})
    if(method==='GET'){
      if(path==='/api/site'||path==='/api/admin/content')return json(site)
      if(path==='/api/runtime')return json({developmentLogin:false})
      if(path==='/api/admin/me')return json({id:'fixture-hq',name:'总部管理员',hq:true,storeId:'',roleIds:[],permissions:readonly?['content:read','assets:read']:['stores:write','content:read','content:write','assets:read']})
      if(path==='/api/admin/stores')return json(stores)
      if(path==='/api/admin/assets')return json(assets)
    }
    if(method==='PUT'&&path==='/api/admin/stores/shanghai'){
      const body=req.postDataJSON();saves.push(body);Object.assign(stores[0],body);return json(stores[0])
    }
    if(method==='PUT'&&path==='/api/admin/content/draft'){
      Object.assign(site,req.postDataJSON());site.version++;return json(site)
    }
    unknown.push(`${method} ${path}`);return route.fulfill({status:404,json:{message:'Unmocked API blocked'}})
  })
}
function watch(page){page.on('pageerror',e=>errors.push(e.message))}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}
try{
  const context=await browser.newContext({viewport:{width:2560,height:1440}});await fixture(context)
  const admin=await context.newPage();watch(admin);await admin.goto(adminOrigin+'/admin')
  await admin.getByRole('button',{name:'管理上海中心店',exact:true}).click()
  await admin.getByRole('button',{name:'添加图片',exact:true}).click()
  const rowPath=index=>admin.getByRole('textbox',{name:`门店相册路径（一行一张）第 ${index} 张图片路径`,exact:true})
  await rowPath(2).fill('/media/store-07.webp');await rowPath(2).press('Enter')
  assert.equal(await admin.locator('.image-path-row').count(),3)
  assert(await rowPath(3).evaluate(input=>input===document.activeElement),'A newly added row should receive focus')
  await admin.getByRole('button',{name:'移除第 3 张图片',exact:true}).click()
  await admin.getByRole('button',{name:'在第 1 张图片后添加',exact:true}).click()
  assert.equal(await rowPath(3).inputValue(),'/media/store-07.webp')
  await rowPath(2).fill('/media/ritual.webp')
  await admin.getByRole('button',{name:'移除第 2 张图片',exact:true}).click()
  checks.push('Plus/minus controls insert and remove independent image rows; Enter adds and focuses the next row')
  await admin.getByRole('button',{name:'多行粘贴',exact:true}).click()
  const paths=admin.getByRole('textbox',{name:'门店相册路径（一行一张）',exact:true})
  await paths.fill('/media/store-02.webp')
  await paths.click();await paths.press('Control+End');await paths.press('Enter')
  assert.equal(await paths.inputValue(),'/media/store-02.webp\n','Enter must preserve a blank new line')
  await paths.pressSequentially('/media/store-07.webp');await paths.press('Enter');await paths.press('Enter')
  assert.equal(await paths.inputValue(),'/media/store-02.webp\n/media/store-07.webp\n\n')
  checks.push('Album Enter and consecutive blank lines survive controlled rerenders')
  await admin.getByRole('button',{name:'从素材库添加',exact:true}).click()
  const dialog=admin.getByRole('dialog',{name:'从素材库添加图片',exact:true})
  assert(await dialog.getByRole('checkbox',{name:'门店茶室',exact:true}).isDisabled())
  await dialog.getByRole('checkbox',{name:'养护空间',exact:true}).click()
  await dialog.getByRole('button',{name:'添加所选图片（1）',exact:true}).click()
  assert.equal(await admin.locator('.image-path-row').count(),3)
  await admin.getByRole('button',{name:'上移第 3 张图片',exact:true}).click()
  await admin.getByRole('button',{name:'移除第 1 张图片',exact:true}).click()
  assert.equal(await paths.inputValue(),'/media/ritual.webp\n/media/store-07.webp')
  checks.push('Material selection adds images without duplicates; reorder and removal update paths')
  await paths.press('Control+End');await paths.press('Enter');await paths.press('Enter');await paths.pressSequentially(' /media/store-07.webp ')
  await admin.getByRole('button',{name:'保存门店资料',exact:true}).click()
  await admin.getByText('门店配置已保存。',{exact:true}).waitFor()
  assert.deepEqual(saves.at(-1).gallery,['/media/ritual.webp','/media/store-07.webp'])
  await admin.getByRole('button',{name:'返回全部门店',exact:true}).click()
  await admin.getByRole('button',{name:'管理上海中心店',exact:true}).click()
  assert.equal(await rowPath(1).inputValue(),'/media/ritual.webp')
  await admin.getByRole('button',{name:'多行粘贴',exact:true}).click()
  assert.equal(await paths.inputValue(),'/media/ritual.webp\n/media/store-07.webp')
  checks.push('Saving trims blank and duplicate lines; reopening retains saved album order')
  await admin.getByRole('button',{name:'收起多行编辑',exact:true}).click()
  await admin.locator('.image-list-editor').scrollIntoViewIfNeeded()
  await noOverflow(admin);await admin.screenshot({path:output+'/album-2560.png'})
  await admin.setViewportSize({width:1366,height:768});await noOverflow(admin)
  await admin.locator('.image-list-editor').scrollIntoViewIfNeeded()
  await admin.screenshot({path:output+'/album-1366.png'})
  checks.push('Album editor fits 1366 and 2560 widths without horizontal page overflow')
  await admin.getByRole('button',{name:'返回全部门店',exact:true}).click()
  await admin.locator('.ops-sidebar').getByRole('button',{name:'品牌与内容',exact:true}).click()
  await admin.getByRole('button',{name:'空间相册',exact:true}).click()
  await admin.getByRole('button',{name:'多行粘贴',exact:true}).click()
  const brandPaths=admin.getByRole('textbox',{name:'图片路径（一行一张）',exact:true})
  await brandPaths.click();await brandPaths.press('Control+End');await brandPaths.press('Enter')
  assert.equal(await brandPaths.inputValue(),'/media/store-02.webp\n')
  await brandPaths.pressSequentially('/media/store-07.webp');await brandPaths.press('Enter')
  await admin.getByRole('button',{name:'保存草稿',exact:true}).click()
  await admin.getByText('草稿已保存，客户页面仍使用已发布内容。',{exact:true}).waitFor()
  assert.deepEqual(site.galleryGroups[0].images,['/media/store-02.webp','/media/store-07.webp'])
  checks.push('Brand space albums use the same multiline editor and clean only on save')

  const mobileContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await fixture(mobileContext)
  const mini=await mobileContext.newPage();watch(mini);await mini.goto(miniOrigin+'/#/pages/stores/index')
  await mini.locator('.store-list .store-card').first().waitFor()
  await mini.locator('.toolbar').getByText('浦东新区',{exact:true}).click()
  assert.equal(await mini.locator('.store-card:visible').count(),1)
  await mini.locator('.store-card:visible').getByText('门店详情',{exact:true}).click()
  await mini.waitForURL(/pages\/store-detail\/index\?storeId=shanghai/)
  const detail=mini.locator('.store-detail-page:visible').last()
  await detail.getByText('上海中心店',{exact:true}).waitFor()
  await detail.getByText('2 张',{exact:true}).waitFor()
  await detail.getByText('项目详情 +',{exact:true}).click()
  await detail.getByText('体验流程',{exact:true}).waitFor()
  await detail.getByText('门店环境',{exact:true}).scrollIntoViewIfNeeded()
  const back=detail.locator('.store-list-return'),box=await back.boundingBox()
  assert(box&&box.y>=0&&box.y+box.height<844,'Return action stays visible after scrolling')
  await noOverflow(mini);await mini.screenshot({path:output+'/mini-detail.png'})
  await back.click();await mini.waitForURL(/#\/pages\/stores\/index$/)
  assert.equal(await mini.locator('.store-card:visible').count(),1)
  assert.match(await mini.locator('.toolbar .active:visible').innerText(),/浦东新区/)
  checks.push('Mini detail has its own route, shows saved album, and returns to the filtered list after scrolling')
  await mini.locator('.store-card:visible').getByText('门店详情',{exact:true}).click()
  await detail.waitFor();await mini.goBack();await mini.waitForURL(/#\/pages\/stores\/index$/)
  await mini.locator('.store-card:visible').first().waitFor()
  await mini.screenshot({path:output+'/mini-list.png'})
  checks.push('Navigation history also returns from store detail to the list')

  const direct=await mobileContext.newPage();watch(direct);await direct.goto(miniOrigin+'/#/pages/store-detail/index?storeId=shanghai')
  await direct.locator('.store-list-return').click();await direct.waitForURL(/#\/pages\/stores\/index$/)
  await direct.locator('.store-card:visible').first().waitFor()
  await direct.goto(miniOrigin+'/#/pages/store-detail/index?storeId=missing')
  await direct.getByText('暂未找到这家门店',{exact:true}).waitFor()
  await direct.getByText('查看全部门店',{exact:true}).click();await direct.waitForURL(/#\/pages\/stores\/index$/)
  checks.push('Direct detail links and missing stores can always return to the store tab')

  const readonlyContext=await browser.newContext();await fixture(readonlyContext,{readonly:true})
  const readonlyPage=await readonlyContext.newPage();watch(readonlyPage);await readonlyPage.goto(adminOrigin+'/admin')
  await readonlyPage.getByRole('button',{name:'空间相册',exact:true}).click()
  assert(await readonlyPage.locator('.image-path-row input').first().isDisabled())
  assert(await readonlyPage.getByRole('button',{name:'添加图片',exact:true}).isDisabled())
  assert(await readonlyPage.getByRole('button',{name:'从素材库添加',exact:true}).isDisabled())
  checks.push('Read-only accounts cannot edit albums or add material images')
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  await writeFile(output+'/results.json',JSON.stringify({status:'passed',checks,liveApisUsed:false,cloudDatabaseModified:false},null,2))
  console.log(JSON.stringify({status:'passed',checks,output},null,2))
}finally{await browser.close()}
