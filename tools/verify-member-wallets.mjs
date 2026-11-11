import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'

// Intercept every request; never contact production or mutate real balances.
const origin='http://127.0.0.1:5188',dist=resolve('dist'),output=resolve('backups/member-wallets')
await mkdir(output,{recursive:true})
const errors=[],unknown=[],checks=[],browser=await chromium.launch({channel:'msedge',headless:true})
const date='2026-11-09T10:00:00+08:00'
const stores=[{id:'shanghai',name:'上海中心店'},{id:'yuyao',name:'余姚路店'}]
async function fixture(readonly=false,{member=true,empty=false,zero=false,source=false}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(12000)
  const state={failNext:false,requests:[],keys:new Set(),balance:zero?0:392801,version:1,entries:[{id:'opening-1',kind:'OPENING',deltaFen:zero?0:392801,balanceAfterFen:zero?0:392801,businessAt:date,operatorName:'测试总部',referenceNo:'SOURCE-001',note:'合成测试资料',reversed:false}]}
  const account=()=>({id:'wallet-a',storeId:'shanghai',storeName:'上海中心店',externalAccount:'SAMPLE-001',label:'储值账户',balanceFen:state.balance,version:state.version,openingAsOf:date,updatedAt:date,...(source?{source:'KU52',cardNumber:'TEST-CARD-001',validity:'2026.07.23 - 2027.07.23'}:{})})
  await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','wallet-ui-fixture'))
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),json=data=>route.fulfill({json:data})
    if(url.origin!==origin){unknown.push(url.origin+path);return route.abort()}
    if(path.startsWith('/api/')){
      if(path.startsWith('/api/admin/'))assert.equal(req.headers().authorization,'Bearer wallet-ui-fixture')
      if(path==='/api/admin/me')return json({id:'fixture-user',name:'测试人员',hq:!readonly,storeId:readonly?'shanghai':'',roleIds:[],permissions:['customers:read','wallets:read',...(!readonly?['wallets:write','wallets:opening']:[])]})
      if(path==='/api/runtime')return json({developmentLogin:false})
      if(path==='/api/admin/stores')return json(readonly?stores.slice(0,1):stores)
      if(path==='/api/site')return json({brandName:'裕和堂',brandEnglish:'YU Health',hero:{},stores,services:[],products:[],galleryGroups:[],contact:{}})
      if(path==='/api/admin/customers')return json({items:[{id:'customer-1',name:'余额测试会员',phone:'139****6001',memberVerified:member,memberGrade:member?'金卡':'',storeId:'shanghai',sources:['MINIPROGRAM'],registrationOnly:false}],total:1})
      if(path==='/api/admin/customers/customer-1/wallets'&&method==='GET')return json({accounts:empty?[]:[account()],lookupStatus:empty?(member?'MIGRATION_PENDING':'MEMBERSHIP_PENDING'):'AVAILABLE',memberVerified:member,balanceKnown:!empty,totalFen:empty?null:state.balance,balanceScope:source?'LOCAL_AND_SOURCE_CARDS':'MIGRATED_ACCOUNTS_ONLY',sourceSync:source?{enabled:true,state:'READY',lastSuccess:date,stale:false}:undefined})
      if(path==='/api/admin/wallets/wallet-a/entries'&&method==='GET')return json({items:source?[]:state.entries,total:source?0:state.entries.length,readOnlySource:source})
      if(path==='/api/admin/wallets/wallet-a/entries'&&method==='POST'){
        assert(!readonly);const body=req.postDataJSON();state.requests.push(body)
        if(!state.keys.has(body.requestKey)){
          assert.equal(body.version,state.version);state.keys.add(body.requestKey);state.balance+=Math.round(Number(body.amount)*100)*(body.kind==='CONSUME'?-1:1);state.version++
          state.entries.unshift({id:'entry-'+state.version,kind:body.kind,deltaFen:Math.round(Number(body.amount)*100)*(body.kind==='CONSUME'?-1:1),balanceAfterFen:state.balance,businessAt:date,operatorName:'测试人员',referenceNo:body.referenceNo,note:body.note,reversed:false})
        }
        if(state.failNext){state.failNext=false;return route.fulfill({status:503,json:{message:'模拟提交结果不确定，请核对流水。'}})}
        return json({account:account(),replayed:state.requests.length>1})
      }
      unknown.push(method+' '+path);return route.fulfill({status:404,json:{message:'Unmocked API blocked'}})
    }
    const p=resolve(dist,'.'+path);assert(p===dist||p.startsWith(dist+sep));const file=extname(p)?p:resolve(dist,'index.html')
    return route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}[extname(file)]||'application/octet-stream',body:await readFile(file)})
  })
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/admin');await page.getByRole('button',{name:'会员余额',exact:true}).click();await page.locator(empty?'.member-wallet-drawer .data-empty':'.member-wallet-card').waitFor()
  return {page,context,state}
}
try{
  const mirrored=await fixture(false,{source:true})
  try{
    await mirrored.page.getByText('原系统同步 · 只读',{exact:true}).waitFor()
    await mirrored.page.getByText('原系统卡只读，消费详情请在客户档案的消费记录中查看。',{exact:true}).waitFor()
    assert.equal(await mirrored.page.getByRole('button',{name:'登记充值',exact:true}).count(),0)
    assert.equal(await mirrored.page.getByRole('button',{name:'登记消费',exact:true}).count(),0)
    assert.match(await mirrored.page.locator('.member-wallet-card').innerText(),/TEST-CARD-001/)
    await mirrored.page.setViewportSize({width:390,height:844})
    assert.equal(await mirrored.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    const drawer=mirrored.page.getByRole('dialog',{name:'余额测试会员 · 会员余额',exact:true})
    await mirrored.page.waitForFunction(()=>{const box=document.querySelector('.member-wallet-drawer [role="dialog"]')?.getBoundingClientRect();return box&&box.x>=-1&&box.right<=innerWidth+1})
    await drawer.evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))})
    const box=await drawer.boundingBox();assert(box.x>=-1&&box.x+box.width<=391,'Source card drawer must fit after the resize transition')
    await mirrored.page.screenshot({path:resolve(output,'source-readonly-390.png')})
    checks.push('Source-synchronized card exposes its card number and validity; HQ cannot recharge/consume the read-only source snapshot; mobile fits')
  }finally{await mirrored.context.close()}
  const {page,context,state}=await fixture()
  try{
    const drawer=page.getByRole('dialog',{name:'余额测试会员 · 会员余额',exact:true})
    assert.match(await drawer.locator('.member-wallet-card').innerText(),/3,928\.01/)
    await drawer.getByText('仅显示当前门店范围内已迁入并核对的账户，未迁入的其他账户不计入余额。',{exact:true}).waitFor()
    await drawer.getByRole('button',{name:'录入期初账户',exact:true}).click();const opening=page.getByRole('dialog',{name:'期初余额',exact:true})
    await opening.getByText('原系统会员 / 卡账户唯一编号',{exact:true}).waitFor();await opening.locator('.ant-modal-close').click()
    checks.push('HQ opening form requires source account, store, verified cutoff, amount and evidence; separate balance drawer opens from customer directory')
    state.failNext=true;await drawer.getByRole('button',{name:'登记充值',exact:true}).click();const modal=page.getByRole('dialog',{name:'充值登记',exact:true})
    await modal.getByLabel('登记金额（元）',{exact:true}).fill('12.34');await modal.getByLabel('原始凭证 / 订单编号',{exact:true}).fill('OFFLINE-001');await modal.getByLabel('核对说明（仅后台可见）',{exact:true}).fill('合成充值核对');await modal.getByRole('button',{name:'确认登记',exact:true}).click()
    await modal.getByRole('button',{name:'使用原提交标识重试',exact:true}).waitFor();assert(await modal.getByLabel('登记金额（元）',{exact:true}).isDisabled())
    // The shared client observes a 3s cooldown after 503; wait before the explicit retry.
    await page.waitForTimeout(3100);await modal.getByRole('button',{name:'使用原提交标识重试',exact:true}).click();await modal.waitFor({state:'hidden'})
    assert.equal(state.requests.length,2);assert.equal(state.keys.size,1);assert.deepEqual(state.requests[0],state.requests[1]);assert.equal(state.balance,394035)
    await drawer.getByText('OFFLINE-001',{exact:false}).waitFor();checks.push('Ambiguous POST retry retains exactly the same request key and payload; one financial entry, refreshed account and ledger')
    for(const width of [1440,1024,390]){
      await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
      // AntD animates its max-width when the viewport changes; inspect the settled layout.
      await page.waitForFunction(()=>{const box=document.querySelector('.member-wallet-drawer [role="dialog"]')?.getBoundingClientRect();return box&&box.x>=-1&&box.right<=innerWidth+1})
      const box=await drawer.boundingBox();assert(box.x>=-1&&box.x+box.width<=width+1,`Wallet drawer stays inside ${width}px screen: ${JSON.stringify(box)}`)
      await page.screenshot({path:resolve(output,`hq-${width}.png`)});checks.push(`${width}px: balance cards, ledger and action drawer fit without horizontal scrolling`)
    }
    await drawer.getByRole('button',{name:'登记消费',exact:true}).click();const mobileModal=page.getByRole('dialog',{name:'消费登记',exact:true});await mobileModal.waitFor()
    await mobileModal.getByLabel('登记金额（元）',{exact:true}).waitFor()
    await mobileModal.evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))})
    const modalBox=await mobileModal.boundingBox();assert(modalBox.x>=0&&modalBox.x+modalBox.width<=391&&modalBox.height>300)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.screenshot({path:resolve(output,'consume-390.png')});await mobileModal.locator('.ant-modal-close').click();checks.push('Consumption form stays readable and operable at 390px')
  }finally{await context.close()}
  const branch=await fixture(true)
  try{assert.equal(await branch.page.getByRole('button',{name:'录入期初账户',exact:true}).count(),0);assert.equal(await branch.page.getByRole('button',{name:'登记充值',exact:true}).count(),0);assert.equal(await branch.page.getByRole('button',{name:'登记消费',exact:true}).count(),0);checks.push('Read-only branch account can inspect its ledger but sees no financial mutation actions')}finally{await branch.context.close()}
  for(const member of [false,true]){
    const pending=await fixture(false,{member,empty:true})
    try{
      const drawer=pending.page.getByRole('dialog',{name:'余额测试会员 · 会员余额',exact:true})
      await drawer.getByText(member?'余额账户尚未迁入':'请先核实会员资料',{exact:true}).waitFor()
      assert.equal(await drawer.getByRole('button',{name:'录入期初账户',exact:true}).isDisabled(),!member)
      assert.equal(await drawer.locator('.member-wallet-card').count(),0);assert.equal(await drawer.getByText(/¥0\.00/).count(),0)
      await pending.page.setViewportSize({width:390,height:844});assert.equal(await pending.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
      await pending.page.waitForFunction(()=>{const box=document.querySelector('.member-wallet-drawer [role="dialog"]')?.getBoundingClientRect();return box&&box.x>=-1&&box.right<=innerWidth+1})
      await drawer.evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))})
      await pending.page.screenshot({path:resolve(output,member?'migration-pending.png':'membership-pending.png')})
      checks.push(member?'Verified membership with no migrated wallet is pending, not zero; HQ can record the verified opening balance':'Unverified membership is pending, not non-member or zero; opening entry is disabled until membership is verified')
    }finally{await pending.context.close()}
  }
  const zero=await fixture(false,{zero:true})
  try{assert.match(await zero.page.locator('.member-wallet-card').innerText(),/0\.00/);assert.equal(await zero.page.locator('.member-wallet-drawer .data-empty').count(),0);checks.push('An explicitly migrated zero-balance account remains queryable with its opening ledger')}finally{await zero.context.close()}
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  const report={status:'passed',createdAt:new Date().toISOString(),liveApisUsed:false,realBalancesChanged:false,checks,errors,unknown}
  await writeFile(resolve(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}finally{await browser.close()}
