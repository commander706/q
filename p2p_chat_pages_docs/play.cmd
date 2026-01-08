\
@echo off
chcp 65001 >nul
title P2P Invite Chat (local)
set PORT=8000
echo Serving docs/ on http://localhost:%PORT%/ ...
pushd "%~dp0docs"
start "" cmd /k python -m http.server %PORT%
timeout /t 1 >nul
start "" "http://localhost:%PORT%/"
popd
