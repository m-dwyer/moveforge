.PHONY: format format-check gen-compile-commands render suite stress stress-all plot plot-stress plot-stress-all test host move wasm install deploy gen-params gen-presets move-health move-logs move-cache move-restart move-screen check check-all dev-deps clean

render:
	./scripts/render-demo.sh

suite:
	./scripts/render-demo.sh --suite

stress:
	./scripts/render-demo.sh --stress
	pnpm run check-stress

stress-all:
	status=0; for module in $$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('src/modules/index.json','utf8')).modules; console.log(m.filter(x => x.kind !== 'midi_fx').map(x => x.id).join(' '))"); do MODULE_ID=$$module ./scripts/render-demo.sh --stress || status=1; MODULE_ID=$$module pnpm run check-stress || status=1; done; exit $$status

# No `suite` prerequisite: `check` already renders the suite, and having it here
# meant a separate sub-make re-rendered every WAV a second time.
# Run `make suite plot` if you want plots from a clean render.
plot:
	.venv/bin/python tools/plot_renders.py

plot-stress:
	./scripts/render-demo.sh --stress
	PLOT_SUITE=stress .venv/bin/python tools/plot_renders.py
	pnpm run check-stress

plot-stress-all:
	status=0; for module in $$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('src/modules/index.json','utf8')).modules; console.log(m.filter(x => x.kind !== 'midi_fx').map(x => x.id).join(' '))"); do MODULE_ID=$$module ./scripts/render-demo.sh --stress || status=1; MODULE_ID=$$module PLOT_SUITE=stress .venv/bin/python tools/plot_renders.py || status=1; MODULE_ID=$$module pnpm run check-stress || status=1; done; exit $$status

test:
	./scripts/test.sh

host:
	./scripts/build-host.sh

move:
	./scripts/build.sh

install:
	./scripts/install-to-move.sh

wasm:
	./scripts/build-wasm.sh

deploy:
	./scripts/deploy-to-move.sh

gen-params:
	pnpm run gen-params

gen-presets:
	pnpm run gen-presets

move-health:
	./scripts/move-health.sh

move-logs:
	./scripts/tail-move-log.sh

move-cache:
	./scripts/clear-move-cache.sh

move-restart:
	./scripts/restart-move.sh

move-screen:
	node scripts/capture-move-screen.ts

# The one non-device gate. With MODULE_ID unset every step already covers all
# modules, so there is nothing for a separate check-all to add.
check:
	pnpm run typecheck
	pnpm run validate
	pnpm run test:ui-chain
	$(MAKE) test
	$(MAKE) suite
	pnpm run check-renders
	$(MAKE) stress
	$(MAKE) plot
	$(MAKE) host

# Kept as an alias so existing docs and muscle memory keep working.
check-all: check

format:
	pnpm run format

format-check:
	pnpm run format-check

gen-compile-commands:
	pnpm run gen-compile-commands

dev-deps:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements-dev.txt

clean:
	rm -rf build build-host dist dist-host renders/plots web/wasm/*.wasm
