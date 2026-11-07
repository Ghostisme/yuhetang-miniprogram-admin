# 裕和堂管理后台

React 19 + TypeScript + Vite + Ant Design 6，独立提供总部和门店管理界面。客户小程序及 H5 由 [Taro 仓库](https://github.com/Ghostisme/yuhetang-miniprogram) 编译，接口由 [Java 仓库](https://github.com/Ghostisme/yuhetang-miniprogram-backend) 提供。三个工程分别安装依赖、构建和发布。

## 开发

需要 Node.js 20.19+ 或 22.12+。先启动 Java API，再在本仓库执行：

```powershell
npm ci
npm run dev
```

打开 `http://127.0.0.1:5181/admin`；根路径 `/` 也进入后台。`.env.local` 的 `API_PROXY_TARGET` 默认 `http://127.0.0.1:8790`。`VITE_CUSTOMER_H5_URL` 可设置独立 Taro H5 预览地址；不配置时不显示外部预览链接。品牌编辑器内保留手机视觉预览，客户业务操作在 Taro 工程中维护。

## 界面与功能

操作按钮、输入框、下拉框、弹窗、分页、状态标签、开关统一使用 Ant Design，保留裕和堂配色。统计、图片、会话等可点击卡片采用内容布局，避免被操作按钮的固定高度挤压；主题集中在 `src/admin-theme.ts`，普通控件与品牌预览分别设置样式。桌面布局占满可用宽度和高度；客服限制在工作区内滚动，门店设置分为“门店资料 / 预约规则 / 临时安排”三个页签。窄屏按内容换行并折叠为单列。

预约管理、客户档案、调理师、客户沟通、门店与时段、品牌与内容、图片素材、用户及 RBAC、通知、资料导入和日志沿用现有接口。养护项目继续在原“品牌与内容”模块维护，各门店权限和数据范围仍由后端校验。客服默认约 5 秒同步并增加随机间隔；微信消息需另行完成真实平台配置。

## 独立构建和发布

```powershell
npm run build
npm run package:release
# 可指定唯一发布编号
npm run package:release -- --release-id 20261107-180000
```

`dist/` 是静态网站文件，`releases/` 生成 ZIP 及 SHA256。ZIP 根目录直接含 `index.html`、`assets/`、`media/`，普通文件权限为 `0644`，供 OpenResty 读取。打包只读取本仓库，不要求 Java 或小程序工程存在。需要 Python 3.11+ 执行打包脚本。

云端入口为 `https://mp-admin.hetuonian.cn/admin`。将文件发布到现有 1Panel `mp-admin` 静态网站，保留原 SSL、域名和 `/api/` 代理。前端接口使用同源相对路径，无须因域名变更重新打包。只更新后台页面无需重启 Java 或发布小程序；首次安装和接口升级参见后端的 [1Panel 部署文档](https://github.com/Ghostisme/yuhetang-miniprogram-backend/blob/main/deploy/1panel/README.md)。

## 验证

```powershell
npm run typecheck
# 另一个终端先运行 npm run dev；以下外观检查将所有 API 替换为浏览器内示例数据
npm run verify:appearance
$env:VIEWPORT_BASE='http://127.0.0.1:5181'
$env:VIEWPORT_PASSWORD='隔离测试环境的账号密码'
npm run verify:viewport
```

外观检查覆盖总部、门店、四种屏幕尺寸及各管理页面，并检查统计卡片、图片卡片、门店选择器和预约弹窗；所有 API 均由 Playwright 拦截，不连接业务库、不发送微信消息。可通过 `APPEARANCE_BASE` 指向本地生产构建预览，截图与结果默认在 `backups/admin-appearance/`。`verify:viewport` 使用隔离环境登录并注入长客服记录。其他 `verify:*` 联调脚本会创建或修改测试业务记录，只能对隔离 local 测试环境运行。截图、结果、日志、发布包和密钥不提交 Git。

本轮在独立 H2 内存库完成 Taro 预约提交、后台下拉框和客服双向收发验证；这些结果不代表真实微信消息已投递或云端部署已更新。
