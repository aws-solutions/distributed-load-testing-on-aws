#!/bin/bash
# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

# =========================================================================
# Tests for deployment/verify-notice.sh
# =========================================================================
# The reason verify-notice.sh exists is that RedPencil's attribution checks
# were trusted and did not do what the wiki said they did. An unverified
# replacement would be no better, so each case below builds a throwaway
# project with known package licenses and a NOTICE crafted to trip exactly
# one rule -- including the cases that must NOT produce a finding, which is
# where a license checker usually goes wrong.
#
# Usage:
#   ./scripts/test/verify-notice-test.sh
# =========================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly VERIFIER="$SCRIPT_DIR/../../deployment/verify-notice.sh"

passed=0
failed=0

# -------------------------------------------------------------------------
# Fixture helpers
# -------------------------------------------------------------------------

# Creates an empty project with a NOTICE skeleton. Callers add packages with
# add_package and attribution lines with attribute.
new_project() {
    FIXTURE=$(mktemp -d)
    mkdir -p "$FIXTURE/node_modules"
    cat >"$FIXTURE/NOTICE" <<'HEADER'
Distributed Load Testing

**********************
THIRD PARTY COMPONENTS
**********************

This software includes third party software subject to the following copyrights:

HEADER
    ATTRIBUTIONS="$FIXTURE/.attributions"
    FOOTER="$FIXTURE/.footer"
    LOCKFILE_ENTRIES=""
    : >"$ATTRIBUTIONS"
    : >"$FOOTER"
}

# add_package <name> <version> <license>
# A license of "-" omits the field entirely, for the undeclared case.
add_package() {
    local name="$1" version="$2" license="$3"
    local dir="$FIXTURE/node_modules/$name"
    mkdir -p "$dir"
    if [ "$license" = "-" ]; then
        printf '{"name":"%s","version":"%s"}' "$name" "$version" >"$dir/package.json"
    else
        printf '{"name":"%s","version":"%s","license":"%s"}' "$name" "$version" "$license" >"$dir/package.json"
    fi
}

# add_alias_package <install-name> <real-name> <version> <license>
# npm installs an aliased package at node_modules/<install-name> with the real
# package's own manifest inside it. That is why the manifest reader cannot
# resolve an alias: on disk it is indistinguishable from the deep-import stubs
# that reader exists to reject.
add_alias_package() {
    local install_name="$1" name="$2" version="$3" license="$4"
    local dir="$FIXTURE/node_modules/$install_name"
    mkdir -p "$dir"
    printf '{"name":"%s","version":"%s","license":"%s"}' \
        "$name" "$version" "$license" >"$dir/package.json"
}

# Adds a second copy of a package nested under another, which is how npm
# installs conflicting version ranges.
add_nested_package() {
    local parent="$1" name="$2" version="$3" license="$4"
    local dir="$FIXTURE/node_modules/$parent/node_modules/$name"
    mkdir -p "$dir"
    printf '{"name":"%s","version":"%s","license":"%s"}' "$name" "$version" "$license" >"$dir/package.json"
}

# add_lockfile_entry <name> <version> <license> [subdir] [extra-json]
# Records a package as shipped without installing it, which is what npm does for
# an optional dependency whose os/cpu exclude the host. A license of "-" omits
# the field, as npm does for aliases and link entries.
#
# subdir defaults to "." for a lockfile at the fixture root. It is a literal "."
# and not the empty string because write_lockfiles iterates the subdirectories
# through command substitution, which drops empty lines -- so an empty subdir
# silently wrote no lockfile at all and every test using one passed for the wrong
# reason.
#
# Entries accumulate into LOCKFILE_ENTRIES and are written by write_lockfiles at
# run time, so a test can add several before the JSON is assembled.
add_lockfile_entry() {
    local name="$1" version="$2" license="$3" subdir="${4:-.}" extra="${5:-}"
    local entry="\"version\":\"$version\""
    [ "$license" = "-" ] || entry="$entry,\"license\":\"$license\""
    [ -z "$extra" ] || entry="$entry,$extra"
    LOCKFILE_ENTRIES="$LOCKFILE_ENTRIES${LOCKFILE_ENTRIES:+
}${subdir}|node_modules/$name|{$entry}"
}

