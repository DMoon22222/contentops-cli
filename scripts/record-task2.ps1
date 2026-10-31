# Capture one real CLI invocation in a fixed, isolated task-two run. Never replay a write.
[CmdletBinding()]
param(
    [switch]$Initialize,
    [string]$EvidenceDirectory = 'evidence/task2',
    [Parameter(Mandatory)][ValidatePattern('^[0-9]{2}-[a-z0-9-]+$')][string]$Name,
    [Parameter(Mandatory)][string[]]$CliArguments
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$evidenceRoot = [IO.Path]::GetFullPath($(if ([IO.Path]::IsPathRooted($EvidenceDirectory)) { $EvidenceDirectory } else { Join-Path $projectRoot $EvidenceDirectory }))
$utf8 = [Text.UTF8Encoding]::new($false, $true)
function Save-NewJson([string]$Path, $Value) {
    $bytes = $utf8.GetBytes((ConvertTo-Json -InputObject $Value -Depth 25))
    $file = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $file.Write($bytes, 0, $bytes.Length); $file.Flush($true) } finally { $file.Dispose() }
}
function Snapshot([string]$Directory) {
    $path = Join-Path $Directory 'state.json'
    if (!(Test-Path -LiteralPath $path)) { return [ordered]@{ exists=$false; sha256=$null; revision=$null } }
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    try {
        $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        return [ordered]@{ exists=$true; sha256=$hash; revision=$state.revision; state_schema_version=$state.state_schema_version; seed_sha256=$state.seed_sha256 }
    } catch { return [ordered]@{ exists=$true; sha256=$hash; revision=$null; parse_failed=$true } }
}
if (@($CliArguments | Where-Object { $_ -match '^--env($|=)' }).Count -ne 0) { throw 'Recorder fixes --env mock; do not pass another env option.' }
$manifestPath = Join-Path $evidenceRoot 'manifest.json'
if ($Initialize) {
    if (Test-Path -LiteralPath $evidenceRoot) { throw 'Evidence already exists; initialization cannot overwrite or resume a prior run.' }
    if ($null -ne [Environment]::GetEnvironmentVariable('CONTENTOPS_MOCK_SCENARIO','Process')) { throw 'Clear Mock fault configuration before starting the formal demonstration.' }
    $status = @(& git --no-optional-locks status --porcelain)
    if (@($status | Where-Object { $_ -notmatch 'scripts/record-task2\.ps1$' }).Count -ne 0) { throw 'Unexpected worktree changes before capture initialization.' }
    New-Item -ItemType Directory -Path $evidenceRoot | Out-Null
    foreach ($directory in @('commands','before','preview','after','validation')) { New-Item -ItemType Directory -Path (Join-Path $evidenceRoot $directory) | Out-Null }
    $runId = [guid]::NewGuid().ToString()
    $manifest = [ordered]@{ run_id=$runId; created_at=[DateTimeOffset]::Now.ToString('o'); source_commit=(& git rev-parse HEAD).Trim();
        state_directory=(Join-Path $projectRoot ('.contentops/task2/' + $runId)); jar_sha256=(Get-FileHash -LiteralPath 'target/contentops.jar' -Algorithm SHA256).Hash;
        environment='mock'; fault_enabled=$false; original_parent_fault_present=$false; scope='Task two formal local Mock operation; demonstration decision, not production moderation.' }
    Save-NewJson $manifestPath $manifest
    $protected = @('AGENTS.md','.gitattributes','.gitignore','pom.xml','题目：内容运营后台 CLI 化.md','内容运营后台接口数据.zip')
    $protected += @(Get-ChildItem -LiteralPath 'docs','src','内容运营后台接口数据','evidence/s0-s2','evidence/s3-s4','evidence/s5' -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($projectRoot,$_.FullName) })
    Save-NewJson (Join-Path $evidenceRoot 'validation/protected-before.json') @($protected | ForEach-Object { [ordered]@{ file=$_; sha256=(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash } })
} elseif (!(Test-Path -LiteralPath $manifestPath)) { throw 'No task-two manifest; initialize a new run first.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$stateDirectory = [IO.Path]::GetFullPath($manifest.state_directory)
$allowedStateRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot '.contentops/task2')) + [IO.Path]::DirectorySeparatorChar
if (!$stateDirectory.StartsWith($allowedStateRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest state path is outside the designated task-two workspace.' }
if ((Get-FileHash -LiteralPath 'target/contentops.jar' -Algorithm SHA256).Hash -ne $manifest.jar_sha256) { throw 'JAR differs from initialized run; do not mix artifacts.' }
$commandsRoot = Join-Path $evidenceRoot 'commands'
$startedPath = Join-Path $commandsRoot ($Name + '.started.json')
if (Test-Path -LiteralPath $startedPath) { throw 'Invocation already started or completed. Preserve it; use a new name only for an additional read.' }
$arguments = @('--env','mock') + $CliArguments
$isWrite = @($CliArguments | Where-Object { $_ -match '^--execute($|=)' }).Count -ne 0
if ($isWrite) {
    $intentPath = Join-Path $evidenceRoot 'validation/execution-plan.json'
    if (!(Test-Path -LiteralPath $intentPath)) { throw 'A reviewed plan and successful preview are required before capture of the one execution.' }
    $intent = Get-Content -LiteralPath $intentPath -Raw | ConvertFrom-Json
    if ((ConvertTo-Json -InputObject @($CliArguments) -Compress) -cne (ConvertTo-Json -InputObject @($intent.execute_cli_arguments) -Compress)) { throw 'Execution differs from recorded intent.' }
    $previewPath = Join-Path $evidenceRoot $intent.preview_stdout
    $preview = Get-Content -LiteralPath $previewPath -Raw | ConvertFrom-Json
    if ($preview.environment -ne 'mock' -or $preview.mode -ne 'preview' -or $preview.status -ne 'previewed' -or $preview.exit_code -ne 0 -or
        $preview.data.steps.review.write -ne 'not_sent' -or $preview.data.steps.tags.write -ne 'not_sent') { throw 'Preview does not establish a valid zero-write plan.' }
    if ((ConvertTo-Json -InputObject (Snapshot $stateDirectory) -Compress) -cne (ConvertTo-Json -InputObject $intent.snapshot_before_execute -Compress)) { throw 'Business snapshot changed after preview; stop and inspect.' }
    Save-NewJson (Join-Path $evidenceRoot 'validation/execution.started.json') ([ordered]@{ started_at=[DateTimeOffset]::Now.ToString('o'); name=$Name; arguments=$arguments; note='Write may have occurred even if later capture is interrupted. Never replay automatically.' })
}
$display = @($arguments | ForEach-Object { if ($_ -match '\s') { "'" + $_.Replace("'","''") + "'" } else { $_ } })
$started = [ordered]@{ name=$Name; started_at=[DateTimeOffset]::Now.ToString('o'); run_id=$manifest.run_id; state_directory=$stateDirectory;
    command=('java -jar ./target/contentops.jar ' + ($display -join ' ')); arguments=$arguments; fault_enabled=$false; may_write=$isWrite; jar_sha256=$manifest.jar_sha256 }
Save-NewJson $startedPath $started
Save-NewJson (Join-Path $commandsRoot ($Name + '.snapshot-before.json')) (Snapshot $stateDirectory)
$start = [Diagnostics.ProcessStartInfo]::new('java')
$start.WorkingDirectory = $projectRoot; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
$start.StandardOutputEncoding = $utf8; $start.StandardErrorEncoding = $utf8
$start.Environment['CONTENTOPS_STATE_DIR'] = $stateDirectory
foreach ($setting in @('CONTENTOPS_MOCK_SCENARIO','JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','JDK_JAVA_OPTIONS')) { [void]$start.Environment.Remove($setting) }
foreach ($argument in @('-jar','./target/contentops.jar') + $arguments) { $start.ArgumentList.Add($argument) }
$process = [Diagnostics.Process]::Start($start)
$pidOfCli = $process.Id
$outTask = $process.StandardOutput.ReadToEndAsync(); $errTask = $process.StandardError.ReadToEndAsync()
$timedOut = !$process.WaitForExit(20000)
if ($timedOut) { $process.Kill($true); $process.WaitForExit() }
$stdout = $outTask.GetAwaiter().GetResult(); $stderr = $errTask.GetAwaiter().GetResult(); $actualExit = $process.ExitCode
$process.Dispose()
foreach ($stream in @(@('stdout',$stdout),@('stderr',$stderr),@('exit-code',"$actualExit`n"))) {
    [IO.File]::WriteAllText((Join-Path $commandsRoot ($Name + '.' + $stream[0] + '.txt')), $stream[1], $utf8)
}
Save-NewJson (Join-Path $commandsRoot ($Name + '.snapshot-after.json')) (Snapshot $stateDirectory)
Save-NewJson (Join-Path $commandsRoot ($Name + '.finished.json')) ([ordered]@{ finished_at=[DateTimeOffset]::Now.ToString('o'); pid=$pidOfCli; actual_exit_code=$actualExit; timed_out=$timedOut })
if ($isWrite) {
    Save-NewJson (Join-Path $evidenceRoot 'validation/execution.finished.json') ([ordered]@{ name=$Name; actual_exit_code=$actualExit; timed_out=$timedOut; stdout_file=('commands/' + $Name + '.stdout.txt') })
}
Write-Output ($Name + ': actual process exit=' + $actualExit + '; state=' + $stateDirectory)
Write-Output $stdout
if ($stderr.Length -ne 0) { [Console]::Error.Write($stderr) }
if ($timedOut) { throw 'The recorded JVM timed out; preserve evidence and inspect via read commands, never replay the write.' }
exit $actualExit
