# SA-11 benchmark (2026-09-19T18:03:32.546Z, local PostgreSQL 18, dimension=shape, 365D, median of 3)

Queries per request — database path: 2 aggregate queries (+1 label lookup for Customer/Weight Band), returning one row per group/bucket. Previous path: 1 query returning every qualifying stone row (+1 label lookup).

| Invoice rows | Pieces | Result vs in-memory | DB aggregation | In-memory (previous) | Heap Δ DB | Heap Δ in-memory | Previous production path (50k ceiling) |
|---|---|---|---|---|---|---|---|
| 1,000 | 1000 | identical | 2 ms | 8 ms | 0.0 MB | 0.0 MB | ok |
| 10,000 | 10000 | identical | 11 ms | 65 ms | 0.0 MB | 15.7 MB | ok |
| 60,000 | 60000 | identical | 42 ms | 366 ms | 0.0 MB | 86.5 MB | 503 RESULT_LIMIT_EXCEEDED |

Heap Δ is a noisy single-process indicator (GC timing), not a precise measurement.
