# 裕和堂管理后台与客户 H5 预览

React 19 / TypeScript / Vite。管理后台提供总部全部门店和门店独立账号视图，客户 H5 用于演示和本地预约联调。品牌配置中的实时客户页面预览共用同一套组件，因此保留在本仓库。

配套仓库：[微信原生小程序](https://github.com/Ghostisme/yuhetang-miniprogram)、[Java API 与部署](https://github.com/Ghostisme/yuhetang-miniprogram-backend)。

## 功能

- 工作台、预约列表与时段视图、前台代约、人工确认、实际老师分配、取消、改约、到店、完成和未到店。
- 总部全部门店、门店筛选及账号范围隔离；修改上海店老师后仍保留总部全店视图。老师资料、转店、休息及客户端展示开关。
- 品牌与内容 → 养护项目：沿用原内联表单及右侧实时预览，维护本店品项及上下架，保存后客户预约、前台代约和老师项目统一读取本店目录。
- 客户沟通：在线与微信原生客服消息，每 2 秒同步、未读提示、历史和回复、处理状态、总部未归店会话分配。
- 门店和预约规则、客户资料与私有跟进、会员标签、用户、角色及 RBAC 权限配置。
- 内容草稿与发布、三套配色、模块排序、项目和产品、空间相册、图片素材及 XLSX 导入预检、导出和审计。
- 消息中心、门店接收人绑定、浏览器通知授权与发送结果；PMS 扩展配置。
- 客户 H5 完整预约链路，选择本店老师、会员自述并明确等待人工审核；我的预约支持取消和改约。

## 本地开发

先运行 Java API，默认 `http://127.0.0.1:8790`。

```powershell
npm ci
npm run dev
```

客户预览 `http://127.0.0.1:5181/`，管理后台 `http://127.0.0.1:5181/admin`。需要其他 API 地址时复制 `.env.example` 为 `.env.local` 并调整 `API_PROXY_TARGET`。正式 H5 不提供本地模拟客户身份；在线客服在 local H5 可联调；微信原生客服通过小程序进入，回调到本后台接待，真实接入要求见后端 [说明](https://github.com/Ghostisme/yuhetang-miniprogram-backend/blob/main/docs/客服与门店品项接入.md)。

```powershell
npm run build
```

产物在 `dist/`。目前云端采用前后端分开部署：将 `dist/` 的内容部署到 1Panel 的 `mp-admin` 静态网站运行目录，由同域 `/api/` 转发到 Java 服务。后台登录地址为 `https://mp-admin.yuhetangtcm.com/admin`。前端更新只替换网站文件，Java 更新单独替换 API JAR；完整打包和升级步骤见后端仓库的 [三仓库开发与发布](https://github.com/Ghostisme/yuhetang-miniprogram-backend/blob/main/docs/三仓库开发与发布.md) 和 [1Panel 部署](https://github.com/Ghostisme/yuhetang-miniprogram-backend/blob/main/deploy/1panel/README.md)。

本地合并预览仍可将三个仓库放在同一父目录，在后端执行 `mvn -Prelease package`；自定义前端产物可用 `-Dfrontend.dist=绝对路径` 指定。

管理后台使用自适应宽度和剩余视口高度：客服列表、消息区及门店表单在各自内容区域按需滚动，避免外层页面与内容区域重复滚动。预约、客户、日志及导入等页面共用桌面布局规则；手机预览保留原有宽度。

## 回归验证

```powershell
$env:TEST_BASE_URL='http://127.0.0.1:8790'
npm run verify:audit
npm run verify:therapists
# 新增功能回归：另需 TEST_API_URL，并使用隔离 local 内存库
$env:TEST_API_URL=$env:TEST_BASE_URL
npm run verify:store-chat
# 自适应布局：通过前端开发服务的代理访问隔离测试 API
$env:VIEWPORT_BASE='http://127.0.0.1:5181'
# 测试账号密码通过 VIEWPORT_PASSWORD 指定
npm run verify:viewport
```

仅对隔离的 local 测试环境运行：脚本会创建明确标注的测试预约、执行配置或老师转店验证；审计脚本取消测试预约释放名额，老师脚本恢复修改前资料。业务审计与已取消记录保留。`verify:store-chat` 会创建测试项目、代约和客服会话，需显式提供两个测试地址。`verify:e2e` 是额外联调脚本，会保留一条已确认测试预约并发布内容，不能对客户正式数据运行。

截图和结果写入忽略的 `docs/screenshots/`、`docs/*-result.json` 和 `backups/`。源码、构建和 API 验证不代表客户微信账号登录、客服、消息或小程序审核已经完成。


总部可在「角色与权限」直接配置内置店长、前台角色，或新建角色后在「用户管理」分配给指定门店账号。「品牌与内容」的预览、本店项目查看/维护、总部草稿编辑/发布分别授权；原表单及手机预览保留。角色变更使关联账号旧登录立即失效，重新登录后按新权限显示菜单并校验 API。共享角色影响所有关联账号，单店差异授权请使用自定义门店角色。V3 只调整权限名称和分组，不恢复已撤销授权。

消息中心按 PC、微信个人消息、短信三类渠道管理；按门店开关、配置接收人和筛选记录，继续由总部 RBAC 授权。短信默认关闭，腾讯云短信凭证和正式模板配置见 [三类消息通知接入](docs/三类消息通知接入.md)。升级保留已有角色授权和业务数据。

大众点评第一批支持客户与订单 / 预约记录：总部在“扩展与配置”维护门店及本店项目映射，在“资料导入”下载 XLSX 模板、预检并确认导入；客户进入现有客户档案，订单在“预约管理 → 大众点评订单”按门店隔离查看，确认到店时间后再生成本店预约。支持重复去重、版本更新、导入批次和关联预约核对；自动同步适配入口已预留，尚未连接平台。操作及模板字段见 [大众点评数据导入](docs/dianping-integration.md)，独立测试库浏览器回归命令为 `npm run verify:dianping`。
