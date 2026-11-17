param([string]$Python = 'C:\Users\hy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
New-Item -ItemType Directory -Force .tools | Out-Null
& $Python -m pip install --target .tools/python -r server/requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Server dependency installation failed' }
& curl.exe --noproxy '*' -f -L --retry 2 'https://api.github.com/repos/SuperMonster003/AutoJs6/releases/tags/v6.6.4' -o .release.json
if ($LASTEXITCODE -ne 0) { throw 'Release metadata download failed' }
& $Python tools/download_runtime.py
if ($LASTEXITCODE -ne 0) { throw 'Runtime download failed' }
& $Python tools/download_runtime.py --apktool
if ($LASTEXITCODE -ne 0) { throw 'Apktool download failed' }
& $Python -c "import zipfile; z=zipfile.ZipFile('.tools/autojs6-runtime-source.apk'); open('.tools/template.apk','wb').write(z.read('assets/template.apk'))"
if ($LASTEXITCODE -ne 0) { throw 'Template extraction failed' }
& curl.exe --noproxy '*' -f -L --retry 2 'https://repo.maven.apache.org/maven2/com/github/mwiede/jsch/0.2.26/jsch-0.2.26.jar' -o .tools/jsch.jar
if ($LASTEXITCODE -ne 0) { throw 'SSH dependency download failed' }
& $Python tools/provision.py
if ($LASTEXITCODE -ne 0) { throw 'Credential provisioning failed' }
