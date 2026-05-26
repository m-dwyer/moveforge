#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "arpy_core.h"

static void require_true(int condition, const char *message) {
    if (!condition) { fprintf(stderr, "FAIL: %s\n", message); exit(1); }
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

    printf("arpy core tests passed\n");
    return 0;
}
