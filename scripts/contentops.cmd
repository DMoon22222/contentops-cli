@echo off
java -Dfile.encoding=UTF-8 -jar "%~dp0..\target\contentops.jar" %*
exit /b %ERRORLEVEL%
