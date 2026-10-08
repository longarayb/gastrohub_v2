; Installer of the print agent (Inno Setup 6), built by scripts/package.mjs:
;   ISCC /DBrandName=... /DAppVersion=... /DReleaseDir=... print-agent.iss
; Installs the agent as a Windows service that starts with Windows and opens the local page
; (http://127.0.0.1:9180) to pair the computer. No inbound firewall rule: the agent only makes
; outbound connections and its page listens on 127.0.0.1.

#ifndef BrandName
  #error Informe /DBrandName
#endif
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef ReleaseDir
  #define ReleaseDir "..\release"
#endif

[Setup]
AppId={{7B0E4C1A-6A35-4F47-9C55-2F1D3A9E8B21}
AppName={#BrandName} · Impressão automática
AppVersion={#AppVersion}
AppPublisher={#BrandName}
DefaultDirName={autopf}\{#BrandName} Impressao
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=admin
; Windows 10 1809 or newer, 64 bits (minimum of Node.js 24).
MinVersion=10.0.17763
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#ReleaseDir}
OutputBaseFilename=instalar-impressao
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#BrandName} · Impressão automática

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
Source: "{#ReleaseDir}\print-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ReleaseDir}\PrintAgentService.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ReleaseDir}\PrintAgentService.xml"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{commonappdata}\app-print-agent"

[Run]
; Update: stop the running service before installing again (errors ignored on first install).
Filename: "{app}\PrintAgentService.exe"; Parameters: "install"; Flags: runhidden waituntilterminated
Filename: "{app}\PrintAgentService.exe"; Parameters: "start"; Flags: runhidden waituntilterminated
Filename: "http://127.0.0.1:9180"; Description: "Abrir a página para vincular este computador"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{app}\PrintAgentService.exe"; Parameters: "stop"; Flags: runhidden waituntilterminated; RunOnceId: "StopService"
Filename: "{app}\PrintAgentService.exe"; Parameters: "uninstall"; Flags: runhidden waituntilterminated; RunOnceId: "RemoveService"

[Code]
// Stops the old service before the files are replaced (updates).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  if FileExists(ExpandConstant('{app}\PrintAgentService.exe')) then
  begin
    Exec(ExpandConstant('{app}\PrintAgentService.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec(ExpandConstant('{app}\PrintAgentService.exe'), 'uninstall', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
  Result := '';
end;
