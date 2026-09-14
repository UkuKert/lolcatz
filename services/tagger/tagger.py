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


def main():
    model = YOLO("yolov8n.pt")
    log.info("YOLO model loaded")

    db = psycopg2.connect(must_env("DATABASE_URL"))
    db.autocommit = True
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

            results = model(io.BytesIO(img_bytes), verbose=False)
            tags = list({
                model.names[int(box.cls)]
                for r in results
                for box in r.boxes
                if float(box.conf) >= conf_threshold
            })
            log.info("image %s -> tags %s", image_id, tags)

            with db.cursor() as cur:
                cur.execute("UPDATE images SET tags = %s WHERE id = %s", (tags, image_id))

            producer.produce(topic_out, key=image_id.encode(),
                             value=json.dumps({"id": image_id, "tags": tags}).encode())
            producer.poll(0)

        except Exception as e:
            log.exception("failed to process %s: %s", msg.offset(), e)


if __name__ == "__main__":
    main()
