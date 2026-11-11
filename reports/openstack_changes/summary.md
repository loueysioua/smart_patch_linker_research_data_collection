# Linkage & Change Analysis — `openstack_changes`

_Every change and every linkage in this dataset was ingested — nothing was sampled._

## 1. Coverage check

- **Subfolders found under the project directory:** 399,159
- **Successfully ingested as changes:** 399,159
- **Skipped: 0** — every subfolder containing at least one data file was ingested.

## 2. Headline numbers

- **Total changes:** 399,159
- **Total linkages detected:** 25,999
- **Changes that reference at least one other change:** 19,169 (4.8% of all changes)
- **Linkages resolved to a change inside this project's dataset:** 23,502 (90.4%)
- **Linkages pointing outside this project/host:** 973 (3.7%)
- **Linkages flagged for manual review (low-confidence):** 71 (0.3%)
- **Comments/log entries whose text matches a linkage-reaction keyword (duplicate/depends-on/blocks/etc.):** 200,752

## 3. Change status breakdown

| Status | Count | % |
|---|---|---|
| MERGED | 289,374 | 72.5% |
| ABANDONED | 69,588 | 17.4% |
| None | 21,424 | 5.4% |
| NEW | 18,773 | 4.7% |

## 4. Linkage confidence breakdown

_High = strong structural evidence (URL, Depends-On trailer, Change-Id). Medium = bare number + strong trigger phrase. Low = weak evidence, needs a human look._

| Confidence | Count | % |
|---|---|---|
| high | 25,928 | 99.7% |
| low | 71 | 0.3% |

## 5. How linkages were detected

| Detection method | Count | % |
|---|---|---|
| url | 24,696 | 95.0% |
| change_id | 1,303 | 5.0% |

_A linkage can be found in more than one field at once, so this column can add up to over 100%._

| Found in field | Count | % of linkages |
|---|---|---|
| change_comment | 15,416 | 59.3% |
| inline_comment | 11,193 | 43.1% |

## 6. Most-referenced changes (likely hotspots / shared dependencies)

These are changes that other changes point at most often — good candidates for 'this touched a lot of things' or 'everyone depends on this'.

| # | Change | Status | Subject | Times referenced |
|---|---|---|---|---|
| 856903 | #856903 | MERGED | Make python version testing template unversioned | 40 |
| 856904 | #856904 | MERGED | Make python version template unversioned | 36 |
| 843057 | #843057 | ABANDONED | Prepare Zed M1 | 35 |
| 869788 | #869788 | MERGED | Switch to Ubuntu Jammy (22.04) | 35 |
| 888364 | #888364 | MERGED | Do not restart services after policy file changes | 24 |
| 979136 | #979136 | MERGED | Replace --showconfig with config | 23 |
| 918992 | #918992 | MERGED | Fixes for ceph squid | 17 |
| 930126 | #930126 | MERGED | logging: Deprecate watch_log_file | 17 |
| 863012 | #863012 | MERGED | Run build-openstack-puppet-tarball on Focal | 16 |
| 953671 | #953671 | MERGED | Retire Monasca project | 15 |
| 709901 | #709901 | MERGED | [neutron] Transition Rocky to EM | 14 |
| 878253 | #878253 | MERGED | Add support for interim Ubuntu releases | 14 |
| 896552 | #896552 | MERGED | Migrate traefik ingress to v2 | 14 |
| 820195 | #820195 | MERGED | Updating the Yoga testing runtime | 13 |
| 820286 | #820286 | MERGED | Update Yoga testing runtime with new updates | 13 |
| 859939 | #859939 | NEW | Implement Gitea driver | 13 |
| 919374 | #919374 | MERGED | Retire Sahara project | 13 |
| 882165 | #882165 | MERGED | Add py38 as a PTI requirement for Python projects | 12 |
| 905000 | #905000 | MERGED | Avoid restarting dbus service | 12 |
| 871546 | #871546 | MERGED | Pin concurrent-ruby | 11 |

## 7. Changes that reference the most other changes

_Often merge/squash commits, stacked patch series, or changes that re-apply history (see the sample data: a single commit message can carry dozens of prior Change-Ids). Worth spot-checking whether these are genuine dependency chains or repository-migration noise._