# Writes one package-lock.json per distinct subdirectory named above. Called by
# run_verifier, so a test with no lockfile entries gets no lockfile at all.
write_lockfiles() {
    [ -n "$LOCKFILE_ENTRIES" ] || return 0
    local subdir
    for subdir in $(printf '%s\n' "$LOCKFILE_ENTRIES" | cut -d'|' -f1 | sort -u); do
        local dir="$FIXTURE/$subdir"
        mkdir -p "$dir"
        {
            printf '{"name":"fixture","lockfileVersion":3,"packages":{"":{"name":"fixture"}'
            printf '%s\n' "$LOCKFILE_ENTRIES" |
                awk -F'|' -v s="$subdir" '$1 == s { printf ",\"%s\":%s", $2, $3 }'
            printf '}}\n'
        } >"$dir/package-lock.json"
    done
}

attribute() { echo "$1" >>"$ATTRIBUTIONS"; }
cite() { echo "$1" >>"$FOOTER"; }

# Assembles NOTICE and runs the verifier, capturing findings as TSV.
run_verifier() {
    write_lockfiles
    cat "$ATTRIBUTIONS" >>"$FIXTURE/NOTICE"
    {
        echo ""
        echo "********************"
        echo "OPEN SOURCE LICENSES"
        echo "********************"
        echo ""
        cat "$FOOTER"
    } >>"$FIXTURE/NOTICE"

    OUTPUT=$("$VERIFIER" --project-root "$FIXTURE" --tsv 2>&1) && EXIT_CODE=0 || EXIT_CODE=$?
}

# -------------------------------------------------------------------------
# Assertions
# -------------------------------------------------------------------------

# expect_finding <description> <code> <subject>
expect_finding() {
    local description="$1" code="$2" subject="$3"
    if printf '%s\n' "$OUTPUT" | awk -F'\t' -v c="$code" -v s="$subject" \
        '$2 == c && $4 == s { found = 1 } END { exit !found }'; then
        echo "  PASS  $description"
        passed=$((passed + 1))
    else
        echo "  FAIL  $description (expected $code for $subject)"
        printf '%s\n' "$OUTPUT" | sed 's/^/          /'
        failed=$((failed + 1))
    fi
}

# expect_no_finding <description> <code> [subject]
expect_no_finding() {
    local description="$1" code="$2" subject="${3:-}"
    if printf '%s\n' "$OUTPUT" | awk -F'\t' -v c="$code" -v s="$subject" \
        '$2 == c && (s == "" || $4 == s) { found = 1 } END { exit !found }'; then
        echo "  FAIL  $description (unexpected $code${subject:+ for $subject})"
        printf '%s\n' "$OUTPUT" | sed 's/^/          /'
        failed=$((failed + 1))
    else
        echo "  PASS  $description"
        passed=$((passed + 1))
    fi
}

# expect_detail <description> <code> <subject> <substring>
# The findings carry the versions a reader needs in order to act, so a few
# cases assert on the detail column and not just on the code.
expect_detail() {
    local description="$1" code="$2" subject="$3" substring="$4"
    if printf '%s\n' "$OUTPUT" | awk -F'\t' -v c="$code" -v s="$subject" -v d="$substring" \
        '$2 == c && $4 == s && index($5, d) { found = 1 } END { exit !found }'; then
        echo "  PASS  $description"
        passed=$((passed + 1))
    else
        echo "  FAIL  $description (expected $code for $subject to mention '$substring')"
        printf '%s\n' "$OUTPUT" | sed 's/^/          /'
        failed=$((failed + 1))
    fi
}

expect_exit_code() {
    local description="$1" expected="$2"
    if [ "$EXIT_CODE" = "$expected" ]; then
        echo "  PASS  $description"
        passed=$((passed + 1))
    else
        echo "  FAIL  $description (exit $EXIT_CODE, expected $expected)"
        failed=$((failed + 1))
    fi
}

# -------------------------------------------------------------------------
# Cases
# -------------------------------------------------------------------------

test_wrong_license() {
    echo "A wrong license is caught -- the gap RedPencil leaves"
    new_project
    add_package good 1.0.0 MIT
    add_package bad 2.0.0 ISC
    attribute "good under the MIT license"
    attribute "bad under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "ISC - https://opensource.org/licenses/ISC"
    run_verifier

    expect_finding "a mismatched license is reported" WRONG_LICENSE bad
    expect_no_finding "a matching license is not reported" WRONG_LICENSE good
    expect_exit_code "a wrong license fails the run" 1
}

test_clean_notice_passes() {
    echo "An accurate NOTICE produces no errors"
    new_project
    add_package alpha 1.0.0 MIT
    add_package beta 2.0.0 Apache-2.0
    attribute "alpha under the MIT license"
    attribute "beta under the Apache-2.0 license"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "Apache-2.0 - https://opensource.org/licenses/Apache-2.0"
    run_verifier

    expect_exit_code "an accurate NOTICE exits 0" 0
}

