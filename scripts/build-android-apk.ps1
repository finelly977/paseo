param(
    [string]$OutputDirectory,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$app = Join-Path $root 'packages\app'
$key = Join-Path $app '.secrets\android-local.keystore'
if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
    throw '缺少原侧载签名备份 packages/app/.secrets/android-local.keystore；不会生成新签名导致已有用户无法升级'
}
if (-not $env:ANDROID_HOME) {
    $env:ANDROID_HOME = Join-Path $root '.output\android-sdk'
}
$env:ANDROID_HOME = [IO.Path]::GetFullPath($env:ANDROID_HOME)
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME 'build-tools') -PathType Container)) {
    throw '未找到 Android SDK build-tools，请在项目 .output/android-sdk 安装工具链，或显式设置 ANDROID_HOME'
}
if (-not $env:JAVA_HOME) {
    $java = (Get-Command 'java.exe' -ErrorAction Stop).Source
    $env:JAVA_HOME = Split-Path -Parent (Split-Path -Parent $java)
}
$env:Path = "$(Join-Path $env:JAVA_HOME 'bin');$env:Path"
$keytool = Join-Path $env:JAVA_HOME 'bin\keytool.exe'
$certificate = & $keytool -list -v -keystore $key -alias androiddebugkey -storepass android
if ($LASTEXITCODE -ne 0) { throw '无法读取原侧载签名备份，请检查 JDK 和密钥' }
$fingerprint = ($certificate -join "`n").Replace(':', '').ToLowerInvariant()
if (-not $fingerprint.Contains('fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c')) {
    throw '签名备份与已分发 APK 不一致，拒绝构建不可覆盖升级的安装包'
}
$npm = (Get-Command 'npm.cmd' -ErrorAction Stop).Source
$npx = (Get-Command 'npx.cmd' -ErrorAction Stop).Source
if ($CheckOnly) {
    Write-Host "安卓 SDK、JDK、npm 和原侧载签名备份检查通过；SDK：$env:ANDROID_HOME；未构建。"
    return
}
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root '.output\deliverables' }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version

function Invoke-BuildStep {
    param([string]$Description, [string]$Directory, [string]$Command, [string[]]$Arguments)
    Write-Host "`n==> $Description" -ForegroundColor Cyan
    Push-Location -LiteralPath $Directory
    try {
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$Description 失败，退出代码：$LASTEXITCODE" }
    } finally { Pop-Location }
}

$env:APP_VARIANT = 'production'
$env:PASEO_LOCAL_APK = '1'
$env:EXPO_NO_METRO_WORKSPACE_ROOT = '1'
$env:NODE_ENV = 'production'
$env:CI = '1'
$env:EXPO_NO_TELEMETRY = '1'
[Environment]::SetEnvironmentVariable('PASEO_FDROID_BUILD', $null, 'Process')
[Environment]::SetEnvironmentVariable('PASEO_WEB_PLATFORM', $null, 'Process')
[Environment]::SetEnvironmentVariable('EXPO_PUBLIC_LOCAL_DAEMON', $null, 'Process')

$resources = @(
    @{ Path = (Join-Path $app 'src\terminal\webview\terminal-emulator-webview-html.ts'); Script = 'build:terminal-webview'; Before = $null; Generated = $null },
    @{ Path = (Join-Path $app 'src\components\markdown\fence\mermaid\runtime\html.gen.ts'); Script = 'build:mermaid-runtime'; Before = $null; Generated = $null }
)
foreach ($resource in $resources) { $resource.Before = [IO.File]::ReadAllBytes($resource.Path) }
$gradle = Join-Path $app 'android\app\build.gradle'
$gradleBefore = $null
try {
    Invoke-BuildStep '检查版本一致性' $root $npm @('run', 'version:check')
    Invoke-BuildStep '编译应用依赖' $root $npm @('run', 'build:app-deps:clean')
    foreach ($resource in $resources) {
        try {
            Invoke-BuildStep "生成资源 $($resource.Script)" $root $npm @('run', $resource.Script, '--workspace=@getpaseo/app')
        } finally { $resource.Generated = [IO.File]::ReadAllBytes($resource.Path) }
    }
    Invoke-BuildStep '生成安卓原生工程' $app $npx @('expo', 'prebuild', '--platform', 'android', '--no-install')
    $properties = Join-Path $app 'android\local.properties'
    $sdkProperty = "sdk.dir=$($env:ANDROID_HOME.Replace('\', '/'))"
    if (Test-Path -LiteralPath $properties) {
        $propertiesContent = [IO.File]::ReadAllText($properties)
        if ($propertiesContent -match '(?m)^sdk\.dir=') {
            $propertiesContent = [regex]::Replace($propertiesContent, '(?m)^sdk\.dir=[^\r\n]*', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $sdkProperty })
        } else {
            $propertiesContent += "`n$sdkProperty`n"
        }
    } else {
        $propertiesContent = "$sdkProperty`n"
    }
    [IO.File]::WriteAllText($properties, $propertiesContent, [Text.UTF8Encoding]::new($false))
    Copy-Item -LiteralPath $key -Destination (Join-Path $app 'android\app\debug.keystore') -Force
    $gradleBefore = [IO.File]::ReadAllBytes($gradle)
    $content = [Text.Encoding]::UTF8.GetString($gradleBefore)
    if ($content -match 'setActions\s*\(\s*\[\s*\]\s*\)') {
        throw '生成工程存在跳过构建任务的设置，拒绝使用陈旧前端字节码打包'
    }
    # 限制 Metro 与 Gradle 并行数，避免打包抢占全部内存；不跳过前端编译。
    [IO.File]::WriteAllText($gradle, $content + "`nreact { extraPackagerArgs = ['--max-workers', '2'] }`n", [Text.UTF8Encoding]::new($false))
    Invoke-BuildStep '生成 ARM64 与 x86_64 Release APK' (Join-Path $app 'android') (Join-Path $app 'android\gradlew.bat') @(
        ':app:assembleRelease', '-PreactNativeArchitectures=arm64-v8a,x86_64', '--no-daemon', '--max-workers=1',
        '-Dorg.gradle.parallel=false', '-x', 'lint', '-x', 'lintVitalAnalyzeRelease', '-x', 'lintVitalRelease'
    )
    $apk = Join-Path $OutputDirectory "Paseo-$version-android.apk"
    Copy-Item -LiteralPath (Join-Path $app 'android\app\build\outputs\apk\release\app-release.apk') -Destination $apk -Force
} finally {
    if ($null -ne $gradleBefore) { [IO.File]::WriteAllBytes($gradle, $gradleBefore) }
    $changedResources = @()
    foreach ($resource in $resources) {
        if ($null -eq $resource.Generated) { continue }
        $current = [Convert]::ToBase64String([IO.File]::ReadAllBytes($resource.Path))
        if ($current -ne [Convert]::ToBase64String($resource.Generated)) {
            $changedResources += $resource.Path
        } else {
            [IO.File]::WriteAllBytes($resource.Path, $resource.Before)
        }
    }
    if ($changedResources.Count -gt 0) {
        throw "构建期间生成资源被外部修改，保留该修改并停止发布，请检查后重试：$($changedResources -join ', ')"
    }
}
& (Join-Path $PSScriptRoot 'publish-android-apk.ps1') -ApkPath $apk -ValidateOnly -SdkRoot $env:ANDROID_HOME
Write-Host "`n安卓安装包构建完成：$apk" -ForegroundColor Green
