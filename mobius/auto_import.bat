@echo off
set "MYSQL_PATH=%ProgramFiles%\MySQL\MySQL Server 8.0\bin\mysql.exe"

if exist "%MYSQL_PATH%" (
    echo Found MySQL 8.0
    "%MYSQL_PATH%" -u root -pdksdlfduq2 -e "CREATE DATABASE IF NOT EXISTS mobiusdb;"
    "%MYSQL_PATH%" -u root -pdksdlfduq2 mobiusdb < mobiusdb.sql
    echo Import finished.
    exit /b 0
)

set "MYSQL_PATH=%ProgramFiles%\MySQL\MySQL Server 5.7\bin\mysql.exe"
if exist "%MYSQL_PATH%" (
    echo Found MySQL 5.7
    "%MYSQL_PATH%" -u root -pdksdlfduq2 -e "CREATE DATABASE IF NOT EXISTS mobiusdb;"
    "%MYSQL_PATH%" -u root -pdksdlfduq2 mobiusdb < mobiusdb.sql
    echo Import finished.
    exit /b 0
)

echo MySQL not found in standard paths.
exit /b 1
