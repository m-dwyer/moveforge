/*
 * `key=value` collection for the offline render harnesses.
 *
 * All three harnesses used to declare `params[32]` and stop appending at the
 * 32nd, with no warning and no non-zero exit. Both drivers pass *every*
 * parameter on every invocation — `scripts/render-suite.ts` spreads the whole
 * preset param map into argv, `scripts/render-stress.ts` the whole default map —
 * so on a module with more than 32 parameters, everything past the 32nd sat at
 * its `apply_defaults` value in every golden render and every stress render, and
 * `check-renders` would bless the result as correct.
 *
 * That is the worst failure shape available to a test harness: it reports success
 * while measuring something other than the thing under test. So the cap now
 * matches the host's own, and overflow is fatal rather than a truncation.
 *
 * The same shape has since cost a week twice more, so two further silent
 * failures are fatal here as well: a token carrying whitespace, and a key the
 * module does not have. See mf_param_add and mf_param_check_keys.
 */

#ifndef MOVEFORGE_RENDER_PARAMS_H
#define MOVEFORGE_RENDER_PARAMS_H

#include <ctype.h>
#include <stdio.h>
#include <string.h>

/* The Schwung chain host's limit: MAX_CHAIN_PARAMS 256 (schwung 0.11.4,
 * src/modules/chain/dsp/chain_internal.h:101), mirrored by HOST_MAX_PARAMS in
 * scripts/validate-params.ts. A module past it fails `validate` long before it
 * reaches a render, so a harness that accepts 256 can never be the tighter
 * constraint. */
#define MF_RENDER_MAX_PARAMS 256

typedef struct {
    const char *key;
    const char *value;
} mf_param_t;

typedef struct {
    mf_param_t items[MF_RENDER_MAX_PARAMS];
    int count;
} mf_param_list_t;

/* Consume one argv token of the form `key=value`.
 *
 * Splits `arg` in place, as the harnesses always have: `key` and `value` point
 * into argv and stay valid for the life of the process. A token with no '=' is
 * not a parameter assignment, so it is left alone rather than rejected — the
 * callers hand every unrecognised token here after their own flag handling.
 *
 * Returns 0 when the token was stored or was not a parameter, -1 on a reported
 * error. */
static inline int mf_param_add(mf_param_list_t *list, char *arg)
{
    if (!list || !arg) return -1;

    char *eq = strchr(arg, '=');
    if (!eq) return 0;
    if (eq == arg) {
        fprintf(stderr, "param: empty key in '%s'\n", arg);
        return -1;
    }
    /* No parameter key or value contains whitespace, so a token that does is a
     * whole argument list collapsed into one — which zsh does to an unquoted
     * `$PARAMS`. atof() then reads the first number and every later assignment
     * is silently dropped, leaving those parameters at their defaults while the
     * render reports success. That produced a week of evidence for a filter
     * envelope bug that did not exist: env_amount stayed at 0, so the cutoff
     * never swept and renders at every sweep rate came out identical. */
    for (const char *c = arg; *c; c++) {
        if (isspace((unsigned char)*c)) {
            fprintf(stderr,
                    "param: whitespace in '%s' — this is one argv token, not several. "
                    "Pass each key=value as its own argument (in zsh an unquoted "
                    "variable does not word-split; use \"${=VAR}\" or an array).\n",
                    arg);
            return -1;
        }
    }
    if (list->count >= MF_RENDER_MAX_PARAMS) {
        fprintf(stderr,
                "param: more than %d parameters — refusing to render. Dropping the "
                "rest would leave them at their defaults and report success.\n",
                MF_RENDER_MAX_PARAMS);
        return -1;
    }

    *eq = '\0';
    list->items[list->count].key = arg;
    list->items[list->count].value = eq + 1;
    list->count++;
    return 0;
}

/* Keys a harness may set that get_param is right to reject.
 *
 * A module's set_param treats these as commands rather than as stored values,
 * so there is nothing to read back and their absence is not a typo. */
static const char *const MF_PARAM_WRITE_ONLY[] = { "all_notes_off", NULL };

/* Every audio_fx, sound_generator and midi_fx API declares get_param with this
 * signature, so one pre-flight serves all three harnesses. */
typedef int (*mf_get_param_fn)(void *instance, const char *key, char *buf, int buf_len);

/* Refuse to render when a key is not one the module has.
 *
 * set_param is deliberately lenient — the chain host re-sends keys a module
 * never declared — so a misspelt parameter is a silent no-op, and the render
 * measures the module's defaults while exiting 0. A driver passing every
 * declared parameter cannot notice, which is exactly when it matters.
 *
 * Takes the items and count rather than the list, because render_wav.c carries
 * them apart in its render_case_t.
 *
 * Returns 0 when every key resolved, -1 on a reported error. */
static inline int mf_param_check_keys(const mf_param_t *items, int count, void *inst,
                                      mf_get_param_fn get_param)
{
    char buf[256];
    int bad = 0;

    if (count <= 0) return 0;
    if (!items || !inst || !get_param) return -1;

    for (int i = 0; i < count; i++) {
        const char *key = items[i].key;
        int exempt = 0;
        for (int w = 0; MF_PARAM_WRITE_ONLY[w]; w++) {
            if (strcmp(key, MF_PARAM_WRITE_ONLY[w]) == 0) { exempt = 1; break; }
        }
        if (exempt) continue;
        if (get_param(inst, key, buf, (int)sizeof(buf)) < 0) {
            fprintf(stderr, "param: no such key '%s' — setting it would do nothing "
                            "and the render would still report success\n", key);
            bad = 1;
        }
    }
    return bad ? -1 : 0;
}

#endif
