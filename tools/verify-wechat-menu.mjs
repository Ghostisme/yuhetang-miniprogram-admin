import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'

// Intercept every request: browser checks cannot publish a real service menu.
const origin='http://127.0.0.1:5184',dist=resolve('dist'),output=resolve('backups/wechat-menu')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true}),contexts=[],checks=[],errors=[],unknown=[]
const now='2026-11-08T17:00:00+08:00',base='/api/admin/wechat-menu'
const pages=[['小程序首页','pages/home/index'],['在线预约','pages/booking/index'],['养护项目','pages/catalog/index'],['门店查询','pages/stores/index'],['联系客服','pages/contact/index'],['我的预约','pages/orders/index']].map(([name,path])=>({name,path}))
const original={button:[{name:'旧平台',type:'view',url:'https://example.com/old'}]}
async function fixture({readonly=false,branch=false,missing=false}={}){
  const context=await browser.newContext({viewport:{width:1680,height:1100}});contexts.push(context)
  context.setDefaultTimeout(12000)
  const state={calls:[],failPublish:false,online:structuredClone(original),backup:null,config:{revision:0,draft:{button:[]},savedAt:'',publishedAt:'',backupAt:'',hasBackup:false,serviceAppId:'wxf9ad4dfd7684097a',miniAppId:'wxce054e18303efb8a',credentialsConfigured:!missing,pages}}
  if(readonly){state.config.draft={button:[{name:'在线预约',type:'miniprogram',appid:'wxce054e18303efb8a',pagepath:'pages/booking/index',url:'https://www.yuhetangtcm.com'}]};state.config.savedAt=now}
  await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','wechat-menu-fixture'))
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(url.origin!==origin){unknown.push(url.origin+url.pathname);return route.abort()}
    const path=resolve(dist,'.'+url.pathname);assert(path===dist||path.startsWith(dist+sep))
    const file=extname(path)?path:resolve(dist,'index.html')
    return route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)]||'application/octet-stream',body:await readFile(file)})
  })
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method()
    if(path.startsWith('/api/admin/'))assert.equal(req.headers().authorization,'Bearer wechat-menu-fixture')
    state.calls.push({path,method})
    const json=(value,status=200)=>route.fulfill({status,json:value})
    if(path==='/api/admin/me')return json({id:'fixture-hq',name:'测试总部',hq:!branch,storeId:branch?'shanghai':'',roleIds:[],permissions:['wechat-menu:read',...(!readonly?['wechat-menu:write','wechat-menu:publish']:[])]})
    if(path==='/api/admin/stores')return json([])
    if(path==='/api/runtime')return json({developmentLogin:false})
    if(path===base)return json(state.config)
    if(path===base+'/remote')return json({menu:state.online,readAt:now,exists:true,conditionalCount:1})
    if(path===base+'/draft'){
      const body=req.postDataJSON();if(body.revision!==state.config.revision)return json({message:'菜单草稿已被其他人修改，请刷新后核对再操作。'},409)
      state.config={...state.config,revision:state.config.revision+1,draft:body.menu,savedAt:now};return json(state.config)
    }
    if(path===base+'/publish'){
      assert.equal(req.postDataJSON().revision,state.config.revision)
      state.backup=structuredClone(state.online);state.config.hasBackup=true;state.config.backupAt=now
      if(state.failPublish)return json({message:'服务号没有菜单操作权限（微信错误码 48001）'},502)
      state.online=structuredClone(state.config.draft);state.config.publishedAt=now
      return json({...state.config,accepted:true,conditionalCount:1})
    }
    if(path===base+'/restore-draft'){
      state.config={...state.config,revision:state.config.revision+1,draft:structuredClone(state.backup),savedAt:now};return json(state.config)
    }
    unknown.push(method+' '+path);return json({message:'Unmocked request blocked'},404)
  })
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin+'/admin')
  if(!branch)await page.getByRole('heading',{name:'编辑菜单',exact:true}).waitFor()
  else await page.getByText('当前账号尚未分配可用模块，请联系总部管理员配置角色权限。',{exact:true}).waitFor()
  return {context,page,state}
}
async function select(page,label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click()}
async function enabled(locator,expected){assert.equal(await locator.isEnabled(),expected)}
async function save(page){await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('草稿已保存，微信线上菜单尚未改变。',{exact:true}).waitFor()}
async function accept(page,title,label){const dialog=page.getByRole('dialog',{name:title,exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:label,exact:true}).click();await dialog.waitFor({state:'hidden'})}
const count=(state,path)=>state.calls.filter(call=>call.path===base+path).length
let failure
try{
  const {page,state}=await fixture()
  assert.equal(await page.getByLabel('菜单名称',{exact:true}).inputValue(),'在线预约')
  assert.equal(count(state,'/remote'),0);assert.equal(count(state,'/publish'),0)
  await enabled(page.getByRole('button',{name:'发布到微信',exact:true}),false)
  for(const width of [1680,1440,1024,390]){
    await page.setViewportSize({width,height:1100})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow at '+width)
    await page.screenshot({path:resolve(output,`menu-${width}.png`),fullPage:true})
  }
  await page.setViewportSize({width:1680,height:1100})
  checks.push('首次打开预填当前小程序的三个推荐菜单；进入页面不读取或发布微信菜单；1680/1440/1024/390 宽度无整页横向溢出')
  await page.getByLabel('菜单名称',{exact:true}).fill('预约养护')
  await select(page,'打开的小程序页面','养护项目');await save(page)
  assert.equal(state.config.draft.button[0].pagepath,'pages/catalog/index');assert.equal(count(state,'/publish'),0)
  await enabled(page.getByRole('button',{name:'发布到微信',exact:true}),true)
  await page.getByRole('button',{name:'发布到微信',exact:true}).click()
  assert.equal(count(state,'/publish'),0)
  await page.getByRole('dialog',{name:'发布服务号菜单',exact:true}).getByRole('button',{name:/取\s*消/}).click()
  assert.equal(count(state,'/publish'),0)
  checks.push('修改名称和选择页面后可保存草稿；未保存时禁用发布；发布需要确认，取消不会提交')
  state.failPublish=true
  await page.getByRole('button',{name:'发布到微信',exact:true}).click();await accept(page,'发布服务号菜单','确认发布')
  await page.getByText('服务号没有菜单操作权限（微信错误码 48001）',{exact:true}).waitFor()
  assert.equal(state.config.publishedAt,'');assert.equal(count(state,'/publish'),1)
  state.failPublish=false
  await page.getByRole('button',{name:'发布到微信',exact:true}).click();await accept(page,'发布服务号菜单','确认发布')
  await page.getByText(/微信已接受菜单发布/).waitFor();assert.equal(count(state,'/publish'),2)
  assert.deepEqual(state.online,state.config.draft)
  await page.screenshot({path:resolve(output,'menu-published.png'),fullPage:true})
  checks.push('微信权限错误显示错误码且没有成功提示；明确确认后才提交，成功显示微信已接受及刷新说明')
  await page.getByRole('button',{name:'恢复发布前菜单到草稿',exact:true}).click();await accept(page,'恢复发布前菜单到草稿','恢复到草稿')
  await page.getByText('发布前菜单已恢复到草稿，尚未发布到微信。',{exact:true}).waitFor()
  assert.deepEqual(state.config.draft,original);assert.equal(count(state,'/publish'),2)
  checks.push('将发布前菜单恢复到草稿不会自动发布')
  await page.getByRole('button',{name:'读取微信菜单',exact:true}).click();await page.getByText('已读取微信当前菜单，可在下方核对。',{exact:true}).waitFor()
  assert.equal(count(state,'/remote'),1);await page.getByText(/当前还存在 1 份个性化菜单/).waitFor()
  await page.getByRole('button',{name:'载入编辑',exact:true}).click();await accept(page,'载入微信菜单到编辑区','载入编辑')
  assert.equal(await page.getByLabel('菜单名称',{exact:true}).inputValue(),'预约养护')
  await select(page,'点击动作','展开子菜单')
  await page.getByLabel('菜单名称',{exact:true}).fill('预约服务')
  await page.getByRole('button',{name:'编辑二级菜单：子菜单',exact:true}).click();await page.getByLabel('菜单名称',{exact:true}).fill('联系客服')
  await select(page,'打开的小程序页面','联系客服')
  await page.getByRole('button',{name:'添加子菜单',exact:true}).click();await page.getByLabel('菜单名称',{exact:true}).fill('查看预约')
  await select(page,'打开的小程序页面','我的预约')
  await page.getByRole('button',{name:'上移查看预约',exact:true}).click()
  await save(page)
  assert.equal(state.config.draft.button[0].sub_button[0].name,'查看预约');assert.equal(state.config.draft.button[0].sub_button[1].pagepath,'pages/contact/index')
  assert.equal(count(state,'/publish'),2)
  await enabled(page.getByRole('button',{name:'添加一级菜单',exact:true}),false)
  await page.screenshot({path:resolve(output,'menu-submenus.png'),fullPage:true})
  checks.push('读取当前菜单、展示个性化菜单提示、载入编辑、切换为子菜单、排序及保存均可用')
  state.config.revision++
  await page.getByLabel('菜单名称',{exact:true}).fill('预约查询')
  await page.getByRole('button',{name:'保存草稿',exact:true}).click();await page.getByText('菜单草稿已被其他人修改，请刷新后核对再操作。',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('菜单名称',{exact:true}).inputValue(),'预约查询')
  checks.push('多人编辑冲突保留本地未保存内容并显示版本提示')
  const read=await fixture({readonly:true})
  assert.equal(await read.page.getByRole('button',{name:'保存草稿',exact:true}).count(),0);assert.equal(await read.page.getByRole('button',{name:'发布到微信',exact:true}).count(),0)
  await enabled(read.page.getByLabel('菜单名称',{exact:true}),false)
  const missing=await fixture({missing:true})
  await enabled(missing.page.getByRole('button',{name:'读取微信菜单',exact:true}),false);await enabled(missing.page.getByRole('button',{name:'发布到微信',exact:true}),false)
  await save(missing.page);assert.equal(count(missing.state,'/publish'),0)
  const branch=await fixture({branch:true})
  assert.equal(await branch.page.locator('.ops-sidebar').getByRole('button',{name:'服务号菜单',exact:true}).count(),0);assert.equal(count(branch.state,''),0)
  checks.push('只读人员无法编辑或发布；缺少服务号凭据仍能保存草稿；门店账号看不到服务号菜单入口')
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
}catch(error){failure=error;const page=contexts[0]?.pages()[0];await page?.screenshot({path:resolve(output,'failure.png'),fullPage:true}).catch(()=>{});await writeFile(resolve(output,'failure-aria.txt'),await page?.locator('body').ariaSnapshot().catch(()=>'' )||'')}
finally{await browser.close();await writeFile(resolve(output,'result.json'),JSON.stringify({at:new Date().toISOString(),checks,errors,unknown,failure:failure?.stack},null,2))}
if(failure)throw failure
console.log(JSON.stringify({checks,errors,unknown,output},null,2))
