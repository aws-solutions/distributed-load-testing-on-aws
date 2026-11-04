#!/usr/bin/env python3
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0
"""Lint a DLT test script or zip against the Native container contract.

The linter uses only the standard library, so it runs anywhere Python 3.9+ is
available. Given a framework and a path to either a bare script or a zip
archive, it simulates the Native DLT engine's flatten-and-discover behavior. It
then reports whether the container will find the entry point, plus the silent
traps that make a present file look missing. It reads each backslash in an entry
name as a folder separator, as Native extraction does.

Standard mode (Taurus) searches the whole extracted tree and runs the first
match, so a zip with another candidate file, such as lib/types.d.ts beside a k6
script.js, can run a different file there. Its search also matches only a
lowercase extension and skips underscore names. The linter warns when Standard
mode would pick a different file or none.

It also scans every text file in the bundle, dotfiles included, for AWS access
keys. DLT keeps each uploaded bundle in the stack's versioned scenarios bucket,
where console users can download it, so a key must be caught before upload. The
report gives the file and line of each match and the first four characters of a
key ID, never any part of a secret. A file that looks binary is skipped with a
warning.

Usage:
    python3 lint_bundle.py --framework <jmeter|k6|locust> <path>

Exit code:
    0  the bundle satisfies the Native entry-point contract
    1  the bundle would hard-fail Native setup, carries a long-term access key
       or a secret access key, or the input is unusable

This script is part of the dlt-test-packaging-and-lint skill. See
references/native-vs-standard-packaging.md and references/ignored-file-rules.md
for the rules this encodes.
"""

import argparse
import codecs
import io
import os
import re
import sys
import zipfile

FRAMEWORKS = ("jmeter", "k6", "locust")

# Native entry-point contract, mirroring source/load-tester/src/archive/find-script.ts.
# jmeter and k6 match by extension (in order); locust matches an exact file name.
BARE_EXTENSIONS = {
    "jmeter": (".jmx",),
    "k6": (".ts", ".js"),
    "locust": (".py",),
}

# Unix file types in the top 16 bits of a zip entry's external attributes.
S_IFMT = 0o170000
S_IFREG = 0o100000
NON_REGULAR_TYPES = {0o120000: "symlink", 0o010000: "FIFO", 0o020000: "character device", 0o060000: "block device",
                     0o140000: "socket", 0o040000: "directory mode without a trailing slash"}

# What load-test.sh runs in Standard mode (a recursive find, first match wins),
# and how to make that match the Native entry point.
STANDARD_SEARCH = {
    "jmeter": ("the first .jmx file that find returns at any depth", "keep one .jmx file in the zip"),
    "k6": ("the first .ts file that find returns at any depth, or the first .js file when there is no .ts file",
           "make the entry point the only .ts file in the zip, or the only .js file when there is no .ts file"),
    "locust": ("the first locustfile.py that find returns at any depth", "keep one locustfile.py in the zip"),
}

# Levels, ordered from most to least severe for reporting.
ERROR = "ERROR"  # Native setup would hard-fail
WARN = "WARN"    # runtime risk, or a Standard-only feature that Native ignores
INFO = "INFO"    # neutral observation
PASSED = "PASS"  # the Native entry-point contract is satisfied


# ─── Ignore rules (source/load-tester/src/archive/ignored-files.ts) ──────────

def is_ignored(name):
    """Return True for a single path component the Native engine treats as noise."""
    return name.startswith(".") or name == "__MACOSX"


def has_ignored_component(path):
    """Return True if any component of a zip entry path would be ignored."""
    return any(is_ignored(part) for part in path.split("/") if part)


# ─── Credential scan ─────────────────────────────────────────────────────────
# Key IDs follow the IAM identifier prefixes: AKIA for a long-term access key and
# ASIA for a temporary one. A secret access key is 40 base64 characters, so a
# value of that shape counts only near a key field or a key ID: on the same line
# or within the two lines above, as in a JMeter Argument.name and Argument.value.
# A secret with an ASIA key ID within two lines of it belongs to that temporary key.
# A key ID may follow any character but an uppercase letter or digit (KEY_AKIA...),
# and a secret may follow '=' (AWS_SECRET_ACCESS_KEY=...).
LONG_TERM_KEY_RE = re.compile(r"(?<![A-Z0-9])AKIA[0-9A-Z]{16}(?![A-Z0-9])")
TEMPORARY_KEY_RE = re.compile(r"(?<![A-Z0-9])ASIA[0-9A-Z]{16}(?![A-Z0-9])")
KEY_FIELD_RE = re.compile(r"(?i:secret[_-]?(?:access[_-]?)?key|access[_-]?key)"
                          r"|(?<![A-Z0-9])[AS]IA[0-9A-Z]{16}(?![A-Z0-9])")
