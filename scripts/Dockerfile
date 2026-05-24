FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    gcc-aarch64-linux-gnu \
    libc6-dev-arm64-cross \
    make \
  && rm -rf /var/lib/apt/lists/*

