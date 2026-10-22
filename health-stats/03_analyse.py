"""
03_analyse.py - Statistical analysis and figures.

Methods:
  1. Linear trend per country (OLS on year) with confidence intervals
  2. Pooled relationship between coverage and log(cases+1)
  3. Change-point description: pre/post 2019 (COVID disruption)

Outputs: figures/*.png, data/analysis_results.json
"""

import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import statsmodels.api as sm
from matplotlib.ticker import MaxNLocator

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "data")
FIGS = os.path.join(HERE, "figures")
os.makedirs(FIGS, exist_ok=True)

plt.rcParams.update({
    "figure.dpi": 150,
    "savefig.dpi": 200,
    "font.size": 10,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.25,
    "grid.linestyle": "-",
})

PALETTE = "#1a5e3a"
ACCENT = "#c8102e"
GREY = "#666666"


def trend_table(df):
    """OLS slope of coverage against year, per country, with 95% CI."""
    rows = []
    for iso3, g in df.groupby("iso3"):
        g = g.dropna(subset=["coverage_pct"]).sort_values("year")
        if len(g) < 5:
            continue
        X = sm.add_constant(g["year"].astype(float))
        model = sm.OLS(g["coverage_pct"].astype(float), X).fit()
        ci = model.conf_int().loc["year"]
        rows.append({
            "iso3": iso3,
            "slope_pp_per_year": round(model.params["year"], 3),
            "ci_low": round(ci[0], 3),
            "ci_high": round(ci[1], 3),
            "p_value": round(model.pvalues["year"], 4),
            "r_squared": round(model.rsquared, 3),
            "n_years": len(g),
            "significant": bool(model.pvalues["year"] < 0.05),
        })
    return pd.DataFrame(rows).sort_values("slope_pp_per_year")


def fig_coverage_trends(df, trends):
    fig, ax = plt.subplots(figsize=(10, 5.5))
    years = sorted(df["year"].dropna().unique())
    global_mean = df.groupby("year")["coverage_pct"].mean()

    for iso3, g in df.groupby("iso3"):
        g = g.sort_values("year")
        ax.plot(g["year"], g["coverage_pct"], color=GREY, alpha=0.18, linewidth=0.8)

    ax.plot(global_mean.index, global_mean.values, color=PALETTE, linewidth=3,
            label="Mean of 25 countries", zorder=10)

    # annotate the two extremes of the trend table
    if len(trends) >= 2:
        for iso3, colour, label in [
            (trends.iloc[0]["iso3"], ACCENT, f"steepest decline: {trends.iloc[0]['iso3']}"),
            (trends.iloc[-1]["iso3"], PALETTE, f"steepest rise: {trends.iloc[-1]['iso3']}"),
        ]:
            g = df[df["iso3"] == iso3].sort_values("year")
            ax.plot(g["year"], g["coverage_pct"], color=colour, linewidth=2.2,
                    label=label, zorder=11)

    ax.set_xlabel("Year")
    ax.set_ylabel("MCV1 coverage, one-year-olds (%)")
    ax.set_title("Measles vaccination coverage, 2000-2025", loc="left", fontweight="bold")
    ax.set_ylim(0, 105)
    ax.xaxis.set_major_locator(MaxNLocator(integer=True, nbins=7))
    ax.legend(frameon=False, fontsize=8, loc="lower right")
    fig.tight_layout()
    path = os.path.join(FIGS, "fig1_coverage_trends.png")
    fig.savefig(path)
    plt.close(fig)
    return path


def fig_cases_heatmap(df):
    pivot = df.pivot_table(index="iso3", columns="year", values="cases", aggfunc="first")
    pivot = pivot.reindex(sorted(pivot.index))

    fig, ax = plt.subplots(figsize=(11, 6.5))
    # log scale so a single outbreak does not flatten everything else
    data = np.log10(pivot.fillna(0) + 1)
    im = ax.imshow(data.values, aspect="auto", cmap="YlOrRd", interpolation="nearest")

    ax.set_xticks(range(len(pivot.columns)))
    ax.set_xticklabels(pivot.columns, rotation=90, fontsize=6.5)
    ax.set_yticks(range(len(pivot.index)))
    ax.set_yticklabels(pivot.index, fontsize=7.5)
    ax.set_title("Reported measles cases by country and year (colour = log10 of cases + 1)",
                 loc="left", fontweight="bold")
    ax.grid(False)

    cbar = fig.colorbar(im, ax=ax, pad=0.02)
    cbar.set_label("log10(cases + 1)", fontsize=8)

    fig.tight_layout()
    path = os.path.join(FIGS, "fig2_cases_heatmap.png")
    fig.savefig(path)
    plt.close(fig)
    return path


