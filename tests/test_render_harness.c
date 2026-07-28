/* Tests for the offline render harnesses' argument handling —
 * tools/render_params.h and tools/render_pattern.h.
 *
 * These are not DSP, but both of the things they cover were silent-wrong-answer
 * bugs in the tooling: a parameter list that truncated at 32 with no error, and a
 * note spec that could only ever fire one note per step. A harness that reports
 * success while measuring something else is worse than one that crashes, so the
 * assertions here are mostly about *refusing* malformed input rather than about
 * parsing valid input.
 *
 * Mutation-test these: break the cap check or the '+' handling and confirm the
 * relevant case goes red. */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../tools/render_params.h"
#include "../tools/render_pattern.h"

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static void require_note(const mf_pattern_note_t *n, int note, int velocity, const char *message) {
    if (n->note != note || n->velocity != velocity) {
        fprintf(stderr, "FAIL: %s (got note %d vel %d, wanted note %d vel %d)\n",
                message, n->note, n->velocity, note, velocity);
        exit(1);
    }
}

/* The legacy form: a flat CSV is one note per step at the scalar velocity. Every
 * presets.json in the repo is spelled this way, so this case is what keeps the
 * blessed goldens meaningful. */
static void test_pattern_csv_is_one_note_per_step(void) {
    mf_pattern_t p;
    require_true(mf_pattern_parse(&p, "36,43,48", 100) == 0, "plain CSV parses");
    require_true(p.count == 3, "CSV gives one step per note");
    for (int i = 0; i < 3; i++) {
        require_true(p.steps[i].count == 1, "each CSV step holds exactly one note");
    }
    require_note(&p.steps[0].notes[0], 36, 100, "CSV note 1 takes the default velocity");
    require_note(&p.steps[1].notes[0], 43, 100, "CSV note 2 takes the default velocity");
    require_note(&p.steps[2].notes[0], 48, 100, "CSV note 3 takes the default velocity");

    /* Repeated notes are repeated steps, not a chord — ballast's presets rely on
     * this ("notes": [36, 36, 36, 36]). */
    require_true(mf_pattern_parse(&p, "36,36", 90) == 0, "a repeated note parses");
    require_true(p.count == 2 && p.steps[0].count == 1 && p.steps[1].count == 1,
                 "a repeated note is two steps, not one two-note step");
}

static void test_pattern_polyphonic_steps(void) {
    mf_pattern_t p;
    require_true(mf_pattern_parse(&p, "36:110+39:96+42,36:64", 100) == 0,
                 "polyphonic pattern parses");
    require_true(p.count == 2, "two steps");
    require_true(p.steps[0].count == 3, "first step fires three notes together");
    require_note(&p.steps[0].notes[0], 36, 110, "per-note velocity is kept");
    require_note(&p.steps[0].notes[1], 39, 96, "per-note velocity is per note");
    require_note(&p.steps[0].notes[2], 42, 100, "a note with no ':' falls back to the default");
    require_true(p.steps[1].count == 1, "second step fires one note");
    require_note(&p.steps[1].notes[0], 36, 64, "the same note can recur at another velocity");
}

static void test_pattern_rests(void) {
    mf_pattern_t p;
    require_true(mf_pattern_parse(&p, "36,,42", 100) == 0, "a pattern with a rest parses");
    require_true(p.count == 3, "the rest still occupies a step");
    require_true(p.steps[1].count == 0, "the rest holds no notes");
    require_note(&p.steps[2].notes[0], 42, 100, "the step after a rest is unaffected");

    /* A trailing separator is a trailing rest, which is how an off-beat pattern
     * ends without an extra hit. */
    require_true(mf_pattern_parse(&p, "36,", 100) == 0, "a trailing separator parses");
    require_true(p.count == 2 && p.steps[1].count == 0, "a trailing separator is a rest");
}

static void test_pattern_tolerates_spaces_between_steps(void) {
    mf_pattern_t p;
    require_true(mf_pattern_parse(&p, "36, 43", 100) == 0, "spaces after a separator parse");
    require_true(p.count == 2, "spaces do not create steps");
    require_note(&p.steps[1].notes[0], 43, 100, "the note after a space is read");
}

static void test_pattern_fills_to_the_cap(void) {
    char spec[8 * MF_PATTERN_MAX_STEPS];
    mf_pattern_t p;
    int used = 0;

    for (int i = 0; i < MF_PATTERN_MAX_STEPS; i++) {
        used += snprintf(spec + used, sizeof(spec) - (size_t)used, "%s36", i == 0 ? "" : ",");
    }
    require_true(mf_pattern_parse(&p, spec, 100) == 0, "a pattern at the step cap parses");
    require_true(p.count == MF_PATTERN_MAX_STEPS, "every step at the cap is kept");

    used = 0;
    for (int i = 0; i < MF_PATTERN_MAX_NOTES; i++) {
        used += snprintf(spec + used, sizeof(spec) - (size_t)used, "%s%d", i == 0 ? "" : "+", 36 + i);
    }
    require_true(mf_pattern_parse(&p, spec, 100) == 0, "a step at the note cap parses");
    require_true(p.steps[0].count == MF_PATTERN_MAX_NOTES, "every note at the cap is kept");
}

/* Each of these has to be an error rather than a truncation or a clamp. A quietly
 * shortened pattern renders a WAV that looks fine and exercises less than it
 * claims, which is exactly the failure this file exists to prevent. */
