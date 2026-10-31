# PowerShell 7. This is a local Mock development check, not the task-two final demonstration.
[CmdletBinding()]
param([string]$EvidenceDirectory = 'evidence/s3-s4/commands')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$evidenceRoot = if ([IO.Path]::IsPathRooted($EvidenceDirectory)) { $EvidenceDirectory } else { Join-Path $projectRoot $EvidenceDirectory }
if (Test-Path -LiteralPath $evidenceRoot) { throw 'Evidence directory already exists; use a new directory to retain previous outputs.' }
New-Item -ItemType Directory -Path $evidenceRoot | Out-Null
$stateDirectory = Join-Path $projectRoot ('.contentops/s3-s4-validation/' + [guid]::NewGuid())
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$observations = [Collections.Generic.List[object]]::new()
$protectedFiles = @('AGENTS.md', '.gitignore', '.gitattributes', '题目：内容运营后台 CLI 化.md',
    '内容运营后台接口数据/mock_data.json', '内容运营后台接口数据/content-ops-admin-openapi.json',
    '内容运营后台接口数据/README.md', '内容运营后台接口数据.zip')
$protectedFiles += @(Get-ChildItem -LiteralPath 'docs','evidence/s0-s2' -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($projectRoot, $_.FullName) })
$hashes = @{}
foreach ($path in $protectedFiles) { $hashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }

