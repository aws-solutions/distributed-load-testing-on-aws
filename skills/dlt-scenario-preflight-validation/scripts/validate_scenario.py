#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Preflight validator for a Distributed Load Testing on AWS create-test payload.

It mirrors the product's `createTestSchema` (common/src/api/schemas.ts), so a
customer or agent can check a payload before calling `POST /scenarios`. The API
returns an opaque HTTP 400 whose body is a JSON-stringified plain string. This
script reports the same rule failures locally, mostly with the API's own
wording, in the order they are grouped, and prints an approximate preview of the
400 string the API would return.

It also checks the rules `createTest` applies after the schema passes, which
return their own `<Code>: <message>` 400 bodies. Every Region needs a
`regionalTaskDetails` entry and a `taskCount` within it. On v4.3.2 and later
those two checks apply to saveOnly requests, because a run start uses the
capacity the API reads itself. The first execution entry needs both `ramp-up`
and `hold-for`. These findings appear in a separate list, because they arrive as
a different error.

On DLT v4.3.0 and v4.3.1, `ramp-up` and `hold-for` must also be strings in
seconds or minutes, because the run-duration calculation there reads only the
`s` and `m` suffixes. The script prints a note for that case without failing
the payload, because v4.3.2 and later accept every form the schema allows.

Finally, it prints a note for each tag the scenarios handler will rewrite or
drop. The handler normalizes tags instead of rejecting them, so these notes never
change the exit code.

It uses only the Python standard library and imports neither boto3 nor any other
third-party package, so it runs anywhere Python 3.9 or newer is available.

Usage:
    python3 validate_scenario.py path/to/payload.json
    cat payload.json | python3 validate_scenario.py
    python3 validate_scenario.py -            # read stdin explicitly

Exit codes:
    0  payload satisfies every checked rule
    1  payload has one or more validation errors
    2  input could not be read, is not UTF-8, or is not JSON that JSON.parse accepts
       (mirrors "Invalid JSON in request body"); NaN and Infinity are not JSON
