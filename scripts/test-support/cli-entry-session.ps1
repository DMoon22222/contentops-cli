#requires -Version 7.0
# Test-only isolated PowerShell session. Never configure the reviewer's interactive shell.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$CaseName,
      [Parameter(Mandatory)][string]$ProjectRoot,
      [Parameter(Mandatory)][string]$SourceRoot,
      [Parameter(Mandatory)][string]$WorkRoot,
      [Parameter(Mandatory)][string]$EvidenceDirectory,
      [string]$JavaFixtureDirectory)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$utf8=[Text.UTF8Encoding]::new($false)
$checks=[Collections.Generic.List[string]]::new()
$calls=[Collections.Generic.List[object]]::new()
$setup=Join-Path $ProjectRoot 'scripts/enable-contentops.ps1'
$launcher=Join-Path $ProjectRoot 'scripts/contentops.cmd'
$normalState=Join-Path $ProjectRoot '.contentops/reviewer'
$originalPath=$env:PATH
$originalJavaHome=$env:JAVA_HOME
Remove-Item Env:CONTENTOPS_STATE_DIR,Env:CONTENTOPS_MOCK_SCENARIO -ErrorAction SilentlyContinue
Set-Location -LiteralPath $ProjectRoot

function Check([string]$Name,[bool]$Condition) {
    if(!$Condition){throw "CHECK FAILED: $Name"};$checks.Add($Name)
}
function Save([string]$Name,$Value) {
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory $Name),($Value|ConvertTo-Json -Depth 35),$utf8)
}
function Hash([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash }
function Initialize([string]$Name,[hashtable]$Options=@{},[int]$Expected=0) {
    $savedError=[Console]::Error;$capture=[IO.StringWriter]::new()
    $out=Join-Path $EvidenceDirectory "$Name.stdout.txt"
    $psError=Join-Path $EvidenceDirectory "$Name.powershell-errors.txt"
    try {
        [Console]::SetError($capture)
        & $setup @Options 6>&1 1> $out 2> $psError
        $nativeExit=$LASTEXITCODE
    } finally { [Console]::SetError($savedError) }
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory "$Name.stderr.txt"),$capture.ToString(),$utf8)
    Save "$Name.command.json" @{script=$setup;parameters=$Options;actual_exit=$nativeExit;cwd=$PWD.Path}
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory "$Name.exit-code.txt"),"$nativeExit`n",$utf8)
    $calls.Add(@{type='initializer';name=$Name;exit=$nativeExit})
    Check "$Name expected initializer exit $Expected" ($nativeExit -eq $Expected)
    if($Expected -ne 0){Check "$Name friendly error" ($capture.ToString().Contains('ContentOps 初始化失败'))}
}
function Invoke-EntryCli([string]$Name,[string[]]$Arguments,[int]$Expected=0,[bool]$Json=$true,[string]$Entry='contentops') {
    $stdout=Join-Path $EvidenceDirectory "$Name.stdout.txt";$stderr=Join-Path $EvidenceDirectory "$Name.stderr.txt"
    $resolved=(Get-Command $Entry -ErrorAction Stop).Source
    & $Entry @Arguments 1> $stdout 2> $stderr
    $nativeExit=$LASTEXITCODE
    Save "$Name.command.json" @{entry=$Entry;resolved=$resolved;arguments=$Arguments;cwd=$PWD.Path;state_directory=$env:CONTENTOPS_STATE_DIR;actual_exit=$nativeExit}
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory "$Name.exit-code.txt"),"$nativeExit`n",$utf8)
    $calls.Add(@{type='launcher';name=$Name;exit=$nativeExit})
    Check "$Name actual native exit" ($nativeExit -eq $Expected)
    $text=[IO.File]::ReadAllText($stdout,$utf8)
    if($Json){
        $result=$text|ConvertFrom-Json
        Check "$Name exactly one JSON object" ($result -is [pscustomobject] -and $text.TrimStart().StartsWith('{') -and $text.TrimEnd().EndsWith('}'))
        Check "$Name JSON/native exit match" ($result.exit_code -eq $nativeExit)
        Check "$Name Java mock origin" ($result.environment -eq 'mock')
        return $result
    }
    return $text
}
function FailedSetup([string]$Name,[hashtable]$Options=@{}) {
    $beforePath=$env:PATH;$beforeState=$env:CONTENTOPS_STATE_DIR;$beforeStatePresent=Test-Path Env:CONTENTOPS_STATE_DIR
    Initialize $Name $Options 2
    Check "$Name PATH rollback" ($beforePath -ceq $env:PATH)
    Check "$Name state rollback" (($beforeState -ceq $env:CONTENTOPS_STATE_DIR) -and $beforeStatePresent -eq (Test-Path Env:CONTENTOPS_STATE_DIR))
    Check "$Name JAVA_HOME unchanged" ($originalJavaHome -ceq $env:JAVA_HOME)
}

