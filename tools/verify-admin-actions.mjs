import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {serveAdmin,mockAdmin,unknown} from './admin-responsive-fixtures.mjs'

// Exercise the built application, including the widths around both navigation breakpoints.
// All requests stay in the local fixture, including search, refresh and export.
const output=resolve('backups/admin-actions')
await mkdir(output,{recursive:true})
const server=await serveAdmin(),browser=await chromium.launch({channel:'msedge',headless:true})
const sizes=[[320,740],[360,780],[576,800],[768,1024],[834,1112],[1023,768],[1024,768],[1100,768],[1101,768],[1366,768],[1920,1080]]
const results=[],errors=[]
let passed=false
const buildSha256=createHash('sha256').update(await readFile('dist/index.html')).digest('hex')

async function navigate(page,id,label){
  await page.locator('.operations .ops-topbar').waitFor()
  if(await page.getByRole('button',{name:'打开管理导航',exact:true}).isVisible()){
    await page.getByRole('button',{name:'打开管理导航',exact:true}).click()
    await page.locator('.ops-mobile-navigation').getByRole('button',{name:label,exact:true}).click()
    await page.locator('.ops-mobile-navigation').waitFor({state:'hidden'})
  }else await page.locator('.ops-sidebar').getByRole('button',{name:label,exact:true}).click()
  await page.locator(`.ops-main[data-page="${id}"]`).waitFor()
  await page.waitForTimeout(200)
}

async function inspectGroups(page,name){
  const layout=await page.evaluate(()=>{
    const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
    const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}
    return {
      documentWidth:document.documentElement.scrollWidth,
      viewport:innerWidth,
      groups:[...document.querySelectorAll('.card-heading > .button-row,.content-toolbar > .button-row,.wm-toolbar-actions,.member-wallet-toolbar > .button-row,.consumption-admin-toolbar > .button-row')].filter(visible).map(e=>({
        group:rect(e),bar:rect(e.parentElement),gap:parseFloat(getComputedStyle(e).columnGap)||0,
        buttons:[...e.children].filter(visible).map(n=>({text:n.getAttribute('aria-label')||n.textContent,...rect(n)}))
      })),
      headings:[...document.querySelectorAll('.card-heading')].filter(visible).map(e=>({
        heading:rect(e),text:e.firstElementChild?.tagName==='DIV'?rect(e.firstElementChild):null,
        actions:[...e.children].slice(1).filter(visible).map(rect)
      }))
    }
  })
  assert(layout.documentWidth<=layout.viewport+1,`${name}: horizontal page overflow`)
  for(const group of layout.groups){
    const needed=group.buttons.reduce((sum,b)=>sum+b.width,0)+Math.max(0,group.buttons.length-1)*group.gap
    assert(group.group.width>=Math.min(needed,group.bar.width)-2,`${name}: action group shrank and split its buttons`)
    if(needed<=group.bar.width+1&&group.buttons.length>1){
      const [first,...rest]=group.buttons
      for(const button of rest)assert(Math.abs(first.y+first.height/2-button.y-button.height/2)<=1,`${name}: adjacent actions must align`)
    }
    for(const button of group.buttons)assert(button.x>=group.bar.x-1&&button.right<=group.bar.right+1,`${name}: action leaves its toolbar`)
  }
  for(const heading of layout.headings){
    for(const action of heading.actions){
      assert(action.x>=heading.heading.x-1&&action.right<=heading.heading.right+1,`${name}: heading action is clipped`)
      if(heading.text)assert(!(action.x<heading.text.right-1&&action.right>heading.text.x+1&&action.y<heading.text.bottom-1&&action.bottom>heading.text.y+1),`${name}: description overlaps its actions`)
    }
  }
  results.push({name,...layout})
}

