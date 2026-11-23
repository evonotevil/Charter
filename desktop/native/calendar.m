// EventKit runs in Charter's main process. Node's worker pool handles calendar I/O;
// the system permission sheet uses the main queue and Apple's native completion block.
#import <EventKit/EventKit.h>
#import <Foundation/Foundation.h>
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

static NSDictionary *failure(NSString *code, NSError *error) {
    return error ? @{@"error": code, @"message": error.localizedDescription} : @{@"error": code};
}

static NSString *permissionError(EKAuthorizationStatus status) {
    switch (status) {
        case EKAuthorizationStatusNotDetermined: return @"notDetermined";
        case EKAuthorizationStatusRestricted: return @"restricted";
        case EKAuthorizationStatusDenied: return @"denied";
        case EKAuthorizationStatusFullAccess: return nil; // Also the legacy authorized value.
        case EKAuthorizationStatusWriteOnly: return @"writeOnly";
        default: return @"permissionFailed";
    }
}

static NSString *permissionStatus(void) {
    return permissionError([EKEventStore authorizationStatusForEntityType:EKEntityTypeEvent]);
}

static NSDictionary *checkPermission(BOOL mayPrompt) {
    NSString *initial = permissionStatus();
    if (!initial) return @{@"ok": @YES};
    if (!mayPrompt || !([initial isEqual:@"notDetermined"] || [initial isEqual:@"writeOnly"])) {
        return failure(initial, nil);
    }

    NSString *usageKey;
    if (@available(macOS 14.0, *)) usageKey = @"NSCalendarsFullAccessUsageDescription";
    else usageKey = @"NSCalendarsUsageDescription";
    if (![[NSBundle.mainBundle objectForInfoDictionaryKey:usageKey] length]) return failure(@"permissionFailed", nil);

    dispatch_semaphore_t completed = dispatch_semaphore_create(0);
    __block NSError *requestError = nil;
    dispatch_async(dispatch_get_main_queue(), ^{
        // Retain the requesting store even if the person answers after our UI timeout.
        __block EKEventStore *store = [EKEventStore new];
        EKEventStoreRequestAccessCompletionHandler reply = ^(BOOL granted, NSError *error) {
            requestError = error;
            store = nil;
            dispatch_semaphore_signal(completed);
        };
        if (@available(macOS 14.0, *)) {
            [store requestFullAccessToEventsWithCompletion:reply];
        } else {
            [store requestAccessToEntityType:EKEntityTypeEvent completion:reply];
        }
    });
    // Some systems update the permission before delivering the callback. Observe
    // either signal off the main thread; an unanswered prompt is not a denial.
    for (int second = 0; second < 20; second++) {
        BOOL answered = dispatch_semaphore_wait(completed, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC)) == 0;
        NSString *current = permissionStatus();
        if (!current) return @{@"ok": @YES};
        if (answered) {
            if (![current isEqual:@"notDetermined"]) return failure(current, nil);
            return failure(requestError ? @"permissionFailed" : @"permissionPending", requestError);
        }
        if (![current isEqual:initial] && ![current isEqual:@"notDetermined"]) return failure(current, nil);
    }
    return failure(@"permissionPending", nil);
}

static NSDateFormatter *formatter(NSString *format, NSCalendar *calendar) {
    NSDateFormatter *f = [NSDateFormatter new];
    f.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    f.calendar = calendar;
    f.timeZone = calendar.timeZone;
    f.dateFormat = format;
    return f;
}

