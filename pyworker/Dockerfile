FROM python:3.11-slim

ARG BUILD_SHA=unknown
ARG BUILD_TIME=unknown

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV BUILD_SHA=$BUILD_SHA
ENV BUILD_TIME=$BUILD_TIME

EXPOSE 3002

CMD ["python3", "server.py"]
