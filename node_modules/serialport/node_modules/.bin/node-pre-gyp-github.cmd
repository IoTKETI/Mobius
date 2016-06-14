@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\node-pre-gyp-github\bin\node-pre-gyp-github.js" %*
) ELSE (
  @SETLOCAL
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\..\node-pre-gyp-github\bin\node-pre-gyp-github.js" %*
)