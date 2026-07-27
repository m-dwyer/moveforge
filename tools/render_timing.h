/*
 * Per-block DSP timing for the offline render harnesses.
 *
 * The device host drops a module's DSP entirely after three consecutive blocks
 * over 2850 us (schwung_shim.c OVERRUN_THRESHOLD_US / SKIP_DSP_THRESHOLD), and
 * moveforge measured no time at all anywhere. This is that measurement.
 *
 * Per block, not a total ratio. An average cannot see a single bad block, which
 * is precisely the failure mode that matters here — measured on lobber with a
 * capture firing every 500 blocks:
 *
 *   average view : 4110x realtime, mean 0.7 us/block      <- looks fine
 *   per block    : median 0.0 us  p99 1.0 us  MAX 172 us  <- the capture
 *
 * Reading the numbers: the dev machine is not the device. Absolute microseconds
 * do not transfer from an Apple M-series or a CI runner to a 1.5 GHz Cortex-A72
 * with CM4's LPDDR4 — only ratios and regressions do. Treat this as an
 * investigation and visibility tool; see the gating note below for what it is
 * and is not willing to fail a build on.
 */

#ifndef MOVEFORGE_RENDER_TIMING_H
#define MOVEFORGE_RENDER_TIMING_H

#include <stdio.h>
#include <stdlib.h>
#include <time.h>

/* A block taking longer to compute than the audio it produces cannot be
 * realtime on any slower machine either, so this is a hard failure regardless of
 * where it runs. Necessary but nowhere near sufficient: the dev machine is
 * several times faster than the device. */
#define MF_TIMING_QUANTUM_US(frames, sample_rate) \
    ((double)(frames) / (double)(sample_rate) * 1.0e6)

/* What this gates on, and what it deliberately does not.
 *
 * Wall-clock timing on a general-purpose OS is noisy: faust_voice-demo measured
 * max 5 us in one run and 289 us in the next with identical code, because the
 * render process was preempted. So a gate on the slowest block is flaky by
 * construction. Gating on the 3rd-slowest instead (mirroring the host's
 * SKIP_DSP_THRESHOLD) removes the flakiness but is too blunt to catch what it
 * exists for — measured against the pre-fix lobber capture it let a 141 us spike
 * through because only two blocks were large.
 *
 * Rather than keep tuning a statistic against noise, the split is:
 *
 *   FAIL   only when N blocks each take longer than the audio they produce.
 *          At 2902 us against typical values of 1-20 us that is orders of
 *          magnitude outside scheduler noise, and it is broken on any machine.
 *   WARN   on a repeated spike, printed for a human or a reviewer to look at.
 *
 * The real regression gate for a spike is a behavioural test, not a timer —
 * see test_capture_is_amortised_across_blocks in tests/test_lobber_core.c,
 * which asserts the copy spans multiple blocks and holds on any machine. */
#define MF_TIMING_GATE_RANK 3

/* Spike *warning* thresholds. The floor keeps very cheap modules (p99 near
 * clock resolution) from warning constantly. */
#define MF_TIMING_SPIKE_FLOOR_US 50.0
#define MF_TIMING_SPIKE_FACTOR   25.0

typedef struct {
    double *us;
    int count;
    int cap;
    struct timespec t0;
} mf_timing_t;

static inline void mf_timing_init(mf_timing_t *t, int expected_blocks)
{
    if (!t) return;
    t->cap = expected_blocks > 0 ? expected_blocks : 1024;
    t->us = (double *)malloc((size_t)t->cap * sizeof(double));
    t->count = 0;
}

static inline void mf_timing_free(mf_timing_t *t)
{
    if (!t) return;
    free(t->us);
    t->us = NULL;
    t->count = 0;
    t->cap = 0;
}

static inline void mf_timing_begin(mf_timing_t *t)
{
    if (!t) return;
    clock_gettime(CLOCK_MONOTONIC, &t->t0);
}

static inline void mf_timing_end(mf_timing_t *t)
{
    if (!t || !t->us) return;
    struct timespec t1;
    clock_gettime(CLOCK_MONOTONIC, &t1);
    double us = (double)(t1.tv_sec - t->t0.tv_sec) * 1.0e6
              + (double)(t1.tv_nsec - t->t0.tv_nsec) / 1.0e3;
    if (t->count == t->cap) {
        int cap = t->cap * 2;
        double *grown = (double *)realloc(t->us, (size_t)cap * sizeof(double));
        if (!grown) return;
        t->us = grown;
        t->cap = cap;
    }
    t->us[t->count++] = us;
}

static int mf_timing_cmp(const void *a, const void *b)
{
    double x = *(const double *)a;
    double y = *(const double *)b;
    return x < y ? -1 : (x > y ? 1 : 0);
}

/* Print the distribution and return 1 if it should fail the render. */
static inline int mf_timing_report(mf_timing_t *t, const char *label,
                                  int frames_per_block, int sample_rate)
{
    if (!t || !t->us || t->count < 8) return 0;

    qsort(t->us, (size_t)t->count, sizeof(double), mf_timing_cmp);
    double median = t->us[t->count / 2];
    double p99 = t->us[(int)((double)t->count * 0.99)];
    double max = t->us[t->count - 1];
    /* Nth-slowest, guarded for short runs. */
    int rank_idx = t->count - MF_TIMING_GATE_RANK;
    if (rank_idx < 0) rank_idx = 0;
    double nth = t->us[rank_idx];
    double total = 0.0;
    for (int i = 0; i < t->count; i++) total += t->us[i];

    double quantum_us = MF_TIMING_QUANTUM_US(frames_per_block, sample_rate);
    double spike_limit = MF_TIMING_SPIKE_FLOOR_US;
    if (p99 * MF_TIMING_SPIKE_FACTOR > spike_limit) spike_limit = p99 * MF_TIMING_SPIKE_FACTOR;

    fprintf(stderr,
            "timing %s: %d blocks  median %.1f us  p99 %.1f us  #%d-slowest %.1f us  "
            "max %.1f us  (mean %.1f%% of the %.0f us quantum)\n",
            label, t->count, median, p99, MF_TIMING_GATE_RANK, nth, max,
            100.0 * (total / (double)t->count) / quantum_us, quantum_us);

    int fail = 0;
    if (nth >= quantum_us) {
        fprintf(stderr,
                "ERROR: %s has %d blocks taking over %.0f us to produce %.0f us of "
                "audio — slower than realtime even here, so certainly on the device\n",
                label, MF_TIMING_GATE_RANK, nth, quantum_us);
        fail = 1;
    } else if (max > spike_limit) {
        /* Warning only: see the note above on why this is not a failure. */
        fprintf(stderr,
                "warning: %s slowest block %.1f us is %.0fx its p99 of %.1f us. "
                "If that repeats it is a block doing far more work than the rest; a "
                "single occurrence is usually scheduler noise. The host drops a "
                "module's DSP after three consecutive blocks over 2850 us, and this "
                "machine is several times faster than the device's Cortex-A72.\n",
                label, max, max / (p99 > 0.0 ? p99 : 1.0), p99);
    }
    return fail;
}

#endif
