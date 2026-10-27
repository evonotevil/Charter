// 5.4：把申报事项和证件到期同步到系统日历。
// Mac：EventKit（经 JXA 调用，第一次会弹出“Charter 想访问你的日历”）；Windows：桌面版 Outlook（COM）。
// 只动名为“Charter”（可在设置里改名）的那一本日历；每个事件用 URL / 自定义属性记下 Charter 的键，
// 再次同步时按键新增、修改、删除，不会重复，也不会碰其他日历里的事件。
// 输入：JSON 文件 { name, calendarId?, checkOnly?, events: [{ key, title, date: "YYYY-MM-DD", notes }] }
// 输出（stdout）：JSON { ok, calendarId, added, updated, removed } 或 { error: "denied" | "noOutlook" | ... , message? }

const MAC_SCRIPT = String.raw`
ObjC.import('Foundation'); ObjC.import('EventKit');
function out(o) { return JSON.stringify(o); }
function run(argv) {
  var raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null);
  var input = JSON.parse(ObjC.unwrap(raw));
  var store = $.EKEventStore.alloc.init;
  var status = Number($.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent));
  // 0 未决定 1 受限 2 拒绝 3 完全访问（旧系统为“已授权”） 4 仅写入
  if (status === 0) {
    var state = { done: false, ok: false };
    var cb = function (granted, err) { state.ok = !!granted; state.done = true; };
    if (store.respondsToSelector('requestFullAccessToEventsWithCompletion:')) store.requestFullAccessToEventsWithCompletion(cb);
    else store.requestAccessToEntityTypeCompletion($.EKEntityTypeEvent, cb);
    var until = $.NSDate.dateWithTimeIntervalSinceNow(120);
    while (!state.done && $.NSDate.date.compare(until) < 0) $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.2));
    if (!state.ok) return out({ error: 'denied' });
    store = $.EKEventStore.alloc.init;
  } else if (status === 1 || status === 2) return out({ error: 'denied' });
  else if (status === 4) return out({ error: 'writeOnly' });
  if (input.checkOnly) return out({ ok: true });

  var cals = store.calendarsForEntityType($.EKEntityTypeEvent), cal = null, i;
  for (i = 0; i < cals.count; i++) { var c = cals.objectAtIndex(i); if (input.calendarId && ObjC.unwrap(c.calendarIdentifier) === input.calendarId) cal = c; }
  if (!cal) for (i = 0; i < cals.count; i++) { var c2 = cals.objectAtIndex(i); if (ObjC.unwrap(c2.title) === input.name && c2.allowsContentModifications) { cal = c2; break; } }
  if (!cal) {
    cal = $.EKCalendar.calendarForEntityTypeEventStore($.EKEntityTypeEvent, store);
    cal.title = input.name;
    var def = store.defaultCalendarForNewEvents, src = (def && !def.isNil()) ? def.source : null;
    if (!src || src.isNil()) { var ss = store.sources; for (i = 0; i < ss.count; i++) { if (Number(ss.objectAtIndex(i).sourceType) === 0) { src = ss.objectAtIndex(i); break; } } }
    if (!src || src.isNil()) return out({ error: 'noSource' });
    cal.source = src;
    var e1 = Ref();
    if (!store.saveCalendarCommitError(cal, true, e1)) return out({ error: 'createCalendar', message: e1[0] && !e1[0].isNil() ? ObjC.unwrap(e1[0].localizedDescription) : '' });
  }

  var greg = $.NSCalendar.currentCalendar;
  function day(s) { var p = s.split('-'); var dc = $.NSDateComponents.alloc.init; dc.year = +p[0]; dc.month = +p[1]; dc.day = +p[2]; dc.hour = 0; return greg.dateFromComponents(dc); }
  function ymd(d) { var f = $.NSDateFormatter.alloc.init; f.dateFormat = 'yyyy-MM-dd'; return ObjC.unwrap(f.stringFromDate(d)); }
  var start = $.NSDate.dateWithTimeIntervalSinceNow(-86400 * 800), end = $.NSDate.dateWithTimeIntervalSinceNow(86400 * 1500);
  var found = store.eventsMatchingPredicate(store.predicateForEventsWithStartDateEndDateCalendars(start, end, $([cal])));
  var existing = {};
  for (i = 0; i < found.count; i++) {
    var ev = found.objectAtIndex(i), u = ev.URL;
    var k = (u && !u.isNil()) ? ObjC.unwrap(u.absoluteString) : '';
    if (k.indexOf('charter://item/') === 0) existing[decodeURIComponent(k.slice(15))] = ev;
  }
  var added = 0, updated = 0, removed = 0, err = Ref();
  input.events.forEach(function (e) {
    var ev = existing[e.key];
    if (ev) {
      delete existing[e.key];
      if (ObjC.unwrap(ev.title) === e.title && ymd(ev.startDate) === e.date && (ObjC.unwrap(ev.notes) || '') === e.notes) return;
      updated++;
    } else { ev = $.EKEvent.eventWithEventStore(store); ev.calendar = cal; ev.URL = $.NSURL.URLWithString('charter://item/' + encodeURIComponent(e.key)); added++; }
    ev.title = e.title; ev.notes = e.notes; ev.allDay = true;
    var d = day(e.date); ev.startDate = d; ev.endDate = d;
    store.saveEventSpanCommitError(ev, 0, false, err);
  });
  Object.keys(existing).forEach(function (k) { store.removeEventSpanCommitError(existing[k], 0, false, err); removed++; });
  if (!store.commit(err)) return out({ error: 'commit', message: err[0] && !err[0].isNil() ? ObjC.unwrap(err[0].localizedDescription) : '' });
  return out({ ok: true, calendarId: ObjC.unwrap(cal.calendarIdentifier), added: added, updated: updated, removed: removed });
}`;

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
  foreach ($f in $root.Folders) { if ($f.Name -eq $in.name) { $cal = $f } }
  if (-not $cal) { $cal = $root.Folders.Add($in.name, 9) }
  $existing = @{}
  foreach ($it in @($cal.Items)) { $p = $it.UserProperties.Find('CharterKey'); if ($p) { $existing[[string]$p.Value] = $it } }
  $added = 0; $updated = 0; $removed = 0
  foreach ($e in $in.events) {
    $start = [datetime]::ParseExact($e.date, 'yyyy-MM-dd', $null)
    $it = $existing[$e.key]
    if ($it) {
      $existing.Remove($e.key)
      if ($it.Subject -eq $e.title -and $it.Start.Date -eq $start -and $it.Body -eq $e.notes) { continue }
      $updated++
    } else {
      $it = $cal.Items.Add(1)
      $up = $it.UserProperties.Add('CharterKey', 1); $up.Value = $e.key
      $added++
    }
    $it.Subject = $e.title; $it.Body = $e.notes; $it.AllDayEvent = $true
    $it.Start = $start; $it.End = $start.AddDays(1); $it.ReminderSet = $false; $it.BusyStatus = 0
    $it.Save()
  }
  foreach ($k in @($existing.Keys)) { $existing[$k].Delete(); $removed++ }
  Out @{ ok = $true; calendarId = $cal.EntryID; added = $added; updated = $updated; removed = $removed }
} catch { Out @{ error = 'outlook'; message = $_.Exception.Message } }
`;

module.exports = { MAC_SCRIPT, WIN_SCRIPT };
