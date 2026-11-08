# 裕和堂整体更新包 {{RELEASE_ID}}

这是一份累计版本，包含当前管理后台、Java API、Taro 小程序正式构建、H5 构建、初始化资料与消息配置工具。服务器使用同一个入口完成前后端更新，三个源码项目继续独立维护。

适用服务器：现有 Ubuntu、Docker、1Panel 环境，Java 容器 `yuhetang-java-api`，独立 MySQL 容器 `yuwatang-mysql-isolated`，管理后台域名 `mp-admin.hetuonian.cn`，网站目录 `/opt/1panel/www/sites/mp-admin/index`。这是已有系统的更新包，不是新服务器安装包。

## 1. 上传后一次更新服务器

通过腾讯云网页终端的上传按钮，以 **ubuntu 用户上传到 `/home/ubuntu`**。需要上传两个文件：

- `yuhetang-full-update-{{RELEASE_ID}}.tar.gz`
- `yuhetang-full-update-{{RELEASE_ID}}.tar.gz.sha256`

在服务器终端逐行执行下面四条。每条成功后再执行下一条：

```bash
cd /home/ubuntu
sha256sum --check yuhetang-full-update-{{RELEASE_ID}}.tar.gz.sha256
tar -xzf yuhetang-full-update-{{RELEASE_ID}}.tar.gz
sudo bash /home/ubuntu/yuhetang-full-update-{{RELEASE_ID}}/update.sh
```

如果校验显示文件不存在，先在 `/home/ubuntu` 确认两个文件的名称与上传位置；不要继续解压。若只想先检查环境，可以在第四条前执行：

```bash
sudo bash /home/ubuntu/yuhetang-full-update-{{RELEASE_ID}}/update.sh --check
```

`--check` 只校验总包、现有 Java、独立数据库、网站目录和本机 HTTPS，不构建、不备份、不重启。若你的 1Panel 网站目录确实另有名称，核对网站页面中的 root 目录后，将 `--site-root /opt/1panel/www/sites/实际代号/index` 附加在更新命令末尾。

更新前和构建后都会检查旧宿主机服务 `yuwatang-reservation.service`。它仍在运行、启动中或启用开机启动时，脚本会在暂停正常 Docker Java 之前停止更新，提示先核对并执行 `sudo systemctl disable --now yuwatang-reservation.service`。只有确认该服务是本项目旧安装时才停用；更新入口不会自行停止其他进程。切换前再次确认 8790/8791 已释放，避免两个 Java 实例争用同一端口。

更新入口按下面顺序执行：

1. 校验全部文件，将版本复制至 root 私有上传目录。
2. 保持原服务运行，构建纯 Java Docker 镜像并核对 JAR 和独立库连接目标。
3. 仅暂停本项目 Java，备份 `yuwatang_reservation` 库、应用上传文件、后台静态文件及服务器原配置。
4. 保留旧 Java 容器，启动新 Java；检查 Docker 健康状态、数据库连接和运行中 JAR。
5. 先放入新版静态资源，最后原子替换 `index.html`，保留旧哈希资源供尚未刷新的浏览器使用。
6. 通过本机 HTTPS 检查 `/api/health` 和 `/admin`，成功后显示完成信息。

该过程不安装或重建 MySQL、OpenResty、Nginx、1Panel，不更换域名、SSL 证书、密码或微信密钥。现有业务数据继续保留，数据库结构按累计 Flyway 迁移更新；初始化资料不会自动导入。Java 暂停期间接口短暂不可用，备份所需时间取决于现有业务数据和上传图片大小。

成功标志：

```text
SUCCESS: SERVER RELEASE {{RELEASE_ID}}
Image=yuhetang-java-api:{{RELEASE_ID}} Health=healthy
JAR_SHA256={{JAVA_SHA256}}
```

完成后在浏览器打开 `https://mp-admin.hetuonian.cn/admin` 并按 **Ctrl+F5** 刷新。相同版本重复执行时会核对运行镜像、JAR 和全部后台文件；如果已经一致且健康，会显示 `ALREADY ACTIVE`，不会再次重启。镜像构建成功本身不等于容器已经切换，以上成功信息才是本脚本完成切换的标志。

## 2. 备份与中断恢复

每次实际切换都会生成一个独立备份目录：

```text
/var/backups/yuhetang-unified/{{RELEASE_ID}}-时间戳/
  database.sql.gz          仅本项目业务库的逻辑备份
  uploads.tar.gz           应用上传目录
  admin.tar.gz             更新前后台文件
  config-private.tar.gz    原环境配置与独立库配置（含秘密，保持 root 私有）
  before.json              原容器 ID、镜像、库结构指纹、网站路径
  SHA256SUMS               更新前备份校验值
  completed.json           更新成功后写入
  java-startup.log         新版启动失败时保留的私有日志（0600）
```

