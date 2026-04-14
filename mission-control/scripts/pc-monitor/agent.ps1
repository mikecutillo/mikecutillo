# ─── MissionControl PC Monitor Agent ──────────────────────────────────────────
# Silent agent that collects screen time, app usage, browser history, and system
# activity, then reports to Mission Control every 5 minutes.
#
# Usage:  powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File agent.ps1
# Config: C:\MissionControl\config.json
# Buffer: %LOCALAPPDATA%\MissionControl\buffer.jsonl
# ──────────────────────────────────────────────────────────────────────────────

# ─── Load config ──────────────────────────────────────────────────────────────
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $scriptDir 'config.json'
if (!(Test-Path $configPath)) {
    $configPath = 'C:\MissionControl\config.json'
}

$config = @{ serverUrl = 'http://192.168.1.100:3333'; intervalSeconds = 300 }
if (Test-Path $configPath) {
    $loaded = Get-Content $configPath -Raw | ConvertFrom-Json
    if ($loaded.serverUrl) { $config.serverUrl = $loaded.serverUrl }
    if ($loaded.intervalSeconds) { $config.intervalSeconds = $loaded.intervalSeconds }
}

$bufferDir = Join-Path $env:LOCALAPPDATA 'MissionControl'
$bufferFile = Join-Path $bufferDir 'buffer.jsonl'
if (!(Test-Path $bufferDir)) { New-Item -ItemType Directory -Path $bufferDir -Force | Out-Null }

# ─── Win32 P/Invoke for foreground window + idle time ─────────────────────────
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class MCWinAPI {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    [StructLayout(LayoutKind.Sequential)]
    public struct LASTINPUTINFO {
        public uint cbSize;
        public uint dwTime;
    }

    public static int GetIdleMs() {
        LASTINPUTINFO lii = new LASTINPUTINFO();
        lii.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        GetLastInputInfo(ref lii);
        return (int)(Environment.TickCount - (int)lii.dwTime);
    }

    public static string GetForegroundTitle() {
        IntPtr hwnd = GetForegroundWindow();
        StringBuilder sb = new StringBuilder(512);
        GetWindowText(hwnd, sb, 512);
        return sb.ToString();
    }

    public static int GetForegroundPid() {
        IntPtr hwnd = GetForegroundWindow();
        uint pid = 0;
        GetWindowThreadProcessId(hwnd, out pid);
        return (int)pid;
    }
}
"@

# ─── Collector: foreground window ─────────────────────────────────────────────
function Get-ForegroundApp {
    try {
        $title = [MCWinAPI]::GetForegroundTitle()
        $pid = [MCWinAPI]::GetForegroundPid()
        if ($pid -le 0) { return $null }
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if (!$proc) { return $null }
        return @{
            processName = $proc.ProcessName
            windowTitle = $title
        }
    } catch { return $null }
}

# ─── Collector: idle time ─────────────────────────────────────────────────────
function Get-IdleSeconds {
    try {
        $ms = [MCWinAPI]::GetIdleMs()
        return [Math]::Max(0, [Math]::Floor($ms / 1000))
    } catch { return 0 }
}

# ─── Collector: top processes ─────────────────────────────────────────────────
function Get-TopProcesses {
    try {
        Get-Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ProcessName -ne 'Idle' -and $_.ProcessName -ne 'System' } |
            Sort-Object CPU -Descending |
            Select-Object -First 20 |
            ForEach-Object {
                @{
                    name  = $_.ProcessName
                    pid   = $_.Id
                    cpu   = [Math]::Round($_.CPU, 1)
                    memMb = [Math]::Round($_.WorkingSet64 / 1MB, 0)
                }
            }
    } catch { return @() }
}

# ─── Collector: network connections ───────────────────────────────────────────
function Get-ActiveConnections {
    try {
        Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue |
            Select-Object -First 30 |
            ForEach-Object {
                $procName = ''
                try { $procName = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName } catch {}
                @{
                    localPort      = $_.LocalPort
                    remoteAddress  = $_.RemoteAddress
                    remotePort     = $_.RemotePort
                    owningProcess  = $procName
                }
            }
    } catch { return @() }
}

