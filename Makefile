.PHONY: render suite plot metrics check-renders bless-renders new-module test validate emulator-test host move wasm serve dev deploy check check-all dev-deps clean

render:
	./scripts/render-demo.sh

suite:
	./scripts/render-demo.sh --suite

plot: suite
	.venv/bin/python tools/plot_renders.py

metrics: suite
	node scripts/render-metrics.ts

check-renders:
	node scripts/check-renders.ts check

bless-renders:
	node scripts/check-renders.ts bless

new-module:
	@if [ -z "$(ID)" ]; then echo "usage: make new-module ID=<module-id> [NAME=<DisplayName>] [ABBREV=<AB>]"; exit 2; fi
	node scripts/new-module.ts --id $(ID) $(if $(NAME),--name "$(NAME)") $(if $(ABBREV),--abbrev "$(ABBREV)")

test:
	./scripts/test.sh

validate:
	node scripts/validate-params.ts

emulator-test:
	node scripts/test-emulator.ts

host:
	./scripts/build-host.sh

move:
	./scripts/build.sh

wasm:
	./scripts/build-wasm.sh

serve:
	node scripts/serve-web.ts

dev:
	node scripts/dev-web.ts

deploy:
	./scripts/deploy-to-move.sh

check: validate test suite check-renders plot host

check-all: validate test
	$(MAKE) suite
	$(MAKE) check-renders
	$(MAKE) plot
	$(MAKE) host
	MODULE_ID=dustline $(MAKE) suite
	MODULE_ID=dustline $(MAKE) check-renders
	MODULE_ID=dustline $(MAKE) plot
	MODULE_ID=dustline $(MAKE) host

dev-deps:
	python3 -m venv .venv
	.venv/bin/python -m pip install -r requirements-dev.txt

clean:
	rm -rf build build-host dist dist-host renders/plots
