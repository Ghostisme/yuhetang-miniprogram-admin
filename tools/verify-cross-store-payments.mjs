import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'

// Isolated compiled-UI verification. No real accounts, payments or WeChat calls.
const origin='http://127.0.0.1:5186',dist=resolve('dist'),output=resolve('backups/cross-store-payments')
const id='YHT-CROSS-STORE-FIXTURE',checks=[],errors=[],unknown=[],contexts=[]
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true})
async function fixture({readonly=false,noPermission=false,member=true,closed=false,width=1440,failOnce=false}={}){
  const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context);context.setDefaultTimeout(10000)
  const booking={id,storeId:'shanghai',storeName:'上海中心店',serviceId:'care-1',serviceName:'对症调理',customerName:'跨店测试客户',phone:'139****3001',bookingDate:'2030-01-02',startTime:'15:00',headcount:1,status:closed?'CANCELLED':'CONFIRMED',version:3,memberClaim:'YES',visitedClaim:'NO',source:'MINIPROGRAM',history:[],membership:{memberVerified:member,memberGrade:member?'金卡':'',memberStoreId:member?'yuyao':'',memberStoreName:member?'余姚路店':'',serviceStoreId:'shanghai',crossStore:member,status:member?'MEMBER':'NON_MEMBER',verificationMethod:'WECHAT_PHONE'}}
  const state={payment:{id:'payment-fixture',appointmentId:id,serviceStoreId:'shanghai',memberStoreId:member?'yuyao':null,amountFen:null,currency:'CNY',channel:'UNSELECTED',status:closed?'CLOSED':'UNPRICED',settlementStatus:'NOT_STARTED',version:1,mode:'RESERVATION_ONLY',canPay:false,paymentEnabled:false},attempts:[],failed:false,calls:[]}
  const permissions=['appointments:read',...(!noPermission?['payments:read',...(!readonly?['payments:write']:[])]:[])]
  await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','cross-store-fixture'))
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method()
    if(url.origin!==origin){unknown.push(url.origin+path);return route.abort()}
    if(path.startsWith('/api/')){
      state.calls.push(method+' '+path)
      const json=(data,status=200)=>route.fulfill({status,json:data})
      if(path==='/api/runtime')return json({developmentLogin:false})
      assert.equal(req.headers().authorization,'Bearer cross-store-fixture')
      if(path==='/api/admin/me')return json({id:'fixture-manager',name:'测试店长',hq:false,storeId:'shanghai',roleIds:[],permissions})
      if(path==='/api/admin/stores')return json([{id:'shanghai',name:'上海中心店',enabled:true}])
      if(path==='/api/admin/appointments')return json({items:[booking],total:1,page:1})
      if(path===`/api/admin/appointments/${id}`)return json(booking)
      if(path===`/api/admin/appointments/${id}/payment`){
        assert(!noPermission)
        if(method==='GET')return json(state.payment)
        assert.equal(method,'PUT');assert(!readonly&&!closed)
        const body=req.postDataJSON(),key=req.headers()['idempotency-key'];assert(key)
        state.attempts.push({body,key})
        if(failOnce&&!state.failed){state.failed=true;return json({message:'连接中断，请核实后重试'},502)}
        assert.equal(body.version,state.payment.version);assert.equal(body.appointmentVersion,booking.version)
        state.payment={...state.payment,...body,version:state.payment.version+1,status:body.amountFen==null?'UNPRICED':'RESERVED',settlementStatus:body.channel==='MEMBER_BALANCE'?'RULES_PENDING':'NOT_STARTED'}
        return json(state.payment)
      }
      unknown.push(method+' '+path);return json({message:'Unmocked API blocked'},404)
    }
    const pathName=resolve(dist,'.'+path);assert(pathName===dist||pathName.startsWith(dist+sep))
    const file=extname(pathName)?pathName:resolve(dist,'index.html')
    return route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}[extname(file)]||'application/octet-stream',body:await readFile(file)})
  })
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
  await page.goto(origin+'/admin?appointment='+id)
  await page.getByRole('dialog',{name:'预约详情与处理'}).waitFor()
  if(!noPermission)await page.getByRole('textbox',{name:'门店确认总金额',exact:true}).waitFor()
  await page.getByRole('dialog').evaluate(async element=>{await Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))})
  return {page,state,panel:page.locator('.payment-reservation')}
}
async function channel(page,name){await page.getByRole('combobox',{name:'后续结算方式',exact:true}).click();await page.getByRole('option',{name,exact:true}).click()}
try{
  const member=await fixture({failOnce:true}),{page,panel,state}=member
  await page.getByText('会员跨店预约',{exact:true}).waitFor()
  await page.getByText('余姚路店',{exact:true}).waitFor()
  assert.equal(await panel.getByText('未开通支付',{exact:true}).count(),1)
  const amount=panel.getByRole('textbox',{name:'门店确认总金额',exact:true})
  await amount.fill('0');await panel.getByRole('button',{name:'保存结算意向',exact:true}).click()
  await panel.getByRole('alert').filter({hasText:'金额范围'}).waitFor();assert.equal(state.attempts.length,0)
  await amount.fill('250.019');await panel.getByRole('button',{name:'保存结算意向',exact:true}).click()
  await panel.getByRole('alert').filter({hasText:'最多两位小数'}).waitFor();assert.equal(state.attempts.length,0)
  checks.push('Invalid or over-precision amounts never reach the reservation API')
  await amount.fill('250.01');await channel(page,'会员储值（预留）')
  await panel.getByText('会员归属：余姚路店；接待：上海中心店。跨店储值分摊与划账规则待配置。',{exact:true}).waitFor()
  await panel.getByRole('button',{name:'保存结算意向',exact:true}).click()
  await panel.getByRole('alert').filter({hasText:'连接中断'}).waitFor()
  await panel.getByRole('button',{name:'保存结算意向',exact:true}).click()
  await panel.getByText('已登记结算意向',{exact:true}).waitFor()
  assert.equal(state.attempts.length,2);assert.deepEqual(state.attempts[0],state.attempts[1])
  assert.equal(state.payment.amountFen,25001);assert.equal(state.payment.channel,'MEMBER_BALANCE');assert.equal(state.payment.settlementStatus,'RULES_PENDING')
  checks.push('Cross-store quote sends exact integer cents and preserves the idempotency key after an uncertain connection')
  await channel(page,'微信支付（预留）')
  const saved=page.waitForResponse(response=>response.request().method()==='PUT')
  await panel.getByRole('button',{name:'保存结算意向',exact:true}).click();await saved
  assert.equal(state.payment.channel,'WECHAT_PAY');assert(!state.calls.some(call=>call.includes('/payment/start')))
  await page.screenshot({path:resolve(output,'member-cross-store-1440.png'),fullPage:true})
  checks.push('Both payment choices only register an intention; no payment-start request or deduction button exists')
  const read=await fixture({readonly:true,width:390})
  assert.equal(await read.panel.getByRole('button',{name:'保存结算意向',exact:true}).count(),0)
  assert(await read.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await read.page.screenshot({path:resolve(output,'member-cross-store-readonly-390.png')})
  const hidden=await fixture({noPermission:true})
  assert.equal(await hidden.page.locator('.payment-reservation').count(),0);assert(!hidden.state.calls.some(call=>call.endsWith('/payment')))
  checks.push('Read-only and no-permission accounts do not receive writable controls; mobile detail fits the viewport')
  const nonmember=await fixture({member:false})
  await nonmember.page.getByRole('combobox',{name:'后续结算方式',exact:true}).click()
  assert.equal(await nonmember.page.getByRole('option',{name:'会员储值（预留）',exact:true}).getAttribute('aria-disabled'),'true')
  const closed=await fixture({closed:true})
  assert.equal(await closed.panel.getByRole('button',{name:'保存结算意向',exact:true}).count(),0)
  checks.push('Unverified nonmembers cannot select member balance; cancelled appointments cannot reopen a quote')
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  await writeFile(resolve(output,'result.json'),JSON.stringify({status:'passed',liveApisUsed:false,realPaymentsUsed:false,checks,errors,unknown},null,2)+'\n')
  console.log(JSON.stringify({status:'passed',checks},null,2))
}finally{for(const context of contexts)await context.close();await browser.close()}
