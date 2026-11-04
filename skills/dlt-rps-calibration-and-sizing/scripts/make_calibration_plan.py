#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Generate a DLT Native mode JMeter plan that holds a per-task request rate for one HTTP request.

The plan uses the load model that calibrates well on DLT: a Concurrency Thread Group paced by a
Throughput Shaping Timer, with __tstFeedback sizing the thread pool and keeping a floor of spare
threads. Keep-alive is on, the HTTP client is HttpClient4, and "Same user on each iteration" is
checked, so connections are reused. Optionally it adds the telemetry setUp thread group from
templates/telemetry.groovy, which records the task's CPU, memory, heap, GC, and network once per
second.

Two ways to set the schedule, both per task (every DLT task runs the whole plan):

  --steps 1000,2000,4000,8000   a calibration schedule: a warm-up ramp, then one hold per rate
  --profile "line(1,11111,300s) const(11111,600s)"
                                any Throughput Shaping Timer profile, such as the per-task
                                schedule that plan_from_baseline.py prints for the real run

Next to the plan it writes <plan>.profile.json, the schedule that analyze_calibration.py needs to
split the run into steps. The plan embeds the URL, so keep it with your other test assets.

Pass a credential header such as Authorization with --header-env 'Name=ENVVAR', which reads the
value from the environment variable ENVVAR, so that it stays out of the process list and the shell
history. --header with a credential header prints a warning. Either way the plan holds the value
in clear text, and DLT keeps an uploaded plan in a versioned bucket that console users can
download, so use a short-lived, test-only token and revoke it after the test.

It uses only the Python standard library.

Examples:
    python3 make_calibration_plan.py --url https://api.example.com/health \\
        --steps 1000,2000,4000,8000,12000 -o calibration.jmx
    python3 make_calibration_plan.py --url https://api.example.com/orders --method POST \\
        --header "Content-Type: application/json" --body '{"sku":"A1"}' \\
        --steps 500,1000,2000,4000 -o calibration.jmx
    python3 make_calibration_plan.py --url https://api.example.com/health \\
        --profile "line(1,11111,300s) const(11111,600s)" -o full-run.jmx
    # TARGET_AUTH holds "Bearer <short-lived token>", exported without printing it
    python3 make_calibration_plan.py --url https://api.example.com/orders \\
        --header-env Authorization=TARGET_AUTH --steps 500,1000,2000 -o calibration.jmx
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from xml.sax.saxutils import escape

TELEMETRY = Path(__file__).resolve().parent.parent / "templates" / "telemetry.groovy"
TIMER_NAME = "dlt-shaping-timer"


def prop(kind, name, value):
    return f'<{kind}Prop name="{escape(name)}">{escape(str(value))}</{kind}Prop>'


def parse_duration(text):
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min|h)?\s*", text)
    if not m:
        raise ValueError(f"bad duration {text!r}")
    value, unit = float(m.group(1)), (m.group(2) or "s")
    return int(round(value * {"s": 1, "sec": 1, "m": 60, "min": 60, "h": 3600}[unit]))


def parse_profile(text):
    """Parse 'line(a,b,Ns) const(r,Ns)' into [[start, end, seconds], ...]."""
    rows = []
    for kind, args in re.findall(r"(line|const)\(([^)]*)\)", text):
        parts = [p.strip() for p in args.split(",")]
        if kind == "line" and len(parts) == 3:
            rows.append([float(parts[0]), float(parts[1]), parse_duration(parts[2])])
        elif kind == "const" and len(parts) == 2:
            rows.append([float(parts[0]), float(parts[0]), parse_duration(parts[1])])
        else:
            raise ValueError(f"bad profile element {kind}({args})")
    if not rows:
        raise ValueError("profile has no line(...) or const(...) elements")
    return rows


def steps_profile(steps, step_seconds, warmup_seconds, warmup_rps):
    rows = [[1.0, float(warmup_rps or steps[0]), warmup_seconds]] if warmup_seconds else []
    rows += [[float(r), float(r), step_seconds] for r in steps]
    return rows


def no_zero(rows):
    # A Throughput Shaping Timer row at 0 requests per second makes the timer compute an
    # effectively infinite delay: the threads sleep and the test never ends.
    return [[max(1.0, a), max(1.0, b), int(d)] for a, b, d in rows]


def fmt(rate):
    return str(int(rate)) if float(rate).is_integer() else f"{rate:.2f}"


CREDENTIAL_HEADERS = {"authorization", "proxy-authorization", "cookie", "x-api-key", "x-amz-security-token"}


