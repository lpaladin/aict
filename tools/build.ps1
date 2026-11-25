param(
    [string]$ConnectionConfig = "",
    [string]$OutputApk = "dist/aict-demo-0.4.1.apk",
    [string]$SdkPlatform = 'D:\Projects\AIProjects\bettergpt\.checks\sdk\android-35',
    [string]$BuildTools = 'D:\Projects\AIProjects\bettergpt\.checks\sdk\android-15',
    [string]$Jdk = 'C:\Program Files\Java\jdk-11.0.7',
    [string]$RuntimeJava = 'D:\Projects\AIProjects\bettergpt\.checks\jadx\jre\bin\java.exe',
    [string]$Apktool = "$PSScriptRoot\..\.tools\apktool-new.jar",
    [string]$Python = 'C:\Users\hy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
function Run([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed ($LASTEXITCODE)" }
}
New-Item -ItemType Directory -Force .build/classes,.build/dex,dist,.secrets | Out-Null
$android = (Resolve-Path "$SdkPlatform/android.jar").Path
if (!(Test-Path client/assets/connection.json)) { Run $Python @('tools/provision.py') }
if (!(Test-Path .build/template/AndroidManifest.xml)) {
    Run $RuntimeJava @('-jar',$Apktool,'d','-f','-s','-p','.build/framework35','.tools/template.apk','-o','.build/template')
}
$prepareArgs = @('tools/prepare_apk.py')
if ($ConnectionConfig) { $prepareArgs += @('--connection', $ConnectionConfig) }
Run $Python $prepareArgs
$sources = @(Get-ChildItem client/src -Recurse -Filter '*.java' | ForEach-Object FullName)
Run "$Jdk/bin/javac.exe" (@('-encoding','UTF-8','-source','8','-target','8','-cp',"$android;$PWD/.tools/jsch.jar",'-d',"$PWD/.build/classes") + $sources)
Run "$Jdk/bin/jar.exe" @('cf','.build/client.jar','-C','.build/classes','.')
Run $RuntimeJava @('-cp',"$BuildTools/lib/d8.jar",'com.android.tools.r8.D8','--min-api','26','--lib',$android,'--output','.build/dex','.build/client.jar','.tools/jsch.jar')
# Upstream has classes.dex through classes8.dex; append all source-built DEX files.
$next = 9
foreach ($dex in Get-ChildItem .build/dex -Filter '*.dex' | Sort-Object Name) {
    Copy-Item -LiteralPath $dex.FullName -Destination ".build/template/classes$next.dex" -Force
    $next++
}
Run $RuntimeJava @('-jar',$Apktool,'b','-p','.build/framework35','.build/template','-o','.build/aict-unsigned.apk')
Run "$BuildTools/zipalign.exe" @('-f','-p','4','.build/aict-unsigned.apk','.build/aict-aligned.apk')
if (!(Test-Path .secrets/apk-signing.p12)) {
    Run "$Jdk/bin/keytool.exe" @('-genkeypair','-keystore','.secrets/apk-signing.p12','-storepass','aict-local-build','-keypass','aict-local-build','-alias','aict','-dname','CN=AICT Local Distribution','-keyalg','RSA','-keysize','3072','-validity','10000')
}
Run $RuntimeJava @('-jar',"$BuildTools/lib/apksigner.jar",'sign','--ks','.secrets/apk-signing.p12','--ks-pass','pass:aict-local-build','--key-pass','pass:aict-local-build','--v4-signing-enabled','false','--out',$OutputApk,'.build/aict-aligned.apk')
Run $RuntimeJava @('-jar',"$BuildTools/lib/apksigner.jar",'verify','--verbose','--print-certs',$OutputApk)
Get-FileHash $OutputApk -Algorithm SHA256
