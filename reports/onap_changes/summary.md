# Linkage & Change Analysis — `onap_changes`

_Every change and every linkage in this dataset was ingested — nothing was sampled._

## 1. Coverage check

- **Subfolders found under the project directory:** 103,474
- **Successfully ingested as changes:** 102,905
- **Skipped: 569** — see the breakdown below and the full list in `skipped_dirs.log`.
  - 544 subfolder(s) contained **no recognised data file** (no metadata.json, linkages.json, comments.json, or patchsets.json).
  - 25 subfolder(s) produced a **change id that duplicated another folder's** — only the first-seen folder for that id was kept, so no change was double-counted.

## 2. Headline numbers

- **Total changes:** 102,905
- **Total linkages detected:** 5,725
- **Changes that reference at least one other change:** 3,844 (3.7% of all changes)
- **Linkages resolved to a change inside this project's dataset:** 3,619 (63.2%)
- **Linkages pointing outside this project/host:** 3,678 (64.2%)
- **Linkages flagged for manual review (low-confidence):** 13 (0.2%)
- **Comments/log entries whose text matches a linkage-reaction keyword (duplicate/depends-on/blocks/etc.):** 26,298

## 3. Change status breakdown

| Status | Count | % |
|---|---|---|
| MERGED | 91,476 | 88.9% |
| ABANDONED | 11,428 | 11.1% |
| None | 1 | 0.0% |

## 4. Linkage confidence breakdown

_High = strong structural evidence (URL, Depends-On trailer, Change-Id). Medium = bare number + strong trigger phrase. Low = weak evidence, needs a human look._

| Confidence | Count | % |
|---|---|---|
| high | 5,712 | 99.8% |
| low | 13 | 0.2% |

## 5. How linkages were detected

| Detection method | Count | % |
|---|---|---|
| url | 3,678 | 64.2% |
| change_id | 2,047 | 35.8% |

_A linkage can be found in more than one field at once, so this column can add up to over 100%._

| Found in field | Count | % of linkages |
|---|---|---|
| change_log | 3,392 | 59.2% |
| commit_message | 1,782 | 31.1% |
| inline_comment | 571 | 10.0% |
| change_comment | 72 | 1.3% |

## 6. Most-referenced changes (likely hotspots / shared dependencies)

These are changes that other changes point at most often — good candidates for 'this touched a lot of things' or 'everyone depends on this'.

| # | Change | Status | Subject | Times referenced |
|---|---|---|---|---|
| 46037 | #46037 | MERGED | Add INFO.yaml file | 11 |
| 92707 | #92707 | MERGED | Add multiplatform jobs for policy docker images | 11 |
| 109600 | #109600 | MERGED | Fix sonar issues | 10 |
| 48181 | #48181 | MERGED | R2 model updates | 6 |
| 94202 | #94202 | MERGED | Adding new committer | 6 |
| 108512 | #108512 | ABANDONED | Update css file name in conf.py | 6 |
| 67333 | #67333 | ABANDONED | Added test cases for AAIResponseMessage.java | 5 |
| 75910 | #75910 | MERGED | Sync docker image versions from manifest | 5 |
| 86210 | #86210 | MERGED | Changes related to running oof on TLS/HTTPS | 5 |
| 89490 | #89490 | ABANDONED | XSS Vulnerability fix in AppsController | 5 |
| 97234 | #97234 | MERGED | [AAI-2181] Change aai spike container processes to run as non-root on  | 5 |
| 13175 | #13175 | ABANDONED | Add docker folder for chrome browser | 4 |
| 56079 | #56079 | MERGED | Merge 1806 code of vid-common | 4 |
| 57171 | #57171 | MERGED | add filebeat to k8s log demo | 4 |
| 58153 | #58153 | MERGED | Kubernetes Installation Scripts | 4 |
| 60765 | #60765 | MERGED | helm 2.9.1 from 2.8.2 | 4 |
| 60767 | #60767 | MERGED | helm 2.9.1 and rancher 1.6.18 | 4 |
| 60785 | #60785 | MERGED | Upgrade helm version to 2.9.1 | 4 |
| 60907 | #60907 | MERGED | ARM template to create a k8s cluster on Azure | 4 |
| 62405 | #62405 | ABANDONED | standard logback.xml pattern | 4 |

## 7. Changes that reference the most other changes

_Often merge/squash commits, stacked patch series, or changes that re-apply history (see the sample data: a single commit message can carry dozens of prior Change-Ids). Worth spot-checking whether these are genuine dependency chains or repository-migration noise._