def collect_headers(headers, header_env, environ=None):
    """Return the 'Name: value' headers from --header and --header-env, warning about credentials."""
    environ = os.environ if environ is None else environ
    result = list(headers)
    for header in headers:
        name = header.partition(":")[0].strip()
        if name.lower() in CREDENTIAL_HEADERS:
            print(f"warning: --header {name} puts the credential in the process list and shell history; "
                  f"pass it with --header-env {name}=<ENVVAR> instead", file=sys.stderr)
    for spec in header_env:
        name, sep, var = (part.strip() for part in spec.partition("="))
        if not sep or not name or not var:
            raise ValueError(f"--header-env must be 'Name=ENVVAR', got {spec!r}")
        if not environ.get(var):
            raise ValueError(f"--header-env {name}: the environment variable {var} is unset or empty")
        result.append(f"{name}: {environ[var]}")
    if any(h.partition(":")[0].strip().lower() in CREDENTIAL_HEADERS for h in result):
        print("note: the plan holds the credential header in clear text, and DLT keeps an uploaded plan in a "
              "versioned bucket that console users can download. Use a short-lived, test-only token.",
              file=sys.stderr)
    return result


def headers_xml(headers):
    if not headers:
        return ""
    entries = ""
    for h in headers:
        name, sep, value = h.partition(":")
        if not sep:
            raise ValueError(f"header must be 'Name: value', got {h!r}")
        entries += f"""
              <elementProp name="" elementType="Header">
                {prop("string", "Header.name", name.strip())}
                {prop("string", "Header.value", value.strip())}
              </elementProp>"""
    return f"""
          <HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="headers">
            <collectionProp name="HeaderManager.headers">{entries}
            </collectionProp>
          </HeaderManager>
          <hashTree/>"""


def sampler_xml(url, method, body, keepalive, assert_status, headers):
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ValueError(f"--url must be an http or https URL, got {url!r}")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    if body is not None:
        arguments = f"""
          {prop("bool", "HTTPSampler.postBodyRaw", "true")}
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments">
            <collectionProp name="Arguments.arguments">
              <elementProp name="" elementType="HTTPArgument">
                {prop("bool", "HTTPArgument.always_encode", "false")}
                {prop("string", "Argument.value", body)}
                {prop("string", "Argument.metadata", "=")}
              </elementProp>
            </collectionProp>
          </elementProp>"""
    else:
        arguments = """
          <elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments">
            <collectionProp name="Arguments.arguments"/>
          </elementProp>"""
    assertion = ""
    if assert_status:
        assertion = f"""
          <ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="status {assert_status}">
            <collectionProp name="Asserion.test_strings">{prop("string", "s", assert_status)}</collectionProp>
            {prop("string", "Assertion.test_field", "Assertion.response_code")}
            {prop("bool", "Assertion.assume_success", "false")}
            {prop("int", "Assertion.test_type", 8)}
          </ResponseAssertion>
          <hashTree/>"""
    label = f"{method} {parts.path or '/'}"
    return f"""
        <HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="{escape(label)}">{arguments}
          {prop("string", "HTTPSampler.domain", parts.hostname)}
          {prop("string", "HTTPSampler.port", port)}
          {prop("string", "HTTPSampler.protocol", parts.scheme)}
          {prop("string", "HTTPSampler.path", path)}
          {prop("string", "HTTPSampler.method", method)}
          {prop("bool", "HTTPSampler.follow_redirects", "false")}
          {prop("bool", "HTTPSampler.use_keepalive", "true" if keepalive else "false")}
          {prop("string", "HTTPSampler.implementation", "HttpClient4")}
          {prop("string", "HTTPSampler.connect_timeout", 5000)}
          {prop("string", "HTTPSampler.response_timeout", 10000)}
        </HTTPSamplerProxy>
        <hashTree>{headers_xml(headers)}{assertion}
        </hashTree>"""


def telemetry_xml():
    script = TELEMETRY.read_text(encoding="utf-8")
    return f"""
      <SetupThreadGroup guiclass="SetupThreadGroupGui" testclass="SetupThreadGroup" testname="telemetry">
        {prop("string", "ThreadGroup.on_sample_error", "continue")}
        <elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController">
          {prop("int", "LoopController.loops", 1)}
          {prop("bool", "LoopController.continue_forever", "false")}
        </elementProp>
        {prop("string", "ThreadGroup.num_threads", 1)}
        {prop("string", "ThreadGroup.ramp_time", 0)}
      </SetupThreadGroup>
      <hashTree>
        <JSR223Sampler guiclass="TestBeanGUI" testclass="JSR223Sampler" testname="dlt-telemetry-start">
          {prop("string", "scriptLanguage", "groovy")}
          {prop("string", "cacheKey", "true")}
          {prop("string", "parameters", "")}
          {prop("string", "filename", "")}
          {prop("string", "script", script)}
        </JSR223Sampler>
        <hashTree/>
      </hashTree>"""