| Change | Subject | Outgoing linkages |
|---|---|---|
| #834261 | ring: Introduce a v2 ring format | 23 |
| #836755 | Add support of Sigv4-streaming | 16 |
| #893578 | slo: refactor GET/HEAD response handling | 13 |
| #917711 | Add labeled metrics to proxy-logging | 13 |
| #931060 | Remove PrefixLoggerAdapter and SwiftLoggerAdapter | 13 |
| #826317 | Centos8 master jobs teardown - c8 on train/ussuri/victoria/wallaby | 13 |
| #890470 | Container-server: add container namespaces GET | 12 |
| #909882 | stats: API for native labeled metrics | 12 |
| #944073 | s3api: Validate additional checksums on upload | 12 |
| #959280 | feature: LRC (locally repairable code) backend | 11 |
| #797121 | Remove ovs agent's common constants module | 11 |
| #552924 | Proposes NUMA topology with RPs | 11 |
| #870620 | Release neutron for stable/xena | 11 |
| #829599 | update constraint for oslo.context to new release 4.1.0 | 11 |
| #958209 | Add skip action UI controls | 11 |
| #932201 | lib/glance: Remove support for deploying in standalone mode | 10 |
| #839897 | Remove release names starting from 2023.1 release | 10 |
| #808961 | [OVN] Off-path SmartNIC DPU Port Binding with OVN | 10 |
| #874806 | expirer: account and container level delay_reaping | 10 |
| #894580 | s3api: Support GET/HEAD request with ?partNumber | 10 |

## 8. Frequently-cited changes NOT found in this project's dataset

Either they belong to a different project/repo, or they weren't part of this retrieval run.

| Target change # | Times cited |
|---|---|
| 31954 | 11 |
| 36267 | 9 |
| 36256 | 8 |
| 28537 | 6 |
| 44234 | 6 |
| 45547 | 6 |
| 18953 | 5 |
| 28446 | 5 |
| 35174 | 5 |
| 36254 | 5 |
| 36356 | 5 |
| 36817 | 5 |
| 28458 | 4 |
| 32054 | 4 |
| 34926 | 4 |

## 9. Changes created per month

