FROM debian:bookworm-slim

# ninja executes the generated build/move.ninja inside this container, so the
# whole cross build is one `docker run` and every path stays container-relative.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    gcc-aarch64-linux-gnu \
    libc6-dev-arm64-cross \
    ninja-build \
  && rm -rf /var/lib/apt/lists/*