test_or_election() {
    echo "Dual licensing: OR elects, AND accumulates"
    new_project
    # The Jetty case: "EPL-1.0 OR Apache-2.0" lets the licensee elect one, so
    # naming either operand alone is accurate.
    add_package elected 1.0.0 "(EPL-1.0 OR Apache-2.0)"
    add_package both 1.0.0 "(MIT AND Zlib)"
    add_package reordered 1.0.0 "MIT AND Zlib"
    add_package swapped 1.0.0 "MIT AND Zlib"
    attribute "elected under the Apache-2.0 license"
    attribute "both under the MIT license"
    attribute "reordered under the Zlib AND MIT licenses"
    attribute "swapped under the MIT OR Zlib licenses"
    cite "Apache-2.0 - https://opensource.org/licenses/Apache-2.0"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "Zlib - https://opensource.org/licenses/Zlib"
    run_verifier

    expect_no_finding "electing one side of an OR is accurate" WRONG_LICENSE elected
    expect_finding "naming one side of an AND is not accurate" WRONG_LICENSE both
    expect_no_finding "an AND is order-independent" WRONG_LICENSE reordered
    # The operator is the obligation: an AND published as an OR tells the reader
    # to elect one license where both in fact apply. The operand sets match, so
    # any comparison that keys off the operands alone accepts this.
    expect_finding "an AND published as an OR is not accurate" WRONG_LICENSE swapped
}

test_version_disagreement() {
    echo "Two installed versions under different licenses"
    new_project
    add_package minimatch 3.1.5 ISC
    add_nested_package host minimatch 10.2.6 BlueOak-1.0.0
    add_package host 1.0.0 MIT
    attribute "minimatch under the ISC license"
    attribute "host under the MIT license"
    cite "ISC - https://opensource.org/licenses/ISC"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "BlueOak-1.0.0 - https://blueoakcouncil.org/license/1.0.0"
    run_verifier

    # RedPencil cannot see this at all: its component map holds one version
    # per name, so the relicensed copy is invisible.
    expect_finding "a relicensed second version is reported" AMBIGUOUS_LICENSE minimatch
    expect_exit_code "version disagreement warns but does not fail" 0
}

test_version_pinned_lines() {
    echo "Splitting on version is what resolves a disagreement"
    new_project
    # The fix HELP_AMBIGUOUS_LICENSE prescribes: one line per version, so each
    # line is judged against its own copy and not against every copy.
    add_package minimatch 3.1.5 ISC
    add_nested_package host minimatch 10.2.6 BlueOak-1.0.0
    add_package host 1.0.0 MIT
    attribute "minimatch@3.1.5 under the ISC license"
    attribute "minimatch@10.2.6 under the BlueOak-1.0.0 license"
    attribute "host under the MIT license"
    cite "ISC - https://opensource.org/licenses/ISC"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "BlueOak-1.0.0 - https://blueoakcouncil.org/license/1.0.0"
    run_verifier

    expect_no_finding "a pinned line is judged against its own version" AMBIGUOUS_LICENSE minimatch
    expect_no_finding "a pinned line is not called wrong" WRONG_LICENSE minimatch
    expect_exit_code "splitting by version clears the finding" 0
}

test_version_pinned_wrong_and_stale() {
    echo "Pinning a version does not suppress the license check"
    new_project
    add_package alpha 1.0.0 ISC
    add_package beta 2.0.0 MIT
    attribute "alpha@1.0.0 under the MIT license"
    attribute "beta@9.9.9 under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "ISC - https://opensource.org/licenses/ISC"
    run_verifier

    # Restricting to one version must narrow what is compared, not skip it.
    expect_finding "a pinned line with the wrong license is still caught" \
        WRONG_LICENSE alpha
    expect_finding "a pinned version nothing installs is reported" STALE beta@9.9.9
}

test_aliases_and_case() {
    echo "Known license spellings are resolved, unknown ones are not"
    new_project
    add_package spelled 1.0.0 "Apache License 2.0"
    add_package invented 1.0.0 "MIT"
    attribute "spelled under the Apache-2.0 license"
    attribute "invented under the MIT-ish license"
    cite "Apache-2.0 - https://opensource.org/licenses/Apache-2.0"
    cite "MIT-ish - https://example.invalid/mit-ish"
    run_verifier

    expect_no_finding "a known alias resolves to its SPDX ID" WRONG_LICENSE spelled
    expect_finding "an unrecognized spelling is not assumed correct" WRONG_LICENSE invented
}

test_undeclared_license() {
    echo "A package with no license field cannot be confirmed"
    new_project
    add_package silent 1.0.0 -
    attribute "silent under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_finding "a missing license field is flagged for manual review" UNDECLARED silent
    expect_no_finding "an unreadable declaration is not called wrong" WRONG_LICENSE silent
}

