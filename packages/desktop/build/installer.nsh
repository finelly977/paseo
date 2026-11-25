!macro customInstall
  ; Register per-user Windows Explorer context menu entries ("Open with Paseo" / "用 Paseo 打开")
  ; Uses HKCU so per-user installs require no administrator elevation.
  StrCpy $0 "Open with Paseo"
  ${If} $LANGUAGE == 2052
    StrCpy $0 "用 Paseo 打开"
  ${EndIf}

  ; Right-click on any folder icon
  WriteRegStr HKCU "Software\Classes\Directory\shell\Paseo" "" "$0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\Paseo" "Icon" '"$INSTDIR\Paseo.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\Paseo\command" "" '"$INSTDIR\Paseo.exe" --open-project "%1"'

  ; Right-click on empty background inside any folder
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Paseo" "" "$0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Paseo" "Icon" '"$INSTDIR\Paseo.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\Paseo\command" "" '"$INSTDIR\Paseo.exe" --open-project "%V"'
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\Directory\shell\Paseo"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Paseo"
!macroend
