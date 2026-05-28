.PHONY: render suite plot test host move wasm deploy gen-params move-health move-logs move-cache move-restart move-screen check check-all dev-deps clean

render:
	./scripts/render-demo.sh

suite:
	./scripts/render-demo.sh --suite

plot: suite
	.venv/bin/python tools/plot_renders.py

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