test_license_sentinels() {
    echo "npm's non-SPDX license sentinels"
    new_project
    # Neither sentinel is a license ID: "UNLICENSED" says the package is not
    # licensed for use, and "SEE LICENSE IN <file>" points at prose. Comparing
    # either to an SPDX ID would fail the run over a line that may be right.
    add_package proprietary 1.0.0 "UNLICENSED"
    add_package see-file 1.0.0 "SEE LICENSE IN LICENSE"
    add_package lowercase 1.0.0 "see license in COPYING"
    attribute "proprietary under the MIT license"
    attribute "see-file under the MIT license"
    attribute "lowercase under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_no_finding "UNLICENSED is not compared as a license ID" WRONG_LICENSE proprietary
    expect_no_finding "SEE LICENSE IN is not compared as a license ID" WRONG_LICENSE see-file
    expect_no_finding "the sentinels are matched case-insensitively" WRONG_LICENSE lowercase
    expect_finding "a sentinel is sent to manual review" UNDECLARED see-file
    expect_exit_code "a sentinel does not fail the run" 0
}

test_version_prefix_detail() {
    echo "A version that is a prefix of another installed version"
    new_project
    # " 1.2.3" is a substring of " 1.2.30", so a membership test that is not
    # anchored on both ends drops one of these from the finding detail -- and
    # the detail is what tells the reader which copy to go and look at.
    add_package prefixed 1.2.3 MIT
    add_nested_package host prefixed 1.2.30 MIT
    add_package host 1.0.0 MIT
    attribute "prefixed under the ISC license"
    attribute "host under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "ISC - https://opensource.org/licenses/ISC"
    run_verifier

    expect_detail "the shorter version is kept" WRONG_LICENSE prefixed "1.2.3,"
    expect_detail "the longer version is kept" WRONG_LICENSE prefixed "1.2.30"
}

test_duplicates() {
    echo "Duplicate attribution lines"
    new_project
    add_package repeated 1.0.0 MIT
    # Nested, because two calls to add_package write the same path: the second
    # version has to actually be installed for the assertion below to mean
    # anything.
    add_package versioned 1.0.0 MIT
    add_nested_package repeated versioned 2.0.0 MIT
    attribute "repeated under the MIT license"
    attribute "repeated under the MIT license"
    attribute "versioned@1.0.0 under the MIT license"
    attribute "versioned@2.0.0 under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_finding "a repeated name is reported" DUPLICATE repeated
    expect_no_finding "distinct pinned versions are not duplicates" DUPLICATE versioned
}

test_footer() {
    echo "Footer citations"
    new_project
    add_package alpha 1.0.0 MIT
    add_package beta 1.0.0 ISC
    attribute "alpha under the MIT license"
    attribute "beta under the ISC license"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "OFL-1.1 - https://spdx.org/licenses/OFL-1.1.html"
    run_verifier

    expect_finding "a license used but not cited is reported" UNCITED_LICENSE ISC
    expect_finding "a citation nothing uses is reported" ORPHAN_FOOTER OFL-1.1
}

test_footer_keeps_sbom_licenses() {
    echo "A footer entry an installed package needs is not called orphaned"
    new_project
    # MIT-0 is the case that caused a bad prune: no attribution line uses it,
    # but a package declares it, so RedPencil's ATTR-004 -- which keys off the
    # SBOM, not off the attribution lines -- demands the citation stay.
    add_package alpha 1.0.0 MIT
    add_package uncited 1.0.0 MIT-0
    attribute "alpha under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "MIT-0 - https://opensource.org/licenses/MIT-0"
    run_verifier

    expect_no_finding "a citation an installed package needs is kept" ORPHAN_FOOTER MIT-0
}

test_malformed() {
    echo "Malformed attribution lines"
    new_project
    add_package doubled 1.0.0 Apache-2.0
    add_package fine 1.0.0 MIT
    attribute "doubled under the the Apache-2.0 license"
    attribute "this line says nothing about a license"
    attribute "fine under the MIT license"
    cite "Apache-2.0 - https://opensource.org/licenses/Apache-2.0"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_finding "a duplicated article is reported" MALFORMED doubled
    expect_finding "a line that is not an attribution is reported" MALFORMED \
        "this line says nothing about a license"
    # The duplicated article must not also be misread as an unknown license.
    expect_no_finding "recovering from the typo still checks the license" WRONG_LICENSE doubled
}

