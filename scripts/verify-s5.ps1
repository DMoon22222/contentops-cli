# PowerShell 7. Explicit local Mock development faults; not the task-two final demonstration.
[CmdletBinding()]
param([string]$EvidenceDirectory = 'evidence/s5')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$evidenceRoot = if ([IO.Path]::IsPathRooted($EvidenceDirectory)) { $EvidenceDirectory } else { Join-Path $projectRoot $EvidenceDirectory }
# Maven logs may already exist in validation/. Never overwrite previous command/scenario evidence.
foreach ($child in @('commands','scenarios','summary.json','protected-files.json')) {
    if (Test-Path -LiteralPath (Join-Path $evidenceRoot $child)) { throw 'Evidence already exists; select a new EvidenceDirectory.' }
}
$commandsRoot = Join-Path $evidenceRoot 'commands'; $scenariosRoot = Join-Path $evidenceRoot 'scenarios'
New-Item -ItemType Directory -Path $commandsRoot,$scenariosRoot -Force | Out-Null
$stateRoot = Join-Path $projectRoot ('.contentops/s5-validation/' + [guid]::NewGuid())
$initialScenario = [Environment]::GetEnvironmentVariable('CONTENTOPS_MOCK_SCENARIO', 'Process')
$initialStateDirectory = [Environment]::GetEnvironmentVariable('CONTENTOPS_STATE_DIR', 'Process')
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$invocations = [Collections.Generic.List[object]]::new()
$scenarioResults = [Collections.Generic.List[object]]::new()
$protectedPaths = @('AGENTS.md','.gitignore','.gitattributes','题目：内容运营后台 CLI 化.md','内容运营后台接口数据.zip')
$protectedPaths += @(Get-ChildItem -LiteralPath 'docs','内容运营后台接口数据','evidence/s0-s2','evidence/s3-s4' -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($projectRoot, $_.FullName) })
$sourceHashes = @{}
foreach ($path in $protectedPaths) { $sourceHashes[$path] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }

function Assert-Check([bool]$Condition, [string]$Message) { if (!$Condition) { throw $Message } }
function Save-Json([string]$Path, $Value) { [IO.File]::WriteAllText($Path, (ConvertTo-Json -InputObject $Value -Depth 25), $utf8) }
function As-Json($Value) { ConvertTo-Json -InputObject $Value -Depth 25 -Compress }
function Snapshot-Facts([string]$Directory) {
    $path = Join-Path $Directory 'state.json'
    if (!(Test-Path -LiteralPath $path)) { return [ordered]@{ exists=$false; revision=$null; sha256=$null; content=$null; history=@() } }
    $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    return [ordered]@{ exists=$true; revision=$state.revision; sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash;
        state_schema_version=$state.state_schema_version; seed_sha256=$state.seed_sha256;
        content=@($state.data.contents | Where-Object content_id -eq 'ct_000004')[0]; history=@($state.data.review_logs.ct_000004) }
}
function Invoke-Cli([string]$Name, [string]$StateDirectory, [string]$Scenario, [string[]]$CliArguments, [int]$ExpectedExit) {
    $start = [Diagnostics.ProcessStartInfo]::new('java')
    $start.WorkingDirectory = $projectRoot; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true; $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = $utf8; $start.StandardErrorEncoding = $utf8
    $start.Environment['CONTENTOPS_STATE_DIR'] = $StateDirectory
    [void]$start.Environment.Remove('CONTENTOPS_MOCK_SCENARIO')
    if (![string]::IsNullOrEmpty($Scenario)) { $start.Environment['CONTENTOPS_MOCK_SCENARIO'] = $Scenario }
    foreach ($jvmSetting in @('JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','JDK_JAVA_OPTIONS')) { [void]$start.Environment.Remove($jvmSetting) }
    foreach ($argument in @('-jar','./target/contentops.jar') + $CliArguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    $outTask = $process.StandardOutput.ReadToEndAsync(); $errTask = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit(20000)) { $process.Kill($true); throw ('CLI timed out: ' + $Name) }
    $stdout = $outTask.GetAwaiter().GetResult(); $stderr = $errTask.GetAwaiter().GetResult(); $exitCode = $process.ExitCode
    $process.Dispose()
    foreach ($stream in @(@('stdout',$stdout),@('stderr',$stderr),@('exit-code',"$exitCode`n"))) {
        [IO.File]::WriteAllText((Join-Path $commandsRoot ($Name + '.' + $stream[0] + '.txt')), $stream[1], $utf8)
    }
    $displayArguments = @($CliArguments | ForEach-Object { if ($_ -match '\s') { "'" + $_.Replace("'","''") + "'" } else { $_ } })
    $record = [ordered]@{ name=$Name; command=('java -jar ./target/contentops.jar ' + ($displayArguments -join ' ')); arguments=$CliArguments;
        state_directory=$StateDirectory; scenario_environment=$(if ([string]::IsNullOrEmpty($Scenario)) { $null } else { $Scenario }); actual_exit_code=$exitCode }
    $invocations.Add($record)
    Assert-Check ($exitCode -eq $ExpectedExit) ('Wrong actual process exit for ' + $Name + ': ' + $exitCode)
    $result = ConvertFrom-Json -InputObject $stdout -ErrorAction Stop
    Assert-Check ($result -isnot [array] -and $result.schema_version -eq '1' -and $result.exit_code -eq $exitCode) ('Invalid single JSON envelope: ' + $Name)
    $record['status'] = $result.status; $record['mode'] = $result.mode
    if (![string]::IsNullOrEmpty($Scenario) -and $result.environment -eq 'mock' -and $Scenario -ne 'invalid') {
        Assert-Check (@($result.warnings | Where-Object { $_ -like ('MOCK_FAULT_ACTIVE scenario=' + $Scenario + '*') }).Count -eq 1) 'Missing explicit fault marker'
    }
    return $result
}
function Counters($Result) {
    $prefix = 'MOCK_CALL_COUNTS '
    $values = @($Result.warnings | Where-Object { $_.StartsWith($prefix) })
    Assert-Check ($values.Count -eq 1) 'Missing invocation write counters'
    return ConvertFrom-Json -InputObject $values[0].Substring($prefix.Length)
}