function Get-StateInfo {
    $path = Join-Path $stateDirectory 'state.json'
    if (!(Test-Path -LiteralPath $path)) { return [ordered]@{ exists=$false; revision=$null; sha256=$null } }
    $snapshot = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    return [ordered]@{ exists=$true; revision=$snapshot.revision; sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
}
function Invoke-RecordedCli([string]$Name, [string[]]$CliArguments, [int]$ExpectedExit, [bool]$Json = $false) {
    $start = [Diagnostics.ProcessStartInfo]::new('java')
    $start.WorkingDirectory = $projectRoot; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = $utf8; $start.StandardErrorEncoding = $utf8
    $start.Environment['CONTENTOPS_STATE_DIR'] = $stateDirectory
    foreach ($jvmOptionName in @('JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','JDK_JAVA_OPTIONS')) { [void]$start.Environment.Remove($jvmOptionName) }
    foreach ($argument in @('-jar','./target/contentops.jar') + $CliArguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    $outTask = $process.StandardOutput.ReadToEndAsync(); $errTask = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit(20000)) { $process.Kill($true); throw ('CLI process timed out: ' + $Name) }
    $stdout = $outTask.GetAwaiter().GetResult(); $stderr = $errTask.GetAwaiter().GetResult(); $actualExit = $process.ExitCode
    $process.Dispose()
    foreach ($stream in @(@('stdout',$stdout),@('stderr',$stderr),@('exit-code',"$actualExit`n"))) {
        [IO.File]::WriteAllText((Join-Path $evidenceRoot ($Name + '.' + $stream[0] + '.txt')), $stream[1], $utf8)
    }
    $displayArguments = @($CliArguments | ForEach-Object { if ($_ -match '\s') { "'" + $_.Replace("'","''") + "'" } else { $_ } })
    $record = [ordered]@{ name=$Name; command=('java -jar ./target/contentops.jar ' + ($displayArguments -join ' ')); arguments=$CliArguments; actual_exit_code=$actualExit }
    $observations.Add($record)
    if ($actualExit -ne $ExpectedExit) { throw ('Unexpected actual process exit for ' + $Name + ': ' + $actualExit) }
    if (!$Json) { return $null }
    $result = ConvertFrom-Json -InputObject $stdout -ErrorAction Stop
    if ($result -is [array] -or $result.schema_version -ne '1' -or $result.exit_code -ne $actualExit -or $result.environment -ne 'mock') { throw 'Invalid JSON envelope or mismatched process exit' }
    $record['status'] = $result.status; $record['mode'] = $result.mode
    return $result
}
function Assert-Check([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function As-Json($Value) { return ConvertTo-Json -InputObject $Value -Depth 30 -Compress }

Invoke-RecordedCli '01-pending-list' @('--env','mock','content','list','--review-status','pending','--page','1') 0
Invoke-RecordedCli '02-before-table' @('--env','mock','content','get','ct_000004') 0
Invoke-RecordedCli '03-active-tags' @('--env','mock','tags','list','--status','active') 0
$before = Invoke-RecordedCli '04-before-detail' @('--env','mock','--output','json','content','get','ct_000004') 0 $true
$historyBefore = Invoke-RecordedCli '05-before-history' @('--env','mock','--output','json','content','history','ct_000004') 0 $true
$stateBeforePreview = Get-StateInfo
$workflow = @('--env','mock','--output','json','content','process','ct_000004','--action','approve','--reason','演示：人工已给出审核决定','--add','轻松')
$preview = Invoke-RecordedCli '06-process-preview' $workflow 0 $true
Assert-Check ($preview.status -eq 'previewed' -and $preview.mode -eq 'preview') 'Preview status/mode incorrect'
Assert-Check ($preview.data.steps.review.write -eq 'not_sent' -and $preview.data.steps.tags.write -eq 'not_sent') 'Preview claims a write'
$afterPreview = Invoke-RecordedCli '07-after-preview-detail' @('--env','mock','--output','json','content','get','ct_000004') 0 $true
$historyAfterPreview = Invoke-RecordedCli '08-after-preview-history' @('--env','mock','--output','json','content','history','ct_000004') 0 $true
$stateAfterPreview = Get-StateInfo
Assert-Check ((As-Json $before.data) -eq (As-Json $afterPreview.data)) 'Preview changed detail'
Assert-Check ((As-Json $historyBefore.data) -eq (As-Json $historyAfterPreview.data)) 'Preview changed history'
Assert-Check ((As-Json $stateBeforePreview) -eq (As-Json $stateAfterPreview)) 'Preview changed business snapshot'
$noYes = Invoke-RecordedCli '09-execute-without-yes' ($workflow + @('--execute')) 2 $true
$onlyYes = Invoke-RecordedCli '10-yes-without-execute' ($workflow + @('--yes')) 2 $true
Assert-Check ($noYes.status -eq 'rejected' -and $onlyYes.status -eq 'rejected') 'Unauthorized modes not rejected'
Assert-Check (!(Get-StateInfo).exists) 'Unauthorized command created snapshot'
$executionArguments = @('--env','mock','--output','json','--non-interactive') + $workflow[4..($workflow.Length-1)] + @('--execute','--yes')
$executed = Invoke-RecordedCli '11-process-execute' $executionArguments 0 $true
Assert-Check ($executed.status -eq 'succeeded' -and $executed.mode -eq 'execute') 'Execution not fully successful'
Assert-Check ($executed.data.steps.review.write -eq 'acknowledged' -and $executed.data.steps.review.verification -eq 'matched') 'Review not acknowledged and verified'
Assert-Check ($executed.data.steps.tags.write -eq 'acknowledged' -and $executed.data.steps.tags.verification -eq 'matched') 'Tags not acknowledged and verified'
$after = Invoke-RecordedCli '12-after-detail' @('--env','mock','--output','json','content','get','ct_000004') 0 $true
Invoke-RecordedCli '13-after-history-table' @('--env','mock','content','history','ct_000004') 0
$historyAfter = Invoke-RecordedCli '14-after-history-json' @('--env','mock','--output','json','content','history','ct_000004') 0 $true
Assert-Check ($before.data.review_status -eq 'pending' -and $after.data.review_status -eq 'approved') 'Review did not persist'
Assert-Check ((As-Json $after.data.tags) -eq (As-Json @('恋爱','校园','武侠','轻松'))) 'Original tags not retained or new tag missing'
Assert-Check (@($historyAfter.data.items).Count -eq (@($historyBefore.data.items).Count + 1)) 'Expected exactly one new audit log'
$stateAfterExecute = Get-StateInfo
Assert-Check ($stateAfterExecute.revision -eq 2) 'Review and tag calls did not create two separate commits'
$repeat = Invoke-RecordedCli '15-repeat-review-rejected' @('--env','mock','--output','json','content','review','ct_000004','--action','approve','--execute','--yes') 2 $true
Assert-Check ($repeat.error.code -eq 'REVIEW_NOT_PENDING') 'Repeated review not blocked'
$same = Invoke-RecordedCli '16-tag-no-change' @('--env','mock','--output','json','content','tags','update','ct_000004','--add','轻松','--execute','--yes') 0 $true
Assert-Check ($same.status -eq 'no_change' -and $same.data.steps.tags.write -eq 'skipped') 'Already present tag did not skip PUT'
$finalHistory = Invoke-RecordedCli '17-final-history' @('--env','mock','--output','json','content','history','ct_000004') 0 $true
Assert-Check ((As-Json $historyAfter.data) -eq (As-Json $finalHistory.data)) 'Repeated review/no-change added logs'
Assert-Check ((As-Json $stateAfterExecute) -eq (As-Json (Get-StateInfo))) 'Read/no-change/rejected command rewrote state'

$protected = foreach ($path in $protectedFiles) {
    $afterHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    Assert-Check ($hashes[$path] -eq $afterHash) ('Protected source/evidence changed: ' + $path)
    [ordered]@{ file=$path; before_sha256=$hashes[$path]; after_sha256=$afterHash; unchanged=$true }
}
$summary = [ordered]@{
    captured_at=[DateTimeOffset]::Now.ToString('o'); scope='S3-S4 local Mock development validation. Human-supplied demonstration decision; no automatic moderation.';
    state_directory=$stateDirectory; jar_sha256=(Get-FileHash -LiteralPath 'target/contentops.jar' -Algorithm SHA256).Hash;
    command_count=$observations.Count; commands=$observations; preview_zero_write_verified=$true;
    state_before_preview=$stateBeforePreview; state_after_preview=$stateAfterPreview; state_after_execute=$stateAfterExecute;
    review_before=$before.data.review_status; review_after=$after.data.review_status;
    tags_before=$before.data.tags; tags_after=$after.data.tags;
    history_count_before=@($historyBefore.data.items).Count; history_count_after=@($historyAfter.data.items).Count;
    protected_files=$protected; all_assertions_passed=$true
}
[IO.File]::WriteAllText((Join-Path $evidenceRoot 'summary.json'), ($summary | ConvertTo-Json -Depth 15), $utf8)
Write-Output ('PASS: ' + $observations.Count + ' actual JAR invocations; preview unchanged; two durable writes; one new audit log; protected materials unchanged.')