SECRET_VALUE_RE = re.compile(r"(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+=])")
FIELD_WINDOW = 2
SNIFF_BYTES = 8192
# Bounds on what one zip member can make the linter hold in memory, so that a
# small archive that decompresses to gigabytes cannot exhaust it.
MAX_MEMBER_READ = 4 * 1024 * 1024  # bytes read from a .py or requirements.txt member
MAX_LINE_CHARS = 1024 * 1024  # characters of one line held at a time by the credential scan
STORED_BUNDLE = ("DLT keeps every uploaded bundle in the stack's versioned scenarios bucket, where console users "
                 "can download it and old versions survive a replace, a delete, and the stack itself.")


def likely_secret(value):
    """Return True for a 40-character value mixed like a generated secret key.

    A SHA-1 digest or an identifier lacks either a letter case or a digit, slash, or plus.
    """
    return all(re.search(p, value) for p in ("[a-z]", "[A-Z]", "[0-9/+]"))


def scan_lines(name, chunks):
    """Return (kind, "file:line", prefix) for each credential in one text file.

    chunks are lines, or pieces of a long line, as readline(limit) returns them.
    kind is long-term, temporary, or secret, and a secret's prefix is empty. A
    secret within FIELD_WINDOW lines of a temporary key ID is taken to belong to
    that key, so the temporary-key warning covers it instead of an error.
    """
    hits, secrets, temporary = [], [], set()
    recent = [False] * (FIELD_WINDOW + 1)  # a key field on this line or one of the two above
    number, new_line = 0, True
    for chunk in chunks:
        if new_line:
            number += 1
            recent = recent[1:] + [False]
        new_line = chunk.endswith("\n")
        where = "%s:%d" % (name, number)
        for kind, pattern in (("long-term", LONG_TERM_KEY_RE), ("temporary", TEMPORARY_KEY_RE)):
            for match in pattern.finditer(chunk):
                hits.append((kind, where, match.group(0)[:4]))
                if kind == "temporary":
                    temporary.add(number)
        recent[-1] = recent[-1] or KEY_FIELD_RE.search(chunk) is not None
        if any(recent):
            secrets.extend((number, ("secret", where, "")) for match in SECRET_VALUE_RE.finditer(chunk)
                           if likely_secret(match.group(0)))
    return hits + [hit for number, hit in secrets
                   if not any(abs(number - line) <= FIELD_WINDOW for line in temporary)]


def scan_stream(name, opener):
    """Scan one file for credentials. opener returns a new binary stream each call.

    A file with a NUL byte in its first 8 KiB counts as binary, unless it starts
    with a UTF-16 byte order mark. It is not scanned, and the result is None.
    """
    with opener() as raw:
        head = raw.read(SNIFF_BYTES)
    encoding = "utf-16" if head[:2] in (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE) else "utf-8"
    if encoding == "utf-8" and b"\0" in head:
        return None
    with io.TextIOWrapper(opener(), encoding=encoding, errors="replace") as text:
        return scan_lines(name, iter(lambda: text.readline(MAX_LINE_CHARS), ""))


def credential_findings(hits, unreadable=(), binary=()):
    """Turn credential hits into findings. No finding repeats a secret or a whole key ID."""
    def places(kind):
        found = [hit for hit in hits if hit[0] == kind]
        shown = ", ".join(where + (" (%s...)" % prefix if prefix else "") for _, where, prefix in found[:5])
        return shown + (" and %d more" % (len(found) - 5) if len(found) > 5 else "") if found else ""

    findings = []
    if places("long-term"):
        findings.append((ERROR, "long-term AWS access key ID (AKIA) at %s. %s Remove the key and sign with "
                                "temporary credentials. If any copy of this bundle was uploaded, deactivate "
                                "and rotate the key in IAM now." % (places("long-term"), STORED_BUNDLE)))
    if places("secret"):
        findings.append((ERROR, "likely AWS secret access key next to an access key field at %s. %s Remove the "
                                "secret. If any copy of this bundle was uploaded and the secret belongs to a "
                                "long-term key, deactivate and rotate that key in IAM now."
                         % (places("secret"), STORED_BUNDLE)))
    if places("temporary"):
        findings.append((WARN, "temporary AWS access key ID (ASIA) at %s. It expires, but the key, its secret, and "
                               "its session token stay stored after it does. %s Use a role that allows only what "
                               "the test calls, for a session no longer than the test."
                         % (places("temporary"), STORED_BUNDLE)))
    if unreadable:
        findings.append((WARN, "could not read these entries for the credential scan, so check them by hand: %s"
                         % ", ".join(unreadable[:5])))
    if binary:
        findings.append((WARN, "the credential scan skipped these entries as binary, because each has a NUL byte "
                               "in its first 8 KiB, so check them by hand: %s%s"
                         % (", ".join(binary[:5]), " and %d more" % (len(binary) - 5) if len(binary) > 5 else "")))
    return findings


