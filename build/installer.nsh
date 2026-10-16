; NingMeng123 — keep the application in its own directory.
!ifndef CAMPUS_LINK_INSTALLER_INCLUDED
!define CAMPUS_LINK_INSTALLER_INCLUDED

!ifndef BUILD_UNINSTALLER
; A stack-only helper, also executed by the native installer-path test harness.
; Return an empty string and set Errors for incomplete or unsafe path syntax.
Function CampusLinkNormalizeInstallPath
  Exch $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  ClearErrors

  StrCpy $1 ""
  StrCpy $2 0
  campus_path_character:
    StrCpy $3 $0 1 $2
    StrCmp $3 "" campus_path_prefix
    StrCmp $3 "/" 0 +2
      StrCpy $3 "\"
    StrCmp $3 '"' campus_path_invalid
    StrCmp $3 "<" campus_path_invalid
    StrCmp $3 ">" campus_path_invalid
    StrCmp $3 "|" campus_path_invalid
    StrCmp $3 "?" campus_path_invalid
    StrCmp $3 "*" campus_path_invalid
    StrCmp $3 "$\r" campus_path_invalid
    StrCmp $3 "$\n" campus_path_invalid
    StrCmp $3 "$\t" campus_path_invalid
    StrCmp $3 ":" 0 campus_path_add_character
      IntCmp $2 1 campus_path_add_character campus_path_invalid campus_path_invalid
    campus_path_add_character:
      StrCpy $1 "$1$3"
      IntOp $2 $2 + 1
      Goto campus_path_character

  campus_path_prefix:
    StrCpy $0 $1
    StrCpy $3 $0 2
    StrCmp $3 "\\" campus_path_unc
    StrCpy $3 $0 2 1
    StrCmp $3 ":\" 0 campus_path_invalid
    StrCpy $3 $0 1
    StrCpy $2 0
    campus_path_drive_letter:
      StrCpy $4 "ABCDEFGHIJKLMNOPQRSTUVWXYZ" 1 $2
      StrCmp $4 "" campus_path_invalid
      StrCmp $3 $4 campus_path_trim
      IntOp $2 $2 + 1
      Goto campus_path_drive_letter

  campus_path_unc:
    ; A UNC path needs both a server and a share, even when they do not exist yet.
    StrCpy $2 2
    StrCpy $4 ""
    campus_path_server:
      StrCpy $3 $0 1 $2
      StrCmp $3 "" campus_path_invalid
      StrCmp $3 "\" campus_path_share_start
      StrCpy $4 "$4$3"
      IntOp $2 $2 + 1
      Goto campus_path_server
    campus_path_share_start:
      StrCmp $4 "" campus_path_invalid
      StrCmp $4 "." campus_path_invalid
      StrCmp $4 ".." campus_path_invalid
      StrCpy $4 ""
      IntOp $2 $2 + 1
    campus_path_share:
      StrCpy $3 $0 1 $2
      StrCmp $3 "" campus_path_share_end
      StrCmp $3 "\" campus_path_share_end
      StrCpy $4 "$4$3"
      IntOp $2 $2 + 1
      Goto campus_path_share
    campus_path_share_end:
      StrCmp $4 "" campus_path_invalid
      StrCmp $4 "." campus_path_invalid
      StrCmp $4 ".." campus_path_invalid

  campus_path_trim:
    StrCpy $3 $0 1 -1
    StrCmp $3 "\" 0 campus_path_basename_start
    StrCpy $0 $0 -1
    Goto campus_path_trim
  campus_path_basename_start:
    StrLen $2 $0
  campus_path_basename:
    IntOp $2 $2 - 1
    IntCmp $2 0 0 campus_path_basename_found
    StrCpy $3 $0 1 $2
    StrCmp $3 "\" campus_path_basename_found
    Goto campus_path_basename
  campus_path_basename_found:
    IntOp $2 $2 + 1
    StrCpy $3 $0 "" $2
    ; StrCmp is case-insensitive, matching Windows directory names.
    StrCmp $3 "${APP_FILENAME}" campus_path_done
    StrLen $4 "\${APP_FILENAME}"
    StrLen $5 $0
    IntOp $4 $4 + $5
    IntCmp $4 ${NSIS_MAX_STRLEN} campus_path_invalid campus_path_append campus_path_invalid
  campus_path_append:
    StrCpy $0 "$0\${APP_FILENAME}"
    Goto campus_path_done
  campus_path_invalid:
    StrCpy $0 ""
    SetErrors
  campus_path_done:
    Pop $5
    Pop $4
    Pop $3
    Pop $2
    Pop $1
    Exch $0
FunctionEnd

!ifndef CAMPUS_LINK_PATH_HELPER_ONLY
; NSIS uses the final InstallDir component as the native Browse suffix.
; electron-builder's runtime initialization still restores existing installs.
InstallDir "$LOCALAPPDATA\Programs\${APP_FILENAME}"
!include "MUI2.nsh"

; Add the hook at the directory declaration itself: a global SHOW/LEAVE define
; would otherwise be consumed by electron-builder's earlier install-mode page.
!macroundef MUI_PAGE_DIRECTORY
!macro MUI_PAGE_DIRECTORY
  !verbose push
  !verbose ${MUI_VERBOSE}
  !insertmacro MUI_PAGE_INIT
  !define MUI_DIRECTORYPAGE_VERIFYONLEAVE
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE CampusLinkDirectoryLeave
  !insertmacro MUI_PAGEDECLARATION_DIRECTORY
  !verbose pop

  Function CampusLinkDirectoryLeave
    Push $0
    Push $1
    ${NSD_GetText} $mui.DirectoryPage.Directory $0
    Push $0
    Call CampusLinkNormalizeInstallPath
    Pop $1
    StrCmp $1 "" campus_directory_invalid
    StrCpy $INSTDIR $1
    ; Native NSIS reads the edit control again after this leave callback.
    ; Updating only $INSTDIR here would be overwritten by the original input.
    SendMessage $mui.DirectoryPage.Directory ${WM_SETTEXT} 0 "STR:$1"
    GetInstDirError $0
    StrCmp $0 0 campus_directory_valid
    campus_directory_invalid:
      Pop $1
      Pop $0
      Abort
    campus_directory_valid:
      Pop $1
      Pop $0
  FunctionEnd
!macroend
!endif
!endif
!endif
