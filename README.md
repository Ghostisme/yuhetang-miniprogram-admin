# 裕和堂管理后台与客户 H5 预览

React 19 / TypeScript / Vite。管理后台提供总部全部门店和门店独立账号视图，客户 H5 用于演示和本地预约联调。品牌配置中的实时客户页面预览共用同一套组件，因此保留在本仓库。

配套仓库：[微信原生小程序](https://github.com/Ghostisme/yuhetang-miniprogram)、[Java API 与部署](https://github.com/Ghostisme/yuhetang-miniprogram-backend)。

## 功能

- 工作台、预约列表与时段视图、前台代约、人工确认、实际老师分配、取消、改约、到店、完成和未到店。
- 总部全部门店、门店筛选及账号范围隔离；修改上海店老师后仍保留总部全店视图。老师资料、转店、休息及客户端展示开关。
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

客户预览 `http://127.0.0.1:5181/`，管理后台 `http://127.0.0.1:5181/admin`。需要其他 API 地址时复制 `.env.example` 为 `.env.local` 并调整 `API_PROXY_TARGET`。正式 H5 不提供本地模拟客户身份；微信客服在原生小程序中使用。

```powershell
npm run build
```

产物在 `dist/`。把三个仓库放在同一父目录，后端 `mvn -Prelease package` 将此目录打进 JAR；也可以用 `-Dfrontend.dist=绝对路径` 指定。部署及本地启停脚本见后端仓库。

## 回归验证

```powershell
$env:TEST_BASE_URL='http://127.0.0.1:8790'
npm run verify:audit
npm run verify:therapists
```

仅对隔离的 local 测试环境运行：脚本会创建明确标注的测试预约、执行配置或老师转店验证；审计脚本取消测试预约释放名额，老师脚本恢复修改前资料。业务审计与已取消记录保留。`verify:e2e` 是额外联调脚本，会保留一条已确认测试预约并发布内容，不能对客户正式数据运行。

截图和结果写入忽略的 `docs/screenshots/` 与 `docs/*-result.json`。源码、构建和 API 验证不代表客户微信账号登录、客服、消息或小程序审核已经完成。
