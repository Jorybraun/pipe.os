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

# Switch back to the unprivileged coder user
USER coder

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
