#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-AgentLog {
  param([string]$HypothesisId, [string]$Location, [string]$Message, $Data)
  #region agent log
  try {
    $logPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'debug-e15d93.log'
    $payload = @{
      sessionId = 'e15d93'
      timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      hypothesisId = $HypothesisId
      location = $Location
      message = $Message
      data = $Data
    } | ConvertTo-Json -Compress -Depth 6
    Add-Content -LiteralPath $logPath -Value $payload -Encoding UTF8
  } catch { }
  #endregion
}

Write-AgentLog 'E' 'launcher.ps1:entry' 'script start' @{
  psVersion = $PSVersionTable.PSVersion.ToString()
  sta = [System.Threading.Thread]::CurrentThread.GetApartmentState().ToString()
  scriptRoot = "$PSScriptRoot"
}

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -TypeDefinition @'
public class MsStaticRoot {
  public string Id { get; set; }
  public string Label { get; set; }
  public override string ToString() { return Label ?? Id ?? ""; }
}
'@
  [System.Windows.Forms.Application]::EnableVisualStyles()
  Write-AgentLog 'A' 'launcher.ps1:addtype' 'Add-Type ok' @{}
} catch {
  Write-AgentLog 'A' 'launcher.ps1:addtype' 'Add-Type failed' @{
    type = $_.Exception.GetType().FullName
    msg = $_.Exception.Message
    line = $_.InvocationInfo.ScriptLineNumber
  }
  throw
}

#region agent log
try {
  Add-Type -Namespace Native -Name AgentWin -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@
  $consoleHwnd = [Native.AgentWin]::GetConsoleWindow()
  $hidden = $false
  if ($consoleHwnd -ne [IntPtr]::Zero) {
    $hidden = [Native.AgentWin]::ShowWindow($consoleHwnd, 0)
  }
  Write-AgentLog 'E' 'launcher.ps1:hide-console' 'console hide' @{
    hwnd = "$consoleHwnd"
    hidden = $hidden
    runId = 'post-fix'
  }
} catch {
  Write-AgentLog 'E' 'launcher.ps1:hide-console' 'console hide failed' @{
    msg = $_.Exception.Message
    runId = 'post-fix'
  }
}
#endregion

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $RepoRoot

$script:DevProc = $null
$script:StaticProc = $null
$script:BuildProc = $null
$script:RestartDevAfterBuild = $false
$script:StartLanAfterBuild = $false
$script:TickLogsLeft = 5
$MaxLogLines = 5000

function Get-ListenPids([int]$Port) {
  $pids = New-Object System.Collections.Generic.List[int]
  $lines = netstat -ano | Select-String -Pattern (":$Port\s") | Select-String 'LISTENING'
  foreach ($line in @($lines)) {
    if ($null -eq $line) { continue }
    $parts = ($line.Line -split '\s+') | Where-Object { $_ }
    if ($parts.Count -gt 0) {
      $last = $parts[-1]
      $n = 0
      if ([int]::TryParse($last, [ref]$n) -and $n -gt 0 -and -not $pids.Contains($n)) {
        $pids.Add($n)
      }
    }
  }
  return $pids
}

function Test-PortListening([int]$Port) {
  $tcp = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $tcp.BeginConnect('127.0.0.1', $Port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(80, $false)
    if ($ok) {
      try { $tcp.EndConnect($iar) } catch { return $false }
      return $true
    }
    return $false
  } catch {
    return $false
  } finally {
    $tcp.Close()
  }
}

function Stop-PidTree([int]$ProcessId) {
  if ($ProcessId -le 0) { return }
  Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', "$ProcessId", '/T', '/F') -WindowStyle Hidden -Wait
}

function Stop-ListenPorts([int[]]$Ports) {
  foreach ($port in $Ports) {
    foreach ($listenPid in @(Get-ListenPids $port)) {
      Append-Log $script:ActiveLog "Port $port is in use. Stopping PID $listenPid ..."
      Stop-PidTree $listenPid
    }
  }
}