"""

import json
import re
import sys

# Bounds and enums, kept in sync with common/src/api/limits.ts, schemas.ts,
# and create-test.ts.
NAME_MIN = 3
NAME_MAX = 255
DESCRIPTION_MIN = 3
DESCRIPTION_MAX = 60000
URL_MAX = 2048
BODY_MAX = 65536
MAX_TAGS = 5
MAX_REQUESTS_PER_SCENARIO = 100
MIN_CONCURRENCY = 1
MAX_CONCURRENCY = 25000
MAX_TEST_DURATION_SECONDS = 86400
# nativeRunMode is a strict object in the API schema, so this is the complete set
# of keys it accepts. The API rejects anything else.
NATIVE_RUN_MODE_KEYS = frozenset({"maxTestDurationSeconds"})
HEALTHY_THRESHOLD_MIN = 0
HEALTHY_THRESHOLD_MAX = 100
# Zod 4's int() accepts only safe integers, so 1e20 fails even as a whole number.
MAX_SAFE_INTEGER = 2 ** 53 - 1

TEST_TYPES = ("simple", "jmeter", "k6", "locust")
FRAMEWORK_TEST_TYPES = ("jmeter", "k6", "locust")
FILE_TYPES = ("none", "script", "zip")
HTTP_METHODS = ("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS")
EXECUTORS = ("locust", "k6", "jmeter")
SCHEDULE_STEPS = ("create", "start")
RECURRENCES = ("daily", "weekly", "biweekly", "monthly")
SCHEDULE_TIMEZONE_MAX = 64
TEST_ID_MAX = 128

# Per-suffix duration caps for ramp-up and hold-for string form.
DURATION_LIMITS = {
    "s": (3600, "seconds"),
    "m": (1440, "minutes"),
    "h": (168, "hours"),
    "d": (30, "days"),
}

CONTROL_CHAR = re.compile("[\u0000-\u001f\u007f-\u009f\u2028\u2029]")
# These patterns are copied from schemas.ts and must be applied with fullmatch,
# through matches(). In Python, $ also matches before a trailing newline and \d
# matches any Unicode digit; in JavaScript, $ ends the string and \d is 0 to 9.
# fullmatch and re.ASCII give them the JavaScript meaning.
REGION_RE = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-\d$", re.ASCII)
DIGITS_RE = re.compile(r"^\d+$", re.ASCII)
DURATION_RE = re.compile(r"^(\d+)([smhd])$", re.ASCII)
TEST_ID_RE = re.compile(r"^[a-zA-Z0-9-]+$", re.ASCII)
SCHEDULE_DATE_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$", re.ASCII)
SCHEDULE_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$", re.ASCII)
# Copied verbatim from CRON_EXPRESSION_REGEX in schemas.ts.
CRON_RE = re.compile(r"^([0-5]?\d) ((\*|\*\/\d+|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(\/\d+)?)(,(\*|\*\/\d+|([01]?\d|2[0-3])(-([01]?\d|2[0-3]))?(\/\d+)?))*) (\?|(\*|L|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)(\/\d+)?(,(\*|L|([1-9]|[12]\d|3[01])(-([1-9]|[12]\d|3[01]))?)(\/\d+)?)*) ((\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC])(-(\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC]))?(\/\d+)?(,((\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC])(-(\*|0[1-9]|1[0-2]?|[2-9]|[jJ][aA][nN]|[fF][eE][bB]|[mM][aA][rRyY]|[aA][pP][rR]|[jJ][uU][nNlL]|[aA][uU][gG]|[sS][eE][pP]|[oO][cC][tT]|[nN][oO][vV]|[dD][eE][cC]))?(\/\d+)?))*) (\?|L|(\*|[0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])(#[1-5]|L?(-([0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])L?)?(,(L|(\*|[0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])(L?(-([0-6]|[sS][uU][nN]|[mM][oO][nN]|[tT][uU][eE]|[wW][eE][dD]|[tT][hH][uU]|[fF][rR][iI]|[sS][aA][tT])L?)?)?))*)?)$", re.ASCII)
# On DLT v4.3.0 and v4.3.1, createTest computes the run duration from
# execution[0] and reads only these two suffixes, although the schema also
# accepts h and d. v4.3.2 reads every schema form.
RUN_DURATION_RE = re.compile(r"^\s*\d+\s*[sm]\s*$")

# Friendly names for the control characters a user is most likely to paste in,
# matching CONTROL_CHAR_NAMES in schemas.ts.
CONTROL_CHAR_NAMES = {0x00: "null", 0x09: "tab", 0x0A: "newline", 0x0D: "carriage return"}

# Appended to the two capacity findings. On v4.3.0 and v4.3.1 they apply to every
# request, and on v4.3.2 and later only to a saveOnly request.
CAPACITY_VERSION_NOTE = (
    " On v4.3.2 and later this check applies to saveOnly requests; a run start uses the "
    "capacity the API reads itself."
)


class Errors:
    """Accumulates `path: message` strings in the shape the API emits."""

    def __init__(self):
        self.items = []

    def add(self, path, message):
        self.items.append("{}: {}".format(path, message))

    def extend(self, other):
        self.items.extend(other.items)

    def __bool__(self):
        return bool(self.items)


# Stands for a key the payload does not carry, as distinct from an explicit null.
ABSENT = object()


def is_str(value):
    return isinstance(value, str)


def matches(pattern, value):
    """Return True if a string value matches a whole schema pattern."""
    return is_str(value) and pattern.fullmatch(value) is not None


def optional(errors, mapping, key, path):
    """Return mapping[key] for an optional field, or ABSENT when there is none.

    Zod's .optional() accepts a missing key but rejects an explicit null, so a
    null is reported here and returned as ABSENT, which the caller skips.
    """
    value = mapping.get(key, ABSENT)
    if value is None:
        errors.add(path, "{} must be omitted rather than null; the API rejects null for an optional field".format(key))
        return ABSENT
    return value


def expect_object(errors, value, path):
    """Report a non-object where the schema has a z.object, and return whether it is one."""
    if isinstance(value, dict):
        return True
    errors.add(path, "Invalid input: expected object, received {}".format(json_type_name(value)))
    return False


def json_type_name(value):
    """Name a parsed JSON value's type the way Zod's messages do."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return "string"


def is_int(value):
    # bool is a subclass of int in Python; exclude it, because Zod treats booleans
    # separately from numbers. A float with an integral value, such as 50.0,
    # counts as an integer, because JavaScript parses it as the number 50. Zod 4
    # also rejects an integer beyond Number.MAX_SAFE_INTEGER.
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return abs(value) <= MAX_SAFE_INTEGER
    return isinstance(value, float) and value.is_integer() and abs(value) <= MAX_SAFE_INTEGER


def digits_value(text):
    """Read an ASCII digit string as JavaScript's parseInt does.

    Python's int() refuses a string of more than 4300 digits, so a long string
    becomes the nearest float, or infinity, as it does in JavaScript.
    """
    return int(text) if len(text) < 20 else float(text)


