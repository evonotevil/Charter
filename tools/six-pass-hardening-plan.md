# Charter six-pass hardening plan

This plan turns the current design review into bounded, testable changes. The built-in jurisdiction lists are starter checklists and must not be presented as authoritative statements of law.

1. **Distill** — keep the dashboard focused on actionable files, archive completeness, and the selected group. Remove repeated metrics and make personal-file scope explicit.
2. **Clarify** — distinguish “not archived”, “not obtained”, “stored externally”, “access restricted”, “not applicable”, and “date unverified” everywhere they appear, including exports and packet requests.
3. **Harden** — validate every document type/owner pair, prevent duplicate current documents, preserve incomplete nominee ownership as unknown, and avoid definitive negative chain claims when ownership data has gaps.
4. **Typeset / layout** — test long CJK/Latin company names, aliases, registration numbers, notes, and status labels at the 1080-point minimum window without clipping primary actions.
5. **Normalize** — use one status-color and status-copy mapping across dashboard, company archives, files, packets, and exports; use the same toolbar and group-filter placement across primary pages.
6. **Polish** — align spacing, focus/hover states, keyboard movement, reduced-motion behavior, and empty/error states after the correctness passes are complete.

## Required regression evidence

- A company document cannot be reassigned to a person, and a person document cannot be reassigned to a company.
- A jurisdiction-specific document type cannot be assigned to a company in another jurisdiction.
- Editing metadata cannot create two current documents with the same owner and type.
- A failed validation leaves both the in-memory document collection and the saved collection unchanged.
- Missing beneficial-owner data is reported as unknown rather than assigned to the nominee or described as a confirmed absence.
- Archive marks and notes survive packet preview/export so restricted or externally held material is not described merely as missing.
