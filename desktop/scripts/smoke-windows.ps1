$ErrorActionPreference = 'Stop'
$installer = Get-Item 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/*-setup.exe'
$installDir = Join-Path $env:RUNNER_TEMP 'Charter-smoke'
$setup = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -PassThru -Wait
if ($setup.ExitCode -ne 0) { throw "Installer exited $($setup.ExitCode)" }
$exe = Join-Path $installDir 'Charter.exe'
if (!(Test-Path $exe)) { $exe = Join-Path $installDir 'charter.exe' }
if (!(Test-Path $exe)) { throw 'Installed executable missing' }
$app = Start-Process -FilePath $exe -PassThru
try {
  Start-Sleep -Seconds 15
  $app.Refresh()
  if ($app.HasExited) { throw "Application exited during startup: $($app.ExitCode)" }
  if ($app.MainWindowHandle -eq 0) { throw 'Application did not create a window' }
  $info = (Get-Item $exe).VersionInfo
  $result = @{ installerExitCode = $setup.ExitCode; running = !$app.HasExited; windowTitle = $app.MainWindowTitle; productVersion = $info.ProductVersion; executable = $exe }
  $result | ConvertTo-Json | Set-Content windows-smoke.json
  $result | ConvertTo-Json | Write-Output
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bitmap.Save((Join-Path $PWD 'windows-smoke.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
} finally {
  if (!$app.HasExited) { Stop-Process -Id $app.Id -Force }
}
