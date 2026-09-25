# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""
Locust sidecar to collect live data and final results.

Locust's own CSV output is summaries only — a row per endpoint, holding counts
and averages, with no record of any individual request. It also rounds every
response time before storing it (147ms becomes 150, 3432 becomes 3400), so
percentiles taken from it are approximations. DLT needs exact per-request data,
so this sidecar records it separately.

1. Writes a row to kpi.csv for every request. The runner's reducer
   reads it to build result.json following DLT's schema.
2. Prints one JSON line per second to stdout, which CloudWatch Logs forwards to
   the live-data publisher Lambda. Only when live data is turned on.

Environment variables, all set by the runner:
    DLT_OUTPUT_DIR         — directory for kpi.csv
    DLT_TEST_ID            — test ID stamped on the JSON lines
    DLT_LIVE_DATA_ENABLED  — "true" turns live data on; anything else off
    AWS_REGION             — region stamped on the JSON lines

Defines no User or LoadTestShape classes — listeners only.

Runtime environment:
    This file is never imported as a module and is not installed as a package —
    the container image copies it to /opt/dlt/sidecar.py and the runner passes
    that path to -f.

    The non-stdlib imports below (locust, gevent) come from the virtualenv the
    Dockerfile builds at /opt/locust. gevent is not installed directly — Locust
    depends on it and pins the version.

    That virtualenv is only ever filled in at build time. The container runs as
    a user that cannot write to /opt, so nothing can be installed while a test
    is running: an import that is not already in the image fails the test rather
    than fetching anything. To add a dependency, change the Dockerfile.

Source references (Locust 2.43.3):
    https://github.com/locustio/locust/blob/2.43.3/locust/stats.py
    https://github.com/locustio/locust/blob/2.43.3/locust/main.py
    https://github.com/locustio/locust/blob/2.43.3/locust/clients.py
    https://github.com/locustio/locust/blob/2.43.3/locust/runners.py
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import gevent
from locust import events

_OUTPUT_DIR = Path(os.environ.get("DLT_OUTPUT_DIR", "/tmp/artifacts"))
_TEST_ID = os.environ.get("DLT_TEST_ID", "unknown")
_REGION = os.environ.get("AWS_REGION", "unknown")
_LIVE_DATA_ENABLED = os.environ.get("DLT_LIVE_DATA_ENABLED") == "true"
_KPI_CSV_PATH = _OUTPUT_DIR / "kpi.csv"

_kpi_fh = None
_kpi_writer = None
_environment = None
_emit_greenlet = None

# Running totals for each second, keyed by that second. _on_request adds to
# them as requests finish; the background loop reports and removes them.
_second_buckets: dict[int, dict[str, float]] = defaultdict(
    lambda: {"count": 0, "fail": 0, "rt_sum": 0.0}
)


@events.init.add_listener
def _on_init(environment, **_kwargs) -> None:
    """
    Open kpi.csv, write its header, and start the live-data emitter if
    live data is on. Locust calls this once at startup before any users run.

    Source: locust/main.py main() calls
        environment.events.init.fire(environment=environment, runner=runner, web_ui=web_ui)
    """
    global _kpi_fh, _kpi_writer, _environment, _emit_greenlet
    _environment = environment

    _OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    _kpi_fh = open(_KPI_CSV_PATH, "w", buffering=1)
    _kpi_writer = csv.writer(_kpi_fh)
    _kpi_writer.writerow(
        [
            "timestamp",
            "method",
            "name",
            "response_time_ms",
            "response_length_bytes",
            "status_code",
            "success",
            "exception_type",
            "exception_message",
            "user_count",
            "context_json",
        ]
    )

    if _LIVE_DATA_ENABLED:
        _emit_greenlet = gevent.spawn(_emit_live_stats_loop)

    print(f"[dlt-sidecar] initialized; kpi.csv at {_KPI_CSV_PATH}", file=sys.stderr)


@events.request.add_listener
def _on_request(
    request_type,
    name,
    response_time,
    response_length,
    response=None,
    context=None,
    exception=None,
    start_time=None,
    **_kwargs,
) -> None:
    """
    Write one kpi.csv row for this request, and add it to the current
    second's totals when live data is on. Locust calls this once for every
    request that finishes, whether it succeeded or failed.

    Source: locust/clients.py ResponseContextManager._report_request()
        fires self._request_event.fire(**self.request_meta)
    The request_meta dict contains: request_type, response_time, name,
    context, response, exception, start_time, url, response_length.
    """
    now = time.time()
    # kpi.csv records when the request started, not when it finished. We run
    # after the response arrived, so `now` is too late to use. Locust usually
    # tells us the start time; when it doesn't, work back from how long the
    # request took (milliseconds).
    if start_time is not None:
        started_at = start_time
    elif response_time is not None:
        started_at = now - (response_time / 1000.0)
    else:
        started_at = now

    if _kpi_writer is not None:
        try:
            _kpi_writer.writerow(
                [
                    started_at,
                    request_type,
                    name,
                    response_time,
                    response_length,
                    getattr(response, "status_code", ""),
                    "true" if exception is None else "false",
                    type(exception).__name__ if exception else "",
                    (str(exception)[:512] if exception else ""),
                    _current_user_count(),
                    _context_to_json(context),
                ]
            )
        except Exception:
            # Losing one row beats losing the run. Locust throws away whatever
            # we raise here and carries on, so a row we can't build would
            # otherwise vanish with no trace and no way to notice.
            pass

    if _LIVE_DATA_ENABLED:
        bucket = _second_buckets[int(now)]
        bucket["count"] += 1
        if exception is not None:
            bucket["fail"] += 1
        # Locust allows a request with no response time, so treat it as zero
        # rather than letting the addition blow up.
        bucket["rt_sum"] += response_time or 0


