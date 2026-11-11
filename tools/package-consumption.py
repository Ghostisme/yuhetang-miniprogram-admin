"""Bundle the verified consumption feature with the existing independent Java/admin/client builds."""
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

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('consumption_components', ROOT / 'tools/package-unified.py')
COMP = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMP)
require = COMP.require
sha = lambda value: hashlib.sha256(value).hexdigest()


def source(repo):
    files = [path for path in (repo / 'src').rglob('*') if path.is_file()]
    for name in ('config',):
        if (repo / name).is_dir():
            files.extend(path for path in (repo / name).rglob('*') if path.is_file())
    files.extend(repo / name for name in ('pom.xml', 'package.json', 'package-lock.json', 'vite.config.ts', 'babel.config.js', 'tsconfig.json') if (repo / name).is_file())
    return dict(commit=COMP.git(repo, 'rev-parse', 'HEAD'), workingTreeDirty=bool(COMP.git(repo, 'status', '--porcelain')),
                files={path.relative_to(repo).as_posix(): sha(path.read_bytes()) for path in sorted(files)})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--include-working-changes', action='store_true')
    args = parser.parse_args()
    release = args.release_id
    require(re.fullmatch(r'\d{8}-\d{6}', release), 'Use YYYYMMDD-HHMMSS')
    backend, mini = ROOT.parent / 'yuhetang-miniprogram-backend', ROOT.parent / 'yuhetang-miniprogram'
    sources = {name: source(repo) for name, repo in (('java', backend), ('admin', ROOT), ('miniprogram', mini))}
    require(args.include_working_changes or not any(value['workingTreeDirty'] for value in sources.values()), 'Explicitly include and record the verified working changes')
    java = COMP.read_tar(backend / f'releases/yuhetang-java-docker-{release}.tar.gz', f'yuhetang-java-docker-{release}/')
    admin = COMP.read_zip(ROOT / f'releases/yuhetang-admin-{release}.zip')
    validation = json.loads(java['validation.json'])
    require(validation['backendTests']['tests'] >= 250 and not any(validation['backendTests'][key] for key in ('failures', 'errors', 'skipped')), 'Full backend verification is required')
    require(sha(java['reservation.jar']) == validation['backendJarSha256'], 'Backend JAR mismatch')
    for repo, entry in ((ROOT, ROOT / 'dist/index.html'), (mini, mini / 'dist/weapp/app.json'), (mini, mini / 'dist/h5/index.html')):
        files = source(repo)['files']
        require(entry.stat().st_mtime >= max((repo / name).stat().st_mtime for name in files), 'Rebuild current source: ' + str(entry))
    for name, value in admin.items():
        if name != 'SHA256SUMS':
            require(value == (ROOT / 'dist' / name).read_bytes(), 'Admin package differs from current build')
    require('pages/consumption/index' in json.loads((mini / 'dist/weapp/app.json').read_text(encoding='utf-8'))['pages'], 'Missing native consumption page')
    payload = {prefix + name: value for prefix, files in (('server/java/', java), ('server/admin/', admin)) for name, value in files.items()}
    COMP.add_tree(payload, mini / 'dist/weapp', 'client/')
    for repo, name, target, entry in ((ROOT, 'backups/consumption/result.json', 'admin-consumption.json', ROOT / 'dist/index.html'), (mini, 'backups/consumption/result.json', 'client-consumption.json', mini / 'dist/h5/index.html')):
        path = repo / name
        report = json.loads(path.read_text(encoding='utf-8'))
        require(report['status'] == 'passed' and not report['errors'] and not report['unknown'] and not report['liveApisUsed'], 'Passing isolated browser checks are required')
        require(path.stat().st_mtime >= entry.stat().st_mtime, 'Browser checks predate the build')
        payload['validation/' + target] = path.read_bytes()
    native_path = mini / 'backups/weapp-native/result.json'
    native = json.loads(native_path.read_text(encoding='utf-8'))
    require(native['status'] == 'passed' and not native['failures'], 'Native WXSS compiler must pass')
    for name, digest in native['files'].items():
        require(sha((mini / 'dist/weapp' / name).read_bytes()) == digest, 'Native stylesheet changed after verification')
    payload['validation/native-wxss.json'] = native_path.read_bytes()
    payload['validation/source-sha256.json'] = (json.dumps(sources, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    payload['validation/backend.json'] = java['validation.json']
    result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(ROOT / 'tools/test_unified_update.py')], capture_output=True, encoding='utf-8')
    require(result.returncode == 0, result.stdout + result.stderr)
    payload['validation/updater-tests.txt'] = (result.stdout + result.stderr).encode('utf-8')
    for name in ('update.py', 'update.sh'):
        payload[name] = (ROOT / 'deploy/unified' / name).read_bytes().replace(b'\r\n', b'\n')
    guide = f'''# 消费记录整体更新 {release}

本包同时包含独立 Java 后端、管理后台前端和小程序编译产物。复用现有 Docker 与 1Panel 网站，服务器更新入口仅切换 Java 与后台静态文件。

## 使用入口

- 客户：微信登录并授权手机号后，在「我的预约 → 消费记录」直接查看，也可在「会员余额」中进入。按门店、日期筛选，点击记录查看消费项目、金额、北京时间、原订单/凭证、来源及客户可见说明。
- 管理员：「客户档案 → 消费记录」查看已登记及已迁入记录；「会员余额 → 登记消费」填写项目、金额、凭证、内部核对说明和客户可见说明。
- 原系统历史：「客户档案 → 消费记录 → 补录历史消费」。只补录已核对的原订单，不再次扣余额。长订单号保持文本。错误记录可作废，原记录保留。

## 上传与服务器更新

把 `yuhetang-full-update-{release}.tar.gz` 及其 `.sha256` 文件一并上传到 `/home/ubuntu`，逐行执行：

```bash
cd /home/ubuntu
sha256sum --check yuhetang-full-update-{release}.tar.gz.sha256
tar -xzf yuhetang-full-update-{release}.tar.gz
sudo bash /home/ubuntu/yuhetang-full-update-{release}/update.sh --check
sudo bash /home/ubuntu/yuhetang-full-update-{release}/update.sh
```

成功标记：`SUCCESS: SERVER RELEASE {release}`。浏览器打开 https://mp-admin.hetuonian.cn/admin 并 Ctrl+F5 刷新。脚本会检查端口、旧 systemd Java 状态、当前站点和独立数据库，切换前备份数据库、配置、uploads 和前端，保留旧 Java 容器。数据库新增 V16 消费明细表；已有 V14 会员余额和 V15 附件迁移保持完整。服务号与小程序密钥继续使用服务器现有配置。

小程序新增了消费记录页面，需要重新编译并上传体验版：可用微信开发者工具导入本包的 `client` 文件夹（AppID `wxce054e18303efb8a`，`miniprogramRoot` 为 `./`），或从 `D:\\github_code\\裕和堂相关项目\\yuhetang-miniprogram` 运行 `npm run build:weapp` 后上传。服务器更新不会替代微信小程序上传。以后新增消费和记录变化通过接口更新，无需因此再次发布。

## 数据与验收

当前显示后台实际登记的会员消费和已补录的原系统历史，不会凭余额推算消费项目。酷鼠历史明细尚未完整迁入，本包不会自动导入真实消费数据；尚未迁入会明确提示，不能据空列表认定顾客没有消费。充值、期初余额与预约不是消费记录，不会混入列表。

先在后台找到本人手机号对应的测试客户，补录一笔已核对的历史订单；客户打开消费记录核对，确认会员余额未变。余额登记消费属于真实记账操作，仅对已核对的实际消费执行。历史补录与余额扣款的同店同凭证重复操作会被阻止。冲正或作废继续保留原记录，客户端显示状态。客户只能查看自己已验证手机号关联的记录，后台内部备注与操作人不会出现在客户端。

本地已通过 Java 251 项测试、小程序 67 项测试、三语/窄屏浏览器检查、原生 wcsc 编译和部署脚本隔离测试。检查使用合成数据，未连接线上数据库、未操作真实余额、未向真实微信客户发送消息。实际手机数据链路须按上述入口在部署后验收。验证报告及工作区源码哈希在 `validation/` 中。
'''
    payload['README.md'] = guide.encode('utf-8')
    manifest = dict(schemaVersion=1, releaseId=release, createdAt=dt.datetime.now(dt.timezone.utc).isoformat(), javaJarSha256=sha(java['reservation.jar']),
                    sources={key: {name: value[name] for name in ('commit', 'workingTreeDirty')} for key, value in sources.items()}, automaticDataImport=False, cloudDeployed=False,
                    files=[dict(path=name, bytes=len(value), sha256=sha(value)) for name, value in sorted(payload.items())])
    payload['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    payload['SHA256SUMS'] = ''.join(sha(value) + '  ' + name + '\n' for name, value in sorted(payload.items())).encode('utf-8')
    title = 'yuhetang-full-update-' + release
    folder, target = ROOT / 'releases' / title, ROOT / 'releases' / (title + '.tar.gz')
    require(not folder.exists() and not target.exists() and not Path(str(target)+'.sha256').exists(), 'Release IDs are immutable')
    folder.mkdir(parents=True)
    for name, value in payload.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
    COMP.UPDATE.verify_package(folder)
    with tarfile.open(target, 'x:gz', compresslevel=6) as archive:
        for name, value in sorted(payload.items()):
            entry = tarfile.TarInfo(title + '/' + name)
            entry.size, entry.mode = len(value), 0o755 if name.endswith('.sh') else 0o644
            archive.addfile(entry, io.BytesIO(value))
    with tarfile.open(target, 'r:gz') as archive:
        require(len(archive.getmembers()) == len(payload), 'Archive file count mismatch')
        for entry in archive:
            require(entry.isfile() and entry.name.startswith(title + '/') and archive.extractfile(entry).read() == payload[entry.name[len(title)+1:]], 'Archive verification failed')
    Path(str(target) + '.sha256').write_text(COMP.UPDATE.digest(target) + '  ' + target.name + '\n', encoding='ascii')
    (ROOT / 'releases' / (title + '.README.md')).write_bytes(payload['README.md'])
    print(json.dumps(dict(archive=str(target), sha256=COMP.UPDATE.digest(target), bytes=target.stat().st_size, files=len(payload)), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
