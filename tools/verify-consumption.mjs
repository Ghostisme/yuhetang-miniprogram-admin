import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'

// Every API is intercepted. These records never reach a real database or a customer.
const origin='http://127.0.0.1:5192',dist=resolve('dist'),out=resolve('backups/consumption')
await mkdir(out,{recursive:true})
const errors=[],unknown=[],checks=[],browser=await chromium.launch({channel:'msedge',headless:true})
const stores=[{id:'shanghai',name:'上海中心店'},{id:'yuyao',name:'余姚路店'}],date='2026-11-09T10:00:00+08:00'
const live={id:'entry-live',storeId:'shanghai',storeName:'上海中心店',source:'WALLET',projectName:'中医推拿 60 分钟',paidFen:8850,businessAt:date,referenceNo:'0000000000000000000000012345678901',publicNote:'客户可见消费说明',accountLabel:'储值账户',balanceAfterFen:392801,status:'RECORDED',version:1}
async function fixture(readonly=false,empty=false,{branch=false}={}){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(10000)
  const state={items:empty?[]:[structuredClone(live)],historyPosts:[],voidPosts:[],walletPosts:[],failNext:false,balance:392801,version:1,keys:new Set(),ledger:[]}
  const account=()=>({id:'wallet-a',storeId:'shanghai',storeName:'上海中心店',externalAccount:'SAMPLE-001',label:'储值账户',balanceFen:state.balance,version:state.version,openingAsOf:date,updatedAt:date})
  await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','consumption-admin-fixture'))
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),json=data=>route.fulfill({json:data})
    if(url.origin!==origin){unknown.push(url.origin+path);return route.abort()}
    if(path.startsWith('/api/')){
      if(path.startsWith('/api/admin/'))assert.equal(req.headers().authorization,'Bearer consumption-admin-fixture')
      if(path==='/api/admin/me')return json({id:'fixture-user',name:'测试人员',hq:!readonly&&!branch,storeId:readonly||branch?'shanghai':'',roleIds:[],permissions:['customers:read','wallets:read',...(!readonly?['wallets:write',...(!branch?['wallets:opening']:[])]:[])]})
      if(path==='/api/runtime')return json({developmentLogin:false})
      if(path==='/api/admin/stores')return json(readonly||branch?stores.slice(0,1):stores)
      if(path==='/api/site')return json({brandName:'裕和堂',brandEnglish:'YU Health',hero:{},stores,services:[],products:[],galleryGroups:[],contact:{}})
      if(path==='/api/admin/customers')return json({items:[{id:'customer-1',name:'消费测试会员',phone:'139****6011',memberVerified:true,memberGrade:'金卡',storeId:branch?'yuyao':'shanghai',sources:['MINIPROGRAM'],registrationOnly:false}],total:1})
      if(path==='/api/admin/customers/customer-1/consumption-records'&&method==='GET')return json({items:state.items,total:state.items.length,pageSize:20,historyComplete:false,stores})
      if(path==='/api/admin/customers/customer-1/consumption-records'&&method==='POST'){
        assert(!readonly);const body=req.postDataJSON();if(branch)assert.equal(body.storeId,'shanghai');state.historyPosts.push(body)
        if(!state.keys.has(body.requestKey)){
          state.keys.add(body.requestKey);state.items.unshift({id:'legacy-new',...body,storeName:'上海中心店',source:'LEGACY',paidFen:Math.round(Number(body.amount)*100),accountLabel:'',balanceAfterFen:null,status:'RECORDED',version:1})
        }
        if(state.failNext){state.failNext=false;return route.fulfill({status:503,json:{message:'模拟提交结果待核对'}})}
        return json({id:'legacy-new',replayed:state.historyPosts.length>1})
      }
      if(path==='/api/admin/consumption-records/legacy-new/void'&&method==='POST'){
        assert(!readonly);state.voidPosts.push(req.postDataJSON());state.items.find(item=>item.id==='legacy-new').status='VOIDED';return json({saved:true})
      }
      if(path==='/api/admin/customers/customer-1/wallets')return json({accounts:[account()],lookupStatus:'AVAILABLE',memberVerified:true,balanceKnown:true,totalFen:state.balance})
      if(path==='/api/admin/wallets/wallet-a/entries'&&method==='GET')return json({items:state.ledger,total:state.ledger.length})
      if(path==='/api/admin/wallets/wallet-a/entries'&&method==='POST'){
        assert(!readonly);const body=req.postDataJSON();state.walletPosts.push(body);assert.equal(body.kind,'CONSUME');assert.equal(body.version,state.version)
        const amount=Math.round(Number(body.amount)*100);state.balance-=amount;state.version++
        state.ledger.unshift({...body,id:'new-debit',deltaFen:-amount,balanceAfterFen:state.balance,businessAt:date,operatorName:'测试人员',reversed:false})
        return json({account:account()})
      }
      unknown.push(method+' '+path);return route.fulfill({status:404,json:{message:'Unmocked API blocked'}})
    }
    const p=resolve(dist,'.'+path);assert(p===dist||p.startsWith(dist+sep));const file=extname(p)?p:resolve(dist,'index.html')
    return route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}[extname(file)]||'application/octet-stream',body:await readFile(file)})
  })
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(origin+'/admin')
  await page.getByRole('button',{name:'消费记录',exact:true}).click();const drawer=page.getByRole('dialog',{name:'消费测试会员 · 消费记录',exact:true})
  await drawer.locator(empty?'.data-empty':'.consumption-admin-record').waitFor();return {page,context,state,drawer}
}
async function settle(element){await element.evaluate(async node=>{await Promise.all(node.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))})}
try{
  const {page,context,state,drawer}=await fixture()
  try{
    await drawer.getByText('中医推拿 60 分钟',{exact:true}).waitFor();assert.match(await drawer.innerText(),/88\.50/);await drawer.getByText('订单 / 凭证：'+live.referenceNo,{exact:true}).waitFor()
    checks.push('Customer directory opens a consumption drawer showing store, project, paid amount, original order, source and status')
    for(const width of [1440,1024,390,320]){
      await page.setViewportSize({width,height:950});await settle(drawer)
      await page.waitForFunction(()=>{const box=document.querySelector('.customer-consumption-drawer [role="dialog"]')?.getBoundingClientRect();return box&&box.x>=-1&&box.right<=innerWidth+1})
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
      assert.equal(await drawer.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true)
      await page.screenshot({path:resolve(out,`drawer-${width}.png`)});checks.push(`${width}px: consumption list, filters and original order fit the screen`)
    }
    await drawer.getByRole('button',{name:'补录历史消费',exact:true}).click();const modal=page.getByRole('dialog',{name:'补录历史消费',exact:true})
    await modal.getByLabel('消费项目（客户可见）',{exact:true}).fill('扶阳悬灸 60 分钟')
    await modal.getByLabel('历史消费金额（元）',{exact:true}).fill('120.25')
    await modal.getByLabel('实际消费时间（北京时间）',{exact:true}).fill('2025-10-02T18:30')
    await modal.getByLabel('原系统订单 / 凭证编号',{exact:true}).fill('00000000000000000001234567')
    await modal.getByLabel('消费说明（客户可见，选填）',{exact:true}).fill('已核对原系统订单')
    await settle(modal);assert.equal(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true)
    await page.screenshot({path:resolve(out,'legacy-form-320.png')})
    state.failNext=true;await modal.getByRole('button',{name:'确认补录',exact:true}).click()
    await modal.getByRole('button',{name:'使用原提交标识重试',exact:true}).waitFor();assert(await modal.getByLabel('历史消费金额（元）',{exact:true}).isDisabled())
    await page.waitForTimeout(3100);await modal.getByRole('button',{name:'使用原提交标识重试',exact:true}).click();await modal.waitFor({state:'hidden'})
    assert.equal(state.historyPosts.length,2);assert.deepEqual(state.historyPosts[0],state.historyPosts[1]);assert.equal(state.historyPosts[0].businessAt,'2025-10-02T10:30:00.000Z');assert.equal(state.items.length,2);assert.equal(state.walletPosts.length,0);assert.equal(state.balance,392801)
    checks.push('Historical order is stored once after an ambiguous-response retry; long order remains text, and wallet balance is unchanged')
    const historical=drawer.locator('.consumption-admin-record').filter({hasText:'扶阳悬灸 60 分钟'})
    await historical.getByRole('button',{name:'作废历史记录',exact:true}).click();const cancellation=page.getByRole('dialog',{name:'作废历史消费记录',exact:true})
    await cancellation.getByLabel('作废原因（内部核对）',{exact:true}).fill('合成历史资料录入有误')
    await cancellation.getByRole('button',{name:'确认作废',exact:true}).click();await cancellation.waitFor({state:'hidden'});await historical.getByText('已作废',{exact:true}).waitFor()
    assert.deepEqual(state.voidPosts,[{version:1,reason:'合成历史资料录入有误'}]);assert.equal(state.balance,392801);assert.equal(await historical.getByRole('button',{name:'作废历史记录',exact:true}).count(),0)
    checks.push('Void requires a reconciliation reason and version, retains the original historical record and does not alter the balance')
    await drawer.locator('.ant-drawer-close').click();await drawer.waitFor({state:'hidden'})
    await page.getByRole('button',{name:'会员余额',exact:true}).click();const wallets=page.getByRole('dialog',{name:'消费测试会员 · 会员余额',exact:true})
    await wallets.getByRole('button',{name:'登记消费',exact:true}).click();const consume=page.getByRole('dialog',{name:'消费登记',exact:true})
    await consume.getByLabel('登记金额（元）',{exact:true}).fill('88.50');await consume.getByLabel('消费项目（客户可见）',{exact:true}).fill('中医推拿 60 分钟')
    await consume.getByLabel('消费说明（客户可见，选填）',{exact:true}).fill('使用会员储值')
    await consume.getByLabel('原始凭证 / 订单编号',{exact:true}).fill('NEW-CONSUMPTION-001');await consume.getByLabel('核对说明（仅后台可见）',{exact:true}).fill('内部核对凭证')
    await settle(consume);await page.screenshot({path:resolve(out,'new-consumption-320.png')})
    await consume.getByRole('button',{name:'确认登记',exact:true}).click();await consume.waitFor({state:'hidden'})
    assert.equal(state.walletPosts.length,1);assert.equal(state.walletPosts[0].projectName,'中医推拿 60 分钟');assert.equal(state.walletPosts[0].publicNote,'使用会员储值');assert.equal(state.walletPosts[0].note,'内部核对凭证')
    assert.equal(state.balance,383951);await wallets.getByText('消费项目：中医推拿 60 分钟',{exact:true}).waitFor();checks.push('New consumption records project and public explanation separately from internal reconciliation notes, debits once and refreshes the ledger')
  }finally{await context.close()}
  const readonly=await fixture(true)
  try{assert.equal(await readonly.drawer.getByRole('button',{name:'补录历史消费',exact:true}).count(),0);assert.equal(await readonly.drawer.getByRole('button',{name:'作废历史记录',exact:true}).count(),0);assert.equal(readonly.state.historyPosts.length,0);checks.push('Read-only branch staff can inspect scoped consumption without history or balance mutation actions')}finally{await readonly.context.close()}
  const branch=await fixture(false,false,{branch:true})
  try{
    await branch.drawer.getByRole('button',{name:'补录历史消费',exact:true}).click();const form=branch.page.getByRole('dialog',{name:'补录历史消费',exact:true})
    assert(await form.getByRole('combobox').isDisabled());await form.getByLabel('消费项目（客户可见）',{exact:true}).fill('分店历史项目')
    await form.getByLabel('历史消费金额（元）',{exact:true}).fill('20.00');await form.getByLabel('实际消费时间（北京时间）',{exact:true}).fill('2025-10-02T18:30')
    await form.getByLabel('原系统订单 / 凭证编号',{exact:true}).fill('BRANCH-LEGACY-001');await form.getByRole('button',{name:'确认补录',exact:true}).click();await form.waitFor({state:'hidden'})
    assert.equal(branch.state.historyPosts[0].storeId,'shanghai');checks.push('A branch records consumption under its own store even when the customer belongs to a different home store')
  }finally{await branch.context.close()}
  const empty=await fixture(false,true)
  try{await empty.drawer.getByText('未显示不代表没有消费，请核对原系统明细是否已迁入。',{exact:true}).waitFor();checks.push('Empty records explicitly distinguish unmigrated legacy history from no prior consumption')}finally{await empty.context.close()}
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  const report={status:'passed',createdAt:new Date().toISOString(),liveApisUsed:false,realBalancesChanged:false,checks,errors,unknown}
  await writeFile(resolve(out,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}finally{await browser.close()}
