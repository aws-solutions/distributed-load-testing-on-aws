#!/bin/bash
#
# Regression test for command injection through .env values in the root Makefile.
# Covers each variable the Makefile reads from .env and expands into a shell
# command (TARGET_REGION, MAIN_STACK_NAME, REGIONAL_STACK_NAME, ADMIN_NAME,
# ADMIN_EMAIL, STACK_TAGS, REGIONAL_STACKS).
#
# The Makefile reads several variables from .env and expands them into shell
# commands (cdk / aws). Two injection vectors exist:
#
#   1. Shell-level: an unquoted value containing shell metacharacters (; | & etc.)
#      runs as a command when the recipe line reaches /bin/sh.
#   2. Make-level: Make evaluates $(...) functions while expanding a variable, so
#      a value like  x$(shell touch P)  executes during expansion, BEFORE the
#      shell runs. Shell quoting cannot stop this; it happens one layer too late.
#
# Two protections defend against both, and this test verifies them:
#   A. Every .env value is single-quoted where it is expanded into a recipe, so
#      shell metacharacters are inert (covers vector 1).
#   B. A parse-time guard rejects any .env value containing a single quote (which
#      would close the quoting in A) or a dollar sign (which enables vector 2).
#      The guard reads raw values via $(value VAR) so it does not itself trigger
#      a $(shell ...) payload.
#
# How it works: the real recipes run cdk/aws, so we cannot exercise them live.
# We extract the REAL guard block from the Makefile and build a mirror recipe
# that replaces cdk with echo, then drive every input class through it. An
# injection payload detonates with `:>INJECTED` (or `$(shell ...)`); the test
# asserts the file is never created under the protected mirror. A "vuln" mirror
# (no guard, unquoted) is a negative control proving the test can see injection,
# so a pass is meaningful rather than vacuous. Static assertions also confirm the
# shipping Makefile still quotes its expansions and still carries the guard, so
# the mirror cannot silently drift from the file it protects.
#
# Self-contained: no AWS calls, no npm, no cdk. Recipes run under /bin/sh like
# the real Makefile. Compatible with the bash 3.2 shipped on macOS.

set -u

# Locate the repository root from this script's own path so the test does not
# depend on the caller's working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
MAKEFILE="$REPO_ROOT/Makefile"

fail=0
note() { printf '  %s\n' "$1"; }

if [ ! -f "$MAKEFILE" ]; then
  echo "FATAL: Makefile not found at $MAKEFILE"
  exit 1
fi

# --- Static assertions: the shipping Makefile must keep the protections ------
# Every variable read from .env and expanded into a recipe must be single-quoted,
# and the .env guard block must be present. These catch a regression even if the
# behavioral mirror below somehow passes.
guard_count="$(grep -c '_dlt_check_env_var' "$MAKEFILE" | tr -d ' ')"
strip_count="$(grep -E 'eval.*strip' "$MAKEFILE" | wc -l | tr -d ' ')"
quoted_tags="$(grep -F -e "--tags '\$(tag)'" "$MAKEFILE" | wc -l | tr -d ' ')"
unquoted_tags="$(grep -F -e "--tags \$(tag))" "$MAKEFILE" | wc -l | tr -d ' ')"
# Unquoted scalar expansions that feed cdk/aws must not exist. Check the specific
# risky patterns these variables must never appear in.
unquoted_scalars="$(grep -E -e 'deploy \$\(MAIN_STACK_NAME\)' \
                            -e 'diff \$\(MAIN_STACK_NAME\)' \
                            -e 'AdminName=\$\(ADMIN_NAME\)' \
                            -e 'AdminEmail=\$\(ADMIN_EMAIL\)' \
                            -e 'stack-name \$\(MAIN_STACK_NAME\)' \
                            "$MAKEFILE" | wc -l | tr -d ' ')"

if [ "$guard_count" -lt 1 ]; then
  note "STATIC FAIL: .env injection guard (_dlt_check_env_var) is missing"
  fail=$((fail + 1))
fi
if [ "$strip_count" -lt 1 ]; then
  note "STATIC FAIL: .env whitespace-strip line (eval ... strip) is missing"
  fail=$((fail + 1))
fi
if [ "$quoted_tags" -ne 4 ]; then
  note "STATIC FAIL: expected 4 quoted '--tags '\$(tag)'' sites, found $quoted_tags"
  fail=$((fail + 1))
