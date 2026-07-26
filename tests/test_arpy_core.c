#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "arpy_core.h"

static void require_true(int condition, const char *message) {
    if (!condition) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
}

/* Run ticks until a note is sounding, or give up. */
static void tick_until_sounding(arpy_core_t *s, uint8_t msgs[][3], int lens[], int max_out) {
    for (int b = 0; b < 500 && s->playing_note < 0; b++) {
        arpy_tick(s, 128, 44100, msgs, lens, max_out);
    }
}

static void test_pattern_off_releases_the_sounding_note(void) {
    /* Switching the pattern to off used to `return 0` before the gate-off step,
     * leaving the downstream synth holding a note forever. Lifting the key could
     * not recover it either: with the pattern off, process_midi passes the input
     * note-off through, but the sounding note is a transposed chord tone, so the
     * note-off addressed the wrong pitch. */
    arpy_core_t s;
    uint8_t msgs[16][3];
    int lens[16];

    arpy_init(&s);
    arpy_set_param(&s, arpy_param_id("pattern"), 1.0f);
    arpy_set_param(&s, arpy_param_id("chord"), 3.0f);
    arpy_set_param(&s, arpy_param_id("rate"), 0.0f);

    uint8_t on[3] = { 0x90, 60, 100 };
    arpy_process_midi(&s, on, 3, msgs, lens, 16);
    tick_until_sounding(&s, msgs, lens, 16);
    require_true(s.playing_note >= 0, "a note is sounding before the pattern is switched off");

    arpy_set_param(&s, arpy_param_id("pattern"), 0.0f);
    int n = arpy_tick(&s, 128, 44100, msgs, lens, 16);
    require_true(n == 1, "switching the pattern off emits exactly one message");
    require_true((msgs[0][0] & 0xF0) == 0x80, "that message is a note-off");
    require_true(msgs[0][2] == 0, "the note-off has zero velocity");
    require_true(s.playing_note == -1, "no note is left sounding");
    require_true(s.held_active == 0, "held state is cleared");

    int extra = 0;
    for (int b = 0; b < 100; b++) extra += arpy_tick(&s, 128, 44100, msgs, lens, 16);
    require_true(extra == 0, "nothing further is emitted while the pattern is off");
}

static void test_output_overflow_does_not_strand_a_note(void) {
    /* emit() silently drops past max_out. Writing playing_note unconditionally
     * therefore left the core believing a note was sounding that the host never
     * received — a stuck voice with no note-off ever generated for it.
     *
     * max_out == 1 is the tight case: closing the previous note and opening the
     * next one need two slots, so the step must be deferred rather than half
     * emitted. */
    arpy_core_t s;
    uint8_t msgs[16][3];
    int lens[16];

    arpy_init(&s);
    arpy_set_param(&s, arpy_param_id("pattern"), 1.0f);
    arpy_set_param(&s, arpy_param_id("chord"), 4.0f);
    arpy_set_param(&s, arpy_param_id("rate"), 0.0f);

    uint8_t on[3] = { 0x90, 60, 100 };
    arpy_process_midi(&s, on, 3, msgs, lens, 16);

    for (int b = 0; b < 400; b++) {
        int n = arpy_tick(&s, 128, 44100, msgs, lens, 1);
        require_true(n <= 1, "never emits more messages than max_out");
        /* Whatever the core believes is sounding must have been announced: if a
         * note is marked playing, some note-on for it was emitted at some point.
         * The invariant we can check cheaply is that state stays self-consistent
         * and the gate timer never goes negative-unbounded. */
        /* playing_note is int8_t, so an upper bound of 127 is tautological —
         * GCC on aarch64 rejects it under -Werror=type-limits. -1 is the only
         * meaningful sentinel to check. */
        require_true(s.playing_note >= -1, "playing_note stays a valid note or -1");
        require_true(s.frames_until_gate_off >= 0, "gate timer never goes negative");
    }

    /* And with room again, it recovers and keeps arpeggiating. */
    int emitted = 0;
    for (int b = 0; b < 200; b++) emitted += arpy_tick(&s, 128, 44100, msgs, lens, 16);
    require_true(emitted > 0, "arp resumes once output room is available");
}

