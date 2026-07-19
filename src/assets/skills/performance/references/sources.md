# Performance — Sources

## Primary References

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 1 | USE Method | Brendan Gregg | 2012 | [Free](https://brendangregg.com/usemethod.html) | Utilization, Saturation, Errors — systematic resource analysis |
| 2 | RED Method | Tom Wilkie | 2018 | [Free](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/) | Rate, Errors, Duration — service-level performance signals |
| 3 | "High Performance Browser Networking" | Ilya Grigorik | 2013 | [Free](https://hpbn.co) | HTTP, TLS, TCP, WebSockets, network performance |
| 4 | "What Every Programmer Should Know About Memory" | Ulrich Drepper | 2007 | [Free](https://people.freebsd.org/~lstewart/articles/cpumemory.pdf) | Memory hierarchy, L1/L2/L3 cache effects, NUMA, prefetching |
| 5 | MIT 6.172 Performance Engineering of Software Systems | Charles Leiserson et al. | 2018 | [Free](https://ocw.mit.edu/courses/6-172-performance-engineering-of-software-systems-fall-2018/) | Algorithmic optimization, SIMD, parallelism, work-span model |
| 6 | Web Vitals | Google | 2024 | [Free](https://web.dev/vitals/) | LCP, INP, CLS — core user experience metrics |
| 7 | "Latency Numbers Every Programmer Should Know" | Jeff Dean | 2012 | [Free](https://norvig.com/21-days.html#answers) | Order-of-magnitude latencies: cache, RAM, disk, network |
| 8 | "How NOT to Measure Latency" | Gil Tene | 2015 | [Free](https://www.youtube.com/watch?v=lJ8ydIuPFeU) | Coordinated omission, HDR histograms, percentile pitfalls |
| 9 | Flame Graphs | Brendan Gregg | 2011 | [Free](https://brendangregg.com/flamegraphs.html) | CPU profiling visualization, hot path identification |
| 10 | "The LMAX Disruptor" | Thompson, Farley, Barker, Gee, Stewart | 2011 | [Free](https://lmax-exchange.github.io/disruptor/disruptor.html) | Mechanical sympathy, false sharing, cache line padding |
| 11 | "The Tail at Scale" | Dean & Barroso | 2013 | [Free](https://research.google/pubs/the-tail-at-scale/) | Tail latency causes and mitigation (hedged requests, micro-partitioning) |
| 12 | "Algorithms for Modern Hardware" | Sergey Slotin | 2022 | [Free](https://en.algorithmica.org/hpc/) | Cache-aware algorithms, SIMD, branch prediction, memory layout |
| 13 | V8 Blog | Google V8 Team | ongoing | [Free](https://v8.dev/blog) | JavaScript engine JIT internals, hidden classes, deoptimizations |
| 14 | Lighthouse Documentation | Google | 2024 | [Free](https://developer.chrome.com/docs/lighthouse/) | Web performance auditing, scoring, budget enforcement |
| 15 | Chrome DevTools Performance Panel | Google | 2024 | [Free](https://developer.chrome.com/docs/devtools/performance/) | CPU profiling, frame timeline, memory analysis in browser |
| 16 | Node.js Performance Hooks (`perf_hooks`) | Node.js | 2024 | [Free](https://nodejs.org/api/perf_hooks.html) | Server-side measurement, `performance.mark`, `PerformanceObserver` |
| 17 | Chrome UX Report (CrUX) | Google | 2024 | [Free](https://developer.chrome.com/docs/crux/) | Real-user field data for Core Web Vitals |
| 18 | webpack Bundle Analysis | webpack contributors | 2024 | [Free](https://webpack.js.org/guides/code-splitting/) | Bundle size optimization, code splitting, tree shaking |
| 19 | "Systems Performance" 2nd Ed. | Brendan Gregg | 2020 | Purchase | Comprehensive systems performance: OS, CPU, memory, I/O |
| 20 | "Database Internals" | Alex Petrov | 2019 | Purchase | B-tree storage, LSM trees, index structures, query optimization |

## Standards & Specifications

| # | Source | Org | Access | Topics |
|---|--------|-----|--------|--------|
| 21 | INP (Interaction to Next Paint) | Google/W3C | [Free](https://web.dev/articles/inp) | Responsiveness metric replacing FID, input latency budget |
| 22 | Resource Timing Level 2 | W3C | [Free](https://www.w3.org/TR/resource-timing-2/) | Browser resource loading performance API |
| 23 | Long Animation Frames API | W3C | [Free](https://w3c.github.io/long-animation-frames/) | Detecting long tasks blocking the main thread |

## Academic & Research

| # | Source | Author(s) | Year | Access | Topics |
|---|--------|-----------|------|--------|--------|
| 24 | "Computer Architecture: A Quantitative Approach" Ch. 2 | Hennessy & Patterson | 2017 | Purchase | Memory hierarchy design, cache performance, Amdahl's Law |
| 25 | "The Danger of Naive Benchmarking" (JVM warmup) | Shipilev | 2014 | [Free](https://shipilev.net/blog/2014/nanotrusting-the-nanotime/) | JVM JIT warmup, benchmark harness design, measurement validity |
