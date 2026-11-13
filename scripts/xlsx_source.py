"""Read supplied XLSX tables without changing the source workbooks."""
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

def read_book(path):
    with ZipFile(path) as archive:
        strings = ["".join(t.itertext()) for t in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)]
        rels = {r.attrib["Id"]: r.attrib["Target"] for r in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        for sheet in ET.fromstring(archive.read("xl/workbook.xml")).findall("s:sheets/s:sheet", NS):
            rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            root = ET.fromstring(archive.read("xl/" + rels[rid]))
            rows = []
            for row in root.findall("s:sheetData/s:row", NS):
                cells = {}
                for cell in row.findall("s:c", NS):
                    val = cell.find("s:v", NS)
                    if val is not None and val.text is not None:
                        cells[cell.attrib["r"]] = strings[int(val.text)] if cell.attrib.get("t") == "s" else val.text
                if cells:
                    rows.append(cells)
            yield sheet.attrib["name"], rows

if __name__ == "__main__":
    for path in Path("Yibo data/Dataset").glob("*.xlsx"):
        if path.name.startswith("First"):
            continue
        print("\nBOOK", path.name)
        for name, rows in read_book(path):
            if name not in {"Cover", "Index", "raw"}:
                print("\nSHEET", name)
                for row in rows[:22]:
                    print(row)