test_names_with_spaces() {
    echo "Component names that are not npm package names"
    new_project
    add_package alpha 1.0.0 MIT
    attribute "alpha under the MIT license"
    attribute "Apache JMeter under the Apache-2.0 license"
    attribute "jpgc-json (JMeter Plugins) under the Apache-2.0 license"
    attribute "org.eclipse.jetty/jetty-client under the Apache-2.0 license"
    attribute "some-deleted-package under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "Apache-2.0 - https://opensource.org/licenses/Apache-2.0"
    run_verifier

    expect_no_finding "a bundled non-npm component is not called stale" STALE "Apache JMeter"
    expect_no_finding "a JMeter plugin is not called stale" STALE "jpgc-json (JMeter Plugins)"
    expect_no_finding "a Jetty jar is not called stale" STALE org.eclipse.jetty/jetty-client
    expect_finding "an uninstalled npm package is called stale" STALE some-deleted-package
    expect_exit_code "stale entries alone do not fail the run" 0
}

test_scoped_names() {
    echo "Scoped package names and version suffixes"
    new_project
    add_package scoped 1.0.0 MIT
    mkdir -p "$FIXTURE/node_modules/@scope/pkg"
    printf '{"name":"@scope/pkg","version":"1.2.3","license":"Apache-2.0"}' \
        >"$FIXTURE/node_modules/@scope/pkg/package.json"
    attribute "@scope/pkg under the Apache-2.0 license"
    attribute "scoped@1.0.0 under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "Apache-2.0 - https://opensource.org/licenses/Apache-2.0"
    run_verifier

    # A leading "@" is a scope, not a version separator.
    expect_no_finding "a scoped name is not mistaken for a version" STALE @scope/pkg
    expect_no_finding "a scoped name checks its license" WRONG_LICENSE @scope/pkg
    expect_no_finding "an @version suffix is stripped from the name" STALE scoped
}

test_missing_attribution() {
    echo "An installed package with no attribution line"
    new_project
    add_package attributed 1.0.0 MIT
    add_package forgotten 1.0.0 MIT
    attribute "attributed under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_finding "an unattributed package is reported" MISSING forgotten
    expect_no_finding "an attributed package is not reported" MISSING attributed
}

test_unparseable_notice() {
    echo "A NOTICE without the section markers"
    new_project
    add_package alpha 1.0.0 MIT
    echo "no markers here" >"$FIXTURE/NOTICE"
    OUTPUT=$("$VERIFIER" --project-root "$FIXTURE" --tsv 2>&1) && EXIT_CODE=0 || EXIT_CODE=$?

    # Silently checking zero lines would be the worst possible failure mode.
    expect_exit_code "an unparseable NOTICE is an error, not a pass" 2
}

test_unreadable_tree() {
    echo "An unreadable node_modules subtree"
    if [ "$(id -u)" -eq 0 ]; then
        echo "  SKIP  root can read a 000 directory"
        return
    fi
    new_project
    add_package visible 1.0.0 MIT
    add_package buried 1.0.0 MIT
    attribute "visible under the MIT license"
    attribute "buried under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    chmod 000 "$FIXTURE/node_modules/buried"
    run_verifier
    chmod 755 "$FIXTURE/node_modules/buried"

    # A scan that could not read the whole tree must not be reported as a clean
    # one: its STALE findings are the argument for deleting attributions, and
    # here they would name software that is installed.
    expect_no_finding "a half-read tree does not call a package stale" STALE buried
    expect_exit_code "a failed scan is an error, not a pass" 2
}

# expect_output <description> <substring>
expect_output() {
    local description="$1" substring="$2"
    case "$OUTPUT" in
        *"$substring"*)
            echo "  PASS  $description"
            passed=$((passed + 1)) ;;
        *)
            echo "  FAIL  $description (output does not mention '$substring')"
            failed=$((failed + 1)) ;;
    esac
}

# expect_no_output <description> <substring>
expect_no_output() {
    local description="$1" substring="$2"
    case "$OUTPUT" in
        *"$substring"*)
            echo "  FAIL  $description (output mentions '$substring')"
            failed=$((failed + 1)) ;;
        *)
            echo "  PASS  $description"
            passed=$((passed + 1)) ;;
    esac
}

test_help() {
    echo "Asking for help"
    OUTPUT=$("$VERIFIER" --help 2>&1) && EXIT_CODE=0 || EXIT_CODE=$?

    expect_exit_code "--help is not a usage error" 0
    expect_output "the options are listed" "--project-root <path>"
    # The help text is sliced out of the script header, so the slice can end in
    # the wrong place and silently drop a whole section -- which is how --help
    # came to advertise exit codes without listing any.
    expect_output "the exit codes are listed, not just their heading" \
        "1  at least one error-severity finding"
    # And the other way: a slice that overruns dumps the script itself.
    expect_no_output "nothing past the header leaks in" "Related Files"
    expect_no_output "no code leaks in" "set -eo pipefail"
}

