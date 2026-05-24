#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "host/plugin_api_v1.h"

extern plugin_api_v2_t* move_plugin_init_v2(const host_api_v1_t *host);

typedef struct {
    const char *key;
    const char *value;
} param_t;

typedef struct {
    const char *name;
    const param_t *params;
    int param_count;
    const int *notes;
    int note_count;
    int note_blocks;
    int gate_blocks;
    int seconds;
    int velocity;
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

    for (uint32_t frame = 0; frame < total_frames; frame += 128) {
        uint32_t block_index = frame / 128;
        if (block_index % (uint32_t)rc->note_blocks == 0) {
            int step = (block_index / (uint32_t)rc->note_blocks) % rc->note_count;
            if (step > 0) send_midi(api, inst, 0x80, (uint8_t)rc->notes[step - 1], 0);
            send_midi(api, inst, 0x90, (uint8_t)rc->notes[step], (uint8_t)rc->velocity);
        }
        if (block_index % (uint32_t)rc->note_blocks == (uint32_t)rc->gate_blocks) {
            int step = (block_index / (uint32_t)rc->note_blocks) % rc->note_count;
            send_midi(api, inst, 0x80, (uint8_t)rc->notes[step], 0);
        }
        api->render_block(inst, block, 128);
        fwrite(block, sizeof(int16_t), 128 * 2, f);
    }

    api->destroy_instance(inst);
    fclose(f);
    fprintf(stderr, "Wrote %s\n", out_path);
    return 0;
}

static const int seq_demo[] = { 48, 55, 60, 62, 67, 72, 67, 62 };
static const param_t p_demo[] = {
    {"volume", "0.82"}, {"ratio", "1.997"}, {"fm", "0.23"}, {"fold", "0.52"},
    {"lpg", "0.68"}, {"decay", "0.38"}, {"release", "1.2"}
};

#define ARRAY_LEN(a) ((int)(sizeof(a) / sizeof((a)[0])))

int main(int argc, char **argv) {
    host_api_v1_t host;
    plugin_api_v2_t *api = create_api(&host);

    if (argc > 8 && strcmp(argv[1], "--render") == 0) {
        int notes[64];
        param_t params[32];
        int param_count = 0;
        int note_count = parse_notes(argv[7], notes, 64);
        for (int i = 8; i < argc && param_count < 32; i++) {
            char *eq = strchr(argv[i], '=');
            if (!eq) continue;
            *eq = '\0';
            params[param_count].key = argv[i];
            params[param_count].value = eq + 1;
            param_count++;
        }
        const render_case_t rc = {
            "custom",
            params,
            param_count,
            notes,
            note_count,
            atoi(argv[4]),
            atoi(argv[5]),
            atoi(argv[3]),
            atoi(argv[6])
        };
        return render_case(api, &rc, argv[2]);
    }

    const char *out_path = argc > 1 ? argv[1] : "westfold-demo.wav";
    const render_case_t demo = {
        "demo", p_demo, ARRAY_LEN(p_demo), seq_demo, ARRAY_LEN(seq_demo), 86, 64, 8, 102
    };
    return render_case(api, &demo, out_path);
}
