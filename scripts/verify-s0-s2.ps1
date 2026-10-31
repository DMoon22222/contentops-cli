# Requires PowerShell 7. Run from the project root after mvn verify.
[CmdletBinding()]
param([string]$EvidenceDirectory = 'evidence/s0-s2/commands')

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$evidenceRoot = [IO.Path]::GetFullPath($EvidenceDirectory)
if (Test-Path -LiteralPath $evidenceRoot) {
    throw 'Evidence directory already exists. Select a new directory to preserve previous results.'
}
New-Item -ItemType Directory -Path $evidenceRoot | Out-Null
$stateDirectory = Join-Path $projectRoot ('.contentops/manual-validation/' + [guid]::NewGuid())
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$jar = Join-Path $projectRoot 'target/contentops.jar'
$protectedFiles = @(
    'AGENTS.md', '.gitignore', '.gitattributes',
    'docs/01-需求与接口分析.md', 'docs/02-第一阶段MVP与CLI产品方案.md',
    'docs/03-Java技术架构与实施方案.md', 'docs/04-交付物规划与验收清单.md',
    '题目：内容运营后台 CLI 化.md',
    '内容运营后台接口数据/README.md', '内容运营后台接口数据/content-ops-admin-openapi.json',
    '内容运营后台接口数据/mock_data.json', '内容运营后台接口数据.zip'
)
$before = @{}
foreach ($file in $protectedFiles) { $before[$file] = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }

$cases = @(
    @{ Name='01-help'; Args=@('--help'); Exit=0 },
    @{ Name='02-pending-table'; Args=@('--env','mock','content','list','--review-status','pending','--page','1'); Exit=0 },
    @{ Name='03-detail-table'; Args=@('--env','mock','content','get','ct_000004'); Exit=0 },
    @{ Name='04-history-table'; Args=@('--env','mock','content','history','ct_000003'); Exit=0 },
    @{ Name='05-tags-table'; Args=@('--env','mock','tags','list','--status','active'); Exit=0 },
    @{ Name='06-detail-json'; Args=@('--env','mock','--output','json','content','get','ct_000004'); Exit=0; Json=$true; Check='detail' },
    @{ Name='07-total-json'; Args=@('--env','mock','--output','json','content','list'); Exit=0; Json=$true; Total=300; Items=20 },
    @{ Name='08-pending-json'; Args=@('--env','mock','--output','json','content','list','--review-status','pending','--page','1'); Exit=0; Json=$true; Total=132; Items=20 },
    @{ Name='09-active-json'; Args=@('--env','mock','--output','json','tags','list'); Exit=0; Json=$true; Total=23; Items=23 },
    @{ Name='10-all-tags-json'; Args=@('--env','mock','--output','json','tags','list','--status','all'); Exit=0; Json=$true; Total=25; Items=25; Check='tags' },
    @{ Name='11-last-pending-page'; Args=@('--env','mock','--output','json','content','list','--review-status','pending','--page','7'); Exit=0; Json=$true; Total=132; Items=12 },
    @{ Name='12-and-query'; Args=@('--env','mock','--output','json','content','list','--content-id','ct_000003','--review-status','pending'); Exit=0; Json=$true; Total=0; Items=0 },
    @{ Name='13-invalid-page'; Args=@('--env','mock','--output','json','content','list','--page','0'); Exit=2; Json=$true; Code='INVALID_PAGE' },
    @{ Name='14-invalid-page-type'; Args=@('--env','mock','--output','json','content','list','--page','abc'); Exit=2; Json=$true; Code='INVALID_ARGUMENTS'; Check='parse' },
    @{ Name='15-missing-content'; Args=@('--env','mock','--output','json','content','get','ct_missing'); Exit=3; Json=$true; Code='CONTENT_NOT_FOUND' },
    @{ Name='16-api-rejected'; Args=@('--env','api','--output','json','content','list'); Exit=2; Json=$true; Code='API_ENV_NOT_IMPLEMENTED' },
    @{ Name='17-history-json'; Args=@('--env','mock','--output','json','content','history','ct_000003'); Exit=0; Json=$true; Check='history' },
    @{ Name='18-outside-page'; Args=@('--env','mock','--output','json','content','list','--review-status','pending','--page','999'); Exit=0; Json=$true; Total=132; Items=0 }
)