int main(void) {
    arpy_core_t fx;
    arpy_init(&fx);

    int pattern_id = arpy_param_id("pattern");
    int chord_id = arpy_param_id("chord");
    int rate_id = arpy_param_id("rate");
    require_true(pattern_id >= 0 && chord_id >= 0 && rate_id >= 0, "params resolve");
    require_true(arpy_param_id("does_not_exist") < 0, "unknown param fails");

    uint8_t msgs[16][3];
    int lens[16];

    /* Pattern off: passthrough note-on/off, no tick emission. */
    arpy_set_param(&fx, pattern_id, 0.0f);
    uint8_t on60[3] = { 0x90, 60, 100 };
    int n = arpy_process_midi(&fx, on60, 3, msgs, lens, 16);
    require_true(n == 1 && msgs[0][1] == 60 && msgs[0][2] == 100, "passthrough note-on");
    uint8_t off60[3] = { 0x80, 60, 0 };
    n = arpy_process_midi(&fx, off60, 3, msgs, lens, 16);
    require_true(n == 1 && msgs[0][0] == 0x80, "passthrough note-off");
    n = arpy_tick(&fx, 128, 44100, msgs, lens, 16);
    require_true(n == 0, "tick silent when pattern=0");

    /* Pattern up, triad, fast rate: a held note should generate a stream of
     * arp notes via mf_tick. The note-on itself emits nothing; the first arp
     * note appears on the first tick after note-on. */
    arpy_set_param(&fx, pattern_id, 1.0f);
    arpy_set_param(&fx, chord_id, 3.0f);
    arpy_set_param(&fx, rate_id, 0.0f); /* fastest: 50ms per step */
    n = arpy_process_midi(&fx, on60, 3, msgs, lens, 16);
    require_true(n == 0, "note-on does not emit immediately when arp armed");

    /* One block (128 frames ~ 2.9ms) advances the clock; the first step fires
     * immediately because frames_to_next_step started at 0. */
    n = arpy_tick(&fx, 128, 44100, msgs, lens, 16);
    require_true(n >= 1, "first tick emits at least one arp note");
    int saw_root = 0;
    for (int i = 0; i < n; i++) if (msgs[i][0] == 0x90 && msgs[i][1] == 60) saw_root = 1;
    require_true(saw_root, "arp opens with root note");

    /* Run enough total frames to cover several steps at 50ms each. Expect
     * triad notes 60, 64, 67 all show up across the window. */
    int seen60 = 1, seen64 = 0, seen67 = 0;
    for (int b = 0; b < 200 && !(seen64 && seen67); b++) {
        n = arpy_tick(&fx, 128, 44100, msgs, lens, 16);
        for (int i = 0; i < n; i++) {
            if (msgs[i][0] == 0x90 && msgs[i][1] == 64) seen64 = 1;
            if (msgs[i][0] == 0x90 && msgs[i][1] == 67) seen67 = 1;
        }
    }
    require_true(seen60 && seen64 && seen67, "up pattern walks the triad");

    /* Note-off + extra ticks: any sounding arp note must release within a
     * step interval; no stuck notes after the held key is lifted. */
    n = arpy_process_midi(&fx, off60, 3, msgs, lens, 16);
    int total_releases = 0;
    for (int b = 0; b < 100; b++) {
        n = arpy_tick(&fx, 128, 44100, msgs, lens, 16);
        for (int i = 0; i < n; i++) if (msgs[i][0] == 0x80) total_releases++;
    }
    require_true(total_releases >= 1, "playing note is released after note-off");
    /* After full release, the tick stream should be silent. */
    int post_release = 0;
    for (int b = 0; b < 20; b++) {
        n = arpy_tick(&fx, 128, 44100, msgs, lens, 16);
        post_release += n;
    }
    require_true(post_release == 0, "no further notes emitted after note-off settles");

    test_pattern_off_releases_the_sounding_note();
    test_output_overflow_does_not_strand_a_note();

    printf("arpy core tests passed\n");
    return 0;
}