# ─── Python dependency checks for Locust ─────────────────────────────────────
# These sets define what a Locust test may import without declaring anything. Both
# images carry the standard library, locust, and Locust's own dependencies. The
# Standard image also carries every package bzt and the AWS CLI install, PyYAML
# among them, because Locust runs in that same interpreter. The Native image is a
# venv holding only locust and its own dependencies, so `import yaml` fails there
# unless the bundle declares PyYAML in requirements.txt. Locust's own dependencies
# (requests, gevent, and so on) are importable in both images but are not a
# contract, so they are still reported, as a warning rather than an error.
#
# This is a broad, not exhaustive, list of stdlib top-level modules. A name not
# listed here is reported as a WARN, not as a hard error, to avoid failing a
# bundle over an obscure stdlib module.
STDLIB_MODULES = {
    "__future__", "abc", "argparse", "array", "ast", "asyncio", "base64",
    "bisect", "builtins", "bz2", "calendar", "cmath", "codecs", "collections",
    "concurrent", "configparser", "contextlib", "contextvars", "copy", "csv",
    "ctypes", "dataclasses", "datetime", "decimal", "difflib", "dis",
    "email", "encodings", "enum", "errno", "faulthandler", "fnmatch",
    "fractions", "functools", "gc", "getopt", "getpass", "gettext", "glob",
    "gzip", "hashlib", "heapq", "hmac", "html", "http", "imaplib", "importlib",
    "inspect", "io", "ipaddress", "itertools", "json", "keyword", "linecache",
    "locale", "logging", "lzma", "math", "mimetypes", "multiprocessing",
    "numbers", "operator", "os", "pathlib", "pickle", "pkgutil", "platform",
    "pprint", "queue", "random", "re", "sched", "secrets", "select",
    "selectors", "shlex", "shutil", "signal", "smtplib", "socket",
    "socketserver", "sqlite3", "ssl", "stat", "statistics", "string",
    "stringprep", "struct", "subprocess", "sys", "sysconfig", "tarfile",
    "tempfile", "textwrap", "threading", "time", "timeit", "tkinter", "token",
    "tokenize", "traceback", "types", "typing", "unicodedata", "unittest",
    "urllib", "uuid", "venv", "warnings", "wave", "weakref", "webbrowser",
    "xml", "xmlrpc", "zipfile", "zipimport", "zlib", "zoneinfo",
}
# Importable in both images without a requirements.txt.
RUNTIME_EXTRA_MODULES = {"locust"}
# Importable in Standard mode only, because Taurus brings it into that image.
STANDARD_ONLY_MODULES = {"yaml"}

# Import names whose distribution name on PyPI differs, so that a requirements.txt
# line can be matched to the import it satisfies. Anything not listed is matched
# by normalized name.
IMPORT_TO_DISTRIBUTION = {
    "yaml": "pyyaml",
    "dateutil": "python-dateutil",
    "jwt": "pyjwt",
    "bs4": "beautifulsoup4",
    "PIL": "pillow",
    "dotenv": "python-dotenv",
    "google": "protobuf",
    "Crypto": "pycryptodome",
    "OpenSSL": "pyopenssl",
    "sklearn": "scikit-learn",
    "cv2": "opencv-python",
}

# "from x import a, b" names one top-level module, x. "import a, b.c as d" names
# one per comma-separated part, so each part is read separately.
FROM_RE = re.compile(r"^\s*from\s+([a-zA-Z_][a-zA-Z0-9_]*)")
IMPORT_STMT_RE = re.compile(r"^\s*import\s+(.+)")
MODULE_NAME_RE = re.compile(r"^([a-zA-Z_][a-zA-Z0-9_]*)")
REQUIREMENT_NAME_RE = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def normalize_distribution(name):
    """Apply PEP 503 normalization, so that PyYAML, pyyaml, and py_yaml compare equal."""
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_requirements(text):
    """Return the normalized distribution names a requirements.txt declares.

    Comments, blank lines, and pip options (lines starting with -) are skipped.
    Version specifiers, extras, and environment markers are dropped.
    """
    names = set()
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        match = REQUIREMENT_NAME_RE.match(line)
        if match:
            names.add(normalize_distribution(match.group(1)))
    return names