try {
    switch($CaseName){
        'normal' {
            Initialize '01-enable'
            Check 'default absolute state directory' ([IO.Path]::IsPathFullyQualified($env:CONTENTOPS_STATE_DIR) -and $env:CONTENTOPS_STATE_DIR -eq $normalState)
            Check 'project launcher resolved' ((Get-Command contentops).Source -eq $launcher)
            $pathAfter=$env:PATH
            Initialize '02-enable-again'
            Check 'repeat initialization unchanged PATH' ($pathAfter -ceq $env:PATH)
            Check 'scripts first and occurs once' (($env:PATH -split ';')[0] -eq (Join-Path $ProjectRoot 'scripts') -and @($env:PATH -split ';'|Where-Object {$_ -eq (Join-Path $ProjectRoot 'scripts')}).Count -eq 1)
            $help=Invoke-EntryCli '03-help' @('--help') 0 $false
            Check 'help content' ($help.Contains('content') -and $help.Contains('tags'))
            Check 'help no business snapshot' (!(Test-Path -LiteralPath (Join-Path $normalState 'state.json')))
            foreach($item in @(@{n='04-list';a=@('content','list','--review-status','pending')},@{n='05-get';a=@('content','get','ct_000004')},@{n='06-history';a=@('content','history','ct_000004')},@{n='07-tags';a=@('tags','list')})){
                $text=Invoke-EntryCli $item.n $item.a 0 $false;Check ($item.n+' table mode') ($text.Contains('环境: mock'))
            }
            $r=Invoke-EntryCli '08-total' @('--output','json','content','list');Check 'all 300 contents' ($r.data.total -eq 300)
            $r=Invoke-EntryCli '09-pending' @('--output','json','content','list','--review-status','pending');Check 'pending132 page1=20' ($r.data.total -eq 132 -and $r.data.items.Count -eq 20)
            $r=Invoke-EntryCli '10-tags' @('--output','json','tags','list');Check 'active23 default' ($r.data.total -eq 23)
            $r=Invoke-EntryCli '11-all-tags' @('--output','json','tags','list','--status','all');Check 'all25' ($r.data.total -eq 25)
            foreach($item in @(@{n='12-review-preview';a=@('content','review','ct_000004','--action','approve')},@{n='13-tags-preview';a=@('content','tags','update','ct_000004','--add','悬疑')},@{n='14-process-preview';a=@('content','process','ct_000004','--action','approve','--reason','中文 English 空格','--add','悬疑')})){
                $r=Invoke-EntryCli $item.n (@('--output','json')+$item.a);Check ($item.n+' preview') ($r.mode -eq 'preview' -and $r.status -eq 'previewed')
                Check ($item.n+' zero business writes') (!(Test-Path -LiteralPath (Join-Path $normalState 'state.json')))
            }
            $null=Invoke-EntryCli '15-missing-yes' @('--output','json','content','review','ct_000004','--action','approve','--execute') 2
            $null=Invoke-EntryCli '16-only-yes' @('--output','json','content','review','ct_000004','--action','approve','--yes') 2
            Check 'authorization guards no writes' (!(Test-Path -LiteralPath (Join-Path $normalState 'state.json')))
            $reason='本地演示审核决定 · 中文 English 空格 (A) !'
            $r=Invoke-EntryCli '17-process-execute' @('--output','json','content','process','ct_000004','--action','approve','--reason',$reason,'--add','悬疑','--execute','--yes')
            Check 'execute success and verified' ($r.status -eq 'succeeded' -and $r.data.steps.review.verification -eq 'matched' -and $r.data.steps.tags.verification -eq 'matched')
            $stateHash=Hash (Join-Path $normalState 'state.json')
            $r=Invoke-EntryCli '18-after-get' @('--output','json','content','get','ct_000004')
            Check 'approved complete tags' ($r.data.review_status -eq 'approved' -and ($r.data.tags -join '|') -eq '恋爱|校园|武侠|悬疑')
            $r=Invoke-EntryCli '19-after-history' @('--output','json','content','history','ct_000004')
            Check 'Chinese spaced reason and exclamation preserved' ($r.data.items.Count -eq 1 -and $r.data.items[0].reason -ceq $reason)
            $r=Invoke-EntryCli '20-pending-after' @('--output','json','content','list','--review-status','pending');Check 'pending131' ($r.data.total -eq 131)
            $r=Invoke-EntryCli '21-repeat' @('--output','json','content','review','ct_000004','--action','approve','--execute','--yes') 2
            Check 'repeat pending protection' ($r.error.code -eq 'REVIEW_NOT_PENDING')
            $null=Invoke-EntryCli '22-missing-id' @('--output','json','content','get','ct_missing') 3
            Check 'queries and repeat preserve snapshot' ($stateHash -eq (Hash (Join-Path $normalState 'state.json')))
            Set-Location -LiteralPath $WorkRoot
            $r=Invoke-EntryCli '23-other-cwd' @('--output','json','content','get','ct_000004');Check 'other cwd same stored state' ($r.data.review_status -eq 'approved' -and $stateHash -eq (Hash (Join-Path $normalState 'state.json')))
            Save 'state-facts.json' @{state_directory=$normalState;sha256=$stateHash;snapshot=Get-Content -LiteralPath (Join-Path $normalState 'state.json') -Raw|ConvertFrom-Json|Select-Object state_schema_version,seed_sha256,revision}
        }
        'preserve' {
            $env:CONTENTOPS_STATE_DIR=$normalState;$before=Hash (Join-Path $normalState 'state.json')
            Initialize 'enable-preserve';Check 'existing env retained' ($env:CONTENTOPS_STATE_DIR -ceq $normalState)
            $null=Invoke-EntryCli 'read-existing' @('--output','json','content','get','ct_000004')
            Check 'existing bytes unchanged' ($before -eq (Hash (Join-Path $normalState 'state.json')))
        }
        'new-state' {
            $env:CONTENTOPS_STATE_DIR=$normalState;$before=Hash (Join-Path $normalState 'state.json')
            Initialize 'new-state' @{NewState=$true};$fresh=$env:CONTENTOPS_STATE_DIR
            Check 'new unique directory' ($fresh -ne $normalState -and (Test-Path -LiteralPath $fresh -PathType Container))
            $r=Invoke-EntryCli 'new-state-get' @('--output','json','content','get','ct_000004');Check 'new view pending initial three tags' ($r.data.review_status -eq 'pending' -and $r.data.tags.Count -eq 3)
            Check 'fresh directory has no business snapshot' (!(Test-Path -LiteralPath (Join-Path $fresh 'state.json')))
            Initialize 'reuse-new';Check 'second init reuses new directory' ($fresh -ceq $env:CONTENTOPS_STATE_DIR)
            Check 'old state was not reset' ($before -eq (Hash (Join-Path $normalState 'state.json')))
        }
        'custom' {
            $custom=Join-Path $WorkRoot '自定义 状态目录'
            Initialize 'custom' @{StateDirectory=$custom};Check 'custom absolute state' ($env:CONTENTOPS_STATE_DIR -eq $custom)
            $null=Invoke-EntryCli 'custom-read' @('--output','json','content','get','ct_000004')
        }
        'custom-relative' {
            Initialize 'relative-custom' @{StateDirectory='相对 状态目录'}
            Check 'explicit relative argument resolved absolutely' ($env:CONTENTOPS_STATE_DIR -eq (Join-Path $ProjectRoot '相对 状态目录'))
        }
        'path-dedup' {
            $scripts=Join-Path $ProjectRoot 'scripts'
            $env:PATH='"'+$scripts.ToLowerInvariant()+'\";'+$scripts+';'+$env:PATH
            Initialize 'path-dedup'
            Check 'normalized duplicate entries removed' (@($env:PATH -split ';'|Where-Object {$_.Trim('"').TrimEnd('\','/') -ieq $scripts}).Count -eq 1)
            Check 'other original PATH contents preserved' ($env:PATH.EndsWith($originalPath,[StringComparison]::Ordinal))
        }
        'file-state' {
            $file=Join-Path $WorkRoot 'directory-is-a-file.txt';[IO.File]::WriteAllText($file,'test fixture')
            FailedSetup 'state-is-file' @{StateDirectory=$file}
            Check 'existing non-state file preserved' ([IO.File]::ReadAllText($file) -ceq 'test fixture')
        }
        'no-java' {
            $env:PATH=Join-Path $env:WINDIR 'System32';FailedSetup 'no-java'
            $text=Invoke-EntryCli 'launcher-no-java' @('--output','json','content','get','ct_000004') 2 $false $launcher
            Check 'launcher missing Java stdout empty' ($text -eq '')
        }
        'broken-java' {
            $env:PATH=$JavaFixtureDirectory;FailedSetup 'broken-java'
        }
        'old-java' {
            $env:PATH=$JavaFixtureDirectory;FailedSetup 'old-java'
            Check 'unsupported version friendly' ([IO.File]::ReadAllText((Join-Path $EvidenceDirectory 'old-java.stderr.txt')).Contains('JDK 21'))
        }
        'no-jar' {
            FailedSetup 'missing-jar'
            $text=Invoke-EntryCli 'launcher-no-jar' @('--help') 2 $false $launcher
            Check 'launcher missing JAR stdout empty' ($text -eq '')
            Check 'build or complete extraction advice' ([IO.File]::ReadAllText((Join-Path $EvidenceDirectory 'missing-jar.stderr.txt')).Contains('解压完整'))
        }
        'fault' {
            $env:CONTENTOPS_MOCK_SCENARIO='tags-reject-before-write';FailedSetup 'fault-active'
            Check 'fault configuration not removed' ($env:CONTENTOPS_MOCK_SCENARIO -ceq 'tags-reject-before-write')
        }
        'empty-fault' {
            $env:CONTENTOPS_MOCK_SCENARIO='';Check 'empty variable present' (Test-Path Env:CONTENTOPS_MOCK_SCENARIO)
            FailedSetup 'fault-empty';Check 'empty fault not removed' (Test-Path Env:CONTENTOPS_MOCK_SCENARIO)
        }
        'invalid-state' {
            foreach($value in @('relative-state','F:drive-relative')){
                $env:CONTENTOPS_STATE_DIR=$value;FailedSetup ('invalid-state-'+$calls.Count)
            }
            Remove-Item Env:CONTENTOPS_STATE_DIR
            FailedSetup 'conflicting-options' @{NewState=$true;StateDirectory=(Join-Path $WorkRoot 'unused')}
        }
        'protected-state' {
            $env:CONTENTOPS_STATE_DIR=Join-Path $SourceRoot '.contentops/task2/a20c72c2-74c1-4130-af99-8d17452424b6'
            FailedSetup 'formal-task2-refused'
            FailedSetup 'seed-directory-refused' @{StateDirectory=(Join-Path $SourceRoot '内容运营后台接口数据')}
        }
        'function-conflict' {
            function global:contentops { 'WRONG ENTRY' }
            FailedSetup 'function-conflict';Check 'user function not deleted' ((Get-Command contentops).CommandType -eq 'Function')
        }
        'foreign-command' {
            $env:PATH=$JavaFixtureDirectory+';'+$env:PATH
            Initialize 'foreign-command';Check 'own entry wins over external same name' ((Get-Command contentops).Source -eq $launcher)
            $null=Invoke-EntryCli 'own-help' @('--help') 0 $false
        }
        'late-conflict' {
            $env:PATHEXT='.EXE;.CMD'
            FailedSetup 'late-conflict';Check 'conflicting executable not executed' (!(Test-Path -LiteralPath (Join-Path $WorkRoot 'foreign-executed')))
        }
        'root-and-cwd' {
            $env:CONTENTOPS_STATE_DIR=Join-Path $WorkRoot '原项目只读 状态'
            $null=Invoke-EntryCli 'root-help' @('--help') 0 $false $launcher
            Set-Location -LiteralPath $WorkRoot
            $null=Invoke-EntryCli 'root-other-cwd' @('--output','json','content','get','ct_000004') 0 $true $launcher
            Check 'current-directory Java fixture did not replace PATH Java' (Test-Path -LiteralPath (Join-Path $WorkRoot 'java.exe'))
            Check 'source-root launcher queries do not create snapshot' (!(Test-Path -LiteralPath (Join-Path $env:CONTENTOPS_STATE_DIR 'state.json')))
        }
        default { throw 'Unknown controlled test case' }
    }
    Check 'JAVA_HOME unchanged throughout' ($originalJavaHome -ceq $env:JAVA_HOME)
    Save 'result.json' @{case=$CaseName;passed=$true;checks=$checks;calls=$calls;state_directory=$env:CONTENTOPS_STATE_DIR;project_root=$ProjectRoot;state_default=$normalState}
    "PASS: $CaseName ($($checks.Count) checks)"
    exit 0
} catch {
    Save 'failure.json' @{case=$CaseName;passed=$false;checks=$checks;calls=$calls;error=$_.ToString();position=$_.InvocationInfo.PositionMessage}
    [Console]::Error.WriteLine($_.ToString())
    exit 1
}
