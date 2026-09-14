FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download YOLO weights at build time so runtime starts cold-free
RUN python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"

RUN useradd -u 1001 -m app
COPY --chown=app:app tagger.py .
USER app

CMD ["python", "tagger.py"]
