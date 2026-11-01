# Test-only: parent supplies a PATH containing only the real JDK bin and System32.
[CmdletBinding()]
param([string]$ProjectRoot,[string]$SourceRoot,[string]$WorkRoot,[string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
if(Get-Command mvn,mvn.cmd -CommandType Application -ErrorAction SilentlyContinue){throw 'Maven unexpectedly available in the runtime test'}
Write-Output 'Verified: Maven is absent from this runtime PATH.'
& (Join-Path $SourceRoot 'scripts/test-support/cli-entry-session.ps1') -CaseName custom -ProjectRoot $ProjectRoot -SourceRoot $SourceRoot -WorkRoot $WorkRoot -EvidenceDirectory $EvidenceDirectory
exit $LASTEXITCODE
