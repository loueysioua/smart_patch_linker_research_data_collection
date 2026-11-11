# Linkage & Change Analysis — `libreoffice_changes`

_Every change and every linkage in this dataset was ingested — nothing was sampled._

## 1. Coverage check

- **Subfolders found under the project directory:** 203,969
- **Successfully ingested as changes:** 203,359
- **Skipped: 610** — see the breakdown below and the full list in `skipped_dirs.log`.
  - 610 subfolder(s) contained **no recognised data file** (no metadata.json, linkages.json, comments.json, or patchsets.json).

## 2. Headline numbers

- **Total changes:** 203,359
- **Total linkages detected:** 46,112
- **Changes that reference at least one other change:** 32,985 (16.2% of all changes)
- **Linkages resolved to a change inside this project's dataset:** 36,429 (79.0%)
- **Linkages pointing outside this project/host:** 36,611 (79.4%)
- **Linkages flagged for manual review (low-confidence):** 13 (0.0%)
- **Comments/log entries whose text matches a linkage-reaction keyword (duplicate/depends-on/blocks/etc.):** 242,745

## 3. Change status breakdown

| Status | Count | % |
|---|---|---|
| MERGED | 186,420 | 91.7% |
| ABANDONED | 16,929 | 8.3% |
| NEW | 10 | 0.0% |

## 4. Linkage confidence breakdown

_High = strong structural evidence (URL, Depends-On trailer, Change-Id). Medium = bare number + strong trigger phrase. Low = weak evidence, needs a human look._

| Confidence | Count | % |
|---|---|---|
| high | 46,099 | 100.0% |
| low | 13 | 0.0% |

## 5. How linkages were detected

| Detection method | Count | % |
|---|---|---|
| url | 36,613 | 79.4% |
| change_id | 9,499 | 20.6% |

_A linkage can be found in more than one field at once, so this column can add up to over 100%._

| Found in field | Count | % of linkages |
|---|---|---|
| commit_message | 39,014 | 84.6% |
| change_log | 3,520 | 7.6% |
| change_comment | 2,470 | 5.4% |
| inline_comment | 1,351 | 2.9% |

## 6. Most-referenced changes (likely hotspots / shared dependencies)

These are changes that other changes point at most often — good candidates for 'this touched a lot of things' or 'everyone depends on this'.

| # | Change | Status | Subject | Times referenced |
|---|---|---|---|---|
| 199615 | #199615 | MERGED | Add Qt6 support for Windows | 34 |
| 185849 | #185849 | MERGED | vcl a11y: Let OAccessibleComponentHelper implement XAccessible | 19 |
| 168981 | #168981 | MERGED | annot: update object text when annotation text changes | 17 |
| 23630 | #23630 | ABANDONED | tdf#97966 Compiler plugin | 16 |
| 161831 | #161831 | MERGED | tdf#130857 qt weld: Implement QtBuilder + use it for first msg dialog | 16 |
| 168667 | #168667 | MERGED | remove ability to trust not validated macro signatures in high securit | 16 |
| 203098 | #203098 | MERGED | svx: prefix members of SvxRuler | 16 |
| 169525 | #169525 | MERGED | remove ability to trust not validated macro signatures in high securit | 14 |
| 149971 | #149971 | MERGED | query getUserAllowsLinkUpdate for the case of content in a floating fr | 13 |
| 150341 | #150341 | MERGED | extract a OCommonEmbeddedObject::SetInplaceActiveState for reuse | 13 |
| 150342 | #150342 | MERGED | use parent window as dialog parent | 13 |
| 150343 | #150343 | MERGED | adjust IFrameObject so it could reuse mxFrame for a reload of content | 13 |
| 150349 | #150349 | MERGED | add a route to get writer Floating Frame links under 'manage links' | 13 |
| 150526 | #150526 | MERGED | create the FloatingFrameShape in a separate step to inserting it | 13 |
| 150538 | #150538 | MERGED | allow SvxOle2Shape::resetModifiedState to survive having no SdrObject | 13 |
| 150539 | #150539 | MERGED | add a route to get calc Floating Frame links under 'manage links' | 13 |
| 165410 | #165410 | MERGED | add notify for script use | 12 |
| 111654 | #111654 | MERGED | tdf#47065 Add new file open UI options and implement a new thread | 11 |
| 150221 | #150221 | MERGED | set Referer on loading IFrames | 11 |
| 191587 | #191587 | MERGED | tdf#168598 Fix for tdf#148578 should only apply to RTF | 11 |