$observations = @()
foreach ($case in $cases) {
    $start = [Diagnostics.ProcessStartInfo]::new('java')
    $start.WorkingDirectory = $projectRoot
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = $utf8
    $start.StandardErrorEncoding = $utf8
    $start.Environment['CONTENTOPS_STATE_DIR'] = $stateDirectory
    foreach ($argument in @('-jar','./target/contentops.jar') + $case.Args) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::Start($start)
    $outTask = $process.StandardOutput.ReadToEndAsync()
    $errTask = $process.StandardError.ReadToEndAsync()
    if (!$process.WaitForExit(20000)) {
        $process.Kill($true)
        throw ('JAR command timed out: ' + $case.Name)
    }
    $stdout = $outTask.GetAwaiter().GetResult()
    $stderr = $errTask.GetAwaiter().GetResult()
    $actualExit = $process.ExitCode
    $process.Dispose()
    [IO.File]::WriteAllText((Join-Path $evidenceRoot ($case.Name + '.stdout.txt')), $stdout, $utf8)
    [IO.File]::WriteAllText((Join-Path $evidenceRoot ($case.Name + '.stderr.txt')), $stderr, $utf8)
    [IO.File]::WriteAllText((Join-Path $evidenceRoot ($case.Name + '.exit-code.txt')), "$actualExit`n", $utf8)
    $checks = @('actual_process_exit')
    if ($actualExit -ne $case.Exit) { throw ('Unexpected process exit: ' + $case.Name) }
    if ($case.Name -eq '01-help' -and (Test-Path -LiteralPath $stateDirectory)) { throw 'Help created state metadata' }
    $result = $null
    if ($case.Json) {
        $result = ConvertFrom-Json -InputObject $stdout -ErrorAction Stop
        if ($result -is [array] -or $result.schema_version -ne '1' -or $result.exit_code -ne $actualExit) { throw 'Invalid JSON envelope' }
        $checks += 'single_json_envelope_and_exit_match'
        if ($case.Exit -eq 0 -and ($result.status -ne 'succeeded' -or $result.mode -ne 'read' -or $stderr.Length -ne 0)) { throw 'Invalid read success' }
        if ($case.ContainsKey('Total')) {
            if ($result.data.total -ne $case.Total -or @($result.data.items).Count -ne $case.Items) { throw ('Wrong data count: ' + $case.Name) }
            $checks += 'total_and_item_counts'
        }
        if ($case.ContainsKey('Code') -and ($result.error.code -ne $case.Code -or $stderr.Length -eq 0)) { throw 'Wrong error code or missing diagnostic' }
        if ($case.Check -eq 'detail' -and ($result.data.content_id -ne 'ct_000004' -or @($result.data.PSObject.Properties).Count -ne 12 -or $result.data.body -notmatch '[\p{IsCJKUnifiedIdeographs}]')) { throw 'Detail fields or Chinese body lost' }
        if ($case.Check -eq 'tags' -and @($result.data.items | Where-Object status -eq 'deprecated').Count -ne 2) { throw 'Deprecated tags not retained' }
        if ($case.Check -eq 'parse' -and $null -ne $result.mode) { throw 'Parse failure fabricated execution mode' }
        if ($case.Check -eq 'history') {
            $dates = @($result.data.items | ForEach-Object { [DateTimeOffset]$_.created_at })
            for ($i = 1; $i -lt $dates.Count; $i++) { if ($dates[$i] -gt $dates[$i-1]) { throw 'History not descending' } }
        }
    }
    if (Test-Path -LiteralPath (Join-Path $stateDirectory 'state.json')) { throw 'Read command created business snapshot' }
    $observations += [ordered]@{
        name=$case.Name; command=('java -jar ./target/contentops.jar ' + ($case.Args -join ' '));
        actual_exit_code=$actualExit; actual_total=$result.data.total; checks=$checks; passed=$true
    }
}

$protection = @()
foreach ($file in $protectedFiles) {
    $after = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    if ($before[$file] -ne $after) { throw ('Protected file changed: ' + $file) }
    $protection += [ordered]@{ file=$file; before_sha256=$before[$file]; after_sha256=$after; unchanged=$true }
}
$summary = [ordered]@{
    captured_at=[DateTimeOffset]::Now.ToString('o'); platform=[Environment]::OSVersion.VersionString;
    powershell=$PSVersionTable.PSVersion.ToString(); state_directory=$stateDirectory;
    jar_sha256=(Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash;
    command_count=$observations.Count; commands=$observations;
    business_snapshot_created=(Test-Path -LiteralPath (Join-Path $stateDirectory 'state.json'));
    protected_files=$protection;
    scope='Read-only Mock validation; no review or tag business mutation was executed.'
}
[IO.File]::WriteAllText((Join-Path $evidenceRoot 'summary.json'), ($summary | ConvertTo-Json -Depth 12), $utf8)
Write-Output ('PASS: ' + $observations.Count + ' JAR invocations; protected files unchanged; no business snapshot created.')