test_empty_attribution_body() {
    echo "A NOTICE with the markers but no attribution lines"
    new_project
    add_package alpha 1.0.0 MIT
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    # An empty body is a real state -- someone mid-edit, or a bad prune. The
    # footer must still be read as the footer, not shifted into the slot the
    # attribution lines left empty, which would report every citation uncited.
    expect_no_finding "an empty body does not fabricate uncited licenses" UNCITED_LICENSE
    expect_finding "an unattributed package is still reported" MISSING alpha
    expect_exit_code "an empty body alone does not fail the run" 0
}

test_empty_tree() {
    echo "An empty node_modules"
    new_project
    # A first-party manifest at the root, because that is the production case:
    # the repo's own package.json is always there, so a guard that only asks
    # whether any manifest was found never fires on a missing install.
    printf '{"name":"solution","version":"1.0.0","license":"Apache-2.0"}' \
        >"$FIXTURE/package.json"
    attribute "alpha under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_exit_code "no installed packages is an error, not a pass" 2
}

test_lockfile_is_shipped() {
    echo "A lockfile entry is shipped even with nothing installed"
    new_project
    add_package installed 1.0.0 MIT
    # The production case this exists for: npm skips an optional dependency whose
    # os/cpu exclude the host, so the package is shipped but absent from
    # node_modules. Keying "shipped" off the installed tree reported the
    # attribution stale on the one platform that skips it, and the help text then
    # told the reader to delete a line the solution requires.
    add_lockfile_entry platform-binary 1.0.0 MIT "" \
        '"optional":true,"os":["linux"],"cpu":["x64"]'
    attribute "installed under the MIT license"
    attribute "platform-binary under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_no_finding "a lockfile-only package is not stale" STALE platform-binary
    # And it is not reported as an attribution gap either: MISSING is a statement
    # about this machine, so extending it to lockfile rows would report every
    # other platform's sibling binary as unattributed.
    expect_no_finding "a lockfile-only package is not reported missing" MISSING platform-binary
    expect_exit_code "a lockfile-only attribution passes" 0
}

test_lockfile_license_is_checked() {
    echo "A lockfile-only package still has its license checked"
    new_project
    add_package anchor 1.0.0 MIT
    add_lockfile_entry honest 1.0.0 MIT
    add_lockfile_entry lying 1.0.0 "Apache-2.0 AND MIT"
    attribute "anchor under the MIT license"
    attribute "honest under the MIT license"
    attribute "lying under the Apache-2.0 license"
    cite "MIT - https://opensource.org/licenses/MIT"
    cite "Apache-2.0 - https://opensource.org/licenses/Apache-2.0"
    run_verifier

    # The point of reading licenses from the lockfile: these lines were asserted
    # and nothing checked them before, because the package is never installed
    # here. Ten real @swc/core-* errors were hiding behind exactly this.
    expect_finding "a lockfile-only wrong license is caught" WRONG_LICENSE lying
    expect_no_finding "a lockfile-only right license is not reported" WRONG_LICENSE honest
}

test_lockfile_and_installed_agree() {
    echo "A package in both sources is not double-counted"
    new_project
    add_package both 1.0.0 MIT
    add_lockfile_entry both 1.0.0 MIT
    attribute "both under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    # The same version now arrives twice, once per scope. Anything that compared
    # or listed versions without deduplicating would report the package as
    # ambiguous, or name "1.0.0, 1.0.0" in a finding detail.
    expect_no_finding "two scopes for one version is not a disagreement" AMBIGUOUS_LICENSE both
    expect_no_finding "two scopes for one version is not stale" STALE both
    expect_exit_code "a package in both sources passes" 0
}

test_lockfile_missing_license() {
    echo "A lockfile entry with no license falls back to the manifest"
    new_project
    # npm omits the license on alias entries, so the lockfile can know a package
    # is shipped while only the installed manifest knows what it is licensed
    # under. The empty declaration must not override the real one.
    add_package aliased 1.0.0 MIT
    add_lockfile_entry aliased 1.0.0 -
    attribute "aliased under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_no_finding "an empty lockfile license does not mask the manifest" UNDECLARED aliased
    expect_no_finding "an empty lockfile license is not a mismatch" WRONG_LICENSE aliased
    expect_exit_code "the manifest license wins" 0
}

