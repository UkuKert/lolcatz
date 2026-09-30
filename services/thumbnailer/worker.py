"""Pre-generate both thumbnail sizes from retained upload events."""
import json
import logging
import os
from uuid import UUID

from worker_runtime import consume, kafka_security
from confluent_kafka import Consumer

from cache import ThumbnailCache
from thumbnail import InvalidImage

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def process_message(message, cache):
    payload = message.value()
    if payload is None:
        key = message.key()
        if key is None:
            log.error("skipping thumbnail tombstone without a key")
            return
        raw_id = key.decode()
    else:
        try:
            event = json.loads(payload)
        except (json.JSONDecodeError, UnicodeDecodeError):
            log.exception("skipping malformed thumbnail event")
            return
        if not isinstance(event, dict) or not isinstance(event.get("id"), str):
            log.error("skipping thumbnail event without a string image id")
            return
        raw_id = event["id"]
    try:
        image_id = str(UUID(raw_id))
    except ValueError:
        log.exception("skipping thumbnail event with an invalid image id")
        return
    if payload is None:
        cache.delete(image_id)
        return
    try:
        cache.ensure(image_id)
    except InvalidImage:
        log.exception("skipping unsupported/corrupt image %s", image_id)


def main():
    cache = ThumbnailCache()
    consumer = Consumer({
        **kafka_security(),
        "bootstrap.servers": os.environ["KAFKA_BROKERS"],
        "group.id": "lolcatz-thumbnailer",
        "auto.offset.reset": "earliest",
        "enable.auto.commit": False,
        "enable.auto.offset.store": False,
        "max.poll.interval.ms": 900000,
    })
    consumer.subscribe([os.environ.get("KAFKA_TOPIC", "lolcatz-images")])
    consume(consumer, lambda message: process_message(message, cache))



if __name__ == "__main__":
    main()