| Change | Subject | Outgoing linkages |
|---|---|---|
| #115962 | Merge sli/core into sli repository. | 393 |
| #115956 | Add sli/core to sli repository | 393 |
| #125445 | parent 5732262128b3fecf53463ebc6c9a02320e2603cd author Singal, Kapil ( | 43 |
| #63231 | Add subscriber docker image for client testing | 20 |
| #21463 | fix for VNFSDK-120 | 15 |
| #125456 | Sync changes to ccsdk/sli for GRA microservice | 13 |
| #125446 | Sync changes to ccsdk/sli for GRA microservice | 13 |
| #125466 | Sync changes made in downstream | 12 |
| #13039 | Fixed SONAR issues | 12 |
| #42339 | Improve JUnit test coverage | 11 |
| #121885 | Cherry pick changes from master back to Honolulu | 11 |
| #42323 | Improve JUnit test coverage | 9 |
| #138866 | Update newdelhi branch HEAD | 9 |
| #58959 | testing artifact to nexus | 9 |
| #72579 | music core implemented as a service | 9 |
| #9693 | added filebeat to all components | 9 |
| #126150 | [GLOBAL] Move to Gitlab | 9 |
| #123814 | Carry forward honolulu fixes | 7 |
| #140666 | Improve OpenAPI files and documentation | 7 |
| #103910 | Update oom with the latest release version for OOF | 7 |

## 8. Frequently-cited changes NOT found in this project's dataset

Either they belong to a different project/repo, or they weren't part of this retrieval run.

| Target change # | Times cited |
|---|---|
| 85955 | 7 |
| 512 | 1 |
| 5760 | 1 |
| 6098 | 1 |
| 6864 | 1 |
| 9535 | 1 |
| 9588 | 1 |
| 9826 | 1 |
| 10986 | 1 |
| 12894 | 1 |
| 15072 | 1 |
| 16448 | 1 |
| 16656 | 1 |
| 17762 | 1 |
| 19610 | 1 |

## 9. Changes created per month

| Month | Changes |
|---|---|
| 2017-01 | 12 |
| 2017-02 | 696 |
| 2017-03 | 685 |
| 2017-04 | 437 |
| 2017-05 | 411 |
| 2017-06 | 376 |
| 2017-07 | 362 |
| 2017-08 | 1618 |
| 2017-09 | 3391 |
| 2017-10 | 2341 |
| 2017-11 | 1744 |
| 2017-12 | 910 |
| 2018-01 | 1307 |
| 2018-02 | 1732 |
| 2018-03 | 3388 |
| 2018-04 | 2386 |
| 2018-05 | 2202 |
| 2018-06 | 1130 |
| 2018-07 | 1243 |
| 2018-08 | 2665 |
| 2018-09 | 2643 |
| 2018-10 | 1951 |
| 2018-11 | 2431 |
| 2018-12 | 1025 |
| 2019-01 | 1437 |
| 2019-02 | 1681 |
| 2019-03 | 2434 |
| 2019-04 | 2731 |
| 2019-05 | 2282 |
| 2019-06 | 1568 |
| 2019-07 | 1661 |
| 2019-08 | 2245 |
| 2019-09 | 1667 |
| 2019-10 | 1319 |
| 2019-11 | 1092 |
| 2019-12 | 926 |
| 2020-01 | 1023 |
| 2020-02 | 1595 |
| 2020-03 | 2065 |
| 2020-04 | 2012 |
| 2020-05 | 1545 |
| 2020-06 | 985 |
| 2020-07 | 1083 |
| 2020-08 | 1018 |
| 2020-09 | 1388 |
| 2020-10 | 988 |
| 2020-11 | 1392 |
| 2020-12 | 594 |
| 2021-01 | 655 |
| 2021-02 | 1302 |
| 2021-03 | 1372 |
| 2021-04 | 866 |
| 2021-05 | 546 |
| 2021-06 | 704 |
| 2021-07 | 617 |
| 2021-08 | 663 |
| 2021-09 | 877 |
| 2021-10 | 797 |
| 2021-11 | 480 |
| 2021-12 | 379 |
| 2022-01 | 495 |
| 2022-02 | 437 |
| 2022-03 | 815 |
| 2022-04 | 735 |
| 2022-05 | 391 |
| 2022-06 | 274 |
| 2022-07 | 340 |
| 2022-08 | 479 |
| 2022-09 | 708 |
| 2022-10 | 556 |
| 2022-11 | 584 |
| 2022-12 | 294 |
| 2023-01 | 254 |
| 2023-02 | 344 |
| 2023-03 | 439 |
| 2023-04 | 407 |
| 2023-05 | 317 |
| 2023-06 | 466 |
| 2023-07 | 333 |
| 2023-08 | 235 |
| 2023-09 | 170 |
| 2023-10 | 286 |
| 2023-11 | 311 |
| 2023-12 | 166 |
| 2024-01 | 191 |
| 2024-02 | 334 |
| 2024-03 | 159 |
| 2024-04 | 197 |
| 2024-05 | 300 |
| 2024-06 | 212 |
| 2024-07 | 274 |
| 2024-08 | 231 |
| 2024-09 | 169 |
| 2024-10 | 185 |
| 2024-11 | 298 |
| 2024-12 | 200 |
| 2025-01 | 310 |
| 2025-02 | 212 |
| 2025-03 | 271 |
| 2025-04 | 171 |
| 2025-05 | 244 |
| 2025-06 | 288 |
| 2025-07 | 213 |
| 2025-08 | 319 |
| 2025-09 | 197 |
| 2025-10 | 172 |
| 2025-11 | 237 |
| 2025-12 | 241 |
| 2026-01 | 259 |
| 2026-02 | 289 |
| 2026-03 | 409 |
| 2026-04 | 267 |
| 2026-05 | 526 |
| 2026-06 | 884 |
| 2026-07 | 1035 |
| 2026-08 | 433 |
| 2026-09 | 266 |

