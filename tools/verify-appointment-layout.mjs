import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {chromium} from 'playwright'
import {serveAdmin,mockAdmin,unknown} from './admin-responsive-fixtures.mjs'

// Measure the production UI, including portal styles and the browser's native date control.
// Every API is intercepted; phone disclosure and appointment changes stay in fixtures.
const output=resolve('backups/appointment-layout'),results=[],errors=[]
await mkdir(output,{recursive:true})
const server=await serveAdmin(),browser=await chromium.launch({channel:'msedge',headless:true})
const builtIndexSha256=createHash('sha256').update(await readFile('dist/index.html')).digest('hex')
let passed=false
try {
  for(const [width,height] of [[360,780],[390,844],[600,900],[768,1024],[1024,768],[1440,1160],[1920,1080]]) {
    const context=await browser.newContext({viewport:{width,height}})
    try {
      await mockAdmin(context)
      await context.route('**/api/admin/appointments/*/phone',route=>route.fulfill({json:{phone:'13800000000'}}))
      const page=await context.newPage()
      page.on('pageerror',error=>errors.push(error.message))
      await page.goto(server.base+'/admin?appointment=YHT-APPOINTMENT-2')
      const dialog=page.getByRole('dialog',{name:'预约详情与处理'})
      await dialog.getByLabel('门店确认总金额',{exact:true}).waitFor()
      await dialog.evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{})))})
      const metrics=await dialog.evaluate(el=>{
        const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}
        const textRect=e=>{const range=document.createRange();range.selectNodeContents(e);return rect(range)}
        const dt=[...el.querySelectorAll('dt')].find(e=>e.textContent==='联系电话')
        const dd=dt.nextElementSibling
        const phone=dd.querySelector('span')||dd
        const pay=el.querySelector('.payment-reservation-fields')
        const amount=pay.querySelector('input.ant-input'),channel=pay.querySelector('.ant-select')
        const date=el.querySelector('[aria-label="后台改约日期"]')
        const time=el.querySelector('[aria-label="后台改约时段"]').closest('.ant-select')
        const submit=[...el.querySelectorAll('button')].find(e=>e.textContent==='调整并确认新时间')
        const note=submit.previousElementSibling
        const body=el.querySelector('.ant-modal-body')
        const bounds=rect(body)
        return {width:innerWidth,dialog:rect(el),phoneLabel:textRect(dt),phoneValue:textRect(phone),phoneAction:rect(dd.querySelector('button')),
          payment:{amount:rect(amount),channel:rect(channel)},reschedule:{date:rect(date),time:rect(time),note:rect(note),submit:rect(submit),noteDisplay:getComputedStyle(note).display},
          overflow:[...el.querySelectorAll('input.ant-input,.admin-select,textarea,button')].filter(e=>{
            if(e.closest('.select-validation')||e.classList.contains('ant-modal-close'))return false
            const r=rect(e);return r.width>0&&(r.x<bounds.x-1||r.right>bounds.right+1)
          }).map(e=>e.getAttribute('aria-label')||e.textContent),scrollable:body.scrollHeight>body.clientHeight}
      })
      results.push(metrics)
      assert(Math.abs(metrics.phoneLabel.y-metrics.phoneValue.y)<=1,`${width}: phone and label share a text baseline`)
      assert.equal(metrics.reschedule.noteDisplay,'block',`${width}: form help is a separate block`)
      const minimum=width<768?44:38
      for(const [name,r] of Object.entries({amount:metrics.payment.amount,channel:metrics.payment.channel,date:metrics.reschedule.date,time:metrics.reschedule.time})) {
        assert(r.height>=minimum&&r.height<=minimum+1,`${width}: ${name} uses the shared ${minimum}px control height`)
      }
      if(width>600) {
        assert(Math.abs(metrics.payment.amount.y-metrics.payment.channel.y)<=1,`${width}: payment control tops align`)
        assert(Math.abs(metrics.payment.amount.bottom-metrics.payment.channel.bottom)<=1,`${width}: payment control bottoms align`)
      }
      if(width>=768) {
        assert(Math.abs(metrics.reschedule.date.y-metrics.reschedule.time.y)<=1,`${width}: date and time controls align`)
        assert(Math.abs(metrics.reschedule.date.bottom-metrics.reschedule.time.bottom)<=1,`${width}: date and time control bottoms align`)
      }
      assert(metrics.reschedule.submit.y>=metrics.reschedule.note.bottom+8,`${width}: reschedule button has its own row below the complete help text`)
      assert.deepEqual(metrics.overflow,[],`${width}: no controls extend outside the dialog body`)
      assert(metrics.dialog.x>=0&&metrics.dialog.right<=width+1,`${width}: dialog fits the viewport`)
      if(height<1000)assert(metrics.scrollable,`${width}: long details scroll inside the dialog`)
      if(width===1440)await dialog.screenshot({path:resolve(output,'appointment-overview-1440.png'),animations:'disabled'})
      await dialog.getByRole('button',{name:'查看完整电话（留痕）',exact:true}).click()
      await dialog.getByText('13800000000',{exact:true}).waitFor()
      const revealed=await dialog.evaluate(el=>{
        const dt=[...el.querySelectorAll('dt')].find(e=>e.textContent==='联系电话'),value=dt.nextElementSibling.querySelector('span')
        const y=e=>{const range=document.createRange();range.selectNodeContents(e);return range.getBoundingClientRect().y}
        return Math.abs(y(dt)-y(value))
      })
      assert(revealed<=1,`${width}: revealing the phone keeps its label aligned`)
      await dialog.getByLabel('门店确认总金额',{exact:true}).fill('250.50')
      await dialog.getByRole('combobox',{name:'后续结算方式',exact:true}).click()
      await page.getByRole('option',{name:'微信支付（预留）',exact:true}).click()
      await dialog.getByRole('combobox',{name:'后台改约时段',exact:true}).click()
      await page.getByRole('option',{name:'14:30',exact:true}).click()
      assert(await dialog.getByRole('button',{name:'调整并确认新时间',exact:true}).isEnabled())
      // Screenshots cover the processing section first and the lower payment form separately.
      await dialog.getByRole('button',{name:'调整并确认新时间',exact:true}).scrollIntoViewIfNeeded()
      await page.screenshot({path:resolve(output,`appointment-actions-${width}.png`),animations:'disabled'})
      await dialog.getByLabel('门店确认总金额',{exact:true}).scrollIntoViewIfNeeded()
      await page.screenshot({path:resolve(output,`appointment-payment-${width}.png`),animations:'disabled'})
      console.log(`PASS ${width}x${height}: phone, payment, date/time, help/actions and dialog scrolling`)
    }finally{await context.close()}
  }
  assert.deepEqual(errors,[]);assert.deepEqual(unknown,[])
  passed=true
}finally{
  await writeFile(resolve(output,'result.json'),JSON.stringify({status:passed?'passed':'failed',builtIndexSha256,liveApisUsed:false,results,errors,unknown},null,2)+'\n')
  await browser.close();await server.close()
}