def coerce_positive_int(value):
    """Accept an int or a numeric string, matching Zod's union+transform."""
    if is_int(value):
        return int(value)
    if matches(DIGITS_RE, value):
        return digits_value(value)
    return None


def validate_name(errors, value, label, path):
    if not is_str(value):
        errors.add(path, "{} must be a string".format(label))
        return
    if len(value) < NAME_MIN:
        errors.add(path, "{} must be at least {} characters".format(label, NAME_MIN))
    if len(value) > NAME_MAX:
        errors.add(path, "{} must not exceed {} characters".format(label, NAME_MAX))
    if value != value.strip():
        errors.add(path, "{} cannot have leading or trailing whitespace".format(label))
    match = CONTROL_CHAR.search(value)
    if match:
        errors.add(
            path,
            "{} contains a disallowed control character: {}".format(label, describe_control_char(match.group(0))),
        )


def describe_control_char(char):
    """Describe a control character as "name (U+XXXX)", or just "U+XXXX" if uncommon."""
    code_point = ord(char)
    hex_form = "U+{:04X}".format(code_point)
    name = CONTROL_CHAR_NAMES.get(code_point)
    return "{} ({})".format(name, hex_form) if name else hex_form


def validate_duration(errors, value, label, path, allow_zero):
    """Mirror validateTimeDuration: integer or `<n><s|m|h|d>` with per-unit caps."""
    if is_int(value):
        if not allow_zero and value <= 0:
            errors.add(path, "{} must be a positive number".format(label))
        elif allow_zero and value < 0:
            errors.add(path, "{} must be a non-negative number".format(label))
        return
    if not is_str(value):
        errors.add(path, "{} must be in format: number followed by s, m, h, or d".format(label))
        return
    match = DURATION_RE.fullmatch(value)
    if not match:
        errors.add(path, "{} must be in format: number followed by s, m, h, or d".format(label))
        return
    num = digits_value(match.group(1))
    suffix = match.group(2)
    if not allow_zero and num == 0:
        errors.add(path, "{} must be greater than 0".format(label))
        return
    cap, unit = DURATION_LIMITS[suffix]
    if num > cap:
        errors.add(path, "{}: value {} exceeds maximum of {} {}".format(label, num, cap, unit))


def validate_concurrency(errors, value, path):
    if is_int(value):
        resolved = value
    elif matches(DIGITS_RE, value):
        resolved = digits_value(value)
    else:
        errors.add(path, "concurrency must be a positive integer")
        return
    if resolved < MIN_CONCURRENCY or resolved > MAX_CONCURRENCY:
        errors.add(path, "concurrency must be between {} and {}".format(MIN_CONCURRENCY, MAX_CONCURRENCY))


def validate_task_count(errors, value, path):
    resolved = coerce_positive_int(value)
    if resolved is None:
        errors.add(path, "taskCount must be a positive integer")
        return
    if resolved < 1:
        errors.add(path, "taskCount must be a positive integer")


def is_valid_url(value):
    """Approximate the WHATWG URL parse that Zod's url() check performs.

    Zod trims the value, and the URL parser drops tabs and newlines, so neither
    makes a URL invalid. A value with no scheme is invalid. For the schemes that
    need a host (http, https, ws, wss, ftp), the host must be present and free of
    forbidden characters such as a space, and any port must be a number from 0 to
    65535. Other schemes, such as mailto, parse as valid URLs and are left to the
    HTTP or HTTPS check.
    """
    text = re.sub(r"[\t\n\r]", "", value.strip())
    match = re.match(r"^([A-Za-z][A-Za-z0-9+.\-]*):(.*)$", text, re.S)
    if not match:
        return False
    scheme, rest = match.group(1).lower(), match.group(2)
    if scheme not in ("http", "https", "ws", "wss", "ftp"):
        return True
    # A special scheme takes the authority from the text after the colon, with
    # or without the slashes, so http:example.com parses as http://example.com.
    authority = re.split(r"[/\\?#]", rest.lstrip("/\\"), maxsplit=1)[0]
    if "@" in authority:
        authority = authority.rsplit("@", 1)[1]
    host, port = authority, ""
    if authority.startswith("["):
        end = authority.find("]")
        if end == -1:
            return False
        host, tail = authority[: end + 1], authority[end + 1 :]
        if tail and not tail.startswith(":"):
            return False
        port = tail[1:]
    elif ":" in authority:
        host, port = authority.rsplit(":", 1)
    if host == "" or re.search(r"[\s<>^|\\\[\]]", host.strip("[]")):
        return False
    if port and (not port.isdigit() or int(port) > 65535):
        return False
    return True


