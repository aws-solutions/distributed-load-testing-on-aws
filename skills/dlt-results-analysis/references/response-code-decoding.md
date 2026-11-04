# Response-Code (rc) Decoding

The `rc` field in a DLT aggregate, and the `responseCodes` array in a raw `dlt.result.v1` artifact, are the easiest part of a results object to misread. This reference explains what is in the list, what is deliberately left out, and how to decode the `code` values for each framework. It is the companion to the `dlt-results-analysis` skill.

## What the List Contains

`rc` is a list of `{ code, count }` objects. Two rules shape it:

1. **Success and redirect codes are stripped before storage.** The parser holds an explicit allowlist of codes it treats as success. Any code on the list, and any empty code, is removed from `rc` before the aggregate is stored. Counts for the codes that remain are then summed per code.
2. **The `code` value is whatever the framework reported.** It is often an HTTP status as a string (`"404"`, `"503"`), but on a network-level failure, where no HTTP response ever arrived, each framework reports something different and non-numeric.

Two consequences follow. An **empty `rc` means every request returned a success or redirect code**, not that the run did nothing. And a **non-numeric `code` is a network or protocol failure**, not a strange HTTP status.

## The Success Allowlist

These codes are treated as success and never appear in `rc`:

```
200  201  202  204            (2xx success)
300  301  302  303  304  307  308   (3xx redirects)
101                            (Switching Protocols, e.g. WebSocket upgrade)
1000                           (framework success marker; see note)
```

Notes on the allowlist:

- It is a literal, fixed list. Some HTTP codes that are not errors are **not** on it, for example `203`, `205`, and `206 Partial Content`. If your target legitimately returns one of those, it will appear in `rc` even though it is not a failure. Account for that before calling it an error.
- `1000` is on the allowlist and is stripped. A response coded `1000` therefore never shows up in `rc`. Do not treat a k6 numeric error code of `1000` as if it were counted; it is not.
- The allowlist strips codes from the list, but it does not change `succ` and `fail`. Those counts come from the framework's own success and failure classification. That is why `fail` can be non-zero even when `rc` looks short: the counts in `rc` are per distinct code, and several codes sum to the total failures.

## JMeter

JMeter writes one row per sample to `kpi.jtl`, and the `responseCode` column passes through to `code` verbatim.

- When there was an HTTP response, `code` is the numeric HTTP status as a string: `"400"`, `"429"`, `"500"`, `"503"`.
- When no HTTP response arrived, JMeter writes a descriptive Java string, for example `"Non HTTP response code: java.net.ConnectException"` or `"Non HTTP response code: java.net.SocketTimeoutException"`. Read the exception class at the end: `ConnectException` is a refused or unreachable target, `SocketTimeoutException` is a timeout, `UnknownHostException` is a DNS failure.

## k6

k6 reports an HTTP `status` when a response reached the client, and an `error_code` when one did not. The DLT reducer uses the HTTP status when it is present and non-zero. Otherwise it uses the numeric `error_code`, and when neither is present it records the code `"0"`.

- Numeric HTTP statuses appear as usual: `"404"`, `"429"`, `"500"`.
- A numeric `error_code` from 1000 to 1701 is a k6 error code. The k6 error-code documentation groups the codes in these ranges:

| Range | Category |
|---|---|
| 1000-1099 | General errors |
| 1100-1199 | DNS resolution errors |
| 1200-1299 | TCP and connection errors (dial failures, resets, timeouts) |
| 1300-1399 | TLS and certificate errors |
| 1400-1499 | HTTP 4xx client errors |
| 1500-1599 | HTTP 5xx server errors |
| 1600-1699 | HTTP/2 errors (GoAway, stream, and connection errors) |
| 1701 | Decompression error |

The DLT reducer prefers the HTTP status, so a response that carried a 4xx or 5xx status appears in `rc` as that status, such as `"404"`, rather than as a code from 1400 to 1599.

For the exact meaning of a specific code, consult the k6 error-code documentation at `https://grafana.com/docs/k6/latest/javascript-api/error-codes/`. Remember that `1000` is stripped by the DLT success allowlist, so it will not appear in `rc`.

## Locust

Locust reports a `status_code` when the request got an HTTP response, and an `exception_type` when it did not. The DLT reducer uses the status code when it is present and non-zero. Otherwise it uses the exception class name, and when neither is present it keeps the status code as reported, typically `"0"`. In Native mode DLT runs Locust with `--exit-code-on-error=0`, so these failures are counted here and in `fail` without changing Locust's exit code or raising a framework warning alert.

- Numeric HTTP statuses appear as usual: `"404"`, `"429"`, `"500"`.
- A non-numeric `code` is a Python exception class name from the HTTP client. Common ones:
  - `ConnectionRefusedError`, `ConnectionResetError`: the target refused or dropped the connection.
  - `ConnectTimeout`, `ReadTimeout`, `Timeout`: the connection or the read timed out.
  - `ConnectionError`: a general connection failure (DNS, refused, or reset).
  - `SSLError`: a TLS or certificate failure.
  The exact class depends on the HTTP library the locustfile uses; read the class name literally.

## Reading an `rc` List in Practice

1. Sort by `count` descending to find the dominant failure.
2. Separate numeric HTTP statuses from non-numeric codes. Numeric statuses point at the application or a gateway (throttling on `429`, backend errors on `5xx`). Non-numeric codes, and the k6 error codes from 1000 to 1399 and from 1600 to 1701, point at the network, the connection, or the protocol (refused, reset, timeout, DNS, TLS, HTTP/2, decompression). A code of `"0"` means the framework reported neither a status nor an error code for those requests.
3. Cross-check against the per-label `rc` in `labels[]` to see which endpoint produced which codes.
4. Confirm the totals: the counts in `rc` usually sum to at most `fail`. A success status outside the allowlist, such as `206`, is counted in `rc` but not in `fail`, so subtract those first. A large `fail` with a short `rc` usually means one or two codes dominate.

## Sources

The facts here come from these files in the solution source:

- `source/results-parser/lib/parser/index.js`: the `acceptedCodes` allowlist and the per-code count reduction.
- `source/results-parser/lib/native/index.js`: stripping success and empty codes from each task before aggregation.
- `source/common/src/schemas/result.ts`: the framework-specific nature of the `code` field.
- The framework reducers `source/load-tester/src/results/jmeter-reducer.ts`, `k6-reducer.ts`, and `locust-reducer.ts`: how each framework's raw output becomes a `code`.
