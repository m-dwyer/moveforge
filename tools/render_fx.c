/*
 * Offline audio_fx render harness.
 *
 * Generates a deterministic test signal, streams it through an audio_fx
 * module's process_block in 128-frame blocks, and writes the processed
 * audio out as a WAV. Optionally accepts an input WAV instead of the
 * generated signal.
 *
 * Usage:
 *   render_fx_<id> <out.wav> [--input <in.wav>] [--signal sweep|noise|impulse|silence]
 *                  [--seconds N] [--key=value ...]
 *
 * Defaults: 4 seconds of a 50Hz -> 8kHz exponential sine sweep at -3dBFS.
 */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "host/audio_fx_api_v2.h"

extern audio_fx_api_v2_t* move_audio_fx_init_v2(const host_api_v1_t *host);

#define SR 44100
#define BLOCK 128

static void write_u16(FILE *f, uint16_t v) { fputc(v & 255, f); fputc((v >> 8) & 255, f); }
static void write_u32(FILE *f, uint32_t v) {
    fputc(v & 255, f); fputc((v >> 8) & 255, f);
    fputc((v >> 16) & 255, f); fputc((v >> 24) & 255, f);
}

static void write_wav_header(FILE *f, uint32_t frames) {
    uint32_t data_bytes = frames * 2u * sizeof(int16_t);
    fwrite("RIFF", 1, 4, f);
    write_u32(f, 36 + data_bytes);
    fwrite("WAVEfmt ", 1, 8, f);
    write_u32(f, 16);
    write_u16(f, 1);
    write_u16(f, 2);
    write_u32(f, SR);
    write_u32(f, SR * 2 * 2);
    write_u16(f, 4);
    write_u16(f, 16);
    fwrite("data", 1, 4, f);
    write_u32(f, data_bytes);
}

static int read_wav_stereo(const char *path, int16_t **out_samples, uint32_t *out_frames) {
    FILE *f = fopen(path, "rb");
    if (!f) { perror(path); return -1; }
    uint8_t header[44];
    if (fread(header, 1, 44, f) != 44) { fclose(f); fprintf(stderr, "%s: short read\n", path); return -1; }
    if (memcmp(header, "RIFF", 4) != 0 || memcmp(header + 8, "WAVE", 4) != 0) {
        fclose(f); fprintf(stderr, "%s: not a RIFF/WAVE file\n", path); return -1;
    }
    int channels = header[22] | (header[23] << 8);
    int bits = header[34] | (header[35] << 8);
    if (channels != 2 || bits != 16) {
        fclose(f); fprintf(stderr, "%s: need 16-bit stereo (got %dch %dbit)\n", path, channels, bits); return -1;
    }
    uint32_t data_bytes = header[40] | (header[41] << 8) | (header[42] << 16) | (header[43] << 24);
    uint32_t frames = data_bytes / 4;
    int16_t *buf = (int16_t*)malloc((size_t)frames * 2 * sizeof(int16_t));
    if (!buf) { fclose(f); return -1; }
    if (fread(buf, sizeof(int16_t), (size_t)frames * 2, f) != (size_t)frames * 2) {
        free(buf); fclose(f); fprintf(stderr, "%s: short data read\n", path); return -1;
    }
    fclose(f);
    *out_samples = buf;
    *out_frames = frames;
    return 0;
}

