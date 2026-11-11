"""Bundle verified customer layout, member synchronization and cumulative features."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import xml.etree.ElementTree as ET
import zipfile

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location('components',ROOT/'tools/package-unified.py')
COMP=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMP)
require=COMP.require
sha=lambda value:hashlib.sha256(value).hexdigest()


def source(repo):
    files=[path for path in (repo/'src').rglob('*') if path.is_file()]
    if (repo/'config').is_dir():files.extend(path for path in (repo/'config').rglob('*') if path.is_file())
    for name in ('pom.xml','package.json','package-lock.json','vite.config.ts','babel.config.js','tsconfig.json'):
        if (repo/name).is_file():files.append(repo/name)
    return dict(commit=COMP.git(repo,'rev-parse','HEAD'),workingTreeDirty=bool(COMP.git(repo,'status','--porcelain')),
                files={path.relative_to(repo).as_posix():sha(path.read_bytes()) for path in sorted(files)})


def report(repo,name):
    path=repo/name
    data=json.loads(path.read_text(encoding='utf-8'))
    require(data.get('status')=='passed' and not data.get('errors') and not data.get('unknown')
            and not data.get('liveApisUsed',False),'Missing passing isolated validation: '+name)
    return path.read_bytes(),data


def python_tests(name):
    result=subprocess.run([sys.executable,'-B','-X','utf8',str(ROOT/'tools'/name)],capture_output=True,encoding='utf-8')
    require(result.returncode==0,result.stdout+result.stderr)
    return (result.stdout+result.stderr).encode('utf-8')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-id',required=True)
    parser.add_argument('--backend-repo',type=Path,default=ROOT.parent/'yuhetang-miniprogram-backend')
    parser.add_argument('--miniprogram-repo',type=Path,default=ROOT.parent/'yuhetang-miniprogram')
    parser.add_argument('--include-working-changes',action='store_true',help='Record hashes of explicitly included, tested local member/login changes')
    args=parser.parse_args();release=args.release_id;backend=args.backend_repo.resolve();mini=args.miniprogram_repo.resolve()
    require(re.fullmatch(r'\d{8}-\d{6}',release),'Invalid release ID')
    sources={name:source(repo) for name,repo in (('admin',ROOT),('java',backend),('miniprogram',mini))}
    require(args.include_working_changes or not any(value['workingTreeDirty'] for value in sources.values()),'Commit sources or explicitly include and record tested working changes')
    java=COMP.read_tar(backend/f'releases/yuhetang-java-docker-{release}.tar.gz',f'yuhetang-java-docker-{release}/')
    admin=COMP.read_zip(ROOT/f'releases/yuhetang-admin-{release}.zip')
    validation=json.loads(java['validation.json']);counts=validation['backendTests']
    require(counts['tests']>=254 and not any(counts[name] for name in ('failures','errors','skipped')),'The complete backend regression suite must pass')
    require(validation['sourceCommit']==sources['java']['commit'],'The backend commit changed after packaging')
    require(sha(java['reservation.jar'])==validation['backendJarSha256'],'JAR checksum mismatch')
    with zipfile.ZipFile(io.BytesIO(java['reservation.jar'])) as archive:
        for name in ('ChatAttachments','ChatCustomers','MemberWallets','ConsumptionRecords','ConsumptionApi','Ku52MemberSync','Ku52SyncApi'):
            require(f'BOOT-INF/classes/com/yuwatang/reservation/{name}.class' in archive.namelist(),'Missing cumulative feature: '+name)
        require('BOOT-INF/classes/db/migration/V15__chat_attachments.sql' in archive.namelist(),'Missing attachment migration')
        require('BOOT-INF/classes/db/migration/V14__member_balance_and_service_lookup.sql' in archive.namelist(),'Do not downgrade the deployed member schema')
        require('BOOT-INF/classes/db/migration/V16__customer_consumption_records.sql' in archive.namelist(),'Keep the cumulative consumption feature')
        require('BOOT-INF/classes/db/migration/V17__ku52_member_read_model.sql' in archive.namelist(),'Include card and consumption synchronization schema')
    for name,value in admin.items():
        if name!='SHA256SUMS':require(value==(ROOT/'dist'/name).read_bytes(),'Admin component differs from current build: '+name)
    COMP.built_after_sources(ROOT,ROOT/'dist/index.html')
    payload={prefix+name:value for prefix,files in (('server/java/',java),('server/admin/',admin)) for name,value in files.items()}
    for path,target in (('backups/chat-attachments/result.json','admin-attachments.json'),('backups/chat-client-attachments/result.json','client-attachments.json'),('backups/customer-chat-verification/result.json','admin-chat-regression.json'),('backups/admin-responsive/results.json','admin-responsive.json'),('backups/consumption/result.json','admin-consumption.json'),('backups/appointment-layout/result.json','appointment-layout.json'),('backups/appointment-changes/result.json','appointment-changes.json'),('backups/cross-store-payments/result.json','cross-store-payments.json')):
        content,data=report(ROOT,path)
        if 'builtIndexSha256' in data:require(data['builtIndexSha256']==sha(admin['index.html']),'Rerun browser verification against this admin build')
        require((ROOT/path).stat().st_mtime>=(ROOT/'dist/index.html').stat().st_mtime,'Browser report predates the admin build: '+path)
        payload['validation/'+target]=content
    content,data=report(mini,'backups/consumption/result.json')
    require((mini/'backups/consumption/result.json').stat().st_mtime>=(mini/'dist/h5/index.html').stat().st_mtime,'Client consumption verification predates its build')
    payload['validation/client-consumption.json']=content
    content,data=report(mini,'backups/chat-identity-verification/result.json')
    require(data.get('builtIndexSha256')==sha((mini/'dist/h5/index.html').read_bytes()),'Rerun customer identity verification against the current H5 build')
    require((mini/'backups/chat-identity-verification/result.json').stat().st_mtime>=(mini/'dist/h5/index.html').stat().st_mtime,'Customer identity verification predates its build')
    payload['validation/client-chat-identity.json']=content
    content,data=report(mini,'backups/contact-verification/result.json')
    require((mini/'backups/contact-verification/result.json').stat().st_mtime>=(mini/'dist/h5/index.html').stat().st_mtime,'Contact route verification predates its build')
    payload['validation/client-contact-routes.json']=content
    for repo,path,target in ((mini,'backups/member-wallet/result.json','client-member-wallet.json'),(ROOT,'backups/member-wallets/result.json','admin-member-wallets.json')):
        content,data=report(repo,path)
        index=repo/('dist/h5/index.html' if repo==mini else 'dist/index.html')
        require((repo/path).stat().st_mtime>=index.stat().st_mtime,'Rerun current member wallet browser verification')
        payload['validation/'+target]=content
    worker=backend/'deploy/ku52-sync'
    for name in ('worker.py','configure.py','install.sh','requirements.txt','yuhetang-ku52-sync.service','yuhetang-ku52-sync.timer','README.md'):
        payload['member-sync/'+name]=(worker/name).read_bytes().replace(b'\r\n',b'\n')
    exporter=ROOT.parent/'ku52-member-exporter'
    for original,target in (('ku52_export.py','ku52_export.py'),('ku52_data.py','ku52_data.py'),('config/member-import.json','stores.json')):
        payload['member-sync/'+target]=(exporter/original).read_bytes().replace(b'\r\n',b'\n')
    checked=subprocess.run([sys.executable,'-B','-X','utf8',str(backend/'tools/test_ku52_sync_worker.py')],capture_output=True,encoding='utf-8')
    require(checked.returncode==0,checked.stdout+checked.stderr)
    payload['validation/ku52-worker-tests.txt']=(checked.stdout+checked.stderr).encode('utf-8')
    proof=json.loads((backend/'backups/ku52-sync/source-read-verification.json').read_text(encoding='utf-8'))
    require(proof['status']=='passed' and proof['liveSourceReadOnly'] and not proof['productionReservationApiUsed'] and not proof['sourceBalanceChanged'],'Read-only source worker verification required')
    payload['validation/ku52-source-read.json']=(json.dumps(proof,indent=2)+'\n').encode('utf-8')
    gate_tests=[]
    for name in ('StoreChatIntegrationTest','CustomerProfileIntegrationTest'):
        path=backend/f'target-chat-access/surefire-reports/TEST-com.yuwatang.reservation.{name}.xml'
        suite=ET.parse(path).getroot()
        require(int(suite.attrib['tests'])>0 and all(int(suite.attrib.get(key,0))==0 for key in ('failures','errors','skipped')),'Customer access integration tests must pass: '+name)
        require(path.stat().st_mtime>=max(file.stat().st_mtime for file in (backend/'src').rglob('*') if file.is_file()),'Customer access integration tests predate source changes')
        gate_tests.append(dict(suite=name,tests=int(suite.attrib['tests']),failures=0,errors=0,skipped=0,cases=[case.attrib['name'] for case in suite.findall('testcase')]))
    payload['validation/java-customer-access.json']=(json.dumps(dict(status='passed',isolatedDatabase=True,liveApisUsed=False,suites=gate_tests),ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    payload['client/客服授权与身份关联.md']=(mini/'docs/客服授权与身份关联.md').read_bytes()
    native_bytes,native=report(mini,'backups/weapp-native/result.json')
    require(not native.get('failures'),'Native WXSS compiler must pass')
    for name,digest in native['files'].items():require(sha((mini/'dist/weapp'/name).read_bytes())==digest,'Native WXSS validation differs: '+name)
    require((mini/'backups/weapp-native/result.json').stat().st_mtime>=max(path.stat().st_mtime for path in (mini/'src').rglob('*') if path.is_file()),'Rebuild the miniprogram after source changes')
    COMP.add_tree(payload,mini/'dist/weapp','client/weapp/')
    config=json.loads((mini/'project.config.json').read_text(encoding='utf-8'));config['miniprogramRoot']='weapp/'
    require(config['appid']=='wxce054e18303efb8a','Unexpected miniprogram AppID')
    require('pages/consumption/index' in json.loads((mini/'dist/weapp/app.json').read_text(encoding='utf-8'))['pages'],'Keep the consumption page')
    payload['client/project.config.json']=(json.dumps(config,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    payload['validation/client-native-wxss.json']=native_bytes
    payload['validation/java.json']=java['validation.json']
    payload['validation/source-snapshot.json']=(json.dumps(sources,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    payload['validation/update-tests.txt']=python_tests('test_unified_update.py')
    payload['validation/upload-proxy-tests.txt']=python_tests('test_chat_upload_proxy.py')
    for name in ('update.py','chat-upload-proxy.py'):payload[name]=(ROOT/'deploy/unified'/name).read_bytes().replace(b'\r\n',b'\n')
    payload['update.sh']=b'''#!/usr/bin/env bash
set -euo pipefail
YHT_ATTACHMENT_PACKAGE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
for YHT_ATTACHMENT_ARG in "$@"; do
  if [ "$YHT_ATTACHMENT_ARG" = --verify-only ]; then exec python3 "$YHT_ATTACHMENT_PACKAGE/update.py" "$@"; fi
  if [ "$YHT_ATTACHMENT_ARG" = --check ]; then
    python3 "$YHT_ATTACHMENT_PACKAGE/update.py" "$@"
    exec python3 "$YHT_ATTACHMENT_PACKAGE/chat-upload-proxy.py" --check
  fi
done
python3 "$YHT_ATTACHMENT_PACKAGE/update.py" --verify-only
python3 "$YHT_ATTACHMENT_PACKAGE/update.py" --check "$@"
python3 "$YHT_ATTACHMENT_PACKAGE/chat-upload-proxy.py"
exec python3 "$YHT_ATTACHMENT_PACKAGE/update.py" "$@"
'''
    guide=f'''# 会员卡、消费同步与小程序布局整体更新 {release}

本包同时包含独立 Java 后端、管理后台前端和小程序编译产物；累计保留会员余额、消费记录、预约、通知、菜单，以及客户姓名与微信手机号授权规则。复用现有 Docker 和 1Panel 网站。

本次修复小程序「我的预约」顶部留白：按微信状态栏和胶囊按钮的实际像素计算一次顶部空间，去除安全区和旧固定间距重复叠加。「我的预约」「会员余额」「消费记录」的语言按钮合并到标题眉题行，不再单独占据一整行。已检查中文、英文、日文及窄屏，保留余额和消费页的内部滚动。

会员数据新增独立只读同步层：已验证手机号关联酷鼠会员详情，逐张核对卡数量和余额，按卡号、所属门店和有效期展示。已在新后台维护的同门店同卡号账户优先，不重复累计，也不更改会员原归属门店。原系统卡只读，后台不提供对同步卡直接充值或扣款。此次实际正常界面查询验证获得 4 张卡、总额 7551.00 元，以及 20 条近期消费；这只证明该样本的来源读取，未向线上预约数据库写入。

消费记录由服务器定时任务拉取，客户的起止日期和门店只用于过滤已同步数据库记录。默认每位已登记查询的客户约 5 分钟进入一次同步队列，小程序每 15 秒读取后台最新结果；实际时效受队列与源系统响应影响。当前酷鼠查询入口只提供近期记录，历史完整性明确标为未完成；旧的已同步记录继续保留，不能将这 20 条当作全部历史。登录过期、部分卡缺失或总额不符时保留最后成功结果并显示同步状态。

此前管理后台预约详情对齐、客服授权登录、附件、回车发送、会员余额、服务号菜单及店长通知等累计变更一起保留。

在线咨询、微信客服统一要求先微信登录、填写姓名或称呼，并授权微信手机号。客服资料表单移除了“保存称呼”跳过入口；拒绝授权、仅填姓名或资料读取失败均不创建会话。已完成资料的客户可直接咨询，已有授权手机号的客户只补齐姓名和用途同意即可。后台会话显示关联客户的姓名、手机号和会员状态。旧匿名会话保留历史但不可接入或回复，微信回调同样阻止未完成授权的账号写入新消息。本包含小程序前端变更，必须更新体验版/正式版，单独更新服务器不能改变旧版手机入口。

后台新增图片、视频按钮，支持粘贴图片、发送前预览、删除选中附件、失败后手动重试。图片为 JPG/PNG/GIF、不超过 2MB；视频为 MP4、不超过 10MB（建议 H.264/AAC，以便手机兼容）。小程序在线咨询显示图片、可放大查看，并直接播放视频。微信原生客服发送图片消息；视频使用微信支持的链接卡片，客户点击后进入视频播放页，链接 7 天有效。附件发送沿用接入人、门店权限、回复窗口和条数限制。

服务器部署：上传本压缩包及同名 .sha256 到 /home/ubuntu；另外将本机 `D:\\github_code\\裕和堂相关项目\\ku52-member-exporter\\data\\browser-state.json` 单独上传并命名为 `/home/ubuntu/yuhetang-ku52-browser-state.json`。该会话文件不在发布包中，不要贴到聊天或网站目录。然后执行：

```bash
cd /home/ubuntu
sha256sum --check yuhetang-full-update-{release}.tar.gz.sha256
tar -xzf yuhetang-full-update-{release}.tar.gz
sudo python3 -B /home/ubuntu/yuhetang-full-update-{release}/member-sync/configure.py --session /home/ubuntu/yuhetang-ku52-browser-state.json
sudo bash /home/ubuntu/yuhetang-full-update-{release}/update.sh --check
sudo bash /home/ubuntu/yuhetang-full-update-{release}/update.sh --reload-env
sudo bash /home/ubuntu/yuhetang-full-update-{release}/member-sync/install.sh
```

脚本先验证所有文件和当前服务；将 mp-admin 站点原先小于 12m 的代理上传限制提高到 12m，保留较大限额、原证书、域名和代理目标。修改前备份并执行 nginx -t，失败恢复原配置。随后备份独立数据库、uploads、私有配置和管理后台文件，再切换 Java 与前端，保留旧容器。独立数据库保留 V14/V15/V16，新增 V17 同步任务、储值卡快照和消费快照表；历史消费只查询，不重放为扣款。PUBLIC_URL、正式店长模板和 AppSecret 继续沿用服务器配置。configure.py 先备份私有 env，再添加内部同步密钥与周期；--reload-env 确保新容器加载它们。

成功标记：SUCCESS: SERVER RELEASE {release}。浏览器 Ctrl+F5 刷新 https://mp-admin.hetuonian.cn/admin。

首次启用同步：先用已授权手机号的客户打开一次余额页面，登记其自动更新任务，然后执行：

```bash
sudo systemctl start yuhetang-ku52-sync.service
sudo journalctl -u yuhetang-ku52-sync.service -n 30 --no-pager
sudo systemctl enable --now yuhetang-ku52-sync.timer
sudo systemctl list-timers --all yuhetang-ku52-sync.timer
```

预期日志 `SYNC state=READY cards=4 orders=20`（具体数量随客户不同）；`IDLE` 表示当前无到期任务，`LOGIN_REQUIRED` 表示需重新正常登录酷鼠并替换专用会话文件。小程序可见时 15 秒内读取已同步结果。更详细的维护、暂停和会话续期流程见 member-sync/README.md。安装不会自动开启定时器，先核对单次结果再启用。

小程序必须另外上传：微信开发者工具导入本包的 client 目录（AppID wxce054e18303efb8a），编译并上传体验版，之后按原流程发布。也可在本地源码项目重新构建后上传。服务器脚本不代替微信审核和发布。

验收：客户完成姓名/微信手机号授权后发起在线咨询，后台接入会话；分别发送一张图片和一个小于10MB的MP4，手机查看大图和播放视频；再在微信原生客服中验证图片消息和视频播放卡片。选文件不会自动发送，结束会话后不可继续发送。保留 Enter 发送、Shift+Enter 换行及中文输入法选字行为。微信发送结果不明确时先核实接收情况，不自动重复发送。

消费记录入口：后台「客户档案 → 消费记录」，客户「我的预约 → 消费记录」。只在配置并启用定时任务后同步原系统，单独更新 Java 不会生成来源数据，不通过余额推算消费项目，不改动实际余额。后续余额和消费更新不需要反复发版小程序；本次页面修改需要上传新的小程序体验版或正式版。

后端与界面回归使用隔离数据库和模拟微信接口，未向真实客户发送消息；会员来源采集另做了一次正常授权界面的只读核对，未变更源系统余额。已完成的测试报告及源码哈希见 validation；服务器安装、Linux 定时器运行和真实微信投递仍需部署后验收。
'''
    payload['README.md']=guide.encode('utf-8')
    manifest=dict(schemaVersion=1,releaseId=release,createdAt=dt.datetime.now(dt.timezone.utc).isoformat(),javaJarSha256=sha(java['reservation.jar']),sources={key:{name:value[name] for name in ('commit','workingTreeDirty')} for key,value in sources.items()},automaticDataImport=False,realWechatDeliveryValidated=False,cloudDeployed=False,
                  memberSync=dict(mode='read-only normal authorized UI',defaultIntervalSeconds=300,clientPollSeconds=15,privateCredentialsIncluded=False,workerIncluded=True,sourceHistoryComplete=False,localSameCardPriority=True,sourceReadVerification=proof),
                  adminLayout=dict(phoneAndLabelAligned=True,uniformControls=True,independentActionSections=True,formHelpOnSeparateRow=True,verifiedViewportWidths=[360,390,600,768,1024,1440,1920]),
                  customerChatAccess=dict(loginRequired=True,nameRequired=True,wechatPhoneGrantRequired=True,serverSideEnforced=True,channels=['WEB','WECHAT'],existingAnonymousHistory='preserved; cannot accept or reply until authorized'),
                  staffNotification=dict(appId='wxf9ad4dfd7684097a',templateId='VCNcEJHWic3yXHkcsjoyG--YjIVPGdw50G6zh2QQZqk',mapping=dict(thing10='storeName',thing14='serviceName',time12='time',thing16='customerName',phone_number9='customerPhone'),publicUrl='https://mp-admin.hetuonian.cn'),
                  files=[dict(path=name,bytes=len(value),sha256=sha(value)) for name,value in sorted(payload.items())])
    payload['manifest.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
    payload['SHA256SUMS']=''.join(sha(value)+'  '+name+'\n' for name,value in sorted(payload.items())).encode('utf-8')
    title='yuhetang-full-update-'+release;folder=ROOT/'releases'/title;target=ROOT/'releases'/(title+'.tar.gz')
    require(not folder.exists() and not target.exists(),'Release IDs are immutable')
    folder.mkdir(parents=True)
    for name,value in payload.items():
        path=folder/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(value)
    COMP.UPDATE.verify_package(folder)
    with tarfile.open(target,'x:gz',compresslevel=6) as archive:
        for name,value in sorted(payload.items()):
            entry=tarfile.TarInfo(title+'/'+name);entry.size=len(value);entry.mode=0o755 if name=='update.sh' else 0o644
            archive.addfile(entry,io.BytesIO(value))
    with tarfile.open(target,'r:gz') as archive:
        require(len(archive.getmembers())==len(payload),'Archive entry count mismatch')
        for entry in archive:
            name=entry.name[len(title)+1:];require(entry.isfile() and entry.name.startswith(title+'/') and archive.extractfile(entry).read()==payload[name],'Final archive verification failed')
    Path(str(target)+'.sha256').write_text(COMP.UPDATE.digest(target)+'  '+target.name+'\n',encoding='ascii')
    (ROOT/'releases'/(title+'.README.md')).write_bytes(payload['README.md'])
    print(json.dumps(dict(archive=str(target),sha256=COMP.UPDATE.digest(target),bytes=target.stat().st_size,files=len(payload),sources=manifest['sources']),ensure_ascii=False,indent=2))


if __name__=='__main__':main()
