param(
    [Parameter(Mandatory = $true)][string]$ApkPath,
    [string]$NotesPath,
    [string]$SdkRoot = $env:ANDROID_HOME,
    [switch]$ResumeDraft,
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$repo = 'finelly977/paseo'
$root = Split-Path -Parent $PSScriptRoot
$apk = (Resolve-Path -LiteralPath $ApkPath).Path
if (-not $ValidateOnly -and -not $NotesPath) { throw '发布时必须通过 -NotesPath 提供发布说明' }
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^(\d+)\.(\d+)\.(\d+)$') { throw '安卓更新仅发布正式数字版本' }
$code = [int]$Matches[1] * 1000000 + [int]$Matches[2] * 1000 + [int]$Matches[3]
$tag = "android-apk-v$version"
$name = "Paseo-$version-android.apk"
if ([IO.Path]::GetFileName($apk) -ne $name) { throw "安装包必须命名为 $name" }
$buildTools = Get-ChildItem -LiteralPath (Join-Path $SdkRoot 'build-tools') -Directory |
    Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $buildTools) { throw '未找到 Android build-tools' }
$signer = Join-Path $buildTools.FullName 'apksigner.bat'
$aapt = Join-Path $buildTools.FullName 'aapt.exe'
$signatures = & $signer verify --verbose --print-certs $apk
if ($LASTEXITCODE -ne 0) { throw 'APK 签名校验失败' }
if (($signatures -join "`n") -notmatch 'fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c') {
    throw '签名与当前已分发的二开 APK 不一致，不能覆盖升级'
}
& (Join-Path $buildTools.FullName 'zipalign.exe') -c -P 16 -v 4 $apk
if ($LASTEXITCODE -ne 0) { throw 'APK 原生库未正确按 16 KB 对齐，拒绝分发' }
$badging = (& $aapt dump badging $apk) -join "`n"
if ($LASTEXITCODE -ne 0 -or $badging -notmatch "package: name='sh.paseo' versionCode='$code' versionName='$version'") {
    throw 'APK 包名或版本与源码不一致'
}
if ($ValidateOnly) {
    Write-Output 'APK 包名、版本、签名及 16 KB 对齐校验通过；未上传或发布。'
    return
}
if ((& git -C $root status --porcelain)) { throw '请先提交本次交付文件，确保发布源可追溯' }
if ($LASTEXITCODE -ne 0) { throw '无法读取发布源码状态' }
$notes = (Resolve-Path -LiteralPath $NotesPath).Path
$commit = (& git -C $root rev-parse HEAD).Trim()
$sha = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$hashFile = "$apk.sha256"
[IO.File]::WriteAllText($hashFile, "$sha  $name`n")
if (-not $ResumeDraft) {
    & gh release create $tag --repo $repo --target $commit --draft --title "Paseo 安卓 v$version" --notes-file $notes $apk $hashFile
    if ($LASTEXITCODE -ne 0) { throw 'GitHub 草稿上传失败，请检查草稿后重试，不要改用上游仓库' }
}
# 草稿尚未创建真实标签，不能用 REST 的按标签读取接口查询。
$release = (& gh release view $tag --repo $repo --json assets,isDraft | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw '无法读取 GitHub 草稿' }
if (-not $release.isDraft) { throw '目标已正式发布，拒绝改写现有版本' }
$asset = $release.assets | Where-Object name -EQ $name
if ($asset.digest -ne "sha256:$sha" -or $asset.size -ne (Get-Item -LiteralPath $apk).Length) {
    throw 'GitHub 安装包摘要或大小不一致，草稿未发布'
}
& gh release edit $tag --repo $repo --target $commit --draft=false --latest=false
if ($LASTEXITCODE -ne 0) { throw '发布失败，安装包仍留在 GitHub 草稿中' }
Write-Output "已发布：https://github.com/$repo/releases/tag/$tag"
