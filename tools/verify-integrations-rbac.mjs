import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {serveAdmin,mockAdmin,unknown} from './admin-responsive-fixtures.mjs'

// Test the built application with local API fixtures. Server authorization and
// the existing-database upgrade are separately covered by Java integration tests.
const output=resolve('backups/integrations-rbac')
await mkdir(output,{recursive:true})
const server=await serveAdmin(),browser=await chromium.launch({channel:'msedge',headless:true})
const errors=[],checks=[],requests=[],writes=[]
const builtIndexSha256=createHash('sha256').update(await readFile('dist/index.html')).digest('hex')
const configPaths=['/api/admin/integrations','/api/admin/settings','/api/admin/launch-mode','/api/admin/dianping/config']
const permissions=[
  {code:'dashboard:read',name:'查看工作台',module:'工作台'},
  {code:'roles:read',name:'查看角色',module:'权限'},
  {code:'roles:write',name:'维护角色',module:'权限',requires:['roles:read'],headquartersOnly:true},
  {code:'integrations:read',name:'查看扩展与配置（总部）',module:'扩展与配置',headquartersOnly:true},
  {code:'integrations:write',name:'维护扩展与配置（总部）',module:'扩展与配置',requires:['integrations:read'],headquartersOnly:true},
]
let passed=false

async function menu(page){
  const trigger=page.getByRole('button',{name:'打开管理导航',exact:true})
  if(await trigger.isVisible()){
    await trigger.click()
    return page.locator('.ops-mobile-navigation')
  }
  return page.locator('.ops-sidebar')
}
async function fixture(width,{name,hq=true,grants}){
  const context=await browser.newContext({viewport:{width,height:width<768?844:900}})
  await mockAdmin(context,hq)
  await context.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    requests.push({name,width,path,method:request.method()})
    if(path==='/api/admin/me')return route.fulfill({json:{id:`rbac-${name}`,name,hq,storeId:hq?'':'bailemen',roleIds:[name],permissions:grants}})
    if(path==='/api/admin/permissions')return route.fulfill({json:permissions})
    if(path==='/api/admin/roles'&&request.method()==='GET')return route.fulfill({json:[
      {id:'custom-config',name:'自定义总部岗位',dataScope:'GLOBAL',builtin:false,permissions:['dashboard:read']},
      {id:'branch-config',name:'自定义门店岗位',dataScope:'STORE',builtin:false,permissions:['dashboard:read']},
    ]})
    if(request.method()==='PUT'&&path==='/api/admin/settings'){
      writes.push({name,path,body:request.postDataJSON()})
      return route.fulfill({json:{ok:true}})
    }
    return route.fallback()
  })
  const page=await context.newPage()
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto(server.base+'/admin');await page.locator('.ops-topbar').waitFor()
  return {context,page}
}

