#!/bin/bash
# Simulator wrapper for the Smelter (Babytuna) iOS app.
# This Mac also runs Project Nellit with its own booted simulator.
# Always target by UDID. Never pass "booted": with two devices booted,
# simctl silently picks one at random and exits 0.
set -euo pipefail

# The historical QA UDID FCADAB49-3A22-4167-B3EB-F794BEB32D9E is not present
# in this simulator set. This isolated replacement was created for this pass.
BABYTUNA_SIM_UDID="EF05F833-2AC4-4383-8688-36C51B956BCF"  # Smelter Release QA iPhone 17 Pro Max, iOS 26.2
NELLIT_UDID="7C0CA22A-4895-44BA-BF7E-F53BB5CAF7F8"        # Nellit's device: never target
NELLIT_APP_ID="com.worthunion.nailit"

for arg in "$@"; do
  if [ "$arg" = "booted" ] || [ "$arg" = "$NELLIT_UDID" ]; then
    echo "sim.sh: refusing '$arg'. Target the Babytuna sim by UDID only: $BABYTUNA_SIM_UDID" >&2
    exit 1
  fi
done

case "${1:-}" in
  input)
    shift
    case "${1:-}" in
      tap|type|describe-ui|swipe|drag|button|key|key-sequence|key-combo|touch|gesture|slider|batch) ;;
      *) echo "sim.sh: unsupported headless UI command" >&2; exit 1 ;;
    esac
    for arg in "$@"; do
      if [[ "$arg" == --udid* ]]; then
        echo "sim.sh: UI target is pinned; do not supply --udid" >&2
        exit 1
      fi
    done
    if [[ -z "${SMELTER_AXE_PATH:-}" || ! -x "$SMELTER_AXE_PATH" ]]; then
      echo "sim.sh: set SMELTER_AXE_PATH to the installed XcodeBuildMCP AXe binary" >&2
      exit 1
    fi
    "$SMELTER_AXE_PATH" "$@" --udid "$BABYTUNA_SIM_UDID"
    ;;
  udid)
    echo "$BABYTUNA_SIM_UDID"
    ;;
  assert)
    state=$(xcrun simctl list devices | grep "$BABYTUNA_SIM_UDID" | grep -o "(Booted)\|(Shutdown)" || true)
    if [ -z "$state" ]; then
      echo "sim.sh: FAIL: target sim $BABYTUNA_SIM_UDID not found on this machine" >&2
      exit 1
    fi
    if [ "$state" = "(Shutdown)" ]; then
      echo "sim.sh: target sim is shutdown; run 'scripts/sim.sh boot' first" >&2
      exit 1
    fi
    if xcrun simctl listapps "$BABYTUNA_SIM_UDID" 2>/dev/null | grep -q "$NELLIT_APP_ID"; then
      echo "sim.sh: FAIL: $NELLIT_APP_ID present on target. This is Nellit's device. Stop." >&2
      exit 1
    fi
    echo "sim.sh: target OK: iPhone 17 Pro Max $BABYTUNA_SIM_UDID (booted, Nellit app absent)"
    ;;
  boot)
    xcrun simctl boot "$BABYTUNA_SIM_UDID" 2>/dev/null || true
    xcrun simctl bootstatus "$BABYTUNA_SIM_UDID"
    ;;
  "")
    echo "usage: scripts/sim.sh udid | assert | boot | <simctl-subcommand> [args...]" >&2
    echo "  e.g. scripts/sim.sh launch com.babytuna.systems" >&2
    exit 1
    ;;
  *)
    # Pass through to simctl with the UDID injected as the device argument.
    xcrun simctl "$1" "$BABYTUNA_SIM_UDID" "${@:2}"
    ;;
esac
