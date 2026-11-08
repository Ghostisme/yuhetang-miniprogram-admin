import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'
import ts from 'typescript'

// All browser requests are intercepted. No production API or database is used.
const origin='http://127.0.0.1:5185',dist=resolve('dist'),output=resolve('backups/list-editors')
await mkdir(output,{recursive:true})
const checks=[],errors=[],unknown=[],contexts=[],audit=[]
const browser=await chromium.launch({channel:'msedge',headless:true})
const services=[{id:'care-1',name:'经络调养',english:'WELLNESS',category:'东方养护',duration:'60分钟',image:'/media/ritual.webp',enabled:true,subtitle:'照顾日常',description:'养护项目介绍',tag:'养护',steps:['到店沟通','细致养护']},
  {id:'care-2',name:'扶阳悬灸',english:'WELLNESS',category:'东方养护',duration:'50分钟',image:'/media/ritual.webp',enabled:true,subtitle:'从容养护',description:'另一项目介绍',tag:'养护',steps:['到店评估']}]
const stores=[{id:'shanghai',name:'上海中心店',district:'浦东新区',image:'/media/store-02.webp',address:'花园石桥路158号',hours:'9:00—23:00',phone:'021-50181919',description:'门店介绍',tag:'东方养护',enabled:true,onlineBooking:true,gallery:['/media/store-02.webp']},
  {id:'bailemen',name:'百乐门店',district:'静安区',image:'/media/store-07.webp',address:'南京西路',hours:'10:00—22:00',phone:'021-00000000',description:'另一门店',tag:'东方养护',enabled:true,onlineBooking:true,gallery:['/media/store-07.webp']}]
