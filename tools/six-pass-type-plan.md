# Structure typography and layout pass

## Scope

- Preserve the native system font and the existing black, lime, and amber semantics.
- Change only `DesignSystem.swift` and `StructureView.swift`.
- Keep the cached structure snapshot, node sizes, and routing geometry stable.

## Target result

1. Define a small semantic type ramp for entity titles, section titles, row titles, body text, metadata, and micro labels.
2. Apply those roles to the structure graph and inspector without globally rewriting the application.
3. Keep long company and person names readable inside the existing node geometry.
4. Bound long nominee labels while preserving their full meaning through help and accessibility text.
5. Retain tabular digits for percentages, dates, and timeline years.

## Verification

- Inspect the diff for changes outside the two owned Swift files and this plan.
- Confirm company nodes remain `280 x 70` and person nodes remain `170 x 56`.
- Confirm graph labels remain single-line, capped, and expose the complete label to assistive technology.
- Run a Swift parse check for the two edited files if available; the parent agent owns the full build.
