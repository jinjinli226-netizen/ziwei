"""Isolated POSIX qualification. JS integration runs separately with Linux Node.

No original API/DB, service, credentials or system dependency is touched.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix="ziwei-lock-", dir="/tmp") as directory:
    filename = str(pathlib.Path(directory) / "current.sqlite")
    database = sqlite3.connect(filename)
    try:
        database.execute("PRAGMA journal_mode=DELETE")
        database.execute("CREATE TABLE sample(id INTEGER PRIMARY KEY)")
        database.commit()
        database.execute("BEGIN IMMEDIATE")
        database.execute("INSERT INTO sample VALUES(1)")

        def competitor():
            code = """import sqlite3,sys
db=sqlite3.connect(sys.argv[1], timeout=0)
try:
 db.execute('INSERT INTO sample VALUES(2)');db.commit();print('wrote')
except sqlite3.OperationalError:
 print('locked')
finally:
 db.close()
"""
            return subprocess.check_output([sys.executable, "-c", code, filename], text=True, timeout=10).strip()

        assert competitor() == "locked"
        original = os.stat(filename)
        observed = 0
        for _ in range(3):
            for name in os.listdir("/proc/self/fd"):
                try:
                    descriptor = int(name)
                    identity = os.fstat(descriptor)
                    os.readlink("/proc/self/fd/" + name)
                    if identity.st_dev == original.st_dev and identity.st_ino == original.st_ino:
                        assert os.pread(descriptor, 16, 0) == b"SQLite format 3\x00"
                        observed += 1
                except (FileNotFoundError, OSError):
                    continue
        assert observed >= 3
        assert competitor() == "locked"
        database.commit()
        assert competitor() == "wrote"
        assert database.execute("SELECT count(*) FROM sample").fetchone()[0] == 2
        print(json.dumps({"suite": "isolated Linux POSIX SQLite lock", "beforeIdentity": "locked", "afterIdentity": "locked", "afterCommit": "wrote", "existingFdReads": observed, "jsIntegration": "pending-native-Linux-Node", "passed": True}))
    finally:
        database.close()
