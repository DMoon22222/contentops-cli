@echo off
setlocal DisableDelayedExpansion
set "_CONTENTOPS_JAR=%~dp0..\target\contentops.jar"
if not exist "%_CONTENTOPS_JAR%" (
  >&2 echo ContentOps: executable JAR was not found at "%_CONTENTOPS_JAR%".
  >&2 echo Source checkout: run mvn -B -ntp verify. Packaged copy: check that extraction is complete.
  exit /b 2
)
set "_CONTENTOPS_JAVA="
for %%J in (java.exe) do set "_CONTENTOPS_JAVA=%%~$PATH:J"
if not defined _CONTENTOPS_JAVA (
  >&2 echo ContentOps: java.exe was not found on PATH. Install JDK 21, reopen PowerShell, and initialize again.
  exit /b 2
)
"%_CONTENTOPS_JAVA%" -Dfile.encoding=UTF-8 -jar "%_CONTENTOPS_JAR%" %*
set "_CONTENTOPS_EXIT=%ERRORLEVEL%"
exit /b %_CONTENTOPS_EXIT%