def build_plan(args, profile):
    rows_xml = "".join(
        f"""
            <collectionProp name="row{i}">{prop("string", "start", fmt(a))}{prop("string", "end", fmt(b))}{prop("string", "duration", d)}</collectionProp>"""
        for i, (a, b, d) in enumerate(profile)
    )
    hold = sum(d for _, _, d in profile)
    feedback = "${__tstFeedback(" + f"{TIMER_NAME},{args.start_threads},{args.max_threads},{args.spare}" + ")}"
    telemetry = "" if args.no_telemetry else telemetry_xml()
    sampler = sampler_xml(args.url, args.method.upper(), args.body, not args.no_keepalive, args.assert_status, args.header)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
  <hashTree>
    <TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="{escape(args.name)}">
      <elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments">
        <collectionProp name="Arguments.arguments"/>
      </elementProp>
      {prop("bool", "TestPlan.functional_mode", "false")}
      {prop("bool", "TestPlan.serialize_threadgroups", "false")}
      {prop("bool", "TestPlan.tearDown_on_shutdown", "true")}
    </TestPlan>
    <hashTree>{telemetry}
      <com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroup guiclass="com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroupGui" testclass="com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroup" testname="paced load">
        <elementProp name="ThreadGroup.main_controller" elementType="com.blazemeter.jmeter.control.VirtualUserController"/>
        {prop("string", "ThreadGroup.on_sample_error", "continue")}
        {prop("string", "TargetLevel", feedback)}
        {prop("string", "RampUp", "")}
        {prop("string", "Steps", "")}
        {prop("string", "Hold", hold)}
        {prop("string", "LogFilename", "")}
        {prop("string", "Iterations", "")}
        {prop("string", "Unit", "S")}
        {prop("bool", "ThreadGroup.same_user_on_next_iteration", "true")}
      </com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroup>
      <hashTree>
        <kg.apc.jmeter.timers.VariableThroughputTimer guiclass="kg.apc.jmeter.timers.VariableThroughputTimerGui" testclass="kg.apc.jmeter.timers.VariableThroughputTimer" testname="{TIMER_NAME}">
          <collectionProp name="load_profile">{rows_xml}
          </collectionProp>
        </kg.apc.jmeter.timers.VariableThroughputTimer>
        <hashTree/>{sampler}
      </hashTree>
    </hashTree>
  </hashTree>
</jmeterTestPlan>
"""


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True, help="the request to send, for example https://api.example.com/health")
    ap.add_argument("--method", default="GET")
    ap.add_argument("--header", action="append", default=[], metavar="'Name: value'", help="request header; repeatable")
    ap.add_argument("--header-env", action="append", default=[], metavar="Name=ENVVAR",
                    help="request header whose value is read from the environment variable ENVVAR, for "
                         "credentials such as Authorization; repeatable")
    ap.add_argument("--body", help="raw request body, for POST or PUT")
    schedule = ap.add_mutually_exclusive_group(required=True)
    schedule.add_argument("--steps", help="comma-separated per-task rates for a calibration, e.g. 1000,2000,4000")
    schedule.add_argument("--profile", help="a Throughput Shaping Timer profile, e.g. 'line(1,5000,300s) const(5000,600s)'")
    ap.add_argument("--step-seconds", type=int, default=300, help="hold per calibration step (default 300)")
    ap.add_argument("--warmup-seconds", type=int, default=180, help="warm-up ramp before the first step (default 180)")
    ap.add_argument("--warmup-rps", type=float, help="rate the warm-up ramps to (default: the first step)")
    ap.add_argument("--start-threads", type=int, default=50, help="threads to start with (default 50)")
    ap.add_argument("--max-threads", type=int, default=400, help="most threads the pool may grow to (default 400)")
    ap.add_argument("--spare", default="50", help="spare threads kept idle, a count or a fraction like 0.1 (default 50)")
    ap.add_argument("--no-keepalive", action="store_true", help="open a new connection per request (not recommended)")
    ap.add_argument("--assert-status", type=int, default=200, help="expected response code; 0 disables the check")
    ap.add_argument("--no-telemetry", action="store_true", help="leave out the telemetry setUp thread group")
    ap.add_argument("--name", default="dlt rps calibration", help="test plan name")
    ap.add_argument("-o", "--output", required=True, help="where to write the .jmx")
    args = ap.parse_args(argv)

    try:
        if args.steps:
            steps = [float(x) for x in args.steps.split(",") if x.strip()]
            profile = steps_profile(steps, args.step_seconds, args.warmup_seconds, args.warmup_rps)
        else:
            profile = parse_profile(args.profile)
        profile = no_zero(profile)
        args.header = collect_headers(args.header, args.header_env)
        plan = build_plan(args, profile)
    except (ValueError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    out = Path(args.output)
    out.write_text(plan, encoding="utf-8")
    sidecar = out.with_suffix(out.suffix + ".profile.json")
    sidecar.write_text(json.dumps({"profile": profile, "url": args.url, "method": args.method.upper(),
                                   "keepalive": not args.no_keepalive, "pool": {"start": args.start_threads,
                                   "max": args.max_threads, "spare": args.spare},
                                   "telemetry": not args.no_telemetry}, indent=2), encoding="utf-8")
    total = sum(d for _, _, d in profile)
    print(f"wrote {out} and {sidecar.name}: {len(profile)} profile rows, {total} s "
          f"({total / 60:.1f} min); set the DLT safety duration (--max-test-duration) above that")
    return 0


if __name__ == "__main__":
    sys.exit(main())