static NSDictionary *syncCalendar(NSDictionary *input) {
    BOOL checkOnly = [input[@"checkOnly"] boolValue];
    BOOL mayPrompt = checkOnly && ![input[@"requestAccess"] isEqual:@NO];
    NSDictionary *access = checkPermission(mayPrompt);
    if (access[@"error"] || checkOnly) return access;

    NSArray *events = input[@"events"];
    if (![events isKindOfClass:NSArray.class]) return failure(@"failed", nil);
    NSCalendar *greg = [[NSCalendar alloc] initWithCalendarIdentifier:NSCalendarIdentifierGregorian];
    greg.timeZone = NSTimeZone.localTimeZone;
    NSDateFormatter *day = formatter(@"yyyy-MM-dd", greg);
    NSDateFormatter *time = formatter(@"yyyy-MM-dd'T'HH:mm", greg);
    EKEventStore *store = [EKEventStore new];
    BOOL clear = [input[@"clearOnly"] boolValue];
    NSString *identifier = input[@"calendarId"];
    EKCalendar *calendar = identifier.length ? [store calendarWithIdentifier:identifier] : nil;
    if (clear && !calendar) return @{@"ok": @YES, @"added": @0, @"updated": @0, @"removed": @0};
    NSString *name = input[@"name"];
    if (!calendar) {
        for (EKCalendar *candidate in [store calendarsForEntityType:EKEntityTypeEvent]) {
            if ([candidate.title isEqual:name] && candidate.allowsContentModifications) {
                calendar = candidate;
                break;
            }
        }
    }
    NSError *error = nil;
    if (!calendar) {
        EKSource *source = store.defaultCalendarForNewEvents.source;
        if (!source) {
            for (NSNumber *kind in @[@(EKSourceTypeCalDAV), @(EKSourceTypeLocal)]) {
                for (EKSource *candidate in store.sources) {
                    if (candidate.sourceType == kind.integerValue) { source = candidate; break; }
                }
                if (source) break;
            }
        }
        if (!source) return failure(@"noSource", nil);
        calendar = [EKCalendar calendarForEntityType:EKEntityTypeEvent eventStore:store];
        calendar.title = name;
        calendar.source = source;
        if (![store saveCalendar:calendar commit:YES error:&error]) return failure(@"createCalendar", error);
    }

    NSString *prefix = @"charter://item/";
    NSMutableDictionary<NSString *, EKEvent *> *existing = [NSMutableDictionary new];
    NSArray *chunks = input[@"chunks"];
    if (!chunks.count) chunks = @[@[@-800, @295], @[@295, @450]];
    NSDate *now = NSDate.date;
    for (NSArray *range in chunks) {
        NSDate *from = [greg dateByAddingUnit:NSCalendarUnitDay value:[range[0] integerValue] toDate:now options:0];
        NSDate *to = [greg dateByAddingUnit:NSCalendarUnitDay value:[range[1] integerValue] toDate:now options:0];
        NSPredicate *match = [store predicateForEventsWithStartDate:from endDate:to calendars:@[calendar]];
        for (EKEvent *event in [store eventsMatchingPredicate:match]) {
            NSString *url = event.URL.absoluteString;
            if (![url hasPrefix:prefix]) continue;
            NSString *key = [[url substringFromIndex:prefix.length] stringByRemovingPercentEncoding];
            if (key) existing[key] = event;
        }
    }

    NSInteger added = 0, updated = 0, removed = 0;
    NSCharacterSet *keyChars = [NSCharacterSet characterSetWithCharactersInString:
        @"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()"];
    for (NSDictionary *item in events) {
        NSString *key = item[@"key"];
        NSDate *start = [day dateFromString:item[@"date"]];
        if (!start) return failure(@"commit", nil);
        NSDate *end = [greg dateByAddingUnit:NSCalendarUnitDay value:1 toDate:start options:0];
        // TN3130: Ventura and later include the end date of an all-day event.
        // Midnight on the following day would make a one-day deadline span two days.
        if (@available(macOS 13.0, *)) end = [end dateByAddingTimeInterval:-1];
        EKEvent *event = existing[key];
        NSArray<NSString *> *reminders = item[@"reminders"] ?: @[];
        if (event) {
            [existing removeObjectForKey:key];
            NSMutableArray *alarms = [NSMutableArray new];
            for (EKAlarm *alarm in event.alarms) {
                if (alarm.absoluteDate) [alarms addObject:[time stringFromDate:alarm.absoluteDate]];
            }
            if (event.allDay && [event.startDate isEqualToDate:start] && [event.endDate isEqualToDate:end]
                && [event.title isEqual:item[@"title"]]
                && [(event.notes ?: @"") isEqual:(item[@"notes"] ?: @"")]
                && [[alarms sortedArrayUsingSelector:@selector(compare:)] isEqual:[reminders sortedArrayUsingSelector:@selector(compare:)]]) {
                continue;
            }
            updated++;
        } else {
            event = [EKEvent eventWithEventStore:store];
            event.calendar = calendar;
            event.URL = [NSURL URLWithString:[prefix stringByAppendingString:[key stringByAddingPercentEncodingWithAllowedCharacters:keyChars]]];
            added++;
        }
        event.title = item[@"title"];
        event.notes = item[@"notes"];
        event.allDay = YES;
        event.startDate = start;
        event.endDate = end;
        NSMutableArray *alarms = [NSMutableArray arrayWithCapacity:reminders.count];
        for (NSString *stamp in reminders) {
            NSDate *at = [time dateFromString:stamp];
            if (!at) return failure(@"commit", nil);
            [alarms addObject:[EKAlarm alarmWithAbsoluteDate:at]];
        }
        event.alarms = alarms;
        if (![store saveEvent:event span:EKSpanThisEvent commit:NO error:&error]) return failure(@"commit", error);
    }
    for (EKEvent *stale in existing.allValues) {
        if (![store removeEvent:stale span:EKSpanThisEvent commit:NO error:&error]) return failure(@"commit", error);
        removed++;
    }
    if ((added || updated || removed) && ![store commit:&error]) return failure(@"commit", error);
    return @{@"ok": @YES, @"calendarId": calendar.calendarIdentifier, @"added": @(added), @"updated": @(updated), @"removed": @(removed)};
}

