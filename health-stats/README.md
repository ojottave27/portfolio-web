# Measles vaccination coverage and reported cases — 25-country analysis

A reproducible data pipeline analysing the relationship between measles vaccination
coverage (MCV1) and reported measles cases across 25 countries, 2000–2025.

Data: [WHO Global Health Observatory](https://www.who.int/data/gho) — CC BY-NC-SA 3.0 IGO.

## What this demonstrates

- Fetching from a public health surveillance API with retry handling
- Cleaning with **documented decisions** rather than silent imputation
- Longitudinal trend estimation with confidence intervals per country
- A pooled association model, reported with its limitations rather than as a causal claim
- Publication-quality figures

## Run it

```
pip install -r requirements.txt
python 01_fetch.py      # downloads ~650 coverage + 1173 case rows from WHO
python 02_clean.py      # cleans, merges, writes decisions.json + quality_report.txt
python 03_analyse.py    # statistics + four figures
```

No manual steps. No hidden state. Running the three scripts from a clean checkout
reproduces every number in `REPORT.md`.

## Outputs

| Path | Contents |
|---|---|
| `data/clean_measles.csv` | Analysis-ready dataset, 650 rows |
| `data/decisions.json` | Every cleaning decision, machine-readable |
| `data/quality_report.txt` | Human-readable quality summary |
| `data/trends_by_country.csv` | Slope, 95% CI, p-value, R² per country |
| `data/analysis_results.json` | All computed statistics |
| `figures/fig1_coverage_trends.png` | 25 country trajectories + mean |
| `figures/fig2_cases_heatmap.png` | Cases by country-year, log colour scale |
| `figures/fig3_coverage_vs_cases.png` | Pooled scatter with OLS line |
| `figures/fig4_pre_post_2019.png` | Before/after comparison |
| `REPORT.md` | 10–15 page analysis report |

## Key methodological choice

**No imputation.** A missing case count is not a zero — it may mean no cases, no
reporting, or a reporting delay. Treating it as zero biases every downstream estimate
downward. The merge keeps unmatched rows and flags them (`has_coverage`, `has_cases`),
so any later analysis can apply its own policy. Every decision is logged.

## Key finding, stated honestly

Coverage explains **17.4%** of the variation in case counts (pooled OLS, p < 0.001).
The direction matches vaccination theory; the magnitude is modest because outbreaks
depend on local susceptible clustering, importation and surveillance intensity — none
of which are in the model. A much higher R² on this data would suggest leaked
information, not a better model.

## Limitations

Ecological design (country-year level). No causal identification. Reported cases
conflate incidence with surveillance effort. Country selection is purposive, not random.
Coverage is a national estimate and hides the subnational heterogeneity that drives
outbreaks. Full discussion in section 6 of `REPORT.md`.

## Licence

Data: CC BY-NC-SA 3.0 IGO (WHO). Non-commercial use, attribution required.
Analysis code: original work.