def is_declared(import_name, declared):
    """Return True if a requirements.txt name set covers this top-level import."""
    candidates = {normalize_distribution(import_name)}
    if import_name in IMPORT_TO_DISTRIBUTION:
        candidates.add(normalize_distribution(IMPORT_TO_DISTRIBUTION[import_name]))
    return bool(candidates & declared)


def find_third_party_imports(text):
    """Return top-level import names in Python source that the Native runtime
    does not provide without a requirements.txt. Relative imports (from .x) are
    skipped."""
    suspects = set()
    for line in text.splitlines():
        for statement in line.split("#", 1)[0].split(";"):
            for top in import_names(statement):
                if top not in STDLIB_MODULES and top not in RUNTIME_EXTRA_MODULES:
                    suspects.add(top)
    return sorted(suspects)


def import_names(statement):
    """Return the top-level module names one import statement brings in."""
    if re.match(r"^\s*from\s+\.", statement):
        return []  # relative import of a bundled module
    match = FROM_RE.match(statement)
    if match:
        return [match.group(1)]
    match = IMPORT_STMT_RE.match(statement)
    if not match:
        return []
    names = []
    for part in match.group(1).replace("(", " ").replace(")", " ").split(","):
        name = MODULE_NAME_RE.match(part.strip())
        if name:
            names.append(name.group(1))
    return names


def dependency_findings(suspects, declared, local_modules, bare=False):
    """Classify Locust imports against what the bundle declares.

    suspects lists the import names the Native runtime lacks. declared is the
    normalized requirements.txt name set, or None when the bundle ships no
    requirements.txt. local_modules lists the module names the bundle itself
    provides. A bare script cannot carry a requirements.txt, so its advice points
    at a zip instead.
    """
    where = ("a zip whose top-level requirements.txt declares %s" if bare
             else "a top-level requirements.txt that declares %s")
    findings = []
    undeclared = [m for m in suspects if m not in local_modules
                  and not (declared is not None and is_declared(m, declared))]
    covered = [m for m in suspects if m not in local_modules
               and declared is not None and is_declared(m, declared)]
    yaml_gap = [m for m in undeclared if m in STANDARD_ONLY_MODULES]
    other_gap = [m for m in undeclared if m not in STANDARD_ONLY_MODULES]
    if covered:
        findings.append((INFO, "imports declared in requirements.txt and installed at setup "
                               "(DLT v4.3.0 and later, both modes): %s" % ", ".join(covered)))
    if yaml_gap:
        findings.append((WARN, "imports yaml, which the Standard mode image provides through Taurus but "
                               "the Native image does not. In Native mode this fails at import time, so "
                               "the framework exits non-zero and the run measures nothing. Remove the "
                               "import, or ship %s (DLT v4.3.0 and later)." % (where % "PyYAML")))
    if other_gap:
        findings.append((WARN, "imports that neither image is guaranteed to provide and that requirements.txt "
                               "does not declare: %s. Locust's own dependencies, such as requests and gevent, "
                               "import in both modes, and Standard mode also carries the Taurus and AWS CLI "
                               "packages, but anything else fails at runtime. Declare each one in %s (DLT "
                               "v4.3.0 and later), or remove the import."
                         % (", ".join(other_gap), where % "them")))
    return findings


# ─── Zip structure simulation ────────────────────────────────────────────────

def immediate_children(names, prefix):
    """Return the immediate entries under a directory prefix ("" for the archive root).

    The result is a dict of child-name -> is_directory, matching how the Native
    engine sees a single directory level. A child is a directory if any entry
    shows it having descendants or if it is an explicit directory entry.
    """
    children = {}
    plen = len(prefix)
    for name in names:
        if prefix and not name.startswith(prefix):
            continue
        rest = name[plen:]
        if rest == "":
            continue
        parts = rest.split("/")
        first = parts[0]
        if first == "":
            continue
        is_dir = len(parts) > 1 or rest.endswith("/")
        children[first] = children.get(first, False) or is_dir
    return children


def effective_top_level(names):
    """Apply the Native single-wrapper flatten, returning (prefix, note).

    prefix is the directory prefix whose immediate files the entry-point search
    inspects. note describes whether a wrapper folder was flattened.
    """
    root = {n: d for n, d in immediate_children(names, "").items() if not is_ignored(n)}
    if len(root) == 0:
        return None, "archive has no usable entries after ignoring dotfiles and __MACOSX"
    if len(root) == 1:
        only_name, only_is_dir = next(iter(root.items()))
        if only_is_dir:
            return only_name + "/", "single wrapper folder '%s' is flattened to the top level" % only_name
    return "", "no single-wrapper flatten; the archive root is the top level"