def fig_coverage_vs_cases(df):
    d = df.dropna(subset=["coverage_pct", "cases"]).copy()
    d["log_cases"] = np.log10(d["cases"] + 1)

    fig, ax = plt.subplots(figsize=(8, 5.5))
    ax.scatter(d["coverage_pct"], d["log_cases"], s=14, alpha=0.45,
               color=PALETTE, edgecolors="none")

    # pooled OLS
    X = sm.add_constant(d["coverage_pct"].astype(float))
    model = sm.OLS(d["log_cases"].astype(float), X).fit()
    xs = np.linspace(d["coverage_pct"].min(), d["coverage_pct"].max(), 100)
    ys = model.params["const"] + model.params["coverage_pct"] * xs
    ax.plot(xs, ys, color=ACCENT, linewidth=2.5,
            label=f"OLS: slope {model.params['coverage_pct']:.4f}, R² {model.rsquared:.3f}")

    ax.set_xlabel("MCV1 coverage (%)")
    ax.set_ylabel("log10(reported cases + 1)")
    ax.set_title("Coverage against reported cases, all country-years",
                 loc="left", fontweight="bold")
    ax.legend(frameon=False, fontsize=9)

    fig.tight_layout()
    path = os.path.join(FIGS, "fig3_coverage_vs_cases.png")
    fig.savefig(path)
    plt.close(fig)
    return path, model


def fig_pre_post_covid(df):
    d = df.dropna(subset=["coverage_pct"]).copy()
    d["period"] = np.where(d["year"] < 2019, "2000-2018", "2019-2025")
    grouped = d.groupby(["period", "iso3"])["coverage_pct"].mean().unstack(0)
    grouped = grouped.dropna()
    if grouped.empty:
        return None

    fig, ax = plt.subplots(figsize=(7, 6))
    ax.scatter(grouped["2000-2018"], grouped["2019-2025"], s=40,
               color=PALETTE, alpha=0.7, edgecolors="white", linewidth=0.8)

    lo = min(grouped.min()) - 3
    hi = max(grouped.max()) + 3
    ax.plot([lo, hi], [lo, hi], color=GREY, linestyle="--", linewidth=1,
            label="no change")

    ax.set_xlim(lo, hi)
    ax.set_ylim(lo, hi)
    ax.set_xlabel("Mean coverage 2000-2018 (%)")
    ax.set_ylabel("Mean coverage 2019-2025 (%)")
    ax.set_title("Coverage before and after 2019", loc="left", fontweight="bold")
    ax.legend(frameon=False, fontsize=9)

    for iso3, row in grouped.iterrows():
        ax.annotate(iso3, (row["2000-2018"], row["2019-2025"]),
                    fontsize=6.5, alpha=0.75,
                    xytext=(3, 3), textcoords="offset points")

    fig.tight_layout()
    path = os.path.join(FIGS, "fig4_pre_post_2019.png")
    fig.savefig(path)
    plt.close(fig)
    return path, grouped


def main():
    df = pd.read_csv(os.path.join(DATA, "clean_measles.csv"))
    df = df.dropna(subset=["coverage_pct"])

    results = {}

    trends = trend_table(df)
    trends.to_csv(os.path.join(DATA, "trends_by_country.csv"), index=False)
    results["trend_countries"] = len(trends)
    results["trend_significant"] = int(trends["significant"].sum())
    results["steepest_rise"] = trends.iloc[-1].to_dict() if len(trends) else None
    results["steepest_fall"] = trends.iloc[0].to_dict() if len(trends) else None
    results["median_slope"] = float(trends["slope_pp_per_year"].median()) if len(trends) else None

    p1 = fig_coverage_trends(df, trends)
    p2 = fig_cases_heatmap(df)
    p3, model = fig_coverage_vs_cases(df)

    results["pooled_slope"] = round(float(model.params["coverage_pct"]), 4)
    results["pooled_r2"] = round(float(model.rsquared), 4)
    results["pooled_p"] = float(model.pvalues["coverage_pct"])

    pre_post = fig_pre_post_covid(df)
    if pre_post:
        p4, grouped = pre_post
        delta = (grouped["2019-2025"] - grouped["2000-2018"]).sort_values()
        results["pre_post"] = {
            "countries": len(delta),
            "improved": int((delta > 0).sum()),
            "declined": int((delta < 0).sum()),
            "largest_decline": {"iso3": delta.index[0], "pp": round(float(delta.iloc[0]), 2)},
            "largest_gain": {"iso3": delta.index[-1], "pp": round(float(delta.iloc[-1]), 2)},
        }
        results["figures"] = [p1, p2, p3, p4]
    else:
        results["figures"] = [p1, p2, p3]

    with open(os.path.join(DATA, "analysis_results.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(json.dumps(results, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
