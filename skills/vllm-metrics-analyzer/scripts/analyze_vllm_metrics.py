#!/usr/bin/env python3
# Poll vLLM /metrics every second for 5 minutes, collect histogram stats, then summarize per-request averages.
import urllib.request, time, re, sys, os

HOST=os.environ["EMACS_GPTEL_VLLM_HOST"]
PORT=os.environ["EMACS_GPTEL_VLLM_PORT"]
URL=f"http://{HOST}:{PORT}/metrics"
DURATION=300  # 5 min

HIST_LIST=[
    "vllm:request_prefill_time_seconds",
    "vllm:time_to_first_token_seconds",
    "vllm:inter_token_latency_seconds",
    "vllm:e2e_request_latency_seconds",
    "vllm:request_queue_time_seconds",
    "vllm:request_prompt_tokens",
    "vllm:request_generation_tokens",
]

print("=== Starting vLLM monitor ===")
print(f"Endpoint: {URL}")
print(f"Window:   {DURATION}s")
print()

prev={}
samples=[]

for i in range(1,DURATION+1):
    try:
        text=urllib.request.urlopen(URL,timeout=5).read().decode()
    except Exception as e:
        print(f"[WARN] Failed at iteration {i}: {e}")
        time.sleep(1)
        continue

    cur={}
    for name in HIST_LIST:
        m_count=re.search(rf"{name}_count{{[^}}]*}}\s+([\d.e+-]+)",text)
        m_sum=re.search(rf"{name}_sum{{[^}}]*}}\s+([\d.e+-]+)",text)
        c=float(m_count.group(1)) if m_count else 0.0
        s=float(m_sum.group(1)) if m_sum else 0.0
        cur[name]=c,s

    # Δ-count & Δ-sum since last poll
    deltas={}
    averages={}
    if prev:
        for name in HIST_LIST:
            dc=cur[name][0]-prev[name][0]
            ds=cur[name][1]-prev[name][1]
            deltas[name]=(dc,ds)
            if dc>0:
                averages[name]=ds/dc*1000  # ms
            else:
                averages[name]=-1

    # Grab the gauges too
    m_run=re.search(r"^vllm:num_requests_running{engine=\"(\d+)\",model_name=\"([^\"]+)\"}\s+([\d.e+-]+)",text,re.M)
    m_wai=re.search(r"^vllm:num_requests_waiting{engine=\"(\d+)\",model_name=\"([^\"]+)\"}\s+([\d.e+-]+)",text,re.M)
    m_kv=re.search(r"^vllm:kv_cache_usage_perc{engine=\"(\d+)\",model_name=\"([^\"]+)\"}\s+([\d.e+-]+)",text,re.M)
    m_gen=re.search(r"^vllm:generation_tokens_total{engine=\"(\d+)\",model_name=\"([^\"]+)\"}\s+([\d.e+-]+)",text,re.M)
    m_ptok=re.search(r"^vllm:prompt_tokens_total{engine=\"(\d+)\",model_name=\"([^\"]+)\"}\s+([\d.e+-]+)",text,re.M)
    m_succ=re.search(r'^vllm:request_success_total[^_][^}]*finished_reason="stop"[^}]*}\s+([\d.e+-]+)',text,re.M)
    running=float(m_run.group(3)) if m_run else -1
    waiting=float(m_wai.group(3)) if m_wai else -1
    kv_usage=float(m_kv.group(3)) if m_kv else -1
    gen_tok=float(m_gen.group(3)) if m_gen else -1
    prompt_tok=float(m_ptok.group(3)) if m_ptok else -1
    success=float(m_succ.group(1)) if m_succ else -1

    ts=time.strftime("%H:%M:%S")
    line=f"{ts}|run={running}|wai={waiting}|kv={kv_usage:.3f}"
    line+=f"|gen={gen_tok}|prompt={prompt_tok}|ok={success}"

    for nm in HIST_LIST:
        tag=nm.split(":")[-1]
        d=deltas.get(nm,(0,0))
        a=averages.get(nm,-1)
        line+=f"|{tag.replace('_total','')}_Δ={d[0]:.0f},{d[1]:.1f}"
        if a>=0:
            line+=f"{tag}_avg={a:.1f}ms"

    samples.append(line)
    print(line)

    prev=cur.copy()
    time.sleep(1)

print()
print("=== END OF MONITORING ===")
print(f"Total samples: {len(samples)}")
