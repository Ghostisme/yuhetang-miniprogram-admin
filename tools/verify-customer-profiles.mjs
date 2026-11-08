import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'

// All customer identities, phones and requests below are disposable fixtures.
const origin='http://127.0.0.1:5181',dist=resolve('dist'),output=resolve('backups/customer-profiles')
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true})
const checks=[],errors=[],unknown=[],contexts=[]
const now='2026-11-08T10:00:00+08:00'
async function fixture({readonly=false,branch=false}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context)
  const state={calls:[],rows:[
    {id:'member',name:'王女士',registeredName:'小王',phone:'139****3001',storeId:'shanghai',memberVerified:true,memberGrade:'金卡',originalStoreId:'yuyao',memberStoreName:'余姚路店',sharedNote:'原有提示',privateNote:'本店跟进',sources:['MINIPROGRAM','DIANPING'],firstLoginAt:now,lastLoginAt:now,phoneVerified:true},
    {id:'nonmember',name:'李先生',phone:'139****3002',storeId:'',memberVerified:false,memberGrade:'',sources:['MINIPROGRAM'],firstLoginAt:now,lastLoginAt:now,phoneVerified:true},
    {id:'registration',name:'新登录客户',phone:'',storeId:'',memberVerified:false,sources:['MINIPROGRAM'],registrationOnly:true,firstLoginAt:now,lastLoginAt:now,phoneVerified:false},
  ]}
  await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','customer-profile-fixture'))
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(url.origin!==origin){unknown.push(url.origin+url.pathname);return route.abort()}
    const path=resolve(dist,'.'+url.pathname);assert(path===dist||path.startsWith(dist+sep))
    const file=extname(path)?path:resolve(dist,'index.html')
    return route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}[extname(file)]||'application/octet-stream',body:await readFile(file)})
  })
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method()
    if(path.startsWith('/api/admin/'))assert.equal(req.headers().authorization,'Bearer customer-profile-fixture')
    state.calls.push({path,method,query:url.search})
    const json=data=>route.fulfill({json:data})
    if(path==='/api/admin/me')return json({id:'fixture-admin',name:'测试管理员',hq:!branch,storeId:branch?'shanghai':'',roleIds:[],permissions:['customers:read',...(!readonly?['customers:write','appointments:phone',...(!branch?['customers:master']:[])]:[])]})
    if(path==='/api/admin/stores')return json([{id:'shanghai',name:'上海中心店',enabled:true},{id:'yuyao',name:'余姚路店',enabled:true}])
    if(path==='/api/site')return json({brandName:'裕和堂',theme:'sage',hero:{},contact:{},stores:[],services:[],products:[],sections:[],galleryGroups:[]})
    if(path==='/api/runtime')return json({customerProfiles:true,developmentLogin:false})
    if(path==='/api/admin/customers'&&method==='GET'){
      const p=url.searchParams
      const rows=state.rows.filter(row=>(!branch||row.storeId==='shanghai')&&(!p.get('storeId')||row.storeId===p.get('storeId'))&&(!p.get('source')||row.sources.includes(p.get('source')))&&(!p.get('member')||row.memberVerified===(p.get('member')==='MEMBER'))&&(!p.get('search')||(row.name+' '+(row.registeredName||'')).includes(p.get('search'))))
      return json({items:rows,total:rows.length,page:1,pageSize:30})
    }
    if(path==='/api/admin/customers/member/phone')return json({phone:'13900003001'})
    if(path==='/api/admin/customers/member'&&method==='PUT'){
      const body=req.postDataJSON();state.rows[0]={...state.rows[0],...body}
      return json({saved:true})
    }
    unknown.push(method+' '+path);return route.fulfill({status:404,json:{message:'Unmocked request blocked'}})
  })
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin+'/admin');await page.locator('.customer-directory tbody tr').first().waitFor()
  return {context,page,state}
}
async function select(page,label,option){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click()}
async function rows(page,count){await page.waitForFunction(n=>document.querySelectorAll('.customer-directory tbody tr').length===n,count)}
try{
  const {page,state}=await fixture()
  await rows(page,3)
  assert.equal(await page.getByText('等待客户完善资料',{exact:true}).count(),1)
  const first=page.locator('.customer-directory tbody tr').filter({hasText:'王女士'})
  assert.equal(await first.getByText('小程序',{exact:true}).count(),1)
  assert.equal(await first.getByText('大众点评',{exact:true}).count(),1)
  await page.screenshot({path:resolve(output,'customer-directory-1440.png'),fullPage:true})
  checks.push('Headquarters sees registered customers before booking, verified profiles and multiple source tags')
  await select(page,'会员状态','会员');await rows(page,1)
  await select(page,'客户来源','大众点评');await rows(page,1)
  await first.getByRole('button',{name:'查看完整电话',exact:true}).click()
  await first.getByText('13900003001',{exact:true}).waitFor()
  checks.push('Member/source filters combine and full phone is fetched only through the audited endpoint')
  await first.getByRole('button',{name:'维护档案',exact:true}).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('dialog').evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))})
  await page.screenshot({path:resolve(output,'customer-member-edit.png')})
  await select(page,'会员归属门店','上海中心店')
  await page.getByRole('switch',{name:'会员标识'}).click()
  await page.getByRole('button',{name:'保存档案',exact:true}).click()
  await page.getByRole('dialog').waitFor({state:'detached'})
  await page.getByText('当前条件下暂无客户档案',{exact:true}).waitFor()
  assert.equal(state.rows[0].memberVerified,false)
  assert.equal(state.rows[0].originalStoreId,'shanghai','Headquarters explicitly maintains the member home independently from a booking store')
  assert.deepEqual(state.rows[0].sources,['MINIPROGRAM','DIANPING'])
  await select(page,'会员状态','全部会员状态');await rows(page,1)
  assert.equal(await page.locator('tbody tr').getByText('非会员',{exact:true}).count(),1)
  checks.push('Headquarters can change membership without changing customer sources or hiding a profile permanently')
  await select(page,'客户来源','全部客户来源');await rows(page,3)
  await page.getByRole('textbox',{name:'搜索客户',exact:true}).fill('新登录客户')
  await page.getByRole('button',{name:'搜索',exact:true}).click();await rows(page,1)
  assert.equal(await page.locator('tbody tr').getByText('新登录客户',{exact:true}).count(),1)
  checks.push('Search finds login registrations that have not yet authorized a phone')
  const scoped=await fixture({branch:true});await rows(scoped.page,1)
  await scoped.page.getByRole('button',{name:'维护档案',exact:true}).click()
  assert.equal(await scoped.page.getByRole('switch',{name:'会员标识'}).count(),0)
  assert.equal(await scoped.page.getByRole('combobox',{name:'会员归属门店'}).count(),0)
  assert.equal(await scoped.page.getByText('本店私有跟进',{exact:true}).count(),1)
  const readonly=await fixture({readonly:true})
  assert.equal(await readonly.page.getByRole('button',{name:'维护档案',exact:true}).count(),0)
  assert.equal(await readonly.page.getByRole('button',{name:'查看完整电话',exact:true}).count(),0)
  checks.push('Branch accounts only maintain their private note; read-only accounts cannot edit or reveal phones')
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  await writeFile(resolve(output,'result.json'),JSON.stringify({status:'passed',liveApisUsed:false,checks,errors,unknown},null,2)+'\n')
  console.log(JSON.stringify({status:'passed',checks},null,2))
}finally{for(const context of contexts)await context.close();await browser.close()}
