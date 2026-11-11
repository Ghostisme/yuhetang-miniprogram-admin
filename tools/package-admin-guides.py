"""Package the current verified admin and Java with the existing server updater."""
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
SPEC = importlib.util.spec_from_file_location('unified_package', ROOT / 'tools/package-unified.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)
require = PACKAGE.require


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def source_snapshot(repo):
    paths = [repo / 'package.json', repo / 'package-lock.json', repo / 'vite.config.ts', repo / 'pom.xml']
    paths += [p for p in (repo / 'src').rglob('*') if p.is_file()]
    return {
        'baseCommit': PACKAGE.git(repo, 'rev-parse', 'HEAD'),
        'workingTreeDirty': bool(PACKAGE.git(repo, 'status', '--porcelain')),
        'files': {p.relative_to(repo).as_posix(): sha(p.read_bytes()) for p in sorted(paths) if p.is_file()},
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-id', required=True)
    args = parser.parse_args()
    release = args.release_id
    require(re.fullmatch(r'\d{8}-\d{6}', release), 'Invalid release ID')
    backend = ROOT.parent / 'yuhetang-miniprogram-backend'
    title = f'yuhetang-server-update-{release}'
    folder = ROOT / 'releases' / title
    target = ROOT / 'releases' / (title + '.tar.gz')
    require(not folder.exists() and not target.exists(), 'Release IDs are immutable')
    build = ROOT / 'dist/index.html'
    require(build.is_file(), 'Build the admin first')
    for repo, entry in ((ROOT, build), (backend, backend / 'target-api/reservation-api-1.0.0.jar')):
        latest = max(p.stat().st_mtime for p in (repo / 'src').rglob('*') if p.is_file())
        require(entry.stat().st_mtime >= latest, 'Build predates current sources: ' + str(entry))
    build_sha = sha(build.read_bytes())
    payload = {}
    reports = {
        'admin-guides': 'backups/admin-guides/result.json',
        'notification-scroll': 'backups/notification-scroll/result.json',
        'integrations-rbac': 'backups/integrations-rbac/result.json',
        'message-center': 'backups/notifications/results.json',
        'admin-actions': 'backups/admin-actions/result.json',
        'admin-responsive': 'backups/admin-responsive/results.json',
        'launch-mode': 'backups/launch-mode/result.json',
    }
    checked = {}
    for name, relative in reports.items():
        path = ROOT / relative
        report = json.loads(path.read_bytes())
        # The legacy responsive report records intercepted requests/unknowns,
        # while its runner prints liveApisUsed=false only to stdout.
        isolated = report.get('liveApisUsed') is False or (
            name == 'admin-responsive' and report.get('unknown') == [] and 'writes' in report)
        require(report.get('status') == 'passed' and not report.get('errors') and not report.get('unknown')
                and isolated, 'Isolated browser verification failed: ' + relative)
        require(report.get('builtIndexSha256') == build_sha and path.stat().st_mtime >= build.stat().st_mtime,
                'Verification does not match the current build: ' + relative)
        payload[f'validation/{name}.json'] = path.read_bytes()
        checked[name] = report
    java_path = backend / 'releases' / f'yuhetang-java-docker-{release}.tar.gz'
    java = PACKAGE.read_tar(java_path, f'yuhetang-java-docker-{release}/')
    java_report = json.loads(java['validation.json'])
    tests = java_report['backendTests']
    require(tests['tests'] >= 275 and not any(tests[k] for k in ('failures', 'errors', 'skipped')),
            'Missing successful full backend verification')
    require(java['reservation.jar'] == (backend / 'target-api/reservation-api-1.0.0.jar').read_bytes(),
            'Java component differs from current build')
    jar_sha = sha(java['reservation.jar'])
    require(jar_sha == java_report['backendJarSha256'] and java_report['migrationFiles'] == 18,
            'Java hash or migrations mismatch')
    subprocess.run([sys.executable, '-B', '-X', 'utf8', str(ROOT / 'tools/package-release.py'),
                    '--release-id', release], cwd=ROOT, check=True)
    admin = PACKAGE.read_zip(ROOT / 'releases' / f'yuhetang-admin-{release}.zip')
    for name, content in admin.items():
        if name != 'SHA256SUMS':
            require(content == (ROOT / 'dist' / name).read_bytes(), 'Admin artifact differs from build: ' + name)
    for prefix, files in (('server/java/', java), ('server/admin/', admin)):
        payload.update({prefix + name: value for name, value in files.items()})
    for name in ('update.py', 'update.sh'):
        payload[name] = (ROOT / 'deploy/unified' / name).read_bytes().replace(b'\r\n', b'\n')
    payload['validation/java-component.json'] = java['validation.json']
    payload['validation/source-files.json'] = json_bytes({
        'admin': source_snapshot(ROOT), 'java': source_snapshot(backend),
        'note': 'Cumulative local working-tree builds; unrelated source edits were preserved, not committed.',
    })
    for width in (360, 768, 1366):
        payload[f'preview/notifications-{width}.png'] = (ROOT / f'backups/notification-scroll/{width}-staff-records.png').read_bytes()
        payload[f'preview/customers-{width}.png'] = (ROOT / f'backups/admin-actions/{width}-customers.png').read_bytes()
    payload['preview/permissions-1366.png'] = (ROOT / 'backups/integrations-rbac/1366-role-permissions.png').read_bytes()
    for width in (320, 360, 768, 1366):
        for page in ('appointments', 'customers', 'chats', 'stores', 'content', 'notifications', 'imports-members', 'imports-dianping-orders'):
            payload[f'preview/{page}-{width}.png'] = (ROOT / f'backups/admin-guides/{width}-{page}.png').read_bytes()
    for kind in ('members', 'therapists', 'stores', 'services', 'dianping-customers', 'dianping-orders'):
        for extension in ('json', 'xlsx'):
            payload[f'examples/{kind}.{extension}'] = (backend / f'target-api/import-guide-fixtures/{kind}.{extension}').read_bytes()
    payload['validation/summary.json'] = json_bytes({
        'releaseId': release, 'scope': 'admin-and-java', 'builtIndexSha256': build_sha,
        'javaJarSha256': jar_sha, 'backendTests': tests,
        'notificationViewports': len(checked['notification-scroll']['results']),
        'rbacBrowserChecks': len(checked['integrations-rbac']['checks']),
        'responsiveScenarios': len(checked['admin-responsive']['results']),
        'toolbarScenarios': len(checked['admin-actions']['results']),
        'messageCenterChecks': len(checked['message-center']['checks']),
        'guideAndImportChecks': len(checked['admin-guides']['checks']),
        'liveDeploymentPerformed': False, 'realWechatDeliveryTested': False,
        'dockerRuntimeTested': False, 'miniprogramChangedByThisUpdate': False,
    })
    payload['README.md'] = f'''# 管理后台 Ant Design Tour 漫游式引导更新 {release}

这是管理后台静态文件与独立 Java Docker 应用的合并更新。使用当前本地累计源码构建，保留之前的后台功能与适配修改；源码未在本次自动提交或推送。此包用于已有 1Panel HTTPS 站点和独立 MySQL 的更新。

## 本次行为

- 预约管理、客户档案、客户沟通、门店与时段、品牌与内容、消息中心使用 Ant Design 原生 Tour。页面标题旁显示完整的“操作引导”入口，手机端同样显示文字。
- 首次进入各模块时自动展示，等待页面加载和导航收起；已有业务弹窗时先不打断。每一步用遮罩高亮实际控件，气泡跟随目标，支持“上一步”“下一步”“完成引导”“跳过”和关闭。
- 完成或跳过后，该账号在当前浏览器不再自动展示同模块引导，可随时点标题旁入口重看。新版单独记录状态，上一版旧状态不会让新引导失效。清除浏览器数据或使用其他浏览器后会重新展示。
- PC 与手机均使用真实控件高亮和锚定提示，自动跟随独立滚动区域定位；窄屏会为提示卡片预留空间。引导按账号权限减少不可用步骤，不替用户保存、确认接待、接入会话、发送消息或写入示例数据。
- 资料导入增加四步流程、六类模板字段说明、虚构填写示例、实际门店编号对照与复制，以及“下载填写示例 Excel”。原有空白模板、预检、确认写入流程保留。
- 六类示例分别为会员基础资料、调理师资料、门店资料、养护品项资料、大众点评客户、大众点评订单。Excel 的第一个工作表保留系统原始列名与顺序，第二个工作表提供填写说明；编号和手机号按文本保存，保留前导零。
- 示例全部为虚构数据，门店/项目/点评映射编号必须替换。会员基础资料不包含储值余额、储值卡与消费记录；同手机号更新会员标识等字段前请先核实。品项导入保存品牌草稿，各店独立品项仍分别维护。
- 新的示例说明与下载接口使用 imports:write 权限和总部数据范围双重限制。examples/ 另附本次后端实际生成的六个示例 Excel 与字段说明 JSON，供离线参考。
- 本包同时保留之前累计的通知滚动、RBAC 与多端布局修复：
- 消息中心默认打开“通知记录”。页面标题、通知对象、页签、筛选、刷新与分页保持可见，只有列表内容滚动。PC 保留固定表头，手机改用卡片。鼠标滚轮、手机触摸和键盘均可操作。
- “本账号站内消息”与“推送设置”使用各自的内容滚动区域。手动/自动刷新保留阅读位置，切换筛选或分页后回到列表顶部。原有微信、短信、接收人绑定与桌面提醒设置保留。
- “扩展与配置”接入独立的总部权限组：查看扩展与配置（integrations:read）、维护扩展与配置（integrations:write）。维护权限依赖查看权限。缺少查看权限时隐藏菜单并拒绝相关配置接口；只读账号不能保存。
- roles:write 只负责角色管理，imports:write 只负责导入，均不再隐式授予配置维护。分店数据范围的角色不能获得总部配置权限。服务号菜单仍使用自己的权限。
- V18 数据库迁移增加上述权限。仅为原本有 integrations:read 的内置 GLOBAL 总部角色补齐维护权限；已撤销查看权限的角色不会被重新授权，自定义角色需由总部按需分配。
- 同时包含此前客户档案刷新/导出、筛选栏和多端工具栏的累计布局修改。

## 上传与执行

只需上传外层 {title}.tar.gz 与 {title}.tar.gz.sha256 至 /home/ubuntu，不需要另传组件 ZIP/JAR。

```bash
cd /home/ubuntu &&
sha256sum --check {title}.tar.gz.sha256 &&
tar -xzf {title}.tar.gz &&
sudo bash /home/ubuntu/{title}/update.sh --check &&
sudo bash /home/ubuntu/{title}/update.sh
```

--check 仅检查已有服务、目录和端口等前置条件。若检查失败，请保留输出并先处理对应问题，再执行最后一行。不要同时运行两份更新。

成功标记：SUCCESS: SERVER RELEASE {release}，且 Java Health=healthy。
默认站点目录 /opt/1panel/www/sites/mp-admin/index；后台地址 https://mp-admin.hetuonian.cn/admin。
更新后 Ctrl+F5 刷新；手机关闭旧页面后重新打开。进入上述六个模块，首次会自动显示漫游引导；重看时点击模块标题旁的“操作引导”。权限变更后退出再登录。在“角色与权限”中按需勾选“扩展与配置”权限并保存。

## 更新与恢复范围

此包复用现有 Docker、OpenResty、站点证书、环境配置、独立数据库和上传目录，不安装网关、不初始化业务数据。保留服务号配置，不自动修改微信后台。此次功能无须重新上传或审核小程序。

脚本先构建并校验 Java，停用本项目旧 Java 后备份独立库、环境配置、上传文件和原前端，再切换 Java 并等待健康检查，通过后发布前端。前端资产先复制，index.html 最后替换。Java 切换期间接口会短暂不可用，请选空闲时段执行。

若旧 systemd 服务 yuwatang-reservation.service 仍启用，或 8790/8791 被其他进程占用，预检查会停止，不会直接杀进程。本次 Java 包含 V18 权限迁移；若服务器还未安装此前累计版本，也会执行缺失的已有迁移。

备份目录为 /var/backups/yuhetang-unified/，以执行输出为准。保留旧 Java 容器供恢复。若升级失败且数据库结构已变更或无法核实，脚本不会自动恢复数据库或强行启动旧版本；请保留容器、备份和错误输出后定位，避免用旧 JAR 配合未经确认的新结构。已有业务数据不会被初始化脚本覆盖。

## 本地验证与边界

- Java 全量 verify：{tests['tests']} 项测试，失败/错误/跳过均为 0；包含总部/分店、只读/维护、越权拒绝、V17→V18 权限迁移。
- 操作引导与导入：{len(checked['admin-guides']['checks'])} 组当前构建浏览器检查，涵盖四种视口、六个模块各步、首次自动展示、完成/回退/跳过/重开、真实遮罩高亮、气泡不遮挡控件、不超出屏幕、权限受限账号及六类实际 Excel 下载字节比对。后端测试核对所有列名、示例单元格、填写说明、权限拒绝与下载/预检不写库。
- 通知滚动：{len(checked['notification-scroll']['results'])} 种视口，320×568 至 1920×1080，验证实际触摸/滚轮/键盘、固定操作区、刷新保留位置、筛选分页复位及空/错误状态。
- 配置权限：{len(checked['integrations-rbac']['checks'])} 组浏览器检查；消息中心 {len(checked['message-center']['checks'])} 组回归。
- 通用适配 {len(checked['admin-responsive']['results'])} 个页面/视口场景；工具栏 {len(checked['admin-actions']['results'])} 个场景。
- preview/ 是当前构建的实际本地截图，validation/ 是对应构建哈希、测试报告和源码文件哈希。

以上浏览器接口均为本地测试数据；后端使用独立测试数据库。未连接线上业务库、未发送真实微信消息、未执行线上部署。Docker 目标镜像构建与真实服务器验收将在上述服务器更新时完成。

管理后台入口 SHA256：{build_sha}
Java JAR SHA256：{jar_sha}
'''.encode('utf-8')
    payload['manifest.json'] = json_bytes({
        'schemaVersion': 1, 'releaseId': release, 'scope': 'admin-and-java',
        'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'javaJarSha256': jar_sha, 'builtIndexSha256': build_sha,
        'files': [{'path': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in sorted(payload.items())],
    })
    payload['SHA256SUMS'] = ''.join(sha(data) + '  ' + name + '\n' for name, data in sorted(payload.items())).encode('utf-8')
    folder.mkdir(parents=True)
    for name, data in payload.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    PACKAGE.UPDATE.verify_package(folder)
    with tarfile.open(target, 'x:gz', compresslevel=6) as archive:
        for name, data in sorted(payload.items()):
            entry = tarfile.TarInfo(title + '/' + name)
            entry.size = len(data)
            entry.mode = 0o755 if name.endswith('.sh') else 0o644
            archive.addfile(entry, io.BytesIO(data))
    with tarfile.open(target, 'r:gz') as archive:
        require(len(archive.getmembers()) == len(payload), 'Archive count mismatch')
        for entry in archive:
            require(entry.isfile() and entry.name.startswith(title + '/'), 'Invalid final archive path')
            name = entry.name[len(title) + 1:]
            require(name in payload and archive.extractfile(entry).read() == payload[name], 'Archive bytes mismatch')
    Path(str(target) + '.sha256').write_text(sha(target.read_bytes()) + '  ' + target.name + '\n', encoding='ascii')
    PACKAGE.check_outer(target)
    (ROOT / 'releases' / (title + '.README.md')).write_bytes(payload['README.md'])
    examples_zip = ROOT / 'releases' / f'yuhetang-import-examples-{release}.zip'
    with zipfile.ZipFile(examples_zip, 'x', zipfile.ZIP_DEFLATED) as archive:
        for name, data in payload.items():
            if name.startswith('examples/'):
                archive.writestr(name, data)
    Path(str(examples_zip) + '.sha256').write_text(sha(examples_zip.read_bytes()) + '  ' + examples_zip.name + '\n', encoding='ascii')
    print(json.dumps({'status': 'verified', 'release': release, 'archive': str(target),
                      'bytes': target.stat().st_size, 'sha256': sha(target.read_bytes()),
                      'files': len(payload)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
