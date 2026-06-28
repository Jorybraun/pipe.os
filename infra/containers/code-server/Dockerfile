FROM codercom/code-server:4.22.1

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

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

RUN curl -fsSL https://cli.devin.ai/install.sh | bash || test -x /root/.local/bin/devin
RUN test -x /root/.local/bin/devin && /root/.local/bin/devin --version
ENV PATH="/root/.local/bin:${PATH}"

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY agent-diagnostics.js /usr/local/bin/agent-diagnostics.js
COPY agent-bridge.js /usr/local/bin/agent-bridge.js
RUN chmod +x /usr/local/bin/entrypoint.sh
RUN mkdir -p /workspace && chown -R coder:coder /workspace

# Cloudflare Containers currently exits this image during startup when the
# Dockerfile switches to the unprivileged coder user. Keep the dev preview
# container on root so code-server boots consistently in the beta runtime.
USER root

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