def validate_url(errors, value, path):
    if not is_str(value) or len(value) < 1:
        errors.add(path, "url is required")
        return
    if len(value) > URL_MAX:
        errors.add(path, "url must not exceed {} characters".format(URL_MAX))
    if not is_valid_url(value):
        errors.add(path, "url must be a valid URL")
    # Zod's url() check stores the trimmed value, so the prefix test sees it trimmed.
    trimmed = value.strip()
    if not (trimmed.startswith("http://") or trimmed.startswith("https://")):
        errors.add(path, "url must be a valid HTTP/HTTPS URL")


def validate_request(errors, request, path):
    if not isinstance(request, dict):
        errors.add(path, "request must be an object")
        return
    validate_url(errors, request.get("url"), path + ".url")
    method = request.get("method")
    if method not in HTTP_METHODS:
        errors.add(
            path + ".method",
            "method must be a valid HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)",
        )
    headers = optional(errors, request, "headers", path + ".headers")
    if headers is not ABSENT:
        if not isinstance(headers, dict) or not all(is_str(v) for v in headers.values()):
            errors.add(path + ".headers", "headers must be an object of string values")
    body = optional(errors, request, "body", path + ".body")
    if body is not ABSENT:
        if not is_str(body):
            errors.add(path + ".body", "body must be a string")
        elif len(body) > BODY_MAX:
            errors.add(path + ".body", "body must not exceed {} characters".format(BODY_MAX))


def validate_scenarios(errors, scenarios, path):
    if not isinstance(scenarios, dict):
        errors.add(path, "scenarios must be an object")
        return
    if len(scenarios) == 0:
        errors.add(path, "At least one scenario must be defined in scenarios object")
        return
    for name, config in scenarios.items():
        validate_name(errors, name, "Scenario name", "{}.{}".format(path, name))
        if not expect_object(errors, config, "{}.{}".format(path, name)):
            continue
        req_path = "{}.{}.requests".format(path, name)
        requests = optional(errors, config, "requests", req_path)
        if requests is ABSENT:
            continue
        if not isinstance(requests, list):
            errors.add(req_path, "requests must be an array")
            continue
        if len(requests) < 1:
            errors.add(req_path, "Each scenario must have at least one request")
        if len(requests) > MAX_REQUESTS_PER_SCENARIO:
            errors.add(req_path, "Each scenario cannot exceed {} requests".format(MAX_REQUESTS_PER_SCENARIO))
        for index, request in enumerate(requests):
            validate_request(errors, request, "{}[{}]".format(req_path, index))


def validate_execution(errors, execution, scenario_names):
    if not isinstance(execution, list):
        errors.add("testScenario.execution", "execution must be an array")
        return
    if len(execution) < 1:
        errors.add("testScenario.execution", "At least one execution configuration is required")
    for index, exec_entry in enumerate(execution):
        base = "testScenario.execution[{}]".format(index)
        if not expect_object(errors, exec_entry, base):
            continue
        # A null in these four fails the type checks below, as it does in zod.
        if "concurrency" in exec_entry:
            validate_concurrency(errors, exec_entry["concurrency"], base + ".concurrency")
        if "ramp-up" in exec_entry:
            validate_duration(errors, exec_entry["ramp-up"], "ramp-up", base + ".ramp-up", allow_zero=True)
        if "hold-for" in exec_entry:
            validate_duration(errors, exec_entry["hold-for"], "hold-for", base + ".hold-for", allow_zero=False)
        if "taskCount" in exec_entry:
            exec_task_count = exec_entry["taskCount"]
            if not is_int(exec_task_count) or exec_task_count < 1:
                errors.add(base + ".taskCount", "taskCount must be a positive integer number")
        executor = optional(errors, exec_entry, "executor", base + ".executor")
        if executor is not ABSENT and executor not in EXECUTORS:
            errors.add(base + ".executor", "executor must be one of: locust, k6, jmeter")
        scenario_ref = optional(errors, exec_entry, "scenario", base + ".scenario")
        if scenario_ref is ABSENT:
            continue
        if not is_str(scenario_ref):
            errors.add(base + ".scenario", "scenario must be a string")
        # The schema skips the cross-check for an empty name, as JavaScript treats "" as false.
        elif scenario_ref and scenario_ref not in scenario_names:
            errors.add(
                base + ".scenario",
                "Execution references scenario '{}' that doesn't exist in scenarios object".format(scenario_ref),
            )