## 7. Changes that reference the most other changes

_Often merge/squash commits, stacked patch series, or changes that re-apply history (see the sample data: a single commit message can carry dozens of prior Change-Ids). Worth spot-checking whether these are genuine dependency chains or repository-migration noise._

| Change | Subject | Outgoing linkages |
|---|---|---|
| #165674 | Added translation for website using Weblate (Belarusian) | 591 |
| #195239 | Translated using Weblate (Afrikaans) | 436 |
| #198206 | website translated using Weblate | 312 |
| #85086 | Update translations | 298 |
| #189179 | website translated using Weblate | 162 |
| #99278 | update translations | 151 |
| #205273 | website translated using Weblate | 142 |
| #204353 | website translated using Weblate | 140 |
| #203832 | website translated using Weblate | 136 |
| #206982 | website translated using Weblate | 128 |
| #89847 | update translations | 125 |
| #97453 | update translations | 91 |
| #86041 | update translations | 90 |
| #123821 | update translations | 89 |
| #204299 | website translated using Weblate | 83 |
| #88563 | update translations | 82 |
| #85789 | update translations | 75 |
| #204804 | website translated using Weblate | 69 |
| #204966 | Added translation for website using Weblate (Hungarian) | 61 |
| #107507 | update translations | 53 |

## 8. Frequently-cited changes NOT found in this project's dataset

Either they belong to a different project/repo, or they weren't part of this retrieval run.

| Target change # | Times cited |
|---|---|
| 48 | 5 |
| 169617 | 4 |
| 204 | 3 |
| 4339 | 3 |
| 7235 | 3 |
| 7236 | 3 |
| 295892 | 3 |
| 27 | 2 |
| 53 | 2 |
| 67 | 2 |
| 164 | 2 |
| 200 | 2 |
| 1388 | 2 |
| 2628 | 2 |
| 4726 | 2 |

## 9. Changes created per month

