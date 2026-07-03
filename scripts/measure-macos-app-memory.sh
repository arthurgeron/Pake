#!/usr/bin/env zsh
set -euo pipefail

app_name="${1:-Google Meet}"
interval_seconds="${2:-5}"
sample_count="${3:-120}"
output_path="${4:-work/${app_name// /-}-memory-$(date +%Y%m%d-%H%M%S).csv}"
bundle_identifier="${5:-}"
default_binary_name="pake-${app_name:l}"
default_binary_name="${default_binary_name// /}"
binary_name="${6:-$default_binary_name}"

mkdir -p "$(dirname "$output_path")"
printf 'timestamp,elapsed_seconds,root_pids,process_count,webkit_helper_count,total_rss_mb,main_rss_mb\n' > "$output_path"

for ((sample = 0; sample < sample_count; sample++)); do
  timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  elapsed=$((sample * interval_seconds))
  webkit_pids=()

  if [[ -n "$bundle_identifier" ]]; then
    candidate_pids=("${(@f)$(ps -axo pid=,command= | awk '/\/com\.apple\.WebKit\./ { print $1 }')}")
    for pid in "${candidate_pids[@]}"; do
      if [[ -n "$pid" ]] && lsof -p "$pid" 2>/dev/null | grep -Fq "/${bundle_identifier}/"; then
        webkit_pids+=("$pid")
      fi
    done
  fi

  ps -axo pid=,ppid=,rss=,command= | awk \
    -v binary_pattern="/Contents/MacOS/${binary_name}" \
    -v webkit_pid_csv="${(j:,:)webkit_pids}" \
    -v timestamp="$timestamp" \
    -v elapsed="$elapsed" '
      BEGIN {
        split(webkit_pid_csv, webkit_pid_values, ",")
        for (webkit_index in webkit_pid_values) {
          pid = webkit_pid_values[webkit_index]
          if (pid != "") {
            selected[pid] = 1
            webkit_helper[pid] = 1
          }
        }
      }

      {
        pid = $1
        ppid = $2
        rss = $3
        parent[pid] = ppid
        memory[pid] = rss

        if (index($0, binary_pattern) > 0 && index($0, "binary_pattern") == 0) {
          roots[pid] = 1
          selected[pid] = 1
        }
      }

      END {
        changed = 1
        while (changed) {
          changed = 0
          for (pid in parent) {
            if (selected[parent[pid]] && !selected[pid]) {
              selected[pid] = 1
              changed = 1
            }
          }
        }

        root_pids = ""
        root_count = 0
        main_rss = 0
        total_rss = 0
        process_count = 0
        webkit_helper_count = 0

        for (pid in roots) {
          root_count += 1
          main_rss += memory[pid]
          root_pids = root_pids (root_pids == "" ? "" : ";") pid
        }

        for (pid in selected) {
          if (selected[pid]) {
            process_count += 1
            total_rss += memory[pid]
            if (webkit_helper[pid]) {
              webkit_helper_count += 1
            }
          }
        }

        if (root_count == 0) {
          printf "%s,%d,,%d,%d,%.1f,0.0\n",
            timestamp,
            elapsed,
            process_count,
            webkit_helper_count,
            total_rss / 1024
        } else {
          printf "%s,%d,%s,%d,%d,%.1f,%.1f\n",
            timestamp,
            elapsed,
            root_pids,
            process_count,
            webkit_helper_count,
            total_rss / 1024,
            main_rss / 1024
        }
      }
    ' >> "$output_path"

  sleep "$interval_seconds"
done

printf '%s\n' "$output_path"
