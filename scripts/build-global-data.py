"""Build joint national filters and separate state breakdowns from supplied workbooks."""
import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from xlsx_source import read_book

ROOT = Path(__file__).resolve().parents[1]
NATIONAL = "Yibo data/Dataset/hospitalisation_injury_publication_sep2023.xlsx"
STATES = "Yibo data/Dataset/state-and-territory-hospitalisation-injury-publication-2023.xlsx"
baseline = json.loads((ROOT / "data/chart-data.json").read_text(encoding="utf-8"))
years = [str(year) for year in range(2011, 2022)]
ages = [row["label"] for row in baseline["q3"]] + ["Unknown"]
sexes = ["Male", "Female", "Other / not recorded"]
groups = [row["label"] for row in baseline["q5"]]


def fields(row):
    return {cell.rstrip("0123456789"): value for cell, value in row.items()}


def number(row, col):
    value = float(row[col])
    assert math.isfinite(value) and value.is_integer() and value >= 0, (col, value)
    return int(value)


def group(road):
    return {"Motorcyclist": "Motorcyclists", "Pedal cyclist": "Cyclists", "Pedestrian": "Pedestrians",
            "Other or unknown": "Other or unknown"}.get(road, "Vehicle occupants")


cube = defaultdict(lambda: [0, 0])
for name, rows in read_book(ROOT / NATIONAL):
    if name != "raw":
        continue
    for source in rows[1:]:
        row = fields(source)
        if row.get("D") != "Traffic":
            continue
        year, age, sex, road = row["A"], row["E"], row["F"], row["G"]
        age = "Unknown" if age == "Missing" else age
        sex = sex if sex in sexes else "Other / not recorded"
        assert year in years and age in ages
        assert road in {"Car driver", "Car passenger", "Car unknown position", "Heavy transport driver",
                        "Heavy transport passenger", "Heavy transport unknown position", "Pick-up truck or van occupant",
                        "Bus occupant", "Motorcyclist", "Pedal cyclist", "Pedestrian", "Other or unknown"}
        cell = cube[(year, age, sex, road)]
        cell[0] += number(row, "M")
        # Keep reported Bed days, matching the existing E3 exports exactly.
        cell[1] += number(row, "J")
records = [{"year": y, "age": a, "sex": s, "road": r, "group": group(r), "cases": values[0], "beds": values[1]}
           for (y, a, s, r), values in sorted(cube.items())]


def total(predicate, metric="cases"):
    return sum(row[metric] for row in records if predicate(row))


for row in baseline["q1"]:
    assert total(lambda r: r["year"] == row["label"]) == row["value"]
for row in baseline["q3"]:
    assert total(lambda r: r["year"] == "2021" and r["age"] == row["label"]) == row["value"]
for row in baseline["q4"]:
    for sex in ["Male", "Female"]:
        assert total(lambda r: r["year"] == row["label"] and r["sex"] == sex) == row[sex]
for row in baseline["q5"]:
    assert total(lambda r: r["year"] == "2021" and r["group"] == row["label"]) == row["value"]
for row in baseline["e1"]:
    denominator = total(lambda r: r["year"] == row["label"])
    for road_group in groups:
        assert math.isclose(total(lambda r: r["year"] == row["label"] and r["group"] == road_group) / denominator * 100, row[road_group])
for row in baseline["e2"]:
    assert total(lambda r: r["year"] == "2021" and r["age"] == row["age"] and r["road"] == row["road"]) - total(
        lambda r: r["year"] == "2011" and r["age"] == row["age"] and r["road"] == row["road"]) == row["value"]
for key, dimension in [("e3a", "group"), ("e3b", "age")]:
    case_total = total(lambda r: r["year"] >= "2016")
    bed_total = total(lambda r: r["year"] >= "2016", "beds")
    for row in baseline[key]:
        assert math.isclose(total(lambda r: r["year"] >= "2016" and r[dimension] == row["label"]) / case_total * 100, row["Hospitalisations"])
        assert math.isclose(total(lambda r: r["year"] >= "2016" and r[dimension] == row["label"], "beds") / bed_total * 100, row["Bed days"])

state_codes = {"NSW": "NSW", "Vic": "VIC", "Qld": "QLD", "SA": "SA", "WA": "WA", "Tas": "TAS", "NT": "NT", "ACT": "ACT"}
state_cube = defaultdict(int)
for name, rows in read_book(ROOT / STATES):
    if name != "raw":
        continue
    for source in rows[2:]:
        row = fields(source)
        for dimension, year_col, value_col, state_col, label_col in [
            ("total", "A", "D", "F", None), ("group", "H", "L", "N", "K"),
            ("sex", "P", "T", "V", "S"), ("age", "X", "AB", "AD", "AA"),
        ]:
            if year_col not in row:
                continue
            year, state = row[year_col], state_codes[row[state_col]]
            assert year in years
            label = row[label_col] if label_col else "all"
            if dimension == "group":
                label = group(label)
            key = (year, state, dimension, label)
            if row[value_col] == "n.p.":
                state_cube[key] = None
            elif state_cube[key] is not None:
                state_cube[key] += number(row, value_col)

# Preserve unrecorded classifications as residuals, never assign them to a demographic.
for year in years:
    for state in state_codes.values():
        overall = state_cube[(year, state, "total", "all")]
        for dimension, labels, missing in [("sex", sexes[:2], sexes[2]), ("age", ages[:-1], "Unknown")]:
            values = [state_cube[(year, state, dimension, label)] for label in labels]
            remainder = overall - sum(values) if all(value is not None for value in values) else None
            assert remainder is None or remainder >= 0, (year, state, dimension, remainder)
            state_cube[(year, state, dimension, missing)] = remainder
        values = [state_cube[(year, state, "group", label)] for label in groups]
        if all(value is not None for value in values):
            assert sum(values) == overall
for row in baseline["q2"]:
    assert state_cube[("2021", row["code"], "total", "all")] == row["value"]
states = [{"year": y, "state": s, "dimension": d, "label": label, "cases": value}
          for (y, s, d, label), value in sorted(state_cube.items())]
result = {
    "years": years, "ages": ages, "sexes": sexes, "groups": groups,
    "records": records, "states": states,
    "sources": {
        "national": NATIONAL, "nationalSheet": "raw", "nationalFilter": "Cause of injury = Traffic",
        "nationalFields": {"cases": "Hospitalisations (column M)", "beds": "Bed days (column J)"},
        "states": STATES, "stateSheet": "raw",
        "stateLimit": "Year plus at most one of road-user group, sex or age. Joint demographic counts are not supplied. Any n.p. source cell makes its aggregated state value null; suppressed counts are never imputed.",
        "validation": "All annual national and sex totals, 2021 age/road-user/state counts, 28 E2 differences, and all E3 2016-2021 shares match the existing CSV charts.",
    },
}
(ROOT / "data/global-data.json").write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(f"Validated {len(records)} national joint cells and {len(states)} separate state cells against existing charts.")