function Invoke-UiAction([scriptblock]$Action) {
  try {
    & $Action
  } catch {
    $msg = $_.Exception.Message
    try {
      Append-Log $script:ActiveLog $msg
    } catch { }
    [System.Windows.Forms.MessageBox]::Show(
      $msg,
      'MangaSketcher',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  }
}

function Wait-PortsFree([int[]]$Ports, [int]$TimeoutSec) {
  $deadline = [datetime]::UtcNow.AddSeconds($TimeoutSec)
  while ([datetime]::UtcNow -lt $deadline) {
    $busy = $false
    foreach ($port in $Ports) {
      if (Test-PortListening $port) { $busy = $true; break }
    }
    if (-not $busy) { return $true }
    Start-Sleep -Milliseconds 400
    [System.Windows.Forms.Application]::DoEvents()
  }
  return $false
}

function Get-LanIpv4 {
  $addrs = New-Object System.Collections.Generic.List[string]
  try {
    foreach ($ni in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($ni.OperationalStatus -ne 'Up') { continue }
      $props = $ni.GetIPProperties()
      foreach ($uni in $props.UnicastAddresses) {
        if ($uni.Address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
        $ip = $uni.Address.ToString()
        if ($ip -eq '127.0.0.1' -or $ip.StartsWith('169.254.')) { continue }
        if (-not $addrs.Contains($ip)) { $addrs.Add($ip) }
      }
    }
  } catch { }
  $pref = $addrs | Where-Object { $_.StartsWith('192.168.') } | Select-Object -First 1
  if ($pref) { return $pref }
  if ($addrs.Count -gt 0) { return $addrs[0] }
  return '127.0.0.1'
}

function Get-StaticRootItems {
  $items = New-Object System.Collections.Generic.List[object]
  function Read-MetaLabel([string]$Id, [string]$Dir) {
    $metaPath = Join-Path $Dir 'build-meta.json'
    $built = $null
    $git = $null
    if (Test-Path -LiteralPath $metaPath) {
      try {
        $meta = Get-Content -LiteralPath $metaPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($meta.builtAt) { $built = [string]$meta.builtAt }
        if ($meta.git) { $git = [string]$meta.git }
      } catch { }
    }
    $parts = New-Object System.Collections.Generic.List[string]
    if ($Id -eq 'out') { $parts.Add('out (latest)') } else { $parts.Add($Id) }
    if ($built) { $parts.Add("built $built") }
    if ($Id -ne 'out') {
      $stamp = Split-Path -Leaf $Id
      $parts.Add("parkedAt $stamp")
    }
    if ($git) { $parts.Add($git) }
    return ($parts -join ' | ')
  }
  function New-RootItem([string]$Id, [string]$Dir) {
    $o = New-Object MsStaticRoot
    $o.Id = $Id
    $o.Label = Read-MetaLabel $Id $Dir
    return $o
  }
  $outDir = Join-Path $RepoRoot 'out'
  if (Test-Path -LiteralPath (Join-Path $outDir 'index.html')) {
    $items.Add((New-RootItem 'out' $outDir))
  }
  $backupRoot = Join-Path $RepoRoot 'out-backup'
  if (Test-Path -LiteralPath $backupRoot) {
    $dirs = Get-ChildItem -LiteralPath $backupRoot -Directory | Sort-Object Name -Descending
    foreach ($d in $dirs) {
      if (-not (Test-Path -LiteralPath (Join-Path $d.FullName 'index.html'))) { continue }
      $id = "out-backup/$($d.Name)"
      $items.Add((New-RootItem $id $d.FullName))
    }
  }
  return $items
}

function Test-ProcAlive($proc) {
  return $null -ne $proc -and -not $proc.HasExited
}

function Append-Log {
  param(
    [System.Windows.Forms.TextBox]$Box,
    [string]$Text
  )
  if ($null -eq $Box) { return }
  $action = {
    param($b, $t)
    if ($b.Lines.Count -gt $script:MaxLogLines) {
      $keep = $b.Lines | Select-Object -Last ([Math]::Floor($script:MaxLogLines * 0.8))
      $b.Lines = @($keep)
    }
    $b.AppendText($t + [Environment]::NewLine)
  }
  if ($Box.InvokeRequired) {
    [void]$Box.BeginInvoke($action, @($Box, $Text))
  } else {
    & $action $Box $Text
  }
}

function Stop-TrackedProcess($proc) {
  if ($null -eq $proc) { return }
  try {
    if (-not $proc.HasExited) {
      Stop-PidTree $proc.Id
    }
  } catch { }
}

function New-RedirectedProcess {
  param(
    [string]$FileName,
    [string]$Arguments,
    [hashtable]$ExtraEnv,
    [System.Windows.Forms.TextBox]$LogBox,
    [switch]$Stdin
  )
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $FileName
  $psi.Arguments = $Arguments
  $psi.WorkingDirectory = $RepoRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.RedirectStandardInput = [bool]$Stdin
  $psi.StandardOutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $psi.StandardErrorEncoding = [System.Text.UTF8Encoding]::new($false)
  if ($ExtraEnv) {
    foreach ($k in $ExtraEnv.Keys) {
      $psi.EnvironmentVariables[$k] = [string]$ExtraEnv[$k]
    }
  }
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  $p.EnableRaisingEvents = $true
  $handler = {
    if (-not [string]::IsNullOrEmpty($EventArgs.Data)) {
      Append-Log $Event.MessageData $EventArgs.Data
    }
  }
  $null = Register-ObjectEvent -InputObject $p -EventName OutputDataReceived -Action $handler -MessageData $LogBox
  $null = Register-ObjectEvent -InputObject $p -EventName ErrorDataReceived -Action $handler -MessageData $LogBox
  $null = Register-ObjectEvent -InputObject $p -EventName Exited -MessageData $LogBox -Action {
    Append-Log $Event.MessageData ("--- exited $($Event.Sender.ExitCode) ---")
  }
  [void]$p.Start()
  $p.BeginOutputReadLine()
  $p.BeginErrorReadLine()
  return $p
}

function Get-NodePath {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw 'node が見つかりません。Node.js 20 以上を PATH に入れてください。'
}

function Get-NpmCmd {
  $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw 'npm が見つかりません。'
}

function Confirm-RestartSlot([string]$Name, $proc) {
  if (-not (Test-ProcAlive $proc)) { return $true }
  $r = [System.Windows.Forms.MessageBox]::Show(
    "$Name は実行中です。止めてから起動しますか?",
    'MangaSketcher',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question
  )
  return $r -eq [System.Windows.Forms.DialogResult]::Yes
}

function Refresh-RootCombo {
  $keepId = $null
  if ($comboRoots.SelectedItem) { $keepId = $comboRoots.SelectedItem.Id }
  $comboRoots.Items.Clear()
  foreach ($item in @(Get-StaticRootItems)) {
    [void]$comboRoots.Items.Add($item)
  }
  $comboRoots.DisplayMember = 'Label'
  $comboRoots.ValueMember = 'Id'
  if ($comboRoots.Items.Count -eq 0) {
    $comboRoots.SelectedIndex = -1
    return
  }
  $idx = 0
  if ($keepId) {
    for ($i = 0; $i -lt $comboRoots.Items.Count; $i++) {
      if ($comboRoots.Items[$i].Id -eq $keepId) { $idx = $i; break }
    }
  }
  $comboRoots.SelectedIndex = $idx
}

function Get-SelectedRootId {
  if ($comboRoots.SelectedItem) { return [string]$comboRoots.SelectedItem.Id }
  return ''
}

function Start-DevServer {
  param([switch]$Force)
  if (-not $Force -and -not (Confirm-RestartSlot '開発サーバー' $script:DevProc)) { return }
  Stop-TrackedProcess $script:DevProc
  $script:DevProc = $null
  Stop-ListenPorts @(3000)
  if (-not (Wait-PortsFree @(3000) 30)) {
    Append-Log $logDev 'Timed out waiting for port 3000 to be free.'
    return
  }
  $tabs.SelectedTab = $pageDev
  Append-Log $logDev 'Starting start-dev.mjs (non-TTY output may buffer)...'
  $node = Get-NodePath
  $script:DevProc = New-RedirectedProcess -FileName $node -Arguments 'scripts\start-dev.mjs' -LogBox $logDev
}

function Start-StaticHost {
  param([switch]$Lan, [switch]$Chrome, [switch]$Force)
  if (-not $Force -and -not (Confirm-RestartSlot '静的ホスト' $script:StaticProc)) { return }
  $rootId = Get-SelectedRootId
  if (-not $rootId) {
    [System.Windows.Forms.MessageBox]::Show(
      '静的ツリーがありません。先に静的ビルドするか、out / out-backup を用意してください。',
      'MangaSketcher',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    return
  }
  Stop-TrackedProcess $script:StaticProc
  $script:StaticProc = $null
  Stop-ListenPorts @(3001, 3002, 3443, 13443)
  if (-not (Wait-PortsFree @(3001, 3002, 3443, 13443) 30)) {
    Append-Log $logStatic 'Timed out waiting for static/LAN ports to be free.'
    return
  }
  $tabs.SelectedTab = $pageStatic
  $args = 'scripts\static-host\start.mjs'
  if ($Lan) { $args += ' --lan' }
  if ($Chrome) { $args += ' --chrome' }
  $args += " --root=$rootId"
  Append-Log $logStatic "Starting static-host $args"
  $node = Get-NodePath
  $envMap = @{ STATIC_HOST_REPL = '1' }
  $script:StaticProc = New-RedirectedProcess -FileName $node -Arguments $args -ExtraEnv $envMap -LogBox $logStatic -Stdin
}

function Send-StaticCommand([string]$Line) {
  if (-not (Test-ProcAlive $script:StaticProc)) {
    Append-Log $logStatic '静的ホストは起動していません。'
    return
  }
  try {
    $script:StaticProc.StandardInput.WriteLine($Line)
    $script:StaticProc.StandardInput.Flush()
    Append-Log $logStatic ("> $Line")
  } catch {
    Append-Log $logStatic ("stdin に書けません: $($_.Exception.Message)")
  }
}

function Start-StaticBuildThenLan {
  $r = [System.Windows.Forms.MessageBox]::Show(
    "ホーム画面用の out を作り直し、成功したら iPad 向け HTTPS（:3443）を起動します。`nホットリロードではありません。所要は 15〜40 秒程度です。続けますか?",
    'MangaSketcher',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Question
  )
  if ($r -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  if (Test-ProcAlive $script:BuildProc) {
    if (-not (Confirm-RestartSlot '静的ビルド' $script:BuildProc)) { return }
    Stop-TrackedProcess $script:BuildProc
    $script:BuildProc = $null
  }
  $script:RestartDevAfterBuild = $false
  Stop-ListenPorts @(3001, 3002, 3443, 13443)
  $devPids = @(Get-ListenPids 3000)
  if ($devPids.Count -gt 0) {
    $script:RestartDevAfterBuild = $true
    Stop-ListenPorts @(3000)
    Stop-TrackedProcess $script:DevProc
    $script:DevProc = $null
  }
  $tabs.SelectedTab = $pageBuild
  Append-Log $logBuild 'npm run build:static ...'
  $npm = Get-NpmCmd
  $script:StartLanAfterBuild = $true
  $script:BuildProc = New-RedirectedProcess -FileName $npm -Arguments 'run build:static' -LogBox $logBuild
}

function Set-PortLabel($Label, [int]$Port) {
  if ($null -eq $Label) { return }
  $up = Test-PortListening $Port
  $Label.Text = if ($up) { ":${Port} Listen" } else { ":${Port} ---" }
  $Label.ForeColor = if ($up) { [System.Drawing.Color]::ForestGreen } else { [System.Drawing.Color]::Gray }
}

function On-Tick {
  $tickStarted = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  Set-PortLabel $lbl3000 3000
  Set-PortLabel $lbl3001 3001
  Set-PortLabel $lbl3002 3002
  Set-PortLabel $lbl3443 3443
  Set-PortLabel $lbl13443 13443
  $ip = Get-LanIpv4
  $lblUrlDev.Text = "開発（ホットリロード）  https://${ip}:3000/"
  $lblUrlLan.Text = "静的（既存 out / iPad）  https://${ip}:3443/"
  $lblUrlCa.Text = "証明書プロファイル  http://${ip}:3002/"
  $btnSwitch.Enabled = (Test-ProcAlive $script:StaticProc)
  $txtCmd.Enabled = (Test-ProcAlive $script:StaticProc)
  $btnSend.Enabled = (Test-ProcAlive $script:StaticProc)
  if ($script:StartLanAfterBuild -and $null -ne $script:BuildProc -and $script:BuildProc.HasExited) {
    $script:StartLanAfterBuild = $false
    $code = $script:BuildProc.ExitCode
    if ($code -ne 0) {
      Append-Log $logBuild 'Static build failed. LAN は起動しません。'
      return
    }
    Append-Log $logBuild 'Static build finished. Starting LAN...'
    Refresh-RootCombo
    for ($i = 0; $i -lt $comboRoots.Items.Count; $i++) {
      if ($comboRoots.Items[$i].Id -eq 'out') { $comboRoots.SelectedIndex = $i; break }
    }
    Start-StaticHost -Lan -Force
    if ($script:RestartDevAfterBuild) {
      Append-Log $logDev 'Restarting the dev server on :3000 ...'
      Start-DevServer -Force
    }
  }
  if ($script:TickLogsLeft -gt 0) {
    $script:TickLogsLeft -= 1
    #region agent log
    Write-AgentLog 'B' 'launcher.ps1:On-Tick' 'tick done' @{
      runId = 'post-fix'
      elapsedMs = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $tickStarted)
      left = $script:TickLogsLeft
    }
    #endregion
  }
}

function Stop-AllChildren {
  $script:StartLanAfterBuild = $false
  Stop-TrackedProcess $script:DevProc
  Stop-TrackedProcess $script:StaticProc
  Stop-TrackedProcess $script:BuildProc
  $script:DevProc = $null
  $script:StaticProc = $null
  $script:BuildProc = $null
}

# --- UI ---
$form = New-Object System.Windows.Forms.Form
$form.Text = 'MangaSketcher'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(980, 740)
$form.MinimumSize = New-Object System.Drawing.Size(820, 560)
$form.Font = New-Object System.Drawing.Font('Yu Gothic UI', 9)

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Dock = 'Fill'
$pageDev = New-Object System.Windows.Forms.TabPage
$pageDev.Text = '開発'
$pageStatic = New-Object System.Windows.Forms.TabPage
$pageStatic.Text = '静的'
$pageBuild = New-Object System.Windows.Forms.TabPage
$pageBuild.Text = 'ビルド'
$tabs.TabPages.AddRange(@($pageDev, $pageStatic, $pageBuild))
$form.Controls.Add($tabs)

$top = New-Object System.Windows.Forms.Panel
$top.Dock = 'Top'
$top.Height = 208
$form.Controls.Add($top)

$tips = New-Object System.Windows.Forms.ToolTip
$tips.AutoPopDelay = 20000
$tips.InitialDelay = 400

$y = 8
$btnDev = New-Object System.Windows.Forms.Button
$btnDev.Text = '開発（ホットリロード）'
$btnDev.Location = New-Object System.Drawing.Point(8, $y)
$btnDev.Size = New-Object System.Drawing.Size(180, 28)
$btnStopDev = New-Object System.Windows.Forms.Button
$btnStopDev.Text = '開発を止める'
$btnStopDev.Location = New-Object System.Drawing.Point(194, $y)
$btnStopDev.Size = New-Object System.Drawing.Size(110, 28)
$tips.SetToolTip($btnDev, 'コード変更がすぐ反映されます。普段の確認はこちら（:3000）。')
$tips.SetToolTip($btnStopDev, '開発サーバー（:3000）を止めます。')

$y = 40
$btnLan = New-Object System.Windows.Forms.Button
$btnLan.Text = '既存の out を LAN 配信'
$btnLan.Location = New-Object System.Drawing.Point(8, $y)
$btnLan.Size = New-Object System.Drawing.Size(168, 28)
$btnChrome = New-Object System.Windows.Forms.Button
$btnChrome.Text = '既存の out を PC で開く'
$btnChrome.Location = New-Object System.Drawing.Point(182, $y)
$btnChrome.Size = New-Object System.Drawing.Size(168, 28)
$btnBuild = New-Object System.Windows.Forms.Button
$btnBuild.Text = 'out を作り直して LAN 配信'
$btnBuild.Location = New-Object System.Drawing.Point(356, $y)
$btnBuild.Size = New-Object System.Drawing.Size(196, 28)
$btnStopStatic = New-Object System.Windows.Forms.Button
$btnStopStatic.Text = '静的を止める'
$btnStopStatic.Location = New-Object System.Drawing.Point(558, $y)
$btnStopStatic.Size = New-Object System.Drawing.Size(110, 28)
$tips.SetToolTip($btnLan, 'すでに書き出した out を iPad 向け HTTPS（:3443）で出します。ビルドしません。')
$tips.SetToolTip($btnChrome, 'すでに書き出した out を PC だけで開きます。ビルドしません。')
$tips.SetToolTip($btnBuild, 'out を作り直し、成功したら iPad 向け HTTPS を起動します。ホーム画面 / オフライン用にコードを取り込むとき。')
$tips.SetToolTip($btnStopStatic, '静的ホスト（:3001 / :3002 / :3443）を止めます。')
$top.Controls.AddRange(@($btnDev, $btnStopDev, $btnLan, $btnChrome, $btnBuild, $btnStopStatic))

$y = 74
$lblRoots = New-Object System.Windows.Forms.Label
$lblRoots.Text = '静的ツリー'
$lblRoots.Location = New-Object System.Drawing.Point(8, ($y + 4))
$lblRoots.AutoSize = $true
$comboRoots = New-Object System.Windows.Forms.ComboBox
$comboRoots.DropDownStyle = 'DropDownList'
$comboRoots.Location = New-Object System.Drawing.Point(80, $y)
$comboRoots.Size = New-Object System.Drawing.Size(620, 28)
$comboRoots.Anchor = 'Top, Left, Right'
$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = '一覧を更新'
$btnRefresh.Location = New-Object System.Drawing.Point(708, $y)
$btnRefresh.Size = New-Object System.Drawing.Size(90, 28)
$btnSwitch = New-Object System.Windows.Forms.Button
$btnSwitch.Text = 'このバックアップに切替'
$btnSwitch.Location = New-Object System.Drawing.Point(804, $y)
$btnSwitch.Size = New-Object System.Drawing.Size(150, 28)
$btnSwitch.Enabled = $false
$top.Controls.AddRange(@($lblRoots, $comboRoots, $btnRefresh, $btnSwitch))

$y = 108
$lbl3000 = New-Object System.Windows.Forms.Label
$lbl3000.Name = 'lbl3000'
$lbl3000.Location = New-Object System.Drawing.Point(8, $y)
$lbl3000.AutoSize = $true
$lbl3001 = New-Object System.Windows.Forms.Label
$lbl3001.Name = 'lbl3001'
$lbl3001.Location = New-Object System.Drawing.Point(140, $y)
$lbl3001.AutoSize = $true
$lbl3002 = New-Object System.Windows.Forms.Label
$lbl3002.Name = 'lbl3002'
$lbl3002.Location = New-Object System.Drawing.Point(272, $y)
$lbl3002.AutoSize = $true
$lbl3443 = New-Object System.Windows.Forms.Label
$lbl3443.Name = 'lbl3443'
$lbl3443.Location = New-Object System.Drawing.Point(404, $y)
$lbl3443.AutoSize = $true
$lbl13443 = New-Object System.Windows.Forms.Label
$lbl13443.Name = 'lbl13443'
$lbl13443.Location = New-Object System.Drawing.Point(536, $y)
$lbl13443.AutoSize = $true
$top.Controls.AddRange(@($lbl3000, $lbl3001, $lbl3002, $lbl3443, $lbl13443))

$y = 132
$lblUrlDev = New-Object System.Windows.Forms.Label
$lblUrlDev.Location = New-Object System.Drawing.Point(8, $y)
$lblUrlDev.AutoSize = $true
$lblUrlLan = New-Object System.Windows.Forms.Label
$lblUrlLan.Location = New-Object System.Drawing.Point(8, ($y + 18))
$lblUrlLan.AutoSize = $true
$lblUrlCa = New-Object System.Windows.Forms.Label
$lblUrlCa.Location = New-Object System.Drawing.Point(8, ($y + 36))
$lblUrlCa.AutoSize = $true
$btnCopyDev = New-Object System.Windows.Forms.Button
$btnCopyDev.Text = '開発URLをコピー'
$btnCopyDev.Location = New-Object System.Drawing.Point(520, 132)
$btnCopyDev.Size = New-Object System.Drawing.Size(130, 24)
$btnCopyLan = New-Object System.Windows.Forms.Button
$btnCopyLan.Text = '静的URLをコピー'
$btnCopyLan.Location = New-Object System.Drawing.Point(656, 132)
$btnCopyLan.Size = New-Object System.Drawing.Size(130, 24)
$btnCopyCa = New-Object System.Windows.Forms.Button
$btnCopyCa.Text = 'CA URLをコピー'
$btnCopyCa.Location = New-Object System.Drawing.Point(792, 132)
$btnCopyCa.Size = New-Object System.Drawing.Size(130, 24)
$top.Controls.AddRange(@($lblUrlDev, $lblUrlLan, $lblUrlCa, $btnCopyDev, $btnCopyLan, $btnCopyCa))
$lblHint = New-Object System.Windows.Forms.Label
$lblHint.Location = New-Object System.Drawing.Point(8, 186)
$lblHint.AutoSize = $true
$lblHint.ForeColor = [System.Drawing.Color]::DimGray
$lblHint.Text = 'LAN 配信はすでにある out を出すだけ。ホーム画面用にコードを取り込むときは「out を作り直して LAN 配信」。'
$top.Controls.Add($lblHint)

$bottom = New-Object System.Windows.Forms.Panel
$bottom.Dock = 'Bottom'
$bottom.Height = 36
$form.Controls.Add($bottom)
$txtCmd = New-Object System.Windows.Forms.TextBox
$txtCmd.Location = New-Object System.Drawing.Point(8, 6)
$txtCmd.Size = New-Object System.Drawing.Size(850, 24)
$txtCmd.Anchor = 'Left, Right, Top'
$txtCmd.Enabled = $false
try { $txtCmd.PlaceholderText = 'list / quit / 番号（稼働中の静的ホストへ）' } catch { }
$btnSend = New-Object System.Windows.Forms.Button
$btnSend.Text = '送信'
$btnSend.Location = New-Object System.Drawing.Point(866, 4)
$btnSend.Size = New-Object System.Drawing.Size(90, 26)
$btnSend.Anchor = 'Right, Top'
$btnSend.Enabled = $false
$bottom.Controls.AddRange(@($txtCmd, $btnSend))

function New-LogBox {
  $tb = New-Object System.Windows.Forms.TextBox
  $tb.Multiline = $true
  $tb.ScrollBars = 'Both'
  $tb.ReadOnly = $true
  $tb.WordWrap = $false
  $tb.Dock = 'Fill'
  $tb.Font = New-Object System.Drawing.Font('Consolas', 9)
  $tb.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 24)
  $tb.ForeColor = [System.Drawing.Color]::FromArgb(220, 220, 220)
  return $tb
}
$logDev = New-LogBox
$logStatic = New-LogBox
$logBuild = New-LogBox
$pageDev.Controls.Add($logDev)
$pageStatic.Controls.Add($logStatic)
$pageBuild.Controls.Add($logBuild)
$script:ActiveLog = $logDev
$script:MaxLogLines = $MaxLogLines

$btnDev.Add_Click({ Invoke-UiAction { Start-DevServer } })
$btnLan.Add_Click({ Invoke-UiAction { Start-StaticHost -Lan } })
$btnChrome.Add_Click({ Invoke-UiAction { Start-StaticHost -Chrome } })
$btnBuild.Add_Click({ Invoke-UiAction { Start-StaticBuildThenLan } })
$btnRefresh.Add_Click({ Invoke-UiAction { Refresh-RootCombo } })
$btnSwitch.Add_Click({
  Invoke-UiAction {
    $id = Get-SelectedRootId
    if (-not $id) { return }
    Send-StaticCommand $id
  }
})
$btnStopDev.Add_Click({
  Invoke-UiAction {
    if ([System.Windows.Forms.MessageBox]::Show('開発サーバーを止めますか?', 'MangaSketcher', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question) -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    Stop-TrackedProcess $script:DevProc
    $script:DevProc = $null
    Stop-ListenPorts @(3000)
  }
})
$btnStopStatic.Add_Click({
  Invoke-UiAction {
    if ([System.Windows.Forms.MessageBox]::Show('静的ホストを止めますか?', 'MangaSketcher', [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question) -ne [System.Windows.Forms.DialogResult]::Yes) { return }
    Stop-TrackedProcess $script:StaticProc
    $script:StaticProc = $null
    Stop-ListenPorts @(3001, 3002, 3443, 13443)
  }
})
$btnCopyDev.Add_Click({ Invoke-UiAction { [System.Windows.Forms.Clipboard]::SetText("https://$(Get-LanIpv4):3000/") } })
$btnCopyLan.Add_Click({ Invoke-UiAction { [System.Windows.Forms.Clipboard]::SetText("https://$(Get-LanIpv4):3443/") } })
$btnCopyCa.Add_Click({ Invoke-UiAction { [System.Windows.Forms.Clipboard]::SetText("http://$(Get-LanIpv4):3002/") } })
$btnSend.Add_Click({
  Invoke-UiAction {
    $line = $txtCmd.Text.Trim()
    if (-not $line) { return }
    Send-StaticCommand $line
    $txtCmd.Clear()
  }
})
$txtCmd.Add_KeyDown({
  if ($_.KeyCode -eq 'Enter') {
    $_.SuppressKeyPress = $true
    $btnSend.PerformClick()
  }
})

$form.Add_FormClosing({
  Stop-AllChildren
  Get-EventSubscriber -ErrorAction SilentlyContinue | Unregister-Event -Force -ErrorAction SilentlyContinue
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.Add_Tick({ On-Tick })

function Layout-TopBar {
  $right = 8 + 90 + 8 + 150
  $comboRoots.Width = [Math]::Max(200, $top.ClientSize.Width - 80 - $right)
  $btnRefresh.Left = $comboRoots.Left + $comboRoots.Width + 8
  $btnSwitch.Left = $btnRefresh.Left + $btnRefresh.Width + 8
}
$top.Add_Resize({ Layout-TopBar })
Layout-TopBar

try {
  Write-AgentLog 'C' 'launcher.ps1:init' 'before Refresh-RootCombo' @{}
  Refresh-RootCombo
  Write-AgentLog 'C' 'launcher.ps1:init' 'after Refresh-RootCombo' @{ count = $comboRoots.Items.Count }
  Write-AgentLog 'D' 'launcher.ps1:init' 'before On-Tick' @{}
  On-Tick
  Write-AgentLog 'D' 'launcher.ps1:init' 'after On-Tick' @{}
  $timer.Start()
  Write-AgentLog 'E' 'launcher.ps1:init' 'ShowDialog' @{}
  [void]$form.ShowDialog()
} catch {
  Write-AgentLog 'A' 'launcher.ps1:init-catch' 'init or dialog failed' @{
    type = $_.Exception.GetType().FullName
    msg = $_.Exception.Message
    line = $_.InvocationInfo.ScriptLineNumber
  }
  throw
}
$timer.Stop()
$timer.Dispose()
