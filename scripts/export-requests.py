"""Export requests from a D1 SQL backup to a provider-neutral JSON document.

Usage: python3 scripts/export-requests.py /private/tmp/backup.sql --output /private/tmp/requests.json
The input and output contain private request data and must stay outside Git.
"""
import argparse
import hashlib
import json
import os
import sqlite3
from pathlib import Path


def export_requests(database):
    database.row_factory = sqlite3.Row
    requests = []
    for row in database.execute("SELECT * FROM travel_requests ORDER BY created_at, id"):
        item = dict(row)
        item["summary"] = json.loads(item.pop("summary_json"))
        revisions = {}
        for chunk in database.execute(
            "SELECT revision, chunk_index, content FROM request_snapshot_chunks WHERE request_id=? ORDER BY revision, chunk_index",
            (row["id"],),
        ):
            revisions.setdefault(chunk["revision"], []).append(chunk)
        item["snapshots"] = []
        for revision, chunks in revisions.items():
            if [c["chunk_index"] for c in chunks] != list(range(len(chunks))):
                raise ValueError(f"Snapshot incompleto: {row['id']} revisión {revision}")
            serialized = "".join(c["content"] for c in chunks)
            if revision == row["snapshot_revision"] and hashlib.sha256(serialized.encode("utf-8")).hexdigest() != row["snapshot_digest"]:
                raise ValueError(f"Snapshot alterado: {row['id']} revisión {revision}")
            payload = json.loads(serialized)
            item["snapshots"].append({"revision": revision, "payload": payload})
        if row["snapshot_revision"] not in revisions:
            raise ValueError(f"Falta el snapshot actual de {row['id']}")
        item["events"] = [dict(e) for e in database.execute(
            "SELECT revision, status, actor_email, reason, occurred_at FROM request_events WHERE request_id=? ORDER BY id",
            (row["id"],),
        )]
        requests.append(item)
    return {
        "schemaVersion": 1,
        "currency": "GTQ",
        "moneyUnit": "cent",
        "kilometerUnit": "hundredth",
        "timestampTimezone": "UTC",
        "requests": requests,
        "administrators": [dict(r) for r in database.execute("SELECT email, is_owner FROM request_administrators ORDER BY email")],
        "administratorEvents": [dict(r) for r in database.execute("SELECT * FROM administrator_events ORDER BY id")],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.backup.resolve() == args.output.resolve():
        parser.error("El archivo de salida debe ser distinto al respaldo.")
    if args.output.exists():
        parser.error("El archivo de salida ya existe; usa una ruta nueva.")
    with sqlite3.connect(":memory:") as database:
        database.executescript(args.backup.read_text(encoding="utf-8"))
        result = export_requests(database)
    # Exclusive creation avoids replacing an existing export, including a symlink.
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as target:
        json.dump(result, target, ensure_ascii=False, indent=2)
        target.write("\n")
    print(f"Exportadas {len(result['requests'])} solicitudes.")


if __name__ == "__main__":
    main()
