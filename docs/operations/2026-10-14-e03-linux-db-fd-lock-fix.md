# E03 Linux API database FD observation correction

The previous identity observer reopened `/proc/self/fd/N` to read a SQLite header and closed that new descriptor inside the API process. A close on the same inode can release the process's POSIX advisory SQLite locks. [SQLite's official section 2.2](https://www.sqlite.org/howtocorrupt.html#_posix_advisory_locks_canceled_by_a_separate_thread_doing_close) describes this failure mode.

The correction uses `fstat` and `readlink` on existing descriptors, then a positional read of the existing descriptor. It never opens or closes a descriptor for the SQLite inode. The conservative same-inode/all-open-SQLite-files identity check remains. No original service or database was tested or modified.

Native Linux qualification used WSL Ubuntu, a separately approved Node v24.9.0 archive unpacked only under E03's private `.local/native-linux-node-v24.9.0` directory, and SQLite files created under Linux `/tmp`. No runtime was globally installed, no PATH/system configuration changed, and no business service started. Archive SHA256 `f52ec50e959d72d5c680d9731420b2661cd2a8070e94c7369b6ddfcd8b7278be` matches the [official Node checksums](https://nodejs.org/download/release/v24.9.0/SHASUMS256.txt).

`test/preservation-api-linux-lock.test.mjs` holds a real `BEGIN IMMEDIATE` transaction, launches a separate native Node/SQLite competitor, invokes the actual exported identity observer three times, and checks the competitor remains locked. After commit, the competitor writes successfully. The old ac1b4d5 observer fails this same regression by releasing the lock; the corrected observer passes. `test/preservation-api-linux-lock.py` independently verifies the corresponding existing-FD POSIX primitives with Python sqlite3 and a separate Python competitor. Python verification is separate from actual JS integration verification.

Exact JS command on an existing native Linux Node host:

```sh
node --test --test-reporter=spec test/preservation-api-linux-lock.test.mjs
```

E03's native Linux run reported 1/1 passed, zero skipped. Python reported locked before identity, locked after three existing-FD reads, and writable only after commit. Windows source/identity fixtures remain separate and are not included in this urgent fix commit. The Windows implementation draft was saved in an explicit task-local Git stash before this correction and will resume after the clean fix checkpoint.
