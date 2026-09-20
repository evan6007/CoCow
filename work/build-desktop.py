from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import io, json, re, tarfile, hashlib, plistlib, sys
from zipfile import ZipInfo

base=Path(__file__).resolve().parent.parent
source=base/'outputs/codex-chat-demo'
build=base/'work/desktop-build'
build.mkdir(exist_ok=True)
runtime=base/'work/desktop-build-tools/node-runtime/node-v24.21.0-win-x64'
fonts=set(re.findall(r'/fonts/([a-f0-9]{24}\.woff2)',(source/'font.css').read_text(encoding='utf-8-sig')))
assets=[p for p in source.iterdir() if p.is_file() and p.suffix in {'.mjs','.js','.html','.css','.svg','.py'}]
assets += [source/'fonts'/name for name in sorted(fonts)]+[source/'fonts/OFL.txt']
with ZipFile(build/'workbench.zip','w',ZIP_DEFLATED,compresslevel=6) as archive:
    for p in assets: archive.write(p,'app/'+p.relative_to(source).as_posix())
    archive.write(runtime/'node.exe','runtime/node.exe')
    archive.write(runtime/'LICENSE','runtime/LICENSE')
if '--windows-only' in sys.argv:
    print(json.dumps({'windowsPayload':str(build/'workbench.zip'),'files':len(assets)}))
    sys.exit(0)

# A native Debian package installs the bundled runtime and desktop shortcut.
# No post-install script, account data, or service running as root is included.
linux=base/'work/linux-guide-runtime/node'
def tar_bytes(items):
    output=io.BytesIO()
    with tarfile.open(fileobj=output,mode='w:gz') as archive:
        for name,content,mode in items:
            if isinstance(content,Path): content=content.read_bytes()
            if isinstance(content,str): content=content.encode()
            info=tarfile.TarInfo(name);info.size=len(content);info.mode=mode;info.uid=info.gid=0
            info.uname=info.gname='root';info.mtime=0;archive.addfile(info,io.BytesIO(content))
    return output.getvalue()
control='Package: workbench-desktop\nVersion: 0.16.0~preview\nSection: utils\nPriority: optional\nArchitecture: amd64\nMaintainer: Workbench Maintainers <workbench@localhost>\nDepends: libc6 (>= 2.28), libstdc++6, xdg-utils\nDescription: Workbench local desktop launcher (preview)\n Bundled runtime, automatic local records, and desktop launcher.\n Tailscale login and a machine sharing invitation are still required.\n'
items=[('usr/lib/workbench/app/'+p.relative_to(source).as_posix(),p,0o644) for p in assets]
items += [('usr/lib/workbench/runtime/node',linux/'bin/node',0o755),('usr/lib/workbench/runtime/LICENSE',linux/'LICENSE',0o644),('usr/bin/workbench','#!/bin/sh\nexec /usr/lib/workbench/runtime/node /usr/lib/workbench/app/desktop-launch.mjs\n',0o755),('usr/share/applications/workbench.desktop','[Desktop Entry]\nType=Application\nName=工作台\nName[en]=Workbench\nComment=Open your local workbench\nExec=/usr/bin/workbench\nIcon=workbench\nTerminal=false\nCategories=Development;Utility;\n',0o644),('usr/share/icons/hicolor/scalable/apps/workbench.svg',source/'favicon.svg',0o644)]
with (base/'outputs/Workbench-Linux-0.16-preview-amd64.deb').open('wb') as f:
    f.write(b'!<arch>\n')
    for name,data in [('debian-binary',b'2.0\n'),('control.tar.gz',tar_bytes([('control',control,0o644)])),('data.tar.gz',tar_bytes(items))]:
        f.write(f'{name+"/":<16}{0:<12}{0:<6}{0:<6}{"100644":<8}{len(data):<10}`\n'.encode('ascii'))
        f.write(data)
        if len(data)%2: f.write(b'\n')
# Apple Silicon app bundle. Keep executable modes in the ZIP; no post-install
# scripts, credentials, third-party installers, or security-setting changes.
mac_archive=base/'work/desktop-build-tools/node-v24.21.0-darwin-arm64.tar.gz'
assert hashlib.sha256(mac_archive.read_bytes()).hexdigest()=='bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057'
with tarfile.open(mac_archive,'r:gz') as archive:
    mac_node=archive.extractfile('node-v24.21.0-darwin-arm64/bin/node').read()
    mac_license=archive.extractfile('node-v24.21.0-darwin-arm64/LICENSE').read()
assert mac_node[:4]==bytes.fromhex('cffaedfe') and int.from_bytes(mac_node[4:8],'little')==0x100000c
plist=plistlib.dumps({'CFBundleIdentifier':'tw.e806.workbench','CFBundleName':'Workbench','CFBundleDisplayName':'工作台','CFBundleExecutable':'workbench','CFBundlePackageType':'APPL','CFBundleShortVersionString':'0.16.0','CFBundleVersion':'16','LSApplicationCategoryType':'public.app-category.developer-tools','LSArchitecturePriority':['arm64'],'LSUIElement':True})
with ZipFile(base/'outputs/Workbench-Mac-0.16-preview-arm64.zip','w',ZIP_DEFLATED,compresslevel=6) as archive:
    def add(name,content,mode=0o644):
        item=ZipInfo('Workbench.app/Contents/'+name);item.create_system=3;item.external_attr=(0o100000|mode)<<16;item.compress_type=ZIP_DEFLATED
        if isinstance(content,Path): content=content.read_bytes()
        if isinstance(content,str): content=content.encode('utf-8')
        archive.writestr(item,content)
    add('Info.plist',plist)
    add('MacOS/workbench','#!/bin/sh\nset -eu\nHERE="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexec "$HERE/../Resources/runtime/node" "$HERE/../Resources/app/desktop-launch.mjs"\n',0o755)
    add('Resources/runtime/node',mac_node,0o755);add('Resources/runtime/LICENSE',mac_license)
    for p in assets:add('Resources/app/'+p.relative_to(source).as_posix(),p)
report={'files':len(assets),'runtimeVersion':'24.21.0','bundledSecrets':False,'linuxPackage':'Workbench-Linux-0.16-preview-amd64.deb','macPackage':'Workbench-Mac-0.16-preview-arm64.zip','macArch':'Mach-O arm64','signed':False,'windowsPayloadSha256':hashlib.sha256((build/'workbench.zip').read_bytes()).hexdigest()}
(build/'build-summary.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
