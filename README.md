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

操作按钮、输入框、下拉框、弹窗、分页、状态标签、开关统一使用 Ant Design，保留裕和堂配色。统计、图片、会话等可点击卡片采用内容布局，避免被操作按钮的固定高度挤压；主题集中在 `src/admin-theme.ts`，普通控件与品牌预览分别设置样式。桌面布局占满可用宽度和高度；客服限制在工作区内滚动，门店设置分为“门店资料 / 预约规则 / 临时安排”三个页签。

后台按手机（小于 768px）、平板（768–1023px）、桌面（1024px 起）布局。手机和平板使用带文字的抽屉导航；手机预约列表为信息卡片，客户、通知、导入和日志表格逐行显示字段标签；平板和桌面表格可在自己的区域内滚动。手机预约详情先展示预约摘要和处理区，长内容在弹窗内滚动。手机客服先显示会话列表，点选后进入聊天，返回保留当前草稿；聊天未展示时新消息不会自动标为已读。高度缩小时继续保留回复区。断点与布局样式集中在 `src/admin-responsive.css`，页面权限及门店数据范围由原接口控制。

预约管理、客户档案、调理师、客户沟通、门店与时段、品牌与内容、图片素材、用户及 RBAC、通知、资料导入和日志沿用现有接口。养护项目继续在原“品牌与内容”模块维护，各门店权限和数据范围仍由后端校验。客服默认约 5 秒同步并增加随机间隔；微信消息需另行完成真实平台配置。

客服按“待接入 → 接待中 → 已结束”管理。员工先点击“接入会话”成为本次接待人，才能回复或结束；其他员工只能查看，交接需先退回待接入。结束前二次确认，结束后历史只读，不能重新打开；客户再次咨询会创建新会话。更新需同时使用配套 Java API，步骤与验收见后端的 [客服接入和结束说明](https://github.com/Ghostisme/yuhetang-miniprogram-backend/blob/main/docs/客服会话接入与结束.md)。

## 独立构建和发布

```powershell
npm run build
npm run package:release
# 可指定唯一发布编号
npm run package:release -- --release-id 20261107-180000
```

`dist/` 是静态网站文件，`releases/` 生成 ZIP 及 SHA256。ZIP 根目录直接含 `index.html`、`assets/`、`media/`，普通文件权限为 `0644`，供 OpenResty 读取。打包只读取本仓库，不要求 Java 或小程序工程存在。需要 Python 3.11+ 执行打包脚本。

云端入口为 `https://mp-admin.hetuonian.cn/admin`。将文件发布到现有 1Panel `mp-admin` 静态网站，保留原 SSL、域名和 `/api/` 代理。前端接口使用同源相对路径，无须因域名变更重新打包。只更新后台页面无需重启 Java 或发布小程序；首次安装和接口升级参见后端的 [1Panel 部署文档](https://github.com/Ghostisme/yuhetang-miniprogram-backend/blob/main/deploy/1panel/README.md)。

## 整体更新与资料补缺

`python -B tools/package-unified.py` 将已经验证的 Java、后台前端、Taro 小程序/H5 和初始化资料整理成一个总包。总包的 `update.sh` 更新服务器程序，`initialize.py --apply` 用总部管理员账号补齐缺少的门店、各店独立品项、品牌素材和带“示例”标识的调理师。两者入口独立，资料补缺无需重启服务；已有门店相册、品项价格/上下架和人员资料保留。完整操作、备份和验收见 [总包部署说明](deploy/unified/README.md)。

## 验证

```powershell
npm run typecheck
# 初始化保留规则与更新失败恢复；均不连接线上
python -B tools/test_missing_initial_data.py
python -B tools/test_unified_update.py
# 无需启动服务器，直接对构建产物注入接口响应
npm run verify:customer-chat
# 先在相邻小程序仓库构建 H5，再验证客户结束和发起新咨询
npm run verify:chat-customer
# 构建后检查真实静态产物，无需另外启动服务或输入业务密码
npm run build
npm run verify:responsive
# 外观和视口旧入口复用同一套检查
npm run verify:appearance
npm run verify:viewport
# 多行编辑器及服务号菜单使用独立内存响应回归
npm run verify:list-editors
npm run verify:wechat-menu
```

多端检查使用 Microsoft Edge 的 Playwright 无头浏览器读取 `dist/`，覆盖 360 / 390 / 430 / 768 / 1024 / 1366 / 1920 / 2560 宽度、15 个管理模块、总部和门店账号，以及设置页签、长表单、预约确认和客服回复。另测店长微信预约详情链接、登录短屏、聊天高度 640/500px 和隐藏会话的已读边界。检查整页溢出、表格可用高度、操作尺寸、弹窗与长内容滚动、导航后滚动复位和浏览器异常；保留统计及素材卡片与门店选择器的外观断言。所有 API 由 Playwright 内存响应拦截，示例预约确认及回复也只写内存；不连接业务库、不发送微信消息。截图和含构建入口校验值的结果在 `backups/admin-responsive/`。

`verify:customer-chat`、`verify:chat-customer`、`verify:list-editors` 和 `verify:wechat-menu` 也仅验证构建产物与内存响应。其余 `verify:*` 联调脚本可能创建或修改测试业务记录，只能对隔离 local 测试环境运行。截图、结果、日志、发布包和密钥不提交 Git。

本轮在独立 H2 内存库完成 Taro 预约提交、后台下拉框和客服双向收发验证；这些结果不代表真实微信消息已投递或云端部署已更新。

客户档案支持查看尚未预约的微信登录登记、已授权手机号状态、首次/最近登录时间、会员与非会员、同时包含小程序及大众点评的来源标签。总部可维护主档称呼、会员等级与共享提示；门店只维护本店私有跟进。会员和来源可组合筛选，也可按姓名、称呼或手机号搜索；查看完整电话仍需独立权限并留痕。未关联门店的客户仅总部可见。来源由登录、预约及导入自动记录，不作为手工会员判断。

运行 `npm run build` 后执行 `node tools/verify-customer-profiles.mjs` 可在无服务器、无真实客户数据的条件下检查上述页面。结果与截图位于 `backups/customer-profiles/`；自动化只使用编译产物与模拟接口。
