# Ignored-file rules

When DLT unpacks an uploaded zip, it treats some entries as accidental packaging noise and hides them from the rest of the run. This matters because an ignored top-level name never reaches the test. If your real entry point matches an ignore rule, the container reports it as not found and hard-fails at setup.

The rule below is the Native engine's, grounded in `source/load-tester/src/archive/ignored-files.ts`. It is intentionally tight, because anything matched here disappears. At the end, this reference describes the broader version that the Standard engine's shell runner applies.

## The Rule

An entry is ignored when its name:

- starts with a dot (`.`), or
- is exactly `__MACOSX`.

That is the whole rule. As the container lists a directory, it applies the rule to each entry name in two places. One is the extraction root, when it decides whether to flatten a single wrapper folder. The other is the effective top level, when it copies the archive into place and finds the entry point. Deeper levels are exempt: a dotfile inside a subfolder, such as `data/.settings`, is copied with its folder.

## What This Covers in Practice

- macOS Finder metadata: the `__MACOSX/` folder and `._name` AppleDouble companion files that Finder zips carry.
- Editor and OS scratch files: `.DS_Store`, `.swp`, `.gitignore`, and anything else beginning with a dot.

DLT ignores these so a Finder-created or editor-polluted zip still works. The risk arises when a name you actually depend on happens to match.

## Names That Must Not Start with a Dot

If any of these begins with a dot, the container cannot see it and setup fails:

- The entry point itself: `locustfile.py`, your `*.jmx`, your `*.ts` or `*.js`. A file saved as `.locustfile.py` or `.plan.jmx` is silently skipped.
- Any companion your script reads at runtime: data sets, `locust.conf`, helper modules.

## `__init__.py` Is Deliberately Kept

`__init__.py` does not start with a dot and is not `__MACOSX`, so it is never ignored. This is intentional: Locust projects need `__init__.py` to import their own helper modules as a package. Keep it in the zip alongside `locustfile.py` when your script uses relative imports.

Do not confuse the double-underscore `__init__.py` (kept) with `__MACOSX` (ignored). The rule matches only the exact name `__MACOSX`; it does not match other double-underscore names such as `__init__.py` and `__pycache__`, though shipping compiled `__pycache__` is unnecessary.

## Common Mistakes This Rule Creates

1. A hidden entry point. Renaming or exporting a script with a leading dot makes it vanish. Rename it so the first character is not a dot.
2. An "empty" archive. A zip that contains only ignored entries (all dotfiles, or just `__MACOSX`) has no usable entries, and setup throws. Verify that your real files are present and un-dotted.
3. A Finder zip that nests. The Finder sometimes wraps files under a folder and adds `__MACOSX`. After ignoring `__MACOSX`, you may be left with a single wrapper folder (which flattens, fine) or with the real files one level deeper than the Native engine looks (which fails). Build the zip from the command line to avoid this.

## Not Part of the Ignore Rule, but Still Filtered

Two more classes are handled by extraction, not by the ignore rule:

- Symlink entries and other non-regular entries are skipped during extraction and never recreated. This is a safety measure, not a name-based ignore. A file that relies on a symlink will be missing at runtime.
- Entries whose path escapes the destination (`..` traversal or absolute paths, the zip-slip class) are rejected, and setup hard-fails.

## The Standard Engine's Version of the Rule

Standard mode unpacks the zip with `unzip` in `load-test.sh` and applies its own, broader filter:

- When deciding whether to flatten a single wrapper folder, it ignores every root entry whose name starts with `.` or `_`, not only `__MACOSX`. If it flattens, it copies only the wrapper's contents, so a sibling such as `_shared/` is left behind.
- The JMeter and Locust entry-point searches skip any path with a component that starts with `.` or `_`. A `locustfile.py` under `_tests/` is therefore not found.
- The k6 entry-point search applies no such filter, so an AppleDouble file such as `__MACOSX/._script.ts` can be chosen as the k6 entry point when the zip is not flattened. Remove `__MACOSX` from k6 zips.

A bundle that follows the Native rule (real files at the top level, nothing important named with a leading `.` or `_`, and lowercase extensions) satisfies both.
