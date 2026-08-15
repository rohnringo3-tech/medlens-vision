@echo off
cd /d "%~dp0"
start "" http://localhost:7990
node server.js
