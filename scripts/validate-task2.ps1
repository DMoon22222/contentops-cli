# Read-only business validation of the captured task-two run; no CLI calls or state mutation.
[CmdletBinding()]
param([string]$EvidenceDirectory = 'evidence/task2', [switch]$SaveReports)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$root = if ([IO.Path]::IsPathRooted($EvidenceDirectory)) { $EvidenceDirectory } else { Join-Path $projectRoot $EvidenceDirectory }
function Read-Json([string]$Relative) { Get-Content -LiteralPath (Join-Path $root $Relative) -Raw | ConvertFrom-Json }
function Canonical($Value) { ConvertTo-Json -InputObject $Value -Depth 40 -Compress }
function Assert-Check([bool]$Value, [string]$Message) { if (!$Value) { throw $Message } }
function Save-NewJson([string]$Relative, $Value) {
    if (!$SaveReports) { return }
    $path = Join-Path $root $Relative
    if (Test-Path -LiteralPath $path) { throw ('Validation report already exists: ' + $Relative) }
    [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $Value -Depth 30), [Text.UTF8Encoding]::new($false))
}
$manifest = Read-Json 'manifest.json'
$before = Read-Json 'commands/05-candidate-ct000004-detail.stdout.txt'
$historyBefore = Read-Json 'commands/07-candidate-ct000004-history.stdout.txt'
$preview = Read-Json 'commands/10-process-preview.stdout.txt'
$executed = Read-Json 'commands/13-process-execute.stdout.txt'
$after = Read-Json 'commands/14-after-detail.stdout.txt'
$historyAfter = Read-Json 'commands/15-after-history.stdout.txt'
$pending = Read-Json 'commands/16-after-pending-exact.stdout.txt'
$queueBefore = Read-Json 'commands/03-pending-page1-json.stdout.txt'
$queueAfter = Read-Json 'commands/17-after-pending-total.stdout.txt'
$snapshotPath = Join-Path $manifest.state_directory 'state.json'
$snapshot = Get-Content -LiteralPath $snapshotPath -Raw | ConvertFrom-Json
$snapshotSha = (Get-FileHash -LiteralPath $snapshotPath -Algorithm SHA256).Hash
$seed = Get-Content -LiteralPath '内容运营后台接口数据/mock_data.json' -Raw | ConvertFrom-Json
$commands = [Collections.Generic.List[object]]::new()
foreach ($file in Get-ChildItem -LiteralPath (Join-Path $root 'commands') -Filter '*.started.json' | Sort-Object Name) {
    $started = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    $finished = Read-Json ('commands/' + $started.name + '.finished.json')
    $exitCode = [int](Get-Content -LiteralPath (Join-Path $root ('commands/' + $started.name + '.exit-code.txt')))
    Assert-Check ($exitCode -eq $finished.actual_exit_code -and $exitCode -eq 0 -and !$finished.timed_out) ('Unsuccessful/incomplete invocation: ' + $started.name)
    Assert-Check ($started.state_directory -eq $manifest.state_directory -and !$started.fault_enabled) 'Mixed state or enabled fault'
    $outputJson = @($started.arguments).IndexOf('--output')
    $mode = $null; $status = $null
    if ($outputJson -ge 0 -and $started.arguments[$outputJson + 1] -eq 'json') {
        $result = Read-Json ('commands/' + $started.name + '.stdout.txt')
        Assert-Check ($result -isnot [array] -and $result.schema_version -eq '1' -and $result.environment -eq 'mock' -and $result.exit_code -eq $exitCode -and $null -eq $result.error -and @($result.warnings).Count -eq 0) 'Invalid JSON result/context'
        $mode = $result.mode; $status = $result.status
    }
    if ([int]$started.name.Substring(0,2) -ge 14) {
        $beforeRead = Read-Json ('commands/' + $started.name + '.snapshot-before.json')
        $afterRead = Read-Json ('commands/' + $started.name + '.snapshot-after.json')
        Assert-Check ($beforeRead.sha256 -eq $snapshotSha -and $afterRead.sha256 -eq $snapshotSha) 'Post-execution read rewrote snapshot'
    }
    $commands.Add([ordered]@{ name=$started.name; command=$started.command; arguments=$started.arguments; started_at=$started.started_at; finished_at=$finished.finished_at; pid=$finished.pid;
        actual_exit_code=$exitCode; mode=$mode; status=$status; may_write=$started.may_write; stdout=('commands/' + $started.name + '.stdout.txt'); stderr=('commands/' + $started.name + '.stderr.txt') })
}
Assert-Check ($commands.Count -eq 18 -and @($commands | Where-Object { $_.may_write }).Count -eq 1) 'Expected exactly eighteen captures and one write invocation'
Assert-Check ($before.data.review_status -eq 'pending' -and $after.data.review_status -eq 'approved') 'Review state transition not observed'
Assert-Check ((Canonical $after.data.tags) -ceq (Canonical @('恋爱','校园','武侠','悬疑'))) 'Original tags lost or target missing'
Assert-Check ($preview.mode -eq 'preview' -and $preview.status -eq 'previewed' -and $preview.data.steps.review.write -eq 'not_sent' -and $preview.data.steps.tags.write -eq 'not_sent') 'Invalid preview'
Assert-Check ((Canonical $preview.data.plan) -ceq (Canonical $executed.data.plan)) 'Execution intent differs from preview'
Assert-Check ($executed.mode -eq 'execute' -and $executed.status -eq 'succeeded' -and $executed.exit_code -eq 0) 'No trustworthy execution success'
foreach ($step in @('review','tags')) { Assert-Check ($executed.data.steps.$step.write -eq 'acknowledged' -and $executed.data.steps.$step.verification -eq 'matched') 'Write step not verified' }
Assert-Check (@($historyBefore.data.items).Count -eq 0 -and @($historyAfter.data.items).Count -eq 1) 'Expected exactly one new audit log'
$log = $historyAfter.data.items[0]
Assert-Check ($log.action -eq 'approve' -and $log.reason -eq $executed.data.plan.review.reason -and $log.operator_id -eq 'op_mock_cli') 'Unexpected audit log'
Assert-Check ($pending.data.total -eq 0 -and @($pending.data.items).Count -eq 0 -and $queueBefore.data.total -eq 132 -and $queueAfter.data.total -eq 131) 'Queue result did not update'
Assert-Check ($snapshot.revision -eq 2 -and @($snapshot.data.contents).Count -eq 300) 'Unexpected snapshot revision or content count'
$writePid = (Read-Json 'commands/13-process-execute.finished.json').pid
$verificationPids = @('14-after-detail','15-after-history','16-after-pending-exact' | ForEach-Object { (Read-Json ('commands/' + $_ + '.finished.json')).pid })
Assert-Check (@($verificationPids | Where-Object { $_ -eq $writePid }).Count -eq 0) 'Verification was not performed in independent JVM processes'
# Compare every original content field and all unrelated business collections, without editing either tree.
$contentChanges = [Collections.Generic.List[object]]::new()
Assert-Check (@($seed.contents).Count -eq @($snapshot.data.contents).Count) 'Content array changed shape'
for ($i = 0; $i -lt @($seed.contents).Count; $i++) {
    $old = $seed.contents[$i]; $new = $snapshot.data.contents[$i]
    Assert-Check ($old.content_id -ceq $new.content_id) 'Content order/ID changed'
    Assert-Check ((@($old.PSObject.Properties.Name | Sort-Object) -join '|') -ceq (@($new.PSObject.Properties.Name | Sort-Object) -join '|')) 'Content fields lost/added'
    foreach ($field in $old.PSObject.Properties.Name) {
        if ((Canonical $old.$field) -cne (Canonical $new.$field)) {
            $contentChanges.Add([ordered]@{ content_id=$old.content_id; field=$field; before=$old.$field; after=$new.$field })
        }
    }
}
Assert-Check ($contentChanges.Count -eq 2 -and @($contentChanges | Where-Object { $_.content_id -ne 'ct_000004' -or $_.field -notin @('review_status','tags') }).Count -eq 0) 'Unauthorized content fields changed'
$rootChanges = @($seed.PSObject.Properties.Name | Where-Object { $_ -notin @('contents','review_logs') -and (Canonical $seed.$_) -cne (Canonical $snapshot.data.$_) })
Assert-Check ($rootChanges.Count -eq 0) 'Unrelated business collection changed'
Assert-Check ((@($seed.PSObject.Properties.Name | Sort-Object) -join '|') -ceq (@($snapshot.data.PSObject.Properties.Name | Sort-Object) -join '|')) 'Root business fields changed shape'
$historyKeys = @(@($seed.review_logs.PSObject.Properties.Name) + @($snapshot.data.review_logs.PSObject.Properties.Name) | Sort-Object -Unique)
$historyChanges = @($historyKeys | Where-Object { (Canonical $seed.review_logs.$_) -cne (Canonical $snapshot.data.review_logs.$_) })
Assert-Check ($historyChanges.Count -eq 1 -and $historyChanges[0] -eq 'ct_000004') 'Unrelated audit history changed'
$protected = @(Read-Json 'validation/protected-before.json')
$protection = foreach ($item in $protected) {
    $actual = (Get-FileHash -LiteralPath $item.file -Algorithm SHA256).Hash
    Assert-Check ($actual -eq $item.sha256) ('Protected source/evidence changed: ' + $item.file)
    [ordered]@{ file=$item.file; before_sha256=$item.sha256; after_sha256=$actual; unchanged=$true }
}
$seedSha = (Get-FileHash -LiteralPath '内容运营后台接口数据/mock_data.json' -Algorithm SHA256).Hash
Assert-Check ($seedSha -eq $snapshot.seed_sha256.ToUpperInvariant()) 'Snapshot seed fingerprint mismatch'
Assert-Check ((Get-FileHash -LiteralPath 'target/contentops.jar' -Algorithm SHA256).Hash -eq $manifest.jar_sha256) 'JAR changed'
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $projectRoot 'target/contentops.jar'))
try {
    $stream = $zip.GetEntry('seed/mock_data.json').Open()
    try { $embeddedSeedSha = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($stream)) } finally { $stream.Dispose() }
} finally { $zip.Dispose() }
Assert-Check ($embeddedSeedSha -eq $seedSha) 'Packaged seed differs from original attachment'
Save-NewJson 'after/content.json' ([ordered]@{ source='commands/14-after-detail.stdout.txt'; data=$after.data })
Save-NewJson 'after/history.json' ([ordered]@{ source='commands/15-after-history.stdout.txt'; data=$historyAfter.data })
Save-NewJson 'after/tags.json' ([ordered]@{ source='commands/14-after-detail.stdout.txt'; tags=$after.data.tags })
Save-NewJson 'after/snapshot-facts.json' ([ordered]@{ state_schema_version=$snapshot.state_schema_version; revision=$snapshot.revision; seed_sha256=$snapshot.seed_sha256; sha256=$snapshotSha; content_id='ct_000004'; history_count=@($historyAfter.data.items).Count })
Save-NewJson 'validation/business-diff.json' ([ordered]@{ source='Original seed compared read-only with actual working snapshot'; content_changes=$contentChanges; changed_history_keys=$historyChanges; unrelated_content_count=299; changed_unrelated_collections=$rootChanges; all_assertions_passed=$true })
Save-NewJson 'validation/protected-after.json' $protection
$result = [ordered]@{ captured_at=[DateTimeOffset]::Now.ToString('o'); run_id=$manifest.run_id; source_commit=$manifest.source_commit; jar_sha256=$manifest.jar_sha256; seed_sha256=$seedSha;
    command_count=$commands.Count; commands=$commands; write_invocation_count=1; selected_content_id='ct_000004'; action='approve'; add='悬疑';
    preview_zero_write=(Read-Json 'preview/zero-write-validation.json'); execute_invocation_id=$executed.invocation_id; execute_actual_exit_code=0; steps=$executed.data.steps;
    before=$before.data; after=$after.data; history_before_count=0; history_after_count=1; new_history=$log;
    pending_total_before=$queueBefore.data.total; pending_total_after=$queueAfter.data.total; selected_pending_total_after=$pending.data.total;
    snapshot_revision=$snapshot.revision; snapshot_sha256=$snapshotSha; write_pid=$writePid; verification_pids=$verificationPids;
    cross_jvm_verified=$true; unauthorized_business_changes=$false; fault_enabled=$false; all_assertions_passed=$true }
Save-NewJson 'validation/result.json' $result
Write-Output 'PASS: 18 actual CLI invocations, one process execution; zero-write preview, approved + 悬疑, one audit log, cross-JVM persistence, no unrelated changes.'
