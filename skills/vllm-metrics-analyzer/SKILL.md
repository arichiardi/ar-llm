---
name: vllm-metrics-analyzer
description: Expert vLLM performance analyzer that monitors /metrics endpoints, tracks histogram deltas, and produces structured reports with prefill/decode throughput analysis.
---

# vLLM Metrics Analyzer

vLLM performance monitoring expert that polls Prometheus /metrics endpoints, computes per-request histogram averages via _count/_sum deltas, and produces structured reports for documentation.

## Primary Workflows

1. MONITOR - Poll /metrics every 1s for 5 minutes using the bundled `vllm_monitor.sh`
2. ANALYZE - Parse histogram logs with delta computation
3. REPORT - Generate structured summary tables for warm/cold cache performance
4. DOCUMENT - Write findings to a journal or knowledge base

## Tool Usage Policy

- Use bash for curl requests and log parsing
- Use Python for floating-point histogram calculations
- Run scripts directly from the skill's `scripts/` directory

## Monitoring Setup

### Environment Variables
```shell
LOCAL_VLLM_HOST=<your-vllm-host>
LOCAL_VLLM_PORT=<your-vllm-port>
```

### Scripts
Scripts ship with this skill:
- `scripts/vllm_monitor.sh` - Main monitoring script (bash)
- `scripts/analyze_vllm_metrics.py` - Python analyzer (has bugs, prefer the bash version)

### Running a Monitor Session
```shell
# Start monitoring (5 minutes)
nohup bash skills/vllm-metrics-analyzer/scripts/vllm_monitor.sh > /dev/null 2>&1 &
MONITOR_PID=$!
# Logs written to /tmp/vllm_monitor_YYYYMMDD_HHMMSS.log and /tmp/vllm_monitor_hist_YYYYMMDD_HHMMSS.log
```

## Analysis Methodology

### Histogram Delta Computation
Track `_count` and `_sum` Prometheus metrics between 1-second polls:
```python
delta_count = cur_count - prev_count
delta_sum = cur_sum - prev_sum
if delta_count > 0:
    avg_ms = (delta_sum / delta_count) * 1000  # Convert to milliseconds
```

### Key Metrics Tracked
| Metric | Description | Units |
|--------|-------------|-------|
| `vllm:request_prefill_time_seconds` | Time to process input tokens | ms |
| `vllm:time_to_first_token_seconds` | TTFT including queue+prefill | ms |
| `vllm:inter_token_latency_seconds` | Time between output tokens | ms |
| `vllm:e2e_request_latency_seconds` | Total request duration | ms |
| `vllm:request_queue_time_seconds` | Time spent waiting in queue | ms |

### Warm vs Cold Cache Classification
- **Warm cache**: Prefill <5s (prefix caching active, ~9K new tokens)
- **Cold cache**: Prefill ≥5s (full context load, 40K+ tokens)

## Report Format Pattern

Organize findings using headings, subheadings, and tables. The exact markup depends on your preferred format (org-mode, Markdown, etc.) — the structure is what matters:

```
## Session N Averages (HH:MM:SS → HH:MM:SS, N requests)

### Cold Prefill Anomaly Analysis (HH:MM:SS)
| Timestamp | Prompt Tokens | Delta |
|-----------|---------------|-------|
| ...       | ...           | ...   |

| Metric              | Value      |
|---------------------|------------|
| Prompt tokens       | NNN,NNN    |
| Prefill time        | NN.NNs     |
| Prefill speed       | N,NNN tok/s|

### Summary Table
| Metric                | All Requests | Warm Cache Only |
|-----------------------+--------------+----------------|
| Prefill p50           | NNNms        | NNNms          |
| Prefill avg           | NNNms        | NNNms          |
| ITL avg               | NN.Nms       | NN.Nms         |
| Decode TPS (raw)      | ~N tok/s     | ~N tok/s       |
| Decode TPS (effective)| ~N-N tok/s   | ~N-N tok/s     |
| E2E p50               | NNNms        | NNNms          |
| Queue time            | 0ms          | 0ms            |

| Gauge Delta (over window)     | Value   |
|-------------------------------+---------|
| Generation tokens             | +N,NNN  |
| Successful requests           | +N      |
| Prompt tokens                 | +NNN,K  |

Warm cache: N/N requests (<5s prefill), Cold cache: N/N requests (≥5s)
```

## Measurement Limitations

- 1-second polling granularity means sub-second events can't be precisely timed
- TTFT often missed because first-token event and request-completion fall in different polling windows
- Histogram _sum/_count deltas give per-request averages but not individual request breakdowns
- Prefix caching makes most requests appear much faster than cold starts

## Common Anomalies

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Prefill >30s | Cold cache miss (new context/session) | Normal for first request |
| E2E >30s | Large output generation | Check generation token count |
| ITL >100ms | GPU contention or memory pressure | Check KV cache usage |
| Queue >0ms | Concurrent requests exceeding capacity | Consider increasing max_num_seqs |

## Example Analysis Commands

```shell
# Find prompt token jumps (cold cache events)
grep "prompt=" /tmp/vllm_monitor_*.log | grep -E "\+[1-9]" | head -10

# Extract histogram activity lines
grep -v "^ts\|^- \|Starting\|Log:\|Done\|Main\|n_req=0$\|Histogram" /tmp/vllm_monitor_hist_*.log | column -t

# Calculate prefill speed for anomaly
echo "Prompt tokens: NNN,NNN / Prefill time: NN.s = NNNN tok/s"
```
