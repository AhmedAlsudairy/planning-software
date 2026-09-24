# Search result UX guidelines

Written for whoever builds or reviews the search and result screens.

These are the rules the result list follows today. They exist because a wrong answer here is a
wrong purchase order, and because the people using this tool are deciding whether an existing SAP
code can be reused instead of a new one being created.

## 1. One row per material, never one row per plant

A material number stocked at nine plants is one material. It appears once, and its row names the
plants that carry it.

In the reference export, 2,453 of 8,221 materials are stocked at more than one plant. Before this
rule, a search returned the same part up to ten times and filled the first page with duplicates.

- Show the count first, then the codes: **3 plants · 8502, 8503, 8506**.
- Beyond four plants, truncate with `+n`. The full list belongs in the exported spreadsheet, not on
  the card.
- Never show a bare "Plant —". If no plant is recorded, say so once, quietly.

## 2. Say when a match is an identification, not a guess

When the user pastes a SAP code or repeats a description verbatim, the system has not estimated
anything — it has found the row. That is labelled **Exact match**, shown at 100%, and ranked first.

Everything else is a similarity estimate and is presented as a percentage with its reasoning
available. Do not blur the two: a confident guess and a certain identification look different.

## 3. Blocked stock stays visible and ranks last

Materials marked *Blocked for Procurement* (753 rows, 6.1% of the reference export) are real codes
that answer "what is the part number for this?" — so they are never hidden. They are:

- badged **Blocked for procurement** in red, in the position where the status normally sits;
- ranked below every available material of comparable quality;
- **except** when they are an exact match, because a user who typed that code wants that code.

The exported spreadsheet spells this out in an *Availability* column rather than leaving it as a
flag, because that column is what decides whether a PO can be raised.

Rationale for showing rather than dropping: a buyer who cannot find a code assumes none exists and
requests a new one. A buyer who finds a blocked code knows the part is catalogued and can ask why
it is blocked. The second outcome is always better, so the block is information, not a filter.

## 4. Never return an empty result set when the catalog has candidates

Retrieval runs as four independent arms (exact code, lexical, trigram, attribute) and unions them.
Any one arm may find nothing; the result set is only empty when the catalog genuinely has nothing.

A cross-family match is ranked far down, not removed — a search for an elbow that surfaces a flange
at 30% is telling the truth. The one exception is spares: a query for an item does not return that
item's repair kit, because that is a different purchase, not a worse match.

This is a hard rule and the retrieval evaluation (`npm run eval-search`) fails the build if any
sampled query returns nothing.

## 5. Show what was understood from the query, before the results

The parsed attribute pills are not decoration. They are how a user discovers that "1/2 inch" was
read as 12.7 mm, or that their item type was not recognised. When a search goes wrong, the pills
are the first place to look.

Show every attribute that was parsed — item type, subtypes, both bores of a reducing fitting,
schedule, angle, wall thickness, pressure, connection, make, materials, standards. An attribute the
system did not extract must not appear as though it did.

## 6. Every score must be explainable on the row

The attribute comparison table shows, per attribute, what was asked for, what the candidate offers,
and the verdict (exact / compatible / mismatch / missing). A confidence number with no visible
derivation is not actionable, and users will not trust it twice.

Keep the three sub-scores (parametric, semantic, lexical) visible. They are how a reviewer tells
"matched on engineering attributes" from "matched on wording".

## 7. Confidence colour reflects decision risk, not the number

- **≥ 85%** green — safe to reuse this code after a glance.
- **65–84%** amber — read the comparison table before reusing.
- **< 65%** red — probably a different part; treat as a lead, not an answer.

Do not retune these bands without re-running the retrieval evaluation. They are calibrated against
observed behaviour, and the dashboard readiness figure is a completeness indicator — not a
calibrated match probability.

## 8. Language

- "Blocked for procurement", not "inactive" or "invalid". It says what the constraint is.
- "Exact match", not "100% match". The distinction in rule 2 is the whole point.
- Plant codes stay numeric and monospaced; they are identifiers users cross-check by eye.
- SAP codes are copy-on-click, monospaced, and never truncated. Copying the code is the single most
  common action on this screen.

## 9. Import feedback must name what is missing

A rejected file says which *kind* of column it could not find and lists the headers it did see —
never just "missing required columns". The importer accepts either export layout and resolves
headers by meaning, so a rejection means something genuinely absent.

Warnings are surfaced, not swallowed: an export with no corporate-number column imports fine, and
the user is told that materials are identified by SAP code alone.