// Transfer only immutable JSON across the worker boundary; Node values are used
// exclusively on its own thread.
typedef struct {
    napi_async_work work;
    napi_deferred deferred;
    char *input;
    char *output;
} CalendarWork;

static void execute(napi_env env, void *data) {
    CalendarWork *work = data;
    @autoreleasepool {
        NSDictionary *result;
        @try {
            NSData *json = [NSData dataWithBytes:work->input length:strlen(work->input)];
            id input = [NSJSONSerialization JSONObjectWithData:json options:0 error:NULL];
            result = [input isKindOfClass:NSDictionary.class] ? syncCalendar(input) : failure(@"failed", nil);
        } @catch (NSException *ex) {
            result = @{@"error": @"failed", @"message": ex.reason ?: @"EventKit"};
        }
        NSData *encoded = [NSJSONSerialization dataWithJSONObject:result options:0 error:NULL];
        NSString *output = [[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding];
        work->output = strdup(output.UTF8String ?: "{\"error\":\"failed\"}");
    }
}

static void complete(napi_env env, napi_status status, void *data) {
    CalendarWork *work = data;
    napi_value result;
    if (env) {
        napi_create_string_utf8(env, status == napi_ok && work->output ? work->output : "{\"error\":\"failed\"}", NAPI_AUTO_LENGTH, &result);
        napi_resolve_deferred(env, work->deferred, result);
        napi_delete_async_work(env, work->work);
    }
    free(work->input);
    free(work->output);
    free(work);
}

static napi_value startSync(napi_env env, napi_callback_info info) {
    size_t argc = 1, len;
    napi_value input, promise, label;
    napi_get_cb_info(env, info, &argc, &input, NULL, NULL);
    if (argc != 1 || napi_get_value_string_utf8(env, input, NULL, 0, &len) != napi_ok) {
        napi_throw_type_error(env, NULL, "Expected a JSON string");
        return NULL;
    }
    CalendarWork *work = calloc(1, sizeof(CalendarWork));
    if (!work || !(work->input = malloc(len + 1))) {
        free(work);
        napi_throw_error(env, NULL, "Unable to allocate calendar request");
        return NULL;
    }
    napi_get_value_string_utf8(env, input, work->input, len + 1, &len);
    napi_create_promise(env, &work->deferred, &promise);
    napi_create_string_utf8(env, "CharterCalendar", NAPI_AUTO_LENGTH, &label);
    if (napi_create_async_work(env, NULL, label, execute, complete, work, &work->work) != napi_ok ||
        napi_queue_async_work(env, work->work) != napi_ok) {
        if (work->work) napi_delete_async_work(env, work->work);
        free(work->input);
        free(work);
        napi_throw_error(env, NULL, "Unable to start calendar request");
        return NULL;
    }
    return promise;
}

static napi_value init(napi_env env, napi_value exports) {
    napi_value fn;
    napi_create_function(env, "sync", NAPI_AUTO_LENGTH, startSync, NULL, &fn);
    napi_set_named_property(env, exports, "sync", fn);
    return exports;
}

NAPI_MODULE(calendar, init)
