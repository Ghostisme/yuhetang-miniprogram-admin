import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve,sep,extname} from 'node:path'

const origin='http://127.0.0.1:5186',dist=resolve('dist'),output=resolve('backups/appointment-changes')
const id='YHT-DETAIL-FIXTURE',checks=[],errors=[],unknown=[],contexts=[]
await mkdir(output,{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true})
const tomorrow=new Date(Date.now()+86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'})
const initial={id,storeId:'shanghai',storeName:'上海中心店',serviceId:'care-1',serviceName:'对症调理',customerName:'详情测试客户',phone:'139****3001',bookingDate:tomorrow,startTime:'15:00',headcount:2,status:'CONFIRMED',version:3,memberClaim:'NO',visitedClaim:'YES',source:'MINIPROGRAM',therapistIntentName:'门店安排',assignedTherapistName:'门店安排',remark:'请安排安静房间',history:[],rescheduleRequest:{id:'change-1',status:'PENDING',statusLabel:'改约待门店处理',canReview:true,originalDate:tomorrow,originalTime:'15:00',originalHeadcount:2,requestedDate:tomorrow,requestedTime:'16:00',requestedHeadcount:2,requestNote:'希望晚一小时到店',expiresAt:new Date(Date.now()+3600000).toISOString()}}
async function fixture({signedIn=true,readonly=false,forbidden=false,width=1440,target=id}={}){
  const context=await browser.newContext({viewport:{width,height:1000}});contexts.push(context);context.setDefaultTimeout(12000)
  const state={booking:structuredClone(initial),calls:[],changes:[]}
  const permissions=['appointments:read',...(!readonly?['appointments:write','appointments:review','appointments:status','appointments:phone','therapists:read']:[])]
  if(signedIn)await context.addInitScript(()=>sessionStorage.setItem('yht-admin-token','appointment-detail-fixture'))
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method()
    if(url.origin!==origin){unknown.push(url.origin+path);return route.abort()}
    if(path.startsWith('/api/')){
      state.calls.push({path,method,query:url.search})
      const json=(data,status=200)=>route.fulfill({status,json:data})
      if(path==='/api/runtime')return json({developmentLogin:false})
      if(path==='/api/admin/login')return json({token:'appointment-detail-fixture'})
      assert.equal(req.headers().authorization,'Bearer appointment-detail-fixture')
      if(path==='/api/admin/me')return json({id:'detail-manager',name:'上海中心店店长',hq:false,storeId:'shanghai',roleIds:[],permissions})
      if(path==='/api/admin/stores')return json([{id:'shanghai',name:'上海中心店',enabled:true,onlineBooking:true}])
      if(path==='/api/admin/therapists')return json([])
      if(path==='/api/admin/appointments')return json({items:forbidden?[]:[state.booking],total:forbidden?0:1,page:1})
      if(path===`/api/admin/appointments/${id}/slots`)return json({slots:[],rules:{advanceDays:7}})
      if(path===`/api/admin/appointments/${id}/phone`){assert(!readonly);return json({phone:'13900003001'})}
      if(path===`/api/admin/appointments/${id}`){
        if(forbidden)return json({message:'预约不存在或无权访问'},404)
        if(method==='GET')return json(state.booking)
        assert.equal(method,'PATCH');assert(!readonly)
        const change=req.postDataJSON();assert.equal(change.version,state.booking.version);state.changes.push(change)
        assert(['approve_reschedule','reject_reschedule'].includes(change.action))
        const accepted=change.action==='approve_reschedule'
        if(accepted)Object.assign(state.booking,{bookingDate:state.booking.rescheduleRequest.requestedDate,startTime:state.booking.rescheduleRequest.requestedTime})
        else assert(change.note.trim())
        state.booking.rescheduleRequest={...state.booking.rescheduleRequest,status:accepted?'APPROVED':'REJECTED',statusLabel:accepted?'改约已确认':'改约未通过',canReview:false,resolutionNote:accepted?'门店已确认新时间':change.note}
        state.booking.version++;return json(state.booking)
      }
      unknown.push(method+' '+path);return json({message:'Unmocked API blocked'},404)
    }
    const full=resolve(dist,'.'+path);assert(full===dist||full.startsWith(dist+sep))
    const file=extname(full)?full:resolve(dist,'index.html')
    return route.fulfill({contentType:{'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'}[extname(file)]||'application/octet-stream',body:await readFile(file)})
  })
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
  await page.goto(origin+'/admin?appointment='+encodeURIComponent(target))
  return {page,state}
}
const dialog=page=>page.getByRole('dialog',{name:'预约详情与处理'})
async function detail(page){await dialog(page).waitFor();await dialog(page).getByRole('heading',{name:'详情测试客户 · 对症调理'}).waitFor()}
try{
  const login=await fixture({signedIn:false,width:390})
  await login.page.getByText('登录后继续查看该预约详情。',{exact:true}).waitFor()
  await login.page.getByPlaceholder('请输入账号',{exact:true}).fill('store-manager')
  await login.page.getByPlaceholder('请输入密码',{exact:true}).fill('fixture-only-password')
  await login.page.getByRole('button',{name:'登录管理后台',exact:true}).click();await detail(login.page)
  assert.equal(new URL(login.page.url()).searchParams.get('appointment'),id)
  assert(login.state.calls.some(c=>c.path===`/api/admin/appointments/${id}`))
  checks.push('Staff message opens the exact appointment after login while preserving the target identifier')
  const mobile=dialog(login.page)
  await mobile.getByText('139****3001',{exact:false}).waitFor()
  await mobile.getByRole('button',{name:'查看完整电话（留痕）'}).click();await mobile.getByText('13900003001',{exact:false}).waitFor()
  await mobile.getByText('请安排安静房间',{exact:true}).waitFor()
  assert.equal(await mobile.locator('.reschedule-comparison strong').allTextContents().then(values=>values.join('|')),`${tomorrow} 15:00|${tomorrow} 16:00`)
  assert(await login.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await mobile.screenshot({path:resolve(output,'staff-appointment-mobile-390.png')})
  checks.push('Mobile detail shows store, service, customer, audited phone, current/requested times and notes without horizontal overflow')
  await mobile.getByRole('button',{name:'改约未通过，保留原预约',exact:true}).click()
  await mobile.getByRole('alert').filter({hasText:'请填写未通过原因'}).waitFor();assert.equal(login.state.changes.length,0)
  await mobile.getByLabel('处理说明',{exact:true}).fill('新时间无空房，请按原时间到店。')
  await mobile.getByRole('button',{name:'改约未通过，保留原预约',exact:true}).click()
  await mobile.getByText('改约未通过',{exact:true}).waitFor();assert.equal(login.state.booking.startTime,'15:00')
  checks.push('Rejecting a change requires a reason and retains the original confirmed appointment')
  const approve=await fixture();await detail(approve.page)
  await dialog(approve.page).screenshot({path:resolve(output,'staff-appointment-desktop-1440.png')})
  await dialog(approve.page).getByRole('button',{name:'确认改约并通知客户',exact:true}).click()
  await dialog(approve.page).getByText('改约已确认',{exact:true}).waitFor()
  assert.equal(approve.state.booking.startTime,'16:00');assert.equal(approve.state.booking.status,'CONFIRMED');assert.equal(approve.state.changes.length,1)
  checks.push('Approving a change uses the current version and refreshes the detail with the confirmed new time')
  await dialog(approve.page).locator('.ant-modal-close').click()
  await approve.page.getByLabel('预约状态',{exact:true}).click()
  const filtered=approve.page.waitForResponse(r=>new URL(r.url()).searchParams.get('status')==='RESCHEDULE_PENDING')
  await approve.page.getByRole('option',{name:'改约待处理',exact:true}).click()
  await filtered
  checks.push('Appointments can be filtered by pending reschedule requests independently of the original confirmed status')
  const readonly=await fixture({readonly:true});await detail(readonly.page)
  assert.equal(await dialog(readonly.page).getByRole('button',{name:'确认改约并通知客户',exact:true}).count(),0)
  assert.equal(await dialog(readonly.page).getByRole('button',{name:'查看完整电话（留痕）'}).count(),0)
  assert.equal(readonly.state.changes.length,0)
  checks.push('Read-only users can view details without receiving review or full-phone controls')
  const foreign=await fixture({forbidden:true})
  await foreign.page.getByText('预约不存在或无权访问',{exact:true}).waitFor()
  assert.equal(await dialog(foreign.page).count(),0);assert.equal(await foreign.page.getByText('详情测试客户',{exact:true}).count(),0)
  checks.push('A link to an inaccessible appointment stays blocked and does not display customer details')
  const invalid=await fixture({target:'https://outside.invalid/private'})
  await invalid.page.getByRole('button',{name:'预约管理',exact:true}).waitFor()
  assert(!invalid.state.calls.some(c=>c.path.includes('outside.invalid')))
  checks.push('Malformed message targets are ignored and cannot become an external redirect or appointment request')
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  await writeFile(resolve(output,'result.json'),JSON.stringify({status:'passed',liveApisUsed:false,checks,errors,unknown},null,2)+'\n')
  console.log(JSON.stringify({status:'passed',checks},null,2))
}finally{for(const c of contexts)await c.close();await browser.close()}