def discover_entry(children, framework):
    """Return the discovered entry-point file name at this level, or None,
    following the Native contract. children is name -> is_directory."""
    files = sorted(name for name, is_dir in children.items()
                   if not is_dir and not is_ignored(name))
    if framework == "locust":
        return "locustfile.py" if "locustfile.py" in files else None
    for ext in BARE_EXTENSIONS[framework]:
        for name in files:
            if name.lower().endswith(ext):
                return name
    return None


def recursive_candidates(names, framework):
    """Return every entry in the archive that would qualify as an entry point
    if Native looked recursively (which it does not). The nesting diagnosis uses
    this list."""
    hits = []
    for name in names:
        if name.endswith("/") or has_ignored_component(name):
            continue
        base = name.rsplit("/", 1)[-1]
        if framework == "locust":
            if base == "locustfile.py":
                hits.append(name)
        else:
            for ext in BARE_EXTENSIONS[framework]:
                if base.lower().endswith(ext):
                    hits.append(name)
                    break
    return hits


def skipped_kind(name, info):
    """Return why Native extraction skips an entry, or None if it writes it.

    extract-zip.ts creates a directory for a name that ends in a slash, and
    otherwise writes only an entry whose unix file type is unset or regular.
    It skips every other entry, such as a symlink or a FIFO.
    """
    file_type = (info.external_attr >> 16) & S_IFMT
    if name.endswith("/") or file_type in (0, S_IFREG):
        return None
    return NON_REGULAR_TYPES.get(file_type, "file type 0o%o" % file_type)


def has_zip_slip(name):
    """Return True if yauzl rejects an entry name, which aborts Native extraction.

    The name already has its backslashes turned into slashes, as yauzl does.
    yauzl then rejects a leading slash or a drive letter such as C: as an
    absolute path, and a .. component as an invalid relative path.
    """
    return name.startswith("/") or re.match(r"[A-Za-z]:", name) is not None or ".." in name.split("/")


def standard_mode_picks(names, framework):
    """Return the archive paths Standard mode's entry-point search can return.

    This models load-test.sh. It flattens a lone wrapper folder when every other
    root name starts with a dot or an underscore, and copies with cp -r dir/*,
    which leaves out dot names at that level. Its find matches extensions
    case-sensitively, and its JMeter and Locust searches skip dot and underscore
    paths. None means the root holds only such names, which is not modeled.
    """
    root = [(n, d) for n, d in immediate_children(names, "").items() if not n.startswith((".", "_"))]
    if not root:
        return None
    prefix = root[0][0] + "/" if len(root) == 1 and root[0][1] else ""
    tree = [(n, n[len(prefix):]) for n in names
            if n.startswith(prefix) and not n.endswith("/") and not n[len(prefix):].startswith(".")]

    def shown(rel):
        return not any(part.startswith((".", "_")) for part in rel.split("/"))

    if framework == "k6":
        for ext in (".ts", ".js"):
            picks = [n for n, rel in tree if rel.endswith(ext)]
            if picks:
                return picks
        return []
    if framework == "jmeter":
        return [n for n, rel in tree if rel.endswith(".jmx") and shown(rel) and not rel.startswith("jmeter-bundle/")]
    return [n for n, rel in tree if rel.rsplit("/", 1)[-1] == "locustfile.py" and shown(rel)]


def standard_mode_gaps(names, prefix, entry, framework):
    """Return warnings for a bundle that Native finds but Standard mode may not.

    Standard mode (load-test.sh) matches extensions case-sensitively, ignores
    root names that start with an underscore when it decides whether to flatten
    a wrapper folder, and skips underscore paths in its JMeter and Locust
    searches. Its search is recursive, so it can also run another file.
    """
    findings = []
    if framework != "locust":
        extension = entry.rsplit(".", 1)[-1]
        if extension != extension.lower():
            findings.append((WARN, "the entry point '%s' has an uppercase extension. Standard mode finds only "
                                   "a lowercase extension, so this entry point runs in Native mode only; rename "
                                   "it to end with .%s." % (entry, extension.lower())))
    if framework == "jmeter" and entry.startswith("_"):
        findings.append((WARN, "the entry point '%s' starts with an underscore. Standard mode skips names that "
                               "start with an underscore, so this bundle runs in Native mode only." % entry))
    if prefix.startswith("_"):
        findings.append((WARN, "the wrapper folder '%s' starts with an underscore. Standard mode skips names "
                               "that start with an underscore when it flattens a wrapper folder, so this "
                               "bundle runs in Native mode only." % prefix.rstrip("/")))
    picks = None if findings else standard_mode_picks(names, framework)
    native_path = prefix + entry
    search, advice = STANDARD_SEARCH[framework]
    if picks == []:
        findings.append((WARN, "Standard mode runs %s, and this zip has none, so the bundle runs in Native "
                               "mode only." % search))
    elif picks and picks != [native_path]:
        others = [n for n in picks if n != native_path][:5]
        findings.append((WARN, "Standard mode runs %s, so for this zip it %s %s instead of the Native entry "
                               "point '%s'. To run the same file in both modes, %s.%s"
                         % (search, "may run" if native_path in picks else "would run",
                            " or ".join("'%s'" % n for n in others), native_path, advice,
                            " Remove __MACOSX." if any(n.startswith("__MACOSX/") for n in others) else "")))
    return findings