def _context_to_json(context) -> str:
    """
    Turn the request's context into JSON text for the last column.

    The context is whatever the customer's script put there, so it can hold
    anything, including things JSON has no way to represent. default=str asks
    those objects for their own text form instead of giving up.

    If even that fails we return an empty string rather than raise, because
    raising here would lose the entire row for this request, not just this one
    column.
    """
    if not context:
        return ""
    try:
        return json.dumps(context, default=str)
    except Exception:
        return ""


def _current_user_count() -> int:
    """
    How many virtual users are running right now, or 0 before Locust has
    started them.

    Source: locust/runners.py Runner.user_count property returns
    len(self.user_greenlets) — the count of active virtual users.
    """
    if _environment is None or _environment.runner is None:
        return 0
    return int(_environment.runner.user_count or 0)


def _emit_live_stats_loop() -> None:
    """
    Once per second, print a JSON line summarizing the second that just
    ended: how many requests passed, failed, and their average time. Runs
    forever in the background until the process exits.

    Waits with gevent.sleep rather than time.sleep. Locust shares one thread
    between every virtual user, so a plain sleep here would stop the whole test
    for that second instead of just this loop.
    Source: locust/runners.py uses gevent.spawn throughout for concurrent work.
    """
    # Begin one second back, so the second we started in still gets reported —
    # requests can already have finished in it. One second is the limit: any
    # earlier and the first pass would walk every second since 1970.
    last_emitted = int(time.time()) - 1
    while True:
        gevent.sleep(1.0)
        # Only report seconds that are over. A request is counted in the second
        # it finished in, so once a second has passed nothing new can join it.
        to_emit = int(time.time()) - 1
        if to_emit <= last_emitted:
            continue

        # Normally just the one second. If the loop got held up under load it
        # catches up on the ones it missed, so none are left sitting unreported.
        for second in range(last_emitted + 1, to_emit + 1):
            _emit_second(second)
        last_emitted = to_emit

        # Nothing should be left this far back, given the above. If something is
        # — say the clock stepped backwards — drop it, so it can't sit here for
        # the rest of the run.
        for second in [s for s in _second_buckets if s <= to_emit]:
            del _second_buckets[second]


def _emit_second(second: int) -> None:
    """
    Print the live-data line for one second, and drop that second's totals now
    they have been reported. A second with no requests still gets a line, so
    the chart shows a real zero rather than a gap.
    """
    bucket = _second_buckets.pop(second, None)
    if bucket is None:
        bucket = {"count": 0, "fail": 0, "rt_sum": 0.0}

    count = bucket["count"]
    event = {
        "_filter": "INFO: Current: live=true",
        "schema": "dlt.live-data.v1",
        "testId": _TEST_ID,
        "region": _REGION,
        # Milliseconds, because that is what the publisher Lambda and the
        # console chart both expect.
        "timestamp": second * 1000,
        "vu": _current_user_count(),
        "succ": count - int(bucket["fail"]),
        "fail": int(bucket["fail"]),
        # Seconds, even though Locust gives us milliseconds. The Lambda that
        # reads this line only accepts up to three digits before the decimal
        # point, so a millisecond value would be read wrong.
        "avgRt": (bucket["rt_sum"] / count / 1000.0) if count else 0.0,
    }
    print(json.dumps(event), flush=True)


@events.quit.add_listener
def _on_quit(**_kwargs) -> None:
    """
    Report whatever live data is left and close kpi.csv. Locust fires this after
    every user has stopped, so no more requests can arrive.

    The background loop waits a second between passes, so left to itself it
    would never report the last second or two of the run. Stop it and report
    those seconds here instead.

    Source: locust/main.py shutdown() calls runner.quit() to stop every user,
    then fires events.quit.fire(exit_code=code) just before sys.exit().
    """
    global _kpi_fh, _kpi_writer
    if _emit_greenlet is not None:
        _emit_greenlet.kill()
        for second in sorted(_second_buckets):
            _emit_second(second)

    if _kpi_fh is not None:
        _kpi_fh.flush()
        _kpi_fh.close()
        _kpi_writer = None
        _kpi_fh = None
    print("[dlt-sidecar] quit; live data drained, kpi.csv closed", file=sys.stderr)


@events.quitting.add_listener
def _on_quitting(environment, **_kwargs) -> None:
    """
    Push the last kpi.csv rows to disk when Locust starts shutting down, but
    leave the file open. Requests already in flight are given time to finish,
    and closing the file now would make those last writes fail. _on_quit closes
    it once they are done.

    Source: locust/main.py shutdown() fires events.quitting.fire() then
    waits for runner.quit() which respects stop_timeout (locust/runners.py
    Runner.stop_users() does stop_group.join(timeout=environment.stop_timeout)).
    """
    if _kpi_fh is not None:
        _kpi_fh.flush()
    print("[dlt-sidecar] quitting; kpi.csv flushed", file=sys.stderr)