const initial={version:1,brandName:'裕和堂',brandEnglish:'YU HE TANG',theme:'sage',tagline:'自在有和',hero:{eyebrow:'YOUR MOMENT',image:'/media/store-02.webp',title:'从容时光',subtitle:'细致关照',button:'了解门店'},brandStory:'东方养护',contact:{phone:'021-00000000',wechat:'裕和堂',message:'欢迎咨询'},stores,services,products:[{id:'product-1',name:'草本好物',subtitle:'自然关照',image:'/media/ritual.webp',category:'东方好物',description:'第一段\n第二段',enabled:true}],sections:[],galleryGroups:[{id:'space',name:'门店空间',images:['/media/store-02.webp']}],customerServiceEnabled:true}
const initialRules={opens:'10:00',closes:'22:00',interval:15,capacity:4,advanceDays:7,minLeadMinutes:30,cancelHours:2,maxHeadcount:4,phoneOpenLimit:3,remindMinutes:15,closedDates:['2026-12-01']}
async function fixture({hq=false,readonly=false}={}){
  const context=await browser.newContext({viewport:{width:1680,height:1100}});contexts.push(context);context.setDefaultTimeout(12000)
  const state={site:structuredClone(initial),stores:structuredClone(stores),services:{shanghai:structuredClone(services),bailemen:[{...structuredClone(services[0]),id:'care-other',name:'本店独立养护',steps:['百乐门接待']}]},rules:{shanghai:structuredClone(initialRules),bailemen:{...structuredClone(initialRules),closedDates:['2026-12-25']}},writes:[]}
  const permissions=hq?['content:read','services:read',...(!readonly?['content:write','content:publish','services:write','stores:write','rules:write','assets:read']:[])]:['services:read',...(!readonly?['services:write','stores:write','rules:write','assets:read']:[])]
  await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','list-editor-fixture'))
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(url.origin!==origin){unknown.push(url.origin+url.pathname);return route.abort()}
    const path=resolve(dist,'.'+url.pathname);assert(path===dist||path.startsWith(dist+sep))
    const file=extname(path)?path:resolve(dist,'index.html')
    return route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}[extname(file)]||'application/octet-stream',body:await readFile(file)})
  })
  await context.route('**/api/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname,method=req.method(),json=data=>route.fulfill({json:data})
    if(path.startsWith('/api/admin/'))assert.equal(req.headers().authorization,'Bearer list-editor-fixture')
    if(method==='GET'){
      if(path==='/api/admin/me')return json({id:'fixture-'+(hq?'hq':'branch'),name:'测试人员',hq,storeId:hq?'':'shanghai',roleIds:[],permissions})
      if(path==='/api/runtime')return json({developmentLogin:false})
      if(path==='/api/admin/stores')return json(state.stores)
      if(path==='/api/site')return json({...state.site,stores:state.stores.map(store=>({...store,services:state.services[store.id]}))})
      if(path==='/api/admin/content')return json(state.site)
      if(path==='/api/admin/assets')return json([{id:'asset-1',title:'门店环境',url:'/media/store-07.webp'},{id:'asset-2',title:'养护空间',url:'/media/ritual.webp'}])
      const match=path.match(/^\/api\/admin\/stores\/(shanghai|bailemen)\/(services|rules|slots)$/)
      if(match)return json(match[2]==='slots'?[]:state[match[2]][match[1]])
    }
    if(method==='PUT'){
      assert(!readonly,'Read-only accounts must never write')
      const body=req.postDataJSON();state.writes.push({path,body:structuredClone(body)})
      const match=path.match(/^\/api\/admin\/stores\/(shanghai|bailemen)(?:\/(services|rules))?$/)
      if(match){
        if(match[2]==='rules'){state.rules[match[1]]=body;return json(body)}
        if(match[2]==='services'){
          for(const item of body.items){const index=state.services[match[1]].findIndex(old=>old.id===item.id);if(index<0)state.services[match[1]].push({...item,id:'created-'+state.services[match[1]].length});else state.services[match[1]][index]=item}
          return json(state.services[match[1]])
        }
        const store=state.stores.find(store=>store.id===match[1]);Object.assign(store,body);return json(store)
      }
      if(path==='/api/admin/content/draft'||path==='/api/admin/content/publish'){state.site={...body,version:state.site.version+1};return json(state.site)}
    }
    unknown.push(method+' '+path);return route.fulfill({status:404,json:{message:'Unmocked API blocked'}})
  })
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/same key|unique .key. prop/i.test(message.text()))errors.push(message.text())});page.on('dialog',dialog=>dialog.accept())
  await page.goto(origin+'/admin');await menu(page,'品牌与内容').click();await page.getByRole('button',{name:'养护项目',exact:true}).click();await steps(page).waitFor()
  return {page,state}
}
const menu=(page,name)=>page.locator('.ops-sidebar').getByRole('button',{name,exact:true})
const steps=page=>page.locator('.step-list-editor')
const row=(page,index)=>page.getByLabel(`养护步骤第 ${index} 步`,{exact:true})
const values=group=>group.locator('.entry-list-row input').evaluateAll(inputs=>inputs.map(input=>input.value))
async function save(page,hq=false,publish=false){const response=page.waitForResponse(res=>res.request().method()==='PUT'&&new URL(res.url()).pathname.endsWith(hq?publish?'/publish':'/draft':'/services'));await page.getByRole('button',{name:hq?publish?'发布到小程序':'保存草稿':'保存到小程序',exact:true}).click();assert.equal((await response).status(),200);await page.getByRole('status').filter({hasText:hq?publish?'内容已发布':'草稿已保存':'养护项目已保存'}).waitFor()}
async function paste(locator,text){await locator.evaluate((input,value)=>{const data=new DataTransfer();data.setData('text/plain',value);input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))},text)}
async function snapshot(page,selector,name){for(const width of [2560,1440,1024,390]){await page.setViewportSize({width,height:1100});await selector.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' overflow at '+width);await selector.screenshot({path:resolve(output,`${name}-${width}.png`)})}await page.setViewportSize({width:1680,height:1100})}
async function sourceAudit(folder){for(const file of await readdir(folder,{withFileTypes:true})){const path=resolve(folder,file.name);if(file.isDirectory()){await sourceAudit(path);continue}if(!/\.tsx$/.test(file.name))continue;const text=await readFile(path,'utf8'),source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);function visit(node){if(ts.isJsxAttribute(node)&&['onChange','onInput'].includes(node.name.getText(source))&&node.initializer){const handler=node.initializer.getText(source);assert(!/\.split\([\s\S]*?\.filter\(Boolean\)/.test(handler),'Eager line deletion in '+path);if(/\.split\(/.test(handler))audit.push({file:path.slice(resolve('src').length+1),line:source.getLineAndCharacterOfPosition(node.pos).line+1})}ts.forEachChild(node,visit)}visit(source)}}
let failure
try{
  const {page,state}=await fixture()
  assert.deepEqual(await values(steps(page)),['到店沟通','细致养护'])
  await row(page,1).dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true})
  assert.equal(await steps(page).locator('.entry-list-row').count(),2)
  await row(page,1).press('Enter');assert.equal(await row(page,2).evaluate(input=>input===document.activeElement),true)
  await row(page,2).fill('项目沟通');await steps(page).getByRole('button',{name:'上移第 3 步',exact:true}).click()
  await steps(page).getByRole('button',{name:'删除第 2 步',exact:true}).click();await steps(page).getByRole('button',{name:'在第 1 步后添加',exact:true}).click();await row(page,2).fill('舒缓推拿')
  assert.deepEqual(await values(steps(page)),['到店沟通','舒缓推拿','项目沟通']);assert.equal(state.writes.length,0)
  checks.push('养护步骤支持回车插入并聚焦、加减和排序；中文输入法确认不误加步骤；编辑操作不自动保存')
  await row(page,2).fill('首尾');await row(page,2).evaluate(input=>input.setSelectionRange(1,1));await paste(row(page,2),'甲\r\n乙\r\n')
  assert.deepEqual(await values(steps(page)),['到店沟通','首甲','乙','尾','项目沟通'])
  checks.push('单条输入粘贴多行按步骤展开，保留光标前后文字，兼容 Windows 换行')
  await steps(page).getByRole('button',{name:'多行粘贴',exact:true}).click()
  let batch=page.getByLabel('养护步骤（一行一步）',{exact:true})
  await batch.fill('到店沟通');await batch.press('Control+End');await batch.press('Enter');await batch.press('Enter');assert.equal(await batch.inputValue(),'到店沟通\n\n')
  await batch.fill(' 到店沟通 \n\n舒缓推拿\n 到店沟通 \n')
  await page.getByRole('button',{name:'下一项',exact:true}).click();assert.deepEqual(await values(steps(page)),['到店评估'])
  await row(page,1).fill('悬灸沟通');await page.getByRole('button',{name:'上一项',exact:true}).click()
  assert.deepEqual(await values(steps(page)),[' 到店沟通 ','','舒缓推拿',' 到店沟通 ',''])
  await save(page)
  assert.deepEqual(state.services.shanghai[0].steps,['到店沟通','舒缓推拿','到店沟通']);assert.deepEqual(state.services.shanghai[1].steps,['悬灸沟通']);assert.deepEqual(state.services.bailemen[0].steps,['百乐门接待'])
  assert.equal(state.writes.at(-1).body.items.length,2)
  await page.reload();await menu(page,'品牌与内容').click();await steps(page).waitFor();assert.deepEqual(await values(steps(page)),['到店沟通','舒缓推拿','到店沟通'])
  const preview=page.locator('.content-preview');await preview.locator('.service-card').filter({hasText:'经络调养'}).click()
  assert.deepEqual(await preview.locator('.ritual-step h3').allTextContents(),['到店沟通','舒缓推拿','到店沟通'])
  assert.deepEqual(await preview.locator('.ritual-step>span').allTextContents(),['01','02','03'])
  await preview.getByRole('button',{name:'返回',exact:true}).click()
  await snapshot(page,steps(page),'care-steps')
  const writesBeforeCleanup=state.writes.length;await steps(page).getByRole('button',{name:'添加步骤',exact:true}).click();await row(page,1).fill(' 到店沟通 ')
  await page.getByRole('button',{name:'保存到小程序',exact:true}).click();await page.getByRole('status').filter({hasText:'本店项目没有待保存的修改。'}).waitFor()
  assert.deepEqual(await values(steps(page)),['到店沟通','舒缓推拿','到店沟通']);assert.equal(state.writes.length,writesBeforeCleanup)
  checks.push('连续换行和切换品项保留草稿；保存才去空行及首尾空格，保留重复步骤；刷新后顺序正确且不修改其他门店')

  await menu(page,'门店与时段').click();await page.getByRole('button',{name:'保存门店资料',exact:true}).waitFor()
  const gallery=page.locator('.image-list-editor'),imageRow=index=>gallery.getByRole('textbox',{name:`门店相册路径（一行一张）第 ${index} 张图片路径`,exact:true})
  await imageRow(1).dispatchEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true});assert.equal(await gallery.locator('.image-path-row').count(),1)
  await imageRow(1).press('Enter');await imageRow(2).fill('');await paste(imageRow(2),'/media/store-07.webp\r\n/media/ritual.webp\r\n')
  assert.equal(await gallery.locator('.image-path-row').count(),4)
  await gallery.getByRole('button',{name:'多行粘贴',exact:true}).click()
  const imageBatch=gallery.getByRole('textbox',{name:'门店相册路径（一行一张）',exact:true})
  assert.equal(await imageBatch.inputValue(),'/media/store-02.webp\n/media/store-07.webp\n/media/ritual.webp\n')
  await imageBatch.press('Control+End');await imageBatch.press('Enter');assert((await imageBatch.inputValue()).endsWith('\n\n'))
  await gallery.getByRole('button',{name:'从素材库添加',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'从素材库添加图片',exact:true});assert(await dialog.getByRole('checkbox',{name:'门店环境',exact:true}).isDisabled());await dialog.getByRole('button',{name:/取\s*消/}).click()
  await imageBatch.fill(' /media/store-02.webp \n/media/store-07.webp\n\n/media/store-02.webp\n')
  await page.getByRole('button',{name:'保存门店资料',exact:true}).click();await page.getByRole('status').filter({hasText:'门店配置已保存'}).waitFor()
  assert.deepEqual(state.stores[0].gallery,['/media/store-02.webp','/media/store-07.webp']);assert.deepEqual(state.stores[1].gallery,['/media/store-07.webp'])
  await snapshot(page,gallery,'store-gallery')
  checks.push('门店相册回车、连续空行、多行粘贴及素材去重正常；保存时清理空白和重复图片，其他门店不受影响')

  await page.getByRole('button',{name:'预约规则',exact:true}).click();const dates=page.locator('.closed-dates-editor')
  await dates.getByRole('button',{name:'添加日期',exact:true}).click();await dates.locator('input').nth(1).fill('2026-12-02');await dates.locator('input').nth(1).press('Enter');assert.equal(await dates.locator('.entry-list-row').count(),3)
  await dates.getByRole('button',{name:'多行粘贴',exact:true}).click();const dateBatch=dates.getByRole('textbox',{name:'休店日期（每行一个，或用逗号分隔）',exact:true})
  await dateBatch.fill('2026-12-01');await dateBatch.press('Control+End');await dateBatch.press('Enter');await dateBatch.press('Enter');assert.equal(await dateBatch.inputValue(),'2026-12-01\n\n')
  await dateBatch.fill('2026-02-30\n2026-12-01');const writes=state.writes.length;await page.getByRole('button',{name:'保存预约规则',exact:true}).click();await page.getByText('休店日期 2026-02-30 无效，请使用 YYYY-MM-DD 格式的真实日期。',{exact:true}).waitFor();assert.equal(state.writes.length,writes);assert.equal(await dateBatch.inputValue(),'2026-02-30\n2026-12-01')
  await dateBatch.fill(' 2026-12-01 ,2026-12-02，2026-12-02\n\n');await page.getByRole('button',{name:'保存预约规则',exact:true}).click();await page.getByText('休店日期 2026-02-30 无效，请使用 YYYY-MM-DD 格式的真实日期。',{exact:true}).waitFor({state:'hidden'})
  assert.deepEqual(state.rules.shanghai.closedDates,['2026-12-01','2026-12-02']);assert.deepEqual(state.rules.bailemen.closedDates,['2026-12-25'])
  await snapshot(page,dates,'closed-dates')
  await dates.getByRole('button',{name:'删除第 2 个日期',exact:true}).click();await dates.getByRole('button',{name:'删除第 1 个日期',exact:true}).click();await dates.getByText('暂无休店日期，点击「＋ 添加日期」开始编辑。',{exact:true}).waitFor()
  const cleared=page.waitForResponse(response=>response.url().endsWith('/rules')&&response.request().method()==='PUT');await page.getByRole('button',{name:'保存预约规则',exact:true}).click();await cleared;assert.deepEqual(state.rules.shanghai.closedDates,[])
  checks.push('休店日期支持逐条选择和加减、中英文逗号及换行粘贴；无效日期保留草稿并阻止提交，保存去重，允许清空，门店隔离')

  const hq=await fixture({hq:true})
  await steps(hq.page).getByRole('button',{name:'多行粘贴',exact:true}).click();await hq.page.getByLabel('养护步骤（一行一步）',{exact:true}).fill(' 品牌步骤 \n\n品牌步骤\n');await save(hq.page,true)
  assert.deepEqual(hq.state.site.services[0].steps,['品牌步骤','品牌步骤']);assert.deepEqual(hq.state.services.shanghai[0].steps,['到店沟通','细致养护'])
  await hq.page.getByRole('button',{name:'空间相册',exact:true}).click();const album=hq.page.locator('.image-list-editor')
  await album.getByRole('button',{name:'添加图片',exact:true}).click();await album.getByRole('textbox',{name:'图片路径（一行一张）第 2 张图片路径',exact:true}).fill('/media/store-07.webp')
  await album.getByRole('button',{name:'上移第 2 张图片',exact:true}).click();await album.getByRole('button',{name:'多行粘贴',exact:true}).click();const albumBatch=album.getByRole('textbox',{name:'图片路径（一行一张）',exact:true})
  await albumBatch.press('Control+End');await albumBatch.press('Enter');await save(hq.page,true,true);assert.deepEqual(hq.state.site.galleryGroups[0].images,['/media/store-07.webp','/media/store-02.webp'])
  checks.push('总部品牌养护步骤与品牌空间相册复用相同交互；草稿和发布均在提交时清理，品牌步骤不改写门店独立数据')
  await hq.page.getByRole('button',{name:'首页与品牌',exact:true}).click();await hq.page.getByRole('textbox',{name:'品牌故事',exact:true}).fill('第一段\n\n第二段\n')
  await hq.page.getByRole('button',{name:'首页封面',exact:true}).click();await hq.page.getByRole('textbox',{name:'封面标题（可换行）',exact:true}).fill('标题一\n标题二\n');await save(hq.page,true)
  assert.equal(hq.state.site.brandStory,'第一段\n\n第二段\n');assert.equal(hq.state.site.hero.title,'标题一\n标题二\n')
  await hq.page.getByRole('button',{name:'品牌产品',exact:true}).click();await hq.page.getByRole('textbox',{name:'详细介绍',exact:true}).fill('产品第一段\n\n产品第二段\n');await save(hq.page,true);assert.equal(hq.state.site.products[0].description,'产品第一段\n\n产品第二段\n')
  checks.push('品牌故事、首页封面多行标题、产品介绍原有段落和空行在切换及保存时保留')
  const read=await fixture({readonly:true});assert(await row(read.page,1).isDisabled());assert(await steps(read.page).getByRole('button',{name:'添加步骤',exact:true}).isDisabled());assert.equal(await read.page.getByRole('button',{name:'保存到小程序',exact:true}).count(),0)
  const readHq=await fixture({hq:true,readonly:true});await readHq.page.getByRole('button',{name:'空间相册',exact:true}).click();assert(await readHq.page.locator('.image-path-row input').first().isDisabled());assert(await readHq.page.getByRole('button',{name:'添加图片',exact:true}).isDisabled())
  assert.equal(read.state.writes.length,0);assert.equal(readHq.state.writes.length,0)
  checks.push('总部及门店只读账号无法编辑步骤和相册、无法提交修改；2560/1440/1024/390 宽度的三个编辑器均无整页横向溢出')
  await sourceAudit(resolve('src'));assert(audit.length>=2)
  checks.push('扫描全部 TSX 输入处理器，没有边输入边 split/filter(Boolean) 删除空行或分隔符的遗留操作')
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
}catch(error){failure=error;for(let i=0;i<contexts.length;i++){const page=contexts[i].pages()[0];await page?.screenshot({path:resolve(output,`failure-${i}.png`),fullPage:true}).catch(()=>{});await writeFile(resolve(output,`failure-${i}-aria.txt`),await page?.locator('body').ariaSnapshot().catch(()=>'')||'')}}
finally{await browser.close();await writeFile(resolve(output,'result.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,unknown,audit,liveApisUsed:false,cloudDatabaseModified:false,failure:failure?.stack},null,2))}
if(failure)throw failure
console.log(JSON.stringify({checks,errors,unknown,audit,output},null,2))