test_lockfile_link_entries_ignored() {
    echo "Workspace link entries are not attributable packages"
    new_project
    printf '{"name":"solution","version":"1.0.0","license":"Apache-2.0"}' \
        >"$FIXTURE/package.json"
    add_package real 1.0.0 MIT
    # A link entry points at a workspace in this repo and carries no license.
    # Treating it as a dependency would add a first-party name to the third-party
    # NOTICE, as an UNDECLARED finding nobody can act on.
    add_lockfile_entry own-workspace 1.0.0 - "" '"link":true,"resolved":"source/thing"'
    attribute "real under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_no_finding "a link entry is not reported undeclared" UNDECLARED own-workspace
    expect_no_finding "a link entry is not reported missing" MISSING own-workspace
    expect_exit_code "link entries do not affect the run" 0
}

test_nested_lockfiles() {
    echo "Lockfiles are found below the root, not just at it"
    new_project
    add_package anchor 1.0.0 MIT
    # source/ and the five non-workspace packages under it each carry their own
    # lockfile. A hand-written glob missed source/package-lock.json entirely, so
    # the set is found rather than listed.
    add_lockfile_entry deep-one 1.0.0 MIT "source"
    add_lockfile_entry deep-two 1.0.0 MIT "source/results-parser"
    attribute "anchor under the MIT license"
    attribute "deep-one under the MIT license"
    attribute "deep-two under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    expect_no_finding "a lockfile one level down is read" STALE deep-one
    expect_no_finding "a lockfile two levels down is read" STALE deep-two
}

test_stale_survives() {
    echo "A genuinely unshipped component is still reported"
    new_project
    add_package present 1.0.0 MIT
    add_lockfile_entry shipped-elsewhere 1.0.0 MIT
    attribute "present under the MIT license"
    attribute "shipped-elsewhere under the MIT license"
    attribute "long-gone under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    # The rule still has teeth: absent from every lockfile and from the installed
    # tree is the one case that means "not shipped". If widening the definition of
    # shipped had swallowed this, the check would pass everything.
    expect_finding "a component in neither source is stale" STALE long-gone
    expect_no_finding "a lockfile component is not stale" STALE shipped-elsewhere
}

test_lockfile_alone_is_enough() {
    echo "A lockfile with no node_modules at all can still be checked"
    new_project
    rmdir "$FIXTURE/node_modules"
    printf '{"name":"solution","version":"1.0.0","license":"Apache-2.0"}' \
        >"$FIXTURE/package.json"
    add_lockfile_entry only-in-lock 1.0.0 MIT
    add_lockfile_entry also-wrong 1.0.0 ISC
    attribute "only-in-lock under the MIT license"
    attribute "also-wrong under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    # This is what makes the script runnable on a fresh checkout, and so wireable
    # into CI: before, no node_modules was a hard exit 2.
    expect_no_finding "a lockfile alone is not an empty scan" STALE only-in-lock
    expect_finding "a lockfile alone still catches a wrong license" WRONG_LICENSE also-wrong
    expect_exit_code "a wrong license fails without any install" 1
}

test_lockfile_alias_resolves_to_the_real_package() {
    echo "An npm alias is recorded under the real package name, not the local one"
    new_project
    # "string-width-cjs": "npm:string-width@^4.2.0" installs the string-width
    # tarball at node_modules/string-width-cjs, and the lockfile entry keeps both
    # identities. The distributed component -- the one NOTICE and the SBOM name --
    # is string-width.
    add_alias_package string-width-cjs string-width 4.2.3 MIT
    add_lockfile_entry string-width-cjs 4.2.3 MIT "." '"name":"string-width"'
    attribute "string-width under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    # Keying the name off the install path reported the real package stale while
    # recording a nickname nothing attributes as shipped. Only the lockfile can
    # resolve this: the manifest reader drops the aliased directory, since on disk
    # it is indistinguishable from a deep-import stub.
    expect_no_finding "the real package is not called stale" STALE string-width
    expect_no_finding "the aliased directory is not an attribution gap" MISSING
    expect_exit_code "an aliased package passes" 0
}

test_lockfile_alias_license_is_checked() {
    echo "An alias-only package still has its license checked"
    new_project
    rmdir "$FIXTURE/node_modules"
    add_lockfile_entry string-width-cjs 4.2.3 MIT "." '"name":"string-width"'
    attribute "string-width under the Apache-2.0 license"
    cite "Apache-2.0 - https://www.apache.org/licenses/LICENSE-2.0"
    run_verifier

    # The declaration used to land on the nickname, which nothing attributes, so
    # a wrong claim about the real package went unchecked -- and would stay
    # unchecked if dependency cleanup removed the ordinary copies that mask it.
    expect_finding "the alias declaration reaches the real name" WRONG_LICENSE string-width
    expect_detail "the finding names the version" WRONG_LICENSE string-width "4.2.3"
    expect_exit_code "a wrong license on an alias fails the run" 1
}