脚本会输出实际备份路径及旧容器名。构建失败时原 Java 继续运行；备份失败时恢复原 Java。新版本失败后，先停止本次尝试的 Java，再对比数据库结构：结构未改变时自动恢复原 Java 和原 HTML；结构已改变或无法核验时保留备份、旧容器及失败容器并停止切换，输出 `RECOVERY REQUIRED`，不自动覆盖数据库。

失败容器会先关闭自动重启，保留启动日志后停止，避免持续重试占用端口。日志命中 `Port 8790/8791 was already in use` 时会直接显示端口冲突原因，完整日志只存入 root 私有备份。回退旧容器之前也检查端口和旧宿主机服务；存在其他占用者时保留容器待核对，不自动终止未知进程。

本版本包含通知 V7 和客服会话 V8 迁移。V8 允许每位客户保留多个已结束历史并限制只有一个有效会话，旧 JAR 与新约束不能视作天然兼容。MySQL DDL 不能靠应用事务自动撤销；遇到迁移失败，应保留失败日志与 `flyway_schema_history`，先核对本项目迁移及备份，再恢复匹配的数据库和代码。不要直接启动旧 JAR、删除数据库卷或恢复整个 MySQL 实例。

服务器更新过程仍需在目标 Docker/MySQL 环境实际验证；总包中的测试记录注明了本地验证范围。

## 3. 小程序与 H5

服务器更新成功后，在**本机**解压同一总包，用微信开发者工具导入：

```text
yuhetang-full-update-{{RELEASE_ID}}/client/miniprogram
```

- AppID：`wxce054e18303efb8a`。
- `project.config.json` 指向已经编译好的 `dist/weapp/`。
- API：`https://mp-admin.hetuonian.cn`，保持小程序后台合法域名配置。
- 点击“编译”，真机预览，确认后上传、设体验版，再按需要提交审核发布。
- 该目录是 Taro 编译产物，后续开发继续使用独立的 `yuhetang-miniprogram` 源码仓库，以 `npm run build:weapp` 或 `npm run build:h5` 构建。

服务器更新不会替你上传、审核或发布微信客户端。此次客户端包含客户微信授权登录页、协议确认、游客浏览、登录返回预约草稿、退出与过期登录提示，以及会话结束只读、发起新咨询和门店展示等界面，需要更新小程序客户端才能看到完整变化；以后仅修改后台文案、图片、门店品项和接口逻辑时，通常只需更新服务器或在后台编辑。

“我的预约”未登录时显示整屏门店实景，客户勾选协议后点击白色“登录”按钮直接授权；预约最后一步与“在线咨询”使用覆盖当前页面的底部授权面板。关闭面板或选择“仅浏览”保留原门店及预约草稿；登录成功后预约仍需再次确认提交。此前未明确同意的静默登录态会重新确认一次，同一微信仍关联原有客户记录。订阅消息继续单独由客户选择，不能用登录协议代替微信订阅弹窗。客户登录说明与测试范围见 `docs/小程序客户登录说明.md` 和 `validation/client-login.json`；开发测试身份的页面验收另见 `validation/client-login-development.json`，真实微信登录仍需真机验收。

`client/h5/` 同时提供 H5 构建文件，未自动发布到现有后台站点；H5 正式用户登录接入需要单独核对。

## 4. 门店与品项资料按需初始化

总包中已整理资料，`update.sh` 负责程序发布。实际数据通过 `initialize.py` 导入，输入一次总部管理员密码，依次补齐缺少的官网门店、各店独立品项、品牌内容及示例调理师：

```bash
sudo python3 -B /home/ubuntu/yuhetang-full-update-{{RELEASE_ID}}/initialize.py --apply
```

如果登录名不是 `admin`，末尾加 `--username 实际登录名`。去掉 `--apply` 可只查看缺失数量；`--validate-only` 仅检查总包数据与图片，不登录服务器。入口通过本机 `127.0.0.1:8790` 调用管理接口，密码隐藏输入且只用于登录，不修改服务器环境配置。

该入口保留所有已有门店公开字段和相册、已有门店品项价格/描述/上下架状态及已有调理师资料。只有缺少的门店和品项才创建，门店项目模式切换为独立；品牌字段仅补空缺，未发布草稿继续保留在草稿中。导入过程中暂停编辑对应资料，工具会检查并发变更，结果和备份存到 `/var/backups/yuhetang-initialize/时间戳/`。重复执行会重新匹配记录，保留之前已完成的内容。

以下三个单项工具用于需要按原资料更新字段的专项操作，日常补缺优先使用上面的统一入口。

为保留总包校验目录的完整性，先把初始化工具复制到单独的工作目录：

```bash
sudo install -d -m 0700 /root/yuhetang-data-{{RELEASE_ID}}
sudo cp -a /home/ubuntu/yuhetang-full-update-{{RELEASE_ID}}/optional-data/. /root/yuhetang-data-{{RELEASE_ID}}/
sudo -i
cd /root/yuhetang-data-{{RELEASE_ID}}
```

