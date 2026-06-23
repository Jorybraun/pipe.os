FROM codercom/code-server:4.22.1

# Switch to root to install system packages
USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    jq \
    ca-certificates \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
RUN mkdir -p /workspace && chown -R coder:coder /workspace

# Cloudflare Containers currently exits this image during startup when the
# Dockerfile switches to the unprivileged coder user. Keep the dev preview
# container on root so code-server boots consistently in the beta runtime.
USER root

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
