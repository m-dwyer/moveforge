.PHONY: render suite plot test validate emulator-test host move wasm serve dev deploy dev-deps clean

render:
	./scripts/render-demo.sh

suite:
	./scripts/render-demo.sh --suite

plot: suite
	.venv/bin/python tools/plot_renders.py

test:
	./scripts/test.sh

validate:
	node scripts/validate-params.mjs

emulator-test:
	node scripts/test-emulator.mjs

host:
	./scripts/build-host.sh

move:
	./scripts/build.sh

wasm:
	./scripts/build-wasm.sh

serve:
	./scripts/serve-web.sh

dev:
	./scripts/dev-web.sh

deploy:
	./scripts/deploy-to-move.sh

dev-deps:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements-dev.txt

clean:
	rm -rf build build-host dist dist-host renders/plots
