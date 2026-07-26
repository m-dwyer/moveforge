/*
 * Parameter automation for the offline render harnesses.
 *
 * Every render in this project used to set its parameters once, before the block
 * loop, and never touch them again. That makes a whole class of defect
 * structurally invisible offline: zipper noise on a smoothed gain, clicks when a
 * delay time jumps the read pointer, filter coefficients recomputed
 * discontinuously at a block boundary, envelopes retriggered mid-tail.
 *
 * Automation is applied at block rate, which is also how the Schwung host
 * delivers parameters (set_param between render_block calls), so what this
 * exercises is what the device does.
 *
 * CLI forms, both via repeated --automate:
 *
 *   --automate cutoff=0.1..0.9     linear ramp across the whole render
 *   --automate drive=0..1x8        triangle sweep, 8 round trips across it
 *   --automate sync=0,4,7,2        step to each value at equal intervals
 *
 * Sweep *rate* matters more than range. A 0..1 ramp over 4 seconds moves about
 * 0.0007 per block, which is precisely the case where an unsmoothed parameter
 * sounds fine — measured against faust_drive (which smooths nothing) such a ramp
 * shifted slew_ratio by 0.4%, well inside tolerance. Use the `xN` cycle form for
 * anything meant to expose zipper noise, and the step form for discontinuities.
 */

#ifndef MOVEFORGE_RENDER_AUTOMATION_H
#define MOVEFORGE_RENDER_AUTOMATION_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MF_AUTOMATE_MAX 8
#define MF_AUTOMATE_MAX_STEPS 16

typedef struct {
    char key[32];
    int is_ramp;                        /* 1 = ramp from/to, 0 = discrete steps */
    double from;
    double to;
    int cycles;                         /* >1 = triangle sweep, that many round trips */
    double steps[MF_AUTOMATE_MAX_STEPS];
    int step_count;
} mf_automate_t;

typedef struct {
    mf_automate_t items[MF_AUTOMATE_MAX];
    int count;
} mf_automate_set_t;

/* Parse one "--automate" argument value. Returns 0 on success. */
static int mf_automate_add(mf_automate_set_t *set, const char *spec)
{
    if (!set || !spec) return -1;
    if (set->count >= MF_AUTOMATE_MAX) {
        fprintf(stderr, "automate: too many entries (max %d)\n", MF_AUTOMATE_MAX);
        return -1;
    }

    const char *eq = strchr(spec, '=');
    if (!eq || eq == spec) {
        fprintf(stderr, "automate: expected <key>=<from>..<to> or <key>=v1,v2,...  (got '%s')\n", spec);
        return -1;
    }

    mf_automate_t *a = &set->items[set->count];
    memset(a, 0, sizeof(*a));

    size_t key_len = (size_t)(eq - spec);
    if (key_len >= sizeof(a->key)) {
        fprintf(stderr, "automate: key too long in '%s'\n", spec);
        return -1;
    }
    memcpy(a->key, spec, key_len);
    a->key[key_len] = '\0';

    const char *value = eq + 1;
    const char *range = strstr(value, "..");
    if (range) {
        a->is_ramp = 1;
        a->from = atof(value);
        a->to = atof(range + 2);
        a->cycles = 1;
        const char *x = strchr(range + 2, 'x');
        if (x) {
            a->cycles = atoi(x + 1);
            if (a->cycles < 1) a->cycles = 1;
        }
    } else {
        a->is_ramp = 0;
        const char *p = value;
        while (p && *p && a->step_count < MF_AUTOMATE_MAX_STEPS) {
            a->steps[a->step_count++] = atof(p);
            const char *comma = strchr(p, ',');
            p = comma ? comma + 1 : NULL;
        }
        if (a->step_count == 0) {
            fprintf(stderr, "automate: no values in '%s'\n", spec);
            return -1;
        }
    }

    set->count++;
    return 0;
}

/* Current value for entry `i` at normalized render position `t` in [0, 1]. */
static double mf_automate_value(const mf_automate_t *a, double t)
{
    if (t < 0.0) t = 0.0;
    if (t > 1.0) t = 1.0;
    if (a->is_ramp) {
        double u = t;
        if (a->cycles > 1) {
            /* Triangle: 0 -> 1 -> 0 per cycle, so the sweep is continuous at
             * the turnaround rather than snapping back to `from`. */
            double phase = t * (double)a->cycles;
            double frac = phase - (double)(long)phase;
            u = frac < 0.5 ? frac * 2.0 : (1.0 - frac) * 2.0;
        }
        return a->from + (a->to - a->from) * u;
    }
    int idx = (int)(t * (double)a->step_count);
    if (idx >= a->step_count) idx = a->step_count - 1;
    return a->steps[idx];
}

/* Push every automated parameter for this block. `set_param` is the module's
 * string-keyed setter, matching the Schwung ABI. */
static void mf_automate_apply(const mf_automate_set_t *set, double t, void *instance,
                              void (*set_param)(void *, const char *, const char *))
{
    if (!set || !set_param) return;
    for (int i = 0; i < set->count; i++) {
        char buf[32];
        snprintf(buf, sizeof(buf), "%.6f", mf_automate_value(&set->items[i], t));
        set_param(instance, set->items[i].key, buf);
    }
}

#endif