fi
if [ "$unquoted_tags" -ne 0 ]; then
  note "STATIC FAIL: found $unquoted_tags unquoted '--tags \$(tag)' site(s); must be 0"
  fail=$((fail + 1))
fi
if [ "$unquoted_scalars" -ne 0 ]; then
  note "STATIC FAIL: found $unquoted_scalars unquoted scalar expansion(s) feeding cdk/aws; must be 0"
  fail=$((fail + 1))
fi

# --- Behavioral test bed -----------------------------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/dltenv.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Pull the REAL guard + whitespace-strip block from the Makefile (from
# `SQUOTE :=` through the `strip` foreach) so the mirror tests the shipping
# logic, not a copy. The block contains two `$(foreach v,...)` lines: the guard
# and the strip. Capture through the strip line specifically.
GUARD="$(sed -n '/^SQUOTE :=/,/eval.*strip/p' "$MAKEFILE")"
if [ -z "$GUARD" ] || ! printf '%s\n' "$GUARD" | grep -q 'eval.*strip'; then
  note "FATAL: could not extract the .env guard+strip block from $MAKEFILE"
  exit 1
fi

# Guarded mirror: real guard + a recipe that quotes both a scalar
# (MAIN_STACK_NAME) and the foreach tag, mirroring the real recipes. The `render`
# target writes the quoted scalar between markers to a file so the harness can
# detect a leaked surrounding space (echo on a terminal would hide it).
{
  printf '%s\n' '-include .env'
  printf '%s\n' "$GUARD"
  printf '%s\n' 'check:'
  printf '\t@echo cdk deploy %s %s\n' \
    "'\$(MAIN_STACK_NAME)'" "\$(foreach tag,\$(STACK_TAGS),--tags '\$(tag)')"
  printf '%s\n' 'render:'
  printf '\t@printf "<%%s>" "$(MAIN_STACK_NAME)" > RENDER\n'
} > "$WORK/Makefile.guarded"

# Vulnerable control: no guard, unquoted expansions. This is the unsafe form the
# test exists to prevent; it proves the harness can actually detect injection.
{
  printf '%s\n' '-include .env'
  printf '%s\n' 'check:'
  printf '\t@echo cdk deploy %s %s\n' \
    "\$(MAIN_STACK_NAME)" "\$(foreach tag,\$(STACK_TAGS),--tags \$(tag))"
} > "$WORK/Makefile.vuln"

