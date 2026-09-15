"""OCR worker for captioned lolcat images."""

import io
import json
import logging
import os
import re

import boto3
import psycopg2
import pytesseract
from PIL import Image, ImageOps
from botocore.client import Config
from confluent_kafka import Consumer, KafkaError

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def env(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if not value:
        raise RuntimeError(f"required env var {name} is not set")
    return value


def make_s3():
    endpoint = env("S3_ENDPOINT")
    if not endpoint.startswith("http"):
        endpoint = "http://" + endpoint
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=env("S3_ACCESS_KEY"),
        aws_secret_access_key=env("S3_SECRET_KEY"),
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def sanitize_text(value: str) -> str:
    # Keep readable whitespace, remove terminal/control escapes, and bound DB/UI payloads.
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()[:20000]


def title_from_ocr(text: str) -> str:
    for line in text.splitlines():
        line = " ".join(line.split()).strip(" -–—")
        if line:
            return line[:160]
    return ""


def main():
    db = psycopg2.connect(env("DATABASE_URL"))
    db.autocommit = True
    with db.cursor() as cur:
        cur.execute("ALTER TABLE images ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb")

    s3 = make_s3()
    bucket = env("S3_BUCKET")
    language = env("OCR_LANGUAGE", "eng")
    consumer = Consumer({
        "bootstrap.servers": env("KAFKA_BROKERS"),
        "group.id": env("OCR_GROUP", "lolcatz-ocr"),
        "auto.offset.reset": "earliest",
        "enable.auto.commit": True,
    })
    consumer.subscribe([env("KAFKA_TOPIC", "lolcatz-images")])
    log.info("listening for OCR jobs using tesseract language %s", language)

    while True:
        message = consumer.poll(1.0)
        if message is None:
            continue
        if message.error():
            if message.error().code() != KafkaError._PARTITION_EOF:
                log.error("kafka error: %s", message.error())
            continue
        try:
            event = json.loads(message.value())
            image_id = event["id"]
            object_key = f"{event.get('board', 'b')}/{image_id}"
            image_bytes = s3.get_object(Bucket=bucket, Key=object_key)["Body"].read()
            with Image.open(io.BytesIO(image_bytes)) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
                text = sanitize_text(pytesseract.image_to_string(image, lang=language))

            with db.cursor() as cur:
                cur.execute(
                    """UPDATE images
                       SET metadata = COALESCE(metadata, '{}'::jsonb) || %s::jsonb,
                           title = CASE WHEN NULLIF(BTRIM(title), '') IS NULL
                                        THEN COALESCE(NULLIF(%s, ''), title)
                                        ELSE title END
                       WHERE id = %s""",
                    (json.dumps({"ocr_text": text, "ocr_language": language, "ocr_status": "complete"}), title_from_ocr(text), image_id),
                )
            log.info("OCR processed %s (%d characters)", image_id, len(text))
        except Exception:
            log.exception("failed to OCR message at offset %s", message.offset())


if __name__ == "__main__":
    main()