def validate_task_configs(errors, task_configs):
    if not isinstance(task_configs, list):
        errors.add("testTaskConfigs", "testTaskConfigs must be an array")
        return
    if len(task_configs) < 1:
        errors.add("testTaskConfigs", "At least one test task configuration is required")
    for index, config in enumerate(task_configs):
        base = "testTaskConfigs[{}]".format(index)
        if not expect_object(errors, config, base):
            continue
        if not matches(REGION_RE, config.get("region")):
            errors.add(
                base + ".region",
                "Invalid region format (expected: us-west-2, us-gov-west-1, eu-central-1, etc.)",
            )
        validate_task_count(errors, config.get("taskCount"), base + ".taskCount")
        validate_concurrency(errors, config.get("concurrency"), base + ".concurrency")


def validate_regional_task_details(errors, value):
    """createTestSchema requires regionalTaskDetails: a map of Region to an
    object carrying dltAvailableTasks. The web console and the dlt CLI fill it
    in. A raw POST /scenarios must include it, or the API rejects the request."""
    if value is None:
        errors.add(
            "regionalTaskDetails",
            "regionalTaskDetails is required (a map of region to {dltAvailableTasks}); "
            "the console and the dlt CLI fill it in, and a raw POST must compute it from GET /vCPUDetails",
        )
        return
    if not isinstance(value, dict):
        errors.add("regionalTaskDetails", "regionalTaskDetails must be an object keyed by region")
        return
    for region, details in value.items():
        base = "regionalTaskDetails.{}".format(region)
        if not isinstance(details, dict):
            errors.add(base, "regionalTaskDetails entry must be an object with dltAvailableTasks")
            continue
        available = details.get("dltAvailableTasks")
        # This mirrors createTestSchema exactly: a number must be a positive integer,
        # but a string only has to match ^\d+$, so the string "0" passes the schema.
        # createTest then rejects any taskCount above it, which
        # check_create_test_rules reports.
        if is_int(available):
            if available < 1:
                errors.add(base + ".dltAvailableTasks", "dltAvailableTasks must be a positive integer")
        elif not matches(DIGITS_RE, available):
            errors.add(base + ".dltAvailableTasks", "dltAvailableTasks must be a positive integer")


def validate_native_run_mode(errors, native_run_mode, test_type):
    """Check the Native-only rules.

    ``nativeRunMode`` is a strict object in the API schema: its only member is
    ``maxTestDurationSeconds``, and the API rejects any additional key outright.
    Native mode also needs an uploaded script, so the schema rejects it for
    ``simple`` tests. This function flags each of these before the payload
    reaches the API.
    """
    if native_run_mode is ABSENT:
        return
    if test_type == "simple":
        errors.add("nativeRunMode", "nativeRunMode is only supported for jmeter, k6, and locust tests")
    if not isinstance(native_run_mode, dict):
        errors.add("nativeRunMode", "nativeRunMode must be an object")
        return

    max_duration = native_run_mode.get("maxTestDurationSeconds")
    if not is_int(max_duration):
        errors.add("nativeRunMode.maxTestDurationSeconds", "maxTestDurationSeconds must be an integer")
    else:
        if max_duration < 1:
            errors.add("nativeRunMode.maxTestDurationSeconds", "maxTestDurationSeconds must be at least 1")
        if max_duration > MAX_TEST_DURATION_SECONDS:
            errors.add(
                "nativeRunMode.maxTestDurationSeconds",
                "maxTestDurationSeconds must not exceed {} (24 hours)".format(MAX_TEST_DURATION_SECONDS),
            )

    # Zod reports every unknown key of a strict object in one issue, in the
    # order the keys appear in the payload.
    unknown = [key for key in native_run_mode if key not in NATIVE_RUN_MODE_KEYS]
    if unknown:
        noun = "key" if len(unknown) == 1 else "keys"
        errors.add(
            "nativeRunMode",
            "Unrecognized {}: {}".format(noun, ", ".join('"{}"'.format(key) for key in unknown)),
        )


