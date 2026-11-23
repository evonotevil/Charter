// Windows 经典 Outlook 日历同步。macOS 使用 native/calendar.m 中的 EventKit。
const WIN_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$in = Get-Content -Raw -Encoding UTF8 -LiteralPath $args[0] | ConvertFrom-Json
function Out($o) { $o | ConvertTo-Json -Compress -Depth 4 }
try { $ol = New-Object -ComObject Outlook.Application } catch { Out @{ error = 'noOutlook' }; exit }
try {
  $ns = $ol.GetNamespace('MAPI')
  $root = $ns.GetDefaultFolder(9)
  if ($in.checkOnly) { Out @{ ok = $true }; exit }
  $cal = $null
  foreach ($f in $root.Folders) {
    if ($in.clearOnly) { if ($in.calendarId -and $f.EntryID -eq $in.calendarId) { $cal = $f } }
    elseif ($f.Name -eq $in.name) { $cal = $f }
  }
  if ($in.clearOnly -and -not $cal) { Out @{ ok = $true; calendarId = $in.calendarId; added = 0; updated = 0; removed = 0 }; exit }
  if (-not $cal) { $cal = $root.Folders.Add($in.name, 9) }
  $existing = @{}
  foreach ($it in @($cal.Items)) { $p = $it.UserProperties.Find('CharterKey'); if ($p) { $existing[[string]$p.Value] = $it } }
  $added = 0; $updated = 0; $removed = 0
  foreach ($e in $in.events) {
    $start = [datetime]::ParseExact($e.date, 'yyyy-MM-dd', $null)
    $it = $existing[$e.key]
    if ($it) {
      $existing.Remove($e.key)
      if ($it.Subject -eq $e.title -and $it.Start.Date -eq $start -and $it.Body -eq $e.notes -and -not $it.ReminderSet) { $it = $null }
      else { $updated++ }
    } else {
      $it = $cal.Items.Add(1)
      $up = $it.UserProperties.Add('CharterKey', 1); $up.Value = $e.key
      $added++
    }
    if ($null -ne $it) {
      $it.Subject = $e.title; $it.Body = $e.notes; $it.AllDayEvent = $true
      $it.Start = $start; $it.End = $start.AddDays(1); $it.ReminderSet = $false; $it.BusyStatus = 0
      $it.Save()
    }
    foreach ($raw in @($e.reminders)) {
      $alarm = [datetime]::ParseExact([string]$raw, 'yyyy-MM-ddTHH:mm', [Globalization.CultureInfo]::InvariantCulture)
      $rk = "$($e.key)|reminder|$raw"
      $rit = $existing[$rk]
      if ($rit) {
        $existing.Remove($rk)
        if ($rit.Subject -eq "提醒：$($e.title)" -and $rit.Start -eq $alarm -and $rit.Body -eq $e.notes -and $rit.ReminderSet -and $rit.ReminderMinutesBeforeStart -eq 0) { continue }
        $updated++
      } else {
        $rit = $cal.Items.Add(1)
        $rup = $rit.UserProperties.Add('CharterKey', 1); $rup.Value = $rk
        $added++
      }
      $rit.Subject = "提醒：$($e.title)"; $rit.Body = $e.notes; $rit.AllDayEvent = $false
      $rit.Start = $alarm; $rit.End = $alarm.AddMinutes(15); $rit.ReminderSet = $true; $rit.ReminderMinutesBeforeStart = 0; $rit.BusyStatus = 0
      $rit.Save()
    }
  }
  foreach ($k in @($existing.Keys)) { $existing[$k].Delete(); $removed++ }
  Out @{ ok = $true; calendarId = $cal.EntryID; added = $added; updated = $updated; removed = $removed }
} catch { Out @{ error = 'outlook'; message = $_.Exception.Message } }
`;

module.exports = { WIN_SCRIPT };