static void test_pattern_rejects_malformed_specs(void) {
    char spec[16 * (MF_PATTERN_MAX_STEPS + 4)];
    mf_pattern_t p;
    int used = 0;

    fprintf(stderr, "--- expected parse errors follow ---\n");

    require_true(mf_pattern_parse(&p, "", 100) != 0, "an empty spec is an error, not silence");
    require_true(mf_pattern_parse(&p, ",,", 100) != 0, "an all-rest spec is an error");
    require_true(mf_pattern_parse(&p, "36x9", 100) != 0, "trailing garbage is an error");
    require_true(mf_pattern_parse(&p, "hat", 100) != 0, "a non-numeric note is an error");
    require_true(mf_pattern_parse(&p, "36:", 100) != 0, "a ':' with no velocity is an error");
    require_true(mf_pattern_parse(&p, "128", 100) != 0, "a note above 127 is an error");
    require_true(mf_pattern_parse(&p, "-1", 100) != 0, "a negative note is an error");
    require_true(mf_pattern_parse(&p, "36:0", 100) != 0, "velocity 0 is an error, not a quiet hit");
    require_true(mf_pattern_parse(&p, "36:128", 100) != 0, "velocity above 127 is an error");
    require_true(mf_pattern_parse(&p, "36+36", 100) != 0, "the same note twice in a step is an error");
    require_true(mf_pattern_parse(&p, "36", 0) != 0, "a default velocity of 0 is an error");
    require_true(mf_pattern_parse(&p, "36", 128) != 0, "a default velocity above 127 is an error");

    for (int i = 0; i < MF_PATTERN_MAX_STEPS + 1; i++) {
        used += snprintf(spec + used, sizeof(spec) - (size_t)used, "%s36", i == 0 ? "" : ",");
    }
    require_true(mf_pattern_parse(&p, spec, 100) != 0, "one step past the cap is an error");

    used = 0;
    for (int i = 0; i < MF_PATTERN_MAX_NOTES + 1; i++) {
        used += snprintf(spec + used, sizeof(spec) - (size_t)used, "%s%d", i == 0 ? "" : "+", 36 + i);
    }
    require_true(mf_pattern_parse(&p, spec, 100) != 0, "one note past the cap is an error");

    fprintf(stderr, "--- end expected parse errors ---\n");
}

static void test_param_add_splits_in_place(void) {
    mf_param_list_t list = {0};
    char arg[] = "hat_decay=0.125";

    require_true(mf_param_add(&list, arg) == 0, "a key=value token is accepted");
    require_true(list.count == 1, "the parameter is stored");
    require_true(strcmp(list.items[0].key, "hat_decay") == 0, "the key is the text before '='");
    require_true(strcmp(list.items[0].value, "0.125") == 0, "the value is the text after '='");
    require_true(list.items[0].key == arg, "the key points into argv rather than a copy");

    /* A value may itself contain '=' — only the first one splits. */
    char pair[] = "label=a=b";
    require_true(mf_param_add(&list, pair) == 0, "only the first '=' splits");
    require_true(strcmp(list.items[1].value, "a=b") == 0, "the rest of the value is kept whole");
}

static void test_param_add_ignores_non_parameters(void) {
    mf_param_list_t list = {0};
    char flag[] = "--tail-seconds";

    require_true(mf_param_add(&list, flag) == 0, "a flag is not an error");
    require_true(list.count == 0, "a flag is not stored as a parameter");
}

/* The B1 regression: the harnesses declared params[32] and stopped appending
 * there, while both drivers pass every parameter on every invocation. Anything
 * past the cap has to fail the render, because leaving it at its default and
 * exiting 0 is a golden that measures the wrong module. */
static void test_param_add_fails_rather_than_truncating(void) {
    static char args[MF_RENDER_MAX_PARAMS + 1][16];
    mf_param_list_t list = {0};

    for (int i = 0; i < MF_RENDER_MAX_PARAMS; i++) {
        snprintf(args[i], sizeof(args[i]), "p%d=%d", i, i);
        require_true(mf_param_add(&list, args[i]) == 0, "parameters up to the cap are accepted");
    }
    require_true(list.count == MF_RENDER_MAX_PARAMS, "the whole list is kept");
    require_true(MF_RENDER_MAX_PARAMS >= 64,
                 "the cap has to clear a 64-parameter module by a wide margin");

    fprintf(stderr, "--- expected parse errors follow ---\n");
    snprintf(args[MF_RENDER_MAX_PARAMS], sizeof(args[0]), "over=1");
    require_true(mf_param_add(&list, args[MF_RENDER_MAX_PARAMS]) != 0,
                 "one parameter past the cap fails the render");
    require_true(list.count == MF_RENDER_MAX_PARAMS, "the failing parameter is not stored");

    char empty_key[] = "=1";
    mf_param_list_t fresh = {0};
    require_true(mf_param_add(&fresh, empty_key) != 0, "an empty key is an error");
    fprintf(stderr, "--- end expected parse errors ---\n");
}

int main(void) {
    test_pattern_csv_is_one_note_per_step();
    test_pattern_polyphonic_steps();
    test_pattern_rests();
    test_pattern_tolerates_spaces_between_steps();
    test_pattern_fills_to_the_cap();
    test_pattern_rejects_malformed_specs();
    test_param_add_splits_in_place();
    test_param_add_ignores_non_parameters();
    test_param_add_fails_rather_than_truncating();
    printf("render harness argument tests passed\n");
    return 0;
}