def validate_create_test(payload):
    """Return an Errors object mirroring createTestSchema on the given payload."""
    errors = Errors()

    if not isinstance(payload, dict):
        errors.add("value", "request body must be a JSON object")
        return errors

    test_id = optional(errors, payload, "testId", "testId")
    if test_id is not ABSENT:
        if not is_str(test_id) or len(test_id) < 1:
            errors.add("testId", "testId is required")
        else:
            if len(test_id) > TEST_ID_MAX:
                errors.add("testId", "testId must not exceed {} characters".format(TEST_ID_MAX))
            if not TEST_ID_RE.fullmatch(test_id):
                errors.add("testId", "testId must contain only alphanumeric characters and hyphens")

    validate_name(errors, payload.get("testName"), "testName", "testName")

    description = payload.get("testDescription")
    if not is_str(description):
        errors.add("testDescription", "testDescription must be a string")
    else:
        if len(description) < DESCRIPTION_MIN:
            errors.add("testDescription", "testDescription must be at least {} characters".format(DESCRIPTION_MIN))
        if len(description) > DESCRIPTION_MAX:
            errors.add("testDescription", "testDescription must not exceed {} characters".format(DESCRIPTION_MAX))

    test_type = payload.get("testType")
    if test_type not in TEST_TYPES:
        errors.add("testType", "testType must be one of: simple, jmeter, locust, k6")

    file_type = optional(errors, payload, "fileType", "fileType")
    if file_type is not ABSENT and file_type not in FILE_TYPES:
        errors.add("fileType", "fileType must be one of: none, script, zip")

    # Cross-field: framework tests cannot use fileType "none". Only "simple"
    # may run without a script or zip.
    if test_type in FRAMEWORK_TEST_TYPES and file_type == "none":
        errors.add("fileType", "fileType must be script or zip for {} tests".format(test_type))

    if "testTaskConfigs" not in payload:
        errors.add("testTaskConfigs", "At least one test task configuration is required")
    else:
        validate_task_configs(errors, payload["testTaskConfigs"])

    test_scenario = payload.get("testScenario")
    scenario_names = []
    if not isinstance(test_scenario, dict):
        errors.add("testScenario", "testScenario must be an object")
    else:
        scenarios = optional(errors, test_scenario, "scenarios", "testScenario.scenarios")
        if scenarios is not ABSENT:
            validate_scenarios(errors, scenarios, "testScenario.scenarios")
            if isinstance(scenarios, dict):
                scenario_names = list(scenarios.keys())
        if "execution" not in test_scenario:
            errors.add("testScenario.execution", "At least one execution configuration is required")
        else:
            validate_execution(errors, test_scenario["execution"], scenario_names)

    tags = optional(errors, payload, "tags", "tags")
    if tags is not ABSENT:
        if not isinstance(tags, list):
            errors.add("tags", "tags must be an array")
        elif len(tags) > MAX_TAGS:
            errors.add("tags", "Maximum {} tags allowed per scenario".format(MAX_TAGS))
        else:
            for index, tag in enumerate(tags):
                if not is_str(tag):
                    errors.add(
                        "tags[{}]".format(index),
                        "Invalid input: expected string, received {}".format(json_type_name(tag)),
                    )

    threshold = optional(errors, payload, "healthyThreshold", "healthyThreshold")
    if threshold is not ABSENT:
        if not is_int(threshold):
            errors.add("healthyThreshold", "healthyThreshold must be an integer")
        elif threshold < HEALTHY_THRESHOLD_MIN or threshold > HEALTHY_THRESHOLD_MAX:
            errors.add(
                "healthyThreshold",
                "healthyThreshold must be between {} and {}".format(HEALTHY_THRESHOLD_MIN, HEALTHY_THRESHOLD_MAX),
            )

    validate_regional_task_details(errors, payload.get("regionalTaskDetails"))

    validate_schedule_fields(errors, payload)

    for key in ("showLive", "saveOnly"):
        if key in payload and not isinstance(payload[key], bool):
            errors.add(key, "{} must be a boolean".format(key))

    validate_native_run_mode(errors, optional(errors, payload, "nativeRunMode", "nativeRunMode"), test_type)

    return errors


