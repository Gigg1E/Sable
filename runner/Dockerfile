# Sandbox for the agent's scripts. Sees only the workspace volume; runs as an unprivileged user.
FROM python:3.12-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs bash tini fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
# Common libraries so documents, spreadsheets, charts and PDFs work out of the box.
RUN pip install --no-cache-dir python-docx openpyxl matplotlib pandas pypdf reportlab pillow requests beautifulsoup4
RUN useradd --uid 1000 --create-home runner && mkdir -p /workspace && chown runner:runner /workspace
COPY server.mjs /app/server.mjs
USER runner
ENV RUNNER_WORKSPACE=/workspace RUNNER_PORT=8790
EXPOSE 8790
ENTRYPOINT ["tini", "--"]
CMD ["node", "/app/server.mjs"]
