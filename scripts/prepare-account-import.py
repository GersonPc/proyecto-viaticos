"""Validate the private CSV and optionally create a D1 import file outside Git.

Usage:
  python3 scripts/prepare-account-import.py /path/to/accounts.csv
  python3 scripts/prepare-account-import.py /path/to/accounts.csv --output /private/tmp/accounts.sql
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import os
import re
from pathlib import Path


HEADERS = ["Técnico", "Área", "Cuenta", "Tipo", "Banco", "Correo"]


def sql_value(value: str | None) -> str:
    return "NULL" if value is None else "'" + value.replace("'", "''") + "'"


def load_rows(source: Path) -> list[tuple[str, str, str | None, str | None, str | None]]:
    with source.open(encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        if reader.fieldnames != HEADERS:
            raise ValueError(f"Se esperaban estas columnas, en orden: {', '.join(HEADERS)}")
        records = list(reader)

    if not records:
        raise ValueError("El archivo no contiene colaboradores.")

    rows = []
    emails = set()
    for number, record in enumerate(records, start=2):
        if None in record:
            raise ValueError(f"Fila {number}: hay más columnas de las esperadas.")
        if any(value is None for value in record.values()):
            raise ValueError(f"Fila {number}: faltan columnas.")
        name = record["Técnico"].strip()
        email = record["Correo"].strip().lower()
        account = record["Cuenta"].strip() or None
        account_type = record["Tipo"].strip() or None
        bank = record["Banco"].strip() or None
        if not name or len(name) > 100:
            raise ValueError(f"Fila {number}: nombre vacío o demasiado largo.")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
            raise ValueError(f"Fila {number}: correo no válido.")
        if email in emails:
            raise ValueError(f"Fila {number}: correo duplicado.")
        if len({item is None for item in (account, account_type, bank)}) != 1:
            raise ValueError(f"Fila {number}: cuenta, tipo y banco deben estar completos o los tres vacíos.")
        if any(value and len(value) > limit for value, limit in ((account, 40), (account_type, 40), (bank, 80))):
            raise ValueError(f"Fila {number}: algún dato bancario es demasiado largo.")
        emails.add(email)
        rows.append((email, name, account, account_type, bank))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, help="Archivo SQL privado fuera del repositorio")
    args = parser.parse_args()
    rows = load_rows(args.source)
    missing = sum(row[2] is None for row in rows)
    print(f"Validado: {len(rows)} colaboradores; {missing} sin cuenta registrada.")

    if args.output:
        repository = Path(__file__).resolve().parents[1]
        destination = args.output.resolve()
        if destination == repository or repository in destination.parents:
            raise ValueError("El SQL con cuentas debe escribirse fuera del repositorio.")
        if destination.exists():
            raise ValueError("El archivo de salida ya existe; elige uno nuevo.")
        lines = ["DELETE FROM employee_accounts;"]
        for row in rows:
            values = ", ".join(sql_value(value) for value in row)
            lines.append(f"INSERT INTO employee_accounts (email, name, account_number, account_type, bank) VALUES ({values});")
        active_signature_keys = ", ".join(
            sql_value("signatures/" + hashlib.sha256(row[0].encode("utf-8")).hexdigest()) for row in rows
        )
        lines.append(f"DELETE FROM employee_signatures WHERE key NOT IN ({active_signature_keys});")
        descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as file:
            file.write("\n".join(lines) + "\n")
        print(f"SQL privado listo en: {destination}")


if __name__ == "__main__":
    main()