def validate_schedule_fields(errors, payload):
    """Mirror the pattern checks on the optional scheduling fields."""
    step = optional(errors, payload, "scheduleStep", "scheduleStep")
    if step is not ABSENT and step not in SCHEDULE_STEPS:
        errors.add("scheduleStep", "scheduleStep must be one of: create, start")
    for key in ("scheduleDate", "cronExpiryDate"):
        value = optional(errors, payload, key, key)
        if value is not ABSENT and not matches(SCHEDULE_DATE_RE, value):
            errors.add(key, "Invalid date format. Expected format: YYYY-MM-DD")
    time_value = optional(errors, payload, "scheduleTime", "scheduleTime")
    if time_value is not ABSENT and not matches(SCHEDULE_TIME_RE, time_value):
        errors.add("scheduleTime", "Invalid time format. Expected format: HH:MM or HH:MM:SS")
    recurrence = optional(errors, payload, "recurrence", "recurrence")
    if recurrence is not ABSENT and recurrence not in RECURRENCES:
        errors.add("recurrence", "recurrence must be one of: daily, weekly, biweekly, monthly")
    cron_value = optional(errors, payload, "cronValue", "cronValue")
    if cron_value is not ABSENT and not matches(CRON_RE, cron_value):
        errors.add(
            "cronValue",
            "Invalid cron expression format. Hours support step values and lists. "
            "Day-of-week supports ranges and lists.",
        )
    timezone = optional(errors, payload, "scheduleTimezone", "scheduleTimezone")
    if timezone is not ABSENT:
        if not is_str(timezone):
            errors.add("scheduleTimezone", "scheduleTimezone must be a string")
        elif len(timezone) > SCHEDULE_TIMEZONE_MAX:
            errors.add(
                "scheduleTimezone",
                "scheduleTimezone must not exceed {} characters".format(SCHEDULE_TIMEZONE_MAX),
            )
    event_bridge = optional(errors, payload, "eventBridge", "eventBridge")
    if event_bridge is not ABSENT and not is_str(event_bridge):
        errors.add("eventBridge", "eventBridge must be a string")


def check_create_test_rules(payload):
    """Return the rules createTest enforces after the schema has passed.

    These come back as HTTP 400 with a `<Code>: <message>` body rather than an
    INVALID_REQUEST_BODY string, so they are reported on their own. The
    v4.3.0 and v4.3.1 duration rule is not here; duration_notes reports it.
    """
    errors = Errors()
    if not isinstance(payload, dict):
        return errors

    details = payload.get("regionalTaskDetails")
    task_configs = payload.get("testTaskConfigs")
    if isinstance(details, dict) and isinstance(task_configs, list):
        for config in task_configs:
            if not isinstance(config, dict) or not is_str(config.get("region")):
                continue
            region = config["region"]
            entry = details.get(region)
            if not isinstance(entry, dict):
                errors.add(
                    "InvalidRegionalStack",
                    'The regional stack for "{}" no longer exists. Please remove this region from the '
                    "scenario or redeploy the regional stack. (regionalTaskDetails has no entry for "
                    "{}.){}".format(region, region, CAPACITY_VERSION_NOTE),
                )
                continue
            available = coerce_positive_int(entry.get("dltAvailableTasks"))
            task_count = coerce_positive_int(config.get("taskCount"))
            if available is not None and task_count is not None and task_count > available:
                errors.add(
                    "InvalidParameter",
                    "Task count should be positive number between 1 to {}. ({} requests {} tasks.){}".format(
                        available, region, task_count, CAPACITY_VERSION_NOTE
                    ),
                )

    first = first_execution(payload)
    if first is not None:
        for key, placeholder in (("ramp-up", "0s"), ("hold-for", "1s")):
            if first.get(key) is None:
                # createTest parses both fields unconditionally, so a missing one
                # fails with a TypeError even though the schema marks it optional.
                errors.add(
                    "testScenario.execution[0].{}".format(key),
                    "{} is required by createTest even in Native mode, where it is an unused "
                    'placeholder; the console and the CLI send "{}"'.format(key, placeholder),
                )
    return errors


def first_execution(payload):
    """Return testScenario.execution[0] when it is an object, else None."""
    test_scenario = payload.get("testScenario") if isinstance(payload, dict) else None
    execution = test_scenario.get("execution") if isinstance(test_scenario, dict) else None
    if isinstance(execution, list) and execution and isinstance(execution[0], dict):
        return execution[0]
    return None


def duration_notes(payload):
    """Return notes for durations that DLT v4.3.0 and v4.3.1 cannot start.

    On those releases createTest computes the run duration from execution[0]
    and reads only strings with an s or m suffix. v4.3.2 and later accept every
    form the schema allows, so these are notes and never change the exit code.
    """
    notes = []
    first = first_execution(payload)
    if first is None:
        return notes
    for key in ("ramp-up", "hold-for"):
        value = first.get(key)
        if value is None:
            continue
        if key == "ramp-up" and is_int(value) and value == 0:
            continue
        if is_str(value) and RUN_DURATION_RE.match(value):
            continue
        # A value the schema rejects is already reported as a schema issue, and no
        # release accepts it, so it gets no note.
        schema_check = Errors()
        validate_duration(schema_check, value, key, key, allow_zero=(key == "ramp-up"))
        if schema_check:
            continue
        if key == "hold-for" and is_int(value):
            notes.append(
                "On DLT v4.3.0 and v4.3.1, createTest rejects testScenario.execution[0].hold-for = {!r} "
                "when the run starts, with TypeError: testDuration.match is not a function. Write the "
                "value as a string such as 30s or 120m; each field is capped at 1440 minutes. v4.3.2 "
                "and later accept this value.".format(value)
            )
        else:
            notes.append(
                "On DLT v4.3.0 and v4.3.1, createTest rejects testScenario.execution[0].{} = {!r} when "
                "the run starts, with InvalidParameter: Invalid hold-for unit, it should be either m or s. "
                "Write hours as minutes, for example 2h as 120m; each field is capped at 1440 minutes. "
                "v4.3.2 and later accept this value.".format(key, value)
            )
    return notes


