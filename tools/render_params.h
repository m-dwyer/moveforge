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
 */

#ifndef MOVEFORGE_RENDER_PARAMS_H
#define MOVEFORGE_RENDER_PARAMS_H

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

#endif
