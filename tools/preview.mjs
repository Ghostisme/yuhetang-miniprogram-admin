import {chromium} from 'playwright'
import {mkdir} from 'node:fs/promises'
await mkdir('docs/screenshots',{recursive:true})
const browser=await chromium.launch({channel:'msedge',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1080},deviceScaleFactor:1})
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:5181'
const errors=[];page.on('pageerror',e=>errors.push(e.message))
await page.goto(base+'/');await page.getByRole('button',{name:'我的预约申请',exact:false}).first().waitFor();await page.screenshot({path:'docs/screenshots/client-home-desktop.png',fullPage:true})
await page.goto(base+'/admin');await page.getByPlaceholder('请输入账号').fill('admin');await page.getByPlaceholder('请输入密码').fill('Yht@9800dev');await page.getByRole('button',{name:'登录管理后台',exact:true}).click();await page.getByRole('heading',{name:'工作台',exact:true}).waitFor();await page.screenshot({path:'docs/screenshots/admin-dashboard.png',fullPage:true})
console.log(JSON.stringify({errors,title:await page.title(),body:(await page.locator('body').innerText()).slice(0,900)}))
await browser.close()