test_lockfile_alias_nickname_is_not_a_component() {
    echo "The local alias name is not a component to attribute"
    new_project
    rmdir "$FIXTURE/node_modules"
    add_lockfile_entry string-width-cjs 4.2.3 MIT "." '"name":"string-width"'
    attribute "string-width under the MIT license"
    attribute "string-width-cjs under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    run_verifier

    # Nothing by that name is distributed, so the line should go -- the reverse of
    # the old behavior, which covered the nickname and reported the real package.
    expect_finding "attributing the nickname is stale" STALE string-width-cjs
    expect_no_finding "the real package is covered" STALE string-width
}

test_lockfile_version_1() {
    echo "A lockfileVersion 1 lockfile fails the run instead of reading as empty"
    new_project
    add_package anchor 1.0.0 MIT
    attribute "anchor under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    # v1 keeps its tree under "dependencies", so a reader looking at "packages"
    # sees a lockfile with nothing in it -- identical to a project with no
    # dependencies, and the symptom is live attributions reported stale.
    printf '{"lockfileVersion":1,"dependencies":{"ghost":{"version":"1.0.0"}}}' \
        >"$FIXTURE/package-lock.json"
    run_verifier

    expect_output "the unreadable lockfile format is named" "lockfileVersion 1"
    expect_output "the way out is spelled out" "npm 7 or later"
    expect_exit_code "a lockfile that cannot be read fails the run" 2
}

test_unparseable_lockfile() {
    echo "An unparseable lockfile fails the run, and every bad file is named"
    new_project
    add_package anchor 1.0.0 MIT
    add_lockfile_entry good-lock 1.0.0 MIT "source"
    attribute "anchor under the MIT license"
    attribute "good-lock under the MIT license"
    cite "MIT - https://opensource.org/licenses/MIT"
    # Truncated mid-write, or a merge conflict left in place. Two of them,
    # because reading one file at a time is what lets a run name them both
    # instead of stopping at the first.
    mkdir -p "$FIXTURE/nested"
    printf '{"packages":{"":{' >"$FIXTURE/package-lock.json"
    printf 'not json at all' >"$FIXTURE/nested/package-lock.json"
    run_verifier

    expect_output "an unparseable lockfile is named" \
        "Error: could not parse $FIXTURE/package-lock.json"
    expect_output "so is the second, not just the first" \
        "Error: could not parse $FIXTURE/nested/package-lock.json"
    # Losing a lockfile loses the record of everything it resolves, and the
    # symptom is STALE findings whose help text says to delete the line. Exiting
    # 0 on a scan that could not be completed is the failure to avoid.
    expect_output "the consequence is explained" \
        "a partial scan reports attribution lines stale"
    expect_exit_code "a lockfile that cannot be read fails the run" 2
}

# -------------------------------------------------------------------------

main() {
    echo "Running deployment/verify-notice.sh tests"
    echo ""

    test_wrong_license; echo ""
    test_clean_notice_passes; echo ""
    test_or_election; echo ""
    test_version_disagreement; echo ""
    test_version_pinned_lines; echo ""
    test_version_pinned_wrong_and_stale; echo ""
    test_aliases_and_case; echo ""
    test_undeclared_license; echo ""
    test_license_sentinels; echo ""
    test_version_prefix_detail; echo ""
    test_duplicates; echo ""
    test_footer; echo ""
    test_footer_keeps_sbom_licenses; echo ""
    test_malformed; echo ""
    test_names_with_spaces; echo ""
    test_scoped_names; echo ""
    test_missing_attribution; echo ""
    test_unparseable_notice; echo ""
    test_empty_attribution_body; echo ""
    test_empty_tree; echo ""
    test_unreadable_tree; echo ""
    test_lockfile_is_shipped; echo ""
    test_lockfile_license_is_checked; echo ""
    test_lockfile_and_installed_agree; echo ""
    test_lockfile_missing_license; echo ""
    test_lockfile_link_entries_ignored; echo ""
    test_nested_lockfiles; echo ""
    test_stale_survives; echo ""
    test_lockfile_alone_is_enough; echo ""
    test_lockfile_alias_resolves_to_the_real_package; echo ""
    test_lockfile_alias_license_is_checked; echo ""
    test_lockfile_alias_nickname_is_not_a_component; echo ""
    test_lockfile_version_1; echo ""
    test_unparseable_lockfile; echo ""
    test_help; echo ""

    echo "$passed passed, $failed failed"
    [ "$failed" -eq 0 ]
}

main "$@"