# ─── Collector: browser history ───────────────────────────────────────────────
function Get-BrowserHistory {
    $entries = @()
    $sqlite = Join-Path $scriptDir 'sqlite3.exe'
    if (!(Test-Path $sqlite)) { $sqlite = 'C:\MissionControl\sqlite3.exe' }
    if (!(Test-Path $sqlite)) { return $entries }

    # Chrome timestamp: microseconds since 1601-01-01
    $chromeCutoff = ([DateTimeOffset]::UtcNow.AddHours(-2).ToUnixTimeSeconds() + 11644473600) * 1000000

    $browsers = @(
        @{ name = 'chrome'; path = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\History" },
        @{ name = 'edge';   path = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\History" }
    )

    foreach ($browser in $browsers) {
        if (!(Test-Path $browser.path)) { continue }
        $tempDb = Join-Path $env:TEMP "mc_history_$($browser.name).db"
        try {
            Copy-Item $browser.path $tempDb -Force -ErrorAction Stop
            $query = "SELECT url, title, last_visit_time FROM urls WHERE last_visit_time > $chromeCutoff ORDER BY last_visit_time DESC LIMIT 50;"
            $rows = & $sqlite $tempDb $query 2>$null
            foreach ($row in $rows) {
                $parts = $row -split '\|', 3
                if ($parts.Count -ge 2) {
                    $url = $parts[0]
                    $title = $parts[1]
                    $visitTimestamp = if ($parts.Count -ge 3 -and $parts[2]) {
                        try {
                            $unixSec = [long]$parts[2] / 1000000 - 11644473600
                            [DateTimeOffset]::FromUnixTimeSeconds($unixSec).ToString('o')
                        } catch { (Get-Date).ToString('o') }
                    } else { (Get-Date).ToString('o') }

                    $entries += @{
                        url       = $url
                        title     = $title
                        visitTime = $visitTimestamp
                        browser   = $browser.name
                    }
                }
            }
            Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
        } catch {
            # Browser may have the file locked; skip this cycle
            Remove-Item $tempDb -Force -ErrorAction SilentlyContinue
        }
    }
    return $entries
}

# ─── Collector: login events ──────────────────────────────────────────────────
function Get-LoginEvents {
    $events = @()
    try {
        $cutoff = (Get-Date).AddHours(-2)
        $logEvents = Get-WinEvent -FilterHashtable @{
            LogName   = 'Security'
            Id        = 4624, 4634
            StartTime = $cutoff
        } -MaxEvents 20 -ErrorAction SilentlyContinue

        foreach ($evt in $logEvents) {
            $xml = [xml]$evt.ToXml()
            $logonType = ($xml.Event.EventData.Data | Where-Object { $_.Name -eq 'LogonType' }).'#text'
            # Only interactive logons (2=local, 10=RemoteInteractive, 11=CachedInteractive)
            if ($logonType -notin @('2', '10', '11')) { continue }
            $targetUser = ($xml.Event.EventData.Data | Where-Object { $_.Name -eq 'TargetUserName' }).'#text'
            if ($targetUser -match '^\$|^SYSTEM$|^LOCAL SERVICE$|^NETWORK SERVICE$') { continue }

            $events += @{
                type = if ($evt.Id -eq 4624) { 'logon' } else { 'logoff' }
                user = $targetUser
                time = $evt.TimeCreated.ToString('o')
            }
        }
    } catch {
        # Security log may require specific audit policies; skip gracefully
    }
    return $events
}

# ─── Send report to Mission Control ──────────────────────────────────────────
function Send-Report($report) {
    $json = $report | ConvertTo-Json -Depth 5 -Compress
    $url = "$($config.serverUrl)/api/family/pc-report"
    try {
        $response = Invoke-RestMethod -Uri $url -Method POST -Body $json -ContentType 'application/json' -TimeoutSec 10
        return $true
    } catch {
        return $false
    }
}

function Buffer-Report($report) {
    $json = $report | ConvertTo-Json -Depth 5 -Compress
    Add-Content -Path $bufferFile -Value $json -Encoding UTF8
}

function Flush-Buffer {
    if (!(Test-Path $bufferFile)) { return }
    $lines = Get-Content $bufferFile -Encoding UTF8 -ErrorAction SilentlyContinue
    if (!$lines -or $lines.Count -eq 0) { return }

    $remaining = @()
    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $report = $line | ConvertFrom-Json
            $json = $line
            $url = "$($config.serverUrl)/api/family/pc-report"
            Invoke-RestMethod -Uri $url -Method POST -Body $json -ContentType 'application/json' -TimeoutSec 10
        } catch {
            $remaining += $line
        }
    }

    if ($remaining.Count -gt 0) {
        Set-Content -Path $bufferFile -Value $remaining -Encoding UTF8
    } else {
        Remove-Item $bufferFile -Force -ErrorAction SilentlyContinue
    }
}

# ─── Main loop ────────────────────────────────────────────────────────────────
while ($true) {
    try {
        $report = @{
            hostname       = $env:COMPUTERNAME
            timestamp      = (Get-Date).ToString('o')
            windowsUser    = $env:USERNAME
            foreground     = Get-ForegroundApp
            idleSeconds    = Get-IdleSeconds
            uptime         = [Math]::Floor((Get-CimInstance Win32_OperatingSystem).LastBootUpTime.Subtract([datetime]::MinValue).TotalSeconds)
            processes      = @(Get-TopProcesses)
            connections    = @(Get-ActiveConnections)
            browserHistory = @(Get-BrowserHistory)
            loginEvents    = @(Get-LoginEvents)
        }

        # Try to flush any buffered reports first
        Flush-Buffer

        # Send current report
        $sent = Send-Report $report
        if (!$sent) {
            Buffer-Report $report
        }
    } catch {
        # Log error silently and continue
        $errMsg = "$(Get-Date -Format 'o') ERROR: $($_.Exception.Message)"
        $errLog = Join-Path $bufferDir 'error.log'
        Add-Content -Path $errLog -Value $errMsg -Encoding UTF8
    }

    Start-Sleep -Seconds $config.intervalSeconds
}