# ─── Linters ─────────────────────────────────────────────────────────────────

def lint_bare(path, framework):
    name = os.path.basename(path)
    try:
        hits = scan_stream(name, lambda: open(path, "rb"))
        findings = credential_findings(hits or [], binary=[name] if hits is None else [])
    except OSError as err:
        findings = credential_findings([], ["%s (%s)" % (name, err)])
    exts = BARE_EXTENSIONS[framework]
    if name.lower().endswith(exts):
        findings.append((PASSED, "bare %s script '%s' matches the expected extension %s"
                         % (framework, name, " or ".join(exts))))
    else:
        findings.append((ERROR, "bare %s script must end with %s; got '%s'"
                         % (framework, " or ".join(exts), name)))

    if is_ignored(name):
        findings.append((INFO, "the local file name does not matter for a bare upload, because DLT stores it "
                               "as <testId>.<ext>; inside a zip a leading dot would hide it"))

    if framework == "locust" and name != "locustfile.py":
        findings.append((INFO, "a bare upload is referenced by path, so the name need not be "
                               "'locustfile.py'; inside a zip it must be exactly 'locustfile.py'"))

    if framework == "locust":
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                suspects = find_third_party_imports(handle.read())
            # A bare script carries no requirements.txt, so nothing it imports
            # beyond the image contents can be installed.
            findings.extend(dependency_findings(suspects, None, set(), bare=True))
        except OSError as err:
            findings.append((WARN, "could not read script for dependency check: %s" % err))

    findings.append((INFO, "a bare script carries no companion files; if it reads any external "
                           "file (data set, config, helper module), upload a zip instead"))
    return findings


