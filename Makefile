.PHONY: render suite plot test host move wasm deploy check check-all dev-deps clean

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

check:
	npm run typecheck
	npm run validate
	$(MAKE) test
	$(MAKE) suite
	npm run check-renders
	$(MAKE) plot
	$(MAKE) host

check-all:
	npm run typecheck
	npm run validate
	$(MAKE) test
	$(MAKE) suite
	npm run check-renders
	$(MAKE) plot
	$(MAKE) host
	MODULE_ID=dustline $(MAKE) suite
	MODULE_ID=dustline npm run check-renders
	MODULE_ID=dustline $(MAKE) plot
	MODULE_ID=dustline $(MAKE) host

dev-deps:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements-dev.txt

clean:
	rm -rf build build-host dist dist-host renders/plots