## 10. Developer reaction language (comments/log mentioning duplicate / depends-on / blocks / etc.)

| Keyword matched | Occurrences |
|---|---|
| abandon | 13361 |
| cherry pick | 5193 |
| dependency | 1649 |
| not needed | 1242 |
| related to | 1221 |
| same as | 1100 |
| duplicate | 772 |
| cherry-pick | 260 |
| depends on | 250 |
| fixed in | 230 |
| blocks | 203 |
| revert of | 169 |
| replaced by | 133 |
| addressed in | 93 |
| already done | 78 |
| see also | 76 |
| duplicate of | 68 |
| relates to | 59 |
| replaces | 39 |
| already fixed | 34 |

See `reactions.csv` for the full list with authors, timestamps, and message snippets — this is the raw material for a 'how do developers actually respond to linkages' read (acknowledged & fixed vs. disputed vs. ignored vs. led to abandonment).

## 11. Sample of low-confidence linkages flagged for manual review

| Change | Raw match | Field | Context |
|---|---|---|---|
| #112990 | `I8d660a8e3` | commit_message | …ion 113061-change-112626-6  Reason for revert: e2e tests are broken by Guilin SDNC versions Reverte |
| #112990 | `Ide8b60615` | commit_message | …t: e2e tests are broken by Guilin SDNC versions Reverted Changes: I8d660a8e3:[SDNC/CCSDK] Guilin ve |
| #112991 | `I8d660a8e3` | commit_message | …ion 113061-change-112626-6  Reason for revert: e2e tests are broken by Guilin SDNC versions Reverte |
| #112991 | `Ide8b60615` | commit_message | …t: e2e tests are broken by Guilin SDNC versions Reverted Changes: I8d660a8e3:[SDNC/CCSDK] Guilin ve |
| #114848 | `Ic1302ac28` | commit_message | …consul server run as non-root"  Revert submission 114556  Reason for revert: Bug - OOM-2630 Reverte |
| #114848 | `I43584b7f0` | commit_message | …6  Reason for revert: Bug - OOM-2630 Reverted Changes: Ic1302ac28:[CONSUL] Make consul server run a |
| #114849 | `Ic1302ac28` | commit_message | …] Make consul run as non-root"  Revert submission 114556  Reason for revert: Bug - OOM-2630 Reverte |
| #114849 | `I43584b7f0` | commit_message | …6  Reason for revert: Bug - OOM-2630 Reverted Changes: Ic1302ac28:[CONSUL] Make consul server run a |
| #114972 | `Ic1302ac28` | commit_message | …] Make consul run as non-root"  Revert submission 114556  Reason for revert: Bug - OOM-2630 Reverte |
| #114972 | `I43584b7f0` | commit_message | …6  Reason for revert: Bug - OOM-2630 Reverted Changes: Ic1302ac28:[CONSUL] Make consul server run a |
| #114973 | `Ic1302ac28` | commit_message | …consul server run as non-root"  Revert submission 114556  Reason for revert: Bug - OOM-2630 Reverte |
| #114973 | `I43584b7f0` | commit_message | …6  Reason for revert: Bug - OOM-2630 Reverted Changes: Ic1302ac28:[CONSUL] Make consul server run a |
| #145993 | `Icde348d8` | commit_message | …property modal regressions from the Angular migration  Follow-up to the icon/module-property modal  |

(Showing 25 of 13 flagged linkages — query `linkages.csv` or the DB for the rest.)

