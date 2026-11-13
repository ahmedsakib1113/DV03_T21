"""Build existing website charts directly from Yibo's latest KNIME CSV exports.

Only chart data is written; the page, styling, explanations and interactions
are kept intact. Uses Python's standard library and leaves source CSVs unchanged.
"""
from pathlib import Path
import csv
import json
import math

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "q1": "Yibo data/Q1/Q1_national_annual_hospitalisations_2011_2021.csv",
    "q2": "Yibo data/Q2/Q2_state_territory_hospitalisations_2021.csv",
    "q3": "Yibo data/Q3/Q3_age_group_hospitalisations_2021.csv",
    "q4": "Yibo data/Q4/Q4_male_female_hospitalisations_2011_2021.csv",
    "q5": "Yibo data/Q5/Q5_road_user_group_hospitalisations_2021.csv",
    "e1": "Yibo data/E1/E1_road_user_annual_shares_2011_2021.csv",
    "e2": "Yibo data/E2/E2_age_road_user_change_2011_2021.csv",
    "e3a": "Yibo data/E3/E3a/E3a_road_user_hospitalisation_bed_day_shares.csv",
    "e3b": "Yibo data/E3/E3b/E3b_age_hospitalisation_bed_day_shares.csv",
}
ROAD_GROUPS = ["Vehicle occupants", "Motorcyclists", "Cyclists", "Pedestrians", "Other or unknown"]
ROAD_USERS = ["Car driver", "Motorcyclist", "Pedal cyclist", "Pedestrian"]
STATE_NAMES = {
    "NSW": "New South Wales", "Vic": "Victoria", "Qld": "Queensland",
    "SA": "South Australia", "WA": "Western Australia", "Tas": "Tasmania",
    "NT": "Northern Territory", "ACT": "Australian Capital Territory",
}

def read_csv(key):
    with (ROOT / SOURCES[key]).open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    assert rows, f"{key}: source CSV is empty"
    return rows

def number(row, field):
    value = float(row[field])
    assert math.isfinite(value), f"Invalid value in {field}: {row[field]}"
    return value

def integer(row, field):
    value = number(row, field)
    assert value.is_integer(), f"Count must be a whole number: {field}"
    return int(value)

def age_order(label):
    return int(label.split("-")[0].rstrip("+"))

def close(left, right):
    return math.isclose(left, right, rel_tol=1e-10, abs_tol=1e-9)

source = {key: read_csv(key) for key in SOURCES}
q1 = [{"label": r["Calendar year"], "value": integer(r, "Sum(Hospitalisations)")}
      for r in sorted(source["q1"], key=lambda r: int(r["Calendar year"]))]
state_rows = {r["state or territory"]: r for r in source["q2"]}
assert len(state_rows) == len(source["q2"]) == 8
q2 = []
for code, name in STATE_NAMES.items():
    row = state_rows[code]
    assert row["calendar year"] == "2021"
    q2.append({"label": name, "code": code.upper(),
               "value": integer(row, "Sum(count of cases excluding died in hospitals within 30 days)")})
q3 = [{"label": r["Age group"], "value": integer(r, "Sum(Hospitalisations)")}
      for r in sorted(source["q3"], key=lambda r: age_order(r["Age group"]))]
q4 = [{"label": r["Calendar year"], "Male": integer(r, "Male"), "Female": integer(r, "Female")}
      for r in sorted(source["q4"], key=lambda r: int(r["Calendar year"]))]
road_rows = {r["Road user group"]: r for r in source["q5"]}
assert len(road_rows) == len(source["q5"]) == len(ROAD_GROUPS)
q5 = [{"label": group, "value": integer(road_rows[group], "Sum(Hospitalisations)")}
      for group in ROAD_GROUPS]
assert all(r["Calendar year"] == "2021" for r in source["q3"] + source["q5"])

e1 = []
for row in sorted(source["e1"], key=lambda r: int(r["Calendar year"])):
    total = integer(row, "Annual total")
    assert total > 0 and sum(integer(row, group) for group in ROAD_GROUPS) == total
    result = {"label": row["Calendar year"]}
    for group in ROAD_GROUPS:
        # This export supplies four share columns; derive the remaining share
        # from its exported Other or unknown count and the same annual total.
        calculated = integer(row, group) / total * 100
        result[group] = calculated if group == "Other or unknown" else number(row, group + " share (%)")
        assert close(result[group], calculated), f"E1 share/count mismatch: {group}"
    e1.append(result)

