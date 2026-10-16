'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function nsisString(value) {
  return `"${value.replaceAll('$', '$$').replaceAll('"', '$\\"')}"`;
}

test('native NSIS helper appends one application directory and rejects incomplete paths', { skip: process.platform !== 'win32' }, async t => {
  const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows');
  const compiler = await getMakeNsisPath();
  const compilerEnv = { ...process.env, ...compiler.env };
  const headerInfo = execFileSync(compiler.path, ['/HDRINFO'], { env: compilerEnv, encoding: 'utf8', windowsHide: true });
  const maxStringLength = Number(/NSIS_MAX_STRLEN=(\d+)/.exec(headerInfo)[1]);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-installer-path-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const executable = path.join(directory, 'path-test.exe');
  const output = path.join(directory, 'result.txt');
  const include = path.resolve(__dirname, '../../build/installer.nsh');
  const cases = [
    ['D:\\', 'D:\\Campus Link'],
    ['D:\\\\', 'D:\\Campus Link'],
    ['D:\\Applications', 'D:\\Applications\\Campus Link'],
    ['D:\\Applications\\', 'D:\\Applications\\Campus Link'],
    ['D:\\Campus Link', 'D:\\Campus Link'],
    ['D:\\Campus Link\\\\', 'D:\\Campus Link'],
    ['D:\\campus link', 'D:\\campus link'],
    ['D:\\CAMPUS LINK\\', 'D:\\CAMPUS LINK'],
    ['D:\\Campus Link backup', 'D:\\Campus Link backup\\Campus Link'],
    ['D:\\Campus Link\\extras', 'D:\\Campus Link\\extras\\Campus Link'],
    ['D:/Applications/', 'D:\\Applications\\Campus Link'],
    ['D:\\学校应用', 'D:\\学校应用\\Campus Link'],
    ['\\\\server\\share', '\\\\server\\share\\Campus Link'],
    ['\\\\server\\share\\', '\\\\server\\share\\Campus Link'],
    ['\\\\server\\share\\Campus Link\\', '\\\\server\\share\\Campus Link'],
    ['\\\\server\\share\\CAMPUS LINK', '\\\\server\\share\\CAMPUS LINK'],
    ['', null], ['D:', null], ['D:relative', null], ['relative\\folder', null],
    ['\\folder', null], ['\\\\server', null], ['\\\\server\\', null],
    ['\\\\\\server\\share', null], ['\\\\server\\\\share', null],
    ['1:\\folder', null], ['D:\\bad:name', null], ['D:\\bad?name', null],
    ['D:\\' + 'a'.repeat(maxStringLength - 9), null],
  ];
  const calls = cases.map(([input], index) => `
    StrCpy $0 "preserved-0"
    StrCpy $1 "preserved-1"
    Push ${nsisString(input)}
    Call CampusLinkNormalizeInstallPath
    Pop $8
    IfErrors invalid_${index} valid_${index}
    invalid_${index}:
      StrCpy $8 "<invalid>"
    valid_${index}:
      FileWriteUTF16LE $9 "$8|$0|$1$\\r$\\n"
  `).join('\n');
  const source = `
    Unicode true
    Name "Campus Link installer path test"
    OutFile ${nsisString(executable)}
    RequestExecutionLevel user
    SilentInstall silent
    !define APP_FILENAME "Campus Link"
    !define CAMPUS_LINK_PATH_HELPER_ONLY
    !include ${nsisString(include)}
    Function .onInit
      FileOpen $9 ${nsisString(output)} w
      ${calls}
      FileClose $9
      SetErrorLevel 0
      Quit
    FunctionEnd
    Section
    SectionEnd
  `;
  const sourcePath = path.join(directory, 'path-test.nsi');
  fs.writeFileSync(sourcePath, source, 'utf8');
  execFileSync(compiler.path, ['/V2', '/INPUTCHARSET', 'UTF8', sourcePath], { env: compilerEnv, timeout: 30000, stdio: 'pipe', windowsHide: true });
  // This executable only runs the real string helper and writes this fixture;
  // it never installs files, launches the application or touches the registry.
  execFileSync(executable, ['/S'], { timeout: 15000, stdio: 'pipe', windowsHide: true });
  const lines = fs.readFileSync(output, 'utf16le').trimEnd().split('\r\n');
  assert.equal(lines.length, cases.length);
  cases.forEach(([input, expected], index) => {
    assert.equal(lines[index], `${expected ?? '<invalid>'}|preserved-0|preserved-1`, `input: ${JSON.stringify(input)}`);
  });
});