| Month | Changes |
|---|---|
| 2011-10 | 1 |
| 2012-06 | 1 |
| 2012-07 | 1 |
| 2012-08 | 2 |
| 2012-12 | 2 |
| 2013-01 | 5 |
| 2013-02 | 2 |
| 2013-03 | 5 |
| 2013-05 | 2 |
| 2013-06 | 3 |
| 2013-07 | 2 |
| 2013-08 | 6 |
| 2013-09 | 2 |
| 2013-10 | 4 |
| 2013-11 | 4 |
| 2013-12 | 6 |
| 2014-01 | 4 |
| 2014-02 | 10 |
| 2014-03 | 6 |
| 2014-04 | 21 |
| 2014-05 | 14 |
| 2014-06 | 5 |
| 2014-07 | 16 |
| 2014-08 | 9 |
| 2014-09 | 11 |
| 2014-10 | 12 |
| 2014-11 | 12 |
| 2014-12 | 28 |
| 2015-01 | 11 |
| 2015-02 | 16 |
| 2015-03 | 28 |
| 2015-04 | 29 |
| 2015-05 | 38 |
| 2015-06 | 41 |
| 2015-07 | 40 |
| 2015-08 | 56 |
| 2015-09 | 39 |
| 2015-10 | 94 |
| 2015-11 | 74 |
| 2015-12 | 86 |
| 2016-01 | 79 |
| 2016-02 | 105 |
| 2016-03 | 120 |
| 2016-04 | 104 |
| 2016-05 | 235 |
| 2016-06 | 277 |
| 2016-07 | 820 |
| 2016-08 | 202 |
| 2016-09 | 259 |
| 2016-10 | 266 |
| 2016-11 | 235 |
| 2016-12 | 210 |
| 2017-01 | 271 |
| 2017-02 | 255 |
| 2017-03 | 359 |
| 2017-04 | 219 |
| 2017-05 | 190 |
| 2017-06 | 272 |
| 2017-07 | 288 |
| 2017-08 | 271 |
| 2017-09 | 256 |
| 2017-10 | 219 |
| 2017-11 | 294 |
| 2017-12 | 245 |
| 2018-01 | 354 |
| 2018-02 | 336 |
| 2018-03 | 394 |
| 2018-04 | 293 |
| 2018-05 | 381 |
| 2018-06 | 506 |
| 2018-07 | 642 |
| 2018-08 | 530 |
| 2018-09 | 661 |
| 2018-10 | 922 |
| 2018-11 | 1222 |
| 2018-12 | 1234 |
| 2019-01 | 2070 |
| 2019-02 | 5502 |
| 2019-03 | 8659 |
| 2019-04 | 7713 |
| 2019-05 | 5980 |
| 2019-06 | 5744 |
| 2019-07 | 5585 |
| 2019-08 | 5619 |
| 2019-09 | 6312 |
| 2019-10 | 6601 |
| 2019-11 | 4315 |
| 2019-12 | 4043 |
| 2020-01 | 4488 |
| 2020-02 | 5272 |
| 2020-03 | 5865 |
| 2020-04 | 8323 |
| 2020-05 | 7291 |
| 2020-06 | 6645 |
| 2020-07 | 5549 |
| 2020-08 | 4898 |
| 2020-09 | 6251 |
| 2020-10 | 5274 |
| 2020-11 | 4028 |
| 2020-12 | 3746 |
| 2021-01 | 4446 |
| 2021-02 | 4610 |
| 2021-03 | 6271 |
| 2021-04 | 4807 |
| 2021-05 | 4845 |
| 2021-06 | 5066 |
| 2021-07 | 4061 |
| 2021-08 | 3671 |
| 2021-09 | 5204 |
| 2021-10 | 3944 |
| 2021-11 | 3774 |
| 2021-12 | 3223 |
| 2022-01 | 3875 |
| 2022-02 | 4038 |
| 2022-03 | 4760 |
| 2022-04 | 3945 |
| 2022-05 | 4080 |
| 2022-06 | 4092 |
| 2022-07 | 3280 |
| 2022-08 | 3729 |
| 2022-09 | 4584 |
| 2022-10 | 2988 |
| 2022-11 | 3088 |
| 2022-12 | 2601 |
| 2023-01 | 3375 |
| 2023-02 | 3312 |
| 2023-03 | 3348 |
| 2023-04 | 2659 |
| 2023-05 | 3013 |
| 2023-06 | 2484 |
| 2023-07 | 2703 |
| 2023-08 | 3229 |
| 2023-09 | 3531 |
| 2023-10 | 2728 |
| 2023-11 | 2482 |
| 2023-12 | 2030 |
| 2024-01 | 2854 |
| 2024-02 | 3295 |
| 2024-03 | 4090 |
| 2024-04 | 2914 |
| 2024-05 | 3096 |
| 2024-06 | 2159 |
| 2024-07 | 2322 |
| 2024-08 | 2224 |
| 2024-09 | 3286 |
| 2024-10 | 2910 |
| 2024-11 | 2895 |
| 2024-12 | 1493 |
| 2025-01 | 2199 |
| 2025-02 | 2475 |
| 2025-03 | 2935 |
| 2025-04 | 2568 |
| 2025-05 | 2848 |
| 2025-06 | 2372 |
| 2025-07 | 2374 |
| 2025-08 | 2632 |
| 2025-09 | 3576 |
| 2025-10 | 3164 |
| 2025-11 | 3076 |
| 2025-12 | 2936 |
| 2026-01 | 3270 |
| 2026-02 | 2941 |
| 2026-03 | 4586 |
| 2026-04 | 3800 |
| 2026-05 | 3922 |
| 2026-06 | 4686 |
| 2026-07 | 3656 |
| 2026-08 | 258 |

## 10. Developer reaction language (comments/log mentioning duplicate / depends-on / blocks / etc.)

| Keyword matched | Occurrences |
|---|---|
| abandon | 80350 |
| cherry pick | 47776 |
| depends on | 31931 |
| related to | 7837 |
| dependency | 7371 |
| duplicate | 4793 |
| same as | 4051 |
| cherry-pick | 3914 |
| not needed | 3239 |
| revert of | 2403 |
| fixed in | 2004 |
| blocks | 1066 |
| addressed in | 825 |
| duplicate of | 654 |
| replaced by | 447 |
| already done | 443 |
| blocked by | 312 |
| see also | 296 |
| replaces | 254 |
| already fixed | 248 |

See `reactions.csv` for the full list with authors, timestamps, and message snippets — this is the raw material for a 'how do developers actually respond to linkages' read (acknowledged & fixed vs. disputed vs. ignored vs. led to abandonment).

## 11. Sample of low-confidence linkages flagged for manual review

