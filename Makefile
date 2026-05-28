.PHONY: render suite stress stress-all plot plot-stress plot-stress-all test host move wasm deploy gen-params move-health move-logs move-cache move-restart move-screen check check-all dev-deps clean

render:
	./scripts/render-demo.sh

suite:
	./scripts/render-demo.sh --suite

stress:
	./scripts/render-demo.sh --stress
	pnpm run check-stress

stress-all:
	status=0; for module in $$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('src/modules/index.json','utf8')).modules; console.log(m.filter(x => x.kind !== 'midi_fx').map(x => x.id).join(' '))"); do MODULE_ID=$$module ./scripts/render-demo.sh --stress || status=1; MODULE_ID=$$module pnpm run check-stress || status=1; done; exit $$status

plot: suite
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

wasm:
	./scripts/build-wasm.sh

deploy:
	./scripts/deploy-to-move.sh

gen-params:
	pnpm run gen-params

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

check:
	pnpm run typecheck
	pnpm run validate
	$(MAKE) test
	$(MAKE) suite
	pnpm run check-renders
	$(MAKE) plot
	$(MAKE) host

check-all:
	pnpm run typecheck
	pnpm run validate
	$(MAKE) test
	$(MAKE) suite
	pnpm run check-renders
	$(MAKE) plot
	$(MAKE) host
	MODULE_ID=dustline $(MAKE) suite
	MODULE_ID=dustline pnpm run check-renders
	MODULE_ID=dustline $(MAKE) plot
	MODULE_ID=dustline $(MAKE) host

dev-deps:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements-dev.txt

clean:
	rm -rf build build-host dist dist-host renders/plots web/wasm/*.wasm
