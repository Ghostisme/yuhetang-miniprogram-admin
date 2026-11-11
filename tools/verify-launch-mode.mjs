import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {serveAdmin,mockAdmin,unknown} from './admin-responsive-fixtures.mjs'

const output=resolve('backups/launch-mode');await mkdir(output,{recursive:true})
const server=await serveAdmin(),browser=await chromium.launch({channel:'msedge',headless:true})
const errors=[],checks=[]
try{
  for(const width of [360,768,1366]){
    const context=await browser.newContext({viewport:{width,height:width===1366?900:844}})
    await mockAdmin(context)
    let saved={enabled:false,revision:0,updatedAt:'',title:{zh:'温馨提示',en:'A warm reminder',ja:'ご案内'},message:{zh:'小程序正在建设中，暂仅供浏览。',en:'YU Health is under construction. Browsing is available; no valid bookings or business requests can be made. The official launch will be announced separately.',ja:'現在準備中です。閲覧のみ可能です。正式公開は公式のご案内でお知らせします。'}}
    const writes=[]
    await context.route('**/api/admin/launch-mode',async route=>{
      if(route.request().method()==='GET')return route.fulfill({json:saved})
      const data=route.request().postDataJSON();writes.push(data)
      assert.equal(data.revision,saved.revision)
      saved={...data,revision:saved.revision+1,updatedAt:new Date().toISOString()}
      return route.fulfill({json:saved})
    })
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message))
    await page.goto(server.base+'/admin');await page.locator('.ops-topbar').waitFor()
    if(await page.getByRole('button',{name:'打开管理导航',exact:true}).isVisible()){
      await page.getByRole('button',{name:'打开管理导航',exact:true}).click()
      await page.locator('.ops-mobile-navigation').getByRole('button',{name:'扩展与配置',exact:true}).click()
    }else await page.locator('.ops-sidebar').getByRole('button',{name:'扩展与配置',exact:true}).click()
    const card=page.getByRole('region',{name:'小程序上线控制'})
    await card.getByText('当前：正常使用',{exact:true}).waitFor()
    assert(await card.getByRole('button',{name:'保存上线控制',exact:true}).isDisabled())
    await card.getByRole('switch',{name:'启用建设中模式'}).click()
    await card.getByLabel('提示内容 中文',{exact:true}).fill('裕和堂小程序正在建设中，所有提交暂不生效，正式上线后另行告知。')
    assert.equal(writes.length,0,'Editing must not affect customers until saved')
    await card.getByRole('button',{name:'保存上线控制',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'开启小程序建设中模式？'});await dialog.waitFor()
    await dialog.getByRole('button',{name:'确认保存',exact:true}).click()
    await card.getByText('当前：建设中 · 仅供浏览',{exact:true}).waitFor()
    assert.equal(writes.length,1);assert.equal(saved.enabled,true)
    assert.equal(saved.message.en.includes('under construction'),true)
    await card.scrollIntoViewIfNeeded()
    const overflow=await card.evaluate(root=>({width:root.clientWidth,scroll:root.scrollWidth,doc:document.documentElement.scrollWidth,viewport:innerWidth}))
    assert(overflow.scroll<=overflow.width+1&&overflow.doc<=width+1,'Three-language settings fit the screen')
    await page.screenshot({path:resolve(output,`admin-${width}.png`)})
    await card.getByRole('switch',{name:'启用建设中模式'}).click()
    await card.getByRole('button',{name:'保存上线控制',exact:true}).click()
    await page.getByRole('dialog',{name:'恢复小程序正常使用？'}).getByRole('button',{name:'确认保存',exact:true}).click()
    await card.getByText('当前：正常使用',{exact:true}).waitFor()
    assert.equal(writes.length,2);assert.equal(saved.enabled,false)
    checks.push(`${width}: settings fit; draft does not publish; enable/edit/disable saves only after confirmation with revision checks`)
    await context.close()
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  const report={status:'passed',createdAt:new Date().toISOString(),builtIndexSha256:createHash('sha256').update(await readFile('dist/index.html')).digest('hex'),liveApisUsed:false,realMessagesSent:false,checks,errors,unknown}
  await writeFile(resolve(output,'result.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2))
}finally{await browser.close();await server.close()}
