$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$appDirectory = Join-Path $repoRoot "packages\app"
$desktopDirectory = Join-Path $repoRoot "packages\desktop"
$npmCommand = (Get-Command "npm.cmd" -ErrorAction Stop).Source
$npxCommand = (Get-Command "npx.cmd" -ErrorAction Stop).Source

function Invoke-ExternalCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Description,
    [Parameter(Mandatory = $true)]
    [string]$WorkingDirectory,
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  Write-Host "`n==> $Description" -ForegroundColor Cyan
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      throw "$Description 失败，退出代码：$exitCode"
    }
  }
  finally {
    Pop-Location
  }
}

function Remove-BuildDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $allowedPaths = @(
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot "packages\app\dist")),
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot "packages\desktop\dist"))
  )
  if ($resolvedPath -notin $allowedPaths) {
    throw "拒绝清理未授权目录：$resolvedPath"
  }

  if (Test-Path -LiteralPath $resolvedPath) {
    Write-Host "清理旧构建产物：$resolvedPath"
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
  }
}

Write-Host "开始构建 Paseo Windows x64 NSIS 安装包。" -ForegroundColor Green

Invoke-ExternalCommand -Description "检查源码与锁文件版本一致性" -WorkingDirectory $repoRoot -FilePath $npmCommand -Arguments @("run", "version:check")
Invoke-ExternalCommand -Description "清理并编译桌面界面依赖" -WorkingDirectory $repoRoot -FilePath $npmCommand -Arguments @("run", "build:app-deps:clean")

Remove-BuildDirectory -Path (Join-Path $appDirectory "dist")
$previousWebPlatform = [Environment]::GetEnvironmentVariable("PASEO_WEB_PLATFORM", "Process")
try {
  [Environment]::SetEnvironmentVariable("PASEO_WEB_PLATFORM", "electron", "Process")
  Invoke-ExternalCommand -Description "导出 Electron 桌面界面" -WorkingDirectory $appDirectory -FilePath $npxCommand -Arguments @("expo", "export", "--platform", "web")
}
finally {
  [Environment]::SetEnvironmentVariable("PASEO_WEB_PLATFORM", $previousWebPlatform, "Process")
}

Invoke-ExternalCommand -Description "清理并编译服务端、CLI 及其依赖" -WorkingDirectory $repoRoot -FilePath $npmCommand -Arguments @("run", "build:server:clean")

Remove-BuildDirectory -Path (Join-Path $desktopDirectory "dist")
Invoke-ExternalCommand -Description "编译 Electron 主进程" -WorkingDirectory $desktopDirectory -FilePath $npmCommand -Arguments @("run", "build:main")
Invoke-ExternalCommand -Description "打包前再次检查版本一致性" -WorkingDirectory $repoRoot -FilePath $npmCommand -Arguments @("run", "version:check")
Invoke-ExternalCommand -Description "生成 Windows x64 NSIS 安装包" -WorkingDirectory $desktopDirectory -FilePath $npxCommand -Arguments @("electron-builder", "--config", "electron-builder.yml", "--win", "nsis", "--x64", "--publish", "never")

$installerVersion = (Get-Content -LiteralPath (Join-Path $desktopDirectory "package.json") -Raw | ConvertFrom-Json).version
$installerPath = Join-Path $desktopDirectory "release\Paseo-Setup-$installerVersion-x64.exe"
if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
  throw "构建命令成功结束，但没有找到预期安装包：$installerPath"
}

Write-Host "`nWindows 安装包构建完成：$installerPath" -ForegroundColor Green
