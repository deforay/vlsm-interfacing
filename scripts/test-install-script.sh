#!/usr/bin/env bash
#
# Drives scripts/install.sh against stand-ins for curl, apt-get and dpkg.
#
# WHY: this script is what every Debian and Ubuntu laboratory runs, on a
# machine that is already working, and its failure modes are the expensive
# kind -- an upgrade that removes the application it was replacing, or one that
# says "Installation completed" while the laboratory carries on running the
# version it had and nobody finds out until a result goes missing.
#
# Neither is visible by reading it. Both are one stubbed command away from
# being demonstrated.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
failures=0

# Builds a PATH of fakes: each records what it was called with, and exits with
# the code the case under test asks for.
setup_fakes() {
  fake_dir="$(mktemp -d)"
  calls="${fake_dir}/calls"
  : > "${calls}"

  cat > "${fake_dir}/sudo" <<'FAKE'
#!/usr/bin/env bash
exec "$@"
FAKE

  cat > "${fake_dir}/curl" <<'FAKE'
#!/usr/bin/env bash
echo "curl $*" >> "$CALLS"
# -o <path> is the last argument pair; write something that looks like a package.
target=""
while [[ $# -gt 0 ]]; do
  [[ "$1" == "-o" ]] && target="$2"
  shift
done
if [[ -n "$target" ]]; then
  printf 'not really a deb' > "$target"
else
  # The release lookup: answer with a release carrying one .deb asset.
  printf '{"browser_download_url": "https://example.test/intelis-interfacing_9.9.9_amd64.deb"}'
fi
FAKE

  cat > "${fake_dir}/apt-get" <<'FAKE'
#!/usr/bin/env bash
echo "apt-get $*" >> "$CALLS"
for argument in "$@"; do
  if [[ "$argument" == *.deb ]]; then
    exit "${APT_INSTALL_EXIT:-0}"
  fi
done
exit "${APT_FIX_EXIT:-0}"
FAKE

  cat > "${fake_dir}/dpkg" <<'FAKE'
#!/usr/bin/env bash
echo "dpkg $*" >> "$CALLS"
[[ "${1:-}" == "--remove" ]] && exit "${DPKG_REMOVE_EXIT:-0}"
exit "${DPKG_INSTALL_EXIT:-0}"
FAKE

  cat > "${fake_dir}/dpkg-query" <<'FAKE'
#!/usr/bin/env bash
echo "dpkg-query $*" >> "$CALLS"
requested="${!#}"
for name in ${INSTALLED_PACKAGES:-}; do
  if [[ "$name" == "$requested" ]]; then
    echo "install ok installed"
    exit 0
  fi
done
exit 1
FAKE

  cat > "${fake_dir}/dpkg-deb" <<'FAKE'
#!/usr/bin/env bash
echo "intelis-interfacing"
FAKE

  chmod +x "${fake_dir}"/*
}

# Runs install.sh with the fakes in front of the real tools.
# Usage: run_install <description>; environment variables set by the caller
# decide how each fake behaves.
run_install() {
  setup_fakes
  output="$(CALLS="${calls}" PATH="${fake_dir}:${PATH}" bash "${root}/scripts/install.sh" 2>&1)"
  status=$?
  calls_made="$(cat "${calls}")"
}

expect() {
  local description="$1" condition="$2"
  if eval "${condition}"; then
    echo "  ok  ${description}"
  else
    echo "  FAILED  ${description}"
    echo "----- exit ${status}; output -----"
    echo "${output}"
    echo "----- calls -----"
    echo "${calls_made}"
    echo "---------------------------------"
    failures=$((failures + 1))
  fi
}

echo "a machine with nothing installed yet"
(
  export INSTALLED_PACKAGES="" APT_INSTALL_EXIT=0
  run_install
  expect "installs and reports success" '[[ ${status} -eq 0 ]]'
  expect "goes through apt in one transaction" 'grep -q "apt-get install -y" <<< "${calls_made}"'
  expect "removes nothing" '! grep -q "dpkg --remove" <<< "${calls_made}"'
) || failures=$((failures + 1))

echo "a machine still carrying the package the tool shipped under before"
(
  export INSTALLED_PACKAGES="vlsm-interfacing" APT_INSTALL_EXIT=0
  run_install
  expect "installs and reports success" '[[ ${status} -eq 0 ]]'
  expect "leaves the removal to apt rather than doing it first" '! grep -q "dpkg --remove" <<< "${calls_made}"'
) || failures=$((failures + 1))

echo "an install that fails, with nothing broken for the repair to fix"
(
  export INSTALLED_PACKAGES="vlsm-interfacing" APT_INSTALL_EXIT=100 APT_FIX_EXIT=0
  run_install
  # The expensive lie: the repair exits 0 because there is nothing to repair.
  expect "does not report success" '[[ ${status} -ne 0 ]]'
  expect "says the machine was not changed" 'grep -q "has not been changed" <<< "${output}"'
  expect "never removed what the laboratory was running" '! grep -q "dpkg --remove" <<< "${calls_made}"'
) || failures=$((failures + 1))

echo "an install that fails and is then repaired"
(
  export INSTALLED_PACKAGES="vlsm-interfacing intelis-interfacing" APT_INSTALL_EXIT=100 APT_FIX_EXIT=0
  run_install
  expect "reports success once the package is really there" '[[ ${status} -eq 0 ]]'
  expect "says so plainly" 'grep -q "after dependency repair" <<< "${output}"'
) || failures=$((failures + 1))

if [[ ${failures} -ne 0 ]]; then
  echo "install script: ${failures} case(s) failed."
  exit 1
fi

echo "install script: an upgrade that cannot proceed leaves the laboratory as it was."