$cases = @(
    @{ Name='normal'; Scene=$null; Code=0; Status='succeeded'; Revision=2; TagAttempts=1; TagDelegates=1; Reads=4; DelegateReads=4 },
    @{ Name='tags-reject-before-write'; Scene='tags-reject-before-write'; Code=4; Status='partial'; Revision=1; TagAttempts=1; TagDelegates=0; Reads=3; DelegateReads=3 },
    @{ Name='review-commit-response-lost'; Scene='review-commit-response-lost'; Code=5; Status='unknown'; Revision=1; TagAttempts=0; TagDelegates=0; Reads=2; DelegateReads=2 },
    @{ Name='tags-commit-response-lost'; Scene='tags-commit-response-lost'; Code=5; Status='unknown'; Revision=2; TagAttempts=1; TagDelegates=1; Reads=3; DelegateReads=3 },
    @{ Name='review-readback-mismatch'; Scene='review-readback-mismatch'; Code=6; Status='verification_failed'; Revision=1; TagAttempts=0; TagDelegates=0; Reads=3; DelegateReads=4 },
    @{ Name='tags-readback-mismatch'; Scene='tags-readback-mismatch'; Code=6; Status='verification_failed'; Revision=2; TagAttempts=1; TagDelegates=1; Reads=4; DelegateReads=5 }
)
$prefixArguments = @('--env','mock','--output','json','--non-interactive')
$processArguments = $prefixArguments + @('content','process','ct_000004','--action','approve','--reason','S5：人工提供的开发验证决定','--add','轻松')
foreach ($case in $cases) {
    $caseRoot = Join-Path $scenariosRoot $case.Name
    New-Item -ItemType Directory -Path $caseRoot | Out-Null
    $stateDirectory = Join-Path $stateRoot $case.Name
    $before = Invoke-Cli ($case.Name + '-01-before') $stateDirectory $null ($prefixArguments + @('content','get','ct_000004')) 0
    $historyBefore = Invoke-Cli ($case.Name + '-02-history-before') $stateDirectory $null ($prefixArguments + @('content','history','ct_000004')) 0
    $snapshotBefore = Snapshot-Facts $stateDirectory
    Save-Json (Join-Path $caseRoot 'snapshot-before.json') $snapshotBefore
    $preview = Invoke-Cli ($case.Name + '-03-preview') $stateDirectory $case.Scene $processArguments 0
    Assert-Check ($preview.status -eq 'previewed' -and $preview.data.steps.review.write -eq 'not_sent' -and $preview.data.steps.tags.write -eq 'not_sent') 'Preview wrote or claimed execution'
    Assert-Check (!(Snapshot-Facts $stateDirectory).exists) 'Preview created business snapshot'
    $invoked = Invoke-Cli ($case.Name + '-04-process') $stateDirectory $case.Scene ($processArguments + @('--execute','--yes')) $case.Code
    Assert-Check ($invoked.status -eq $case.Status -and $invoked.mode -eq 'execute') 'Fault status or mode mismatch'
    $calls = $null
    if ($null -ne $case.Scene) {
        $calls = Counters $invoked
        Assert-Check ($calls.review_attempts -eq 1 -and $calls.review_delegate_calls -eq 1) 'Review was retried or not delegated exactly once'
        Assert-Check ($calls.tag_attempts -eq $case.TagAttempts -and $calls.tag_delegate_calls -eq $case.TagDelegates) 'Wrong tag attempts/delegate count'
        Assert-Check ($calls.content_reads -eq $case.Reads -and $calls.delegate_content_reads -eq $case.DelegateReads) 'Read phase count mismatch'
        Assert-Check ($calls.injected_readbacks -eq $(if ($case.Code -eq 6) { 1 } else { 0 })) 'Wrong readback injection scope'
    } else {
        Assert-Check (@($invoked.warnings).Count -eq 0) 'Normal baseline unexpectedly activated diagnostics'
    }
    $reviewWrite = if ($case.Name -eq 'review-commit-response-lost') { 'unknown' } else { 'acknowledged' }
    $reviewVerify = if ($case.Name -eq 'review-commit-response-lost') { 'not_checked' } elseif ($case.Name -eq 'review-readback-mismatch') { 'mismatched' } else { 'matched' }
    $tagWrite = if ($case.TagAttempts -eq 0) { 'not_sent' } elseif ($case.Code -eq 4) { 'failed' } elseif ($case.Code -eq 5) { 'unknown' } else { 'acknowledged' }
    $tagVerify = if ($case.Name -eq 'tags-readback-mismatch') { 'mismatched' } elseif ($case.Code -eq 0) { 'matched' } else { 'not_checked' }
    Assert-Check ($invoked.data.steps.review.write -eq $reviewWrite -and $invoked.data.steps.review.verification -eq $reviewVerify) 'Review facts lost'
    Assert-Check ($invoked.data.steps.tags.write -eq $tagWrite -and $invoked.data.steps.tags.verification -eq $tagVerify) 'Tags facts lost'
    if ($case.Code -ne 0) { Assert-Check ((As-Json $invoked.data.observed.tags) -eq (As-Json $before.data.tags)) 'Observed was replaced by target tags' }
    $snapshot = Snapshot-Facts $stateDirectory
    Save-Json (Join-Path $caseRoot 'snapshot-after-process.json') $snapshot
    Assert-Check ($snapshot.revision -eq $case.Revision -and $snapshot.content.review_status -eq 'approved' -and @($snapshot.history).Count -eq 1) 'Real disk state/log/revision incorrect'
    $expectedTags = if ($case.Revision -eq 2) { @('恋爱','校园','武侠','轻松') } else { @('恋爱','校园','武侠') }
    Assert-Check ((As-Json $snapshot.content.tags) -eq (As-Json $expectedTags)) 'Disk tags differ from actual expected changes'
    $originalResultHash = (Get-FileHash -LiteralPath (Join-Path $commandsRoot ($case.Name + '-04-process.stdout.txt')) -Algorithm SHA256).Hash
    # All subsequent queries/recovery use newly started JVMs with the scenario env removed.
    $observed = Invoke-Cli ($case.Name + '-05-query-no-fault') $stateDirectory $null ($prefixArguments + @('content','get','ct_000004')) 0
    $history = Invoke-Cli ($case.Name + '-06-history-no-fault') $stateDirectory $null ($prefixArguments + @('content','history','ct_000004')) 0
    Assert-Check (@($observed.warnings).Count -eq 0 -and $observed.data.review_status -eq 'approved') 'Fault leaked into independent query'
    Assert-Check ((As-Json $observed.data.tags) -eq (As-Json $expectedTags) -and @($history.data.items).Count -eq 1) 'Independent JVM did not see committed result'
    $repeat = Invoke-Cli ($case.Name + '-07-repeat-process-rejected') $stateDirectory $null ($processArguments + @('--execute','--yes')) 2
    Assert-Check ($repeat.error.code -eq 'REVIEW_NOT_PENDING') 'Sequential duplicate review not blocked'
    Assert-Check ((Snapshot-Facts $stateDirectory).sha256 -eq $snapshot.sha256) 'Query/rejected retry changed snapshot'
    $recoveryResult = $null
    if ($case.Code -eq 4) {
        $recoveryResult = Invoke-Cli ($case.Name + '-08-tags-only-recovery') $stateDirectory $null ($prefixArguments + @('content','tags','update','ct_000004','--add','轻松','--execute','--yes')) 0
        Assert-Check ($recoveryResult.status -eq 'succeeded' -and !($recoveryResult.data.steps.PSObject.Properties.Name -contains 'review')) 'Recovery incorrectly repeated review'
        $recovered = Invoke-Cli ($case.Name + '-09-recovered-query') $stateDirectory $null ($prefixArguments + @('content','get','ct_000004')) 0
        $recoveredHistory = Invoke-Cli ($case.Name + '-10-recovered-history') $stateDirectory $null ($prefixArguments + @('content','history','ct_000004')) 0
        Assert-Check ((As-Json $recoveredHistory.data) -eq (As-Json $history.data)) 'Tag recovery appended another review log'
        Assert-Check ((As-Json $recovered.data.tags) -eq (As-Json @('恋爱','校园','武侠','轻松'))) 'Tag recovery lost original tags'
        $recoverySnapshot = Snapshot-Facts $stateDirectory
        Assert-Check ($recoverySnapshot.revision -eq 2 -and $recovered.data.review_status -eq 'approved') 'Recovery not durably committed'
        Save-Json (Join-Path $caseRoot 'snapshot-after-recovery.json') $recoverySnapshot
    }
    Assert-Check ((Get-FileHash -LiteralPath (Join-Path $commandsRoot ($case.Name + '-04-process.stdout.txt')) -Algorithm SHA256).Hash -eq $originalResultHash) 'Original invocation result changed after observation'
    Assert-Check ($invoked.status -eq $case.Status) 'Unknown/failure promoted by later query'
    $facts = [ordered]@{ scenario=$case.Scene; status=$invoked.status; actual_exit_code=$invoked.exit_code; steps=$invoked.data.steps;
        observed_during_invocation=$invoked.data.observed; calls=$calls; calls_source=$(if ($null -eq $calls) { 'Not exposed for default runtime; normal request order/counts covered by JUnit' } else { 'Actual fault wrapper counters in CLI warnings' });
        disk_revision_after_process=$snapshot.revision; disk_review_status=$snapshot.content.review_status; disk_tags=$snapshot.content.tags;
        history_before=@($historyBefore.data.items).Count; history_after=@($history.data.items).Count;
        repeat_rejected=$true; original_result_sha256=$originalResultHash; original_result_unchanged=$true; tag_recovery_succeeded=($null -ne $recoveryResult); all_assertions_passed=$true }
    Save-Json (Join-Path $caseRoot 'result.json') $facts
    $scenarioResults.Add($facts)
}
$invalid = Invoke-Cli 'config-invalid' (Join-Path $stateRoot 'invalid') 'invalid' ($prefixArguments + @('content','get','ct_000004')) 2
Assert-Check ($invalid.error.code -eq 'INVALID_MOCK_SCENARIO') 'Invalid scenario not rejected'
$apiFault = Invoke-Cli 'config-api-forbidden' (Join-Path $stateRoot 'api') 'tags-reject-before-write' @('--env','api','--output','json','content','get','ct_000004') 2
Assert-Check ($apiFault.error.code -eq 'MOCK_SCENARIO_NOT_ALLOWED') 'API accepted a Mock scenario'
Assert-Check (!(Test-Path -LiteralPath (Join-Path $stateRoot 'invalid')) -and !(Test-Path -LiteralPath (Join-Path $stateRoot 'api'))) 'Rejected config created state directory'
$protection = foreach ($path in $protectedPaths) {
    $afterHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    Assert-Check ($sourceHashes[$path] -eq $afterHash) ('Protected file changed: ' + $path)
    [ordered]@{ file=$path; before_sha256=$sourceHashes[$path]; after_sha256=$afterHash; unchanged=$true }
}
Assert-Check ([Environment]::GetEnvironmentVariable('CONTENTOPS_MOCK_SCENARIO','Process') -ceq $initialScenario) 'Parent scenario env changed'
Assert-Check ([Environment]::GetEnvironmentVariable('CONTENTOPS_STATE_DIR','Process') -ceq $initialStateDirectory) 'Parent state env changed'
Save-Json (Join-Path $evidenceRoot 'protected-files.json') $protection
Save-Json (Join-Path $evidenceRoot 'summary.json') ([ordered]@{ captured_at=[DateTimeOffset]::Now.ToString('o'); scope='S5 explicit local Mock faults, not task-two final demonstration or HTTP';
    state_root=$stateRoot; jar_sha256=(Get-FileHash -LiteralPath 'target/contentops.jar' -Algorithm SHA256).Hash;
    command_count=$invocations.Count; commands=$invocations; scenarios=$scenarioResults; protected_file_count=$protectedPaths.Count; parent_environment_unchanged=$true; all_assertions_passed=$true })
Write-Output ('PASS: ' + $invocations.Count + ' real JAR invocations; normal + five fault scenarios; tag-only recovery; immutable original outcomes and protected materials.')
