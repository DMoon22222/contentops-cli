#requires -Version 7.0
# A disposable no-profile acceptance session. All writes stay in the copied trial project.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$ProjectRoot,
      [Parameter(Mandatory)][string]$EvidenceDirectory,
      [Parameter(Mandatory)][string]$ExpectedJarSha256)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$utf8=[Text.UTF8Encoding]::new($false)
$checks=[Collections.Generic.List[string]]::new()
$calls=[Collections.Generic.List[object]]::new()
$started=[DateTimeOffset]::Now.ToString('o')
function Save([string]$Name,$Data){[IO.File]::WriteAllText((Join-Path $EvidenceDirectory $Name),($Data|ConvertTo-Json -Depth 50),$utf8)}
function Check([string]$Name,[bool]$Condition){if(!$Condition){throw "CHECK FAILED: $Name"};$checks.Add($Name)}
function RunCli([string]$Name,[string[]]$Arguments,[int]$Expected=0,[bool]$Json=$true,[string]$Entry='contentops'){
    $out=Join-Path $EvidenceDirectory ($Name+'.stdout.txt');$err=Join-Path $EvidenceDirectory ($Name+'.stderr.txt')
    & $Entry @Arguments 1> $out 2> $err
    $code=$LASTEXITCODE
    $facts=@{name=$Name;entry=$Entry;arguments=$Arguments;cwd=$PWD.Path;state=$env:CONTENTOPS_STATE_DIR;actual_exit_code=$code;caller_pid=$PID}
    Save ($Name+'.command.json') $facts;$calls.Add($facts)
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory ($Name+'.exit-code.txt')),"$code`n",$utf8)
    Check ($Name+' native exit') ($code -eq $Expected)
    $text=[IO.File]::ReadAllText($out,$utf8)
    if(!$Json){return $text}
    $r=$text|ConvertFrom-Json
    Check ($Name+' one JSON object') ($r -is [pscustomobject])
    Check ($Name+' envelope/native exit') ($r.exit_code -eq $code)
    Check ($Name+' actual Java Mock environment') ($r.environment -eq 'mock')
    return $r
}
try {
    Set-Location -LiteralPath $ProjectRoot
    Check 'Maven absent from runtime PATH' (@(Get-Command mvn,mvn.cmd -CommandType Application -ErrorAction SilentlyContinue).Count -eq 0)
    Check 'Git absent from runtime PATH' (@(Get-Command git,git.exe -CommandType Application -ErrorAction SilentlyContinue).Count -eq 0)
    Check 'No inherited state' (!(Test-Path Env:CONTENTOPS_STATE_DIR))
    Check 'No inherited fault injection' (!(Test-Path Env:CONTENTOPS_MOCK_SCENARIO))
    $jar=Join-Path $ProjectRoot 'target/contentops.jar'
    Check 'Trial JAR equals frozen binary' ((Get-FileHash -LiteralPath $jar).Hash -ieq $ExpectedJarSha256)
    $oldError=[Console]::Error;$capture=[IO.StringWriter]::new()
    try {
        [Console]::SetError($capture)
        & (Join-Path $ProjectRoot 'scripts/enable-contentops.ps1') -NewState 6>&1 1> (Join-Path $EvidenceDirectory '01-initialize.stdout.txt') 2> (Join-Path $EvidenceDirectory '01-initialize.powershell-errors.txt')
        $initCode=$LASTEXITCODE
    } finally {[Console]::SetError($oldError)}
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory '01-initialize.stderr.txt'),$capture.ToString(),$utf8)
    Save '01-initialize.command.json' @{script='scripts/enable-contentops.ps1';arguments=@('-NewState');actual_exit_code=$initCode;cwd=$PWD.Path}
    Check 'Initialization succeeded' ($initCode -eq 0)
    $launcher=(Get-Command contentops).Source
    Check 'Resolved launcher belongs to trial project' ($launcher -eq (Join-Path $ProjectRoot 'scripts/contentops.cmd'))
    $state=$env:CONTENTOPS_STATE_DIR;$snapshot=Join-Path $state 'state.json'
    Check 'New state is inside trial project' ($state.StartsWith((Join-Path $ProjectRoot '.contentops/reviewer-'),[StringComparison]::OrdinalIgnoreCase))
    Check 'New state absolute and initially empty' ([IO.Path]::IsPathFullyQualified($state) -and !(Test-Path -LiteralPath $snapshot))
    $help=RunCli '02-help' @('--help') 0 $false
    Check 'Help renders without business state' ($help.Contains('content') -and !(Test-Path -LiteralPath $snapshot))
    foreach($q in @(@{name='03-list-table';args=@('content','list','--review-status','pending')},@{name='04-get-table';args=@('content','get','ct_000004')},@{name='05-history-table';args=@('content','history','ct_000004')},@{name='06-tags-table';args=@('tags','list')})){
        $text=RunCli $q.name $q.args 0 $false;Check ($q.name+' table output') ($text.Contains('环境: mock'))
    }
    $before=RunCli '07-before-get' @('--output','json','content','get','ct_000004')
    Check 'Initial pending content with original tags' ($before.data.review_status -eq 'pending' -and ($before.data.tags -join '|') -eq '恋爱|校园|武侠')
    $h=RunCli '08-before-history' @('--output','json','content','history','ct_000004');Check 'Initial history empty' ($h.data.items.Count -eq 0)
    $pending=RunCli '09-before-pending' @('--output','json','content','list','--review-status','pending');Check 'Initial pending132' ($pending.data.total -eq 132)
    foreach($q in @(@{name='10-review-preview';args=@('content','review','ct_000004','--action','approve')},@{name='11-tags-preview';args=@('content','tags','update','ct_000004','--add','悬疑')},@{name='12-process-preview';args=@('content','process','ct_000004','--action','approve','--reason','交付候选测试','--add','悬疑')})){
        $r=RunCli $q.name (@('--output','json')+$q.args)
        Check ($q.name+' preview semantics') ($r.mode -eq 'preview' -and $r.status -eq 'previewed')
        Check ($q.name+' zero business writes') (!(Test-Path -LiteralPath $snapshot))
    }
    $bad=@(
        @{name='13-execute-without-yes';args=@('content','review','ct_000004','--action','approve','--execute')},
        @{name='14-yes-without-execute';args=@('content','review','ct_000004','--action','approve','--yes')},
        @{name='15-reject-no-reason';args=@('content','review','ct_000004','--action','reject','--execute','--yes')},
        @{name='16-unknown-tag';args=@('content','tags','update','ct_000004','--add','不存在的交付标签','--execute','--yes')},
        @{name='17-deprecated-tag';args=@('content','tags','update','ct_000004','--add','旧版-悬疑','--execute','--yes')})
    foreach($q in $bad){
        $r=RunCli $q.name (@('--output','json')+$q.args) 2
        Check ($q.name+' rejected and zero writes') ($r.status -eq 'rejected' -and !(Test-Path -LiteralPath $snapshot))
    }
    $r=RunCli '18-process-execute' @('--output','json','content','process','ct_000004','--action','approve','--reason','交付候选测试','--add','悬疑','--execute','--yes')
    Check 'Process succeeded, execute, exit0' ($r.status -eq 'succeeded' -and $r.mode -eq 'execute' -and $r.exit_code -eq 0)
    Check 'Both operations acknowledged and matched' ($r.data.steps.review.write -eq 'acknowledged' -and $r.data.steps.review.verification -eq 'matched' -and $r.data.steps.tags.write -eq 'acknowledged' -and $r.data.steps.tags.verification -eq 'matched')
    $hash=(Get-FileHash -LiteralPath $snapshot).Hash
    $after=RunCli '19-after-get-new-jvm' @('--output','json','content','get','ct_000004')
    Check 'New JVM reads approved and preserves existing tags' ($after.data.review_status -eq 'approved' -and ($after.data.tags -join '|') -eq '恋爱|校园|武侠|悬疑')
    $h=RunCli '20-after-history-new-jvm' @('--output','json','content','history','ct_000004')
    Check 'Exactly one new audit with exact reason' ($h.data.items.Count -eq 1 -and $h.data.items[0].reason -ceq '交付候选测试' -and $h.data.items[0].action -eq 'approve')
    $p=RunCli '21-after-pending' @('--output','json','content','list','--review-status','pending');Check 'Pending now131' ($p.data.total -eq 131)
    $r=RunCli '22-repeat-review' @('--output','json','content','review','ct_000004','--action','approve','--execute','--yes') 2
    Check 'Repeat review refused without changes' ($r.error.code -eq 'REVIEW_NOT_PENDING' -and (Get-FileHash -LiteralPath $snapshot).Hash -eq $hash)
    Set-Location -LiteralPath (Split-Path -Parent $ProjectRoot)
    $r=RunCli '23-other-cwd-new-jvm' @('--output','json','content','get','ct_000004')
    Check 'Other working directory uses same persisted state' ($r.data.review_status -eq 'approved' -and (Get-FileHash -LiteralPath $snapshot).Hash -eq $hash)
    $noJar=Join-Path (Split-Path -Parent $ProjectRoot) 'missing-jar-fixture/scripts'
    $null=[IO.Directory]::CreateDirectory($noJar)
    Copy-Item -LiteralPath $launcher -Destination (Join-Path $noJar 'contentops.cmd')
    $empty=RunCli '24-missing-jar' @('--output','json','content','get','ct_000004') 2 $false (Join-Path $noJar 'contentops.cmd')
    Check 'Missing JAR has stderr and empty stdout' ($empty -eq '' -and ([IO.File]::ReadAllText((Join-Path $EvidenceDirectory '24-missing-jar.stderr.txt'))).Contains('JAR'))
    $admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Save 'result.json' @{passed=$true;started_at=$started;finished_at=[DateTimeOffset]::Now.ToString('o');checks=$checks;calls=$calls;project_root=$ProjectRoot;resolved_launcher=$launcher;state_directory=$state;state_sha256=$hash;frozen_jar_sha256=$ExpectedJarSha256;runtime_path=$env:PATH;administrator=$admin;powershell=$PSVersionTable.PSVersion.ToString();business_changes=@{content_id='ct_000004';review_before='pending';review_after='approved';tags_before=$before.data.tags;tags_after=$after.data.tags;history_count=1;pending_before=132;pending_after=131};snapshot_metadata=(Get-Content -LiteralPath $snapshot -Raw|ConvertFrom-Json|Select-Object state_schema_version,seed_sha256,revision)}
    Write-Output "PASS: $($checks.Count) checks, no Maven/Git, actual copied JAR, independent Mock persistence"
    exit 0
} catch {
    Save ('failure-'+[DateTimeOffset]::Now.ToUnixTimeMilliseconds()+'.json') @{error=$_.ToString();position=$_.InvocationInfo.PositionMessage;checks=$checks;calls=$calls}
    [Console]::Error.WriteLine($_.ToString());exit 1
}
