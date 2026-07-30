#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"
#include "render_automation.h"
#include "render_params.h"
#include "render_pattern.h"
#include "render_timing.h"

extern plugin_api_v2_t* move_plugin_init_v2(const host_api_v1_t *host);

#ifdef MOVEFORGE_COUNT_NONFINITE
/* Incremented by moveforge_float_to_i16 (modules/_shared/dsp_runtime.h) when a
 * module emits a non-finite sample. Checked after the render loop — without it,
 * a NaN blowup is indistinguishable from a quiet patch in the WAV. */
unsigned long moveforge_nonfinite_count = 0;
#endif

typedef struct {
    const char *name;
    const mf_param_t *params;
    int param_count;
    const mf_pattern_t *pattern;
    int note_blocks;
    int gate_blocks;
    int seconds;
    int tail_seconds;
    const mf_automate_set_t *automation;
} render_case_t;

static void write_u16(FILE *f, uint16_t v) {
    fputc(v & 255, f);
    fputc((v >> 8) & 255, f);
}

static void write_u32(FILE *f, uint32_t v) {
    fputc(v & 255, f);
    fputc((v >> 8) & 255, f);
    fputc((v >> 16) & 255, f);
    fputc((v >> 24) & 255, f);
}

static void write_wav_header(FILE *f, uint32_t frames) {
    uint32_t data_bytes = frames * 2u * sizeof(int16_t);
    fwrite("RIFF", 1, 4, f);
    write_u32(f, 36 + data_bytes);
    fwrite("WAVEfmt ", 1, 8, f);
    write_u32(f, 16);
    write_u16(f, 1);
    write_u16(f, 2);
    write_u32(f, 44100);
    write_u32(f, 44100 * 2 * 2);
    write_u16(f, 4);
    write_u16(f, 16);
    fwrite("data", 1, 4, f);
    write_u32(f, data_bytes);
}

static void log_msg(const char *msg) {
    fprintf(stderr, "%s\n", msg);
}

static void send_midi(plugin_api_v2_t *api, void *inst, uint8_t st, uint8_t d1, uint8_t d2) {
    uint8_t msg[3] = { st, d1, d2 };
    api->on_midi(inst, msg, 3, MOVE_MIDI_SOURCE_HOST);
}

static plugin_api_v2_t *create_api(host_api_v1_t *host) {
    memset(host, 0, sizeof(*host));
    host->api_version = MOVE_PLUGIN_API_VERSION;
    host->sample_rate = 44100;
    host->frames_per_block = 128;
    host->log = log_msg;
    return move_plugin_init_v2(host);
}

static int render_case(plugin_api_v2_t *api, const render_case_t *rc, const char *out_path) {
    FILE *f = fopen(out_path, "wb");
    if (!f) {
        perror(out_path);
        return 1;
    }

    void *inst = api->create_instance(".", NULL);
    if (!inst) return 1;

    for (int i = 0; i < rc->param_count; i++) {
        api->set_param(inst, rc->params[i].key, rc->params[i].value);
    }

    const uint32_t total_frames = 44100u * (uint32_t)rc->seconds;
    write_wav_header(f, total_frames);

    int16_t block[128 * 2];
    mf_timing_t timing;
    mf_timing_init(&timing, (int)(total_frames / 128) + 1);

    /* Stop issuing note-ons before the end so the last hit's tail is actually
     * captured. Without this the recorded tail is whatever `total_blocks mod
     * note_blocks` happens to be — it can never exceed one note interval no
     * matter how long `seconds` is, so a preset with a 2 s decay renders with
     * its tail chopped at -10 dB regardless. */
    uint32_t tail_blocks = (uint32_t)rc->tail_seconds * 44100u / 128u;
    uint32_t total_blocks = total_frames / 128;
    uint32_t last_trigger_block = (tail_blocks < total_blocks)
                                ? total_blocks - tail_blocks : total_blocks;

    const mf_pattern_t *pattern = rc->pattern;

    for (uint32_t frame = 0; frame < total_frames; frame += 128) {
        uint32_t block_index = frame / 128;
        if (block_index < last_trigger_block
            && block_index % (uint32_t)rc->note_blocks == 0) {
            int step = (int)((block_index / (uint32_t)rc->note_blocks)
                             % (uint32_t)pattern->count);
            /* Release the previous step before firing this one — and, as the
             * monophonic version did, leave step 0's wrap-around predecessor
             * held so it decays into the loop point rather than being cut. */
            if (step > 0) {
                const mf_pattern_step_t *prev = &pattern->steps[step - 1];
                for (int n = 0; n < prev->count; n++) {
                    send_midi(api, inst, 0x80, (uint8_t)prev->notes[n].note, 0);
                }
            }
            const mf_pattern_step_t *cur = &pattern->steps[step];
            for (int n = 0; n < cur->count; n++) {
                send_midi(api, inst, 0x90, (uint8_t)cur->notes[n].note,
                          (uint8_t)cur->notes[n].velocity);
            }
        }
        if (block_index % (uint32_t)rc->note_blocks == (uint32_t)rc->gate_blocks) {
            int step = (int)((block_index / (uint32_t)rc->note_blocks)
                             % (uint32_t)pattern->count);
            const mf_pattern_step_t *cur = &pattern->steps[step];
            for (int n = 0; n < cur->count; n++) {
                send_midi(api, inst, 0x80, (uint8_t)cur->notes[n].note, 0);
            }
        }
        /* Block-rate automation, matching how the host delivers parameters. */
        if (rc->automation && rc->automation->count > 0) {
            mf_automate_apply(rc->automation, (double)frame / (double)total_frames,
                              inst, api->set_param);
        }
        mf_timing_begin(&timing);
        api->render_block(inst, block, 128);
        mf_timing_end(&timing);
        fwrite(block, sizeof(int16_t), 128 * 2, f);
    }

    api->destroy_instance(inst);
    fclose(f);

    int timing_failed = mf_timing_report(&timing, out_path, 128, 44100);
    mf_timing_free(&timing);
    if (timing_failed) return 1;

#ifdef MOVEFORGE_COUNT_NONFINITE
    if (moveforge_nonfinite_count > 0) {
        fprintf(stderr,
                "ERROR: %s emitted %lu non-finite sample(s) — these become silence in the WAV, "
                "so the render would otherwise look merely quiet\n",
                out_path, moveforge_nonfinite_count);
        return 1;
    }
#endif

    fprintf(stderr, "Wrote %s\n", out_path);
    return 0;
}