| Month | Changes |
|---|---|
| 2012-03 | 12 |
| 2012-04 | 4 |
| 2012-05 | 5 |
| 2012-06 | 25 |
| 2012-07 | 78 |
| 2012-08 | 155 |
| 2012-09 | 215 |
| 2012-10 | 211 |
| 2012-11 | 224 |
| 2012-12 | 255 |
| 2013-01 | 409 |
| 2013-02 | 511 |
| 2013-03 | 628 |
| 2013-04 | 551 |
| 2013-05 | 356 |
| 2013-06 | 483 |
| 2013-07 | 568 |
| 2013-08 | 481 |
| 2013-09 | 347 |
| 2013-10 | 402 |
| 2013-11 | 326 |
| 2013-12 | 330 |
| 2014-01 | 522 |
| 2014-02 | 613 |
| 2014-03 | 386 |
| 2014-04 | 341 |
| 2014-05 | 377 |
| 2014-06 | 355 |
| 2014-07 | 639 |
| 2014-08 | 529 |
| 2014-09 | 483 |
| 2014-10 | 427 |
| 2014-11 | 594 |
| 2014-12 | 462 |
| 2015-01 | 526 |
| 2015-02 | 404 |
| 2015-03 | 393 |
| 2015-04 | 458 |
| 2015-05 | 420 |
| 2015-06 | 578 |
| 2015-07 | 798 |
| 2015-08 | 727 |
| 2015-09 | 808 |
| 2015-10 | 648 |
| 2015-11 | 573 |
| 2015-12 | 692 |
| 2016-01 | 934 |
| 2016-02 | 796 |
| 2016-03 | 911 |
| 2016-04 | 810 |
| 2016-05 | 1165 |
| 2016-06 | 1062 |
| 2016-07 | 878 |
| 2016-08 | 766 |
| 2016-09 | 815 |
| 2016-10 | 1001 |
| 2016-11 | 965 |
| 2016-12 | 1095 |
| 2017-01 | 1171 |
| 2017-02 | 948 |
| 2017-03 | 1214 |
| 2017-04 | 1085 |
| 2017-05 | 1144 |
| 2017-06 | 1117 |
| 2017-07 | 1122 |
| 2017-08 | 1140 |
| 2017-09 | 1170 |
| 2017-10 | 1128 |
| 2017-11 | 1418 |
| 2017-12 | 1569 |
| 2018-01 | 1793 |
| 2018-02 | 1432 |
| 2018-03 | 1653 |
| 2018-04 | 1392 |
| 2018-05 | 1424 |
| 2018-06 | 1591 |
| 2018-07 | 1562 |
| 2018-08 | 1488 |
| 2018-09 | 1263 |
| 2018-10 | 1499 |
| 2018-11 | 1618 |
| 2018-12 | 1384 |
| 2019-01 | 1439 |
| 2019-02 | 1270 |
| 2019-03 | 1488 |
| 2019-04 | 1570 |
| 2019-05 | 1639 |
| 2019-06 | 1629 |
| 2019-07 | 1794 |
| 2019-08 | 1536 |
| 2019-09 | 1535 |
| 2019-10 | 1910 |
| 2019-11 | 2219 |
| 2019-12 | 1879 |
| 2020-01 | 1723 |
| 2020-02 | 1875 |
| 2020-03 | 1622 |
| 2020-04 | 1743 |
| 2020-05 | 1942 |
| 2020-06 | 2218 |
| 2020-07 | 2200 |
| 2020-08 | 1878 |
| 2020-09 | 1905 |
| 2020-10 | 1351 |
| 2020-11 | 1695 |
| 2020-12 | 1585 |
| 2021-01 | 1628 |
| 2021-02 | 1445 |
| 2021-03 | 1684 |
| 2021-04 | 1475 |
| 2021-05 | 1516 |
| 2021-06 | 1618 |
| 2021-07 | 1549 |
| 2021-08 | 1555 |
| 2021-09 | 1446 |
| 2021-10 | 1563 |
| 2021-11 | 1602 |
| 2021-12 | 1602 |
| 2022-01 | 1446 |
| 2022-02 | 1475 |
| 2022-03 | 1583 |
| 2022-04 | 1271 |
| 2022-05 | 1471 |
| 2022-06 | 1441 |
| 2022-07 | 943 |
| 2022-08 | 1471 |
| 2022-09 | 1516 |
| 2022-10 | 1224 |
| 2022-11 | 1363 |
| 2022-12 | 1292 |
| 2023-01 | 1494 |
| 2023-02 | 1549 |
| 2023-03 | 1565 |
| 2023-04 | 1322 |
| 2023-05 | 1182 |
| 2023-06 | 1328 |
| 2023-07 | 1269 |
| 2023-08 | 1249 |
| 2023-09 | 1034 |
| 2023-10 | 1249 |
| 2023-11 | 1380 |
| 2023-12 | 1312 |
| 2024-01 | 1357 |
| 2024-02 | 1309 |
| 2024-03 | 1376 |
| 2024-04 | 1206 |
| 2024-05 | 1345 |
| 2024-06 | 1424 |
| 2024-07 | 1506 |
| 2024-08 | 1337 |
| 2024-09 | 1600 |
| 2024-10 | 1517 |
| 2024-11 | 1683 |
| 2024-12 | 1973 |
| 2025-01 | 1374 |
| 2025-02 | 1382 |
| 2025-03 | 1146 |
| 2025-04 | 1272 |
| 2025-05 | 1201 |
| 2025-06 | 1117 |
| 2025-07 | 1495 |
| 2025-08 | 1724 |
| 2025-09 | 1247 |
| 2025-10 | 1550 |
| 2025-11 | 1531 |
| 2025-12 | 1536 |
| 2026-01 | 2080 |
| 2026-02 | 2203 |
| 2026-03 | 2419 |
| 2026-04 | 1387 |
| 2026-05 | 1203 |
| 2026-06 | 1268 |
| 2026-07 | 1264 |
| 2026-08 | 1093 |
| 2026-09 | 625 |