def normalize_tag(tag):
    """Mirror the scenarios handler's normalizeTag (api-services/lib/scenarios)."""
    text = str(tag).strip().lower()
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"[^a-z0-9-]", "", text)
    text = re.sub(r"-+", "-", text)
    return re.sub(r"^-|-$", "", text)


def tag_rewrites(payload):
    """Return notes for tags the handler will store differently from how they were sent."""
    notes = []
    tags = payload.get("tags") if isinstance(payload, dict) else None
    if not isinstance(tags, list) or len(tags) > MAX_TAGS:
        return notes
    seen = set()
    for tag in tags:
        if not is_str(tag):
            # The schema rejects a non-string tag, which validate_create_test reports.
            continue
        stored = normalize_tag(tag)
        if not stored or len(stored) > 50:
            notes.append("tag {!r} is dropped: it normalizes to {!r}, outside 1 to 50 characters".format(tag, stored))
        elif stored in seen:
            notes.append("tag {!r} is dropped as a duplicate of {!r} after normalization".format(tag, stored))
        elif stored != tag:
            notes.append("tag {!r} is stored as {!r}".format(tag, stored))
        if stored and len(stored) <= 50:
            seen.add(stored)
    return notes


def read_input(argv):
    """Return the input as text, raising UnicodeDecodeError if it is not UTF-8."""
    if len(argv) > 1 and argv[1] != "-":
        with open(argv[1], "rb") as handle:
            data = handle.read()
    else:
        data = sys.stdin.buffer.read()
    return data.decode("utf-8")


def reject_constant(name):
    raise ValueError("{} is not valid JSON".format(name))


def parse_payload(raw):
    """Parse the body as JSON.parse would, which rejects NaN and Infinity."""
    return json.loads(raw, parse_constant=reject_constant)


def main(argv):
    if any(arg in ("-h", "--help") for arg in argv[1:]):
        print(__doc__)
        return 0

    try:
        raw = read_input(argv)
    except OSError as exc:
        print("Could not read input: {}".format(exc), file=sys.stderr)
        return 2
    except UnicodeDecodeError as exc:
        print("Could not read input: it is not UTF-8 ({})".format(exc), file=sys.stderr)
        return 2

    try:
        payload = parse_payload(raw)
    except (ValueError, RecursionError) as exc:
        # The API returns HTTP 400 "Invalid JSON in request body" for this case.
        print("Invalid JSON in request body: {}".format(exc), file=sys.stderr)
        return 2

    errors = validate_create_test(payload)
    later = check_create_test_rules(payload)
    notes = tag_rewrites(payload)
    durations = duration_notes(payload)

    if not errors and not later:
        print("OK: payload satisfies every checked create-test rule.")
        print_notes(notes)
        print_duration_notes(durations)
        return 0

    if errors:
        print("Found {} schema issue(s). The API would reject this payload.".format(len(errors.items)))
        print("")
        for item in errors.items:
            print("  - {}".format(item))
        print("")
        # Preview the HTTP 400 body string the API would return (approximate).
        combined = "; ".join(errors.items)
        print("Preview of the API response body (HTTP 400, approximate):")
        print('  "INVALID_REQUEST_BODY: {}"'.format(combined))
    if later:
        if errors:
            print("")
        print(
            "Found {} issue(s) that createTest rejects after the schema passes, "
            "each as its own HTTP 400:".format(len(later.items))
        )
        print("")
        for item in later.items:
            print("  - {}".format(item))
    print_notes(notes)
    print_duration_notes(durations)
    return 1


def print_notes(notes):
    if notes:
        print("")
        print("Note: the scenarios handler rewrites tags instead of rejecting them:")
        for note in notes:
            print("  - {}".format(note))


def print_duration_notes(notes):
    if notes:
        print("")
        print("Note: these durations start only on DLT v4.3.2 and later:")
        for note in notes:
            print("  - {}".format(note))


if __name__ == "__main__":
    sys.exit(main(sys.argv))
