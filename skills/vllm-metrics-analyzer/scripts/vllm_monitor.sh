#!/bin/bash
# Polls vLLM /metrics every second for 5 minutes, logs gauges + histogram deltas
set -euo pipefail

HOST="${EMACS_GPTEL_VLLM_HOST}"
PORT="${EMACS_GPTEL_VLLM_PORT}"
URL="http://${HOST}:${PORT}/metrics"
LOG="/tmp/vllm_monitor_$(date +%Y%m%d_%H%M%S).log"
HIST_LOG="/tmp/vllm_monitor_hist_$(date +%Y%m%d_%H%M%S).log"
DURATION=300  # 5 minutes

echo "[$(date '+%H:%M:%S')] Starting vLLM monitor: $URL (every 1s for ${DURATION}s)" | tee "$LOG"
echo "Histogram log: $HIST_LOG" | tee -a "$LOG"

# Header for histogram log
echo "ts | prefill_avg(ms) | ttft_avg(ms) | itl_avg(ms) | e2e_avg(ms) | queue_avg(ms) | n_new" > "$HIST_LOG"

prev_running=""
prev_waiting=""
prev_kv=""
prev_gen=""
prev_prompt=""
prev_success=""
prev_http=""

# Previous histogram _count and _sum values
prev_prefill_count="" prev_prefill_sum=""
prev_ttft_count=""    prev_ttft_sum=""
prev_itl_count=""     prev_itl_sum=""
prev_e2e_count=""     prev_e2e_sum=""
prev_queue_count=""   prev_queue_sum=""

extract_hist() {
  local name="$1" raw="$2" count sum
  count=$(echo "$raw" | grep "^${name}_count{" | head -1 | grep -oP '[0-9.e+-]+$' | tail -1)
  sum=$(echo "$raw"   | grep "^${name}_sum{"   | head -1 | grep -oP '[0-9.e+-]+$' | tail -1)
  echo "${count:-0} ${sum:-0}"
}

compute_avg_ms() {
  local pc="$1" ps="$2" cc="$3" cs="$4" dc ds avg
  dc=$(awk "BEGIN{printf \"%.0f\", $cc - $pc}")
  ds=$(awk "BEGIN{printf \"%.6f\", $cs - $ps}")
  if [ "$dc" -gt 0 ] 2>/dev/null; then
    avg=$(awk "BEGIN{printf \"%.1f\", ($ds/$dc)*1000}")
    echo "$avg $dc"
  else
    echo "- 0"
  fi
}

