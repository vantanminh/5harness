# 0005 Prebuilt Native Engine (historical)

Date: 2026-05-23

## Status

**Superseded** by decision **0010** (TypeScript CLI toolchain) and **0008**
(npm-native distribution). Kept for decision-history only.

## Summary

An earlier design considered shipping a prebuilt native CLI binary as the
primary durable-layer entrypoint. This product instead ships a **TypeScript**
CLI via npm (`@vantanminh/harness`, bin `harness`). A native engine remains an
optional future path behind the same npm bin (see 0008), not a repo-local
`scripts/bin` contract.