try{
  for(let offset=0;offset<sizes.length;offset+=3){
    const batch=await Promise.allSettled(sizes.slice(offset,offset+3).map(async([width,height])=>{
      const context=await browser.newContext({viewport:{width,height},hasTouch:width<1024})
      await mockAdmin(context)
      const customerRequests=[],exports=[]
      await context.route('**/api/admin/customers**',route=>{
        const url=new URL(route.request().url())
        if(url.pathname!=='/api/admin/customers')return route.fallback()
        customerRequests.push(url.search)
        return route.fulfill({json:{items:Array.from({length:12},(_,i)=>({
          id:`customer-${i}`,name:i?'示例客户长姓名测试':'待完善称呼',phone:i?'138****0000':'',
          memberVerified:i%2===1,memberGrade:'银卡会员',memberStoreName:'上海中心店',
          storeId:i?'bailemen':'',privateNote:i?'到店前请联系确认养护项目和时间。':'',
          source:'MINIPROGRAM',sources:i%2?['MINIPROGRAM','DIANPING']:['MINIPROGRAM'],
          phoneAuthorized:!!i,profileComplete:!!i,firstLoginAt:'2026-11-10T14:10:00+08:00',lastLoginAt:'2026-11-10T14:12:00+08:00'
        })),total:211}})
      })
      await context.route('**/api/admin/exports/customers**',route=>{
        exports.push(new URL(route.request().url()).search)
        return route.fulfill({contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',body:Buffer.from('local-export-fixture')})
      })
      const page=await context.newPage()
      page.on('pageerror',error=>errors.push(error.message))
      await page.goto(server.base+'/admin')
      await navigate(page,'customers','客户档案')
      await page.locator('.customer-directory tbody tr').first().waitFor()
      await inspectGroups(page,`${width}-customers`)
      const filters=await page.locator('.customer-filters').evaluate(e=>{
        const box=e.getBoundingClientRect()
        return [...e.children].map(n=>{const r=n.getBoundingClientRect();return {label:n.getAttribute('aria-label')||n.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom,leftBound:box.left,rightBound:box.right}})
      })
      for(const field of filters)assert(field.x>=field.leftBound-1&&field.right<=field.rightBound+1,`${width}: filter is clipped`)
      for(let i=0;i<filters.length;i++)for(const field of filters.slice(i+1)){
        const current=filters[i]
        assert(!(current.x<field.right-1&&current.right>field.x+1&&current.y<field.bottom-1&&current.bottom>field.y+1),`${width}: filters overlap`)
      }
      if(width<1024){
        assert(await page.locator('.customer-directory .table-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1),`${width}: customer details require sideways scrolling`)
        for(const action of await page.locator('.customer-directory .customer-row-actions').evaluateAll(rows=>rows.map(e=>e.getBoundingClientRect().toJSON()))){
          assert(action.x>=0&&action.right<=width,`${width}: customer actions are offscreen`)
        }
      }else{
        const table=page.locator('.customer-directory .table-scroll')
        await table.evaluate(e=>e.scrollLeft=e.scrollWidth)
        assert(await page.locator('.customer-directory tbody tr').first().getByRole('button',{name:'维护档案',exact:true}).isVisible())
        await table.evaluate(e=>e.scrollLeft=0)
      }
      const beforeRefresh=customerRequests.length
      const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/customers')
      await page.getByRole('button',{name:'刷新客户档案',exact:true}).click()
      await refreshed
      assert(customerRequests.length>beforeRefresh,'Refresh must reload customer data')
      const query='测试客户'
      await page.getByRole('textbox',{name:'搜索客户',exact:true}).fill(query)
      const search=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/admin/customers'&&new URL(r.url()).searchParams.get('search')===query)
      await page.locator('.customer-filters').getByRole('button',{name:'搜索',exact:true}).click()
      await search
      const download=page.waitForEvent('download')
      await page.locator('.customer-directory .card-heading').getByRole('button',{name:'导出',exact:true}).click()
      await download
      assert.equal(exports.length,1,'One export click must download exactly once')
      await page.screenshot({path:resolve(output,`${width}-customers.png`),animations:'disabled'})
      for(const [id,label] of [['appointments','预约管理'],['chats','客户沟通'],['content','品牌与内容'],['wechat-menu','服务号菜单'],['notifications','消息中心'],['integrations','扩展与配置']]){
        await navigate(page,id,label)
        await inspectGroups(page,`${width}-${id}`)
      }
      await context.close()
      console.log(`PASS ${width}x${height}: grouped actions, customer filters/cards and refresh/search/export`)
    }))
    for(const result of batch)if(result.status==='rejected')throw result.reason
  }
  assert.deepEqual(unknown,[],'All API calls must be local fixtures')
  assert.deepEqual(errors,[],'No browser exceptions')
  passed=true
}finally{
  await writeFile(resolve(output,'result.json'),JSON.stringify({status:passed?'passed':'failed',builtIndexSha256:buildSha256,viewports:sizes,results,errors,unknown,liveApisUsed:false},null,2))
  await browser.close()
  await server.close()
}
console.log(`PASS ${results.length} page/viewport checks. Screenshots: ${output}`)