static const char seq_demo[] = "48,55,60,62,67,72,67,62";
static const mf_param_t p_demo[] = {
    {"volume", "0.82"}, {"ratio", "1.997"}, {"fm", "0.23"}, {"fold", "0.52"},
    {"lpg", "0.68"}, {"decay", "0.38"}, {"release", "1.2"}
};

#define ARRAY_LEN(a) ((int)(sizeof(a) / sizeof((a)[0])))

int main(int argc, char **argv) {
    host_api_v1_t host;
    plugin_api_v2_t *api = create_api(&host);

    /* --render <out.wav> <seconds> <note_blocks> <gate_blocks> <velocity> <pattern>
     *          [key=value ...] [--automate <spec>] [--tail-seconds N]
     *
     * <velocity> is the default for pattern notes that do not carry their own;
     * see render_pattern.h for the pattern grammar. Guarded at `argc > 7`, not
     * `> 8`: requiring a trailing token meant a paramless --render fell through
     * to the demo path and wrote a file called "--render". */
    if (argc > 7 && strcmp(argv[1], "--render") == 0) {
        mf_pattern_t pattern;
        mf_param_list_t params = {0};
        mf_automate_set_t automation = {0};
        int tail_seconds = 0;
        int seconds = atoi(argv[3]);
        int note_blocks = atoi(argv[4]);

        if (mf_pattern_parse(&pattern, argv[7], atoi(argv[6])) != 0) return 2;
        /* note_blocks is a modulus in the render loop, so zero is a crash rather
         * than a degenerate render. */
        if (seconds < 1 || note_blocks < 1) {
            fprintf(stderr, "render: seconds (%d) and note_blocks (%d) must both be >= 1\n",
                    seconds, note_blocks);
            return 2;
        }

        for (int i = 8; i < argc; i++) {
            if (strcmp(argv[i], "--automate") == 0 && i + 1 < argc) {
                if (mf_automate_add(&automation, argv[++i]) != 0) return 2;
                continue;
            }
            if (strcmp(argv[i], "--tail-seconds") == 0 && i + 1 < argc) {
                tail_seconds = atoi(argv[++i]);
                continue;
            }
            if (mf_param_add(&params, argv[i]) != 0) return 2;
        }

        const render_case_t rc = {
            .name = "custom",
            .params = params.items,
            .param_count = params.count,
            .pattern = &pattern,
            .note_blocks = note_blocks,
            .gate_blocks = atoi(argv[5]),
            .seconds = seconds,
            .tail_seconds = tail_seconds,
            .automation = &automation
        };
        return render_case(api, &rc, argv[2]);
    }

    if (argc > 1 && strcmp(argv[1], "--render") == 0) {
        fprintf(stderr, "usage: %s --render <out.wav> <seconds> <note_blocks> <gate_blocks> "
                        "<velocity> <pattern> [key=value ...] [--automate <spec>] "
                        "[--tail-seconds N]\n", argv[0]);
        return 2;
    }

    const char *out_path = argc > 1 ? argv[1] : "westfold-demo.wav";
    mf_pattern_t demo_pattern;
    if (mf_pattern_parse(&demo_pattern, seq_demo, 102) != 0) return 2;
    const render_case_t demo = {
        .name = "demo",
        .params = p_demo,
        .param_count = ARRAY_LEN(p_demo),
        .pattern = &demo_pattern,
        .note_blocks = 86,
        .gate_blocks = 64,
        .seconds = 8,
        .tail_seconds = 0,
        .automation = NULL
    };
    return render_case(api, &demo, out_path);
}