static void generate_signal(const char *kind, int16_t *buf, uint32_t frames) {
    if (strcmp(kind, "silence") == 0) {
        memset(buf, 0, (size_t)frames * 2 * sizeof(int16_t));
        return;
    }
    if (strcmp(kind, "impulse") == 0) {
        memset(buf, 0, (size_t)frames * 2 * sizeof(int16_t));
        for (uint32_t i = 0; i < 8 && i < frames; i++) {
            buf[i * 2] = 23000;
            buf[i * 2 + 1] = 23000;
        }
        return;
    }
    if (strcmp(kind, "noise") == 0) {
        uint32_t s = 0x12345678u;
        for (uint32_t i = 0; i < frames; i++) {
            s = s * 1664525u + 1013904223u;
            int16_t v = (int16_t)((int32_t)(s >> 16) * 0.7);
            buf[i * 2] = v;
            buf[i * 2 + 1] = v;
        }
        return;
    }
    /* sweep: exponential 50Hz -> 8kHz over the buffer, -3dBFS sine */
    double duration = (double)frames / (double)SR;
    double f0 = 50.0, f1 = 8000.0;
    double K = (f1 - f0) / log(f1 / f0);
    double phase = 0.0;
    for (uint32_t i = 0; i < frames; i++) {
        double t = (double)i / (double)SR;
        double f = f0 * pow(f1 / f0, t / duration);
        phase += 2.0 * M_PI * f / (double)SR;
        if (phase > 2.0 * M_PI) phase -= 2.0 * M_PI;
        int16_t v = (int16_t)(sin(phase) * 23000.0);
        buf[i * 2] = v;
        buf[i * 2 + 1] = v;
    }
    (void)K;
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <out.wav> [--input <in.wav>] [--signal sweep|noise|impulse|silence] [--seconds N] [--key=value ...]\n", argv[0]);
        return 2;
    }
    const char *out_path = argv[1];
    const char *input_path = NULL;
    const char *signal_kind = "sweep";
    int seconds = 4;

    typedef struct { const char *key; const char *value; } pair_t;
    pair_t params[32];
    int param_count = 0;

    for (int i = 2; i < argc; i++) {
        if (strcmp(argv[i], "--input") == 0 && i + 1 < argc) { input_path = argv[++i]; continue; }
        if (strcmp(argv[i], "--signal") == 0 && i + 1 < argc) { signal_kind = argv[++i]; continue; }
        if (strcmp(argv[i], "--seconds") == 0 && i + 1 < argc) { seconds = atoi(argv[++i]); continue; }
        char *eq = strchr(argv[i], '=');
        if (eq && param_count < 32) {
            *eq = '\0';
            params[param_count].key = argv[i];
            params[param_count].value = eq + 1;
            param_count++;
        }
    }

    int16_t *input = NULL;
    uint32_t total_frames = (uint32_t)(SR * seconds);

    if (input_path) {
        if (read_wav_stereo(input_path, &input, &total_frames) != 0) return 1;
    } else {
        input = (int16_t*)malloc((size_t)total_frames * 2 * sizeof(int16_t));
        if (!input) return 1;
        generate_signal(signal_kind, input, total_frames);
    }

    host_api_v1_t host = {0};
    host.api_version = MOVE_PLUGIN_API_VERSION;
    host.sample_rate = SR;
    host.frames_per_block = BLOCK;
    audio_fx_api_v2_t *api = move_audio_fx_init_v2(&host);
    if (!api) { fprintf(stderr, "init failed\n"); free(input); return 1; }

    void *inst = api->create_instance(".", NULL);
    if (!inst) { fprintf(stderr, "create_instance failed\n"); free(input); return 1; }

    for (int i = 0; i < param_count; i++) {
        api->set_param(inst, params[i].key, params[i].value);
    }

    FILE *f = fopen(out_path, "wb");
    if (!f) { perror(out_path); free(input); return 1; }
    write_wav_header(f, total_frames);

    int16_t block_buf[BLOCK * 2];
    for (uint32_t frame = 0; frame < total_frames; frame += BLOCK) {
        uint32_t this_block = total_frames - frame;
        if (this_block > BLOCK) this_block = BLOCK;
        memcpy(block_buf, input + (size_t)frame * 2, (size_t)this_block * 2 * sizeof(int16_t));
        if (this_block < BLOCK) {
            memset(block_buf + this_block * 2, 0, (size_t)(BLOCK - this_block) * 2 * sizeof(int16_t));
        }
        api->process_block(inst, block_buf, (int)this_block);
        fwrite(block_buf, sizeof(int16_t), (size_t)this_block * 2, f);
    }

    api->destroy_instance(inst);
    fclose(f);
    free(input);
    fprintf(stderr, "Wrote %s (%d s, %s)\n", out_path, seconds, input_path ? input_path : signal_kind);
    return 0;
}
