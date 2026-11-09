import React from 'react'
import {createRoot} from 'react-dom/client'
import {App,ConfigProvider} from 'antd'
import zhCN from 'antd/locale/zh_CN'
import Admin from './Admin'
import {adminTheme} from './admin-theme'
import './brand.css'
import './app.css'
import './admin-layout.css'
import './antd-admin.css'
import './admin-responsive.css'
import './chat-reply.css'

createRoot(document.getElementById('root')!).render(<React.StrictMode><ConfigProvider locale={zhCN} theme={adminTheme}><App><Admin/></App></ConfigProvider></React.StrictMode>)
