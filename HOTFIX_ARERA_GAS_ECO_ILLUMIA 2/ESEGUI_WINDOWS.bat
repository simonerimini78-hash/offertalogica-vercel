@echo off
set /p REPO=Incolla il percorso completo del repository: 
py APPLICA_FIX_ARERA_SOLO_GAS.py "%REPO%" || goto :errore
py VERIFICA_FIX_ARERA_SOLO_GAS.py "%REPO%" || goto :errore
echo.
echo HOTFIX APPLICATO E VERIFICATO.
pause
exit /b 0
:errore
echo.
echo ERRORE: nessun caricamento deve essere eseguito. Controlla il messaggio sopra.
pause
exit /b 1
