/*
 * Offline midi_fx trace harness.
 *
 * Loads a midi_fx module via move_midi_fx_init, runs a deterministic MIDI
 * sequence interleaved with tick() calls, and prints a stable text trace
 * of every event in + every event out. Used as golden-file source for
 * regression testing midi_fx modules without a device.
 *
 * Usage:
 *   trace_midi_fx_<id> <out.trace> [--blocks N] [--notes 60,64,67]
 *                       [--velocity V] [--gate-blocks G] [--note-blocks NB]
 *                       [--key=value ...]
 *
 * Defaults: 40 blocks, notes 60,64,67, vel 100, 8 blocks between notes,
 * 4 blocks gate.
 *
 * Trace line format (stable, sortable):
 *   <block_idx> <event> <hex bytes>
 * where event ∈ {in, out, tick-out}.
 *
 * Block 0 is the first audio block (frames 0..127 at 44.1 kHz).
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/midi_fx_api_v1.h"

extern midi_fx_api_v1_t* move_midi_fx_init(const host_api_v1_t *host);

#define SR 44100
#define BLOCK 128
#define MAX_OUT 8
#define MAX_NOTES 64

static void write_hex(FILE *f, const uint8_t *bytes, int len) {
    for (int i = 0; i < len; i++) {
        if (i > 0) fputc(' ', f);
        fprintf(f, "%02X", bytes[i]);
    }
}

static int parse_notes(const char *csv, int *notes, int max_notes) {
    int count = 0;
    const char *p = csv;
    while (p && *p && count < max_notes) {
        notes[count++] = atoi(p);
        p = strchr(p, ',');
        if (p) p++;
    }
    return count;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <out.trace> [--blocks N] [--notes 60,64,67] [--velocity V] [--gate-blocks G] [--note-blocks NB] [--key=value ...]\n", argv[0]);
        return 2;
    }
    const char *out_path = argv[1];
    int total_blocks = 40;
    int notes[MAX_NOTES];
    int note_count = parse_notes("60,64,67", notes, MAX_NOTES);
    int velocity = 100;
    int gate_blocks = 4;
    int note_blocks = 8;

    typedef struct { const char *key; const char *value; } pair_t;
    pair_t params[32];
    int param_count = 0;

    for (int i = 2; i < argc; i++) {
        if (strcmp(argv[i], "--blocks") == 0 && i + 1 < argc) { total_blocks = atoi(argv[++i]); continue; }
        if (strcmp(argv[i], "--notes") == 0 && i + 1 < argc) { note_count = parse_notes(argv[++i], notes, MAX_NOTES); continue; }
        if (strcmp(argv[i], "--velocity") == 0 && i + 1 < argc) { velocity = atoi(argv[++i]); continue; }
        if (strcmp(argv[i], "--gate-blocks") == 0 && i + 1 < argc) { gate_blocks = atoi(argv[++i]); continue; }
        if (strcmp(argv[i], "--note-blocks") == 0 && i + 1 < argc) { note_blocks = atoi(argv[++i]); continue; }
        char *eq = strchr(argv[i], '=');
        if (eq && param_count < 32) {
            *eq = '\0';
            params[param_count].key = argv[i];
            params[param_count].value = eq + 1;
            param_count++;
        }
    }

    host_api_v1_t host = {0};
    host.api_version = MOVE_PLUGIN_API_VERSION;
    host.sample_rate = SR;
    host.frames_per_block = BLOCK;

    midi_fx_api_v1_t *api = move_midi_fx_init(&host);
    if (!api) { fprintf(stderr, "init failed\n"); return 1; }

    void *inst = api->create_instance(".", NULL);
    if (!inst) { fprintf(stderr, "create_instance failed\n"); return 1; }

    for (int i = 0; i < param_count; i++) {
        api->set_param(inst, params[i].key, params[i].value);
    }

    FILE *f = fopen(out_path, "w");
    if (!f) { perror(out_path); return 1; }

    /* Stable header so traces are self-documenting. */
    fprintf(f, "# midi_fx trace\n");
    fprintf(f, "# blocks=%d notes=", total_blocks);
    for (int i = 0; i < note_count; i++) fprintf(f, "%s%d", i > 0 ? "," : "", notes[i]);
    fprintf(f, " velocity=%d note_blocks=%d gate_blocks=%d\n", velocity, note_blocks, gate_blocks);
    for (int i = 0; i < param_count; i++) fprintf(f, "# param %s=%s\n", params[i].key, params[i].value);
    fprintf(f, "# block event bytes\n");

    uint8_t out_msgs[MAX_OUT][3];
    int out_lens[MAX_OUT];

    for (int block = 0; block < total_blocks; block++) {
        /* Schedule note-on / note-off based on block index. */
        if (block % note_blocks == 0) {
            int step = (block / note_blocks) % note_count;
            if (step > 0) {
                /* Note off the previous note first. */
                uint8_t prev_off[3] = { 0x80, (uint8_t)notes[step - 1], 0 };
                fprintf(f, "%d in ", block); write_hex(f, prev_off, 3); fputc('\n', f);
                int n = api->process_midi(inst, prev_off, 3, out_msgs, out_lens, MAX_OUT);
                for (int i = 0; i < n; i++) {
                    fprintf(f, "%d out ", block); write_hex(f, out_msgs[i], out_lens[i]); fputc('\n', f);
                }
            }
            uint8_t on[3] = { 0x90, (uint8_t)notes[step], (uint8_t)velocity };
            fprintf(f, "%d in ", block); write_hex(f, on, 3); fputc('\n', f);
            int n = api->process_midi(inst, on, 3, out_msgs, out_lens, MAX_OUT);
            for (int i = 0; i < n; i++) {
                fprintf(f, "%d out ", block); write_hex(f, out_msgs[i], out_lens[i]); fputc('\n', f);
            }
        }
        if (block % note_blocks == gate_blocks) {
            int step = (block / note_blocks) % note_count;
            uint8_t off[3] = { 0x80, (uint8_t)notes[step], 0 };
            fprintf(f, "%d in ", block); write_hex(f, off, 3); fputc('\n', f);
            int n = api->process_midi(inst, off, 3, out_msgs, out_lens, MAX_OUT);
            for (int i = 0; i < n; i++) {
                fprintf(f, "%d out ", block); write_hex(f, out_msgs[i], out_lens[i]); fputc('\n', f);
            }
        }

        int n = api->tick(inst, BLOCK, SR, out_msgs, out_lens, MAX_OUT);
        for (int i = 0; i < n; i++) {
            fprintf(f, "%d tick-out ", block); write_hex(f, out_msgs[i], out_lens[i]); fputc('\n', f);
        }
    }

    api->destroy_instance(inst);
    fclose(f);
    fprintf(stderr, "Wrote %s (%d blocks)\n", out_path, total_blocks);
    return 0;
}
