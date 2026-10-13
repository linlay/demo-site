# Package only prebuilt Linux artifacts. This image build never installs dependencies.
# Before packaging: pnpm --dir frontend run build && make build-linux TARGET_ARCH=amd64
FROM scratch
COPY --chown=65532:65532 deploy/runtime/data/ /data/
COPY --chown=65532:65532 deploy/runtime/tmp/ /tmp/
COPY build/demo-site-server-linux /app/demo-site-server
COPY frontend/dist/ /app/web/
ENV AWCP_LISTEN=0.0.0.0:2181 \
    AWCP_DATABASE=/data/awcp.sqlite \
    AWCP_STATIC_DIR=/app/web \
    AWCP_ALLOWED_ORIGINS=http://127.0.0.1:2181 \
    AWCP_SECURE_COOKIE=false \
    AWCP_DATA_PROFILE=acceptance
USER 65532:65532
EXPOSE 2181
VOLUME ["/data"]
ENTRYPOINT ["/app/demo-site-server"]
