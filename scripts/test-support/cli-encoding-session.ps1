#requires -Version 5.1
# Test-only child session: baseline code pages are fixtures, not user workarounds.
[CmdletBinding()]
param([string]$CaseName, [string]$ProjectRoot, [string]$EvidenceDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$utf8=New-Object Text.UTF8Encoding($false)
$strictUtf8=New-Object Text.UTF8Encoding($false,$true)
$checks=New-Object 'Collections.Generic.List[string]'
$calls=New-Object 'Collections.Generic.List[object]'
$setup=Join-Path $ProjectRoot 'scripts/enable-contentops.ps1'
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class EncodingTestConsole {
    [DllImport("kernel32.dll")] public static extern uint GetConsoleCP();
    [DllImport("kernel32.dll")] public static extern uint GetConsoleOutputCP();
    [DllImport("kernel32.dll")] public static extern bool SetConsoleCP(uint value);
    [DllImport("kernel32.dll")] public static extern bool SetConsoleOutputCP(uint value);
}
'@
function Check([string]$Name,[bool]$Condition) {
    if(!$Condition){throw "CHECK FAILED: $Name"};$checks.Add($Name)
}
function Save([string]$Name,$Value) {
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory $Name),($Value|ConvertTo-Json -Depth 30),$utf8)
}
function FileHash([string]$Path) {
    $hash=[Security.Cryptography.SHA256]::Create()
    try { [BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($Path))).Replace('-','') }
    finally { $hash.Dispose() }
}
function EncodingFacts {
    @{input=[Console]::InputEncoding.CodePage;output=[Console]::OutputEncoding.CodePage;
      pipeline=$global:OutputEncoding.CodePage;pipeline_preamble=$global:OutputEncoding.GetPreamble().Length;
      native_input=[EncodingTestConsole]::GetConsoleCP();native_output=[EncodingTestConsole]::GetConsoleOutputCP()}
}
function Initialize([int]$Expected=0) {
    $savedError=[Console]::Error;$capture=New-Object IO.StringWriter
    try {
        [Console]::SetError($capture)
        $text=(& $setup -NewState 6>&1 | Out-String)
        $code=$LASTEXITCODE
    } finally { [Console]::SetError($savedError) }
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'initialize.stdout.txt'),$text,$utf8)
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'initialize.stderr.txt'),$capture.ToString(),$utf8)
    Save 'initialize.json' @{exit_code=$code;dot_sourced=$false;new_state=$true}
    Check 'initializer actual exit code' ($code -eq $Expected)
    if($Expected -ne 0){Check 'clear initialization error' ($capture.ToString().Contains('ContentOps 初始化失败'))}
    return $text
}
function Invoke-RealCli([string]$Name,[string[]]$Arguments,[int]$Expected=0) {
    $temporaryError=Join-Path $EvidenceDirectory ($Name+'.powershell-stderr.txt')
    # Capture via PowerShell's actual native decoder, not a manually selected UTF-8
    # Process reader. 5.1 redirects stderr as UTF-16; normalize explicitly for evidence.
    $previous=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        $lines=@(& contentops @Arguments 2> $temporaryError)
        $code=$LASTEXITCODE
    } finally { $ErrorActionPreference=$previous }
    $text=$lines -join "`n"
    $errorText=if((Get-Item -LiteralPath $temporaryError).Length){Get-Content -LiteralPath $temporaryError -Raw}else{''}
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory ($Name+'.stdout.txt')),$text,$utf8)
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory ($Name+'.stderr.txt')),$errorText,$utf8)
    Save ($Name+'.command.json') @{arguments=$Arguments;exit_code=$code;cwd=$PWD.Path;entry=(Get-Command contentops).Source;capture='PowerShell native decoder; evidence re-encoded UTF-8 without BOM'}
    $calls.Add(@{name=$Name;arguments=$Arguments;exit_code=$code})
    Check ($Name+' native exit') ($code -eq $Expected)
    Check ($Name+' no replacement character') (!$text.Contains([string][char]0xfffd) -and !$errorText.Contains([string][char]0xfffd))
    return $text
}
$originalInput=[Console]::InputEncoding;$originalOutput=[Console]::OutputEncoding
$originalPipeline=$global:OutputEncoding
$originalInputCP=[EncodingTestConsole]::GetConsoleCP();$originalOutputCP=[EncodingTestConsole]::GetConsoleOutputCP()
$oldPath=$env:PATH;$hadState=Test-Path Env:CONTENTOPS_STATE_DIR;$oldState=$env:CONTENTOPS_STATE_DIR
try {
    Set-Location -LiteralPath $ProjectRoot
    # Fresh mode never changes encoding before the normal initialization call.
    if($CaseName -ne 'fresh') {
        $cp=if($CaseName -eq 'cp65001'){65001}else{936}
        [Console]::InputEncoding=[Text.Encoding]::GetEncoding($cp)
        [Console]::OutputEncoding=[Text.Encoding]::GetEncoding($cp)
        $global:OutputEncoding=[Text.Encoding]::ASCII
        Check 'baseline native input available' ([EncodingTestConsole]::SetConsoleCP($cp))
        $outputCP=if($CaseName -eq 'rollback-mixed'){65001}else{$cp}
        Check 'baseline native output available' ([EncodingTestConsole]::SetConsoleOutputCP($outputCP))
    }
    $before=EncodingFacts;Save 'encoding.before.json' $before
    $beforePath=$env:PATH;$beforeState=$env:CONTENTOPS_STATE_DIR;$beforeHadState=Test-Path Env:CONTENTOPS_STATE_DIR
    if($CaseName.StartsWith('rollback') -or $CaseName -eq 'encoding-refused') {
        # The copied fixture contains a real .EXE before .CMD, discovered only
        # after encoding + PATH changes. It must never be executed.
        if($CaseName -eq 'encoding-refused') {
            Set-Variable -Name OutputEncoding -Scope Global -Option ReadOnly
        } else { $env:PATHEXT='.EXE;.CMD' }
        $null=Initialize 2
        $after=EncodingFacts;Save 'encoding.after.json' $after
        foreach($key in $before.Keys){Check ('rollback '+$key) ($before[$key] -eq $after[$key])}
        Check 'rollback PATH' ($beforePath -ceq $env:PATH)
        Check 'rollback state' ($beforeState -ceq $env:CONTENTOPS_STATE_DIR -and $beforeHadState -eq (Test-Path Env:CONTENTOPS_STATE_DIR))
        $diagnostic=[IO.File]::ReadAllText((Join-Path $EvidenceDirectory 'initialize.stderr.txt'),$utf8)
        if($CaseName -eq 'encoding-refused') {
            Check 'encoding application error is explicit' ($diagnostic.Contains('UTF-8 初始化失败'))
            Check 'failed initialization never claims ready' (![IO.File]::ReadAllText((Join-Path $EvidenceDirectory 'initialize.stdout.txt'),$utf8).Contains('已准备就绪'))
        } else { Check 'failure is post-encoding entry conflict' ($diagnostic.Contains('同名 contentops 入口')) }
        Check 'rollback completed without secondary errors' (!$diagnostic.Contains('环境恢复未完成'))
    } else {
        $notice=Initialize
        $after=EncodingFacts;Save 'encoding.after.json' $after
        foreach($key in @('input','output','pipeline')){Check ($key+' UTF-8 persists after script returns') ($after[$key] -eq 65001)}
        Check 'pipeline no BOM' ($after.pipeline_preamble -eq 0)
        if($after.native_input -ne 0){
            Check 'native input 65001' ($after.native_input -eq 65001)
            Check 'native output 65001' ($after.native_output -eq 65001)
            $chcp=(& "$env:WINDIR/System32/chcp.com" | Out-String)
            $chcpCode=$LASTEXITCODE;Save 'chcp.json' @{exit_code=$chcpCode;text=$chcp}
            Check 'chcp independently confirms 65001' ($chcpCode -eq 0 -and $chcp.Contains('65001'))
        }
        Check 'success notice encoding' ($notice.Contains('UTF-8 (65001)'))
        Check 'new independent state directory' ($env:CONTENTOPS_STATE_DIR.StartsWith((Join-Path $ProjectRoot '.contentops/reviewer-'),[StringComparison]::OrdinalIgnoreCase))
        $stateFile=Join-Path $env:CONTENTOPS_STATE_DIR 'state.json'
        $seed=Get-Content -LiteralPath (Join-Path $ProjectRoot '内容运营后台接口数据/mock_data.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $sample=@($seed.contents|Where-Object {$_.content_id -eq 'ct_000004'})[0]
        $text=Invoke-RealCli '01-list' @('content','list','--review-status','pending','--page','1')
        Check 'list Chinese heading/page/title' ($text.Contains('环境: mock | 命令: content.list | 模式: read') -and $text.Contains('第 1 页 | 每页 20 条 | 匹配 132 条') -and $text.Contains($sample.title))
        $text=Invoke-RealCli '02-get' @('content','get','ct_000004')
        Check 'detail exact Chinese title/body/tags' ($text.Contains($sample.title) -and $text.Contains($sample.body) -and $text.Contains('恋爱、校园、武侠') -and $text.Contains('正文:'))
        $text=Invoke-RealCli '03-history' @('content','history','ct_000004')
        Check 'history Chinese fields' ($text.Contains('内容: ct_000004 | 历史 0 条') -and $text.Contains('时间') -and $text.Contains('暂无历史记录'))
        $text=Invoke-RealCli '04-tags' @('tags','list')
        Check 'tags Chinese labels' ($text.Contains('标签 23 个') -and $text.Contains('悬疑') -and $text.Contains('分组'))
        $reason='编码回归 · 中文 English 空格 (A) !'
        $text=Invoke-RealCli '05-review-preview' @('content','review','ct_000004','--action','approve','--reason',$reason)
        Check 'review Chinese preview and argument' ($text.Contains('审核计划: pending -> approved') -and $text.Contains($reason) -and $text.Contains('previewed / 0'))
        $text=Invoke-RealCli '06-tags-preview' @('content','tags','update','ct_000004','--add','悬疑')
        Check 'tags preview retains other Chinese tags' ($text.Contains('标签 after: 恋爱、校园、武侠、悬疑') -and $text.Contains('previewed / 0'))
        $text=Invoke-RealCli '07-process-preview' @('content','process','ct_000004','--action','approve','--reason',$reason,'--add','悬疑')
        Check 'process Chinese preview' ($text.Contains($reason) -and $text.Contains('标签 after: 恋爱、校园、武侠、悬疑') -and $text.Contains('previewed / 0'))
        Check 'all seven commands and previews zero writes' (!(Test-Path -LiteralPath $stateFile))
        $text=Invoke-RealCli '08-json' @('--output','json','content','get','ct_000004')
        $json=$text|ConvertFrom-Json
        Check 'JSON exact Chinese fields' ($json.data.title -ceq $sample.title -and $json.data.body -ceq $sample.body -and ($json.data.tags -join '|') -ceq '恋爱|校园|武侠')
        Check 'JSON only envelope and actual exit' ($text.Trim().StartsWith('{') -and $text.Trim().EndsWith('}') -and $json.exit_code -eq 0 -and !$text.Contains('已准备就绪'))
        # Independently capture the actual JAR bytes. PowerShell 5.1 file
        # redirection has its own UTF-16 default and is not a JAR BOM test.
        $start=New-Object Diagnostics.ProcessStartInfo
        $start.FileName=$env:ComSpec
        $entry=(Get-Command contentops).Source
        $start.Arguments='/d /s /c ""'+$entry+'" --output json content get ct_000004"'
        $start.UseShellExecute=$false;$start.CreateNoWindow=$true
        $start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
        $process=[Diagnostics.Process]::Start($start)
        try {
            $memory=New-Object IO.MemoryStream
            $copy=$process.StandardOutput.BaseStream.CopyToAsync($memory)
            $err=$process.StandardError.ReadToEndAsync()
            if(!$process.WaitForExit(30000)){$process.Kill();throw 'Raw JSON process timeout'}
            $null=$copy.GetAwaiter().GetResult();$bytes=$memory.ToArray();$rawExit=$process.ExitCode
            [IO.File]::WriteAllBytes((Join-Path $EvidenceDirectory '09-raw-json.stdout.bin'),$bytes)
            [IO.File]::WriteAllText((Join-Path $EvidenceDirectory '09-raw-json.stderr.txt'),$err.GetAwaiter().GetResult(),$utf8)
            $raw=$strictUtf8.GetString($bytes);$rawJson=$raw|ConvertFrom-Json
            Check 'raw JSON UTF-8 first byte no BOM' ($bytes.Length -gt 0 -and $bytes[0] -eq 123)
            Check 'raw JSON exit and Chinese exact' ($rawExit -eq 0 -and $rawJson.exit_code -eq $rawExit -and $rawJson.data.title -ceq $sample.title -and $rawJson.data.body -ceq $sample.body)
            Save '09-raw-json.command.json' @{arguments=$start.Arguments;exit_code=$rawExit;strict_utf8=$true;has_bom=$false}
        } finally { $process.Dispose() }
        $text=Invoke-RealCli '10-execute' @('--output','json','content','process','ct_000004','--action','approve','--reason',$reason,'--add','悬疑','--execute','--yes')
        $result=$text|ConvertFrom-Json
        Check 'explicit execution verified as before' ($result.status -eq 'succeeded' -and $result.data.steps.review.verification -eq 'matched' -and $result.data.steps.tags.verification -eq 'matched')
        $stateHash=FileHash $stateFile
        $text=Invoke-RealCli '11-after-get' @('--output','json','content','get','ct_000004');$result=$text|ConvertFrom-Json
        Check 'new JVM actual stored Chinese tags' ($result.data.review_status -eq 'approved' -and ($result.data.tags -join '|') -ceq '恋爱|校园|武侠|悬疑')
        $text=Invoke-RealCli '12-after-history' @('content','history','ct_000004')
        Check 'Chinese history reason after execution' ($text.Contains('历史 1 条') -and $text.Contains($reason))
        Check 'post-execution queries preserve bytes' ($stateHash -eq (FileHash $stateFile))
    }
    Save 'result.json' @{passed=$true;case=$CaseName;powershell=$PSVersionTable.PSVersion.ToString();checks=$checks;calls=$calls;encoding_before=$before;encoding_after=$after;state_directory=$env:CONTENTOPS_STATE_DIR}
    "PASS: encoding $CaseName ($($checks.Count) checks)"
    exit 0
} catch {
    Save 'failure.json' @{passed=$false;case=$CaseName;checks=$checks;calls=$calls;error=$_.ToString();position=$_.InvocationInfo.PositionMessage}
    [Console]::Error.WriteLine($_.ToString());exit 1
} finally {
    [Console]::InputEncoding=$originalInput;[Console]::OutputEncoding=$originalOutput
    Set-Variable -Name OutputEncoding -Scope Global -Value $originalPipeline -Option None -Force
    if($originalInputCP){[void][EncodingTestConsole]::SetConsoleCP($originalInputCP)}
    if($originalOutputCP){[void][EncodingTestConsole]::SetConsoleOutputCP($originalOutputCP)}
    $env:PATH=$oldPath
    if($hadState){$env:CONTENTOPS_STATE_DIR=$oldState}else{Remove-Item Env:CONTENTOPS_STATE_DIR -ErrorAction SilentlyContinue}
}