## 12. Where to go for the full, unabridged data

- `onap_changes.db` — SQLite database with **every** change, linkage, and reaction row. Open with `sqlite3`, DB Browser for SQLite, or pandas (`pd.read_sql`).
- `changes.csv` / `linkages.csv` / `reactions.csv` — the same data as flat files, one row per record, nothing aggregated away.
- `dashboard.html` — open in a browser to search/sort/page through every change and every linkage interactively.

## Appendix: skipped folders (sample — full list in `skipped_dirs.log`)

**No recognised data file (skipped)** (544):
- 138773
- 145031
- 145033
- 145041
- 145109
- 145217
- 145259
- 145260
- 145261
- 145273
- 145274
- 145275
- 145276
- 145277
- 145295
- 145296
- 145298
- 145299
- 145300
- 145301
- 145308
- 145309
- 145310
- 145312
- 145330

**Duplicate change ids** (25):
- duplicate change_key 'doc~honolulu~I302b93a36bd1205473945a8f2a17034f07fe369e' (folders '121025' and '121026' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'oom%2Foffline-installer~honolulu~Ie7c9562403f3b330f52136adc5dc8a11f85bc950' (folders '124586' and '124587' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'cps%2Fncmp-dmi-plugin~master~I16664a831d73f67f7b219c1b04ad46253e637aea' (folders '124765' and '124766' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'usecase-ui%2Fnlp~master~Ic237acc553e417efb23352e8832d1997b7463cc1' (folders '125320' and '125321' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fparent~istanbul~I89cc443a7e41bdaa35cf6255d5303295c97fbd9b' (folders '125639' and '125700' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fparent~istanbul~I89cc443a7e41bdaa35cf6255d5303295c97fbd9b' (folders '125639' and '125701' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'integration~kohn~I8b9e1cd568f94c230d144888f309d4e117c94b0e' (folders '132151' and '132152' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'integration~kohn~I52b2aab0d4d58156fbe2c21a4a72c4977028546f' (folders '132153' and '132154' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'sdc%2Fsdc-workflow-designer~master~I3576bc5b39fe2749a84bf7290719be36680c280a' (folders '141142' and '141143' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'sdc%2Fsdc-workflow-designer~master~I3576bc5b39fe2749a84bf7290719be36680c280a' (folders '141142' and '141144' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fopa-pdp~master~I89922d1143bbeaed051bc9a6c6dc2564aafb8b00' (folders '141153' and '141154' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fopa-pdp~master~I89922d1143bbeaed051bc9a6c6dc2564aafb8b00' (folders '141153' and '141155' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fopa-pdp~master~I89922d1143bbeaed051bc9a6c6dc2564aafb8b00' (folders '141153' and '141156' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fopa-pdp~master~I89922d1143bbeaed051bc9a6c6dc2564aafb8b00' (folders '141153' and '141157' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fopa-pdp~master~I5525b861050d7734be5014f038749143f913cf91' (folders '141158' and '141159' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fopa-pdp~master~I5e43bcf6b4b47bcb8e11bdda673afeefe7e45d6c' (folders '141160' and '141162' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fopa-pdp~master~I5e43bcf6b4b47bcb8e11bdda673afeefe7e45d6c' (folders '141160' and '141163' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'policy%2Fclamp~master~Icbe17bbf7e76e2be68022367809a2127a790477f' (folders '141550' and '141551' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'appc~master~Iab31d84016c84bf03df7fdc8cf0c163c23091a88' (folders '28061' and '28191' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'integration%2Fcsit~master~I69782b3bc426dac02c691392ae679aeedcf81ee3' (folders '82055' and '83758' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'dcaegen2%2Fcollectors%2Fdatafile~master~I27dd76a8f1b84a8ab26080381321c509c1117a9b' (folders '90661' and '90662' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'dcaegen2%2Fcollectors%2Fdatafile~master~Ic482f510e46223ecf798d288a9ce63961a5b54f9' (folders '91578' and '91579' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'dcaegen2%2Fcollectors%2Fdatafile~master~I98f6e0ee50187f8f24fd16293778dab4d5a5a3a5' (folders '91917' and '91918' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'dcaegen2%2Fcollectors%2Fdatafile~master~I0b4c22df62200dc8b48a185bf5f6b352d66e1ff1' (folders '92342' and '92343' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)
- duplicate change_key 'dcaegen2%2Fcollectors%2Fdatafile~master~I12892461e2ddb46672594384af055248109aec05' (folders '92352' and '92353' both produced this id — the second one was NOT ingested, INSERT OR REPLACE would have silently overwritten the first)