for i in $(seq 1 $DURATION); do
  raw=$(curl -s --max-time 5 "$URL" 2>/dev/null) || { echo "[WARN] curl failed at iteration $i" >> "$LOG"; sleep 1; continue; }

  running=$(echo "$raw" | grep "^vllm:num_requests_running{engine=" | head -1 | grep -oP '[0-9.]+' | tail -1)
  waiting=$(echo "$raw" | grep "^vllm:num_requests_waiting{engine=" | head -1 | grep -oP '[0-9.]+' | tail -1)
  kv=$(echo "$raw" | grep "^vllm:kv_cache_usage_perc{" | head -1 | grep -oP '[0-9.e+]+' | tail -1)
  gen=$(echo "$raw" | grep "^vllm:generation_tokens_total{" | head -1 | grep -oP '[0-9.e+-]+' | tail -1)
  prompt=$(echo "$raw" | grep "^vllm:prompt_tokens_total{" | head -1 | grep -oP '[0-9.e+-]+' | tail -1)
  success=$(echo "$raw" | grep 'finished_reason="stop"' | head -1 | grep -oP '[0-9.]+' | tail -1)
  http=$(echo "$raw" | grep "^http_requests_total{" | head -1 | grep -oP '[0-9.]+' | tail -1)

  # Calculate gauge deltas
  delta_gen=""; delta_prompt=""; delta_success=""; delta_http=""
  if [[ -n "$prev_gen" && -n "$gen" ]]; then
    delta_gen=$(awk "BEGIN{printf \"%.0f\", $gen - $prev_gen}")
    delta_prompt=$(awk "BEGIN{printf \"%.0f\", $prompt - $prev_prompt}")
    delta_success=$(awk "BEGIN{printf \"%.0f\", $success - $prev_success}")
    delta_http=$(awk "BEGIN{printf \"%.0f\", $http - $prev_http}")
  fi

  ts=$(date '+%H:%M:%S')
  line="$ts | run=$running wait=$waiting kv=${kv} | gen=$gen(+${delta_gen:-?}) prompt=$prompt(+${delta_prompt:-?}) | ok=$success(+${delta_success:-?}) http=$http(+${delta_http:-?})"
  echo "$line" | tee -a "$LOG"

  # --- Histogram processing ---
  read prefill_count prefill_sum <<< "$(extract_hist 'vllm:request_prefill_time_seconds' "$raw")"
  read ttft_count ttft_sum       <<< "$(extract_hist 'vllm:time_to_first_token_seconds' "$raw")"
  read itl_count itl_sum         <<< "$(extract_hist 'vllm:inter_token_latency_seconds' "$raw")"
  read e2e_count e2e_sum         <<< "$(extract_hist 'vllm:e2e_request_latency_seconds' "$raw")"
  read queue_count queue_sum     <<< "$(extract_hist 'vllm:request_queue_time_seconds' "$raw")"

  if [[ -n "$prev_prefill_count" ]]; then
    read prefill_avg prefill_n  <<< "$(compute_avg_ms $prev_prefill_count $prev_prefill_sum $prefill_count $prefill_sum)"
    read ttft_avg    ttft_n     <<< "$(compute_avg_ms $prev_ttft_count $prev_ttft_sum $ttft_count $ttft_sum)"
    read itl_avg     itl_n      <<< "$(compute_avg_ms $prev_itl_count $prev_itl_sum $itl_count $itl_sum)"
    read e2e_avg     e2e_n      <<< "$(compute_avg_ms $prev_e2e_count $prev_e2e_sum $e2e_count $e2e_sum)"
    read queue_avg   queue_n    <<< "$(compute_avg_ms $prev_queue_count $prev_queue_sum $queue_count $queue_sum)"
    hist_line="$ts | prefill=${prefill_avg}ms | ttft=${ttft_avg}ms | itl=${itl_avg}ms | e2e=${e2e_avg}ms | queue=${queue_avg}ms | n_req=${prefill_n}"
    echo "$hist_line" >> "$HIST_LOG"
  fi

  prev_running=$running; prev_waiting=$waiting; prev_kv=$kv
  prev_gen=$gen; prev_prompt=$prompt; prev_success=$success; prev_http=$http
  prev_prefill_count=$prefill_count; prev_prefill_sum=$prefill_sum
  prev_ttft_count=$ttft_count;       prev_ttft_sum=$ttft_sum
  prev_itl_count=$itl_count;         prev_itl_sum=$itl_sum
  prev_e2e_count=$e2e_count;         prev_e2e_sum=$e2e_sum
  prev_queue_count=$queue_count;     prev_queue_sum=$queue_sum

  sleep 1
done

echo "[$(date '+%H:%M:%S')] Done." | tee -a "$LOG"
echo "  Main log:      $LOG" | tee -a "$LOG"
echo "  Histogram log: $HIST_LOG" | tee -a "$LOG"

# Print summary of histogram activity (only lines where requests completed)
echo "" | tee -a "$HIST_LOG"
echo "=== Histogram Activity Summary ===" | tee -a "$HIST_LOG"
grep -v "^ts\|^- \|Starting\|Log:\|Done\|Main\|n_req=0$\|Histogram" "$HIST_LOG" | column -t | tee -a "$HIST_LOG"
