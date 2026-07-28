$project = Split-Path -Parent $PSScriptRoot
$executable = Join-Path $project 'out\自媒体桌面终端-win32-x64\content-media-terminal.exe'
$profile = Join-Path $project 'artifacts\task-receipts\BIZ-008\acceptance-workspace\profile'

if (-not (Test-Path -LiteralPath $executable)) {
  throw "打包应用不存在，请先运行 scripts/check.ps1"
}

Start-Process -FilePath $executable -ArgumentList "--user-data-dir=$profile"
