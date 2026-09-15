"""
Image tagger — consumes lolcatz-images Kafka topic, runs YOLO on each image,
writes tags back to Postgres and publishes to lolcatz-tags topic.
"""

import json
import logging
import os
import io
import psycopg2
import boto3
from PIL import Image, ImageOps
from botocore.client import Config
from confluent_kafka import Consumer, Producer, KafkaError
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


def must_env(k: str) -> str:
    v = os.environ.get(k)
    if not v:
        raise RuntimeError(f"required env var {k} is not set")
    return v


def get_env(k: str, default: str) -> str:
    return os.environ.get(k, default)


def make_s3():
    endpoint = must_env("S3_ENDPOINT")
    if not endpoint.startswith("http"):
        endpoint = "http://" + endpoint
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=must_env("S3_ACCESS_KEY"),
        aws_secret_access_key=must_env("S3_SECRET_KEY"),
        config=Config(signature_version="s3v4"),
        region_name="us-east-1",
    )


def _number(value):
    try:
        return round(float(value), 6)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _text(value):
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return str(value).strip(" \x00") if value is not None else ""


def _coordinate(values, reference):
    if not values or len(values) != 3:
        return None
    degrees = _number(values[0])
    minutes = _number(values[1])
    seconds = _number(values[2])
    if None in (degrees, minutes, seconds):
        return None
    coordinate = degrees + minutes / 60 + seconds / 3600
    if _text(reference).upper() in ("S", "W"):
        coordinate *= -1
    return round(coordinate, 7)


def extract_metadata(image):
    """Return useful EXIF fields while excluding device/owner serial data."""
    metadata = {"width": image.width, "height": image.height}
    exif = image.getexif()
    if not exif:
        return metadata

    text_fields = {
        271: "camera_make",
        272: "camera_model",
        305: "software",
        36867: "taken_at",
        36881: "timezone",
        42036: "lens_model",
    }
    number_fields = {
        274: "orientation",
        33434: "exposure_seconds",
        33437: "f_number",
        34855: "iso",
        37386: "focal_length_mm",
    }
    for tag, name in text_fields.items():
        value = _text(exif.get(tag))
        if value:
            metadata[name] = value
    for tag, name in number_fields.items():
        value = _number(exif.get(tag))
        if value is not None:
            metadata[name] = value

    try:
        gps = exif.get_ifd(34853)
    except (AttributeError, KeyError, TypeError):
        gps = {}
    latitude = _coordinate(gps.get(2), gps.get(1))
    longitude = _coordinate(gps.get(4), gps.get(3))
    if latitude is not None and longitude is not None:
        location = {"latitude": latitude, "longitude": longitude}
        altitude = _number(gps.get(6))
        if altitude is not None:
            location["altitude_m"] = -altitude if gps.get(5) == 1 else altitude
        metadata["gps"] = location

    return metadata


def main():
    model = YOLO(get_env("YOLO_MODEL_PATH", "yolov8n.pt"))
    log.info("YOLO model loaded")

    db = psycopg2.connect(must_env("DATABASE_URL"))
    db.autocommit = True
    with db.cursor() as cur:
        cur.execute("ALTER TABLE images ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb")
    log.info("postgres connected")

    s3 = make_s3()
    bucket = must_env("S3_BUCKET")
    brokers = must_env("KAFKA_BROKERS")
    topic_in = get_env("KAFKA_TOPIC_IN", "lolcatz-images")
    topic_out = get_env("KAFKA_TOPIC_OUT", "lolcatz-tags")
    conf_threshold = float(get_env("YOLO_CONF_THRESHOLD", "0.4"))

    consumer = Consumer({
        "bootstrap.servers": brokers,
        "group.id": "lolcatz-tagger",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": True,
    })
    consumer.subscribe([topic_in])

    producer = Producer({"bootstrap.servers": brokers})

    log.info("listening on %s", topic_in)
    while True:
        msg = consumer.poll(timeout=1.0)
        if msg is None:
            continue
        if msg.error():
            if msg.error().code() == KafkaError._PARTITION_EOF:
                continue
            log.error("kafka error: %s", msg.error())
            continue

        try:
            event = json.loads(msg.value())
            image_id = event["id"]
            board = event.get("board", "b")
            object_key = f"{board}/{image_id}"

            log.info("tagging %s", image_id)
            resp = s3.get_object(Bucket=bucket, Key=object_key)
            img_bytes = resp["Body"].read()

            # Ultralytics does not treat BytesIO as an image source. Decode
            # the object first and normalize orientation/color for inference.
            with Image.open(io.BytesIO(img_bytes)) as source:
                metadata = extract_metadata(source)
                image = ImageOps.exif_transpose(source).convert("RGB")
                image.load()
            results = model(image, verbose=False)
            tags = sorted({
                model.names[int(box.cls)]
                for r in results
                for box in r.boxes
                if float(box.conf) >= conf_threshold
            })
            log.info("image %s -> tags %s", image_id, tags)

            with db.cursor() as cur:
                cur.execute(
                    "UPDATE images SET tags = %s, metadata = %s::jsonb WHERE id = %s",
                    (tags, json.dumps(metadata), image_id),
                )

            producer.produce(topic_out, key=image_id.encode(),
                             value=json.dumps({"id": image_id, "tags": tags}).encode())
            producer.poll(0)

        except Exception as e:
            log.exception("failed to process %s: %s", msg.offset(), e)


if __name__ == "__main__":
    main()
