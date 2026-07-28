/*
 * Polyphonic step patterns for the sound-generator render harness.
 *
 * The harness used to take a flat note list plus one scalar velocity for the
 * whole render, and fire exactly one note per step. For a single-voice module
 * that is enough; for anything note-mapped it means no golden can ever exercise
 * voice summing, gain staging under simultaneity, choke groups, or per-voice
 * velocity — which for a kit engine is the entire behaviour under test.
 *
 * A pattern is a list of steps; a step is a chord of zero or more notes fired on
 * the same block, each with its own velocity.
 *
 *   36,43,48              three steps, one note each — the old form, unchanged
 *   36:110+39:96,36:64    step 1 fires 36 and 39 at different velocities
 *   36,,36                an empty step is a rest
 *
 * Steps are separated by ',', simultaneous notes within a step by '+', and a
 * note's velocity follows ':'. Notes with no ':' take the render's default
 * velocity, so the legacy `notes` + `velocity` pair is exactly the subset of this
 * grammar with one note per step and no ':' anywhere — every existing
 * presets.json keeps rendering byte-identically.
 *
 * MIDI here is block-quantised with no sample offset (plugin_api_v1.h:210), so
 * every note in a step lands on sample 0 of the same block. That is the point:
 * simultaneity is what the module has to survive.
 *
 * Every malformed spec is an error with a non-zero exit. A harness that quietly
 * drops half a pattern renders a file that looks fine and measures the wrong
 * thing.
 */

#ifndef MOVEFORGE_RENDER_PATTERN_H
#define MOVEFORGE_RENDER_PATTERN_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MF_PATTERN_MAX_STEPS 64
#define MF_PATTERN_MAX_NOTES 16     /* simultaneous notes in one step */

typedef struct {
    int note;
    int velocity;
} mf_pattern_note_t;

typedef struct {
    mf_pattern_note_t notes[MF_PATTERN_MAX_NOTES];
    int count;                      /* 0 = a rest */
} mf_pattern_step_t;

typedef struct {
    mf_pattern_step_t steps[MF_PATTERN_MAX_STEPS];
    int count;
} mf_pattern_t;

/* One `note` or `note:velocity` term. `*end` receives the first byte after the
 * term, so the caller can insist on a real delimiter instead of accepting
 * trailing garbage — `36x9` must not parse as note 36. */
static inline int mf_pattern_parse_note(const char *text, int default_velocity,
                                        mf_pattern_note_t *out, const char **end)
{
    const char *p = text;
    char *stop = NULL;

    while (*p == ' ') p++;
    long note = strtol(p, &stop, 10);
    if (stop == p) {
        fprintf(stderr, "pattern: expected a note number at '%s'\n", text);
        return -1;
    }
    p = stop;

    long velocity = default_velocity;
    if (*p == ':') {
        p++;
        velocity = strtol(p, &stop, 10);
        if (stop == p) {
            fprintf(stderr, "pattern: expected a velocity after ':' at '%s'\n", text);
            return -1;
        }
        p = stop;
    }

    while (*p == ' ') p++;
    if (*p != '\0' && *p != ',' && *p != '+') {
        fprintf(stderr, "pattern: unexpected '%c' at '%s'\n", *p, p);
        return -1;
    }

    if (note < 0 || note > 127) {
        fprintf(stderr, "pattern: note %ld is outside 0..127\n", note);
        return -1;
    }
    /* Velocity 0 is a note-off on the wire, so accepting it here would render a
     * step that looks scheduled and makes no sound. */
    if (velocity == 0) {
        fprintf(stderr, "pattern: velocity 0 on note %ld is a note-off, not a quiet hit\n", note);
        return -1;
    }
    if (velocity < 0 || velocity > 127) {
        fprintf(stderr, "pattern: velocity %ld on note %ld is outside 1..127\n", velocity, note);
        return -1;
    }

    out->note = (int)note;
    out->velocity = (int)velocity;
    *end = p;
    return 0;
}

/* Parse a whole pattern spec. Returns 0 on success, -1 on a reported error. */
static inline int mf_pattern_parse(mf_pattern_t *pattern, const char *spec,
                                   int default_velocity)
{
    if (!pattern || !spec) return -1;
    memset(pattern, 0, sizeof(*pattern));

    if (default_velocity < 1 || default_velocity > 127) {
        fprintf(stderr, "pattern: default velocity %d is outside 1..127\n", default_velocity);
        return -1;
    }

    const char *p = spec;
    for (;;) {
        if (pattern->count >= MF_PATTERN_MAX_STEPS) {
            fprintf(stderr, "pattern: more than %d steps in '%s'\n", MF_PATTERN_MAX_STEPS, spec);
            return -1;
        }
        mf_pattern_step_t *step = &pattern->steps[pattern->count++];

        while (*p == ' ') p++;
        /* An empty step is a rest. A realistic drum pattern needs those far more
         * often than it needs a hit on every step. */
        if (*p != '\0' && *p != ',') {
            for (;;) {
                if (step->count >= MF_PATTERN_MAX_NOTES) {
                    fprintf(stderr, "pattern: step %d has more than %d simultaneous notes\n",
                            pattern->count, MF_PATTERN_MAX_NOTES);
                    return -1;
                }
                if (mf_pattern_parse_note(p, default_velocity,
                                          &step->notes[step->count], &p) != 0) {
                    return -1;
                }
                /* Two note-ons for one note on one block is a retrigger dressed
                 * up as a chord — always an authoring slip, never a voicing. */
                for (int i = 0; i < step->count; i++) {
                    if (step->notes[i].note == step->notes[step->count].note) {
                        fprintf(stderr, "pattern: note %d appears twice in step %d\n",
                                step->notes[i].note, pattern->count);
                        return -1;
                    }
                }
                step->count++;
                if (*p != '+') break;
                p++;
            }
        }

        if (*p == '\0') break;
        p++;                        /* the ',' */
    }

    int notes = 0;
    for (int i = 0; i < pattern->count; i++) notes += pattern->steps[i].count;
    if (notes == 0) {
        fprintf(stderr, "pattern: '%s' has no notes in it\n", spec);
        return -1;
    }
    return 0;
}

#endif