def lint_zip(path, framework):
    findings = []
    try:
        with zipfile.ZipFile(path) as zf:
            # Native extraction (yauzl) turns each backslash into a slash before
            # anything else, so the simulation does too. orig_filename keeps the
            # stored name, which Python rewrites on Windows.
            entries = [(info.filename.replace("\\", "/"), info) for info in zf.infolist()]
            names = [name for name, _ in entries]
            backslashed = [info.orig_filename for _, info in entries if "\\" in info.orig_filename]
            skipped = {}
            for name, info in entries:
                kind = skipped_kind(name, info)
                if kind:
                    skipped[name] = kind
            # The bucket stores the whole zip, so the scan reads every entry,
            # including the ones Native ignores or skips.
            hits, unreadable, binary = [], [], []
            for name, info in entries:
                if not name.endswith("/"):
                    try:
                        found = scan_stream(name, lambda info=info: zf.open(info))
                    except Exception as err:  # an encrypted, corrupt, or unsupported entry
                        unreadable.append("%s (%s)" % (name, err))
                        continue
                    if found is None:
                        binary.append(name)
                    else:
                        hits.extend(found)
            findings.extend(credential_findings(hits, unreadable, binary))
            py_sources = {}
            text_files = {}
            oversized = []
            if framework == "locust":
                for name, info in entries:
                    if has_ignored_component(name) or name.endswith("/") or name in skipped:
                        continue
                    base = name.rsplit("/", 1)[-1]
                    if name.endswith(".py") or base == "requirements.txt":
                        try:
                            with zf.open(info) as member:
                                data = member.read(MAX_MEMBER_READ + 1)
                        except (OSError, zipfile.BadZipFile):
                            continue
                        if len(data) > MAX_MEMBER_READ:
                            oversized.append(name)
                            continue
                        content = data.decode("utf-8", "replace")
                        if base == "requirements.txt":
                            text_files[name] = content
                        else:
                            py_sources[name] = content
    except (zipfile.BadZipFile, OSError) as err:
        return [(ERROR, "not a readable zip archive: %s" % err)]
    if oversized:
        findings.append((WARN, "entries larger than %d MiB were not read for the dependency check: %s"
                         % (MAX_MEMBER_READ // (1024 * 1024), ", ".join(oversized[:5]))))

    # yauzl rejects these names and aborts the whole extraction, so setup fails.
    slip = [info.orig_filename for name, info in entries if has_zip_slip(name)]
    if slip:
        findings.append((ERROR, "zip contains entries with a .. component, an absolute path, or a drive "
                               "letter such as C:, which Native extraction rejects as unsafe, so the whole "
                               "extraction and setup fail: %s" % ", ".join(slip[:5])))
    if backslashed:
        findings.append((WARN, "entry names use backslashes as folder separators, as PowerShell 5.1 "
                               "Compress-Archive writes them: %s. Native extraction and this lint read each "
                               "backslash as a folder separator. Standard mode's unzip does so only when the "
                               "zip records a Windows host, and otherwise writes file names that contain "
                               "backslashes. Rebuild the zip with forward slashes, as the zip format requires."
                         % ", ".join(backslashed[:5])))

    # Report ignored top-level entries, which are informational unless they hide
    # the entry point. Skip path-navigation components (. and ..), which are reported as zip-slip.
    ignored_present = sorted({n.split("/")[0] for n in names
                              if n.split("/")[0] not in ("", ".", "..")
                              and is_ignored(n.split("/")[0])})
    if ignored_present:
        findings.append((INFO, "top-level entries silently ignored: %s" % ", ".join(ignored_present)))

    # Native extraction never writes symlinks or other non-regular entries, so
    # they cannot be flattened or found as an entry point. Simulate only what
    # Native extracts. The zip-slip check above still sees every entry, because
    # Native rejects a traversal path before it decides to skip an entry.
    all_names = names
    names = [n for n in names if n not in skipped]

    # Simulate the Native flatten.
    prefix, note = effective_top_level(names)
    if prefix is None:
        findings.append((ERROR, note + " (empty archive hard-fails setup)"))
        return findings
    findings.append((INFO, note))

    # Run Native discovery at the effective top level.
    children = immediate_children(names, prefix)
    entry = discover_entry(children, framework)
    if entry is not None:
        shown = (prefix + entry) if prefix else entry
        findings.append((PASSED, "Native engine finds the %s entry point at the top level: '%s'"
                         % (framework, shown)))
        # Note ambiguity when several candidates sit at the top level.
        top_files = sorted(n for n, d in children.items()
                           if not d and not is_ignored(n))
        if framework == "locust":
            extra = [f for f in top_files if f.endswith(".py") and f != "locustfile.py"]
        else:
            extra = [f for f in top_files
                     if f.lower().endswith(BARE_EXTENSIONS[framework]) and f != entry]
        if framework != "locust" and extra:
            findings.append((WARN, "more than one candidate entry file at the top level (%s); Native picks "
                                   "one of them by locale-aware sort order, so the choice is not guaranteed. "
                                   "Keep exactly one entry point." % ", ".join([entry] + extra)))
        findings.extend(standard_mode_gaps(all_names, prefix, entry, framework))
    else:
        findings.append((ERROR, "Native engine finds no %s entry point at the top level" % framework))
        # Diagnose the common causes.
        nested = recursive_candidates(names, framework)
        if nested:
            findings.append((ERROR, "a matching file exists deeper in the archive (%s), but Native only "
                                   "looks at the top level. Standard mode (Taurus) would find it; Native "
                                   "fails. Move the entry point to the top level (or a single wrapper "
                                   "folder root)."
                             % ", ".join(nested[:5])))
        if framework == "locust":
            misnamed = [n.rsplit("/", 1)[-1] for n in names
                        if not n.endswith("/") and n.rsplit("/", 1)[-1].lower() == "locustfile.py"
                        and n.rsplit("/", 1)[-1] != "locustfile.py"]
            if misnamed:
                findings.append((ERROR, "found a mis-cased entry name (%s); locust requires exactly "
                                       "'locustfile.py'" % ", ".join(sorted(set(misnamed)))))
        dot_hidden = [n for n in names if not n.endswith("/")
                      and has_ignored_component(n)
                      and _would_match(n.rsplit("/", 1)[-1], framework)]
        if dot_hidden:
            findings.append((ERROR, "a candidate entry point is dot-prefixed or under __MACOSX and is "
                                   "silently ignored (%s). Rename it so it does not start with a dot."
                             % ", ".join(dot_hidden[:5])))

    # Native extraction skips symlinks, FIFOs, devices, and sockets.
    if skipped:
        findings.append((WARN, "non-regular entries are skipped and never recreated by Native extraction; "
                               "anything relying on them will be missing: %s"
                         % ", ".join("%s (%s)" % item for item in list(skipped.items())[:5])))

    # Run the framework-specific dependency and plugin checks.
    if framework == "locust":
        findings.extend(lint_locust_dependencies(names, prefix, py_sources, text_files))

    if framework == "jmeter":
        user_jars = [n for n in names if re.search(r"(^|/)plugins/[^/]+\.jar$", n)]
        if user_jars:
            findings.append((WARN, "user plugins/*.jar are installed only in Standard mode (Taurus), from the "
                                   "plugins/ folder next to the .jmx; the Native engine uses the bundled "
                                   "plugins only and ignores these: %s" % ", ".join(user_jars[:5])))

    return findings


def lint_locust_dependencies(names, prefix, py_sources, text_files):
    """Check requirements.txt and packages/ placement and the imports they cover.

    Both engines look for requirements.txt and packages/ at the effective top
    level, next to locustfile.py. The Native runner looks in the script's
    directory, and the Standard runner looks in its working directory after the
    wrapper flatten.
    """
    findings = []
    top_requirements = prefix + "requirements.txt"
    top_packages = prefix + "packages/"
    has_top_requirements = top_requirements in text_files
    has_top_packages = any(n.startswith(top_packages) for n in names)
    nested_requirements = sorted(k for k in text_files if k != top_requirements)

    declared = parse_requirements(text_files[top_requirements]) if has_top_requirements else None

    # Modules the bundle provides itself, so `import helpers` is not reported.
    local_modules = set()
    for name in names:
        if name.endswith(".py"):
            local_modules.add(name.rsplit("/", 1)[-1][:-3])
        parts = name.split("/")
        if len(parts) > 1 and parts[-1] == "__init__.py":
            local_modules.add(parts[-2])

    suspects = set()
    for text in py_sources.values():
        suspects.update(find_third_party_imports(text))
    findings.extend(dependency_findings(sorted(suspects), declared, local_modules))

    if has_top_requirements:
        source = ("offline from the bundled wheels in packages/ (--no-index)" if has_top_packages
                  else "from PyPI, so tasks need egress to pypi.org and files.pythonhosted.org")
        findings.append((INFO, "requirements.txt is installed during setup in both modes, %s. This needs "
                               "DLT v4.3.0 or later; earlier versions ignore the file. A failed install "
                               "fails the task before the test starts, and the Native install must finish "
                               "within 180 seconds." % source))
        if declared and "locust" in declared:
            findings.append((WARN, "requirements.txt installs its own locust, which takes precedence over the "
                                   "version in the image. Remove it unless you need a specific version."))
    elif nested_requirements:
        findings.append((WARN, "requirements.txt is not at the top level (%s). Both engines read it only "
                               "from the top level, next to locustfile.py, so nothing is installed."
                         % ", ".join(nested_requirements)))
    if has_top_packages and not has_top_requirements:
        findings.append((WARN, "a packages/ directory is present without a top-level requirements.txt, so "
                               "no wheels are installed. Add a requirements.txt that names them."))
    return findings


def _would_match(basename, framework):
    if framework == "locust":
        return basename.lstrip(".").lower() == "locustfile.py"
    return basename.lower().endswith(BARE_EXTENSIONS[framework])


# ─── Reporting ───────────────────────────────────────────────────────────────

def report(path, framework, mode, findings):
    print("DLT bundle lint")
    print("  input:     %s" % path)
    print("  framework: %s" % framework)
    print("  mode:      %s" % mode)
    print("")

    order = {ERROR: 0, WARN: 1, PASSED: 2, INFO: 3}
    for level in sorted({f[0] for f in findings}, key=lambda l: order[l]):
        for lvl, msg in findings:
            if lvl == level:
                print("  [%s] %s" % (lvl, msg))
    print("")

    errors = [f for f in findings if f[0] == ERROR]
    passes = [f for f in findings if f[0] == PASSED]
    if errors:
        print("RESULT: FAIL. Fix the ERROR items above before you upload the bundle.")
        return 1
    if passes:
        print("RESULT: PASS. The Native entry-point contract is satisfied. Review any WARN items.")
        return 0
    print("RESULT: FAIL. No entry point was confirmed.")
    return 1


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Lint a DLT test script or zip against the Native container contract.")
    parser.add_argument("--framework", required=True, choices=FRAMEWORKS,
                        help="load-test framework the bundle targets")
    parser.add_argument("path", help="path to a bare script or a .zip archive")
    args = parser.parse_args(argv)

    if not os.path.exists(args.path):
        print("error: no such file: %s" % args.path, file=sys.stderr)
        return 1

    if zipfile.is_zipfile(args.path):
        findings = lint_zip(args.path, args.framework)
        mode = "zip"
    else:
        findings = lint_bare(args.path, args.framework)
        mode = "bare script"

    return report(args.path, args.framework, mode, findings)


if __name__ == "__main__":
    sys.exit(main())
