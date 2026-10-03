"""CIB folyószámlakivonat (.xls/.xlsx) beolvasása.

Elvárt szerkezet:
 - A11-től kezdve a konkrét tranzakciók, időben visszafelé (legújabb elöl).
 - A oszlop: dátum
 - B oszlop: tranzakció típusa
 - C oszlop: közlemény
 - D oszlop: összeg (kiadás = negatív, bevétel = pozitív)

A fájl A11-től kezdődő teljes tartalma beolvasásra kerül, dátum/hónap
szerinti szűrés NINCS — ez a main.py upload végpontjának felelőssége (ami
csak a már korábban betöltött, azonos tx_hash-ű rekordokat hagyja ki, hogy
ismételt/teljesebb feltöltéskor ne keletkezzen duplikátum)."""
import hashlib

import pandas as pd

HEADER_ROWS_TO_SKIP = 10  # A11 az első adatsor -> 10 sort kell átugrani (0-indexeltként)


def parse_cib_statement(filepath: str) -> list[dict]:
    df = None
    last_err = None
    for engine in ("xlrd", "openpyxl"):
        try:
            df = pd.read_excel(filepath, header=None, skiprows=HEADER_ROWS_TO_SKIP, engine=engine)
            break
        except Exception as e:  # próbáljuk a következő motort
            last_err = e
            continue
    if df is None:
        raise ValueError(f"Nem sikerült beolvasni az Excel fájlt: {last_err}")

    if df.shape[1] < 4:
        raise ValueError("A fájl nem tartalmazza a várt 4 oszlopot (dátum, típus, közlemény, összeg).")

    df = df.iloc[:, 0:4].copy()
    df.columns = ["date", "tx_type", "description", "amount"]
    df = df.dropna(subset=["date"])

    records: list[dict] = []
    for _, row in df.iterrows():
        try:
            d = pd.to_datetime(row["date"]).date()
        except Exception:
            continue
        try:
            amount = float(row["amount"])
        except Exception:
            continue
        records.append(
            {
                "date": d,
                "tx_type": str(row["tx_type"]).strip() if pd.notna(row["tx_type"]) else "",
                "description": str(row["description"]).strip() if pd.notna(row["description"]) else "",
                "amount": amount,
            }
        )
    return records


def make_hash(rec: dict) -> str:
    key = f"{rec['date'].isoformat()}|{rec['tx_type']}|{rec['description']}|{rec['amount']:.2f}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()
