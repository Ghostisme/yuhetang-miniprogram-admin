"""Bundle the verified admin build and its existing atomic publisher in one upload."""
import argparse
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(value):
    return hashlib.sha256(value).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-id', default=dt.datetime.now().strftime('%Y%m%d-%H%M%S'))
    args = parser.parse_args()
    release = args.release_id
    require(re.fullmatch(r'\d{8}-\d{6}', release), 'Invalid release ID')
    build = ROOT / 'dist/index.html'
    source = [p for p in (ROOT / 'src').rglob('*') if p.is_file()]
    require(build.is_file() and build.stat().st_mtime >= max(p.stat().st_mtime for p in source),
            'Build the current frontend sources first')
    payload = {}
    reports = {
        'notification-scroll': 'backups/notification-scroll/result.json',
        'message-center': 'backups/notifications/results.json',
        'actions': 'backups/admin-actions/result.json',
        'responsive': 'backups/admin-responsive/results.json',
        'appointment-layout': 'backups/appointment-layout/result.json',
        'member-wallets': 'backups/member-wallets/result.json',
        'consumption': 'backups/consumption/result.json',
        'launch-mode': 'backups/launch-mode/result.json',
    }
    for name, relative in reports.items():
        path = ROOT / relative
        raw = path.read_bytes()
        report = json.loads(raw)
        require(report.get('status') == 'passed' and not report.get('errors') and not report.get('unknown')
                and report.get('liveApisUsed', False) is False, f'Local browser verification failed: {relative}')
        require(path.stat().st_mtime >= build.stat().st_mtime, f'Verification predates this build: {relative}')
        require(report.get('builtIndexSha256', sha(build.read_bytes())) == sha(build.read_bytes()),
                f'Verification used a different build: {relative}')
        payload[f'validation/{name}.json'] = raw

    title = f'yuhetang-admin-layout-update-{release}'
    folder, target = ROOT / 'releases' / title, ROOT / 'releases' / (title + '.tar.gz')
    require(not folder.exists() and not target.exists(), 'Release IDs are immutable')
    subprocess.run([sys.executable, '-B', '-X', 'utf8', str(ROOT / 'tools/package-release.py'),
                    '--release-id', release], cwd=ROOT, check=True)
    archive = ROOT / 'releases' / f'yuhetang-admin-{release}.zip'
    payload[archive.name] = archive.read_bytes()
    payload[archive.name + '.sha256'] = archive.with_suffix('.zip.sha256').read_bytes()
    publisher = (ROOT / 'tools/publish-admin-20261109-141610.py').read_text(encoding='utf-8')
    publisher, changed_release = re.subn(r"(?m)^RELEASE = '[^']+'$", f"RELEASE = '{release}'", publisher)
    publisher, changed_digest = re.subn(r"(?m)^ARCHIVE_SHA256 = '[0-9a-f]+'$",
                                       f"ARCHIVE_SHA256 = '{sha(payload[archive.name])}'", publisher)
    require(changed_release == changed_digest == 1, 'Publisher constants changed unexpectedly')
    publisher = publisher.replace('Publish the verified 20261109-141610 admin ZIP',
                                  f'Publish the verified {release} admin ZIP')
    payload['publish-admin.py'] = publisher.encode('utf-8')
    # Validate all release bytes before invoking the publisher. The publisher also
    # pins the inner ZIP and checks the current site before changing any file.
    payload['update.sh'] = b'''#!/usr/bin/env bash
set -euo pipefail
YHT_UPDATE_ROOT="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd -- "$YHT_UPDATE_ROOT"
sha256sum --check SHA256SUMS
exec python3 -B "$YHT_UPDATE_ROOT/publish-admin.py"
'''
    for width in (360, 768, 1366):
        payload[f'preview/customers-{width}.png'] = (ROOT / f'backups/admin-actions/{width}-customers.png').read_bytes()
        payload[f'preview/notifications-{width}.png'] = (ROOT / f'backups/notification-scroll/{width}-staff-records.png').read_bytes()
    payload['preview/inbox-360.png'] = (ROOT / 'backups/notification-scroll/360-inbox.png').read_bytes()
    payload['validation/source-files.json'] = (json.dumps(
        {p.relative_to(ROOT).as_posix(): sha(p.read_bytes()) for p in sorted(source)},
        ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    actions = json.loads(payload['validation/actions.json'])
    responsive = json.loads(payload['validation/responsive.json'])
    notification_scroll = json.loads(payload['validation/notification-scroll.json'])
    message_center = json.loads(payload['validation/message-center.json'])
    guide = f'''# 管理后台多端布局更新 {release}

修复消息中心在 PC 和手机上整页滚动、操作区随列表消失的问题。通知记录、站内消息和推送设置分别显示；通知列表在剩余空间内独立滚动，标题、接收对象、筛选、刷新和分页保持可见。

消息中心默认进入“通知记录”；管理后台通知的个人消息在“本账号站内消息”，原有微信、短信、绑定接收人及桌面提醒设置在“推送设置”。手机使用两个下拉筛选与消息卡片，PC 保留表格及固定表头。鼠标滚轮、手机触摸和键盘均可滚动内容，手动/自动刷新保留阅读位置，切换分页或筛选回到列表顶部。切换门店保留当前视图，忽略旧门店迟到的绑定结果。

此包已合入上一轮客户档案的刷新/导出按钮对齐、筛选栏换行、平板字段和操作被遮挡的修复；同步保留预约、客户沟通、品牌与内容、服务号菜单、扩展与配置以及会员余额/消费记录的工具栏优化，无需分别安装两个布局包。

手机使用单列客户资料，平板使用双列资料卡，桌面保留表格。按钮作为一组换行，说明文字独立伸缩。已保留当前源码中此前的前端功能，包括小程序上线控制、客服附件、余额及消费记录。

## 上传与执行

只需上传外层 {title}.tar.gz 和同名 .sha256 至 /home/ubuntu。

```bash
cd /home/ubuntu
sha256sum --check {title}.tar.gz.sha256
tar -xzf {title}.tar.gz
sudo bash /home/ubuntu/{title}/update.sh
```

成功标记：SUCCESS: ADMIN RELEASE {release}。
打开 https://mp-admin.hetuonian.cn/admin，按 Ctrl+F5 强制刷新；手机浏览器请关闭原页面后重新进入。

## 更新范围与恢复

本次仅发布管理后台静态文件到现有 /opt/1panel/www/sites/mp-admin/index。复用已经正常工作的 HTTPS 站点，无需为此次布局修复重新部署 Java 或提交微信小程序审核。
前端资产先写入，index.html 最后原子替换；保留旧资产，避免仍打开的旧页面丢失文件。
发布前校验本地 HTTPS 指向现有站点，备份被替换文件至 /var/backups/yuhetang-admin/；发布后逐字节校验 /admin 及所引用 JS/CSS。校验失败自动恢复原页面，并保留备份路径供定位。
此包不替代此前 Java/小程序更新。若此前功能的后端尚未更新，应按之前整体包完成对应部署。

## 验证

通知滚动专项通过 {len(notification_scroll['results'])} 种视口，覆盖 320×568、360×780、390×844、768×1024、1024×768、1366×768、1920×1080；验证真实滚轮、手机触摸、键盘滚动、固定操作区、滚动边界、刷新保留位置、分页/筛选复位、空数据和临时错误。
消息中心通过 {len(message_center['checks'])} 组功能检查，包括客户/后台分组、设置保存、接收人绑定、门店切换、未读与已读处理、通知跳转以及权限隔离。
当前构建的通用适配检查通过 {len(responsive['results'])} 个页面/视口场景。
专项工具栏检查通过 {len(actions['results'])} 个页面/视口场景，覆盖 320、360、576、768、834、1023、1024、1100、1101、1366、1920 像素；验证刷新、搜索和导出实际触发，并检查重叠、溢出、换行与客户操作可达性。
预约详情、余额及消费记录抽屉、小程序上线控制的既有浏览器回归也已通过。
所有接口为本地测试数据，没有发送真实微信消息、变更真实余额或执行线上部署。preview/ 为本地实际渲染截图；validation/ 为本次构建的报告和源码哈希。
'''
    payload['README.md'] = guide.encode('utf-8')
    payload['manifest.json'] = (json.dumps({
        'release': release, 'scope': 'admin-frontend-only',
        'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'builtIndexSha256': sha(build.read_bytes()),
        'archiveSha256': sha(payload[archive.name]),
        'liveDeploymentPerformed': False,
        'files': {name: sha(value) for name, value in sorted(payload.items())},
    }, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    payload['SHA256SUMS'] = ''.join(sha(value) + '  ' + name + '\n'
                                  for name, value in sorted(payload.items())).encode('utf-8')
    folder.mkdir(parents=True)
    for name, value in payload.items():
        file = folder / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(value)
    with tarfile.open(target, 'x:gz', compresslevel=6) as out:
        for name, value in sorted(payload.items()):
            entry = tarfile.TarInfo(title + '/' + name)
            entry.size = len(value)
            entry.mode = 0o755 if name.endswith('.sh') else 0o644
            out.addfile(entry, io.BytesIO(value))
    with tarfile.open(target, 'r:gz') as saved:
        require(len(saved.getmembers()) == len(payload), 'Archive entry count mismatch')
        for entry in saved:
            name = entry.name[len(title) + 1:]
            require(entry.isfile() and entry.name.startswith(title + '/')
                    and saved.extractfile(entry).read() == payload[name], 'Final archive verification failed')
    Path(str(target) + '.sha256').write_text(sha(target.read_bytes()) + '  ' + target.name + '\n', encoding='ascii')
    (ROOT / 'releases' / (title + '.README.md')).write_bytes(payload['README.md'])
    print(json.dumps({'status': 'verified', 'release': release, 'archive': str(target),
                      'sha256': sha(target.read_bytes()), 'bytes': target.stat().st_size,
                      'files': len(payload)}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
