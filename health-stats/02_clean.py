"""
02_clean.py - Clean and reconcile the two WHO measles indicators.

Design principle: every decision about missing or inconsistent data is
RECORDED, not silently applied. The output includes a decisions log so the
reader can see exactly what was changed and why.

Inputs : data/raw_mslv.json   (MCV1 coverage %, WHS8_110)
         data/raw_cases.json  (reported measles cases, WHS3_62)
Outputs: data/clean_measles.csv
         data/decisions.json
         data/quality_report.txt
"""

import json
import os
from collections import defaultdict

import pandas as pd

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "data")

YEARS = (2000, 2025)  # coverage data starts in 2000; earlier cases have no denominator


def load_json(name):
    path = os.path.join(DATA, name)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def to_frame(rows, value_col, source):
    """Flatten API rows into a tidy frame, keeping provenance."""
    records = []
    for r in rows:
        records.append({
            "iso3": r.get("SpatialDim"),
            "year": r.get("TimeDim"),
            "sex": r.get("Dim1"),
            value_col: r.get("NumericValue"),
            "low": r.get("Low"),
            "high": r.get("High"),
            "source": source,
        })
    return pd.DataFrame(records)


def main():
    decisions = []
    quality = []

    # ---------- coverage ----------
    cov = to_frame(load_json("raw_mslv.json"), "coverage", "WHS8_110")
    quality.append(f"coverage: {len(cov)} raw rows")

    before = len(cov)
    cov = cov[cov["sex"].isin(["BTSX", None]) | cov["sex"].isna()]
    if len(cov) < before:
        decisions.append({
            "step": "coverage_sex_filter",
            "dropped": before - len(cov),
            "reason": "kept only 'Both sexes' (BTSX) rows; sex-disaggregated rows would double-count",
        })

    before = len(cov)
    cov = cov[cov["year"].between(*YEARS)]
    if len(cov) < before:
        decisions.append({
            "step": "coverage_year_filter",
            "dropped": before - len(cov),
            "reason": f"restricted to {YEARS[0]}-{YEARS[1]}, the window where both indicators overlap",
        })

    before = len(cov)
    cov = cov[cov["coverage"].between(0, 100)]
    if len(cov) < before:
        decisions.append({
            "step": "coverage_range_check",
            "dropped": before - len(cov),
            "reason": "coverage outside 0-100% is not physically meaningful",
        })

    before = len(cov)
    cov = cov.drop_duplicates(subset=["iso3", "year"], keep="first")
    if len(cov) < before:
        decisions.append({
            "step": "coverage_dedupe",
            "dropped": before - len(cov),
            "reason": "duplicate (country, year) pairs; kept first occurrence",
        })

    cov = cov[["iso3", "year", "coverage"]].rename(columns={"coverage": "coverage_pct"})
    quality.append(f"coverage: {len(cov)} clean rows, {cov['iso3'].nunique()} countries")

    # ---------- cases ----------
    cases = to_frame(load_json("raw_cases.json"), "cases", "WHS3_62")
    quality.append(f"cases: {len(cases)} raw rows")

    before = len(cases)
    cases = cases[cases["sex"].isin(["BTSX", None]) | cases["sex"].isna()]
    if len(cases) < before:
        decisions.append({
            "step": "cases_sex_filter",
            "dropped": before - len(cases),
            "reason": "kept only 'Both sexes' rows",
        })

    before = len(cases)
    cases = cases[cases["year"].between(*YEARS)]
    if len(cases) < before:
        decisions.append({
            "step": "cases_year_filter",
            "dropped": before - len(cases),
            "reason": f"restricted to {YEARS[0]}-{YEARS[1]} to match the coverage window",
        })

    before = len(cases)
    cases = cases[cases["cases"] >= 0]
    if len(cases) < before:
        decisions.append({
            "step": "cases_negative_check",
            "dropped": before - len(cases),
            "reason": "negative case counts are data errors",
        })

    before = len(cases)
    cases = cases.drop_duplicates(subset=["iso3", "year"], keep="first")
    if len(cases) < before:
        decisions.append({
            "step": "cases_dedupe",
            "dropped": before - len(cases),
            "reason": "duplicate (country, year) pairs; kept first occurrence",
        })

    cases = cases[["iso3", "year", "cases"]]
    quality.append(f"cases: {len(cases)} clean rows, {cases['iso3'].nunique()} countries")

    # ---------- merge ----------
    merged = pd.merge(cov, cases, on=["iso3", "year"], how="outer", indicator=True)
    only_cov = int((merged["_merge"] == "left_only").sum())
    only_cases = int((merged["_merge"] == "right_only").sum())
    both = int((merged["_merge"] == "both").sum())

    decisions.append({
        "step": "merge",
        "only_in_coverage": only_cov,
        "only_in_cases": only_cases,
        "in_both": both,
        "reason": "outer join on (country, year); unmatched rows are KEPT and flagged, not dropped",
    })

    # ---------- missing ----------
    # We do NOT impute. Gaps are documented per country so the analyst and the
    # reader both know where the series is incomplete.
    merged["has_coverage"] = merged["coverage_pct"].notna()
    merged["has_cases"] = merged["cases"].notna()
    merged["complete"] = merged["has_coverage"] & merged["has_cases"]

    gaps = defaultdict(list)
    for iso3, group in merged.groupby("iso3"):
        missing_years = sorted(
            set(range(YEARS[0], YEARS[1] + 1)) - set(group["year"].tolist())
        )
        if missing_years:
            gaps[iso3] = missing_years

    decisions.append({
        "step": "missing_values",
        "approach": "no imputation",
        "reason": (
            "imputing surveillance counts would fabricate data. Gaps are reported "
            "per country in quality_report.txt so the reader knows where a trend "
            "line is incomplete."
        ),
        "countries_with_gaps": len(gaps),
    })

    merged = merged.drop(columns=["_merge"]).sort_values(["iso3", "year"])

    out_csv = os.path.join(DATA, "clean_measles.csv")
    merged.to_csv(out_csv, index=False)
    quality.append(f"merged: {len(merged)} rows -> {out_csv}")

    with open(os.path.join(DATA, "decisions.json"), "w", encoding="utf-8") as f:
        json.dump(decisions, f, indent=2, ensure_ascii=False)

    # ---------- quality report ----------
    lines = [
        "DATA QUALITY REPORT - WHO measles indicators",
        "=" * 60,
        "Source: WHO Global Health Observatory (CC BY-NC-SA 3.0 IGO)",
        f"Window: {YEARS[0]}-{YEARS[1]}",
        "",
        "Row counts",
        "-" * 60,
    ]
    lines += ["  " + q for q in quality]
    lines += ["", "Coverage completeness", "-" * 60]
    cov_complete = merged["has_coverage"].mean() * 100
    lines.append(f"  {cov_complete:.1f}% of country-years have a coverage value")
    lines += ["", "Countries with year gaps", "-" * 60]
    if gaps:
        for iso3 in sorted(gaps):
            lines.append(f"  {iso3}: {len(gaps[iso3])} missing year(s) -> {gaps[iso3][:6]}{'...' if len(gaps[iso3]) > 6 else ''}")
    else:
        lines.append("  none")

    lines += ["", "Decisions applied", "-" * 60]
    for d in decisions:
        lines.append(f"  [{d['step']}] {d.get('reason', '')}")
        for k, v in d.items():
            if k not in ("step", "reason"):
                lines.append(f"      {k}: {v}")

    report_path = os.path.join(DATA, "quality_report.txt")
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    print("\n".join(lines))
    print(f"\nWritten: {out_csv}")
    print(f"Written: {report_path}")


if __name__ == "__main__":
    main()
