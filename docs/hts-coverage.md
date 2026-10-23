# Full HTS dataset: sources and coverage

Built by `python3 scripts/build_hts.py` (stdlib plus `pdftotext`). The output goes to `data/hts/`.

**Source:** U.S. International Trade Commission, *Harmonized Tariff Schedule of the United States*, **2026 HTS Revision 21**. The release is dated 10/07/2026 and is effective 10/09/2026 per the USITC release list.
- JSON export: `https://hts.usitc.gov/reststop/exportList?from=0100&to=9999&format=JSON&styles=false`
- Chapter 99 (U.S. notes 16, 20, 31): `https://hts.usitc.gov/reststop/file?release=currentRelease&filename=Chapter%2099`
- Release list: `https://hts.usitc.gov/reststop/releaseList`

## Base schedule (`hts_base.csv` / `.json`)

The base schedule covers every 8-digit subheading and 10-digit statistical line in chapters 01–98: **23,696 lines** (19,949 ten-digit and 3,747 eight-digit).
- A statistical line with a blank General column inherits the rate of its nearest indented ancestor. These rows are flagged `inherited=true`.
- Special-column programs are parsed into `[{rate, programs[]}]`, and the raw text is kept too.

| Parsed General rate type | Lines |
|---|---:|
| ad valorem (`N%`) | 12,078 |
| Free | 8,657 |
| specific (`N¢/kg`, `$N/liter`, `N¢ each`, …) | 1,567 |
| compound (`specific + N%`) | 481 |
| other (text rule, or two specific parts) | 622 |
| no General rate (ch. 98 special provisions) | 291 |

The Column 2 rate ("other", for Cuba, North Korea, Russia and Belarus) and footnotes are left in the source and not parsed.

## Chapter 99 layer (`additional.csv` / `.json`)

The layer has **24,169 entries** covering **21,220 distinct lines**. Each entry is keyed by HTS line, origin and 9903 heading. 8-digit list entries are expanded to every 10-digit line under them.

| Measure | Heading | Origin | Add | Lines |
|---|---|---|---:|---:|
| Section 301 List 1 (note 20(b)) | 9903.88.01 | CN | +25% | 2,077 |
| Section 301 List 2 (note 20(d)) | 9903.88.02 | CN | +25% | 487 |
| Section 301 List 3 (note 20(f)) | 9903.88.03 | CN | +25% | 11,192 |
| Section 301 List 4A (note 20(s)(i)) | 9903.88.15 | CN | +7.5% | 6,332 |
| Section 301 four-year review (note 31(b),(c),(d),(f)–(j), in force) | 9903.91.01/.02/.03/.05/.06/.07/.08/.11 | CN | +25% to +100% | 1,225 |
| Section 232 steel, aluminum, copper and derivatives (note 16(c)(i)–(v)) | 9903.82.02 | ANY | +50% | 1,438 |
| Section 232, UK (note 16(c)(i)–(iv)) | 9903.82.04 | GB | +25% | 1,305 |
| Section 232 aluminum, Russia | 9903.85.67 / .68 | RU | +200% | 113 |

### Caveats: what is NOT covered

- **AD/CVD.** Antidumping and countervailing duties are case-, producer- and exporter-specific (Commerce/CBP). They are excluded, and note 16(b) confirms that they still apply on top.
- **IEEPA and "reciprocal" country-wide duties** (9903.01.xx / 9903.02.xx) are not modelled. They change often by executive order and depend on origin and exceptions.
- **Section 301 product exclusions** (9903.88.05–.70) and the **9903.91.09–.16** carve-outs (cranes, chassis, syringes) are not modelled. The listed rate is the maximum before any exclusion.
- **Section 232 conditions.** Outside chapters 72, 73, 74 and 76, a duty applies only if the metal is at least 15% of the article's weight. Duties apply to the metal-content value per note 16, and the headings are mutually exclusive. Derivative lists (c)(vi)–(xi) depend on country agreements (e.g. EU/JP 15% all-in) and are excluded. 232 autos and parts, lumber, trucks and other 232 actions are excluded.
- Quotas, TRQ in-quota/over-quota splits, Column 2 countries, de minimis, and FTA rule-of-origin eligibility are also out of scope.
- **Stacking.** The layer lists each measure separately and does not compute a combined total, because stacking rules vary (see the notes).

**This is not legal advice.** Confirm against the USITC HTS and CBP CSMS messages before you file.
