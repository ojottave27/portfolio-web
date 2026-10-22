"""
01_fetch.py - Download measles indicators from the WHO Global Health Observatory.

Source : WHO Global Health Observatory (GHO) - https://www.who.int/data/gho
API    : https://ghoapi.azureedge.net/api/{IndicatorCode}
Licence: CC BY-NC-SA 3.0 IGO (attribution required, non-commercial)

Two indicators:
  mslv    - Measles immunization coverage among one-year-olds (%)
  WHS3_62 - Measles - number of reported cases

Output: data/raw_mslv.json, data/raw_cases.json
"""

import json
import os
import time
import urllib.error
import urllib.request

API = "https://ghoapi.azureedge.net/api/{code}"
OUT = os.path.join(os.path.dirname(__file__), "data")

# A spread of countries: high-income, middle-income, large population, island states.
# Chosen to give the analysis enough variation to be meaningful.
COUNTRIES = [
    "CHE", "DEU", "FRA", "ITA", "AUT", "GBR", "ESP", "POL",  # Europe
    "USA", "CAN", "BRA", "MEX",                                # Americas
    "IND", "PAK", "BGD", "IDN", "CHN", "JPN",                  # Asia
    "NGA", "ETH", "KEN", "ZAF", "EGY",                        # Africa
    "AUS", "NZL",                                             # Oceania
]

INDICATORS = {
    "WHS8_110": "raw_mslv.json",   # MCV1 measles immunization coverage (%)
    "WHS3_62": "raw_cases.json",   # Measles - reported cases
}


def fetch(code, retries=3):
    url = API.format(code=code)
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "health-stats-demo/1.0"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  attempt {attempt}/{retries} failed: {e}")
            if attempt == retries:
                raise
            time.sleep(3 * attempt)


def main():
    os.makedirs(OUT, exist_ok=True)

    for code, filename in INDICATORS.items():
        print(f"Fetching {code} ...")
        raw = fetch(code)
        rows = raw.get("value", [])
        print(f"  {len(rows)} rows returned by the API")

        # Keep only our country list and rows that carry a numeric value.
        kept = [
            r for r in rows
            if r.get("SpatialDim") in COUNTRIES and r.get("NumericValue") is not None
        ]
        print(f"  {len(kept)} rows kept after country filter")

        path = os.path.join(OUT, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(kept, f, ensure_ascii=False)

        years = sorted({r["TimeDim"] for r in kept})
        if years:
            print(f"  years: {years[0]}-{years[-1]}  ({len(years)} distinct)")
        print(f"  written to {path}\n")

    print("Done. Next: python 02_clean.py")


if __name__ == "__main__":
    main()
