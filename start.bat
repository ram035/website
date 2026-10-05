@echo off
rem Abre el panel del sitio Gavna (solo en esta computadora).
cd /d "%~dp0"
start "" http://127.0.0.1:4410/admin/
node server.js
