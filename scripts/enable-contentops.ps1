#requires -Version 5.1
<#
.SYNOPSIS
Enable contentops.cmd in the current Windows PowerShell process; no installation.
.EXAMPLE
.\scripts\enable-contentops.ps1 -NewState
#>
[CmdletBinding()]
param([string]$StateDirectory, [switch]$NewState)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$oldPath = $env:PATH
$hadState = Test-Path Env:CONTENTOPS_STATE_DIR
$oldState = $env:CONTENTOPS_STATE_DIR
$environmentChanged = $false

function Get-ComparablePath([string]$Value) {
    try { return [IO.Path]::GetFullPath($Value.Trim().Trim('"')).TrimEnd('\','/') }
    catch { return $Value }
}

try {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw '此脚本用于 Windows；其他平台可按 README 使用 java -jar。'
    }
    if ($NewState -and $PSBoundParameters.ContainsKey('StateDirectory')) {
        throw '-NewState 与 -StateDirectory 请只选一个。'
    }
    $scriptsDirectory = [IO.Path]::GetFullPath($PSScriptRoot)
    $projectDirectory = Split-Path -Parent $scriptsDirectory
    $launcher = Join-Path $scriptsDirectory 'contentops.cmd'
    $jar = Join-Path $projectDirectory 'target/contentops.jar'
    if (!(Test-Path -LiteralPath $launcher -PathType Leaf)) { throw '缺少 scripts/contentops.cmd，请检查解压是否完整。' }
    if (!(Test-Path -LiteralPath $jar -PathType Leaf)) {
        throw '尚未找到可执行 JAR。如果获得的是源码版本，请使用 Maven 构建（mvn -B -ntp verify）；如果获得的是完整交付包，请检查文件是否解压完整。'
    }
    if (Test-Path Env:CONTENTOPS_MOCK_SCENARIO) {
        throw '检测到 CONTENTOPS_MOCK_SCENARIO，未进入普通试用，也未清除配置。请先确认并在当前会话运行 Remove-Item Env:CONTENTOPS_MOCK_SCENARIO 后重试（空值同样无效）。'
    }
    $java = Get-Command java.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $java) { throw '未找到 java.exe。请安装 JDK 21，将其 bin 加入可用环境后重新打开 PowerShell；本脚本不安装 JDK 或修改 JAVA_HOME。' }
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $java.Source
    $start.Arguments = '-version'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $probe = $null
    try {
        $probe = [Diagnostics.Process]::Start($start)
        $stdout = $probe.StandardOutput.ReadToEndAsync()
        $stderr = $probe.StandardError.ReadToEndAsync()
        if (!$probe.WaitForExit(10000)) { $probe.Kill(); throw 'Java 版本检查超时。' }
        $versionText = $stdout.GetAwaiter().GetResult() + "`n" + $stderr.GetAwaiter().GetResult()
        if ($probe.ExitCode -ne 0) { throw 'Java 无法正常执行 -version。' }
    } catch { throw '无法调用 Java。请单独检查 java -version，并确认安装的 JDK 21 可运行。' }
    finally { if ($null -ne $probe) { $probe.Dispose() } }
    $match = [regex]::Match($versionText, '(?m)^(?:openjdk|java) version "(?<major>\d+)[^"\r\n]*"')
    if (!$match.Success -or $match.Groups['major'].Value -ne '21') {
        $detected = if ($match.Success) { $match.Groups['major'].Value } else { '无法识别' }
        throw ('检测到 Java 版本：' + $detected + '；已验证环境要求 JDK 21。请切换后重试，本脚本不自动修改 JAVA_HOME。')
    }

    $other = @(Get-Command contentops -All -ErrorAction SilentlyContinue)
    if (@($other | Where-Object { $_.CommandType -notin @('Application','ExternalScript') }).Count) {
        throw '当前会话有同名 contentops 别名、函数或命令，PATH 无法覆盖它。请先检查 Get-Command contentops -All，或明确使用 scripts/contentops.cmd。'
    }
    if ($NewState) {
        $selectedState = Join-Path $projectDirectory ('.contentops/reviewer-' + [DateTime]::Now.ToString('yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N'))
    } elseif ($PSBoundParameters.ContainsKey('StateDirectory')) {
        if ([string]::IsNullOrWhiteSpace($StateDirectory)) { throw '-StateDirectory 不能为空。' }
        if (![IO.Path]::IsPathRooted($StateDirectory)) {
            if ((Get-Location).Provider.Name -ne 'FileSystem') { throw '相对状态目录需要从文件系统目录指定。' }
            $StateDirectory = Join-Path (Get-Location).Path $StateDirectory
        }
        $selectedState = $StateDirectory
    } elseif ($hadState) {
        $selectedState = $oldState
    } else {
        $selectedState = Join-Path $projectDirectory '.contentops/reviewer'
    }
    if ([string]::IsNullOrWhiteSpace($selectedState) -or $selectedState -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))') {
        throw '现有 CONTENTOPS_STATE_DIR 必须是有效绝对目录；请明确用 -StateDirectory 或 -NewState 选择，不会静默覆盖。'
    }
    $absoluteState = [IO.Path]::GetFullPath($selectedState)
    $segments = $absoluteState -split '[\\/]'
    if ($segments -contains '内容运营后台接口数据') { throw '原始附件目录只读，不能用作 Mock 状态目录。' }
    for ($i = 0; $i -lt $segments.Length - 1; $i++) {
        if ($segments[$i] -ieq '.contentops' -and $segments[$i+1] -ieq 'task2') {
            throw '任务二正式工作副本不用于普通试用，请使用 -NewState。'
        }
    }
    # Refuse reparse ancestors rather than resolving into seed or saved evidence.
    $ancestor = $absoluteState
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw '状态目录不能经过符号链接或目录联接；请另选独立目录。' }
        }
        $ancestor = Split-Path -Parent $ancestor
    }
    if ((Test-Path -LiteralPath $absoluteState) -and !(Test-Path -LiteralPath $absoluteState -PathType Container)) {
        throw '状态目录指向了文件，请另选一个目录。'
    }
    if ($NewState -and (Test-Path -LiteralPath $absoluteState)) { throw '新的演示目录意外已存在，请重试；旧目录未删除。' }
    $stateFileExists = Test-Path -LiteralPath (Join-Path $absoluteState 'state.json')
    $newParts = New-Object 'Collections.Generic.List[string]'
    $newParts.Add($scriptsDirectory)
    foreach ($part in ($oldPath -split ';')) {
        if (![StringComparer]::OrdinalIgnoreCase.Equals((Get-ComparablePath $part), (Get-ComparablePath $scriptsDirectory))) { $newParts.Add($part) }
    }
    $null = [IO.Directory]::CreateDirectory($absoluteState)
    $environmentChanged = $true
    $env:PATH = $newParts -join ';'
    # Keep an existing explicit value exactly as provided when no override was requested.
    $env:CONTENTOPS_STATE_DIR = if ($hadState -and !$NewState -and !$PSBoundParameters.ContainsKey('StateDirectory')) { $oldState } else { $absoluteState }
    $resolved = Get-Command contentops -ErrorAction Stop
    if ($resolved.CommandType -ne 'Application' -or ![StringComparer]::OrdinalIgnoreCase.Equals($resolved.Source, $launcher)) {
        throw '同名 contentops 入口遮蔽了本项目 .cmd；环境已恢复。请检查 Get-Command contentops -All。'
    }
    $resolvedJava = Get-Command java.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    if (![StringComparer]::OrdinalIgnoreCase.Equals($resolvedJava.Source, $java.Source)) { throw 'PATH 调整改变了 Java 入口，请检查 scripts 中的同名程序。' }

    Write-Host 'ContentOps CLI 已准备就绪'
    Write-Host ('Java：21 · ' + $java.Source)
    Write-Host '运行模式：Mock'
    Write-Host ('命令入口：' + $launcher)
    Write-Host ('状态目录：' + $env:CONTENTOPS_STATE_DIR)
    if ($stateFileExists) { Write-Host '复用已有工作状态，未读取、删除或重置。' }
    if (@($other | Where-Object { $_.Source -and ![StringComparer]::OrdinalIgnoreCase.Equals($_.Source, $launcher) }).Count) {
        Write-Host '当前 PATH 中有其他同名入口，本会话已明确优先使用上面显示的项目入口。'
    }
    Write-Host "`n  contentops --help`n  contentops content list --review-status pending`n  contentops content get ct_000004"
    Write-Host "`n此配置仅在当前 PowerShell 会话及子进程生效。浏览器 Playground 使用另一份页面内存状态。"
    exit 0
} catch {
    if ($environmentChanged) {
        $env:PATH = $oldPath
        if ($hadState) { Set-Item Env:CONTENTOPS_STATE_DIR -Value $oldState } else { Remove-Item Env:CONTENTOPS_STATE_DIR -ErrorAction SilentlyContinue }
    }
    [Console]::Error.WriteLine('ContentOps 初始化失败：' + $_.Exception.Message)
    exit 2
}