e2 = []
for row in sorted(source["e2"], key=lambda r: (int(r["Age order"]), ROAD_USERS.index(r["Road user"]))):
    change = integer(row, "Change 2011-2021")
    assert change == integer(row, "2021") - integer(row, "2011")
    age, road = row["Age group"], row["Road user"]
    e2.append({"age": age, "road": road, "label": age + " / " + road, "value": change})

def burden_shares(key, label_field, order):
    rows = {r[label_field]: r for r in source[key]}
    assert len(rows) == len(source[key]) == len(order), f"{key}: missing or duplicate groups"
    result = []
    for label in order:
        row = rows[label]
        cases = integer(row, "Sum(Hospitalisations)")
        beds = integer(row, "Sum(Bed days)")
        total_cases = integer(row, "Sum(Hospitalisations) (#1)")
        total_beds = integer(row, "Sum(Bed days) (#1)")
        assert total_cases > 0 and total_beds > 0
        case_share = number(row, "Hospitalisation share (%)")
        bed_share = number(row, "Bed-day share (%)")
        assert close(case_share, cases / total_cases * 100)
        assert close(bed_share, beds / total_beds * 100)
        result.append({"label": label, "Hospitalisations": case_share, "Bed days": bed_share})
    assert close(sum(row["Hospitalisations"] for row in result), 100)
    assert close(sum(row["Bed days"] for row in result), 100)
    return result

data = {
    "q1": q1, "q2": q2, "q3": q3, "q4": q4, "q5": q5,
    "e1": e1, "e2": e2,
    "e3a": burden_shares("e3a", "Road user group", ROAD_GROUPS),
    "e3b": burden_shares("e3b", "Age group", [r["label"] for r in q3]),
    "sources": {
        "national": "Yibo data/Dataset/hospitalisation_injury_publication_sep2023.xlsx",
        "states": "Yibo data/Dataset/state-and-territory-hospitalisation-injury-publication-2023.xlsx",
        "csv": SOURCES,
        "methods": {
            "q1": "Annual hospitalisations from the Q1 CSV.",
            "q2": "2021 jurisdiction counts from the Q2 CSV; state codes mapped to map names.",
            "q3": "2021 counts from the Q3 CSV, in age order.",
            "q4": "Annual male and female counts from the Q4 CSV.",
            "q5": "2021 counts from the Q5 CSV, in the existing chart order.",
            "e1": "Exported annual shares; Other or unknown share equals its exported count divided by Annual total times 100.",
            "e2": "Exported Change 2011-2021, checked against each row's 2021 minus 2011 counts.",
            "e3a": "Exported road-user hospitalisation and bed-day shares, checked against counts and totals.",
            "e3b": "Exported age-group hospitalisation and bed-day shares, checked against counts and totals.",
        },
        "map": "https://github.com/rowanhogan/australian-states/blob/master/states.geojson",
    },
}
years = [str(year) for year in range(2011, 2022)]
assert [r["label"] for r in q1] == [r["label"] for r in q4] == [r["label"] for r in e1] == years
for key, rows in data.items():
    if key != "sources":
        assert len({r["label"] for r in rows}) == len(rows), f"{key}: duplicate chart labels"
annual_2021 = q1[-1]["value"]
assert sum(r["value"] for r in q3) == sum(r["value"] for r in q5) == annual_2021
assert len(e2) == len(q3) * len(ROAD_USERS)
assert {r["label"] for r in e2} == {a["label"] + " / " + road for a in q3 for road in ROAD_USERS}

output = ROOT / "data/chart-data.json"
previous = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {}
changed = []
for key in SOURCES:
    old_rows = {r["label"]: r for r in previous.get(key, [])}
    for row in data[key]:
        old_row = old_rows.get(row["label"], {})
        for field, value in row.items():
            if isinstance(value, (int, float)) and not close(value, old_row.get(field, float("nan"))):
                changed.append(f"{key}: {row['label']} / {field}")
output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Built all nine existing charts directly from Yibo's latest CSV exports.")
print("Validated source totals, unique labels, E1/E3 percentages and all 28 E2 changes.")
print(f"Material numeric changes compared with the previous chart data: {len(changed)}")
for item in changed:
    print(item)
