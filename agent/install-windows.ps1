<#
.SYNOPSIS
  Pasang AW Hub agent sebagai Scheduled Task (tiap 15 menit + saat login).

.EXAMPLE
  .\install-windows.ps1 -ServerUrl https://aw.contoh.com -Token xxxxx -DeviceName Kantor
  .\install-windows.ps1 -Uninstall
#>
param(
  [string]$ServerUrl,
  [string]$Token,
  [string]$DeviceName = $env:COMPUTERNAME,
  [string]$HideTitleRegex = "",
  [int]$IntervalMinutes = 15,
  [switch]$Uninstall
)
$ErrorActionPreference = "Stop"
$TaskName = "AW Hub Agent"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path $Here "aw_hub_agent.py"
$Config = Join-Path $Here "config.json"

if ($Uninstall) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Task '$TaskName' dihapus."
  return
}

if (-not (Test-Path $Config)) {
  if (-not $ServerUrl -or -not $Token) { throw "config.json belum ada: isi -ServerUrl dan -Token." }
  [ordered]@{
    server_url       = $ServerUrl
    token            = $Token
    device_name      = $DeviceName
    aw_url           = "http://localhost:5600"
    hide_title_regex = $HideTitleRegex
  } | ConvertTo-Json | ForEach-Object {
    # tulis UTF-8 tanpa BOM (Out-File -Encoding utf8 di PowerShell 5.1 menambahkan BOM)
    [IO.File]::WriteAllText($Config, $_, (New-Object System.Text.UTF8Encoding $false))
  }
  Write-Host "config.json dibuat."
}

# pythonw = tanpa jendela console
$Py = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $Py) { $Py = (Get-Command pyw.exe -ErrorAction SilentlyContinue).Source }
if (-not $Py) { throw "pythonw.exe / pyw.exe tidak ditemukan. Pasang Python 3.9+ dulu." }

$Action = New-ScheduledTaskAction -Execute $Py -Argument "`"$Script`" -c `"$Config`"" -WorkingDirectory $Here
$Triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"),
  (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes))
)
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Triggers -Settings $Settings `
  -Description "Kirim data ActivityWatch ke AW Hub" -Force | Out-Null
Write-Host "Task '$TaskName' terpasang (tiap $IntervalMinutes menit + saat login)."
Write-Host "Sinkron awal mengirim seluruh riwayat, bisa beberapa menit. Log: $Here\aw-hub-agent.log"
Start-ScheduledTask -TaskName $TaskName