首次数据准备的顺序为：官网门店 → 各店独立品项 → 本地品牌与示例内容。以下操作默认只预览，输入当前总部管理账号密码即可，密码不写入命令：

```bash
python3 -B tools/initialize-official-stores.py --base-url https://mp-admin.hetuonian.cn
python3 -B tools/initialize-client-services.py --base-url https://mp-admin.hetuonian.cn
python3 -B tools/initialize-local-content.py --base-url https://mp-admin.hetuonian.cn
```

若总部登录名不是 `admin`，在相应命令后加 `--username 实际登录名`。核对某一步的预览后，再在该条命令末尾加 `--apply` 执行写入。各工具会为写入创建私有备份和报告；不要一次盲目批量执行三条 `--apply`。

| 资料 | 内容 | 导入语义 |
| --- | --- | --- |
| 官网门店 | 9 家店的公开资料和对应照片 | 创建或更新匹配门店；可能更新你已编辑的公开字段，先检查差异 |
| 各店独立品项 | 135 条门店品项，126 条价目图片已确认，9 条 PDF 补充待确认 | 每店独立维护；待确认项目保持停用，匹配品项字段可能更新 |
| 本地品牌与示例 | 首页/品牌介绍、2 个产品、2 组相册、33 张素材、27 位“示例”调理师 | 补缺，保留已有内容和示例标识；需先完成门店和独立品项 |

离线只校验文件、不连接服务器：

```bash
python3 -B tools/initialize-client-services.py --validate-only
python3 -B tools/initialize-local-content.py --validate-only
```

详细核对说明放在 `docs/` 和 `optional-data/initial-data/` 中。

## 5. 消息、客服与店长微信配置

本次累计内容包括客户订阅授权及通知、PC 站内/桌面通知、店长服务号绑定与待办提醒、客服回车发送、手动接入/交接/结束、门店相册增减行及小程序门店项目展示。

已配置的消息密钥继续使用服务器原环境文件。店长服务号配置尚缺时，可以运行交互工具：

```bash
sudo python3 -B /home/ubuntu/yuhetang-full-update-{{RELEASE_ID}}/tools/configure-staff-wechat.py
```

预置服务号 AppID：`wxf9ad4dfd7684097a`；待接单模板：`uxrBTYh7rLOfcO0GKajIKEpFeQ2OtY0prH8a9WBVxrk`；映射：`thing1=serviceName`、`time2=time`、`phone_number3=customerPhone`、`thing4=staffNotice`。AppSecret 仅在服务器隐藏输入。

工具编辑环境文件后，用同一总包重新创建 Java 以加载新配置（`docker restart` 不会重读修改后的 env 文件）：

```bash
sudo bash /home/ubuntu/yuhetang-full-update-{{RELEASE_ID}}/update.sh --reload-env
```

后台“消息中心”检查客户/店长微信配置，店长本人在微信关注服务号并确认绑定。客户订阅弹窗由微信显示；用户允许一次模板授权后才有相应发送机会，不能把一次订阅当作永久许可。模板配置存在也不代表消息已实际送达，需做一次新预约、状态变更和到店提醒的真机验收。

**客服接待方式：** 新消息先等待并提示，点击“接入会话”后才可回复，结束后历史只读；新咨询重新排队。PC 桌面提醒需在后台开启并允许浏览器通知，后台关闭后的离线推送不属于浏览器页面通知能力。

**微信官方客服工具的接待状态不与本后台双向同步。** 官方工具接入后，微信会把后续客户消息直接交给官方工具，直到客服关闭或官方规定的超时；本系统没有通过小程序客服接口控制官方工具队列和关闭历史会话的能力。若统一使用本后台接待，先在官方工具结束旧会话，并避免继续从官方工具接入。详情和官方依据见 `docs/客服接待与官方工具.md`。

## 6. 更新后核对

1. 管理后台登录、门店列表、相册增减行、各店独立品项均正常；已有门店数据没有被重置。
2. 客户发一条新的微信客服消息，后台显示“待接入”及提示；手动接入后回复，真机确认收到；结束后历史不能再次接入或回复。
3. 小程序在线咨询显示等待、接待人、结束状态；结束后发起新咨询，产生新的待接入会话。
4. 客户在预约操作中允许订阅，触发预约处理通知与到店提醒，检查发送结果及真机消息。
5. 店长完成服务号配置和绑定后，提交本店新预约，检查后台待办、桌面提示与服务号通知。

`manifest.json` 记录三个项目的源码提交、组件版本、每个文件的长度和 SHA-256；`validation/` 保留组件原测试报告和总包校验说明。运行 `python3 -B update.py --verify-only` 可离线重新校验总包。