try{
  for(const width of [360,1366]){
    for(const account of [
      {name:'ordinary-hq',grants:['dashboard:read']},
      {name:'role-admin',grants:['dashboard:read','roles:read','roles:write']},
      {name:'legacy-branch',hq:false,grants:['dashboard:read','integrations:read','integrations:write']},
    ]){
      const {context,page}=await fixture(width,account)
      const nav=await menu(page)
      assert.equal(await nav.getByRole('button',{name:'扩展与配置',exact:true}).count(),0,`${account.name}: extension menu must be hidden`)
      assert.equal(requests.filter(r=>r.name===account.name&&r.width===width&&configPaths.includes(r.path)).length,0,'Hidden configuration must not fetch sensitive settings')
      checks.push(`${width}: ${account.name} cannot see or load configuration`)
      await context.close()
    }
    for(const writable of [false,true]){
      const name=writable?'config-maintainer':'config-reader'
      const {context,page}=await fixture(width,{name,grants:['dashboard:read','integrations:read',...(writable?['integrations:write']:['imports:write'])]})
      const nav=await menu(page)
      assert.equal(await nav.getByRole('button',{name:'角色与权限',exact:true}).count(),0,'Configuration maintenance does not imply role administration')
      await nav.getByRole('button',{name:'扩展与配置',exact:true}).click()
      await page.getByText('扩展口默认关闭',{exact:true}).waitFor()
      await page.getByRole('region',{name:'小程序上线控制'}).getByText('当前：正常使用',{exact:true}).waitFor()
      const mapping=page.getByLabel('服务号模板字段 JSON',{exact:true})
      const launch=page.getByRole('switch',{name:'启用建设中模式',exact:true})
      const shared=page.getByRole('switch',{name:'允许已授权角色按完整手机号精确查询白名单字段',exact:true})
      assert.equal(await mapping.isDisabled(),!writable)
      assert.equal(await launch.isDisabled(),!writable)
      assert.equal(await shared.isDisabled(),!writable)
      assert.equal(await page.getByRole('button',{name:'保存品牌配置',exact:true}).count(),writable?1:0)
      assert.equal(await page.getByRole('button',{name:'保存上线控制',exact:true}).count(),writable?1:0)
      assert.equal(await page.getByRole('button',{name:'保存门店映射',exact:true}).count(),writable?1:0)
      assert.equal(await page.getByRole('button',{name:'保存品项映射',exact:true}).count(),writable?1:0)
      if(writable){
        await mapping.fill('{"thing10":"storeName"}')
        await page.getByRole('button',{name:'保存品牌配置',exact:true}).click()
        await page.getByText('配置已保存。',{exact:true}).waitFor()
        assert.deepEqual(writes.at(-1),{name,path:'/api/admin/settings',body:{sharedLookupEnabled:false,serviceTemplateMapping:{thing10:'storeName'},customerTemplateMapping:{name1:'customerName',date2:'time',thing3:'serviceName',thing4:'storeName',phrase5:'status'},customerReminderTemplateMapping:{thing31:'customerName',time2:'time',thing7:'serviceName',thing8:'storeName',phrase11:'status'}}})
      }else{
        assert.equal(writes.filter(w=>w.name===name).length,0)
        await page.getByText('当前仅可查看；保存配置需授予“维护扩展与配置”权限。',{exact:true}).waitFor()
      }
      await page.screenshot({path:resolve(output,`${width}-${name}.png`),animations:'disabled'})
      checks.push(`${width}: ${name} has correct template, shared lookup, launch-mode and Dianping controls`)
      await context.close()
    }
    const {context,page}=await fixture(width,{name:'role-editor',grants:['dashboard:read','roles:read','roles:write']})
    await (await menu(page)).getByRole('button',{name:'角色与权限',exact:true}).click()
    await page.locator('[data-role-id="custom-config"]').getByRole('button',{name:'配置权限',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'角色与权限点配置',exact:true})
    await dialog.getByRole('heading',{name:'扩展与配置',exact:true}).waitFor()
    const view=dialog.getByRole('switch',{name:'查看扩展与配置（总部）',exact:true})
    const edit=dialog.getByRole('switch',{name:'维护扩展与配置（总部）',exact:true})
    await edit.click()
    assert.equal(await view.getAttribute('aria-checked'),'true','Write permission includes view')
    await view.click()
    assert.equal(await edit.getAttribute('aria-checked'),'false','Revoking view also revokes write')
    await dialog.getByLabel('数据范围',{exact:true}).click()
    await page.getByRole('option',{name:'仅账号所属门店',exact:true}).click()
    assert.equal(await view.isDisabled(),true)
    assert.equal(await edit.isDisabled(),true)
    await page.screenshot({path:resolve(output,`${width}-role-permissions.png`),animations:'disabled'})
    checks.push(`${width}: separate permission group, dependency selection and branch-scope restriction`)
    await context.close()
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  passed=true
}finally{
  const report={status:passed?'passed':'failed',at:new Date().toISOString(),builtIndexSha256,liveApisUsed:false,realMessagesSent:false,checks,errors,unknown}
  await writeFile(resolve(output,'result.json'),JSON.stringify(report,null,2)+'\n')
  await browser.close();await server.close();console.log(JSON.stringify(report,null,2))
}