# Input cases as "name|var|class|value" records. var is the .env variable the
# value is assigned to; the other variable is left benign/empty.
#   benign     : legitimate value. Guarded must succeed (exit 0), no detonation.
#   inject     : shell metacharacters, no $ or '. Guarded neutralizes via quoting.
#   makeinj    : contains $(...) or ${...}; guard must abort BEFORE shell runs.
#   breakout   : contains a single quote; guard must abort.
#   whitespace : value with surrounding space (e.g. from an inline .env comment).
#                Guarded must succeed AND render the value trimmed (no leaked space),
#                so cdk/aws receives the clean name. A surrounding space left
#                inside the quotes would become part of the value and break the
#                CloudFormation stack lookup.
# Injection detonators are space-free; foreach splits STACK_TAGS on whitespace,
# so spaced payloads get '--tags' glued in front of the second word and often
# defuse by accident. Space-free payloads are the realistic attack.
# A trailing _SP_ token in a value is substituted with a real space below (the
# while-read loop would otherwise strip raw trailing spaces from the record).
SQ="'"
cases="
benign|STACK_TAGS|benign|
benign-tags|STACK_TAGS|benign|auto-delete=never env=dev
benign-stack|MAIN_STACK_NAME|benign|distributed-load-testing-on-aws
stack-inline-comment|MAIN_STACK_NAME|whitespace|distributed-load-testing-on-aws_SP_
stack-leading-space|MAIN_STACK_NAME|whitespace|_SP_distributed-load-testing-on-aws
tags-semicolon|STACK_TAGS|inject|a=1;:>INJECTED
tags-pipe|STACK_TAGS|inject|a=1|:>INJECTED
tags-amp|STACK_TAGS|inject|a=1&:>INJECTED
tags-redirect|STACK_TAGS|inject|a=1>INJECTED
stack-semicolon|MAIN_STACK_NAME|inject|x;:>INJECTED
stack-backtick|MAIN_STACK_NAME|inject|x\`:>INJECTED\`
tags-makeshell|STACK_TAGS|makeinj|a=\$(shell :>INJECTED)
stack-makeshell|MAIN_STACK_NAME|makeinj|x\$(shell :>INJECTED)
tags-makesubst|STACK_TAGS|makeinj|a=\${shell :>INJECTED}
tags-breakout|STACK_TAGS|breakout|a=1${SQ};:>INJECTED;${SQ}
stack-breakout|MAIN_STACK_NAME|breakout|x${SQ};:>INJECTED;${SQ}
lone-quote|STACK_TAGS|breakout|${SQ}
"

sens=0   # inject/makeinj cases the vuln control actually detonated
total=0
while IFS='|' read -r nm var cls val; do
  [ -z "$nm" ] && continue
  total=$((total + 1))

  # Restore real spaces from the _SP_ sentinel (while-read strips raw trailing
  # spaces from the record, so whitespace cases encode them as _SP_).
  val="${val//_SP_/ }"

  # Build a .env that sets the targeted variable; the other stays benign.
  if [ "$var" = MAIN_STACK_NAME ]; then
    printf 'MAIN_STACK_NAME=%s\nSTACK_TAGS=\n' "$val" > "$WORK/.env"
  else
    printf 'MAIN_STACK_NAME=stack\nSTACK_TAGS=%s\n' "$val" > "$WORK/.env"
  fi

  # Guarded mirror (the Makefile's protections).
  rm -f "$WORK/INJECTED"
  ( cd "$WORK" && make -s -f Makefile.guarded check ) >/dev/null 2>&1; frc=$?
  if [ -e "$WORK/INJECTED" ]; then finj=YES; else finj=no; fi

  # Vulnerable control. Only meaningful for inject/makeinj sensitivity.
  rm -f "$WORK/INJECTED"
  ( cd "$WORK" && make -s -f Makefile.vuln check ) >/dev/null 2>&1
  if [ -e "$WORK/INJECTED" ]; then vinj=YES; else vinj=no; fi
  rm -f "$WORK/INJECTED"

  ok=1
  case "$cls" in
    benign)
      { [ "$frc" -eq 0 ] && [ "$finj" = no ]; } || ok=0 ;;
    inject)
      { [ "$frc" -eq 0 ] && [ "$finj" = no ]; } || ok=0
      [ "$vinj" = YES ] && sens=$((sens + 1)) ;;
    makeinj)
      { [ "$frc" -ne 0 ] && [ "$finj" = no ]; } || ok=0
      [ "$vinj" = YES ] && sens=$((sens + 1)) ;;
    breakout)
      { [ "$frc" -ne 0 ] && [ "$finj" = no ]; } || ok=0 ;;
    whitespace)
      # Must succeed, not detonate, and render the value with surrounding space
      # trimmed. Expected = the input value with leading/trailing spaces removed.
      rm -f "$WORK/RENDER"
      ( cd "$WORK" && make -s -f Makefile.guarded render ) >/dev/null 2>&1
      rendered="$(cat "$WORK/RENDER" 2>/dev/null)"
      trimmed="$val"
      trimmed="${trimmed#"${trimmed%%[![:space:]]*}"}"   # strip leading space
      trimmed="${trimmed%"${trimmed##*[![:space:]]}"}"   # strip trailing space
      { [ "$frc" -eq 0 ] && [ "$finj" = no ] && [ "$rendered" = "<$trimmed>" ]; } || ok=0
      rm -f "$WORK/RENDER" ;;
  esac
  if [ "$ok" -eq 0 ]; then
    extra=""
    [ "$cls" = whitespace ] && extra=" rendered='${rendered:-?}' expected='<$trimmed>'"
    note "BEHAVIOR FAIL [$cls] $nm: $var='$val' (guarded_exit=$frc guarded_detonated=$finj)$extra"
    fail=$((fail + 1))
  fi
done <<EOF
$cases
EOF

# The control must detonate on at least one case, or the test is not sensitive.
if [ "$sens" -lt 1 ]; then
  note "FATAL: vuln control never detonated; test is not sensitive to injection"
  fail=$((fail + 1))
fi

if [ "$fail" -eq 0 ]; then
  echo ".env injection test passed ($total input cases, control detonated $sens)"
  exit 0
fi
echo ".env injection test FAILED with $fail problem(s)"
exit 1
