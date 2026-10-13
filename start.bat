@echo off
setlocal
title Scent Atlas
cd /d "%~dp0app"

rem ---- find Python 3 (python.exe, else the py launcher)
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY ( where py >nul 2>nul && set "PY=py -3" )
if not defined PY (
  echo Python 3 was not found on PATH. Install it from https://www.python.org/downloads/ and run this again.
  pause
  exit /b 1
)

rem ---- first run: install dependencies
%PY% -c "import fastapi, uvicorn, numpy, sqlalchemy, argon2" >nul 2>nul
if errorlevel 1 (
  echo First run: installing requirements...
  %PY% -m pip install --disable-pip-version-check -r ..\requirements.txt
  if errorlevel 1 (
    echo Could not install the requirements. See the messages above.
    pause
    exit /b 1
  )
)

rem ---- stand-in data when neither the real master.db nor the deploy artifact exists
if not exist "..\data\master.db" if not exist "..\data\deploy\catalog.db.gz" if not exist "fixture.db" %PY% make_fixture.py

echo.
echo Scent Atlas is starting at http://127.0.0.1:8765  (close this window to stop it)
echo Accounts and favorites are stored in data\users.db.
echo.
%PY% server.py --open
if errorlevel 1 pause
endlocal
