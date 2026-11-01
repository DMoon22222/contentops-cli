#requires -Version 7.0
<# Test Windows setup and the real CMD launcher in disposable project copies. #>
[CmdletBinding()]
param([string]$EvidenceDirectory)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$project=[IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$utf8=[Text.UTF8Encoding]::new($false)
$run=[guid]::NewGuid().ToString('N')
$reviewBase=Join-Path $project 'evidence/cli-entry'
if(!$EvidenceDirectory){$EvidenceDirectory=Join-Path $reviewBase ('run-'+$run)}
$out=[IO.Path]::GetFullPath($EvidenceDirectory)
if(!$out.StartsWith($reviewBase+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Evidence must be a new child directory of evidence/cli-entry'}
if(Test-Path -LiteralPath $out){throw 'Evidence directory exists; use a new path to preserve results'}
$null=[IO.Directory]::CreateDirectory($out)
$work=Join-Path $project ('.contentops/cli-entry/'+$run)
$null=[IO.Directory]::CreateDirectory($work)
$jar=Join-Path $project 'target/contentops.jar'
if(!(Test-Path -LiteralPath $jar -PathType Leaf)){throw 'Build the JAR with mvn verify before running this developer-only test'}
$pwsh=(Get-Command pwsh.exe -CommandType Application -ErrorAction Stop).Source
$child=Join-Path $PSScriptRoot 'test-support/cli-entry-session.ps1'

function HashText([string]$Value) {
    if($null -eq $Value){return 'absent'}
    [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($Value)))
}
function PermanentFingerprint {
    $facts=[ordered]@{}
    foreach($scope in @('User','Machine')){foreach($key in @('PATH','CONTENTOPS_STATE_DIR','CONTENTOPS_MOCK_SCENARIO','JAVA_HOME')){
        $value=[Environment]::GetEnvironmentVariable($key,$scope)
        $facts["$scope/$key"]=if($null -eq $value){'absent'}else{HashText $value}
    }}
    $facts
}
function Save([string]$Name,$Value){[IO.File]::WriteAllText((Join-Path $out $Name),($Value|ConvertTo-Json -Depth 40),$utf8)}
function New-Project([string]$Name,[bool]$IncludeJar=$true){
    $root=Join-Path $work $Name
    $null=[IO.Directory]::CreateDirectory((Join-Path $root 'scripts'))
    foreach($file in @('contentops.cmd','enable-contentops.ps1')){Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination (Join-Path $root "scripts/$file")}
    if($IncludeJar){$null=[IO.Directory]::CreateDirectory((Join-Path $root 'target'));Copy-Item -LiteralPath $jar -Destination (Join-Path $root 'target/contentops.jar')}
    $root
}

$permanentBefore=PermanentFingerprint
$parentPath=$env:PATH;$parentState=$env:CONTENTOPS_STATE_DIR;$parentFault=$env:CONTENTOPS_MOCK_SCENARIO;$parentJavaHome=$env:JAVA_HOME
$normal=New-Project '面试解压项目 ContentOps CLI'
$noJar=New-Project '缺少 JAR 项目' $false
$shadow=New-Project '同名入口冲突 项目'
[IO.File]::WriteAllBytes((Join-Path $shadow 'scripts/contentops.exe'),[byte[]]@())
$broken=Join-Path $work '无法运行 Java';$null=[IO.Directory]::CreateDirectory($broken)
[IO.File]::WriteAllBytes((Join-Path $broken 'java.exe'),[byte[]]@())
$foreign=Join-Path $work '已有其他 ContentOps';$null=[IO.Directory]::CreateDirectory($foreign)
[IO.File]::WriteAllText((Join-Path $foreign 'contentops.cmd'),"@echo off`r`n>&2 echo WRONG CONTENTOPS ENTRY`r`nexit /b 91`r`n",[Text.Encoding]::ASCII)
# Test-only .NET Framework fixture reports Java 17. No JDK is installed or replaced.
$fake17=Join-Path $work '受控 Java17 版本夹具';$null=[IO.Directory]::CreateDirectory($fake17)
$cs=Join-Path $fake17 'VersionFixture.cs'
[IO.File]::WriteAllText($cs,'using System; class VersionFixture { static int Main() { Console.Error.WriteLine("openjdk version \"17.0.99\""); return 0; } }',$utf8)
$csc=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $csc /nologo /target:exe (('/out:')+(Join-Path $fake17 'java.exe')) $cs 1> (Join-Path $out 'version-fixture-compile.stdout.txt') 2> (Join-Path $out 'version-fixture-compile.stderr.txt')
$compileExit=$LASTEXITCODE
Save 'version-fixture-compile.json' @{compiler=$csc;exit_code=$compileExit;purpose='test-only controlled version string; not an installed Java runtime'}
if($compileExit -ne 0){throw 'Controlled Java-version fixture did not compile'}
Copy-Item -LiteralPath (Join-Path $fake17 'java.exe') -Destination (Join-Path $shadow 'scripts/contentops.exe')
Copy-Item -LiteralPath (Join-Path $fake17 'java.exe') -Destination (Join-Path $work 'java.exe')

$cases=@('normal','preserve','new-state','custom','custom-relative','path-dedup','file-state','no-java','broken-java','old-java','no-jar','fault','empty-fault','invalid-state','protected-state','function-conflict','foreign-command','late-conflict','root-and-cwd')
$results=[Collections.Generic.List[object]]::new()
try {
    foreach($case in $cases){
        $caseOut=Join-Path $out $case;$null=[IO.Directory]::CreateDirectory($caseOut)
        $root=switch($case){'no-jar'{$noJar};'late-conflict'{$shadow};'root-and-cwd'{$project};default{$normal}}
        $javaFixture=switch($case){'broken-java'{$broken};'old-java'{$fake17};'foreign-command'{$foreign};default{''}}
        $start=[Diagnostics.ProcessStartInfo]::new($pwsh)
        $start.WorkingDirectory=$project;$start.UseShellExecute=$false;$start.CreateNoWindow=$true
        $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
        $start.StandardOutputEncoding=$utf8;$start.StandardErrorEncoding=$utf8
        foreach($arg in @('-NoLogo','-NoProfile','-File',$child,'-CaseName',$case,'-ProjectRoot',$root,'-SourceRoot',$project,'-WorkRoot',$work,'-EvidenceDirectory',$caseOut,'-JavaFixtureDirectory',$javaFixture)){$start.ArgumentList.Add($arg)}
        foreach($key in @('CONTENTOPS_STATE_DIR','CONTENTOPS_MOCK_SCENARIO','JAVA_TOOL_OPTIONS','_JAVA_OPTIONS','JDK_JAVA_OPTIONS')){[void]$start.Environment.Remove($key)}
        Save ($case+'/session.started.json') @{arguments=@($start.ArgumentList);executable=$pwsh;at=[DateTimeOffset]::Now.ToString('o')}
        $process=[Diagnostics.Process]::Start($start)
        try {
            $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
            if(!$process.WaitForExit(60000)){$process.Kill($true);throw "Test session timed out: $case"}
            $code=$process.ExitCode
            [IO.File]::WriteAllText((Join-Path $caseOut 'session.stdout.txt'),$stdout.GetAwaiter().GetResult(),$utf8)
            [IO.File]::WriteAllText((Join-Path $caseOut 'session.stderr.txt'),$stderr.GetAwaiter().GetResult(),$utf8)
            Save ($case+'/session.finished.json') @{pid=$process.Id;exit_code=$code;at=[DateTimeOffset]::Now.ToString('o')}
            if($code -ne 0){throw "Test case failed: $case. Read its saved stdout/stderr and failure.json"}
            $result=Get-Content -LiteralPath (Join-Path $caseOut 'result.json') -Raw|ConvertFrom-Json
            $results.Add($result)
            Write-Host "PASS: $case ($($result.checks.Count) checks)"
        } finally {if(!$process.HasExited){$process.Kill($true)};$process.Dispose()}
    }
    $permanentAfter=PermanentFingerprint
    Save 'permanent-environment.json' @{before=$permanentBefore;after=$permanentAfter;unchanged=($permanentBefore|ConvertTo-Json -Compress) -ceq ($permanentAfter|ConvertTo-Json -Compress)}
    if(($permanentBefore|ConvertTo-Json -Compress) -cne ($permanentAfter|ConvertTo-Json -Compress)){throw 'Permanent environment changed during test'}
    if($parentPath -cne $env:PATH -or $parentState -cne $env:CONTENTOPS_STATE_DIR -or $parentFault -cne $env:CONTENTOPS_MOCK_SCENARIO -or $parentJavaHome -cne $env:JAVA_HOME){throw 'Parent session environment changed'}
    $summary=@{passed=$true;case_count=$results.Count;check_count=($results|ForEach-Object {$_.checks.Count}|Measure-Object -Sum).Sum;
        commands=@($results|ForEach-Object {$_.calls});results=$results;source_commit=(& git -C $project rev-parse HEAD);jar_sha256=(Get-FileHash -LiteralPath $jar -Algorithm SHA256).Hash;
        powershell=$PSVersionTable.PSVersion.ToString();copied_project=$normal;work_root=$work;permanent_environment_unchanged=$true;parent_environment_unchanged=$true}
    Save 'summary.json' $summary
    Write-Host "PASS: $($results.Count) sessions; $($summary.check_count) checks; isolated Mock only"
} catch {
    Save 'failure.json' @{passed=$false;completed_cases=$results.Count;error=$_.ToString();position=$_.InvocationInfo.PositionMessage}
    throw
}
