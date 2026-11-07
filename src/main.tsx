import React from 'react'
import {createRoot} from 'react-dom/client'
import {App,ConfigProvider} from 'antd'
import zhCN from 'antd/locale/zh_CN'
import Admin from './Admin'
import './brand.css'
import './app.css'
import './admin-layout.css'
import './antd-admin.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfigProvider locale={zhCN} theme={{
  token:{colorPrimary:'#53704b',colorInfo:'#53704b',colorText:'#344438',colorTextSecondary:'#74806f',colorBorder:'#dce4d6',colorBgLayout:'#f5f7f3',borderRadius:6,fontFamily:'"PingFang SC", "Microsoft YaHei", sans-serif',fontSize:14,controlHeight:38},
  components:{Button:{fontWeight:500},Modal:{titleFontSize:20},Select:{optionSelectedBg:'#edf3e6'}},
}}><App><Admin/></App></ConfigProvider></React.StrictMode>)
