"""Add tested launch controls to a verified cumulative server/client release."""
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
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('components', ROOT / 'tools/package-unified.py')
COMP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMP)
require = COMP.require
sha = lambda content: hashlib.sha256(content).hexdigest()


def snapshot(repo):
    files = [p for p in (repo / 'src').rglob('*') if p.is_file()]
    if (repo / 'config').is_dir():
        files.extend(p for p in (repo / 'config').rglob('*') if p.is_file())
    files.extend(repo / name for name in ('pom.xml', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'babel.config.js') if (repo / name).is_file())
    return dict(commit=COMP.git(repo, 'rev-parse', 'HEAD'), workingTreeDirty=bool(COMP.git(repo, 'status', '--porcelain')),
                files={p.relative_to(repo).as_posix(): sha(p.read_bytes()) for p in sorted(files)})


def evidence(repo, path, build):
    file = repo / path
    value = json.loads(file.read_text(encoding='utf-8'))
    require(value.get('status') == 'passed' and not value.get('errors') and not value.get('unknown') and not value.get('liveApisUsed'), 'Isolated verification must pass: ' + path)
    require(file.stat().st_mtime >= build.stat().st_mtime, 'Rerun browser verification for this build: ' + path)
    if 'builtIndexSha256' in value:
        require(value['builtIndexSha256'] == sha(build.read_bytes()), 'Browser build mismatch: ' + path)
    return file.read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--base-release', default='20261110-202701')
    args = parser.parse_args()
    release, base = args.release_id, args.base_release
    require(all(re.fullmatch(r'\d{8}-\d{6}', v) for v in (release, base)), 'Invalid release identifier')
    backend, mini = ROOT.parent / 'yuhetang-miniprogram-backend', ROOT.parent / 'yuhetang-miniprogram'
    baseline_path = ROOT / f'releases/yuhetang-full-update-{base}.tar.gz'
    baseline = COMP.read_tar(baseline_path, f'yuhetang-full-update-{base}/')
    previous = json.loads(baseline['manifest.json'])
    java = COMP.read_tar(backend / f'releases/yuhetang-java-docker-{release}.tar.gz', f'yuhetang-java-docker-{release}/')
    admin = COMP.read_zip(ROOT / f'releases/yuhetang-admin-{release}.zip')
    java_report = json.loads(java['validation.json'])
    counts = java_report['backendTests']
    require(counts['tests'] >= 268 and not any(counts[k] for k in ('failures', 'errors', 'skipped')), 'Complete backend regression must pass')
    require(sha(java['reservation.jar']) == java_report['backendJarSha256'], 'Java build mismatch')
    with zipfile.ZipFile(io.BytesIO(java['reservation.jar'])) as jar:
        names = set(jar.namelist())
        for name in ('LaunchMode', 'LaunchModeApi', 'ChatAttachments', 'ChatCustomers', 'MemberWallets', 'ConsumptionRecords', 'Ku52MemberSync'):
            require(f'BOOT-INF/classes/com/yuwatang/reservation/{name}.class' in names, 'Missing cumulative feature: ' + name)
        for version in (14, 15, 16, 17):
            require(any(name.startswith(f'BOOT-INF/classes/db/migration/V{version}__') for name in names), 'Missing cumulative migration ' + str(version))
    for name, content in admin.items():
        if name != 'SHA256SUMS':
            require(content == (ROOT / 'dist' / name).read_bytes(), 'Admin component differs from current build')
    for repo, build in ((ROOT, ROOT / 'dist/index.html'), (mini, mini / 'dist/h5/index.html'), (mini, mini / 'dist/weapp/app.js')):
        require(build.stat().st_mtime >= max(p.stat().st_mtime for p in (repo / 'src').rglob('*') if p.is_file()), 'Rebuild current sources: ' + str(repo))

    # Keep prior operational assets, but do not describe old browser results as current validation.
    payload = {name: value for name, value in baseline.items() if not name.startswith(('server/', 'client/', 'validation/')) and name not in ('manifest.json', 'SHA256SUMS', 'README.md')}
    for name, value in baseline.items():
        if name.startswith('validation/'):
            payload[f'validation/baseline-{base}/' + name.removeprefix('validation/')] = value
    payload[f'docs/previous-release-{base}.md'] = baseline['README.md']
    for prefix, files in (('server/java/', java), ('server/admin/', admin)):
        payload.update({prefix + name: value for name, value in files.items()})
    native = json.loads((mini / 'backups/weapp-native/result.json').read_text(encoding='utf-8'))
    require(native.get('status') == 'passed' and not native.get('failures'), 'Native WXSS compiler must pass')
    for name, value in native['files'].items():
        require(sha((mini / 'dist/weapp' / name).read_bytes()) == value, 'Native validation build mismatch: ' + name)
    COMP.add_tree(payload, mini / 'dist/weapp', 'client/weapp/')
    config = json.loads((mini / 'project.config.json').read_text(encoding='utf-8'))
    require(config['appid'] == 'wxce054e18303efb8a', 'Unexpected mini program AppID')
    config['miniprogramRoot'] = 'weapp/'
    payload['client/project.config.json'] = (json.dumps(config, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    payload['client/客服授权与身份关联.md'] = (mini / 'docs/客服授权与身份关联.md').read_bytes()
    payload['validation/admin-launch-mode.json'] = evidence(ROOT, 'backups/launch-mode/result.json', ROOT / 'dist/index.html')
    payload['validation/client-launch-mode.json'] = evidence(mini, 'backups/launch-mode/result.json', mini / 'dist/h5/index.html')
    payload['validation/client-i18n.json'] = evidence(mini, 'backups/i18n/result.json', mini / 'dist/h5/index.html')
    payload['validation/client-native-wxss.json'] = (mini / 'backups/weapp-native/result.json').read_bytes()
    payload['validation/java.json'] = java['validation.json']
    unit = (mini / 'work/launch-unit-tests.log').read_text(encoding='utf-8-sig')
    require('tests 80' in unit and 'pass 80' in unit and 'fail 0' in unit, 'Mini program unit suite must pass')
    require((mini / 'work/launch-unit-tests.log').stat().st_mtime >= max(p.stat().st_mtime for p in (mini / 'src').rglob('*') if p.is_file()), 'Mini program unit report is stale')
    payload['validation/client-unit-tests.txt'] = unit.encode('utf-8')
    for name in ('test_unified_update.py', 'test_chat_upload_proxy.py'):
        result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(ROOT / 'tools' / name)], capture_output=True, encoding='utf-8')
        require(result.returncode == 0, result.stdout + result.stderr)
        payload['validation/' + name + '.txt'] = (result.stdout + result.stderr).encode('utf-8')
    # Require the updater and worker baseline to match the current operational sources.
    for name in ('update.py', 'chat-upload-proxy.py'):
        require(payload[name] == (ROOT / 'deploy/unified' / name).read_bytes().replace(b'\r\n', b'\n'), 'Operational updater changed; review before bundling: ' + name)
    for name in ('worker.py', 'configure.py', 'install.sh', 'requirements.txt', 'yuhetang-ku52-sync.service', 'yuhetang-ku52-sync.timer', 'README.md'):
        require(payload['member-sync/' + name] == (backend / 'deploy/ku52-sync' / name).read_bytes().replace(b'\r\n', b'\n'), 'Member synchronization source changed: ' + name)
    sources = {name: snapshot(repo) for name, repo in (('admin', ROOT), ('java', backend), ('miniprogram', mini))}
    require(java_report['sourceCommit'] == sources['java']['commit'], 'Backend commit changed after packaging')
    payload['validation/source-snapshot.json'] = (json.dumps(sources, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    guide = f'''# 小程序建设中模式 · 累计更新 {release}

本包包含 Java 后端、管理后台前端、小程序原生编译产物，以及原有会员同步工具。保留此前的预约、客户授权、客服附件、会员卡与消费记录、店长通知、服务号菜单和中英日布局修复。

## 启用方式

总部管理员登录 https://mp-admin.hetuonian.cn/admin → 扩展与配置 → 小程序上线控制。
打开「启用建设中模式」，填写三语标题和正文，点击「保存上线控制」并确认。
默认关闭，部署不会擅自暂停正在使用的业务。编辑后必须保存才生效。

开启后顾客首次进入或提示版本变化时显示原生温馨提示；确认后仍有「建设中 · 仅供浏览」入口。切换标签页不重复弹窗。可继续浏览门店、养护项目和已有记录；登录、预约、改约、取消、手机号/资料提交、订阅申请和新客服消息由前后端共同拦截，不创建有效业务记录。旧版客户端的相关提交同样由后端拦截；原生客服入口提示需使用本次小程序版本。

后台处理、既有会员同步和微信签名回调继续运行。开关仅控制顾客前台提交，不删除历史数据。配置记录在本项目数据库，包含保存人审计和版本冲突校验。
正式上线时关闭开关并保存即可恢复顾客操作；不需再发版。可见页面每 15 秒读取配置，重新进入页面立即读取；后端按最新保存状态拦截。此功能不自动群发上线通知，文案为「正式上线后，我们会通过官方渠道告知您」。

默认中文正文：
裕和堂小程序正在建设中，功能尚未正式上线。目前仅供浏览，登录、预约、改约、取消、资料提交及客服对话暂不可用，不构成有效预约或业务办理。正式上线后，我们会通过官方渠道告知您。感谢您的理解与耐心等待。

## 服务器更新

上传压缩包及同名 .sha256 至 /home/ubuntu，然后逐行执行：

```bash
cd /home/ubuntu
sha256sum --check yuhetang-full-update-{release}.tar.gz.sha256
tar -xzf yuhetang-full-update-{release}.tar.gz
sudo bash /home/ubuntu/yuhetang-full-update-{release}/update.sh --check
sudo bash /home/ubuntu/yuhetang-full-update-{release}/update.sh
```

成功标记：SUCCESS: SERVER RELEASE {release}。Ctrl+F5 刷新管理后台。
升级脚本校验发布文件，备份本项目独立数据库、私有配置、上传图片和管理后台文件，保留旧 Java 容器。复用现有 MySQL、Docker 与 1Panel 网站；包内不安装 OpenResty，不导入初始数据，不包含私钥或酷鼠登录会话。此次建设中配置复用 app_setting，不增加数据库迁移；累计包包含既有 V14–V17，实际是否应用由当前库版本决定。
会员同步若已配置，继续使用原定时任务；若尚未部署，按 docs/previous-release-{base}.md 和 member-sync/README.md 操作，专用登录会话单独上传。

## 小程序更新与验收

本次需上传一次新的体验版/正式版，才能显示弹窗和提示条。微信开发者工具导入解压后的 client 目录，AppID wxce054e18303efb8a，产物目录 weapp/；也可从本地 Taro 项目重新编译。
先更新服务器，再上传小程序体验版。后台开启模式后，用客户微信依次验证：进入即提示；门店/项目可浏览；登录、预约、资料提交和客服入口被阻止。切换中文/英文/日文，查看完整提示。后台关闭后重新进入，验证恢复正常。之后按原流程审核发布；今后切换与文案只走接口。

## 验证范围

当前版本 Java 全量 268 项测试通过（含隔离数据库和模拟微信），小程序 80 项单元测试通过；管理后台 360/768/1366 窄宽屏开关保存检查通过，小程序三语 × 320/390/414 提示与布局检查通过；13 页产物完整、16 个 WXSS 通过微信原生 wcsc 编译。自动检查未向真实客户发送消息，也未部署线上。
validation/ 保存当前版本验证与源码哈希；validation/baseline-{base}/ 是旧累计版本的历史报告，仅用于追溯，不冒充当前界面验证。服务器 Docker 运行、真实手机提示和真实微信投递需部署后验收。
'''
    payload['README.md'] = guide.encode('utf-8')
    manifest = {key: value for key, value in previous.items() if key not in ('files', 'releaseId', 'createdAt', 'javaJarSha256', 'sources')}
    manifest.update(releaseId=release, createdAt=dt.datetime.now(dt.timezone.utc).isoformat(), javaJarSha256=sha(java['reservation.jar']),
                    sources={key: {field: value[field] for field in ('commit', 'workingTreeDirty')} for key, value in sources.items()},
                    baselineRelease=base, baselineArchiveSha256=COMP.UPDATE.digest(baseline_path),
                    launchControl=dict(defaultEnabled=False, settingKey='miniprogramLaunchMode', locales=['zh', 'en', 'ja'], pollSeconds=15,
                                       customerWritesBlocked=True, historicalDataPreserved=True, launchNotificationsAutomatic=False),
                    files=[dict(path=name, bytes=len(value), sha256=sha(value)) for name, value in sorted(payload.items())])
    payload['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    payload['SHA256SUMS'] = ''.join(sha(value) + '  ' + name + '\n' for name, value in sorted(payload.items())).encode('utf-8')
    title = 'yuhetang-full-update-' + release
    folder, target = ROOT / 'releases' / title, ROOT / 'releases' / (title + '.tar.gz')
    require(not folder.exists() and not target.exists(), 'Release identifiers are immutable')
    folder.mkdir(parents=True)
    for name, value in payload.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
    COMP.UPDATE.verify_package(folder)
    with tarfile.open(target, 'x:gz', compresslevel=6) as archive:
        for name, value in sorted(payload.items()):
            entry = tarfile.TarInfo(title + '/' + name)
            entry.size = len(value)
            entry.mode = 0o755 if name.endswith('.sh') else 0o644
            archive.addfile(entry, io.BytesIO(value))
    with tarfile.open(target, 'r:gz') as archive:
        require(len(archive.getmembers()) == len(payload), 'Archive entry count mismatch')
        for entry in archive:
            name = entry.name[len(title) + 1:]
            require(entry.isfile() and entry.name.startswith(title + '/') and archive.extractfile(entry).read() == payload[name], 'Final archive verification failed')
    Path(str(target) + '.sha256').write_text(COMP.UPDATE.digest(target) + '  ' + target.name + '\n', encoding='ascii')
    (ROOT / 'releases' / (title + '.README.md')).write_bytes(payload['README.md'])
    print(json.dumps(dict(status='verified', archive=str(target), sha256=COMP.UPDATE.digest(target), bytes=target.stat().st_size, files=len(payload)), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