| Change | Raw match | Field | Context |
|---|---|---|---|
| #127848 | `id858081` | inline_comment | …sion has a plain style flow scalar that has no special introductory character.  See http://yaml.org |
| #710238 | `Ia18e9be4d` | inline_comment | …bvirt (4.0.0) and QEMU (2.11)   for "Ussuri" satisfy the version requirements; this was done    in  |
| #755190 | `Ic45dff740693` | change_comment | …py2.7, you can checkout train-last and use that version.  The main tempest code removed six support |
| #774554 | `id2796251` | inline_comment | It's standard YAML 'Folded Style' indicator: https://yaml.org/spec/1.2/spec.html#id2796251 A way to  |
| #776311 | `I19fb971de864` | inline_comment | Maybe I have a bad sample, but in other openstack clients (e.g., change I19fb971de864), this is kept |
| #776311 | `Ic9deaa001482` | inline_comment | …der-side change for mTLS in the connection to glance also has separate client cert and key paramete |
| #783079 | `I75014bd50b` | inline_comment | glance registry was deprecated in Queens and removed by change I75014bd50b in Victoria. |
| #785235 | `I3fd514126dbd` | inline_comment | …be a general encrypted volume issues note, and I can refer to that doc change Sofia made in victori |
| #790473 | `I2a521118` | inline_comment | Thanks for the careful review.  I can see an argument for I2a521118 because it exposes a new configu |
| #800014 | `Ie6c8bdf1f3a` | inline_comment | …e_io() will log       if not ignore_errors:           raise  (the exception chaining was introduced |
| #806817 | `I6d45aeab0651` | inline_comment | Here's the strategy in change I6d45aeab0651, that introduces mv 3.66 in cinder: - we will silently i |
| #810419 | `I9fc2ac1ea094` | change_comment | @Simon: the connector is named 'scaleio', but the backend that uses it is PowerFlex (change I9fc2ac1 |
| #810419 | `Iab5d66bbaab6` | change_comment | …med 'scaleio', but the backend that uses it is PowerFlex (change I9fc2ac1ea094 : ScaleIO -> VxFlex  |
| #813224 | `If99416e8a382` | change_comment | The redirect was added by Change If99416e8a382 in the stein time frame, but we neglected to include  |
| #814528 | `ieee1275` | change_comment | …arm-dbg grub-efi-arm grub-efi-arm64-bin grub-efi-arm64-dbg grub-efi-arm64 grub-efi-arm64-signed-tem |
| #826317 | `id2760395` | inline_comment | …was a bit hard to find a reference but found something relevant there https://yaml.org/spec/1.2-old |
| #828087 | `I2e86fa840490` | inline_comment | I agree with Muli's suggestion; you can add "This patch is a followup to change I2e86fa840490." befo |
| #832291 | `I17fbbdd0e889` | change_comment | Used change I17fbbdd0e889 locally to verify that the py36 and py39 unit tests can be run using the m |
| #835133 | `I6544e5d68714` | inline_comment | Just so no one gets confused, please add this line:    Includes the release note formatting fix from |
| #836058 | `I6b749fcc4594` | change_comment | This was done in cinder by change I6b749fcc4594, so we should do it in os-brick, too, to be consiste |
| #837350 | `I6aa753818ed3` | change_comment | Already done in cinder by change I6aa753818ed3, makes sense here also. |
| #839597 | `Iaa3a7892` | change_comment | Missed those on Iaa3a7892!  Thanks, Eric. |
| #839760 | `Ic481d68639d9` | change_comment | Has this been superseded by Ic481d68639d9 ?  If so, please abandon this patch. |
| #842432 | `I1333b0471974` | inline_comment | …r third-party CI systems that may not be running tempest in a greenfield environment.  So while cin |
| #842432 | `I07d74078dbb1` | inline_comment | …ors (who may need to refer to the protocol in volume-type extra-specs), the get-pools response was  |

(Showing 25 of 71 flagged linkages — query `linkages.csv` or the DB for the rest.)

## 12. Where to go for the full, unabridged data

- `openstack_changes.db` — SQLite database with **every** change, linkage, and reaction row. Open with `sqlite3`, DB Browser for SQLite, or pandas (`pd.read_sql`).
- `changes.csv` / `linkages.csv` / `reactions.csv` — the same data as flat files, one row per record, nothing aggregated away.
- `dashboard.html` — open in a browser to search/sort/page through every change and every linkage interactively.
