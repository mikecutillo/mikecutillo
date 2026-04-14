# ─── MissionControl PC Monitor — Installer ────────────────────────────────────
# Run this once on each Windows PC as Administrator.
#
# Usage:  powershell -ExecutionPolicy Bypass -File install.ps1 -ServerUrl "http://192.168.1.100:3333"
# ──────────────────────────────────────────────────────────────────────────────

param(
    [string]$ServerUrl = 'http://192.168.1.100:3333',
    [int]$IntervalSeconds = 300,
    [string]$InstallDir = 'C:\MissionControl'
)

$ErrorActionPreference = 'Stop'

Write-Host '╔══════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '║   MissionControl PC Monitor — Installer      ║' -ForegroundColor Cyan
Write-Host '╚══════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''

# ─── 1. Create install directory ──────────────────────────────────────────────
Write-Host '[1/5] Creating install directory...' -ForegroundColor Yellow
if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}
Write-Host "       $InstallDir" -ForegroundColor Green

# ─── 2. Copy agent script ────────────────────────────────────────────────────
Write-Host '[2/5] Copying agent.ps1...' -ForegroundColor Yellow
$agentSource = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'agent.ps1'
$agentDest = Join-Path $InstallDir 'agent.ps1'
Copy-Item $agentSource $agentDest -Force
Write-Host "       $agentDest" -ForegroundColor Green

# ─── 3. Write config ─────────────────────────────────────────────────────────
Write-Host '[3/5] Writing config.json...' -ForegroundColor Yellow
$configPath = Join-Path $InstallDir 'config.json'
$configObj = @{
    serverUrl       = $ServerUrl
    intervalSeconds = $IntervalSeconds
}
$configObj | ConvertTo-Json | Set-Content $configPath -Encoding UTF8
Write-Host "       Server: $ServerUrl" -ForegroundColor Green
Write-Host "       Interval: ${IntervalSeconds}s" -ForegroundColor Green

# ─── 4. Download portable sqlite3.exe ────────────────────────────────────────
Write-Host '[4/5] Checking for sqlite3.exe...' -ForegroundColor Yellow
$sqlitePath = Join-Path $InstallDir 'sqlite3.exe'
if (!(Test-Path $sqlitePath)) {
    Write-Host '       Downloading portable sqlite3...' -ForegroundColor Yellow
    $sqliteUrl = 'https://www.sqlite.org/2024/sqlite-tools-win-x64-3470200.zip'
    $zipPath = Join-Path $env:TEMP 'sqlite-tools.zip'
    $extractPath = Join-Path $env:TEMP 'sqlite-tools'

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $sqliteUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

        # Find sqlite3.exe in the extracted folder
        $found = Get-ChildItem -Path $extractPath -Recurse -Filter 'sqlite3.exe' | Select-Object -First 1
        if ($found) {
            Copy-Item $found.FullName $sqlitePath -Force
            Write-Host "       Downloaded to $sqlitePath" -ForegroundColor Green
        } else {
            Write-Host '       WARNING: sqlite3.exe not found in download. Browser history will be skipped.' -ForegroundColor Red
        }

        # Cleanup
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Host "       WARNING: Could not download sqlite3.exe: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host '       Browser history collection will be disabled. Agent will still collect all other data.' -ForegroundColor Yellow
    }
} else {
    Write-Host '       sqlite3.exe already present' -ForegroundColor Green
}

# ─── 5. Register scheduled task ──────────────────────────────────────────────
Write-Host '[5/5] Registering scheduled task...' -ForegroundColor Yellow
$taskName = 'MissionControl-Monitor'

# Remove existing task if present
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host '       Removed existing task' -ForegroundColor Yellow
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$agentDest`""

$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Seconds 60) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -RunLevel Highest `
    -LogonType S4U

Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'MissionControl silent PC monitoring agent — reports screen time and app usage' | Out-Null

Write-Host "       Task registered: $taskName" -ForegroundColor Green

# ─── Start the task now ───────────────────────────────────────────────────────
Write-Host ''
Write-Host 'Starting agent now...' -ForegroundColor Cyan
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 2
$status = (Get-ScheduledTask -TaskName $taskName).State
Write-Host "Task status: $status" -ForegroundColor $(if ($status -eq 'Running') { 'Green' } else { 'Yellow' })

Write-Host ''
Write-Host '╔══════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '║   Installation complete!                      ║' -ForegroundColor Green
Write-Host '║                                              ║' -ForegroundColor Green
Write-Host '║   Agent will report to Mission Control       ║' -ForegroundColor Green
Write-Host "║   every $($IntervalSeconds / 60) minutes silently.                  ║" -ForegroundColor Green
Write-Host '║                                              ║' -ForegroundColor Green
Write-Host '║   To uninstall:                              ║' -ForegroundColor Green
Write-Host '║   Unregister-ScheduledTask MissionControl-Monitor ║' -ForegroundColor Green
Write-Host '║   Remove-Item C:\MissionControl -Recurse    ║' -ForegroundColor Green
Write-Host '╚══════════════════════════════════════════════╝' -ForegroundColor Green