## 10. Developer reaction language (comments/log mentioning duplicate / depends-on / blocks / etc.)

| Keyword matched | Occurrences |
|---|---|
| cherry-pick | 181769 |
| cherry pick | 32745 |
| abandon | 20511 |
| related to | 1800 |
| duplicate | 799 |
| same as | 783 |
| revert of | 680 |
| blocks | 678 |
| not needed | 575 |
| depends on | 480 |
| dependency | 455 |
| fixed in | 397 |
| see also | 282 |
| replaced by | 185 |
| addressed in | 127 |
| replaces | 124 |
| reverts | 106 |
| already done | 80 |
| already fixed | 53 |
| duplicate of | 44 |

See `reactions.csv` for the full list with authors, timestamps, and message snippets — this is the raw material for a 'how do developers actually respond to linkages' read (acknowledged & fixed vs. disputed vs. ignored vs. led to abandonment).

## 11. Sample of low-confidence linkages flagged for manual review

| Change | Raw match | Field | Context |
|---|---|---|---|
| #100403 | `ifdeffed` | commit_message | …SABIReference/Articles/ARM64FunctionCallingConventions.html  We should probably copy the edited (an |
| #1012 | `ifdeffed` | change_log | Patch Set 1: I would prefer that you didn't submit this  In general, such ifdeffed-out code should n |
| #116015 | `id1753384014` | commit_message | …field metadata fields allows quick visual check of metadata categories.  For example, RDF triple  c |
| #1193 | `Ifed2349d` | change_log | Patch Set 1: Abandoned  Doesn't depend on Ifed2349d |
| #124264 | `ifdeffed` | commit_message | Remove lines that have been ifdeffed out since 2008  Change-Id: I56e17e876803a11047904187ae2fd40fbae |
| #1310 | `Idf933915` | change_log | …r, I think the problem for which you want to introduce it (<https://gerrit.libreoffice.org/#/c/1311 |
| #16642 | `I0ef8cda7b` | commit_message | …0. The debug ucrtbased.dll is also included as part of this SDK and is installed to the system dire |
| #171639 | `Ia6b8ecb9` | commit_message | …plementations (nss+mscrypt) implement listing public keys (getAllCertificates) as a stub. See previ |
| #1734 | `Idf933915` | commit_message | …nateThread" message (which allegedly caused deadlocks, see <https://gerrit.libreoffice.org/#/c/1311 |
| #3517 | `I07e698f7` | change_log | …just a testing backed (for comparison).  This gets things a bit further, the code builds now, but t |
| #79217 | `ifdeffed` | commit_message | …ystem clipboard interface for iOS  Based on the corresponding macOS code. Work in progress. The ima |
| #83710 | `Ie1c125e6925` | change_log, inline_comment | Patch Set 2:  I don't understand what you mean with abbreviated change id.  I mean if I search Ie1c1 |
| #99302 | `I6909a933fe` | commit_message | Grant "Toggle Wip State" permission to Committers group on refs/heads/*  This is a follow-up of I690 |

(Showing 25 of 13 flagged linkages — query `linkages.csv` or the DB for the rest.)

## 12. Where to go for the full, unabridged data

- `libreoffice_changes.db` — SQLite database with **every** change, linkage, and reaction row. Open with `sqlite3`, DB Browser for SQLite, or pandas (`pd.read_sql`).
- `changes.csv` / `linkages.csv` / `reactions.csv` — the same data as flat files, one row per record, nothing aggregated away.
- `dashboard.html` — open in a browser to search/sort/page through every change and every linkage interactively.

## Appendix: skipped folders (sample — full list in `skipped_dirs.log`)

**No recognised data file (skipped)** (610):
- 201217
- 201238
- 202257
- 202634
- 203677
- 203678
- 203679
- 203680
- 203681
- 203682
- 203684
- 204086
- 204662
- 204669
- 205231
- 206080
- 206127
- 206844
- 206845
- 206846
- 206847
- 206848
- 206849
- 206850
- 206851